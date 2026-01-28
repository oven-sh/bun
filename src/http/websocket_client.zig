/// This is the Zig implementation of the WebSocket client.
///
/// It manages the WebSocket connection, including sending and receiving data,
/// handling connection events, and managing the WebSocket state.
///
/// The WebSocket client supports both secure (TLS) and non-secure connections.
///
/// This is only used **after** the websocket handshaking step is completed.
pub fn NewWebSocketClient(comptime ssl: bool) type {
    return struct {
        pub const Socket = uws.NewSocketHandler(ssl);

        const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
        pub const ref = RefCount.ref;
        pub const deref = RefCount.deref;

        ref_count: RefCount,

        tcp: Socket,
        outgoing_websocket: ?*CppWebSocket = null,

        receive_state: ReceiveState = ReceiveState.need_header,
        receiving_type: Opcode = Opcode.ResB,
        // we need to start with final so we validate the first frame
        receiving_is_final: bool = true,

        ping_frame_bytes: [128 + 6]u8 = [_]u8{0} ** (128 + 6),
        ping_len: u8 = 0,
        ping_received: bool = false,
        close_received: bool = false,
        close_frame_buffering: bool = false,

        receive_frame: usize = 0,
        receive_body_remain: usize = 0,
        receive_pending_chunk_len: usize = 0,
        receive_buffer: bun.LinearFifo(u8, .Dynamic),

        send_buffer: bun.LinearFifo(u8, .Dynamic),

        globalThis: *jsc.JSGlobalObject,
        poll_ref: Async.KeepAlive = Async.KeepAlive.init(),

        header_fragment: ?u8 = null,

        payload_length_frame_bytes: [8]u8 = [_]u8{0} ** 8,
        payload_length_frame_len: u8 = 0,

        initial_data_handler: ?*InitialDataHandler = null,
        event_loop: *jsc.EventLoop = undefined,
        deflate: ?*WebSocketDeflate = null,

        // Track if current message is compressed
        receiving_compressed: bool = false,
        // Track compression state of the entire message (across fragments)
        message_is_compressed: bool = false,

        // Custom SSL context for per-connection TLS options (e.g., custom CA)
        // This is set when the WebSocket is adopted from a connection that used a custom SSL context.
        // Must be cleaned up when the WebSocket closes.
        custom_ssl_ctx: ?*uws.SocketContext = null,

        // Proxy tunnel for wss:// through HTTP proxy.
        // When set, all I/O goes through the tunnel (TLS encryption/decryption).
        // The tunnel handles the TLS layer, so this is used with ssl=false.
        proxy_tunnel: ?*WebSocketProxyTunnel = null,

        const stack_frame_size = 1024;
        // Minimum message size to compress (RFC 7692 recommendation)
        const MIN_COMPRESS_SIZE = 860;
        // DEFLATE overhead
        const COMPRESSION_OVERHEAD = 4;

        const WebSocket = @This();

        fn shouldCompress(this: *const WebSocket, data_len: usize, opcode: Opcode) bool {
            // Check if compression is available
            if (this.deflate == null) return false;

            // Only compress Text and Binary messages
            if (opcode != .Text and opcode != .Binary) return false;

            // Don't compress small messages where overhead exceeds benefit
            if (data_len < MIN_COMPRESS_SIZE) return false;

            return true;
        }

        pub fn register(global: *jsc.JSGlobalObject, loop_: *anyopaque, ctx_: *anyopaque) callconv(.c) void {
            const vm = global.bunVM();
            const loop = @as(*uws.Loop, @ptrCast(@alignCast(loop_)));

            const ctx: *uws.SocketContext = @as(*uws.SocketContext, @ptrCast(ctx_));

            if (comptime Environment.isPosix) {
                if (vm.event_loop_handle) |other| {
                    bun.assert(other == loop);
                }
            }

            Socket.configure(
                ctx,
                true,
                *WebSocket,
                struct {
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

        pub fn clearData(this: *WebSocket) void {
            log("clearData", .{});
            this.poll_ref.unref(this.globalThis.bunVM());
            this.clearReceiveBuffers(true);
            this.clearSendBuffers(true);
            this.ping_received = false;
            this.ping_len = 0;
            this.close_frame_buffering = false;
            this.receive_pending_chunk_len = 0;
            this.receiving_compressed = false;
            this.message_is_compressed = false;
            if (this.deflate) |d| d.deinit();
            this.deflate = null;
            // Clean up custom SSL context if we own one
            if (this.custom_ssl_ctx) |ctx| {
                ctx.deinit(ssl);
                this.custom_ssl_ctx = null;
            }
            // Clean up proxy tunnel if we own one
            // Set to null FIRST to prevent re-entrancy (shutdown can trigger callbacks)
            if (this.proxy_tunnel) |tunnel| {
                this.proxy_tunnel = null;
                tunnel.shutdown();
                tunnel.deref();
            }
        }

        pub fn cancel(this: *WebSocket) callconv(.c) void {
            log("cancel", .{});
            this.clearData();

            if (comptime ssl) {
                // we still want to send pending SSL buffer + close_notify
                this.tcp.close(.normal);
            } else {
                this.tcp.close(.failure);
            }
        }

        pub fn fail(this: *WebSocket, code: ErrorCode) void {
            jsc.markBinding(@src());
            if (this.outgoing_websocket) |ws| {
                this.outgoing_websocket = null;
                log("fail ({s})", .{@tagName(code)});
                ws.didAbruptClose(code);
                this.deref();
            }

            this.cancel();
        }

        pub fn handleHandshake(this: *WebSocket, socket: Socket, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
            jsc.markBinding(@src());

            const authorized = if (success == 1) true else false;

            log("onHandshake({d})", .{success});

            if (this.outgoing_websocket) |ws| {
                const reject_unauthorized = ws.rejectUnauthorized();

                // Only reject the connection if reject_unauthorized is true
                if (reject_unauthorized) {
                    // Check for SSL errors
                    if (ssl_error.error_no != 0) {
                        this.outgoing_websocket = null;
                        ws.didAbruptClose(ErrorCode.failed_to_connect);
                        return;
                    }

                    // Check authorization status
                    if (!authorized) {
                        this.outgoing_websocket = null;
                        ws.didAbruptClose(ErrorCode.failed_to_connect);
                        return;
                    }

                    // Check server identity
                    const ssl_ptr = @as(*BoringSSL.c.SSL, @ptrCast(socket.getNativeHandle()));
                    if (BoringSSL.c.SSL_get_servername(ssl_ptr, 0)) |servername| {
                        const hostname = servername[0..bun.len(servername)];
                        if (!BoringSSL.checkServerIdentity(ssl_ptr, hostname)) {
                            this.outgoing_websocket = null;
                            ws.didAbruptClose(ErrorCode.failed_to_connect);
                        }
                    }
                }
                // If reject_unauthorized is false, we accept the connection regardless of SSL errors
            }
        }
        pub fn handleClose(this: *WebSocket, _: Socket, _: c_int, _: ?*anyopaque) void {
            log("onClose", .{});
            jsc.markBinding(@src());
            this.clearData();
            this.tcp.detach();

            this.dispatchAbruptClose(ErrorCode.ended);

            // For the socket.
            this.deref();
        }

        pub fn terminate(this: *WebSocket, code: ErrorCode) void {
            log("terminate", .{});
            this.fail(code);
        }

        fn clearReceiveBuffers(this: *WebSocket, free: bool) void {
            this.receive_buffer.head = 0;
            this.receive_buffer.count = 0;

            if (free) {
                this.receive_buffer.deinit();
                this.receive_buffer.buf.len = 0;
            }

            this.receive_pending_chunk_len = 0;
            this.receive_body_remain = 0;
        }

        fn clearSendBuffers(this: *WebSocket, free: bool) void {
            this.send_buffer.head = 0;
            this.send_buffer.count = 0;
            if (free) {
                this.send_buffer.deinit();
                this.send_buffer.buf.len = 0;
            }
        }

        fn dispatchCompressedData(this: *WebSocket, data_: []const u8, kind: Opcode) void {
            const deflate = this.deflate orelse {
                this.terminate(ErrorCode.compression_unsupported);
                return;
            };

            // Decompress the data
            var decompressed = deflate.rare_data.arrayList();
            defer decompressed.deinit();

            deflate.decompress(data_, &decompressed) catch |err| {
                const error_code = switch (err) {
                    error.InflateFailed => ErrorCode.invalid_compressed_data,
                    error.TooLarge => ErrorCode.message_too_big,
                    error.OutOfMemory => ErrorCode.failed_to_allocate_memory,
                };
                this.terminate(error_code);
                return;
            };

            this.dispatchData(decompressed.items, kind);
        }

        /// Data will be cloned in C++.
        fn dispatchData(this: *WebSocket, data_: []const u8, kind: Opcode) void {
            var out = this.outgoing_websocket orelse {
                this.clearData();
                return;
            };

            switch (kind) {
                .Text => {
                    // this function encodes to UTF-16 if > 127
                    // so we don't need to worry about latin1 non-ascii code points
                    // we avoid trim since we wanna keep the utf8 validation intact
                    const utf16_bytes_ = strings.toUTF16Alloc(bun.default_allocator, data_, true, false) catch {
                        this.terminate(ErrorCode.invalid_utf8);
                        return;
                    };
                    var outstring = jsc.ZigString.Empty;
                    if (utf16_bytes_) |utf16| {
                        outstring = jsc.ZigString.from16Slice(utf16);
                        outstring.markGlobal();
                        jsc.markBinding(@src());
                        out.didReceiveText(false, &outstring);
                    } else {
                        outstring = jsc.ZigString.init(data_);
                        jsc.markBinding(@src());
                        out.didReceiveText(true, &outstring);
                    }
                },
                .Binary, .Ping, .Pong => {
                    jsc.markBinding(@src());
                    out.didReceiveBytes(data_.ptr, data_.len, @as(u8, @intFromEnum(kind)));
                },
                else => {
                    this.terminate(ErrorCode.unexpected_opcode);
                },
            }
        }

        pub fn consume(this: *WebSocket, data_: []const u8, left_in_fragment: usize, kind: Opcode, is_final: bool) usize {
            bun.assert(data_.len <= left_in_fragment);

            // For compressed messages, we must buffer all fragments until the message is complete
            if (this.receiving_compressed) {
                // Always buffer compressed data
                if (data_.len > 0) {
                    var writable = this.receive_buffer.writableWithSize(data_.len) catch {
                        this.terminate(ErrorCode.closed);
                        return 0;
                    };
                    @memcpy(writable[0..data_.len], data_);
                    this.receive_buffer.update(data_.len);
                }

                if (left_in_fragment >= data_.len and left_in_fragment - data_.len - this.receive_pending_chunk_len == 0) {
                    this.receive_pending_chunk_len = 0;
                    this.receive_body_remain = 0;
                    if (is_final) {
                        // Decompress the complete message
                        this.dispatchCompressedData(this.receive_buffer.readableSlice(0), kind);
                        this.clearReceiveBuffers(false);
                        this.receiving_compressed = false;
                        this.message_is_compressed = false;
                    }
                } else {
                    this.receive_pending_chunk_len -|= left_in_fragment;
                }
                return data_.len;
            }

            // Non-compressed path remains the same
            // did all the data fit in the buffer?
            // we can avoid copying & allocating a temporary buffer
            if (is_final and data_.len == left_in_fragment and this.receive_pending_chunk_len == 0) {
                if (this.receive_buffer.count == 0) {
                    this.dispatchData(data_, kind);
                    this.message_is_compressed = false;
                    return data_.len;
                } else if (data_.len == 0) {
                    this.dispatchData(this.receive_buffer.readableSlice(0), kind);
                    this.clearReceiveBuffers(false);
                    this.message_is_compressed = false;
                    return 0;
                }
            }

            // this must come after the above check
            if (data_.len == 0) return 0;

            var writable = this.receive_buffer.writableWithSize(data_.len) catch unreachable;
            @memcpy(writable[0..data_.len], data_);
            this.receive_buffer.update(data_.len);

            if (left_in_fragment >= data_.len and left_in_fragment - data_.len - this.receive_pending_chunk_len == 0) {
                this.receive_pending_chunk_len = 0;
                this.receive_body_remain = 0;
                if (is_final) {
                    this.dispatchData(this.receive_buffer.readableSlice(0), kind);
                    this.clearReceiveBuffers(false);
                    this.message_is_compressed = false;
                }
            } else {
                this.receive_pending_chunk_len -|= left_in_fragment;
            }
            return data_.len;
        }

        pub fn handleData(this: *WebSocket, socket: Socket, data_: []const u8) void {

            // after receiving close we should ignore the data
            if (this.close_received) return;
            this.ref();
            defer this.deref();

            // Due to scheduling, it is possible for the websocket onData
            // handler to run with additional data before the microtask queue is
            // drained.
            if (this.initial_data_handler) |initial_handler| {
                // This calls `handleData`
                // We deliberately do not set this.initial_data_handler to null here, that's done in handleWithoutDeinit.
                // We do not free the memory here since the lifetime is managed by the microtask queue (it should free when called from there)
                initial_handler.handleWithoutDeinit();

                // handleWithoutDeinit is supposed to clear the handler from WebSocket*
                // to prevent an infinite loop
                bun.assert(this.initial_data_handler == null);

                // If we disconnected for any reason in the re-entrant case, we should just ignore the data
                if (this.outgoing_websocket == null or !this.hasTCP())
                    return;
            }

            var data = data_;
            var receive_state = this.receive_state;
            var terminated = false;
            var is_fragmented = false;
            var receiving_type = this.receiving_type;
            var receive_body_remain = this.receive_body_remain;
            var is_final = this.receiving_is_final;
            var last_receive_data_type = receiving_type;

            defer {
                if (terminated) {
                    this.close_received = true;
                } else {
                    this.receive_state = receive_state;
                    this.receiving_type = last_receive_data_type;
                    this.receive_body_remain = receive_body_remain;
                }
            }

            var header_bytes: [@sizeOf(usize)]u8 = [_]u8{0} ** @sizeOf(usize);

            // In the WebSocket specification, control frames may not be fragmented.
            // However, the frame parser should handle fragmented control frames nonetheless.
            // Whether or not the frame parser is given a set of fragmented bytes to parse is subject
            // to the strategy in which the client buffers and coalesces received bytes.

            while (true) {
                log("onData ({s})", .{@tagName(receive_state)});

                switch (receive_state) {
                    // 0                   1                   2                   3
                    // 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
                    // +-+-+-+-+-------+-+-------------+-------------------------------+
                    // |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
                    // |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
                    // |N|V|V|V|       |S|             |   (if payload len==126/127)   |
                    // | |1|2|3|       |K|             |                               |
                    // +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
                    // |     Extended payload length continued, if payload len == 127  |
                    // + - - - - - - - - - - - - - - - +-------------------------------+
                    // |                               |Masking-key, if MASK set to 1  |
                    // +-------------------------------+-------------------------------+
                    // | Masking-key (continued)       |          Payload Data         |
                    // +-------------------------------- - - - - - - - - - - - - - - - +
                    // :                     Payload Data continued ...                :
                    // + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
                    // |                     Payload Data continued ...                |
                    // +---------------------------------------------------------------+
                    .need_header => {
                        if (data.len < 2) {
                            bun.assert(data.len > 0);
                            if (this.header_fragment == null) {
                                this.header_fragment = data[0];
                                break;
                            }
                        }

                        if (this.header_fragment) |header_fragment| {
                            header_bytes[0] = header_fragment;
                            header_bytes[1] = data[0];
                            data = data[1..];
                        } else {
                            header_bytes[0..2].* = data[0..2].*;
                            data = data[2..];
                        }
                        this.header_fragment = null;

                        receive_body_remain = 0;
                        var need_compression = false;
                        is_final = false;

                        receive_state = parseWebSocketHeader(
                            header_bytes[0..2].*,
                            &receiving_type,
                            &receive_body_remain,
                            &is_fragmented,
                            &is_final,
                            &need_compression,
                        );
                        if (receiving_type == .Continue) {
                            // if is final is true continue is invalid
                            if (this.receiving_is_final) {
                                // nothing to continue here
                                // Per Autobahn test case 5.9: "The connection is failed immediately, since there is no message to continue."
                                this.terminate(ErrorCode.unexpected_opcode);
                                terminated = true;
                                break;
                            }
                            // only update final if is a valid continue
                            this.receiving_is_final = is_final;
                        } else if (receiving_type == .Text or receiving_type == .Binary) {
                            // if the last one is not final this is invalid because we are waiting a continue
                            if (!this.receiving_is_final) {
                                this.terminate(ErrorCode.unexpected_opcode);
                                terminated = true;
                                break;
                            }
                            // for text and binary frames we need to keep track of final and type
                            this.receiving_is_final = is_final;
                            last_receive_data_type = receiving_type;
                        } else if (receiving_type.isControl() and is_fragmented) {
                            // Control frames must not be fragmented.
                            this.terminate(ErrorCode.control_frame_is_fragmented);
                            terminated = true;
                            break;
                        }

                        switch (receiving_type) {
                            .Continue, .Text, .Binary, .Ping, .Pong, .Close => {},
                            else => {
                                this.terminate(ErrorCode.unsupported_control_frame);
                                terminated = true;
                                break;
                            },
                        }

                        if (need_compression and this.deflate == null) {
                            this.terminate(ErrorCode.compression_unsupported);
                            terminated = true;
                            break;
                        }

                        // Control frames must not be compressed
                        if (need_compression and receiving_type.isControl()) {
                            this.terminate(ErrorCode.invalid_control_frame);
                            terminated = true;
                            break;
                        }

                        // Track compression state for this message
                        if (receiving_type == .Text or receiving_type == .Binary) {
                            // New message starts - set both compression states
                            this.message_is_compressed = need_compression;
                            this.receiving_compressed = need_compression;
                        } else if (receiving_type == .Continue) {
                            // Continuation frame - use the compression state from the message start
                            this.receiving_compressed = this.message_is_compressed;
                        }

                        // Handle when the payload length is 0, but it is a message
                        //
                        // This should become
                        //
                        // - ArrayBuffer(0)
                        // - ""
                        // - Buffer(0) (etc)
                        //
                        if (receive_body_remain == 0 and receive_state == .need_body and is_final) {
                            _ = this.consume(
                                "",
                                receive_body_remain,
                                last_receive_data_type,
                                is_final,
                            );

                            // Return to the header state to read the next frame
                            receive_state = .need_header;
                            is_fragmented = false;
                            this.receiving_compressed = false;
                            this.message_is_compressed = false;

                            // Bail out if there's nothing left to read
                            if (data.len == 0) break;
                        }
                    },
                    .need_mask => {
                        this.terminate(.unexpected_mask_from_server);
                        terminated = true;
                        break;
                    },
                    .extended_payload_length_64, .extended_payload_length_16 => |rc| {
                        const byte_size = switch (rc) {
                            .extended_payload_length_64 => @as(usize, 8),
                            .extended_payload_length_16 => @as(usize, 2),
                            else => unreachable,
                        };

                        // we need to wait for more data
                        if (data.len == 0) {
                            break;
                        }

                        // copy available payload length bytes to a buffer held on this client instance
                        const total_received = @min(byte_size - this.payload_length_frame_len, data.len);
                        @memcpy(this.payload_length_frame_bytes[this.payload_length_frame_len..][0..total_received], data[0..total_received]);
                        this.payload_length_frame_len += @intCast(total_received);
                        data = data[total_received..];

                        // short read on payload length - we need to wait for more data
                        // whatever bytes were returned from the short read are kept in `payload_length_frame_bytes`
                        if (this.payload_length_frame_len < byte_size) {
                            break;
                        }

                        // Multibyte length quantities are expressed in network byte order
                        receive_body_remain = switch (byte_size) {
                            8 => @as(usize, std.mem.readInt(u64, this.payload_length_frame_bytes[0..8], .big)),
                            2 => @as(usize, std.mem.readInt(u16, this.payload_length_frame_bytes[0..2], .big)),
                            else => unreachable,
                        };

                        this.payload_length_frame_len = 0;

                        receive_state = .need_body;

                        if (receive_body_remain == 0) {
                            // this is an error
                            // the server should've set length to zero
                            this.terminate(ErrorCode.invalid_control_frame);
                            terminated = true;
                            break;
                        }
                    },
                    .ping => {
                        if (!this.ping_received) {
                            if (receive_body_remain > 125) {
                                this.terminate(ErrorCode.invalid_control_frame);
                                terminated = true;
                                break;
                            }
                            this.ping_len = @truncate(receive_body_remain);
                            receive_body_remain = 0;
                            this.ping_received = true;
                        }
                        const ping_len = this.ping_len;

                        if (data.len > 0) {
                            // copy the data to the ping frame
                            const total_received = @min(ping_len, receive_body_remain + data.len);
                            const slice = this.ping_frame_bytes[6..][receive_body_remain..total_received];
                            @memcpy(slice, data[0..slice.len]);
                            receive_body_remain = total_received;
                            data = data[slice.len..];
                        }
                        const pending_body = ping_len - receive_body_remain;
                        if (pending_body > 0) {
                            // wait for more data it can be fragmented
                            break;
                        }

                        const ping_data = this.ping_frame_bytes[6..][0..ping_len];
                        this.dispatchData(ping_data, .Ping);

                        receive_state = .need_header;
                        receive_body_remain = 0;
                        receiving_type = last_receive_data_type;
                        this.ping_received = false;

                        // we need to send all pongs to pass autobahn tests
                        _ = this.sendPong(socket);
                        if (data.len == 0) break;
                    },
                    .pong => {
                        const pong_len = @min(data.len, @min(receive_body_remain, this.ping_frame_bytes.len));

                        this.dispatchData(data[0..pong_len], .Pong);

                        data = data[pong_len..];
                        receive_state = .need_header;
                        receive_body_remain = 0;
                        receiving_type = last_receive_data_type;

                        if (data.len == 0) break;
                    },
                    .need_body => {
                        const to_consume = @min(receive_body_remain, data.len);

                        const consumed = this.consume(data[0..to_consume], receive_body_remain, last_receive_data_type, is_final);

                        receive_body_remain -= consumed;
                        data = data[to_consume..];
                        if (receive_body_remain == 0) {
                            receive_state = .need_header;
                            is_fragmented = false;
                        }

                        if (data.len == 0) break;
                    },

                    .close => {
                        if (receive_body_remain == 1 or receive_body_remain > 125) {
                            this.terminate(ErrorCode.invalid_control_frame);
                            terminated = true;
                            break;
                        }

                        if (receive_body_remain > 0) {
                            if (!this.close_frame_buffering) {
                                this.ping_len = @truncate(receive_body_remain);
                                receive_body_remain = 0;
                                this.close_frame_buffering = true;
                            }
                            const to_copy = @min(data.len, this.ping_len - receive_body_remain);
                            @memcpy(this.ping_frame_bytes[6 + receive_body_remain ..][0..to_copy], data[0..to_copy]);
                            receive_body_remain += to_copy;
                            data = data[to_copy..];
                            if (receive_body_remain < this.ping_len) break;

                            this.close_received = true;
                            const close_data = this.ping_frame_bytes[6..][0..this.ping_len];
                            if (this.ping_len >= 2) {
                                var code = std.mem.readInt(u16, close_data[0..2], .big);
                                if (code == 1001) code = 1000;
                                if ((code < 1000) or (code >= 1004 and code < 1007) or (code >= 1016 and code <= 2999)) code = 1002;
                                var buf: [125]u8 = undefined;
                                @memcpy(buf[0 .. this.ping_len - 2], close_data[2..this.ping_len]);
                                this.sendCloseWithBody(socket, code, &buf, this.ping_len - 2);
                            } else {
                                this.sendClose();
                            }
                            this.close_frame_buffering = false;
                            terminated = true;
                            break;
                        }

                        this.close_received = true;
                        this.sendClose();
                        terminated = true;
                        break;
                    },
                    .fail => {
                        this.terminate(ErrorCode.unsupported_control_frame);
                        terminated = true;
                        break;
                    },
                }
            }
        }

        pub fn sendClose(this: *WebSocket) void {
            this.sendCloseWithBody(this.tcp, 1000, null, 0);
        }

        fn enqueueEncodedBytes(
            this: *WebSocket,
            socket: Socket,
            bytes: []const u8,
        ) bool {
            // For tunnel mode, write through the tunnel instead of direct socket
            if (this.proxy_tunnel) |tunnel| {
                // The tunnel handles TLS encryption and buffering
                _ = tunnel.write(bytes) catch {
                    this.terminate(ErrorCode.failed_to_write);
                    return false;
                };
                return true;
            }

            // fast path: no backpressure, no queue, just send the bytes.
            if (!this.hasBackpressure()) {
                // Do not set MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
                const wrote = socket.write(bytes);
                const expected = @as(c_int, @intCast(bytes.len));
                if (wrote == expected) {
                    return true;
                }

                if (wrote < 0) {
                    this.terminate(ErrorCode.failed_to_write);
                    return false;
                }

                _ = this.copyToSendBuffer(bytes[@as(usize, @intCast(wrote))..], false);
                return true;
            }

            return this.copyToSendBuffer(bytes, true);
        }

        fn copyToSendBuffer(this: *WebSocket, bytes: []const u8, do_write: bool) bool {
            return this.sendData(.{ .raw = bytes }, do_write, .Binary);
        }

        fn sendData(this: *WebSocket, bytes: Copy, do_write: bool, opcode: Opcode) bool {
            const should_compress = this.deflate != null and (opcode == .Text or opcode == .Binary) and bytes != .raw;

            if (should_compress) {
                // For compressed messages, we need to compress the content first
                var temp_buffer: ?[]u8 = null;
                const allocator = this.deflate.?.rare_data.allocator();
                defer if (temp_buffer) |buf| allocator.free(buf);
                const content_to_compress: []const u8 = switch (bytes) {
                    .utf16 => |utf16| brk: {
                        // Convert UTF16 to UTF8 for compression
                        const content_byte_len: usize = strings.elementLengthUTF16IntoUTF8(utf16);
                        temp_buffer = allocator.alloc(u8, content_byte_len) catch return false;
                        const encode_result = strings.copyUTF16IntoUTF8(temp_buffer.?, utf16);
                        break :brk temp_buffer.?[0..encode_result.written];
                    },
                    .latin1 => |latin1| brk: {
                        // Convert Latin1 to UTF8 for compression
                        const content_byte_len: usize = strings.elementLengthLatin1IntoUTF8(latin1);
                        if (content_byte_len == latin1.len) {
                            // It's all ascii, we don't need to copy it an extra time.
                            break :brk latin1;
                        }

                        temp_buffer = allocator.alloc(u8, content_byte_len) catch return false;
                        const encode_result = strings.copyLatin1IntoUTF8(temp_buffer.?, latin1);
                        break :brk temp_buffer.?[0..encode_result.written];
                    },
                    .bytes => |b| b,
                    .raw => unreachable,
                };

                // Check if compression is worth it
                if (!this.shouldCompress(content_to_compress.len, opcode)) {
                    return this.sendDataUncompressed(bytes, do_write, opcode);
                }

                {
                    // Compress the content
                    var compressed = std.array_list.Managed(u8).init(allocator);
                    defer compressed.deinit();

                    this.deflate.?.compress(content_to_compress, &compressed) catch {
                        // If compression fails, fall back to uncompressed
                        return this.sendDataUncompressed(bytes, do_write, opcode);
                    };

                    // Create the compressed frame
                    const frame_size = WebsocketHeader.frameSizeIncludingMask(compressed.items.len);
                    const writable = this.send_buffer.writableWithSize(frame_size) catch return false;
                    Copy.copyCompressed(this.globalThis, writable[0..frame_size], compressed.items, opcode, true);
                    this.send_buffer.update(frame_size);
                }

                if (do_write) {
                    if (comptime Environment.allow_assert) {
                        bun.assert(!this.tcp.isShutdown());
                        bun.assert(!this.tcp.isClosed());
                        bun.assert(this.tcp.isEstablished());
                    }
                    return this.sendBuffer(this.send_buffer.readableSlice(0));
                }
            } else {
                return this.sendDataUncompressed(bytes, do_write, opcode);
            }

            return true;
        }

        fn sendDataUncompressed(this: *WebSocket, bytes: Copy, do_write: bool, opcode: Opcode) bool {
            var content_byte_len: usize = 0;
            const write_len = bytes.len(&content_byte_len);
            bun.assert(write_len > 0);

            const writable = this.send_buffer.writableWithSize(write_len) catch unreachable;
            bytes.copy(this.globalThis, writable[0..write_len], content_byte_len, opcode);
            this.send_buffer.update(write_len);

            if (do_write) {
                if (comptime Environment.allow_assert) {
                    bun.assert(!this.tcp.isShutdown());
                    bun.assert(!this.tcp.isClosed());
                    bun.assert(this.tcp.isEstablished());
                }
                return this.sendBuffer(this.send_buffer.readableSlice(0));
            }

            return true;
        }

        fn sendBuffer(
            this: *WebSocket,
            out_buf: []const u8,
        ) bool {
            bun.assert(out_buf.len > 0);
            // Do not set MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
            if (this.tcp.isClosed()) {
                return false;
            }
            const wrote = this.tcp.write(out_buf);
            if (wrote < 0) {
                this.terminate(ErrorCode.failed_to_write);
                return false;
            }
            const expected = @as(usize, @intCast(wrote));
            const readable = this.send_buffer.readableSlice(0);
            if (readable.ptr == out_buf.ptr) {
                this.send_buffer.discard(expected);
            }

            return true;
        }

        fn sendPong(this: *WebSocket, socket: Socket) bool {
            if (socket.isClosed() or socket.isShutdown()) {
                this.dispatchAbruptClose(ErrorCode.ended);
                return false;
            }

            var header = @as(WebsocketHeader, @bitCast(@as(u16, 0)));
            header.final = true;
            header.opcode = .Pong;

            const to_mask = this.ping_frame_bytes[6..][0..this.ping_len];

            header.mask = true;
            header.len = @as(u7, @truncate(this.ping_len));
            this.ping_frame_bytes[0..2].* = header.slice();

            if (to_mask.len > 0) {
                Mask.fill(this.globalThis, this.ping_frame_bytes[2..6], to_mask, to_mask);
                return this.enqueueEncodedBytes(socket, this.ping_frame_bytes[0 .. 6 + @as(usize, this.ping_len)]);
            } else {
                @memset(this.ping_frame_bytes[2..6], 0); //autobahn tests require that we mask empty pongs
                return this.enqueueEncodedBytes(socket, this.ping_frame_bytes[0..6]);
            }
        }

        fn sendCloseWithBody(
            this: *WebSocket,
            socket: Socket,
            code: u16,
            body: ?*[125]u8,
            body_len: usize,
        ) void {
            log("Sending close with code {d}", .{code});
            if (socket.isClosed() or socket.isShutdown()) {
                this.dispatchAbruptClose(ErrorCode.ended);
                this.clearData();
                return;
            }
            // we dont wanna shutdownRead when SSL, because SSL handshake can happen when writting
            if (comptime !ssl) {
                socket.shutdownRead();
            }
            var final_body_bytes: [128 + 8]u8 = undefined;
            var header = @as(WebsocketHeader, @bitCast(@as(u16, 0)));
            header.final = true;
            header.opcode = .Close;
            header.mask = true;
            header.len = @as(u7, @truncate(body_len + 2));
            final_body_bytes[0..2].* = header.slice();
            const mask_buf: *[4]u8 = final_body_bytes[2..6];
            final_body_bytes[6..8].* = @bitCast(@byteSwap(code));

            var reason = bun.String.empty;
            if (body) |data| {
                if (body_len > 0) {
                    const body_slice = data[0..body_len];
                    // close is always utf8
                    if (!strings.isValidUTF8(body_slice)) {
                        this.terminate(ErrorCode.invalid_utf8);
                        return;
                    }
                    reason = bun.String.cloneUTF8(body_slice);
                    @memcpy(final_body_bytes[8..][0..body_len], body_slice);
                }
            }

            // we must mask the code
            var slice = final_body_bytes[0..(8 + body_len)];
            Mask.fill(this.globalThis, mask_buf, slice[6..], slice[6..]);

            if (this.enqueueEncodedBytes(socket, slice)) {
                this.clearData();
                this.dispatchClose(code, &reason);
            }
        }
        pub fn isSameSocket(this: *WebSocket, socket: Socket) bool {
            return socket.socket.eq(this.tcp.socket);
        }

        pub fn handleEnd(this: *WebSocket, socket: Socket) void {
            bun.assert(this.isSameSocket(socket));
            this.terminate(ErrorCode.ended);
        }

        pub fn handleWritable(
            this: *WebSocket,
            socket: Socket,
        ) void {
            if (this.close_received) return;
            bun.assert(this.isSameSocket(socket));
            const send_buf = this.send_buffer.readableSlice(0);
            if (send_buf.len == 0)
                return;
            _ = this.sendBuffer(send_buf);
        }
        pub fn handleTimeout(
            this: *WebSocket,
            _: Socket,
        ) void {
            this.terminate(ErrorCode.timeout);
        }
        pub fn handleConnectError(this: *WebSocket, _: Socket, _: c_int) void {
            this.tcp.detach();
            this.terminate(ErrorCode.failed_to_connect);
        }

        pub fn hasBackpressure(this: *const WebSocket) bool {
            return this.send_buffer.count > 0;
        }

        pub fn writeBinaryData(
            this: *WebSocket,
            ptr: [*]const u8,
            len: usize,
            op: u8,
        ) callconv(.c) void {
            if (!this.hasTCP() or op > 0xF) {
                this.dispatchAbruptClose(ErrorCode.ended);
                return;
            }

            const opcode: Opcode = @enumFromInt(op);
            const slice = ptr[0..len];
            const bytes = Copy{ .bytes = slice };
            // fast path: small frame, no backpressure, attempt to send without allocating
            const frame_size = WebsocketHeader.frameSizeIncludingMask(len);
            if (!this.hasBackpressure() and frame_size < stack_frame_size) {
                var inline_buf: [stack_frame_size]u8 = undefined;
                bytes.copy(this.globalThis, inline_buf[0..frame_size], slice.len, opcode);
                _ = this.enqueueEncodedBytes(this.tcp, inline_buf[0..frame_size]);
                return;
            }

            _ = this.sendData(bytes, !this.hasBackpressure(), opcode);
        }
        fn hasTCP(this: *WebSocket) bool {
            // For tunnel mode, we have an active connection through the tunnel
            if (this.proxy_tunnel != null) return true;
            return !this.tcp.isClosed() and !this.tcp.isShutdown();
        }

        pub fn writeBlob(
            this: *WebSocket,
            blob_value: jsc.JSValue,
            op: u8,
        ) callconv(.c) void {
            if (!this.hasTCP() or op > 0xF) {
                this.dispatchAbruptClose(ErrorCode.ended);
                return;
            }

            const opcode: Opcode = @enumFromInt(op);

            // Cast the JSValue to a Blob
            if (blob_value.as(jsc.WebCore.Blob)) |blob| {
                // Get the shared view of the blob data
                const data = blob.sharedView();
                if (data.len == 0) {
                    // Empty blob, send empty frame
                    const bytes = Copy{ .bytes = &[0]u8{} };
                    _ = this.sendData(bytes, !this.hasBackpressure(), opcode);
                    return;
                }

                // Send the blob data similar to writeBinaryData
                const bytes = Copy{ .bytes = data };

                // Fast path for small blobs
                const frame_size = WebsocketHeader.frameSizeIncludingMask(data.len);
                if (!this.hasBackpressure() and frame_size < stack_frame_size) {
                    var inline_buf: [stack_frame_size]u8 = undefined;
                    bytes.copy(this.globalThis, inline_buf[0..frame_size], data.len, opcode);
                    _ = this.enqueueEncodedBytes(this.tcp, inline_buf[0..frame_size]);
                    return;
                }

                _ = this.sendData(bytes, !this.hasBackpressure(), opcode);
            } else {
                // Invalid blob, close connection
                this.dispatchAbruptClose(ErrorCode.ended);
            }
        }

        pub fn writeString(
            this: *WebSocket,
            str_: *const jsc.ZigString,
            op: u8,
        ) callconv(.c) void {
            const str = str_.*;
            if (!this.hasTCP()) {
                this.dispatchAbruptClose(ErrorCode.ended);
                return;
            }
            const tcp = this.tcp;

            // Note: 0 is valid

            const opcode = @as(Opcode, @enumFromInt(@as(u4, @truncate(op))));
            {
                var inline_buf: [stack_frame_size]u8 = undefined;

                // fast path: small frame, no backpressure, attempt to send without allocating
                if (!str.is16Bit() and str.len < stack_frame_size) {
                    const bytes = Copy{ .latin1 = str.slice() };
                    var byte_len: usize = 0;
                    const frame_size = bytes.len(&byte_len);
                    if (!this.hasBackpressure() and frame_size < stack_frame_size) {
                        bytes.copy(this.globalThis, inline_buf[0..frame_size], byte_len, opcode);
                        _ = this.enqueueEncodedBytes(tcp, inline_buf[0..frame_size]);
                        return;
                    }
                    // max length of a utf16 -> utf8 conversion is 4 times the length of the utf16 string
                } else if ((str.len * 4) < (stack_frame_size) and !this.hasBackpressure()) {
                    const bytes = Copy{ .utf16 = str.utf16SliceAligned() };
                    var byte_len: usize = 0;
                    const frame_size = bytes.len(&byte_len);
                    bun.assert(frame_size <= stack_frame_size);
                    bytes.copy(this.globalThis, inline_buf[0..frame_size], byte_len, opcode);
                    _ = this.enqueueEncodedBytes(tcp, inline_buf[0..frame_size]);
                    return;
                }
            }

            _ = this.sendData(
                if (str.is16Bit())
                    Copy{ .utf16 = str.utf16SliceAligned() }
                else
                    Copy{ .latin1 = str.slice() },
                !this.hasBackpressure(),
                opcode,
            );
        }

        fn dispatchAbruptClose(this: *WebSocket, code: ErrorCode) void {
            var out = this.outgoing_websocket orelse return;
            this.poll_ref.unref(this.globalThis.bunVM());
            jsc.markBinding(@src());
            this.outgoing_websocket = null;
            out.didAbruptClose(code);
            this.deref();
        }

        fn dispatchClose(this: *WebSocket, code: u16, reason: *bun.String) void {
            var out = this.outgoing_websocket orelse return;
            this.poll_ref.unref(this.globalThis.bunVM());
            jsc.markBinding(@src());
            this.outgoing_websocket = null;
            out.didClose(code, reason);
            this.deref();
        }

        pub fn close(this: *WebSocket, code: u16, reason: ?*const jsc.ZigString) callconv(.c) void {
            if (!this.hasTCP())
                return;
            const tcp = this.tcp;
            var close_reason_buf: [128]u8 = undefined;
            if (reason) |str| {
                inner: {
                    var fixed_buffer = std.heap.FixedBufferAllocator.init(&close_reason_buf);
                    const allocator = fixed_buffer.allocator();
                    const wrote = std.fmt.allocPrint(allocator, "{f}", .{str.*}) catch break :inner;
                    this.sendCloseWithBody(tcp, code, wrote.ptr[0..125], wrote.len);
                    return;
                }
            }

            this.sendCloseWithBody(tcp, code, null, 0);
        }

        const InitialDataHandler = struct {
            adopted: ?*WebSocket,
            ws: *CppWebSocket,
            slice: []u8,

            pub const Handle = jsc.AnyTask.New(@This(), handle);

            pub const new = bun.TrivialNew(@This());

            pub fn handleWithoutDeinit(this: *@This()) void {
                var this_socket = this.adopted orelse return;
                this.adopted = null;
                this_socket.initial_data_handler = null;
                var ws = this.ws;
                defer ws.unref();

                // For tunnel mode, tcp is detached but connection is still active through the tunnel
                const is_connected = !this_socket.tcp.isClosed() or this_socket.proxy_tunnel != null;
                if (this_socket.outgoing_websocket != null and is_connected) {
                    this_socket.handleData(this_socket.tcp, this.slice);
                }
            }

            pub fn handle(this: *@This()) void {
                this.handleWithoutDeinit();
                this.deinit();
            }

            pub fn deinit(this: *@This()) void {
                bun.default_allocator.free(this.slice);
                bun.destroy(this);
            }
        };

        pub fn init(
            outgoing: *CppWebSocket,
            input_socket: *anyopaque,
            socket_ctx: *anyopaque,
            globalThis: *jsc.JSGlobalObject,
            buffered_data: [*]u8,
            buffered_data_len: usize,
            deflate_params: ?*const WebSocketDeflate.Params,
            custom_ssl_ctx_ptr: ?*anyopaque,
        ) callconv(.c) ?*anyopaque {
            const tcp = @as(*uws.us_socket_t, @ptrCast(input_socket));
            const ctx = @as(*uws.SocketContext, @ptrCast(socket_ctx));
            var ws = bun.new(WebSocket, .{
                .ref_count = .init(),
                .tcp = .{ .socket = .{ .detached = {} } },
                .outgoing_websocket = outgoing,
                .globalThis = globalThis,
                .send_buffer = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator),
                .receive_buffer = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator),
                .event_loop = globalThis.bunVM().eventLoop(),
                // Take ownership of custom SSL context if provided
                .custom_ssl_ctx = if (custom_ssl_ctx_ptr) |ptr| @ptrCast(ptr) else null,
            });

            if (deflate_params) |params| {
                if (WebSocketDeflate.init(bun.default_allocator, params.*, globalThis.bunVM().rareData())) |deflate| {
                    ws.deflate = deflate;
                } else |_| {
                    // failed to init, silently disable compression
                    ws.deflate = null;
                }
            }

            if (!Socket.adoptPtr(
                tcp,
                ctx,
                WebSocket,
                "tcp",
                ws,
            )) {
                ws.deref();
                return null;
            }

            bun.handleOom(ws.send_buffer.ensureTotalCapacity(2048));
            bun.handleOom(ws.receive_buffer.ensureTotalCapacity(2048));
            ws.poll_ref.ref(globalThis.bunVM());

            const buffered_slice: []u8 = buffered_data[0..buffered_data_len];
            if (buffered_slice.len > 0) {
                const initial_data = InitialDataHandler.new(.{
                    .adopted = ws,
                    .slice = buffered_slice,
                    .ws = outgoing,
                });

                // Use a higher-priority callback for the initial onData handler
                globalThis.queueMicrotaskCallback(initial_data, InitialDataHandler.handle);

                // We need to ref the outgoing websocket so that it doesn't get finalized
                // before the initial data handler is called
                outgoing.ref();
            }

            // And lastly, ref the new websocket since C++ has a reference to it
            ws.ref();

            return @as(
                *anyopaque,
                @ptrCast(ws),
            );
        }

        /// Initialize a WebSocket client that uses a proxy tunnel for I/O.
        /// Used for wss:// through HTTP proxy where TLS is handled by the tunnel.
        /// The tunnel takes ownership of socket I/O, and this client reads/writes through it.
        pub fn initWithTunnel(
            outgoing: *CppWebSocket,
            tunnel_ptr: *anyopaque,
            globalThis: *jsc.JSGlobalObject,
            buffered_data: [*]u8,
            buffered_data_len: usize,
            deflate_params: ?*const WebSocketDeflate.Params,
        ) callconv(.c) ?*anyopaque {
            const tunnel: *WebSocketProxyTunnel = @ptrCast(@alignCast(tunnel_ptr));

            var ws = bun.new(WebSocket, .{
                .ref_count = .init(),
                .tcp = .{ .socket = .{ .detached = {} } }, // No direct socket - using tunnel
                .outgoing_websocket = outgoing,
                .globalThis = globalThis,
                .send_buffer = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator),
                .receive_buffer = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator),
                .event_loop = globalThis.bunVM().eventLoop(),
                .proxy_tunnel = tunnel,
            });

            // Take ownership of the tunnel
            tunnel.ref();

            if (deflate_params) |params| {
                if (WebSocketDeflate.init(bun.default_allocator, params.*, globalThis.bunVM().rareData())) |deflate| {
                    ws.deflate = deflate;
                } else |_| {
                    ws.deflate = null;
                }
            }

            bun.handleOom(ws.send_buffer.ensureTotalCapacity(2048));
            bun.handleOom(ws.receive_buffer.ensureTotalCapacity(2048));
            ws.poll_ref.ref(globalThis.bunVM());

            const buffered_slice: []u8 = buffered_data[0..buffered_data_len];
            if (buffered_slice.len > 0) {
                const initial_data = InitialDataHandler.new(.{
                    .adopted = ws,
                    .slice = buffered_slice,
                    .ws = outgoing,
                });
                globalThis.queueMicrotaskCallback(initial_data, InitialDataHandler.handle);
                outgoing.ref();
            }

            ws.ref();

            return @as(*anyopaque, @ptrCast(ws));
        }

        /// Handle data received from the proxy tunnel (already decrypted).
        /// Called by the WebSocketProxyTunnel when it receives and decrypts data.
        pub fn handleTunnelData(this: *WebSocket, data: []const u8) void {
            // Process the decrypted data as if it came from the socket
            // hasTCP() now returns true for tunnel mode, so this will work correctly
            this.handleData(this.tcp, data);
        }

        pub fn finalize(this: *WebSocket) callconv(.c) void {
            log("finalize", .{});
            this.clearData();

            // This is only called by outgoing_websocket.
            if (this.outgoing_websocket != null) {
                this.outgoing_websocket = null;
                this.deref();
            }

            if (!this.tcp.isClosed()) {
                // no need to be .failure we still wanna to send pending SSL buffer + close_notify
                if (comptime ssl) {
                    this.tcp.close(.normal);
                } else {
                    this.tcp.close(.failure);
                }
            }
        }

        pub fn deinit(this: *WebSocket) void {
            this.clearData();
            if (this.deflate) |d| d.deinit();
            this.deflate = null;
            bun.destroy(this);
        }

        pub fn memoryCost(this: *WebSocket) callconv(.c) usize {
            var cost: usize = @sizeOf(WebSocket);
            cost += this.send_buffer.buf.len;
            cost += this.receive_buffer.buf.len;
            // This is under-estimated a little, as we don't include usockets context.
            return cost;
        }
        pub fn exportAll() void {
            comptime {
                const name = if (ssl) "WebSocketClientTLS" else "WebSocketClient";
                @export(&cancel, .{ .name = "Bun__" ++ name ++ "__cancel" });
                @export(&close, .{ .name = "Bun__" ++ name ++ "__close" });
                @export(&finalize, .{ .name = "Bun__" ++ name ++ "__finalize" });
                @export(&init, .{ .name = "Bun__" ++ name ++ "__init" });
                @export(&initWithTunnel, .{ .name = "Bun__" ++ name ++ "__initWithTunnel" });
                @export(&memoryCost, .{ .name = "Bun__" ++ name ++ "__memoryCost" });
                @export(&register, .{ .name = "Bun__" ++ name ++ "__register" });
                @export(&writeBinaryData, .{ .name = "Bun__" ++ name ++ "__writeBinaryData" });
                @export(&writeBlob, .{ .name = "Bun__" ++ name ++ "__writeBlob" });
                @export(&writeString, .{ .name = "Bun__" ++ name ++ "__writeString" });
            }
        }
    };
}

