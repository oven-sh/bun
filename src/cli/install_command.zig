pub const InstallCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        install(ctx) catch |err| switch (err) {
            error.InstallFailed,
            error.InvalidPackageJSON,
            => {
                const log = &bun.CLI.Cli.log_;
                log.print(bun.Output.errorWriter()) catch {};
                bun.Global.exit(1);
            },
            else => |e| return e,
        };
    }
};

fn deleteOldNodeModules(fd: bun.FileDescriptor) void {
    var dir = std.fs.Dir{ .fd = fd.cast() };
    var iter = dir.iterate();

    while (iter.next() catch null) |entry| {
        if (entry.kind == .directory and bun.strings.hasPrefixComptime(entry.name, ".node_modules_old_")) {
            fd.deleteTree(entry.name) catch {};
        }
    }
}

fn install(ctx: Command.Context) !void {
    var cli = try CommandLineArguments.parse(ctx.allocator, .install);

    // The way this works:
    // 1. Run the bundler on source files
    // 2. Rewrite positional arguments to act identically to the developer
    //    typing in the dependency names
    // 3. Run the install command
    if (cli.analyze) {
        const Analyzer = struct {
            ctx: Command.Context,
            cli: *CommandLineArguments,
            pub fn onAnalyze(this: *@This(), result: *bun.bundle_v2.BundleV2.DependenciesScanner.Result) anyerror!void {
                // TODO: add separate argument that makes it so positionals[1..] is not done     and instead the positionals are passed
                var positionals = bun.default_allocator.alloc(string, result.dependencies.keys().len + 1) catch bun.outOfMemory();
                positionals[0] = "install";
                bun.copy(string, positionals[1..], result.dependencies.keys());
                this.cli.positionals = positionals;

                try installWithCLI(this.ctx, this.cli.*);

                Global.exit(0);
            }
        };
        var analyzer = Analyzer{
            .ctx = ctx,
            .cli = &cli,
        };

        var fetcher = bun.bundle_v2.BundleV2.DependenciesScanner{
            .ctx = &analyzer,
            .entry_points = cli.positionals[1..],
            .onFetch = @ptrCast(&Analyzer.onAnalyze),
        };

        try bun.CLI.BuildCommand.exec(bun.CLI.Command.get(), &fetcher);
        return;
    }

    return installWithCLI(ctx, cli);
}

fn installWithCLI(ctx: Command.Context, cli: CommandLineArguments) !void {
    const subcommand: Subcommand = if (cli.positionals.len > 1) .add else .install;

    // TODO(dylan-conway): print `bun install <version>` or `bun add <version>` before logs from `init`.
    // and cleanup install/add subcommand usage
    var manager, const original_cwd = try PackageManager.init(ctx, cli, .install);

    if (cli.is_ci_command and subcommand == .install) {
        const timestamp = @as(u64, @intCast(std.time.milliTimestamp()));
        var temp_name_buf: [256]u8 = undefined;
        const temp_name = std.fmt.bufPrintZ(&temp_name_buf, ".node_modules_old_{d}", .{timestamp}) catch ".node_modules_old";

        _ = bun.sys.renameat(manager.root_dir.fd, "node_modules", manager.root_dir.fd, temp_name);

        const delete_thread = std.Thread.spawn(.{}, deleteOldNodeModules, .{manager.root_dir.fd}) catch null;
        if (delete_thread) |thread| {
            thread.detach();
        }
    }

    // switch to `bun add <package>`
    if (subcommand == .add) {
        manager.subcommand = .add;
        if (manager.options.shouldPrintCommandName()) {
            Output.prettyln("<r><b>bun add <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
            Output.flush();
        }
        return manager.updatePackageJSONAndInstallWithManager(ctx, original_cwd);
    }

    if (manager.options.shouldPrintCommandName()) {
        Output.prettyln("<r><b>bun install <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
        Output.flush();
    }

    const package_json_contents = manager.root_package_json_file.readToEndAlloc(ctx.allocator, std.math.maxInt(usize)) catch |err| {
        if (manager.options.log_level != .silent) {
            Output.prettyErrorln("<r><red>{s} reading package.json<r> :(", .{@errorName(err)});
            Output.flush();
        }
        return;
    };

    try manager.installWithManager(ctx, package_json_contents, original_cwd);

    if (manager.any_failed_to_install) {
        Global.exit(1);
    }
}

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const string = bun.string;
const Command = bun.CLI.Command;

const PackageManager = bun.install.PackageManager;
const CommandLineArguments = PackageManager.CommandLineArguments;
const Subcommand = PackageManager.Subcommand;
