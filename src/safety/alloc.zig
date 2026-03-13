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
        bun.allocators.allocation_scope.isInstance(alloc) or
        ((comptime bun.Environment.isLinux) and LinuxMemFdAllocator.isInstance(alloc)) or
        bun.MaxHeapAllocator.isInstance(alloc) or
        alloc.vtable == bun.allocators.c_allocator.vtable or
        alloc.vtable == bun.allocators.z_allocator.vtable or
        MimallocArena.isInstance(alloc) or
        bun.jsc.CachedBytecode.isInstance(alloc) or
        bun.bundle_v2.allocatorHasPointer(alloc) or
        ((comptime bun.heap_breakdown.enabled) and bun.heap_breakdown.Zone.isInstance(alloc)) or
        bun.String.isWTFAllocator(alloc);
}

/// Returns true if the allocators are definitely different.
fn guaranteedMismatch(alloc1: Allocator, alloc2: Allocator) bool {
    if (alloc1.vtable != alloc2.vtable) return true;
    const ptr1 = if (hasPtr(alloc1)) alloc1.ptr else return false;
    const ptr2 = if (hasPtr(alloc2)) alloc2.ptr else return false;
    return ptr1 != ptr2;
}

/// Asserts that two allocators are equal (in `ci_assert` builds).
///
/// This function may have false negatives; that is, it may fail to detect that two allocators
/// are different. However, in practice, it's a useful safety check.
pub fn assertEq(alloc1: Allocator, alloc2: Allocator) void {
    assertEqFmt(alloc1, alloc2, "allocators do not match", .{});
}

/// Asserts that two allocators are equal, with a formatted message.
pub fn assertEqFmt(
    alloc1: Allocator,
    alloc2: Allocator,
    comptime format: []const u8,
    args: anytype,
) void {
    if (comptime !enabled) return;
    blk: {
        if (alloc1.vtable != alloc2.vtable) {
            bun.Output.err(
                "allocator mismatch",
                "vtables differ: {*} and {*}",
                .{ alloc1.vtable, alloc2.vtable },
            );
            break :blk;
        }
        const ptr1 = if (hasPtr(alloc1)) alloc1.ptr else return;
        const ptr2 = if (hasPtr(alloc2)) alloc2.ptr else return;
        if (ptr1 == ptr2) return;
        bun.Output.err(
            "allocator mismatch",
            "vtables are both {*} but pointers differ: {*} and {*}",
            .{ alloc1.vtable, ptr1, ptr2 },
        );
    }
    bun.assertf(false, format, args);
}

/// Use this in unmanaged containers to ensure multiple allocators aren't being used with the same
/// container. Each method of the container that accepts an allocator parameter should call either
/// `CheckedAllocator.set` (for non-const methods) or `CheckedAllocator.assertEq` (for const
/// methods). (Exception: methods like `clone` which explicitly accept any allocator should not call
/// any methods on this type.)
pub const CheckedAllocator = struct {
    const Self = @This();

    #allocator: if (enabled) NullableAllocator else void = if (enabled) .init(null),
    #trace: if (traces_enabled) StoredTrace else void = if (traces_enabled) StoredTrace.empty,

    pub inline fn init(alloc: Allocator) Self {
        var self: Self = .{};
        self.set(alloc);
        return self;
    }

    pub fn set(self: *Self, alloc: Allocator) void {
        if (comptime !enabled) return;
        if (self.#allocator.isNull()) {
            self.#allocator = .init(alloc);
            if (comptime traces_enabled) {
                self.#trace = StoredTrace.capture(@returnAddress());
            }
        } else {
            self.assertEq(alloc);
        }
    }

    pub fn assertEq(self: Self, alloc: Allocator) void {
        if (comptime !enabled) return;
        const old_alloc = self.#allocator.get() orelse return;
        if (!guaranteedMismatch(old_alloc, alloc)) return;

        bun.Output.err(
            "allocator mismatch",
            "cannot use multiple allocators with the same collection",
            .{},
        );
        if (comptime traces_enabled) {
            bun.Output.err(
                "allocator mismatch",
                "collection first used here, with a different allocator:",
                .{},
            );
            var trace = self.#trace;
            bun.crash_handler.dumpStackTrace(
                trace.trace(),
                .{ .frame_count = 10, .stop_at_jsc_llint = true },
            );
        }
        // Assertion will always fail. We want the error message.
        bun.safety.alloc.assertEq(old_alloc, alloc);
    }

    /// Transfers ownership of the collection to a new allocator.
    ///
    /// This method is valid only if both the old allocator and new allocator are `MimallocArena`s.
    /// This is okay because data allocated by one `MimallocArena` can always be freed by another
    /// (this includes `resize` and `remap`).
    ///
    /// `new_allocator` should be one of the following:
    ///
    /// * `*MimallocArena`
    /// * `*const MimallocArena`
    /// * `MimallocArena.Borrowed`
    ///
    /// If you only have an `std.mem.Allocator`, see `MimallocArena.Borrowed.downcast`.
    pub inline fn transferOwnership(self: *Self, new_allocator: anytype) void {
        if (comptime !enabled) return;
        const ArgType = @TypeOf(new_allocator);
        const new_std = switch (comptime ArgType) {
            *MimallocArena,
            *const MimallocArena,
            MimallocArena.Borrowed,
            => new_allocator.allocator(),
            else => @compileError("unsupported argument: " ++ @typeName(ArgType)),
        };

        defer self.* = .init(new_std);
        const old_allocator = self.#allocator.get() orelse return;
        if (MimallocArena.isInstance(old_allocator)) return;

        if (comptime traces_enabled) {
            bun.Output.errGeneric("collection first used here:", .{});
            var trace = self.#trace;
            bun.crash_handler.dumpStackTrace(
                trace.trace(),
                .{ .frame_count = 10, .stop_at_jsc_llint = true },
            );
        }
        std.debug.panic(
            "cannot transfer ownership from non-MimallocArena (old vtable is {*})",
            .{old_allocator.vtable},
        );
    }
};

pub const enabled = bun.Environment.ci_assert;

const bun = @import("bun");
const std = @import("std");
const Allocator = std.mem.Allocator;
const StoredTrace = bun.crash_handler.StoredTrace;
const traces_enabled = bun.Environment.isDebug;

const LinuxMemFdAllocator = bun.allocators.LinuxMemFdAllocator;
const MimallocArena = bun.allocators.MimallocArena;
const NullableAllocator = bun.allocators.NullableAllocator;
