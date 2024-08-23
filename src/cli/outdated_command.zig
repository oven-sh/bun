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
const string = bun.string;

fn Table(
    comptime num_columns: usize,
    comptime column_color: []const u8,
    comptime column_left_pad: usize,
    comptime column_right_pad: usize,
    comptime enable_ansi_colors: bool,
) type {
    return struct {
        column_names: [num_columns][]const u8,
        column_inside_lengths: [num_columns]usize,

        pub fn topLeftSep(_: *const @This()) string {
            return if (enable_ansi_colors) "┌" else "-";
        }
        pub fn topRightSep(_: *const @This()) string {
            return if (enable_ansi_colors) "┐" else "-";
        }
        pub fn topColumnSep(_: *const @This()) string {
            return if (enable_ansi_colors) "┬" else "-";
        }

        pub fn bottomLeftSep(_: *const @This()) string {
            return if (enable_ansi_colors) "└" else "-";
        }
        pub fn bottomRightSep(_: *const @This()) string {
            return if (enable_ansi_colors) "┘" else "-";
        }
        pub fn bottomColumnSep(_: *const @This()) string {
            return if (enable_ansi_colors) "┴" else "-";
        }

        pub fn middleLeftSep(_: *const @This()) string {
            return if (enable_ansi_colors) "├" else "|";
        }
        pub fn middleRightSep(_: *const @This()) string {
            return if (enable_ansi_colors) "┤" else "|";
        }
        pub fn middleColumnSep(_: *const @This()) string {
            return if (enable_ansi_colors) "┼" else "|";
        }

        pub fn horizontalEdge(_: *const @This()) string {
            return if (enable_ansi_colors) "─" else "-";
        }
        pub fn verticalEdge(_: *const @This()) string {
            return if (enable_ansi_colors) "│" else "|";
        }

        pub fn init(column_names_: [num_columns][]const u8, column_inside_lengths_: [num_columns]usize) @This() {
            return .{
                .column_names = column_names_,
                .column_inside_lengths = column_inside_lengths_,
            };
        }

        pub fn printTopLineSeparator(this: *const @This()) void {
            this.printLine(this.topLeftSep(), this.topRightSep(), this.topColumnSep());
        }

        pub fn printBottomLineSeparator(this: *const @This()) void {
            this.printLine(this.bottomLeftSep(), this.bottomRightSep(), this.bottomColumnSep());
        }

        pub fn printLineSeparator(this: *const @This()) void {
            this.printLine(this.middleLeftSep(), this.middleRightSep(), this.middleColumnSep());
        }

        pub fn printLine(this: *const @This(), left_edge_separator: string, right_edge_separator: string, column_separator: string) void {
            for (this.column_inside_lengths, 0..) |column_inside_length, i| {
                if (i == 0) {
                    Output.pretty("{s}", .{left_edge_separator});
                } else {
                    Output.pretty("{s}", .{column_separator});
                }

                for (0..column_left_pad + column_inside_length + column_right_pad) |_| Output.pretty("{s}", .{this.horizontalEdge()});

                if (i == this.column_inside_lengths.len - 1) {
                    Output.pretty("{s}\n", .{right_edge_separator});
                }
            }
        }

        pub fn printColumnNames(this: *const @This()) void {
            for (this.column_inside_lengths, 0..) |column_inside_length, i| {
                Output.pretty("{s}", .{this.verticalEdge()});
                for (0..column_left_pad) |_| Output.pretty(" ", .{});
                Output.pretty("<b><" ++ column_color ++ ">{s}<r>", .{this.column_names[i]});
                for (this.column_names[i].len..column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
                if (i == this.column_inside_lengths.len - 1) {
                    Output.pretty("{s}\n", .{this.verticalEdge()});
                }
            }
        }
    };
}

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
        if (root_pkg_id == invalid_package_id) return;
        const root_pkg_deps = lockfile.packages.items(.dependencies)[root_pkg_id];

        Output.prettyErrorln("<r><b>bun outdated <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
        Output.flush();

        try updateManifestsIfNecessary(manager, log_level, root_pkg_deps);

        try switch (Output.enable_ansi_colors) {
            inline else => |enable_ansi_colors| printOutdatedInfoTable(manager, root_pkg_deps, enable_ansi_colors),
        };
    }

    fn printOutdatedInfoTable(manager: *PackageManager, root_pkg_deps: Lockfile.DependencySlice, comptime enable_ansi_colors: bool) !void {
        var outdated_ids: std.ArrayListUnmanaged(struct { package_id: PackageID, dep_id: DependencyID }) = .{};
        defer outdated_ids.deinit(manager.allocator);

        var max_name: usize = 0;
        var max_current: usize = 0;
        var max_update: usize = 0;
        var max_latest: usize = 0;

        const lockfile = manager.lockfile;
        const string_buf = lockfile.buffers.string_bytes.items;
        const dependencies = lockfile.buffers.dependencies.items;
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

            const package_name_len = package_name.len +
                if (dep.behavior.dev)
                " (dev)".len
            else if (dep.behavior.peer)
                " (peer)".len
            else if (dep.behavior.optional)
                " (optional)".len
            else
                0;

            if (package_name_len > max_name) max_name = package_name_len;

            version_writer.print("{}", .{resolution.value.npm.version.fmt(string_buf)}) catch bun.outOfMemory();
            if (version_buf.items.len > max_current) max_current = version_buf.items.len;
            version_buf.clearRetainingCapacity();

            version_writer.print("{}", .{update_version.version.fmt(manifest.string_buf)}) catch bun.outOfMemory();
            if (version_buf.items.len > max_update) max_update = version_buf.items.len;
            version_buf.clearRetainingCapacity();

            version_writer.print("{}", .{latest.version.fmt(manifest.string_buf)}) catch bun.outOfMemory();
            if (version_buf.items.len > max_latest) max_latest = version_buf.items.len;
            version_buf.clearRetainingCapacity();

            outdated_ids.append(
                bun.default_allocator,
                .{ .package_id = package_id, .dep_id = @intCast(dep_id) },
            ) catch bun.outOfMemory();
        }

        if (outdated_ids.items.len == 0) return;

        const package_column_inside_length = @max("Packages".len, max_name);
        const current_column_inside_length = @max("Current".len, max_current);
        const update_column_inside_length = @max("Update".len, max_update);
        const latest_column_inside_length = @max("Latest".len, max_latest);

        const column_left_pad = 1;
        const column_right_pad = 1;

        const table = Table(4, "blue", column_left_pad, column_right_pad, enable_ansi_colors).init(
            [_][]const u8{
                "Packages",
                "Current",
                "Update",
                "Latest",
            },
            [_]usize{
                package_column_inside_length,
                current_column_inside_length,
                update_column_inside_length,
                latest_column_inside_length,
            },
        );

        table.printTopLineSeparator();
        table.printColumnNames();

        inline for (
            .{
                Behavior{ .normal = true },
                Behavior{ .dev = true },
                Behavior{ .peer = true },
                Behavior{ .optional = true },
            },
        ) |group_behavior| {
            for (outdated_ids.items) |ids| {
                const package_id = ids.package_id;
                const dep_id = ids.dep_id;

                const dep = dependencies[dep_id];
                if (@as(u8, @bitCast(group_behavior)) & @as(u8, @bitCast(dep.behavior)) == 0) continue;

                const package_name = pkg_names[package_id].slice(string_buf);
                const resolution = pkg_resolutions[package_id];

                var expired = false;
                const manifest = manager.manifests.byNameAllowExpired(
                    manager.scopeForPackageName(package_name),
                    package_name,
                    &expired,
                ) orelse continue;

                const latest = manifest.findByDistTag("latest") orelse continue;
                const update = if (dep.version.tag == .npm)
                    manifest.findBestVersion(dep.version.value.npm.version, string_buf) orelse continue
                else
                    manifest.findByDistTag(dep.version.value.dist_tag.tag.slice(string_buf)) orelse continue;

                table.printLineSeparator();

                {
                    // package name
                    const behavior_str = if (dep.behavior.dev)
                        " (dev)"
                    else if (dep.behavior.peer)
                        " (peer)"
                    else if (dep.behavior.optional)
                        " (optional)"
                    else
                        "";

                    Output.pretty("{s}", .{table.verticalEdge()});
                    for (0..column_left_pad) |_| Output.pretty(" ", .{});

                    Output.pretty("{s}<d>{s}<r>", .{ package_name, behavior_str });
                    for (package_name.len + behavior_str.len..package_column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
                }

                {
                    // current version
                    Output.pretty("{s}", .{table.verticalEdge()});
                    for (0..column_left_pad) |_| Output.pretty(" ", .{});

                    version_writer.print("{}", .{resolution.value.npm.version.fmt(string_buf)}) catch bun.outOfMemory();
                    Output.pretty("{s}", .{version_buf.items});
                    for (version_buf.items.len..current_column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
                    version_buf.clearRetainingCapacity();
                }

                {
                    // update version
                    Output.pretty("{s}", .{table.verticalEdge()});
                    for (0..column_left_pad) |_| Output.pretty(" ", .{});

                    version_writer.print("{}", .{update.version.fmt(manifest.string_buf)}) catch bun.outOfMemory();
                    Output.pretty("{s}", .{update.version.diffFmt(resolution.value.npm.version, manifest.string_buf, string_buf)});
                    for (version_buf.items.len..update_column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
                    version_buf.clearRetainingCapacity();
                }

                {
                    // latest version
                    Output.pretty("{s}", .{table.verticalEdge()});
                    for (0..column_left_pad) |_| Output.pretty(" ", .{});

                    version_writer.print("{}", .{latest.version.fmt(manifest.string_buf)}) catch bun.outOfMemory();
                    Output.pretty("{s}", .{latest.version.diffFmt(resolution.value.npm.version, manifest.string_buf, string_buf)});
                    for (version_buf.items.len..latest_column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
                    version_buf.clearRetainingCapacity();
                }

                Output.pretty("{s}\n", .{table.verticalEdge()});
            }
        }

        table.printBottomLineSeparator();
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
