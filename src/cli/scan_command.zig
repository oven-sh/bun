const std = @import("std");
const bun = @import("bun");
const Output = bun.Output;
const Global = bun.Global;
const strings = bun.strings;
const Command = @import("../cli.zig").Command;
const PackageManager = @import("../install/install.zig").PackageManager;
const security_scanner = @import("../install/PackageManager/security_scanner.zig");

pub const ScanCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .scan);

        const manager, const cwd = PackageManager.init(ctx, cli, .scan) catch |err| {
            if (err == error.MissingPackageJSON) {
                Output.errGeneric("No package.json found. 'bun pm scan' requires a lockfile to analyze dependencies.", .{});
                Output.note("Run \"bun install\" first to generate a lockfile", .{});
                Global.exit(1);
            }
            return err;
        };
        defer ctx.allocator.free(cwd);

        try execWithManager(ctx, manager);
    }

    pub fn execWithManager(ctx: Command.Context, manager: *PackageManager) !void {
        if (manager.options.security_scanner == null) {
            Output.prettyErrorln("<r><red>error<r>: no security scanner configured", .{});
            Output.prettyln("", .{});
            Output.prettyln("To use 'bun pm scan', configure a security scanner in bunfig.toml:", .{});
            Output.prettyln("  [install.security]", .{});
            Output.prettyln("  scanner = \"<cyan>package_name<r>\"", .{});
            Output.prettyln("", .{});
            Output.prettyln("Security scanners can be npm packages that export a scanner object.", .{});
            Global.exit(1);
            return; // sanity? lol
        }

        Output.prettyError(comptime Output.prettyFmt("<r><b>bun pm scan <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", true), .{});
        Output.flush();

        const load_lockfile = manager.lockfile.loadFromCwd(manager, ctx.allocator, ctx.log, true);
        if (load_lockfile == .not_found) {
            Output.errGeneric("Lockfile not found. Run 'bun install' first to generate a lockfile.", .{});
            Global.exit(1);
        }
        if (load_lockfile == .err) {
            Output.errGeneric("Error loading lockfile: {s}", .{@errorName(load_lockfile.err.value)});
            Global.exit(1);
        }

        try security_scanner.performSecurityScanForAll(manager);

        Global.exit(0);
    }
};
