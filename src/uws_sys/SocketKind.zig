//! Closed-world enum of every us_socket_t consumer in Bun. Stamped on the
//! socket at creation (`s->kind`) and switched on in `dispatch.zig` so the
//! event loop calls straight into the right Zig/C++ handler with the ext
//! already typed — no per-context vtable, no runtime SSL flag.
//!
//! Adding a kind:
//!   1. Add it here.
//!   2. Add an arm to every switch in `dispatch.zig` (it's `exhaustive`, so
//!      forgetting is a compile error).
//!   3. Add a `SocketGroup` field to whatever owns the sockets.
//!
//! The `_tls` variants exist so dispatch can devirtualise the TLS layer too:
//! the loop already knows from `s->ssl != NULL` whether to decrypt, but the
//! *handler* often differs (e.g. `Bun.connect` TCP vs TLS land in different
//! Zig types). Where the handler is identical for both, a single kind is used
//! and the handler reads `s.isTLS()` itself.

pub const SocketKind = enum(u8) {
    /// Reserved. `loop.c` callocs sockets, so 0 must be a value that crashes
    /// loudly if dispatch ever sees it instead of silently routing somewhere.
    invalid = 0,

    /// Dispatch reads `group->vtable->on_*`. For sockets whose handler set is
    /// only known at runtime (uWS C++ via per-App vtable, tests).
    dynamic,

    // ── Bun.connect / Bun.listen (src/runtime/api/bun/socket.zig) ──────────
    bun_socket_tcp,
    bun_socket_tls,
    /// Server-accepted socket; ext is the `*Listener` so onCreate can attach
    /// a fresh `NewSocket` before re-stamping to `bun_socket_{tcp,tls}`.
    bun_listener_tcp,
    bun_listener_tls,

    // ── HTTP client thread (src/http/HTTPContext.zig) ─────────────────────
    http_client,
    http_client_tls,

    // ── new WebSocket(...) client (src/http/websocket_client*) ────────────
    ws_client_upgrade,
    ws_client_upgrade_tls,
    ws_client,
    ws_client_tls,

    // ── Database drivers ──────────────────────────────────────────────────
    postgres,
    postgres_tls,
    mysql,
    mysql_tls,
    valkey,
    valkey_tls,

    // ── Bun.spawn IPC over socketpair ─────────────────────────────────────
    spawn_ipc,

    // ── Bun.serve / uWS — handlers live in C++; dispatch calls a thunk and
    //    the thunk reads `group->ext` as the templated `HttpContext<SSL>*`.
    uws_http,
    uws_http_tls,
    uws_ws,
    uws_ws_tls,

    pub inline fn isTLS(self: SocketKind) bool {
        return switch (self) {
            .bun_socket_tls,
            .bun_listener_tls,
            .http_client_tls,
            .ws_client_upgrade_tls,
            .ws_client_tls,
            .postgres_tls,
            .mysql_tls,
            .valkey_tls,
            .uws_http_tls,
            .uws_ws_tls,
            => true,
            else => false,
        };
    }
};

comptime {
    // `unsigned char kind` on us_socket_t — full byte, not the flags bitfield.
    bun.assert(@typeInfo(SocketKind).@"enum".fields.len <= 256);
}

/// The four kinds whose handlers live in C++ are also referenced from C++
/// (`packages/bun-uws/src/SocketKinds.h`). Export their ordinals so the C++
/// side links against the Zig source of truth instead of mirroring literals
/// that silently rot if this enum is reordered.
const exported_ordinals = struct {
    export const BUN_SOCKET_KIND_DYNAMIC: u8 = @intFromEnum(SocketKind.dynamic);
    export const BUN_SOCKET_KIND_UWS_HTTP: u8 = @intFromEnum(SocketKind.uws_http);
    export const BUN_SOCKET_KIND_UWS_HTTP_TLS: u8 = @intFromEnum(SocketKind.uws_http_tls);
    export const BUN_SOCKET_KIND_UWS_WS: u8 = @intFromEnum(SocketKind.uws_ws);
    export const BUN_SOCKET_KIND_UWS_WS_TLS: u8 = @intFromEnum(SocketKind.uws_ws_tls);
};
comptime {
    _ = exported_ordinals;
}

const bun = @import("bun");
