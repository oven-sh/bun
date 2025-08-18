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
        ((comptime bun.Environment.isLinux) and LinuxMemFdAllocator.isInstance(alloc)) or
        bun.MaxHeapAllocator.isInstance(alloc) or
        alloc.vtable == bun.allocators.c_allocator.vtable or
        alloc.vtable == bun.allocators.z_allocator.vtable or
        bun.MimallocArena.isInstance(alloc) or
        bun.jsc.CachedBytecode.isInstance(alloc) or
        bun.bundle_v2.allocatorHasPointer(alloc) or
        ((comptime bun.heap_breakdown.enabled) and bun.heap_breakdown.Zone.isInstance(alloc)) or
        bun.String.isWTFAllocator(alloc);
}

/// Asserts that two allocators are equal (in `ci_assert` builds).
///
/// This function may have false negatives; that is, it may fail to detect that two allocators
/// are different. However, in practice, it's a useful safety check.
pub fn assertEq(alloc1: Allocator, alloc2: Allocator) void {
    if (comptime !enabled) return;
    bun.assertf(
        alloc1.vtable == alloc2.vtable,
        "allocators do not match (vtables differ: {*} and {*})",
        .{ alloc1.vtable, alloc2.vtable },
    );
    const ptr1 = if (hasPtr(alloc1)) alloc1.ptr else return;
    const ptr2 = if (hasPtr(alloc2)) alloc2.ptr else return;
    bun.assertf(
        ptr1 == ptr2,
        "allocators do not match (vtables are both {*} but pointers differ: {*} and {*})",
        .{ alloc1.vtable, ptr1, ptr2 },
    );
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
    trace: if (traces_enabled) StoredTrace else void = if (traces_enabled) StoredTrace.empty,

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
            if (comptime traces_enabled) {
                self.trace = StoredTrace.capture(@returnAddress());
            }
        } else {
            self.assertPtrEq(ptr);
        }
    }

    pub fn assertEq(self: Self, alloc: Allocator) void {
        if (comptime !enabled) return;
        self.assertPtrEq(allocToPtr(alloc));
    }

    fn assertPtrEq(self: Self, ptr: *anyopaque) void {
        const old_ptr = self.ptr orelse return;
        if (old_ptr == ptr) return;
        if (comptime traces_enabled) {
            bun.Output.err(
                "allocator mismatch",
                "collection first used here, with a different allocator:",
                .{},
            );
            var trace = self.trace;
            bun.crash_handler.dumpStackTrace(
                trace.trace(),
                .{ .frame_count = 10, .stop_at_jsc_llint = true },
            );
        }
        std.debug.panic(
            "cannot use multiple allocators with the same collection (got {*}, expected {*})",
            .{ ptr, old_ptr },
        );
    }
};

const bun = @import("bun");
const std = @import("std");
const Allocator = std.mem.Allocator;
const LinuxMemFdAllocator = bun.allocators.LinuxMemFdAllocator;
const StoredTrace = bun.crash_handler.StoredTrace;

const enabled = bun.Environment.ci_assert;
const traces_enabled = bun.Environment.isDebug;
