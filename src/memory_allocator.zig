const mem = @import("std").mem;
const builtin = @import("std").builtin;
const std = @import("std");

const mimalloc = @import("./allocators/mimalloc.zig");
const FeatureFlags = @import("./feature_flags.zig");

const c = struct {
    pub const malloc_size = mimalloc.mi_malloc_size;
    pub const malloc_usable_size = mimalloc.mi_malloc_usable_size;
    pub const malloc = struct {
        pub inline fn malloc_wrapped(size: usize) ?*anyopaque {
            if (comptime FeatureFlags.log_allocations) std.debug.print("Malloc: {d}\n", .{size});
            return mimalloc.mi_malloc(size);
        }
    }.malloc_wrapped;
    pub const free = mimalloc.mi_free;
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
    comptime {
        if (!@import("builtin").link_libc) {
            @compileError("C allocator is only available when linking against libc");
        }
    }

    usingnamespace if (@hasDecl(c, "malloc_size"))
        struct {
            pub const supports_malloc_size = true;
            pub const malloc_size = c.malloc_size;
        }
    else if (@hasDecl(c, "malloc_usable_size"))
        struct {
            pub const supports_malloc_size = true;
            pub const malloc_size = c.malloc_usable_size;
        }
    else if (@hasDecl(c, "_msize"))
        struct {
            pub const supports_malloc_size = true;
            pub const malloc_size = c._msize;
        }
    else
        struct {
            pub const supports_malloc_size = false;
        };

    pub const supports_posix_memalign = true;

    fn getHeader(ptr: [*]u8) *[*]u8 {
        return @intToPtr(*[*]u8, @ptrToInt(ptr) - @sizeOf(usize));
    }

    const MI_MAX_ALIGN_SIZE = 16;
    inline fn mi_malloc_satisfies_alignment(alignment: usize, size: usize) bool {
        return (alignment == @sizeOf(*anyopaque) or (alignment == MI_MAX_ALIGN_SIZE and size > (MI_MAX_ALIGN_SIZE / 2)));
    }

    fn alignedAlloc(len: usize, alignment: usize) ?[*]u8 {
        var ptr = if (mi_malloc_satisfies_alignment(alignment, len))
            mimalloc.mi_malloc(len)
        else
            mimalloc.mi_malloc_aligned(len, alignment);

        return @ptrCast([*]u8, ptr orelse null);
    }

    fn alignedFree(ptr: [*]u8) void {
        return c.free(ptr);
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
        mimalloc.mi_free(buf.ptr);
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
    comptime {
        if (!@import("builtin").link_libc) {
            @compileError("C allocator is only available when linking against libc");
        }
    }

    usingnamespace if (@hasDecl(c, "malloc_size"))
        struct {
            pub const supports_malloc_size = true;
            pub const malloc_size = c.malloc_size;
        }
    else if (@hasDecl(c, "malloc_usable_size"))
        struct {
            pub const supports_malloc_size = true;
            pub const malloc_size = c.malloc_usable_size;
        }
    else if (@hasDecl(c, "_msize"))
        struct {
            pub const supports_malloc_size = true;
            pub const malloc_size = c._msize;
        }
    else
        struct {
            pub const supports_malloc_size = false;
        };

    pub const supports_posix_memalign = true;

    fn getHeader(ptr: [*]u8) *[*]u8 {
        return @intToPtr(*[*]u8, @ptrToInt(ptr) - @sizeOf(usize));
    }

    const MI_MAX_ALIGN_SIZE = 16;
    inline fn mi_malloc_satisfies_alignment(alignment: usize, size: usize) bool {
        return (alignment == @sizeOf(*anyopaque) or (alignment == MI_MAX_ALIGN_SIZE and size > (MI_MAX_ALIGN_SIZE / 2)));
    }

    fn alignedAlloc(len: usize, alignment: usize) ?[*]u8 {
        var ptr = if (mi_malloc_satisfies_alignment(alignment, len))
            mimalloc.mi_zalloc(len)
        else
            mimalloc.mi_zalloc_aligned(len, alignment);

        return @ptrCast([*]u8, ptr orelse null);
    }

    fn alignedFree(ptr: [*]u8) void {
        return c.free(ptr);
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
