const mem = @import("std").mem;
const builtin = @import("std").builtin;
const std = @import("std");

const mimalloc = @import("./allocators/mimalloc.zig");
const FeatureFlags = @import("./feature_flags.zig");
const Environment = @import("./env.zig");
const c = struct {
    pub const malloc_size = mimalloc.mi_malloc_size;
    pub const malloc_usable_size = mimalloc.mi_malloc_usable_size;
    pub const malloc = struct {
        pub inline fn malloc_wrapped(size: usize) ?*anyopaque {
            if (comptime FeatureFlags.log_allocations) std.debug.print("Malloc: {d}\n", .{size});

            return mimalloc.mi_malloc(size);
        }
    }.malloc_wrapped;
    pub inline fn free(ptr: anytype) void {
        if (comptime Environment.allow_assert) {
            assert(mimalloc.mi_is_in_heap_region(ptr));
        }

        mimalloc.mi_free(ptr);
    }
    pub const posix_memalign = struct {
        pub inline fn mi_posix_memalign(p: [*c]?*anyopaque, alignment: usize, size: usize) c_int {
            if (comptime FeatureFlags.log_allocations) std.debug.print("Posix_memalign: {d}\n", .{std.mem.alignForward(size, alignment)});
            return mimalloc.mi_posix_memalign(p, alignment, size);
        }
    }.mi_posix_memalign;
};
const Allocator = mem.Allocator;
const assert = std.debug.assert;
const CAllocator = struct {
    const malloc_size = c.malloc_size;
    pub const supports_posix_memalign = true;

    // This is copied from Rust's mimalloc integration
    const MI_MAX_ALIGN_SIZE = 16;
    inline fn mi_malloc_satisfies_alignment(alignment: usize, size: usize) bool {
        return (alignment == @sizeOf(*anyopaque) or
            (alignment == MI_MAX_ALIGN_SIZE and size >= (MI_MAX_ALIGN_SIZE / 2)));
    }

    fn alignedAlloc(len: usize, alignment: usize) ?[*]u8 {
        if (comptime FeatureFlags.log_allocations) std.debug.print("Malloc: {d}\n", .{len});

        var ptr = if (mi_malloc_satisfies_alignment(alignment, len))
            mimalloc.mi_malloc(len)
        else
            mimalloc.mi_malloc_aligned(len, alignment);

        return @ptrCast([*]u8, ptr orelse null);
    }

    fn alignedAllocSize(ptr: [*]u8) usize {
        return CAllocator.malloc_size(ptr);
    }

    fn alloc(
        _: *anyopaque,
        len: usize,
        alignment: u29,
        len_align: u29,
        return_address: usize,
    ) error{OutOfMemory}![]u8 {
        _ = return_address;
        assert(len > 0);
        assert(std.math.isPowerOfTwo(alignment));

        var ptr = alignedAlloc(len, alignment) orelse return error.OutOfMemory;
        if (len_align == 0) {
            return ptr[0..len];
        }
        return ptr[0..mem.alignBackwardAnyAlign(mimalloc.mi_usable_size(ptr), len_align)];
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

        const full_len = alignedAllocSize(buf.ptr);
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
        // mi_free_size internally just asserts the size
        // so it's faster if we don't pass that value through
        // but its good to have that assertion
        if (comptime Environment.allow_assert) {
            assert(mimalloc.mi_is_in_heap_region(buf.ptr));
            mimalloc.mi_free_size_aligned(buf.ptr, buf.len, buf_align);
        } else {
            mimalloc.mi_free(buf.ptr);
        }
    }
};

pub const c_allocator = Allocator{
    .ptr = undefined,
    .vtable = &c_allocator_vtable,
};
const c_allocator_vtable = Allocator.VTable{
    .alloc = CAllocator.alloc,
    .resize = CAllocator.resize,
    .free = CAllocator.free,
};

