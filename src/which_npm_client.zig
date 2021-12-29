const _global = @import("./global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;

const std = @import("std");

pub const NPMClient = struct {
    bin: string,
    tag: Tag,

    pub const Tag = enum {
        bun,
    };

    pub fn detect(allocator: std.mem.Allocator, realpath_buf: *[std.fs.MAX_PATH_BYTES]u8, PATH: string, cwd: string, comptime allow_yarn: bool) !NPMClient {}
};
