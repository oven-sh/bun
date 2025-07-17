pub const TerminalHyperlink = struct {
    link: []const u8,
    text: []const u8,
    enabled: bool,

    const Protocol = enum {
        vscode,
        cursor,
    };

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
    };
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

    fn updatePackages(
        manager: *PackageManager,
        ctx: Command.Context,
        updates: []UpdateRequest,
        original_cwd: string,
    ) !void {
        // This function follows the same pattern as updatePackageJSONAndInstallWithManagerWithUpdates
        // from updatePackageJSONAndInstall.zig

        // Load and parse the current package.json
        var current_package_json = switch (manager.workspace_package_json_cache.getWithPath(
            manager.allocator,
            manager.log,
            manager.original_package_json_path,
            .{ .guess_indentation = true },
        )) {
            .parse_err => |err| {
                manager.log.print(Output.errorWriter()) catch {};
                Output.errGeneric("failed to parse package.json \"{s}\": {s}", .{
                    manager.original_package_json_path,
                    @errorName(err),
                });
                Global.crash();
            },
            .read_err => |err| {
                Output.errGeneric("failed to read package.json \"{s}\": {s}", .{
                    manager.original_package_json_path,
                    @errorName(err),
                });
                Global.crash();
            },
            .entry => |entry| entry,
        };

        const current_package_json_indent = current_package_json.indentation;
        const preserve_trailing_newline = current_package_json.source.contents.len > 0 and
            current_package_json.source.contents[current_package_json.source.contents.len - 1] == '\n';

        // Set update mode
        manager.to_update = true;
        manager.update_requests = updates;

        // Edit the package.json with all updates
        // For interactive mode, we'll edit all as dependencies
        // TODO: preserve original dependency types
        var updates_mut = updates;
        try PackageJSONEditor.edit(
            manager,
            &updates_mut,
            &current_package_json.root,
            "dependencies",
            .{
                .exact_versions = manager.options.enable.exact_versions,
                .before_install = true,
            },
        );

        // Serialize the updated package.json
        var buffer_writer = JSPrinter.BufferWriter.init(manager.allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(manager.allocator, current_package_json.source.contents.len + 1);
        buffer_writer.append_newline = preserve_trailing_newline;
        var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

        _ = JSPrinter.printJSON(
            @TypeOf(&package_json_writer),
            &package_json_writer,
            current_package_json.root,
            &current_package_json.source,
            .{
                .indent = current_package_json_indent,
                .mangled_props = null,
            },
        ) catch |err| {
            Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
            Global.crash();
        };

        const new_package_json_source = try manager.allocator.dupe(u8, package_json_writer.ctx.writtenWithoutTrailingZero());

        // Call installWithManager to perform the installation
        try manager.installWithManager(ctx, new_package_json_source, original_cwd);
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

        switch (Output.enable_ansi_colors) {
            inline else => |_| {
                const workspace_pkg_ids = if (manager.options.filter_patterns.len > 0) blk: {
                    const filters = manager.options.filter_patterns;
                    break :blk findMatchingWorkspaces(
                        bun.default_allocator,
                        original_cwd,
                        manager,
                        filters,
                    ) catch bun.outOfMemory();
                } else blk: {
                    // just the current workspace
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
                    // Check if we're using --latest flag
                    const is_latest_mode = manager.options.do.update_to_latest;

                    if (is_latest_mode) {
                        Output.prettyln("<r><green>✓<r> All packages are up to date!", .{});
                    } else {
                        // Count how many packages have newer versions available
                        var packages_with_newer_versions: usize = 0;

                        // We need to check all packages for newer versions
                        for (workspace_pkg_ids) |workspace_pkg_id| {
                            const pkg_deps = manager.lockfile.packages.items(.dependencies)[workspace_pkg_id];
                            for (pkg_deps.begin()..pkg_deps.end()) |dep_id| {
                                const package_id = manager.lockfile.buffers.resolutions.items[dep_id];
                                if (package_id == invalid_package_id) continue;
                                const dep = manager.lockfile.buffers.dependencies.items[dep_id];
                                const resolved_version = resolveCatalogDependency(manager, dep) orelse continue;
                                if (resolved_version.tag != .npm and resolved_version.tag != .dist_tag) continue;
                                const resolution = manager.lockfile.packages.items(.resolution)[package_id];
                                if (resolution.tag != .npm) continue;

                                const package_name = manager.lockfile.packages.items(.name)[package_id].slice(manager.lockfile.buffers.string_bytes.items);

                                var expired = false;
                                const manifest = manager.manifests.byNameAllowExpired(
                                    manager,
                                    manager.scopeForPackageName(package_name),
                                    package_name,
                                    &expired,
                                    .load_from_memory_fallback_to_disk,
                                ) orelse continue;

                                const latest = manifest.findByDistTag("latest") orelse continue;

                                // Check if current version is less than latest
                                if (resolution.value.npm.version.order(latest.version, manager.lockfile.buffers.string_bytes.items, manifest.string_buf) == .lt) {
                                    packages_with_newer_versions += 1;
                                }
                            }
                        }

                        if (packages_with_newer_versions > 0) {
                            Output.prettyln("<r><green>✓<r> All packages are up to date!\n", .{});
                            Output.prettyln("<r><d>Excluded {d} package{s} with potentially breaking changes. Run <cyan>`bun update -i --latest`<r><d> to update<r>", .{ packages_with_newer_versions, if (packages_with_newer_versions == 1) "" else "s" });
                        } else {
                            Output.prettyln("<r><green>✓<r> All packages are up to date!", .{});
                        }
                    }
                    return;
                }

                // Prompt user to select packages
                const selected = try promptForUpdates(bun.default_allocator, outdated_packages);
                defer bun.default_allocator.free(selected);

                // Create package specifier array from selected packages
                var package_specifiers = std.ArrayList([]const u8).init(bun.default_allocator);
                defer package_specifiers.deinit();

                // Create a map to track dependency types for packages
                var dep_types = bun.StringHashMap([]const u8).init(bun.default_allocator);
                defer dep_types.deinit();

                for (outdated_packages, selected) |pkg, is_selected| {
                    if (!is_selected) continue;

                    try dep_types.put(pkg.name, pkg.dependency_type);

                    // Use latest version if user selected it with 'l' key
                    const target_version = if (pkg.use_latest) pkg.latest_version else pkg.update_version;

                    // Create a full package specifier string for UpdateRequest.parse
                    const package_specifier = try std.fmt.allocPrint(bun.default_allocator, "{s}@{s}", .{ pkg.name, target_version });

                    try package_specifiers.append(package_specifier);
                }

                // dep_types will be freed when we exit this scope

                if (package_specifiers.items.len == 0) {
                    Output.prettyln("<r><yellow>!</r> No packages selected for update", .{});
                    return;
                }

                // Parse the package specifiers into UpdateRequests
                var update_requests_array = UpdateRequest.Array{};
                const update_requests = UpdateRequest.parse(
                    bun.default_allocator,
                    manager,
                    manager.log,
                    package_specifiers.items,
                    &update_requests_array,
                    .update,
                );

                // Perform the update
                Output.prettyln("\n<r><cyan>Installing updates...<r>", .{});
                Output.flush();

                try updatePackages(
                    manager,
                    ctx,
                    update_requests,
                    original_cwd,
                );
            },
        }
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

                const update_version = if (manager.options.do.update_to_latest)
                    latest
                else if (resolved_version.tag == .npm)
                    manifest.findBestVersion(resolved_version.value.npm.version, string_buf) orelse continue
                else
                    manifest.findByDistTag(resolved_version.value.dist_tag.tag.slice(string_buf)) orelse continue;

                // Skip if current version is already the latest
                if (resolution.value.npm.version.order(latest.version, string_buf, manifest.string_buf) != .lt) continue;

                // Skip if update version is the same as current version
                // Note: Current version is in lockfile's string_buf, update version is in manifest's string_buf
                const current_ver = resolution.value.npm.version;
                const update_ver = update_version.version;

                // Compare the actual version numbers
                if (current_ver.major == update_ver.major and
                    current_ver.minor == update_ver.minor and
                    current_ver.patch == update_ver.patch and
                    current_ver.tag.eql(update_ver.tag))
                {
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
                });
            }
        }

        const result = try outdated_packages.toOwnedSlice();

        // Sort packages: dependencies first, then devDependencies, etc.
        std.sort.pdq(OutdatedPackage, result, {}, struct {
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

        return result;
    }

    const ColumnWidths = struct {
        name: usize,
        current: usize,
        target: usize,
        latest: usize,
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
    };

    fn calculateColumnWidths(packages: []OutdatedPackage) ColumnWidths {
        // Calculate natural widths based on content
        var max_name_len: usize = "Package".len;
        var max_current_len: usize = "Current".len;
        var max_target_len: usize = "Target".len;
        var max_latest_len: usize = "Latest".len;

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
        }

        // Apply reasonable maximum limits to prevent excessive width
        const MAX_NAME_WIDTH = 50;
        const MAX_VERSION_WIDTH = 25;
        
        return ColumnWidths{
            .name = @min(max_name_len, MAX_NAME_WIDTH),
            .current = @min(max_current_len, MAX_VERSION_WIDTH),
            .target = @min(max_target_len, MAX_VERSION_WIDTH),
            .latest = @min(max_latest_len, MAX_VERSION_WIDTH),
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
                    // So we need to pad: 4 (cursor/space) + 2 (checkbox+space) + max_name_len + 4 (name padding) - dep_type_text_len
                    // Use safe subtraction to prevent underflow when dep_type_text_len is longer than available space
                    const base_padding = 4 + 2 + state.max_name_len + 4;
                    const padding_to_current = if (dep_type_text_len >= base_padding) 1 else base_padding - dep_type_text_len;
                    while (j < padding_to_current) : (j += 1) {
                        Output.print(" ", .{});
                    }

                    // Column headers aligned with their columns
                    Output.print("Current", .{});
                    j = 0;
                    while (j < state.max_current_len - "Current".len + 4) : (j += 1) {
                        Output.print(" ", .{});
                    }
                    Output.print("Target", .{});
                    j = 0;
                    while (j < state.max_update_len - "Target".len + 2) : (j += 1) {
                        Output.print(" ", .{});
                    }
                    Output.print("Latest", .{});
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

                // Truncate package name if it's too long
                const display_name = if (pkg.name.len > state.max_name_len and state.max_name_len > 3)
                    try std.fmt.allocPrint(bun.default_allocator, "{s}...", .{pkg.name[0..state.max_name_len-3]})
                else
                    pkg.name;
                defer if (display_name.ptr != pkg.name.ptr) bun.default_allocator.free(display_name);

                const hyperlink = TerminalHyperlink.new(package_url, display_name, package_url.len > 0);

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

                // Print padding after name (4 spaces as requested)
                var j: usize = 0;
                while (j < name_padding + 4) : (j += 1) {
                    Output.print(" ", .{});
                }

                // Current version - truncate if too long
                const display_current = if (pkg.current_version.len > state.max_current_len and state.max_current_len > 3)
                    try std.fmt.allocPrint(bun.default_allocator, "{s}...", .{pkg.current_version[0..state.max_current_len-3]})
                else
                    pkg.current_version;
                defer if (display_current.ptr != pkg.current_version.ptr) bun.default_allocator.free(display_current);

                Output.pretty("<r>{s}<r>", .{display_current});

                // Print padding after current version (4 spaces as requested)
                const current_display_len = if (pkg.current_version.len > state.max_current_len) state.max_current_len else pkg.current_version.len;
                const current_padding = if (current_display_len >= state.max_current_len) 0 else state.max_current_len - current_display_len;
                j = 0;
                while (j < current_padding + 4) : (j += 1) {
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
                    // Don't move cursor on space - let user manually navigate
                },
                'a', 'A' => {
                    @memset(state.selected, true);
                },
                'n', 'N' => {
                    @memset(state.selected, false);
                },
                'i', 'I' => {
                    // Invert selection
                    for (state.selected) |*sel| {
                        sel.* = !sel.*;
                    }
                },
                'l', 'L' => {
                    state.packages[state.cursor].use_latest = !state.packages[state.cursor].use_latest;
                },
                'j' => {
                    if (state.cursor < state.packages.len - 1) {
                        state.cursor += 1;
                    } else {
                        state.cursor = 0;
                    }
                },
                'k' => {
                    if (state.cursor > 0) {
                        state.cursor -= 1;
                    } else {
                        state.cursor = state.packages.len - 1;
                    }
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
                },
                else => {},
            }
        }
    }
};

extern fn Bun__ttySetMode(fd: c_int, mode: c_int) c_int;

// @sortImports

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const JSPrinter = bun.js_printer;
const OOM = bun.OOM;
const Output = bun.Output;
const PathBuffer = bun.PathBuffer;
const glob = bun.glob;
const path = bun.path;
const string = bun.string;
const strings = bun.strings;
const FileSystem = bun.fs.FileSystem;

const Command = bun.CLI.Command;
const OutdatedCommand = bun.CLI.OutdatedCommand;

const Semver = bun.Semver;
const SlicedString = Semver.SlicedString;

const Install = bun.install;
const DependencyID = Install.DependencyID;
const PackageID = Install.PackageID;
const invalid_package_id = Install.invalid_package_id;
const Behavior = Install.Dependency.Behavior;

const PackageManager = Install.PackageManager;
const PackageJSONEditor = PackageManager.PackageJSONEditor;
const UpdateRequest = PackageManager.UpdateRequest;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
