const std = @import("std");

/// ReusableBuffer is a custom buffer type designed to replace std.ArrayList(u8) usage
/// throughout the codebase. It provides a similar interface to C++ std::string when
/// used as a reusable buffer.
///
/// It explicitly manages an index (len) and capacity to avoid frequent slice reconstruction
/// and to better support "reset without deallocation".
pub const ReusableBuffer = struct {
    allocator: std.mem.Allocator,
    ptr: [*]u8,
    len: usize, // The "index" where items are added
    capacity: usize, // Total allocated size

    /// Initialize an empty buffer with no initial allocation
    pub fn init(allocator: std.mem.Allocator) ReusableBuffer {
        return .{
            .allocator = allocator,
            .ptr = undefined, // ptr is undefined if capacity is 0
            .len = 0,
            .capacity = 0,
        };
    }

    /// Initialize a buffer with a specific capacity pre-allocated
    pub fn initCapacity(allocator: std.mem.Allocator, capacity: usize) !ReusableBuffer {
        if (capacity == 0) {
            return init(allocator);
        }

        const buffer = try allocator.alloc(u8, capacity);
        return .{
            .allocator = allocator,
            .ptr = buffer.ptr,
            .len = 0,
            .capacity = capacity,
        };
    }

    /// Free all memory owned by this buffer
    pub fn deinit(self: *ReusableBuffer) void {
        if (self.capacity > 0) {
            const full_slice = self.ptr[0..self.capacity];
            self.allocator.free(full_slice);
        }
        self.len = 0;
        self.capacity = 0;
        self.ptr = undefined;
    }

    /// Returns the slice of used data
    pub fn usedSlice(self: *const ReusableBuffer) []u8 {
        if (self.capacity == 0) return &[_]u8{};
        return self.ptr[0..self.len];
    }

    /// Alias for usedSlice to satisfy some common interfaces
    pub fn items(self: *const ReusableBuffer) []u8 {
        return self.usedSlice();
    }

    /// Append a single byte to the buffer, growing by 30% if necessary
    pub fn append(self: *ReusableBuffer, item: u8) !void {
        if (self.len >= self.capacity) {
            try self.ensureCapacityWithGrowth(self.len + 1, 30);
        }
        self.appendAssumeCapacity(item);
    }

    /// Append multiple bytes to the buffer, growing by 30% if necessary
    pub fn appendSlice(self: *ReusableBuffer, items_slice: []const u8) !void {
        const needed = self.len + items_slice.len;
        if (needed > self.capacity) {
            try self.ensureCapacityWithGrowth(needed, 30);
        }
        self.appendSliceAssumeCapacity(items_slice);
    }

    /// Ensures capacity, growing by specified percentage if needed
    pub fn ensureCapacityWithGrowth(self: *ReusableBuffer, new_capacity: usize, growth_percent: u8) !void {
        if (new_capacity <= self.capacity) return;

        const growth_factor = @as(f32, @floatFromInt(100 + growth_percent)) / 100.0;
        const new_size = @max(new_capacity, @as(usize, @intFromFloat(@as(f32, @floatFromInt(self.capacity)) * growth_factor)));

        try self.ensureCapacity(new_size);
    }

    /// Resize the buffer to a new length
    /// If growing, new bytes are uninitialized (but memory is allocated)
    /// If shrinking, len is reduced but capacity is retained
    pub fn resize(self: *ReusableBuffer, new_len: usize) !void {
        if (new_len > self.capacity) {
            try self.ensureCapacity(new_len);
        }
        self.len = new_len;
    }

    /// Create a buffer from an existing slice, taking ownership of the memory
    /// The slice must have been allocated with the same allocator
    pub fn fromOwnedSlice(allocator: std.mem.Allocator, slice: []u8) ReusableBuffer {
        return .{
            .allocator = allocator,
            .ptr = slice.ptr,
            .len = slice.len, // Assume full slice is used data
            .capacity = slice.len, // And capacity matches length
        };
    }

    /// Clear the buffer contents but retain the allocated capacity for reuse
    pub fn clearRetainingCapacity(self: *ReusableBuffer) void {
        self.len = 0;
    }

    /// Create an independent copy of this buffer
    pub fn clone(self: *const ReusableBuffer) !ReusableBuffer {
        var new_buffer = try initCapacity(self.allocator, self.len);
        new_buffer.appendSliceAssumeCapacity(self.usedSlice());
        return new_buffer;
    }

    /// Transfer ownership of the buffer contents out, leaving the buffer empty
    /// The caller is responsible for freeing the returned slice
    pub fn toOwnedSlice(self: *ReusableBuffer) []u8 {
        if (self.len == 0 and self.capacity == 0) {
            return self.allocator.dupe(u8, &[_]u8{}) catch unreachable;
        }

        // Return a slice that matches the length.
        const new_ptr = self.allocator.realloc(self.ptr[0..self.capacity], self.len) catch {
            // If shrink fails (unlikely given it's shrinking), duplicate to be safe.
            return self.allocator.dupe(u8, self.ptr[0..self.len]) catch unreachable;
        };

        // Ownership transferred
        self.ptr = undefined;
        self.len = 0;
        self.capacity = 0;

        return new_ptr;
    }

    /// Get the current length of the buffer
    pub inline fn length(self: *const ReusableBuffer) usize {
        return self.len;
    }

    // Private helper methods

    fn ensureUnusedCapacity(self: *ReusableBuffer, additional: usize) !void {
        const needed_capacity = self.len + additional;
        if (self.capacity >= needed_capacity) {
            return;
        }
        try self.ensureCapacity(needed_capacity);
    }

    fn ensureCapacity(self: *ReusableBuffer, new_capacity: usize) !void {
        if (self.capacity >= new_capacity) {
            return;
        }

        const new_memory = if (self.capacity > 0)
            try self.allocator.realloc(self.ptr[0..self.capacity], new_capacity)
        else
            try self.allocator.alloc(u8, new_capacity);

        self.ptr = new_memory.ptr;
        self.capacity = new_memory.len;
    }

    fn appendAssumeCapacity(self: *ReusableBuffer, item: u8) void {
        self.ptr[self.len] = item;
        self.len += 1;
    }

    fn appendSliceAssumeCapacity(self: *ReusableBuffer, new_items: []const u8) void {
        const old_len = self.len;
        const new_len = old_len + new_items.len;
        @memcpy(self.ptr[old_len..new_len], new_items);
        self.len = new_len;
    }

    pub const Writer = std.io.GenericWriter(*ReusableBuffer, std.mem.Allocator.Error, appendWrite);

    pub fn writer(self: *ReusableBuffer) Writer {
        return .{ .context = self };
    }

    fn appendWrite(self: *ReusableBuffer, bytes: []const u8) !usize {
        try self.appendSlice(bytes);
        return bytes.len;
    }
};

