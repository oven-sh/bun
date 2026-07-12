//! Socket event dispatch wiring. This module is the ONLY place that knows
//! the kind→handler mapping: `BUN_UWS_KIND_TABLE` is the fully
//! const-initialized kind table (one monomorphized Protocol v2 row per Rust
//! `SocketKind`) plus the TLS side-channel hooks (raw ciphertext tap /
//! deferred session / keylog delivery). `bun_usockets` resolves both
//! `no_mangle` statics at link time — no runtime registration exists, and a
//! missing/misplaced kind is a compile error (array shape +
//! `validate_kind_table`).

use core::ptr::NonNull;

use bun_usockets as uws;
use bun_usockets::unsafe_core::trampolines::with_socket_owner;
use bun_usockets::us_socket_t;
use uws::{KindEntry, KindTable, SOCKET_KIND_COUNT, TlsSideChannelHooks, kind_entry};

use super::uws_handlers as handlers;

/// Wrap a raw dispatch pointer in a generation-carrying handle.
#[inline]
pub(crate) fn wrap<const SSL: bool>(s: *mut us_socket_t) -> uws::NewSocketHandler<SSL> {
    uws::NewSocketHandler::from(uws::SocketRef::from_live(
        NonNull::new(s).expect("dispatch socket is non-null"),
    ))
}

// ── the link-time kind table ─────────────────────────────────────────────────
// One const row per Rust-handled kind. `kind_entry` const-eval traps a row
// built for the wrong kind; `validate_kind_table` traps a row placed at the
// wrong index; the array shape traps a missing kind when SOCKET_KIND_COUNT
// grows. Group-vtable kinds (Dynamic, UwsHttp*/UwsWs*) and the ABI-reserved
// listener kinds stay `None` — their routing is fixed in core.

use bun_usockets::SocketKind as K;

const E_BUN_TCP: KindEntry = kind_entry::<handlers::BunSocket<false>>(K::BunSocketTcp);
const E_BUN_TLS: KindEntry = kind_entry::<handlers::BunSocket<true>>(K::BunSocketTls);
const E_HTTP: KindEntry = kind_entry::<bun_http::http_context::HttpProtocol<false>>(K::HttpClient);
const E_HTTP_TLS: KindEntry =
    kind_entry::<bun_http::http_context::HttpProtocol<true>>(K::HttpClientTls);
const E_WS_UPGRADE: KindEntry = kind_entry::<
    bun_http_jsc::websocket_client::websocket_upgrade_client::HTTPClient<false>,
>(K::WsClientUpgrade);
const E_WS_UPGRADE_TLS: KindEntry = kind_entry::<
    bun_http_jsc::websocket_client::websocket_upgrade_client::HTTPClient<true>,
>(K::WsClientUpgradeTls);
const E_WS: KindEntry =
    kind_entry::<bun_http_jsc::websocket_client::WebSocket<false>>(K::WsClient);
const E_WS_TLS: KindEntry =
    kind_entry::<bun_http_jsc::websocket_client::WebSocket<true>>(K::WsClientTls);
const E_POSTGRES: KindEntry = kind_entry::<
    bun_sql_jsc::postgres::postgres_sql_connection::PostgresProtocol,
>(K::Postgres);
const E_POSTGRES_TLS: KindEntry = kind_entry::<
    bun_sql_jsc::postgres::postgres_sql_connection::PostgresProtocol,
>(K::PostgresTls);
const E_MYSQL: KindEntry =
    kind_entry::<bun_sql_jsc::mysql::js_my_sql_connection::MySQLSocketProtocol>(K::Mysql);
const E_MYSQL_TLS: KindEntry =
    kind_entry::<bun_sql_jsc::mysql::js_my_sql_connection::MySQLSocketProtocol>(K::MysqlTls);
const E_VALKEY: KindEntry =
    kind_entry::<crate::valkey_jsc::js_valkey::ValkeyProtocol>(K::Valkey);
const E_VALKEY_TLS: KindEntry =
    kind_entry::<crate::valkey_jsc::js_valkey::ValkeyProtocol>(K::ValkeyTls);
