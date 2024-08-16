const mem = @import("std").mem;
const builtin = @import("std").builtin;
const std = @import("std");
const bun = @import("root").bun;
const log = bun.Output.scoped(.mimalloc, true);
const assert = bun.assert;
const Allocator = mem.Allocator;
const mimalloc = @import("./allocators/mimalloc.zig");
const FeatureFlags = @import("./feature_flags.zig");
const Environment = @import("./env.zig");

fn mimalloc_free(
    _: *anyopaque,
    buf: []u8,
    buf_align: u8,
    _: usize,
) void {
    if (comptime Environment.enable_logs)
        log("mi_free({d})", .{buf.len});
    // mi_free_size internally just asserts the size
    // so it's faster if we don't pass that value through
    // but its good to have that assertion
    // let's only enable it in debug mode
    if (comptime Environment.isDebug) {
        assert(mimalloc.mi_is_in_heap_region(buf.ptr));
        if (mimalloc.canUseAlignedAlloc(buf.len, buf_align))
            mimalloc.mi_free_size_aligned(buf.ptr, buf.len, buf_align)
        else
            mimalloc.mi_free_size(buf.ptr, buf.len);
    } else {
        mimalloc.mi_free(buf.ptr);
    }
}

const CAllocator = struct {
    pub const supports_posix_memalign = true;

    fn alignedAlloc(len: usize, alignment: usize) ?[*]u8 {
        if (comptime Environment.enable_logs)
            log("mi_alloc({d}, {d})", .{ len, alignment });

        const ptr: ?*anyopaque = if (mimalloc.canUseAlignedAlloc(len, alignment))
            mimalloc.mi_malloc_aligned(len, alignment)
        else
            mimalloc.mi_malloc(len);

        if (comptime Environment.isDebug) {
            if (ptr != null) {
                const usable = mimalloc.mi_malloc_usable_size(ptr);
                if (usable < len and ptr != null) {
                    std.debug.panic("mimalloc: allocated size is too small: {d} < {d}", .{ usable, len });
                }
            }
        }

        return @as(?[*]u8, @ptrCast(ptr));
    }

    fn alignedAllocSize(ptr: [*]u8) usize {
        return mimalloc.mi_malloc_size(ptr);
    }

    fn alloc(_: *anyopaque, len: usize, log2_align: u8, _: usize) ?[*]u8 {
        if (comptime FeatureFlags.alignment_tweak) {
            return alignedAlloc(len, log2_align);
        }

        const alignment = @as(usize, 1) << @as(Allocator.Log2Align, @intCast(log2_align));
        return alignedAlloc(len, alignment);
    }

    fn resize(_: *anyopaque, buf: []u8, _: u8, new_len: usize, _: usize) bool {
        if (new_len <= buf.len) {
            return true;
        }

        const full_len = alignedAllocSize(buf.ptr);
        if (new_len <= full_len) {
            return true;
        }

        return false;
    }

    const free = mimalloc_free;
};

pub const c_allocator = Allocator{
    .ptr = undefined,
    .vtable = &c_allocator_vtable,
};
const c_allocator_vtable = Allocator.VTable{
    .alloc = &CAllocator.alloc,
    .resize = &CAllocator.resize,
    .free = &CAllocator.free,
};

const ZAllocator = struct {
    pub const supports_posix_memalign = true;

    fn alignedAlloc(len: usize, alignment: usize) ?[*]u8 {
        log("ZAllocator.alignedAlloc: {d}\n", .{len});

        const ptr = if (mimalloc.canUseAlignedAlloc(len, alignment))
            mimalloc.mi_zalloc_aligned(len, alignment)
        else
            mimalloc.mi_zalloc(len);

        if (comptime Environment.isDebug) {
            if (ptr != null) {
                const usable = mimalloc.mi_malloc_usable_size(ptr);
                if (usable < len) {
                    std.debug.panic("mimalloc: allocated size is too small: {d} < {d}", .{ usable, len });
                }
            }
        }

        return @as(?[*]u8, @ptrCast(ptr));
    }

    fn alignedAllocSize(ptr: [*]u8) usize {
        return mimalloc.mi_malloc_size(ptr);
    }

    fn alloc(_: *anyopaque, len: usize, ptr_align: u8, _: usize) ?[*]u8 {
        return alignedAlloc(len, ptr_align);
    }

    fn resize(_: *anyopaque, buf: []u8, _: u8, new_len: usize, _: usize) bool {
        if (new_len <= buf.len) {
            return true;
        }

        const full_len = alignedAllocSize(buf.ptr);
        if (new_len <= full_len) {
            return true;
        }

        return false;
    }

    const free = mimalloc_free;
};

pub const z_allocator = Allocator{
    .ptr = undefined,
    .vtable = &z_allocator_vtable,
};
const z_allocator_vtable = Allocator.VTable{
    .alloc = &ZAllocator.alloc,
    .resize = &ZAllocator.resize,
    .free = &ZAllocator.free,
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

        const slice = std.posix.mmap(
            null,
            len,
            std.posix.PROT.READ | std.posix.PROT.WRITE,
            std.posix.MAP.ANONYMOUS | std.posix.MAP.PRIVATE,
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
        std.posix.munmap(@alignCast(buf));
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
        _ = len_align;
        if (len >= huge_threshold) {
            return huge_allocator.rawAlloc(
                len,
                alignment,
                return_address,
            ) orelse return error.OutOfMemory;
        }

        return c_allocator.rawAlloc(
            len,
            alignment,
            return_address,
        ) orelse return error.OutOfMemory;
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
