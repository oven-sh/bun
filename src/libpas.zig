const std = @import("std");
const builtin = @import("builtin");
const assert = std.debug.assert;
const Allocator = std.mem.Allocator;

// External C functions from bun-libpas.cpp
pub extern fn bun_libpas_malloc(size: usize) ?*anyopaque;
pub extern fn bun_libpas_try_malloc(size: usize) ?*anyopaque;
pub extern fn bun_libpas_calloc(count: usize, size: usize) ?*anyopaque;
pub extern fn bun_libpas_try_calloc(count: usize, size: usize) ?*anyopaque;
pub extern fn bun_libpas_realloc(ptr: ?*anyopaque, size: usize) ?*anyopaque;
pub extern fn bun_libpas_try_realloc(ptr: ?*anyopaque, size: usize) ?*anyopaque;
pub extern fn bun_libpas_free(ptr: ?*anyopaque) void;
pub extern fn bun_libpas_memalign(alignment: usize, size: usize) ?*anyopaque;
pub extern fn bun_libpas_try_memalign(alignment: usize, size: usize) ?*anyopaque;
pub extern fn bun_libpas_malloc_size(ptr: *const anyopaque) usize;
pub extern fn bun_libpas_malloc_good_size(size: usize) usize;
pub extern fn bun_libpas_scavenge() void;
pub extern fn bun_libpas_scavenge_this_thread() void;
pub extern fn bun_libpas_try_allocate_zeroed_virtual_pages(size: usize) ?*anyopaque;
pub extern fn bun_libpas_free_virtual_pages(ptr: ?*anyopaque, size: usize) void;

pub const LibPasAllocator = struct {
    pub const supports_malloc_size = true;

    // Fast path for small allocations that don't need special alignment
    inline fn fastAlloc(len: usize) ?[*]u8 {
        return @as([*]u8, @ptrCast(bun_libpas_try_malloc(len)));
    }

    inline fn alignedAlloc(len: usize, log2_align: u8) ?[*]u8 {
        // Fast path: if alignment is small enough, use regular malloc
        // since libpas guarantees certain minimum alignments
        if (log2_align <= 3) { // 8-byte alignment or less
            return fastAlloc(len);
        }

        const alignment = @as(usize, 1) << @as(Allocator.Log2Align, @intCast(log2_align));
        return @as([*]u8, @ptrCast(bun_libpas_try_memalign(alignment, len)));
    }

    inline fn alignedFree(ptr: [*]u8) void {
        bun_libpas_free(ptr);
    }

    inline fn alignedAllocSize(ptr: [*]u8) usize {
        return bun_libpas_malloc_size(ptr);
    }

    fn alloc(
        _: *anyopaque,
        len: usize,
        log2_align: u8,
        return_address: usize,
    ) ?[*]u8 {
        _ = return_address;
        assert(len > 0);
        return alignedAlloc(len, log2_align);
    }

    fn resize(
        _: *anyopaque,
        buf: []u8,
        log2_buf_align: u8,
        new_len: usize,
        return_address: usize,
    ) bool {
        _ = return_address;

        // Fast path: shrinking
        if (new_len <= buf.len) {
            return true;
        }

        // Check if we have enough space in the existing allocation
        const full_len = alignedAllocSize(buf.ptr);
        if (new_len <= full_len) {
            return true;
        }

        // Try to realloc if alignment requirements allow it
        if (log2_buf_align <= 3) {
            if (bun_libpas_try_realloc(buf.ptr, new_len)) |_| {
                return true;
            }
        }

        return false;
    }

    fn free(
        _: *anyopaque,
        buf: []u8,
        log2_buf_align: u8,
        return_address: usize,
    ) void {
        _ = log2_buf_align;
        _ = return_address;
        alignedFree(buf.ptr);
    }

    // Additional utility functions for direct usage
    pub fn goodSize(size: usize) usize {
        return bun_libpas_malloc_good_size(size);
    }

    pub fn allocSize(ptr: *const anyopaque) usize {
        return bun_libpas_malloc_size(ptr);
    }
};

/// Supports the full Allocator interface, including alignment, and exploiting
/// malloc_size functionality. This allocator uses libpas (bmalloc) under the hood.
pub const libpas_allocator = Allocator{
    .ptr = undefined,
    .vtable = &libpas_allocator_vtable,
};

const libpas_allocator_vtable = Allocator.VTable{
    .alloc = LibPasAllocator.alloc,
    .resize = LibPasAllocator.resize,
    .free = LibPasAllocator.free,
};

/// Virtual memory management functions
pub const virtual = struct {
    /// Allocates zeroed virtual memory pages aligned to the system page size.
    /// The size will be rounded up to the nearest page size.
    pub fn allocatePages(size: usize) ?[*]u8 {
        return @as([*]u8, @ptrCast(bun_libpas_try_allocate_zeroed_virtual_pages(size)));
    }

    /// Frees virtual memory pages previously allocated with allocatePages.
    pub fn freePages(ptr: [*]u8, size: usize) void {
        bun_libpas_free_virtual_pages(ptr, size);
    }

    /// Allocates zeroed virtual memory pages and returns them as a slice.
    pub fn allocatePagesSlice(comptime T: type, count: usize) ?[]T {
        const size = count * @sizeOf(T);
        const ptr = allocatePages(size) orelse return null;
        return @as([*]T, @ptrCast(@alignCast(ptr)))[0..count];
    }
};

/// Utility functions for memory management
pub const memory = struct {
    pub fn scavenge() void {
        bun_libpas_scavenge();
    }

    pub fn scavengeThisThread() void {
        bun_libpas_scavenge_this_thread();
    }

    pub fn mallocSize(ptr: *const anyopaque) usize {
        return bun_libpas_malloc_size(ptr);
    }

    pub fn mallocGoodSize(size: usize) usize {
        return bun_libpas_malloc_good_size(size);
    }

    /// Allocate zeroed memory directly
    pub fn calloc(count: usize, size: usize) ?*anyopaque {
        return bun_libpas_try_calloc(count, size);
    }

    /// Try to resize memory in place
    pub fn tryRealloc(ptr: *anyopaque, size: usize) ?*anyopaque {
        return bun_libpas_try_realloc(ptr, size);
    }
};
