pub const UpdateCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const cli = switch (try PackageManager.CommandLineArguments.parse(ctx.allocator, .update)) {
            .args => |a| a,
            .err => |f| bun.install.InstallResult.exitForCli(f),
        };

        if (cli.interactive) {
            const UpdateInteractiveCommand = @import("./update_interactive_command.zig").UpdateInteractiveCommand;
            try UpdateInteractiveCommand.exec(ctx);
        } else {
            (try updatePackageJSONAndInstallCatchError(ctx, .update)).handleCli();
        }
    }
};

const bun = @import("bun");
const Command = bun.cli.Command;

const PackageManager = bun.install.PackageManager;
const updatePackageJSONAndInstallCatchError = PackageManager.updatePackageJSONAndInstallCatchError;
