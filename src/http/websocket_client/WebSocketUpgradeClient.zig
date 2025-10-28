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

        const State = enum { initializing, reading, failed };

        const HTTPClient = @This();
        pub fn register(_: *jsc.JSGlobalObject, _: *anyopaque, ctx: *uws.SocketContext) callconv(.c) void {
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
            socket_ctx: *anyopaque,
            websocket: *CppWebSocket,
            host: *const jsc.ZigString,
            port: u16,
            pathname: *const jsc.ZigString,
            client_protocol: *const jsc.ZigString,
            header_names: ?[*]const jsc.ZigString,
            header_values: ?[*]const jsc.ZigString,
            header_count: usize,
        ) callconv(.c) ?*HTTPClient {
            const vm = global.bunVM();

            bun.assert(vm.event_loop_handle != null);

            const extra_headers = NonUTF8Headers.init(header_names, header_values, header_count);

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
            ) catch return null;

            var client = bun.new(HTTPClient, .{
                .ref_count = .init(),
                .tcp = .{ .socket = .{ .detached = {} } },
                .outgoing_websocket = websocket,
                .input_body_buf = body,
                .state = .initializing,
                .subprotocols = brk: {
                    var subprotocols = bun.StringSet.init(bun.default_allocator);
                    var it = bun.http.HeaderValueIterator.init(protocol_for_subprotocols.slice());
                    while (it.next()) |protocol| {
                        subprotocols.insert(protocol) catch |e| bun.handleOom(e);
                    }
                    break :brk subprotocols;
                },
            });

            var host_ = host.toSlice(bun.default_allocator);
            defer host_.deinit();

            client.poll_ref.ref(vm);
            const display_host_ = host_.slice();
            const display_host = if (bun.FeatureFlags.hardcode_localhost_to_127_0_0_1 and strings.eqlComptime(display_host_, "localhost"))
                "127.0.0.1"
            else
                display_host_;

            if (Socket.connectPtr(
                display_host,
                port,
                @as(*uws.SocketContext, @ptrCast(socket_ctx)),
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
        }
        pub fn cancel(this: *HTTPClient) callconv(.c) void {
            this.clearData();

            // Either of the below two operations - closing the TCP socket or clearing the C++ reference could trigger a deref
            // Therefore, we need to make sure the `this` pointer is valid until the end of the function.
            this.ref();
            defer this.deref();

            // The C++ end of the socket is no longer holding a reference to this, sowe must clear it.
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

            this.ref();
            defer this.deref();

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
            log("onHandshake({d})", .{success});

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
                    socket.getNativeHandle().?.configureHTTPClient(this.hostname);
                    bun.default_allocator.free(this.hostname);
                    this.hostname = "";
                }
            }

            // Do not set MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
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
            if (this.outgoing_websocket == null) {
                this.clearData();
                socket.close(.failure);
                return;
            }
            this.ref();
            defer this.deref();

            bun.assert(this.isSameSocket(socket));

            if (comptime Environment.allow_assert)
                bun.assert(!socket.isShutdown());

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

            this.clearData();
            jsc.markBinding(@src());
            if (!this.tcp.isClosed() and this.outgoing_websocket != null) {
                this.tcp.timeout(0);
                log("onDidConnect", .{});

                // Once for the outgoing_websocket.
                defer this.deref();
                const ws = bun.take(&this.outgoing_websocket).?;
                const socket = this.tcp;

                this.tcp.detach();
                // Once again for the TCP socket.
                defer this.deref();

                ws.didConnect(socket.socket.get().?, overflow.ptr, overflow.len, if (deflate_result.enabled) &deflate_result.params else null);
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

            if (this.to_send.len == 0)
                return;

            this.ref();
            defer this.deref();

            // Do not set MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
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
};

fn buildRequestBody(
    vm: *jsc.VirtualMachine,
    pathname: *const jsc.ZigString,
    is_https: bool,
    host: *const jsc.ZigString,
    port: u16,
    client_protocol: *const jsc.ZigString,
    extra_headers: NonUTF8Headers,
) std.mem.Allocator.Error![]u8 {
    const allocator = vm.allocator;

    // Check for user overrides
    var user_host: ?jsc.ZigString = null;
    var user_key: ?jsc.ZigString = null;
    var user_protocol: ?jsc.ZigString = null;

    for (extra_headers.names, extra_headers.values) |name, value| {
        const name_slice = name.slice();
        if (user_host == null and strings.eqlCaseInsensitiveASCII(name_slice, "host", true)) {
            user_host = value;
        } else if (user_key == null and strings.eqlCaseInsensitiveASCII(name_slice, "sec-websocket-key", true)) {
            user_key = value;
        } else if (user_protocol == null and strings.eqlCaseInsensitiveASCII(name_slice, "sec-websocket-protocol", true)) {
            user_protocol = value;
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

const WebSocketDeflate = @import("./WebSocketDeflate.zig");
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
