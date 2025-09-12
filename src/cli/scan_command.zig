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

        try execWithManager(ctx, manager, cwd);
    }

    pub fn execWithManager(ctx: Command.Context, manager: *PackageManager, original_cwd: []const u8) !void {
        if (manager.options.security_scanner == null) {
            Output.prettyErrorln("<r><red>error<r>: no security scanner configured", .{});
            Output.pretty(
                \\
                \\To use 'bun pm scan', configure a security scanner in bunfig.toml:
                \\  [install.security]
                \\  scanner = "<cyan>package_name<r>"
                \\
                \\Security scanners can be npm packages that export a scanner object.
                \\
            , .{});
            Global.exit(1);
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

        const security_scan_results = security_scanner.performSecurityScanForAll(manager, ctx, original_cwd) catch |err| {
            Output.errGeneric("Could not perform security scan (<d>{s}<r>)", .{@errorName(err)});
            Global.exit(1);
        };

        if (security_scan_results) |results| {
            defer {
                var results_mut = results;
                results_mut.deinit();
            }

            security_scanner.printSecurityAdvisories(manager, &results);

            if (results.hasAdvisories()) {
                Global.exit(1);
            } else {
                Output.pretty("<green>No advisories found<r>\n", .{});
            }
        }

        Global.exit(0);
    }
};

const security_scanner = @import("../install/PackageManager/security_scanner.zig");
const Command = @import("../cli.zig").Command;
const PackageManager = @import("../install/install.zig").PackageManager;

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
