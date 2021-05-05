const std = @import("std");

const STATIC_MEMORY_SIZE = 256000;
pub var static_manager: ?std.heap.ArenaAllocator = null;
pub var root_manager: ?RootAlloc = null;
pub var needs_setup: bool = true;
pub var static: *std.mem.Allocator = undefined;
pub var dynamic: *std.mem.Allocator = undefined;

pub fn setup(root: *std.mem.Allocator) !void {
    needs_setup = false;
    static = std.heap.c_allocator;
    dynamic = std.heap.c_allocator;
    // static = @ptrCast(*std.mem.Allocator, &stat.allocator);
}

test "GlobalAllocator" {
    try setup(std.heap.page_allocator);
    var testType = try static.alloc(u8, 10);
    testType[1] = 1;
}
