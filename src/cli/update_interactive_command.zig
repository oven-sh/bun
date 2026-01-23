pub const TerminalHyperlink = struct {
    link: []const u8,
    text: []const u8,
    enabled: bool,

    pub fn new(link: []const u8, text: []const u8, enabled: bool) TerminalHyperlink {
        return TerminalHyperlink{
            .link = link,
            .text = text,
            .enabled = enabled,
        };
    }

    pub fn format(this: @This(), writer: *std.Io.Writer) !void {
        if (this.enabled) {
            const ESC = "\x1b";
            const OSC8 = ESC ++ "]8;;";
            const ST = ESC ++ "\\";
            const link_fmt_string = OSC8 ++ "{s}" ++ ST ++ "{s}" ++ OSC8 ++ ST;
            try writer.print(link_fmt_string, .{ this.link, this.text });
        } else {
            try writer.print("{s}", .{this.text});
        }
    }
};

pub const UpdateInteractiveCommand = struct {
    const OutdatedPackage = struct {
        name: []const u8,
        current_version: []const u8,
        latest_version: []const u8,
        update_version: []const u8,
        package_id: PackageID,
        dep_id: DependencyID,
        workspace_pkg_id: PackageID,
        dependency_type: []const u8,
        workspace_name: []const u8,
        behavior: Behavior,
        use_latest: bool = false,
        manager: *PackageManager,
        is_catalog: bool = false,
        catalog_name: ?[]const u8 = null,
    };

    const CatalogUpdate = struct {
        version: []const u8,
        workspace_path: []const u8,
    };

    // Common utility functions to reduce duplication

    fn buildPackageJsonPath(root_dir: []const u8, workspace_path: []const u8, path_buf: *bun.PathBuffer) []const u8 {
        if (workspace_path.len > 0) {
            return bun.path.joinAbsStringBuf(
                root_dir,
                path_buf,
                &[_]string{ workspace_path, "package.json" },
                .auto,
            );
        } else {
            return bun.path.joinAbsStringBuf(
                root_dir,
                path_buf,
                &[_]string{"package.json"},
                .auto,
            );
        }
    }

    // Helper to update a catalog entry at a specific path in the package.json AST
    fn savePackageJson(
        manager: *PackageManager,
        package_json: anytype, // MapEntry from WorkspacePackageJSONCache
        package_json_path: []const u8,
    ) !void {
        const preserve_trailing_newline = package_json.*.source.contents.len > 0 and
            package_json.*.source.contents[package_json.*.source.contents.len - 1] == '\n';

        var buffer_writer = JSPrinter.BufferWriter.init(manager.allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(manager.allocator, package_json.*.source.contents.len + 1);
        buffer_writer.append_newline = preserve_trailing_newline;
        var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

        _ = JSPrinter.printJSON(
            @TypeOf(&package_json_writer),
            &package_json_writer,
            package_json.*.root,
            &package_json.*.source,
            .{
                .indent = package_json.*.indentation,
                .mangled_props = null,
            },
        ) catch |err| {
            Output.errGeneric("Failed to serialize package.json: {s}", .{@errorName(err)});
            return err;
        };

        const new_package_json_source = try manager.allocator.dupe(u8, package_json_writer.ctx.writtenWithoutTrailingZero());

        // Write the updated package.json
        const write_file = std.fs.cwd().createFile(package_json_path, .{}) catch |err| {
            manager.allocator.free(new_package_json_source);
            Output.errGeneric("Failed to write package.json at {s}: {s}", .{ package_json_path, @errorName(err) });
            return err;
        };
        defer write_file.close();

        write_file.writeAll(new_package_json_source) catch |err| {
            manager.allocator.free(new_package_json_source);
            Output.errGeneric("Failed to write package.json at {s}: {s}", .{ package_json_path, @errorName(err) });
            return err;
        };

        // Update the cache so installWithManager sees the new package.json
        // This is critical - without this, installWithManager will use the cached old version
        package_json.*.source.contents = new_package_json_source;
    }

    pub fn exec(ctx: Command.Context) !void {
        Output.prettyln("<r><b>bun update --interactive <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
        Output.flush();

        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .update);

        const manager, const original_cwd = PackageManager.init(ctx, cli, .update) catch |err| {
            if (!cli.silent) {
                if (err == error.MissingPackageJSON) {
                    Output.errGeneric("missing package.json, nothing outdated", .{});
                }
                Output.errGeneric("failed to initialize bun install: {s}", .{@errorName(err)});
            }

            Global.crash();
        };
        defer ctx.allocator.free(original_cwd);

        try updateInteractive(ctx, original_cwd, manager);
    }

    const PackageUpdate = struct {
        name: []const u8,
        target_version: []const u8,
        dep_type: []const u8, // "dependencies", "devDependencies", etc.
        workspace_path: []const u8,
        original_version: []const u8,
        package_id: PackageID,
    };

    fn updatePackageJsonFilesFromUpdates(
        manager: *PackageManager,
        updates: []const PackageUpdate,
    ) !void {
        // Group updates by workspace
        var workspace_groups = bun.StringHashMap(std.array_list.Managed(PackageUpdate)).init(bun.default_allocator);
        defer {
            var it = workspace_groups.iterator();
            while (it.next()) |entry| {
                entry.value_ptr.deinit();
            }
            workspace_groups.deinit();
        }

        // Group updates by workspace path
        for (updates) |update| {
            const result = try workspace_groups.getOrPut(update.workspace_path);
            if (!result.found_existing) {
                result.value_ptr.* = std.array_list.Managed(PackageUpdate).init(bun.default_allocator);
            }
            try result.value_ptr.append(update);
        }

        // Process each workspace
        var it = workspace_groups.iterator();
        while (it.next()) |entry| {
            const workspace_path = entry.key_ptr.*;
            const workspace_updates = entry.value_ptr.items;

            // Build the package.json path for this workspace
            const root_dir = FileSystem.instance.top_level_dir;
            var path_buf: bun.PathBuffer = undefined;
            const package_json_path = buildPackageJsonPath(root_dir, workspace_path, &path_buf);

            // Load and parse the package.json
            var package_json = switch (manager.workspace_package_json_cache.getWithPath(
                manager.allocator,
                manager.log,
                package_json_path,
                .{ .guess_indentation = true },
            )) {
                .parse_err => |err| {
                    Output.errGeneric("Failed to parse package.json at {s}: {s}", .{ package_json_path, @errorName(err) });
                    continue;
                },
                .read_err => |err| {
                    Output.errGeneric("Failed to read package.json at {s}: {s}", .{ package_json_path, @errorName(err) });
                    continue;
                },
                .entry => |package_entry| package_entry,
            };

            var modified = false;

            // Update each package in this workspace's package.json
            for (workspace_updates) |update| {
                // Find the package in the correct dependency section
                if (package_json.root.data == .e_object) {
                    if (package_json.root.asProperty(update.dep_type)) |section_query| {
                        if (section_query.expr.data == .e_object) {
                            const dep_obj = &section_query.expr.data.e_object;
                            if (section_query.expr.asProperty(update.name)) |version_query| {
                                if (version_query.expr.data == .e_string) {
                                    // Get the original version to preserve prefix
                                    const original_version = version_query.expr.data.e_string.data;

                                    // Preserve the version prefix from the original
                                    const version_with_prefix = try preserveVersionPrefix(original_version, update.target_version, manager.allocator);

                                    // Update the version using hash map put
                                    const new_expr = try Expr.init(
                                        E.String,
                                        E.String{ .data = version_with_prefix },
                                        version_query.expr.loc,
                                    ).clone(manager.allocator);
                                    try dep_obj.*.put(manager.allocator, update.name, new_expr);
                                    modified = true;
                                }
                            }
                        }
                    }
                }
            }

            // Write the updated package.json if modified
            if (modified) {
                try savePackageJson(manager, &package_json, package_json_path);
            }
        }
    }

    fn updateCatalogDefinitions(
        manager: *PackageManager,
        catalog_updates: bun.StringHashMap(CatalogUpdate),
    ) !void {

        // Group catalog updates by workspace path
        var workspace_catalog_updates = bun.StringHashMap(std.array_list.Managed(CatalogUpdateRequest)).init(bun.default_allocator);
        defer {
            var it = workspace_catalog_updates.iterator();
            while (it.next()) |entry| {
                entry.value_ptr.deinit();
            }
            workspace_catalog_updates.deinit();
        }

        // Group updates by workspace
        var catalog_it = catalog_updates.iterator();
        while (catalog_it.next()) |entry| {
            const catalog_key = entry.key_ptr.*;
            const update = entry.value_ptr.*;

            const result = try workspace_catalog_updates.getOrPut(update.workspace_path);
            if (!result.found_existing) {
                result.value_ptr.* = std.array_list.Managed(CatalogUpdateRequest).init(bun.default_allocator);
            }

            // Parse catalog_key (format: "package_name" or "package_name:catalog_name")
            const colon_index = std.mem.indexOf(u8, catalog_key, ":");
            const package_name = if (colon_index) |idx| catalog_key[0..idx] else catalog_key;
            const catalog_name = if (colon_index) |idx| catalog_key[idx + 1 ..] else null;

            try result.value_ptr.append(.{
                .package_name = package_name,
                .new_version = update.version,
                .catalog_name = catalog_name,
            });
        }

        // Update catalog definitions for each workspace
        var workspace_it = workspace_catalog_updates.iterator();
        while (workspace_it.next()) |workspace_entry| {
            const workspace_path = workspace_entry.key_ptr.*;
            const updates_for_workspace = workspace_entry.value_ptr.*;

            // Build the package.json path for this workspace
            const root_dir = FileSystem.instance.top_level_dir;
            var path_buf: bun.PathBuffer = undefined;
            const package_json_path = buildPackageJsonPath(root_dir, workspace_path, &path_buf);

            // Load and parse the package.json properly
            var package_json = switch (manager.workspace_package_json_cache.getWithPath(
                manager.allocator,
                manager.log,
                package_json_path,
                .{ .guess_indentation = true },
            )) {
                .parse_err => |err| {
                    Output.errGeneric("Failed to parse package.json at {s}: {s}", .{ package_json_path, @errorName(err) });
                    continue;
                },
                .read_err => |err| {
                    Output.errGeneric("Failed to read package.json at {s}: {s}", .{ package_json_path, @errorName(err) });
                    continue;
                },
                .entry => |entry| entry,
            };

            // Use the PackageJSONEditor to update catalogs
            try editCatalogDefinitions(manager, updates_for_workspace.items, &package_json.root);

            // Save the updated package.json
            try savePackageJson(manager, &package_json, package_json_path);
        }
    }

    fn updateInteractive(ctx: Command.Context, original_cwd: string, manager: *PackageManager) !void {
        // make the package manager things think we are actually in root dir
        // _ = bun.sys.chdir(manager.root_dir.dir, manager.root_dir.dir);

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

        const workspace_pkg_ids = if (manager.options.filter_patterns.len > 0) blk: {
            const filters = manager.options.filter_patterns;
            break :blk findMatchingWorkspaces(
                bun.default_allocator,
                original_cwd,
                manager,
                filters,
            ) catch |err| bun.handleOom(err);
        } else if (manager.options.do.recursive) blk: {
            break :blk bun.handleOom(getAllWorkspaces(bun.default_allocator, manager));
        } else blk: {
            const root_pkg_id = manager.root_package_id.get(manager.lockfile, manager.workspace_name_hash);
            if (root_pkg_id == invalid_package_id) return;

            const ids = bun.handleOom(bun.default_allocator.alloc(PackageID, 1));
            ids[0] = root_pkg_id;
            break :blk ids;
        };
        defer bun.default_allocator.free(workspace_pkg_ids);

        try manager.populateManifestCache(.{ .ids = workspace_pkg_ids });

        // Get outdated packages
        const outdated_packages = try getOutdatedPackages(bun.default_allocator, manager, workspace_pkg_ids);
        defer {
            for (outdated_packages) |pkg| {
                bun.default_allocator.free(pkg.name);
                bun.default_allocator.free(pkg.current_version);
                bun.default_allocator.free(pkg.latest_version);
                bun.default_allocator.free(pkg.update_version);
                bun.default_allocator.free(pkg.workspace_name);
            }
            bun.default_allocator.free(outdated_packages);
        }

        if (outdated_packages.len == 0) {
            // No packages need updating - just exit silently
            Output.prettyln("<r><green>✓<r> All packages are up to date!", .{});
            return;
        }

        // Prompt user to select packages
        const selected = try promptForUpdates(bun.default_allocator, outdated_packages);
        defer bun.default_allocator.free(selected);

        // Create package specifier array from selected packages
        // Group selected packages by workspace
        var workspace_updates = bun.StringHashMap(std.array_list.Managed([]const u8)).init(bun.default_allocator);
        defer {
            var it = workspace_updates.iterator();
            while (it.next()) |entry| {
                entry.value_ptr.deinit();
            }
            workspace_updates.deinit();
        }

        // Track catalog updates separately (catalog_key -> {version, workspace_path})
        var catalog_updates = bun.StringHashMap(CatalogUpdate).init(bun.default_allocator);
        defer {
            var it = catalog_updates.iterator();
            while (it.next()) |entry| {
                bun.default_allocator.free(entry.key_ptr.*);
                bun.default_allocator.free(entry.value_ptr.*.version);
                bun.default_allocator.free(entry.value_ptr.*.workspace_path);
            }
            catalog_updates.deinit();
        }

        // Collect all package updates with full information
        var package_updates = std.array_list.Managed(PackageUpdate).init(bun.default_allocator);
        defer package_updates.deinit();

        // Process selected packages
        for (outdated_packages, selected) |pkg, is_selected| {
            if (!is_selected) continue;

            // Use latest version if requested
            const target_version = if (pkg.use_latest)
                pkg.latest_version
            else
                pkg.update_version;

            if (strings.eql(pkg.current_version, target_version)) {
                continue;
            }

            // For catalog dependencies, we need to collect them separately
            // to update the catalog definitions in the root or workspace package.json
            if (pkg.is_catalog) {
                // Store catalog updates for later processing
                const catalog_key = if (pkg.catalog_name) |catalog_name|
                    try std.fmt.allocPrint(bun.default_allocator, "{s}:{s}", .{ pkg.name, catalog_name })
                else
                    pkg.name;

                // For catalog dependencies, we always update the root package.json
                // (or the workspace root where the catalog is defined)
                const catalog_workspace_path = try bun.default_allocator.dupe(u8, ""); // Always root for now

                try catalog_updates.put(try bun.default_allocator.dupe(u8, catalog_key), .{
                    .version = try bun.default_allocator.dupe(u8, target_version),
                    .workspace_path = catalog_workspace_path,
                });
                continue;
            }

            // Get the workspace path for this package
            const workspace_resolution = manager.lockfile.packages.items(.resolution)[pkg.workspace_pkg_id];
            const workspace_path = if (workspace_resolution.tag == .workspace)
                workspace_resolution.value.workspace.slice(manager.lockfile.buffers.string_bytes.items)
            else
                ""; // Root workspace

            // Add package update with full information
            try package_updates.append(.{
                .name = try bun.default_allocator.dupe(u8, pkg.name),
                .target_version = try bun.default_allocator.dupe(u8, target_version),
                .dep_type = try bun.default_allocator.dupe(u8, pkg.dependency_type),
                .workspace_path = try bun.default_allocator.dupe(u8, workspace_path),
                .original_version = try bun.default_allocator.dupe(u8, pkg.current_version),
                .package_id = pkg.package_id,
            });
        }

        // Check if we have any updates
        const has_package_updates = package_updates.items.len > 0;
        const has_catalog_updates = catalog_updates.count() > 0;

        if (!has_package_updates and !has_catalog_updates) {
            Output.prettyln("<r><yellow>!</r> No packages selected for update", .{});
            return;
        }

        // Actually update the selected packages
        if (has_package_updates or has_catalog_updates) {
            if (manager.options.dry_run) {
                Output.prettyln("\n<r><yellow>Dry run mode: showing what would be updated<r>", .{});

                // In dry-run mode, just show what would be updated without modifying files
                for (package_updates.items) |update| {
                    const workspace_display = if (update.workspace_path.len > 0) update.workspace_path else "root";
                    Output.prettyln("→ Would update {s} to {s} in {s} ({s})", .{ update.name, update.target_version, workspace_display, update.dep_type });
                }

                if (has_catalog_updates) {
                    var it = catalog_updates.iterator();
                    while (it.next()) |entry| {
                        const catalog_key = entry.key_ptr.*;
                        const catalog_update = entry.value_ptr.*;
                        Output.prettyln("→ Would update catalog {s} to {s}", .{ catalog_key, catalog_update.version });
                    }
                }

                Output.prettyln("\n<r><yellow>Dry run complete - no changes made<r>", .{});
            } else {
                Output.prettyln("\n<r><cyan>Installing updates...<r>", .{});
                Output.flush();

                // Update catalog definitions first if needed
                if (has_catalog_updates) {
                    try updateCatalogDefinitions(manager, catalog_updates);
                }

                // Update all package.json files directly (fast!)
                if (has_package_updates) {
                    try updatePackageJsonFilesFromUpdates(manager, package_updates.items);
                }

                manager.to_update = true;

                // Reset the timer to show actual install time instead of total command time
                var install_ctx = ctx;
                install_ctx.start_time = std.time.nanoTimestamp();

                try PackageManager.installWithManager(manager, install_ctx, PackageManager.root_package_json_path, manager.root_dir.dir);
            }
        }
    }

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

    fn groupCatalogDependencies(
        allocator: std.mem.Allocator,
        packages: []OutdatedPackage,
    ) ![]OutdatedPackage {
        // Create a map to track catalog dependencies by name
        var catalog_map = bun.StringHashMap(std.array_list.Managed(OutdatedPackage)).init(allocator);
        defer catalog_map.deinit();
        defer {
            var iter = catalog_map.iterator();
            while (iter.next()) |entry| {
                entry.value_ptr.deinit();
            }
        }

        var result = std.array_list.Managed(OutdatedPackage).init(allocator);
        defer result.deinit();

        // Group catalog dependencies
        for (packages) |pkg| {
            if (pkg.is_catalog) {
                const entry = try catalog_map.getOrPut(pkg.name);
                if (!entry.found_existing) {
                    entry.value_ptr.* = std.array_list.Managed(OutdatedPackage).init(allocator);
                }
                try entry.value_ptr.append(pkg);
            } else {
                try result.append(pkg);
            }
        }

        // Add grouped catalog dependencies
        var iter = catalog_map.iterator();
        while (iter.next()) |entry| {
            const catalog_packages = entry.value_ptr.items;
            if (catalog_packages.len > 0) {
                // Use the first package as the base, but combine workspace names
                var first = catalog_packages[0];

                // Build combined workspace name
                var workspace_names = std.array_list.Managed(u8).init(allocator);
                defer workspace_names.deinit();

                if (catalog_packages.len > 0) {
                    if (catalog_packages[0].catalog_name) |catalog_name| {
                        try workspace_names.appendSlice("catalog:");
                        try workspace_names.appendSlice(catalog_name);
                    } else {
                        try workspace_names.appendSlice("catalog");
                    }
                    try workspace_names.appendSlice(" (");
                } else {
                    try workspace_names.appendSlice("catalog (");
                }
                for (catalog_packages, 0..) |cat_pkg, i| {
                    if (i > 0) try workspace_names.appendSlice(", ");
                    try workspace_names.appendSlice(cat_pkg.workspace_name);
                }
                try workspace_names.append(')');

                // Free the old workspace_name and replace with combined
                allocator.free(first.workspace_name);
                first.workspace_name = try workspace_names.toOwnedSlice();

                try result.append(first);

                // Free the other catalog packages
                for (catalog_packages[1..]) |cat_pkg| {
                    allocator.free(cat_pkg.name);
                    allocator.free(cat_pkg.current_version);
                    allocator.free(cat_pkg.latest_version);
                    allocator.free(cat_pkg.update_version);
                    allocator.free(cat_pkg.workspace_name);
                }
            }
        }

        return result.toOwnedSlice();
    }

    fn getOutdatedPackages(
        allocator: std.mem.Allocator,
        manager: *PackageManager,
        workspace_pkg_ids: []const PackageID,
    ) ![]OutdatedPackage {
        const lockfile = manager.lockfile;
        const string_buf = lockfile.buffers.string_bytes.items;
        const packages = lockfile.packages.slice();
        const pkg_names = packages.items(.name);
        const pkg_resolutions = packages.items(.resolution);
        const pkg_dependencies = packages.items(.dependencies);

        var outdated_packages = std.array_list.Managed(OutdatedPackage).init(allocator);
        defer outdated_packages.deinit();

        var version_buf = std.array_list.Managed(u8).init(allocator);
        defer version_buf.deinit();
        const version_writer = version_buf.writer();

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

                const name_slice = dep.name.slice(string_buf);
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

                const latest = manifest.findByDistTagWithFilter("latest", manager.options.minimum_release_age_ms, manager.options.minimum_release_age_excludes).unwrap() orelse continue;

                // In interactive mode, show the constrained update version as "Target"
                // but always include packages (don't filter out breaking changes)
                const update_version = if (resolved_version.tag == .npm)
                    manifest.findBestVersionWithFilter(resolved_version.value.npm.version, string_buf, manager.options.minimum_release_age_ms, manager.options.minimum_release_age_excludes).unwrap() orelse latest
                else
                    manifest.findByDistTagWithFilter(resolved_version.value.dist_tag.tag.slice(string_buf), manager.options.minimum_release_age_ms, manager.options.minimum_release_age_excludes).unwrap() orelse latest;

                // Skip only if both the constrained update AND the latest version are the same as current
                // This ensures we show packages where latest is newer even if constrained update isn't
                const current_ver = resolution.value.npm.version;
                const update_ver = update_version.version;
                const latest_ver = latest.version;

                const update_is_same = (current_ver.major == update_ver.major and
                    current_ver.minor == update_ver.minor and
                    current_ver.patch == update_ver.patch and
                    current_ver.tag.eql(update_ver.tag));

                const latest_is_same = (current_ver.major == latest_ver.major and
                    current_ver.minor == latest_ver.minor and
                    current_ver.patch == latest_ver.patch and
                    current_ver.tag.eql(latest_ver.tag));

                if (update_is_same and latest_is_same) {
                    continue;
                }

                version_buf.clearRetainingCapacity();
                try version_writer.print("{f}", .{resolution.value.npm.version.fmt(string_buf)});
                const current_version_buf = try allocator.dupe(u8, version_buf.items);

                version_buf.clearRetainingCapacity();
                try version_writer.print("{f}", .{update_version.version.fmt(manifest.string_buf)});
                const update_version_buf = try allocator.dupe(u8, version_buf.items);

                version_buf.clearRetainingCapacity();
                try version_writer.print("{f}", .{latest.version.fmt(manifest.string_buf)});
                const latest_version_buf = try allocator.dupe(u8, version_buf.items);

                // Already filtered by version.order check above

                version_buf.clearRetainingCapacity();
                const dep_type = if (dep.behavior.dev) "devDependencies" else if (dep.behavior.optional) "optionalDependencies" else if (dep.behavior.peer) "peerDependencies" else "dependencies";

                // Get workspace name but only show if it's actually a workspace
                const workspace_resolution = pkg_resolutions[workspace_pkg_id];
                const workspace_name = if (workspace_resolution.tag == .workspace)
                    pkg_names[workspace_pkg_id].slice(string_buf)
                else
                    "";

                const catalog_name_str = if (dep.version.tag == .catalog)
                    dep.version.value.catalog.slice(string_buf)
                else
                    "";

                const catalog_name: ?[]const u8 = if (catalog_name_str.len > 0) try allocator.dupe(u8, catalog_name_str) else null;

                try outdated_packages.append(.{
                    .name = try allocator.dupe(u8, name_slice),
                    .current_version = try allocator.dupe(u8, current_version_buf),
                    .latest_version = try allocator.dupe(u8, latest_version_buf),
                    .update_version = try allocator.dupe(u8, update_version_buf),
                    .package_id = package_id,
                    .dep_id = @intCast(dep_id),
                    .workspace_pkg_id = workspace_pkg_id,
                    .dependency_type = dep_type,
                    .workspace_name = try allocator.dupe(u8, workspace_name),
                    .behavior = dep.behavior,
                    .manager = manager,
                    .is_catalog = dep.version.tag == .catalog,
                    .catalog_name = catalog_name,
                    .use_latest = manager.options.do.update_to_latest, // default to --latest flag value
                });
            }
        }

        const result = try outdated_packages.toOwnedSlice();

        // Group catalog dependencies
        const grouped_result = try groupCatalogDependencies(allocator, result);

        // Sort packages: dependencies first, then devDependencies, etc.
        std.sort.pdq(OutdatedPackage, grouped_result, {}, struct {
            fn lessThan(_: void, a: OutdatedPackage, b: OutdatedPackage) bool {
                // First sort by dependency type
                const a_priority = depTypePriority(a.dependency_type);
                const b_priority = depTypePriority(b.dependency_type);
                if (a_priority != b_priority) return a_priority < b_priority;

                // Then by name
                return strings.order(a.name, b.name) == .lt;
            }

            fn depTypePriority(dep_type: []const u8) u8 {
                if (strings.eqlComptime(dep_type, "dependencies")) return 0;
                if (strings.eqlComptime(dep_type, "devDependencies")) return 1;
                if (strings.eqlComptime(dep_type, "peerDependencies")) return 2;
                if (strings.eqlComptime(dep_type, "optionalDependencies")) return 3;
                return 4;
            }
        }.lessThan);

        return grouped_result;
    }

    const ColumnWidths = struct {
        name: usize,
        current: usize,
        target: usize,
        latest: usize,
        workspace: usize,
        show_workspace: bool,
    };

    const MultiSelectState = struct {
        packages: []OutdatedPackage,
        selected: []bool,
        cursor: usize = 0,
        viewport_start: usize = 0,
        viewport_height: usize = 20, // Default viewport height
        toggle_all: bool = false,
        max_name_len: usize = 0,
        max_current_len: usize = 0,
        max_update_len: usize = 0,
        max_latest_len: usize = 0,
        max_workspace_len: usize = 0,
        show_workspace: bool = false,
    };

    fn calculateColumnWidths(packages: []OutdatedPackage) ColumnWidths {
        // Calculate natural widths based on content
        var max_name_len: usize = "Package".len;
        var max_current_len: usize = "Current".len;
        var max_target_len: usize = "Target".len;
        var max_latest_len: usize = "Latest".len;
        var max_workspace_len: usize = "Workspace".len;
        var has_workspaces = false;

        for (packages) |pkg| {
            // Include dev tag length in max calculation
            var dev_tag_len: usize = 0;
            if (pkg.behavior.dev) {
                dev_tag_len = 4; // " dev"
            } else if (pkg.behavior.peer) {
                dev_tag_len = 5; // " peer"
            } else if (pkg.behavior.optional) {
                dev_tag_len = 9; // " optional"
            }

            max_name_len = @max(max_name_len, pkg.name.len + dev_tag_len);
            max_current_len = @max(max_current_len, pkg.current_version.len);
            max_target_len = @max(max_target_len, pkg.update_version.len);
            max_latest_len = @max(max_latest_len, pkg.latest_version.len);
            max_workspace_len = @max(max_workspace_len, pkg.workspace_name.len);

            // Check if we have any non-empty workspace names
            if (pkg.workspace_name.len > 0) {
                has_workspaces = true;
            }
        }

        // Get terminal width to apply smart limits if needed
        const term_size = getTerminalSize();

        // Apply smart column width limits based on terminal width
        if (term_size.width < 60) {
            // Very narrow terminal - aggressive truncation, hide workspace
            max_name_len = @min(max_name_len, 12);
            max_current_len = @min(max_current_len, 7);
            max_target_len = @min(max_target_len, 7);
            max_latest_len = @min(max_latest_len, 7);
            has_workspaces = false;
        } else if (term_size.width < 80) {
            // Narrow terminal - moderate truncation, hide workspace
            max_name_len = @min(max_name_len, 20);
            max_current_len = @min(max_current_len, 10);
            max_target_len = @min(max_target_len, 10);
            max_latest_len = @min(max_latest_len, 10);
            has_workspaces = false;
        } else if (term_size.width < 120) {
            // Medium terminal - light truncation
            max_name_len = @min(max_name_len, 35);
            max_current_len = @min(max_current_len, 15);
            max_target_len = @min(max_target_len, 15);
            max_latest_len = @min(max_latest_len, 15);
            max_workspace_len = @min(max_workspace_len, 15);
            // Show workspace only if terminal is wide enough for all columns
            if (term_size.width < 100) {
                has_workspaces = false;
            }
        } else if (term_size.width < 160) {
            // Wide terminal - minimal truncation for very long names
            max_name_len = @min(max_name_len, 45);
            max_current_len = @min(max_current_len, 20);
            max_target_len = @min(max_target_len, 20);
            max_latest_len = @min(max_latest_len, 20);
            max_workspace_len = @min(max_workspace_len, 20);
        }
        // else: wide terminal - use natural widths

        return ColumnWidths{
            .name = max_name_len,
            .current = max_current_len,
            .target = max_target_len,
            .latest = max_latest_len,
            .workspace = max_workspace_len,
            .show_workspace = has_workspaces,
        };
    }

    const TerminalSize = struct {
        height: usize,
        width: usize,
    };

    fn getTerminalSize() TerminalSize {
        // Try to get terminal size
        if (comptime Environment.isPosix) {
            var size: std.posix.winsize = undefined;
            if (std.posix.system.ioctl(std.posix.STDOUT_FILENO, std.posix.T.IOCGWINSZ, @intFromPtr(&size)) == 0) {
                // Reserve space for prompt (1 line) + scroll indicators (2 lines) + some buffer
                const usable_height = if (size.row > 6) size.row - 4 else 20;
                return .{
                    .height = usable_height,
                    .width = size.col,
                };
            }
        } else if (comptime Environment.isWindows) {
            const windows = std.os.windows;
            const handle = windows.GetStdHandle(windows.STD_OUTPUT_HANDLE) catch {
                return .{ .height = 20, .width = 80 };
            };

            var csbi: windows.CONSOLE_SCREEN_BUFFER_INFO = undefined;
            const kernel32 = windows.kernel32;
            if (kernel32.GetConsoleScreenBufferInfo(handle, &csbi) != windows.FALSE) {
                const width = csbi.srWindow.Right - csbi.srWindow.Left + 1;
                const height = csbi.srWindow.Bottom - csbi.srWindow.Top + 1;
                // Reserve space for prompt + scroll indicators + buffer
                const usable_height = if (height > 6) height - 4 else 20;
                return .{
                    .height = @intCast(usable_height),
                    .width = @intCast(width),
                };
            }
        }
        return .{ .height = 20, .width = 80 }; // Default fallback
    }

    fn truncateWithEllipsis(allocator: std.mem.Allocator, text: []const u8, max_width: usize, only_end: bool) ![]const u8 {
        if (text.len <= max_width) {
            return try allocator.dupe(u8, text);
        }

        if (max_width <= 3) {
            return try allocator.dupe(u8, "…");
        }

        // Put ellipsis in the middle to show both start and end of package name
        const ellipsis = "…";
        const available_chars = max_width - 1; // Reserve 1 char for ellipsis
        const start_chars = if (only_end) available_chars else available_chars / 2;
        const end_chars = available_chars - start_chars;

        const result = try allocator.alloc(u8, start_chars + ellipsis.len + end_chars);
        @memcpy(result[0..start_chars], text[0..start_chars]);
        @memcpy(result[start_chars .. start_chars + ellipsis.len], ellipsis);
        @memcpy(result[start_chars + ellipsis.len ..], text[text.len - end_chars ..]);

        return result;
    }

    fn promptForUpdates(allocator: std.mem.Allocator, packages: []OutdatedPackage) ![]bool {
        if (packages.len == 0) {
            Output.prettyln("<r><green>✓<r> All packages are up to date!", .{});
            return allocator.alloc(bool, 0);
        }

        const selected = try allocator.alloc(bool, packages.len);
        // Default to all unselected
        @memset(selected, false);

        // Calculate optimal column widths based on terminal width and content
        const columns = calculateColumnWidths(packages);

        // Get terminal size for viewport and width optimization
        const terminal_size = getTerminalSize();

        var state = MultiSelectState{
            .packages = packages,
            .selected = selected,
            .viewport_height = terminal_size.height,
            .max_name_len = columns.name,
            .max_current_len = columns.current,
            .max_update_len = columns.target,
            .max_latest_len = columns.latest,
            .max_workspace_len = columns.workspace,
            .show_workspace = columns.show_workspace, // Show workspace if packages have workspaces
        };

        // Set raw mode
        const original_mode: if (Environment.isWindows) ?bun.windows.DWORD else void = if (comptime Environment.isWindows)
            bun.windows.updateStdioModeFlags(.std_in, .{
                .set = bun.windows.ENABLE_VIRTUAL_TERMINAL_INPUT | bun.windows.ENABLE_PROCESSED_INPUT,
                .unset = bun.windows.ENABLE_LINE_INPUT | bun.windows.ENABLE_ECHO_INPUT,
            }) catch null;

        if (Environment.isPosix)
            _ = Bun__ttySetMode(0, 1);

        defer {
            if (comptime Environment.isWindows) {
                if (original_mode) |mode| {
                    _ = bun.c.SetConsoleMode(
                        bun.FD.stdin().native(),
                        mode,
                    );
                }
            }
            if (Environment.isPosix) {
                _ = Bun__ttySetMode(0, 0);
            }
        }

        const result = processMultiSelect(&state, terminal_size) catch |err| {
            if (err == error.EndOfStream) {
                Output.flush();
                Output.prettyln("\n<r><red>x<r> Cancelled", .{});
                Global.exit(0);
            }
            return err;
        };

        Output.flush();
        return result;
    }

    fn ensureCursorInViewport(state: *MultiSelectState) void {
        // If cursor is not in viewport, position it sensibly
        if (state.cursor < state.viewport_start) {
            // Cursor is above viewport - put it at the start of viewport
            state.cursor = state.viewport_start;
        } else if (state.cursor >= state.viewport_start + state.viewport_height) {
            // Cursor is below viewport - put it at the end of viewport
            if (state.packages.len > 0) {
                const max_cursor = if (state.packages.len > 1) state.packages.len - 1 else 0;
                const viewport_end = state.viewport_start + state.viewport_height;
                state.cursor = @min(viewport_end - 1, max_cursor);
            }
        }
    }

    fn updateViewport(state: *MultiSelectState) void {
        // Ensure cursor is visible with context (2 packages below, 2 above if possible)
        const context_below: usize = 2;
        const context_above: usize = 1;

        // If cursor is below viewport
        if (state.cursor >= state.viewport_start + state.viewport_height) {
            // Scroll down to show cursor with context
            const desired_start = if (state.cursor + context_below + 1 > state.packages.len)
                // Can't show full context, align bottom
                if (state.packages.len > state.viewport_height)
                    state.packages.len - state.viewport_height
                else
                    0
            else
                // Show cursor with context below
                if (state.viewport_height > context_below and state.cursor > state.viewport_height - context_below)
                    state.cursor - (state.viewport_height - context_below)
                else
                    0;

            state.viewport_start = desired_start;
        }
        // If cursor is above viewport
        else if (state.cursor < state.viewport_start) {
            // Scroll up to show cursor with context above
            if (state.cursor >= context_above) {
                state.viewport_start = state.cursor - context_above;
            } else {
                state.viewport_start = 0;
            }
        }
        // If cursor is near bottom of viewport, adjust to maintain context
        else if (state.viewport_height > context_below and state.cursor > state.viewport_start + state.viewport_height - context_below) {
            const max_start = if (state.packages.len > state.viewport_height)
                state.packages.len - state.viewport_height
            else
                0;
            const desired_start = if (state.viewport_height > context_below)
                state.cursor - (state.viewport_height - context_below)
            else
                state.cursor;
            state.viewport_start = @min(desired_start, max_start);
        }
        // If cursor is near top of viewport, adjust to maintain context
        else if (state.cursor < state.viewport_start + context_above and state.viewport_start > 0) {
            if (state.cursor >= context_above) {
                state.viewport_start = state.cursor - context_above;
            } else {
                state.viewport_start = 0;
            }
        }
    }

    fn processMultiSelect(state: *MultiSelectState, initial_terminal_size: TerminalSize) ![]bool {
        const colors = Output.enable_ansi_colors_stdout;

        // Clear any previous progress output
        Output.print("\r\x1B[2K", .{}); // Clear entire line
        Output.print("\x1B[1A\x1B[2K", .{}); // Move up one line and clear it too
        Output.flush();

        // Enable mouse tracking for scrolling (if terminal supports it)
        if (colors) {
            Output.print("\x1b[?25l", .{}); // hide cursor
            Output.print("\x1b[?1000h", .{}); // Enable basic mouse tracking
            Output.print("\x1b[?1006h", .{}); // Enable SGR extended mouse mode
        }
        defer if (colors) {
            Output.print("\x1b[?25h", .{}); // show cursor
            Output.print("\x1b[?1000l", .{}); // Disable mouse tracking
            Output.print("\x1b[?1006l", .{}); // Disable SGR extended mouse mode
        };

        var initial_draw = true;
        var reprint_menu = true;
        var total_lines: usize = 0;
        var last_terminal_width = initial_terminal_size.width;
        errdefer reprint_menu = false;
        defer {
            if (!initial_draw) {
                Output.up(total_lines);
            }
            Output.clearToEnd();

            if (reprint_menu) {
                var count: usize = 0;
                for (state.selected) |sel| {
                    if (sel) count += 1;
                }
                Output.prettyln("<r><green>✓<r> Selected {d} package{s} to update", .{ count, if (count == 1) "" else "s" });
            }
        }

        while (true) {
            // Check for terminal resize
            const current_size = getTerminalSize();
            if (current_size.width != last_terminal_width) {
                // Terminal was resized, update viewport and redraw
                state.viewport_height = current_size.height;
                const columns = calculateColumnWidths(state.packages);
                state.show_workspace = columns.show_workspace and current_size.width > 100;
                state.max_name_len = columns.name;
                state.max_current_len = columns.current;
                state.max_update_len = columns.target;
                state.max_latest_len = columns.latest;
                state.max_workspace_len = columns.workspace;
                last_terminal_width = current_size.width;
                updateViewport(state);
                // Force full redraw
                initial_draw = true;
            }

            // The render body
            {
                const synchronized = Output.synchronized();
                defer synchronized.end();

                if (!initial_draw) {
                    Output.up(total_lines);
                    Output.print("\x1B[1G", .{});
                    Output.clearToEnd();
                }
                initial_draw = false;

                const help_text = "Space to toggle, Enter to confirm, a to select all, n to select none, i to invert, l to toggle latest";
                const elipsised_help_text = try truncateWithEllipsis(bun.default_allocator, help_text, current_size.width - "? Select packages to update - ".len, true);
                defer bun.default_allocator.free(elipsised_help_text);
                Output.prettyln("<r><cyan>?<r> Select packages to update<d> - {s}<r>", .{elipsised_help_text});

                // Calculate how many lines the prompt will actually take due to terminal wrapping
                total_lines = 1;

                // Calculate available space for packages (reserve space for scroll indicators if needed)
                const needs_scrolling = state.packages.len > state.viewport_height;
                const show_top_indicator = needs_scrolling and state.viewport_start > 0;

                // First calculate preliminary viewport end to determine if we need bottom indicator
                const preliminary_viewport_end = @min(state.viewport_start + state.viewport_height, state.packages.len);
                const show_bottom_indicator = needs_scrolling and preliminary_viewport_end < state.packages.len;

                // const is_bottom_scroll = needs_scrolling and state.viewport_start + state.viewport_height <= state.packages.len;

                // Show top scroll indicator if needed
                if (show_top_indicator) {
                    Output.pretty("  <d>↑ {d} more package{s} above<r>", .{ state.viewport_start, if (state.viewport_start == 1) "" else "s" });
                }

                // Calculate how many packages we can actually display
                // The simple approach: just try to show viewport_height packages
                // The display loop will stop when it runs out of room
                const viewport_end = @min(state.viewport_start + state.viewport_height, state.packages.len);

                // Group by dependency type
                var current_dep_type: ?[]const u8 = null;

                // Track how many lines we've actually displayed (headers take 2 lines)
                var lines_displayed: usize = 0;
                var packages_displayed: usize = 0;

                // Only display packages within viewport
                for (state.viewport_start..viewport_end) |i| {
                    const pkg = &state.packages[i];
                    const selected = state.selected[i];

                    // Check if we need a header and if we have room for it
                    const needs_header = current_dep_type == null or !strings.eql(current_dep_type.?, pkg.dependency_type);

                    // Print dependency type header with column headers if changed
                    if (needs_header) {
                        // Count selected packages in this dependency type
                        var selected_count: usize = 0;
                        for (state.packages, state.selected) |p, sel| {
                            if (strings.eql(p.dependency_type, pkg.dependency_type) and sel) {
                                selected_count += 1;
                            }
                        }

                        // Print dependency type - bold if any selected
                        Output.print("\n  ", .{});
                        if (selected_count > 0) {
                            Output.pretty("<r><b>{s} {d}<r>", .{ pkg.dependency_type, selected_count });
                        } else {
                            Output.pretty("<r>{s}<r>", .{pkg.dependency_type});
                        }

                        // Calculate padding to align column headers with values
                        var j: usize = 0;
                        // Calculate actual displayed text length including count if present
                        const dep_type_text_len: usize = if (selected_count > 0)
                            pkg.dependency_type.len + 1 + std.fmt.count("{d}", .{selected_count}) // +1 for space
                        else
                            pkg.dependency_type.len;

                        // The padding should align with the first character of package names
                        // Package names start at: "    " (4 spaces) + "□ " (2 chars) = 6 chars from left
                        // Headers start at: "  " (2 spaces) + dep_type_text
                        // We need the headers to align where the current version column starts
                        // That's at: 6 (start of names) + max_name_len + 2 (spacing after names) - 2 (header indent) - dep_type_text_len
                        const total_offset = 6 + state.max_name_len + 2;
                        const header_start = 2 + dep_type_text_len;
                        const padding_to_current = if (header_start >= total_offset) 1 else total_offset - header_start;
                        while (j < padding_to_current) : (j += 1) {
                            Output.print(" ", .{});
                        }

                        // Column headers aligned with their columns
                        Output.print("Current", .{});
                        j = 0;
                        while (j < state.max_current_len - "Current".len + 2) : (j += 1) {
                            Output.print(" ", .{});
                        }
                        Output.print("Target", .{});
                        j = 0;
                        while (j < state.max_update_len - "Target".len + 2) : (j += 1) {
                            Output.print(" ", .{});
                        }
                        Output.print("Latest", .{});
                        if (state.show_workspace) {
                            j = 0;
                            while (j < state.max_latest_len - "Latest".len + 2) : (j += 1) {
                                Output.print(" ", .{});
                            }
                            Output.print("Workspace", .{});
                        }
                        Output.print("\x1B[0K\n", .{});

                        lines_displayed += 2;
                        current_dep_type = pkg.dependency_type;
                    }

                    const is_cursor = i == state.cursor;
                    const checkbox = if (selected) "■" else "□";

                    // Calculate padding - account for dev/peer/optional tags
                    var dev_tag_len: usize = 0;
                    if (pkg.behavior.dev) {
                        dev_tag_len = 4; // " dev"
                    } else if (pkg.behavior.peer) {
                        dev_tag_len = 5; // " peer"
                    } else if (pkg.behavior.optional) {
                        dev_tag_len = 9; // " optional"
                    }
                    const total_name_len = pkg.name.len + dev_tag_len;
                    const name_padding = if (total_name_len >= state.max_name_len) 0 else state.max_name_len - total_name_len;

                    // Determine version change severity for checkbox color
                    const current_ver_parsed = Semver.Version.parse(SlicedString.init(pkg.current_version, pkg.current_version));
                    const update_ver_parsed = if (pkg.use_latest)
                        Semver.Version.parse(SlicedString.init(pkg.latest_version, pkg.latest_version))
                    else
                        Semver.Version.parse(SlicedString.init(pkg.update_version, pkg.update_version));

                    var checkbox_color: []const u8 = "green"; // default
                    if (current_ver_parsed.valid and update_ver_parsed.valid) {
                        const current_full = Semver.Version{
                            .major = current_ver_parsed.version.major orelse 0,
                            .minor = current_ver_parsed.version.minor orelse 0,
                            .patch = current_ver_parsed.version.patch orelse 0,
                            .tag = current_ver_parsed.version.tag,
                        };
                        const update_full = Semver.Version{
                            .major = update_ver_parsed.version.major orelse 0,
                            .minor = update_ver_parsed.version.minor orelse 0,
                            .patch = update_ver_parsed.version.patch orelse 0,
                            .tag = update_ver_parsed.version.tag,
                        };

                        const target_ver_str = if (pkg.use_latest) pkg.latest_version else pkg.update_version;
                        const diff = update_full.whichVersionIsDifferent(current_full, target_ver_str, pkg.current_version);
                        if (diff) |d| {
                            switch (d) {
                                .major => checkbox_color = "red",
                                .minor => {
                                    if (current_full.major == 0) {
                                        checkbox_color = "red"; // 0.x.y minor changes are breaking
                                    } else {
                                        checkbox_color = "yellow";
                                    }
                                },
                                .patch => {
                                    if (current_full.major == 0 and current_full.minor == 0) {
                                        checkbox_color = "red"; // 0.0.x patch changes are breaking
                                    } else {
                                        checkbox_color = "green";
                                    }
                                },
                                else => checkbox_color = "green",
                            }
                        }
                    }

                    // Cursor and checkbox
                    if (is_cursor) {
                        Output.pretty("  <r><cyan>❯<r> ", .{});
                    } else {
                        Output.print("    ", .{});
                    }

                    // Checkbox with appropriate color
                    if (selected) {
                        if (strings.eqlComptime(checkbox_color, "red")) {
                            Output.pretty("<r><red>{s}<r> ", .{checkbox});
                        } else if (strings.eqlComptime(checkbox_color, "yellow")) {
                            Output.pretty("<r><yellow>{s}<r> ", .{checkbox});
                        } else {
                            Output.pretty("<r><green>{s}<r> ", .{checkbox});
                        }
                    } else {
                        Output.print("{s} ", .{checkbox});
                    }

                    // Package name - truncate if needed and make it a hyperlink if colors are enabled and using default registry
                    // Calculate available space for name (accounting for dev/peer/optional tags)
                    const available_name_width = if (state.max_name_len > dev_tag_len) state.max_name_len - dev_tag_len else state.max_name_len;
                    const display_name = try truncateWithEllipsis(bun.default_allocator, pkg.name, available_name_width, false);
                    defer bun.default_allocator.free(display_name);

                    const uses_default_registry = pkg.manager.options.scope.url_hash == Install.Npm.Registry.default_url_hash and
                        pkg.manager.scopeForPackageName(pkg.name).url_hash == Install.Npm.Registry.default_url_hash;
                    const package_url = if (Output.enable_ansi_colors_stdout and uses_default_registry)
                        try std.fmt.allocPrint(bun.default_allocator, "https://npmjs.org/package/{s}/v/{s}", .{ pkg.name, brk: {
                            if (selected) {
                                if (pkg.use_latest) {
                                    break :brk pkg.latest_version;
                                } else {
                                    break :brk pkg.update_version;
                                }
                            } else {
                                break :brk pkg.current_version;
                            }
                        } })
                    else
                        "";
                    defer if (package_url.len > 0) bun.default_allocator.free(package_url);

                    const hyperlink = TerminalHyperlink.new(package_url, display_name, package_url.len > 0);

                    if (selected) {
                        if (strings.eqlComptime(checkbox_color, "red")) {
                            Output.pretty("<r><red>{f}<r>", .{hyperlink});
                        } else if (strings.eqlComptime(checkbox_color, "yellow")) {
                            Output.pretty("<r><yellow>{f}<r>", .{hyperlink});
                        } else {
                            Output.pretty("<r><green>{f}<r>", .{hyperlink});
                        }
                    } else {
                        Output.pretty("<r>{f}<r>", .{hyperlink});
                    }

                    // Print dev/peer/optional tag if applicable
                    if (pkg.behavior.dev) {
                        Output.pretty("<r><d> dev<r>", .{});
                    } else if (pkg.behavior.peer) {
                        Output.pretty("<r><d> peer<r>", .{});
                    } else if (pkg.behavior.optional) {
                        Output.pretty("<r><d> optional<r>", .{});
                    }

                    // Print padding after name (2 spaces)
                    var j: usize = 0;
                    while (j < name_padding + 2) : (j += 1) {
                        Output.print(" ", .{});
                    }

                    // Current version - truncate if needed
                    const truncated_current = try truncateWithEllipsis(bun.default_allocator, pkg.current_version, state.max_current_len, false);
                    defer bun.default_allocator.free(truncated_current);
                    Output.pretty("<r>{s}<r>", .{truncated_current});

                    // Print padding after current version (2 spaces)
                    const current_padding = if (truncated_current.len >= state.max_current_len) 0 else state.max_current_len - truncated_current.len;
                    j = 0;
                    while (j < current_padding + 2) : (j += 1) {
                        Output.print(" ", .{});
                    }

                    // Target version with diffFmt coloring - bold if not using latest
                    const target_ver_parsed = Semver.Version.parse(SlicedString.init(pkg.update_version, pkg.update_version));

                    // Truncate target version if needed
                    const truncated_target = try truncateWithEllipsis(bun.default_allocator, pkg.update_version, state.max_update_len, false);
                    defer bun.default_allocator.free(truncated_target);

                    // For width calculation, use the truncated version string length
                    const target_width: usize = truncated_target.len;

                    if (current_ver_parsed.valid and target_ver_parsed.valid) {
                        const current_full = Semver.Version{
                            .major = current_ver_parsed.version.major orelse 0,
                            .minor = current_ver_parsed.version.minor orelse 0,
                            .patch = current_ver_parsed.version.patch orelse 0,
                            .tag = current_ver_parsed.version.tag,
                        };
                        const target_full = Semver.Version{
                            .major = target_ver_parsed.version.major orelse 0,
                            .minor = target_ver_parsed.version.minor orelse 0,
                            .patch = target_ver_parsed.version.patch orelse 0,
                            .tag = target_ver_parsed.version.tag,
                        };

                        // Print target version (use truncated version for narrow terminals)
                        if (selected and !pkg.use_latest) {
                            Output.print("\x1B[4m", .{}); // Start underline
                        }
                        if (truncated_target.len < pkg.update_version.len) {
                            // If truncated, use plain display instead of diffFmt to avoid confusion
                            Output.pretty("<r>{s}<r>", .{truncated_target});
                        } else {
                            // Use diffFmt for full versions
                            Output.pretty("{f}", .{target_full.diffFmt(
                                current_full,
                                pkg.update_version,
                                pkg.current_version,
                            )});
                        }
                        if (selected and !pkg.use_latest) {
                            Output.print("\x1B[24m", .{}); // End underline
                        }
                    } else {
                        // Fallback if version parsing fails
                        if (selected and !pkg.use_latest) {
                            Output.print("\x1B[4m", .{}); // Start underline
                        }
                        Output.pretty("<r>{s}<r>", .{truncated_target});
                        if (selected and !pkg.use_latest) {
                            Output.print("\x1B[24m", .{}); // End underline
                        }
                    }

                    const target_padding = if (target_width >= state.max_update_len) 0 else state.max_update_len - target_width;
                    j = 0;
                    while (j < target_padding + 2) : (j += 1) {
                        Output.print(" ", .{});
                    }

                    // Latest version with diffFmt coloring - bold if using latest
                    const latest_ver_parsed = Semver.Version.parse(SlicedString.init(pkg.latest_version, pkg.latest_version));

                    // Truncate latest version if needed
                    const truncated_latest = try truncateWithEllipsis(bun.default_allocator, pkg.latest_version, state.max_latest_len, false);
                    defer bun.default_allocator.free(truncated_latest);
                    if (current_ver_parsed.valid and latest_ver_parsed.valid) {
                        const current_full = Semver.Version{
                            .major = current_ver_parsed.version.major orelse 0,
                            .minor = current_ver_parsed.version.minor orelse 0,
                            .patch = current_ver_parsed.version.patch orelse 0,
                            .tag = current_ver_parsed.version.tag,
                        };
                        const latest_full = Semver.Version{
                            .major = latest_ver_parsed.version.major orelse 0,
                            .minor = latest_ver_parsed.version.minor orelse 0,
                            .patch = latest_ver_parsed.version.patch orelse 0,
                            .tag = latest_ver_parsed.version.tag,
                        };

                        // Dim if latest matches target version
                        const is_same_as_target = strings.eql(pkg.latest_version, pkg.update_version);
                        if (is_same_as_target) {
                            Output.print("\x1B[2m", .{}); // Dim
                        }
                        // Print latest version
                        if (selected and pkg.use_latest) {
                            Output.print("\x1B[4m", .{}); // Start underline
                        }
                        if (truncated_latest.len < pkg.latest_version.len) {
                            // If truncated, use plain display instead of diffFmt to avoid confusion
                            Output.pretty("<r>{s}<r>", .{truncated_latest});
                        } else {
                            // Use diffFmt for full versions
                            Output.pretty("{f}", .{latest_full.diffFmt(
                                current_full,
                                pkg.latest_version,
                                pkg.current_version,
                            )});
                        }
                        if (selected and pkg.use_latest) {
                            Output.print("\x1B[24m", .{}); // End underline
                        }
                        if (is_same_as_target) {
                            Output.print("\x1B[22m", .{}); // Reset dim
                        }
                    } else {
                        // Fallback if version parsing fails
                        const is_same_as_target = strings.eql(pkg.latest_version, pkg.update_version);
                        if (is_same_as_target) {
                            Output.print("\x1B[2m", .{}); // Dim
                        }
                        if (selected and pkg.use_latest) {
                            Output.print("\x1B[4m", .{}); // Start underline
                        }
                        Output.pretty("<r>{s}<r>", .{truncated_latest});
                        if (selected and pkg.use_latest) {
                            Output.print("\x1B[24m", .{}); // End underline
                        }
                        if (is_same_as_target) {
                            Output.print("\x1B[22m", .{}); // Reset dim
                        }
                    }

                    // Workspace column
                    if (state.show_workspace) {
                        const latest_width: usize = truncated_latest.len;
                        const latest_padding = if (latest_width >= state.max_latest_len) 0 else state.max_latest_len - latest_width;
                        j = 0;
                        while (j < latest_padding + 2) : (j += 1) {
                            Output.print(" ", .{});
                        }
                        // Truncate workspace name if needed
                        const truncated_workspace = try truncateWithEllipsis(bun.default_allocator, pkg.workspace_name, state.max_workspace_len, true);
                        defer bun.default_allocator.free(truncated_workspace);
                        Output.pretty("<r><d>{s}<r>", .{truncated_workspace});
                    }

                    Output.print("\x1B[0K\n", .{});
                    lines_displayed += 1;
                    packages_displayed += 1;
                }

                // Show bottom scroll indicator if needed
                if (show_bottom_indicator) {
                    Output.pretty("  <d>↓ {d} more package{s} below<r>", .{ state.packages.len - viewport_end, if (state.packages.len - viewport_end == 1) "" else "s" });
                    lines_displayed += 1;
                }

                total_lines = lines_displayed + 1;
                Output.clearToEnd();
            }
            Output.flush();

            // Read input
            var reader_buffer: [1]u8 = undefined;
            var reader_file = std.fs.File.stdin().readerStreaming(&reader_buffer);
            const reader = &reader_file.interface;
            const byte = reader.takeByte() catch return state.selected;

            switch (byte) {
                '\n', '\r' => return state.selected,
                3, 4 => return error.EndOfStream, // ctrl+c, ctrl+d
                ' ' => {
                    state.selected[state.cursor] = !state.selected[state.cursor];
                    // if the package only has a latest version, then we should toggle the latest version instead of update
                    if (strings.eql(state.packages[state.cursor].current_version, state.packages[state.cursor].update_version)) {
                        state.packages[state.cursor].use_latest = true;
                    }
                    state.toggle_all = false;
                    // Don't move cursor on space - let user manually navigate
                },
                'a', 'A' => {
                    @memset(state.selected, true);
                    state.toggle_all = true; // Mark that 'a' was used
                },
                'n', 'N' => {
                    @memset(state.selected, false);
                    state.toggle_all = false; // Reset toggle_all mode
                },
                'i', 'I' => {
                    // Invert selection
                    for (state.selected) |*sel| {
                        sel.* = !sel.*;
                    }
                    state.toggle_all = false; // Reset toggle_all mode
                },
                'l', 'L' => {
                    // Only affect all packages if 'a' (select all) was used
                    // Otherwise, just toggle the current cursor package
                    if (state.toggle_all) {
                        // All packages were selected with 'a', so toggle latest for all selected packages
                        const new_latest_state = !state.packages[state.cursor].use_latest;
                        for (state.selected, state.packages) |sel, *pkg| {
                            if (sel) {
                                pkg.use_latest = new_latest_state;
                            }
                        }
                    } else {
                        // Individual selection mode, just toggle current cursor package and select it
                        state.packages[state.cursor].use_latest = !state.packages[state.cursor].use_latest;
                        state.selected[state.cursor] = true;
                    }
                },
                'j' => {
                    if (state.cursor < state.packages.len - 1) {
                        state.cursor += 1;
                    } else {
                        state.cursor = 0;
                    }
                    updateViewport(state);
                    state.toggle_all = false;
                },
                'k' => {
                    if (state.cursor > 0) {
                        state.cursor -= 1;
                    } else {
                        state.cursor = state.packages.len - 1;
                    }
                    updateViewport(state);
                    state.toggle_all = false;
                },
                27 => { // escape sequence
                    const seq = reader.takeByte() catch continue;
                    if (seq == '[') {
                        const arrow = reader.takeByte() catch continue;
                        switch (arrow) {
                            'A' => { // up arrow
                                if (state.cursor > 0) {
                                    state.cursor -= 1;
                                } else {
                                    state.cursor = state.packages.len - 1;
                                }
                                updateViewport(state);
                            },
                            'B' => { // down arrow
                                if (state.cursor < state.packages.len - 1) {
                                    state.cursor += 1;
                                } else {
                                    state.cursor = 0;
                                }
                                updateViewport(state);
                            },
                            'C' => { // right arrow - switch to Latest version and select
                                state.packages[state.cursor].use_latest = true;
                                state.selected[state.cursor] = true;
                            },
                            'D' => { // left arrow - switch to Target version and select
                                state.packages[state.cursor].use_latest = false;
                                state.selected[state.cursor] = true;
                            },
                            '5' => { // Page Up
                                const tilde = reader.takeByte() catch continue;
                                if (tilde == '~') {
                                    // Move up by viewport height
                                    if (state.cursor >= state.viewport_height) {
                                        state.cursor -= state.viewport_height;
                                    } else {
                                        state.cursor = 0;
                                    }
                                    updateViewport(state);
                                }
                            },
                            '6' => { // Page Down
                                const tilde = reader.takeByte() catch continue;
                                if (tilde == '~') {
                                    // Move down by viewport height
                                    if (state.cursor + state.viewport_height < state.packages.len) {
                                        state.cursor += state.viewport_height;
                                    } else {
                                        state.cursor = state.packages.len - 1;
                                    }
                                    updateViewport(state);
                                }
                            },
                            '<' => { // SGR extended mouse mode
                                // Read until 'M' or 'm' for button press/release
                                var buffer: [32]u8 = undefined;
                                var buf_idx: usize = 0;
                                while (buf_idx < buffer.len) : (buf_idx += 1) {
                                    const c = reader.takeByte() catch break;
                                    if (c == 'M' or c == 'm') {
                                        // Parse SGR mouse event: ESC[<button;col;row(M or m)
                                        // button: 64 = scroll up, 65 = scroll down
                                        var parts = std.mem.tokenizeScalar(u8, buffer[0..buf_idx], ';');
                                        if (parts.next()) |button_str| {
                                            const button = std.fmt.parseInt(u32, button_str, 10) catch 0;
                                            // Mouse wheel events
                                            if (button == 64) { // Scroll up
                                                if (state.viewport_start > 0) {
                                                    // Scroll up by 3 lines
                                                    const scroll_amount = @min(1, state.viewport_start);
                                                    state.viewport_start -= scroll_amount;
                                                    ensureCursorInViewport(state);
                                                }
                                            } else if (button == 65) { // Scroll down
                                                if (state.viewport_start + state.viewport_height < state.packages.len) {
                                                    // Scroll down by 3 lines
                                                    const max_scroll = state.packages.len - (state.viewport_start + state.viewport_height);
                                                    const scroll_amount = @min(1, max_scroll);
                                                    state.viewport_start += scroll_amount;
                                                    ensureCursorInViewport(state);
                                                }
                                            }
                                        }
                                        break;
                                    }
                                    buffer[buf_idx] = c;
                                }
                            },
                            else => {},
                        }
                    }
                    state.toggle_all = false;
                },
                else => {
                    state.toggle_all = false;
                },
            }
        }
    }
};

