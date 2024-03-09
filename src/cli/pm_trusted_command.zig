const std = @import("std");
const Progress = std.Progress;
const bun = @import("root").bun;
const logger = bun.logger;
const Environment = bun.Environment;
const Command = @import("../cli.zig").Command;
const Install = @import("../install/install.zig");
const PackageID = Install.PackageID;
const String = @import("../install/semver.zig").String;
const PackageManager = Install.PackageManager;
const PackageManagerCommand = @import("./package_manager_command.zig").PackageManagerCommand;
const Lockfile = Install.Lockfile;
const Fs = @import("../fs.zig");
const Global = bun.Global;
const DependencyID = Install.DependencyID;
const ArrayIdentityContext = bun.ArrayIdentityContext;
const DepIdSet = std.ArrayHashMapUnmanaged(DependencyID, void, ArrayIdentityContext, false);
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;

pub const TrustedCommand = struct {
    const Sorter = struct {
        pub fn lessThan(_: void, rhs: string, lhs: string) bool {
            return std.mem.order(u8, rhs, lhs) == .lt;
        }
    };

    const StringSorter = struct {
        buf: string,
        pub fn lessThan(this: @This(), rhs: String, lhs: String) bool {
            return rhs.order(&lhs, this.buf, this.buf) == .lt;
        }
    };

    pub fn exec(ctx: Command.Context, pm: *PackageManager, args: [][:0]u8) !void {
        // Do this before loading lockfile. You don't need a lockfile
        // to see the default trusted dependencies
        if (strings.leftHasAnyInRight(args, &.{"--default"})) {
            Output.print("Default trusted dependencies ({d}):\n", .{Lockfile.default_trusted_dependencies_list.len});
            for (Lockfile.default_trusted_dependencies_list) |name| {
                Output.pretty(" <d>-<r> {s}\n", .{name});
            }

            return;
        }

        const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
        PackageManagerCommand.handleLoadLockfileErrors(load_lockfile, pm);
        try pm.updateLockfileIfNeeded(load_lockfile);

        if (args.len == 2) return trustedNoArgs(ctx, pm);

        var packages_to_trust: std.ArrayListUnmanaged(string) = .{};
        defer packages_to_trust.deinit(ctx.allocator);
        try packages_to_trust.ensureUnusedCapacity(ctx.allocator, args[2..].len);
        for (args[2..]) |arg| {
            if (strings.isNPMPackageName(arg)) packages_to_trust.appendAssumeCapacity(arg);
        }
        const trust_all = strings.leftHasAnyInRight(args, &.{ "-a", "--all" });

        const buf = pm.lockfile.buffers.string_bytes.items;
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

                for (packages_to_trust.items) |package_name_from_cli| {
                    if (strings.eqlLong(package_name_from_cli, alias, true) and !pm.lockfile.hasTrustedDependency(alias)) {
                        try untrusted_dep_ids.put(ctx.allocator, dep_id, {});
                        continue;
                    }
                }
            }
        }

        if (untrusted_dep_ids.count() == 0) {
            if (trust_all) {
                Output.errGeneric("No scripts ran. This means your dependencies are already trusted and/or non have scripts.", .{});
            } else {
                Output.errGeneric("No scripts ran. The following packages are already trusted and/or don't have scripts to run:\n", .{});
                for (packages_to_trust.items) |arg| {
                    Output.prettyError(" <d>-<r> {s}\n", .{arg});
                }
            }
            Global.crash();
        }

        // Instead of running them right away, we group scripts by depth in the node_modules
        // file structure, then run them starting at max depth. This ensures lifecycle scripts are run
        // in the correct order as they would during a normal install
        var tree_iter = Lockfile.Tree.Iterator.init(pm.lockfile);

        const top_level_without_trailing_slash = strings.withoutTrailingSlash(Fs.FileSystem.instance.top_level_dir);
        var abs_node_modules_path: std.ArrayListUnmanaged(u8) = .{};
        defer abs_node_modules_path.deinit(ctx.allocator);
        try abs_node_modules_path.appendSlice(ctx.allocator, top_level_without_trailing_slash);
        try abs_node_modules_path.append(ctx.allocator, std.fs.path.sep);

        var package_names_to_add: std.StringArrayHashMapUnmanaged(void) = .{};
        var scripts_at_depth: std.AutoArrayHashMapUnmanaged(usize, std.ArrayListUnmanaged(struct {
            package_id: PackageID,
            scripts_list: Lockfile.Package.Scripts.List,
        })) = .{};

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
                    if (comptime Environment.allow_assert) {
                        std.debug.assert(package_id != Install.invalid_package_id);
                    }
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
                        if (!entry.found_existing) entry.value_ptr.* = .{};
                        try entry.value_ptr.append(ctx.allocator, .{
                            .package_id = package_id,
                            .scripts_list = scripts_list,
                        });
                        try package_names_to_add.put(ctx.allocator, try ctx.allocator.dupe(u8, alias), {});
                        scripts_count += scripts_list.total;
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
                for (entry.items) |info| {
                    switch (pm.options.log_level) {
                        inline else => |log_level| try pm.spawnPackageLifecycleScripts(ctx, info.scripts_list, log_level),
                    }

                    if (pm.options.log_level.showProgress()) {
                        scripts_node.activate();
                        progress.refresh();
                    }
                }

                while (pm.pending_lifecycle_script_tasks.load(.Monotonic) > 0) {
                    pm.uws_event_loop.tick();
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

            Output.errGeneric("failed to parse package.json: {s}", .{@errorName(err)});
            Global.crash();
        };

        // now add the package names to lockfile.trustedDependencies and package.json `trustedDependencies`
        const names = package_names_to_add.keys();
        if (comptime Environment.allow_assert) {
            std.debug.assert(names.len > 0);
        }

        // could be null if these are the first packages to be trusted
        if (pm.lockfile.trusted_dependencies == null) pm.lockfile.trusted_dependencies = .{};

        var total_scripts_ran: usize = 0;
        depth = scripts_at_depth.count();
        while (depth > 0) {
            depth -= 1;
            if (scripts_at_depth.get(depth)) |entry| {
                for (entry.items) |info| {
                    const resolution = pm.lockfile.packages.items(.resolution)[info.package_id];
                    if (std.mem.indexOf(u8, info.scripts_list.cwd, std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str)) |i| {
                        Output.pretty("<d>./{s}@{}<r>\n", .{
                            strings.withoutTrailingSlash(info.scripts_list.cwd[i + 1 ..]),
                            resolution.fmt(buf),
                        });
                    } else {
                        Output.pretty("<d>{s}@{}<r>\n", .{
                            strings.withoutTrailingSlash(info.scripts_list.cwd),
                            resolution.fmt(buf),
                        });
                    }
                    for (info.scripts_list.items, 0..) |maybe_script, script_index| {
                        if (maybe_script) |script| {
                            Output.pretty("  <green>✓<r> [{s}]: <cyan>{s}<r>\n", .{ Lockfile.Scripts.names[script_index], script.script });
                            total_scripts_ran += 1;
                        }
                    }
                    Output.print("\n", .{});
                }
            }
        }

        Output.pretty("  <green>{d}<r> scripts ran\n", .{total_scripts_ran});

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
            Output.errGeneric("failed to print package.json: {s}", .{@errorName(err)});
            Global.crash();
        };

        const new_package_json_contents = package_json_writer.ctx.writtenWithoutTrailingZero();

        try pm.root_package_json_file.pwriteAll(new_package_json_contents, 0);
        std.os.ftruncate(pm.root_package_json_file.handle, new_package_json_contents.len) catch {};
        pm.root_package_json_file.close();
    }

    /// print information for trusted and untrusted dependencies with scripts.
    pub fn trustedNoArgs(ctx: Command.Context, pm: *PackageManager) !void {
        const packages = pm.lockfile.packages.slice();
        const metas: []Lockfile.Package.Meta = packages.items(.meta);
        const scripts: []Lockfile.Package.Scripts = packages.items(.scripts);
        const resolutions: []Install.Resolution = packages.items(.resolution);
        const buf = pm.lockfile.buffers.string_bytes.items;

        var trusted: std.AutoArrayHashMapUnmanaged(u64, String) = .{};
        defer trusted.deinit(ctx.allocator);
        var untrusted_dep_ids: std.AutoArrayHashMapUnmanaged(DependencyID, void) = .{};
        defer untrusted_dep_ids.deinit(ctx.allocator);

        // loop through dependencies and get trusted and untrusted deps with lifecycle scripts
        for (pm.lockfile.buffers.dependencies.items, 0..) |dep, i| {
            const dep_id: DependencyID = @intCast(i);
            const package_id = pm.lockfile.buffers.resolutions.items[dep_id];
            if (package_id == Install.invalid_package_id) continue;

            // called alias because a dependency name is not always the package name
            const alias = dep.name.slice(buf);

            if (metas[package_id].hasInstallScript()) {
                if (pm.lockfile.hasTrustedDependency(alias)) {
                    // can't put alias directly because it might be inline
                    try trusted.put(ctx.allocator, dep.name_hash, dep.name);
                } else {
                    try untrusted_dep_ids.put(ctx.allocator, dep_id, {});
                }
            }
        }

        if (untrusted_dep_ids.count() == 0 and trusted.count() == 0) {
            try printHelpInfo(ctx, pm);
            return;
        }

        if (trusted.count() > 0) {
            const aliases = trusted.values();
            std.sort.pdq(String, aliases, StringSorter{ .buf = buf }, StringSorter.lessThan);

            Output.pretty("Trusted dependencies ({d}):\n", .{aliases.len});
            for (aliases) |alias| {
                Output.pretty(" <d>-<r> {s}\n", .{alias.slice(buf)});
            }
        }

        if (untrusted_dep_ids.count() == 0) {
            return;
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
            return;
        }

        const aliases = untrusted_with_scripts.keys();
        std.sort.pdq(string, aliases, {}, Sorter.lessThan);
        try untrusted_with_scripts.reIndex(ctx.allocator);

        if (trusted.count() > 0) Output.print("\n", .{});
        Output.print("Blocked dependencies ({d}):\n", .{aliases.len});

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

        return;
    }

    fn printHelpInfo(ctx: Command.Context, pm: *PackageManager) !void {
        _ = ctx;
        _ = pm;
        Output.pretty("No packages found with scripts\n", .{});
    }
};
