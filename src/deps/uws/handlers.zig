//! Per-`SocketKind` handler adapters. Each one names the ext payload type and
//! forwards events into the existing `onOpen`/`onData`/… methods on that type,
//! re-wrapping the raw `*us_socket_t` in the `NewSocketHandler` shim those
//! methods already expect.
//!
//! This is the *only* call-site coupling between the dispatcher and the rest
//! of Bun — everything below here is unchanged consumer code. It replaces the
//! old `NewSocketHandler.configure`/`unsafeConfigure` machinery, which built
//! the same trampolines at runtime per `us_socket_context_t`.

/// `Ext = **T` because the socket ext stores a single pointer to the
/// heap-allocated owner (matching the old `socket.ext(**anyopaque).* = this`
/// pattern). The trampoline derefs it before calling.
fn PtrHandler(comptime T: type, comptime ssl: bool) type {
    const S = uws.NewSocketHandler(ssl);
    return struct {
        pub const Ext = **T;
        inline fn wrap(s: *us_socket_t) S {
            return S.from(s);
        }
        pub fn onOpen(this: Ext, s: *us_socket_t, _: bool, _: []const u8) void {
            if (@hasDecl(T, "onOpen")) this.*.onOpen(wrap(s));
        }
        pub fn onData(this: Ext, s: *us_socket_t, data: []const u8) void {
            if (@hasDecl(T, "onData")) this.*.onData(wrap(s), data);
        }
        pub fn onWritable(this: Ext, s: *us_socket_t) void {
            if (@hasDecl(T, "onWritable")) this.*.onWritable(wrap(s));
        }
        pub fn onClose(this: Ext, s: *us_socket_t, code: i32, reason: ?*anyopaque) void {
            if (@hasDecl(T, "onClose")) this.*.onClose(wrap(s), code, reason);
        }
        pub fn onTimeout(this: Ext, s: *us_socket_t) void {
            if (@hasDecl(T, "onTimeout")) this.*.onTimeout(wrap(s));
        }
        pub fn onLongTimeout(this: Ext, s: *us_socket_t) void {
            if (@hasDecl(T, "onLongTimeout")) this.*.onLongTimeout(wrap(s));
        }
        pub fn onEnd(this: Ext, s: *us_socket_t) void {
            if (@hasDecl(T, "onEnd")) this.*.onEnd(wrap(s));
        }
        pub fn onConnectError(this: Ext, s: *us_socket_t, code: i32) void {
            // Old configure() path force-closed the half-open connect socket
            // before notifying the owner; preserve that.
            _ = us_socket_t.c.us_socket_close(s, 0, null);
            if (@hasDecl(T, "onConnectError")) this.*.onConnectError(wrap(s), code);
        }
        pub fn onConnectingError(c: *ConnectingSocket, code: i32) void {
            const this = c.ext(*T).*;
            if (@hasDecl(T, "onConnectError"))
                this.onConnectError(S.fromConnecting(c), code);
        }
        pub fn onHandshake(this: Ext, s: *us_socket_t, ok: bool, err: uws.us_bun_verify_error_t) void {
            if (@hasDecl(T, "onHandshake")) this.*.onHandshake(wrap(s), @intFromBool(ok), err);
        }
        pub fn onFd(this: Ext, s: *us_socket_t, fd: c_int) void {
            if (@hasDecl(T, "onFd")) this.*.onFd(wrap(s), fd);
        }
    };
}

// ── Bun.connect / Bun.listen ────────────────────────────────────────────────
pub fn BunSocket(comptime ssl: bool) type {
    return PtrHandler(api.NewSocket(ssl), ssl);
}

