/// A ConnectingSocket represents a socket that is in the process of establishing a connection.
/// Corresponds to `us_connecting_socket_t` in uSockets.
///
/// This is an intermediate state between initiating a connection and having a fully connected socket.
/// The socket may be in one of several states:
/// - Performing DNS resolution to resolve the hostname to an IP address
/// - Establishing a TCP connection (non-blocking connect() in progress)
/// - Performing TLS/SSL handshake if this is an SSL connection
/// - Waiting for the connection to be accepted by the remote peer
///
/// Unlike a connected socket, you cannot read from or write to a ConnectingSocket.
/// Once the connection is successfully established, it will be converted to a regular
/// Socket and the appropriate callback (onOpen) will be triggered. If the connection
/// fails, the onConnectError callback will be called instead.
///
/// This design allows for non-blocking connection establishment while maintaining
/// a clear separation between sockets that are connecting vs. those that are ready
/// for I/O operations.
pub const ConnectingSocket = opaque {
    pub fn close(this: *ConnectingSocket, ssl: bool) void {
        c.us_connecting_socket_close(@intFromBool(ssl), this);
    }

    pub fn context(this: *ConnectingSocket, ssl: bool) ?*uws.SocketContext {
        return c.us_connecting_socket_context(@intFromBool(ssl), this);
    }

    pub fn loop(this: *ConnectingSocket) *uws.Loop {
        return c.us_connecting_socket_get_loop(this);
    }

    pub fn ext(this: *ConnectingSocket, ssl: bool) *anyopaque {
        return c.us_connecting_socket_ext(@intFromBool(ssl), this);
    }

    pub fn getError(this: *ConnectingSocket, ssl: bool) i32 {
        return c.us_connecting_socket_get_error(@intFromBool(ssl), this);
    }

    pub fn getNativeHandle(this: *ConnectingSocket, ssl: bool) ?*anyopaque {
        return c.us_connecting_socket_get_native_handle(@intFromBool(ssl), this);
    }

    pub fn isClosed(this: *ConnectingSocket, ssl: bool) bool {
        return c.us_connecting_socket_is_closed(@intFromBool(ssl), this) == 1;
    }

    pub fn isShutdown(this: *ConnectingSocket, ssl: bool) bool {
        return c.us_connecting_socket_is_shut_down(@intFromBool(ssl), this) == 1;
    }

    pub fn longTimeout(this: *ConnectingSocket, ssl: bool, seconds: c_uint) void {
        c.us_connecting_socket_long_timeout(@intFromBool(ssl), this, seconds);
    }

    pub fn shutdown(this: *ConnectingSocket, ssl: bool) void {
        c.us_connecting_socket_shutdown(@intFromBool(ssl), this);
    }

    pub fn shutdownRead(this: *ConnectingSocket, ssl: bool) void {
        c.us_connecting_socket_shutdown_read(@intFromBool(ssl), this);
    }

    pub fn timeout(this: *ConnectingSocket, ssl: bool, seconds: c_uint) void {
        c.us_connecting_socket_timeout(@intFromBool(ssl), this, seconds);
    }
};

const c = struct {
    pub extern fn us_connecting_socket_close(ssl: i32, s: *ConnectingSocket) void;
    pub extern fn us_connecting_socket_context(ssl: i32, s: *ConnectingSocket) ?*uws.SocketContext;
    pub extern fn us_connecting_socket_ext(ssl: i32, s: *ConnectingSocket) *anyopaque;
    pub extern fn us_connecting_socket_get_error(ssl: i32, s: *ConnectingSocket) i32;
    pub extern fn us_connecting_socket_get_native_handle(ssl: i32, s: *ConnectingSocket) ?*anyopaque;
    pub extern fn us_connecting_socket_is_closed(ssl: i32, s: *ConnectingSocket) i32;
    pub extern fn us_connecting_socket_is_shut_down(ssl: i32, s: *ConnectingSocket) i32;
    pub extern fn us_connecting_socket_long_timeout(ssl: i32, s: *ConnectingSocket, seconds: c_uint) void;
    pub extern fn us_connecting_socket_shutdown(ssl: i32, s: *ConnectingSocket) void;
    pub extern fn us_connecting_socket_shutdown_read(ssl: i32, s: *ConnectingSocket) void;
    pub extern fn us_connecting_socket_timeout(ssl: i32, s: *ConnectingSocket, seconds: c_uint) void;
    pub extern fn us_connecting_socket_get_loop(s: *ConnectingSocket) *uws.Loop;
};

const bun = @import("bun");
const uws = bun.uws;
