const std = @import("std");
const Progress = bun.Progress;
const bun = @import("root").bun;
const logger = bun.logger;
const Environment = bun.Environment;
const Command = @import("../cli.zig").Command;
const Install = @import("../install/install.zig");
const LifecycleScriptSubprocess = Install.LifecycleScriptSubprocess;
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

pub const DefaultTrustedCommand = struct {
    pub fn exec() !void {
        Output.print("Default trusted dependencies ({d}):\n", .{Lockfile.default_trusted_dependencies_list.len});
        for (Lockfile.default_trusted_dependencies_list) |name| {
            Output.pretty(" <d>-<r> {s}\n", .{name});
        }

        return;
    }
};

pub const UntrustedCommand = struct {
    pub fn exec(ctx: Command.Context, pm: *PackageManager, args: [][:0]u8) !void {
        _ = args;
        Output.prettyError("<r><b>bun pm untrusted <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n\n", .{});
        Output.flush();

        const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
        PackageManagerCommand.handleLoadLockfileErrors(load_lockfile, pm);
        try pm.updateLockfileIfNeeded(load_lockfile);

        const packages = pm.lockfile.packages.slice();
        const scripts: []Lockfile.Package.Scripts = packages.items(.scripts);
        const resolutions: []Install.Resolution = packages.items(.resolution);
        const buf = pm.lockfile.buffers.string_bytes.items;

        var untrusted_dep_ids: std.AutoArrayHashMapUnmanaged(DependencyID, void) = .{};
        defer untrusted_dep_ids.deinit(ctx.allocator);

        // loop through dependencies and get trusted and untrusted deps with lifecycle scripts
        for (pm.lockfile.buffers.dependencies.items, 0..) |dep, i| {
            const dep_id: DependencyID = @intCast(i);
            const package_id = pm.lockfile.buffers.resolutions.items[dep_id];
            if (package_id == Install.invalid_package_id) continue;

            // called alias because a dependency name is not always the package name
            const alias = dep.name.slice(buf);

            if (!pm.lockfile.hasTrustedDependency(alias)) {
                try untrusted_dep_ids.put(ctx.allocator, dep_id, {});
            }
        }

        if (untrusted_dep_ids.count() == 0) {
            printZeroUntrustedDependenciesFound();
            return;
        }

        var untrusted_deps: std.AutoArrayHashMapUnmanaged(DependencyID, Lockfile.Package.Scripts.List) = .{};
        defer untrusted_deps.deinit(ctx.allocator);

        var tree_iterator = Lockfile.Tree.Iterator(.node_modules).init(pm.lockfile);

        const top_level_without_trailing_slash = strings.withoutTrailingSlash(Fs.FileSystem.instance.top_level_dir);
        var abs_node_modules_path: std.ArrayListUnmanaged(u8) = .{};
        defer abs_node_modules_path.deinit(ctx.allocator);
        try abs_node_modules_path.appendSlice(ctx.allocator, top_level_without_trailing_slash);
        try abs_node_modules_path.append(ctx.allocator, std.fs.path.sep);

        while (tree_iterator.next(null)) |node_modules| {
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
                    var not_lazy: PackageManager.LazyPackageDestinationDir = .{ .dir = node_modules_dir };
                    const maybe_scripts_list = package_scripts.getList(
                        pm.log,
                        pm.lockfile,
                        &not_lazy,
                        abs_node_modules_path.items,
                        alias,
                        resolution,
                    ) catch |err| {
                        if (err == error.ENOENT) continue;
                        return err;
                    };

                    if (maybe_scripts_list) |scripts_list| {
                        if (scripts_list.total == 0 or scripts_list.items.len == 0) continue;
                        try untrusted_deps.put(ctx.allocator, dep_id, scripts_list);
                    }
                }
            }
        }

        if (untrusted_deps.count() == 0) {
            printZeroUntrustedDependenciesFound();
            return;
        }

        var iter = untrusted_deps.iterator();
        while (iter.next()) |entry| {
            const dep_id = entry.key_ptr.*;
            const scripts_list = entry.value_ptr.*;
            const package_id = pm.lockfile.buffers.resolutions.items[dep_id];
            const resolution = pm.lockfile.packages.items(.resolution)[package_id];

            scripts_list.printScripts(&resolution, buf, .untrusted);
            Output.pretty("\n", .{});
        }

        Output.pretty(
            \\These dependencies had their lifecycle scripts blocked during install.
            \\
            \\If you trust them and wish to run their scripts, use <d>`<r><blue>bun pm trust<r><d>`<r>.
            \\
        , .{});
    }

    fn printZeroUntrustedDependenciesFound() void {
        Output.pretty(
            \\Found <b>0<r> untrusted dependencies with scripts.
            \\
            \\This means all packages with scripts are in "trustedDependencies" or none of your dependencies have scripts.
            \\
            \\For more information, visit <magenta>https://bun.sh/docs/install/lifecycle#trusteddependencies<r>
            \\
        , .{});
    }
};

