// This code is based on https://github.com/frmdstryr/zhp/blob/a4b5700c289c3619647206144e10fb414113a888/src/websocket.zig
// Thank you @frmdstryr.
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
const uws = @import("root").bun.uws;
const JSC = @import("root").bun.JSC;
const PicoHTTP = @import("root").bun.picohttp;
const ObjectPool = @import("../pool.zig").ObjectPool;
const WebsocketHeader = @import("./websocket.zig").WebsocketHeader;
const WebsocketDataFrame = @import("./websocket.zig").WebsocketDataFrame;
const Opcode = @import("./websocket.zig").Opcode;
const ZigURL = @import("../url.zig").URL;

const Async = bun.Async;

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
    is_https: bool,
    host: *const JSC.ZigString,
    port: u16,
    client_protocol: *const JSC.ZigString,
    client_protocol_hash: *u64,
    extra_headers: NonUTF8Headers,
) std.mem.Allocator.Error![]u8 {
    const allocator = vm.allocator;
    const input_rand_buf = vm.rareData().nextUUID().bytes;
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
        client_protocol_hash.* = bun.hash(static_headers[1].value);

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
    const headers_ = static_headers[0 .. 1 + @as(usize, @intFromBool(client_protocol.len > 0))];
    const pico_headers = PicoHTTP.Headers{ .headers = headers_ };

    return try std.fmt.allocPrint(
        allocator,
        "GET {s} HTTP/1.1\r\n" ++
            "Host: {any}\r\n" ++
            "Connection: Upgrade\r\n" ++
            "Upgrade: websocket\r\n" ++
            "Sec-WebSocket-Version: 13\r\n" ++
            "{s}" ++
            "{s}" ++
            "\r\n",
        .{ pathname_.slice(), host_fmt, pico_headers, extra_headers },
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

pub export fn Bun__defaultRejectUnauthorized(global: *JSC.JSGlobalObject) callconv(.C) bool {
    var vm = global.bunVM();
    return vm.bundler.env.getTLSRejectUnauthorized();
}

comptime {
    _ = Bun__defaultRejectUnauthorized;
}

const CppWebSocket = opaque {
    extern fn WebSocket__didConnect(
        websocket_context: *CppWebSocket,
        socket: *uws.Socket,
        buffered_data: ?[*]u8,
        buffered_len: usize,
    ) void;
    extern fn WebSocket__didAbruptClose(websocket_context: *CppWebSocket, reason: ErrorCode) void;
    extern fn WebSocket__didClose(websocket_context: *CppWebSocket, code: u16, reason: *const bun.String) void;
    extern fn WebSocket__didReceiveText(websocket_context: *CppWebSocket, clone: bool, text: *const JSC.ZigString) void;
    extern fn WebSocket__didReceiveBytes(websocket_context: *CppWebSocket, bytes: [*]const u8, byte_len: usize, opcode: u8) void;
    extern fn WebSocket__rejectUnauthorized(websocket_context: *CppWebSocket) bool;
    pub const didConnect = WebSocket__didConnect;
    pub const didAbruptClose = WebSocket__didAbruptClose;
    pub const didClose = WebSocket__didClose;
    pub const didReceiveText = WebSocket__didReceiveText;
    pub const didReceiveBytes = WebSocket__didReceiveBytes;
    extern fn WebSocket__incrementPendingActivity(websocket_context: *CppWebSocket) void;
    extern fn WebSocket__decrementPendingActivity(websocket_context: *CppWebSocket) void;
    pub fn ref(this: *CppWebSocket) void {
        JSC.markBinding(@src());
        WebSocket__incrementPendingActivity(this);
    }

    pub fn rejectUnauthorized(this: *CppWebSocket) bool {
        JSC.markBinding(@src());
        return WebSocket__rejectUnauthorized(this);
    }

    pub fn unref(this: *CppWebSocket) void {
        JSC.markBinding(@src());
        WebSocket__decrementPendingActivity(this);
    }
};

const body_buf_len = 16384 - 16;
const BodyBufBytes = [body_buf_len]u8;

const BodyBufPool = ObjectPool(BodyBufBytes, null, true, 4);
const BodyBuf = BodyBufPool.Node;

pub fn NewHTTPUpgradeClient(comptime ssl: bool) type {
    return struct {
        pub const Socket = uws.NewSocketHandler(ssl);
        tcp: ?Socket = null,
        outgoing_websocket: ?*CppWebSocket,
        input_body_buf: []u8 = &[_]u8{},
        client_protocol: []const u8 = "",
        to_send: []const u8 = "",
        read_length: usize = 0,
        headers_buf: [128]PicoHTTP.Header = undefined,
        body: std.ArrayListUnmanaged(u8) = .{},
        websocket_protocol: u64 = 0,
        hostname: [:0]const u8 = "",
        poll_ref: Async.KeepAlive = Async.KeepAlive.init(),

        pub const name = if (ssl) "WebSocketHTTPSClient" else "WebSocketHTTPClient";

        pub const shim = JSC.Shimmer("Bun", name, @This());
        pub usingnamespace bun.New(@This());

        const HTTPClient = @This();

        pub fn register(_: *JSC.JSGlobalObject, _: *anyopaque, ctx: *uws.SocketContext) callconv(.C) void {
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

        pub fn connect(
            global: *JSC.JSGlobalObject,
            socket_ctx: *anyopaque,
            websocket: *CppWebSocket,
            host: *const JSC.ZigString,
            port: u16,
            pathname: *const JSC.ZigString,
            client_protocol: *const JSC.ZigString,
            header_names: ?[*]const JSC.ZigString,
            header_values: ?[*]const JSC.ZigString,
            header_count: usize,
        ) callconv(.C) ?*HTTPClient {
            std.debug.assert(global.bunVM().event_loop_handle != null);

            var client_protocol_hash: u64 = 0;
            const body = buildRequestBody(
                global.bunVM(),
                pathname,
                ssl,
                host,
                port,
                client_protocol,
                &client_protocol_hash,
                NonUTF8Headers.init(header_names, header_values, header_count),
            ) catch return null;
            var vm = global.bunVM();

            var client = HTTPClient.new(.{
                .tcp = undefined,
                .outgoing_websocket = websocket,
                .input_body_buf = body,
                .websocket_protocol = client_protocol_hash,
            });

            var host_ = host.toSlice(bun.default_allocator);
            defer host_.deinit();
            const prev_start_server_on_next_tick = vm.eventLoop().start_server_on_next_tick;
            vm.eventLoop().start_server_on_next_tick = true;
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
            )) |out| {
                if (comptime ssl) {
                    if (!strings.isIPAddress(host_.slice())) {
                        out.hostname = bun.default_allocator.dupeZ(u8, host_.slice()) catch "";
                    }
                }

                out.tcp.?.timeout(120);
                return out;
            } else {
                vm.eventLoop().start_server_on_next_tick = prev_start_server_on_next_tick;

                client.clearData();
                client.destroy();
            }

            return null;
        }

        pub fn clearInput(this: *HTTPClient) void {
            if (this.input_body_buf.len > 0) bun.default_allocator.free(this.input_body_buf);
            this.input_body_buf.len = 0;
        }
        pub fn clearData(this: *HTTPClient) void {
            this.poll_ref.unrefOnNextTick(JSC.VirtualMachine.get());

            this.clearInput();
            this.body.clearAndFree(bun.default_allocator);
        }
        pub fn cancel(this: *HTTPClient) callconv(.C) void {
            this.clearData();

            var tcp = this.tcp orelse return;
            this.tcp = null;

            if (!tcp.isEstablished()) {
                _ = uws.us_socket_close_connecting(comptime @as(c_int, @intFromBool(ssl)), tcp.socket);
            } else {
                tcp.shutdown();
                tcp.close(0, null);
            }
        }

        pub fn fail(this: *HTTPClient, code: ErrorCode) void {
            log("onFail", .{});
            JSC.markBinding(@src());
            if (this.outgoing_websocket) |ws| {
                this.outgoing_websocket = null;
                ws.didAbruptClose(code);
            }

            this.cancel();
        }

        pub fn handleClose(this: *HTTPClient, _: Socket, _: c_int, _: ?*anyopaque) void {
            log("onClose", .{});
            JSC.markBinding(@src());
            this.clearData();
            this.tcp = null;

            if (this.outgoing_websocket) |ws| {
                this.outgoing_websocket = null;
                ws.didAbruptClose(ErrorCode.ended);
            }

            this.destroy();
        }

        pub fn terminate(this: *HTTPClient, code: ErrorCode) void {
            this.fail(code);

            // We cannot access the pointer after fail is called.
        }

        pub fn handleHandshake(this: *HTTPClient, socket: Socket, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
            log("onHandshake({d})", .{success});

            const authorized = if (success == 1) true else false;
            var reject_unauthorized = false;
            if (this.outgoing_websocket) |ws| {
                reject_unauthorized = ws.rejectUnauthorized();
            }
            if (ssl_error.error_no != 0 and (reject_unauthorized or !authorized)) {
                this.fail(ErrorCode.failed_to_connect);
                return;
            }

            if (authorized) {
                if (reject_unauthorized) {
                    const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(socket.getNativeHandle()));
                    if (BoringSSL.SSL_get_servername(ssl_ptr, 0)) |servername| {
                        const hostname = servername[0..bun.len(servername)];
                        if (!BoringSSL.checkServerIdentity(ssl_ptr, hostname)) {
                            this.fail(ErrorCode.failed_to_connect);
                        }
                    }
                }
            }
        }

        pub fn handleOpen(this: *HTTPClient, socket: Socket) void {
            log("onOpen", .{});
            std.debug.assert(socket.socket == this.tcp.?.socket);

            std.debug.assert(this.input_body_buf.len > 0);
            std.debug.assert(this.to_send.len == 0);

            if (comptime ssl) {
                if (this.hostname.len > 0) {
                    socket.getNativeHandle().configureHTTPClient(this.hostname);
                    bun.default_allocator.free(this.hostname);
                    this.hostname = "";
                }
            }

            // Do not set MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
            const wrote = socket.write(this.input_body_buf, false);
            if (wrote < 0) {
                this.terminate(ErrorCode.failed_to_write);
                return;
            }

            this.to_send = this.input_body_buf[@as(usize, @intCast(wrote))..];
        }

        pub fn handleData(this: *HTTPClient, socket: Socket, data: []const u8) void {
            log("onData", .{});
            defer JSC.VirtualMachine.get().drainMicrotasks();
            if (this.outgoing_websocket == null) {
                this.clearData();
                return;
            }
            std.debug.assert(socket.socket == this.tcp.?.socket);

            if (comptime Environment.allow_assert)
                std.debug.assert(!socket.isShutdown());

            var body = data;
            if (this.body.items.len > 0) {
                this.body.appendSlice(bun.default_allocator, data) catch @panic("out of memory");
                body = this.body.items;
            }

            const is_first = this.body.items.len == 0;
            if (is_first) {
                // fail early if we receive a non-101 status code
                if (!strings.hasPrefixComptime(body, "HTTP/1.1 101 ")) {
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
                            this.body.appendSlice(bun.default_allocator, data) catch @panic("out of memory");
                        }
                        return;
                    },
                }
            };

            this.processResponse(response, body[@as(usize, @intCast(response.bytes_read))..]);
        }

        pub fn handleEnd(this: *HTTPClient, socket: Socket) void {
            log("onEnd", .{});
            std.debug.assert(socket.socket == this.tcp.?.socket);
            this.terminate(ErrorCode.ended);
        }

        pub fn processResponse(this: *HTTPClient, response: PicoHTTP.Response, remain_buf: []const u8) void {
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
                            if (this.websocket_protocol == 0 or bun.hash(header.value) != this.websocket_protocol) {
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
                @memcpy(overflow, remain_buf);
            }

            this.clearData();
            JSC.markBinding(@src());
            this.tcp.?.timeout(0);
            log("onDidConnect", .{});

            this.outgoing_websocket.?.didConnect(this.tcp.?.socket, overflow.ptr, overflow.len);
        }

        pub fn handleWritable(
            this: *HTTPClient,
            socket: Socket,
        ) void {
            std.debug.assert(socket.socket == this.tcp.?.socket);

            if (this.to_send.len == 0)
                return;

            // Do not set MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
            const wrote = socket.write(this.to_send, false);
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
        pub fn handleConnectError(this: *HTTPClient, _: Socket, _: c_int) void {
            this.tcp = null;
            this.terminate(ErrorCode.failed_to_connect);
            this.destroy();
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

        const skip_mask = @as(u32, @bitCast(mask)) == 0;
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
    const header = WebsocketHeader.fromSlice(bytes);
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
    // reserved bits must be 0
    if (header.rsv != 0) {
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
                byte_len.* = strings.elementLengthUTF16IntoUTF8([]const u16, this.utf16);
                return WebsocketHeader.frameSizeIncludingMask(byte_len.*);
            },
            .latin1 => {
                byte_len.* = strings.elementLengthLatin1IntoUTF8([]const u8, this.latin1);
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

    pub fn copy(this: @This(), globalThis: *JSC.JSGlobalObject, buf: []u8, content_byte_len: usize, opcode: Opcode) void {
        if (this == .raw) {
            std.debug.assert(buf.len >= this.raw.len);
            std.debug.assert(buf.ptr != this.raw.ptr);
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

        std.debug.assert(WebsocketHeader.frameSizeIncludingMask(content_byte_len) == buf.len);

        switch (this) {
            .utf16 => |utf16| {
                header.len = WebsocketHeader.packLength(content_byte_len);
                const encode_into_result = strings.copyUTF16IntoUTF8(to_mask, []const u16, utf16, true);
                std.debug.assert(@as(usize, encode_into_result.written) == content_byte_len);
                std.debug.assert(@as(usize, encode_into_result.read) == utf16.len);
                header.len = WebsocketHeader.packLength(encode_into_result.written);
                var fib = std.io.fixedBufferStream(buf);
                header.writeHeader(fib.writer(), encode_into_result.written) catch unreachable;

                Mask.fill(globalThis, buf[mask_offset..][0..4], to_mask[0..content_byte_len], to_mask[0..content_byte_len]);
            },
            .latin1 => |latin1| {
                const encode_into_result = strings.copyLatin1IntoUTF8(to_mask, []const u8, latin1);
                std.debug.assert(@as(usize, encode_into_result.written) == content_byte_len);

                // latin1 can contain non-ascii
                std.debug.assert(@as(usize, encode_into_result.read) == latin1.len);

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
};

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

        initial_data_handler: ?*InitialDataHandler = null,

        pub const name = if (ssl) "WebSocketClientTLS" else "WebSocketClient";

        pub const shim = JSC.Shimmer("Bun", name, @This());
        const stack_frame_size = 1024;

        const WebSocket = @This();

        pub usingnamespace bun.New(@This());

        pub fn register(global: *JSC.JSGlobalObject, loop_: *anyopaque, ctx_: *anyopaque) callconv(.C) void {
            const vm = global.bunVM();
            const loop = @as(*uws.Loop, @ptrCast(@alignCast(loop_)));

            const ctx: *uws.SocketContext = @as(*uws.SocketContext, @ptrCast(ctx_));

            if (comptime Environment.isPosix) {
                if (vm.event_loop_handle) |other| {
                    std.debug.assert(other == loop);
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
            this.poll_ref.unrefOnNextTick(this.globalThis.bunVM());
            this.clearReceiveBuffers(true);
            this.clearSendBuffers(true);
            this.ping_received = false;
            this.ping_len = 0;
            this.receive_pending_chunk_len = 0;
        }

        pub fn cancel(this: *WebSocket) callconv(.C) void {
            this.clearData();

            if (this.tcp.isClosed() or this.tcp.isShutdown())
                return;

            if (!this.tcp.isEstablished()) {
                _ = uws.us_socket_close_connecting(comptime @as(c_int, @intFromBool(ssl)), this.tcp.socket);
            } else {
                this.tcp.close(0, null);
            }
        }

        pub fn fail(this: *WebSocket, code: ErrorCode) void {
            JSC.markBinding(@src());
            if (this.outgoing_websocket) |ws| {
                this.outgoing_websocket = null;
                log("fail ({s})", .{@tagName(code)});
                ws.didAbruptClose(code);
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
                        const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(socket.getNativeHandle()));
                        if (BoringSSL.SSL_get_servername(ssl_ptr, 0)) |servername| {
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
            if (this.outgoing_websocket) |ws| {
                this.outgoing_websocket = null;
                ws.didAbruptClose(ErrorCode.ended);
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
                    // we avoid trim since we wanna keep the utf8 validation intact
                    const utf16_bytes_ = strings.toUTF16AllocNoTrim(bun.default_allocator, data_, true) catch {
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
            std.debug.assert(data_.len <= left_in_fragment);

            // did all the data fit in the buffer?
            // we can avoid copying & allocating a temporary buffer
            if (is_final and data_.len == left_in_fragment and this.receive_pending_chunk_len == 0) {
                if (this.receive_buffer.count == 0) {
                    this.dispatchData(data_, kind);
                    return data_.len;
                } else if (data_.len == 0) {
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

            // This is the start of a task, so we need to drain the microtask queue at the end
            defer JSC.VirtualMachine.get().drainMicrotasks();

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
                std.debug.assert(this.initial_data_handler == null);

                // If we disconnected for any reason in the re-entrant case, we should just ignore the data
                if (this.outgoing_websocket == null or this.tcp.isShutdown() or this.tcp.isClosed())
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
                            std.debug.assert(data.len > 0);
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

                        if (need_compression) {
                            this.terminate(ErrorCode.compression_unsupported);
                            terminated = true;
                            break;
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
                        if (data.len == 0) return;

                        if (data.len < byte_size) {
                            this.terminate(ErrorCode.control_frame_is_fragmented);
                            terminated = true;
                            break;
                        }

                        // Multibyte length quantities are expressed in network byte order
                        receive_body_remain = switch (byte_size) {
                            8 => @as(usize, std.mem.readInt(u64, data[0..8], .big)),
                            2 => @as(usize, std.mem.readInt(u16, data[0..2], .big)),
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
            return this.sendData(.{ .raw = bytes }, do_write, .Binary);
        }

        fn sendData(this: *WebSocket, bytes: Copy, do_write: bool, opcode: Opcode) bool {
            var content_byte_len: usize = 0;
            const write_len = bytes.len(&content_byte_len);
            std.debug.assert(write_len > 0);

            var writable = this.send_buffer.writableWithSize(write_len) catch unreachable;
            bytes.copy(this.globalThis, writable[0..write_len], content_byte_len, opcode);
            this.send_buffer.update(write_len);

            if (do_write) {
                if (comptime Environment.allow_assert) {
                    std.debug.assert(!this.tcp.isShutdown());
                    std.debug.assert(!this.tcp.isClosed());
                    std.debug.assert(this.tcp.isEstablished());
                }
                return this.sendBuffer(this.send_buffer.readableSlice(0));
            }

            return true;
        }

        fn sendBuffer(
            this: *WebSocket,
            out_buf: []const u8,
        ) bool {
            std.debug.assert(out_buf.len > 0);
            // Do not set MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
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
                this.dispatchAbruptClose();
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
                this.dispatchAbruptClose();
                this.clearData();
                return;
            }

            socket.shutdownRead();
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
                this.dispatchClose(code, &reason);
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
            _ = this.sendBuffer(send_buf);
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
            op: u8,
        ) callconv(.C) void {
            if (this.tcp.isClosed() or this.tcp.isShutdown() or op > 0xF) {
                this.dispatchAbruptClose();
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

        pub fn writeString(
            this: *WebSocket,
            str_: *const JSC.ZigString,
            op: u8,
        ) callconv(.C) void {
            const str = str_.*;
            if (this.tcp.isClosed() or this.tcp.isShutdown()) {
                this.dispatchAbruptClose();
                return;
            }

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
                        _ = this.enqueueEncodedBytes(this.tcp, inline_buf[0..frame_size]);
                        return;
                    }
                    // max length of a utf16 -> utf8 conversion is 4 times the length of the utf16 string
                } else if ((str.len * 4) < (stack_frame_size) and !this.hasBackpressure()) {
                    const bytes = Copy{ .utf16 = str.utf16SliceAligned() };
                    var byte_len: usize = 0;
                    const frame_size = bytes.len(&byte_len);
                    std.debug.assert(frame_size <= stack_frame_size);
                    bytes.copy(this.globalThis, inline_buf[0..frame_size], byte_len, opcode);
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
                opcode,
            );
        }

        fn dispatchAbruptClose(this: *WebSocket) void {
            var out = this.outgoing_websocket orelse return;
            this.poll_ref.unrefOnNextTick(this.globalThis.bunVM());
            JSC.markBinding(@src());
            this.outgoing_websocket = null;
            out.didAbruptClose(ErrorCode.closed);
        }

        fn dispatchClose(this: *WebSocket, code: u16, reason: *const bun.String) void {
            var out = this.outgoing_websocket orelse return;
            this.poll_ref.unrefOnNextTick(this.globalThis.bunVM());
            JSC.markBinding(@src());
            this.outgoing_websocket = null;
            out.didClose(code, reason);
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

        const InitialDataHandler = struct {
            adopted: ?*WebSocket,
            ws: *CppWebSocket,
            slice: []u8,

            pub const Handle = JSC.AnyTask.New(@This(), handle);

            pub fn handleWithoutDeinit(this: *@This()) void {
                var this_socket = this.adopted orelse return;
                this.adopted = null;
                this_socket.initial_data_handler = null;
                var ws = this.ws;
                defer ws.unref();

                if (this_socket.outgoing_websocket != null)
                    this_socket.handleData(this_socket.tcp, this.slice);
            }

            pub fn handle(this: *@This()) void {
                defer {
                    bun.default_allocator.free(this.slice);
                    bun.default_allocator.destroy(this);
                }
                this.handleWithoutDeinit();
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
                .tcp = undefined,
                .outgoing_websocket = outgoing,
                .globalThis = globalThis,
                .send_buffer = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator),
                .receive_buffer = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator),
            });
            if (!Socket.adoptPtr(
                tcp,
                ctx,
                WebSocket,
                "tcp",
                ws,
            )) {
                ws.destroy();
                return null;
            }

            ws.send_buffer.ensureTotalCapacity(2048) catch return null;
            ws.receive_buffer.ensureTotalCapacity(2048) catch return null;
            ws.poll_ref.ref(globalThis.bunVM());

            const buffered_slice: []u8 = buffered_data[0..buffered_data_len];
            if (buffered_slice.len > 0) {
                const initial_data = bun.default_allocator.create(InitialDataHandler) catch unreachable;
                initial_data.* = .{
                    .adopted = ws,
                    .slice = buffered_slice,
                    .ws = outgoing,
                };

                // Use a higher-priority callback for the initial onData handler
                globalThis.queueMicrotaskCallback(initial_data, InitialDataHandler.handle);

                // We need to ref the outgoing websocket so that it doesn't get finalized
                // before the initial data handler is called
                outgoing.ref();
            }
            return @as(
                *anyopaque,
                @ptrCast(ws),
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
            .cancel = cancel,
            .register = register,
            .init = init,
            .finalize = finalize,
        });

        comptime {
            if (!JSC.is_bindgen) {
                @export(writeBinaryData, .{ .name = Export[0].symbol_name });
                @export(writeString, .{ .name = Export[1].symbol_name });
                @export(close, .{ .name = Export[2].symbol_name });
                @export(cancel, .{ .name = Export[3].symbol_name });
                @export(register, .{ .name = Export[4].symbol_name });
                @export(init, .{ .name = Export[5].symbol_name });
                @export(finalize, .{ .name = Export[6].symbol_name });
            }
        }
    };
}

pub const WebSocketHTTPClient = NewHTTPUpgradeClient(false);
pub const WebSocketHTTPSClient = NewHTTPUpgradeClient(true);
pub const WebSocketClient = NewWebSocketClient(false);
pub const WebSocketClientTLS = NewWebSocketClient(true);
