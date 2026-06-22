/// `us_connecting_socket_t` — a connect in flight (DNS / non-blocking
/// `connect()` / happy-eyeballs). No I/O is possible yet; on success the loop
/// promotes it to a `us_socket_t` and fires `onOpen`, on failure
/// `onConnectingError`.
pub const ConnectingSocket = opaque {
    pub fn close(this: *ConnectingSocket) void {
        c.us_connecting_socket_close(this);
    }

    pub fn group(this: *ConnectingSocket) *SocketGroup {
        return c.us_connecting_socket_group(this);
    }
    pub const rawGroup = group;

    pub fn kind(this: *ConnectingSocket) SocketKind {
        return @enumFromInt(c.us_connecting_socket_kind(this));
    }

    pub fn loop(this: *ConnectingSocket) *uws.Loop {
        return c.us_connecting_socket_get_loop(this);
    }

    pub fn ext(this: *ConnectingSocket, comptime T: type) *T {
        return @ptrCast(@alignCast(c.us_connecting_socket_ext(this)));
    }

    pub fn getError(this: *ConnectingSocket) i32 {
        return c.us_connecting_socket_get_error(this);
    }

    pub fn getNativeHandle(this: *ConnectingSocket) ?*anyopaque {
        return c.us_connecting_socket_get_native_handle(this);
    }

    pub fn isClosed(this: *ConnectingSocket) bool {
        return c.us_connecting_socket_is_closed(this) == 1;
    }

    pub fn isShutdown(this: *ConnectingSocket) bool {
        return c.us_connecting_socket_is_shut_down(this) == 1;
    }

    pub fn longTimeout(this: *ConnectingSocket, seconds: c_uint) void {
        c.us_connecting_socket_long_timeout(this, seconds);
    }

    pub fn shutdown(this: *ConnectingSocket) void {
        c.us_connecting_socket_shutdown(this);
    }

    pub fn shutdownRead(this: *ConnectingSocket) void {
        c.us_connecting_socket_shutdown_read(this);
    }

    pub fn timeout(this: *ConnectingSocket, seconds: c_uint) void {
        c.us_connecting_socket_timeout(this, seconds);
    }
};

const c = struct {
    pub extern fn us_connecting_socket_close(s: *ConnectingSocket) void;
    pub extern fn us_connecting_socket_group(s: *ConnectingSocket) *SocketGroup;
    pub extern fn us_connecting_socket_kind(s: *ConnectingSocket) u8;
    pub extern fn us_connecting_socket_ext(s: *ConnectingSocket) *anyopaque;
    pub extern fn us_connecting_socket_get_error(s: *ConnectingSocket) i32;
    pub extern fn us_connecting_socket_get_native_handle(s: *ConnectingSocket) ?*anyopaque;
    pub extern fn us_connecting_socket_is_closed(s: *ConnectingSocket) i32;
    pub extern fn us_connecting_socket_is_shut_down(s: *ConnectingSocket) i32;
    pub extern fn us_connecting_socket_long_timeout(s: *ConnectingSocket, seconds: c_uint) void;
    pub extern fn us_connecting_socket_shutdown(s: *ConnectingSocket) void;
    pub extern fn us_connecting_socket_shutdown_read(s: *ConnectingSocket) void;
    pub extern fn us_connecting_socket_timeout(s: *ConnectingSocket, seconds: c_uint) void;
    pub extern fn us_connecting_socket_get_loop(s: *ConnectingSocket) *uws.Loop;
};

const bun = @import("bun");

const uws = bun.uws;
const SocketGroup = uws.SocketGroup;
const SocketKind = uws.SocketKind;
