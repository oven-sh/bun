const mem = @import("std").mem;
const builtin = @import("std").builtin;
const std = @import("std");

pub const bmalloc = struct {
    pub fn memalign(alignment: usize, size: usize) ?*anyopaque {
        return bun__bmalloc__memalign(alignment, size);
    }
    pub fn free(ptr: *anyopaque) void {
        return bun__bmalloc__free(ptr);
    }
    pub fn realloc(ptr: *anyopaque, size: usize) ?*anyopaque {
        return bun__bmalloc__realloc(ptr, size);
    }
    pub fn allocatedSize(ptr: *anyopaque) usize {
        return bun__bmalloc__size(ptr);
    }

    extern fn bun__bmalloc__memalign(alignment: usize, size: usize) ?*anyopaque;
    extern fn bun__bmalloc__free(*anyopaque) void;
    extern fn bun__bmalloc__realloc(*anyopaque, usize) ?*anyopaque;
    extern fn bun__bmalloc__size(*anyopaque) usize;

    pub extern fn bmalloc_try_allocate_zeroed(size: usize) ?*anyopaque;
    pub extern fn bmalloc_deallocate(*anyopaque) void;
    pub extern fn bmalloc_get_allocation_size(?*const anyopaque) usize;
};
pub const free = bmalloc.free;

const Allocator = mem.Allocator;
const assert = std.debug.assert;
const CAllocator = struct {
    pub const supports_posix_memalign = true;

    fn alloc(_: *anyopaque, len: usize, log2_align: u8, _: usize) ?[*]u8 {
        const alignment = @as(usize, 1) << @as(Allocator.Log2Align, @intCast(log2_align));
        // The posix_memalign only accepts alignment values that are a
        // multiple of the pointer size
        const eff_alignment = @max(alignment, @sizeOf(usize));
        return @ptrCast(bmalloc.memalign(eff_alignment, len));
    }

    fn resize(_: *anyopaque, buf: []u8, _: u8, new_len: usize, _: usize) bool {
        return bmalloc.realloc(buf.ptr, new_len) != null;
    }

    fn free(
        _: *anyopaque,
        buf: []u8,
        _: u8,
        _: usize,
    ) void {
        bmalloc.free(buf.ptr);
    }

    pub const VTable = Allocator.VTable{
        .alloc = &alloc,
        .resize = &resize,
        .free = &CAllocator.free,
    };
};

pub const c_allocator = Allocator{
    .ptr = undefined,
    .vtable = &CAllocator.VTable,
};
