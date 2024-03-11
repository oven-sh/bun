const std = @import("std");
const Progress = std.Progress;
const bun = @import("root").bun;
const Global = bun.Global;
const Output = bun.Output;
const string = bun.string;
const strings = bun.strings;
const log = bun.log;
const logger = bun.logger;
const Command = @import("../cli.zig").Command;
const Fs = @import("../fs.zig");
const Dependency = @import("../install/dependency.zig");
const Install = @import("../install/install.zig");
const PackageID = Install.PackageID;
const DependencyID = Install.DependencyID;
const PackageManager = Install.PackageManager;
const Lockfile = @import("../install/lockfile.zig");
const NodeModulesFolder = Lockfile.Tree.NodeModulesFolder;
const Path = @import("../resolver/resolve_path.zig");
const String = @import("../install/semver.zig").String;
const ArrayIdentityContext = bun.ArrayIdentityContext;
const DepIdSet = std.ArrayHashMapUnmanaged(DependencyID, void, ArrayIdentityContext, false);
const Environment = bun.Environment;

fn handleLoadLockfileErrors(load_lockfile: Lockfile.LoadFromDiskResult, pm: *PackageManager) void {
    if (load_lockfile == .not_found) {
        if (pm.options.log_level != .silent) {
            Output.errGeneric("Lockfile not found", .{});
        }
        Global.exit(1);
    }

    if (load_lockfile == .err) {
        if (pm.options.log_level != .silent) {
            Output.errGeneric("Error loading lockfile: {s}", .{@errorName(load_lockfile.err.value)});
        }
        Global.exit(1);
    }
}

const ByName = struct {
    dependencies: []const Dependency,
    buf: []const u8,

    pub fn isLessThan(ctx: ByName, lhs: DependencyID, rhs: DependencyID) bool {
        return strings.cmpStringsAsc(
            {},
            ctx.dependencies[lhs].name.slice(ctx.buf),
            ctx.dependencies[rhs].name.slice(ctx.buf),
        );
    }
};

