const Command = @import("../cli.zig").Command;
const PackageManager = @import("../install/install.zig").PackageManager;
const bun = @import("root").bun;

pub const AddCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        PackageManager.add(ctx) catch |err| switch (err) {
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