// This is a memory allocator which always writes zero instead of undefined
const ZAllocator = struct {
    const malloc_size = c.malloc_size;
    pub const supports_posix_memalign = true;

    // This is copied from Rust's mimalloc integration
    const MI_MAX_ALIGN_SIZE = 16;
    inline fn mi_malloc_satisfies_alignment(alignment: usize, size: usize) bool {
        return (alignment == @sizeOf(*anyopaque) or
            (alignment == MI_MAX_ALIGN_SIZE and size >= (MI_MAX_ALIGN_SIZE / 2)));
    }

    fn alignedAlloc(len: usize, alignment: usize) ?[*]u8 {
        if (comptime FeatureFlags.log_allocations) std.debug.print("Malloc: {d}\n", .{len});

        var ptr = if (mi_malloc_satisfies_alignment(alignment, len))
            mimalloc.mi_zalloc(len)
        else
            mimalloc.mi_zalloc_aligned(len, alignment);

        return @ptrCast([*]u8, ptr orelse return null);
    }

    fn alignedAllocSize(ptr: [*]u8) usize {
        return ZAllocator.malloc_size(ptr);
    }

    fn alloc(
        _: *anyopaque,
        len: usize,
        alignment: u29,
        len_align: u29,
        return_address: usize,
    ) error{OutOfMemory}![]u8 {
        _ = return_address;
        assert(len > 0);
        assert(std.math.isPowerOfTwo(alignment));

        var ptr = alignedAlloc(len, alignment) orelse return error.OutOfMemory;
        if (len_align == 0) {
            return ptr[0..len];
        }
        return ptr[0..mem.alignBackwardAnyAlign(mimalloc.mi_usable_size(ptr), len_align)];
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

        const full_len = alignedAllocSize(buf.ptr);
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

pub const z_allocator = Allocator{
    .ptr = undefined,
    .vtable = &z_allocator_vtable,
};
const z_allocator_vtable = Allocator.VTable{
    .alloc = ZAllocator.alloc,
    .resize = ZAllocator.resize,
    .free = ZAllocator.free,
};
const HugeAllocator = struct {
    fn alloc(
        _: *anyopaque,
        len: usize,
        alignment: u29,
        len_align: u29,
        return_address: usize,
    ) error{OutOfMemory}![]u8 {
        _ = return_address;
        assert(len > 0);
        assert(std.math.isPowerOfTwo(alignment));

        var slice = std.os.mmap(
            null,
            len,
            std.os.PROT.READ | std.os.PROT.WRITE,
            std.os.MAP.ANONYMOUS | std.os.MAP.PRIVATE,
            -1,
            0,
        ) catch
            return error.OutOfMemory;

        _ = len_align;
        return slice;
    }

    fn resize(
        _: *anyopaque,
        _: []u8,
        _: u29,
        _: usize,
        _: u29,
        _: usize,
    ) ?usize {
        return null;
    }

    fn free(
        _: *anyopaque,
        buf: []u8,
        _: u29,
        _: usize,
    ) void {
        std.os.munmap(@alignCast(std.meta.alignment([]align(std.mem.page_size) u8), buf));
    }
};

pub const huge_allocator = Allocator{
    .ptr = undefined,
    .vtable = &huge_allocator_vtable,
};
const huge_allocator_vtable = Allocator.VTable{
    .alloc = HugeAllocator.alloc,
    .resize = HugeAllocator.resize,
    .free = HugeAllocator.free,
};

pub const huge_threshold = 1024 * 256;

const AutoSizeAllocator = struct {
    fn alloc(
        _: *anyopaque,
        len: usize,
        alignment: u29,
        len_align: u29,
        return_address: usize,
    ) error{OutOfMemory}![]u8 {
        if (len >= huge_threshold) {
            return huge_allocator.rawAlloc(
                len,
                alignment,
                len_align,
                return_address,
            );
        }

        return c_allocator.rawAlloc(
            len,
            alignment,
            len_align,
            return_address,
        );
    }

    fn resize(
        _: *anyopaque,
        _: []u8,
        _: u29,
        _: usize,
        _: u29,
        _: usize,
    ) ?usize {
        return null;
    }

    fn free(
        _: *anyopaque,
        buf: []u8,
        a: u29,
        b: usize,
    ) void {
        if (buf.len >= huge_threshold) {
            return huge_allocator.rawFree(
                buf,
                a,
                b,
            );
        }

        return c_allocator.rawFree(
            buf,
            a,
            b,
        );
    }
};

pub const auto_allocator = Allocator{
    .ptr = undefined,
    .vtable = &auto_allocator_vtable,
};
const auto_allocator_vtable = Allocator.VTable{
    .alloc = AutoSizeAllocator.alloc,
    .resize = AutoSizeAllocator.resize,
    .free = AutoSizeAllocator.free,
};