pub const PackageManagerCommand = struct {
    pub fn printHash(ctx: Command.Context, lockfile_: []const u8) !void {
        @setCold(true);
        var lockfile_buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
        @memcpy(lockfile_buffer[0..lockfile_.len], lockfile_);
        lockfile_buffer[lockfile_.len] = 0;
        const lockfile = lockfile_buffer[0..lockfile_.len :0];
        var pm = try PackageManager.init(ctx, PackageManager.Subcommand.pm);

        const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, lockfile);
        handleLoadLockfileErrors(load_lockfile, pm);

        Output.flush();
        Output.disableBuffering();
        try Output.writer().print("{}", .{load_lockfile.ok.lockfile.fmtMetaHash()});
        Output.enableBuffering();
        Global.exit(0);
    }

    fn getSubcommand(args_ptr: *[]const string) []const u8 {
        var args = args_ptr.*;
        defer args_ptr.* = args;

        var subcommand: []const u8 = if (args.len > 0)
            args[0]
        else
            "";

        if (strings.eqlComptime(subcommand, "pm")) {
            subcommand = "";
            if (args.len > 1) {
                args = args[1..];
                return args[0];
            }
        }

        return subcommand;
    }

    pub fn printHelp() void {
        Output.prettyln(
            \\<b><blue>bun pm<r>: Package manager utilities
            \\
            \\  bun pm <b>bin<r>            print the path to bin folder
            \\  <d>└<r>  <cyan>-g<r> bin             print the <b>global<r> path to bin folder
            \\  bun pm <b>ls<r>             list the dependency tree according to the current lockfile
            \\  <d>└<r>  <cyan>--all<r>              list the entire dependency tree according to the current lockfile
            \\  bun pm <b>hash<r>           generate & print the hash of the current lockfile
            \\  bun pm <b>hash-string<r>    print the string used to hash the lockfile
            \\  bun pm <b>hash-print<r>     print the hash stored in the current lockfile
            \\  bun pm <b>cache<r>          print the path to the cache folder
            \\  bun pm <b>cache rm<r>       clear the cache
            \\  bun pm <b>migrate<r>        migrate another package manager's lockfile without installing anything
            \\  bun pm <b>trust(ed)<r>      print current trusted and untrusted dependencies with scripts
            \\  <d>├<r>  \<packages, ...\>    trust dependencies and run scripts
            \\  <d>├<r>  <cyan>--all<r>              trust all untrusted dependencies and run their scripts 
            \\  <d>└<r>  <cyan>--default<r>          print the list of default trusted dependencies
            \\
            \\Learn more about these at <magenta>https://bun.sh/docs/cli/pm<r>
            \\
        , .{});
    }

    pub fn exec(ctx: Command.Context) !void {
        var args = try std.process.argsAlloc(ctx.allocator);
        args = args[1..];

        var pm = PackageManager.init(ctx, PackageManager.Subcommand.pm) catch |err| {
            if (err == error.MissingPackageJSON) {
                var cwd_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                if (bun.getcwd(&cwd_buf)) |cwd| {
                    Output.errGeneric("No package.json was found for directory \"{s}\"", .{cwd});
                } else |_| {
                    Output.errGeneric("No package.json was found", .{});
                }
                Output.note("Run \"bun init\" to initialize a project", .{});
                Global.exit(1);
            }
            return err;
        };

        const subcommand = getSubcommand(&pm.options.positionals);
        if (pm.options.global) {
            try pm.setupGlobalDir(&ctx);
        }

        if (strings.eqlComptime(subcommand, "bin")) {
            const output_path = Path.joinAbs(Fs.FileSystem.instance.top_level_dir, .auto, bun.asByteSlice(pm.options.bin_path));
            Output.prettyln("{s}", .{output_path});
            if (Output.stdout_descriptor_type == .terminal) {
                Output.prettyln("\n", .{});
            }

            if (pm.options.global) {
                warner: {
                    if (Output.enable_ansi_colors_stderr) {
                        if (bun.getenvZ("PATH")) |path| {
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
        } else if (strings.eqlComptime(subcommand, "hash")) {
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            handleLoadLockfileErrors(load_lockfile, pm);

            _ = try pm.lockfile.hasMetaHashChanged(false, pm.lockfile.packages.len);

            Output.flush();
            Output.disableBuffering();
            try Output.writer().print("{}", .{load_lockfile.ok.lockfile.fmtMetaHash()});
            Output.enableBuffering();
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "hash-print")) {
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            handleLoadLockfileErrors(load_lockfile, pm);

            Output.flush();
            Output.disableBuffering();
            try Output.writer().print("{}", .{load_lockfile.ok.lockfile.fmtMetaHash()});
            Output.enableBuffering();
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "hash-string")) {
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            handleLoadLockfileErrors(load_lockfile, pm);

            _ = try pm.lockfile.hasMetaHashChanged(true, pm.lockfile.packages.len);
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "cache")) {
            var dir: [bun.MAX_PATH_BYTES]u8 = undefined;
            var fd = pm.getCacheDirectory();
            const outpath = bun.getFdPath(fd.fd, &dir) catch |err| {
                Output.prettyErrorln("{s} getting cache directory", .{@errorName(err)});
                Global.crash();
            };

            if (pm.options.positionals.len > 1 and strings.eqlComptime(pm.options.positionals[1], "rm")) {
                fd.close();

                var had_err = false;

                std.fs.deleteTreeAbsolute(outpath) catch |err| {
                    Output.err(err, "Could not delete {s}", .{outpath});
                    had_err = true;
                };
                Output.prettyln("Cleared 'bun install' cache", .{});

                bunx: {
                    const tmp = bun.fs.FileSystem.RealFS.platformTempDir();
                    const tmp_dir = std.fs.openDirAbsolute(tmp, .{ .iterate = true }) catch |err| {
                        Output.err(err, "Could not open {s}", .{tmp});
                        had_err = true;
                        break :bunx;
                    };
                    var iter = tmp_dir.iterate();

                    // This is to match 'bunx_command.BunxCommand.exec's logic
                    const prefix = try std.fmt.allocPrint(ctx.allocator, "bunx-{d}-", .{
                        if (bun.Environment.isPosix) bun.C.getuid() else bun.windows.userUniqueId(),
                    });

                    var deleted: usize = 0;
                    while (iter.next() catch |err| {
                        Output.err(err, "Could not read {s}", .{tmp});
                        had_err = true;
                        break :bunx;
                    }) |entry| {
                        if (std.mem.startsWith(u8, entry.name, prefix)) {
                            tmp_dir.deleteTree(entry.name) catch |err| {
                                Output.err(err, "Could not delete {s}", .{entry.name});
                                had_err = true;
                                continue;
                            };

                            deleted += 1;
                        }
                    }

                    Output.prettyln("Cleared {d} cached 'bunx' packages", .{deleted});
                }

                Global.exit(if (had_err) 1 else 0);
            }

            Output.writer().writeAll(outpath) catch {};
            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "trusted") or (strings.eqlComptime(subcommand, "trust"))) {

            // do this before loading lockfile because you don't need a lockfile
            // to see the default trusted dependencies
            if (strings.leftHasAnyInRight(args, &.{"--default"})) {
                Output.print("Default trusted dependencies ({d}):\n", .{Lockfile.default_trusted_dependencies_list.len});
                for (Lockfile.default_trusted_dependencies_list) |name| {
                    Output.pretty(" <d>-<r> {s}\n", .{name});
                }

                Global.exit(0);
            }

            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            handleLoadLockfileErrors(load_lockfile, pm);
            try pm.updateLockfileIfNeeded(load_lockfile);
            const buf = pm.lockfile.buffers.string_bytes.items;

            if (args.len == 2) {
                // no args, print information for trusted and untrusted dependencies with scripts.
                const packages = pm.lockfile.packages.slice();
                const metas: []Lockfile.Package.Meta = packages.items(.meta);
                const scripts: []Lockfile.Package.Scripts = packages.items(.scripts);
                const resolutions: []Install.Resolution = packages.items(.resolution);

                var trusted_set: std.AutoArrayHashMapUnmanaged(u64, String) = .{};
                var untrusted_dep_ids: std.AutoArrayHashMapUnmanaged(DependencyID, void) = .{};
                defer untrusted_dep_ids.deinit(ctx.allocator);

                // loop through all dependencies, print all the trusted packages, and collect
                // untrusted packages with lifecycle scripts
                for (pm.lockfile.buffers.dependencies.items, 0..) |dep, i| {
                    const dep_id: DependencyID = @intCast(i);
                    const package_id = pm.lockfile.buffers.resolutions.items[dep_id];
                    if (package_id == Install.invalid_package_id) continue;

                    // called alias because a dependency name is not always the package name
                    const alias = dep.name.slice(buf);

                    if (metas[package_id].hasInstallScript()) {
                        if (pm.lockfile.hasTrustedDependency(alias)) {
                            // can't put alias directly because it might be inline
                            try trusted_set.put(ctx.allocator, dep.name_hash, dep.name);
                        } else {
                            try untrusted_dep_ids.put(ctx.allocator, dep_id, {});
                        }
                    }
                }

                {
                    const Sorter = struct {
                        buf: string,
                        pub fn lessThan(this: @This(), rhs: String, lhs: String) bool {
                            return rhs.order(&lhs, this.buf, this.buf) == .lt;
                        }
                    };
                    const aliases = trusted_set.values();
                    std.sort.pdq(String, aliases, Sorter{ .buf = buf }, Sorter.lessThan);

                    Output.pretty("Trusted dependencies ({d}):\n", .{aliases.len});
                    for (aliases) |alias| {
                        Output.pretty(" <d>-<r> {s}\n", .{alias.slice(buf)});
                    } else {
                        Output.pretty("\n", .{});
                    }

                    trusted_set.deinit(ctx.allocator);
                }

                if (untrusted_dep_ids.count() == 0) {
                    Output.print("Untrusted dependencies (0):\n", .{});
                    Global.exit(0);
                }

                var untrusted_with_scripts: std.StringArrayHashMapUnmanaged(std.ArrayListUnmanaged(struct {
                    dep_id: DependencyID,
                    scripts_list: Lockfile.Package.Scripts.List,
                })) = .{};
                defer untrusted_with_scripts.deinit(ctx.allocator);

                var tree_iterator = Lockfile.Tree.Iterator.init(pm.lockfile);

                const top_level_without_trailing_slash = strings.withoutTrailingSlash(Fs.FileSystem.instance.top_level_dir);
                var abs_node_modules_path: std.ArrayListUnmanaged(u8) = .{};
                defer abs_node_modules_path.deinit(ctx.allocator);
                try abs_node_modules_path.appendSlice(ctx.allocator, top_level_without_trailing_slash);
                try abs_node_modules_path.append(ctx.allocator, std.fs.path.sep);

                while (tree_iterator.nextNodeModulesFolder(null)) |node_modules| {
                    // + 1 because we want to keep the path separator
                    abs_node_modules_path.items.len = top_level_without_trailing_slash.len + 1;
                    try abs_node_modules_path.appendSlice(ctx.allocator, node_modules.relative_path);

                    var node_modules_dir = bun.openDir(std.fs.cwd(), node_modules.relative_path) catch |err| {
                        if (err == error.ENOENT) continue;
                        return err;
                    };
                    defer node_modules_dir.close();

                    for (node_modules.dependencies) |dep_id| {
                        if (untrusted_dep_ids.contains(dep_id)) {
                            const dep = pm.lockfile.buffers.dependencies.items[dep_id];
                            const alias = dep.name.slice(buf);
                            const package_id = pm.lockfile.buffers.resolutions.items[dep_id];
                            const resolution = &resolutions[package_id];
                            var package_scripts = scripts[package_id];

                            if (try package_scripts.getList(
                                pm.log,
                                pm.lockfile,
                                node_modules_dir,
                                abs_node_modules_path.items,
                                alias,
                                resolution,
                            )) |scripts_list| {
                                if (scripts_list.items.len == 0) continue;
                                const key = try ctx.allocator.dupe(u8, alias);
                                const gop = try untrusted_with_scripts.getOrPut(ctx.allocator, key);
                                if (!gop.found_existing) {
                                    gop.value_ptr.* = .{};
                                } else {
                                    ctx.allocator.free(key);
                                }

                                try gop.value_ptr.append(ctx.allocator, .{ .dep_id = dep_id, .scripts_list = scripts_list });
                            }
                        }
                    }
                }

                if (untrusted_with_scripts.count() == 0) {
                    Output.print("Untrusted dependencies (0):\n", .{});
                    Global.exit(0);
                }

                const Sorter = struct {
                    pub fn lessThan(_: void, rhs: string, lhs: string) bool {
                        return std.mem.order(u8, rhs, lhs) == .lt;
                    }
                };

                const aliases = untrusted_with_scripts.keys();
                std.sort.pdq(string, aliases, {}, Sorter.lessThan);
                try untrusted_with_scripts.reIndex(ctx.allocator);

                Output.print("Untrusted dependencies ({d}):\n", .{aliases.len});

                for (aliases) |alias| {
                    const _entry = untrusted_with_scripts.get(alias);

                    if (comptime bun.Environment.allow_assert) {
                        std.debug.assert(_entry != null);
                    }

                    if (_entry) |entry| {
                        if (comptime bun.Environment.allow_assert) {
                            std.debug.assert(entry.items.len > 0);
                        }

                        Output.pretty(" <d>-<r> {s}\n", .{alias});
                    }
                }

                Global.exit(0);
            }

            // this isn't great, flags could be in this slice, but it works
            const packages_to_trust = args[2..];
            const trust_all = strings.leftHasAnyInRight(args, &.{ "-a", "--all" });

            const packages = pm.lockfile.packages.slice();
            const metas: []Lockfile.Package.Meta = packages.items(.meta);
            const resolutions: []Install.Resolution = packages.items(.resolution);
            const scripts: []Lockfile.Package.Scripts = packages.items(.scripts);

            var untrusted_dep_ids: DepIdSet = .{};
            defer untrusted_dep_ids.deinit(ctx.allocator);

            // .1 go through all installed dependencies and find untrusted ones with scripts
            //    from packages through cli, or all if --all.
            // .2 iterate through node_modules folder and spawn lifecycle scripts for each
            //    untrusted dependency from step 1.
            // .3 add the untrusted dependencies to package.json and lockfile.trusted_dependencies.

            for (pm.lockfile.buffers.dependencies.items, 0..) |dep, i| {
                const dep_id: u32 = @intCast(i);
                const package_id = pm.lockfile.buffers.resolutions.items[dep_id];
                if (package_id == Install.invalid_package_id) continue;

                const alias = dep.name.slice(buf);

                if (metas[package_id].hasInstallScript()) {
                    if (trust_all and !pm.lockfile.hasTrustedDependency(alias)) {
                        try untrusted_dep_ids.put(ctx.allocator, dep_id, {});
                        continue;
                    }

                    for (packages_to_trust) |package_name_from_cli| {
                        if (strings.eqlLong(package_name_from_cli, alias, true) and !pm.lockfile.hasTrustedDependency(alias)) {
                            try untrusted_dep_ids.put(ctx.allocator, dep_id, {});
                            continue;
                        }
                    }
                }
            }

            if (untrusted_dep_ids.count() == 0) Global.exit(0);

            // instead of running them right away, we group scripts by depth in the node_modules
            // file structure, then run in descending order. this ensures lifecycle scripts are run
            // in the correct order as they would during a normal install
            var tree_iter = Lockfile.Tree.Iterator.init(pm.lockfile);

            const top_level_without_trailing_slash = strings.withoutTrailingSlash(Fs.FileSystem.instance.top_level_dir);
            var abs_node_modules_path: std.ArrayListUnmanaged(u8) = .{};
            defer abs_node_modules_path.deinit(ctx.allocator);
            try abs_node_modules_path.appendSlice(ctx.allocator, top_level_without_trailing_slash);
            try abs_node_modules_path.append(ctx.allocator, std.fs.path.sep);

            var package_names_to_add: std.StringArrayHashMapUnmanaged(void) = .{};
            var scripts_at_depth: std.AutoArrayHashMapUnmanaged(usize, std.ArrayListUnmanaged(Lockfile.Package.Scripts.List)) = .{};
            defer {
                var iter = scripts_at_depth.iterator();
                while (iter.next()) |entry| {
                    for (entry.value_ptr.items) |item| {
                        item.deinit(ctx.allocator);
                    }
                    entry.value_ptr.deinit(ctx.allocator);
                }
                scripts_at_depth.deinit(ctx.allocator);
                package_names_to_add.deinit(ctx.allocator);
            }

            var scripts_count: usize = 0;

            while (tree_iter.nextNodeModulesFolder(null)) |node_modules| {
                abs_node_modules_path.items.len = top_level_without_trailing_slash.len + 1;
                try abs_node_modules_path.appendSlice(ctx.allocator, node_modules.relative_path);

                var node_modules_dir = bun.openDir(std.fs.cwd(), node_modules.relative_path) catch |err| {
                    if (err == error.ENOENT) continue;
                    return err;
                };
                defer node_modules_dir.close();

                for (node_modules.dependencies) |dep_id| {
                    if (untrusted_dep_ids.contains(dep_id)) {
                        const dep = pm.lockfile.buffers.dependencies.items[dep_id];
                        const alias = dep.name.slice(buf);
                        const package_id = pm.lockfile.buffers.resolutions.items[dep_id];
                        const resolution = &resolutions[package_id];
                        var package_scripts = scripts[package_id];

                        if (try package_scripts.getList(
                            pm.log,
                            pm.lockfile,
                            node_modules_dir,
                            abs_node_modules_path.items,
                            alias,
                            resolution,
                        )) |scripts_list| {
                            const entry = try scripts_at_depth.getOrPut(ctx.allocator, node_modules.depth);
                            if (!entry.found_existing) {
                                entry.value_ptr.* = .{};
                            }
                            scripts_count += scripts_list.total;
                            try entry.value_ptr.append(ctx.allocator, scripts_list);
                            try package_names_to_add.put(ctx.allocator, try ctx.allocator.dupe(u8, alias), {});
                        }
                    }
                }
            }

            if (scripts_at_depth.count() == 0) Global.exit(0);

            var root_node: *Progress.Node = undefined;
            var scripts_node: Progress.Node = undefined;
            var progress = &pm.progress;

            if (pm.options.log_level.showProgress()) {
                root_node = progress.start("", 0);
                progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;

                scripts_node = root_node.start(PackageManager.ProgressStrings.script(), scripts_count);
                pm.scripts_node = &scripts_node;
            }

            var depth = scripts_at_depth.count();
            while (depth > 0) {
                depth -= 1;
                const _entry = scripts_at_depth.get(depth);
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(_entry != null);
                }
                if (_entry) |entry| {
                    for (entry.items) |scripts_list| {
                        switch (pm.options.log_level) {
                            inline else => |log_level| try pm.spawnPackageLifecycleScripts(ctx, scripts_list, log_level),
                        }

                        if (pm.options.log_level.showProgress()) {
                            scripts_node.activate();
                            progress.refresh();
                        }
                    }

                    const loop = pm.event_loop.loop();
                    while (pm.pending_lifecycle_script_tasks.load(.Monotonic) > 0) {
                        loop.tick();
                    }
                }
            }

            if (pm.options.log_level.showProgress()) {
                progress.root.end();
                progress.* = .{};
            }

            const package_json_contents = try pm.root_package_json_file.readToEndAlloc(ctx.allocator, try pm.root_package_json_file.getEndPos());
            defer ctx.allocator.free(package_json_contents);

            const package_json_source = logger.Source.initPathString(PackageManager.package_json_cwd, package_json_contents);

            var package_json = bun.JSON.ParseJSONUTF8(&package_json_source, ctx.log, ctx.allocator) catch |err| {
                switch (Output.enable_ansi_colors) {
                    inline else => |enable_ansi_colors| ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), enable_ansi_colors) catch {},
                }

                if (err == error.ParserError and ctx.log.errors > 0) {
                    Output.prettyErrorln("<red>error<r>: Failed to parse package.json", .{});
                    Global.crash();
                }

                Output.panic("<r><red>{s}<r> parsing package.json<r>", .{
                    @errorName(err),
                });
            };

            // now add the package names to lockfile.trustedDependencies and package.json `trustedDependencies`
            const names_count = package_names_to_add.count();
            if (comptime Environment.allow_assert) {
                std.debug.assert(names_count > 0);
            }

            // could be null if these are the first packages to be trusted
            if (names_count > 0 and pm.lockfile.trusted_dependencies == null) pm.lockfile.trusted_dependencies = .{};

            const names = package_names_to_add.keys();

            try Install.PackageManager.PackageJSONEditor.editTrustedDependencies(ctx.allocator, &package_json, names);

            for (names) |name| {
                try pm.lockfile.trusted_dependencies.?.put(ctx.allocator, @truncate(String.Builder.stringHash(name)), {});
            }

            pm.lockfile.saveToDisk(pm.options.lockfile_path);

            var buffer_writer = try bun.js_printer.BufferWriter.init(ctx.allocator);
            try buffer_writer.buffer.list.ensureTotalCapacity(ctx.allocator, package_json_contents.len + 1);
            buffer_writer.append_newline = package_json_contents.len > 0 and package_json_contents[package_json_contents.len - 1] == '\n';
            var package_json_writer = bun.js_printer.BufferPrinter.init(buffer_writer);

            _ = bun.js_printer.printJSON(@TypeOf(&package_json_writer), &package_json_writer, package_json, &package_json_source) catch |err| {
                Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                Global.crash();
            };

            const new_package_json_contents = package_json_writer.ctx.writtenWithoutTrailingZero();

            try pm.root_package_json_file.pwriteAll(new_package_json_contents, 0);
            std.os.ftruncate(pm.root_package_json_file.handle, new_package_json_contents.len) catch {};
            pm.root_package_json_file.close();

            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "ls")) {
            const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
            handleLoadLockfileErrors(load_lockfile, pm);

            Output.flush();
            Output.disableBuffering();
            const lockfile = load_lockfile.ok.lockfile;
            var iterator = Lockfile.Tree.Iterator.init(lockfile);

            var max_depth: usize = 0;

            var directories = std.ArrayList(NodeModulesFolder).init(ctx.allocator);
            defer directories.deinit();
            while (iterator.nextNodeModulesFolder(null)) |node_modules| {
                const path_len = node_modules.relative_path.len;
                const path = try ctx.allocator.alloc(u8, path_len + 1);
                bun.copy(u8, path, node_modules.relative_path);
                path[path_len] = 0;

                const dependencies = try ctx.allocator.alloc(DependencyID, node_modules.dependencies.len);
                bun.copy(DependencyID, dependencies, node_modules.dependencies);

                if (max_depth < node_modules.depth + 1) max_depth = node_modules.depth + 1;

                try directories.append(.{
                    .relative_path = path[0..path_len :0],
                    .dependencies = dependencies,
                    .tree_id = node_modules.tree_id,
                    .depth = node_modules.depth,
                });
            }

            const first_directory = directories.orderedRemove(0);

            var more_packages = try ctx.allocator.alloc(bool, max_depth);
            @memset(more_packages, false);
            if (first_directory.dependencies.len > 1) more_packages[0] = true;

            if (strings.leftHasAnyInRight(args, &.{ "-A", "-a", "--all" })) {
                try printNodeModulesFolderStructure(&first_directory, null, 0, &directories, lockfile, more_packages);
            } else {
                var cwd_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const path = bun.getcwd(&cwd_buf) catch {
                    Output.prettyErrorln("<r><red>error<r>: Could not get current working directory", .{});
                    Global.exit(1);
                };
                const dependencies = lockfile.buffers.dependencies.items;
                const slice = lockfile.packages.slice();
                const resolutions = slice.items(.resolution);
                const root_deps = slice.items(.dependencies)[0];

                Output.println("{s} node_modules ({d})", .{ path, dependencies.len });
                const string_bytes = lockfile.buffers.string_bytes.items;
                const sorted_dependencies = try ctx.allocator.alloc(DependencyID, root_deps.len);
                defer ctx.allocator.free(sorted_dependencies);
                for (sorted_dependencies, 0..) |*dep, i| {
                    dep.* = @as(DependencyID, @truncate(root_deps.off + i));
                }
                std.sort.pdq(DependencyID, sorted_dependencies, ByName{
                    .dependencies = dependencies,
                    .buf = string_bytes,
                }, ByName.isLessThan);

                for (sorted_dependencies, 0..) |dependency_id, index| {
                    const package_id = lockfile.buffers.resolutions.items[dependency_id];
                    if (package_id >= lockfile.packages.len) continue;
                    const name = dependencies[dependency_id].name.slice(string_bytes);
                    const resolution = resolutions[package_id].fmt(string_bytes);

                    if (index < sorted_dependencies.len - 1) {
                        Output.prettyln("<d>├──<r> {s}<r><d>@{any}<r>\n", .{ name, resolution });
                    } else {
                        Output.prettyln("<d>└──<r> {s}<r><d>@{any}<r>\n", .{ name, resolution });
                    }
                }
            }

            Global.exit(0);
        } else if (strings.eqlComptime(subcommand, "migrate")) {
            if (!pm.options.enable.force_save_lockfile) try_load_bun: {
                std.fs.cwd().accessZ("bun.lockb", .{ .mode = .read_only }) catch break :try_load_bun;

                Output.prettyErrorln(
                    \\<r><red>error<r>: bun.lockb already exists
                    \\run with --force to overwrite
                , .{});
                Global.exit(1);
            }
            const load_lockfile = @import("../install/migration.zig").detectAndLoadOtherLockfile(
                pm.lockfile,
                ctx.allocator,
                pm.log,
                pm.options.lockfile_path,
            );
            if (load_lockfile == .not_found) {
                Output.prettyErrorln(
                    \\<r><red>error<r>: could not find any other lockfile
                , .{});
                Global.exit(1);
            }
            handleLoadLockfileErrors(load_lockfile, pm);
            const lockfile = load_lockfile.ok.lockfile;
            lockfile.saveToDisk(pm.options.lockfile_path);
            Global.exit(0);
        }

        printHelp();

        if (subcommand.len > 0) {
            Output.prettyErrorln("\n<red>error<r>: \"{s}\" unknown command\n", .{subcommand});
            Output.flush();

            Global.exit(1);
        } else {
            Global.exit(0);
        }
    }
};

