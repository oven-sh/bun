/// WebSocketUpgradeClient handles the HTTP upgrade process for WebSocket connections.
///
/// This module implements the client-side of the WebSocket protocol handshake as defined in RFC 6455.
/// It manages the initial HTTP request that upgrades the connection from HTTP to WebSocket protocol.
///
/// The process works as follows:
/// 1. Client sends an HTTP request with special headers indicating a WebSocket upgrade
/// 2. Server responds with HTTP 101 Switching Protocols
/// 3. After successful handshake, the connection is handed off to the WebSocket implementation
///
/// This client handles both secure (TLS) and non-secure connections.
/// It manages connection timeouts, protocol negotiation, and error handling during the upgrade process.
///
/// Note: This implementation is only used during the initial connection phase.
/// Once the WebSocket connection is established, control is passed to the WebSocket client.
///
/// For more information about the WebSocket handshaking process, see:
/// - RFC 6455 (The WebSocket Protocol): https://datatracker.ietf.org/doc/html/rfc6455#section-1.3
/// - MDN WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
/// - WebSocket Handshake: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers#the_websocket_handshake
pub fn NewHTTPUpgradeClient(comptime ssl: bool) type {
    return struct {
        pub const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
        pub const ref = RefCount.ref;
        pub const deref = RefCount.deref;
        pub const Socket = uws.NewSocketHandler(ssl);

        pub const DeflateNegotiationResult = struct {
            enabled: bool = false,
            params: WebSocketDeflate.Params = .{},
        };

        ref_count: RefCount,
        tcp: Socket,
        outgoing_websocket: ?*CppWebSocket,
        input_body_buf: []u8 = &[_]u8{},
        to_send: []const u8 = "",
        read_length: usize = 0,
        headers_buf: [128]PicoHTTP.Header = undefined,
        body: std.ArrayListUnmanaged(u8) = .{},
        hostname: [:0]const u8 = "",
        poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
        state: State = .initializing,
        subprotocols: bun.StringSet,

        /// Proxy state (null when not using proxy)
        proxy: ?WebSocketProxy = null,

        // TLS options (full SSLConfig for complete TLS customization)
        ssl_config: ?*SSLConfig = null,

        // Custom SSL context for per-connection TLS options (e.g., custom CA)
        // This is used when ssl_config has custom options that can't be applied
        // to the shared SSL context from C++.
        custom_ssl_ctx: ?*uws.SocketContext = null,

        // Expected Sec-WebSocket-Accept value for handshake validation per RFC 6455 §4.2.2.
        // This is base64(SHA-1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")).
        expected_accept: [28]u8 = .{0} ** 28,

        /// Non-.none while buffering the body of a non-101 response that spans
        /// multiple TCP reads. The 'handshake' event is deferred until we have
        /// the full body so the `unexpected-response` consumer sees the
        /// complete payload instead of just the bytes colocated with the
        /// header block in the first read.
        ///
        /// `.waiting_for_length` tracks the total expected buffer length
        /// (head_len + Content-Length). `.waiting_for_eof` is used when the
        /// response has no Content-Length — accumulate until the peer closes.
        deferred_handshake: union(enum) {
            none: void,
            waiting_for_length: usize,
            waiting_for_eof: void,
        } = .none,

        const State = enum {
            initializing,
            reading,
            failed,
            // Proxy states
            proxy_handshake, // Sent CONNECT, waiting for 200
            proxy_tls_handshake, // TLS inside tunnel (for wss:// through proxy)
            done, // WebSocket upgrade complete, forwarding data through tunnel
        };

        const HTTPClient = @This();
        pub fn register(_: *jsc.JSGlobalObject, _: *uws.Loop, ctx: *uws.SocketContext) callconv(.c) void {
            Socket.configure(
                ctx,
                true,
                *HTTPClient,
                struct {
                    pub const onOpen = handleOpen;
                    pub const onClose = handleClose;
                    pub const onData = handleData;
                    pub const onWritable = handleWritable;
                    pub const onTimeout = handleTimeout;
                    pub const onLongTimeout = handleTimeout;
                    pub const onConnectError = handleConnectError;
                    pub const onEnd = handleEnd;
                    pub const onHandshake = handleHandshake;
                },
            );
        }

        fn deinit(this: *HTTPClient) void {
            this.clearData();
            bun.debugAssert(this.tcp.isDetached());
            bun.destroy(this);
        }

        /// On error, this returns null.
        /// Returning null signals to the parent function that the connection failed.
        pub fn connect(
            global: *jsc.JSGlobalObject,
            socket_ctx: *uws.SocketContext,
            websocket: *CppWebSocket,
            host: *const bun.String,
            port: u16,
            pathname: *const bun.String,
            client_protocol: *const bun.String,
            header_names: ?[*]const bun.String,
            header_values: ?[*]const bun.String,
            header_count: usize,
            // Proxy parameters
            proxy_host: ?*const bun.String,
            proxy_port: u16,
            proxy_authorization: ?*const bun.String,
            proxy_header_names: ?[*]const bun.String,
            proxy_header_values: ?[*]const bun.String,
            proxy_header_count: usize,
            // TLS options (full SSLConfig for complete TLS customization)
            ssl_config: ?*SSLConfig,
            // Whether the target URL is wss:// (separate from ssl template parameter)
            target_is_secure: bool,
            // Target URL authorization (Basic auth from ws://user:pass@host)
            target_authorization: ?*const bun.String,
            // Unix domain socket path for ws+unix:// / wss+unix:// (null for TCP)
            unix_socket_path: ?*const bun.String,
        ) callconv(.c) ?*HTTPClient {
            const vm = global.bunVM();

            bun.assert(vm.event_loop_handle != null);

            // Decode all BunString inputs into UTF-8 slices. The underlying
            // JavaScript strings may be Latin1 or UTF-16; `String.toUTF8()` either
            // borrows the 8-bit ASCII backing (no allocation) or allocates a
            // UTF-8 copy. All slices live until `deinit_slices()` below.
            const allocator = bun.default_allocator;

            var host_slice = host.toUTF8(allocator);
            var pathname_slice = pathname.toUTF8(allocator);
            var client_protocol_slice = client_protocol.toUTF8(allocator);

            // Headers8Bit.init only returns Allocator.Error; handle OOM as a
            // crash per the OOM contract instead of masking it as a connection
            // failure.
            const extra_headers = Headers8Bit.init(allocator, header_names, header_values, header_count) catch |err| bun.handleOom(err);
            defer extra_headers.deinit();

            defer host_slice.deinit();
            defer pathname_slice.deinit();
            defer client_protocol_slice.deinit();

            var proxy_host_slice: ?jsc.ZigString.Slice = null;
            defer if (proxy_host_slice) |s| s.deinit();
            if (proxy_host) |ph| proxy_host_slice = ph.toUTF8(allocator);

            var target_authorization_slice: ?jsc.ZigString.Slice = null;
            defer if (target_authorization_slice) |s| s.deinit();
            if (target_authorization) |ta| target_authorization_slice = ta.toUTF8(allocator);

            var unix_socket_path_slice: ?jsc.ZigString.Slice = null;
            defer if (unix_socket_path_slice) |s| s.deinit();
            if (unix_socket_path) |usp| unix_socket_path_slice = usp.toUTF8(allocator);

            const using_proxy = proxy_host != null;

            // Check if user provided a custom protocol for subprotocols validation
            var protocol_for_subprotocols: []const u8 = client_protocol_slice.slice();
            for (extra_headers.names(), extra_headers.values()) |name, value| {
                if (strings.eqlCaseInsensitiveASCII(name, "sec-websocket-protocol", true)) {
                    protocol_for_subprotocols = value;
                    break;
                }
            }

            const request_result = buildRequestBody(
                vm,
                pathname_slice.slice(),
                target_is_secure,
                host_slice.slice(),
                port,
                client_protocol_slice.slice(),
                extra_headers,
                if (target_authorization_slice) |s| s.slice() else null,
            ) catch return null;
            const body = request_result.body;

            // Build proxy state if using proxy
            // The CONNECT request is built using local variables for proxy_authorization and proxy_headers
            // which are freed immediately after building the request (not stored on the client).
            var proxy_state: ?WebSocketProxy = null;
            var connect_request: []u8 = &[_]u8{};
            if (using_proxy) {
                // Parse proxy authorization (temporary, freed after building CONNECT request)
                var proxy_auth_slice: ?[]const u8 = null;
                var proxy_auth_decoded: ?jsc.ZigString.Slice = null;
                defer if (proxy_auth_decoded) |s| s.deinit();

                if (proxy_authorization) |auth| {
                    proxy_auth_decoded = auth.toUTF8(allocator);
                    proxy_auth_slice = proxy_auth_decoded.?.slice();
                }

                // Parse proxy headers (temporary, freed after building CONNECT request)
                var proxy_hdrs: ?Headers = null;
                defer if (proxy_hdrs) |*hdrs| hdrs.deinit();

                // Headers8Bit.init / toHeaders only return Allocator.Error;
                // OOM should crash, not silently become a connection failure.
                const proxy_extra_headers = Headers8Bit.init(allocator, proxy_header_names, proxy_header_values, proxy_header_count) catch |err| bun.handleOom(err);
                defer proxy_extra_headers.deinit();

                if (proxy_header_count > 0) {
                    proxy_hdrs = proxy_extra_headers.toHeaders(allocator) catch |err| bun.handleOom(err);
                }

                // Build CONNECT request (proxy_auth and proxy_hdrs are freed by defer after this).
                // buildConnectRequest only returns Allocator.Error; crash on OOM.
                connect_request = buildConnectRequest(
                    host_slice.slice(),
                    port,
                    proxy_auth_slice,
                    proxy_hdrs,
                ) catch |err| bun.handleOom(err);

                // Duplicate target_host (needed for SNI during TLS handshake).
                // allocator.dupe only returns Allocator.Error; crash on OOM.
                const target_host_dup = allocator.dupe(u8, host_slice.slice()) catch |err| bun.handleOom(err);

                proxy_state = WebSocketProxy.init(
                    target_host_dup,
                    // Use target_is_secure from C++, not ssl template parameter
                    // (ssl may be true for HTTPS proxy even with ws:// target)
                    target_is_secure,
                    body,
                );
            }

            var client = bun.new(HTTPClient, .{
                .ref_count = .init(),
                .tcp = .{ .socket = .{ .detached = {} } },
                .outgoing_websocket = websocket,
                .input_body_buf = if (using_proxy) connect_request else body,
                .state = .initializing,
                .proxy = proxy_state,
                .expected_accept = request_result.expected_accept,
                .subprotocols = brk: {
                    var subprotocols = bun.StringSet.init(bun.default_allocator);
                    var it = bun.http.HeaderValueIterator.init(protocol_for_subprotocols);
                    while (it.next()) |protocol| {
                        subprotocols.insert(protocol) catch |e| bun.handleOom(e);
                    }
                    break :brk subprotocols;
                },
            });

            // Store TLS config if provided (ownership transferred to client)
            client.ssl_config = ssl_config;

            const display_host_ = if (using_proxy) proxy_host_slice.?.slice() else host_slice.slice();
            const connect_port = if (using_proxy) proxy_port else port;

            client.poll_ref.ref(vm);
            const display_host = if (bun.FeatureFlags.hardcode_localhost_to_127_0_0_1 and strings.eqlComptime(display_host_, "localhost"))
                "127.0.0.1"
            else
                display_host_;

            // For TLS connections with custom SSLConfig (e.g., custom CA), create a per-connection
            // SSL context instead of using the shared context from C++. This is needed because:
            // - The shared context is created once with default settings (no custom CA)
            // - Custom CA certificates must be loaded at context creation time
            // - This applies to both direct wss:// and HTTPS proxy connections
            var connect_ctx: *uws.SocketContext = socket_ctx;

            log("connect: ssl={}, has_ssl_config={}, using_proxy={}", .{ ssl, ssl_config != null, using_proxy });

            if (comptime ssl) {
                if (ssl_config) |config| {
                    if (config.requires_custom_request_ctx) {
                        const ctx_opts = config.asUSocketsForClientVerification();

                        var err: uws.create_bun_socket_error_t = .none;
                        if (uws.SocketContext.createSSLContext(
                            vm.uwsLoop(),
                            @sizeOf(usize),
                            ctx_opts,
                            &err,
                        )) |custom_ctx| {
                            // Configure the custom context with the same callbacks as the shared context
                            Socket.configure(
                                custom_ctx,
                                true,
                                *HTTPClient,
                                struct {
                                    pub const onOpen = handleOpen;
                                    pub const onClose = handleClose;
                                    pub const onData = handleData;
                                    pub const onWritable = handleWritable;
                                    pub const onTimeout = handleTimeout;
                                    pub const onLongTimeout = handleTimeout;
                                    pub const onConnectError = handleConnectError;
                                    pub const onEnd = handleEnd;
                                    pub const onHandshake = handleHandshake;
                                },
                            );
                            client.custom_ssl_ctx = custom_ctx;
                            connect_ctx = custom_ctx;
                            log("Created custom SSL context for TLS connection with custom CA", .{});
                        } else {
                            // Failed to create custom context, fall back to shared context
                            // The connection may still work if the CA isn't needed
                            log("Failed to create custom SSL context: {s}", .{@tagName(err)});
                        }
                    }
                }
            }

            // Unix domain socket path (ws+unix:// / wss+unix://)
            if (unix_socket_path_slice) |usp| {
                if (Socket.connectUnixAnon(
                    usp.slice(),
                    connect_ctx,
                    client,
                    false,
                )) |socket| {
                    client.tcp = socket;
                    if (client.state == .failed) {
                        client.deref();
                        return null;
                    }
                    bun.analytics.Features.WebSocket += 1;

                    if (comptime ssl) {
                        // SNI uses the URL host (defaulted to "localhost" in
                        // C++ when absent), mirroring the TCP path below. A
                        // user-supplied Host header does NOT affect SNI; use
                        // `tls: { checkServerIdentity }` or put the hostname
                        // in the URL (wss+unix://name/path) to verify against
                        // a specific certificate name.
                        if (host_slice.slice().len > 0 and !strings.isIPAddress(host_slice.slice())) {
                            client.hostname = bun.default_allocator.dupeZ(u8, host_slice.slice()) catch "";
                        }
                    }

                    client.tcp.timeout(120);
                    client.state = .reading;
                    // +1 for cpp_websocket
                    client.ref();
                    return client;
                } else |_| {
                    client.deref();
                }
                return null;
            }

            if (Socket.connectPtr(
                display_host,
                connect_port,
                connect_ctx,
                HTTPClient,
                client,
                "tcp",
                false,
            )) |out| {
                // I don't think this case gets reached.
                if (out.state == .failed) {
                    client.deref();
                    return null;
                }
                bun.analytics.Features.WebSocket += 1;

                if (comptime ssl) {
                    // SNI for the outer TLS socket must use the host we actually
                    // dialed. For HTTPS proxy connections, that's the proxy host,
                    // not the wss:// target.
                    if (!strings.isIPAddress(display_host_)) {
                        out.hostname = bun.default_allocator.dupeZ(u8, display_host_) catch "";
                    }
                }

                out.tcp.timeout(120);
                out.state = .reading;
                // +1 for cpp_websocket
                out.ref();
                return out;
            } else |_| {
                client.deref();
            }

            return null;
        }

        pub fn clearInput(this: *HTTPClient) void {
            if (this.input_body_buf.len > 0) bun.default_allocator.free(this.input_body_buf);
            this.input_body_buf.len = 0;
        }
        pub fn clearData(this: *HTTPClient) void {
            this.poll_ref.unref(jsc.VirtualMachine.get());

            this.subprotocols.clearAndFree();
            this.clearInput();
            this.body.clearAndFree(bun.default_allocator);

            if (this.hostname.len > 0) {
                bun.default_allocator.free(this.hostname);
                this.hostname = "";
            }

            // Clean up proxy state. Null the field and detach the tunnel's
            // back-reference before deinit so that SSLWrapper shutdown callbacks
            // cannot re-enter clearData() while the proxy is still reachable.
            if (this.proxy != null) {
                var proxy = this.proxy.?;
                this.proxy = null;
                if (proxy.getTunnel()) |tunnel| {
                    tunnel.detachUpgradeClient();
                }
                proxy.deinit();
            }
            if (this.ssl_config) |config| {
                config.deinit();
                bun.default_allocator.destroy(config);
                this.ssl_config = null;
            }
            if (this.custom_ssl_ctx) |ctx| {
                ctx.deinit(ssl);
                this.custom_ssl_ctx = null;
            }
        }
        pub fn cancel(this: *HTTPClient) callconv(.c) void {
            this.clearData();

            // Either of the below two operations - closing the TCP socket or clearing the C++ reference could trigger a deref
            // Therefore, we need to make sure the `this` pointer is valid until the end of the function.
            this.ref();
            defer this.deref();

            // The C++ end of the socket is no longer holding a reference to this, so we must clear it.
            if (this.outgoing_websocket != null) {
                this.outgoing_websocket = null;
                this.deref();
            }

            // no need to be .failure we still wanna to send pending SSL buffer + close_notify
            if (comptime ssl) {
                this.tcp.close(.normal);
            } else {
                this.tcp.close(.failure);
            }
        }

        pub fn fail(this: *HTTPClient, code: ErrorCode) void {
            log("onFail: {s}", .{@tagName(code)});
            jsc.markBinding(@src());
            this.dispatchAbruptClose(code);

            if (comptime ssl) {
                this.tcp.close(.normal);
            } else {
                this.tcp.close(.failure);
            }
        }

        fn dispatchAbruptClose(this: *HTTPClient, code: ErrorCode) void {
            if (this.outgoing_websocket) |ws| {
                this.outgoing_websocket = null;
                ws.didAbruptClose(code);
                this.deref();
            }
        }

        pub fn handleClose(this: *HTTPClient, _: Socket, _: c_int, _: ?*anyopaque) void {
            log("onClose", .{});
            jsc.markBinding(@src());

            // If a non-101 response body was mid-accumulation when the peer
            // reset the socket, flush whatever arrived before tearing down
            // — the peer may RST instead of FIN, so `handleEnd` never fires
            // and the `unexpected-response` consumer would otherwise see
            // the close event with no body at all. Do this BEFORE
            // `clearData()` frees `this.body`.
            flush: {
                switch (this.deferred_handshake) {
                    .none => break :flush,
                    .waiting_for_length, .waiting_for_eof => {},
                }
                this.deferred_handshake = .none;
                if (this.body.items.len == 0) break :flush;
                this.flushDeferredHandshakeAndProcess(this.body.items);
                // flushDeferredHandshakeAndProcess → processResponse →
                // terminate for the non-101 status: `outgoing_websocket`
                // is null by the time we fall through, so
                // `dispatchAbruptClose` below becomes a no-op.
            }

            this.clearData();
            this.tcp.detach();
            this.dispatchAbruptClose(ErrorCode.ended);

            this.deref();
        }

        pub fn terminate(this: *HTTPClient, code: ErrorCode) void {
            // If a non-101 response body was being accumulated when the
            // transport ended cleanly (peer close), flush the deferred
            // handshake first so the `unexpected-response` listener sees
            // what the server actually delivered. `handleEnd` does this
            // for the plain-TCP path, but the TLS-tunnel path
            // (`WebSocketProxyTunnel.onClose`) calls `terminate` directly
            // without going through `handleEnd`, so the flush must live
            // here too.
            if (code == ErrorCode.ended) {
                switch (this.deferred_handshake) {
                    .none => {},
                    .waiting_for_length, .waiting_for_eof => {
                        this.deferred_handshake = .none;
                        if (this.body.items.len > 0) {
                            this.flushDeferredHandshakeAndProcess(this.body.items);
                            return;
                        }
                    },
                }
            }
            this.fail(code);

            // We cannot access the pointer after fail is called.
        }

        pub fn handleHandshake(this: *HTTPClient, socket: Socket, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
            log("onHandshake({d}) ssl_error.error_no={d}", .{ success, ssl_error.error_no });

            const handshake_success = if (success == 1) true else false;
            var reject_unauthorized = false;
            if (this.outgoing_websocket) |ws| {
                reject_unauthorized = ws.rejectUnauthorized();
            }

            if (handshake_success) {
                // handshake completed but we may have ssl errors
                if (reject_unauthorized) {
                    // only reject the connection if reject_unauthorized == true
                    if (ssl_error.error_no != 0) {
                        log("TLS handshake failed: ssl_error={d}, has_custom_ctx={}", .{ ssl_error.error_no, this.custom_ssl_ctx != null });
                        this.fail(ErrorCode.tls_handshake_failed);
                        return;
                    }
                    const ssl_ptr = @as(*BoringSSL.c.SSL, @ptrCast(socket.getNativeHandle()));
                    if (BoringSSL.c.SSL_get_servername(ssl_ptr, 0)) |servername| {
                        const hostname = servername[0..bun.len(servername)];
                        if (!BoringSSL.checkServerIdentity(ssl_ptr, hostname)) {
                            this.fail(ErrorCode.tls_handshake_failed);
                        }
                    }
                }
            } else {
                // if we are here is because server rejected us, and the error_no is the cause of this
                // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
                this.fail(ErrorCode.tls_handshake_failed);
            }
        }

        pub fn handleOpen(this: *HTTPClient, socket: Socket) void {
            log("onOpen", .{});
            this.tcp = socket;

            bun.assert(this.input_body_buf.len > 0);
            bun.assert(this.to_send.len == 0);

            if (comptime ssl) {
                if (this.hostname.len > 0) {
                    if (socket.getNativeHandle()) |handle| {
                        handle.configureHTTPClient(this.hostname);
                    }
                    bun.default_allocator.free(this.hostname);
                    this.hostname = "";
                }
            }

            // If using proxy, set state to proxy_handshake
            if (this.proxy != null) {
                this.state = .proxy_handshake;
            }

            const wrote = socket.write(this.input_body_buf);
            if (wrote < 0) {
                this.terminate(ErrorCode.failed_to_write);
                return;
            }

            this.to_send = this.input_body_buf[@as(usize, @intCast(wrote))..];
        }

        pub fn isSameSocket(this: *HTTPClient, socket: Socket) bool {
            return socket.socket.eq(this.tcp.socket);
        }

        pub fn handleData(this: *HTTPClient, socket: Socket, data: []const u8) void {
            log("onData", .{});

            // For tunnel mode after successful upgrade, forward all data to the tunnel
            // The tunnel will decrypt and pass to the WebSocket client
            if (this.state == .done) {
                if (this.proxy) |*p| {
                    if (p.getTunnel()) |tunnel| {
                        // Ref the tunnel to keep it alive during this call
                        // (in case the WebSocket client closes during processing)
                        tunnel.ref();
                        defer tunnel.deref();
                        tunnel.receive(data);
                    }
                }
                return;
            }

            if (this.outgoing_websocket == null) {
                this.state = .failed;
                this.clearData();
                socket.close(.failure);
                return;
            }
            this.ref();
            defer this.deref();

            bun.assert(this.isSameSocket(socket));

            if (comptime Environment.allow_assert)
                bun.assert(!socket.isShutdown());

            // Handle proxy handshake response
            if (this.state == .proxy_handshake) {
                this.handleProxyResponse(socket, data);
                return;
            }

            // Route through proxy tunnel if TLS handshake is in progress or complete
            if (this.proxy) |*p| {
                if (p.getTunnel()) |tunnel| {
                    tunnel.receive(data);
                    return;
                }
            }

            // If we're in the middle of buffering a non-101 response body
            // (Content-Length > what arrived with the headers, or no
            // Content-Length → read until EOF), keep appending and check
            // for completion. See the deferred_handshake comment.
            if (this.appendDeferredHandshakeBody(data)) return;

            var body = data;
            if (this.body.items.len > 0) {
                bun.handleOom(this.body.appendSlice(bun.default_allocator, data));
                body = this.body.items;
            }

            const response = PicoHTTP.Response.parse(body, &this.headers_buf) catch |err| {
                switch (err) {
                    error.Malformed_HTTP_Response => {
                        this.terminate(ErrorCode.invalid_response);
                        return;
                    },
                    error.ShortRead => {
                        if (this.body.items.len == 0) {
                            bun.handleOom(this.body.appendSlice(bun.default_allocator, data));
                        }
                        return;
                    },
                }
            };

            this.processWebSocketUpgradeResponse(response, body);
        }

        /// Maximum bytes we'll buffer for a non-101 response body before
        /// bailing out. Real error pages (workerd restart text, JSON API
        /// errors, HTML) fit comfortably under this; the cap exists so a
        /// malicious or misbehaving server can't make us accumulate
        /// unbounded data — either via a giant `Content-Length` header
        /// (saturating the `+|` add and never satisfying the length
        /// check) or a keep-alive connection that never closes after a
        /// no-Content-Length response.
        const MAX_NON_101_BODY: usize = 64 * 1024 * 1024;

        /// Returns true if `data` was consumed as part of a deferred non-101
        /// handshake body (and the caller should stop processing this read).
        /// Enforces `MAX_NON_101_BODY` so neither a giant Content-Length
        /// nor a never-closing no-Content-Length stream can grow `this.body`
        /// without bound.
        fn appendDeferredHandshakeBody(this: *HTTPClient, data: []const u8) bool {
            switch (this.deferred_handshake) {
                .none => return false,
                .waiting_for_length => |target_len| {
                    // `target_len` was bounded to `head_len +
                    // MAX_NON_101_BODY` upstream in
                    // `processWebSocketUpgradeResponse` (which rejects
                    // Content-Length > MAX_NON_101_BODY), so the
                    // accumulated buffer can never exceed that limit.
                    //
                    // If this read would carry us past `target_len`, take
                    // only enough bytes to fill the declared body. The
                    // rest belong to the next pipelined response or are
                    // trailing garbage — same as the single-chunk fast
                    // path in `processWebSocketUpgradeResponse` which
                    // truncates via `body[0..target_len]` before
                    // dispatching.
                    const available = target_len - this.body.items.len;
                    const take = @min(available, data.len);
                    bun.handleOom(this.body.appendSlice(bun.default_allocator, data[0..take]));
                    if (this.body.items.len >= target_len) {
                        const truncated = this.body.items[0..target_len];
                        this.deferred_handshake = .none;
                        this.flushDeferredHandshakeAndProcess(truncated);
                    }
                    return true;
                },
                .waiting_for_eof => {
                    if (this.body.items.len +| data.len > MAX_NON_101_BODY) {
                        this.deferred_handshake = .none;
                        this.terminate(ErrorCode.expected_101_status_code);
                        return true;
                    }
                    bun.handleOom(this.body.appendSlice(bun.default_allocator, data));
                    return true;
                },
            }
        }

        // Scan the response headers for Content-Length. Returns the parsed
        // value or null if the header is absent or unparseable.
        fn findContentLength(response: PicoHTTP.Response) ?usize {
            for (response.headers.list) |h| {
                if (h.name.len == "Content-Length".len and strings.eqlCaseInsensitiveASCII(h.name, "Content-Length", false)) {
                    return std.fmt.parseInt(usize, std.mem.trim(u8, h.value, " \t"), 10) catch null;
                }
            }
            return null;
        }

        // Shared between the plain-TCP and proxy-tunnel paths.
        //
        // For non-101 responses whose body straddles multiple TCP reads, we
        // defer the handshake dispatch until we have the complete body so
        // the `unexpected-response` listener sees the full payload instead
        // of a truncated prefix. See `deferred_handshake`.
        //
        // Once ready to dispatch: the 'handshake' event into JS is
        // synchronous. JS in the listener can call `ws.close()` →
        // `terminate()` → `clearData()`, which frees `this.body` out from
        // under us — and `body` / `response.headers.list` point into that
        // same allocation in the multi-chunk accumulation path. To keep
        // the post-dispatch `processResponse` call safe without duplicating
        // + re-parsing the response, move `this.body` out into a local so
        // `clearData()` finds an empty ArrayList and the backing bytes
        // outlive the dispatch.
        //
        // In the single-chunk fast path `body` points into `data` (owned by
        // uSockets for the rest of `onData`) and `this.body` is already
        // empty, so the transfer is a no-op.
        fn processWebSocketUpgradeResponse(this: *HTTPClient, response: PicoHTTP.Response, body: []const u8) void {
            const head_len: usize = @intCast(response.bytes_read);
            const status_code = std.math.cast(u16, response.status_code) orelse 0;

            const ws = this.outgoing_websocket orelse {
                this.processResponse(response, body[head_len..]);
                return;
            };

            if (status_code != 101) {
                // Check if the full response body is present. If not, defer
                // the dispatch until handleData / handleEnd flushes a
                // complete buffer.
                const content_length = findContentLength(response);
                if (content_length) |cl| {
                    // Cap the Content-Length we'll buffer — a malicious
                    // server could otherwise send `Content-Length:
                    // 18446744073709551615` and make us accumulate every
                    // byte of every subsequent TCP read forever
                    // (`body.items.len >= usize_max` never holds,
                    // `bun.handleOom` panics on allocation failure).
                    // Reject as an invalid response so we surface a
                    // normal `expected_101_status_code` error instead of
                    // crashing.
                    if (cl > MAX_NON_101_BODY) {
                        this.terminate(ErrorCode.expected_101_status_code);
                        return;
                    }
                    const target_len = head_len + cl;
                    if (body.len < target_len) {
                        // Make sure `this.body` owns the accumulated bytes
                        // so subsequent handleData calls can append to it.
                        // In the single-chunk case body points at `data`;
                        // copy it into this.body.
                        if (body.ptr != this.body.items.ptr) {
                            bun.handleOom(this.body.appendSlice(bun.default_allocator, body));
                        }
                        this.deferred_handshake = .{ .waiting_for_length = target_len };
                        return;
                    }
                    // Truncate at head_len + Content-Length — discard any
                    // bytes beyond the declared body length (they belong
                    // to the next pipelined response, or are garbage).
                    this.flushDeferredHandshakeAndProcess(body[0..target_len]);
                    return;
                } else {
                    // No Content-Length — RFC 7230 §3.3.3: read until the
                    // peer closes the connection. Defer to handleEnd.
                    // handleData enforces MAX_NON_101_BODY so a keep-alive
                    // server that never closes can't buffer forever.
                    if (body.ptr != this.body.items.ptr) {
                        bun.handleOom(this.body.appendSlice(bun.default_allocator, body));
                    }
                    this.deferred_handshake = .waiting_for_eof;
                    return;
                }
            }

            // 101 fast path — dispatch with whatever body bytes are on hand
            // (post-header bytes are the first WebSocket frame, not HTTP
            // body — the shim drops them from the 'upgrade' response).
            this.dispatchHandshakeAndProcess(ws, response, body, head_len, status_code);
        }

        // Called from handleData / handleEnd once `buffer` holds the complete
        // accumulated (truncated to Content-Length, or read-until-EOF) response.
        // Re-parses the headers from the owned buffer, dispatches, then runs
        // processResponse (which will terminate for non-101).
        fn flushDeferredHandshakeAndProcess(this: *HTTPClient, buffer: []const u8) void {
            const response = PicoHTTP.Response.parse(buffer, &this.headers_buf) catch {
                this.terminate(ErrorCode.invalid_response);
                return;
            };
            const head_len: usize = @intCast(response.bytes_read);
            const status_code = std.math.cast(u16, response.status_code) orelse 0;
            const ws = this.outgoing_websocket orelse {
                this.processResponse(response, buffer[head_len..]);
                return;
            };
            this.dispatchHandshakeAndProcess(ws, response, buffer, head_len, status_code);
        }

        fn dispatchHandshakeAndProcess(
            this: *HTTPClient,
            ws: *CppWebSocket,
            response: PicoHTTP.Response,
            body: []const u8,
            head_len: usize,
            status_code: u16,
        ) void {
            // Keep `this` alive across the synchronous JS dispatch. JS in
            // the handshake listener can call `ws.terminate()` →
            // didAbruptClose → HTTPClient.terminate() → deinit, which would
            // free us mid-function. handleData / handleDecryptedData ref
            // around the whole parse loop, but handleEnd flushes deferred
            // bodies here directly — do an additional ref so the guard
            // holds regardless of caller.
            this.ref();
            defer this.deref();

            var owned_body = this.body;
            this.body = .{};
            defer owned_body.deinit(bun.default_allocator);

            var raw_headers: [128]CppWebSocket.RawHeader = undefined;
            for (response.headers.list, 0..) |h, i| {
                raw_headers[i] = .{
                    .name_ptr = h.name.ptr,
                    .name_len = h.name.len,
                    .value_ptr = h.value.ptr,
                    .value_len = h.value.len,
                };
            }

            // On 101 Switching Protocols, any bytes after the header block
            // are the first WebSocket frame from the peer — not HTTP body.
            // Node delivers them as the `head` buffer on its 'upgrade'
            // event and ws.js passes them to the protocol reader via
            // setSocket. Don't surface them to `'handshake'` listeners as
            // if they were HTTP body; only `processResponse` (below) hands
            // them to the connected WebSocket client as overflow.
            const handshake_body: []const u8 = if (status_code == 101) &.{} else body[head_len..];
            ws.didReceiveHandshakeResponse(status_code, response.status, raw_headers[0..response.headers.list.len], handshake_body);
            if (this.outgoing_websocket == null) return;
            this.processResponse(response, body[head_len..]);
        }

        fn handleProxyResponse(this: *HTTPClient, socket: Socket, data: []const u8) void {
            log("handleProxyResponse", .{});

            var body = data;
            if (this.body.items.len > 0) {
                bun.handleOom(this.body.appendSlice(bun.default_allocator, data));
                body = this.body.items;
            }

            // Check for HTTP 200 response from proxy
            const is_first = this.body.items.len == 0;
            const http_200 = "HTTP/1.1 200 ";
            const http_200_alt = "HTTP/1.0 200 ";
            if (is_first and body.len > http_200.len) {
                if (!strings.hasPrefixComptime(body, http_200) and !strings.hasPrefixComptime(body, http_200_alt)) {
                    // Proxy connection failed
                    this.terminate(ErrorCode.proxy_connect_failed);
                    return;
                }
            }

            // Parse the response to find the end of headers
            const response = PicoHTTP.Response.parse(body, &this.headers_buf) catch |err| {
                switch (err) {
                    error.Malformed_HTTP_Response => {
                        this.terminate(ErrorCode.invalid_response);
                        return;
                    },
                    error.ShortRead => {
                        if (this.body.items.len == 0) {
                            bun.handleOom(this.body.appendSlice(bun.default_allocator, data));
                        }
                        return;
                    },
                }
            };

            // Proxy returned non-200 status
            if (response.status_code != 200) {
                if (response.status_code == 407) {
                    this.terminate(ErrorCode.proxy_authentication_required);
                } else {
                    this.terminate(ErrorCode.proxy_connect_failed);
                }
                return;
            }

            // Proxy tunnel established
            log("Proxy tunnel established", .{});

            // Clear the body buffer for WebSocket handshake
            this.body.clearRetainingCapacity();

            const remain_buf = body[@as(usize, @intCast(response.bytes_read))..];

            // Safely unwrap proxy state - it must exist if we're in proxy_handshake state
            const p = if (this.proxy) |*proxy| proxy else {
                this.terminate(ErrorCode.proxy_tunnel_failed);
                return;
            };

            // For wss:// through proxy, we need to do TLS handshake inside the tunnel
            if (p.isTargetHttps()) {
                this.startProxyTLSHandshake(socket, remain_buf);
                return;
            }

            // For ws:// through proxy, send the WebSocket upgrade request
            this.state = .reading;

            // Free the CONNECT request buffer
            if (this.input_body_buf.len > 0) {
                bun.default_allocator.free(this.input_body_buf);
            }

            // Use the WebSocket upgrade request from proxy state
            this.input_body_buf = p.takeWebsocketRequestBuf();

            // Send the WebSocket upgrade request
            const wrote = socket.write(this.input_body_buf);
            if (wrote < 0) {
                this.terminate(ErrorCode.failed_to_write);
                return;
            }

            this.to_send = this.input_body_buf[@as(usize, @intCast(wrote))..];

            // If there's remaining data after the proxy response, process it
            if (remain_buf.len > 0) {
                this.handleData(socket, remain_buf);
            }
        }

        /// Start TLS handshake inside the proxy tunnel for wss:// connections
        fn startProxyTLSHandshake(this: *HTTPClient, socket: Socket, initial_data: []const u8) void {
            log("startProxyTLSHandshake", .{});

            // Safely unwrap proxy state - it must exist if we're called from handleProxyResponse
            const p = if (this.proxy) |*proxy| proxy else {
                this.terminate(ErrorCode.proxy_tunnel_failed);
                return;
            };

            // Get certificate verification setting
            const reject_unauthorized = if (this.outgoing_websocket) |ws| ws.rejectUnauthorized() else true;

            // Create proxy tunnel with all parameters
            const tunnel = WebSocketProxyTunnel.init(ssl, this, socket, p.getTargetHost(), reject_unauthorized) catch {
                this.terminate(ErrorCode.proxy_tunnel_failed);
                return;
            };

            // Use ssl_config if available, otherwise use defaults
            const ssl_options: SSLConfig = if (this.ssl_config) |config| config.* else SSLConfig{
                .reject_unauthorized = 0, // We verify manually
                .request_cert = 1,
            };

            // Start TLS handshake
            tunnel.start(ssl_options, initial_data) catch {
                tunnel.deref();
                this.terminate(ErrorCode.proxy_tunnel_failed);
                return;
            };

            p.setTunnel(tunnel);
            this.state = .proxy_tls_handshake;
        }

        /// Called by WebSocketProxyTunnel when TLS handshake completes successfully
        pub fn onProxyTLSHandshakeComplete(this: *HTTPClient) void {
            log("onProxyTLSHandshakeComplete", .{});

            // TLS handshake done - send WebSocket upgrade request through tunnel
            this.state = .reading;

            // Free the CONNECT request buffer
            if (this.input_body_buf.len > 0) {
                bun.default_allocator.free(this.input_body_buf);
                this.input_body_buf = &[_]u8{};
            }

            // Safely unwrap proxy state and send through the tunnel
            const p = if (this.proxy) |*proxy| proxy else {
                this.terminate(ErrorCode.proxy_tunnel_failed);
                return;
            };

            // Take the WebSocket upgrade request from proxy state (transfers ownership).
            // Store it in input_body_buf so handleWritable can retry on drain.
            this.input_body_buf = p.takeWebsocketRequestBuf();
            if (this.input_body_buf.len == 0) {
                this.terminate(ErrorCode.failed_to_write);
                return;
            }

            // Send through the tunnel (will be encrypted). Buffer any unwritten
            // portion in to_send so handleWritable retries when the socket drains.
            if (p.getTunnel()) |tunnel| {
                const wrote = tunnel.write(this.input_body_buf) catch {
                    this.terminate(ErrorCode.failed_to_write);
                    return;
                };
                this.to_send = this.input_body_buf[wrote..];
            } else {
                this.terminate(ErrorCode.proxy_tunnel_failed);
            }
        }

        /// Called by WebSocketProxyTunnel with decrypted data from the TLS tunnel
        pub fn handleDecryptedData(this: *HTTPClient, data: []const u8) void {
            log("handleDecryptedData: {} bytes", .{data.len});

            // Keep `this` alive through the synchronous JS dispatch in
            // processWebSocketUpgradeResponse — JS may drop the last ref on
            // us during that call (ws.close()).
            this.ref();
            defer this.deref();

            // Same deferred-body flushing as plain handleData.
            if (this.appendDeferredHandshakeBody(data)) return;

            // Process as if it came directly from the socket
            var body = data;
            if (this.body.items.len > 0) {
                bun.handleOom(this.body.appendSlice(bun.default_allocator, data));
                body = this.body.items;
            }

            const response = PicoHTTP.Response.parse(body, &this.headers_buf) catch |err| {
                switch (err) {
                    error.Malformed_HTTP_Response => {
                        this.terminate(ErrorCode.invalid_response);
                        return;
                    },
                    error.ShortRead => {
                        if (this.body.items.len == 0) {
                            bun.handleOom(this.body.appendSlice(bun.default_allocator, data));
                        }
                        return;
                    },
                }
            };

            this.processWebSocketUpgradeResponse(response, body);
        }

        pub fn handleEnd(this: *HTTPClient, _: Socket) void {
            log("onEnd", .{});
            // If we were waiting for the peer to close before dispatching a
            // non-101 response body (Content-Length absent), flush now with
            // whatever arrived. waiting_for_length also falls through here
            // when the peer closes before sending Content-Length bytes —
            // dispatch with the truncated body so the consumer sees what
            // the server actually delivered.
            switch (this.deferred_handshake) {
                .none => {},
                .waiting_for_length, .waiting_for_eof => {
                    this.deferred_handshake = .none;
                    if (this.body.items.len > 0) {
                        this.flushDeferredHandshakeAndProcess(this.body.items);
                        return;
                    }
                },
            }
            this.terminate(ErrorCode.ended);
        }

        pub fn processResponse(this: *HTTPClient, response: PicoHTTP.Response, remain_buf: []const u8) void {
            var upgrade_header = PicoHTTP.Header{ .name = "", .value = "" };
            var connection_header = PicoHTTP.Header{ .name = "", .value = "" };
            var websocket_accept_header = PicoHTTP.Header{ .name = "", .value = "" };
            var protocol_header_seen = false;

            // var visited_version = false;
            var deflate_result = DeflateNegotiationResult{};

            if (response.status_code != 101) {
                this.terminate(ErrorCode.expected_101_status_code);
                return;
            }

            for (response.headers.list) |header| {
                switch (header.name.len) {
                    "Connection".len => {
                        if (connection_header.name.len == 0 and strings.eqlCaseInsensitiveASCII(header.name, "Connection", false)) {
                            connection_header = header;
                        }
                    },
                    "Upgrade".len => {
                        if (upgrade_header.name.len == 0 and strings.eqlCaseInsensitiveASCII(header.name, "Upgrade", false)) {
                            upgrade_header = header;
                        }
                    },
                    "Sec-WebSocket-Version".len => {
                        if (strings.eqlCaseInsensitiveASCII(header.name, "Sec-WebSocket-Version", false)) {
                            if (!strings.eqlComptimeIgnoreLen(header.value, "13")) {
                                this.terminate(ErrorCode.invalid_websocket_version);
                                return;
                            }
                        }
                    },
                    "Sec-WebSocket-Accept".len => {
                        if (websocket_accept_header.name.len == 0 and strings.eqlCaseInsensitiveASCII(header.name, "Sec-WebSocket-Accept", false)) {
                            websocket_accept_header = header;
                        }
                    },
                    "Sec-WebSocket-Protocol".len => {
                        if (strings.eqlCaseInsensitiveASCII(header.name, "Sec-WebSocket-Protocol", false)) {
                            const valid = brk: {
                                // Can't have multiple protocol headers in the response.
                                if (protocol_header_seen) break :brk false;

                                protocol_header_seen = true;

                                var iterator = bun.http.HeaderValueIterator.init(header.value);

                                const protocol = iterator.next()
                                    // Can't be empty.
                                    orelse break :brk false;

                                // Can't have multiple protocols.
                                if (iterator.next() != null) break :brk false;

                                // Protocol must be in the list of allowed protocols.
                                if (!this.subprotocols.contains(protocol)) break :brk false;

                                if (this.outgoing_websocket) |ws| {
                                    var protocol_str = bun.String.cloneLatin1(protocol);
                                    defer protocol_str.deref();
                                    ws.setProtocol(&protocol_str);
                                }
                                break :brk true;
                            };

                            if (!valid) {
                                this.terminate(ErrorCode.mismatch_client_protocol);
                                return;
                            }
                        }
                    },
                    "Sec-WebSocket-Extensions".len => {
                        if (strings.eqlCaseInsensitiveASCII(header.name, "Sec-WebSocket-Extensions", false)) {
                            // This is a simplified parser. A full parser would handle multiple extensions and quoted values.
                            var it = std.mem.splitScalar(u8, header.value, ',');
                            while (it.next()) |ext_str| {
                                var ext_it = std.mem.splitScalar(u8, std.mem.trim(u8, ext_str, " \t"), ';');
                                const ext_name = std.mem.trim(u8, ext_it.next() orelse "", " \t");
                                if (strings.eqlComptime(ext_name, "permessage-deflate")) {
                                    deflate_result.enabled = true;
                                    while (ext_it.next()) |param_str| {
                                        var param_it = std.mem.splitScalar(u8, std.mem.trim(u8, param_str, " \t"), '=');
                                        const key = std.mem.trim(u8, param_it.next() orelse "", " \t");
                                        const value = std.mem.trim(u8, param_it.next() orelse "", " \t");

                                        if (strings.eqlComptime(key, "server_no_context_takeover")) {
                                            deflate_result.params.server_no_context_takeover = 1;
                                        } else if (strings.eqlComptime(key, "client_no_context_takeover")) {
                                            deflate_result.params.client_no_context_takeover = 1;
                                        } else if (strings.eqlComptime(key, "server_max_window_bits")) {
                                            if (value.len > 0) {
                                                // Remove quotes if present
                                                const trimmed_value = if (value.len >= 2 and value[0] == '"' and value[value.len - 1] == '"')
                                                    value[1 .. value.len - 1]
                                                else
                                                    value;

                                                if (std.fmt.parseInt(u8, trimmed_value, 10) catch null) |bits| {
                                                    if (bits >= WebSocketDeflate.Params.MIN_WINDOW_BITS and bits <= WebSocketDeflate.Params.MAX_WINDOW_BITS) {
                                                        deflate_result.params.server_max_window_bits = bits;
                                                    }
                                                }
                                            }
                                        } else if (strings.eqlComptime(key, "client_max_window_bits")) {
                                            if (value.len > 0) {
                                                // Remove quotes if present
                                                const trimmed_value = if (value.len >= 2 and value[0] == '"' and value[value.len - 1] == '"')
                                                    value[1 .. value.len - 1]
                                                else
                                                    value;

                                                if (std.fmt.parseInt(u8, trimmed_value, 10) catch null) |bits| {
                                                    if (bits >= WebSocketDeflate.Params.MIN_WINDOW_BITS and bits <= WebSocketDeflate.Params.MAX_WINDOW_BITS) {
                                                        deflate_result.params.client_max_window_bits = bits;
                                                    }
                                                }
                                            } else {
                                                // client_max_window_bits without value means use default (15)
                                                deflate_result.params.client_max_window_bits = 15;
                                            }
                                        }
                                    }
                                    break; // Found and parsed permessage-deflate, stop.
                                }
                            }
                        }
                    },
                    else => {},
                }
            }

            // if (!visited_version) {
            //     this.terminate(ErrorCode.invalid_websocket_version);
            //     return;
            // }

            if (@min(upgrade_header.name.len, upgrade_header.value.len) == 0) {
                this.terminate(ErrorCode.missing_upgrade_header);
                return;
            }

            if (@min(connection_header.name.len, connection_header.value.len) == 0) {
                this.terminate(ErrorCode.missing_connection_header);
                return;
            }

            if (@min(websocket_accept_header.name.len, websocket_accept_header.value.len) == 0) {
                this.terminate(ErrorCode.missing_websocket_accept_header);
                return;
            }

            if (!strings.eqlCaseInsensitiveASCII(connection_header.value, "Upgrade", true)) {
                this.terminate(ErrorCode.invalid_connection_header);
                return;
            }

            if (!strings.eqlCaseInsensitiveASCII(upgrade_header.value, "websocket", true)) {
                this.terminate(ErrorCode.invalid_upgrade_header);
                return;
            }

            if (!std.mem.eql(u8, websocket_accept_header.value, &this.expected_accept)) {
                this.terminate(ErrorCode.mismatch_websocket_accept_header);
                return;
            }

            const overflow_len = remain_buf.len;
            var overflow: []u8 = &.{};
            if (overflow_len > 0) {
                overflow = bun.default_allocator.alloc(u8, overflow_len) catch {
                    this.terminate(ErrorCode.invalid_response);
                    return;
                };
                @memcpy(overflow, remain_buf);
            }

            // Check if we're using a proxy tunnel (wss:// through HTTP proxy)
            if (this.proxy) |*p| {
                if (p.getTunnel()) |tunnel| {
                    // wss:// through HTTP proxy: use tunnel mode
                    // For tunnel mode, the upgrade client STAYS ALIVE to forward socket data to the tunnel.
                    // The socket continues to call handleData on the upgrade client, which forwards to tunnel.
                    // The tunnel forwards decrypted data to the WebSocket client.
                    jsc.markBinding(@src());
                    if (!this.tcp.isClosed() and this.outgoing_websocket != null) {
                        this.tcp.timeout(0);
                        log("onDidConnect (tunnel mode)", .{});

                        // Take the outgoing_websocket reference but DON'T deref the upgrade client.
                        // We need to keep it alive to forward socket data to the tunnel.
                        // The upgrade client will be cleaned up when the socket closes.
                        const ws = bun.take(&this.outgoing_websocket).?;

                        // Create the WebSocket client with the tunnel
                        ws.didConnectWithTunnel(tunnel, overflow.ptr, overflow.len, if (deflate_result.enabled) &deflate_result.params else null);

                        // Switch state to connected - handleData will forward to tunnel
                        this.state = .done;
                    } else if (this.tcp.isClosed()) {
                        this.terminate(ErrorCode.cancel);
                    } else if (this.outgoing_websocket == null) {
                        this.tcp.close(.failure);
                    }
                    return;
                }
            }

            // Normal (non-tunnel) mode - original code path
            // Don't destroy custom SSL context yet - the socket still needs it!
            // Save it before clearData() would destroy it, then transfer ownership to the WebSocket client.
            const saved_custom_ssl_ctx = this.custom_ssl_ctx;
            this.custom_ssl_ctx = null; // Prevent clearData from destroying it
            this.clearData();
            jsc.markBinding(@src());
            if (!this.tcp.isClosed() and this.outgoing_websocket != null) {
                this.tcp.timeout(0);
                log("onDidConnect", .{});

                // Once for the outgoing_websocket.
                defer this.deref();
                const ws = bun.take(&this.outgoing_websocket).?;
                const socket = this.tcp;

                // Normal mode: pass socket directly to WebSocket client
                this.tcp.detach();
                // Once again for the TCP socket.
                defer this.deref();
                if (socket.socket.get()) |native_socket| {
                    ws.didConnect(native_socket, overflow.ptr, overflow.len, if (deflate_result.enabled) &deflate_result.params else null, saved_custom_ssl_ctx);
                } else {
                    this.terminate(ErrorCode.failed_to_connect);
                }
            } else if (this.tcp.isClosed()) {
                this.terminate(ErrorCode.cancel);
            } else if (this.outgoing_websocket == null) {
                this.tcp.close(.failure);
            }
        }

        pub fn memoryCost(this: *HTTPClient) callconv(.c) usize {
            var cost: usize = @sizeOf(HTTPClient);
            cost += this.body.capacity;
            cost += this.to_send.len;
            return cost;
        }

        pub fn handleWritable(
            this: *HTTPClient,
            socket: Socket,
        ) void {
            bun.assert(this.isSameSocket(socket));

            // Forward to proxy tunnel if active
            if (this.proxy) |*p| {
                if (p.getTunnel()) |tunnel| {
                    tunnel.onWritable();
                    // In .done state (after WebSocket upgrade), just handle tunnel writes
                    if (this.state == .done) return;

                    // Flush any unwritten upgrade request bytes through the tunnel
                    if (this.to_send.len == 0) return;
                    this.ref();
                    defer this.deref();
                    const wrote = tunnel.write(this.to_send) catch {
                        this.terminate(ErrorCode.failed_to_write);
                        return;
                    };
                    this.to_send = this.to_send[@min(wrote, this.to_send.len)..];
                    return;
                }
            }

            if (this.to_send.len == 0)
                return;

            this.ref();
            defer this.deref();

            const wrote = socket.write(this.to_send);
            if (wrote < 0) {
                this.terminate(ErrorCode.failed_to_write);
                return;
            }
            this.to_send = this.to_send[@min(@as(usize, @intCast(wrote)), this.to_send.len)..];
        }
        pub fn handleTimeout(
            this: *HTTPClient,
            _: Socket,
        ) void {
            this.terminate(ErrorCode.timeout);
        }

        // In theory, this could be called immediately
        // In that case, we set `state` to `failed` and return, expecting the parent to call `destroy`.
        pub fn handleConnectError(this: *HTTPClient, _: Socket, _: c_int) void {
            this.tcp.detach();

            // For the TCP socket.
            defer this.deref();

            if (this.state == .reading) {
                this.terminate(ErrorCode.failed_to_connect);
            } else {
                this.state = .failed;
            }
        }

        pub fn exportAll() void {
            comptime {
                const name = if (ssl) "WebSocketHTTPSClient" else "WebSocketHTTPClient";
                @export(&connect, .{
                    .name = "Bun__" ++ name ++ "__connect",
                });
                @export(&cancel, .{
                    .name = "Bun__" ++ name ++ "__cancel",
                });
                @export(&register, .{
                    .name = "Bun__" ++ name ++ "__register",
                });
                @export(&memoryCost, .{
                    .name = "Bun__" ++ name ++ "__memoryCost",
                });
            }
        }
    };
}

