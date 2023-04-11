const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");
const open = @import("../open.zig");

pub const DocsCommand = struct {
    const docs_url: string = "https://bun.sh/docs";
    pub fn exec(_: std.mem.Allocator) !void {
        try open.openURL(docs_url);
    }
};
