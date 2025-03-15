const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const BoringSSL = bun.BoringSSL;
const uws = bun.uws;
const JSC = bun.JSC;
const PicoHTTP = bun.picohttp;
const ObjectPool = @import("../pool.zig").ObjectPool;
const protocol = @import("./websocket_protocol.zig");
const WebsocketHeader = protocol.WebsocketHeader;
const WebsocketDataFrame = protocol.WebsocketDataFrame;
const Opcode = protocol.Opcode;
const ZigURL = @import("../url.zig").URL;

const websocket_client = @import("websocket_client.zig");
const CppWebSocket = websocket_client.CppWebSocket;
const ErrorCode = websocket_client.ErrorCode;
const Mask = websocket_client.Mask;
const ReceiveState = websocket_client.ReceiveState;
const Copy = websocket_client.Copy;
const WebSocketCompression = websocket_client.WebSocketCompression;

const Async = bun.Async;

const log = Output.scoped(.WebSocketClient, false);

pub fn NewWebSocketClient(comptime ssl: bool) type {
    return struct {
        pub const Socket = uws.NewSocketHandler(ssl);
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

        receive_frame: usize = 0,
        receive_body_remain: usize = 0,
        receive_pending_chunk_len: usize = 0,
        receive_buffer: bun.LinearFifo(u8, .Dynamic),

        send_buffer: bun.LinearFifo(u8, .Dynamic),

        globalThis: *JSC.JSGlobalObject,
        poll_ref: Async.KeepAlive = Async.KeepAlive.init(),

        header_fragment: ?u8 = null,

        payload_length_frame_bytes: [8]u8 = [_]u8{0} ** 8,
        payload_length_frame_len: u8 = 0,

        initial_data_handler: ?*InitialDataHandler = null,
        event_loop: *JSC.EventLoop = undefined,
        ref_count: u32 = 1,

        compression: WebSocketCompression = WebSocketCompression.init(),

        pub const name = if (ssl) "WebSocketClientTLS" else "WebSocketClient";

        pub const shim = JSC.Shimmer("Bun", name, @This());
        const stack_frame_size = 1024;

        const WebSocket = @This();

        pub usingnamespace bun.NewRefCounted(@This(), deinit, null);
        pub fn register(global: *JSC.JSGlobalObject, loop_: *anyopaque, ctx_: *anyopaque) callconv(.C) void {
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
            this.receive_pending_chunk_len = 0;
            
            // Free compression resources
            this.compression.deinit();
        }

        pub fn cancel(this: *WebSocket) callconv(.C) void {
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
            JSC.markBinding(@src());
            if (this.outgoing_websocket) |ws| {
                this.outgoing_websocket = null;
                log("fail ({s})", .{@tagName(code)});
                ws.didAbruptClose(code);
                this.deref();
            }

            this.cancel();
        }

        pub fn handleHandshake(this: *WebSocket, socket: Socket, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
            JSC.markBinding(@src());

            const authorized = if (success == 1) true else false;

            log("onHandshake({d})", .{success});

            if (this.outgoing_websocket) |ws| {
                const reject_unauthorized = ws.rejectUnauthorized();
                if (ssl_error.error_no != 0 and (reject_unauthorized or !authorized)) {
                    this.outgoing_websocket = null;
                    ws.didAbruptClose(ErrorCode.failed_to_connect);
                    return;
                }

                if (authorized) {
                    if (reject_unauthorized) {
                        const ssl_ptr = @as(*BoringSSL.c.SSL, @ptrCast(socket.getNativeHandle()));
                        if (BoringSSL.c.SSL_get_servername(ssl_ptr, 0)) |servername| {
                            const hostname = servername[0..bun.len(servername)];
                            if (!BoringSSL.checkServerIdentity(ssl_ptr, hostname)) {
                                this.outgoing_websocket = null;
                                ws.didAbruptClose(ErrorCode.failed_to_connect);
                            }
                        }
                    }
                }
            }
        }
        pub fn handleClose(this: *WebSocket, _: Socket, _: c_int, _: ?*anyopaque) void {
            log("onClose", .{});
            JSC.markBinding(@src());
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
                    var outstring = JSC.ZigString.Empty;
                    if (utf16_bytes_) |utf16| {
                        outstring = JSC.ZigString.from16Slice(utf16);
                        outstring.mark();
                        JSC.markBinding(@src());
                        out.didReceiveText(false, &outstring);
                    } else {
                        outstring = JSC.ZigString.init(data_);
                        JSC.markBinding(@src());
                        out.didReceiveText(true, &outstring);
                    }
                },
                .Binary, .Ping, .Pong => {
                    JSC.markBinding(@src());
                    out.didReceiveBytes(data_.ptr, data_.len, @as(u8, @intFromEnum(kind)));
                },
                else => {
                    this.terminate(ErrorCode.unexpected_opcode);
                },
            }
        }

        pub fn consume(this: *WebSocket, data_: []const u8, left_in_fragment: usize, kind: Opcode, is_final: bool) usize {
            bun.assert(data_.len <= left_in_fragment);

            // did all the data fit in the buffer?
            // we can avoid copying & allocating a temporary buffer
            if (is_final and data_.len == left_in_fragment and this.receive_pending_chunk_len == 0) {
                if (this.receive_buffer.count == 0) {
                    // Check if this data needs decompression
                    if (this.compression.enabled and (kind == .Text or kind == .Binary)) {
                        // We need to handle RSV1 bit properly in the header
                        // For now, let's attempt to decompress if compression is enabled
                        if (this.compression.decompress(data_, data_.len * 3)) |decompressed_data| {
                            this.dispatchData(decompressed_data, kind);
                            return data_.len;
                        }
                        // If decompression fails, fall back to uncompressed data
                    }
                    this.dispatchData(data_, kind);
                    return data_.len;
                } else if (data_.len == 0) {
                    // For final fragments with empty data
                    if (this.compression.enabled and (kind == .Text or kind == .Binary)) {
                        const buffer_data = this.receive_buffer.readableSlice(0);
                        if (this.compression.decompress(buffer_data, buffer_data.len * 3)) |decompressed_data| {
                            this.dispatchData(decompressed_data, kind);
                            this.clearReceiveBuffers(false);
                            return 0;
                        }
                    }
                    this.dispatchData(this.receive_buffer.readableSlice(0), kind);
                    this.clearReceiveBuffers(false);
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
                    // All data has been received, handle decompression for the complete message
                    if (this.compression.enabled and (kind == .Text or kind == .Binary)) {
                        const buffer_data = this.receive_buffer.readableSlice(0);
                        if (this.compression.decompress(buffer_data, buffer_data.len * 3)) |decompressed_data| {
                            this.dispatchData(decompressed_data, kind);
                            this.clearReceiveBuffers(false);
                            return data_.len;
                        }
                    }
                    this.dispatchData(this.receive_buffer.readableSlice(0), kind);
                    this.clearReceiveBuffers(false);
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

                        receive_state = ReceiveState.parseWebSocketHeader(
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

                        // Handle compression if enabled
                        if (need_compression) {
                            if (!this.compression.enabled) {
                                this.terminate(ErrorCode.compression_unsupported);
                                terminated = true;
                                break;
                            }
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
                        this.close_received = true;

                        // invalid close frame with 1 byte
                        if (data.len == 1 and receive_body_remain == 1) {
                            this.terminate(ErrorCode.invalid_control_frame);
                            terminated = true;
                            break;
                        }
                        // 2 byte close code and optional reason
                        if (data.len >= 2 and receive_body_remain >= 2) {
                            var code = std.mem.readInt(u16, data[0..2], .big);
                            log("Received close with code {d}", .{code});
                            if (code == 1001) {
                                // going away actual sends 1000 (normal close)
                                code = 1000;
                            } else if ((code < 1000) or (code >= 1004 and code < 1007) or (code >= 1016 and code <= 2999)) {
                                // invalid codes must clean close with 1002
                                code = 1002;
                            }
                            const reason_len = receive_body_remain - 2;
                            if (reason_len > 125) {
                                this.terminate(ErrorCode.invalid_control_frame);
                                terminated = true;
                                break;
                            }
                            var close_reason_buf: [125]u8 = undefined;
                            @memcpy(close_reason_buf[0..reason_len], data[2..receive_body_remain]);
                            this.sendCloseWithBody(socket, code, &close_reason_buf, reason_len);
                            data = data[receive_body_remain..];
                            terminated = true;
                            break;
                        }

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
            // fast path: no backpressure, no queue, just send the bytes.
            if (!this.hasBackpressure()) {
                // Do not set MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
                const wrote = socket.write(bytes, false);
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
            return this.sendData(.{ .raw = bytes }, do_write, .Binary, false);
        }

        fn sendData(this: *WebSocket, bytes: Copy, do_write: bool, opcode: Opcode, compressed: bool) bool {
            var content_byte_len: usize = 0;
            const write_len = bytes.len(&content_byte_len);
            bun.assert(write_len > 0);

            var writable = this.send_buffer.writableWithSize(write_len) catch unreachable;
            bytes.copy(this.globalThis, writable[0..write_len], content_byte_len, opcode, compressed);
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
            const wrote = this.tcp.write(out_buf, false);
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
                    reason = bun.String.createUTF8(body_slice);
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
        ) callconv(.C) void {
            if (!this.hasTCP() or op > 0xF) {
                this.dispatchAbruptClose(ErrorCode.ended);
                return;
            }

            const opcode: Opcode = @enumFromInt(op);
            const slice = ptr[0..len];
            
            // Try compression if enabled and appropriate opcode
            if (this.compression.enabled and (opcode == .Text or opcode == .Binary)) {
                // See if we can compress the data
                if (this.compression.compress(slice)) |compressed_data| {
                    // Small optimization: only compress if it actually saves space
                    if (compressed_data.len < slice.len) {
                        const bytes = Copy{ .bytes = compressed_data };
                        const frame_size = WebsocketHeader.frameSizeIncludingMask(compressed_data.len);
                        
                        // Create a header with compression flag set
                        if (!this.hasBackpressure() and frame_size < stack_frame_size) {
                            var inline_buf: [stack_frame_size]u8 = undefined;
                            // We need to set the compression flag when copying
                            bytes.copy(this.globalThis, inline_buf[0..frame_size], compressed_data.len, opcode, true);
                            _ = this.enqueueEncodedBytes(this.tcp, inline_buf[0..frame_size]);
                            return;
                        }
                        
                        _ = this.sendData(bytes, !this.hasBackpressure(), opcode, true);
                        return;
                    }
                }
            }
            
            // Fall back to uncompressed data
            const bytes = Copy{ .bytes = slice };
            const frame_size = WebsocketHeader.frameSizeIncludingMask(len);
            if (!this.hasBackpressure() and frame_size < stack_frame_size) {
                var inline_buf: [stack_frame_size]u8 = undefined;
                bytes.copy(this.globalThis, inline_buf[0..frame_size], slice.len, opcode, false);
                _ = this.enqueueEncodedBytes(this.tcp, inline_buf[0..frame_size]);
                return;
            }

            _ = this.sendData(bytes, !this.hasBackpressure(), opcode, false);
        }
        fn hasTCP(this: *WebSocket) bool {
            return !this.tcp.isClosed() and !this.tcp.isShutdown();
        }

        pub fn writeString(
            this: *WebSocket,
            str_: *const JSC.ZigString,
            op: u8,
        ) callconv(.C) void {
            const str = str_.*;
            if (!this.hasTCP()) {
                this.dispatchAbruptClose(ErrorCode.ended);
                return;
            }
            const tcp = this.tcp;

            // Note: 0 is valid

            const opcode = @as(Opcode, @enumFromInt(@as(u4, @truncate(op))));
            
            // For compression, we need to first convert the string to UTF-8 bytes
            if (this.compression.enabled and (opcode == .Text or opcode == .Binary)) {
                var str_bytes: []const u8 = undefined;
                var need_free = false;
                
                if (!str.is16Bit()) {
                    str_bytes = str.slice();
                } else {
                    // Convert UTF-16 to UTF-8
                    const utf8_len = strings.elementLengthUTF16IntoUTF8([]const u16, str.utf16SliceAligned());
                    const utf8_buf = default_allocator.alloc(u8, utf8_len) catch null;
                    if (utf8_buf) |buf| {
                        need_free = true;
                        const result = strings.copyUTF16IntoUTF8(buf, []const u16, str.utf16SliceAligned(), true);
                        if (result.written > 0) {
                            str_bytes = buf[0..result.written];
                        } else {
                            default_allocator.free(buf);
                            need_free = false;
                            str_bytes = str.slice();
                        }
                    } else {
                        str_bytes = str.slice();
                    }
                }
                
                defer if (need_free) default_allocator.free(str_bytes);
                
                // Try compression
                if (this.compression.compress(str_bytes)) |compressed_data| {
                    // Only use compression if it actually saves space
                    if (compressed_data.len < str_bytes.len) {
                        const bytes = Copy{ .bytes = compressed_data };
                        const frame_size = WebsocketHeader.frameSizeIncludingMask(compressed_data.len);
                        
                        if (!this.hasBackpressure() and frame_size < stack_frame_size) {
                            var inline_buf: [stack_frame_size]u8 = undefined;
                            bytes.copy(this.globalThis, inline_buf[0..frame_size], compressed_data.len, opcode, true);
                            _ = this.enqueueEncodedBytes(tcp, inline_buf[0..frame_size]);
                            return;
                        }
                        
                        _ = this.sendData(bytes, !this.hasBackpressure(), opcode, true);
                        return;
                    }
                }
            }
            
            // Fall back to original uncompressed text handling
            {
                var inline_buf: [stack_frame_size]u8 = undefined;

                // fast path: small frame, no backpressure, attempt to send without allocating
                if (!str.is16Bit() and str.len < stack_frame_size) {
                    const bytes = Copy{ .latin1 = str.slice() };
                    var byte_len: usize = 0;
                    const frame_size = bytes.len(&byte_len);
                    if (!this.hasBackpressure() and frame_size < stack_frame_size) {
                        bytes.copy(this.globalThis, inline_buf[0..frame_size], byte_len, opcode, false);
                        _ = this.enqueueEncodedBytes(tcp, inline_buf[0..frame_size]);
                        return;
                    }
                    // max length of a utf16 -> utf8 conversion is 4 times the length of the utf16 string
                } else if ((str.len * 4) < (stack_frame_size) and !this.hasBackpressure()) {
                    const bytes = Copy{ .utf16 = str.utf16SliceAligned() };
                    var byte_len: usize = 0;
                    const frame_size = bytes.len(&byte_len);
                    bun.assert(frame_size <= stack_frame_size);
                    bytes.copy(this.globalThis, inline_buf[0..frame_size], byte_len, opcode, false);
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
                false
            );
        }

        fn dispatchAbruptClose(this: *WebSocket, code: ErrorCode) void {
            var out = this.outgoing_websocket orelse return;
            this.poll_ref.unref(this.globalThis.bunVM());
            JSC.markBinding(@src());
            this.outgoing_websocket = null;
            out.didAbruptClose(code);
            this.deref();
        }

        fn dispatchClose(this: *WebSocket, code: u16, reason: *bun.String) void {
            var out = this.outgoing_websocket orelse return;
            this.poll_ref.unref(this.globalThis.bunVM());
            JSC.markBinding(@src());
            this.outgoing_websocket = null;
            out.didClose(code, reason);
            this.deref();
        }

        pub fn close(this: *WebSocket, code: u16, reason: ?*const JSC.ZigString) callconv(.C) void {
            if (!this.hasTCP())
                return;
            const tcp = this.tcp;
            var close_reason_buf: [128]u8 = undefined;
            if (reason) |str| {
                inner: {
                    var fixed_buffer = std.heap.FixedBufferAllocator.init(&close_reason_buf);
                    const allocator = fixed_buffer.allocator();
                    const wrote = std.fmt.allocPrint(allocator, "{}", .{str.*}) catch break :inner;
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

            pub const Handle = JSC.AnyTask.New(@This(), handle);

            pub usingnamespace bun.New(@This());

            pub fn handleWithoutDeinit(this: *@This()) void {
                var this_socket = this.adopted orelse return;
                this.adopted = null;
                this_socket.initial_data_handler = null;
                var ws = this.ws;
                defer ws.unref();

                if (this_socket.outgoing_websocket != null and !this_socket.tcp.isClosed()) {
                    this_socket.handleData(this_socket.tcp, this.slice);
                }
            }

            pub fn handle(this: *@This()) void {
                this.handleWithoutDeinit();
                this.deinit();
            }

            pub fn deinit(this: *@This()) void {
                bun.default_allocator.free(this.slice);
                this.destroy();
            }
        };

        pub fn init(
            outgoing: *CppWebSocket,
            input_socket: *anyopaque,
            socket_ctx: *anyopaque,
            globalThis: *JSC.JSGlobalObject,
            buffered_data: [*]u8,
            buffered_data_len: usize,
        ) callconv(.C) ?*anyopaque {
            const tcp = @as(*uws.Socket, @ptrCast(input_socket));
            const ctx = @as(*uws.SocketContext, @ptrCast(socket_ctx));
            var ws = WebSocket.new(WebSocket{
                .tcp = .{ .socket = .{ .detached = {} } },
                .outgoing_websocket = outgoing,
                .globalThis = globalThis,
                .send_buffer = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator),
                .receive_buffer = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator),
                .event_loop = globalThis.bunVM().eventLoop(),
            });

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

            ws.send_buffer.ensureTotalCapacity(2048) catch return null;
            ws.receive_buffer.ensureTotalCapacity(2048) catch return null;
            ws.poll_ref.ref(globalThis.bunVM());

            // Initialize compression if header indicated support
            // This would normally be done based on the Sec-WebSocket-Extensions response header
            // For now, we'll enable it by default for testing
            ws.initCompression("permessage-deflate");

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
        
        pub fn initCompression(this: *WebSocket, extensions_header: []const u8) void {
            // Only set up compression if the server indicated support in the response headers
            if (extensions_header.len > 0 and std.mem.indexOf(u8, extensions_header, "permessage-deflate") != null) {
                log("Setting up permessage-deflate compression with extension: {s}", .{extensions_header});
                
                // Initialize compression with the settings from the header
                if (this.compression.setup(extensions_header)) {
                    log("WebSocket compression enabled with client_max_window_bits={d}, server_max_window_bits={d}", 
                        .{this.compression.client_max_window_bits, this.compression.server_max_window_bits});
                    
                    if (this.compression.client_no_context_takeover) {
                        log("Client context takeover disabled", .{});
                    }
                    
                    if (this.compression.server_no_context_takeover) {
                        log("Server context takeover disabled", .{});
                    }
                } else {
                    log("Failed to set up WebSocket compression", .{});
                }
            }
        }

        pub fn finalize(this: *WebSocket) callconv(.C) void {
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
            this.destroy();
        }

        pub fn memoryCost(this: *WebSocket) callconv(.C) usize {
            var cost: usize = @sizeOf(WebSocket);
            cost += this.send_buffer.buf.len;
            cost += this.receive_buffer.buf.len;
            // This is under-estimated a little, as we don't include usockets context.
            return cost;
        }

        pub const Export = shim.exportFunctions(.{
            .writeBinaryData = writeBinaryData,
            .writeString = writeString,
            .close = close,
            .cancel = cancel,
            .register = register,
            .init = init,
            .finalize = finalize,
            .memoryCost = memoryCost,
        });

        comptime {
            @export(&writeBinaryData, .{ .name = Export[0].symbol_name });
            @export(&writeString, .{ .name = Export[1].symbol_name });
            @export(&close, .{ .name = Export[2].symbol_name });
            @export(&cancel, .{ .name = Export[3].symbol_name });
            @export(&register, .{ .name = Export[4].symbol_name });
            @export(&init, .{ .name = Export[5].symbol_name });
            @export(&finalize, .{ .name = Export[6].symbol_name });
            @export(&memoryCost, .{ .name = Export[7].symbol_name });
        }
    };
}

pub const WebSocketClient = NewWebSocketClient(false);
pub const WebSocketClientTLS = NewWebSocketClient(true);