/// Decodes an array of BunString header name/value pairs to UTF-8 up front.
///
/// The BunString values may be backed by 8-bit Latin1 or 16-bit UTF-16
/// `WTFStringImpl`s. Calling `.slice()` on a ZigString wrapper that was built
/// from a non-ASCII WTFStringImpl returns raw Latin1 or UTF-16 code units,
/// which then corrupts the HTTP upgrade request and can cause heap corruption.
///
/// Using `bun.String.toUTF8(allocator)` either borrows the 8-bit ASCII backing
/// (no allocation) or allocates a UTF-8 copy. The resulting slices are stored
/// here so buildRequestBody / buildConnectRequest can index them by []const u8.
const Headers8Bit = struct {
    slices: []jsc.ZigString.Slice,
    name_slices: [][]const u8,
    value_slices: [][]const u8,
    allocator: std.mem.Allocator,

    pub fn init(
        allocator: std.mem.Allocator,
        names_ptr: ?[*]const bun.String,
        values_ptr: ?[*]const bun.String,
        len: usize,
    ) std.mem.Allocator.Error!Headers8Bit {
        if (len == 0) {
            return .{
                .slices = &.{},
                .name_slices = &.{},
                .value_slices = &.{},
                .allocator = allocator,
            };
        }
        const names_in = names_ptr.?[0..len];
        const values_in = values_ptr.?[0..len];

        const slices = try allocator.alloc(jsc.ZigString.Slice, len * 2);
        errdefer allocator.free(slices);

        const name_slices = try allocator.alloc([]const u8, len);
        errdefer allocator.free(name_slices);

        const value_slices = try allocator.alloc([]const u8, len);
        errdefer allocator.free(value_slices);

        var decoded: usize = 0;
        errdefer {
            var j: usize = 0;
            while (j < decoded) : (j += 1) slices[j].deinit();
        }
        var i: usize = 0;
        while (i < len) : (i += 1) {
            slices[i * 2] = names_in[i].toUTF8(allocator);
            decoded += 1;
            slices[i * 2 + 1] = values_in[i].toUTF8(allocator);
            decoded += 1;
            name_slices[i] = slices[i * 2].slice();
            value_slices[i] = slices[i * 2 + 1].slice();
        }

        return .{
            .slices = slices,
            .name_slices = name_slices,
            .value_slices = value_slices,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: Headers8Bit) void {
        for (self.slices) |*s| s.deinit();
        if (self.slices.len > 0) {
            self.allocator.free(self.slices);
            self.allocator.free(self.name_slices);
            self.allocator.free(self.value_slices);
        }
    }

    pub fn names(self: Headers8Bit) []const []const u8 {
        return self.name_slices;
    }

    pub fn values(self: Headers8Bit) []const []const u8 {
        return self.value_slices;
    }

    /// Convert Headers8Bit to bun.http.Headers
    pub fn toHeaders(self: Headers8Bit, allocator: std.mem.Allocator) !Headers {
        var headers = Headers{
            .allocator = allocator,
        };
        errdefer headers.deinit();

        for (self.name_slices, self.value_slices) |name, value| {
            try headers.append(name, value);
        }

        return headers;
    }
};

/// Build HTTP CONNECT request for proxy tunneling
fn buildConnectRequest(
    target_host: []const u8,
    target_port: u16,
    proxy_authorization: ?[]const u8,
    proxy_headers: ?Headers,
) std.mem.Allocator.Error![]u8 {
    const allocator = bun.default_allocator;

    // Calculate size for the CONNECT request
    var buf = std.array_list.Managed(u8).init(allocator);
    errdefer buf.deinit();
    const writer = buf.writer();

    // CONNECT host:port HTTP/1.1\r\n
    try writer.print("CONNECT {s}:{d} HTTP/1.1\r\n", .{ target_host, target_port });

    // Host: host:port\r\n
    try writer.print("Host: {s}:{d}\r\n", .{ target_host, target_port });

    // Proxy-Connection: Keep-Alive\r\n
    try writer.writeAll("Proxy-Connection: Keep-Alive\r\n");

    // Proxy-Authorization if provided
    if (proxy_authorization) |auth| {
        try writer.print("Proxy-Authorization: {s}\r\n", .{auth});
    }

    // Custom proxy headers
    if (proxy_headers) |hdrs| {
        const slice = hdrs.entries.slice();
        const names = slice.items(.name);
        const values = slice.items(.value);
        for (names, 0..) |name_ptr, idx| {
            // Skip Proxy-Authorization if user provided one (we already added it)
            const name = hdrs.asStr(name_ptr);
            if (proxy_authorization != null and strings.eqlCaseInsensitiveASCII(name, "proxy-authorization", true)) {
                continue;
            }
            try writer.print("{s}: {s}\r\n", .{ name, hdrs.asStr(values[idx]) });
        }
    }

    // End of headers
    try writer.writeAll("\r\n");

    return buf.toOwnedSlice();
}

const BuildRequestResult = struct {
    body: []u8,
    expected_accept: [28]u8,
};

fn buildRequestBody(
    vm: *jsc.VirtualMachine,
    pathname: []const u8,
    is_https: bool,
    host: []const u8,
    port: u16,
    client_protocol: []const u8,
    extra_headers: Headers8Bit,
    target_authorization: ?[]const u8,
) std.mem.Allocator.Error!BuildRequestResult {
    const allocator = bun.default_allocator;

    // Check for user overrides
    var user_host: ?[]const u8 = null;
    var user_key: ?[]const u8 = null;
    var user_protocol: ?[]const u8 = null;
    var user_authorization: bool = false;

    for (extra_headers.names(), extra_headers.values()) |name_slice, value| {
        if (user_host == null and strings.eqlCaseInsensitiveASCII(name_slice, "host", true)) {
            user_host = value;
        } else if (user_key == null and strings.eqlCaseInsensitiveASCII(name_slice, "sec-websocket-key", true)) {
            user_key = value;
        } else if (user_protocol == null and strings.eqlCaseInsensitiveASCII(name_slice, "sec-websocket-protocol", true)) {
            user_protocol = value;
        } else if (!user_authorization and strings.eqlCaseInsensitiveASCII(name_slice, "authorization", true)) {
            user_authorization = true;
        }
    }

    // Validate and use user key, or generate a new one
    var encoded_buf: [24]u8 = undefined;
    const key = blk: {
        if (user_key) |k_slice| {
            // Validate that it's a valid base64-encoded 16-byte value
            var decoded_buf: [24]u8 = undefined; // Max possible decoded size
            const decoded_len = std.base64.standard.Decoder.calcSizeForSlice(k_slice) catch {
                // Invalid base64, fall through to generate
                break :blk std.base64.standard.Encoder.encode(&encoded_buf, &vm.rareData().nextUUID().bytes);
            };

            if (decoded_len == 16) {
                // Try to decode to verify it's valid base64
                _ = std.base64.standard.Decoder.decode(&decoded_buf, k_slice) catch {
                    // Invalid base64, fall through to generate
                    break :blk std.base64.standard.Encoder.encode(&encoded_buf, &vm.rareData().nextUUID().bytes);
                };
                // Valid 16-byte key, use it as-is
                break :blk k_slice;
            }
        }
        // Generate a new key if user key is invalid or not provided
        break :blk std.base64.standard.Encoder.encode(&encoded_buf, &vm.rareData().nextUUID().bytes);
    };

    // Compute the expected Sec-WebSocket-Accept value per RFC 6455 §4.2.2:
    // base64(SHA-1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
    const expected_accept = computeAcceptValue(key);

    const protocol = if (user_protocol) |p| p else client_protocol;

    const host_fmt = bun.fmt.HostFormatter{
        .is_https = is_https,
        .host = host,
        .port = port,
    };

    var static_headers = [_]PicoHTTP.Header{
        .{ .name = "Sec-WebSocket-Key", .value = key },
        .{ .name = "Sec-WebSocket-Protocol", .value = protocol },
    };

    const headers_ = static_headers[0 .. 1 + @as(usize, @intFromBool(protocol.len > 0))];
    const pico_headers = PicoHTTP.Headers{ .headers = headers_ };

    // Build extra headers string, skipping the ones we handle
    var extra_headers_buf = std.array_list.Managed(u8).init(allocator);
    defer extra_headers_buf.deinit();
    const writer = extra_headers_buf.writer();

    // Add Authorization header from URL credentials if user didn't provide one
    if (!user_authorization) {
        if (target_authorization) |auth| {
            try writer.print("Authorization: {s}\r\n", .{auth});
        }
    }

    for (extra_headers.names(), extra_headers.values()) |name_slice, value| {
        if (strings.eqlCaseInsensitiveASCII(name_slice, "host", true) or
            strings.eqlCaseInsensitiveASCII(name_slice, "connection", true) or
            strings.eqlCaseInsensitiveASCII(name_slice, "upgrade", true) or
            strings.eqlCaseInsensitiveASCII(name_slice, "sec-websocket-version", true) or
            strings.eqlCaseInsensitiveASCII(name_slice, "sec-websocket-extensions", true) or
            strings.eqlCaseInsensitiveASCII(name_slice, "sec-websocket-key", true) or
            strings.eqlCaseInsensitiveASCII(name_slice, "sec-websocket-protocol", true))
        {
            continue;
        }
        try writer.print("{s}: {s}\r\n", .{ name_slice, value });
    }

    // Build request with user overrides
    if (user_host) |h| {
        return .{
            .body = try std.fmt.allocPrint(
                allocator,
                "GET {s} HTTP/1.1\r\n" ++
                    "Host: {s}\r\n" ++
                    "Connection: Upgrade\r\n" ++
                    "Upgrade: websocket\r\n" ++
                    "Sec-WebSocket-Version: 13\r\n" ++
                    "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n" ++
                    "{f}" ++
                    "{s}" ++
                    "\r\n",
                .{ pathname, h, pico_headers, extra_headers_buf.items },
            ),
            .expected_accept = expected_accept,
        };
    }

    return .{
        .body = try std.fmt.allocPrint(
            allocator,
            "GET {s} HTTP/1.1\r\n" ++
                "Host: {f}\r\n" ++
                "Connection: Upgrade\r\n" ++
                "Upgrade: websocket\r\n" ++
                "Sec-WebSocket-Version: 13\r\n" ++
                "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n" ++
                "{f}" ++
                "{s}" ++
                "\r\n",
            .{ pathname, host_fmt, pico_headers, extra_headers_buf.items },
        ),
        .expected_accept = expected_accept,
    };
}

/// Compute the expected Sec-WebSocket-Accept value per RFC 6455 §4.2.2:
/// base64(SHA-1(key ++ "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
fn computeAcceptValue(key: []const u8) [28]u8 {
    const websocket_guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    var hasher = bun.sha.Hashers.SHA1.init();
    hasher.update(key);
    hasher.update(websocket_guid);
    var hash: bun.sha.Hashers.SHA1.Digest = undefined;
    hasher.final(&hash);
    var result: [28]u8 = undefined;
    _ = bun.base64.encode(&result, &hash);
    return result;
}

const log = Output.scoped(.WebSocketUpgradeClient, .visible);

/// Parse SSLConfig from a JavaScript TLS options object.
/// This function is exported for C++ to call from JSWebSocket.cpp.
/// Returns null if parsing fails (an exception will be set on globalThis).
/// The returned SSLConfig is heap-allocated and ownership is transferred to the caller.
pub fn parseSSLConfig(
    globalThis: *jsc.JSGlobalObject,
    tls_value: jsc.JSValue,
) callconv(.c) ?*SSLConfig {
    const vm = globalThis.bunVM();

    // Use SSLConfig.fromJS for clean and safe parsing
    const config_opt = SSLConfig.fromJS(vm, globalThis, tls_value) catch {
        // Exception is already set on globalThis
        return null;
    };

    if (config_opt) |config| {
        // Allocate on heap and return pointer (ownership transferred to caller)
        const config_ptr = bun.handleOom(bun.default_allocator.create(SSLConfig));
        config_ptr.* = config;
        return config_ptr;
    }

    // No TLS options provided or all defaults, return null
    return null;
}

comptime {
    @export(&parseSSLConfig, .{ .name = "Bun__WebSocket__parseSSLConfig" });
}

const WebSocketDeflate = @import("./WebSocketDeflate.zig");
const WebSocketProxy = @import("./WebSocketProxy.zig");
const WebSocketProxyTunnel = @import("./WebSocketProxyTunnel.zig");
const std = @import("std");
const CppWebSocket = @import("./CppWebSocket.zig").CppWebSocket;

const websocket_client = @import("../websocket_client.zig");
const ErrorCode = websocket_client.ErrorCode;

const bun = @import("bun");
const Async = bun.Async;
const BoringSSL = bun.BoringSSL;
const Environment = bun.Environment;
const Output = bun.Output;
const PicoHTTP = bun.picohttp;
const default_allocator = bun.default_allocator;
const jsc = bun.jsc;
const strings = bun.strings;
const uws = bun.uws;
const Headers = bun.http.Headers;
const SSLConfig = jsc.API.ServerConfig.SSLConfig;
