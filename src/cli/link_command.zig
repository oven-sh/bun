pub const LinkCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        try link(ctx);
    }
};

fn link(ctx: Command.Context) !void {
    const cli = try CommandLineArguments.parse(ctx.allocator, .link);
    var manager, const original_cwd = PackageManager.init(ctx, cli, .link) catch |err| brk: {
        if (err == error.MissingPackageJSON) {
            try attemptToCreatePackageJSON();
            break :brk try PackageManager.init(ctx, cli, .link);
        }

        return err;
    };
    defer ctx.allocator.free(original_cwd);

    if (manager.options.shouldPrintCommandName()) {
        Output.prettyln("<r><b>bun link <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
        Output.flush();
    }

    if (manager.options.positionals.len == 1) {
        // bun link

        var lockfile: Lockfile = undefined;
        var name: string = "";
        var package = Lockfile.Package{};

        // Step 1. parse the nearest package.json file
        {
            const package_json_source = &(bun.sys.File.toSource(manager.original_package_json_path, ctx.allocator, .{}).unwrap() catch |err| {
                Output.errGeneric("failed to read \"{s}\" for linking: {s}", .{ manager.original_package_json_path, @errorName(err) });
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

        // Step 3a. symlink to the node_modules folder
        {
            // delete it if it exists
            node_modules.deleteTree(name) catch {};

            // create scope if specified
            if (name[0] == '@') {
                if (strings.indexOfChar(name, '/')) |i| {
                    node_modules.makeDir(name[0..i]) catch |err| brk: {
                        if (err == error.PathAlreadyExists) break :brk;
                        if (manager.options.log_level != .silent)
                            Output.prettyErrorln("<r><red>error:<r> failed to create scope in global dir due to error {s}", .{@errorName(err)});
                        Global.crash();
                    };
                }
            }

            if (comptime Environment.isWindows) {
                // create the junction
                const top_level = Fs.FileSystem.instance.topLevelDirWithoutTrailingSlash();
                var link_path_buf: bun.PathBuffer = undefined;
                @memcpy(
                    link_path_buf[0..top_level.len],
                    top_level,
                );
                link_path_buf[top_level.len] = 0;
                const link_path = link_path_buf[0..top_level.len :0];
                const global_path = manager.globalLinkDirPath();
                const dest_path = Path.joinAbsStringZ(global_path, &.{name}, .windows);
                switch (bun.sys.sys_uv.symlinkUV(
                    link_path,
                    dest_path,
                    bun.windows.libuv.UV_FS_SYMLINK_JUNCTION,
                )) {
                    .err => |err| {
                        Output.prettyErrorln("<r><red>error:<r> failed to create junction to node_modules in global dir due to error {f}", .{err});
                        Global.crash();
                    },
                    .result => {},
                }
            } else {
                // create the symlink
                node_modules.symLink(Fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(), name, .{ .is_directory = true }) catch |err| {
                    if (manager.options.log_level != .silent)
                        Output.prettyErrorln("<r><red>error:<r> failed to create symlink to node_modules in global dir due to error {s}", .{@errorName(err)});
                    Global.crash();
                };
            }
        }

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
                .bin = package.bin,
                .node_modules_path = &node_modules_path,
                .global_bin_path = manager.options.bin_path,
                .target_node_modules_path = &node_modules_path,
                .target_package_name = strings.StringOrTinyString.init(name),

                // .destination_dir_subpath = destination_dir_subpath,
                .package_name = strings.StringOrTinyString.init(name),
                .string_buf = lockfile.buffers.string_bytes.items,
                .extern_string_buf = lockfile.buffers.extern_strings.items,
                .seen = null,
                .abs_target_buf = &link_target_buf,
                .abs_dest_buf = &link_dest_buf,
                .rel_buf = &link_rel_buf,
            };
            bin_linker.link(true);

            if (bin_linker.err) |err| {
                if (manager.options.log_level != .silent)
                    Output.prettyErrorln("<r><red>error:<r> failed to link bin due to error {s}", .{@errorName(err)});
                Global.crash();
            }
        }

        Output.flush();

        // Done
        if (manager.options.log_level != .silent)
            Output.prettyln(
                \\<r><green>Success!<r> Registered "{[name]s}"
                \\
                \\To use {[name]s} in a project, run:
                \\  <cyan>bun link {[name]s}<r>
                \\
                \\Or add it in dependencies in your package.json file:
                \\  <cyan>"{[name]s}": "link:{[name]s}"<r>
                \\
            ,
                .{
                    .name = name,
                },
            );

        Output.flush();
        Global.exit(0);
    } else {
        // bun link lodash
        try manager.updatePackageJSONAndInstallWithManager(ctx, original_cwd);
    }
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const Path = bun.path;
const strings = bun.strings;
const Command = bun.cli.Command;
const File = bun.sys.File;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const Bin = bun.install.Bin;
const Features = bun.install.Features;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;

const PackageManager = bun.install.PackageManager;
const CommandLineArguments = PackageManager.CommandLineArguments;
const Options = PackageManager.Options;
const attemptToCreatePackageJSON = PackageManager.attemptToCreatePackageJSON;
