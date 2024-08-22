const std = @import("std");
const bun = @import("root").bun;
const Global = bun.Global;
const Output = bun.Output;
const Command = bun.CLI.Command;
const Install = bun.install;
const PackageManager = Install.PackageManager;
const Lockfile = Install.Lockfile;
const PackageID = Install.PackageID;
const DependencyID = Install.DependencyID;
const Behavior = Install.Dependency.Behavior;
const invalid_package_id = Install.invalid_package_id;

pub const OutdatedCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .outdated);

        const manager = PackageManager.init(ctx, cli, .outdated) catch |err| {
            if (!cli.silent) {
                if (err == error.MissingPackageJSON) {
                    Output.errGeneric("missing package.json, nothing outdated", .{});
                }
                Output.errGeneric("failed to initialize bun install: {s}", .{@errorName(err)});
            }

            Global.crash();
        };

        return switch (manager.options.log_level) {
            inline else => |log_level| outdated(ctx, manager, log_level),
        };
    }

    fn outdated(ctx: Command.Context, manager: *PackageManager, comptime log_level: PackageManager.Options.LogLevel) !void {
        const load_lockfile_result = manager.lockfile.loadFromDisk(
            manager,
            manager.allocator,
            manager.log,
            manager.options.lockfile_path,
            true,
        );

        const lockfile = switch (load_lockfile_result) {
            .not_found => {
                if (log_level != .silent) {
                    Output.errGeneric("missing lockfile, nothing outdated", .{});
                }
                Global.crash();
            },
            .err => |cause| {
                if (log_level != .silent) {
                    switch (cause.step) {
                        .open_file => Output.errGeneric("failed to open lockfile: {s}", .{
                            @errorName(cause.value),
                        }),
                        .parse_file => Output.errGeneric("failed to parse lockfile: {s}", .{
                            @errorName(cause.value),
                        }),
                        .read_file => Output.errGeneric("failed to read lockfile: {s}", .{
                            @errorName(cause.value),
                        }),
                        .migrating => Output.errGeneric("failed to migrate lockfile: {s}", .{
                            @errorName(cause.value),
                        }),
                    }

                    if (ctx.log.hasErrors()) {
                        switch (Output.enable_ansi_colors) {
                            inline else => |enable_ansi_colors| try manager.log.printForLogLevelWithEnableAnsiColors(
                                Output.errorWriter(),
                                enable_ansi_colors,
                            ),
                        }
                    }
                }

                Global.crash();
            },
            .ok => |ok| ok.lockfile,
        };

        manager.lockfile = lockfile;

        const root_pkg_id = manager.root_package_id.get(lockfile, manager.workspace_name_hash);
        const root_pkg_deps = lockfile.packages.items(.dependencies)[root_pkg_id];

        try updateManifestsIfNecessary(manager, log_level, root_pkg_deps);
        try printOutdatedInfo(manager, root_pkg_deps);
    }

    fn printOutdatedInfo(manager: *PackageManager, root_pkg_deps: Lockfile.DependencySlice) !void {
        var outdated_ids: std.ArrayListUnmanaged(struct { package_id: PackageID, dep_id: DependencyID }) = .{};
        defer outdated_ids.deinit(manager.allocator);

        var max_name: usize = 0;
        var max_current: usize = 0;
        var max_update: usize = 0;
        var max_latest: usize = 0;

        var has_dev = false;
        var has_peer = false;
        var has_optional = false;

        const lockfile = manager.lockfile;

        const string_buf = lockfile.buffers.string_bytes.items;
        const packages = lockfile.packages.slice();
        const pkg_names = packages.items(.name);
        const pkg_resolutions = packages.items(.resolution);

        var version_buf = std.ArrayList(u8).init(bun.default_allocator);
        defer version_buf.deinit();
        const version_writer = version_buf.writer();

        for (root_pkg_deps.begin()..root_pkg_deps.end()) |dep_id| {
            const package_id = lockfile.buffers.resolutions.items[dep_id];
            if (package_id == invalid_package_id) continue;
            const dep = lockfile.buffers.dependencies.items[dep_id];
            if (dep.version.tag != .npm and dep.version.tag != .dist_tag) continue;
            const resolution = pkg_resolutions[package_id];
            if (resolution.tag != .npm) continue;

            const package_name = pkg_names[package_id].slice(string_buf);
            var expired = false;
            const manifest = manager.manifests.byNameAllowExpired(
                manager.scopeForPackageName(package_name),
                package_name,
                &expired,
            ) orelse continue;

            const latest = manifest.findByDistTag("latest") orelse continue;

            const update_version = if (dep.version.tag == .npm)
                manifest.findBestVersion(dep.version.value.npm.version, string_buf) orelse continue
            else
                manifest.findByDistTag(dep.version.value.dist_tag.tag.slice(string_buf)) orelse continue;

            if (resolution.value.npm.version.order(latest.version, string_buf, string_buf) != .lt) continue;

            if (dep.behavior.dev)
                has_dev = true
            else if (dep.behavior.peer)
                has_peer = true
            else if (dep.behavior.optional)
                has_optional = true;

            if (package_name.len > max_name) max_name = package_name.len;

            version_writer.print("{}", .{resolution.value.npm.version.fmt(string_buf)}) catch bun.outOfMemory();
            if (version_buf.items.len > max_current) max_current = version_buf.items.len;
            version_buf.items.len = 0;

            version_writer.print("{}", .{update_version.version.fmt(manifest.string_buf)}) catch bun.outOfMemory();
            if (version_buf.items.len > max_update) max_update = version_buf.items.len;
            version_buf.items.len = 0;

            version_writer.print("{}", .{latest.version.fmt(manifest.string_buf)}) catch bun.outOfMemory();
            if (version_buf.items.len > max_latest) max_latest = version_buf.items.len;
            version_buf.items.len = 0;

            outdated_ids.append(
                bun.default_allocator,
                .{ .package_id = package_id, .dep_id = @intCast(dep_id) },
            ) catch bun.outOfMemory();
        }

        if (outdated_ids.items.len == 0) return;

        // +2 for padding columns with 2 spaces
        const package_column_length: usize = 2 + if (has_optional)
            "Optional dependencies".len + @as(usize, (max_name -| "Optional dependencies".len))
        else if (has_peer)
            "Peer dependencies".len + @as(usize, (max_name -| "Peer dependencies".len))
        else if (has_dev)
            "Dev dependencies".len + @as(usize, (max_name -| "Dev dependencies".len))
        else
            "Dependencies".len + @as(usize, (max_name -| "Dependencies".len));

        const current_column_length: usize = "Current".len + @as(usize, (max_current -| "Current".len)) + 2;
        const update_column_length: usize = "Update".len + @as(usize, (max_update -| "Update".len)) + 2;
        const latest_column_length: usize = "Latest".len + @as(usize, (max_latest -| "Latest".len)) + 2;

        var printed_column_names = false;
        inline for (
            .{
                .{ "Dependencies", Behavior{ .normal = true } },
                .{ "Dev dependencies", Behavior{ .dev = true } },
                .{ "Peer dependencies", Behavior{ .peer = true } },
                .{ "Optional dependencies", Behavior{ .optional = true } },
            },
        ) |dependency_group| {
            const group_name, const group_behavior = dependency_group;

            var printed_group_name = false;

            for (outdated_ids.items) |ids| {
                const package_id = ids.package_id;
                const dep_id = ids.dep_id;
                const package_name = pkg_names[package_id].slice(string_buf);
                const dep = lockfile.buffers.dependencies.items[dep_id];

                if (@as(u8, @bitCast(dep.behavior)) & @as(u8, @bitCast(group_behavior)) == 0) continue;

                var expired = false;
                const manifest = manager.manifests.byNameAllowExpired(
                    manager.scopeForPackageName(package_name),
                    package_name,
                    &expired,
                ) orelse continue;

                const latest = manifest.findByDistTag("latest") orelse continue;
                const update_version = if (dep.version.tag == .npm)
                    manifest.findBestVersion(dep.version.value.npm.version, string_buf) orelse continue
                else
                    manifest.findByDistTag(dep.version.value.dist_tag.tag.slice(string_buf)) orelse continue;

                if (!printed_group_name) {
                    printed_group_name = true;

                    Output.pretty("<r>\n<cyan>" ++ group_name ++ "<r>", .{});
                    for (group_name.len..package_column_length) |_| Output.pretty(" ", .{});

                    if (!printed_column_names) {
                        printed_column_names = true;

                        Output.pretty("<cyan>Current<r>", .{});
                        for ("Current".len..current_column_length) |_| Output.pretty(" ", .{});

                        Output.pretty("<cyan>Update<r>", .{});
                        for ("Update".len..update_column_length) |_| Output.pretty(" ", .{});

                        Output.pretty("<cyan>Latest<r>", .{});
                        for ("Latest".len..latest_column_length) |_| Output.pretty(" ", .{});
                    }

                    Output.pretty("\n", .{});
                }

                Output.pretty("{s}", .{package_name});
                for (package_name.len..package_column_length) |_| Output.pretty(" ", .{});

                const resolution = pkg_resolutions[package_id];
                version_writer.print("{}", .{resolution.value.npm.version.fmt(string_buf)}) catch bun.outOfMemory();
                Output.pretty("{s}", .{version_buf.items});
                for (version_buf.items.len..current_column_length) |_| Output.pretty(" ", .{});
                version_buf.items.len = 0;

                version_writer.print("{}", .{update_version.version.fmt(manifest.string_buf)}) catch bun.outOfMemory();
                Output.pretty("{}", .{update_version.version.diffFmt(resolution.value.npm.version, manifest.string_buf, string_buf)});
                for (version_buf.items.len..update_column_length) |_| Output.pretty(" ", .{});
                version_buf.items.len = 0;

                version_writer.print("{}", .{latest.version.fmt(manifest.string_buf)}) catch bun.outOfMemory();
                Output.pretty("{}", .{latest.version.diffFmt(resolution.value.npm.version, manifest.string_buf, string_buf)});
                for (version_buf.items.len..latest_column_length) |_| Output.pretty(" ", .{});
                version_buf.items.len = 0;

                Output.pretty("\n", .{});
            }
        }

        Output.flush();
    }

    fn updateManifestsIfNecessary(manager: *PackageManager, comptime log_level: PackageManager.Options.LogLevel, root_pkg_deps: Lockfile.DependencySlice) !void {
        const lockfile = manager.lockfile;
        const resolutions = lockfile.buffers.resolutions.items;
        const dependencies = lockfile.buffers.dependencies.items;
        const string_buf = lockfile.buffers.string_bytes.items;
        const packages = lockfile.packages.slice();
        const pkg_resolutions = packages.items(.resolution);
        const pkg_names = packages.items(.name);

        for (root_pkg_deps.begin()..root_pkg_deps.end()) |dep_id| {
            if (dep_id >= dependencies.len) continue;
            const package_id = resolutions[dep_id];
            if (package_id == invalid_package_id) continue;
            const dep = dependencies[dep_id];
            if (dep.version.tag != .npm and dep.version.tag != .dist_tag) continue;
            const resolution: Install.Resolution = pkg_resolutions[package_id];
            if (resolution.tag != .npm) continue;

            const package_name = pkg_names[package_id].slice(string_buf);
            _ = manager.manifests.byName(
                manager.scopeForPackageName(package_name),
                package_name,
            ) orelse {
                const task_id = Install.Task.Id.forManifest(package_name);
                if (manager.hasCreatedNetworkTask(task_id, dep.behavior.optional)) continue;

                manager.startProgressBarIfNone();

                var task = manager.getNetworkTask();
                task.* = .{
                    .package_manager = &PackageManager.instance,
                    .callback = undefined,
                    .task_id = task_id,
                    .allocator = manager.allocator,
                };
                try task.forManifest(
                    package_name,
                    manager.allocator,
                    manager.scopeForPackageName(package_name),
                    null,
                    dep.behavior.optional,
                );

                manager.enqueueNetworkTask(task);
            };
        }

        manager.flushNetworkQueue();
        _ = manager.scheduleTasks();

        const RunClosure = struct {
            manager: *PackageManager,
            err: ?anyerror = null,
            pub fn isDone(closure: *@This()) bool {
                if (closure.manager.pendingTaskCount() > 0) {
                    closure.manager.runTasks(
                        *PackageManager,
                        closure.manager,
                        .{
                            .onExtract = {},
                            .onResolve = {},
                            .onPackageManifestError = {},
                            .onPackageDownloadError = {},
                            .progress_bar = true,
                            .manifests_only = true,
                        },
                        true,
                        log_level,
                    ) catch |err| {
                        closure.err = err;
                        return true;
                    };
                }

                return closure.manager.pendingTaskCount() == 0;
            }
        };

        var run_closure: RunClosure = .{ .manager = manager };
        manager.sleepUntil(&run_closure, &RunClosure.isDone);

        if (comptime log_level.showProgress()) {
            manager.endProgressBar();
            Output.flush();
        }

        if (run_closure.err) |err| {
            return err;
        }
    }
};
