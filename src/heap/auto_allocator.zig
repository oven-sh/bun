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
const c_allocator = bun.heap.c_allocator;
const huge_allocator = bun.heap.huge_allocator;

const huge_threshold = 1024 * 256;

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
