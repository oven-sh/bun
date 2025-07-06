const std = @import("std");
const WhyCommand = @import("./why_command.zig").WhyCommand;
const bun = @import("bun");
const Command = bun.CLI.Command;
const PackageManager = bun.install.PackageManager;
const string = bun.string;

pub const PmWhyCommand = struct {
    pub fn exec(ctx: Command.Context, pm: *PackageManager, positionals: []const string) !void {
        try WhyCommand.execFromPm(ctx, pm, positionals);
    }
};
