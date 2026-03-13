/// Returns whether the code point is alphanumeric: A-Z, a-z, or 0-9.
pub fn isAlphanumeric(c: u21) bool {
    return switch (c) {
        '0'...'9', 'A'...'Z', 'a'...'z' => true,
        else => false,
    };
}

/// Returns whether the code point is alphabetic: A-Z or a-z.
pub fn isAlphabetic(c: u21) bool {
    return switch (c) {
        'A'...'Z', 'a'...'z' => true,
        else => false,
    };
}

/// Returns whether the code point is a control character.
///
/// See also: `control_code`
pub fn isControl(c: u21) bool {
    return c <= std.ascii.control_code.us or c == std.ascii.control_code.del;
}

/// Returns whether the code point is a digit.
pub fn isDigit(c: u21) bool {
    return switch (c) {
        '0'...'9' => true,
        else => false,
    };
}

/// Returns whether the code point is a lowercase letter.
pub fn isLower(c: u21) bool {
    return switch (c) {
        'a'...'z' => true,
        else => false,
    };
}

/// Returns whether the code point is printable and has some graphical representation,
/// including the space code point.
pub fn isPrint(c: u21) bool {
    return isAscii(c) and !isControl(c);
}

/// Returns whether this code point is included in `whitespace`.
pub fn isWhitespace(c: u21) bool {
    return switch (c) {
        ' ', '\t'...'\r' => true,
        else => false,
    };
}

/// Returns whether the code point is an uppercase letter.
pub fn isUpper(c: u21) bool {
    return switch (c) {
        'A'...'Z' => true,
        else => false,
    };
}

/// Returns whether the code point is a hexadecimal digit: A-F, a-f, or 0-9.
pub fn isHex(c: u21) bool {
    return switch (c) {
        '0'...'9', 'A'...'F', 'a'...'f' => true,
        else => false,
    };
}

/// Returns whether the code point is a 7-bit ASCII character.
pub fn isAscii(c: u21) bool {
    return c < 128;
}

/// Uppercases the code point and returns it as-is if already uppercase or not a letter.
pub fn toUpper(c: u21) u21 {
    const mask = @as(u21, @intFromBool(isLower(c))) << 5;
    return c ^ mask;
}

/// Lowercases the code point and returns it as-is if already lowercase or not a letter.
pub fn toLower(c: u21) u21 {
    const mask = @as(u21, @intFromBool(isUpper(c))) << 5;
    return c | mask;
}

const std = @import("std");
