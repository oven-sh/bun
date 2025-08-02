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

    pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
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
        defer manager.allocator.free(new_package_json_source);

        // Write the updated package.json
        const write_file = std.fs.cwd().createFile(package_json_path, .{}) catch |err| {
            Output.errGeneric("Failed to write package.json at {s}: {s}", .{ package_json_path, @errorName(err) });
            return err;
        };
        defer write_file.close();

        write_file.writeAll(new_package_json_source) catch |err| {
            Output.errGeneric("Failed to write package.json at {s}: {s}", .{ package_json_path, @errorName(err) });
            return err;
        };
    }

    fn resolveCatalogDependency(manager: *PackageManager, dep: Install.Dependency) ?Install.Dependency.Version {
        return if (dep.version.tag == .catalog) blk: {
            const catalog_dep = manager.lockfile.catalogs.get(
                manager.lockfile,
                dep.version.value.catalog,
                dep.name,
            ) orelse return null;
            break :blk catalog_dep.version;
        } else dep.version;
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
    };

    fn updatePackageJsonFilesFromUpdates(
        manager: *PackageManager,
        updates: []const PackageUpdate,
    ) !void {
        // Group updates by workspace
        var workspace_groups = bun.StringHashMap(std.ArrayList(PackageUpdate)).init(bun.default_allocator);
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
                result.value_ptr.* = std.ArrayList(PackageUpdate).init(bun.default_allocator);
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
        _: string, // original_cwd - no longer needed since we removed the install step
        catalog_updates: bun.StringHashMap(CatalogUpdate),
    ) !void {

        // Group catalog updates by workspace path
        var workspace_catalog_updates = bun.StringHashMap(std.ArrayList(CatalogUpdateRequest)).init(bun.default_allocator);
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
                result.value_ptr.* = std.ArrayList(CatalogUpdateRequest).init(bun.default_allocator);
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

            // Log what was updated (not needed outside debug)
            // const workspace_display = if (workspace_path.len > 0) workspace_path else "root";
            // for (updates_for_workspace.items) |update| {
            //     if (update.catalog_name) |catalog_name| {
            //         Output.prettyln("  Updated {s} in catalog:{s} ({s})", .{ update.package_name, catalog_name, workspace_display });
            //     } else {
            //         Output.prettyln("  Updated {s} in catalog ({s})", .{ update.package_name, workspace_display });
            //     }
            // }
        }

        // Output.prettyln("", .{});
        // Output.prettyln("<r><green>✓<r> Updated catalog definitions", .{});
    }

    fn updateInteractive(ctx: Command.Context, original_cwd: string, manager: *PackageManager) !void {
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
            ) catch bun.outOfMemory();
        } else if (manager.options.do.recursive) blk: {
            break :blk getAllWorkspaces(bun.default_allocator, manager) catch bun.outOfMemory();
        } else blk: {
            const root_pkg_id = manager.root_package_id.get(manager.lockfile, manager.workspace_name_hash);
            if (root_pkg_id == invalid_package_id) return;

            const ids = bun.default_allocator.alloc(PackageID, 1) catch bun.outOfMemory();
            ids[0] = root_pkg_id;
            break :blk ids;
        };
        defer bun.default_allocator.free(workspace_pkg_ids);

        try OutdatedCommand.updateManifestsIfNecessary(manager, workspace_pkg_ids);

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
            return;
        }

        // Prompt user to select packages
        const selected = try promptForUpdates(bun.default_allocator, outdated_packages);
        defer bun.default_allocator.free(selected);

        // Create package specifier array from selected packages
        // Group selected packages by workspace
        var workspace_updates = bun.StringHashMap(std.ArrayList([]const u8)).init(bun.default_allocator);
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
        var package_updates = std.ArrayList(PackageUpdate).init(bun.default_allocator);
        defer package_updates.deinit();

        // Process selected packages
        for (outdated_packages, selected) |pkg, is_selected| {
            if (!is_selected) continue;

            // Use latest version if requested (either via --latest flag or 'l' key toggle)
            const target_version = if (pkg.use_latest)
                pkg.latest_version
            else
                pkg.update_version;

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
                // TODO: In the future, support workspace-specific catalogs
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
                    try updateCatalogDefinitions(manager, original_cwd, catalog_updates);
                }

                // Update all package.json files directly (fast!)
                if (has_package_updates) {
                    try updatePackageJsonFilesFromUpdates(manager, package_updates.items);
                }

                // Get the root package.json from cache (should be updated after our saves)
                const root_package_json = switch (manager.workspace_package_json_cache.getWithPath(
                    manager.allocator,
                    manager.log,
                    manager.original_package_json_path,
                    .{ .guess_indentation = true },
                )) {
                    .parse_err => |err| {
                        Output.errGeneric("Failed to parse root package.json: {s}", .{@errorName(err)});
                        return;
                    },
                    .read_err => |err| {
                        Output.errGeneric("Failed to read root package.json: {s}", .{@errorName(err)});
                        return;
                    },
                    .entry => |entry| entry,
                };
                const root_package_json_contents = root_package_json.source.contents;

                // // Update all package.json files directly (to avoid conflicts with catalog updates)
                // if (has_package_updates) {
                //     try updatePackageJsonFilesFromUpdates(manager, package_updates.items);
                // }

                // Create UpdateRequests for the install summary
                var update_request_array = UpdateRequest.Array{};
                defer update_request_array.deinit(manager.allocator);

                // Collect all package specs to create UpdateRequests for the summary
                var all_package_specs = std.ArrayList([]const u8).init(manager.allocator);
                defer all_package_specs.deinit();

                for (package_updates.items) |update| {
                    const spec = try std.fmt.allocPrint(manager.allocator, "{s}@{s}", .{ update.name, update.target_version });
                    try all_package_specs.append(spec);
                }

                // Parse package specs into UpdateRequests for the install summary
                if (all_package_specs.items.len > 0) {
                    const updates = UpdateRequest.parse(
                        manager.allocator,
                        manager,
                        manager.log,
                        all_package_specs.items,
                        &update_request_array,
                        .update,
                    );
                    _ = updates; // We just need them in the array for the summary
                }

                // Set update mode so the install summary shows what was updated
                manager.to_update = true;
                manager.update_requests = update_request_array.items;

                // Use the internal installWithManager API instead of spawning a subprocess
                try PackageManager.installWithManager(manager, ctx, root_package_json_contents, original_cwd);
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

                            if (!glob.walk.matchImpl(allocator, pattern, strings.withoutTrailingSlash(abs_res_path)).matches()) {
                                break :matched false;
                            }
                        },
                        .name => |pattern| {
                            const name = pkg_names[workspace_pkg_id].slice(string_buf);

                            if (!glob.walk.matchImpl(allocator, pattern, name).matches()) {
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
        var catalog_map = bun.StringHashMap(std.ArrayList(OutdatedPackage)).init(allocator);
        defer catalog_map.deinit();
        defer {
            var iter = catalog_map.iterator();
            while (iter.next()) |entry| {
                entry.value_ptr.deinit();
            }
        }

        var result = std.ArrayList(OutdatedPackage).init(allocator);
        defer result.deinit();

        // Group catalog dependencies
        for (packages) |pkg| {
            if (pkg.is_catalog) {
                const entry = try catalog_map.getOrPut(pkg.name);
                if (!entry.found_existing) {
                    entry.value_ptr.* = std.ArrayList(OutdatedPackage).init(allocator);
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
                var workspace_names = std.ArrayList(u8).init(allocator);
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

        var outdated_packages = std.ArrayList(OutdatedPackage).init(allocator);
        defer outdated_packages.deinit();

        var version_buf = std.ArrayList(u8).init(allocator);
        defer version_buf.deinit();
        const version_writer = version_buf.writer();

        for (workspace_pkg_ids) |workspace_pkg_id| {
            const pkg_deps = pkg_dependencies[workspace_pkg_id];
            for (pkg_deps.begin()..pkg_deps.end()) |dep_id| {
                const package_id = lockfile.buffers.resolutions.items[dep_id];
                if (package_id == invalid_package_id) continue;
                const dep = lockfile.buffers.dependencies.items[dep_id];
                const resolved_version = resolveCatalogDependency(manager, dep) orelse continue;
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
                ) orelse continue;

                const latest = manifest.findByDistTag("latest") orelse continue;

                // In interactive mode, show the constrained update version as "Target"
                // but always include packages (don't filter out breaking changes)
                const update_version = if (resolved_version.tag == .npm)
                    manifest.findBestVersion(resolved_version.value.npm.version, string_buf) orelse latest
                else
                    manifest.findByDistTag(resolved_version.value.dist_tag.tag.slice(string_buf)) orelse latest;

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
                try version_writer.print("{}", .{resolution.value.npm.version.fmt(string_buf)});
                const current_version_buf = try allocator.dupe(u8, version_buf.items);

                version_buf.clearRetainingCapacity();
                try version_writer.print("{}", .{update_version.version.fmt(manifest.string_buf)});
                const update_version_buf = try allocator.dupe(u8, version_buf.items);

                version_buf.clearRetainingCapacity();
                try version_writer.print("{}", .{latest.version.fmt(manifest.string_buf)});
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
                    .use_latest = manager.options.do.update_to_latest, // Set based on --latest flag
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

        // Use natural widths without any limits
        return ColumnWidths{
            .name = max_name_len,
            .current = max_current_len,
            .target = max_target_len,
            .latest = max_latest_len,
            .workspace = max_workspace_len,
            .show_workspace = has_workspaces,
        };
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

        var state = MultiSelectState{
            .packages = packages,
            .selected = selected,
            .max_name_len = columns.name,
            .max_current_len = columns.current,
            .max_update_len = columns.target,
            .max_latest_len = columns.latest,
            .max_workspace_len = columns.workspace,
            .show_workspace = columns.show_workspace,
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

        const result = processMultiSelect(&state) catch |err| {
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

    fn processMultiSelect(state: *MultiSelectState) ![]bool {
        const colors = Output.enable_ansi_colors;

        // Clear any previous progress output
        Output.print("\r\x1B[2K", .{}); // Clear entire line
        Output.print("\x1B[1A\x1B[2K", .{}); // Move up one line and clear it too
        Output.flush();

        // Print the prompt
        Output.prettyln("<r><cyan>?<r> Select packages to update<d> - Space to toggle, Enter to confirm, a to select all, n to select none, i to invert, l to toggle latest<r>", .{});

        Output.prettyln("", .{});

        if (colors) Output.print("\x1b[?25l", .{}); // hide cursor
        defer if (colors) Output.print("\x1b[?25h", .{}); // show cursor

        var initial_draw = true;
        var reprint_menu = true;
        var total_lines: usize = 0;
        errdefer reprint_menu = false;
        defer {
            if (!initial_draw) {
                Output.up(total_lines + 2);
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
            if (!initial_draw) {
                Output.up(total_lines);
                Output.clearToEnd();
            }
            initial_draw = false;
            total_lines = 0;

            var displayed_lines: usize = 0;

            // Group by dependency type
            var current_dep_type: ?[]const u8 = null;

            for (state.packages, state.selected, 0..) |*pkg, selected, i| {
                // Print dependency type header with column headers if changed
                if (current_dep_type == null or !strings.eql(current_dep_type.?, pkg.dependency_type)) {
                    if (displayed_lines > 0) {
                        Output.print("\n", .{});
                        displayed_lines += 1;
                    }

                    // Count selected packages in this dependency type
                    var selected_count: usize = 0;
                    for (state.packages, state.selected) |p, sel| {
                        if (strings.eql(p.dependency_type, pkg.dependency_type) and sel) {
                            selected_count += 1;
                        }
                    }

                    // Print dependency type - bold if any selected
                    Output.print("  ", .{});
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
                    displayed_lines += 1;
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

                // Package name - make it a hyperlink if colors are enabled and using default registry
                const uses_default_registry = pkg.manager.options.scope.url_hash == Install.Npm.Registry.default_url_hash and
                    pkg.manager.scopeForPackageName(pkg.name).url_hash == Install.Npm.Registry.default_url_hash;
                const package_url = if (Output.enable_ansi_colors and uses_default_registry)
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

                const hyperlink = TerminalHyperlink.new(package_url, pkg.name, package_url.len > 0);

                if (selected) {
                    if (strings.eqlComptime(checkbox_color, "red")) {
                        Output.pretty("<r><red>{}<r>", .{hyperlink});
                    } else if (strings.eqlComptime(checkbox_color, "yellow")) {
                        Output.pretty("<r><yellow>{}<r>", .{hyperlink});
                    } else {
                        Output.pretty("<r><green>{}<r>", .{hyperlink});
                    }
                } else {
                    Output.pretty("<r>{}<r>", .{hyperlink});
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

                // Current version
                Output.pretty("<r>{s}<r>", .{pkg.current_version});

                // Print padding after current version (2 spaces)
                const current_padding = if (pkg.current_version.len >= state.max_current_len) 0 else state.max_current_len - pkg.current_version.len;
                j = 0;
                while (j < current_padding + 2) : (j += 1) {
                    Output.print(" ", .{});
                }

                // Target version with diffFmt coloring - bold if not using latest
                const target_ver_parsed = Semver.Version.parse(SlicedString.init(pkg.update_version, pkg.update_version));

                // For width calculation, use the plain version string length
                // since diffFmt only adds colors, not visible characters
                const target_width: usize = pkg.update_version.len;

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

                    // Print target version
                    if (selected and !pkg.use_latest) {
                        Output.print("\x1B[4m", .{}); // Start underline
                    }
                    Output.pretty("{}", .{target_full.diffFmt(
                        current_full,
                        pkg.update_version,
                        pkg.current_version,
                    )});
                    if (selected and !pkg.use_latest) {
                        Output.print("\x1B[24m", .{}); // End underline
                    }
                } else {
                    // Fallback if version parsing fails
                    if (selected and !pkg.use_latest) {
                        Output.print("\x1B[4m", .{}); // Start underline
                    }
                    Output.pretty("<r>{s}<r>", .{pkg.update_version});
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
                    Output.pretty("{}", .{latest_full.diffFmt(
                        current_full,
                        pkg.latest_version,
                        pkg.current_version,
                    )});
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
                    Output.pretty("<r>{s}<r>", .{pkg.latest_version});
                    if (selected and pkg.use_latest) {
                        Output.print("\x1B[24m", .{}); // End underline
                    }
                    if (is_same_as_target) {
                        Output.print("\x1B[22m", .{}); // Reset dim
                    }
                }

                // Workspace column
                if (state.show_workspace) {
                    const latest_width: usize = pkg.latest_version.len;
                    const latest_padding = if (latest_width >= state.max_latest_len) 0 else state.max_latest_len - latest_width;
                    j = 0;
                    while (j < latest_padding + 2) : (j += 1) {
                        Output.print(" ", .{});
                    }
                    Output.pretty("<r><d>{s}<r>", .{pkg.workspace_name});
                }

                Output.print("\x1B[0K\n", .{});
                displayed_lines += 1;
            }

            total_lines = displayed_lines;
            Output.clearToEnd();
            Output.flush();

            // Read input
            const byte = std.io.getStdIn().reader().readByte() catch return state.selected;

            switch (byte) {
                '\n', '\r' => return state.selected,
                3, 4 => return error.EndOfStream, // ctrl+c, ctrl+d
                ' ' => {
                    state.selected[state.cursor] = !state.selected[state.cursor];
                    // Individual selection resets toggle_all mode
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
                        // Individual selection mode, just toggle current cursor package
                        state.packages[state.cursor].use_latest = !state.packages[state.cursor].use_latest;
                    }
                },
                'j' => {
                    if (state.cursor < state.packages.len - 1) {
                        state.cursor += 1;
                    } else {
                        state.cursor = 0;
                    }
                    state.toggle_all = false;
                },
                'k' => {
                    if (state.cursor > 0) {
                        state.cursor -= 1;
                    } else {
                        state.cursor = state.packages.len - 1;
                    }
                    state.toggle_all = false;
                },
                27 => { // escape sequence
                    const seq = std.io.getStdIn().reader().readByte() catch continue;
                    if (seq == '[') {
                        const arrow = std.io.getStdIn().reader().readByte() catch continue;
                        switch (arrow) {
                            'A' => { // up arrow
                                if (state.cursor > 0) {
                                    state.cursor -= 1;
                                } else {
                                    state.cursor = state.packages.len - 1;
                                }
                            },
                            'B' => { // down arrow
                                if (state.cursor < state.packages.len - 1) {
                                    state.cursor += 1;
                                } else {
                                    state.cursor = 0;
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
    if (original_version.len > 0) {
        const first_char = original_version[0];
        if (first_char == '^' or first_char == '~' or first_char == '>' or first_char == '<' or first_char == '=') {
            return try std.fmt.allocPrint(allocator, "{c}{s}", .{ first_char, new_version });
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
const FileSystem = bun.fs.FileSystem;

const Semver = bun.Semver;
const SlicedString = Semver.SlicedString;
const String = Semver.String;

const JSAst = bun.ast;
const E = JSAst.E;
const Expr = JSAst.Expr;

const Command = bun.cli.Command;
const OutdatedCommand = bun.cli.OutdatedCommand;

const Install = bun.install;
const DependencyID = Install.DependencyID;
const PackageID = Install.PackageID;
const invalid_package_id = Install.invalid_package_id;
const Behavior = Install.Dependency.Behavior;

const PackageManager = Install.PackageManager;
const PackageJSONEditor = PackageManager.PackageJSONEditor;
const UpdateRequest = PackageManager.UpdateRequest;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
