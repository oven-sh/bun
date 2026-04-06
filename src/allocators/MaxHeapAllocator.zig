//! Single allocation only.

const Self = @This();

array_list: std.array_list.AlignedManaged(u8, .of(std.c.max_align_t)),

fn alloc(ptr: *anyopaque, len: usize, alignment: std.mem.Alignment, _: usize) ?[*]u8 {
    bun.assert(alignment.toByteUnits() <= @alignOf(std.c.max_align_t));
    var self = bun.cast(*Self, ptr);
    self.array_list.items.len = 0;
    self.array_list.ensureTotalCapacity(len) catch return null;
    self.array_list.items.len = len;
    return self.array_list.items.ptr;
}

fn resize(_: *anyopaque, buf: []u8, _: std.mem.Alignment, new_len: usize, _: usize) bool {
    _ = new_len;
    _ = buf;
    @panic("not implemented");
}

fn free(
    _: *anyopaque,
    _: []u8,
    _: std.mem.Alignment,
    _: usize,
) void {}

pub fn reset(self: *Self) void {
    self.array_list.items.len = 0;
}

pub fn deinit(self: *Self) void {
    self.array_list.deinit();
}

const vtable = std.mem.Allocator.VTable{
    .alloc = &alloc,
    .free = &free,
    .resize = &resize,
    .remap = &std.mem.Allocator.noRemap,
};

pub fn init(self: *Self, allocator: std.mem.Allocator) std.mem.Allocator {
    self.array_list = .init(allocator);

    return std.mem.Allocator{
        .ptr = self,
        .vtable = &vtable,
    };
}

pub fn isInstance(allocator: std.mem.Allocator) bool {
    return allocator.vtable == &vtable;
}

const bun = @import("bun");
const std = @import("std");