extern fn Bun__ttySetMode(fd: c_int, mode: c_int) c_int;

const string = []const u8;

pub const CatalogUpdateRequest = struct {
    package_name: string,
    new_version: string,
    catalog_name: ?string = null,
};

/// Edit catalog definitions in package.json
pub fn editCatalogDefinitions(
    manager: *PackageManager,
    updates: []CatalogUpdateRequest,
    current_package_json: *Expr,
) !void {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    Expr.Disabler.disable();
    defer Expr.Disabler.enable();

    const allocator = manager.allocator;

    for (updates) |update| {
        if (update.catalog_name) |catalog_name| {
            try updateNamedCatalog(allocator, current_package_json, catalog_name, update.package_name, update.new_version);
        } else {
            try updateDefaultCatalog(allocator, current_package_json, update.package_name, update.new_version);
        }
    }
}

fn updateDefaultCatalog(
    allocator: std.mem.Allocator,
    package_json: *Expr,
    package_name: string,
    new_version: string,
) !void {
    // Get or create the catalog object
    // First check if catalog is under workspaces.catalog
    var catalog_obj = brk: {
        if (package_json.asProperty("workspaces")) |workspaces_query| {
            if (workspaces_query.expr.data == .e_object) {
                if (workspaces_query.expr.asProperty("catalog")) |catalog_query| {
                    if (catalog_query.expr.data == .e_object)
                        break :brk catalog_query.expr.data.e_object.*;
                }
            }
        }
        // Fallback to root-level catalog
        if (package_json.asProperty("catalog")) |catalog_query| {
            if (catalog_query.expr.data == .e_object)
                break :brk catalog_query.expr.data.e_object.*;
        }
        break :brk E.Object{};
    };

    // Get original version to preserve prefix if it exists
    var version_with_prefix = new_version;
    if (catalog_obj.get(package_name)) |existing_prop| {
        if (existing_prop.data == .e_string) {
            const original_version = existing_prop.data.e_string.data;
            version_with_prefix = try preserveVersionPrefix(original_version, new_version, allocator);
        }
    }

    // Update or add the package version
    const new_expr = Expr.allocate(allocator, E.String, E.String{ .data = version_with_prefix }, logger.Loc.Empty);
    try catalog_obj.put(allocator, package_name, new_expr);

    // Check if we need to update under workspaces.catalog or root-level catalog
    if (package_json.asProperty("workspaces")) |workspaces_query| {
        if (workspaces_query.expr.data == .e_object) {
            if (workspaces_query.expr.asProperty("catalog")) |_| {
                // Update under workspaces.catalog
                try workspaces_query.expr.data.e_object.put(
                    allocator,
                    "catalog",
                    Expr.allocate(allocator, E.Object, catalog_obj, logger.Loc.Empty),
                );
                return;
            }
        }
    }

    // Otherwise update at root level
    try package_json.data.e_object.put(
        allocator,
        "catalog",
        Expr.allocate(allocator, E.Object, catalog_obj, logger.Loc.Empty),
    );
}

