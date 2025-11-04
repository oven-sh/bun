pub const c_allocator = std.heap.c_allocator;
pub const z_allocator = @import("./fallback/z.zig").allocator;

/// libc can free allocations without being given their size.
pub fn freeWithoutSize(ptr: ?*anyopaque) void {
    std.c.free(ptr);
}

const std = @import("std");
