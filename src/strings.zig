const mutable = @import("string_mutable.zig");
const std = @import("std");

pub usingnamespace @import("string_types.zig");

pub const strings = @import("string_immutable.zig");

pub const MutableString = mutable.MutableString;

pub const eql = std.meta.eql;

pub fn nql(a: anytype, b: @TypeOf(a)) bool {
    return !eql(a, b);
}