fn updateNamedCatalog(
    allocator: std.mem.Allocator,
    package_json: *Expr,
    catalog_name: string,
    package_name: string,
    new_version: string,
) !void {

    // Get or create the catalogs object
    // First check if catalogs is under workspaces.catalogs (newer structure)
    var catalogs_obj = brk: {
        if (package_json.asProperty("workspaces")) |workspaces_query| {
            if (workspaces_query.expr.data == .e_object) {
                if (workspaces_query.expr.asProperty("catalogs")) |catalogs_query| {
                    if (catalogs_query.expr.data == .e_object)
                        break :brk catalogs_query.expr.data.e_object.*;
                }
            }
        }
        // Fallback to root-level catalogs
        if (package_json.asProperty("catalogs")) |catalogs_query| {
            if (catalogs_query.expr.data == .e_object)
                break :brk catalogs_query.expr.data.e_object.*;
        }
        break :brk E.Object{};
    };

    // Get or create the specific catalog
    var catalog_obj = brk: {
        if (catalogs_obj.get(catalog_name)) |catalog_query| {
            if (catalog_query.data == .e_object)
                break :brk catalog_query.data.e_object.*;
        }
        break :brk E.Object{};
    };

    // Get original version to preserve prefix if it exists
    var version_with_prefix = new_version;
    if (catalog_obj.get(package_name)) |existing_prop| {
        if (existing_prop.data == .e_string) {
            const original_version = existing_prop.data.e_string.data;
            version_with_prefix = try preserveVersionPrefix(original_version, new_version, allocator);
        }
    }

    // Update or add the package version
    const new_expr = Expr.allocate(allocator, E.String, E.String{ .data = version_with_prefix }, logger.Loc.Empty);
    try catalog_obj.put(allocator, package_name, new_expr);

    // Update the catalog in catalogs object
    try catalogs_obj.put(
        allocator,
        catalog_name,
        Expr.allocate(allocator, E.Object, catalog_obj, logger.Loc.Empty),
    );

    // Check if we need to update under workspaces.catalogs or root-level catalogs
    if (package_json.asProperty("workspaces")) |workspaces_query| {
        if (workspaces_query.expr.data == .e_object) {
            if (workspaces_query.expr.asProperty("catalogs")) |_| {
                // Update under workspaces.catalogs
                try workspaces_query.expr.data.e_object.put(
                    allocator,
                    "catalogs",
                    Expr.allocate(allocator, E.Object, catalogs_obj, logger.Loc.Empty),
                );
                return;
            }
        }
    }

    // Otherwise update at root level
    try package_json.data.e_object.put(
        allocator,
        "catalogs",
        Expr.allocate(allocator, E.Object, catalogs_obj, logger.Loc.Empty),
    );
}

