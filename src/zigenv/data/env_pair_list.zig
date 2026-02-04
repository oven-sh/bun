const std = @import("std");
const EnvPair = @import("env_pair.zig").EnvPair;
const Allocator = std.mem.Allocator;

/// A managed list of EnvPairs with pre-allocation support.
/// This replaces std.ArrayListUnmanaged(EnvPair) to give us precise control over memory.
pub const EnvPairList = struct {
    items: []EnvPair,
    capacity: usize,
    allocator: Allocator,

    pub fn init(allocator: Allocator) EnvPairList {
        return .{
            .items = &[_]EnvPair{},
            .capacity = 0,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *EnvPairList) void {
        for (self.items) |*pair| {
            pair.deinit();
        }
        if (self.capacity > 0) {
            // Use the stored allocator to free the backing memory
            // We must reconstruct the slice that was allocated
            // self.items.ptr points to the start.
            self.allocator.free(self.items.ptr[0..self.capacity]);
        }
        self.items = &[_]EnvPair{};
        self.capacity = 0;
    }

    /// Pre-allocate space for at least new_capacity items.
    /// Does not change the number of items.
    pub fn ensureTotalCapacity(self: *EnvPairList, new_capacity: usize) !void {
        if (self.capacity >= new_capacity) return;

        var old_mem: []EnvPair = undefined;
        if (self.capacity == 0) {
            old_mem = &[_]EnvPair{};
        } else {
            // Reconstruct the full allocated slice
            old_mem = self.items.ptr[0..self.capacity];
        }

        const new_mem = try self.allocator.realloc(old_mem, new_capacity);

        self.capacity = new_mem.len;
        // Update items slice to point to new memory, preserving current length
        self.items = new_mem[0..self.items.len];
    }

    pub fn append(self: *EnvPairList, item: EnvPair) !void {
        if (self.items.len >= self.capacity) {
            var new_cap = self.capacity;
            if (new_cap == 0) {
                new_cap = 8;
            } else {
                // Grow by 2x
                new_cap *= 2;
            }
            // Ensure we grow enough to fit at least one more
            if (new_cap < self.items.len + 1) new_cap = self.items.len + 1;

            try self.ensureTotalCapacity(new_cap);
        }

        // Access the backing array at the position of the new item
        const full_slice = self.items.ptr[0..self.capacity];
        full_slice[self.items.len] = item;

        // Update items slice to include the new item
        self.items = full_slice[0 .. self.items.len + 1];
    }

    /// Clear the list but keep the memory allocated.
    /// Clean up the pairs themselves.
    pub fn clearRetainingCapacity(self: *EnvPairList) void {
        for (self.items) |*pair| {
            pair.deinit();
        }
        self.items.len = 0;
    }
};

test "EnvPairList basic usage" {
    const testing = std.testing;
    const allocator = testing.allocator;

    var list = EnvPairList.init(allocator);
    defer list.deinit();

    var pair1 = EnvPair.init(allocator);
    // Add some data so we can verify cleanup
    pair1.key.setOwnBuffer(try allocator.dupe(u8, "key1"));
    try list.append(pair1);

    try testing.expectEqual(@as(usize, 1), list.items.len);
    try testing.expectEqualStrings("key1", list.items[0].key.key());
}
