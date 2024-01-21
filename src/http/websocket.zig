// This code is based on https://github.com/frmdstryr/zhp/blob/a4b5700c289c3619647206144e10fb414113a888/src/websocket.zig
// Thank you @frmdstryr.
const std = @import("std");

const os = std.os;
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

pub const Opcode = enum(u4) {
    Continue = 0x0,
    Text = 0x1,
    Binary = 0x2,
    Res3 = 0x3,
    Res4 = 0x4,
    Res5 = 0x5,
    Res6 = 0x6,
    Res7 = 0x7,
    Close = 0x8,
    Ping = 0x9,
    Pong = 0xA,
    ResB = 0xB,
    ResC = 0xC,
    ResD = 0xD,
    ResE = 0xE,
    ResF = 0xF,

    pub fn isControl(opcode: Opcode) bool {
        return @intFromEnum(opcode) & 0x8 != 0;
    }
};

pub const WebsocketHeader = packed struct {
    len: u7,
    mask: bool,
    opcode: Opcode,
    rsv: u2 = 0, //rsv2 and rsv3
    compressed: bool = false, // rsv1
    final: bool = true,

    pub fn writeHeader(header: WebsocketHeader, writer: anytype, n: usize) anyerror!void {
        // packed structs are sometimes buggy
        // lets check it worked right
        if (comptime Environment.allow_assert) {
            var buf_ = [2]u8{ 0, 0 };
            var stream = std.io.fixedBufferStream(&buf_);
            stream.writer().writeInt(u16, @as(u16, @bitCast(header)), .big) catch unreachable;
            stream.pos = 0;
            const casted = stream.reader().readInt(u16, .big) catch unreachable;
            std.debug.assert(casted == @as(u16, @bitCast(header)));
            std.debug.assert(std.meta.eql(@as(WebsocketHeader, @bitCast(casted)), header));
        }

        try writer.writeInt(u16, @as(u16, @bitCast(header)), .big);
        std.debug.assert(header.len == packLength(n));
    }

    pub fn packLength(length: usize) u7 {
        return switch (length) {
            0...125 => @as(u7, @truncate(length)),
            126...0xFFFF => 126,
            else => 127,
        };
    }

    const mask_length = 4;
    const header_length = 2;

    pub fn lengthByteCount(byte_length: usize) usize {
        return switch (byte_length) {
            0...125 => 0,
            126...0xFFFF => @sizeOf(u16),
            else => @sizeOf(u64),
        };
    }

    pub fn frameSize(byte_length: usize) usize {
        return header_length + byte_length + lengthByteCount(byte_length);
    }

    pub fn frameSizeIncludingMask(byte_length: usize) usize {
        return frameSize(byte_length) + mask_length;
    }

    pub fn slice(self: WebsocketHeader) [2]u8 {
        return @as([2]u8, @bitCast(@byteSwap(@as(u16, @bitCast(self)))));
    }

    pub fn fromSlice(bytes: [2]u8) WebsocketHeader {
        return @as(WebsocketHeader, @bitCast(@byteSwap(@as(u16, @bitCast(bytes)))));
    }
};

pub const WebsocketDataFrame = struct {
    header: WebsocketHeader,
    mask: [4]u8 = undefined,
    data: []const u8,

    pub fn isValid(dataframe: WebsocketDataFrame) bool {
        // Validate control frame
        if (dataframe.header.opcode.isControl()) {
            if (!dataframe.header.final) {
                return false; // Control frames cannot be fragmented
            }
            if (dataframe.data.len > 125) {
                return false; // Control frame payloads cannot exceed 125 bytes
            }
        }

        // Validate header len field
        const expected = switch (dataframe.data.len) {
            0...126 => dataframe.data.len,
            127...0xFFFF => 126,
            else => 127,
        };
        return dataframe.header.len == expected;
    }
};

// Create a buffered writer
// TODO: This will still split packets
pub fn Writer(comptime size: usize, comptime opcode: Opcode) type {
    const WriterType = switch (opcode) {
        .Text => Websocket.TextFrameWriter,
        .Binary => Websocket.BinaryFrameWriter,
        else => @compileError("Unsupported writer opcode"),
    };
    return std.io.BufferedWriter(size, WriterType);
}

const ReadStream = std.io.FixedBufferStream([]u8);

