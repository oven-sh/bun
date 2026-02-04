const std = @import("std");
const EnvKey = @import("env_key.zig").EnvKey;
const EnvValue = @import("env_value.zig").EnvValue;

pub const EnvPair = struct {
    key: EnvKey,
    value: EnvValue,

    pub fn init(allocator: std.mem.Allocator) EnvPair {
        return EnvPair{
            .key = EnvKey.init(allocator),
            .value = EnvValue.init(allocator),
        };
    }

    pub fn initWithCapacity(allocator: std.mem.Allocator, key_capacity: usize, value_capacity: usize) !EnvPair {
        return EnvPair{
            .key = try EnvKey.initCapacity(allocator, key_capacity),
            .value = try EnvValue.initCapacity(allocator, value_capacity),
        };
    }

    pub fn clear(self: *EnvPair) void {
        self.key.clear();
        self.value.clear();
    }

    pub fn deinit(self: *EnvPair) void {
        self.key.deinit();
        self.value.deinit();
    }
};

test "EnvPair initialization and lifecycle" {
    const allocator = std.testing.allocator;
    var pair = EnvPair.init(allocator);
    defer pair.deinit();

    // Verify key init
    try std.testing.expectEqualStrings("", pair.key.key());

    // Verify value init
    try std.testing.expectEqualStrings("", pair.value.value());

    // Modify and check cleanup
    const kbuf = try allocator.alloc(u8, 3);
    @memcpy(kbuf, "key");
    pair.key.setOwnBuffer(kbuf);

    const vbuf = try allocator.alloc(u8, 5);
    @memcpy(vbuf, "value");
    pair.value.setOwnBuffer(vbuf);

    try std.testing.expectEqualStrings("key", pair.key.key());
    try std.testing.expectEqualStrings("value", pair.value.value());
}

test "EnvPair initWithCapacity" {
    const allocator = std.testing.allocator;
    var pair = try EnvPair.initWithCapacity(allocator, 50, 150);
    defer pair.deinit();

    try std.testing.expect(pair.key.buffer.capacity >= 50);
    try std.testing.expect(pair.value.buffer.capacity >= 150);
}
