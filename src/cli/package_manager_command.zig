const Command = @import("../cli.zig").Command;
const PackageManager = @import("../install/install.zig").PackageManager;
const ComamndLineArguments = PackageManager.CommandLineArguments;
const std = @import("std");
const strings = @import("strings");
const Global = @import("../global.zig").Global;
const Output = @import("../global.zig").Output;
const Fs = @import("../fs.zig");
const Path = @import("../resolver/resolve_path.zig");

pub const PackageManagerCommand = struct {
    pub fn printHelp(_: std.mem.Allocator) void {}
    pub fn exec(ctx: Command.Context) !void {
        var args = try std.process.argsAlloc(ctx.allocator);
        args = args[1..];

        var pm = try PackageManager.init(ctx, null, &PackageManager.install_params);

        var first: []const u8 = if (pm.options.positionals.len > 0) pm.options.positionals[0] else "";
        if (strings.eqlComptime(first, "pm")) {
            if (pm.options.positionals.len > 1) {
                pm.options.positionals = pm.options.positionals[1..];
            } else {
                return;
            }
        }

        first = pm.options.positionals[0];

        if (pm.options.global) {
            try pm.setupGlobalDir(&ctx);
        }

        if (strings.eqlComptime(first, "bin")) {
            var output_path = Path.joinAbs(Fs.FileSystem.instance.top_level_dir, .auto, std.mem.span(pm.options.bin_path));
            Output.prettyln("{s}\n", .{output_path});
            if (pm.options.global) {
                warner: {
                    if (Output.enable_ansi_colors_stderr) {
                        if (std.os.getenvZ("PATH")) |path| {
                            var path_splitter = std.mem.split(u8, path, ":");
                            while (path_splitter.next()) |entry| {
                                if (strings.eql(entry, output_path)) {
                                    break :warner;
                                }
                            }

                            Output.prettyErrorln("\n<r><yellow>warn<r>: not in $PATH\n", .{});
                        }
                    }
                }
            }

            Output.flush();
            return;
        }
    }
};
