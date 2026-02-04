const std = @import("std");
const VariablePosition = @import("variable_position.zig").VariablePosition;
const VariablePositionList = @import("variable_position_list.zig").VariablePositionList;
const ReusableBuffer = @import("../buffer/reusable_buffer.zig").ReusableBuffer;

pub const EnvValue = struct {
    interpolations: VariablePositionList,

    // Parsing state
    is_parsing_variable: bool,
    is_parsing_braceless_variable: bool,
    interpolation_index: usize,

    // Quote tracking flags
    quoted: bool,
    double_quoted: bool,
    backtick_quoted: bool,
    triple_quoted: bool,
    triple_double_quoted: bool,
    implicit_double_quote: bool,

    // Parsing streaks
    single_quote_streak: usize,
    double_quote_streak: usize,
    back_slash_streak: usize,

    // Interpolation state (for resolution)
    is_being_interpolated: bool,
    is_already_interpolated: bool,

    // Buffer management
    buffer: ReusableBuffer,
    escaped_dollar_index: ?usize,

    pub fn init(allocator: std.mem.Allocator) EnvValue {
        return EnvValue{
            .interpolations = VariablePositionList.init(allocator),

            .is_parsing_variable = false,
            .is_parsing_braceless_variable = false,
            .interpolation_index = 0,

            .quoted = false,
            .double_quoted = false,
            .backtick_quoted = false,
            .triple_quoted = false,
            .triple_double_quoted = false,
            .implicit_double_quote = false,

            .single_quote_streak = 0,
            .double_quote_streak = 0,
            .back_slash_streak = 0,

            .is_being_interpolated = false,
            .is_already_interpolated = false,

            .buffer = ReusableBuffer.init(allocator),
            .escaped_dollar_index = null,
        };
    }

    pub fn clear(self: *EnvValue) void {
        self.interpolations.clearRetainingCapacity();

        self.is_parsing_variable = false;
        self.is_parsing_braceless_variable = false;
        self.interpolation_index = 0;

        self.quoted = false;
        self.double_quoted = false;
        self.backtick_quoted = false;
        self.triple_quoted = false;
        self.triple_double_quoted = false;
        self.implicit_double_quote = false;

        self.single_quote_streak = 0;
        self.double_quote_streak = 0;
        self.back_slash_streak = 0;

        self.is_being_interpolated = false;
        self.is_already_interpolated = false;

        self.buffer.clearRetainingCapacity();
        self.escaped_dollar_index = null;
    }

    pub fn initCapacity(allocator: std.mem.Allocator, capacity: usize) !EnvValue {
        var val = init(allocator);
        val.buffer.deinit();
        val.buffer = try ReusableBuffer.initCapacity(allocator, capacity);
        return val;
    }

    pub fn deinit(self: *EnvValue) void {
        self.interpolations.deinit();
        self.buffer.deinit();
    }

    pub fn hasOwnBuffer(self: *const EnvValue) bool {
        return self.buffer.len > 0;
    }

    /// Access the value slice
    pub fn value(self: *const EnvValue) []const u8 {
        return self.buffer.usedSlice();
    }

    /// Takes ownership of the provided buffer.
    /// If there was already an owned buffer, it is freed.
    pub fn setOwnBuffer(self: *EnvValue, buffer: []u8) void {
        const allocator = self.buffer.allocator;
        self.buffer.deinit();
        self.buffer = ReusableBuffer.fromOwnedSlice(allocator, buffer);
    }

    /// Shrinks the owned buffer to the specified length.
    pub fn clipOwnBuffer(self: *EnvValue, length: usize) !void {
        try self.buffer.resize(length);
    }
};

test "EnvValue initialization" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    try std.testing.expectEqualStrings("", val.value());
    try std.testing.expect(val.interpolations.items.len == 0);
    try std.testing.expect(!val.quoted);
}

test "EnvValue initCapacity" {
    const allocator = std.testing.allocator;
    var val = try EnvValue.initCapacity(allocator, 256);
    defer val.deinit();

    try std.testing.expectEqual(@as(usize, 0), val.buffer.len);
    try std.testing.expect(val.buffer.capacity >= 256);
}

test "EnvValue buffer ownership" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    const buffer = try allocator.alloc(u8, 5);
    @memcpy(buffer, "value");

    val.setOwnBuffer(buffer);

    try std.testing.expect(val.hasOwnBuffer());
    try std.testing.expectEqualStrings("value", val.value());
}

test "EnvValue interpolations" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    try val.interpolations.append(VariablePosition.init(0, 0, 0));

    try std.testing.expect(val.interpolations.items.len == 1);
}
