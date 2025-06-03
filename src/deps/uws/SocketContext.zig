/// Zig wrapper around `us_socket_context_t` from uSockets.
///
/// Stores shared state for a group of sockets sharing the same configuration.
///
/// Key responsibilities:
/// - Socket creation and configuration management
/// - SSL/TLS certificate and security settings
/// - Event callback registration (open, close, data, error, etc.)
///
/// The wrapper:
/// - Provides compile-time SSL/TLS specialization via boolean parameters
/// - Offers safe casting between Zig and C representations
/// - Maintains zero-cost abstractions over the underlying uSockets API
/// - Supports both plain TCP and SSL/TLS socket contexts
///
/// Usage patterns:
/// - Create contexts using createNoSSLContext() or createSSLContext()
/// - Configure callbacks and options before creating sockets
/// - Use ref()/unref() for reference counting when sharing contexts
/// - Clean up with appropriate deinit methods when done
pub const SocketContext = opaque {
    pub fn getNativeHandle(this: *SocketContext, comptime ssl: bool) *anyopaque {
        return c.us_socket_context_get_native_handle(@intFromBool(ssl), this).?;
    }

    fn _deinit_ssl(this: *SocketContext) void {
        c.us_socket_context_free(@as(i32, 1), this);
    }

    fn _deinit(this: *SocketContext) void {
        c.us_socket_context_free(@as(i32, 0), this);
    }

    pub fn ref(this: *SocketContext, comptime ssl: bool) *SocketContext {
        c.us_socket_context_ref(@intFromBool(ssl), this);
        return this;
    }

    pub fn unref(this: *SocketContext, comptime ssl: bool) *SocketContext {
        c.us_socket_context_unref(@intFromBool(ssl), this);
        return this;
    }

    pub fn addServerName(this: *SocketContext, ssl: bool, hostname_pattern: [*c]const u8, options: BunSocketContextOptions) void {
        c.us_bun_socket_context_add_server_name(@intFromBool(ssl), this, hostname_pattern, options, null);
    }

    // TODO: refactor to "create" with optional ssl options
    pub fn createNoSSLContext(loop_ptr: *Loop, ext_size: i32) ?*SocketContext {
        return c.us_create_bun_nossl_socket_context(loop_ptr, ext_size);
    }

    // TODO: refactor to error union
    pub fn createSSLContext(loop_ptr: *Loop, ext_size: i32, options: BunSocketContextOptions, err: *uws.create_bun_socket_error_t) ?*SocketContext {
        return c.us_create_bun_ssl_socket_context(loop_ptr, ext_size, options, err);
    }

    pub fn cleanCallbacks(ctx: *SocketContext, is_ssl: bool) void {
        const ssl_int: i32 = @intFromBool(is_ssl);
        // replace callbacks with dummy ones
        const DummyCallbacks = struct {
            fn open(socket: *us_socket_t, _: i32, _: [*c]u8, _: i32) callconv(.C) ?*us_socket_t {
                return socket;
            }
            fn close(socket: *us_socket_t, _: i32, _: ?*anyopaque) callconv(.C) ?*us_socket_t {
                return socket;
            }
            fn data(socket: *us_socket_t, _: [*c]u8, _: i32) callconv(.C) ?*us_socket_t {
                return socket;
            }
            fn fd(socket: *us_socket_t, _: c_int) callconv(.C) ?*us_socket_t {
                return socket;
            }
            fn writable(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                return socket;
            }
            fn timeout(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                return socket;
            }
            fn connect_error(socket: *ConnectingSocket, _: i32) callconv(.C) ?*ConnectingSocket {
                return socket;
            }
            fn socket_connect_error(socket: *us_socket_t, _: i32) callconv(.C) ?*us_socket_t {
                return socket;
            }
            fn end(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                return socket;
            }
            fn handshake(_: *us_socket_t, _: i32, _: us_bun_verify_error_t, _: ?*anyopaque) callconv(.C) void {}
            fn long_timeout(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                return socket;
            }
        };
        c.us_socket_context_on_open(ssl_int, ctx, DummyCallbacks.open);
        c.us_socket_context_on_close(ssl_int, ctx, DummyCallbacks.close);
        c.us_socket_context_on_data(ssl_int, ctx, DummyCallbacks.data);
        c.us_socket_context_on_fd(ssl_int, ctx, DummyCallbacks.fd);
        c.us_socket_context_on_writable(ssl_int, ctx, DummyCallbacks.writable);
        c.us_socket_context_on_timeout(ssl_int, ctx, DummyCallbacks.timeout);
        c.us_socket_context_on_connect_error(ssl_int, ctx, DummyCallbacks.connect_error);
        c.us_socket_context_on_socket_connect_error(ssl_int, ctx, DummyCallbacks.socket_connect_error);
        c.us_socket_context_on_end(ssl_int, ctx, DummyCallbacks.end);
        c.us_socket_context_on_handshake(ssl_int, ctx, DummyCallbacks.handshake, null);
        c.us_socket_context_on_long_timeout(ssl_int, ctx, DummyCallbacks.long_timeout);
    }

    fn getLoop(this: *SocketContext, ssl: bool) ?*Loop {
        return c.us_socket_context_loop(@intFromBool(ssl), this);
    }

    /// closes and deinit the SocketContexts
    pub fn deinit(this: *SocketContext, ssl: bool) void {
        // we clean the callbacks to avoid UAF because we are deiniting
        this.cleanCallbacks(ssl);
        this.close(ssl);
        //always deinit in next iteration
        if (ssl) {
            Loop.get().nextTick(*SocketContext, this, SocketContext._deinit_ssl);
        } else {
            Loop.get().nextTick(*SocketContext, this, SocketContext._deinit);
        }
    }

    pub fn close(this: *SocketContext, ssl: bool) void {
        debug("us_socket_context_close({d})", .{@intFromPtr(this)});
        c.us_socket_context_close(@intFromBool(ssl), this);
    }

    pub fn ext(this: *SocketContext, ssl: bool, comptime ContextType: type) ?*ContextType {
        const alignment = if (ContextType == *anyopaque)
            @sizeOf(usize)
        else
            std.meta.alignment(ContextType);

        const ptr = c.us_socket_context_ext(
            @intFromBool(ssl),
            this,
        ) orelse return null;

        return @as(*align(alignment) ContextType, @ptrCast(@alignCast(ptr)));
    }

    pub fn onOpen(this: *SocketContext, ssl: bool, on_open: ?*const fn (*us_socket_t, i32, [*c]u8, i32) callconv(.C) ?*us_socket_t) void {
        c.us_socket_context_on_open(@intFromBool(ssl), this, on_open);
    }

    pub fn onClose(this: *SocketContext, ssl: bool, on_close: ?*const fn (*us_socket_t, i32, ?*anyopaque) callconv(.C) ?*us_socket_t) void {
        c.us_socket_context_on_close(@intFromBool(ssl), this, on_close);
    }

    pub fn onData(this: *SocketContext, ssl: bool, on_data: ?*const fn (*us_socket_t, [*c]u8, i32) callconv(.C) ?*us_socket_t) void {
        c.us_socket_context_on_data(@intFromBool(ssl), this, on_data);
    }

    pub fn onFd(this: *SocketContext, ssl: bool, on_fd: ?*const fn (*us_socket_t, c_int) callconv(.C) ?*us_socket_t) void {
        c.us_socket_context_on_fd(@intFromBool(ssl), this, on_fd);
    }

    pub fn onHandshake(this: *SocketContext, ssl: bool, on_handshake: ?*const fn (*us_socket_t, i32, us_bun_verify_error_t, ?*anyopaque) callconv(.C) void) void {
        c.us_socket_context_on_handshake(@intFromBool(ssl), this, on_handshake, null);
    }

    pub fn onLongTimeout(this: *SocketContext, ssl: bool, on_timeout: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t) void {
        c.us_socket_context_on_long_timeout(@intFromBool(ssl), this, on_timeout);
    }

    pub fn onWritable(this: *SocketContext, ssl: bool, on_writable: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t) void {
        c.us_socket_context_on_writable(@intFromBool(ssl), this, on_writable);
    }

    pub fn onTimeout(this: *SocketContext, ssl: bool, on_timeout: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t) void {
        c.us_socket_context_on_timeout(@intFromBool(ssl), this, on_timeout);
    }

    pub fn onConnectError(this: *SocketContext, ssl: bool, on_connect_error: ?*const fn (*ConnectingSocket, i32) callconv(.C) ?*ConnectingSocket) void {
        c.us_socket_context_on_connect_error(@intFromBool(ssl), this, on_connect_error);
    }

    pub fn onSocketConnectError(this: *SocketContext, ssl: bool, on_connect_error: ?*const fn (*us_socket_t, i32) callconv(.C) ?*us_socket_t) void {
        c.us_socket_context_on_socket_connect_error(@intFromBool(ssl), this, on_connect_error);
    }

    pub fn onEnd(this: *SocketContext, ssl: bool, on_end: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t) void {
        c.us_socket_context_on_end(@intFromBool(ssl), this, on_end);
    }

    pub fn onServerName(this: *SocketContext, ssl: bool, on_server_name: ?*const fn (*SocketContext, [*c]const u8) callconv(.C) void) void {
        c.us_socket_context_on_server_name(@intFromBool(ssl), this, on_server_name);
    }

    pub fn removeServerName(this: *SocketContext, ssl: bool, hostname_pattern: [*:0]const u8) void {
        c.us_socket_context_remove_server_name(@intFromBool(ssl), this, hostname_pattern);
    }

    pub fn adoptSocket(this: *SocketContext, ssl: bool, s: *us_socket_t, ext_size: i32) ?*us_socket_t {
        return c.us_socket_context_adopt_socket(@intFromBool(ssl), this, s, ext_size);
    }

    pub fn connect(this: *SocketContext, ssl: bool, host: [*:0]const u8, port: i32, options: i32, socket_ext_size: i32, has_dns_resolved: *i32) ?*anyopaque {
        return c.us_socket_context_connect(@intFromBool(ssl), this, host, port, options, socket_ext_size, has_dns_resolved);
    }

    pub fn connectUnix(this: *SocketContext, ssl: bool, path: [:0]const u8, options: i32, socket_ext_size: i32) ?*us_socket_t {
        return c.us_socket_context_connect_unix(@intFromBool(ssl), this, path.ptr, path.len, options, socket_ext_size);
    }

    pub fn free(this: *SocketContext, ssl: bool) void {
        c.us_socket_context_free(@intFromBool(ssl), this);
    }

    pub fn listen(this: *SocketContext, ssl: bool, host: ?[*:0]const u8, port: i32, options: i32, socket_ext_size: i32, err: *c_int) ?*ListenSocket {
        return c.us_socket_context_listen(@intFromBool(ssl), this, host, port, options, socket_ext_size, err);
    }

    pub fn listenUnix(this: *SocketContext, ssl: bool, path: [*:0]const u8, pathlen: usize, options: i32, socket_ext_size: i32, err: *c_int) ?*ListenSocket {
        return c.us_socket_context_listen_unix(@intFromBool(ssl), this, path, pathlen, options, socket_ext_size, err);
    }

    pub fn loop(this: *SocketContext, ssl: bool) ?*Loop {
        return c.us_socket_context_loop(@intFromBool(ssl), this);
    }

    /// Corresponds to `us_bun_socket_context_options_t`
    pub const BunSocketContextOptions = extern struct {
        key_file_name: [*c]const u8 = null,
        cert_file_name: [*c]const u8 = null,
        passphrase: [*c]const u8 = null,
        dh_params_file_name: [*c]const u8 = null,
        ca_file_name: [*c]const u8 = null,
        ssl_ciphers: [*c]const u8 = null,
        ssl_prefer_low_memory_usage: i32 = 0,
        key: ?[*]?[*:0]const u8 = null,
        key_count: u32 = 0,
        cert: ?[*]?[*:0]const u8 = null,
        cert_count: u32 = 0,
        ca: ?[*]?[*:0]const u8 = null,
        ca_count: u32 = 0,
        secure_options: u32 = 0,
        reject_unauthorized: i32 = 0,
        request_cert: i32 = 0,
        client_renegotiation_limit: u32 = 3,
        client_renegotiation_window: u32 = 600,

        pub fn createSSLContext(options: BunSocketContextOptions, err: *uws.create_bun_socket_error_t) ?*BoringSSL.SSL_CTX {
            return c.create_ssl_context_from_bun_options(options, err);
        }
    };
};

