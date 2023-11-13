const Command = @import("../cli.zig").Command;
const bun = @import("root").bun;
const PackageManager = @import("../install/install.zig").PackageManager;

pub const InstallCommand = struct {
    pub fn exec(ctx: *Command.Context) !void {
        if (bun.FeatureFlags.disable_on_windows_due_to_bugs and !bun.Environment.allow_assert) {
            bun.Output.prettyErrorln("install is not supported on Windows yet, sorry!!", .{});
            bun.Global.exit(1);
        }

        try PackageManager.install(ctx);
    }
};
