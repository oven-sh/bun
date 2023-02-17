const Lock = @import("../lock.zig").Lock;
const std = @import("std");
const MutableString = @import("bun").MutableString;
const getAllocator = @import("../http_client_async.zig").getAllocator;
const ZlibPool = @This();
const Zlib = @import("../zlib.zig");
const bun = @import("bun");

fn initMutableString(allocator: std.mem.Allocator) anyerror!MutableString {
    return MutableString.initEmpty(allocator);
}

const BufferPool = bun.ObjectPool(MutableString, initMutableString, false, 4);

pub fn get(allocator: std.mem.Allocator) *MutableString {
    return &BufferPool.get(allocator).data;
}

pub fn put(mutable: *MutableString) void {
    mutable.reset();
    var node = @fieldParentPtr(BufferPool.Node, "data", mutable);
    node.release();
}

pub fn decompress(compressed_data: []const u8, output: *MutableString, allocator: std.mem.Allocator) Zlib.ZlibError!void {
    var reader = try Zlib.ZlibReaderArrayList.initWithOptionsAndListAllocator(
        compressed_data,
        &output.list,
        output.allocator,
        allocator,
        .{
            .windowBits = 15 + 32,
        },
    );
    try reader.readAll();
    reader.deinit();
}
