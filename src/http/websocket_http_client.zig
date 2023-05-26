// This code is based on https://github.com/frmdstryr/zhp/blob/a4b5700c289c3619647206144e10fb414113a888/src/websocket.zig
// Thank you @frmdstryr.
const std = @import("std");
const native_endian = @import("builtin").target.cpu.arch.endian();

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

const uws = @import("root").bun.uws;
const JSC = @import("root").bun.JSC;
const PicoHTTP = @import("root").bun.picohttp;
const ObjectPool = @import("../pool.zig").ObjectPool;
const WebsocketHeader = @import("./websocket.zig").WebsocketHeader;
const WebsocketDataFrame = @import("./websocket.zig").WebsocketDataFrame;
const Opcode = @import("./websocket.zig").Opcode;

const log = Output.scoped(.WebSocketClient, false);

const NonUTF8Headers = struct {
    names: []const JSC.ZigString,
    values: []const JSC.ZigString,

    pub fn format(self: NonUTF8Headers, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        const count = self.names.len;
        var i: usize = 0;
        while (i < count) : (i += 1) {
            try std.fmt.format(writer, "{any}: {any}\r\n", .{ self.names[i], self.values[i] });
        }
    }

    pub fn init(names: ?[*]const JSC.ZigString, values: ?[*]const JSC.ZigString, len: usize) NonUTF8Headers {
        if (len == 0) {
            return .{
                .names = &[_]JSC.ZigString{},
                .values = &[_]JSC.ZigString{},
            };
        }

        return .{
            .names = names.?[0..len],
            .values = values.?[0..len],
        };
    }
};

fn buildRequestBody(
    vm: *JSC.VirtualMachine,
    pathname: *const JSC.ZigString,
    host: *const JSC.ZigString,
    client_protocol: *const JSC.ZigString,
    client_protocol_hash: *u64,
    extra_headers: NonUTF8Headers,
) std.mem.Allocator.Error![]u8 {
    const allocator = vm.allocator;
    const input_rand_buf = vm.rareData().nextUUID();
    const temp_buf_size = comptime std.base64.standard.Encoder.calcSize(16);
    var encoded_buf: [temp_buf_size]u8 = undefined;
    const accept_key = std.base64.standard.Encoder.encode(&encoded_buf, &input_rand_buf);

    var static_headers = [_]PicoHTTP.Header{
        .{
            .name = "Sec-WebSocket-Key",
            .value = accept_key,
        },
        .{
            .name = "Sec-WebSocket-Protocol",
            .value = client_protocol.slice(),
        },
    };

    if (client_protocol.len > 0)
        client_protocol_hash.* = std.hash.Wyhash.hash(0, static_headers[1].value);

    const headers_ = static_headers[0 .. 1 + @as(usize, @boolToInt(client_protocol.len > 0))];

    const pathname_ = pathname.slice();
    const host_ = host.slice();
    const pico_headers = PicoHTTP.Headers{ .headers = headers_ };
    return try std.fmt.allocPrint(
        allocator,
        "GET {s} HTTP/1.1\r\n" ++
            "Host: {s}\r\n" ++
            "Pragma: no-cache\r\n" ++
            "Cache-Control: no-cache\r\n" ++
            "Connection: Upgrade\r\n" ++
            "Upgrade: websocket\r\n" ++
            "Sec-WebSocket-Version: 13\r\n" ++
            "{any}" ++
            "{any}" ++
            "\r\n",
        .{ pathname_, host_, pico_headers, extra_headers },
    );
}

const ErrorCode = enum(i32) {
    cancel,
    invalid_response,
    expected_101_status_code,
    missing_upgrade_header,
    missing_connection_header,
    missing_websocket_accept_header,
    invalid_upgrade_header,
    invalid_connection_header,
    invalid_websocket_version,
    mismatch_websocket_accept_header,
    missing_client_protocol,
    mismatch_client_protocol,
    timeout,
    closed,
    failed_to_write,
    failed_to_connect,
    headers_too_large,
    ended,
    failed_to_allocate_memory,
    control_frame_is_fragmented,
    invalid_control_frame,
    compression_unsupported,
    unexpected_mask_from_server,
    expected_control_frame,
    unsupported_control_frame,
    unexpected_opcode,
    invalid_utf8,
};

pub const JSWebSocket = opaque {
    extern fn WebSocket__didConnect(
        websocket_context: *JSWebSocket,
        socket: *uws.Socket,
        buffered_data: ?[*]u8,
        buffered_len: usize,
    ) void;
    extern fn WebSocket__didCloseWithErrorCode(websocket_context: *JSWebSocket, reason: ErrorCode) void;
    extern fn WebSocket__didReceiveText(websocket_context: *JSWebSocket, clone: bool, text: *const JSC.ZigString) void;
    extern fn WebSocket__didReceiveBytes(websocket_context: *JSWebSocket, bytes: [*]const u8, byte_len: usize) void;

    pub const didConnect = WebSocket__didConnect;
    pub const didCloseWithErrorCode = WebSocket__didCloseWithErrorCode;
    pub const didReceiveText = WebSocket__didReceiveText;
    pub const didReceiveBytes = WebSocket__didReceiveBytes;
};

const body_buf_len = 16384 - 16;
const BodyBufBytes = [body_buf_len]u8;

const BodyBufPool = ObjectPool(BodyBufBytes, null, true, 4);
const BodyBuf = BodyBufPool.Node;

