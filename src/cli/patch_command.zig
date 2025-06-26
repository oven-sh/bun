//! parse dependency of positional arg string (may include name@version for example)
//! get the precise version from the lockfile (there may be multiple)
//! copy the contents into a temp folder

pub const PatchCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        try updatePackageJSONAndInstallCatchError(ctx, .patch);
    }
};

// @sortImports

const bun = @import("bun");
const string = bun.string;
const Command = bun.CLI.Command;

const PackageManager = bun.install.PackageManager;
const updatePackageJSONAndInstallCatchError = PackageManager.updatePackageJSONAndInstallCatchError;
