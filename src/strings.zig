const std = @import("std");
pub fn indexOfChar(contents: []u8, char: u8) callconv(.Inline) ?usize {
    return std.mem.indexOfScalar(u8, contents, char);
}

pub fn lastIndexOfChar(contents: []u8, char: u8) callconv(.Inline) ?usize {
    return std.mem.lastIndexOfScalar(u8, contents, char);
}
