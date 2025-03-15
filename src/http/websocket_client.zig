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
const libdeflate = @import("../deps/libdeflate.zig");

const Async = bun.Async;

pub const WebSocketCompression = struct {
    // Compression state
    enabled: bool = false,
    client_no_context_takeover: bool = false,
    server_no_context_takeover: bool = false,
    client_max_window_bits: u8 = 15, // Default is 15 (32KB window)
    server_max_window_bits: u8 = 15, // Default is 15 (32KB window)
    compressor: ?*libdeflate.Compressor = null,
    decompressor: ?*libdeflate.Decompressor = null,
    compression_buffer: []u8 = &[_]u8{},

    pub fn init() WebSocketCompression {
        return .{};
    }

    pub fn deinit(self: *WebSocketCompression) void {
        if (self.compressor) |compressor| {
            compressor.deinit();
            self.compressor = null;
        }
        if (self.decompressor) |decompressor| {
            decompressor.deinit();
            self.decompressor = null;
        }
        if (self.compression_buffer.len > 0) {
            default_allocator.free(self.compression_buffer);
            self.compression_buffer = &[_]u8{};
        }
    }

    pub fn setup(self: *WebSocketCompression, extensions_header: []const u8) bool {
        // Parse the extensions header to set up compression parameters
        // Example: "permessage-deflate; client_max_window_bits=15; server_max_window_bits=15"
        if (extensions_header.len == 0) return false;

        // Simple check for permessage-deflate extension
        if (std.mem.indexOf(u8, extensions_header, "permessage-deflate") == null) return false;

        self.enabled = true;

        // Parse parameters
        if (std.mem.indexOf(u8, extensions_header, "client_no_context_takeover") != null) {
            self.client_no_context_takeover = true;
        }

        if (std.mem.indexOf(u8, extensions_header, "server_no_context_takeover") != null) {
            self.server_no_context_takeover = true;
        }

        // Parse window bits parameters
        if (std.mem.indexOf(u8, extensions_header, "client_max_window_bits=")) |client_pos| {
            // Find the actual value after the equals sign
            const start_pos = client_pos + "client_max_window_bits=".len;
            var end_pos = start_pos;
            while (end_pos < extensions_header.len and
                std.ascii.isDigit(extensions_header[end_pos]))
            {
                end_pos += 1;
            }

            if (end_pos > start_pos) {
                const value_str = extensions_header[start_pos..end_pos];
                const value = std.fmt.parseInt(u8, value_str, 10) catch 15;
                // Valid window bits values are 8-15, with 15 being the default
                if (value >= 8 and value <= 15) {
                    self.client_max_window_bits = value;
                }
            }
        }

        if (std.mem.indexOf(u8, extensions_header, "server_max_window_bits=")) |server_pos| {
            // Find the actual value after the equals sign
            const start_pos = server_pos + "server_max_window_bits=".len;
            var end_pos = start_pos;
            while (end_pos < extensions_header.len and
                std.ascii.isDigit(extensions_header[end_pos]))
            {
                end_pos += 1;
            }

            if (end_pos > start_pos) {
                const value_str = extensions_header[start_pos..end_pos];
                const value = std.fmt.parseInt(u8, value_str, 10) catch 15;
                // Valid window bits values are 8-15, with 15 being the default
                if (value >= 8 and value <= 15) {
                    self.server_max_window_bits = value;
                }
            }
        }

        // Initialize compression/decompression
        if (self.enabled) {
            libdeflate.load();

            // Level 6 compression is a good balance of speed vs compression ratio
            // Choose compression level based on window bits
            var compression_level: c_int = 6; // Default

            if (self.server_max_window_bits <= 9) {
                compression_level = 1; // For very small windows, use fast compression
            } else if (self.server_max_window_bits <= 11) {
                compression_level = 3; // For small windows
            } else if (self.server_max_window_bits <= 13) {
                compression_level = 5; // For medium windows
            }

            self.compressor = libdeflate.Compressor.alloc(compression_level);
            self.decompressor = libdeflate.Decompressor.alloc();

            // Log the negotiated parameters
            log("Initialized compression with client_max_window_bits={d}, server_max_window_bits={d}", .{ self.client_max_window_bits, self.server_max_window_bits });

            // Allocate a shared buffer for compression/decompression
            // Start with a reasonable size that will be grown if needed
            self.compression_buffer = default_allocator.alloc(u8, 8192) catch &[_]u8{};

            return self.compressor != null and self.decompressor != null and self.compression_buffer.len > 0;
        }

        return false;
    }

    pub fn compress(self: *WebSocketCompression, data: []const u8) ?[]const u8 {
        if (!self.enabled or self.compressor == null) return null;

        // Make sure our buffer is large enough
        const max_size = self.compressor.?.maxBytesNeeded(data, .deflate);
        if (max_size > self.compression_buffer.len) {
            if (self.compression_buffer.len > 0) {
                default_allocator.free(self.compression_buffer);
            }
            self.compression_buffer = default_allocator.alloc(u8, max_size) catch return null;
        }

        // Compress the data
        const result = self.compressor.?.compress(data, self.compression_buffer, .deflate);
        if (result.status == .success and result.written > 0) {
            // Remove the last 4 bytes (0x00 0x00 0xff 0xff) as per RFC7692
            if (result.written >= 4 and
                self.compression_buffer[result.written - 4] == 0x00 and
                self.compression_buffer[result.written - 3] == 0x00 and
                self.compression_buffer[result.written - 2] == 0xff and
                self.compression_buffer[result.written - 1] == 0xff)
            {

                // If server_no_context_takeover is true, we should reset the compressor
                // However, libdeflate doesn't have a direct way to reset the compressor
                // So we would need to free and recreate it if needed
                if (self.server_no_context_takeover) {
                    if (self.compressor) |compressor| {
                        compressor.deinit();

                        // Create a new compressor with the same settings
                        var compression_level: c_int = 6; // Default

                        if (self.server_max_window_bits <= 9) {
                            compression_level = 1; // For very small windows, use fast compression
                        } else if (self.server_max_window_bits <= 11) {
                            compression_level = 3; // For small windows
                        } else if (self.server_max_window_bits <= 13) {
                            compression_level = 5; // For medium windows
                        }

                        self.compressor = libdeflate.Compressor.alloc(compression_level);
                    }
                }

                return self.compression_buffer[0 .. result.written - 4];
            }
            return self.compression_buffer[0..result.written];
        }

        return null;
    }

    pub fn decompress(self: *WebSocketCompression, data: []const u8, estimated_size: usize) ?[]const u8 {
        if (!self.enabled or self.decompressor == null) return null;

        // Make sure our buffer is large enough for decompression
        // We might need to grow the buffer if the uncompressed data is large
        if (estimated_size > self.compression_buffer.len) {
            if (self.compression_buffer.len > 0) {
                default_allocator.free(self.compression_buffer);
            }
            self.compression_buffer = default_allocator.alloc(u8, estimated_size) catch return null;
        }

        // Append 0x00 0x00 0xff 0xff to the data as required by RFC7692
        var input_buffer = default_allocator.alloc(u8, data.len + 4) catch return null;
        defer default_allocator.free(input_buffer);

        @memcpy(input_buffer[0..data.len], data);
        input_buffer[data.len] = 0x00;
        input_buffer[data.len + 1] = 0x00;
        input_buffer[data.len + 2] = 0xff;
        input_buffer[data.len + 3] = 0xff;

        // Decompress
        const result = self.decompressor.?.decompress(input_buffer, self.compression_buffer, .deflate);
        if (result.status == .success and result.written > 0) {
            // If client_no_context_takeover is true, we should reset the decompressor
            // Similar to the compressor, libdeflate doesn't have a direct way to reset
            // So we would need to free and recreate it
            if (self.client_no_context_takeover) {
                if (self.decompressor) |decompressor| {
                    decompressor.deinit();
                    self.decompressor = libdeflate.Decompressor.alloc();
                }
            }

            return self.compression_buffer[0..result.written];
        }

        return null;
    }
};

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
    extern fn WebSocket__setupCompression(websocket_context: *CppWebSocket, extensions: [*]const u8, extensions_len: usize) void;

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
    pub fn setupCompression(_: *CppWebSocket, _: []const u8) void {
        // Skip for now since setupCompression is not yet implemented in C++ side
        // When implementing this in C++, uncomment the following:
        // const loop = JSC.VirtualMachine.get().eventLoop();
        // loop.enter();
        // defer loop.exit();
        // WebSocket__setupCompression(this, extensions.ptr, extensions.len);
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

    pub fn copy(this: @This(), globalThis: *JSC.JSGlobalObject, buf: []u8, content_byte_len: usize, opcode: Opcode, compressed: bool) void {
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
        header.compressed = compressed;
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
