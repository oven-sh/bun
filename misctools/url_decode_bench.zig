const std = @import("std");
const bun = @import("bun");

const PercentEncoding = bun.PercentEncoding;

fn fillEncoded(buf: []u8, seed: u64) []const u8 {
    var prng = std.Random.DefaultPrng.init(seed);
    const rand = prng.random();

    var i: usize = 0;
    while (i < buf.len) : (i += 1) {
        const r = rand.uintLessThan(u8, 100);
        if (r < 5 and i + 3 <= buf.len) {
            buf[i] = '%';
            buf[i + 1] = '4';
            buf[i + 2] = '1'; // 'A'
            i += 2;
            continue;
        }

        buf[i] = 'a' + rand.uintLessThan(u8, 26);
    }

    return buf;
}

fn runCase(out_buf: []u8, encoded: []const u8, iters: usize) !u64 {
    var sink: u64 = 0;

    var i: usize = 0;
    while (i < iters) : (i += 1) {
        var stream = std.io.fixedBufferStream(out_buf);
        const writer = stream.writer();
        const written = try PercentEncoding.decode(@TypeOf(writer), writer, encoded);
        sink +%= @as(u64, written);
        sink +%= out_buf[0];
    }

    return sink;
}

pub fn main() !void {
    var gpa_impl = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa_impl.deinit();
    const allocator = gpa_impl.allocator();

    var stdout_buf: [4096]u8 = undefined;
    var stdout_file_writer = std.fs.File.stdout().writer(&stdout_buf);
    var stdout = &stdout_file_writer.interface;

    const iters = 200_000;

    var encoded_small_buf: [64]u8 = undefined;
    const encoded_small = fillEncoded(&encoded_small_buf, 0x1234);

    var encoded_medium_buf: [1024]u8 = undefined;
    const encoded_medium = fillEncoded(&encoded_medium_buf, 0x5678);

    const out_small = try allocator.alloc(u8, encoded_small.len);
    defer allocator.free(out_small);

    const out_medium = try allocator.alloc(u8, encoded_medium.len);
    defer allocator.free(out_medium);

    var timer = try std.time.Timer.start();
    const sink_small = try runCase(out_small, encoded_small, iters);
    const ns_small = timer.read();

    timer.reset();
    const sink_medium = try runCase(out_medium, encoded_medium, iters / 64);
    const ns_medium = timer.read();

    try stdout.print("url_decode_bench\n", .{});
    try stdout.print("small: bytes={d} iters={d} ns_total={d} ns_per_iter={d} sink={d}\n", .{ encoded_small.len, iters, ns_small, ns_small / iters, sink_small });
    try stdout.print("medium: bytes={d} iters={d} ns_total={d} ns_per_iter={d} sink={d}\n", .{ encoded_medium.len, iters / 64, ns_medium, ns_medium / (iters / 64), sink_medium });
    try stdout.flush();
}
