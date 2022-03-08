const std = @import("std");

const SourceMap = @import("./sourcemap.zig");

pub fn main() anyerror!void {
    const args = try std.process.argsAlloc(std.heap.c_allocator);
    const how_many = try std.fmt.parseInt(u64, args[args.len - 1], 10);

    var numbers = try std.heap.c_allocator.alloc(i32, how_many);
    var results = try std.heap.c_allocator.alloc(SourceMap.VLQ, how_many);
    const byte_size = std.mem.sliceAsBytes(numbers).len;

    var rand = std.rand.DefaultPrng.init(0);

    std.debug.print("Random values:\n\n", .{});

    for (numbers) |_, i| {
        numbers[i] = rand.random().int(i32);
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers) |n, i| {
            results[i] = SourceMap.encodeVLQ(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]                encode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers) |n, i| {
            results[i] = SourceMap.encodeVLQWithLookupTable(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}] encodeWithLookupTable: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (results) |n, i| {
            numbers[i] = SourceMap.decodeVLQ(n.bytes[0..n.len], 0).value;
        }

        const elapsed = timer.read();
        std.debug.print("[{d}]                decode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    std.debug.print("\nNumbers between 0 - 8096 (most columns won't exceed 255):\n\n", .{});

    for (numbers) |_, i| {
        numbers[i] = rand.random().intRangeAtMost(i32, 0, 8096);
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers) |n, i| {
            results[i] = SourceMap.encodeVLQ(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]                encode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers) |n, i| {
            results[i] = SourceMap.encodeVLQWithLookupTable(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}] encodeWithLookupTable: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (results) |n, i| {
            numbers[i] = SourceMap.decodeVLQ(n.bytes[0..n.len], 0).value;
        }

        const elapsed = timer.read();
        std.debug.print("[{d}]                decode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    std.debug.print("\nNumbers between 0 - 255 (most columns won't exceed 255):\n\n", .{});

    for (numbers) |_, i| {
        numbers[i] = rand.random().intRangeAtMost(i32, 0, 255);
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers) |n, i| {
            results[i] = SourceMap.encodeVLQ(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}]                encode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (numbers) |n, i| {
            results[i] = SourceMap.encodeVLQWithLookupTable(n);
        }
        const elapsed = timer.read();
        std.debug.print("[{d}] encodeWithLookupTable: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }

    {
        var timer = try std.time.Timer.start();

        for (results) |n, i| {
            numbers[i] = SourceMap.decodeVLQ(n.bytes[0..n.len], 0).value;
        }

        const elapsed = timer.read();
        std.debug.print("[{d}]                decode: {} in {}\n", .{ how_many, std.fmt.fmtIntSizeDec(byte_size), std.fmt.fmtDuration(elapsed) });
    }
}
