const std = @import("std");
const bun = @import("bun");
pub const Index = bun.ast.Index;

const IndexStringList = @This();

map: std.AutoArrayHashMapUnmanaged(Index.Int, []const u8) = .{},

pub fn deinit(self: *IndexStringList, allocator: std.mem.Allocator) void {
    for (self.map.values()) |value| {
        allocator.free(value);
    }
    self.map.deinit(allocator);
}

pub fn get(self: *const IndexStringList, index: Index.Int) ?[]const u8 {
    return self.map.get(index);
}

pub fn put(self: *IndexStringList, allocator: std.mem.Allocator, index: Index.Int, value: []const u8) !void {
    try self.map.put(allocator, index, value);
}
