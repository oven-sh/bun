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
const open = @import("../open.zig");

pub const DiscordCommand = struct {
    const discord_url = "https://bun.sh/discord";
    pub fn exec(_: std.mem.Allocator) !void {
        open.openURL(discord_url);
    }
};
