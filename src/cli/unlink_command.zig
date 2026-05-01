pub const UnlinkCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        try unlink(ctx);
    }
};

fn unlink(ctx: Command.Context) !void {
    const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .unlink);
    var manager, const original_cwd = PackageManager.init(ctx, cli, .unlink) catch |err| brk: {
        if (err == error.MissingPackageJSON) {
            try attemptToCreatePackageJSON();
            break :brk try PackageManager.init(ctx, cli, .unlink);
        }

        return err;
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
                Output.errGeneric("failed to read \"{s}\" for unlinking: {s}", .{ manager.original_package_json_path, @errorName(err) });
                Global.crash();
            });
            lockfile.initEmpty(ctx.allocator);

            var resolver: void = {};
            try package.parse(&lockfile, manager, ctx.allocator, manager.log, package_json_source, void, &resolver, Features.folder);
            name = lockfile.str(&package.name);
            if (name.len == 0) {
                if (manager.options.log_level != .silent) {
                    Output.prettyErrorln("<r><red>error:<r> package.json missing \"name\" <d>in \"{s}\"<r>", .{package_json_source.path.text});
                }
                Global.crash();
            } else if (!strings.isNPMPackageName(name)) {
                if (manager.options.log_level != .silent) {
                    Output.prettyErrorln("<r><red>error:<r> invalid package.json name \"{s}\" <d>in \"{s}\"<r>", .{
                        name,
                        package_json_source.path.text,
                    });
                }
                Global.crash();
            }
        }

        switch (Syscall.lstat(Path.joinAbsStringZ(manager.globalLinkDirPath(), &.{name}, .auto))) {
            .result => |stat| {
                if (!bun.S.ISLNK(@intCast(stat.mode))) {
                    Output.prettyErrorln("<r><green>success:<r> package \"{s}\" is not globally linked, so there's nothing to do.", .{name});
                    Global.exit(0);
                }
            },
            .err => {
                Output.prettyErrorln("<r><green>success:<r> package \"{s}\" is not globally linked, so there's nothing to do.", .{name});
                Global.exit(0);
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
                if (manager.options.log_level != .silent)
                    Output.prettyErrorln("<r><red>error:<r> failed to create node_modules in global dir due to error {s}", .{@errorName(err)});
                Global.crash();
            };
        };

        // Step 3b. Link any global bins
        if (package.bin.tag != .none) {
            var link_target_buf: bun.PathBuffer = undefined;
            var link_dest_buf: bun.PathBuffer = undefined;
            var link_rel_buf: bun.PathBuffer = undefined;

            var node_modules_path = bun.AbsPath(.{}).initFdPath(.fromStdDir(node_modules)) catch |err| {
                if (manager.options.log_level != .silent) {
                    Output.err(err, "failed to link binary", .{});
                }
                Global.crash();
            };
            defer node_modules_path.deinit();

            var bin_linker = Bin.Linker{
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
            if (manager.options.log_level != .silent)
                Output.prettyErrorln("<r><red>error:<r> failed to unlink package in global dir due to error {s}", .{@errorName(err)});
            Global.crash();
        };

        Output.prettyln("<r><green>success:<r> unlinked package \"{s}\"", .{name});
        Global.exit(0);
    } else {
        Output.prettyln("<r><red>error:<r> bun unlink {{packageName}} not implemented yet", .{});
        Global.crash();
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

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;

const PackageManager = bun.install.PackageManager;
const CommandLineArguments = PackageManager.CommandLineArguments;
const Options = PackageManager.Options;
const attemptToCreatePackageJSON = PackageManager.attemptToCreatePackageJSON;

const Syscall = bun.sys;
const File = bun.sys.File;
