pub const std = @import("std");
pub const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
pub const StaticExport = @import("./static_export.zig");
pub const c_char = StaticExport.c_char;
pub usingnamespace @import("../../../global.zig");

pub fn zigCast(comptime Destination: type, value: anytype) *Destination {
    return @ptrCast(*Destination, @alignCast(@alignOf(*Destination), value));
}
