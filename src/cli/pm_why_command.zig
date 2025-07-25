pub const PmWhyCommand = struct {
    pub fn exec(ctx: Command.Context, pm: *PackageManager, positionals: []const string) !void {
        try WhyCommand.execFromPm(ctx, pm, positionals);
    }
};

const string = []const u8;

const bun = @import("bun");
const WhyCommand = @import("./why_command.zig").WhyCommand;
const Command = bun.cli.Command;
const PackageManager = bun.install.PackageManager;
