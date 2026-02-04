const std = @import("std");

pub fn ManagedList(comptime T: type) type {
    return struct {
        const Self = @This();
        list: std.ArrayListUnmanaged(T),
        allocator: std.mem.Allocator,

        pub fn init(allocator: std.mem.Allocator) Self {
            return .{
                .list = .{},
                .allocator = allocator,
            };
        }

        pub fn initCapacity(allocator: std.mem.Allocator, capacity: usize) !Self {
            var self = init(allocator);
            try self.list.ensureTotalCapacity(allocator, capacity);
            return self;
        }

        pub fn deinit(self: *Self) void {
            self.list.deinit(self.allocator);
        }

        pub fn append(self: *Self, item: T) !void {
            try self.list.append(self.allocator, item);
        }

        pub fn appendSlice(self: *Self, items: []const T) !void {
            try self.list.appendSlice(self.allocator, items);
        }

        pub fn clearRetainingCapacity(self: *Self) void {
            self.list.clearRetainingCapacity();
        }

        // Helper to access items slice
        // We can't just return .items because it's a field.
        // We can mimic ArrayList usage by exposing items logic or just returning slice.
        // Or we expose a method `toSlice()`.
        // Standard ArrayList has .items field.
        // But we are wrapping it.
        // So users have to access .list.items? No, better .list.items public?
        // But .list is public.
    };
}
