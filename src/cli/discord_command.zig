const _global = @import("../global.zig");
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
const open = @import("../open.zig");

pub const DiscordCommand = struct {
    const discord_url: string = "https://bun.sh/discord";
    pub fn exec(_: std.mem.Allocator) !void {
        try open.openURL(discord_url);
    }
};
