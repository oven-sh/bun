const std = @import("std");

extern fn print(*const u8) void;

comptime {
    std.debug.assert(@alignOf(u16) >= 2);
    std.debug.assert(@alignOf(u32) >= 4);
    std.debug.assert(@alignOf(u64) >= 8);
    std.debug.assert(@alignOf(i16) >= 2);
    std.debug.assert(@alignOf(i32) >= 4);
    std.debug.assert(@alignOf(i64) >= 8);
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
export fn adler32(input_ptr: [*]const u8, input_size: u32) u32 {
    const input: []const u8 = input_ptr[0..input_size];
    defer std.heap.wasm_allocator.free(input);
    return std.hash.Adler32.hash(input);
}
export fn crc32(input_ptr: [*]const u8, input_size: u32) u32 {
    const input: []const u8 = input_ptr[0..input_size];
    defer std.heap.wasm_allocator.free(input);
    return std.hash.Crc32.hash(input);
}
export fn cityhash32(input_ptr: [*]const u8, input_size: u32) u32 {
    const input: []const u8 = input_ptr[0..input_size];
    defer std.heap.wasm_allocator.free(input);
    return std.hash.CityHash32.hash(input);
}
export fn cityhash64(input_ptr: [*]const u8, input_size: u32, seed: u64) u64 {
    const input: []const u8 = input_ptr[0..input_size];
    defer std.heap.wasm_allocator.free(input);
    return std.hash.CityHash64.hashWithSeed(input, seed);
}
export fn xxhash32(input_ptr: [*]const u8, input_size: u32, seed: u32) u32 {
    const input: []const u8 = input_ptr[0..input_size];
    defer std.heap.wasm_allocator.free(input);
    return std.hash.XxHash32.hash(seed, input);
}
export fn xxhash64(input_ptr: [*]const u8, input_size: u32, seed: u64) u64 {
    const input: []const u8 = input_ptr[0..input_size];
    defer std.heap.wasm_allocator.free(input);
    return std.hash.XxHash64.hash(seed, input);
}
export fn xxhash3(input_ptr: [*]const u8, input_size: u32, seed: u64) u64 {
    const input: []const u8 = input_ptr[0..input_size];
    defer std.heap.wasm_allocator.free(input);
    return std.hash.XxHash3.hash(seed, input);
}
export fn murmur32v3(input_ptr: [*]const u8, input_size: u32, seed: u32) u32 {
    const input: []const u8 = input_ptr[0..input_size];
    defer std.heap.wasm_allocator.free(input);
    return std.hash.Murmur3_32.hashWithSeed(input, seed);
}
export fn murmur32v2(input_ptr: [*]const u8, input_size: u32, seed: u32) u32 {
    const input: []const u8 = input_ptr[0..input_size];
    defer std.heap.wasm_allocator.free(input);
    return std.hash.Murmur2_32.hashWithSeed(input, seed);
}
export fn murmur64v2(input_ptr: [*]const u8, input_size: u32, seed: u64) u64 {
    const input: []const u8 = input_ptr[0..input_size];
    defer std.heap.wasm_allocator.free(input);
    return std.hash.Murmur2_64.hashWithSeed(input, seed);
}
