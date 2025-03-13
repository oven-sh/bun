const bun = @import("root").bun;
const std = @import("std");

const Global = bun.Global;
const picohttp = bun.picohttp;
const BoringSSL = bun.BoringSSL;
const JSC = bun.JSC;
const MutableString = bun.MutableString;
const Environment = bun.Environment;
const DeadSocket = opaque {};
var dead_socket = @as(*DeadSocket, @ptrFromInt(1));
const HiveArray = bun.HiveArray;
const uws = bun.uws;
const FeatureFlags = bun.FeatureFlags;
const TaggedPointerUnion = bun.TaggedPointerUnion;
const InitError = @import("./errors.zig").InitError;
const InitOpts = @import("./init_options.zig").InitOpts;
const SSLConfig = bun.server.ServerConfig.SSLConfig;
const Output = bun.Output;
const assert = bun.assert;
const strings = bun.strings;
const Batch = bun.ThreadPool.Batch;

pub var http_thread: HTTPThread = undefined;

var custom_ssl_context_map = std.AutoArrayHashMap(*SSLConfig, *NewHTTPContext(true)).init(bun.default_allocator);
pub const Headers = JSC.WebCore.Headers;
const HTTPCertError = @import("./errors.zig").HTTPCertError;
const Queue = @import("./async_http.zig").Queue;
const ThreadlocalAsyncHTTP = @import("./async_http.zig").ThreadlocalAsyncHTTP;
const ProxyTunnel = @import("./proxy_tunnel.zig").ProxyTunnel;
const AsyncHTTP = @import("./async_http.zig").AsyncHTTP;
const socket_async_http_abort_tracker = AsyncHTTP.getSocketAsyncHTTPAbortTracker();
const log = Output.scoped(.fetch, false);
const HTTPClient = @import("../../http.zig").HTTPClient;
pub const end_of_chunked_http1_1_encoding_response_body = "0\r\n\r\n";

pub fn getContext(comptime ssl: bool) *NewHTTPContext(ssl) {
    return if (ssl) &http_thread.https_context else &http_thread.http_context;
}
pub fn getHttpThread() *HTTPThread {
    return &http_thread;
}

