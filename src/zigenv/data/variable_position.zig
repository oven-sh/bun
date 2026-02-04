const std = @import("std");
const testing = std.testing;

pub const VariablePosition = struct {
    variable_start: usize,
    start_brace: usize,
    dollar_sign: usize,
    end_brace: usize,
    variable_end: usize,
    variable_str: []const u8,
    default_value: []const u8,
    closed: bool,
    allocator: ?std.mem.Allocator,

    pub fn init(variable_start: usize, start_brace: usize, dollar_sign: usize) VariablePosition {
        return VariablePosition{
            .variable_start = variable_start,
            .start_brace = start_brace,
            .dollar_sign = dollar_sign,
            .end_brace = 0,
            .variable_end = 0,
            .variable_str = "",
            .default_value = "",
            .closed = false,
            .allocator = null,
        };
    }

    pub fn deinit(self: *VariablePosition) void {
        if (self.allocator) |allocator| {
            if (self.variable_str.len > 0) {
                allocator.free(self.variable_str);
            }
            if (self.default_value.len > 0) {
                allocator.free(self.default_value);
            }
        }
    }

    pub fn setVariableStr(self: *VariablePosition, allocator: std.mem.Allocator, str: []const u8) !void {
        // If we already allocated specifically for this struct (not just pointing to memory), free it
        if (self.allocator) |old_alloc| {
            if (self.variable_str.len > 0) {
                old_alloc.free(self.variable_str);
            }
        }

        self.variable_str = try allocator.dupe(u8, str);
        self.allocator = allocator;
    }

    pub fn setDefaultValue(self: *VariablePosition, allocator: std.mem.Allocator, str: []const u8) !void {
        if (self.allocator) |old_alloc| {
            if (self.default_value.len > 0) {
                old_alloc.free(self.default_value);
            }
        }

        self.default_value = try allocator.dupe(u8, str);
        self.allocator = allocator;
    }
};

test "VariablePosition initialization" {
    var pos = VariablePosition.init(0, 1, 2);
    // No allocator needed for init state if variable_str is empty string slice literal
    defer pos.deinit();

    try testing.expectEqual(@as(usize, 0), pos.variable_start);
    try testing.expectEqual(@as(usize, 1), pos.start_brace);
    try testing.expectEqual(@as(usize, 2), pos.dollar_sign);
    try testing.expectEqual(@as(usize, 0), pos.end_brace);
    try testing.expectEqual(false, pos.closed);
    try testing.expectEqualStrings("", pos.variable_str);
}

test "VariablePosition memory cleanup" {
    var pos = VariablePosition.init(10, 11, 12);
    defer pos.deinit();

    const test_str = "MY_VAR";
    try pos.setVariableStr(testing.allocator, test_str);

    try testing.expectEqualStrings(test_str, pos.variable_str);
    try testing.expect(pos.allocator != null);
}
