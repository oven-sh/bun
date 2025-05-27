const Command = @import("../cli.zig").Command;
const PackageManager = @import("../install/install.zig").PackageManager;

pub const PatchCommitCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        try PackageManager.patchCommit(ctx);
    }
};
