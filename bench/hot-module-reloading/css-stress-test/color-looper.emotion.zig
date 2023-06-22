const std = @import("std");

pub const Counter = extern struct {
    timestamp: usize,
    percent: f64,
    rotate: u32,
    color_values: [8 * 3]u32,
};

const RUN_COUNT = 1024;

var counters: [RUN_COUNT]Counter = undefined;

pub const Blob = extern struct {
    run_count: u32,
    interval: u64,
};

pub var all_timestamps: [RUN_COUNT + 1]usize = undefined;

// usage:
// ./file-path:0 10
// 1           2 3

// 1. file path
// 2. Byte offset in file
// 3. ms update interval
var color_buf: [8096 + SIMULATE_LONG_FILE.len]u8 = undefined;

pub fn main() anyerror!void {
    var allocator = std.heap.c_allocator;
    var timer = try std.time.Timer.start();

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
    const video = std.fmt.allocPrint(allocator, "{s}.mov", .{filepath}) catch unreachable;
    std.fs.deleteFileAbsolute(video) catch {};
    var screen_recorder_argv = [_][]const u8{ "screencapture", "-v", video };

    var recorder = std.ChildProcess.init(&screen_recorder_argv, allocator);
    recorder.stdin_behavior = .Pipe;
    try recorder.spawn();
    std.time.sleep(std.time.ns_per_s);
    var wrote: []u8 = undefined;
    while (counter < RUN_COUNT) {
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
        const fmtd: []const u8 = comptime brk: {
            break :brk (
                \\
                \\import {{ Global }} from "@emotion/react";
                \\export function CSSInJSStyles() {{
                \\  return (
                \\    <Global
                \\      styles={{`
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
            ++ SIMULATE_LONG_FILE ++
                \\  `}}
                \\    />
                \\  );
                \\}}
                \\
            );
        };

        counters[counter].timestamp = @truncate(u64, @intCast(u128, std.time.nanoTimestamp()) / (std.time.ns_per_ms / 10));
        counters[counter].rotate = rotate % 360;
        counters[counter].percent = std.math.mod(f64, std.math.round(((progress_bar + 1.0) / destination_count) * 1000) / 1000, 100) catch 0;
        counters[counter].color_values[0] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[0][0] + 1) % 256)) * 0.8));
        counters[counter].color_values[1] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[0][1] + 1) % 256)) * 0.8));
        counters[counter].color_values[2] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[0][2] + 1) % 256)) * 0.8));
        counters[counter].color_values[3] = (colors[0][0] + 1) % 256;
        counters[counter].color_values[4] = (colors[0][1] + 1) % 256;
        counters[counter].color_values[5] = (colors[0][2] + 1) % 256;
        counters[counter].color_values[6] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[1][0] + 1) % 256)) * 0.8));
        counters[counter].color_values[7] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[1][1] + 1) % 256)) * 0.8));
        counters[counter].color_values[8] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[1][2] + 1) % 256)) * 0.8));
        counters[counter].color_values[9] = (colors[1][0] + 1) % 256;
        counters[counter].color_values[10] = (colors[1][1] + 1) % 256;
        counters[counter].color_values[11] = (colors[1][2] + 1) % 256;
        counters[counter].color_values[12] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[2][0] + 1) % 256)) * 0.8));
        counters[counter].color_values[13] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[2][1] + 1) % 256)) * 0.8));
        counters[counter].color_values[14] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[2][2] + 1) % 256)) * 0.8));
        counters[counter].color_values[15] = (colors[2][0] + 1) % 256;
        counters[counter].color_values[16] = (colors[2][1] + 1) % 256;
        counters[counter].color_values[17] = (colors[2][2] + 1) % 256;
        counters[counter].color_values[18] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[3][0] + 1) % 256)) * 0.8));
        counters[counter].color_values[19] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[3][1] + 1) % 256)) * 0.8));
        counters[counter].color_values[20] = @intFromFloat(u32, std.math.round(@floatFromInt(f64, ((colors[3][2] + 1) % 256)) * 0.8));
        counters[counter].color_values[21] = (colors[3][0] + 1) % 256;
        counters[counter].color_values[22] = (colors[3][1] + 1) % 256;
        counters[counter].color_values[23] = (colors[3][2] + 1) % 256;

        file = try std.fs.createFileAbsolute(filepath, .{ .truncate = true });
        wrote = try std.fmt.bufPrint(&color_buf, fmtd, .{
            counters[counter].timestamp,
            args[args.len - 1],
            counters[counter].percent,
            counters[counter].color_values[0],
            counters[counter].color_values[1],
            counters[counter].color_values[2],
            counters[counter].color_values[3],
            counters[counter].color_values[4],
            counters[counter].color_values[5],
            counters[counter].color_values[6],
            counters[counter].color_values[7],
            counters[counter].color_values[8],
            counters[counter].color_values[9],
            counters[counter].color_values[10],
            counters[counter].color_values[11],
            counters[counter].color_values[12],
            counters[counter].color_values[13],
            counters[counter].color_values[14],
            counters[counter].color_values[15],
            counters[counter].color_values[16],
            counters[counter].color_values[17],
            counters[counter].color_values[18],
            counters[counter].color_values[19],
            counters[counter].color_values[20],
            counters[counter].color_values[21],
            counters[counter].color_values[22],
            counters[counter].color_values[23],
            counters[counter].rotate,
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

    try recorder.stdin.?.writeAll(&[_]u8{ 3, ';' });

    _ = try recorder.wait();

    all_timestamps[0] = wrote.len;
    for (counters, 0..) |count, i| {
        all_timestamps[i + 1] = count.timestamp;
    }

    std.time.sleep(std.time.ns_per_s);
    var blob_file = try std.fs.createFileAbsolute(std.fmt.allocPrint(std.heap.c_allocator, "{s}.blob", .{filepath}) catch unreachable, .{ .truncate = true });
    try blob_file.writeAll(std.mem.asBytes(&all_timestamps));
    blob_file.close();
}

const SIMULATE_LONG_FILE =
    \\
;
