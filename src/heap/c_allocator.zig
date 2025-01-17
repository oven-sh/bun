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

    const free = mimalloc.free;
};

pub const c_allocator = Allocator{
    // This ptr can be anything. But since it's not nullable, we should set it to something.
    .ptr = @constCast(c_allocator_vtable),
    .vtable = c_allocator_vtable,
};
const c_allocator_vtable = &Allocator.VTable{
    .alloc = &CAllocator.alloc,
    .resize = &CAllocator.resize,
    .free = &CAllocator.free,
};
