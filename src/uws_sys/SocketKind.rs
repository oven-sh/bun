//! Closed-world enum of every us_socket_t consumer in Bun. Stamped on the
//! socket at creation (`s->kind`) and switched on in `dispatch.rs` so the
//! event loop calls straight into the right Rust/C++ handler with the ext
//! already typed — no per-context vtable, no runtime SSL flag.
//!
//! Adding a kind:
//!   1. Add it here.
//!   2. Add an arm to every match in `dispatch.rs` (it's exhaustive, so
//!      forgetting is a compile error).
//!   3. Add a `SocketGroup` field to whatever owns the sockets.
//!
//! The `*Tls` variants exist so dispatch can devirtualise the TLS layer too:
//! the loop already knows from `s->ssl != NULL` whether to decrypt, but the
//! *handler* often differs (e.g. `Bun.connect` TCP vs TLS land in different
//! Rust types). Where the handler is identical for both, a single kind is used
//! and the handler reads `s.is_tls()` itself.

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SocketKind {
    /// Reserved. `loop.c` callocs sockets, so 0 must be a value that crashes
    /// loudly if dispatch ever sees it instead of silently routing somewhere.
    Invalid = 0,

    /// Dispatch reads `group->vtable->on_*`. For sockets whose handler set is
    /// only known at runtime (uWS C++ via per-App vtable, tests).
    Dynamic,

    // ── Bun.connect / Bun.listen (src/runtime/api/bun/socket.zig) ──────────
    BunSocketTcp,
    BunSocketTls,
    /// Server-accepted socket; ext is the `*Listener` so onCreate can attach
    /// a fresh `NewSocket` before re-stamping to `BunSocket{Tcp,Tls}`.
    BunListenerTcp,
    BunListenerTls,

    // ── HTTP client thread (src/http/HTTPContext.zig) ─────────────────────
    HttpClient,
    HttpClientTls,

    // ── new WebSocket(...) client (src/http/websocket_client*) ────────────
    WsClientUpgrade,
    WsClientUpgradeTls,
    WsClient,
    WsClientTls,

    // ── Database drivers ──────────────────────────────────────────────────
    Postgres,
    PostgresTls,
    Mysql,
    MysqlTls,
    Valkey,
    ValkeyTls,

    // ── Bun.spawn IPC over socketpair ─────────────────────────────────────
    SpawnIpc,

    // ── Bun.serve / uWS — handlers live in C++; dispatch calls a thunk and
    //    the thunk reads `group->ext` as the templated `HttpContext<SSL>*`.
    UwsHttp,
    UwsHttpTls,
    UwsWs,
    UwsWsTls,
}

impl SocketKind {
    #[inline]
    pub const fn is_tls(self) -> bool {
        matches!(
            self,
            SocketKind::BunSocketTls
                | SocketKind::BunListenerTls
                | SocketKind::HttpClientTls
                | SocketKind::WsClientUpgradeTls
                | SocketKind::WsClientTls
                | SocketKind::PostgresTls
                | SocketKind::MysqlTls
                | SocketKind::ValkeyTls
                | SocketKind::UwsHttpTls
                | SocketKind::UwsWsTls
        )
    }
}

// `unsigned char kind` on us_socket_t — full byte, not the flags bitfield.
// Zig: `comptime bun.assert(@typeInfo(SocketKind).@"enum".fields.len <= 256)`.
// In Rust, `#[repr(u8)]` already refuses to compile with >256 variants, so the
// invariant is enforced by the type system; no explicit assert needed.

/// The four kinds whose handlers live in C++ are also referenced from C++
/// (`packages/bun-uws/src/SocketKinds.h`). Export their ordinals so the C++
/// side links against the Rust source of truth instead of mirroring literals
/// that silently rot if this enum is reordered.
#[unsafe(no_mangle)]
pub static BUN_SOCKET_KIND_DYNAMIC: u8 = SocketKind::Dynamic as u8;
#[unsafe(no_mangle)]
pub static BUN_SOCKET_KIND_UWS_HTTP: u8 = SocketKind::UwsHttp as u8;
#[unsafe(no_mangle)]
pub static BUN_SOCKET_KIND_UWS_HTTP_TLS: u8 = SocketKind::UwsHttpTls as u8;
#[unsafe(no_mangle)]
pub static BUN_SOCKET_KIND_UWS_WS: u8 = SocketKind::UwsWs as u8;
#[unsafe(no_mangle)]
pub static BUN_SOCKET_KIND_UWS_WS_TLS: u8 = SocketKind::UwsWsTls as u8;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/SocketKind.zig (101 lines)
//   confidence: high
//   todos:      0
//   notes:      #[repr(u8)] enforces the ≤256-variant invariant; exported ordinals are `static` (linkage matches Zig `export const`).
// ──────────────────────────────────────────────────────────────────────────