pub const Websocket = struct {
    pub const WriteError = error{
        InvalidMessage,
        MessageTooLarge,
        EndOfStream,
    } || std.fs.File.WriteError;

    stream: std.net.Stream,

    err: ?anyerror = null,
    buf: [8192]u8 = undefined,
    read_stream: ReadStream,
    reader: ReadStream.Reader,
    flags: u32 = 0,
    pub fn create(
        fd: std.os.fd_t,
        comptime flags: u32,
    ) Websocket {
        const stream = ReadStream{
            .buffer = &[_]u8{},
            .pos = 0,
        };
        var socket = Websocket{
            .read_stream = undefined,
            .reader = undefined,
            .stream = std.net.Stream{ .handle = bun.socketcast(fd) },
            .flags = flags,
        };

        socket.read_stream = stream;
        socket.reader = socket.read_stream.reader();
        return socket;
    }

    // ------------------------------------------------------------------------
    // Stream API
    // ------------------------------------------------------------------------
    pub const TextFrameWriter = std.io.Writer(*Websocket, WriteError, Websocket.writeText);
    pub const BinaryFrameWriter = std.io.Writer(*Websocket, anyerror, Websocket.writeBinary);

    // A buffered writer that will buffer up to size bytes before writing out
    pub fn newWriter(self: *Websocket, comptime size: usize, comptime opcode: Opcode) Writer(size, opcode) {
        const BufferedWriter = Writer(size, opcode);
        const frame_writer = switch (opcode) {
            .Text => TextFrameWriter{ .context = self },
            .Binary => BinaryFrameWriter{ .context = self },
            else => @compileError("Unsupported writer type"),
        };
        return BufferedWriter{ .unbuffered_writer = frame_writer };
    }

    // Close and send the status
    pub fn close(self: *Websocket, code: u16) !void {
        const c = @byteSwap(code);
        const data = @as([2]u8, @bitCast(c));
        _ = try self.writeMessage(.Close, &data);
    }

    // ------------------------------------------------------------------------
    // Low level API
    // ------------------------------------------------------------------------

    // Flush any buffered data out the underlying stream
    pub fn flush(self: *Websocket) !void {
        try self.io.flush();
    }

    pub fn writeText(self: *Websocket, data: []const u8) !usize {
        return self.writeMessage(.Text, data);
    }

    pub fn writeBinary(self: *Websocket, data: []const u8) anyerror!usize {
        return self.writeMessage(.Binary, data);
    }

    // Write a final message packet with the given opcode
    pub fn writeMessage(self: *Websocket, opcode: Opcode, message: []const u8) anyerror!usize {
        return self.writeSplitMessage(opcode, true, message);
    }

    // Write a message packet with the given opcode and final flag
    pub fn writeSplitMessage(self: *Websocket, opcode: Opcode, final: bool, message: []const u8) anyerror!usize {
        return self.writeDataFrame(WebsocketDataFrame{
            .header = WebsocketHeader{
                .final = final,
                .opcode = opcode,
                .mask = false, // Server to client is not masked
                .len = WebsocketHeader.packLength(message.len),
            },
            .data = message,
        });
    }

    // Write a raw data frame
    pub fn writeDataFrame(self: *Websocket, dataframe: WebsocketDataFrame) anyerror!usize {
        var stream = self.stream.writer();

        if (!dataframe.isValid()) return error.InvalidMessage;

        try stream.writeInt(u16, @as(u16, @bitCast(dataframe.header)), .big);

        // Write extended length if needed
        const n = dataframe.data.len;
        switch (n) {
            0...126 => {}, // Included in header
            127...0xFFFF => try stream.writeInt(u16, @as(u16, @truncate(n)), .big),
            else => try stream.writeInt(u64, n, .big),
        }

        // TODO: Handle compression
        if (dataframe.header.compressed) return error.InvalidMessage;

        if (dataframe.header.mask) {
            const mask = &dataframe.mask;
            try stream.writeAll(mask);

            // Encode
            for (dataframe.data, 0..) |c, i| {
                try stream.writeByte(c ^ mask[i % 4]);
            }
        } else {
            try stream.writeAll(dataframe.data);
        }

        // try self.io.flush();

        return dataframe.data.len;
    }

    pub fn read(self: *Websocket) !WebsocketDataFrame {
        @memset(&self.buf, 0);

        // Read and retry if we hit the end of the stream buffer
        const start = try self.stream.read(&self.buf);
        if (start == 0) {
            return error.ConnectionClosed;
        }

        self.read_stream.pos = start;
        return try self.readDataFrameInBuffer();
    }

    pub fn eatAt(self: *Websocket, offset: usize, _len: usize) []u8 {
        const len = @min(self.read_stream.buffer.len, _len);
        self.read_stream.pos = len;
        return self.read_stream.buffer[offset..len];
    }

    // Read assuming everything can fit before the stream hits the end of
    // it's buffer
    pub fn readDataFrameInBuffer(
        self: *Websocket,
    ) !WebsocketDataFrame {
        var buf: []u8 = self.buf[0..];

        const header_bytes = buf[0..2];
        var header = std.mem.zeroes(WebsocketHeader);
        header.final = header_bytes[0] & 0x80 == 0x80;
        // header.rsv1 = header_bytes[0] & 0x40 == 0x40;
        // header.rsv2 = header_bytes[0] & 0x20;
        // header.rsv3 = header_bytes[0] & 0x10;
        header.opcode = @as(Opcode, @enumFromInt(@as(u4, @truncate(header_bytes[0]))));
        header.mask = header_bytes[1] & 0x80 == 0x80;
        header.len = @as(u7, @truncate(header_bytes[1]));

        // Decode length
        var length: u64 = header.len;

        switch (header.len) {
            126 => {
                length = std.mem.readInt(u16, buf[2..4], .big);
                buf = buf[4..];
            },
            127 => {
                length = std.mem.readInt(u64, buf[2..10], .big);
                // Most significant bit must be 0
                if (length >> 63 == 1) {
                    return error.InvalidMessage;
                }
                buf = buf[10..];
            },
            else => {
                buf = buf[2..];
            },
        }

        const start: usize = if (header.mask) 4 else 0;

        const end = start + length;

        if (end > self.read_stream.pos) {
            const extend_length = try self.stream.read(self.buf[self.read_stream.pos..]);
            if (self.read_stream.pos + extend_length > self.buf.len) {
                return error.MessageTooLarge;
            }
            self.read_stream.pos += extend_length;
        }

        var data = buf[start..end];

        if (header.mask) {
            const mask = buf[0..4];
            // Decode data in place
            for (data, 0..) |_, i| {
                data[i] ^= mask[i % 4];
            }
        }

        return WebsocketDataFrame{
            .header = header,
            .mask = if (header.mask) buf[0..4].* else undefined,
            .data = data,
        };
    }
};
