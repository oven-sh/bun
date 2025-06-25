// parse dependency of positional arg string (may include name@version for example)
// get the precise version from the lockfile (there may be multiple)
// copy the contents into a temp folder
pub fn patch(ctx: Command.Context) !void {
    try updatePackageJSONAndInstallCatchError(ctx, .patch);
}

pub fn patchCommit(ctx: Command.Context) !void {
    try updatePackageJSONAndInstallCatchError(ctx, .@"patch-commit");
}

pub fn update(ctx: Command.Context) !void {
    try updatePackageJSONAndInstallCatchError(ctx, .update);
}

pub fn add(ctx: Command.Context) !void {
    try updatePackageJSONAndInstallCatchError(ctx, .add);
}

pub fn remove(ctx: Command.Context) !void {
    try updatePackageJSONAndInstallCatchError(ctx, .remove);
}

pub fn link(ctx: Command.Context) !void {
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
                    Output.prettyErrorln("<r><red>error:<r> invalid package.json name \"{s}\" <d>in \"{any}\"<r>", .{
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
                const global_path = try manager.globalLinkDirPath();
                const dest_path = Path.joinAbsStringZ(global_path, &.{name}, .windows);
                switch (bun.sys.sys_uv.symlinkUV(
                    link_path,
                    dest_path,
                    bun.windows.libuv.UV_FS_SYMLINK_JUNCTION,
                )) {
                    .err => |err| {
                        Output.prettyErrorln("<r><red>error:<r> failed to create junction to node_modules in global dir due to error {}", .{err});
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
            var node_modules_path_buf: bun.PathBuffer = undefined;
            var bin_linker = Bin.Linker{
                .bin = package.bin,
                .node_modules = .fromStdDir(node_modules),
                .node_modules_path = bun.getFdPath(.fromStdDir(node_modules), &node_modules_path_buf) catch |err| {
                    if (manager.options.log_level != .silent) {
                        Output.err(err, "failed to link binary", .{});
                    }
                    Global.crash();
                },
                .global_bin_path = manager.options.bin_path,

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

pub fn unlink(ctx: Command.Context) !void {
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

        switch (Syscall.lstat(Path.joinAbsStringZ(try manager.globalLinkDirPath(), &.{name}, .auto))) {
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
            var node_modules_path_buf: bun.PathBuffer = undefined;

            var bin_linker = Bin.Linker{
                .bin = package.bin,
                .node_modules = .fromStdDir(node_modules),
                .node_modules_path = bun.getFdPath(.fromStdDir(node_modules), &node_modules_path_buf) catch |err| {
                    if (manager.options.log_level != .silent) {
                        Output.err(err, "failed to link binary", .{});
                    }
                    Global.crash();
                },
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

pub fn install(ctx: Command.Context) !void {
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

pub fn installWithCLI(ctx: Command.Context, cli: CommandLineArguments) !void {
    const subcommand: Subcommand = if (cli.positionals.len > 1) .add else .install;

    // TODO(dylan-conway): print `bun install <version>` or `bun add <version>` before logs from `init`.
    // and cleanup install/add subcommand usage
    var manager, const original_cwd = try PackageManager.init(ctx, cli, .install);

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

// Corresponds to possible commands from the CLI.
pub const Subcommand = enum {
    install,
    update,
    pm,
    add,
    remove,
    link,
    unlink,
    patch,
    @"patch-commit",
    outdated,
    pack,
    publish,
    audit,
    info,

    // bin,
    // hash,
    // @"hash-print",
    // @"hash-string",
    // cache,
    // @"default-trusted",
    // untrusted,
    // trust,
    // ls,
    // migrate,

    pub fn canGloballyInstallPackages(this: Subcommand) bool {
        return switch (this) {
            .install, .update, .add => true,
            else => false,
        };
    }

    pub fn supportsWorkspaceFiltering(this: Subcommand) bool {
        return switch (this) {
            .outdated => true,
            .install => true,
            // .pack => true,
            // .add => true,
            else => false,
        };
    }

    pub fn supportsJsonOutput(this: Subcommand) bool {
        return switch (this) {
            .audit,
            .pm,
            .info,
            => true,
            else => false,
        };
    }

    // TODO: make all subcommands find root and chdir
    pub fn shouldChdirToRoot(this: Subcommand) bool {
        return switch (this) {
            .link => false,
            else => true,
        };
    }
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const JSON = bun.JSON;
const Output = bun.Output;
const Path = bun.path;
const default_allocator = bun.default_allocator;
const string = bun.string;
const strings = bun.strings;
const Command = bun.CLI.Command;

const Semver = bun.Semver;
const String = Semver.String;

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
const updatePackageJSONAndInstallCatchError = PackageManager.updatePackageJSONAndInstallCatchError;

const Syscall = bun.sys;
const File = bun.sys.File;
