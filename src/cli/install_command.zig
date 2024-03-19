const Command = @import("../cli.zig").Command;
const bun = @import("root").bun;
const PackageManager = @import("../install/install.zig").PackageManager;

pub const InstallCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        PackageManager.install(ctx) catch |err| switch (err) {
            error.InstallFailed,
            error.InvalidPackageJSON,
            => {
                const log = &bun.CLI.Cli.log_;
                log.printForLogLevel(bun.Output.errorWriter()) catch {};
                bun.Global.exit(1);
            },
            else => |e| return e,
        };
    }
};
