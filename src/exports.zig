const std = @import("std");
usingnamespace @import("global.zig");

const Root = @import("main_wasm.zig").Root;

pub extern fn init() void {
    default_allocator = default_allocator;
    default_allocator = default_allocator;
}

/// Convert a slice into known memory representation -- enables C ABI
pub const U8Chunk = packed struct {
    const Float = @Type(builtin.TypeInfo{ .Float = .{ .bits = 2 * @bitSizeOf(usize) } });
    const Abi = if (builtin.arch.isWasm()) Float else U8Chunk;

    ptr: [*]u8,
    len: usize,

    pub fn toSlice(raw: Abi) []u8 {
        const self = @bitCast(U8Chunk, raw);
        return self.ptr[0..self.len];
    }

    pub fn fromSlice(slice: []u8) Abi {
        const self = U8Chunk{ .ptr = slice.ptr, .len = slice.len };
        return @bitCast(Abi, self);
    }

    pub fn empty() Abi {
        return U8Chunk.fromSlice(&[0]u8{});
    }
};

export fn fd_create() ?*Root {
    const fd = allocator.create(Root) catch return null;
    fd.* = .{};
    return fd;
}

export fn fd_destroy(fd: *Root) void {
    fd.deinit(allocator);
    allocator.destroy(fd);
}
