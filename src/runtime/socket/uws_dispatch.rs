//! Socket event dispatch wiring. The Rust core (`bun_usockets`) drives its
//! own kind→vtable dispatch tables; this module is the ONLY place that knows
//! the kind→handler mapping. [`ensure_registered`] installs a static
//! monomorphized vtable per Rust `SocketKind` plus the TLS side-channel hooks
//! (raw ciphertext tap / deferred session / keylog delivery), and runs at
//! process + VM init — before the first socket of any of these kinds exists.

use core::ptr::NonNull;

use bun_ptr::ThisPtr;
use bun_usockets as uws;
use bun_usockets::dispatch::{self, TlsSideChannelHooks};
use bun_usockets::{SocketKind, us_socket_t};

use super::uws_handlers as handlers;

/// Reborrow a live socket pointer arriving from a core callback (TLS
/// side-channel hooks here, the SNI select-cert callback in Listener.rs):
/// the core only hands out live slab-resident sockets and slots are not
/// recycled until the tick postlude (C6). The returned `&mut` must NOT span
/// any call that can dispatch (close/write/handshake/feed) — use the
/// raw-routed `NewSocketHandler` methods for those (C17).
#[inline]
pub(crate) fn hdr<'a>(s: *mut us_socket_t) -> &'a mut us_socket_t {
    debug_assert!(!s.is_null());
    // SAFETY: per the contract above.
    unsafe { &mut *s }
}

/// Wrap a raw dispatch pointer in a generation-carrying handle.
#[inline]
pub(crate) fn wrap<const SSL: bool>(s: *mut us_socket_t) -> uws::NewSocketHandler<SSL> {
    uws::NewSocketHandler::from(uws::SocketRef::from_live(
        NonNull::new(s).expect("dispatch socket is non-null"),
    ))
}

/// Register every Protocol v2 kind this binary dispatches on the JS thread,
/// plus the TLS side-channel hooks. Idempotent; must run before the first
/// socket of any of these kinds is created. Callers: process start
/// (`cli::Command::start`, covering VM-less paths like `bun install`), VM
/// init (`jsc_hooks::init_runtime_state`, covering embedded/worker paths),
/// and each Bun-socket entry point. Registration is `Once`-guarded here and
/// idempotent in the kind tables, so consumers that self-register at their
/// own entry points (postgres/mysql at connect, spawn-IPC at adoption) are
/// safe to double-register.
pub fn ensure_registered() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        // Bun.connect / Bun.listen (accepted sockets carry the same kinds —
        // the listener itself never dispatches; see `Listener::listen`).
        uws::register::<handlers::BunSocket<false>>();
        uws::register::<handlers::BunSocket<true>>();

        // HTTP client thread (kind tables are process-global; registering
        // from the JS thread covers the HTTP thread's loop too).
        bun_http::http_context::register_protocol();

        // WebSocket client (upgrade + framed, TCP + TLS).
        bun_http_jsc::websocket_client::register_ws_client_protocols();

        // Valkey (postgres/mysql/spawn-IPC self-register at their own
        // connect/adoption entry points in their crates).
        uws::register::<crate::valkey_jsc::js_valkey::ValkeyProtocol>();

        dispatch::register_tls_side_channel(&TLS_HOOKS);
    });
}

// ── TLS side-channel hooks (only `BunSocketTls` sockets reach these; the
// dispatch driver gates on kind + slot liveness before calling) ─────────────

static TLS_HOOKS: TlsSideChannelHooks = TlsSideChannelHooks {
    ssl_raw_tap: ssl_raw_tap_hook,
    session: session_hook,
    keylog: keylog_hook,
};

type TLSSocket = super::NewSocket<true>;

/// Ciphertext tap for `socket.upgradeTLS()` — fires on the `[raw, _]` half of
/// the returned pair before decryption. Only `BunSocketTls` sockets with the
/// `ssl_raw_tap` bit set produce this event; delivery goes to the `twin`
/// TLSSocket's `on_data`.
fn ssl_raw_tap_hook(s: *mut us_socket_t, data: &[u8]) {
    debug_assert!(hdr(s).kind() == SocketKind::BunSocketTls);
    // The ext word is the core-held Protocol v2 owner (`*mut TLSSocket`,
    // nullable) — layout-identical to `Option<ThisPtr<..>>`; read-only here.
    let ext = *hdr(s).ext::<Option<ThisPtr<TLSSocket>>>();
    // upgradeTLS sets the tap bit only after the owner-swapping adopt, so an
    // unstamped slot here is an invariant violation — loud in debug only.
    debug_assert!(ext.is_some(), "ssl_raw_tap on unstamped ext");
    let Some(tls) = ext else { return };
    if let Some(raw) = tls.twin.get().as_ref() {
        // `twin` is `IntrusiveRc<Self>`; grab the raw `*mut` without consuming
        // the ref so the +1 stays put.
        let raw: *mut TLSSocket = raw.as_ptr();
        // SAFETY: `twin` holds a live +1 ref to the `[raw, _]` half, so `raw`
        // is live for `ThisPtr::new`; dispatch is single-threaded so no
        // aliasing `&mut` exists.
        unsafe { TLSSocket::on_data(ThisPtr::new(raw), wrap::<true>(s), data) };
    }
}

/// A new (resumable) TLS session is ready. The core parks the serialized
/// session while `SSL_read`/`SSL_do_handshake` runs and delivers it here once
/// that stack has unwound (contract C11). Mirrors Node's `NewSessionCallback`
/// → `onnewsession` flow.
fn session_hook(s: *mut us_socket_t, session: &[u8]) {
    let Some(tls) = *hdr(s).ext::<Option<ThisPtr<TLSSocket>>>() else {
        return;
    };
    let _ = TLSSocket::on_session(tls, session);
}

/// Hands an NSS key-log line parked by the keylog callback to the JS
/// `keylog` handler (deferred like sessions — contract C11).
fn keylog_hook(s: *mut us_socket_t, line: &[u8]) {
    let Some(tls) = *hdr(s).ext::<Option<ThisPtr<TLSSocket>>>() else {
        return;
    };
    let _ = TLSSocket::on_keylog(tls, line);
}
