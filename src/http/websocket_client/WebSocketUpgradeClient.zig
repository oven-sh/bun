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
            host: *const jsc.ZigString,
            port: u16,
            pathname: *const jsc.ZigString,
            client_protocol: *const jsc.ZigString,
            header_names: ?[*]const jsc.ZigString,
            header_values: ?[*]const jsc.ZigString,
            header_count: usize,
            // Proxy parameters
            proxy_host: ?*const jsc.ZigString,
            proxy_port: u16,
            proxy_authorization: ?*const jsc.ZigString,
            proxy_header_names: ?[*]const jsc.ZigString,
            proxy_header_values: ?[*]const jsc.ZigString,
            proxy_header_count: usize,
            // TLS options (full SSLConfig for complete TLS customization)
            ssl_config: ?*SSLConfig,
            // Whether the target URL is wss:// (separate from ssl template parameter)
            target_is_secure: bool,
            // Target URL authorization (Basic auth from ws://user:pass@host)
            target_authorization: ?*const jsc.ZigString,
        ) callconv(.c) ?*HTTPClient {
            const vm = global.bunVM();

            bun.assert(vm.event_loop_handle != null);

            const extra_headers = NonUTF8Headers.init(header_names, header_values, header_count);
            const using_proxy = proxy_host != null;

            // Check if user provided a custom protocol for subprotocols validation
            var protocol_for_subprotocols = client_protocol.*;
            for (extra_headers.names, extra_headers.values) |name, value| {
                if (strings.eqlCaseInsensitiveASCII(name.slice(), "sec-websocket-protocol", true)) {
                    protocol_for_subprotocols = value;
                    break;
                }
            }

            const body = buildRequestBody(
                vm,
                pathname,
                ssl,
                host,
                port,
                client_protocol,
                extra_headers,
                if (target_authorization) |auth| auth.slice() else null,
            ) catch return null;

            // Build proxy state if using proxy
            // The CONNECT request is built using local variables for proxy_authorization and proxy_headers
            // which are freed immediately after building the request (not stored on the client).
            var proxy_state: ?WebSocketProxy = null;
            var connect_request: []u8 = &[_]u8{};
            if (using_proxy) {
                // Parse proxy authorization (temporary, freed after building CONNECT request)
                var proxy_auth_slice: ?[]const u8 = null;
                var proxy_auth_owned: ?[]u8 = null;
                defer if (proxy_auth_owned) |auth| bun.default_allocator.free(auth);

                if (proxy_authorization) |auth| {
                    proxy_auth_owned = bun.default_allocator.dupe(u8, auth.slice()) catch {
                        bun.default_allocator.free(body);
                        return null;
                    };
                    proxy_auth_slice = proxy_auth_owned;
                }

                // Parse proxy headers (temporary, freed after building CONNECT request)
                var proxy_hdrs: ?Headers = null;
                defer if (proxy_hdrs) |*hdrs| hdrs.deinit();

                if (proxy_header_count > 0) {
                    const non_utf8_hdrs = NonUTF8Headers.init(proxy_header_names, proxy_header_values, proxy_header_count);
                    proxy_hdrs = non_utf8_hdrs.toHeaders(bun.default_allocator) catch {
                        bun.default_allocator.free(body);
                        return null;
                    };
                }

                // Build CONNECT request (proxy_auth and proxy_hdrs are freed by defer after this)
                connect_request = buildConnectRequest(
                    host.slice(),
                    port,
                    proxy_auth_slice,
                    proxy_hdrs,
                ) catch {
                    bun.default_allocator.free(body);
                    return null;
                };

                // Duplicate target_host (needed for SNI during TLS handshake)
                const target_host_dup = bun.default_allocator.dupe(u8, host.slice()) catch {
                    bun.default_allocator.free(body);
                    bun.default_allocator.free(connect_request);
                    return null;
                };

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
                .subprotocols = brk: {
                    var subprotocols = bun.StringSet.init(bun.default_allocator);
                    var it = bun.http.HeaderValueIterator.init(protocol_for_subprotocols.slice());
                    while (it.next()) |protocol| {
                        subprotocols.insert(protocol) catch |e| bun.handleOom(e);
                    }
                    break :brk subprotocols;
                },
            });

            // Store TLS config if provided (ownership transferred to client)
            client.ssl_config = ssl_config;

            var host_ = if (using_proxy) proxy_host.?.toSlice(bun.default_allocator) else host.toSlice(bun.default_allocator);
            defer host_.deinit();

            const connect_port = if (using_proxy) proxy_port else port;

            client.poll_ref.ref(vm);
            const display_host_ = host_.slice();
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
                    if (!strings.isIPAddress(host_.slice())) {
                        out.hostname = bun.default_allocator.dupeZ(u8, host_.slice()) catch "";
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

            // Clean up proxy state
            if (this.proxy) |*p| {
                p.deinit();
                this.proxy = null;
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
            this.clearData();
            this.tcp.detach();
            this.dispatchAbruptClose(ErrorCode.ended);

            this.deref();
        }

        pub fn terminate(this: *HTTPClient, code: ErrorCode) void {
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

            var body = data;
            if (this.body.items.len > 0) {
                bun.handleOom(this.body.appendSlice(bun.default_allocator, data));
                body = this.body.items;
            }

            const is_first = this.body.items.len == 0;
            const http_101 = "HTTP/1.1 101 ";
            if (is_first and body.len > http_101.len) {
                // fail early if we receive a non-101 status code
                if (!strings.hasPrefixComptime(body, http_101)) {
                    this.terminate(ErrorCode.expected_101_status_code);
                    return;
                }
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

            this.processResponse(response, body[@as(usize, @intCast(response.bytes_read))..]);
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

            // Take the WebSocket upgrade request from proxy state (transfers ownership)
            const upgrade_request = p.takeWebsocketRequestBuf();
            if (upgrade_request.len == 0) {
                this.terminate(ErrorCode.failed_to_write);
                return;
            }

            // Send through the tunnel (will be encrypted)
            if (p.getTunnel()) |tunnel| {
                _ = tunnel.write(upgrade_request) catch {
                    this.terminate(ErrorCode.failed_to_write);
                    return;
                };
            } else {
                this.terminate(ErrorCode.proxy_tunnel_failed);
            }
        }

        /// Called by WebSocketProxyTunnel with decrypted data from the TLS tunnel
        pub fn handleDecryptedData(this: *HTTPClient, data: []const u8) void {
            log("handleDecryptedData: {} bytes", .{data.len});

            // Process as if it came directly from the socket
            var body = data;
            if (this.body.items.len > 0) {
                bun.handleOom(this.body.appendSlice(bun.default_allocator, data));
                body = this.body.items;
            }

            const is_first = this.body.items.len == 0;
            const http_101 = "HTTP/1.1 101 ";
            if (is_first and body.len > http_101.len) {
                // fail early if we receive a non-101 status code
                if (!strings.hasPrefixComptime(body, http_101)) {
                    this.terminate(ErrorCode.expected_101_status_code);
                    return;
                }
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

            this.processResponse(response, body[@as(usize, @intCast(response.bytes_read))..]);
        }

        pub fn handleEnd(this: *HTTPClient, _: Socket) void {
            log("onEnd", .{});
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
                                    var protocol_str = bun.String.init(protocol);
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

            // TODO: check websocket_accept_header.value

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

const NonUTF8Headers = struct {
    names: []const jsc.ZigString,
    values: []const jsc.ZigString,

    pub fn format(self: NonUTF8Headers, writer: *std.Io.Writer) !void {
        const count = self.names.len;
        var i: usize = 0;
        while (i < count) : (i += 1) {
            try writer.print("{f}: {f}\r\n", .{ self.names[i], self.values[i] });
        }
    }

    pub fn init(names: ?[*]const jsc.ZigString, values: ?[*]const jsc.ZigString, len: usize) NonUTF8Headers {
        if (len == 0) {
            return .{
                .names = &[_]jsc.ZigString{},
                .values = &[_]jsc.ZigString{},
            };
        }

        return .{
            .names = names.?[0..len],
            .values = values.?[0..len],
        };
    }

    /// Convert NonUTF8Headers to bun.http.Headers
    pub fn toHeaders(self: NonUTF8Headers, allocator: std.mem.Allocator) !Headers {
        var headers = Headers{
            .allocator = allocator,
        };
        errdefer headers.deinit();

        for (self.names, self.values) |name, value| {
            try headers.append(name.slice(), value.slice());
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

fn buildRequestBody(
    vm: *jsc.VirtualMachine,
    pathname: *const jsc.ZigString,
    is_https: bool,
    host: *const jsc.ZigString,
    port: u16,
    client_protocol: *const jsc.ZigString,
    extra_headers: NonUTF8Headers,
    target_authorization: ?[]const u8,
) std.mem.Allocator.Error![]u8 {
    const allocator = vm.allocator;

    // Check for user overrides
    var user_host: ?jsc.ZigString = null;
    var user_key: ?jsc.ZigString = null;
    var user_protocol: ?jsc.ZigString = null;
    var user_authorization: bool = false;

    for (extra_headers.names, extra_headers.values) |name, value| {
        const name_slice = name.slice();
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
        if (user_key) |k| {
            const k_slice = k.slice();
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
    const protocol = if (user_protocol) |p| p.slice() else client_protocol.slice();

    const pathname_ = pathname.toSlice(allocator);
    const host_ = host.toSlice(allocator);
    defer {
        pathname_.deinit();
        host_.deinit();
    }

    const host_fmt = bun.fmt.HostFormatter{
        .is_https = is_https,
        .host = host_.slice(),
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

    for (extra_headers.names, extra_headers.values) |name, value| {
        const name_slice = name.slice();
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
        try writer.print("{f}: {f}\r\n", .{ name, value });
    }

    // Build request with user overrides
    if (user_host) |h| {
        return try std.fmt.allocPrint(
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
            .{ pathname_.slice(), h, pico_headers, extra_headers_buf.items },
        );
    }

    return try std.fmt.allocPrint(
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
        .{ pathname_.slice(), host_fmt, pico_headers, extra_headers_buf.items },
    );
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
