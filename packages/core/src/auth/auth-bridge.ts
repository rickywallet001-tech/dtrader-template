/**
 * auth-bridge.ts — dtrader-template
 *
 * Receives the auth token from the TradeXpro parent window and applies it
 * using the SAME storage shape the real client-store reads on boot:
 *   sessionStorage['auth_info']        = { access_token, refresh_token, expires_at }
 *   localStorage['client.accounts']    = { [loginid]: { token, ... } }
 *   localStorage['active_loginid']     = loginid
 *
 * Protocol:
 *   1. dtrader sends  { type: 'DTRADER_AUTH_READY' }  to parent
 *   2. parent sends   { type: 'TRADEXPRO_AUTH', token, loginid, accounts }
 *   3. dtrader stores it in the real shape and reloads so client-store boots authed
 */

const ALLOWED_PARENT_ORIGIN = 'https://tradexpro.co.ke';

const AUTH_INFO_KEY = 'auth_info';
const ACCOUNTS_KEY = 'client.accounts';
const ACTIVE_LOGINID_KEY = 'active_loginid';

type IncomingAccount = { account: string; token: string; currency?: string };

function applyAuth(data: { token: string; loginid?: string; accounts?: IncomingAccount[] }): void {
    if (!data.token) return;

    // Capture this BEFORE any writes below — it's what decides whether we
    // actually need to reload.
    const previousLoginid = sessionStorage.getItem(ACTIVE_LOGINID_KEY);

    // 1) What getStoredToken() actually reads
    sessionStorage.setItem(
        AUTH_INFO_KEY,
        JSON.stringify({ access_token: data.token, refresh_token: null, expires_at: null })
    );

    // 2) What getAccountsFromLocalStorage() actually reads
    const accountsList = data.accounts?.length
        ? data.accounts
        : data.loginid
          ? [{ account: data.loginid, token: data.token }]
          : [];
    if (accountsList.length) {
        const accountsMap: Record<string, unknown> = {};
        accountsList.forEach(acc => {
            accountsMap[acc.account] = {
                token: acc.token || data.token,
                accepted_bch: 1,
                landing_company_shortcode: 'svg',
                residence: '',
                session_start: Math.floor(Date.now() / 1000),
            };
        });
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accountsMap));
    }

    // 3) What getActiveLoginIDFromLocalStorage() actually reads.
    // client-store's init() checks sessionStorage's active_loginid FIRST,
    // before localStorage — so it must be set here too, or a stale entry
    // from an earlier boot in this same tab (e.g. an unauthenticated
    // default) will keep winning on every reload and shadow this value.
    const activeLoginid = data.loginid || accountsList[0]?.account;
    if (activeLoginid) {
        sessionStorage.setItem(ACTIVE_LOGINID_KEY, activeLoginid);
        localStorage.setItem(ACTIVE_LOGINID_KEY, activeLoginid);
    }

    // client-store reads these synchronously on app boot, not reactively —
    // so a reload is the only way the already-running app picks up a
    // change. Reload whenever the active account actually differs from
    // what was last applied (covers first login AND every subsequent
    // Demo<->Real switch on the parent site). A flat one-time flag here
    // previously meant only the very first TRADEXPRO_AUTH message ever
    // triggered a reload — every account switch after that silently wrote
    // the new loginid to storage but left the running app on whichever
    // account was active at first boot, trading real/demo funds that
    // didn't match what the parent site displayed.
    if (activeLoginid && activeLoginid !== previousLoginid) {
        window.location.reload();
    }
}

export function initAuthBridge(): void {
    window.addEventListener('message', (event: MessageEvent) => {
        if (event.origin !== ALLOWED_PARENT_ORIGIN) return;

        const data = event.data as { type?: string } & Parameters<typeof applyAuth>[0];

        if (data?.type === 'TRADEXPRO_AUTH') {
            applyAuth(data);
            return;
        }

        if (data?.type === 'AUTH_LOGOUT') {
            sessionStorage.removeItem(AUTH_INFO_KEY);
            sessionStorage.removeItem('tradexpro_auth_applied');
            sessionStorage.removeItem(ACTIVE_LOGINID_KEY);
            localStorage.removeItem(ACCOUNTS_KEY);
            localStorage.removeItem(ACTIVE_LOGINID_KEY);
            window.location.reload();
        }
    });

    // Signal parent that we are ready to receive tokens.
    // '*' is fine here — the inbound listener above enforces origin, not this call.
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'DTRADER_AUTH_READY' }, '*');
    }
}
