const std = @import("std");
const bun = @import("root").bun;

pub const Mimalloc = @import("./heap/Mimalloc.zig");
pub const MimallocArena = @import("./heap/MimallocArena.zig").Arena;
pub const NullableAllocator = @import("./heap/NullableAllocator.zig");
pub const MaxHeapAllocator = @import("./heap/MaxHeapAllocator.zig").MaxHeapAllocator;
pub const MemFdAllocator = @import("./heap/MemFdAllocator.zig").MemFdAllocator;

const heap_breakdown = bun.heap_breakdown;

pub const use_mimalloc = true;

pub const default_allocator: std.mem.Allocator = if (!use_mimalloc)
    std.heap.c_allocator
else
    @import("./heap/c_allocator.zig").c_allocator;

/// Zeroing memory allocator
pub const z_allocator: std.mem.Allocator = if (!use_mimalloc)
    std.heap.c_allocator
else
    @import("./heap/z_allocator.zig").z_allocator;

pub const huge_allocator: std.mem.Allocator = if (!use_mimalloc)
    std.heap.c_allocator
else
    @import("./heap/huge_allocator.zig").huge_allocator;

pub const auto_allocator: std.mem.Allocator = if (!use_mimalloc)
    std.heap.c_allocator
else
    @import("./heap/auto_allocator.zig").auto_allocator;

/// We cannot use a threadlocal memory allocator for FileSystem-related things
/// FileSystem is a singleton.
pub const fs_allocator = default_allocator;

pub const failing_allocator = @import("./heap/failing_allocator.zig");

pub fn typedAllocator(comptime T: type) std.mem.Allocator {
    if (heap_breakdown.enabled)
        return heap_breakdown.allocator(comptime T);

    return default_allocator;
}

pub inline fn namedAllocator(comptime name: [:0]const u8) std.mem.Allocator {
    if (heap_breakdown.enabled)
        return heap_breakdown.namedAllocator(name);

    return default_allocator;
}

pub fn threadlocalAllocator() std.mem.Allocator {
    if (comptime use_mimalloc) {
        return MimallocArena.getThreadlocalDefault();
    }

    return default_allocator;
}
