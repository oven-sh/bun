const special_characters = "|\\{}()[]^$+*?.-";

pub fn escapeRegExp(input: []const u8, writer: *std.Io.Writer) std.Io.Writer.Error!void {
    var remain = input;

    while (strings.indexOfAny(remain, special_characters)) |i| {
        try writer.writeAll(remain[0..i]);
        switch (remain[i]) {
            '|',
            '\\',
            '{',
            '}',
            '(',
            ')',
            '[',
            ']',
            '^',
            '$',
            '+',
            '*',
            '?',
            '.',
            => |c| try writer.writeAll(&.{ '\\', c }),
            '-' => try writer.writeAll("\\x2d"),
            else => |c| {
                if (comptime Environment.isDebug) {
                    unreachable;
                }
                try writer.writeByte(c);
            },
        }
        remain = remain[i + 1 ..];
    }

    try writer.writeAll(remain);
}

/// '*' becomes '.*' instead of '\\*'
pub fn escapeRegExpForPackageNameMatching(input: []const u8, writer: *std.Io.Writer) std.Io.Writer.Error!void {
    var remain = input;

    while (strings.indexOfAny(remain, special_characters)) |i| {
        try writer.writeAll(remain[0..i]);
        switch (remain[i]) {
            '|',
            '\\',
            '{',
            '}',
            '(',
            ')',
            '[',
            ']',
            '^',
            '$',
            '+',
            '?',
            '.',
            => |c| try writer.writeAll(&.{ '\\', c }),
            '*' => try writer.writeAll(".*"),
            '-' => try writer.writeAll("\\x2d"),
            else => |c| {
                if (comptime Environment.isDebug) {
                    unreachable;
                }
                try writer.writeByte(c);
            },
        }
        remain = remain[i + 1 ..];
    }

    try writer.writeAll(remain);
}

pub const jsEscapeRegExp = @import("../jsc/bun_string_jsc.zig").jsEscapeRegExp;
pub const jsEscapeRegExpForPackageNameMatching = @import("../jsc/bun_string_jsc.zig").jsEscapeRegExpForPackageNameMatching;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const strings = bun.strings;
