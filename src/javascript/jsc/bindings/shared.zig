pub const std = @import("std");
pub const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
pub const StaticExport = @import("./static_export.zig");
pub const c_char = StaticExport.c_char;
const _global = @import("../../../global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;

pub fn zigCast(comptime Destination: type, value: anytype) *Destination {
    return @ptrCast(*Destination, @alignCast(@alignOf(*Destination), value));
}
