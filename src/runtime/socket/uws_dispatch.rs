//! Socket event dispatch wiring. The Rust core (`bun_usockets`) drives its
//! own kind→vtable dispatch tables; this module is the ONLY place that knows
//! the kind→handler mapping. [`ensure_registered`] installs a static
//! monomorphized vtable per Rust `SocketKind` plus the TLS side-channel hooks
//! (raw ciphertext tap / deferred session / keylog delivery), and runs at VM
//! init — before the first socket of any of these kinds can be created.

use core::ptr::NonNull;

use bun_ptr::ThisPtr;
use bun_usockets as uws;
use bun_usockets::dispatch::{self, TlsSideChannelHooks};
use bun_usockets::{ConnectingSocket, SocketKind, us_socket_t};

use super::uws_handlers as handlers;

/// Reborrow a live dispatch socket pointer. The core only dispatches live,
/// non-null slab-resident sockets, and slots are not recycled until the tick
/// postlude (C6) — the same contract the old opaque `opaque_mut` relied on.
#[inline]
pub(crate) fn hdr<'a>(s: *mut us_socket_t) -> &'a mut us_socket_t {
    debug_assert!(!s.is_null());
    // SAFETY: per the contract above.
    unsafe { &mut *s }
}

/// Connecting-socket variant of [`hdr`] (same slab-residency contract).
#[inline]
pub(crate) fn conn<'a>(c: *mut ConnectingSocket) -> &'a mut ConnectingSocket {
    debug_assert!(!c.is_null());
    // SAFETY: per the contract above.
    unsafe { &mut *c }
}

/// Wrap a raw dispatch pointer in a generation-carrying handle.
#[inline]
pub(crate) fn wrap<const SSL: bool>(s: *mut us_socket_t) -> uws::NewSocketHandler<SSL> {
    uws::NewSocketHandler::from(uws::SocketRef::from_live(
        NonNull::new(s).expect("dispatch socket is non-null"),
    ))
}

/// Register every Rust-handled kind's vtable + the TLS side-channel hooks.
/// Idempotent; must run before the first socket of any Rust kind is created.
/// Callers: each Bun-socket entry point (listen/connect/upgradeTLS), plus
/// `jsc_hooks::init_runtime_state` — VM init precedes every lower-tier
/// consumer (fetch/WebSocket/SQL/spawn-IPC), which cannot call up into this
/// crate themselves.
pub fn ensure_registered() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        use dispatch::register_kind;

        // Bun.connect / Bun.listen
        register_kind::<handlers::BunSocket<false>>(SocketKind::BunSocketTcp);
        register_kind::<handlers::BunSocket<true>>(SocketKind::BunSocketTls);
        register_kind::<handlers::BunListener<false>>(SocketKind::BunListenerTcp);
        register_kind::<handlers::BunListener<true>>(SocketKind::BunListenerTls);

        // HTTP client thread
        register_kind::<handlers::HTTPClient<false>>(SocketKind::HttpClient);
        register_kind::<handlers::HTTPClient<true>>(SocketKind::HttpClientTls);

        // WebSocket client
        register_kind::<handlers::WSUpgrade<false>>(SocketKind::WsClientUpgrade);
        register_kind::<handlers::WSUpgrade<true>>(SocketKind::WsClientUpgradeTls);
        register_kind::<handlers::WSClient<false>>(SocketKind::WsClient);
        register_kind::<handlers::WSClient<true>>(SocketKind::WsClientTls);

        // SQL drivers
        register_kind::<handlers::Postgres<false>>(SocketKind::Postgres);
        register_kind::<handlers::Postgres<true>>(SocketKind::PostgresTls);
        register_kind::<handlers::MySQL<false>>(SocketKind::Mysql);
        register_kind::<handlers::MySQL<true>>(SocketKind::MysqlTls);
        register_kind::<handlers::Valkey<false>>(SocketKind::Valkey);
        register_kind::<handlers::Valkey<true>>(SocketKind::ValkeyTls);

        // IPC
        register_kind::<handlers::SpawnIPC>(SocketKind::SpawnIpc);

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
    let ext = *hdr(s).ext::<Option<ThisPtr<TLSSocket>>>();
    // upgradeTLS sets the tap bit only after stamping ext, so an unstamped
    // slot here is an invariant violation — loud in debug, no-op in release.
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
