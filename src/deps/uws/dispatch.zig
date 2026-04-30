//! Socket event dispatch. `loop.c` calls these `us_dispatch_*` exports for
//! every readable/writable/close/etc; we switch on `s->kind` and direct-call
//! the right Zig handler with the ext already typed. C++ kinds (uWS) and
//! `.dynamic` go through `s->group->vtable`.
//!
//! This file is the ONLY place that knows the kind→handler mapping. Adding a
//! kind to `SocketKind` forces a compile error here until every event has an
//! arm — no silent fallthrough.

comptime {
    // Force these into the link even if nothing in Zig calls them.
    _ = us_dispatch_open;
    _ = us_dispatch_data;
    _ = us_dispatch_fd;
    _ = us_dispatch_writable;
    _ = us_dispatch_close;
    _ = us_dispatch_timeout;
    _ = us_dispatch_long_timeout;
    _ = us_dispatch_end;
    _ = us_dispatch_connect_error;
    _ = us_dispatch_connecting_error;
    _ = us_dispatch_handshake;
    _ = us_dispatch_is_low_prio;
    _ = us_dispatch_ssl_raw_tap;
}

/// kind → vtable. Zig kinds get a comptime-generated `Trampolines(H)` vtable
/// (so the call is *still* indirect by one pointer, but the table itself is
/// `.rodata` and there's exactly one per kind — not one per connection). C++
/// kinds use the per-group vtable since the handler closure differs per App.
///
/// `.invalid` is intentionally null so a missed `kind` stamp crashes here
/// instead of dispatching into the wrong handler.
const tables = blk: {
    var t = std.EnumArray(SocketKind, ?*const VTable).initFill(null);

    // Bun.connect / Bun.listen
    t.set(.bun_socket_tcp, vtable.make(handlers.BunSocket(false)));
    t.set(.bun_socket_tls, vtable.make(handlers.BunSocket(true)));
    t.set(.bun_listener_tcp, vtable.make(handlers.BunListener(false)));
    t.set(.bun_listener_tls, vtable.make(handlers.BunListener(true)));

    // HTTP client thread
    t.set(.http_client, vtable.make(handlers.HTTPClient(false)));
    t.set(.http_client_tls, vtable.make(handlers.HTTPClient(true)));

    // WebSocket client
    t.set(.ws_client_upgrade, vtable.make(handlers.WSUpgrade(false)));
    t.set(.ws_client_upgrade_tls, vtable.make(handlers.WSUpgrade(true)));
    t.set(.ws_client, vtable.make(handlers.WSClient(false)));
    t.set(.ws_client_tls, vtable.make(handlers.WSClient(true)));

    // SQL drivers
    t.set(.postgres, vtable.make(handlers.Postgres(false)));
    t.set(.postgres_tls, vtable.make(handlers.Postgres(true)));
    t.set(.mysql, vtable.make(handlers.MySQL(false)));
    t.set(.mysql_tls, vtable.make(handlers.MySQL(true)));
    t.set(.valkey, vtable.make(handlers.Valkey(false)));
    t.set(.valkey_tls, vtable.make(handlers.Valkey(true)));

    // IPC
    t.set(.spawn_ipc, vtable.make(handlers.SpawnIPC));

    break :blk t;
};

inline fn vt(s: *us_socket_t) *const VTable {
    const kind = s.kind();
    return switch (kind) {
        .invalid => bun.Output.panic("us_socket_t with kind=invalid (group={*})", .{s.rawGroup()}),
        // Per-group vtable: uWS C++ installs a different `HttpContext<SSL>*`
        // closure per server, so the table can't be static per kind.
        .dynamic, .uws_http, .uws_http_tls, .uws_ws, .uws_ws_tls => s.rawGroup().vtable.?,
        else => tables.get(kind).?,
    };
}

inline fn vtc(c: *ConnectingSocket) *const VTable {
    const kind = c.kind();
    return switch (kind) {
        .invalid => bun.Output.panic("us_connecting_socket_t with kind=invalid", .{}),
        .dynamic, .uws_http, .uws_http_tls, .uws_ws, .uws_ws_tls => c.rawGroup().vtable.?,
        else => tables.get(kind).?,
    };
}

export fn us_dispatch_open(s: *us_socket_t, is_client: c_int, ip: [*c]u8, ip_len: c_int) ?*us_socket_t {
    return if (vt(s).on_open) |f| f(s, is_client, ip, ip_len) else s;
}
export fn us_dispatch_data(s: *us_socket_t, data: [*c]u8, len: c_int) ?*us_socket_t {
    return if (vt(s).on_data) |f| f(s, data, len) else s;
}
export fn us_dispatch_fd(s: *us_socket_t, fd: c_int) ?*us_socket_t {
    return if (vt(s).on_fd) |f| f(s, fd) else s;
}
export fn us_dispatch_writable(s: *us_socket_t) ?*us_socket_t {
    return if (vt(s).on_writable) |f| f(s) else s;
}
export fn us_dispatch_close(s: *us_socket_t, code: c_int, reason: ?*anyopaque) ?*us_socket_t {
    return if (vt(s).on_close) |f| f(s, code, reason) else s;
}
export fn us_dispatch_timeout(s: *us_socket_t) ?*us_socket_t {
    return if (vt(s).on_timeout) |f| f(s) else s;
}
export fn us_dispatch_long_timeout(s: *us_socket_t) ?*us_socket_t {
    return if (vt(s).on_long_timeout) |f| f(s) else s;
}
export fn us_dispatch_end(s: *us_socket_t) ?*us_socket_t {
    return if (vt(s).on_end) |f| f(s) else s;
}
export fn us_dispatch_connect_error(s: *us_socket_t, code: c_int) ?*us_socket_t {
    return if (vt(s).on_connect_error) |f| f(s, code) else s;
}
export fn us_dispatch_connecting_error(c: *ConnectingSocket, code: c_int) ?*ConnectingSocket {
    return if (vtc(c).on_connecting_error) |f| f(c, code) else c;
}
export fn us_dispatch_handshake(s: *us_socket_t, ok: c_int, err: uws.us_bun_verify_error_t) void {
    if (vt(s).on_handshake) |f| f(s, ok, err, null);
}
export fn us_dispatch_is_low_prio(s: *us_socket_t) c_int {
    return if (vt(s).is_low_prio) |f| f(s) else 0;
}

/// Ciphertext tap for `socket.upgradeTLS()` — fires on the `[raw, _]` half of
/// the returned pair before decryption. Only `bun_socket_tls` ever sets the
/// `ssl_raw_tap` bit, so this isn't part of the per-kind vtable.
export fn us_dispatch_ssl_raw_tap(s: *us_socket_t, data: [*c]u8, len: c_int) ?*us_socket_t {
    bun.debugAssert(s.kind() == .bun_socket_tls);
    const TLSSocket = bun.jsc.API.NewSocket(true);
    const tls = s.ext(*TLSSocket).*;
    if (tls.twin) |raw| {
        raw.onData(TLSSocket.Socket.from(s), data[0..@intCast(len)]);
    }
    return s;
}

const bun = @import("bun");
const handlers = @import("./handlers.zig");
const std = @import("std");
const vtable = @import("./vtable.zig");

const uws = bun.uws;
const ConnectingSocket = uws.ConnectingSocket;
const SocketKind = uws.SocketKind;
const us_socket_t = uws.us_socket_t;
const VTable = uws.SocketGroup.VTable;
