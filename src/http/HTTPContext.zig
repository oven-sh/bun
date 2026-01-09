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

        pub fn markTaggedSocketAsDead(socket: HTTPSocket, tagged: ActiveSocket) void {
            if (tagged.is(PooledSocket)) {
                Handler.addMemoryBackToPool(tagged.as(PooledSocket));
            }

            if (socket.ext(**anyopaque)) |ctx| {
                ctx.* = bun.cast(**anyopaque, ActiveSocket.init(dead_socket).ptr());
            }
        }

        pub fn markSocketAsDead(socket: HTTPSocket) void {
            markTaggedSocketAsDead(socket, getTaggedFromSocket(socket));
        }

        pub fn terminateSocket(socket: HTTPSocket) void {
            markSocketAsDead(socket);
            socket.close(.failure);
        }

        pub fn closeSocket(socket: HTTPSocket) void {
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
            return ActiveSocket.init(dead_socket);
        }

        pub const PooledSocketHiveAllocator = bun.HiveArray(PooledSocket, pool_size);

        pending_sockets: PooledSocketHiveAllocator,
        us_socket_context: *uws.SocketContext,

        const Context = @This();
        pub const HTTPSocket = uws.NewSocketHandler(ssl);

        pub fn context() *@This() {
            if (comptime ssl) {
                return &bun.http.http_thread.https_context;
            } else {
                return &bun.http.http_thread.http_context;
            }
        }

        const ActiveSocket = TaggedPointerUnion(.{
            DeadSocket,
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
            bun.default_allocator.destroy(this);
        }

        pub fn initWithClientConfig(this: *@This(), client: *HTTPClient) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }
            const opts = client.tls_props.?.asUSocketsForClientVerification();
            try this.initWithOpts(&opts);
        }

        fn initWithOpts(this: *@This(), opts: *const uws.SocketContext.BunSocketContextOptions) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }

            var err: uws.create_bun_socket_error_t = .none;
            const socket = uws.SocketContext.createSSLContext(bun.http.http_thread.loop.loop, @sizeOf(usize), opts.*, &err);
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

        pub fn initWithThreadOpts(this: *@This(), init_opts: *const HTTPThread.InitOpts) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }
            var opts: uws.SocketContext.BunSocketContextOptions = .{
                .ca = if (init_opts.ca.len > 0) @ptrCast(init_opts.ca) else null,
                .ca_count = @intCast(init_opts.ca.len),
                .ca_file_name = if (init_opts.abs_ca_file_name.len > 0) init_opts.abs_ca_file_name else null,
                .request_cert = 1,
            };

            try this.initWithOpts(&opts);
        }

        pub fn init(this: *@This()) void {
            if (comptime ssl) {
                const opts: uws.SocketContext.BunSocketContextOptions = .{
                    // we request the cert so we load root certs and can verify it
                    .request_cert = 1,
                    // we manually abort the connection if the hostname doesn't match
                    .reject_unauthorized = 0,
                };
                var err: uws.create_bun_socket_error_t = .none;
                this.us_socket_context = uws.SocketContext.createSSLContext(bun.http.http_thread.loop.loop, @sizeOf(usize), opts, &err).?;

                this.sslCtx().setup();
            } else {
                this.us_socket_context = uws.SocketContext.createNoSSLContext(bun.http.http_thread.loop.loop, @sizeOf(usize)).?;
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
            // log("releaseSocket(0x{f})", .{bun.fmt.hexIntUpper(@intFromPtr(socket.socket))});

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

                    log("Keep-Alive release {s}:{d}", .{
                        hostname,
                        port,
                    });
                    return;
                }
            }
            log("close socket", .{});
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
                        if (comptime ssl) &bun.http.http_thread.https_context else &bun.http.http_thread.http_context,
                        socket,
                    );
                } else if (tagged.is(PooledSocket)) {
                    // trailing zero is fine to ignore
                    if (strings.eqlComptime(buf, bun.http.end_of_chunked_http1_1_encoding_response_body)) {
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
                }

                terminateSocket(socket);
            }
            pub fn onConnectError(
                ptr: *anyopaque,
                socket: HTTPSocket,
                _: c_int,
            ) void {
                const tagged = getTagged(ptr);
                markTaggedSocketAsDead(socket, tagged);
                if (tagged.get(HTTPClient)) |client| {
                    client.onConnectError();
                }
                // us_connecting_socket_close is always called internally by uSockets
            }
            pub fn onEnd(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                // TCP fin must be closed, but we must keep the original tagged
                // pointer so that their onClose callback is called.
                //
                // Three possible states:
                // 1. HTTP Keep-Alive socket: it must be removed from the pool
                // 2. HTTP Client socket: it might need to be retried
                // 3. Dead socket: it is already marked as dead
                const tagged = getTagged(ptr);
                markTaggedSocketAsDead(socket, tagged);
                socket.close(.failure);

                if (tagged.get(HTTPClient)) |client| {
                    client.onClose(comptime ssl, socket);
                    return;
                }
            }
        };

        fn existingSocket(this: *@This(), reject_unauthorized: bool, hostname: []const u8, port: u16) ?HTTPSocket {
            if (hostname.len > MAX_KEEPALIVE_HOSTNAME)
                return null;

            var iter = this.pending_sockets.used.iterator(.{ .kind = .set });

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

                    if (http_socket.isClosed()) {
                        markSocketAsDead(http_socket);
                        continue;
                    }

                    if (http_socket.isShutdown() or http_socket.getError() != 0) {
                        terminateSocket(http_socket);
                        continue;
                    }

                    assert(context().pending_sockets.put(socket));
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

const DeadSocket = struct {
    garbage: u8 = 0,
    pub var dead_socket: DeadSocket = .{};
};

var dead_socket = &DeadSocket.dead_socket;
const log = bun.Output.scoped(.HTTPContext, .hidden);

const HTTPCertError = @import("./HTTPCertError.zig");
const HTTPThread = @import("./HTTPThread.zig");
const TaggedPointerUnion = @import("../ptr.zig").TaggedPointerUnion;

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const assert = bun.assert;
const strings = bun.strings;
const uws = bun.uws;
const BoringSSL = bun.BoringSSL.c;

const HTTPClient = bun.http;
const InitError = HTTPClient.InitError;
