const Lock = @import("../lock.zig").Lock;
const std = @import("std");
const MutableString = @import("../global.zig").MutableString;
const getAllocator = @import("../http_client_async.zig").getAllocator;
const ZlibPool = @This();
const Zlib = @import("../zlib.zig");

lock: Lock = Lock.init(),
items: std.ArrayList(*MutableString),
allocator: std.mem.Allocator,

pub var instance: ZlibPool = undefined;
pub var loaded: bool = false;

pub fn init(allocator: std.mem.Allocator) ZlibPool {
    return ZlibPool{
        .allocator = allocator,
        .items = std.ArrayList(*MutableString).init(allocator),
    };
}

pub fn get(this: *ZlibPool) !*MutableString {
    std.debug.assert(loaded);

    switch (this.items.items.len) {
        0 => {
            var mutable = try getAllocator().create(MutableString);
            mutable.* = try MutableString.init(getAllocator(), 0);
            return mutable;
        },
        else => {
            return this.items.pop();
        },
    }

    unreachable;
}

pub fn put(this: *ZlibPool, mutable: *MutableString) !void {
    std.debug.assert(loaded);
    mutable.reset();
    try this.items.append(mutable);
}

pub fn decompress(compressed_data: []const u8, output: *MutableString) Zlib.ZlibError!void {
    // Heuristic: if we have more than 128 KB of data to decompress
    // it may take 1ms or so
    // We must keep the network thread unblocked as often as possible
    // So if we have more than 50 KB of data to decompress, we do it off the network thread
    // if (compressed_data.len < 50_000) {
    var reader = try Zlib.ZlibReaderArrayList.init(compressed_data, &output.list, getAllocator());
    try reader.readAll();
    return;
    // }

    // var task = try DecompressionTask.get(default_allocator);
    // defer task.release();
    // task.* = DecompressionTask{
    //     .data = compressed_data,
    //     .output = output,
    //     .event_fd = AsyncIO.global.eventfd(),
    // };
    // task.scheduleAndWait();

    // if (task.err) |err| {
    //     return @errSetCast(Zlib.ZlibError, err);
    // }
}
