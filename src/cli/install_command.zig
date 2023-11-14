const Command = @import("../cli.zig").Command;
const bun = @import("root").bun;
const PackageManager = @import("../install/install.zig").PackageManager;

pub const InstallCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        try PackageManager.install(ctx);
    }
};