const E_SPAWN_IPC: KindEntry = kind_entry::<bun_jsc::ipc::SpawnIpcProtocol>(K::SpawnIpc);
#[cfg(not(windows))]
const E_TEST_CHANNEL: KindEntry =
    kind_entry::<crate::cli::test::parallel::channel::ChannelProtocol>(K::TestChannel);

const KIND_TABLE: KindTable = [
    /* Invalid (trap) */ None,
    /* Dynamic (group vtable) */ None,
    Some(&E_BUN_TCP),
    Some(&E_BUN_TLS),
    /* BunListenerTcp (ABI-reserved) */ None,
    /* BunListenerTls (ABI-reserved) */ None,
    Some(&E_HTTP),
    Some(&E_HTTP_TLS),
    Some(&E_WS_UPGRADE),
    Some(&E_WS_UPGRADE_TLS),
    Some(&E_WS),
    Some(&E_WS_TLS),
    Some(&E_POSTGRES),
    Some(&E_POSTGRES_TLS),
    Some(&E_MYSQL),
    Some(&E_MYSQL_TLS),
    Some(&E_VALKEY),
    Some(&E_VALKEY_TLS),
    Some(&E_SPAWN_IPC),
    /* UwsHttp (group vtable) */ None,
    /* UwsHttpTls (group vtable) */ None,
    /* UwsWs (group vtable) */ None,
    /* UwsWsTls (group vtable) */ None,
    /* TestChannel (uv pipes on Windows) */
    #[cfg(not(windows))]
    Some(&E_TEST_CHANNEL),
    #[cfg(windows)]
    None,
];

// Compile-time: every row sits at its own kind's index (KIND_TABLE cannot be
// a static for this check — const eval cannot read statics).
const _: () = uws::validate_kind_table(&KIND_TABLE);
const _: () = assert!(KIND_TABLE.len() == SOCKET_KIND_COUNT);

/// The one definition `bun_usockets` dispatch resolves at link time.
#[unsafe(no_mangle)]
static BUN_UWS_KIND_TABLE: KindTable = KIND_TABLE;

// ── TLS side-channel hooks (only `BunSocketTls` sockets reach these; the
// dispatch driver gates on kind + slot liveness before calling). Same
// link-time seam as the kind table. ──────────────────────────────────────────

#[unsafe(no_mangle)]
static BUN_UWS_TLS_SIDE_CHANNEL: TlsSideChannelHooks = TlsSideChannelHooks {
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
    let sock = wrap::<true>(s);
    // upgradeTLS sets the tap bit only after the owner-swapping adopt, so an
    // unstamped/mistyped owner here is an invariant violation — loud in debug.
    let twin = with_socket_owner::<true, TLSSocket, _>(&sock, |tls| {
        tls.twin.get().as_ref().cloned()
    });
    debug_assert!(twin.is_some(), "ssl_raw_tap on unstamped ext");
    // Hold our own +1 on the `[raw, _]` twin across the handler: `on_data`
    // may re-enter JS and drop the `tls.twin` ref mid-call.
    let Some(Some(twin)) = twin else { return };
    TLSSocket::on_data(uws::this_ptr_of(twin.data()), sock, data);
    twin.deref();
}

/// A new (resumable) TLS session is ready. The core parks the serialized
/// session while `SSL_read`/`SSL_do_handshake` runs and delivers it here once
/// that stack has unwound (contract C11). Mirrors Node's `NewSessionCallback`
/// → `onnewsession` flow.
fn session_hook(s: *mut us_socket_t, session: &[u8]) {
    let _ = with_socket_owner::<true, TLSSocket, _>(&wrap::<true>(s), |tls| {
        let _ = TLSSocket::on_session(uws::this_ptr_of(tls), session);
    });
}

/// Hands an NSS key-log line parked by the keylog callback to the JS
/// `keylog` handler (deferred like sessions — contract C11).
fn keylog_hook(s: *mut us_socket_t, line: &[u8]) {
    let _ = with_socket_owner::<true, TLSSocket, _>(&wrap::<true>(s), |tls| {
        let _ = TLSSocket::on_keylog(uws::this_ptr_of(tls), line);
    });
}
