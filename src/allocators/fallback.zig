pub const c_allocator = std.heap.c_allocator;
pub const z_allocator = @import("./fallback/z.zig").allocator;

pub const malloc = std.c.malloc;
pub const free = std.c.free;
pub const realloc = std.c.realloc;
pub const calloc = std.c.calloc;
pub const usable_size = switch (Environment.os) {
    .mac => std.c.malloc_size,
    .linux => std.c.malloc_usable_size,
    .windows => std.c._msize,
    .wasm => @compileError("unreachable"),
};

const Environment = @import("../env.zig");
const std = @import("std");
