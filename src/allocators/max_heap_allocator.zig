const bun = @import("root").bun;
const std = @import("std");

/// Single allocation only.
///
pub const MaxHeapAllocator = struct {
    array_list: std.ArrayList(u8),

    fn alloc(ptr: *anyopaque, len: usize, _: u8, _: usize) ?[*]u8 {
        var this = bun.cast(*MaxHeapAllocator, ptr);
        this.array_list.items.len = 0;
        this.array_list.ensureTotalCapacity(len) catch return null;
        this.array_list.items.len = len;
        return this.array_list.items.ptr;
    }

    fn resize(_: *anyopaque, buf: []u8, _: u8, new_len: usize, _: usize) bool {
        _ = new_len;
        _ = buf;
        @panic("not implemented");
    }

    fn free(
        _: *anyopaque,
        _: []u8,
        _: u8,
        _: usize,
    ) void {}

    pub fn reset(this: *MaxHeapAllocator) void {
        this.array_list.items.len = 0;
    }

    pub fn deinit(this: *MaxHeapAllocator) void {
        this.array_list.deinit();
    }

    const vtable = std.mem.Allocator.VTable{
        .alloc = &alloc,
        .free = &free,
        .resize = &resize,
    };
    pub fn init(this: *MaxHeapAllocator, allocator: std.mem.Allocator) std.mem.Allocator {
        this.array_list = std.ArrayList(u8).init(allocator);

        return std.mem.Allocator{
            .ptr = this,
            .vtable = &vtable,
        };
    }
};
