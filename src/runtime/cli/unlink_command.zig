pub const UnlinkCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        (try unlink(ctx)).handleCli();
    }
};

fn unlink(ctx: Command.Context) !InstallResult {
    const cli = switch (try PackageManager.CommandLineArguments.parse(ctx.allocator, .unlink)) {
        .args => |a| a,
        .err => |f| return .{ .err = f },
    };
    const init_result = PackageManager.init(ctx, cli, .unlink) catch |err| brk: {
        if (err == error.MissingPackageJSON) {
            try attemptToCreatePackageJSON();
            break :brk try PackageManager.init(ctx, cli, .unlink);
        }

        return err;
    };
    var manager, const original_cwd = switch (init_result) {
        .ok => |r| r,
        .err => |f| return .{ .err = f },
    };
    defer ctx.allocator.free(original_cwd);

    if (manager.options.shouldPrintCommandName()) {
        Output.prettyln("<r><b>bun unlink <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
        Output.flush();
    }

    if (manager.options.positionals.len == 1) {
        // bun unlink

        var lockfile: Lockfile = undefined;
        var name: string = "";
        var package = Lockfile.Package{};

        // Step 1. parse the nearest package.json file
        {
            const package_json_source = &(bun.sys.File.toSource(manager.original_package_json_path, ctx.allocator, .{}).unwrap() catch |err| {
                return InstallResult.fromError(.{ .link_read_package_json = .{
                    .path = bun.handleOom(manager.allocator.dupe(u8, manager.original_package_json_path)),
                    .err = err,
                    .action = .unlinking,
                } });
            });
            lockfile.initEmpty(ctx.allocator);

            var resolver: void = {};
            try package.parse(&lockfile, manager, ctx.allocator, manager.log, package_json_source, void, &resolver, Features.folder);
            name = lockfile.str(&package.name);
            if (name.len == 0) {
                return InstallResult.fromError(.{ .package_json_missing_name = .{
                    .path = bun.handleOom(manager.allocator.dupe(u8, package_json_source.path.text)),
                    .silent = manager.options.log_level == .silent,
                } });
            } else if (!strings.isNPMPackageName(name)) {
                return InstallResult.fromError(.{ .package_json_invalid_name = .{
                    .name = bun.handleOom(manager.allocator.dupe(u8, name)),
                    .path = bun.handleOom(manager.allocator.dupe(u8, package_json_source.path.text)),
                    .silent = manager.options.log_level == .silent,
                } });
            }
        }

        switch (Syscall.lstat(Path.joinAbsStringZ(manager.globalLinkDirPath() catch return manager.takeResult(), &.{name}, .auto))) {
            .result => |stat| {
                if (!bun.S.ISLNK(@intCast(stat.mode))) {
                    Output.prettyErrorln("<r><green>success:<r> package \"{s}\" is not globally linked, so there's nothing to do.", .{name});
                    return .ok;
                }
            },
            .err => {
                Output.prettyErrorln("<r><green>success:<r> package \"{s}\" is not globally linked, so there's nothing to do.", .{name});
                return .ok;
            },
        }

        // Step 2. Setup the global directory
        var node_modules: std.fs.Dir = brk: {
            Bin.Linker.ensureUmask();
            var explicit_global_dir: string = "";
            if (ctx.install) |install_| {
                explicit_global_dir = install_.global_dir orelse explicit_global_dir;
            }
            manager.global_dir = try Options.openGlobalDir(explicit_global_dir);

            try manager.setupGlobalDir(ctx);

            break :brk manager.global_dir.?.makeOpenPath("node_modules", .{}) catch |err| {
                return InstallResult.fromError(.{ .global_node_modules_create = .{
                    .err = err,
                    .silent = manager.options.log_level == .silent,
                } });
            };
        };

        // Step 3b. Link any global bins
        if (package.bin.tag != .none) {
            var link_target_buf: bun.PathBuffer = undefined;
            var link_dest_buf: bun.PathBuffer = undefined;
            var link_rel_buf: bun.PathBuffer = undefined;

            var node_modules_path = bun.AbsPath(.{}).initFdPath(.fromStdDir(node_modules)) catch |err| {
                return InstallResult.fromError(.{ .link_binary_fdpath = .{
                    .err = err,
                    .silent = manager.options.log_level == .silent,
                } });
            };
            defer node_modules_path.deinit();

            var bin_linker = Bin.Linker{
                .allocator = manager.allocator,
                .target_node_modules_path = &node_modules_path,
                .target_package_name = strings.StringOrTinyString.init(name),
                .bin = package.bin,
                .node_modules_path = &node_modules_path,
                .global_bin_path = manager.options.bin_path,
                .package_name = strings.StringOrTinyString.init(name),
                .string_buf = lockfile.buffers.string_bytes.items,
                .extern_string_buf = lockfile.buffers.extern_strings.items,
                .seen = null,
                .abs_target_buf = &link_target_buf,
                .abs_dest_buf = &link_dest_buf,
                .rel_buf = &link_rel_buf,
            };
            bin_linker.unlink(true);
        }

        // delete it if it exists
        node_modules.deleteTree(name) catch |err| {
            return InstallResult.fromError(.{ .unlink_delete = .{
                .err = err,
                .silent = manager.options.log_level == .silent,
            } });
        };

        Output.prettyln("<r><green>success:<r> unlinked package \"{s}\"", .{name});
        return .ok;
    } else {
        return InstallResult.fromError(.unlink_with_name_not_implemented);
    }
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const Path = bun.path;
const strings = bun.strings;
const Command = bun.cli.Command;

const Bin = bun.install.Bin;
const Features = bun.install.Features;
const InstallResult = bun.install.InstallResult;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;

const PackageManager = bun.install.PackageManager;
const CommandLineArguments = PackageManager.CommandLineArguments;
const Options = PackageManager.Options;
const attemptToCreatePackageJSON = PackageManager.attemptToCreatePackageJSON;

const Syscall = bun.sys;
const File = bun.sys.File;
