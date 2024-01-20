const std = @import("std");

const SourceMap = struct {
    const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    const vlq_lookup_table: [256]VLQ = brk: {
        var entries: [256]VLQ = undefined;
        var i: usize = 0;
        var j: i32 = 0;
        while (i < 256) : (i += 1) {
            entries[i] = encodeVLQ(j);
            j += 1;
        }
        break :brk entries;
    };

    const vlq_max_in_bytes = 8;
    pub const VLQ = struct {
        // We only need to worry about i32
        // That means the maximum VLQ-encoded value is 8 bytes
        // because there are only 4 bits of number inside each VLQ value
        // and it expects i32
        // therefore, it can never be more than 32 bits long
        // I believe the actual number is 7 bytes long, however we can add an extra byte to be more cautious
        bytes: [vlq_max_in_bytes]u8,
        len: u4 = 0,
    };

    pub fn encodeVLQWithLookupTable(
        value: i32,
    ) VLQ {
        return if (value >= 0 and value <= 255)
            vlq_lookup_table[@as(usize, @intCast(value))]
        else
            encodeVLQ(value);
    }

    // A single base 64 digit can contain 6 bits of data. For the base 64 variable
    // length quantities we use in the source map spec, the first bit is the sign,
    // the next four bits are the actual value, and the 6th bit is the continuation
    // bit. The continuation bit tells us whether there are more digits in this
    // value following this digit.
    //
    //   Continuation
    //   |    Sign
    //   |    |
    //   V    V
    //   101011
    //
    pub fn encodeVLQ(
        value: i32,
    ) VLQ {
        var len: u4 = 0;
        var bytes: [vlq_max_in_bytes]u8 = undefined;

        var vlq: u32 = if (value >= 0)
            @as(u32, @bitCast(value << 1))
        else
            @as(u32, @bitCast((-value << 1) | 1));

        // source mappings are limited to i32
        comptime var i: usize = 0;
        inline while (i < vlq_max_in_bytes) : (i += 1) {
            var digit = vlq & 31;
            vlq >>= 5;

            // If there are still more digits in this value, we must make sure the
            // continuation bit is marked
            if (vlq != 0) {
                digit |= 32;
            }

            bytes[len] = base64[digit];
            len += 1;

            if (vlq == 0) {
                return VLQ{
                    .bytes = bytes,
                    .len = len,
                };
            }
        }

        return .{ .bytes = bytes, .len = 0 };
    }

    pub const VLQResult = struct {
        value: i32 = 0,
        start: usize = 0,
    };

    // base64 stores values up to 7 bits
    const base64_lut: [std.math.maxInt(u7)]u7 = brk: {
        @setEvalBranchQuota(9999);
        var bytes = [_]u7{std.math.maxInt(u7)} ** std.math.maxInt(u7);

        for (base64, 0..) |c, i| {
            bytes[c] = i;
        }

        break :brk bytes;
    };

    pub fn decodeVLQ(encoded: []const u8, start: usize) VLQResult {
        var shift: u8 = 0;
        var vlq: u32 = 0;

        // hint to the compiler what the maximum value is
        const encoded_ = encoded[start..][0..@min(encoded.len - start, comptime (vlq_max_in_bytes + 1))];

        // inlining helps for the 1 or 2 byte case, hurts a little for larger
        comptime var i: usize = 0;
        inline while (i < vlq_max_in_bytes + 1) : (i += 1) {
            const index = @as(u32, base64_lut[@as(u7, @truncate(encoded_[i]))]);

            // decode a byte
            vlq |= (index & 31) << @as(u5, @truncate(shift));
            shift += 5;

            // Stop if there's no continuation bit
            if ((index & 32) == 0) {
                return VLQResult{
                    .start = i + start,
                    .value = if ((vlq & 1) == 0)
                        @as(i32, @intCast(vlq >> 1))
                    else
                        -@as(i32, @intCast((vlq >> 1))),
                };
            }
        }

        return VLQResult{ .start = start + encoded_.len, .value = 0 };
    }
};