// ============================================================================
// Tests
// ============================================================================

test "ReusableBuffer: init and deinit" {
    var buffer = ReusableBuffer.init(std.testing.allocator);
    defer buffer.deinit();

    try std.testing.expectEqual(@as(usize, 0), buffer.length());
    try std.testing.expectEqual(@as(usize, 0), buffer.capacity);
}

test "ReusableBuffer: initCapacity" {
    var buffer = try ReusableBuffer.initCapacity(std.testing.allocator, 10);
    defer buffer.deinit();

    try std.testing.expectEqual(@as(usize, 0), buffer.length());
    try std.testing.expectEqual(@as(usize, 10), buffer.capacity);
}

test "ReusableBuffer: append single byte" {
    var buffer = ReusableBuffer.init(std.testing.allocator);
    defer buffer.deinit();

    try buffer.append('a');
    try std.testing.expectEqual(@as(usize, 1), buffer.length());
    try std.testing.expectEqual(@as(u8, 'a'), buffer.usedSlice()[0]);

    try buffer.append('b');
    try std.testing.expectEqual(@as(usize, 2), buffer.length());
    try std.testing.expectEqual(@as(u8, 'b'), buffer.usedSlice()[1]);
}

test "ReusableBuffer: appendSlice" {
    var buffer = ReusableBuffer.init(std.testing.allocator);
    defer buffer.deinit();

    try buffer.appendSlice("hello");
    try std.testing.expectEqual(@as(usize, 5), buffer.length());
    try std.testing.expectEqualStrings("hello", buffer.usedSlice());

    try buffer.appendSlice(" world");
    try std.testing.expectEqual(@as(usize, 11), buffer.length());
    try std.testing.expectEqualStrings("hello world", buffer.usedSlice());
}

