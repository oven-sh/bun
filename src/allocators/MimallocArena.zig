const Self = @This();

heap: *mimalloc.Heap,

const log = bun.Output.scoped(.mimalloc, true);

/// Internally, mimalloc calls mi_heap_get_default()
/// to get the default heap.
/// It uses pthread_getspecific to do that.
/// We can save those extra calls if we just do it once in here
pub fn getThreadLocalDefault() Allocator {
    return Allocator{ .ptr = mimalloc.mi_heap_get_default(), .vtable = &c_allocator_vtable };
}

pub fn backingAllocator(self: Self) Allocator {
    var arena = Self{ .heap = self.heap.backing() };
    return arena.allocator();
}

pub fn allocator(self: Self) Allocator {
    return Allocator{ .ptr = self.heap, .vtable = &c_allocator_vtable };
}

pub fn dumpThreadStats(self: *Self) void {
    _ = self;
    const dump_fn = struct {
        pub fn dump(textZ: [*:0]const u8, _: ?*anyopaque) callconv(.C) void {
            const text = bun.span(textZ);
            bun.Output.errorWriter().writeAll(text) catch {};
        }
    }.dump;
    mimalloc.mi_thread_stats_print_out(dump_fn, null);
    bun.Output.flush();
}

pub fn dumpStats(self: *Self) void {
    _ = self;
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
    mimalloc.mi_heap_destroy(self.heap);
    self.* = undefined;
}

pub fn init() Self {
    return .{ .heap = mimalloc.mi_heap_new() orelse bun.outOfMemory() };
}

pub fn gc(self: Self) void {
    mimalloc.mi_heap_collect(self.heap, false);
}

pub inline fn helpCatchMemoryIssues(self: Self) void {
    if (comptime FeatureFlags.help_catch_memory_issues) {
        self.gc();
        bun.mimalloc.mi_collect(false);
    }
}

pub fn ownsPtr(self: Self, ptr: *const anyopaque) bool {
    return mimalloc.mi_heap_check_owned(self.heap, ptr);
}
pub const supports_posix_memalign = true;

fn alignedAlloc(heap: *mimalloc.Heap, len: usize, alignment: mem.Alignment) ?[*]u8 {
    log("Malloc: {d}\n", .{len});

    const ptr: ?*anyopaque = if (mimalloc.mustUseAlignedAlloc(alignment))
        mimalloc.mi_heap_malloc_aligned(heap, len, alignment.toByteUnits())
    else
        mimalloc.mi_heap_malloc(heap, len);

    if (comptime Environment.isDebug) {
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

fn alloc(arena: *anyopaque, len: usize, alignment: mem.Alignment, _: usize) ?[*]u8 {
    const self = bun.cast(*mimalloc.Heap, arena);

    return alignedAlloc(
        self,
        len,
        alignment,
    );
}

fn resize(_: *anyopaque, buf: []u8, _: mem.Alignment, new_len: usize, _: usize) bool {
    return mimalloc.mi_expand(buf.ptr, new_len) != null;
}

fn free(
    _: *anyopaque,
    buf: []u8,
    alignment: mem.Alignment,
    _: usize,
) void {
    // mi_free_size internally just asserts the size
    // so it's faster if we don't pass that value through
    // but its good to have that assertion
    if (comptime Environment.isDebug) {
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
fn remap(self: *anyopaque, buf: []u8, alignment: mem.Alignment, new_len: usize, _: usize) ?[*]u8 {
    const aligned_size = alignment.toByteUnits();
    const value = mimalloc.mi_heap_realloc_aligned(@ptrCast(self), buf.ptr, new_len, aligned_size);
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

const Environment = @import("../env.zig");
const FeatureFlags = @import("../feature_flags.zig");
const std = @import("std");

const bun = @import("bun");
const assert = bun.assert;
const mimalloc = bun.mimalloc;

const mem = std.mem;
const Allocator = mem.Allocator;
