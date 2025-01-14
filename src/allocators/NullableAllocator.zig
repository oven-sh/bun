//! A nullable allocator the same size as `std.mem.Allocator`.
const std = @import("std");
const bun = @import("root").bun;

const NullableAllocator = @This();

ptr: *anyopaque = undefined,
// Utilize the null pointer optimization on the vtable instead of
// the regular ptr because some allocator implementations might tag their
// `ptr` property.
vtable: ?*const std.mem.Allocator.VTable = null,

pub inline fn init(allocator: ?std.mem.Allocator) NullableAllocator {
    return if (allocator) |a| .{
        .ptr = a.ptr,
        .vtable = a.vtable,
    } else .{};
}

pub inline fn isNull(this: NullableAllocator) bool {
    return this.vtable == null;
}

pub inline fn isWTFAllocator(this: NullableAllocator) bool {
    return bun.String.isWTFAllocator(this.get() orelse return false);
}

pub inline fn get(this: NullableAllocator) ?std.mem.Allocator {
    return if (this.vtable) |vt| std.mem.Allocator{ .ptr = this.ptr, .vtable = vt } else null;
}

pub fn free(this: *const NullableAllocator, bytes: []const u8) void {
    if (this.get()) |allocator| {
        if (bun.String.isWTFAllocator(allocator)) {
            // workaround for https://github.com/ziglang/zig/issues/4298
            bun.String.StringImplAllocator.free(allocator.ptr, @constCast(bytes), 0, 0);
            return;
        }

        allocator.free(bytes);
    }
}

comptime {
    if (@sizeOf(NullableAllocator) != @sizeOf(std.mem.Allocator)) {
        @compileError("Expected the sizes to be the same.");
    }
}