pub fn NewHTTPUpgradeClient(comptime ssl: bool) type {
    return struct {
        pub const Socket = uws.NewSocketHandler(ssl);
        tcp: Socket,
        outgoing_websocket: ?*JSWebSocket,
        input_body_buf: []u8 = &[_]u8{},
        client_protocol: []const u8 = "",
        to_send: []const u8 = "",
        read_length: usize = 0,
        headers_buf: [128]PicoHTTP.Header = undefined,
        body_buf: ?*BodyBuf = null,
        body_written: usize = 0,
        websocket_protocol: u64 = 0,
        hostname: [:0]const u8 = "",
        poll_ref: JSC.PollRef = .{},

        pub const name = if (ssl) "WebSocketHTTPSClient" else "WebSocketHTTPClient";

        pub const shim = JSC.Shimmer("Bun", name, @This());

        const HTTPClient = @This();

        pub fn register(global: *JSC.JSGlobalObject, loop_: *anyopaque, ctx_: *anyopaque) callconv(.C) void {
            var vm = global.bunVM();
            var loop = @ptrCast(*uws.Loop, @alignCast(@alignOf(uws.Loop), loop_));
            var ctx: *uws.SocketContext = @ptrCast(*uws.SocketContext, ctx_);

            if (vm.uws_event_loop) |other| {
                std.debug.assert(other == loop);
            }
            const is_new_loop = vm.uws_event_loop == null;

            vm.uws_event_loop = loop;

            Socket.configure(
                ctx,
                false,
                HTTPClient,
                struct {
                    pub const onOpen = handleOpen;
                    pub const onClose = handleClose;
                    pub const onData = handleData;
                    pub const onWritable = handleWritable;
                    pub const onTimeout = handleTimeout;
                    pub const onConnectError = handleConnectError;
                    pub const onEnd = handleEnd;
                    pub const onHandshake = handleHandshake;
                },
            );
            if (is_new_loop) {
                vm.prepareLoop();
            }
        }

        pub fn connect(
            global: *JSC.JSGlobalObject,
            socket_ctx: *anyopaque,
            websocket: *JSWebSocket,
            host: *const JSC.ZigString,
            port: u16,
            pathname: *const JSC.ZigString,
            client_protocol: *const JSC.ZigString,
            header_names: ?[*]const JSC.ZigString,
            header_values: ?[*]const JSC.ZigString,
            header_count: usize,
        ) callconv(.C) ?*HTTPClient {
            std.debug.assert(global.bunVM().uws_event_loop != null);

            var client_protocol_hash: u64 = 0;
            var body = buildRequestBody(
                global.bunVM(),
                pathname,
                host,
                client_protocol,
                &client_protocol_hash,
                NonUTF8Headers.init(header_names, header_values, header_count),
            ) catch return null;
            var client: HTTPClient = HTTPClient{
                .tcp = undefined,
                .outgoing_websocket = websocket,
                .input_body_buf = body,
                .websocket_protocol = client_protocol_hash,
            };
            var host_ = host.toSlice(bun.default_allocator);
            defer host_.deinit();
            var vm = global.bunVM();
            const prev_start_server_on_next_tick = vm.eventLoop().start_server_on_next_tick;
            vm.eventLoop().start_server_on_next_tick = true;
            client.poll_ref.ref(vm);
            const display_host_ = host_.slice();
            const display_host = if (bun.FeatureFlags.hardcode_localhost_to_127_0_0_1 and strings.eqlComptime(display_host_, "localhost"))
                "127.0.0.1"
            else
                display_host_;

            if (Socket.connect(
                display_host,
                port,
                @ptrCast(*uws.SocketContext, socket_ctx),
                HTTPClient,
                client,
                "tcp",
            )) |out| {
                if (comptime ssl) {
                    if (!strings.isIPAddress(host_.slice())) {
                        out.hostname = bun.default_allocator.dupeZ(u8, host_.slice()) catch "";
                    }
                }

                out.tcp.timeout(120);
                return out;
            }
            vm.eventLoop().start_server_on_next_tick = prev_start_server_on_next_tick;

            client.clearData();

            return null;
        }

        pub fn clearInput(this: *HTTPClient) void {
            if (this.input_body_buf.len > 0) bun.default_allocator.free(this.input_body_buf);
            this.input_body_buf.len = 0;
        }
        pub fn clearData(this: *HTTPClient) void {
            this.poll_ref.unrefOnNextTick(JSC.VirtualMachine.get());

            this.clearInput();
            if (this.body_buf) |buf| {
                this.body_buf = null;
                buf.release();
            }
        }
        pub fn cancel(this: *HTTPClient) callconv(.C) void {
            this.clearData();

            if (!this.tcp.isEstablished()) {
                _ = uws.us_socket_close_connecting(comptime @as(c_int, @boolToInt(ssl)), this.tcp.socket);
            } else {
                this.tcp.close(0, null);
            }
        }

        pub fn fail(this: *HTTPClient, code: ErrorCode) void {
            log("onFail", .{});
            JSC.markBinding(@src());
            if (this.outgoing_websocket) |ws| {
                this.outgoing_websocket = null;
                ws.didCloseWithErrorCode(code);
            }

            this.cancel();
        }

        pub fn handleClose(this: *HTTPClient, _: Socket, _: c_int, _: ?*anyopaque) void {
            log("onClose", .{});
            JSC.markBinding(@src());
            this.clearData();
            if (this.outgoing_websocket) |ws| {
                this.outgoing_websocket = null;
                ws.didCloseWithErrorCode(ErrorCode.ended);
            }
        }

        pub fn terminate(this: *HTTPClient, code: ErrorCode) void {
            this.fail(code);
            if (!this.tcp.isClosed())
                this.tcp.close(0, null);
        }

        pub fn handleHandshake(this: *HTTPClient, socket: Socket, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
            _ = socket;
            _ = ssl_error;
            log("onHandshake({d})", .{success});
            if (success == 0) {
                this.fail(ErrorCode.failed_to_connect);
            }
        }

        pub fn handleOpen(this: *HTTPClient, socket: Socket) void {
            log("onOpen", .{});
            std.debug.assert(socket.socket == this.tcp.socket);

            std.debug.assert(this.input_body_buf.len > 0);
            std.debug.assert(this.to_send.len == 0);

            if (comptime ssl) {
                if (this.hostname.len > 0) {
                    socket.getNativeHandle().configureHTTPClient(this.hostname);
                    bun.default_allocator.free(this.hostname);
                    this.hostname = "";
                }
            }

            const wrote = socket.write(this.input_body_buf, true);
            if (wrote < 0) {
                this.terminate(ErrorCode.failed_to_write);
                return;
            }

            this.to_send = this.input_body_buf[@intCast(usize, wrote)..];
        }

        fn getBody(this: *HTTPClient) *BodyBufBytes {
            if (this.body_buf == null) {
                this.body_buf = BodyBufPool.get(bun.default_allocator);
            }

            return &this.body_buf.?.data;
        }

        pub fn handleData(this: *HTTPClient, socket: Socket, data: []const u8) void {
            log("onData", .{});
            std.debug.assert(socket.socket == this.tcp.socket);
            if (this.outgoing_websocket == null) {
                this.clearData();
                return;
            }

            if (comptime Environment.allow_assert)
                std.debug.assert(!socket.isShutdown());

            var body = this.getBody();
            var remain = body[this.body_written..];
            const is_first = this.body_written == 0;
            if (is_first) {
                // fail early if we receive a non-101 status code
                if (!strings.hasPrefixComptime(data, "HTTP/1.1 101 ")) {
                    this.terminate(ErrorCode.expected_101_status_code);
                    return;
                }
            }

            const to_write = remain[0..@min(remain.len, data.len)];
            if (data.len > 0 and to_write.len > 0) {
                @memcpy(remain.ptr, data.ptr, to_write.len);
                this.body_written += to_write.len;
            }

            const overflow = data[to_write.len..];

            const available_to_read = body[0..this.body_written];
            const response = PicoHTTP.Response.parse(available_to_read, &this.headers_buf) catch |err| {
                switch (err) {
                    error.Malformed_HTTP_Response => {
                        this.terminate(ErrorCode.invalid_response);
                        return;
                    },
                    error.ShortRead => {
                        if (overflow.len > 0) {
                            this.terminate(ErrorCode.headers_too_large);
                            return;
                        }
                        return;
                    },
                }
            };

            this.processResponse(response, available_to_read[@intCast(usize, response.bytes_read)..]);
        }

        pub fn handleEnd(this: *HTTPClient, socket: Socket) void {
            log("onEnd", .{});
            std.debug.assert(socket.socket == this.tcp.socket);
            this.terminate(ErrorCode.ended);
        }

        pub fn processResponse(this: *HTTPClient, response: PicoHTTP.Response, remain_buf: []const u8) void {
            std.debug.assert(this.body_written > 0);

            var upgrade_header = PicoHTTP.Header{ .name = "", .value = "" };
            var connection_header = PicoHTTP.Header{ .name = "", .value = "" };
            var websocket_accept_header = PicoHTTP.Header{ .name = "", .value = "" };
            var visited_protocol = this.websocket_protocol == 0;
            // var visited_version = false;
            std.debug.assert(response.status_code == 101);

            for (response.headers) |header| {
                switch (header.name.len) {
                    "Connection".len => {
                        if (connection_header.name.len == 0 and strings.eqlCaseInsensitiveASCII(header.name, "Connection", false)) {
                            connection_header = header;
                            if (visited_protocol and upgrade_header.name.len > 0 and connection_header.name.len > 0 and websocket_accept_header.name.len > 0) {
                                break;
                            }
                        }
                    },
                    "Upgrade".len => {
                        if (upgrade_header.name.len == 0 and strings.eqlCaseInsensitiveASCII(header.name, "Upgrade", false)) {
                            upgrade_header = header;
                            if (visited_protocol and upgrade_header.name.len > 0 and connection_header.name.len > 0 and websocket_accept_header.name.len > 0) {
                                break;
                            }
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
                            if (visited_protocol and upgrade_header.name.len > 0 and connection_header.name.len > 0 and websocket_accept_header.name.len > 0) {
                                break;
                            }
                        }
                    },
                    "Sec-WebSocket-Protocol".len => {
                        if (strings.eqlCaseInsensitiveASCII(header.name, "Sec-WebSocket-Protocol", false)) {
                            if (this.websocket_protocol == 0 or std.hash.Wyhash.hash(0, header.value) != this.websocket_protocol) {
                                this.terminate(ErrorCode.mismatch_client_protocol);
                                return;
                            }
                            visited_protocol = true;

                            if (visited_protocol and upgrade_header.name.len > 0 and connection_header.name.len > 0 and websocket_accept_header.name.len > 0) {
                                break;
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

            if (!visited_protocol) {
                this.terminate(ErrorCode.mismatch_client_protocol);
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
                if (remain_buf.len > 0) @memcpy(overflow.ptr, remain_buf.ptr, remain_buf.len);
            }

            this.clearData();
            JSC.markBinding(@src());
            this.tcp.timeout(0);
            log("onDidConnect", .{});

            this.outgoing_websocket.?.didConnect(this.tcp.socket, overflow.ptr, overflow.len);
        }

        pub fn handleWritable(
            this: *HTTPClient,
            socket: Socket,
        ) void {
            std.debug.assert(socket.socket == this.tcp.socket);

            if (this.to_send.len == 0)
                return;

            const wrote = socket.write(this.to_send, true);
            if (wrote < 0) {
                this.terminate(ErrorCode.failed_to_write);
                return;
            }
            this.to_send = this.to_send[@min(@intCast(usize, wrote), this.to_send.len)..];
        }
        pub fn handleTimeout(
            this: *HTTPClient,
            _: Socket,
        ) void {
            this.terminate(ErrorCode.timeout);
        }
        pub fn handleConnectError(this: *HTTPClient, _: Socket, _: c_int) void {
            this.terminate(ErrorCode.failed_to_connect);
        }

        pub const Export = shim.exportFunctions(.{
            .connect = connect,
            .cancel = cancel,
            .register = register,
        });

        comptime {
            if (!JSC.is_bindgen) {
                @export(connect, .{
                    .name = Export[0].symbol_name,
                });
                @export(cancel, .{
                    .name = Export[1].symbol_name,
                });
                @export(register, .{
                    .name = Export[2].symbol_name,
                });
            }
        }
    };
}

pub const Mask = struct {
    pub fn fill(globalThis: *JSC.JSGlobalObject, mask_buf: *[4]u8, output_: []u8, input_: []const u8) void {
        mask_buf.* = globalThis.bunVM().rareData().entropySlice(4)[0..4].*;
        const mask = mask_buf.*;

        const skip_mask = @bitCast(u32, mask) == 0;
        if (!skip_mask) {
            fillWithSkipMask(mask, output_, input_, false);
        } else {
            fillWithSkipMask(mask, output_, input_, true);
        }
    }

    fn fillWithSkipMask(mask: [4]u8, output_: []u8, input_: []const u8, comptime skip_mask: bool) void {
        var input = input_;
        var output = output_;

        if (comptime Environment.enableSIMD) {
            if (input.len >= strings.ascii_vector_size) {
                const vec: strings.AsciiVector = brk: {
                    var in: [strings.ascii_vector_size]u8 = undefined;
                    comptime var i: usize = 0;
                    inline while (i < strings.ascii_vector_size) : (i += 4) {
                        in[i..][0..4].* = mask;
                    }
                    break :brk @as(strings.AsciiVector, in);
                };
                const end_ptr_wrapped_to_last_16 = input.ptr + input.len - (input.len % strings.ascii_vector_size);

                if (comptime skip_mask) {
                    while (input.ptr != end_ptr_wrapped_to_last_16) {
                        const input_vec: strings.AsciiVector = @as(strings.AsciiVector, input[0..strings.ascii_vector_size].*);
                        output.ptr[0..strings.ascii_vector_size].* = input_vec;
                        output = output[strings.ascii_vector_size..];
                        input = input[strings.ascii_vector_size..];
                    }
                } else {
                    while (input.ptr != end_ptr_wrapped_to_last_16) {
                        const input_vec: strings.AsciiVector = @as(strings.AsciiVector, input[0..strings.ascii_vector_size].*);
                        output.ptr[0..strings.ascii_vector_size].* = input_vec ^ vec;
                        output = output[strings.ascii_vector_size..];
                        input = input[strings.ascii_vector_size..];
                    }
                }
            }

            // hint to the compiler not to vectorize the next loop
            std.debug.assert(input.len < strings.ascii_vector_size);
        }

        if (comptime !skip_mask) {
            while (input.len >= 4) {
                const input_vec: [4]u8 = input[0..4].*;
                output.ptr[0..4].* = [4]u8{
                    input_vec[0] ^ mask[0],
                    input_vec[1] ^ mask[1],
                    input_vec[2] ^ mask[2],
                    input_vec[3] ^ mask[3],
                };
                output = output[4..];
                input = input[4..];
            }
        } else {
            while (input.len >= 4) {
                const input_vec: [4]u8 = input[0..4].*;
                output.ptr[0..4].* = input_vec;
                output = output[4..];
                input = input[4..];
            }
        }

        if (comptime !skip_mask) {
            for (input, 0..) |c, i| {
                output[i] = c ^ mask[i % 4];
            }
        } else {
            for (input, 0..) |c, i| {
                output[i] = c;
            }
        }
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
    const header = @bitCast(WebsocketHeader, @byteSwap(@bitCast(u16, bytes)));
    const payload = @as(usize, header.len);
    payload_length.* = payload;
    receiving_type.* = header.opcode;
    is_fragmented.* = switch (header.opcode) {
        .Continue => true,
        else => false,
    } or !header.final;
    is_final.* = header.final;
    need_compression.* = header.compressed;

    if (header.mask and (header.opcode == .Text or header.opcode == .Binary)) {
        return .need_mask;
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
        .Close => ReceiveState.close,
        .Ping => ReceiveState.ping,
        .Pong => ReceiveState.pong,
        else => ReceiveState.fail,
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
                byte_len.* = strings.elementLengthUTF16IntoUTF8([]const u16, this.utf16);
                return WebsocketHeader.frameSizeIncludingMask(byte_len.*);
            },
            .latin1 => {
                byte_len.* = this.latin1.len;
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

    pub fn copy(this: @This(), globalThis: *JSC.JSGlobalObject, buf: []u8, content_byte_len: usize) void {
        if (this == .raw) {
            std.debug.assert(buf.len >= this.raw.len);
            std.debug.assert(buf.ptr != this.raw.ptr);
            @memcpy(buf.ptr, this.raw.ptr, this.raw.len);
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

        var header = @bitCast(WebsocketHeader, @as(u16, 0));

        // Write extended length if needed
        switch (how_big_is_the_length_integer) {
            0 => {},
            2 => std.mem.writeIntBig(u16, buf[2..][0..2], @truncate(u16, content_byte_len)),
            8 => std.mem.writeIntBig(u64, buf[2..][0..8], @truncate(u64, content_byte_len)),
            else => unreachable,
        }

        header.mask = true;
        header.compressed = false;
        header.final = true;

        std.debug.assert(WebsocketHeader.frameSizeIncludingMask(content_byte_len) == buf.len);

        switch (this) {
            .utf16 => |utf16| {
                header.len = WebsocketHeader.packLength(content_byte_len);
                const encode_into_result = strings.copyUTF16IntoUTF8(to_mask, []const u16, utf16, true);
                std.debug.assert(@as(usize, encode_into_result.written) == content_byte_len);
                std.debug.assert(@as(usize, encode_into_result.read) == utf16.len);
                header.len = WebsocketHeader.packLength(encode_into_result.written);
                header.opcode = Opcode.Text;
                var fib = std.io.fixedBufferStream(buf);
                header.writeHeader(fib.writer(), encode_into_result.written) catch unreachable;

                Mask.fill(globalThis, buf[mask_offset..][0..4], to_mask[0..content_byte_len], to_mask[0..content_byte_len]);
            },
            .latin1 => |latin1| {
                const encode_into_result = strings.copyLatin1IntoUTF8(to_mask, []const u8, latin1);
                std.debug.assert(@as(usize, encode_into_result.written) == content_byte_len);
                std.debug.assert(@as(usize, encode_into_result.read) == latin1.len);
                header.len = WebsocketHeader.packLength(encode_into_result.written);
                header.opcode = Opcode.Text;
                var fib = std.io.fixedBufferStream(buf);
                header.writeHeader(fib.writer(), encode_into_result.written) catch unreachable;
                Mask.fill(globalThis, buf[mask_offset..][0..4], to_mask[0..content_byte_len], to_mask[0..content_byte_len]);
            },
            .bytes => |bytes| {
                header.len = WebsocketHeader.packLength(bytes.len);
                header.opcode = Opcode.Binary;
                var fib = std.io.fixedBufferStream(buf);
                header.writeHeader(fib.writer(), bytes.len) catch unreachable;
                Mask.fill(globalThis, buf[mask_offset..][0..4], to_mask[0..content_byte_len], bytes);
            },
            .raw => unreachable,
        }
    }
};

pub fn NewWebSocketClient(comptime ssl: bool) type {
    return struct {
        pub const Socket = uws.NewSocketHandler(ssl);
        tcp: Socket,
        outgoing_websocket: ?*JSWebSocket = null,

        receive_state: ReceiveState = ReceiveState.need_header,
        receive_header: WebsocketHeader = @bitCast(WebsocketHeader, @as(u16, 0)),
        receiving_type: Opcode = Opcode.ResB,

        ping_frame_bytes: [128 + 6]u8 = [_]u8{0} ** (128 + 6),
        ping_len: u8 = 0,

        receive_frame: usize = 0,
        receive_body_remain: usize = 0,
        receive_pending_chunk_len: usize = 0,
        receive_buffer: bun.LinearFifo(u8, .Dynamic),

        send_buffer: bun.LinearFifo(u8, .Dynamic),

        globalThis: *JSC.JSGlobalObject,
        poll_ref: JSC.PollRef = JSC.PollRef.init(),

        pub const name = if (ssl) "WebSocketClientTLS" else "WebSocketClient";

        pub const shim = JSC.Shimmer("Bun", name, @This());
        const stack_frame_size = 1024;

        const WebSocket = @This();

        pub fn register(global: *JSC.JSGlobalObject, loop_: *anyopaque, ctx_: *anyopaque) callconv(.C) void {
            var vm = global.bunVM();
            var loop = @ptrCast(*uws.Loop, @alignCast(@alignOf(uws.Loop), loop_));

            var ctx: *uws.SocketContext = @ptrCast(*uws.SocketContext, ctx_);

            if (vm.uws_event_loop) |other| {
                std.debug.assert(other == loop);
            }

            vm.uws_event_loop = loop;

            Socket.configure(
                ctx,
                false,
                WebSocket,
                struct {
                    pub const onClose = handleClose;
                    pub const onData = handleData;
                    pub const onWritable = handleWritable;
                    pub const onTimeout = handleTimeout;
                    pub const onConnectError = handleConnectError;
                    pub const onEnd = handleEnd;
                    // just by adding it will fix ssl handshake
                    pub const onHandshake = handleHandshake;
                },
            );
        }

        pub fn clearData(this: *WebSocket) void {
            this.poll_ref.unrefOnNextTick(this.globalThis.bunVM());
            this.clearReceiveBuffers(true);
            this.clearSendBuffers(true);
            this.ping_len = 0;
            this.receive_pending_chunk_len = 0;
        }

        pub fn cancel(this: *WebSocket) callconv(.C) void {
            this.clearData();

            if (this.tcp.isClosed() or this.tcp.isShutdown())
                return;

            if (!this.tcp.isEstablished()) {
                _ = uws.us_socket_close_connecting(comptime @as(c_int, @boolToInt(ssl)), this.tcp.socket);
            } else {
                this.tcp.close(0, null);
            }
        }

        pub fn fail(this: *WebSocket, code: ErrorCode) void {
            JSC.markBinding(@src());
            if (this.outgoing_websocket) |ws| {
                this.outgoing_websocket = null;
                ws.didCloseWithErrorCode(code);
            }

            this.cancel();
        }

        pub fn handleHandshake(this: *WebSocket, socket: Socket, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
            _ = socket;
            _ = ssl_error;
            JSC.markBinding(@src());
            log("WebSocket.onHandshake({d})", .{success});
            if (success == 0) {
                if (this.outgoing_websocket) |ws| {
                    this.outgoing_websocket = null;
                    ws.didCloseWithErrorCode(ErrorCode.failed_to_connect);
                }
            }
        }
        pub fn handleClose(this: *WebSocket, _: Socket, _: c_int, _: ?*anyopaque) void {
            log("onClose", .{});
            JSC.markBinding(@src());
            this.clearData();
            if (this.outgoing_websocket) |ws| {
                this.outgoing_websocket = null;
                ws.didCloseWithErrorCode(ErrorCode.ended);
            }
        }

        pub fn terminate(this: *WebSocket, code: ErrorCode) void {
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
                    const utf16_bytes_ = strings.toUTF16Alloc(bun.default_allocator, data_, true) catch {
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
                .Binary => {
                    JSC.markBinding(@src());
                    out.didReceiveBytes(data_.ptr, data_.len);
                },
                else => unreachable,
            }
        }

        pub fn consume(this: *WebSocket, data_: []const u8, left_in_fragment: usize, kind: Opcode, is_final: bool) usize {
            std.debug.assert(kind == .Text or kind == .Binary);
            std.debug.assert(data_.len <= left_in_fragment);

            // did all the data fit in the buffer?
            // we can avoid copying & allocating a temporary buffer
            if (is_final and data_.len == left_in_fragment and this.receive_pending_chunk_len == 0) {
                this.dispatchData(data_, kind);
                return data_.len;
            }

            // this must come after the above check
            std.debug.assert(data_.len > 0);

            var writable = this.receive_buffer.writableWithSize(data_.len) catch unreachable;
            @memcpy(writable.ptr, data_.ptr, data_.len);
            this.receive_buffer.update(data_.len);

            if (left_in_fragment >= data_.len and left_in_fragment - data_.len - this.receive_pending_chunk_len == 0) {
                this.receive_pending_chunk_len = 0;
                this.dispatchData(this.receive_buffer.readableSlice(0), kind);
                this.clearReceiveBuffers(false);
            } else {
                this.receive_pending_chunk_len -|= left_in_fragment;
            }
            return data_.len;
        }

        pub fn handleData(this: *WebSocket, socket: Socket, data_: []const u8) void {
            var data = data_;
            var receive_state = this.receive_state;
            var terminated = false;
            var is_fragmented = false;
            var receiving_type = this.receiving_type;
            var receive_body_remain = this.receive_body_remain;
            var is_final = false;
            var last_receive_data_type = receiving_type;

            defer {
                if (!terminated) {
                    this.receive_state = receive_state;
                    this.receiving_type = last_receive_data_type;
                    this.receive_body_remain = receive_body_remain;

                    // if we receive multiple pings in a row
                    // we just send back the last one
                    if (this.ping_len > 0) {
                        _ = this.sendPong(socket);
                        this.ping_len = 0;
                    }
                }
            }

            var header_bytes: [@sizeOf(usize)]u8 = [_]u8{0} ** @sizeOf(usize);
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
                            this.terminate(ErrorCode.control_frame_is_fragmented);
                            terminated = true;
                            break;
                        }

                        header_bytes[0..2].* = data[0..2].*;
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

                        last_receive_data_type =
                            if (receiving_type == .Text or receiving_type == .Binary)
                            receiving_type
                        else
                            last_receive_data_type;

                        data = data[2..];

                        if (receiving_type.isControl() and is_fragmented) {
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

                        if (need_compression) {
                            this.terminate(ErrorCode.compression_unsupported);
                            terminated = true;
                            break;
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

                        if (data.len < byte_size) {
                            this.terminate(ErrorCode.control_frame_is_fragmented);
                            terminated = true;
                            break;
                        }

                        // Multibyte length quantities are expressed in network byte order
                        receive_body_remain = switch (byte_size) {
                            8 => @as(usize, std.mem.readIntBig(u64, data[0..8])),
                            2 => @as(usize, std.mem.readIntBig(u16, data[0..2])),
                            else => unreachable,
                        };
                        data = data[byte_size..];
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
                        const ping_len = @min(data.len, @min(receive_body_remain, 125));
                        this.ping_len = @truncate(u8, ping_len);

                        if (ping_len > 0) {
                            @memcpy(this.ping_frame_bytes[6..], data.ptr, ping_len);
                            data = data[ping_len..];
                        }

                        receive_state = .need_header;
                        receive_body_remain = 0;
                        receiving_type = last_receive_data_type;

                        if (data.len == 0) break;
                    },
                    .pong => {
                        const pong_len = @min(data.len, @min(receive_body_remain, this.ping_frame_bytes.len));
                        data = data[pong_len..];
                        receive_state = .need_header;
                        receiving_type = last_receive_data_type;
                        if (data.len == 0) break;
                    },
                    .need_body => {
                        if (receive_body_remain == 0 and data.len > 0) {
                            this.terminate(ErrorCode.expected_control_frame);
                            terminated = true;
                            break;
                        }
                        if (data.len == 0) return;

                        const to_consume = @min(receive_body_remain, data.len);

                        const consumed = this.consume(data[0..to_consume], receive_body_remain, last_receive_data_type, is_final);
                        if (consumed == 0 and last_receive_data_type == .Text) {
                            this.terminate(ErrorCode.invalid_utf8);
                            terminated = true;
                            break;
                        }

                        receive_body_remain -= consumed;
                        data = data[to_consume..];
                        if (receive_body_remain == 0) {
                            receive_state = .need_header;
                            is_fragmented = false;
                        }

                        if (data.len == 0) break;
                    },

                    .close => {
                        // closing frame data is text only.

                        // 2 byte close code
                        if (data.len > 2 and receive_body_remain >= 2) {
                            _ = this.consume(data[2..receive_body_remain], receive_body_remain - 2, .Text, true);
                            data = data[receive_body_remain..];
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
            this.sendCloseWithBody(this.tcp, 1001, null, 0);
        }

        fn enqueueEncodedBytesMaybeFinal(
            this: *WebSocket,
            socket: Socket,
            bytes: []const u8,
            is_closing: bool,
        ) bool {
            // fast path: no backpressure, no queue, just send the bytes.
            if (!this.hasBackpressure()) {
                const wrote = socket.write(bytes, !is_closing);
                const expected = @intCast(c_int, bytes.len);
                if (wrote == expected) {
                    return true;
                }

                if (wrote < 0) {
                    this.terminate(ErrorCode.failed_to_write);
                    return false;
                }

                _ = this.copyToSendBuffer(bytes[@intCast(usize, wrote)..], false, is_closing);
                return true;
            }

            return this.copyToSendBuffer(bytes, true, is_closing);
        }

        fn copyToSendBuffer(this: *WebSocket, bytes: []const u8, do_write: bool, is_closing: bool) bool {
            return this.sendData(.{ .raw = bytes }, do_write, is_closing);
        }

        fn sendData(this: *WebSocket, bytes: Copy, do_write: bool, is_closing: bool) bool {
            var content_byte_len: usize = 0;
            const write_len = bytes.len(&content_byte_len);
            std.debug.assert(write_len > 0);

            var writable = this.send_buffer.writableWithSize(write_len) catch unreachable;
            bytes.copy(this.globalThis, writable[0..write_len], content_byte_len);
            this.send_buffer.update(write_len);

            if (do_write) {
                if (comptime Environment.allow_assert) {
                    std.debug.assert(!this.tcp.isShutdown());
                    std.debug.assert(!this.tcp.isClosed());
                    std.debug.assert(this.tcp.isEstablished());
                }
                return this.sendBuffer(this.send_buffer.readableSlice(0), is_closing, !is_closing);
            }

            return true;
        }

        fn sendBuffer(
            this: *WebSocket,
            out_buf: []const u8,
            is_closing: bool,
            _: bool,
        ) bool {
            std.debug.assert(out_buf.len > 0);
            _ = is_closing;
            // set msg_more to false
            // it seems to improve perf by ~20%
            const wrote = this.tcp.write(out_buf, false);
            if (wrote < 0) {
                this.terminate(ErrorCode.failed_to_write);
                return false;
            }
            const expected = @intCast(usize, wrote);
            var readable = this.send_buffer.readableSlice(0);
            if (readable.ptr == out_buf.ptr) {
                this.send_buffer.discard(expected);
            }

            return true;
        }

        fn enqueueEncodedBytes(this: *WebSocket, socket: Socket, bytes: []const u8) bool {
            return this.enqueueEncodedBytesMaybeFinal(socket, bytes, false);
        }

        fn sendPong(this: *WebSocket, socket: Socket) bool {
            if (socket.isClosed() or socket.isShutdown()) {
                this.dispatchClose();
                return false;
            }

            var header = @bitCast(WebsocketHeader, @as(u16, 0));
            header.final = true;
            header.opcode = .Pong;

            var to_mask = this.ping_frame_bytes[6..][0..this.ping_len];

            header.mask = to_mask.len > 0;
            header.len = @truncate(u7, this.ping_len);
            this.ping_frame_bytes[0..2].* = @bitCast([2]u8, header);

            if (to_mask.len > 0) {
                Mask.fill(this.globalThis, this.ping_frame_bytes[2..6], to_mask, to_mask);
                return this.enqueueEncodedBytes(socket, this.ping_frame_bytes[0 .. 6 + @as(usize, this.ping_len)]);
            } else {
                return this.enqueueEncodedBytes(socket, this.ping_frame_bytes[0..2]);
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
                this.dispatchClose();
                this.clearData();
                return;
            }

            socket.shutdownRead();
            var final_body_bytes: [128 + 8]u8 = undefined;
            var header = @bitCast(WebsocketHeader, @as(u16, 0));
            header.final = true;
            header.opcode = .Close;
            header.mask = true;
            header.len = @truncate(u7, body_len + 2);
            final_body_bytes[0..2].* = @bitCast([2]u8, @bitCast(u16, header));
            var mask_buf: *[4]u8 = final_body_bytes[2..6];
            std.mem.writeIntSliceBig(u16, final_body_bytes[6..8], code);

            if (body) |data| {
                if (body_len > 0) @memcpy(final_body_bytes[8..], data, body_len);
            }

            // we must mask the code
            var slice = final_body_bytes[0..(8 + body_len)];
            Mask.fill(this.globalThis, mask_buf, slice[6..], slice[6..]);

            if (this.enqueueEncodedBytesMaybeFinal(socket, slice, true)) {
                this.dispatchClose();
                this.clearData();
            }
        }

        pub fn handleEnd(this: *WebSocket, socket: Socket) void {
            std.debug.assert(socket.socket == this.tcp.socket);
            this.terminate(ErrorCode.ended);
        }

        pub fn handleWritable(
            this: *WebSocket,
            socket: Socket,
        ) void {
            std.debug.assert(socket.socket == this.tcp.socket);
            const send_buf = this.send_buffer.readableSlice(0);
            if (send_buf.len == 0)
                return;
            _ = this.sendBuffer(send_buf, false, true);
        }
        pub fn handleTimeout(
            this: *WebSocket,
            _: Socket,
        ) void {
            this.terminate(ErrorCode.timeout);
        }
        pub fn handleConnectError(this: *WebSocket, _: Socket, _: c_int) void {
            this.terminate(ErrorCode.failed_to_connect);
        }

        pub fn hasBackpressure(this: *const WebSocket) bool {
            return this.send_buffer.count > 0;
        }

        pub fn writeBinaryData(
            this: *WebSocket,
            ptr: [*]const u8,
            len: usize,
        ) callconv(.C) void {
            if (this.tcp.isClosed() or this.tcp.isShutdown()) {
                this.dispatchClose();
                return;
            }

            if (len == 0)
                return;

            const slice = ptr[0..len];
            const bytes = Copy{ .bytes = slice };
            // fast path: small frame, no backpressure, attempt to send without allocating
            const frame_size = WebsocketHeader.frameSizeIncludingMask(len);
            if (!this.hasBackpressure() and frame_size < stack_frame_size) {
                var inline_buf: [stack_frame_size]u8 = undefined;
                bytes.copy(this.globalThis, inline_buf[0..frame_size], slice.len);
                _ = this.enqueueEncodedBytes(this.tcp, inline_buf[0..frame_size]);
                return;
            }

            _ = this.sendData(bytes, !this.hasBackpressure(), false);
        }
        pub fn writeString(
            this: *WebSocket,
            str_: *const JSC.ZigString,
        ) callconv(.C) void {
            const str = str_.*;
            if (this.tcp.isClosed() or this.tcp.isShutdown()) {
                this.dispatchClose();
                return;
            }

            if (str.len == 0) {
                return;
            }

            {
                var inline_buf: [stack_frame_size]u8 = undefined;

                // fast path: small frame, no backpressure, attempt to send without allocating
                if (!str.is16Bit() and str.len < stack_frame_size) {
                    const bytes = Copy{ .latin1 = str.slice() };
                    const frame_size = WebsocketHeader.frameSizeIncludingMask(str.len);
                    if (!this.hasBackpressure() and frame_size < stack_frame_size) {
                        bytes.copy(this.globalThis, inline_buf[0..frame_size], str.len);
                        _ = this.enqueueEncodedBytes(this.tcp, inline_buf[0..frame_size]);
                        return;
                    }
                    // max length of a utf16 -> utf8 conversion is 4 times the length of the utf16 string
                } else if ((str.len * 4) < (stack_frame_size) and !this.hasBackpressure()) {
                    const bytes = Copy{ .utf16 = str.utf16SliceAligned() };
                    var byte_len: usize = 0;
                    const frame_size = bytes.len(&byte_len);
                    std.debug.assert(frame_size <= stack_frame_size);
                    bytes.copy(this.globalThis, inline_buf[0..frame_size], byte_len);
                    _ = this.enqueueEncodedBytes(this.tcp, inline_buf[0..frame_size]);
                    return;
                }
            }

            _ = this.sendData(
                if (str.is16Bit())
                    Copy{ .utf16 = str.utf16SliceAligned() }
                else
                    Copy{ .latin1 = str.slice() },
                !this.hasBackpressure(),
                false,
            );
        }

        fn dispatchClose(this: *WebSocket) void {
            var out = this.outgoing_websocket orelse return;
            this.poll_ref.unrefOnNextTick(this.globalThis.bunVM());
            JSC.markBinding(@src());
            this.outgoing_websocket = null;
            out.didCloseWithErrorCode(ErrorCode.closed);
        }

        pub fn close(this: *WebSocket, code: u16, reason: ?*const JSC.ZigString) callconv(.C) void {
            if (this.tcp.isClosed() or this.tcp.isShutdown())
                return;

            var close_reason_buf: [128]u8 = undefined;
            if (reason) |str| {
                inner: {
                    var fixed_buffer = std.heap.FixedBufferAllocator.init(&close_reason_buf);
                    const allocator = fixed_buffer.allocator();
                    const wrote = std.fmt.allocPrint(allocator, "{}", .{str.*}) catch break :inner;
                    this.sendCloseWithBody(this.tcp, code, wrote.ptr[0..125], wrote.len);
                    return;
                }
            }

            this.sendCloseWithBody(this.tcp, code, null, 0);
        }

        pub fn init(
            outgoing: *JSWebSocket,
            input_socket: *anyopaque,
            socket_ctx: *anyopaque,
            globalThis: *JSC.JSGlobalObject,
            buffered_data: [*]u8,
            buffered_data_len: usize,
        ) callconv(.C) ?*anyopaque {
            var tcp = @ptrCast(*uws.Socket, input_socket);
            var ctx = @ptrCast(*uws.SocketContext, socket_ctx);
            var adopted = Socket.adopt(
                tcp,
                ctx,
                WebSocket,
                "tcp",
                WebSocket{
                    .tcp = undefined,
                    .outgoing_websocket = outgoing,
                    .globalThis = globalThis,
                    .send_buffer = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator),
                    .receive_buffer = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator),
                },
            ) orelse return null;
            adopted.send_buffer.ensureTotalCapacity(2048) catch return null;
            adopted.receive_buffer.ensureTotalCapacity(2048) catch return null;
            adopted.poll_ref.ref(globalThis.bunVM());

            var buffered_slice: []u8 = buffered_data[0..buffered_data_len];
            if (buffered_slice.len > 0) {
                const InitialDataHandler = struct {
                    adopted: *WebSocket,
                    slice: []u8,
                    task: JSC.AnyTask = undefined,

                    pub const Handle = JSC.AnyTask.New(@This(), handle);

                    pub fn handle(this: *@This()) void {
                        defer {
                            bun.default_allocator.free(this.slice);
                            bun.default_allocator.destroy(this);
                        }

                        this.adopted.receive_buffer.ensureUnusedCapacity(this.slice.len) catch return;
                        var writable = this.adopted.receive_buffer.writableSlice(0);
                        @memcpy(writable.ptr, this.slice.ptr, this.slice.len);

                        this.adopted.handleData(this.adopted.tcp, writable);
                    }
                };
                var initial_data = bun.default_allocator.create(InitialDataHandler) catch unreachable;
                initial_data.* = .{
                    .adopted = adopted,
                    .slice = buffered_slice,
                };
                initial_data.task = InitialDataHandler.Handle.init(initial_data);
                globalThis.bunVM().eventLoop().enqueueTask(JSC.Task.init(&initial_data.task));
            }
            return @ptrCast(
                *anyopaque,
                adopted,
            );
        }

        pub fn finalize(this: *WebSocket) callconv(.C) void {
            log("finalize", .{});
            this.clearData();

            this.outgoing_websocket = null;

            if (this.tcp.isClosed())
                return;

            this.tcp.close(0, null);
        }

        pub const Export = shim.exportFunctions(.{
            .writeBinaryData = writeBinaryData,
            .writeString = writeString,
            .close = close,
            .register = register,
            .init = init,
            .finalize = finalize,
        });

        comptime {
            if (!JSC.is_bindgen) {
                @export(writeBinaryData, .{ .name = Export[0].symbol_name });
                @export(writeString, .{ .name = Export[1].symbol_name });
                @export(close, .{ .name = Export[2].symbol_name });
                @export(register, .{ .name = Export[3].symbol_name });
                @export(init, .{ .name = Export[4].symbol_name });
                @export(finalize, .{ .name = Export[5].symbol_name });
            }
        }
    };
}

pub const WebSocketHTTPClient = NewHTTPUpgradeClient(false);
pub const WebSocketHTTPSClient = NewHTTPUpgradeClient(true);
pub const WebSocketClient = NewWebSocketClient(false);
pub const WebSocketClientTLS = NewWebSocketClient(true);
