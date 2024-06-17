const bun = @import("root").bun;
const Command = @import("../cli.zig").Command;
const PackageManager = @import("../install/install.zig").PackageManager;

pub const PatchCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        if (!bun.FeatureFlags.is_patch_cmd_enabled) {
            bun.Output.prettyErrorln("bun patch is not available in this version of bun. Stay tuned.", .{});
            bun.Global.exit(1);
        }

        try PackageManager.patch(ctx);
    }
};