fn preserveVersionPrefix(original_version: string, new_version: string, allocator: std.mem.Allocator) !string {
    if (original_version.len > 1) {
        var orig_version = original_version;
        var alias: ?string = null;

        // Preserve npm: prefix
        if (strings.withoutPrefixIfPossibleComptime(original_version, "npm:")) |after_npm| {
            if (strings.lastIndexOfChar(after_npm, '@')) |i| {
                alias = after_npm[0..i];
                if (i + 2 < after_npm.len) {
                    orig_version = after_npm[i + 1 ..];
                }
            } else {
                alias = after_npm;
            }
        }

        // Preserve other version prefixes
        const first_char = orig_version[0];
        if (first_char == '^' or first_char == '~' or first_char == '>' or first_char == '<' or first_char == '=') {
            const second_char = orig_version[1];
            if ((first_char == '>' or first_char == '<') and second_char == '=') {
                if (alias) |a| {
                    return try std.fmt.allocPrint(allocator, "npm:{s}@{c}={s}", .{ a, first_char, new_version });
                }
                return try std.fmt.allocPrint(allocator, "{c}={s}", .{ first_char, new_version });
            }
            if (alias) |a| {
                return try std.fmt.allocPrint(allocator, "npm:{s}@{c}{s}", .{ a, first_char, new_version });
            }
            return try std.fmt.allocPrint(allocator, "{c}{s}", .{ first_char, new_version });
        }
        if (alias) |a| {
            return try std.fmt.allocPrint(allocator, "npm:{s}@{s}", .{ a, new_version });
        }
    }
    return try allocator.dupe(u8, new_version);
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const JSPrinter = bun.js_printer;
const OOM = bun.OOM;
const Output = bun.Output;
const PathBuffer = bun.PathBuffer;
const glob = bun.glob;
const logger = bun.logger;
const path = bun.path;
const strings = bun.strings;
const Command = bun.cli.Command;
const FileSystem = bun.fs.FileSystem;

const Semver = bun.Semver;
const SlicedString = Semver.SlicedString;
const String = Semver.String;

const JSAst = bun.ast;
const E = JSAst.E;
const Expr = JSAst.Expr;

const Install = bun.install;
const DependencyID = Install.DependencyID;
const PackageID = Install.PackageID;
const invalid_package_id = Install.invalid_package_id;
const Behavior = Install.Dependency.Behavior;

const PackageManager = Install.PackageManager;
const PackageJSONEditor = PackageManager.PackageJSONEditor;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
