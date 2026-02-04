const std = @import("std");
const EnvValue = @import("../data/env_value.zig").EnvValue;

/// Add a character to the value buffer, resizing if needed.
/// This implementation relies on ReusableBuffer inside EnvValue.
pub fn addToBuffer(value: *EnvValue, char: u8) !void {
    try value.buffer.append(char);
}

/// Check if the character 2 positions back is a backslash.
/// Used for detecting escaped { and } in variable interpolation.
pub fn isPreviousCharAnEscape(value: *const EnvValue) bool {
    // len is the position where the next character will be written.
    // So len - 1 is the last character written.
    // len - 2 is the character before that.
    const len = value.buffer.len;
    return len > 1 and value.buffer.ptr[len - 2] == '\\';
}

test "addToBuffer" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    try addToBuffer(&val, 'a');
    try addToBuffer(&val, 'b');
    try addToBuffer(&val, 'c');

    try std.testing.expectEqualStrings("abc", val.value());
    try std.testing.expectEqual(@as(usize, 3), val.buffer.len);
}

test "isPreviousCharAnEscape" {
    const allocator = std.testing.allocator;
    var val = EnvValue.init(allocator);
    defer val.deinit();

    try addToBuffer(&val, '\\');
    try addToBuffer(&val, '{');

    // len is 2. char at index 0 is \, char at index 1 is {.
    // isPreviousCharAnEscape checks index [2-2] = 0.
    try std.testing.expect(isPreviousCharAnEscape(&val));

    var val2 = EnvValue.init(allocator);
    defer val2.deinit();
    try addToBuffer(&val2, 'a');
    try addToBuffer(&val2, '{');
    try std.testing.expect(!isPreviousCharAnEscape(&val2));
}
