const std = @import("std");
const EnvValue = @import("../data/env_value.zig").EnvValue;
const buffer_utils = @import("../buffer/buffer_utils.zig");

/// Detect and process single quote sequences.
/// Returns true if end quotes detected and input should stop.
pub fn walkSingleQuotes(value: *EnvValue) !bool {
    if (value.single_quote_streak == 0) return false;

    var stop = false;

    // At start of value?
    // We're at start if:
    // 1. buffer.len is 0 (quotes not added yet) OR buffer.len == single_quote_streak (only quotes in buffer)
    // 2. AND we're not already in a quote mode (otherwise we're ending, not starting)
    const at_start = ((value.buffer.len == 0) or (value.buffer.len == value.single_quote_streak)) and (!value.quoted and !value.triple_quoted);

    if (at_start) {
        if (value.single_quote_streak == 1) {
            value.quoted = true;
        } else if (value.single_quote_streak == 2) {
            value.quoted = true;
            stop = true; // Empty value
        } else if (value.single_quote_streak >= 3) {
            value.triple_quoted = true;
            // Add excess quotes to buffer
            var i: usize = 3;
            while (i < value.single_quote_streak) : (i += 1) {
                try buffer_utils.addToBuffer(value, '\'');
            }
        }
    } else {
        // During parsing
        if (value.quoted and value.single_quote_streak > 0) {
            stop = true; // End of single quoted value
        } else if (value.triple_quoted and value.single_quote_streak >= 3) {
            // Add excess quotes
            var i: usize = 3;
            while (i < value.single_quote_streak) : (i += 1) {
                try buffer_utils.addToBuffer(value, '\'');
            }
            stop = true; // End of heredoc
        }
    }

    value.single_quote_streak = 0;
    return stop;
}

/// Detect and process double quote sequences.
/// Returns true if end quotes detected and input should stop.
pub fn walkDoubleQuotes(value: *EnvValue) !bool {
    if (value.double_quote_streak == 0) return false;

    var stop = false;

    // At start of value?
    // We're at start if:
    // 1. buffer.len is 0 (quotes not added yet) OR buffer.len == double_quote_streak (only quotes in buffer)
    // 2. AND we're not already in a double quote mode (otherwise we're ending, not starting)
    const at_start = ((value.buffer.len == 0) or (value.buffer.len == value.double_quote_streak)) and (!value.double_quoted and !value.triple_double_quoted);

    if (at_start) {
        if (value.double_quote_streak == 1) {
            value.double_quoted = true;
        } else if (value.double_quote_streak == 2) {
            value.double_quoted = true;
            stop = true; // Empty value
        } else if (value.double_quote_streak >= 3) {
            value.triple_double_quoted = true;
            // Add excess quotes to buffer
            var i: usize = 3;
            while (i < value.double_quote_streak) : (i += 1) {
                try buffer_utils.addToBuffer(value, '"');
            }
        }
    } else {
        // During parsing
        if (value.double_quoted and value.double_quote_streak > 0) {
            stop = true; // End of double quoted value
        } else if (value.triple_double_quoted and value.double_quote_streak >= 3) {
            // Add excess quotes
            var i: usize = 3;
            while (i < value.double_quote_streak) : (i += 1) {
                try buffer_utils.addToBuffer(value, '"');
            }
            stop = true; // End of heredoc
        }
    }

    value.double_quote_streak = 0;
    return stop;
}

test "walkSingleQuotes - basic" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    // Initial parsing
    val.single_quote_streak = 1;
    _ = try walkSingleQuotes(&val);
    try std.testing.expect(val.quoted);
    try std.testing.expect(!val.triple_quoted);

    // Simulate content 'val'
    try buffer_utils.addToBuffer(&val, 'v');

    // End parsing
    val.single_quote_streak = 1;
    const stop = try walkSingleQuotes(&val);
    try std.testing.expect(stop);
}

test "walkSingleQuotes - empty" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    val.single_quote_streak = 2;
    const stop = try walkSingleQuotes(&val);
    try std.testing.expect(val.quoted);
    try std.testing.expect(stop);
}

test "walkSingleQuotes - heredoc" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    val.single_quote_streak = 3;
    _ = try walkSingleQuotes(&val);
    try std.testing.expect(val.triple_quoted);

    // Simulate content
    try buffer_utils.addToBuffer(&val, 'c');

    val.single_quote_streak = 3;
    const stop = try walkSingleQuotes(&val);
    try std.testing.expect(stop);
}

test "walkSingleQuotes - excess quotes start" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    val.single_quote_streak = 5; // ''' + ''
    _ = try walkSingleQuotes(&val);
    try std.testing.expect(val.triple_quoted);
    try std.testing.expectEqualStrings("''", val.value());
}

test "walkSingleQuotes - excess quotes end" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    val.single_quote_streak = 3;
    _ = try walkSingleQuotes(&val);

    try buffer_utils.addToBuffer(&val, 'a');

    val.single_quote_streak = 5; // ''' + ''
    const stop = try walkSingleQuotes(&val);
    try std.testing.expect(stop);
    try std.testing.expectEqualStrings("a''", val.value());
}

test "walkDoubleQuotes - basic" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    val.double_quote_streak = 1;
    _ = try walkDoubleQuotes(&val);
    try std.testing.expect(val.double_quoted);

    // Simulate content
    try buffer_utils.addToBuffer(&val, 'v');

    val.double_quote_streak = 1;
    const stop = try walkDoubleQuotes(&val);
    try std.testing.expect(stop);
}

test "walkDoubleQuotes - single quotes inside" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    val.double_quote_streak = 1;
    _ = try walkDoubleQuotes(&val);

    // Simulate finding single quotes inside
    try buffer_utils.addToBuffer(&val, '\'');

    try std.testing.expect(val.double_quoted);

    val.double_quote_streak = 1;
    const stop = try walkDoubleQuotes(&val);
    try std.testing.expect(stop);
}

test "walkSingleQuotes - double quotes inside" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    val.single_quote_streak = 1;
    _ = try walkSingleQuotes(&val);

    // Simulate finding double quotes inside
    try buffer_utils.addToBuffer(&val, '"');

    try std.testing.expect(val.quoted);

    val.single_quote_streak = 1;
    const stop = try walkSingleQuotes(&val);
    try std.testing.expect(stop);
}

test "walkDoubleQuotes - empty" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    val.double_quote_streak = 2;
    const stop = try walkDoubleQuotes(&val);
    try std.testing.expect(val.double_quoted);
    try std.testing.expect(stop);
}

test "walkDoubleQuotes - heredoc" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    val.double_quote_streak = 3;
    _ = try walkDoubleQuotes(&val);
    try std.testing.expect(val.triple_double_quoted);

    try buffer_utils.addToBuffer(&val, 'x');

    val.double_quote_streak = 3;
    const stop = try walkDoubleQuotes(&val);
    try std.testing.expect(stop);
}

test "walkDoubleQuotes - excess" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    val.double_quote_streak = 4;
    _ = try walkDoubleQuotes(&val);
    try std.testing.expect(val.triple_double_quoted);
    try std.testing.expectEqualStrings("\"", val.value());

    val.double_quote_streak = 4;
    const stop = try walkDoubleQuotes(&val);
    try std.testing.expect(stop);
    try std.testing.expectEqualStrings("\"\"", val.value());
}
