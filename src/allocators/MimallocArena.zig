//! This type is a `GenericAllocator`; see `src/allocators.zig`.

const Self = @This();

#heap: if (safety_checks) Owned(*DebugHeap) else *mimalloc.Heap,

/// Uses the default thread-local heap. This type is zero-sized.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
pub const Default = struct {
    pub fn allocator(_: Default) std.mem.Allocator {
        // Use global mimalloc functions which are thread-safe
        return .{ .ptr = undefined, .vtable = &global_mimalloc_vtable };
    }
};

/// Borrowed version of `MimallocArena`, returned by `MimallocArena.borrow`.
/// Using this type makes it clear who actually owns the `MimallocArena`, and prevents
/// `deinit` from being called twice.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
pub const Borrowed = struct {
    #heap: BorrowedHeap,

    pub fn allocator(self: Borrowed) std.mem.Allocator {
        return .{ .ptr = self.#heap, .vtable = &heap_allocator_vtable };
    }

    pub fn getDefault() Borrowed {
        // This is a legacy function - prefer using Default.allocator() or getThreadLocalDefault()
        // For backwards compatibility, return a borrowed with undefined heap
        // but callers should use the global allocator instead
        return .{ .#heap = undefined };
    }

    pub fn gc(self: Borrowed) void {
        mimalloc.mi_heap_collect(self.getMimallocHeap(), false);
    }

    pub fn helpCatchMemoryIssues(self: Borrowed) void {
        if (comptime bun.FeatureFlags.help_catch_memory_issues) {
            self.gc();
            bun.mimalloc.mi_collect(false);
        }
    }

    pub fn ownsPtr(_: Borrowed, ptr: *const anyopaque) bool {
        // In mimalloc v3, mi_heap_check_owned was removed.
        // Use mi_check_owned which checks if ptr is in any mimalloc heap.
        return mimalloc.mi_check_owned(ptr);
    }

    fn fromOpaque(ptr: *anyopaque) Borrowed {
        return .{ .#heap = @ptrCast(@alignCast(ptr)) };
    }

    pub fn getMimallocHeap(self: Borrowed) *mimalloc.Heap {
        return if (comptime safety_checks) self.#heap.inner else self.#heap;
    }

    fn assertThreadLock(self: Borrowed) void {
        if (comptime safety_checks) self.#heap.thread_lock.assertLocked();
    }

    fn alignedAlloc(self: Borrowed, len: usize, alignment: Alignment) ?[*]u8 {
        log("Malloc: {d}\n", .{len});

        const heap = self.getMimallocHeap();
        const ptr: ?*anyopaque = if (mimalloc.mustUseAlignedAlloc(alignment))
            mimalloc.mi_heap_malloc_aligned(heap, len, alignment.toByteUnits())
        else
            mimalloc.mi_heap_malloc(heap, len);

        if (comptime bun.Environment.isDebug) {
            const usable = mimalloc.mi_malloc_usable_size(ptr);
            if (usable < len) {
                std.debug.panic("mimalloc: allocated size is too small: {d} < {d}", .{ usable, len });
            }
        }

        return if (ptr) |p|
            @as([*]u8, @ptrCast(p))
        else
            null;
    }

    pub fn downcast(std_alloc: std.mem.Allocator) Borrowed {
        bun.assertf(
            isInstance(std_alloc),
            "not a MimallocArena (vtable is {*})",
            .{std_alloc.vtable},
        );
        return .fromOpaque(std_alloc.ptr);
    }
};

const BorrowedHeap = if (safety_checks) *DebugHeap else *mimalloc.Heap;

const DebugHeap = struct {
    inner: *mimalloc.Heap,
    thread_lock: bun.safety.ThreadLock,

    pub const deinit = void;
};

const log = bun.Output.scoped(.mimalloc, .hidden);

pub fn allocator(self: Self) std.mem.Allocator {
    return self.borrow().allocator();
}

pub fn borrow(self: Self) Borrowed {
    return .{ .#heap = if (comptime safety_checks) self.#heap.get() else self.#heap };
}

/// Returns the default thread-local mimalloc allocator.
/// Uses global mimalloc functions which are thread-safe.
pub fn getThreadLocalDefault() std.mem.Allocator {
    if (bun.Environment.enable_asan) return bun.default_allocator;
    return .{ .ptr = undefined, .vtable = &global_mimalloc_vtable };
}

pub fn backingAllocator(_: Self) std.mem.Allocator {
    return bun.default_allocator;
}

pub fn dumpThreadStats(_: Self) void {
    const dump_fn = struct {
        pub fn dump(textZ: [*:0]const u8, _: ?*anyopaque) callconv(.c) void {
            const text = bun.span(textZ);
            bun.Output.errorWriter().writeAll(text) catch {};
        }
    }.dump;
    mimalloc.mi_thread_stats_print_out(dump_fn, null);
    bun.Output.flush();
}

pub fn dumpStats(_: Self) void {
    const dump_fn = struct {
        pub fn dump(textZ: [*:0]const u8, _: ?*anyopaque) callconv(.c) void {
            const text = bun.span(textZ);
            bun.Output.errorWriter().writeAll(text) catch {};
        }
    }.dump;
    mimalloc.mi_stats_print_out(dump_fn, null);
    bun.Output.flush();
}

pub fn deinit(self: *Self) void {
    const mimalloc_heap = self.borrow().getMimallocHeap();
    if (comptime safety_checks) {
        self.#heap.deinit();
    }
    mimalloc.mi_heap_destroy(mimalloc_heap);
    self.* = undefined;
}

pub fn init() Self {
    const mimalloc_heap = mimalloc.mi_heap_new() orelse bun.outOfMemory();
    if (comptime !safety_checks) return .{ .#heap = mimalloc_heap };
    const heap: Owned(*DebugHeap) = .new(.{
        .inner = mimalloc_heap,
        .thread_lock = .initLocked(),
    });
    return .{ .#heap = heap };
}

pub fn gc(self: Self) void {
    self.borrow().gc();
}

pub fn helpCatchMemoryIssues(self: Self) void {
    self.borrow().helpCatchMemoryIssues();
}

pub fn ownsPtr(self: Self, ptr: *const anyopaque) bool {
    return self.borrow().ownsPtr(ptr);
}

fn alignedAllocSize(ptr: [*]u8) usize {
    return mimalloc.mi_malloc_usable_size(ptr);
}

// ============================================================================
// VTable functions for owned heaps (created with mi_heap_new)
// ============================================================================

fn heap_vtable_alloc(ptr: *anyopaque, len: usize, alignment: Alignment, _: usize) ?[*]u8 {
    const self: Borrowed = .fromOpaque(ptr);
    self.assertThreadLock();
    return self.alignedAlloc(len, alignment);
}

fn heap_vtable_resize(ptr: *anyopaque, buf: []u8, _: Alignment, new_len: usize, _: usize) bool {
    const self: Borrowed = .fromOpaque(ptr);
    self.assertThreadLock();
    return mimalloc.mi_expand(buf.ptr, new_len) != null;
}

fn heap_vtable_free(
    _: *anyopaque,
    buf: []u8,
    alignment: Alignment,
    _: usize,
) void {
    // mi_free_size internally just asserts the size
    // so it's faster if we don't pass that value through
    // but its good to have that assertion
    if (comptime bun.Environment.isDebug) {
        assert(mimalloc.mi_is_in_heap_region(buf.ptr));
        if (mimalloc.mustUseAlignedAlloc(alignment))
            mimalloc.mi_free_size_aligned(buf.ptr, buf.len, alignment.toByteUnits())
        else
            mimalloc.mi_free_size(buf.ptr, buf.len);
    } else {
        mimalloc.mi_free(buf.ptr);
    }
}

fn heap_vtable_remap(ptr: *anyopaque, buf: []u8, alignment: Alignment, new_len: usize, _: usize) ?[*]u8 {
    const self: Borrowed = .fromOpaque(ptr);
    self.assertThreadLock();
    const heap = self.getMimallocHeap();
    const aligned_size = alignment.toByteUnits();
    const value = mimalloc.mi_heap_realloc_aligned(heap, buf.ptr, new_len, aligned_size);
    return @ptrCast(value);
}

// ============================================================================
// VTable functions for global/default allocator (uses thread-local theap)
// ============================================================================

fn global_vtable_alloc(_: *anyopaque, len: usize, alignment: Alignment, _: usize) ?[*]u8 {
    log("Global Malloc: {d}\n", .{len});

    const ptr: ?*anyopaque = if (mimalloc.mustUseAlignedAlloc(alignment))
        mimalloc.mi_malloc_aligned(len, alignment.toByteUnits())
    else
        mimalloc.mi_malloc(len);

    if (comptime bun.Environment.isDebug) {
        const usable = mimalloc.mi_malloc_usable_size(ptr);
        if (usable < len) {
            std.debug.panic("mimalloc: allocated size is too small: {d} < {d}", .{ usable, len });
        }
    }

    return if (ptr) |p|
        @as([*]u8, @ptrCast(p))
    else
        null;
}

fn global_vtable_resize(_: *anyopaque, buf: []u8, _: Alignment, new_len: usize, _: usize) bool {
    return mimalloc.mi_expand(buf.ptr, new_len) != null;
}

fn global_vtable_free(
    _: *anyopaque,
    buf: []u8,
    alignment: Alignment,
    _: usize,
) void {
    if (comptime bun.Environment.isDebug) {
        assert(mimalloc.mi_is_in_heap_region(buf.ptr));
        if (mimalloc.mustUseAlignedAlloc(alignment))
            mimalloc.mi_free_size_aligned(buf.ptr, buf.len, alignment.toByteUnits())
        else
            mimalloc.mi_free_size(buf.ptr, buf.len);
    } else {
        mimalloc.mi_free(buf.ptr);
    }
}

fn global_vtable_remap(_: *anyopaque, buf: []u8, alignment: Alignment, new_len: usize, _: usize) ?[*]u8 {
    const aligned_size = alignment.toByteUnits();
    const value = mimalloc.mi_realloc_aligned(buf.ptr, new_len, aligned_size);
    return @ptrCast(value);
}

// ============================================================================
// VTables
// ============================================================================

pub fn isInstance(alloc: std.mem.Allocator) bool {
    return alloc.vtable == &heap_allocator_vtable or alloc.vtable == &global_mimalloc_vtable;
}

/// VTable for owned MimallocArena heaps (created with mi_heap_new).
/// Uses heap-specific mi_heap_* functions.
const heap_allocator_vtable = std.mem.Allocator.VTable{
    .alloc = heap_vtable_alloc,
    .resize = heap_vtable_resize,
    .remap = heap_vtable_remap,
    .free = heap_vtable_free,
};

/// VTable for global/default mimalloc allocator.
/// Uses global mi_malloc/mi_free functions which are thread-safe.
const global_mimalloc_vtable = std.mem.Allocator.VTable{
    .alloc = global_vtable_alloc,
    .resize = global_vtable_resize,
    .remap = global_vtable_remap,
    .free = global_vtable_free,
};

const std = @import("std");
const Alignment = std.mem.Alignment;

const bun = @import("bun");
const assert = bun.assert;
const mimalloc = bun.mimalloc;
const Owned = bun.ptr.Owned;
const safety_checks = bun.Environment.ci_assert;