pub const ErrorCode = enum(i32) {
    cancel = 1,
    invalid_response = 2,
    expected_101_status_code = 3,
    missing_upgrade_header = 4,
    missing_connection_header = 5,
    missing_websocket_accept_header = 6,
    invalid_upgrade_header = 7,
    invalid_connection_header = 8,
    invalid_websocket_version = 9,
    mismatch_websocket_accept_header = 10,
    missing_client_protocol = 11,
    mismatch_client_protocol = 12,
    timeout = 13,
    closed = 14,
    failed_to_write = 15,
    failed_to_connect = 16,
    headers_too_large = 17,
    ended = 18,
    failed_to_allocate_memory = 19,
    control_frame_is_fragmented = 20,
    invalid_control_frame = 21,
    compression_unsupported = 22,
    invalid_compressed_data = 23,
    compression_failed = 24,
    unexpected_mask_from_server = 25,
    expected_control_frame = 26,
    unsupported_control_frame = 27,
    unexpected_opcode = 28,
    invalid_utf8 = 29,
    tls_handshake_failed = 30,
    message_too_big = 31,
    protocol_error = 32,
    // Proxy error codes
    proxy_connect_failed = 33,
    proxy_authentication_required = 34,
    proxy_connection_refused = 35,
    proxy_tunnel_failed = 36,
};

