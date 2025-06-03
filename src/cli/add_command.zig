const Command = @import("../cli.zig").Command;
const PackageManager = @import("../install/install.zig").PackageManager;

pub const AddCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        try PackageManager.add(ctx);
    }
};
