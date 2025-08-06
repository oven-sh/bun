const quic = @This();

const std = @import("std");
const bun = @import("bun");
const uws = @import("../uws.zig");

const Loop = uws.Loop;

/// QUIC socket context options - uses the same options as regular SSL sockets
pub const SocketContextOptions = uws.BunSocketContextOptions;

/// QUIC socket context - holds shared state and configuration
pub const SocketContext = opaque {
    /// Create a new QUIC socket context
    pub fn create(loop: *Loop, options: SocketContextOptions, ext_size: c_int) ?*SocketContext {
        return us_create_quic_socket_context(loop, options, ext_size);
    }

    /// Start listening for QUIC connections
    pub fn listen(this: *SocketContext, host: [*c]const u8, port: c_int, ext_size: c_int) ?*ListenSocket {
        return us_quic_socket_context_listen(this, host, port, ext_size);
    }

    /// Create an outgoing QUIC connection
    pub fn connect(this: *SocketContext, host: [*c]const u8, port: c_int, ext_size: c_int) ?*Socket {
        return us_quic_socket_context_connect(this, host, port, ext_size);
    }

    /// Get extension data for this context
    pub fn ext(this: *SocketContext) ?*anyopaque {
        return us_quic_socket_context_ext(this);
    }

    /// Set header for HTTP/3 requests
    pub fn setHeader(this: *SocketContext, index: c_int, key: [*c]const u8, key_length: c_int, value: [*c]const u8, value_length: c_int) void {
        us_quic_socket_context_set_header(this, index, key, key_length, value, value_length);
    }

    /// Send headers on a stream
    pub fn sendHeaders(this: *SocketContext, stream: *Stream, num: c_int, has_body: c_int) void {
        us_quic_socket_context_send_headers(this, stream, num, has_body);
    }

    /// Get header from received headers
    pub fn getHeader(this: *SocketContext, index: c_int, name: [*c][*c]u8, name_length: [*c]c_int, value: [*c][*c]u8, value_length: [*c]c_int) c_int {
        return us_quic_socket_context_get_header(this, index, name, name_length, value, value_length);
    }

    // Callback setters
    pub fn onStreamData(this: *SocketContext, callback: *const fn (*Stream, [*c]u8, c_int) callconv(.C) void) void {
        us_quic_socket_context_on_stream_data(this, callback);
    }

    pub fn onStreamEnd(this: *SocketContext, callback: *const fn (*Stream) callconv(.C) void) void {
        us_quic_socket_context_on_stream_end(this, callback);
    }

    pub fn onStreamHeaders(this: *SocketContext, callback: *const fn (*Stream) callconv(.C) void) void {
        us_quic_socket_context_on_stream_headers(this, callback);
    }

    pub fn onStreamOpen(this: *SocketContext, callback: *const fn (*Stream, c_int) callconv(.C) void) void {
        us_quic_socket_context_on_stream_open(this, callback);
    }

    pub fn onStreamClose(this: *SocketContext, callback: *const fn (*Stream) callconv(.C) void) void {
        us_quic_socket_context_on_stream_close(this, callback);
    }

    pub fn onOpen(this: *SocketContext, callback: *const fn (*Socket, c_int) callconv(.C) void) void {
        us_quic_socket_context_on_open(this, callback);
    }

    pub fn onClose(this: *SocketContext, callback: *const fn (*Socket) callconv(.C) void) void {
        us_quic_socket_context_on_close(this, callback);
    }

    pub fn onConnection(this: *SocketContext, callback: *const fn (*Socket) callconv(.C) void) void {
        us_quic_socket_context_on_connection(this, callback);
    }

    pub fn onStreamWritable(this: *SocketContext, callback: *const fn (*Stream) callconv(.C) void) void {
        us_quic_socket_context_on_stream_writable(this, callback);
    }
};

/// QUIC listen socket - represents a listening QUIC socket
pub const ListenSocket = opaque {
    // Listen sockets are created by SocketContext.listen()
    // and typically don't need many methods beyond what's inherited
    
    /// Get the port number this listen socket is bound to
    pub fn getPort(this: *ListenSocket) c_int {
        return us_quic_listen_socket_get_port(this);
    }
};

/// QUIC socket - represents a QUIC connection
pub const Socket = opaque {
    /// Get the socket context for this socket
    pub fn context(this: *Socket) ?*SocketContext {
        return us_quic_socket_context(this);
    }

    /// Create a new stream on this QUIC connection
    pub fn createStream(this: *Socket, ext_size: c_int) void {
        us_quic_socket_create_stream(this, ext_size);
    }
};

