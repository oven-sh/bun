//! This type is a `GenericAllocator`; see `src/allocators.zig`.

const Self = @This();

#heap: if (safety_checks) Owned(*DebugHeap) else *mimalloc.Heap,

/// Uses the default thread-local heap. This type is zero-sized.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
pub const Default = struct {
    pub fn allocator(self: Default) std.mem.Allocator {
        _ = self;
        return Borrowed.getDefault().allocator();
    }
};

/// Borrowed version of `ThreadlocalHeapArena`, returned by `ThreadlocalHeapArena.borrow`.
/// Using this type makes it clear who actually owns the `ThreadlocalHeapArena`, and prevents
/// `deinit` from being called twice.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
pub const Borrowed = struct {
    #heap: BorrowedHeap,

    pub fn allocator(self: Borrowed) std.mem.Allocator {
        return .{ .ptr = self.#heap, .vtable = &c_allocator_vtable };
    }

    pub fn getDefault() Borrowed {
        return .{ .#heap = getThreadHeap() };
    }

    pub fn gc(self: Borrowed) void {
        mimalloc.mi_theap_collect(self.getTHeap(), false);
    }

    pub fn helpCatchMemoryIssues(self: Borrowed) void {
        if (comptime bun.FeatureFlags.help_catch_memory_issues) {
            self.gc();
            bun.mimalloc.mi_collect(false);
        }
    }

    fn fromOpaque(ptr: *anyopaque) Borrowed {
        return .{ .#heap = @ptrCast(@alignCast(ptr)) };
    }

    fn getTHeap(self: Borrowed) *mimalloc.THeap {
        return if (comptime safety_checks) self.#heap.inner else self.#heap;
    }

    fn assertThreadLock(self: Borrowed) void {
        if (comptime safety_checks) self.#heap.thread_lock.assertLocked();
    }

    fn alignedAlloc(self: Borrowed, len: usize, alignment: Alignment) ?[*]u8 {
        log("Malloc: {d}\n", .{len});

        const theap = self.getTHeap();
        const ptr: ?*anyopaque = if (mimalloc.mustUseAlignedAlloc(alignment))
            mimalloc.mi_theap_malloc_aligned(theap, len, alignment.toByteUnits())
        else
            mimalloc.mi_theap_malloc(theap, len);

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
            "not a ThreadlocalHeapArena (vtable is {*})",
            .{std_alloc.vtable},
        );
        return .fromOpaque(std_alloc.ptr);
    }
};

const BorrowedHeap = if (safety_checks) *DebugHeap else *mimalloc.THeap;

const DebugHeap = struct {
    inner: *mimalloc.THeap,
    heap: *mimalloc.Heap,
    thread_lock: bun.safety.ThreadLock,

    pub const deinit = void;
};

threadlocal var thread_heap: if (safety_checks) ?DebugHeap else void = if (safety_checks) null;

fn getThreadHeap() BorrowedHeap {
    if (comptime !safety_checks) return mimalloc.mi_theap_get_default();
    if (thread_heap == null) {
        thread_heap = .{
            .inner = mimalloc.mi_theap_get_default(),
            .heap = mimalloc.mi_heap_main(),
            .thread_lock = .initLocked(),
        };
    }
    return &thread_heap.?;
}

const log = bun.Output.scoped(.mimalloc, .hidden);

pub fn allocator(self: Self) std.mem.Allocator {
    return self.borrow().allocator();
}

pub fn borrow(self: Self) Borrowed {
    return .{ .#heap = if (comptime safety_checks) self.#heap.get() else mimalloc.mi_heap_theap(self.#heap) };
}

pub fn getThreadLocalDefault() std.mem.Allocator {
    if (bun.Environment.enable_asan) return bun.default_allocator;
    return Borrowed.getDefault().allocator();
}

pub fn backingAllocator(_: Self) std.mem.Allocator {
    return getThreadLocalDefault();
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
    const mimalloc_heap = if (comptime safety_checks) self.#heap.get().heap else self.#heap;
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
        .inner = mimalloc.mi_heap_theap(mimalloc_heap),
        .heap = mimalloc_heap,
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
    const heap: *const mimalloc.Heap = if (comptime safety_checks) self.#heap.get().heap else self.#heap;
    return mimalloc.mi_heap_contains(heap, ptr);
}

fn alignedAllocSize(ptr: [*]u8) usize {
    return mimalloc.mi_malloc_usable_size(ptr);
}

fn vtable_alloc(ptr: *anyopaque, len: usize, alignment: Alignment, _: usize) ?[*]u8 {
    const self: Borrowed = .fromOpaque(ptr);
    self.assertThreadLock();
    return self.alignedAlloc(len, alignment);
}

fn vtable_resize(ptr: *anyopaque, buf: []u8, _: Alignment, new_len: usize, _: usize) bool {
    const self: Borrowed = .fromOpaque(ptr);
    self.assertThreadLock();
    return mimalloc.mi_expand(buf.ptr, new_len) != null;
}

fn vtable_free(
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

fn vtable_remap(ptr: *anyopaque, buf: []u8, alignment: Alignment, new_len: usize, _: usize) ?[*]u8 {
    const self: Borrowed = .fromOpaque(ptr);
    self.assertThreadLock();
    const theap = self.getTHeap();
    const aligned_size = alignment.toByteUnits();
    // Allocate new aligned block, copy, and free old
    const new_ptr: ?*anyopaque = mimalloc.mi_theap_malloc_aligned(theap, new_len, aligned_size);
    const dest = new_ptr orelse return null;
    const copy_len = @min(buf.len, new_len);
    @memcpy(@as([*]u8, @ptrCast(dest))[0..copy_len], buf[0..copy_len]);
    mimalloc.mi_free(buf.ptr);
    return @ptrCast(dest);
}

pub fn isInstance(alloc: std.mem.Allocator) bool {
    return alloc.vtable == &c_allocator_vtable;
}

const c_allocator_vtable = std.mem.Allocator.VTable{
    .alloc = vtable_alloc,
    .resize = vtable_resize,
    .remap = vtable_remap,
    .free = vtable_free,
};

const std = @import("std");
const Alignment = std.mem.Alignment;

const bun = @import("bun");
const assert = bun.assert;
const mimalloc = bun.mimalloc;
const Owned = bun.ptr.Owned;
const safety_checks = bun.Environment.ci_assert;