fn printNodeModulesFolderStructure(
    directory: *const NodeModulesFolder,
    directory_package_id: ?PackageID,
    depth: usize,
    directories: *std.ArrayList(NodeModulesFolder),
    lockfile: *Lockfile,
    more_packages_: []bool,
) !void {
    const allocator = lockfile.allocator;
    var more_packages = more_packages_;
    const resolutions = lockfile.packages.items(.resolution);
    const string_bytes = lockfile.buffers.string_bytes.items;

    {
        var i: usize = 0;
        while (i < depth) : (i += 1) {
            if (i == depth - 1) {
                if (more_packages[i]) {
                    Output.pretty("<d>├──<r>", .{});
                } else {
                    Output.pretty("<d>└──<r>", .{});
                }
            } else {
                if (more_packages[i]) {
                    Output.pretty("<d>│<r>   ", .{});
                } else {
                    Output.pretty("    ", .{});
                }
            }
        }

        var resolution_buf: [512]u8 = undefined;
        if (directory_package_id) |id| {
            var path = directory.relative_path;

            if (depth != 0) {
                Output.pretty(" ", .{});
                var temp_depth = depth;
                while (temp_depth > 0) : (temp_depth -= 1) {
                    if (std.mem.indexOf(u8, path, "node_modules")) |j| {
                        path = path[j + "node_modules".len + 1 ..];
                    }
                }
            }
            const directory_version = try std.fmt.bufPrint(&resolution_buf, "{}", .{resolutions[id].fmt(string_bytes)});
            if (std.mem.indexOf(u8, path, "node_modules")) |j| {
                Output.prettyln("{s}<d>@{s}<r>", .{ path[0 .. j - 1], directory_version });
            } else {
                Output.prettyln("{s}<d>@{s}<r>", .{ path, directory_version });
            }
        } else {
            var cwd_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const path = bun.getcwd(&cwd_buf) catch {
                Output.prettyErrorln("<r><red>error<r>: Could not get current working directory", .{});
                Global.exit(1);
            };
            Output.println("{s} node_modules", .{path});
        }
    }

    const dependencies = lockfile.buffers.dependencies.items;
    const sorted_dependencies = try allocator.alloc(DependencyID, directory.dependencies.len);
    defer allocator.free(sorted_dependencies);
    bun.copy(DependencyID, sorted_dependencies, directory.dependencies);
    std.sort.pdq(DependencyID, sorted_dependencies, ByName{
        .dependencies = dependencies,
        .buf = string_bytes,
    }, ByName.isLessThan);

    for (sorted_dependencies, 0..) |dependency_id, index| {
        const package_name = dependencies[dependency_id].name.slice(string_bytes);
        const fmt = "{s}" ++ std.fs.path.sep_str ++ "{s}" ++ std.fs.path.sep_str ++ "node_modules";
        const possible_path = try std.fmt.allocPrint(allocator, fmt, .{ directory.relative_path, package_name });
        defer allocator.free(possible_path);

        if (index + 1 == sorted_dependencies.len) {
            more_packages[depth] = false;
        }

        const package_id = lockfile.buffers.resolutions.items[dependency_id];
        var dir_index: usize = 0;
        var found_node_modules = false;
        while (dir_index < directories.items.len) : (dir_index += 1) {
            // Recursively print node_modules. node_modules is removed from
            // the directories list before traversal.
            if (strings.eqlLong(possible_path, directories.items[dir_index].relative_path, true)) {
                found_node_modules = true;
                const next = directories.orderedRemove(dir_index);

                var new_depth: usize = 0;
                var temp_path = possible_path;
                while (std.mem.indexOf(u8, temp_path["node_modules".len..], "node_modules")) |j| {
                    new_depth += 1;
                    temp_path = temp_path[j + "node_modules".len ..];
                }

                more_packages[new_depth] = true;
                try printNodeModulesFolderStructure(&next, package_id, new_depth, directories, lockfile, more_packages);
            }
        }

        if (found_node_modules) continue;

        var i: usize = 0;
        while (i < depth) : (i += 1) {
            if (more_packages[i]) {
                Output.pretty("<d>│<r>   ", .{});
            } else {
                Output.pretty("    ", .{});
            }
        }

        if (more_packages[depth]) {
            Output.pretty("<d>├──<r> ", .{});
        } else {
            Output.pretty("<d>└──<r> ", .{});
        }

        var resolution_buf: [512]u8 = undefined;
        const package_version = try std.fmt.bufPrint(&resolution_buf, "{}", .{resolutions[package_id].fmt(string_bytes)});
        Output.prettyln("{s}<d>@{s}<r>", .{ package_name, package_version });
    }
}