test "ReusableBuffer: resize grow" {
    var buffer = ReusableBuffer.init(std.testing.allocator);
    defer buffer.deinit();

    try buffer.appendSlice("test");
    try buffer.resize(10);

    try std.testing.expectEqual(@as(usize, 10), buffer.length());
    try std.testing.expectEqualStrings("test", buffer.usedSlice()[0..4]);
}

test "ReusableBuffer: resize shrink" {
    var buffer = ReusableBuffer.init(std.testing.allocator);
    defer buffer.deinit();

    try buffer.appendSlice("hello world");
    const old_capacity = buffer.capacity;

    try buffer.resize(5);

    try std.testing.expectEqual(@as(usize, 5), buffer.length());
    try std.testing.expectEqualStrings("hello", buffer.usedSlice());
    try std.testing.expectEqual(old_capacity, buffer.capacity); // Capacity should not change
}

test "ReusableBuffer: clearRetainingCapacity" {
    var buffer = ReusableBuffer.init(std.testing.allocator);
    defer buffer.deinit();

    try buffer.appendSlice("hello");
    const old_capacity = buffer.capacity;

    buffer.clearRetainingCapacity();

    try std.testing.expectEqual(@as(usize, 0), buffer.length());
    try std.testing.expectEqual(old_capacity, buffer.capacity);

    // Should be able to reuse without reallocation
    try buffer.appendSlice("world");
    try std.testing.expectEqualStrings("world", buffer.usedSlice());
}

test "ReusableBuffer: fromOwnedSlice" {
    const slice = try std.testing.allocator.alloc(u8, 5);
    @memcpy(slice, "hello");

    var buffer = ReusableBuffer.fromOwnedSlice(std.testing.allocator, slice);
    defer buffer.deinit();

    try std.testing.expectEqual(@as(usize, 5), buffer.length());
    try std.testing.expectEqualStrings("hello", buffer.usedSlice());
}

test "ReusableBuffer: clone" {
    var original = ReusableBuffer.init(std.testing.allocator);
    defer original.deinit();

    try original.appendSlice("test");

    var cloned = try original.clone();
    defer cloned.deinit();

    try std.testing.expectEqualStrings(original.usedSlice(), cloned.usedSlice());

    // Modify original, clone should be unaffected
    try original.append('!');
    try std.testing.expectEqual(@as(usize, 4), cloned.length());
    try std.testing.expectEqualStrings("test", cloned.usedSlice());
}

test "ReusableBuffer: toOwnedSlice" {
    var buffer = ReusableBuffer.init(std.testing.allocator);

    try buffer.appendSlice("owned");

    const slice = buffer.toOwnedSlice();
    defer std.testing.allocator.free(slice);

    try std.testing.expectEqualStrings("owned", slice);
    try std.testing.expectEqual(@as(usize, 0), buffer.length());
    try std.testing.expectEqual(@as(usize, 0), buffer.capacity);

    // Buffer should still be usable
    try buffer.appendSlice("new");
    try std.testing.expectEqualStrings("new", buffer.usedSlice());
    buffer.deinit();
}

test "ReusableBuffer: multiple operations" {
    var buffer = try ReusableBuffer.initCapacity(std.testing.allocator, 5);
    defer buffer.deinit();

    try buffer.append('a');
    try buffer.appendSlice("bc");
    try std.testing.expectEqualStrings("abc", buffer.usedSlice());

    buffer.clearRetainingCapacity();
    try buffer.appendSlice("xyz");
    try std.testing.expectEqualStrings("xyz", buffer.usedSlice());

    try buffer.resize(6);
    buffer.ptr[3] = '1';
    buffer.ptr[4] = '2';
    buffer.ptr[5] = '3';
    try std.testing.expectEqualStrings("xyz123", buffer.usedSlice());
}
