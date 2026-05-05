pub const OutdatedCommand = struct {
    const OutdatedInfo = struct {
        package_id: PackageID,
        dep_id: DependencyID,
        workspace_pkg_id: PackageID,
        is_catalog: bool,
    };

    pub fn exec(ctx: Command.Context) !void {
        Output.prettyln("<r><b>bun outdated <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
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

        try outdated(ctx, original_cwd, manager);
    }

    fn outdated(ctx: Command.Context, original_cwd: string, manager: *PackageManager) !void {
        const load_lockfile_result = manager.lockfile.loadFromCwd(
            manager,
            manager.allocator,
            manager.log,
            true,
        );

        manager.lockfile = switch (load_lockfile_result) {
            .not_found => {
                if (manager.options.log_level != .silent) {
                    Output.errGeneric("missing lockfile, nothing outdated", .{});
                }
                Global.crash();
            },
            .err => |cause| {
                if (manager.options.log_level != .silent) {
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
                        try manager.log.print(Output.errorWriter());
                    }
                }

                Global.crash();
            },
            .ok => |ok| ok.lockfile,
        };

        switch (Output.enable_ansi_colors_stdout) {
            inline else => |enable_ansi_colors| {
                if (manager.options.filter_patterns.len > 0) {
                    const filters = manager.options.filter_patterns;
                    const workspace_pkg_ids = findMatchingWorkspaces(
                        bun.default_allocator,
                        original_cwd,
                        manager,
                        filters,
                    ) catch |err| bun.handleOom(err);
                    defer bun.default_allocator.free(workspace_pkg_ids);

                    try manager.populateManifestCache(.{ .ids = workspace_pkg_ids });
                    try printOutdatedInfoTable(manager, workspace_pkg_ids, true, enable_ansi_colors);
                } else if (manager.options.do.recursive) {
                    const all_workspaces = bun.handleOom(getAllWorkspaces(bun.default_allocator, manager));
                    defer bun.default_allocator.free(all_workspaces);

                    try manager.populateManifestCache(.{ .ids = all_workspaces });
                    try printOutdatedInfoTable(manager, all_workspaces, true, enable_ansi_colors);
                } else {
                    const root_pkg_id = manager.root_package_id.get(manager.lockfile, manager.workspace_name_hash);
                    if (root_pkg_id == invalid_package_id) return;

                    try manager.populateManifestCache(.{ .ids = &.{root_pkg_id} });
                    try printOutdatedInfoTable(manager, &.{root_pkg_id}, false, enable_ansi_colors);
                }
            },
        }
    }

    // TODO: use in `bun pack, publish, run, ...`
    const FilterType = union(enum) {
        all,
        name: []const u8,
        path: []const u8,

        pub fn init(pattern: []const u8, is_path: bool) @This() {
            return if (is_path) .{
                .path = pattern,
            } else .{
                .name = pattern,
            };
        }

        /// *NOTE*: Currently this does nothing since name and path are not
        /// allocated.
        pub fn deinit(_: @This(), _: std.mem.Allocator) void {}
    };

    fn getAllWorkspaces(
        allocator: std.mem.Allocator,
        manager: *PackageManager,
    ) OOM![]const PackageID {
        const lockfile = manager.lockfile;
        const packages = lockfile.packages.slice();
        const pkg_resolutions = packages.items(.resolution);

        var workspace_pkg_ids: std.ArrayListUnmanaged(PackageID) = .{};
        for (pkg_resolutions, 0..) |resolution, pkg_id| {
            if (resolution.tag != .workspace and resolution.tag != .root) continue;
            try workspace_pkg_ids.append(allocator, @intCast(pkg_id));
        }

        return workspace_pkg_ids.toOwnedSlice(allocator);
    }

    fn findMatchingWorkspaces(
        allocator: std.mem.Allocator,
        original_cwd: string,
        manager: *PackageManager,
        filters: []const string,
    ) OOM![]const PackageID {
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

        var path_buf: bun.PathBuffer = undefined;

        const converted_filters = converted_filters: {
            const buf = try allocator.alloc(WorkspaceFilter, filters.len);
            for (filters, buf) |filter, *converted| {
                converted.* = try WorkspaceFilter.init(allocator, filter, original_cwd, &path_buf);
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

                            const abs_res_path = path.joinAbsStringBuf(FileSystem.instance.top_level_dir, &path_buf, &[_]string{res_path}, .posix);

                            if (!glob.match(pattern, strings.withoutTrailingSlash(abs_res_path)).matches()) {
                                break :matched false;
                            }
                        },
                        .name => |pattern| {
                            const name = pkg_names[workspace_pkg_id].slice(string_buf);

                            if (!glob.match(pattern, name).matches()) {
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

    const GroupedOutdatedInfo = struct {
        package_id: PackageID,
        dep_id: DependencyID,
        workspace_pkg_id: PackageID,
        is_catalog: bool,
        grouped_workspace_names: ?[]const u8,
    };

    fn groupCatalogDependencies(
        manager: *PackageManager,
        outdated_items: []const OutdatedInfo,
        _: []const PackageID,
    ) !std.ArrayListUnmanaged(GroupedOutdatedInfo) {
        const allocator = bun.default_allocator;
        const lockfile = manager.lockfile;
        const string_buf = lockfile.buffers.string_bytes.items;
        const packages = lockfile.packages.slice();
        const pkg_names = packages.items(.name);
        const dependencies = lockfile.buffers.dependencies.items;

        var result = std.ArrayListUnmanaged(GroupedOutdatedInfo){};

        const CatalogKey = struct {
            name_hash: u64,
            catalog_name_hash: u64,
            behavior: Behavior,
        };
        var catalog_map = std.AutoHashMap(CatalogKey, std.array_list.Managed(PackageID)).init(allocator);
        defer catalog_map.deinit();
        defer {
            var iter = catalog_map.iterator();
            while (iter.next()) |entry| {
                entry.value_ptr.deinit();
            }
        }
        for (outdated_items) |item| {
            if (item.is_catalog) {
                const dep = dependencies[item.dep_id];
                const name_hash = bun.hash(dep.name.slice(string_buf));
                const catalog_name = dep.version.value.catalog.slice(string_buf);
                const catalog_name_hash = bun.hash(catalog_name);
                const key = CatalogKey{ .name_hash = name_hash, .catalog_name_hash = catalog_name_hash, .behavior = dep.behavior };

                const entry = try catalog_map.getOrPut(key);
                if (!entry.found_existing) {
                    entry.value_ptr.* = std.array_list.Managed(PackageID).init(allocator);
                }
                try entry.value_ptr.append(item.workspace_pkg_id);
            } else {
                try result.append(allocator, .{
                    .package_id = item.package_id,
                    .dep_id = item.dep_id,
                    .workspace_pkg_id = item.workspace_pkg_id,
                    .is_catalog = false,
                    .grouped_workspace_names = null,
                });
            }
        }

        // Second pass: add grouped catalog dependencies
        for (outdated_items) |item| {
            if (!item.is_catalog) continue;

            const dep = dependencies[item.dep_id];
            const name_hash = bun.hash(dep.name.slice(string_buf));
            const catalog_name = dep.version.value.catalog.slice(string_buf);
            const catalog_name_hash = bun.hash(catalog_name);
            const key = CatalogKey{ .name_hash = name_hash, .catalog_name_hash = catalog_name_hash, .behavior = dep.behavior };

            const workspace_list = catalog_map.get(key) orelse continue;

            if (workspace_list.items[0] != item.workspace_pkg_id) continue;
            var workspace_names = std.array_list.Managed(u8).init(allocator);
            defer workspace_names.deinit();

            const cat_name = dep.version.value.catalog.slice(string_buf);
            if (cat_name.len > 0) {
                try workspace_names.appendSlice("catalog:");
                try workspace_names.appendSlice(cat_name);
                try workspace_names.appendSlice(" (");
            } else {
                try workspace_names.appendSlice("catalog (");
            }
            for (workspace_list.items, 0..) |workspace_id, i| {
                if (i > 0) try workspace_names.appendSlice(", ");
                const workspace_name = pkg_names[workspace_id].slice(string_buf);
                try workspace_names.appendSlice(workspace_name);
            }
            try workspace_names.append(')');

            try result.append(allocator, .{
                .package_id = item.package_id,
                .dep_id = item.dep_id,
                .workspace_pkg_id = item.workspace_pkg_id,
                .is_catalog = true,
                .grouped_workspace_names = try workspace_names.toOwnedSlice(),
            });
        }

        return result;
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

            const patterns_buf = bun.handleOom(bun.default_allocator.alloc(FilterType, args.len));
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

                converted.* = FilterType.init(arg, false);
                at_least_one_greater_than_zero = at_least_one_greater_than_zero or arg.len > 0;
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
        var has_filtered_versions: bool = false;

        const lockfile = manager.lockfile;
        const string_buf = lockfile.buffers.string_bytes.items;
        const dependencies = lockfile.buffers.dependencies.items;
        const packages = lockfile.packages.slice();
        const pkg_names = packages.items(.name);
        const pkg_resolutions = packages.items(.resolution);
        const pkg_dependencies = packages.items(.dependencies);

        var version_buf = std.array_list.Managed(u8).init(bun.default_allocator);
        defer version_buf.deinit();
        const version_writer = version_buf.writer();

        var outdated_ids: std.ArrayListUnmanaged(OutdatedInfo) = .{};
        defer outdated_ids.deinit(manager.allocator);

        for (workspace_pkg_ids) |workspace_pkg_id| {
            const pkg_deps = pkg_dependencies[workspace_pkg_id];
            for (pkg_deps.begin()..pkg_deps.end()) |dep_id| {
                const package_id = lockfile.buffers.resolutions.items[dep_id];
                if (package_id == invalid_package_id) continue;
                const dep = &lockfile.buffers.dependencies.items[dep_id];
                const resolved_version = manager.lockfile.resolveCatalogDependency(dep) orelse continue;
                if (resolved_version.tag != .npm and resolved_version.tag != .dist_tag) continue;
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
                                    if (!glob.match(name_pattern, dep.name.slice(string_buf)).matches()) {
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
                    manager,
                    manager.scopeForPackageName(package_name),
                    package_name,
                    &expired,
                    .load_from_memory_fallback_to_disk,
                    manager.options.minimum_release_age_ms != null,
                ) orelse continue;

                const actual_latest = manifest.findByDistTag("latest") orelse continue;

                const latest = manifest.findByDistTagWithFilter("latest", manager.options.minimum_release_age_ms, manager.options.minimum_release_age_excludes);

                const update_version = if (resolved_version.tag == .npm)
                    manifest.findBestVersionWithFilter(resolved_version.value.npm.version, string_buf, manager.options.minimum_release_age_ms, manager.options.minimum_release_age_excludes)
                else
                    manifest.findByDistTagWithFilter(resolved_version.value.dist_tag.tag.slice(string_buf), manager.options.minimum_release_age_ms, manager.options.minimum_release_age_excludes);

                if (resolution.value.npm.version.order(actual_latest.version, string_buf, manifest.string_buf) != .lt) continue;

                const has_filtered_update = update_version.latestIsFiltered();
                const has_filtered_latest = latest.latestIsFiltered();
                if (has_filtered_update or has_filtered_latest) has_filtered_versions = true;

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

                bun.handleOom(version_writer.print("{f}", .{resolution.value.npm.version.fmt(string_buf)}));
                if (version_buf.items.len > max_current) max_current = version_buf.items.len;
                version_buf.clearRetainingCapacity();

                if (update_version.unwrap()) |update_version_| {
                    bun.handleOom(version_writer.print("{f}", .{update_version_.version.fmt(manifest.string_buf)}));
                } else {
                    bun.handleOom(version_writer.print("{f}", .{resolution.value.npm.version.fmt(manifest.string_buf)}));
                }
                const update_version_len = version_buf.items.len + (if (has_filtered_update) " *".len else 0);
                if (update_version_len > max_update) max_update = update_version_len;
                version_buf.clearRetainingCapacity();

                if (latest.unwrap()) |latest_version| {
                    bun.handleOom(version_writer.print("{f}", .{latest_version.version.fmt(manifest.string_buf)}));
                } else {
                    bun.handleOom(version_writer.print("{f}", .{resolution.value.npm.version.fmt(manifest.string_buf)}));
                }
                const latest_version_len = version_buf.items.len + (if (has_filtered_latest) " *".len else 0);
                if (latest_version_len > max_latest) max_latest = latest_version_len;
                version_buf.clearRetainingCapacity();

                const workspace_name = pkg_names[workspace_pkg_id].slice(string_buf);
                if (workspace_name.len > max_workspace) max_workspace = workspace_name.len;

                outdated_ids.append(
                    bun.default_allocator,
                    .{
                        .package_id = package_id,
                        .dep_id = @intCast(dep_id),
                        .workspace_pkg_id = workspace_pkg_id,
                        .is_catalog = dep.version.tag == .catalog,
                    },
                ) catch |err| bun.handleOom(err);
            }
        }

        if (outdated_ids.items.len == 0) return;

        // Group catalog dependencies
        var grouped_ids = try groupCatalogDependencies(manager, outdated_ids.items, workspace_pkg_ids);
        defer grouped_ids.deinit(bun.default_allocator);

        // Recalculate max workspace length after grouping
        var new_max_workspace: usize = max_workspace;
        var has_catalog_deps = false;
        for (grouped_ids.items) |item| {
            if (item.grouped_workspace_names) |names| {
                if (names.len > new_max_workspace) new_max_workspace = names.len;
                has_catalog_deps = true;
            }
        }

        // Show workspace column if filtered OR if there are catalog dependencies
        const show_workspace_column = was_filtered or has_catalog_deps;

        const package_column_inside_length = @max("Packages".len, max_name);
        const current_column_inside_length = @max("Current".len, max_current);
        const update_column_inside_length = @max("Update".len, max_update);
        const latest_column_inside_length = @max("Latest".len, max_latest);
        const workspace_column_inside_length = @max("Workspace".len, new_max_workspace);

        const column_left_pad = 1;
        const column_right_pad = 1;

        const table = Table("blue", column_left_pad, column_right_pad, enable_ansi_colors).init(
            &if (show_workspace_column)
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
            &if (show_workspace_column)
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

        // Print grouped items sorted by behavior type
        inline for ([_]Behavior{
            .{ .prod = true },
            .{ .dev = true },
            .{ .peer = true },
            .{ .optional = true },
        }) |group_behavior| {
            for (grouped_ids.items) |item| {
                const package_id = item.package_id;
                const dep_id = item.dep_id;

                const dep = &dependencies[dep_id];
                if (!dep.behavior.includes(group_behavior)) continue;

                const package_name = pkg_names[package_id].slice(string_buf);
                const resolution = pkg_resolutions[package_id];

                var expired = false;
                const manifest = manager.manifests.byNameAllowExpired(
                    manager,
                    manager.scopeForPackageName(package_name),
                    package_name,
                    &expired,
                    .load_from_memory_fallback_to_disk,
                    manager.options.minimum_release_age_ms != null,
                ) orelse continue;

                const latest = manifest.findByDistTagWithFilter("latest", manager.options.minimum_release_age_ms, manager.options.minimum_release_age_excludes);
                const resolved_version = manager.lockfile.resolveCatalogDependency(dep) orelse continue;
                const update = if (resolved_version.tag == .npm)
                    manifest.findBestVersionWithFilter(resolved_version.value.npm.version, string_buf, manager.options.minimum_release_age_ms, manager.options.minimum_release_age_excludes)
                else
                    manifest.findByDistTagWithFilter(resolved_version.value.dist_tag.tag.slice(string_buf), manager.options.minimum_release_age_ms, manager.options.minimum_release_age_excludes);

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

                    Output.pretty("{s}", .{table.symbols.verticalEdge()});
                    for (0..column_left_pad) |_| Output.pretty(" ", .{});

                    Output.pretty("{s}<d>{s}<r>", .{ package_name, behavior_str });
                    for (package_name.len + behavior_str.len..package_column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
                }

                {
                    // current version
                    Output.pretty("{s}", .{table.symbols.verticalEdge()});
                    for (0..column_left_pad) |_| Output.pretty(" ", .{});

                    bun.handleOom(version_writer.print("{f}", .{resolution.value.npm.version.fmt(string_buf)}));
                    Output.pretty("{s}", .{version_buf.items});
                    for (version_buf.items.len..current_column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
                    version_buf.clearRetainingCapacity();
                }

                {
                    // update version
                    Output.pretty("{s}", .{table.symbols.verticalEdge()});
                    for (0..column_left_pad) |_| Output.pretty(" ", .{});
                    if (update.unwrap()) |update_version| {
                        bun.handleOom(version_writer.print("{f}", .{update_version.version.fmt(manifest.string_buf)}));
                        Output.pretty("{f}", .{update_version.version.diffFmt(resolution.value.npm.version, manifest.string_buf, string_buf)});
                    } else {
                        bun.handleOom(version_writer.print("{f}", .{resolution.value.npm.version.fmt(string_buf)}));
                        Output.pretty("<d>{s}<r>", .{version_buf.items});
                    }
                    var update_version_len: usize = version_buf.items.len;
                    if (update.latestIsFiltered()) {
                        Output.pretty(" <blue>*<r>", .{});
                        update_version_len += " *".len;
                    }
                    for (update_version_len..update_column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
                    version_buf.clearRetainingCapacity();
                }

                {
                    // latest version
                    Output.pretty("{s}", .{table.symbols.verticalEdge()});
                    for (0..column_left_pad) |_| Output.pretty(" ", .{});
                    if (latest.unwrap()) |latest_version| {
                        bun.handleOom(version_writer.print("{f}", .{latest_version.version.fmt(manifest.string_buf)}));
                        Output.pretty("{f}", .{latest_version.version.diffFmt(resolution.value.npm.version, manifest.string_buf, string_buf)});
                    } else {
                        bun.handleOom(version_writer.print("{f}", .{resolution.value.npm.version.fmt(string_buf)}));
                        Output.pretty("<d>{s}<r>", .{version_buf.items});
                    }
                    var latest_version_len: usize = version_buf.items.len;
                    if (latest.latestIsFiltered()) {
                        Output.pretty(" <blue>*<r>", .{});
                        latest_version_len += " *".len;
                    }
                    for (latest_version_len..latest_column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
                    version_buf.clearRetainingCapacity();
                }

                if (show_workspace_column) {
                    Output.pretty("{s}", .{table.symbols.verticalEdge()});
                    for (0..column_left_pad) |_| Output.pretty(" ", .{});

                    const workspace_name = if (item.grouped_workspace_names) |names|
                        names
                    else
                        pkg_names[item.workspace_pkg_id].slice(string_buf);
                    Output.pretty("{s}", .{workspace_name});

                    for (workspace_name.len..workspace_column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
                }

                Output.pretty("{s}\n", .{table.symbols.verticalEdge()});
            }
        }

        table.printBottomLineSeparator();

        if (has_filtered_versions) {
            Output.prettyln("<d><b>Note:<r> <d>The <r><blue>*<r><d> indicates that version isn't true latest due to minimum release age<r>", .{});
        }
    }
};

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const OOM = bun.OOM;
const Output = bun.Output;
const PathBuffer = bun.PathBuffer;
const glob = bun.glob;
const path = bun.path;
const strings = bun.strings;
const Command = bun.cli.Command;
const FileSystem = bun.fs.FileSystem;
const Table = bun.fmt.Table;

const Install = bun.install;
const DependencyID = Install.DependencyID;
const PackageID = Install.PackageID;
const invalid_package_id = Install.invalid_package_id;
const Behavior = Install.Dependency.Behavior;

const PackageManager = Install.PackageManager;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