pub const Mask = struct {
    pub fn fill(globalThis: *jsc.JSGlobalObject, mask_buf: *[4]u8, output_: []u8, input_: []const u8) void {
        mask_buf.* = globalThis.bunVM().rareData().entropySlice(4)[0..4].*;
        const mask = mask_buf.*;

        const skip_mask = @as(u32, @bitCast(mask)) == 0;
        fillWithSkipMask(mask, output_, input_, skip_mask);
    }

    fn fillWithSkipMask(mask: [4]u8, output_: []u8, input_: []const u8, skip_mask: bool) void {
        const input = input_;
        const output = output_;
        if (input.len == 0) {
            @branchHint(.unlikely);
            return;
        }
        return bun.highway.fillWithSkipMask(mask, output, input, skip_mask);
    }
};

const ReceiveState = enum {
    need_header,
    need_mask,
    need_body,
    extended_payload_length_16,
    extended_payload_length_64,
    ping,
    pong,
    close,
    fail,

    pub fn needControlFrame(this: ReceiveState) bool {
        return this != .need_body;
    }
};
const DataType = enum {
    none,
    text,
    binary,
};

fn parseWebSocketHeader(
    bytes: [2]u8,
    receiving_type: *Opcode,
    payload_length: *usize,
    is_fragmented: *bool,
    is_final: *bool,
    need_compression: *bool,
) ReceiveState {
    // 0                   1                   2                   3
    // 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
    // +-+-+-+-+-------+-+-------------+-------------------------------+
    // |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
    // |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
    // |N|V|V|V|       |S|             |   (if payload len==126/127)   |
    // | |1|2|3|       |K|             |                               |
    // +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
    // |     Extended payload length continued, if payload len == 127  |
    // + - - - - - - - - - - - - - - - +-------------------------------+
    // |                               |Masking-key, if MASK set to 1  |
    // +-------------------------------+-------------------------------+
    // | Masking-key (continued)       |          Payload Data         |
    // +-------------------------------- - - - - - - - - - - - - - - - +
    // :                     Payload Data continued ...                :
    // + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
    // |                     Payload Data continued ...                |
    // +---------------------------------------------------------------+
    const header = WebsocketHeader.fromSlice(bytes);
    const payload = @as(usize, header.len);
    payload_length.* = payload;
    receiving_type.* = header.opcode;
    is_fragmented.* = switch (header.opcode) {
        .Continue => true,
        else => false,
    } or !header.final;
    is_final.* = header.final;

    // Per RFC 7692, RSV1 bit indicates compression for the first fragment of a message
    // For continuation frames, compression state is inherited from the first fragment
    if (header.opcode == .Text or header.opcode == .Binary) {
        need_compression.* = header.compressed;
    } else if (header.opcode == .Continue) {
        // Compression state for continuation frames should be inherited from the message start
        // This needs to be tracked at a higher level, not determined by the continuation frame's RSV1
        // For now, we don't set it here - it should be maintained by the WebSocket state
        need_compression.* = false;
    } else {
        // Control frames cannot be compressed
        if (header.compressed) {
            return .fail; // Control frames with RSV1 set should fail
        }
        need_compression.* = false;
    }

    if (header.mask and (header.opcode == .Text or header.opcode == .Binary)) {
        return .need_mask;
    }

    // Check RSV bits (rsv2 and rsv3 must always be 0 per RFC 6455)
    // rsv1 (compressed bit) is handled separately above
    if (header.rsv != 0) {
        // RSV2 and RSV3 bits must always be 0
        return .fail;
    }

    return switch (header.opcode) {
        .Text, .Continue, .Binary => if (payload <= 125)
            return .need_body
        else if (payload == 126)
            return .extended_payload_length_16
        else if (payload == 127)
            return .extended_payload_length_64
        else
            return .fail,
        .Close => .close,
        .Ping => .ping,
        .Pong => .pong,
        else => .fail,
    };
}

