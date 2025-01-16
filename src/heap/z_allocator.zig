const std = @import("std");
const mem = std.mem;
const builtin = std.builtin;
const bun = @import("root").bun;
const log = bun.Output.scoped(.mimalloc, true);
const assert = bun.assert;
const Allocator = mem.Allocator;
const mimalloc = bun.heap.Mimalloc;
const FeatureFlags = bun.FeatureFlags;
const Environment = bun.Environment;

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

    const free = mimalloc.free;
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
