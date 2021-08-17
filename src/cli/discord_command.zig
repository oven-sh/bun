usingnamespace @import("../global.zig");
const std = @import("std");
const open = @import("../open.zig");

pub const DiscordCommand = struct {
    const discord_url: string = "https://bun.sh/discord";
    pub fn exec(allocator: *std.mem.Allocator) !void {
        try open.openURL(discord_url);
    }
};
