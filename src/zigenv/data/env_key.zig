const std = @import("std");
const ReusableBuffer = @import("../buffer/reusable_buffer.zig").ReusableBuffer;

pub const EnvKey = struct {
    // Buffer management
    buffer: ReusableBuffer,

    pub fn init(allocator: std.mem.Allocator) EnvKey {
        return EnvKey{
            .buffer = ReusableBuffer.init(allocator),
        };
    }

    pub fn clear(self: *EnvKey) void {
        self.buffer.clearRetainingCapacity();
    }

    pub fn initCapacity(allocator: std.mem.Allocator, capacity: usize) !EnvKey {
        return EnvKey{
            .buffer = try ReusableBuffer.initCapacity(allocator, capacity),
        };
    }

    pub fn deinit(self: *EnvKey) void {
        self.buffer.deinit();
    }

    pub fn hasOwnBuffer(self: *const EnvKey) bool {
        return self.buffer.len > 0;
    }

    /// Access the key slice
    pub fn key(self: *const EnvKey) []const u8 {
        return self.buffer.usedSlice();
    }

    /// Takes ownership of the provided buffer.
    /// If there was already an owned buffer, it is freed.
    pub fn setOwnBuffer(self: *EnvKey, buffer: []u8) void {
        const allocator = self.buffer.allocator;
        self.buffer.deinit();
        self.buffer = ReusableBuffer.fromOwnedSlice(allocator, buffer);
    }

    /// Shrinks the owned buffer to the specified length.
    pub fn clipOwnBuffer(self: *EnvKey, length: usize) !void {
        try self.buffer.resize(length);
    }
};

test "EnvKey initialization" {
    const allocator = std.testing.allocator;
    var key = EnvKey.init(allocator);
    defer key.deinit();

    try std.testing.expectEqualStrings("", key.key());
    try std.testing.expect(key.buffer.len == 0);
}

test "EnvKey initCapacity" {
    const allocator = std.testing.allocator;
    var key = try EnvKey.initCapacity(allocator, 100);
    defer key.deinit();

    try std.testing.expectEqual(@as(usize, 0), key.buffer.len);
    try std.testing.expect(key.buffer.capacity >= 100);
}

test "EnvKey buffer ownership" {
    const allocator = std.testing.allocator;
    var key = EnvKey.init(allocator);
    defer key.deinit();

    const buffer = try allocator.alloc(u8, 5);
    @memcpy(buffer, "hello");

    key.setOwnBuffer(buffer);

    try std.testing.expect(key.hasOwnBuffer());
    try std.testing.expectEqualStrings("hello", key.key());
}

test "EnvKey clip buffer" {
    const allocator = std.testing.allocator;
    var key = EnvKey.init(allocator);
    defer key.deinit();

    const buffer = try allocator.alloc(u8, 10);
    @memcpy(buffer, "helloworld");
    key.setOwnBuffer(buffer);

    try key.clipOwnBuffer(5);

    try std.testing.expectEqualStrings("hello", key.key());
    try std.testing.expectEqual(@as(usize, 5), key.buffer.len);
}
