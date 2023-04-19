const bun = @import("root").bun;
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

pub const NPMClient = struct {
    bin: string,
    tag: Tag,

    pub const Tag = enum {
        bun,
    };
};
