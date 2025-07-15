const bun = @import("bun");

const isDebug = bun.Environment.ci_assert;

/// Use this in unmanaged containers to ensure multiple allocators aren't being used with the
/// same container. Each method of the container that accepts an allocator parameter should call
/// either `AllocPtr.set` (for non-const methods) or `AllocPtr.assertEq` (for const methods).
/// (Exception: methods like `clone` which explicitly accept any allocator should not call any
/// methods on this type.)
pub const AllocPtr = struct {
    const Self = @This();

    ptr: if (isDebug) ?*anyopaque else void = if (isDebug) null,

    pub fn init(ptr: *anyopaque) Self {
        var self = Self{};
        self.set(ptr);
        return self;
    }

    pub fn set(self: *Self, ptr: *anyopaque) void {
        if (comptime !isDebug) return;
        if (self.ptr == null) {
            self.ptr = ptr;
        } else {
            self.assertEq(ptr);
        }
    }

    pub fn assertEq(self: Self, ptr: *anyopaque) void {
        if (comptime !isDebug) return;
        bun.assertf(ptr == self.ptr, "cannot use multiple allocators with same container", .{});
    }
};
