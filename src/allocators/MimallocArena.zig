const Self = @This();

heap: HeapPtr,

const HeapPtr = if (safety_checks) *DebugHeap else *mimalloc.Heap;

const DebugHeap = struct {
    inner: *mimalloc.Heap,
    thread_lock: bun.safety.ThreadLock,
};

fn getMimallocHeap(self: Self) *mimalloc.Heap {
    return if (comptime safety_checks) self.heap.inner else self.heap;
}

fn fromOpaque(ptr: *anyopaque) Self {
    return .{ .heap = bun.cast(HeapPtr, ptr) };
}

fn assertThreadLock(self: Self) void {
    if (comptime safety_checks) self.heap.thread_lock.assertLocked();
}

threadlocal var thread_heap: if (safety_checks) ?DebugHeap else void = if (safety_checks) null;

fn getThreadHeap() HeapPtr {
    if (comptime !safety_checks) return mimalloc.mi_heap_get_default();
    if (thread_heap == null) {
        thread_heap = .{
            .inner = mimalloc.mi_heap_get_default(),
            .thread_lock = .initLocked(),
        };
    }
    return &thread_heap.?;
}

const log = bun.Output.scoped(.mimalloc, .hidden);

/// Internally, mimalloc calls mi_heap_get_default()
/// to get the default heap.
/// It uses pthread_getspecific to do that.
/// We can save those extra calls if we just do it once in here
pub fn getThreadLocalDefault() Allocator {
    return Allocator{ .ptr = getThreadHeap(), .vtable = &c_allocator_vtable };
}

pub fn backingAllocator(_: Self) Allocator {
    return getThreadLocalDefault();
}

pub fn allocator(self: Self) Allocator {
    return Allocator{ .ptr = self.heap, .vtable = &c_allocator_vtable };
}

pub fn dumpThreadStats(_: *Self) void {
    const dump_fn = struct {
        pub fn dump(textZ: [*:0]const u8, _: ?*anyopaque) callconv(.C) void {
            const text = bun.span(textZ);
            bun.Output.errorWriter().writeAll(text) catch {};
        }
    }.dump;
    mimalloc.mi_thread_stats_print_out(dump_fn, null);
    bun.Output.flush();
}

pub fn dumpStats(_: *Self) void {
    const dump_fn = struct {
        pub fn dump(textZ: [*:0]const u8, _: ?*anyopaque) callconv(.C) void {
            const text = bun.span(textZ);
            bun.Output.errorWriter().writeAll(text) catch {};
        }
    }.dump;
    mimalloc.mi_stats_print_out(dump_fn, null);
    bun.Output.flush();
}

pub fn deinit(self: *Self) void {
    const mimalloc_heap = self.getMimallocHeap();
    if (comptime safety_checks) {
        bun.destroy(self.heap);
    }
    mimalloc.mi_heap_destroy(mimalloc_heap);
    self.* = undefined;
}

pub fn init() Self {
    const mimalloc_heap = mimalloc.mi_heap_new() orelse bun.outOfMemory();
    const heap = if (comptime safety_checks)
        bun.new(DebugHeap, .{
            .inner = mimalloc_heap,
            .thread_lock = .initLocked(),
        })
    else
        mimalloc_heap;
    return .{ .heap = heap };
}

pub fn gc(self: Self) void {
    mimalloc.mi_heap_collect(self.getMimallocHeap(), false);
}

pub inline fn helpCatchMemoryIssues(self: Self) void {
    if (comptime bun.FeatureFlags.help_catch_memory_issues) {
        self.gc();
        bun.mimalloc.mi_collect(false);
    }
}

pub fn ownsPtr(self: Self, ptr: *const anyopaque) bool {
    return mimalloc.mi_heap_check_owned(self.getMimallocHeap(), ptr);
}

fn alignedAlloc(self: Self, len: usize, alignment: Alignment) ?[*]u8 {
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

fn alignedAllocSize(ptr: [*]u8) usize {
    return mimalloc.mi_malloc_usable_size(ptr);
}

fn alloc(ptr: *anyopaque, len: usize, alignment: Alignment, _: usize) ?[*]u8 {
    const self = fromOpaque(ptr);
    self.assertThreadLock();
    return alignedAlloc(self, len, alignment);
}

fn resize(ptr: *anyopaque, buf: []u8, _: Alignment, new_len: usize, _: usize) bool {
    const self = fromOpaque(ptr);
    self.assertThreadLock();
    return mimalloc.mi_expand(buf.ptr, new_len) != null;
}

fn free(
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

/// Attempt to expand or shrink memory, allowing relocation.
///
/// `memory.len` must equal the length requested from the most recent
/// successful call to `alloc`, `resize`, or `remap`. `alignment` must
/// equal the same value that was passed as the `alignment` parameter to
/// the original `alloc` call.
///
/// A non-`null` return value indicates the resize was successful. The
/// allocation may have same address, or may have been relocated. In either
/// case, the allocation now has size of `new_len`. A `null` return value
/// indicates that the resize would be equivalent to allocating new memory,
/// copying the bytes from the old memory, and then freeing the old memory.
/// In such case, it is more efficient for the caller to perform the copy.
///
/// `new_len` must be greater than zero.
///
/// `ret_addr` is optionally provided as the first return address of the
/// allocation call stack. If the value is `0` it means no return address
/// has been provided.
fn remap(ptr: *anyopaque, buf: []u8, alignment: Alignment, new_len: usize, _: usize) ?[*]u8 {
    const self = fromOpaque(ptr);
    self.assertThreadLock();
    const heap = self.getMimallocHeap();
    const aligned_size = alignment.toByteUnits();
    const value = mimalloc.mi_heap_realloc_aligned(heap, buf.ptr, new_len, aligned_size);
    return @ptrCast(value);
}

pub fn isInstance(allocator_: Allocator) bool {
    return allocator_.vtable == &c_allocator_vtable;
}

const c_allocator_vtable = Allocator.VTable{
    .alloc = &Self.alloc,
    .resize = &Self.resize,
    .remap = &Self.remap,
    .free = &Self.free,
};

const std = @import("std");

const bun = @import("bun");
const assert = bun.assert;
const mimalloc = bun.mimalloc;
const safety_checks = bun.Environment.ci_assert;

const Alignment = std.mem.Alignment;
const Allocator = std.mem.Allocator;