pub fn main() anyerror!void {
    const args = try std.process.argsAlloc(std.heap.c_allocator);
    const how_many = try std.fmt.parseInt(u64, args[args.len - 1], 10);

    var numbers = try std.heap.c_allocator.alloc(i32, how_many);
    var results = try std.heap.c_allocator.alloc(SourceMap.VLQ, how_many);
    var leb_buf = try std.heap.c_allocator.alloc(u8, how_many * 8);
    const byte_size = std.mem.sliceAsBytes(numbers).len;

    var rand = std.rand.DefaultPrng.init(0);

    std.debug.print("Random values:\n\n", .{});

    for (numbers, 0..) |_, i| {
        numbers[i] = rand.random().int(i32);
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers, 0..) |n, i| {
            results[i] = SourceMap.encodeVLQ(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]                encode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers, 0..) |n, i| {
            results[i] = SourceMap.encodeVLQWithLookupTable(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}] encodeWithLookupTable: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (results, 0..) |n, i| {
            numbers[i] = SourceMap.decodeVLQ(n.bytes[0..n.len], 0).value;
        }

        const elapsed = timer.read();
        std.debug.print("[{d}]                decode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();
        var stream = std.io.fixedBufferStream(leb_buf);
        var writer = stream.writer();
        for (numbers) |n| {
            std.leb.writeILEB128(writer, n) catch unreachable;
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]        ILEB128 encode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();
        var stream = std.io.fixedBufferStream(leb_buf);
        var reader = stream.reader();
        for (numbers, 0..) |_, i| {
            numbers[i] = std.leb.readILEB128(i32, reader) catch unreachable;
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]        ILEB128 decode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    std.debug.print("\nNumbers between 0 - 8192:\n\n", .{});

    for (numbers, 0..) |_, i| {
        numbers[i] = rand.random().intRangeAtMost(i32, 0, 8192);
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers, 0..) |n, i| {
            results[i] = SourceMap.encodeVLQ(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]                encode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers, 0..) |n, i| {
            results[i] = SourceMap.encodeVLQWithLookupTable(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}] encodeWithLookupTable: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (results, 0..) |n, i| {
            numbers[i] = SourceMap.decodeVLQ(n.bytes[0..n.len], 0).value;
        }

        const elapsed = timer.read();
        std.debug.print("[{d}]                decode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();
        var stream = std.io.fixedBufferStream(leb_buf);
        var writer = stream.writer();
        for (numbers) |n| {
            std.leb.writeILEB128(writer, n) catch unreachable;
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]        ILEB128 encode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();
        var stream = std.io.fixedBufferStream(leb_buf);
        var reader = stream.reader();
        for (numbers, 0..) |_, i| {
            numbers[i] = std.leb.readILEB128(i32, reader) catch unreachable;
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]        ILEB128 decode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    std.debug.print("\nNumbers between 0 - 255:\n\n", .{});

    for (numbers, 0..) |_, i| {
        numbers[i] = rand.random().intRangeAtMost(i32, 0, 255);
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers, 0..) |n, i| {
            results[i] = SourceMap.encodeVLQ(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]                encode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers, 0..) |n, i| {
            results[i] = SourceMap.encodeVLQWithLookupTable(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}] encodeWithLookupTable: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (results, 0..) |n, i| {
            numbers[i] = SourceMap.decodeVLQ(n.bytes[0..n.len], 0).value;
        }

        const elapsed = timer.read();
        std.debug.print("[{d}]                decode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();
        var stream = std.io.fixedBufferStream(leb_buf);
        var writer = stream.writer();
        for (numbers) |n| {
            std.leb.writeILEB128(writer, n) catch unreachable;
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]        ILEB128 encode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();
        var stream = std.io.fixedBufferStream(leb_buf);
        var reader = stream.reader();
        for (numbers, 0..) |_, i| {
            numbers[i] = std.leb.readILEB128(i32, reader) catch unreachable;
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]        ILEB128 decode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }
}

test "encodeVLQ" {
    const fixtures = .{
        .{ 2_147_483_647, "+/////D" },
        .{ -2_147_483_647, "//////D" },
        .{ 0, "A" },
        .{ 1, "C" },
        .{ -1, "D" },
        .{ 123, "2H" },
        .{ 123456789, "qxmvrH" },
    };
    inline for (fixtures) |fixture| {
        const result = SourceMap.encodeVLQ(fixture[0]);
        try std.testing.expectEqualStrings(fixture[1], result.bytes[0..result.len]);
    }
}

test "decodeVLQ" {
    const fixtures = .{
        .{ 2_147_483_647, "+/////D" },
        .{ -2_147_483_647, "//////D" },
        .{ 0, "A" },
        .{ 1, "C" },
        .{ -1, "D" },
        .{ 123, "2H" },
        .{ 123456789, "qxmvrH" },
    };
    inline for (fixtures) |fixture| {
        const result = SourceMap.decodeVLQ(fixture[1], 0);
        try std.testing.expectEqual(
            result.value,
            fixture[0],
        );
    }
}
