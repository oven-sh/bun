const std = @import("std");
const expect = std.testing.expect;

usingnamespace @import("string_types.zig");

pub fn containsChar(self: string, char: u8) bool {
    return std.mem(char) != null;
}

pub fn indexOfChar(self: string, char: u8) ?usize {
    return std.mem.indexOfScalar(@TypeOf(char), self, char);
}

pub fn lastIndexOfChar(self: string, char: u8) ?usize {
    return std.mem.lastIndexOfScalar(u8, self, char);
}

pub fn lastIndexOf(self: string, str: u8) ?usize {
    return std.mem.lastIndexOf(u8, self, str);
}

pub fn indexOf(self: string, str: u8) ?usize {
    return std.mem.indexOf(u8, self, str);
}

pub fn eql(self: string, other: anytype) bool {
    return std.mem.eql(u8, self, other);
}