const Copy = union(enum) {
    utf16: []const u16,
    latin1: []const u8,
    bytes: []const u8,
    raw: []const u8,

    pub fn len(this: @This(), byte_len: *usize) usize {
        switch (this) {
            .utf16 => {
                byte_len.* = strings.elementLengthUTF16IntoUTF8(this.utf16);
                return WebsocketHeader.frameSizeIncludingMask(byte_len.*);
            },
            .latin1 => {
                byte_len.* = strings.elementLengthLatin1IntoUTF8(this.latin1);
                return WebsocketHeader.frameSizeIncludingMask(byte_len.*);
            },
            .bytes => {
                byte_len.* = this.bytes.len;
                return WebsocketHeader.frameSizeIncludingMask(byte_len.*);
            },
            .raw => {
                byte_len.* = this.raw.len;
                return this.raw.len;
            },
        }
    }

    pub fn copy(this: @This(), globalThis: *jsc.JSGlobalObject, buf: []u8, content_byte_len: usize, opcode: Opcode) void {
        if (this == .raw) {
            bun.assert(buf.len >= this.raw.len);
            bun.assert(buf.ptr != this.raw.ptr);
            @memcpy(buf[0..this.raw.len], this.raw);
            return;
        }

        const how_big_is_the_length_integer = WebsocketHeader.lengthByteCount(content_byte_len);
        const how_big_is_the_mask = 4;
        const mask_offset = 2 + how_big_is_the_length_integer;
        const content_offset = mask_offset + how_big_is_the_mask;

        // 2 byte header
        // 4 byte mask
        // 0, 2, 8 byte length
        var to_mask = buf[content_offset..];

        var header = @as(WebsocketHeader, @bitCast(@as(u16, 0)));

        // Write extended length if needed
        switch (how_big_is_the_length_integer) {
            0 => {},
            2 => std.mem.writeInt(u16, buf[2..][0..2], @as(u16, @truncate(content_byte_len)), .big),
            8 => std.mem.writeInt(u64, buf[2..][0..8], @as(u64, @truncate(content_byte_len)), .big),
            else => unreachable,
        }

        header.mask = true;
        header.compressed = false;
        header.final = true;
        header.opcode = opcode;

        bun.assert(WebsocketHeader.frameSizeIncludingMask(content_byte_len) == buf.len);

        switch (this) {
            .utf16 => |utf16| {
                header.len = WebsocketHeader.packLength(content_byte_len);
                const encode_into_result = strings.copyUTF16IntoUTF8Impl(to_mask, utf16, true);
                bun.assert(@as(usize, encode_into_result.written) == content_byte_len);
                bun.assert(@as(usize, encode_into_result.read) == utf16.len);
                header.len = WebsocketHeader.packLength(encode_into_result.written);
                var fib = std.io.fixedBufferStream(buf);
                header.writeHeader(fib.writer(), encode_into_result.written) catch unreachable;

                Mask.fill(globalThis, buf[mask_offset..][0..4], to_mask[0..content_byte_len], to_mask[0..content_byte_len]);
            },
            .latin1 => |latin1| {
                const encode_into_result = strings.copyLatin1IntoUTF8(to_mask, latin1);
                bun.assert(@as(usize, encode_into_result.written) == content_byte_len);

                // latin1 can contain non-ascii
                bun.assert(@as(usize, encode_into_result.read) == latin1.len);

                header.len = WebsocketHeader.packLength(encode_into_result.written);
                var fib = std.io.fixedBufferStream(buf);
                header.writeHeader(fib.writer(), encode_into_result.written) catch unreachable;
                Mask.fill(globalThis, buf[mask_offset..][0..4], to_mask[0..content_byte_len], to_mask[0..content_byte_len]);
            },
            .bytes => |bytes| {
                header.len = WebsocketHeader.packLength(bytes.len);
                var fib = std.io.fixedBufferStream(buf);
                header.writeHeader(fib.writer(), bytes.len) catch unreachable;
                Mask.fill(globalThis, buf[mask_offset..][0..4], to_mask[0..content_byte_len], bytes);
            },
            .raw => unreachable,
        }
    }

    pub fn copyCompressed(globalThis: *jsc.JSGlobalObject, buf: []u8, compressed_data: []const u8, opcode: Opcode, is_first_fragment: bool) void {
        const content_byte_len = compressed_data.len;
        const how_big_is_the_length_integer = WebsocketHeader.lengthByteCount(content_byte_len);
        const how_big_is_the_mask = 4;
        const mask_offset = 2 + how_big_is_the_length_integer;
        const content_offset = mask_offset + how_big_is_the_mask;

        // 2 byte header
        // 4 byte mask
        // 0, 2, 8 byte length
        var to_mask = buf[content_offset..];

        // Write extended length if needed
        switch (how_big_is_the_length_integer) {
            0 => {},
            2 => std.mem.writeInt(u16, buf[2..][0..2], @as(u16, @truncate(content_byte_len)), .big),
            8 => std.mem.writeInt(u64, buf[2..][0..8], @as(u64, @truncate(content_byte_len)), .big),
            else => unreachable,
        }

        var header = @as(WebsocketHeader, @bitCast(@as(u16, 0)));

        header.mask = true;
        header.compressed = is_first_fragment; // Only set compressed flag for first fragment
        header.final = true;
        header.opcode = opcode;
        header.len = WebsocketHeader.packLength(content_byte_len);

        bun.assert(WebsocketHeader.frameSizeIncludingMask(content_byte_len) == buf.len);

        var fib = std.io.fixedBufferStream(buf);
        header.writeHeader(fib.writer(), content_byte_len) catch unreachable;

        Mask.fill(globalThis, buf[mask_offset..][0..4], to_mask[0..content_byte_len], compressed_data);
    }
};

const log = Output.scoped(.WebSocketClient, .visible);

const string = []const u8;

const WebSocketDeflate = @import("./websocket_client/WebSocketDeflate.zig");
const WebSocketProxyTunnel = @import("./websocket_client/WebSocketProxyTunnel.zig");
const std = @import("std");
const CppWebSocket = @import("./websocket_client/CppWebSocket.zig").CppWebSocket;

const Opcode = @import("./websocket.zig").Opcode;
const WebsocketHeader = @import("./websocket.zig").WebsocketHeader;

const bun = @import("bun");
const Async = bun.Async;
const BoringSSL = bun.BoringSSL;
const Environment = bun.Environment;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const jsc = bun.jsc;
const strings = bun.strings;
const uws = bun.uws;
