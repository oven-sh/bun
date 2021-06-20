const std = @import("std");

// usage:
// ./file-path:0 10
// 1           2 3

// 1. file path
// 2. Byte offset in file
// 3. ms update interval
pub fn main() anyerror!void {
    var allocator = std.heap.c_allocator;
    var timer = try std.time.Timer.start();
    var color_buf: [2048]u8 = undefined;
    var args = std.mem.span(try std.process.argsAlloc(allocator));

    var basepath_with_colon: []u8 = args[args.len - 2];
    var basepath: []u8 = "";
    var position_str: []u8 = "";
    if (std.mem.lastIndexOfScalar(u8, basepath_with_colon, ':')) |colon| {
        basepath = basepath_with_colon[0..colon];
        position_str = basepath_with_colon[colon + 1 ..];
    }
    var position = try std.fmt.parseInt(u32, position_str, 10);
    const filepath = try std.fs.path.resolve(allocator, &.{basepath});
    var file = try std.fs.openFileAbsolute(filepath, .{ .write = true });
    var ms = @truncate(u64, (try std.fmt.parseInt(u128, args[args.len - 1], 10)) * std.time.ns_per_ms);
    std.debug.assert(ms > 0);
    // std.debug.assert(std.math.isFinite(position));
    var prng = std.rand.DefaultPrng.init(0);
    var stdout = std.io.getStdOut();
    var log = stdout.writer();
    var colors = std.mem.zeroes([4][3]u32);
    var progress_bar: f64 = 0.0;
    var destination_count: f64 = 18.0;

    // Randomize initial colors
    colors[0][0] = prng.random.int(u32);
    colors[0][1] = prng.random.int(u32);
    colors[0][2] = prng.random.int(u32);

    colors[1][0] = prng.random.int(u32);
    colors[1][1] = prng.random.int(u32);
    colors[1][2] = prng.random.int(u32);

    colors[2][0] = prng.random.int(u32);
    colors[2][1] = prng.random.int(u32);
    colors[2][2] = prng.random.int(u32);

    colors[3][0] = prng.random.int(u32);
    colors[3][1] = prng.random.int(u32);
    colors[3][2] = prng.random.int(u32);
    var rotate: u32 = 0;
    var counter: usize = 0;
    while (true) {
        colors[0][0] += 1;
        colors[0][1] += 1;
        colors[0][2] += 1;
        colors[1][0] += 1;
        colors[1][1] += 1;
        colors[1][2] += 1;
        colors[2][0] += 1;
        colors[2][1] += 1;
        colors[2][2] += 1;
        colors[3][0] += 1;
        colors[3][1] += 1;
        colors[3][2] += 1;
        rotate += 1;
        const fmtd =
            \\:root {{
            \\  --timestamp: "{d}";
            \\  --interval: "{s}";
            \\  --progress-bar: {d}%;
            \\  --spinner-1-muted: rgb({d}, {d}, {d});
            \\  --spinner-1-primary: rgb({d}, {d}, {d});
            \\  --spinner-2-muted: rgb({d}, {d}, {d});
            \\  --spinner-2-primary: rgb({d}, {d}, {d});
            \\  --spinner-3-muted: rgb({d}, {d}, {d});
            \\  --spinner-3-primary: rgb({d}, {d}, {d});
            \\  --spinner-4-muted: rgb({d}, {d}, {d});
            \\  --spinner-4-primary: rgb({d}, {d}, {d});
            \\  --spinner-rotate: {d}deg;
            \\}}
        ;

        file = try std.fs.createFileAbsolute(filepath, .{ .truncate = true });
        var wrote = try std.fmt.bufPrint(&color_buf, fmtd, .{
            counter,
            args[args.len - 1],
            std.math.mod(f64, std.math.round(((progress_bar + 1.0) / destination_count) * 1000) / 1000, 100),

            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[0][0] + 1) % 256)) * 0.8)),
            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[0][1] + 1) % 256)) * 0.8)),
            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[0][2] + 1) % 256)) * 0.8)),
            (colors[0][0] + 1) % 256,
            (colors[0][1] + 1) % 256,
            (colors[0][2] + 1) % 256,

            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[1][0] + 1) % 256)) * 0.8)),
            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[1][1] + 1) % 256)) * 0.8)),
            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[1][2] + 1) % 256)) * 0.8)),
            (colors[1][0] + 1) % 256,
            (colors[1][1] + 1) % 256,
            (colors[1][2] + 1) % 256,

            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[2][0] + 1) % 256)) * 0.8)),
            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[2][1] + 1) % 256)) * 0.8)),
            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[2][2] + 1) % 256)) * 0.8)),
            (colors[2][0] + 1) % 256,
            (colors[2][1] + 1) % 256,
            (colors[2][2] + 1) % 256,

            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[3][0] + 1) % 256)) * 0.8)),
            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[3][1] + 1) % 256)) * 0.8)),
            @floatToInt(u32, std.math.round(@intToFloat(f64, ((colors[3][2] + 1) % 256)) * 0.8)),
            (colors[3][0] + 1) % 256,
            (colors[3][1] + 1) % 256,
            (colors[3][2] + 1) % 256,

            rotate % 360,
        });
        progress_bar += 1.0;
        _ = try file.writeAll(wrote);

        try log.print("[{d}] \"{s}\":{d}\n", .{
            std.time.nanoTimestamp(),
            filepath,
            position,
        });
        counter += 1;
        // If we don't close the file, Parcel seems to never recognize it
        file.close();
        std.time.sleep(ms);
    }
}
