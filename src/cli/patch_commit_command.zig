const Command = @import("../cli.zig").Command;
const PackageManager = @import("../install/install.zig").PackageManager;
const bun = @import("root").bun;

pub const PatchCommitCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        try PackageManager.patchCommit(ctx);
    }
};
