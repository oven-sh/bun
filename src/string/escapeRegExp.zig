const special_characters = "|\\{}()[]^$+*?.-";

pub fn escapeRegExp(input: []const u8, writer: anytype) @TypeOf(writer).Error!void {
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
            => |c| try writer.writeByte(c),
            '-' => try writer.writeAll("\\x2d"),
            else => unreachable,
        }
        remain = remain[i + 1 ..];
    }

    try writer.writeAll(remain);
}

/// '*' becomes '.*' instead of '\\*'
pub fn escapeRegExpForPackageNameMatching(input: []const u8, writer: anytype) @TypeOf(writer).Error!void {
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
            => |c| try writer.writeByte(c),
            '*' => try writer.writeAll(".*"),
            '-' => try writer.writeAll("\\x2d"),
            else => unreachable,
        }
        remain = remain[i + 1 ..];
    }

    try writer.writeAll(remain);
}

const bun = @import("bun");
const strings = bun.strings;
const Environment = bun.Environment;