pub fn NewHTTPContext(comptime ssl: bool) type {
    return struct {
        const pool_size = 64;
        const PooledSocket = struct {
            http_socket: HTTPSocket,
            hostname_buf: [MAX_KEEPALIVE_HOSTNAME]u8 = undefined,
            hostname_len: u8 = 0,
            port: u16 = 0,
            /// If you set `rejectUnauthorized` to `false`, the connection fails to verify,
            did_have_handshaking_error_while_reject_unauthorized_is_false: bool = false,
        };

        pub fn markSocketAsDead(socket: HTTPSocket) void {
            if (socket.ext(**anyopaque)) |ctx| {
                ctx.* = bun.cast(**anyopaque, ActiveSocket.init(&dead_socket).ptr());
            }
        }

        fn terminateSocket(socket: HTTPSocket) void {
            markSocketAsDead(socket);
            socket.close(.failure);
        }

        fn closeSocket(socket: HTTPSocket) void {
            markSocketAsDead(socket);
            socket.close(.normal);
        }

        fn getTagged(ptr: *anyopaque) ActiveSocket {
            return ActiveSocket.from(bun.cast(**anyopaque, ptr).*);
        }

        pub fn getTaggedFromSocket(socket: HTTPSocket) ActiveSocket {
            if (socket.ext(anyopaque)) |ctx| {
                return getTagged(ctx);
            }
            return ActiveSocket.init(&dead_socket);
        }

        pending_sockets: HiveArray(PooledSocket, pool_size) = .empty,
        us_socket_context: *uws.SocketContext,

        const Context = @This();
        pub const HTTPSocket = uws.NewSocketHandler(ssl);

        pub fn context() *@This() {
            return getContext(ssl);
        }

        const ActiveSocket = TaggedPointerUnion(.{
            *DeadSocket,
            HTTPClient,
            PooledSocket,
        });
        const ssl_int = @as(c_int, @intFromBool(ssl));

        const MAX_KEEPALIVE_HOSTNAME = 128;

        pub fn sslCtx(this: *@This()) *BoringSSL.SSL_CTX {
            if (comptime !ssl) {
                unreachable;
            }

            return @as(*BoringSSL.SSL_CTX, @ptrCast(this.us_socket_context.getNativeHandle(true)));
        }

        pub fn deinit(this: *@This()) void {
            this.us_socket_context.deinit(ssl);
            uws.us_socket_context_free(@as(c_int, @intFromBool(ssl)), this.us_socket_context);
            bun.default_allocator.destroy(this);
        }

        pub fn initWithClientConfig(this: *@This(), client: *HTTPClient) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }
            var opts = client.tls_props.?.asUSockets();
            opts.request_cert = 1;
            opts.reject_unauthorized = 0;
            try this.initWithOpts(&opts);
        }

        fn initWithOpts(this: *@This(), opts: *const uws.us_bun_socket_context_options_t) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }

            var err: uws.create_bun_socket_error_t = .none;
            const socket = uws.us_create_bun_socket_context(ssl_int, http_thread.loop.loop, @sizeOf(usize), opts.*, &err);
            if (socket == null) {
                return switch (err) {
                    .load_ca_file => error.LoadCAFile,
                    .invalid_ca_file => error.InvalidCAFile,
                    .invalid_ca => error.InvalidCA,
                    else => error.FailedToOpenSocket,
                };
            }
            this.us_socket_context = socket.?;
            this.sslCtx().setup();

            HTTPSocket.configure(
                this.us_socket_context,
                false,
                anyopaque,
                Handler,
            );
        }

        pub fn initWithThreadOpts(this: *@This(), init_opts: *const InitOpts) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }
            var opts: uws.us_bun_socket_context_options_t = .{
                .ca = if (init_opts.ca.len > 0) @ptrCast(init_opts.ca) else null,
                .ca_count = @intCast(init_opts.ca.len),
                .ca_file_name = if (init_opts.abs_ca_file_name.len > 0) init_opts.abs_ca_file_name else null,
                .request_cert = 1,
            };

            try this.initWithOpts(&opts);
        }

        pub fn init(this: *@This()) void {
            if (comptime ssl) {
                const opts: uws.us_bun_socket_context_options_t = .{
                    // we request the cert so we load root certs and can verify it
                    .request_cert = 1,
                    // we manually abort the connection if the hostname doesn't match
                    .reject_unauthorized = 0,
                };
                var err: uws.create_bun_socket_error_t = .none;
                this.us_socket_context = uws.us_create_bun_socket_context(ssl_int, http_thread.loop.loop, @sizeOf(usize), opts, &err).?;

                this.sslCtx().setup();
            } else {
                const opts: uws.us_socket_context_options_t = .{};
                this.us_socket_context = uws.us_create_socket_context(ssl_int, http_thread.loop.loop, @sizeOf(usize), opts).?;
            }

            HTTPSocket.configure(
                this.us_socket_context,
                false,
                anyopaque,
                Handler,
            );
        }

        /// Attempt to keep the socket alive by reusing it for another request.
        /// If no space is available, close the socket.
        ///
        /// If `did_have_handshaking_error_while_reject_unauthorized_is_false`
        /// is set, then we can only reuse the socket for HTTP Keep Alive if
        /// `reject_unauthorized` is set to `false`.
        pub fn releaseSocket(this: *@This(), socket: HTTPSocket, did_have_handshaking_error_while_reject_unauthorized_is_false: bool, hostname: []const u8, port: u16) void {
            // log("releaseSocket(0x{})", .{bun.fmt.hexIntUpper(@intFromPtr(socket.socket))});

            if (comptime Environment.allow_assert) {
                assert(!socket.isClosed());
                assert(!socket.isShutdown());
                assert(socket.isEstablished());
            }
            assert(hostname.len > 0);
            assert(port > 0);

            if (hostname.len <= MAX_KEEPALIVE_HOSTNAME and !socket.isClosedOrHasError() and socket.isEstablished()) {
                if (this.pending_sockets.get()) |pending| {
                    if (socket.ext(**anyopaque)) |ctx| {
                        ctx.* = bun.cast(**anyopaque, ActiveSocket.init(pending).ptr());
                    }
                    socket.flush();
                    socket.timeout(0);
                    socket.setTimeoutMinutes(5);

                    pending.http_socket = socket;
                    pending.did_have_handshaking_error_while_reject_unauthorized_is_false = did_have_handshaking_error_while_reject_unauthorized_is_false;
                    @memcpy(pending.hostname_buf[0..hostname.len], hostname);
                    pending.hostname_len = @as(u8, @truncate(hostname.len));
                    pending.port = port;

                    // log("Keep-Alive release {s}:{d} (0x{})", .{ hostname, port, @intFromPtr(socket.socket) });
                    return;
                }
            }

            closeSocket(socket);
        }

        pub const Handler = struct {
            pub fn onOpen(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                const active = getTagged(ptr);
                if (active.get(HTTPClient)) |client| {
                    if (client.onOpen(comptime ssl, socket)) |_| {
                        return;
                    } else |_| {
                        log("Unable to open socket", .{});
                        terminateSocket(socket);
                        return;
                    }
                }

                if (active.get(PooledSocket)) |pooled| {
                    addMemoryBackToPool(pooled);
                    return;
                }

                log("Unexpected open on unknown socket", .{});
                terminateSocket(socket);
            }
            pub fn onHandshake(
                ptr: *anyopaque,
                socket: HTTPSocket,
                success: i32,
                ssl_error: uws.us_bun_verify_error_t,
            ) void {
                const handshake_success = if (success == 1) true else false;

                const handshake_error = HTTPCertError{
                    .error_no = ssl_error.error_no,
                    .code = if (ssl_error.code == null) "" else ssl_error.code[0..bun.len(ssl_error.code) :0],
                    .reason = if (ssl_error.code == null) "" else ssl_error.reason[0..bun.len(ssl_error.reason) :0],
                };

                const active = getTagged(ptr);
                if (active.get(HTTPClient)) |client| {
                    // handshake completed but we may have ssl errors
                    client.flags.did_have_handshaking_error = handshake_error.error_no != 0;
                    if (handshake_success) {
                        if (client.flags.reject_unauthorized) {
                            // only reject the connection if reject_unauthorized == true
                            if (client.flags.did_have_handshaking_error) {
                                client.closeAndFail(BoringSSL.getCertErrorFromNo(handshake_error.error_no), comptime ssl, socket);
                                return;
                            }

                            // if checkServerIdentity returns false, we dont call open this means that the connection was rejected
                            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(socket.getNativeHandle()));
                            if (!client.checkServerIdentity(comptime ssl, socket, handshake_error, ssl_ptr, true)) {
                                client.flags.did_have_handshaking_error = true;
                                client.unregisterAbortTracker();
                                if (!socket.isClosed()) terminateSocket(socket);
                                return;
                            }
                        }

                        return client.firstCall(comptime ssl, socket);
                    } else {
                        // if we are here is because server rejected us, and the error_no is the cause of this
                        // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
                        if (client.flags.did_have_handshaking_error) {
                            client.closeAndFail(BoringSSL.getCertErrorFromNo(handshake_error.error_no), comptime ssl, socket);
                            return;
                        }
                        // if handshake_success it self is false, this means that the connection was rejected
                        client.closeAndFail(error.ConnectionRefused, comptime ssl, socket);
                        return;
                    }
                }

                if (socket.isClosed()) {
                    markSocketAsDead(socket);
                    if (active.get(PooledSocket)) |pooled| {
                        addMemoryBackToPool(pooled);
                    }

                    return;
                }

                if (handshake_success) {
                    if (active.is(PooledSocket)) {
                        // Allow pooled sockets to be reused if the handshake was successful.
                        socket.setTimeout(0);
                        socket.setTimeoutMinutes(5);
                        return;
                    }
                }

                if (active.get(PooledSocket)) |pooled| {
                    addMemoryBackToPool(pooled);
                }

                terminateSocket(socket);
            }
            pub fn onClose(
                ptr: *anyopaque,
                socket: HTTPSocket,
                _: c_int,
                _: ?*anyopaque,
            ) void {
                const tagged = getTagged(ptr);
                markSocketAsDead(socket);

                if (tagged.get(HTTPClient)) |client| {
                    return client.onClose(comptime ssl, socket);
                }

                if (tagged.get(PooledSocket)) |pooled| {
                    addMemoryBackToPool(pooled);
                }

                return;
            }

            fn addMemoryBackToPool(pooled: *PooledSocket) void {
                assert(context().pending_sockets.put(pooled));
            }

            pub fn onData(
                ptr: *anyopaque,
                socket: HTTPSocket,
                buf: []const u8,
            ) void {
                const tagged = getTagged(ptr);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onData(
                        comptime ssl,
                        buf,
                        getContext(ssl),
                        socket,
                    );
                } else if (tagged.is(PooledSocket)) {
                    // trailing zero is fine to ignore
                    if (strings.eqlComptime(buf, end_of_chunked_http1_1_encoding_response_body)) {
                        return;
                    }

                    log("Unexpected data on socket", .{});

                    return;
                }
                log("Unexpected data on unknown socket", .{});
                terminateSocket(socket);
            }
            pub fn onWritable(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                const tagged = getTagged(ptr);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onWritable(
                        false,
                        comptime ssl,
                        socket,
                    );
                } else if (tagged.is(PooledSocket)) {
                    // it's a keep-alive socket
                } else {
                    // don't know what this is, let's close it
                    log("Unexpected writable on socket", .{});
                    terminateSocket(socket);
                }
            }
            pub fn onLongTimeout(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                const tagged = getTagged(ptr);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onTimeout(comptime ssl, socket);
                } else if (tagged.get(PooledSocket)) |pooled| {
                    // If a socket has been sitting around for 5 minutes
                    // Let's close it and remove it from the pool.
                    addMemoryBackToPool(pooled);
                }

                terminateSocket(socket);
            }
            pub fn onConnectError(
                ptr: *anyopaque,
                socket: HTTPSocket,
                _: c_int,
            ) void {
                const tagged = getTagged(ptr);
                markSocketAsDead(socket);
                if (tagged.get(HTTPClient)) |client| {
                    client.onConnectError();
                } else if (tagged.get(PooledSocket)) |pooled| {
                    addMemoryBackToPool(pooled);
                }
                // us_connecting_socket_close is always called internally by uSockets
            }
            pub fn onEnd(
                _: *anyopaque,
                socket: HTTPSocket,
            ) void {
                // TCP fin must be closed, but we must keep the original tagged
                // pointer so that their onClose callback is called.
                //
                // Three possible states:
                // 1. HTTP Keep-Alive socket: it must be removed from the pool
                // 2. HTTP Client socket: it might need to be retried
                // 3. Dead socket: it is already marked as dead
                socket.close(.failure);
            }
        };

        fn existingSocket(this: *@This(), reject_unauthorized: bool, hostname: []const u8, port: u16) ?HTTPSocket {
            if (hostname.len > MAX_KEEPALIVE_HOSTNAME)
                return null;

            var iter = this.pending_sockets.available.iterator(.{ .kind = .unset });

            while (iter.next()) |pending_socket_index| {
                var socket = this.pending_sockets.at(@as(u16, @intCast(pending_socket_index)));
                if (socket.port != port) {
                    continue;
                }

                if (socket.did_have_handshaking_error_while_reject_unauthorized_is_false and reject_unauthorized) {
                    continue;
                }

                if (strings.eqlLong(socket.hostname_buf[0..socket.hostname_len], hostname, true)) {
                    const http_socket = socket.http_socket;
                    assert(context().pending_sockets.put(socket));

                    if (http_socket.isClosed()) {
                        markSocketAsDead(http_socket);
                        continue;
                    }

                    if (http_socket.isShutdown() or http_socket.getError() != 0) {
                        terminateSocket(http_socket);
                        continue;
                    }

                    log("+ Keep-Alive reuse {s}:{d}", .{ hostname, port });
                    return http_socket;
                }
            }

            return null;
        }

        pub fn connectSocket(this: *@This(), client: *HTTPClient, socket_path: []const u8) !HTTPSocket {
            client.connected_url = if (client.http_proxy) |proxy| proxy else client.url;
            const socket = try HTTPSocket.connectUnixAnon(
                socket_path,
                this.us_socket_context,
                ActiveSocket.init(client).ptr(),
                false, // dont allow half-open sockets
            );
            client.allow_retry = false;
            return socket;
        }

        pub fn connect(this: *@This(), client: *HTTPClient, hostname_: []const u8, port: u16) !HTTPSocket {
            const hostname = if (FeatureFlags.hardcode_localhost_to_127_0_0_1 and strings.eqlComptime(hostname_, "localhost"))
                "127.0.0.1"
            else
                hostname_;

            client.connected_url = if (client.http_proxy) |proxy| proxy else client.url;
            client.connected_url.hostname = hostname;

            if (client.isKeepAlivePossible()) {
                if (this.existingSocket(client.flags.reject_unauthorized, hostname, port)) |sock| {
                    if (sock.ext(**anyopaque)) |ctx| {
                        ctx.* = bun.cast(**anyopaque, ActiveSocket.init(client).ptr());
                    }
                    client.allow_retry = true;
                    try client.onOpen(comptime ssl, sock);
                    if (comptime ssl) {
                        client.firstCall(comptime ssl, sock);
                    }
                    return sock;
                }
            }

            const socket = try HTTPSocket.connectAnon(
                hostname,
                port,
                this.us_socket_context,
                ActiveSocket.init(client).ptr(),
                false,
            );
            client.allow_retry = false;
            return socket;
        }
    };
}