pub const c = struct {
    pub extern fn us_bun_socket_context_add_server_name(ssl: i32, context: ?*SocketContext, hostname_pattern: [*c]const u8, options: SocketContext.BunSocketContextOptions, ?*anyopaque) void;
    pub extern fn us_create_bun_nossl_socket_context(loop: ?*Loop, ext_size: i32) ?*SocketContext;
    pub extern fn us_create_bun_ssl_socket_context(loop: ?*Loop, ext_size: i32, options: SocketContext.BunSocketContextOptions, err: *create_bun_socket_error_t) ?*SocketContext;
    pub extern fn us_create_child_socket_context(ssl: i32, context: ?*SocketContext, context_ext_size: i32) ?*SocketContext;
    pub extern fn us_socket_context_adopt_socket(ssl: i32, context: *SocketContext, s: *us_socket_t, ext_size: i32) ?*us_socket_t;
    pub extern fn us_socket_context_close(ssl: i32, ctx: *anyopaque) void;
    pub extern fn us_socket_context_connect(ssl: i32, context: *SocketContext, host: [*:0]const u8, port: i32, options: i32, socket_ext_size: i32, has_dns_resolved: *i32) ?*anyopaque;
    pub extern fn us_socket_context_connect_unix(ssl: i32, context: *SocketContext, path: [*:0]const u8, pathlen: usize, options: i32, socket_ext_size: i32) ?*us_socket_t;
    pub extern fn us_socket_context_ext(ssl: i32, context: *SocketContext) ?*anyopaque;
    pub extern fn us_socket_context_free(ssl: i32, context: *SocketContext) void;
    pub extern fn us_socket_context_get_native_handle(ssl: i32, context: *SocketContext) ?*anyopaque;
    pub extern fn us_socket_context_listen(ssl: i32, context: *SocketContext, host: ?[*:0]const u8, port: i32, options: i32, socket_ext_size: i32, err: *c_int) ?*ListenSocket;
    pub extern fn us_socket_context_listen_unix(ssl: i32, context: *SocketContext, path: [*:0]const u8, pathlen: usize, options: i32, socket_ext_size: i32, err: *c_int) ?*ListenSocket;
    pub extern fn us_socket_context_loop(ssl: i32, context: *SocketContext) ?*Loop;
    pub extern fn us_socket_context_on_close(ssl: i32, context: *SocketContext, on_close: ?*const fn (*us_socket_t, i32, ?*anyopaque) callconv(.C) ?*us_socket_t) void;
    pub extern fn us_socket_context_on_connect_error(ssl: i32, context: *SocketContext, on_connect_error: ?*const fn (*uws.ConnectingSocket, i32) callconv(.C) ?*uws.ConnectingSocket) void;
    pub extern fn us_socket_context_on_data(ssl: i32, context: *SocketContext, on_data: ?*const fn (*us_socket_t, [*c]u8, i32) callconv(.C) ?*us_socket_t) void;
    pub extern fn us_socket_context_on_end(ssl: i32, context: *SocketContext, on_end: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t) void;
    pub extern fn us_socket_context_on_fd(ssl: i32, context: *SocketContext, on_fd: ?*const fn (*us_socket_t, c_int) callconv(.C) ?*us_socket_t) void;
    pub extern fn us_socket_context_on_handshake(ssl: i32, context: *SocketContext, on_handshake: ?*const fn (*us_socket_t, i32, us_bun_verify_error_t, ?*anyopaque) callconv(.C) void, ?*anyopaque) void;
    pub extern fn us_socket_context_on_long_timeout(ssl: i32, context: *SocketContext, on_timeout: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t) void;
    pub extern fn us_socket_context_on_open(ssl: i32, context: *SocketContext, on_open: ?*const fn (*us_socket_t, i32, [*c]u8, i32) callconv(.C) ?*us_socket_t) void;
    pub extern fn us_socket_context_on_server_name(ssl: i32, context: *SocketContext, cb: ?*const fn (?*SocketContext, [*c]const u8) callconv(.C) void) void;
    pub extern fn us_socket_context_on_socket_connect_error(ssl: i32, context: *SocketContext, on_connect_error: ?*const fn (*us_socket_t, i32) callconv(.C) ?*us_socket_t) void;
    pub extern fn us_socket_context_on_timeout(ssl: i32, context: *SocketContext, on_timeout: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t) void;
    pub extern fn us_socket_context_on_writable(ssl: i32, context: *SocketContext, on_writable: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t) void;
    pub extern fn us_socket_context_ref(ssl: i32, context: *SocketContext) void;
    pub extern fn us_socket_context_remove_server_name(ssl: i32, context: *SocketContext, hostname_pattern: [*c]const u8) void;
    pub extern fn us_socket_context_unref(ssl: i32, context: *SocketContext) void;
    pub extern fn create_ssl_context_from_bun_options(options: SocketContext.BunSocketContextOptions, err: *create_bun_socket_error_t) ?*BoringSSL.SSL_CTX;
};

const bun = @import("bun");
const uws = bun.uws;
const Loop = uws.Loop;
const us_socket_t = uws.us_socket_t;
const us_bun_verify_error_t = uws.us_bun_verify_error_t;
const create_bun_socket_error_t = uws.create_bun_socket_error_t;
const ListenSocket = uws.ListenSocket;
const debug = bun.Output.scoped(.uws, false);
const std = @import("std");
const ConnectingSocket = uws.ConnectingSocket;
const BoringSSL = bun.BoringSSL.c;
