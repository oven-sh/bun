//! Comptime `us_socket_vtable_t` generator. Given a Zig handler type and the
//! ext payload type, emits a single static-const `VTable` whose entries are
//! `callconv(.c)` trampolines that recover the typed ext from the raw socket
//! and forward.
//!
//! This replaces `NewSocketHandler.configure`/`unsafeConfigure`/`wrapTLS`,
//! which did the same trampoline dance per-call at runtime via
//! `us_socket_context_on_*`. One handler type → one vtable in `.rodata`.
//!
//! Handler shape (any subset; missing methods → vtable entry left null):
//!   pub const Ext = *MySocket;                // what `us_socket_ext` holds
//!   pub fn onOpen(ext, *us_socket_t, is_client: bool, ip: []const u8) void
//!   pub fn onData(ext, *us_socket_t, data: []const u8) void
//!   pub fn onWritable(ext, *us_socket_t) void
//!   pub fn onClose(ext, *us_socket_t, code: i32, reason: ?*anyopaque) void
//!
//! `Ext` may be omitted entirely; handlers then take `(*us_socket_t, …)` and
//! recover their owner from `s.group().owner(T)` instead.
//!
//!   pub fn onTimeout(ext, *us_socket_t) void
//!   pub fn onLongTimeout(ext, *us_socket_t) void
//!   pub fn onEnd(ext, *us_socket_t) void
//!   pub fn onFd(ext, *us_socket_t, fd: c_int) void
//!   pub fn onConnectError(ext, *us_socket_t, code: i32) void
//!   pub fn onConnectingError(*ConnectingSocket, code: i32) void
//!   pub fn onHandshake(ext, *us_socket_t, ok: bool, err: us_bun_verify_error_t) void

/// Produce a `*const VTable` for `H`. The result is a comptime address into
/// `.rodata`; safe to store in any number of `SocketGroup`s.
pub fn make(comptime H: type) *const VTable {
    const T = Trampolines(H);
    return &(struct {
        pub const vt: VTable = .{
            .on_open = if (@hasDecl(H, "onOpen")) T.on_open else null,
            .on_data = if (@hasDecl(H, "onData")) T.on_data else null,
            .on_fd = if (@hasDecl(H, "onFd")) T.on_fd else null,
            .on_writable = if (@hasDecl(H, "onWritable")) T.on_writable else null,
            .on_close = if (@hasDecl(H, "onClose")) T.on_close else null,
            .on_timeout = if (@hasDecl(H, "onTimeout")) T.on_timeout else null,
            .on_long_timeout = if (@hasDecl(H, "onLongTimeout")) T.on_long_timeout else null,
            .on_end = if (@hasDecl(H, "onEnd")) T.on_end else null,
            .on_connect_error = if (@hasDecl(H, "onConnectError")) T.on_connect_error else null,
            .on_connecting_error = if (@hasDecl(H, "onConnectingError")) T.on_connecting_error else null,
            .on_handshake = if (@hasDecl(H, "onHandshake")) T.on_handshake else null,
        };
    }).vt;
}

/// The trampolines themselves, exposed so `dispatch.zig` can direct-call them
/// per-kind without going through the vtable pointer at all.
pub fn Trampolines(comptime H: type) type {
    // `Ext` is optional. Handlers that work entirely from `*us_socket_t` (e.g.
    // BunListener — owner comes from `s.group().owner(T)`) omit it and take
    // `(s, …)` instead of `(ext, s, …)`.
    const has_ext = @hasDecl(H, "Ext");
    const E = if (has_ext) H.Ext else void;

    return struct {
        inline fn call(s: *us_socket_t, comptime f: anytype, extra: anytype) void {
            if (comptime has_ext) {
                @call(.auto, f, .{s.ext(@typeInfo(E).pointer.child)} ++ .{s} ++ extra);
            } else {
                @call(.auto, f, .{s} ++ extra);
            }
        }

        pub fn on_open(s: *us_socket_t, is_client: c_int, ip: [*c]u8, ip_len: c_int) callconv(.c) ?*us_socket_t {
            call(s, H.onOpen, .{ is_client != 0, if (ip != null) ip[0..@intCast(ip_len)] else @as([]const u8, &.{}) });
            return s;
        }
        pub fn on_data(s: *us_socket_t, data: [*c]u8, len: c_int) callconv(.c) ?*us_socket_t {
            call(s, H.onData, .{data[0..@intCast(len)]});
            return s;
        }
        pub fn on_fd(s: *us_socket_t, fd: c_int) callconv(.c) ?*us_socket_t {
            call(s, H.onFd, .{fd});
            return s;
        }
        pub fn on_writable(s: *us_socket_t) callconv(.c) ?*us_socket_t {
            call(s, H.onWritable, .{});
            return s;
        }
        pub fn on_close(s: *us_socket_t, code: c_int, reason: ?*anyopaque) callconv(.c) ?*us_socket_t {
            call(s, H.onClose, .{ @as(i32, code), reason });
            return s;
        }
        pub fn on_timeout(s: *us_socket_t) callconv(.c) ?*us_socket_t {
            call(s, H.onTimeout, .{});
            return s;
        }
        pub fn on_long_timeout(s: *us_socket_t) callconv(.c) ?*us_socket_t {
            call(s, H.onLongTimeout, .{});
            return s;
        }
        pub fn on_end(s: *us_socket_t) callconv(.c) ?*us_socket_t {
            call(s, H.onEnd, .{});
            return s;
        }
        pub fn on_connect_error(s: *us_socket_t, code: c_int) callconv(.c) ?*us_socket_t {
            call(s, H.onConnectError, .{@as(i32, code)});
            return s;
        }
        pub fn on_connecting_error(cs: *ConnectingSocket, code: c_int) callconv(.c) ?*ConnectingSocket {
            H.onConnectingError(cs, code);
            return cs;
        }
        pub fn on_handshake(s: *us_socket_t, ok: c_int, err: uws.us_bun_verify_error_t, _: ?*anyopaque) callconv(.c) void {
            call(s, H.onHandshake, .{ ok != 0, err });
        }
    };
}

const bun = @import("bun");

const uws = bun.uws;
const ConnectingSocket = uws.ConnectingSocket;
const us_socket_t = uws.us_socket_t;
const VTable = uws.SocketGroup.VTable;
