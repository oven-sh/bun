const mem = @import("std").mem;
const std = @import("std");
const bun = @import("bun");
const log = bun.Output.scoped(.mimalloc, true);
const assert = bun.assert;
const Allocator = mem.Allocator;
const mimalloc = @import("./mimalloc.zig");
const Environment = @import("../env.zig");

fn mimalloc_free(
    _: *anyopaque,
    buf: []u8,
    alignment: mem.Alignment,
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
        if (mimalloc.canUseAlignedAlloc(buf.len, alignment.toByteUnits()))
            mimalloc.mi_free_size_aligned(buf.ptr, buf.len, alignment.toByteUnits())
        else
            mimalloc.mi_free_size(buf.ptr, buf.len);
    } else {
        mimalloc.mi_free(buf.ptr);
    }
}

const MimallocAllocator = struct {
    pub const supports_posix_memalign = true;

    fn alignedAlloc(len: usize, alignment: mem.Alignment) ?[*]u8 {
        if (comptime Environment.enable_logs)
            log("mi_alloc({d}, {d})", .{ len, alignment.toByteUnits() });

        const ptr: ?*anyopaque = if (mimalloc.canUseAlignedAlloc(len, alignment.toByteUnits()))
            mimalloc.mi_malloc_aligned(len, alignment.toByteUnits())
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

    fn alloc_with_default_allocator(_: *anyopaque, len: usize, alignment: mem.Alignment, _: usize) ?[*]u8 {
        return alignedAlloc(len, alignment);
    }

    fn resize_with_default_allocator(_: *anyopaque, buf: []u8, _: mem.Alignment, new_len: usize, _: usize) bool {
        return mimalloc.mi_expand(buf.ptr, new_len) != null;
    }

    fn remap_with_default_allocator(_: *anyopaque, buf: []u8, alignment: mem.Alignment, new_len: usize, _: usize) ?[*]u8 {
        return @ptrCast(mimalloc.mi_realloc_aligned(buf.ptr, new_len, alignment.toByteUnits()));
    }

    const free_with_default_allocator = mimalloc_free;
};

pub const c_allocator = Allocator{
    // This ptr can be anything. But since it's not nullable, we should set it to something.
    .ptr = memory_allocator_tags.default_allocator_tag_ptr,
    .vtable = c_allocator_vtable,
};
const c_allocator_vtable = &Allocator.VTable{
    .alloc = &MimallocAllocator.alloc_with_default_allocator,
    .resize = &MimallocAllocator.resize_with_default_allocator,
    .remap = &MimallocAllocator.remap_with_default_allocator,
    .free = &MimallocAllocator.free_with_default_allocator,
};

const ZAllocator = struct {
    pub const supports_posix_memalign = true;

    fn alignedAlloc(len: usize, alignment: mem.Alignment) ?[*]u8 {
        log("ZAllocator.alignedAlloc: {d}\n", .{len});

        const ptr = if (mimalloc.canUseAlignedAlloc(len, alignment.toByteUnits()))
            mimalloc.mi_zalloc_aligned(len, alignment.toByteUnits())
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

    fn alloc_with_z_allocator(_: *anyopaque, len: usize, alignment: mem.Alignment, _: usize) ?[*]u8 {
        return alignedAlloc(len, alignment);
    }

    fn resize_with_z_allocator(_: *anyopaque, buf: []u8, _: mem.Alignment, new_len: usize, _: usize) bool {
        if (new_len <= buf.len) {
            return true;
        }

        const full_len = alignedAllocSize(buf.ptr);
        if (new_len <= full_len) {
            return true;
        }

        return false;
    }

    const free_with_z_allocator = mimalloc_free;
};

const memory_allocator_tags = struct {
    const default_allocator_tag: usize = 0xBEEFA110C; // "BEEFA110C"  beef a110c i guess
    pub const default_allocator_tag_ptr: *anyopaque = @ptrFromInt(default_allocator_tag);

    const z_allocator_tag: usize = 0x2a11043470123; // "z4110c4701" (Z ALLOCATOR in 1337 speak)
    pub const z_allocator_tag_ptr: *anyopaque = @ptrFromInt(z_allocator_tag);
};

pub const z_allocator = Allocator{
    .ptr = memory_allocator_tags.z_allocator_tag_ptr,
    .vtable = &z_allocator_vtable,
};
const z_allocator_vtable = Allocator.VTable{
    .alloc = &ZAllocator.alloc_with_z_allocator,
    .resize = &ZAllocator.resize_with_z_allocator,
    .remap = &std.mem.Allocator.noRemap,
    .free = &ZAllocator.free_with_z_allocator,
};
