const strings = @import("root").bun.strings;
const std = @import("std");

pub fn main() anyerror!void {
    const args = try std.process.argsAlloc(std.heap.c_allocator);
    const filepath = args[args.len - 3];
    const find = args[args.len - 2];
    const amount = try std.fmt.parseInt(usize, args[args.len - 1], 10);
    var file = try std.fs.cwd().openFile(filepath, .{ .mode = .read_only });
    var contents = try file.readToEndAlloc(std.heap.c_allocator, std.math.maxInt(usize));
    var list = try std.ArrayList(u8).initCapacity(std.heap.c_allocator, contents.len);
    var duped = list.items.ptr[0..contents.len];
    {
        var timer = try std.time.Timer.start();
        var index: usize = std.math.maxInt(usize);
        var j: usize = 0;
        var i: usize = 0;
        while (j < amount) : (j += 1) {
            i = 0;
            strings.copy(duped, contents);
        }

        if (index == std.math.maxInt(usize)) {
            std.debug.print("manual        [{d} byte file] {s} NOT found in {}\n", .{ contents.len, find, std.fmt.fmtDuration(timer.read()) });
        } else {
            std.debug.print("manual        [{d} byte file] {s} found at {d} in {}\n", .{ contents.len, find, index, std.fmt.fmtDuration(timer.read()) });
        }
    }

    {
        var timer = try std.time.Timer.start();
        var index: usize = std.math.maxInt(usize);
        var j: usize = 0;
        var i: usize = 0;
        while (j < amount) : (j += 1) {
            i = 0;
            @memcpy(duped, contents);
        }

        if (index == std.math.maxInt(usize)) {
            std.debug.print("memcpy      [{d} byte file] {s} NOT found in {}\n", .{ contents.len, find, std.fmt.fmtDuration(timer.read()) });
        } else {
            std.debug.print("memcpy      [{d} byte file] {s} found at {d} in {}\n", .{ contents.len, find, index, std.fmt.fmtDuration(timer.read()) });
        }
    }

    {
        var timer = try std.time.Timer.start();
        var index: usize = std.math.maxInt(usize);
        var j: usize = 0;
        var i: usize = 0;
        while (j < amount) : (j += 1) {
            i = 0;
            list.clearRetainingCapacity();
            list.appendSliceAssumeCapacity(contents);
        }

        if (index == std.math.maxInt(usize)) {
            std.debug.print("ArrayList  [{d} byte file] {s} NOT found in {}\n", .{ contents.len, find, std.fmt.fmtDuration(timer.read()) });
        } else {
            std.debug.print("ArrayList  [{d} byte file] {s} found at {d} in {}\n", .{ contents.len, find, index, std.fmt.fmtDuration(timer.read()) });
        }
    }
}
