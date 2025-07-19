pub const AddCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        try updatePackageJSONAndInstallCatchError(ctx, .add);
    }
};

// @sortImports

const bun = @import("bun");
const Command = bun.CLI.Command;

const PackageManager = bun.install.PackageManager;
const updatePackageJSONAndInstallCatchError = PackageManager.updatePackageJSONAndInstallCatchError;
