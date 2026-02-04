pub fn ManagedList(comptime T: type) type {
    return struct {
        const Self = @This();
        #list: std.ArrayListUnmanaged(T),
        #allocator: std.mem.Allocator,

        pub fn init(allocator: std.mem.Allocator) Self {
            return .{
                .#list = .{},
                .#allocator = allocator,
            };
        }

        pub fn initCapacity(allocator: std.mem.Allocator, capacity: usize) !Self {
            var self = init(allocator);
            try self.#list.ensureTotalCapacity(allocator, capacity);
            return self;
        }

        pub fn deinit(self: *Self) void {
            self.#list.deinit(self.#allocator);
        }

        pub fn append(self: *Self, item: T) !void {
            try self.#list.append(self.#allocator, item);
        }

        pub fn appendSlice(self: *Self, items_slice: []const T) !void {
            try self.#list.appendSlice(self.#allocator, items_slice);
        }

        pub fn clearRetainingCapacity(self: *Self) void {
            self.#list.clearRetainingCapacity();
        }

        pub fn items(self: Self) []T {
            return self.#list.items;
        }
    };
}

const std = @import("std");
