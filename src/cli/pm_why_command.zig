pub const PmWhyCommand = struct {
    pub fn exec(ctx: Command.Context, pm: *PackageManager, positionals: []const string) !void {
        try WhyCommand.execFromPm(ctx, pm, positionals);
    }
};

const WhyCommand = @import("./why_command.zig").WhyCommand;

const bun = @import("bun");
const string = bun.string;
const Command = bun.CLI.Command;
const PackageManager = bun.install.PackageManager;
