// This code is based on https://github.com/frmdstryr/zhp/blob/a4b5700c289c3619647206144e10fb414113a888/src/websocket.zig
// Thank you @frmdstryr.
const std = @import("std");
const native_endian = @import("builtin").target.cpu.arch.endian();

const tcp = std.x.net.tcp;
const ip = std.x.net.ip;

const IPv4 = std.x.os.IPv4;
const IPv6 = std.x.os.IPv6;
const os = std.os;
const bun = @import("../global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;

const uws = @import("uws");
const JSC = @import("javascript_core");
const PicoHTTP = @import("picohttp");
const ObjectPool = @import("../pool.zig").ObjectPool;

fn buildRequestBody(vm: *JSC.VirtualMachine, pathname: *const JSC.ZigString, host: *const JSC.ZigString, client_protocol: *const JSC.ZigString, client_protocol_hash: *u64) std.mem.Allocator.Error![]u8 {
    const allocator = vm.allocator;
    var input_rand_buf: [16]u8 = undefined;
    std.crypto.random.bytes(&input_rand_buf);
    const temp_buf_size = comptime std.base64.standard.Encoder.calcSize(16);
    var encoded_buf: [temp_buf_size]u8 = undefined;
    const accept_key = std.base64.standard.Encoder.encode(&encoded_buf, &input_rand_buf);

    var headers = [_]PicoHTTP.Header{
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
        client_protocol_hash.* = std.hash.Wyhash.hash(0, headers[1].value);

    var headers_: []PicoHTTP.Header = headers[0 .. 1 + @as(usize, @boolToInt(client_protocol.len > 0))];
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
            "\r\n",
        .{
            pathname_,
            host_,
            pico_headers,
        },
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
};
extern fn WebSocket__didConnect(
    websocket_context: *anyopaque,
    socket: *uws.Socket,
    buffered_data: ?[*]u8,
    buffered_len: usize,
) void;
extern fn WebSocket__didFailToConnect(websocket_context: *anyopaque, reason: ErrorCode) void;

const BodyBufBytes = [16384 - 16]u8;

const BodyBufPool = ObjectPool(BodyBufBytes, null, true, 4);
const BodyBuf = BodyBufPool.Node;

pub fn NewHTTPUpgradeClient(comptime ssl: bool) type {
    return struct {
        pub const Socket = uws.NewSocketHandler(ssl);
        socket: Socket,
        outgoing_websocket: *anyopaque,
        input_body_buf: []u8 = &[_]u8{},
        client_protocol: []const u8 = "",
        to_send: []const u8 = "",
        read_length: usize = 0,
        headers_buf: [128]PicoHTTP.Header = undefined,
        body_buf: ?*BodyBuf = null,
        body_written: usize = 0,
        websocket_protocol: u64 = 0,

        pub const name = if (ssl) "WebSocketHTTPSClient" else "WebSocketHTTPClient";

        pub const shim = JSC.Shimmer("Bun", name, @This());

        const HTTPClient = @This();

        pub fn register(global: *JSC.JSGlobalObject, loop_: *anyopaque, ctx_: *anyopaque) callconv(.C) void {
            var vm = global.bunVM();
            var loop = @ptrCast(*uws.Loop, loop_);
            var ctx: *uws.us_socket_context_t = @ptrCast(*uws.us_socket_context_t, ctx_);

            if (vm.uws_event_loop) |other| {
                std.debug.assert(other == loop);
            }

            vm.uws_event_loop = loop;

            Socket.configure(ctx, HTTPClient, handleOpen, handleClose, handleData, handleWritable, handleTimeout, handleConnectError, handleEnd);
        }

        pub fn connect(
            global: *JSC.JSGlobalObject,
            socket_ctx: *anyopaque,
            websocket: *anyopaque,
            host: *const JSC.ZigString,
            port: u16,
            pathname: *const JSC.ZigString,
            client_protocol: *const JSC.ZigString,
        ) callconv(.C) ?*HTTPClient {
            std.debug.assert(global.bunVM().uws_event_loop != null);

            var client_protocol_hash: u64 = 0;
            var body = buildRequestBody(global.bunVM(), pathname, host, client_protocol, &client_protocol_hash) catch return null;
            var client: HTTPClient = HTTPClient{
                .socket = undefined,
                .outgoing_websocket = websocket,
                .input_body_buf = body,
                .websocket_protocol = client_protocol_hash,
            };
            var host_ = host.toSlice(bun.default_allocator);
            defer host_.deinit();

            if (Socket.connect(host_.slice(), port, @ptrCast(*uws.us_socket_context_t, socket_ctx), HTTPClient, client, "socket")) |out| {
                out.socket.timeout(120);
                return out;
            }

            client.clearData();

            return null;
        }

        pub fn clearInput(this: *HTTPClient) void {
            if (this.input_body_buf.len > 0) bun.default_allocator.free(this.input_body_buf);
            this.input_body_buf.len = 0;
        }
        pub fn clearData(this: *HTTPClient) void {
            this.clearInput();
            if (this.body_buf) |buf| {
                this.body_buf = null;
                buf.release();
            }
        }
        pub fn cancel(this: *HTTPClient) callconv(.C) void {
            this.clearData();

            if (!this.socket.isEstablished()) {
                _ = uws.us_socket_close_connecting(comptime @as(c_int, @boolToInt(ssl)), this.socket.socket);
            } else {
                this.socket.close(0, null);
            }
        }

        pub fn fail(this: *HTTPClient, code: ErrorCode) void {
            JSC.markBinding();
            WebSocket__didFailToConnect(this.outgoing_websocket, code);
            this.cancel();
        }

        pub fn handleClose(this: *HTTPClient, _: Socket, _: c_int, _: ?*anyopaque) void {
            JSC.markBinding();
            this.clearData();
            WebSocket__didFailToConnect(this.outgoing_websocket, ErrorCode.ended);
        }

        pub fn terminate(this: *HTTPClient, code: ErrorCode) void {
            this.fail(code);
            if (this.socket.isClosed() == 0)
                this.socket.close(0, null);
        }

        pub fn handleOpen(this: *HTTPClient, socket: Socket) void {
            std.debug.assert(socket.socket == this.socket.socket);

            std.debug.assert(this.input_body_buf.len > 0);
            std.debug.assert(this.to_send.len == 0);

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
            std.debug.assert(socket.socket == this.socket.socket);

            if (comptime Environment.allow_assert)
                std.debug.assert(!socket.isShutdown());

            var body = this.getBody();
            var remain = body[this.body_written..];
            const is_first = this.body_written == 0;
            if (is_first and data.len >= "HTTP/1.1 101 ".len) {
                // fail early if we receive a non-101 status code
                if (!strings.eqlComptimeIgnoreLen(data[0.."HTTP/1.1 101 ".len], "HTTP/1.1 101 ")) {
                    this.terminate(ErrorCode.expected_101_status_code);
                    return;
                }
            }

            const to_write = remain[0..@minimum(remain.len, data.len)];
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

            var buffered_body_data = body[@minimum(@intCast(usize, response.bytes_read), body.len)..];
            buffered_body_data = buffered_body_data[0..@minimum(buffered_body_data.len, this.body_written)];

            this.processResponse(response, buffered_body_data, overflow);
        }

        pub fn handleEnd(this: *HTTPClient, socket: Socket) void {
            std.debug.assert(socket.socket == this.socket.socket);
            this.terminate(ErrorCode.ended);
        }

        pub fn processResponse(this: *HTTPClient, response: PicoHTTP.Response, remain_buf: []const u8, overflow_buf: []const u8) void {
            std.debug.assert(this.body_written > 0);

            var upgrade_header = PicoHTTP.Header{ .name = "", .value = "" };
            var connection_header = PicoHTTP.Header{ .name = "", .value = "" };
            var websocket_accept_header = PicoHTTP.Header{ .name = "", .value = "" };
            var visited_protocol = this.websocket_protocol == 0;
            // var visited_version = false;
            std.debug.assert(response.status_code == 101);

            if (remain_buf.len > 0) {
                std.debug.assert(overflow_buf.len == 0);
            }

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

            if (@minimum(upgrade_header.name.len, upgrade_header.value.len) == 0) {
                this.terminate(ErrorCode.missing_upgrade_header);
                return;
            }

            if (@minimum(connection_header.name.len, connection_header.value.len) == 0) {
                this.terminate(ErrorCode.missing_connection_header);
                return;
            }

            if (@minimum(websocket_accept_header.name.len, websocket_accept_header.value.len) == 0) {
                this.terminate(ErrorCode.missing_websocket_accept_header);
                return;
            }

            if (!visited_protocol) {
                this.terminate(ErrorCode.mismatch_client_protocol);
                return;
            }

            if (!strings.eqlComptime(connection_header.value, "Upgrade")) {
                this.terminate(ErrorCode.invalid_connection_header);
                return;
            }

            if (!strings.eqlComptime(upgrade_header.value, "websocket")) {
                this.terminate(ErrorCode.invalid_upgrade_header);
                return;
            }

            // TODO: check websocket_accept_header.value

            const overflow_len = overflow_buf.len + remain_buf.len;
            var overflow: []u8 = &.{};
            if (overflow_len > 0) {
                overflow = bun.default_allocator.alloc(u8, overflow_len) catch {
                    this.terminate(ErrorCode.invalid_response);
                    return;
                };
                if (remain_buf.len > 0) @memcpy(overflow.ptr, remain_buf.ptr, remain_buf.len);
                if (overflow_buf.len > 0) @memcpy(overflow.ptr + remain_buf.len, overflow_buf.ptr, overflow_buf.len);
            }

            this.clearData();
            JSC.markBinding();
            WebSocket__didConnect(this.outgoing_websocket, this.socket.socket, overflow.ptr, overflow.len);
        }

        pub fn handleWritable(
            this: *HTTPClient,
            socket: Socket,
        ) void {
            std.debug.assert(socket.socket == this.socket.socket);

            if (this.to_send.len == 0)
                return;

            const wrote = socket.write(this.to_send, true);
            if (wrote < 0) {
                this.terminate(ErrorCode.failed_to_write);
                return;
            }
            std.debug.assert(@intCast(usize, wrote) >= this.to_send.len);
            this.to_send = this.to_send[@minimum(@intCast(usize, wrote), this.to_send.len)..];
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

pub const WebSocketHTTPClient = NewHTTPUpgradeClient(false);
pub const WebSocketHTTPSClient = NewHTTPUpgradeClient(true);
