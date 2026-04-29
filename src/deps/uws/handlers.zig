//! Per-`SocketKind` handler adapters. Each one names the ext payload type and
//! forwards events into the existing `onOpen`/`onData`/… methods on that type,
//! re-wrapping the raw `*us_socket_t` in the `NewSocketHandler` shim those
//! methods already expect.
//!
//! This is the *only* call-site coupling between the dispatcher and the rest
//! of Bun — everything below here is unchanged consumer code. It replaces the
//! old `NewSocketHandler.configure`/`unsafeConfigure` machinery, which built
//! the same trampolines at runtime per `us_socket_context_t`.

/// Some consumer methods are `bun.JSError!void` (they can throw into JS),
/// some are plain `void`. The old `configure()` trampolines hand-unrolled the
/// catch per call site; here we do it once. JS errors are already on the
/// pending-exception slot — there's nowhere for the C event loop to propagate
/// them — so we just don't lose the unwind.
inline fn swallow(result: anytype) void {
    if (@typeInfo(@TypeOf(result)) == .error_union) {
        result catch {};
    }
}

/// `Ext = *?*T`: the socket ext stores a single pointer to the heap-allocated
/// owner (matching the old `socket.ext(**anyopaque).* = this` pattern). It is
/// optional because a connect/accept can fail and dispatch `onClose` /
/// `onConnectError` BEFORE the caller has had a chance to stash `this` in the
/// freshly-calloc'd ext slot — pretending it's `**T` there is a NULL deref the
/// type system can't see.
fn PtrHandler(comptime T: type, comptime ssl: bool) type {
    const S = uws.NewSocketHandler(ssl);
    return struct {
        pub const Ext = *?*T;
        inline fn wrap(s: *us_socket_t) S {
            return S.from(s);
        }
        pub fn onOpen(ext: Ext, s: *us_socket_t, _: bool, _: []const u8) void {
            const this = ext.* orelse return;
            if (@hasDecl(T, "onOpen")) swallow(this.onOpen(wrap(s)));
        }
        pub fn onData(ext: Ext, s: *us_socket_t, data: []const u8) void {
            const this = ext.* orelse return;
            if (@hasDecl(T, "onData")) swallow(this.onData(wrap(s), data));
        }
        pub fn onWritable(ext: Ext, s: *us_socket_t) void {
            const this = ext.* orelse return;
            if (@hasDecl(T, "onWritable")) swallow(this.onWritable(wrap(s)));
        }
        pub fn onClose(ext: Ext, s: *us_socket_t, code: i32, reason: ?*anyopaque) void {
            const this = ext.* orelse return;
            if (@hasDecl(T, "onClose")) swallow(this.onClose(wrap(s), code, reason));
        }
        pub fn onTimeout(ext: Ext, s: *us_socket_t) void {
            const this = ext.* orelse return;
            if (@hasDecl(T, "onTimeout")) swallow(this.onTimeout(wrap(s)));
        }
        pub fn onLongTimeout(ext: Ext, s: *us_socket_t) void {
            const this = ext.* orelse return;
            if (@hasDecl(T, "onLongTimeout")) swallow(this.onLongTimeout(wrap(s)));
        }
        pub fn onEnd(ext: Ext, s: *us_socket_t) void {
            const this = ext.* orelse return;
            if (@hasDecl(T, "onEnd")) swallow(this.onEnd(wrap(s)));
        }
        pub fn onConnectError(ext: Ext, s: *us_socket_t, code: i32) void {
            // Old configure() path force-closed the half-open connect socket
            // before notifying the owner; preserve that.
            s.close(.normal);
            const this = ext.* orelse return;
            if (@hasDecl(T, "onConnectError")) swallow(this.onConnectError(wrap(s), code));
        }
        pub fn onConnectingError(c: *ConnectingSocket, code: i32) void {
            const this = c.ext(?*T).* orelse return;
            if (@hasDecl(T, "onConnectError"))
                swallow(this.onConnectError(S.fromConnecting(c), code));
        }
        pub fn onHandshake(ext: Ext, s: *us_socket_t, ok: bool, err: uws.us_bun_verify_error_t) void {
            const this = ext.* orelse return;
            if (@hasDecl(T, "onHandshake")) swallow(this.onHandshake(wrap(s), @intFromBool(ok), err));
        }
        pub fn onFd(ext: Ext, s: *us_socket_t, fd: c_int) void {
            const this = ext.* orelse return;
            if (@hasDecl(T, "onFd")) swallow(this.onFd(wrap(s), fd));
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
        // No `Ext` decl — owner comes from `s.group().owner(Listener)`.
        pub fn onOpen(s: *us_socket_t, _: bool, _: []const u8) void {
            const listener = s.group().owner(api.Listener);
            // onCreate allocates the NewSocket, stashes it in ext, and
            // restamps kind → .bun_socket_*. Fire the user `open` handler
            // (markActive, ALPN, JS callback) before returning so the same
            // dispatch tick that accepted the fd sees an open socket — the
            // old `configure({onCreate, onOpen})` path did this in one
            // on_open call.
            const ns = api.Listener.onCreate(ssl, listener, S.from(s));
            swallow(ns.onOpen(S.from(s)));
        }
        // Accepted sockets reach the remaining events as `.bun_socket_*` once
        // onCreate has restamped them; if anything fires before that, route to
        // the freshly stashed NewSocket.
        pub fn onClose(s: *us_socket_t, code: i32, reason: ?*anyopaque) void {
            if (s.ext(?*NS).*) |ns| swallow(ns.onClose(S.from(s), code, reason));
        }
        pub fn onData(s: *us_socket_t, data: []const u8) void {
            if (s.ext(?*NS).*) |ns| swallow(ns.onData(S.from(s), data));
        }
        pub fn onWritable(s: *us_socket_t) void {
            if (s.ext(?*NS).*) |ns| swallow(ns.onWritable(S.from(s)));
        }
        pub fn onEnd(s: *us_socket_t) void {
            if (s.ext(?*NS).*) |ns| swallow(ns.onEnd(S.from(s)));
        }
        pub fn onTimeout(s: *us_socket_t) void {
            if (s.ext(?*NS).*) |ns| swallow(ns.onTimeout(S.from(s)));
        }
        pub fn onHandshake(s: *us_socket_t, ok: bool, err: uws.us_bun_verify_error_t) void {
            if (s.ext(?*NS).*) |ns| swallow(ns.onHandshake(S.from(s), @intFromBool(ok), err));
        }
    };
}

/// Like `PtrHandler` but the callbacks live on a separate namespace `H` (the
/// driver's pre-existing `SocketHandler(ssl)` adapter) rather than as methods
/// on the owner type itself. Ext stores `*Owner` (optional for the same reason
/// as `PtrHandler`).
fn NsHandler(comptime Owner: type, comptime H: type, comptime ssl: bool) type {
    const S = uws.NewSocketHandler(ssl);
    return struct {
        pub const Ext = *?*Owner;
        inline fn wrap(s: *us_socket_t) S {
            return S.from(s);
        }
        pub fn onOpen(ext: Ext, s: *us_socket_t, _: bool, _: []const u8) void {
            const this = ext.* orelse return;
            if (@hasDecl(H, "onOpen")) swallow(H.onOpen(this, wrap(s)));
        }
        pub fn onData(ext: Ext, s: *us_socket_t, data: []const u8) void {
            const this = ext.* orelse return;
            if (@hasDecl(H, "onData")) swallow(H.onData(this, wrap(s), data));
        }
        pub fn onWritable(ext: Ext, s: *us_socket_t) void {
            const this = ext.* orelse return;
            if (@hasDecl(H, "onWritable")) swallow(H.onWritable(this, wrap(s)));
        }
        pub fn onClose(ext: Ext, s: *us_socket_t, code: i32, reason: ?*anyopaque) void {
            const this = ext.* orelse return;
            if (@hasDecl(H, "onClose")) swallow(H.onClose(this, wrap(s), code, reason));
        }
        pub fn onTimeout(ext: Ext, s: *us_socket_t) void {
            const this = ext.* orelse return;
            if (@hasDecl(H, "onTimeout")) swallow(H.onTimeout(this, wrap(s)));
        }
        pub fn onLongTimeout(ext: Ext, s: *us_socket_t) void {
            const this = ext.* orelse return;
            if (@hasDecl(H, "onLongTimeout")) swallow(H.onLongTimeout(this, wrap(s)));
        }
        pub fn onEnd(ext: Ext, s: *us_socket_t) void {
            const this = ext.* orelse return;
            if (@hasDecl(H, "onEnd")) swallow(H.onEnd(this, wrap(s)));
        }
        pub fn onConnectError(ext: Ext, s: *us_socket_t, code: i32) void {
            s.close(.normal);
            const this = ext.* orelse return;
            if (@hasDecl(H, "onConnectError")) swallow(H.onConnectError(this, wrap(s), code));
        }
        pub fn onConnectingError(c: *ConnectingSocket, code: i32) void {
            const this = c.ext(?*Owner).* orelse return;
            if (@hasDecl(H, "onConnectError"))
                swallow(H.onConnectError(this, S.fromConnecting(c), code));
        }
        pub fn onHandshake(ext: Ext, s: *us_socket_t, ok: bool, err: uws.us_bun_verify_error_t) void {
            const this = ext.* orelse return;
            if (@hasDecl(H, "onHandshake") and @TypeOf(H.onHandshake) != @TypeOf(null))
                swallow(H.onHandshake(this, wrap(s), @intFromBool(ok), err));
        }
    };
}

// ── HTTP client thread (fetch) ──────────────────────────────────────────────
//
// Unlike every other consumer the fetch ext slot does NOT hold a `*Owner`. It
// holds an `ActiveSocket` — a `bun.TaggedPointerUnion` *value* packed into one
// word (`.ptr()` → `*anyopaque` with the tag in the high bits). Dereferencing
// it as a real pointer is UB; `Handler.on*` decode it via `ActiveSocket.from`.
// This adapter just lifts the word out of the slot, so the `*anyopaque` here
// is intentional and irreducible — it IS the tagged-pointer encoding, not a
// type we forgot to name.
pub fn HTTPClient(comptime ssl: bool) type {
    const H = bun.http.NewHTTPContext(ssl).Handler;
    const S = uws.NewSocketHandler(ssl);
    return struct {
        pub const Ext = *?*anyopaque;
        inline fn wrap(s: *us_socket_t) S {
            return S.from(s);
        }
        inline fn fwd(ext: Ext, comptime name: []const u8, args: anytype) void {
            if (@hasDecl(H, name) and @TypeOf(@field(H, name)) != @TypeOf(null))
                swallow(@call(.auto, @field(H, name), .{ext.* orelse return} ++ args));
        }
        pub fn onOpen(ext: Ext, s: *us_socket_t, _: bool, _: []const u8) void {
            fwd(ext, "onOpen", .{wrap(s)});
        }
        pub fn onData(ext: Ext, s: *us_socket_t, data: []const u8) void {
            fwd(ext, "onData", .{ wrap(s), data });
        }
        pub fn onWritable(ext: Ext, s: *us_socket_t) void {
            fwd(ext, "onWritable", .{wrap(s)});
        }
        pub fn onClose(ext: Ext, s: *us_socket_t, code: i32, reason: ?*anyopaque) void {
            fwd(ext, "onClose", .{ wrap(s), code, reason });
        }
        pub fn onTimeout(ext: Ext, s: *us_socket_t) void {
            fwd(ext, "onTimeout", .{wrap(s)});
        }
        pub fn onLongTimeout(ext: Ext, s: *us_socket_t) void {
            fwd(ext, "onLongTimeout", .{wrap(s)});
        }
        pub fn onEnd(ext: Ext, s: *us_socket_t) void {
            fwd(ext, "onEnd", .{wrap(s)});
        }
        pub fn onConnectError(ext: Ext, s: *us_socket_t, code: i32) void {
            s.close(.normal);
            fwd(ext, "onConnectError", .{ wrap(s), code });
        }
        pub fn onConnectingError(cs: *ConnectingSocket, code: i32) void {
            if (@hasDecl(H, "onConnectError"))
                swallow(H.onConnectError(cs.ext(?*anyopaque).* orelse return, S.fromConnecting(cs), code));
        }
        pub fn onHandshake(ext: Ext, s: *us_socket_t, ok: bool, err: uws.us_bun_verify_error_t) void {
            fwd(ext, "onHandshake", .{ wrap(s), @as(i32, @intFromBool(ok)), err });
        }
    };
}

// ── WebSocket client ────────────────────────────────────────────────────────
pub fn WSUpgrade(comptime ssl: bool) type {
    return PtrHandler(websocket_upgrade_client.NewHTTPUpgradeClient(ssl), ssl);
}
pub fn WSClient(comptime ssl: bool) type {
    return PtrHandler(websocket_client.NewWebSocketClient(ssl), ssl);
}

// ── SQL drivers ─────────────────────────────────────────────────────────────
pub fn Postgres(comptime ssl: bool) type {
    const C = bun.api.Postgres.PostgresSQLConnection;
    return NsHandler(C, C.SocketHandler(ssl), ssl);
}
pub fn MySQL(comptime ssl: bool) type {
    return NsHandler(mysql.MySQLConnection, mysql.MySQLConnection.SocketHandler(ssl), ssl);
}
pub fn Valkey(comptime ssl: bool) type {
    return NsHandler(js_valkey.JSValkeyClient, js_valkey.SocketHandler(ssl), ssl);
}

// ── Bun.spawn IPC / process.send() ──────────────────────────────────────────
// Ext is `*IPC.SendQueue` for both child-side `process.send` and parent-side
// `Bun.spawn({ipc})`. Handlers live in `ipc.zig` as free functions, not
// methods on SendQueue, so we adapt manually instead of via PtrHandler.
pub const SpawnIPC = struct {
    const H = IPC.IPCHandlers.PosixSocket;
    const S = uws.NewSocketHandler(false);
    pub const Ext = *?*IPC.SendQueue;
    pub fn onOpen(_: Ext, _: *us_socket_t, _: bool, _: []const u8) void {}
    pub fn onData(ext: Ext, s: *us_socket_t, data: []const u8) void {
        H.onData(ext.* orelse return, S.from(s), data);
    }
    pub fn onFd(ext: Ext, s: *us_socket_t, fd: c_int) void {
        H.onFd(ext.* orelse return, S.from(s), fd);
    }
    pub fn onWritable(ext: Ext, s: *us_socket_t) void {
        H.onWritable(ext.* orelse return, S.from(s));
    }
    pub fn onClose(ext: Ext, s: *us_socket_t, code: i32, reason: ?*anyopaque) void {
        H.onClose(ext.* orelse return, S.from(s), code, reason);
    }
    pub fn onTimeout(ext: Ext, s: *us_socket_t) void {
        H.onTimeout(ext.* orelse return, S.from(s));
    }
    pub fn onEnd(ext: Ext, s: *us_socket_t) void {
        H.onEnd(ext.* orelse return, S.from(s));
    }
};

const IPC = @import("../../bun.js/ipc.zig");
const js_valkey = @import("../../valkey/js_valkey.zig");
const mysql = @import("../../sql/mysql.zig");
const websocket_client = @import("../../http/websocket_client.zig");
const websocket_upgrade_client = @import("../../http/websocket_client/WebSocketUpgradeClient.zig");

const bun = @import("bun");
const api = bun.jsc.API;

const uws = bun.uws;
const ConnectingSocket = uws.ConnectingSocket;
const us_socket_t = uws.us_socket_t;
