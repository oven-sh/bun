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
const uws = bun.uws;
const JSC = bun.JSC;
const PicoHTTP = bun.picohttp;
const ObjectPool = @import("../pool.zig").ObjectPool;
const protocol = @import("./websocket_protocol.zig");
const WebsocketHeader = protocol.WebsocketHeader;
const WebsocketDataFrame = protocol.WebsocketDataFrame;
const Opcode = protocol.Opcode;
const ZigURL = @import("../url.zig").URL;

const Async = bun.Async;

const log = Output.scoped(.WebSocketClient, false);

pub const NonUTF8Headers = struct {
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

pub const ErrorCode = enum(i32) {
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
    tls_handshake_failed,
};

pub const CppWebSocket = opaque {
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
    pub fn didAbruptClose(this: *CppWebSocket, reason: ErrorCode) void {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        WebSocket__didAbruptClose(this, reason);
    }
    pub fn didClose(this: *CppWebSocket, code: u16, reason: *bun.String) void {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        WebSocket__didClose(this, code, reason);
    }
    pub fn didReceiveText(this: *CppWebSocket, clone: bool, text: *const JSC.ZigString) void {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        WebSocket__didReceiveText(this, clone, text);
    }
    pub fn didReceiveBytes(this: *CppWebSocket, bytes: [*]const u8, byte_len: usize, opcode: u8) void {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        WebSocket__didReceiveBytes(this, bytes, byte_len, opcode);
    }
    pub fn rejectUnauthorized(this: *CppWebSocket) bool {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        return WebSocket__rejectUnauthorized(this);
    }
    pub fn didConnect(this: *CppWebSocket, socket: *uws.Socket, buffered_data: ?[*]u8, buffered_len: usize) void {
        const loop = JSC.VirtualMachine.get().eventLoop();
        loop.enter();
        defer loop.exit();
        WebSocket__didConnect(this, socket, buffered_data, buffered_len);
    }
    extern fn WebSocket__incrementPendingActivity(websocket_context: *CppWebSocket) void;
    extern fn WebSocket__decrementPendingActivity(websocket_context: *CppWebSocket) void;
    pub fn ref(this: *CppWebSocket) void {
        JSC.markBinding(@src());
        WebSocket__incrementPendingActivity(this);
    }

    pub fn unref(this: *CppWebSocket) void {
        JSC.markBinding(@src());
        WebSocket__decrementPendingActivity(this);
    }
};

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
            bun.assert(input.len < strings.ascii_vector_size);
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

pub const ReceiveState = enum {
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

    pub fn parseWebSocketHeader(
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
};

pub const DataType = enum {
    none,
    text,
    binary,
};

pub const Copy = union(enum) {
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
                const encode_into_result = strings.copyUTF16IntoUTF8(to_mask, []const u16, utf16, true);
                bun.assert(@as(usize, encode_into_result.written) == content_byte_len);
                bun.assert(@as(usize, encode_into_result.read) == utf16.len);
                header.len = WebsocketHeader.packLength(encode_into_result.written);
                var fib = std.io.fixedBufferStream(buf);
                header.writeHeader(fib.writer(), encode_into_result.written) catch unreachable;

                Mask.fill(globalThis, buf[mask_offset..][0..4], to_mask[0..content_byte_len], to_mask[0..content_byte_len]);
            },
            .latin1 => |latin1| {
                const encode_into_result = strings.copyLatin1IntoUTF8(to_mask, []const u8, latin1);
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
};

// Add public exports at the end
pub const WebSocketHTTPClient = @import("WebsocketHTTPUpgradeClient.zig").WebSocketHTTPClient;
pub const WebSocketHTTPSClient = @import("WebsocketHTTPUpgradeClient.zig").WebSocketHTTPSClient;
pub const WebSocketClient = @import("WebSocket.zig").WebSocketClient;
pub const WebSocketClientTLS = @import("WebSocket.zig").WebSocketClientTLS;