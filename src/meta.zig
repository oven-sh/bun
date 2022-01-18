const std = @import("std");

pub usingnamespace std.meta;

pub fn ReturnOf(comptime function: anytype) type {
    return ReturnOfType(@TypeOf(function));
}

pub fn ReturnOfType(comptime Type: type) type {
    const typeinfo: std.builtin.TypeInfo.Fn = @typeInfo(Type);
    return typeinfo.return_type orelse void;
}
