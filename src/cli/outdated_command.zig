const std = @import("std");
const bun = @import("root").bun;
const Command = bun.CLI.Command;
const PackageManager = bun.install.PackageManager;

pub const OutdatedCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        try PackageManager.outdated(ctx);
    }
};
