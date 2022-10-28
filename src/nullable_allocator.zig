const std = @import("std");

/// A nullable allocator the same size as `std.mem.Allocator`.
pub const NullableAllocator = struct {
    ptr: *anyopaque = undefined,
    // Utilize the null pointer optimization on the vtable instead of
    // the regular ptr because some allocator implementations might tag their
    // `ptr` property.
    vtable: ?*const std.mem.Allocator.VTable = null,

    pub inline fn init(a: std.mem.Allocator) @This() {
        return .{
            .ptr = a.ptr,
            .vtable = a.vtable,
        };
    }

    pub inline fn isNull(this: @This()) bool {
        return this.vtable == null;
    }

    pub inline fn get(this: @This()) ?std.mem.Allocator {
        return if (this.vtable) |vt| std.mem.Allocator{ .ptr = this.ptr, .vtable = vt } else null;
    }
};

comptime {
    if (@sizeOf(NullableAllocator) != @sizeOf(std.mem.Allocator)) {
        @compileError("Expected the sizes to be the same.");
    }
}