pub const HTTPThread = struct {
    loop: *JSC.MiniEventLoop,
    http_context: NewHTTPContext(false),
    https_context: NewHTTPContext(true),

    queued_tasks: Queue = Queue{},

    queued_shutdowns: std.ArrayListUnmanaged(ShutdownMessage) = std.ArrayListUnmanaged(ShutdownMessage){},
    queued_writes: std.ArrayListUnmanaged(WriteMessage) = std.ArrayListUnmanaged(WriteMessage){},

    queued_shutdowns_lock: bun.Mutex = .{},
    queued_writes_lock: bun.Mutex = .{},

    queued_proxy_deref: std.ArrayListUnmanaged(*ProxyTunnel) = std.ArrayListUnmanaged(*ProxyTunnel){},

    has_awoken: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    timer: std.time.Timer,
    lazy_libdeflater: ?*LibdeflateState = null,
    lazy_request_body_buffer: ?*HeapRequestBodyBuffer = null,

    pub const HeapRequestBodyBuffer = struct {
        buffer: [512 * 1024]u8 = undefined,
        fixed_buffer_allocator: std.heap.FixedBufferAllocator,

        pub usingnamespace bun.New(@This());

        pub fn init() *@This() {
            var this = HeapRequestBodyBuffer.new(.{
                .fixed_buffer_allocator = undefined,
            });
            this.fixed_buffer_allocator = std.heap.FixedBufferAllocator.init(&this.buffer);
            return this;
        }

        pub fn put(this: *@This()) void {
            if (http_thread.lazy_request_body_buffer == null) {
                // This case hypothetically should never happen
                this.fixed_buffer_allocator.reset();
                http_thread.lazy_request_body_buffer = this;
            } else {
                this.deinit();
            }
        }

        pub fn deinit(this: *@This()) void {
            this.destroy();
        }
    };

    pub const RequestBodyBuffer = union(enum) {
        heap: *HeapRequestBodyBuffer,
        stack: std.heap.StackFallbackAllocator(request_body_send_stack_buffer_size),

        pub fn deinit(this: *@This()) void {
            switch (this.*) {
                .heap => |heap| heap.put(),
                .stack => {},
            }
        }

        pub fn allocatedSlice(this: *@This()) []u8 {
            return switch (this.*) {
                .heap => |heap| &heap.buffer,
                .stack => |*stack| &stack.buffer,
            };
        }

        pub fn allocator(this: *@This()) std.mem.Allocator {
            return switch (this.*) {
                .heap => |heap| heap.fixed_buffer_allocator.allocator(),
                .stack => |*stack| stack.get(),
            };
        }

        pub fn toArrayList(this: *@This()) std.ArrayList(u8) {
            var arraylist = std.ArrayList(u8).fromOwnedSlice(this.allocator(), this.allocatedSlice());
            arraylist.items.len = 0;
            return arraylist;
        }
    };

    const threadlog = Output.scoped(.HTTPThread, true);
    const WriteMessage = struct {
        data: []const u8,
        async_http_id: u32,
        flags: packed struct {
            is_tls: bool,
            ended: bool,
        },
    };
    const ShutdownMessage = struct {
        async_http_id: u32,
        is_tls: bool,
    };

    pub const LibdeflateState = struct {
        decompressor: *bun.libdeflate.Decompressor = undefined,
        shared_buffer: [512 * 1024]u8 = undefined,

        pub usingnamespace bun.New(@This());
    };

    const request_body_send_stack_buffer_size = 32 * 1024;

    pub inline fn getRequestBodySendBuffer(this: *@This(), estimated_size: usize) RequestBodyBuffer {
        if (estimated_size >= request_body_send_stack_buffer_size) {
            if (this.lazy_request_body_buffer == null) {
                log("Allocating HeapRequestBodyBuffer due to {d} bytes request body", .{estimated_size});
                return .{
                    .heap = HeapRequestBodyBuffer.init(),
                };
            }

            return .{ .heap = bun.take(&this.lazy_request_body_buffer).? };
        }
        return .{
            .stack = std.heap.stackFallback(request_body_send_stack_buffer_size, bun.default_allocator),
        };
    }

    pub fn deflater(this: *@This()) *LibdeflateState {
        if (this.lazy_libdeflater == null) {
            this.lazy_libdeflater = LibdeflateState.new(.{
                .decompressor = bun.libdeflate.Decompressor.alloc() orelse bun.outOfMemory(),
            });
        }

        return this.lazy_libdeflater.?;
    }

    fn initOnce(opts: *const InitOpts) void {
        http_thread = .{
            .loop = undefined,
            .http_context = .{
                .us_socket_context = undefined,
            },
            .https_context = .{
                .us_socket_context = undefined,
            },
            .timer = std.time.Timer.start() catch unreachable,
        };
        bun.libdeflate.load();
        const thread = std.Thread.spawn(
            .{
                .stack_size = bun.default_thread_stack_size,
            },
            onStart,
            .{opts.*},
        ) catch |err| Output.panic("Failed to start HTTP Client thread: {s}", .{@errorName(err)});
        thread.detach();
    }
    var init_once = bun.once(initOnce);

    pub fn init(opts: *const InitOpts) void {
        init_once.call(.{opts});
    }

    pub fn onStart(opts: InitOpts) void {
        Output.Source.configureNamedThread("HTTP Client");

        const loop = bun.JSC.MiniEventLoop.initGlobal(null);

        if (Environment.isWindows) {
            _ = std.process.getenvW(comptime bun.strings.w("SystemRoot")) orelse {
                bun.Output.errGeneric("The %SystemRoot% environment variable is not set. Bun needs this set in order for network requests to work.", .{});
                Global.crash();
            };
        }

        http_thread.loop = loop;
        http_thread.http_context.init();
        http_thread.https_context.initWithThreadOpts(&opts) catch |err| opts.onInitError(err, opts);
        http_thread.has_awoken.store(true, .monotonic);
        http_thread.processEvents();
    }

    pub fn connect(this: *@This(), client: *HTTPClient, comptime is_ssl: bool) !NewHTTPContext(is_ssl).HTTPSocket {
        if (client.unix_socket_path.length() > 0) {
            return try this.context(is_ssl).connectSocket(client, client.unix_socket_path.slice());
        }

        if (comptime is_ssl) {
            const needs_own_context = client.tls_props != null and client.tls_props.?.requires_custom_request_ctx;
            if (needs_own_context) {
                var requested_config = client.tls_props.?;
                for (custom_ssl_context_map.keys()) |other_config| {
                    if (requested_config.isSame(other_config)) {
                        // we free the callers config since we have a existing one
                        if (requested_config != client.tls_props) {
                            requested_config.deinit();
                            bun.default_allocator.destroy(requested_config);
                        }
                        client.tls_props = other_config;
                        if (client.http_proxy) |url| {
                            return try custom_ssl_context_map.get(other_config).?.connect(client, url.hostname, url.getPortAuto());
                        } else {
                            return try custom_ssl_context_map.get(other_config).?.connect(client, client.url.hostname, client.url.getPortAuto());
                        }
                    }
                }
                // we need the config so dont free it
                var custom_context = try bun.default_allocator.create(NewHTTPContext(is_ssl));
                custom_context.initWithClientConfig(client) catch |err| {
                    client.tls_props = null;

                    requested_config.deinit();
                    bun.default_allocator.destroy(requested_config);
                    bun.default_allocator.destroy(custom_context);

                    // TODO: these error names reach js. figure out how they should be handled
                    return switch (err) {
                        error.FailedToOpenSocket => |e| e,
                        error.InvalidCA => error.FailedToOpenSocket,
                        error.InvalidCAFile => error.FailedToOpenSocket,
                        error.LoadCAFile => error.FailedToOpenSocket,
                    };
                };
                try custom_ssl_context_map.put(requested_config, custom_context);
                // We might deinit the socket context, so we disable keepalive to make sure we don't
                // free it while in use.
                client.flags.disable_keepalive = true;
                if (client.http_proxy) |url| {
                    // https://github.com/oven-sh/bun/issues/11343
                    if (url.protocol.len == 0 or strings.eqlComptime(url.protocol, "https") or strings.eqlComptime(url.protocol, "http")) {
                        return try this.context(is_ssl).connect(client, url.hostname, url.getPortAuto());
                    }
                    return error.UnsupportedProxyProtocol;
                }
                return try custom_context.connect(client, client.url.hostname, client.url.getPortAuto());
            }
        }
        if (client.http_proxy) |url| {
            if (url.href.len > 0) {
                // https://github.com/oven-sh/bun/issues/11343
                if (url.protocol.len == 0 or strings.eqlComptime(url.protocol, "https") or strings.eqlComptime(url.protocol, "http")) {
                    return try this.context(is_ssl).connect(client, url.hostname, url.getPortAuto());
                }
                return error.UnsupportedProxyProtocol;
            }
        }
        return try this.context(is_ssl).connect(client, client.url.hostname, client.url.getPortAuto());
    }

    pub fn context(this: *@This(), comptime is_ssl: bool) *NewHTTPContext(is_ssl) {
        return if (is_ssl) &this.https_context else &this.http_context;
    }

    fn drainEvents(this: *@This()) void {
        {
            this.queued_shutdowns_lock.lock();
            defer this.queued_shutdowns_lock.unlock();
            for (this.queued_shutdowns.items) |http| {
                if (socket_async_http_abort_tracker.fetchSwapRemove(http.async_http_id)) |socket_ptr| {
                    if (http.is_tls) {
                        const socket = uws.SocketTLS.fromAny(socket_ptr.value);
                        // do a fast shutdown here since we are aborting and we dont want to wait for the close_notify from the other side
                        socket.close(.failure);
                    } else {
                        const socket = uws.SocketTCP.fromAny(socket_ptr.value);
                        socket.close(.failure);
                    }
                }
            }
            this.queued_shutdowns.clearRetainingCapacity();
        }
        {
            this.queued_writes_lock.lock();
            defer this.queued_writes_lock.unlock();
            for (this.queued_writes.items) |write| {
                const ended = write.flags.ended;
                defer if (!strings.eqlComptime(write.data, end_of_chunked_http1_1_encoding_response_body) and write.data.len > 0) {
                    // "0\r\n\r\n" is always a static so no need to free
                    bun.default_allocator.free(write.data);
                };
                if (socket_async_http_abort_tracker.get(write.async_http_id)) |socket_ptr| {
                    if (write.flags.is_tls) {
                        const socket = uws.SocketTLS.fromAny(socket_ptr);
                        if (socket.isClosed() or socket.isShutdown()) {
                            continue;
                        }
                        const tagged = NewHTTPContext(true).getTaggedFromSocket(socket);
                        if (tagged.get(HTTPClient)) |client| {
                            if (client.state.original_request_body == .stream) {
                                var stream = &client.state.original_request_body.stream;
                                if (write.data.len > 0) {
                                    stream.buffer.write(write.data) catch {};
                                }
                                stream.ended = ended;
                                if (!stream.has_backpressure) {
                                    client.onWritable(
                                        false,
                                        true,
                                        socket,
                                    );
                                }
                            }
                        }
                    } else {
                        const socket = uws.SocketTCP.fromAny(socket_ptr);
                        if (socket.isClosed() or socket.isShutdown()) {
                            continue;
                        }
                        const tagged = NewHTTPContext(false).getTaggedFromSocket(socket);
                        if (tagged.get(HTTPClient)) |client| {
                            if (client.state.original_request_body == .stream) {
                                var stream = &client.state.original_request_body.stream;
                                if (write.data.len > 0) {
                                    stream.buffer.write(write.data) catch {};
                                }
                                stream.ended = ended;
                                if (!stream.has_backpressure) {
                                    client.onWritable(
                                        false,
                                        false,
                                        socket,
                                    );
                                }
                            }
                        }
                    }
                }
            }
            this.queued_writes.clearRetainingCapacity();
        }

        while (this.queued_proxy_deref.popOrNull()) |http| {
            http.deref();
        }

        var count: usize = 0;
        var active = AsyncHTTP.active_requests_count.load(.monotonic);
        const max = AsyncHTTP.max_simultaneous_requests.load(.monotonic);
        if (active >= max) return;
        defer {
            if (comptime Environment.allow_assert) {
                if (count > 0)
                    log("Processed {d} tasks\n", .{count});
            }
        }

        while (this.queued_tasks.pop()) |http| {
            var cloned = ThreadlocalAsyncHTTP.new(.{
                .async_http = http.*,
            });
            cloned.async_http.real = http;
            cloned.async_http.onStart();
            if (comptime Environment.allow_assert) {
                count += 1;
            }

            active += 1;
            if (active >= max) break;
        }
    }

    fn processEvents(this: *@This()) noreturn {
        if (comptime Environment.isPosix) {
            this.loop.loop.num_polls = @max(2, this.loop.loop.num_polls);
        } else if (comptime Environment.isWindows) {
            this.loop.loop.inc();
        } else {
            @compileError("TODO:");
        }

        while (true) {
            this.drainEvents();

            var start_time: i128 = 0;
            if (comptime Environment.isDebug) {
                start_time = std.time.nanoTimestamp();
            }
            Output.flush();

            this.loop.loop.inc();
            this.loop.loop.tick();
            this.loop.loop.dec();

            // this.loop.run();
            if (comptime Environment.isDebug) {
                const end = std.time.nanoTimestamp();
                threadlog("Waited {any}\n", .{std.fmt.fmtDurationSigned(@as(i64, @truncate(end - start_time)))});
                Output.flush();
            }
        }
    }

    pub fn scheduleShutdown(this: *@This(), http: *AsyncHTTP) void {
        {
            this.queued_shutdowns_lock.lock();
            defer this.queued_shutdowns_lock.unlock();
            this.queued_shutdowns.append(bun.default_allocator, .{
                .async_http_id = http.async_http_id,
                .is_tls = http.client.isHTTPS(),
            }) catch bun.outOfMemory();
        }
        if (this.has_awoken.load(.monotonic))
            this.loop.loop.wakeup();
    }

    pub fn scheduleRequestWrite(this: *@This(), http: *AsyncHTTP, data: []const u8, ended: bool) void {
        {
            this.queued_writes_lock.lock();
            defer this.queued_writes_lock.unlock();
            this.queued_writes.append(bun.default_allocator, .{
                .async_http_id = http.async_http_id,
                .data = data,
                .flags = .{
                    .is_tls = http.client.isHTTPS(),
                    .ended = ended,
                },
            }) catch bun.outOfMemory();
        }
        if (this.has_awoken.load(.monotonic))
            this.loop.loop.wakeup();
    }

    pub fn scheduleProxyDeref(this: *@This(), proxy: *ProxyTunnel) void {
        // this is always called on the http thread
        {
            this.queued_proxy_deref.append(bun.default_allocator, proxy) catch bun.outOfMemory();
        }
        if (this.has_awoken.load(.monotonic))
            this.loop.loop.wakeup();
    }

    pub fn wakeup(this: *@This()) void {
        if (this.has_awoken.load(.monotonic))
            this.loop.loop.wakeup();
    }

    pub fn schedule(this: *@This(), batch: Batch) void {
        if (batch.len == 0)
            return;

        {
            var batch_ = batch;
            while (batch_.pop()) |task| {
                const http: *AsyncHTTP = @fieldParentPtr("task", task);
                this.queued_tasks.push(http);
            }
        }

        if (this.has_awoken.load(.monotonic))
            this.loop.loop.wakeup();
    }
};
