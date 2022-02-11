const Command = @import("../cli.zig").Command;
const PackageManager = @import("../install/install.zig").PackageManager;
const std = @import("std");
const strings = @import("strings");
const Global = @import("../global.zig").Global;
pub const PackageManagerCommand = struct {
    pub fn printHelp(_: std.mem.Allocator) void {}
    pub fn exec(ctx: Command.Context) !void {
        var args = try std.process.argsAlloc(ctx.allocator);
        args = args[1..];

        var first = std.mem.span(args[0]);
        if (strings.eqlComptime(first, "pm")) {
            args = args[1..];
        }

        if (args.len == 0) {
            printHelp(ctx.allocator);
            Global.exit(0);
        }

        first = std.mem.span(args[0]);
    }
};
