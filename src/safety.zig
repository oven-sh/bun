const std = @import("std");
const bun = @import("bun");

const global_allocators = @import("./allocators/memory_allocator.zig");
const c_allocator = global_allocators.c_allocator;
const z_allocator = global_allocators.z_allocator;

const Allocator = std.mem.Allocator;
const enabled = bun.Environment.ci_assert;

fn noAlloc(ptr: *anyopaque, len: usize, alignment: std.mem.Alignment, ret_addr: usize) ?[*]u8 {
    _ = ptr;
    _ = len;
    _ = alignment;
    _ = ret_addr;
    return null;
}

const dummy_vtable = Allocator.VTable{
    .alloc = noAlloc,
    .resize = Allocator.noResize,
    .remap = Allocator.noRemap,
    .free = Allocator.noFree,
};

const arena_vtable = blk: {
    var arena = std.heap.ArenaAllocator.init(.{
        .ptr = undefined,
        .vtable = &dummy_vtable,
    });
    break :blk arena.allocator().vtable;
};

/// Returns true if `alloc` definitely has a valid `.ptr`.
fn hasPtr(alloc: Allocator) bool {
    return alloc.vtable == arena_vtable or
        bun.AllocationScope.downcast(alloc) != null or
        bun.MemoryReportingAllocator.isInstance(alloc) or
        ((comptime bun.Environment.isLinux) and bun.linux.memfd_allocator.isInstance(alloc)) or
        bun.MaxHeapAllocator.isInstance(alloc) or
        alloc.vtable == c_allocator.vtable or
        alloc.vtable == z_allocator.vtable or
        bun.MimallocArena.isInstance(alloc) or
        bun.jsc.CachedBytecode.isInstance(alloc) or
        bun.bundle_v2.allocatorHasPointer(alloc) or
        ((comptime bun.heap_breakdown.enabled) and bun.heap_breakdown.Zone.isInstance(alloc)) or
        bun.String.isWTFAllocator(alloc);
}

fn allocToPtr(alloc: Allocator) *anyopaque {
    return if (hasPtr(alloc)) alloc.ptr else @ptrCast(@constCast(alloc.vtable));
}

/// Use this in unmanaged containers to ensure multiple allocators aren't being used with the
/// same container. Each method of the container that accepts an allocator parameter should call
/// either `AllocPtr.set` (for non-const methods) or `AllocPtr.assertEq` (for const methods).
/// (Exception: methods like `clone` which explicitly accept any allocator should not call any
/// methods on this type.)
pub const AllocPtr = struct {
    const Self = @This();

    ptr: if (enabled) ?*anyopaque else void = if (enabled) null,

    pub fn init(alloc: Allocator) Self {
        var self = Self{};
        self.set(alloc);
        return self;
    }

    pub fn set(self: *Self, alloc: Allocator) void {
        if (comptime !enabled) return;
        const ptr = allocToPtr(alloc);
        if (self.ptr == null) {
            self.ptr = ptr;
        } else {
            self.assertPtrEq(ptr);
        }
    }

    pub fn assertEq(self: Self, alloc: Allocator) void {
        if (comptime !enabled) return;
        self.assertPtrEq(allocToPtr(alloc));
    }

    fn assertPtrEq(self: Self, ptr: *anyopaque) void {
        if (self.ptr) |self_ptr| bun.assertf(
            ptr == self_ptr,
            "cannot use multiple allocators with the same collection",
            .{},
        );
    }
};
