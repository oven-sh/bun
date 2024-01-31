const std = @import("std");
const bun = @import("root").bun;
const builtin = @import("builtin");

comptime {
    std.debug.assert(builtin.target.os.tag == .windows);
}

pub fn dirname(str: []const u16) ?[]const u16 {
    const separator = lastIndexOfSeparatorWindows(str) orelse return null;
    return str[0..separator];
}

pub fn lastIndexOfSeparatorWindows(slice: []const u16) ?usize {
    return std.mem.lastIndexOfAny(u16, slice, std.unicode.utf8ToUtf16LeStringLiteral("\\/"));
}