/// Listener accept path: the ext is uninitialised at on_open time (the C accept
/// loop just calloc'd it), so we read the `*Listener` off `group->ext` and let
/// `onCreate` allocate the `NewSocket` and stash it in the ext. After that the
/// socket is re-stamped as `.bun_socket_{tcp,tls}` and routes through
/// `BunSocket` above.
pub fn BunListener(comptime ssl: bool) type {
    const S = uws.NewSocketHandler(ssl);
    const NS = api.NewSocket(ssl);
    return struct {
        pub const Ext = *anyopaque; // unused — owner comes from group
        pub fn onOpen(_: Ext, s: *us_socket_t, _: bool, _: []const u8) void {
            const listener = s.rawGroup().owner(api.Listener);
            api.Listener.onCreate(ssl, listener, S.from(s));
        }
        // Accepted sockets reach the remaining events as `.bun_socket_*` once
        // onCreate has restamped them; if anything fires before that, route to
        // the freshly stashed NewSocket.
        pub fn onClose(_: Ext, s: *us_socket_t, code: i32, reason: ?*anyopaque) void {
            if (s.ext(?*NS).*) |ns| ns.onClose(S.from(s), code, reason);
        }
        pub fn onData(_: Ext, s: *us_socket_t, data: []const u8) void {
            if (s.ext(?*NS).*) |ns| ns.onData(S.from(s), data);
        }
        pub fn onWritable(_: Ext, s: *us_socket_t) void {
            if (s.ext(?*NS).*) |ns| ns.onWritable(S.from(s));
        }
        pub fn onEnd(_: Ext, s: *us_socket_t) void {
            if (s.ext(?*NS).*) |ns| ns.onEnd(S.from(s));
        }
        pub fn onTimeout(_: Ext, s: *us_socket_t) void {
            if (s.ext(?*NS).*) |ns| ns.onTimeout(S.from(s));
        }
        pub fn onHandshake(_: Ext, s: *us_socket_t, ok: bool, err: uws.us_bun_verify_error_t) void {
            if (s.ext(?*NS).*) |ns| ns.onHandshake(S.from(s), @intFromBool(ok), err);
        }
    };
}

/// Like `PtrHandler` but the callbacks live on a separate namespace `H` (the
/// driver's pre-existing `SocketHandler(ssl)` adapter) rather than as methods
/// on the owner type itself. Ext stores `*Owner`.
fn NsHandler(comptime Owner: type, comptime H: type, comptime ssl: bool) type {
    const S = uws.NewSocketHandler(ssl);
    return struct {
        pub const Ext = **Owner;
        inline fn wrap(s: *us_socket_t) S {
            return S.from(s);
        }
        pub fn onOpen(this: Ext, s: *us_socket_t, _: bool, _: []const u8) void {
            if (@hasDecl(H, "onOpen")) H.onOpen(this.*, wrap(s));
        }
        pub fn onData(this: Ext, s: *us_socket_t, data: []const u8) void {
            if (@hasDecl(H, "onData")) H.onData(this.*, wrap(s), data);
        }
        pub fn onWritable(this: Ext, s: *us_socket_t) void {
            if (@hasDecl(H, "onWritable")) H.onWritable(this.*, wrap(s));
        }
        pub fn onClose(this: Ext, s: *us_socket_t, code: i32, reason: ?*anyopaque) void {
            if (@hasDecl(H, "onClose")) H.onClose(this.*, wrap(s), code, reason);
        }
        pub fn onTimeout(this: Ext, s: *us_socket_t) void {
            if (@hasDecl(H, "onTimeout")) H.onTimeout(this.*, wrap(s));
        }
        pub fn onLongTimeout(this: Ext, s: *us_socket_t) void {
            if (@hasDecl(H, "onLongTimeout")) H.onLongTimeout(this.*, wrap(s));
        }
        pub fn onEnd(this: Ext, s: *us_socket_t) void {
            if (@hasDecl(H, "onEnd")) H.onEnd(this.*, wrap(s));
        }
        pub fn onConnectError(this: Ext, s: *us_socket_t, code: i32) void {
            _ = us_socket_t.c.us_socket_close(s, 0, null);
            if (@hasDecl(H, "onConnectError")) H.onConnectError(this.*, wrap(s), code);
        }
        pub fn onConnectingError(c: *ConnectingSocket, code: i32) void {
            if (@hasDecl(H, "onConnectError"))
                H.onConnectError(c.ext(*Owner).*, S.fromConnecting(c), code);
        }
        pub fn onHandshake(this: Ext, s: *us_socket_t, ok: bool, err: uws.us_bun_verify_error_t) void {
            if (@hasDecl(H, "onHandshake") and @TypeOf(H.onHandshake) != @TypeOf(null))
                H.onHandshake(this.*, wrap(s), @intFromBool(ok), err);
        }
    };
}

