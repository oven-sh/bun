pub const RemoveCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        try updatePackageJSONAndInstallCatchError(ctx, .remove);
    }
};

// @sortImports

const bun = @import("bun");
const Command = bun.CLI.Command;

const PackageManager = bun.install.PackageManager;
const updatePackageJSONAndInstallCatchError = PackageManager.updatePackageJSONAndInstallCatchError;