pub const TrustCommand = struct {
    pub const Sorter = struct {
        pub fn lessThan(_: void, rhs: string, lhs: string) bool {
            return std.mem.order(u8, rhs, lhs) == .lt;
        }
    };

    fn errorExpectedArgs() noreturn {
        Output.errGeneric("expected package names(s) or --all", .{});
        Global.crash();
    }

    fn printErrorZeroUntrustedDependenciesFound(trust_all: bool, packages_to_trust: []const string) void {
        Output.print("\n", .{});
        if (trust_all) {
            Output.errGeneric("0 scripts ran. This means all dependencies are already trusted or none have scripts.", .{});
        } else {
            Output.errGeneric("0 scripts ran. The following packages are already trusted, don't have scripts to run, or don't exist:\n\n", .{});
            for (packages_to_trust) |arg| {
                Output.prettyError(" <d>-<r> {s}\n", .{arg});
            }
        }
    }

    pub fn exec(ctx: Command.Context, pm: *PackageManager, args: [][:0]u8) !void {
        Output.prettyError("<r><b>bun pm trust <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
        Output.flush();

        if (args.len == 2) errorExpectedArgs();

        const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
        PackageManagerCommand.handleLoadLockfileErrors(load_lockfile, pm);
        try pm.updateLockfileIfNeeded(load_lockfile);

        var packages_to_trust: std.ArrayListUnmanaged(string) = .{};
        defer packages_to_trust.deinit(ctx.allocator);
        try packages_to_trust.ensureUnusedCapacity(ctx.allocator, args[2..].len);
        for (args[2..]) |arg| {
            if (arg.len > 0 and arg[0] != '-') packages_to_trust.appendAssumeCapacity(arg);
        }
        const trust_all = strings.leftHasAnyInRight(args, &.{ "-a", "--all" });

        if (!trust_all and packages_to_trust.items.len == 0) errorExpectedArgs();

        const buf = pm.lockfile.buffers.string_bytes.items;
        const packages = pm.lockfile.packages.slice();
        const resolutions: []Install.Resolution = packages.items(.resolution);
        const scripts: []Lockfile.Package.Scripts = packages.items(.scripts);

        var untrusted_dep_ids: DepIdSet = .{};
        defer untrusted_dep_ids.deinit(ctx.allocator);

        for (pm.lockfile.buffers.dependencies.items, pm.lockfile.buffers.resolutions.items, 0..) |dep, package_id, i| {
            const dep_id: u32 = @intCast(i);
            if (package_id == Install.invalid_package_id) continue;

            const alias = dep.name.slice(buf);

            if (!pm.lockfile.hasTrustedDependency(alias)) {
                try untrusted_dep_ids.put(ctx.allocator, dep_id, {});
            }
        }

        if (untrusted_dep_ids.count() == 0) {
            printErrorZeroUntrustedDependenciesFound(trust_all, packages_to_trust.items);
            Global.crash();
        }

        // Instead of running them right away, we group scripts by depth in the node_modules
        // file structure, then run them starting at max depth. This ensures lifecycle scripts are run
        // in the correct order as they would during a normal install
        var tree_iter = Lockfile.Tree.Iterator(.node_modules).init(pm.lockfile);

        const top_level_without_trailing_slash = strings.withoutTrailingSlash(Fs.FileSystem.instance.top_level_dir);
        var abs_node_modules_path: std.ArrayListUnmanaged(u8) = .{};
        defer abs_node_modules_path.deinit(ctx.allocator);
        try abs_node_modules_path.appendSlice(ctx.allocator, top_level_without_trailing_slash);
        try abs_node_modules_path.append(ctx.allocator, std.fs.path.sep);

        var package_names_to_add: bun.StringArrayHashMapUnmanaged(void) = .{};
        var scripts_at_depth: std.AutoArrayHashMapUnmanaged(usize, std.ArrayListUnmanaged(struct {
            package_id: PackageID,
            scripts_list: Lockfile.Package.Scripts.List,
            skip: bool,
        })) = .{};

        var scripts_count: usize = 0;

        while (tree_iter.next(null)) |node_modules| {
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
                        bun.assertWithLocation(package_id != Install.invalid_package_id, @src());
                    }
                    const resolution = &resolutions[package_id];
                    var package_scripts = scripts[package_id];
                    var not_lazy = PackageManager.LazyPackageDestinationDir{ .dir = node_modules_dir };
                    const maybe_scripts_list = package_scripts.getList(
                        pm.log,
                        pm.lockfile,
                        &not_lazy,
                        abs_node_modules_path.items,
                        alias,
                        resolution,
                    ) catch |err| {
                        if (err == error.ENOENT) continue;
                        return err;
                    };

                    if (maybe_scripts_list) |scripts_list| {
                        const skip = brk: {
                            if (trust_all) break :brk false;

                            for (packages_to_trust.items) |package_name_from_cli| {
                                if (strings.eqlLong(package_name_from_cli, alias, true) and !pm.lockfile.hasTrustedDependency(alias)) {
                                    break :brk false;
                                }
                            }

                            break :brk true;
                        };

                        // even if it is skipped we still add to scripts_at_depth for logging later
                        const entry = try scripts_at_depth.getOrPut(ctx.allocator, node_modules.depth);
                        if (!entry.found_existing) entry.value_ptr.* = .{};
                        try entry.value_ptr.append(ctx.allocator, .{
                            .package_id = package_id,
                            .scripts_list = scripts_list,
                            .skip = skip,
                        });

                        if (!skip) {
                            try package_names_to_add.put(ctx.allocator, try ctx.allocator.dupe(u8, alias), {});
                            scripts_count += scripts_list.total;
                        }
                    }
                }
            }
        }

        if (scripts_at_depth.count() == 0 or package_names_to_add.count() == 0) {
            printErrorZeroUntrustedDependenciesFound(trust_all, packages_to_trust.items);
            Global.crash();
        }

        var root_node: *Progress.Node = undefined;
        var scripts_node: Progress.Node = undefined;
        var progress = &pm.progress;

        if (pm.options.log_level.showProgress()) {
            progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
            root_node = progress.start("", 0);

            scripts_node = root_node.start(PackageManager.ProgressStrings.script(), scripts_count);
            pm.scripts_node = &scripts_node;
        }

        {
            var iter = std.mem.reverseIterator(scripts_at_depth.values());
            while (iter.next()) |entry| {
                for (entry.items) |info| {
                    if (info.skip) continue;

                    while (LifecycleScriptSubprocess.alive_count.load(.monotonic) >= pm.options.max_concurrent_lifecycle_scripts) {
                        if (pm.options.log_level.isVerbose()) {
                            if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} scripts\n", .{LifecycleScriptSubprocess.alive_count.load(.monotonic)});
                        }

                        pm.sleep();
                    }

                    const output_in_foreground = false;
                    const optional = false;
                    switch (pm.options.log_level) {
                        inline else => |log_level| try pm.spawnPackageLifecycleScripts(
                            ctx,
                            info.scripts_list,
                            optional,
                            log_level,
                            output_in_foreground,
                        ),
                    }

                    if (pm.options.log_level.showProgress()) {
                        scripts_node.activate();
                        progress.refresh();
                    }
                }

                while (pm.pending_lifecycle_script_tasks.load(.monotonic) > 0) {
                    pm.sleep();
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

        var package_json = bun.JSON.parseUTF8(&package_json_source, ctx.log, ctx.allocator) catch |err| {
            ctx.log.print(Output.errorWriter()) catch {};

            Output.errGeneric("failed to parse package.json: {s}", .{@errorName(err)});
            Global.crash();
        };

        // now add the package names to lockfile.trustedDependencies and package.json `trustedDependencies`
        const names = package_names_to_add.keys();
        if (comptime Environment.allow_assert) {
            bun.assertWithLocation(names.len > 0, @src());
        }

        // could be null if these are the first packages to be trusted
        if (pm.lockfile.trusted_dependencies == null) pm.lockfile.trusted_dependencies = .{};

        var total_scripts_ran: usize = 0;
        var total_packages_with_scripts: usize = 0;
        var total_skipped_packages: usize = 0;

        Output.print("\n", .{});

        {
            var iter = std.mem.reverseIterator(scripts_at_depth.values());
            while (iter.next()) |entry| {
                for (entry.items) |info| {
                    const resolution = pm.lockfile.packages.items(.resolution)[info.package_id];
                    if (info.skip) {
                        info.scripts_list.printScripts(&resolution, buf, .untrusted);
                        total_skipped_packages += 1;
                    } else {
                        total_packages_with_scripts += 1;
                        total_scripts_ran += info.scripts_list.total;
                        info.scripts_list.printScripts(&resolution, buf, .completed);
                    }
                    Output.print("\n", .{});
                }
            }
        }

        try Install.PackageManager.PackageJSONEditor.editTrustedDependencies(ctx.allocator, &package_json, names);

        for (names) |name| {
            try pm.lockfile.trusted_dependencies.?.put(ctx.allocator, @truncate(String.Builder.stringHash(name)), {});
        }

        const save_format: Lockfile.LoadResult.LockfileFormat = if (pm.options.save_text_lockfile)
            .text
        else switch (load_lockfile) {
            .not_found => .binary,
            .err => |err| err.format,
            .ok => |ok| ok.format,
        };
        pm.lockfile.saveToDisk(save_format, pm.options.log_level.isVerbose());

        var buffer_writer = try bun.js_printer.BufferWriter.init(ctx.allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(ctx.allocator, package_json_contents.len + 1);
        buffer_writer.append_newline = package_json_contents.len > 0 and package_json_contents[package_json_contents.len - 1] == '\n';
        var package_json_writer = bun.js_printer.BufferPrinter.init(buffer_writer);

        _ = bun.js_printer.printJSON(@TypeOf(&package_json_writer), &package_json_writer, package_json, &package_json_source, .{}) catch |err| {
            Output.errGeneric("failed to print package.json: {s}", .{@errorName(err)});
            Global.crash();
        };

        const new_package_json_contents = package_json_writer.ctx.writtenWithoutTrailingZero();

        try pm.root_package_json_file.pwriteAll(new_package_json_contents, 0);
        std.posix.ftruncate(pm.root_package_json_file.handle, new_package_json_contents.len) catch {};
        pm.root_package_json_file.close();

        if (comptime Environment.allow_assert) {
            bun.assertWithLocation(total_scripts_ran > 0, @src());
        }

        Output.pretty(" <green>{d}<r> script{s} ran across {d} package{s} ", .{
            total_scripts_ran,
            if (total_scripts_ran > 1) "s" else "",
            total_packages_with_scripts,
            if (total_packages_with_scripts > 1) "s" else "",
        });

        Output.printStartEndStdout(bun.start_time, std.time.nanoTimestamp());
        Output.print("\n", .{});

        if (total_skipped_packages > 0) {
            Output.print("\n", .{});
            Output.prettyln(" <yellow>{d}<r> package{s} with blocked scripts", .{
                total_skipped_packages,
                if (total_skipped_packages > 1) "s" else "",
            });
        }
    }
};