// ── HTTP client thread (fetch) ──────────────────────────────────────────────
// Ext is the `ActiveSocket` tagged-pointer word; `Handler.on*` take `*anyopaque`.
pub fn HTTPClient(comptime ssl: bool) type {
    return NsHandler(anyopaque, bun.http.NewHTTPContext(ssl).Handler, ssl);
}

// ── WebSocket client ────────────────────────────────────────────────────────
pub fn WSUpgrade(comptime ssl: bool) type {
    const T = @import("../../http/websocket_client/WebSocketUpgradeClient.zig").NewHTTPUpgradeClient(ssl);
    return PtrHandler(T, ssl);
}
pub fn WSClient(comptime ssl: bool) type {
    const T = @import("../../http/websocket_client.zig").NewWebSocketClient(ssl);
    return PtrHandler(T, ssl);
}

// ── SQL drivers ─────────────────────────────────────────────────────────────
pub fn Postgres(comptime ssl: bool) type {
    const C = bun.api.Postgres.PostgresSQLConnection;
    return NsHandler(C, C.SocketHandler(ssl), ssl);
}
pub fn MySQL(comptime ssl: bool) type {
    const C = bun.api.mysql.js.JSMySQLConnection;
    return NsHandler(C, C.SocketHandler(ssl), ssl);
}
pub fn Valkey(comptime ssl: bool) type {
    const js = @import("../../valkey/js_valkey.zig");
    return NsHandler(js.JSValkeyClient, js.SocketHandler(ssl), ssl);
}

// ── Bun.spawn IPC / process.send() ──────────────────────────────────────────
// Ext is `*IPC.SendQueue` for both child-side `process.send` and parent-side
// `Bun.spawn({ipc})`. Handlers live in `ipc.zig` as free functions, not
// methods on SendQueue, so we adapt manually instead of via PtrHandler.
pub const SpawnIPC = struct {
    const IPC = @import("../../bun.js/ipc.zig");
    const H = IPC.IPCHandlers.PosixSocket;
    const S = uws.NewSocketHandler(false);
    pub const Ext = **IPC.SendQueue;
    pub fn onOpen(_: Ext, _: *us_socket_t, _: bool, _: []const u8) void {}
    pub fn onData(this: Ext, s: *us_socket_t, data: []const u8) void {
        H.onData(this.*, S.from(s), data);
    }
    pub fn onFd(this: Ext, s: *us_socket_t, fd: c_int) void {
        H.onFd(this.*, S.from(s), fd);
    }
    pub fn onWritable(this: Ext, s: *us_socket_t) void {
        H.onWritable(this.*, S.from(s));
    }
    pub fn onClose(this: Ext, s: *us_socket_t, code: i32, reason: ?*anyopaque) void {
        H.onClose(this.*, S.from(s), code, reason);
    }
    pub fn onTimeout(this: Ext, s: *us_socket_t) void {
        H.onTimeout(this.*, S.from(s));
    }
    pub fn onEnd(this: Ext, s: *us_socket_t) void {
        H.onEnd(this.*, S.from(s));
    }
};

const bun = @import("bun");
const uws = bun.uws;
const us_socket_t = uws.us_socket_t;
const ConnectingSocket = uws.ConnectingSocket;
const api = bun.jsc.API;
