const std = @import("std");

extern fn print(*const u8) void;

comptime {
    std.debug.assert(@alignOf(u64) >= 8);
}

export fn alloc(size: u32) [*]const u8 {
    const slice = std.heap.wasm_allocator.alloc(u8, size) catch @panic("wasm failed to allocate memory");
    return slice.ptr;
}

export fn wyhash(input_ptr: [*]const u8, input_size: u32, seed: u64) u64 {
    const input: []const u8 = input_ptr[0..input_size];
    defer std.heap.wasm_allocator.free(input);
    return std.hash.Wyhash.hash(seed, input);
}
