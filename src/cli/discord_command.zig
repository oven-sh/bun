const bun = @import("bun");

const std = @import("std");
const open = @import("../open.zig");

pub const DiscordCommand = struct {
    const discord_url = "https://bun.sh/discord";
    pub fn exec(_: std.mem.Allocator) !void {
        open.openURL(discord_url);
    }
};