/// QUIC stream - represents a single stream within a QUIC connection
pub const Stream = opaque {
    /// Write data to the stream
    pub fn write(this: *Stream, data: []const u8) c_int {
        return us_quic_stream_write(this, @ptrCast(@constCast(data.ptr)), @intCast(data.len));
    }

    /// Get the socket that owns this stream
    pub fn socket(this: *Stream) ?*Socket {
        return us_quic_stream_socket(this);
    }

    /// Get extension data for this stream
    pub fn ext(this: *Stream) ?*anyopaque {
        return us_quic_stream_ext(this);
    }

    /// Check if this stream is from a client connection
    pub fn isClient(this: *Stream) bool {
        return us_quic_stream_is_client(this) != 0;
    }

    /// Shutdown the stream for writing
    pub fn shutdown(this: *Stream) c_int {
        return us_quic_stream_shutdown(this);
    }

    /// Shutdown the stream for reading
    pub fn shutdownRead(this: *Stream) c_int {
        return us_quic_stream_shutdown_read(this);
    }

    /// Close the stream
    pub fn close(this: *Stream) void {
        us_quic_stream_close(this);
    }
};

// External C function declarations
extern fn us_create_quic_socket_context(loop: *Loop, options: SocketContextOptions, ext_size: c_int) ?*SocketContext;
extern fn us_quic_socket_context_listen(context: *SocketContext, host: [*c]const u8, port: c_int, ext_size: c_int) ?*ListenSocket;
extern fn us_quic_socket_context_connect(context: *SocketContext, host: [*c]const u8, port: c_int, ext_size: c_int) ?*Socket;
extern fn us_quic_socket_context_ext(context: *SocketContext) ?*anyopaque;
extern fn us_quic_socket_context(socket: *Socket) ?*SocketContext;

// Stream functions
extern fn us_quic_stream_write(stream: *Stream, data: [*c]u8, length: c_int) c_int;
extern fn us_quic_stream_socket(stream: *Stream) ?*Socket;
extern fn us_quic_stream_ext(stream: *Stream) ?*anyopaque;
extern fn us_quic_stream_is_client(stream: *Stream) c_int;
extern fn us_quic_stream_shutdown(stream: *Stream) c_int;
extern fn us_quic_stream_shutdown_read(stream: *Stream) c_int;
extern fn us_quic_stream_close(stream: *Stream) void;
extern fn us_quic_listen_socket_get_port(listen_socket: *ListenSocket) c_int;

// Socket functions
extern fn us_quic_socket_create_stream(socket: *Socket, ext_size: c_int) void;

// Header functions
extern fn us_quic_socket_context_set_header(context: *SocketContext, index: c_int, key: [*c]const u8, key_length: c_int, value: [*c]const u8, value_length: c_int) void;
extern fn us_quic_socket_context_send_headers(context: *SocketContext, stream: *Stream, num: c_int, has_body: c_int) void;
extern fn us_quic_socket_context_get_header(context: *SocketContext, index: c_int, name: [*c][*c]u8, name_length: [*c]c_int, value: [*c][*c]u8, value_length: [*c]c_int) c_int;

// Callback registration functions
extern fn us_quic_socket_context_on_stream_data(context: *SocketContext, callback: *const fn (*Stream, [*c]u8, c_int) callconv(.C) void) void;
extern fn us_quic_socket_context_on_stream_end(context: *SocketContext, callback: *const fn (*Stream) callconv(.C) void) void;
extern fn us_quic_socket_context_on_stream_headers(context: *SocketContext, callback: *const fn (*Stream) callconv(.C) void) void;
extern fn us_quic_socket_context_on_stream_open(context: *SocketContext, callback: *const fn (*Stream, c_int) callconv(.C) void) void;
extern fn us_quic_socket_context_on_stream_close(context: *SocketContext, callback: *const fn (*Stream) callconv(.C) void) void;
extern fn us_quic_socket_context_on_open(context: *SocketContext, callback: *const fn (*Socket, c_int) callconv(.C) void) void;
extern fn us_quic_socket_context_on_close(context: *SocketContext, callback: *const fn (*Socket) callconv(.C) void) void;
extern fn us_quic_socket_context_on_connection(context: *SocketContext, callback: *const fn (*Socket) callconv(.C) void) void;
extern fn us_quic_socket_context_on_stream_writable(context: *SocketContext, callback: *const fn (*Stream) callconv(.C) void) void;
