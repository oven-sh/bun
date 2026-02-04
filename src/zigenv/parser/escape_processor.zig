const std = @import("std");
const EnvValue = @import("../data/env_value.zig").EnvValue;
const addToBuffer = @import("../buffer/buffer_utils.zig").addToBuffer;

/// Convert pairs of `\\` to single `\`, leave odd backslash for control char processing.
/// This processes the pending streak of backslashes.
pub fn walkBackSlashes(value: *EnvValue) !void {
    const total_backslash_pairs = value.back_slash_streak / 2;
    if (total_backslash_pairs > 0) {
        var i: usize = 0;
        while (i < total_backslash_pairs) : (i += 1) {
            try addToBuffer(value, '\\');
        }
        value.back_slash_streak -= total_backslash_pairs * 2;
    }
}

/// Convert escape sequences to actual control characters.
/// Returns true if the character was processed as a control character (or escaped char),
/// false otherwise.
/// If an unrecognized escape is found, it adds both the backslash and the character literally.
pub fn processPossibleControlCharacter(value: *EnvValue, char: u8) !bool {
    var process = false;
    switch (char) {
        't' => {
            try addToBuffer(value, '\t');
            process = true;
        },
        'n' => {
            try addToBuffer(value, '\n');
            process = true;
        },
        'r' => {
            try addToBuffer(value, '\r');
            process = true;
        },
        'b' => {
            try addToBuffer(value, 0x08); // \b Backspace
            process = true;
        },
        'f' => {
            try addToBuffer(value, 0x0C); // \f Form feed
            process = true;
        },
        'v' => {
            try addToBuffer(value, 0x0B); // \v Vertical tab
            process = true;
        },
        'a' => {
            try addToBuffer(value, 0x07); // \a Alert/Bell
            process = true;
        },
        '"' => {
            try addToBuffer(value, '"');
            process = true;
        },
        '\'' => {
            try addToBuffer(value, '\'');
            process = true;
        },
        '\\' => {
            try addToBuffer(value, '\\');
            process = true;
        },
        '$' => {
            try addToBuffer(value, '$');
            value.escaped_dollar_index = value.buffer.len - 1;
            process = true;
        },
        else => {
            // Not a recognized escape.
            process = false;
        },
    }
    value.back_slash_streak = 0;
    return process;
}

test "walkBackSlashes - paired backslashes" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    // 4 backslashes -> 2 output, 0 remainder
    val.back_slash_streak = 4;
    try walkBackSlashes(&val);
    try std.testing.expectEqualStrings("\\\\", val.value());
    try std.testing.expectEqual(@as(usize, 0), val.back_slash_streak);

    val.buffer.clearRetainingCapacity();
    val.back_slash_streak = 0;

    // 2 backslashes -> 1 output, 0 remainder
    val.back_slash_streak = 2;
    try walkBackSlashes(&val);
    try std.testing.expectEqualStrings("\\", val.value());
    try std.testing.expectEqual(@as(usize, 0), val.back_slash_streak);
}

test "walkBackSlashes - odd backslashes" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    // 3 backslashes -> 1 output, 1 remainder
    val.back_slash_streak = 3;
    try walkBackSlashes(&val);
    try std.testing.expectEqualStrings("\\", val.value());
    try std.testing.expectEqual(@as(usize, 1), val.back_slash_streak);

    val.buffer.clearRetainingCapacity();

    // 1 backslash -> 0 output, 1 remainder
    val.back_slash_streak = 1;
    try walkBackSlashes(&val);
    try std.testing.expectEqualStrings("", val.value());
    try std.testing.expectEqual(@as(usize, 1), val.back_slash_streak);
}

test "walkBackSlashes - zero backslashes" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    val.back_slash_streak = 0;
    try walkBackSlashes(&val);
    try std.testing.expectEqualStrings("", val.value());
    try std.testing.expectEqual(@as(usize, 0), val.back_slash_streak);
}

test "processPossibleControlCharacter - known escapes" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    _ = try processPossibleControlCharacter(&val, 'n');
    try std.testing.expectEqualStrings("\n", val.value());

    val.buffer.clearRetainingCapacity();
    _ = try processPossibleControlCharacter(&val, 't');
    try std.testing.expectEqualStrings("\t", val.value());

    val.buffer.clearRetainingCapacity();
    _ = try processPossibleControlCharacter(&val, 'r');
    try std.testing.expectEqualStrings("\r", val.value());

    val.buffer.clearRetainingCapacity();
    _ = try processPossibleControlCharacter(&val, 'b');
    try std.testing.expectEqualStrings("\x08", val.value());

    // Test quote escaping
    val.buffer.clearRetainingCapacity();
    _ = try processPossibleControlCharacter(&val, '"');
    try std.testing.expectEqualStrings("\"", val.value());
}

test "processPossibleControlCharacter - unknown escapes" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    // \z -> \z
    const processed = try processPossibleControlCharacter(&val, 'z');
    try std.testing.expect(!processed);
    try std.testing.expectEqualStrings("", val.value());
    try std.testing.expectEqual(@as(usize, 0), val.back_slash_streak);
}

test "full flow simulation" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    // Simulation of: "a\nb\\c"
    // 1. 'a' literal
    try addToBuffer(&val, 'a');

    // 2. '\' detected
    val.back_slash_streak = 1;

    // 3. 'n' detected
    // call walkBackSlashes (streak 1 -> 0 output, streak 1)
    try walkBackSlashes(&val);
    // process control char 'n' (streak 1 reset to 0)
    _ = try processPossibleControlCharacter(&val, 'n');

    // 4. 'b' literal
    try addToBuffer(&val, 'b');

    // 5. '\' detected
    val.back_slash_streak = 1;

    // 6. '\' detected
    val.back_slash_streak = 2;

    // 7. 'c' detected
    // call walkBackSlashes (streak 2 -> 1 output, streak 0)
    try walkBackSlashes(&val);
    // add 'c' literal
    try addToBuffer(&val, 'c');

    try std.testing.expectEqualStrings("a\nb\\c", val.value());
}
