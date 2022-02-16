const mem = @import("std").mem;
const builtin = @import("std").builtin;
const std = @import("std");

const mimalloc = @import("./allocators/mimalloc.zig");
const Environment = @import("./env.zig");
const Allocator = mem.Allocator;
const assert = std.debug.assert;

pub const Arena = struct {
    heap: *mimalloc.mi_heap_t = undefined,

    pub fn backingAllocator(this: Arena) Allocator {
        var arena = Arena{ .heap = this.heap.backing() };
        return arena.allocator();
    }

    pub fn allocator(this: Arena) Allocator {
        return Allocator{ .ptr = this.heap, .vtable = &c_allocator_vtable };
    }

    pub fn deinit(this: *Arena) void {
        mimalloc.mi_heap_destroy(this.heap);
    }

    pub fn reset(this: *Arena) void {
        this.deinit();
        this.* = initAssumeCapacity();
    }

    pub fn init() !Arena {
        return Arena{ .heap = mimalloc.mi_heap_new() orelse return error.OutOfMemory };
    }

    pub fn initAssumeCapacity() Arena {
        return Arena{ .heap = mimalloc.mi_heap_new().? };
    }

    pub fn gc(this: Arena, force: bool) void {
        mimalloc.mi_heap_collect(this.heap, force);
    }

    const MI_MAX_ALIGN_SIZE = 16;
    inline fn mi_malloc_satisfies_alignment(alignment: usize, size: usize) bool {
        return (alignment == @sizeOf(*anyopaque) or (alignment == MI_MAX_ALIGN_SIZE and size > (MI_MAX_ALIGN_SIZE / 2)));
    }

    fn alignedAlloc(heap: *mimalloc.mi_heap_t, len: usize, alignment: usize) ?[*]u8 {
        // this is the logic that posix_memalign does
        var ptr = if (mi_malloc_satisfies_alignment(alignment, len))
            mimalloc.mi_heap_malloc(heap, len)
        else
            mimalloc.mi_heap_malloc_aligned(heap, len, alignment);

        return @ptrCast([*]u8, ptr orelse null);
    }

    fn alignedFree(ptr: [*]u8) void {
        return mimalloc.mi_free(ptr);
    }

    fn alloc(
        arena: *anyopaque,
        len: usize,
        alignment: u29,
        len_align: u29,
        return_address: usize,
    ) error{OutOfMemory}![]u8 {
        _ = return_address;
        assert(len > 0);
        assert(std.math.isPowerOfTwo(alignment));

        var ptr = alignedAlloc(@ptrCast(*mimalloc.mi_heap_t, arena), len, alignment) orelse return error.OutOfMemory;
        if (len_align == 0) {
            return ptr[0..len];
        }

        // std.mem.Allocator asserts this, we do it here so we can see the metadata
        if (comptime Environment.allow_assert) {
            const size = mem.alignBackwardAnyAlign(mimalloc.mi_usable_size(ptr), len_align);

            assert(size >= len);
            return ptr[0..size];
        } else {
            return ptr[0..mem.alignBackwardAnyAlign(mimalloc.mi_usable_size(ptr), len_align)];
        }
    }

    fn resize(
        _: *anyopaque,
        buf: []u8,
        buf_align: u29,
        new_len: usize,
        len_align: u29,
        return_address: usize,
    ) ?usize {
        _ = buf_align;
        _ = return_address;

        if (new_len <= buf.len) {
            return mem.alignAllocLen(buf.len, new_len, len_align);
        }

        const full_len = mimalloc.mi_usable_size(buf.ptr);
        if (new_len <= full_len) {
            return mem.alignAllocLen(full_len, new_len, len_align);
        }

        return null;
    }

    fn free(
        _: *anyopaque,
        buf: []u8,
        buf_align: u29,
        return_address: usize,
    ) void {
        _ = buf_align;
        _ = return_address;
        mimalloc.mi_free(buf.ptr);
    }
};

const c_allocator_vtable = Allocator.VTable{
    .alloc = Arena.alloc,
    .resize = Arena.resize,
    .free = Arena.free,
};
