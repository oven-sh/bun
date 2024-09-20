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
const Resolution = Install.Resolution;
const string = bun.string;
const strings = bun.strings;
const PathBuffer = bun.PathBuffer;
const FileSystem = bun.fs.FileSystem;
const path = bun.path;
const glob = bun.glob;
const Table = bun.fmt.Table;

pub const OutdatedCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        Output.prettyErrorln("<r><b>bun outdated <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
        Output.flush();

        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .outdated);

        const manager, const original_cwd = PackageManager.init(ctx, cli, .outdated) catch |err| {
            if (!cli.silent) {
                if (err == error.MissingPackageJSON) {
                    Output.errGeneric("missing package.json, nothing outdated", .{});
                }
                Output.errGeneric("failed to initialize bun install: {s}", .{@errorName(err)});
            }

            Global.crash();
        };
        defer ctx.allocator.free(original_cwd);

        return switch (manager.options.log_level) {
            inline else => |log_level| outdated(ctx, original_cwd, manager, log_level),
        };
    }

    fn outdated(ctx: Command.Context, original_cwd: string, manager: *PackageManager, comptime log_level: PackageManager.Options.LogLevel) !void {
        const load_lockfile_result = manager.lockfile.loadFromDisk(
            manager,
            manager.allocator,
            manager.log,
            manager.options.lockfile_path,
            true,
        );

        manager.lockfile = switch (load_lockfile_result) {
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

        switch (Output.enable_ansi_colors) {
            inline else => |enable_ansi_colors| {
                if (manager.options.filter_patterns.len > 0) {
                    const filters = manager.options.filter_patterns;
                    const workspace_pkg_ids = findMatchingWorkspaces(
                        bun.default_allocator,
                        original_cwd,
                        manager,
                        filters,
                    ) catch bun.outOfMemory();
                    defer bun.default_allocator.free(workspace_pkg_ids);

                    try updateManifestsIfNecessary(manager, log_level, workspace_pkg_ids);
                    try printOutdatedInfoTable(manager, workspace_pkg_ids, true, enable_ansi_colors);
                } else {
                    // just the current workspace
                    const root_pkg_id = manager.root_package_id.get(manager.lockfile, manager.workspace_name_hash);
                    if (root_pkg_id == invalid_package_id) return;

                    try updateManifestsIfNecessary(manager, log_level, &.{root_pkg_id});
                    try printOutdatedInfoTable(manager, &.{root_pkg_id}, false, enable_ansi_colors);
                }
            },
        }
    }

    // TODO: use in `bun pack, publish, run, ...`
    const FilterType = union(enum) {
        all,
        name: []const u32,
        path: []const u32,

        pub fn init(pattern: []const u32, is_path: bool) @This() {
            return if (is_path) .{
                .path = pattern,
            } else .{
                .name = pattern,
            };
        }

        pub fn deinit(this: @This(), allocator: std.mem.Allocator) void {
            switch (this) {
                .path, .name => |pattern| allocator.free(pattern),
                else => {},
            }
        }
    };

    fn findMatchingWorkspaces(
        allocator: std.mem.Allocator,
        original_cwd: string,
        manager: *PackageManager,
        filters: []const string,
    ) error{OutOfMemory}![]const PackageID {
        const lockfile = manager.lockfile;
        const packages = lockfile.packages.slice();
        const pkg_names = packages.items(.name);
        const pkg_resolutions = packages.items(.resolution);
        const string_buf = lockfile.buffers.string_bytes.items;

        var workspace_pkg_ids: std.ArrayListUnmanaged(PackageID) = .{};
        for (pkg_resolutions, 0..) |resolution, pkg_id| {
            if (resolution.tag != .workspace and resolution.tag != .root) continue;
            try workspace_pkg_ids.append(allocator, @intCast(pkg_id));
        }

        const converted_filters = converted_filters: {
            const buf = try allocator.alloc(FilterType, filters.len);
            for (filters, buf) |filter, *converted| {
                if ((filter.len == 1 and filter[0] == '*') or strings.eqlComptime(filter, "**")) {
                    converted.* = .all;
                    continue;
                }

                const is_path = filter.len > 0 and filter[0] == '.';

                const joined_filter = if (is_path)
                    strings.withoutTrailingSlash(path.joinAbsString(original_cwd, &[_]string{filter}, .posix))
                else
                    filter;

                if (joined_filter.len == 0) {
                    converted.* = FilterType.init(&.{}, is_path);
                    continue;
                }

                const length = bun.simdutf.length.utf32.from.utf8.le(joined_filter);
                const convert_buf = try allocator.alloc(u32, length);

                const convert_result = bun.simdutf.convert.utf8.to.utf32.with_errors.le(joined_filter, convert_buf);
                if (!convert_result.isSuccessful()) {
                    // nothing would match
                    converted.* = FilterType.init(&.{}, false);
                    continue;
                }

                converted.* = FilterType.init(convert_buf[0..convert_result.count], is_path);
            }
            break :converted_filters buf;
        };
        defer {
            for (converted_filters) |filter| {
                filter.deinit(allocator);
            }
            allocator.free(converted_filters);
        }

        // move all matched workspaces to front of array
        var i: usize = 0;
        while (i < workspace_pkg_ids.items.len) {
            const workspace_pkg_id = workspace_pkg_ids.items[i];

            const matched = matched: {
                for (converted_filters) |filter| {
                    switch (filter) {
                        .path => |pattern| {
                            if (pattern.len == 0) continue;
                            const res = pkg_resolutions[workspace_pkg_id];

                            const res_path = switch (res.tag) {
                                .workspace => res.value.workspace.slice(string_buf),
                                .root => FileSystem.instance.top_level_dir,
                                else => unreachable,
                            };

                            const abs_res_path = path.joinAbsString(FileSystem.instance.top_level_dir, &[_]string{res_path}, .posix);

                            if (!glob.matchImpl(pattern, strings.withoutTrailingSlash(abs_res_path)).matches()) {
                                break :matched false;
                            }
                        },
                        .name => |pattern| {
                            const name = pkg_names[workspace_pkg_id].slice(string_buf);

                            if (!glob.matchImpl(pattern, name).matches()) {
                                break :matched false;
                            }
                        },
                        .all => {},
                    }
                }

                break :matched true;
            };

            if (matched) {
                i += 1;
            } else {
                _ = workspace_pkg_ids.swapRemove(i);
            }
        }

        return workspace_pkg_ids.items;
    }

    fn printOutdatedInfoTable(
        manager: *PackageManager,
        workspace_pkg_ids: []const PackageID,
        was_filtered: bool,
        comptime enable_ansi_colors: bool,
    ) !void {
        const package_patterns = package_patterns: {
            const args = manager.options.positionals[1..];
            if (args.len == 0) break :package_patterns null;

            var at_least_one_greater_than_zero = false;

            const patterns_buf = bun.default_allocator.alloc(FilterType, args.len) catch bun.outOfMemory();
            for (args, patterns_buf) |arg, *converted| {
                if (arg.len == 0) {
                    converted.* = FilterType.init(&.{}, false);
                    continue;
                }

                if ((arg.len == 1 and arg[0] == '*') or strings.eqlComptime(arg, "**")) {
                    converted.* = .all;
                    at_least_one_greater_than_zero = true;
                    continue;
                }

                const length = bun.simdutf.length.utf32.from.utf8.le(arg);
                const convert_buf = bun.default_allocator.alloc(u32, length) catch bun.outOfMemory();

                const convert_result = bun.simdutf.convert.utf8.to.utf32.with_errors.le(arg, convert_buf);
                if (!convert_result.isSuccessful()) {
                    converted.* = FilterType.init(&.{}, false);
                    continue;
                }

                converted.* = FilterType.init(convert_buf[0..convert_result.count], false);
                at_least_one_greater_than_zero = at_least_one_greater_than_zero or convert_result.count > 0;
            }

            // nothing will match
            if (!at_least_one_greater_than_zero) return;

            break :package_patterns patterns_buf;
        };
        defer {
            if (package_patterns) |patterns| {
                for (patterns) |pattern| {
                    pattern.deinit(bun.default_allocator);
                }
                bun.default_allocator.free(patterns);
            }
        }

        var max_name: usize = 0;
        var max_current: usize = 0;
        var max_update: usize = 0;
        var max_latest: usize = 0;
        var max_workspace: usize = 0;

        const lockfile = manager.lockfile;
        const string_buf = lockfile.buffers.string_bytes.items;
        const dependencies = lockfile.buffers.dependencies.items;
        const packages = lockfile.packages.slice();
        const pkg_names = packages.items(.name);
        const pkg_resolutions = packages.items(.resolution);
        const pkg_dependencies = packages.items(.dependencies);

        var version_buf = std.ArrayList(u8).init(bun.default_allocator);
        defer version_buf.deinit();
        const version_writer = version_buf.writer();

        var outdated_ids: std.ArrayListUnmanaged(struct { package_id: PackageID, dep_id: DependencyID, workspace_pkg_id: PackageID }) = .{};
        defer outdated_ids.deinit(manager.allocator);

        for (workspace_pkg_ids) |workspace_pkg_id| {
            const pkg_deps = pkg_dependencies[workspace_pkg_id];
            for (pkg_deps.begin()..pkg_deps.end()) |dep_id| {
                const package_id = lockfile.buffers.resolutions.items[dep_id];
                if (package_id == invalid_package_id) continue;
                const dep = lockfile.buffers.dependencies.items[dep_id];
                if (dep.version.tag != .npm and dep.version.tag != .dist_tag) continue;
                const resolution = pkg_resolutions[package_id];
                if (resolution.tag != .npm) continue;

                // package patterns match against dependency name (name in package.json)
                if (package_patterns) |patterns| {
                    const match = match: {
                        for (patterns) |pattern| {
                            switch (pattern) {
                                .path => unreachable,
                                .name => |name_pattern| {
                                    if (name_pattern.len == 0) continue;
                                    if (!glob.matchImpl(name_pattern, dep.name.slice(string_buf)).matches()) {
                                        break :match false;
                                    }
                                },
                                .all => {},
                            }
                        }

                        break :match true;
                    };
                    if (!match) {
                        continue;
                    }
                }

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

                if (resolution.value.npm.version.order(latest.version, string_buf, manifest.string_buf) != .lt) continue;

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

                const workspace_name = pkg_names[workspace_pkg_id].slice(string_buf);
                if (workspace_name.len > max_workspace) max_workspace = workspace_name.len;

                outdated_ids.append(
                    bun.default_allocator,
                    .{
                        .package_id = package_id,
                        .dep_id = @intCast(dep_id),
                        .workspace_pkg_id = workspace_pkg_id,
                    },
                ) catch bun.outOfMemory();
            }
        }

        if (outdated_ids.items.len == 0) return;

        const package_column_inside_length = @max("Packages".len, max_name);
        const current_column_inside_length = @max("Current".len, max_current);
        const update_column_inside_length = @max("Update".len, max_update);
        const latest_column_inside_length = @max("Latest".len, max_latest);
        const workspace_column_inside_length = @max("Workspace".len, max_workspace);

        const column_left_pad = 1;
        const column_right_pad = 1;

        const table = Table("blue", column_left_pad, column_right_pad, enable_ansi_colors).init(
            &if (was_filtered)
                [_][]const u8{
                    "Package",
                    "Current",
                    "Update",
                    "Latest",
                    "Workspace",
                }
            else
                [_][]const u8{
                    "Package",
                    "Current",
                    "Update",
                    "Latest",
                },
            &if (was_filtered)
                [_]usize{
                    package_column_inside_length,
                    current_column_inside_length,
                    update_column_inside_length,
                    latest_column_inside_length,
                    workspace_column_inside_length,
                }
            else
                [_]usize{
                    package_column_inside_length,
                    current_column_inside_length,
                    update_column_inside_length,
                    latest_column_inside_length,
                },
        );

        table.printTopLineSeparator();
        table.printColumnNames();

        for (workspace_pkg_ids) |workspace_pkg_id| {
            inline for (
                .{
                    Behavior{ .normal = true },
                    Behavior{ .dev = true },
                    Behavior{ .peer = true },
                    Behavior{ .optional = true },
                },
            ) |group_behavior| {
                for (outdated_ids.items) |ids| {
                    if (workspace_pkg_id != ids.workspace_pkg_id) continue;
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

                    if (was_filtered) {
                        Output.pretty("{s}", .{table.verticalEdge()});
                        for (0..column_left_pad) |_| Output.pretty(" ", .{});

                        const workspace_name = pkg_names[workspace_pkg_id].slice(string_buf);
                        Output.pretty("{s}", .{workspace_name});

                        for (workspace_name.len..workspace_column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
                    }

                    Output.pretty("{s}\n", .{table.verticalEdge()});
                }
            }
        }

        table.printBottomLineSeparator();
    }

    fn updateManifestsIfNecessary(
        manager: *PackageManager,
        comptime log_level: PackageManager.Options.LogLevel,
        workspace_pkg_ids: []const PackageID,
    ) !void {
        const lockfile = manager.lockfile;
        const resolutions = lockfile.buffers.resolutions.items;
        const dependencies = lockfile.buffers.dependencies.items;
        const string_buf = lockfile.buffers.string_bytes.items;
        const packages = lockfile.packages.slice();
        const pkg_resolutions = packages.items(.resolution);
        const pkg_names = packages.items(.name);
        const pkg_dependencies = packages.items(.dependencies);

        for (workspace_pkg_ids) |workspace_pkg_id| {
            const pkg_deps = pkg_dependencies[workspace_pkg_id];
            for (pkg_deps.begin()..pkg_deps.end()) |dep_id| {
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

            if (manager.pendingTaskCount() > 1) {
                try manager.runTasks(
                    *PackageManager,
                    manager,
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
                );
            }
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
