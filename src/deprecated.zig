pub fn BufferedWriter(comptime buffer_size: usize, comptime WriterType: type) type {
    return struct {
        unbuffered_writer: WriterType,
        buf: [buffer_size]u8 = undefined,
        end: usize = 0,

        pub const Error = WriterType.Error;
        pub const Writer = std.Io.GenericWriter(*Self, Error, write);

        const Self = @This();

        pub fn flush(self: *Self) !void {
            try self.unbuffered_writer.writeAll(self.buf[0..self.end]);
            self.end = 0;
        }

        pub fn writer(self: *Self) Writer {
            return .{ .context = self };
        }

        pub fn write(self: *Self, bytes: []const u8) Error!usize {
            if (self.end + bytes.len > self.buf.len) {
                try self.flush();
                if (bytes.len > self.buf.len)
                    return self.unbuffered_writer.write(bytes);
            }

            const new_end = self.end + bytes.len;
            @memcpy(self.buf[self.end..new_end], bytes);
            self.end = new_end;
            return bytes.len;
        }
    };
}

pub fn bufferedWriter(underlying_stream: anytype) BufferedWriter(4096, @TypeOf(underlying_stream)) {
    return .{ .unbuffered_writer = underlying_stream };
}

const std = @import("std");

pub fn BufferedReader(comptime buffer_size: usize, comptime ReaderType: type) type {
    return struct {
        unbuffered_reader: ReaderType,
        buf: [buffer_size]u8 = undefined,
        start: usize = 0,
        end: usize = 0,

        pub const Error = ReaderType.Error;
        pub const Reader = std.Io.GenericReader(*Self, Error, read);

        const Self = @This();

        pub fn read(self: *Self, dest: []u8) Error!usize {
            // First try reading from the already buffered data onto the destination.
            const current = self.buf[self.start..self.end];
            if (current.len != 0) {
                const to_transfer = @min(current.len, dest.len);
                @memcpy(dest[0..to_transfer], current[0..to_transfer]);
                self.start += to_transfer;
                return to_transfer;
            }

            // If dest is large, read from the unbuffered reader directly into the destination.
            if (dest.len >= buffer_size) {
                return self.unbuffered_reader.read(dest);
            }

            // If dest is small, read from the unbuffered reader into our own internal buffer,
            // and then transfer to destination.
            self.end = try self.unbuffered_reader.read(&self.buf);
            const to_transfer = @min(self.end, dest.len);
            @memcpy(dest[0..to_transfer], self.buf[0..to_transfer]);
            self.start = to_transfer;
            return to_transfer;
        }

        pub fn reader(self: *Self) Reader {
            return .{ .context = self };
        }
    };
}

pub fn bufferedReader(reader: anytype) BufferedReader(4096, @TypeOf(reader)) {
    return .{ .unbuffered_reader = reader };
}

pub fn bufferedReaderSize(comptime size: usize, reader: anytype) BufferedReader(size, @TypeOf(reader)) {
    return .{ .unbuffered_reader = reader };
}

test "OneByte" {
    const OneByteReadReader = struct {
        str: []const u8,
        curr: usize,

        const Error = error{NoError};
        const Self = @This();
        const Reader = std.Io.GenericReader(*Self, Error, read);

        fn init(str: []const u8) Self {
            return Self{
                .str = str,
                .curr = 0,
            };
        }

        fn read(self: *Self, dest: []u8) Error!usize {
            if (self.str.len <= self.curr or dest.len == 0)
                return 0;

            dest[0] = self.str[self.curr];
            self.curr += 1;
            return 1;
        }

        fn reader(self: *Self) Reader {
            return .{ .context = self };
        }
    };

    const str = "This is a test";
    var one_byte_stream = OneByteReadReader.init(str);
    var buf_reader = bufferedReader(one_byte_stream.reader());
    const stream = buf_reader.reader();

    const res = try stream.readAllAlloc(std.testing.allocator, str.len + 1);
    defer std.testing.allocator.free(res);
    try std.testing.expectEqualSlices(u8, str, res);
}

