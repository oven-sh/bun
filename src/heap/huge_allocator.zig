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
