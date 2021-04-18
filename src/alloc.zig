const std = @import("std");

const STATIC_MEMORY_SIZE = 256000;
pub var static_manager: ?std.heap.FixedBufferAllocator = null;
pub var dynamic_manager: ?std.heap.ArenaAllocator = null;
pub var root_manager: ?std.heap.ArenaAllocator = null;
pub var static: *std.mem.Allocator = undefined;
pub var dynamic: *std.mem.Allocator = undefined;

pub fn setup(root: *std.mem.Allocator) !void {
    root_manager = std.heap.ArenaAllocator.init(root);
    var buf = try root_manager.?.child_allocator.alloc(u8, STATIC_MEMORY_SIZE);
    dynamic_manager = std.heap.ArenaAllocator.init(root_manager.?.child_allocator);
    static_manager = std.heap.FixedBufferAllocator.init(buf);
    static = root_manager.?.child_allocator;

    dynamic_manager = std.heap.ArenaAllocator.init(root);
    dynamic = dynamic_manager.?.child_allocator;

    // static = @ptrCast(*std.mem.Allocator, &stat.allocator);
}

test "GlobalAllocator" {
    try setup(std.heap.page_allocator);
    var testType = try static.alloc(u8, 10);
    testType[1] = 1;
}