fn smallBufferedReader(underlying_stream: anytype) BufferedReader(8, @TypeOf(underlying_stream)) {
    return .{ .unbuffered_reader = underlying_stream };
}
test "Block" {
    const BlockReader = struct {
        block: []const u8,
        reads_allowed: usize,
        curr_read: usize,

        const Error = error{NoError};
        const Self = @This();
        const Reader = std.Io.GenericReader(*Self, Error, read);

        fn init(block: []const u8, reads_allowed: usize) Self {
            return Self{
                .block = block,
                .reads_allowed = reads_allowed,
                .curr_read = 0,
            };
        }

        fn read(self: *Self, dest: []u8) Error!usize {
            if (self.curr_read >= self.reads_allowed) return 0;
            @memcpy(dest[0..self.block.len], self.block);

            self.curr_read += 1;
            return self.block.len;
        }

        fn reader(self: *Self) Reader {
            return .{ .context = self };
        }
    };

    const block = "0123";

    // len out == block
    {
        var test_buf_reader: BufferedReader(4, BlockReader) = .{
            .unbuffered_reader = BlockReader.init(block, 2),
        };
        const reader = test_buf_reader.reader();
        var out_buf: [4]u8 = undefined;
        _ = try reader.readAll(&out_buf);
        try std.testing.expectEqualSlices(u8, &out_buf, block);
        _ = try reader.readAll(&out_buf);
        try std.testing.expectEqualSlices(u8, &out_buf, block);
        try std.testing.expectEqual(try reader.readAll(&out_buf), 0);
    }

    // len out < block
    {
        var test_buf_reader: BufferedReader(4, BlockReader) = .{
            .unbuffered_reader = BlockReader.init(block, 2),
        };
        const reader = test_buf_reader.reader();
        var out_buf: [3]u8 = undefined;
        _ = try reader.readAll(&out_buf);
        try std.testing.expectEqualSlices(u8, &out_buf, "012");
        _ = try reader.readAll(&out_buf);
        try std.testing.expectEqualSlices(u8, &out_buf, "301");
        const n = try reader.readAll(&out_buf);
        try std.testing.expectEqualSlices(u8, out_buf[0..n], "23");
        try std.testing.expectEqual(try reader.readAll(&out_buf), 0);
    }

    // len out > block
    {
        var test_buf_reader: BufferedReader(4, BlockReader) = .{
            .unbuffered_reader = BlockReader.init(block, 2),
        };
        const reader = test_buf_reader.reader();
        var out_buf: [5]u8 = undefined;
        _ = try reader.readAll(&out_buf);
        try std.testing.expectEqualSlices(u8, &out_buf, "01230");
        const n = try reader.readAll(&out_buf);
        try std.testing.expectEqualSlices(u8, out_buf[0..n], "123");
        try std.testing.expectEqual(try reader.readAll(&out_buf), 0);
    }

    // len out == 0
    {
        var test_buf_reader: BufferedReader(4, BlockReader) = .{
            .unbuffered_reader = BlockReader.init(block, 2),
        };
        const reader = test_buf_reader.reader();
        var out_buf: [0]u8 = undefined;
        _ = try reader.readAll(&out_buf);
        try std.testing.expectEqualSlices(u8, &out_buf, "");
    }

    // len bufreader buf > block
    {
        var test_buf_reader: BufferedReader(5, BlockReader) = .{
            .unbuffered_reader = BlockReader.init(block, 2),
        };
        const reader = test_buf_reader.reader();
        var out_buf: [4]u8 = undefined;
        _ = try reader.readAll(&out_buf);
        try std.testing.expectEqualSlices(u8, &out_buf, block);
        _ = try reader.readAll(&out_buf);
        try std.testing.expectEqualSlices(u8, &out_buf, block);
        try std.testing.expectEqual(try reader.readAll(&out_buf), 0);
    }
}
