const std = @import("std");
const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const Command = bun.CLI.Command;
const Install = bun.install;
const PackageManager = Install.PackageManager;
const PackageID = Install.PackageID;
const DependencyID = Install.DependencyID;
const Behavior = Install.Dependency.Behavior;
const invalid_package_id = Install.invalid_package_id;
const Resolution = Install.Resolution;
const string = bun.string;
const strings = bun.strings;
const String = bun.String;
const PathBuffer = bun.PathBuffer;
const FileSystem = bun.fs.FileSystem;
const path = bun.path;
const glob = bun.glob;
const Table = bun.fmt.Table;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
const OOM = bun.OOM;
const UpdateRequest = Install.UpdateRequest;
const PackageJSONEditor = Install.PackageJSONEditor;
const JSPrinter = bun.js_printer;
const JSAst = bun.JSAst;
const Environment = bun.Environment;
const logger = bun.logger;

extern fn Bun__ttySetMode(fd: c_int, mode: c_int) c_int;

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
        _: std.mem.Allocator,
        manager: *PackageManager,
        ctx: Command.Context,
        updates: []UpdateRequest,
        original_cwd: string,
    ) !void {
        // Get the current package.json
        var current_package_json = switch (manager.workspace_package_json_cache.getWithPath(
            manager.allocator,
            manager.log,
            manager.original_package_json_path,
            .{
                .guess_indentation = true,
            },
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
        
        // Preserve trailing newline if it exists
        const preserve_trailing_newline_at_eof_for_package_json = current_package_json.source.contents.len > 0 and
            current_package_json.source.contents[current_package_json.source.contents.len - 1] == '\n';
        
        // Get dependency types from the stored map
        const dep_types = manager.update_dependency_types;
        
        // Set the update requests on the manager
        manager.update_requests = updates;
        manager.to_update = true;
        
        // First pass: edit package.json with the update requests
        for (updates) |*update| {
            const dep_type = dep_types.get(update.name) orelse "dependencies";
            var update_slice = [_]UpdateRequest{update.*};
            try PackageJSONEditor.edit(
                manager,
                &update_slice,
                &current_package_json.root,
                dep_type,
                .{
                    .exact_versions = manager.options.enable.exact_versions,
                    .before_install = true,
                },
            );
        }
        
        // Create a buffer for the updated package.json
        var buffer_writer = JSPrinter.BufferWriter.init(manager.allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(manager.allocator, current_package_json.source.contents.len + 1);
        buffer_writer.append_newline = preserve_trailing_newline_at_eof_for_package_json;
        var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);
        
        // Serialize the updated package.json
        var written = JSPrinter.printJSON(
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
        
        var new_package_json_source = try manager.allocator.dupe(u8, package_json_writer.ctx.writtenWithoutTrailingZero());
        current_package_json.source.contents = new_package_json_source;
        
        // Call installWithManager to perform the installation
        const installWithManager = @import("../install/PackageManager/install_with_manager.zig").installWithManager;
        try installWithManager(manager, ctx, new_package_json_source, original_cwd);
        
        // Check for failures
        for (updates) |request| {
            if (request.failed) {
                Global.exit(1);
                return;
            }
        }
        
        // Re-parse package.json to update with exact versions from lockfile
        const source = &bun.logger.Source.initPathString("package.json", new_package_json_source);
        var new_package_json = bun.JSON.parsePackageJSONUTF8(source, manager.log, manager.allocator) catch |err| {
            Output.prettyErrorln("package.json failed to parse due to error {s}", .{@errorName(err)});
            Global.crash();
        };
        
        // Second pass: update with exact versions
        for (updates) |*update| {
            const dep_type = dep_types.get(update.name) orelse "dependencies";
            var update_slice = [_]UpdateRequest{update.*};
            try PackageJSONEditor.edit(
                manager,
                &update_slice,
                &new_package_json,
                dep_type,
                .{
                    .exact_versions = manager.options.enable.exact_versions,
                    .add_trusted_dependencies = manager.options.do.trust_dependencies_from_args,
                },
            );
        }
        
        var buffer_writer_two = JSPrinter.BufferWriter.init(manager.allocator);
        try buffer_writer_two.buffer.list.ensureTotalCapacity(manager.allocator, source.contents.len + 1);
        buffer_writer_two.append_newline = preserve_trailing_newline_at_eof_for_package_json;
        var package_json_writer_two = JSPrinter.BufferPrinter.init(buffer_writer_two);
        
        written = JSPrinter.printJSON(
            @TypeOf(&package_json_writer_two),
            &package_json_writer_two,
            new_package_json,
            source,
            .{
                .indent = current_package_json_indent,
                .mangled_props = null,
            },
        ) catch |err| {
            Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
            Global.crash();
        };
        
        new_package_json_source = try manager.allocator.dupe(u8, package_json_writer_two.ctx.writtenWithoutTrailingZero());
        
        // Write the updated package.json to disk
        if (manager.options.do.write_package_json) {
            const workspace_package_json_file = (try bun.sys.File.openat(
                .cwd(),
                manager.original_package_json_path,
                bun.O.RDWR,
                0,
            ).unwrap()).handle.stdFile();
            
            try workspace_package_json_file.pwriteAll(new_package_json_source, 0);
            std.posix.ftruncate(workspace_package_json_file.handle, new_package_json_source.len) catch {};
            workspace_package_json_file.close();
        }
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

                try updateManifestsIfNecessary(manager, workspace_pkg_ids);
                
                // Get outdated packages
                const outdated_packages = try getOutdatedPackages(bun.default_allocator, manager, workspace_pkg_ids);
                defer {
                    for (outdated_packages) |pkg| {
                        bun.default_allocator.free(pkg.name);
                        bun.default_allocator.free(pkg.current_version);
                        bun.default_allocator.free(pkg.latest_version);
                        bun.default_allocator.free(pkg.update_version);
                    }
                    bun.default_allocator.free(outdated_packages);
                }
                
                if (outdated_packages.len == 0) {
                    Output.prettyln("<r><green>✓<r> All packages are up to date!", .{});
                    return;
                }
                
                // Prompt user to select packages
                const selected = try promptForUpdates(bun.default_allocator, outdated_packages);
                defer bun.default_allocator.free(selected);
                
                // Create UpdateRequest array from selected packages
                var update_requests = std.ArrayList(UpdateRequest).init(bun.default_allocator);
                defer update_requests.deinit();
                
                // Create a map to track dependency types for packages
                var dep_types = std.StringHashMap([]const u8).init(bun.default_allocator);
                defer dep_types.deinit();
                
                for (outdated_packages, selected) |pkg, is_selected| {
                    if (!is_selected) continue;
                    
                    try dep_types.put(pkg.name, pkg.dependency_type);
                    
                    // Parse the version string into a proper version
                    var update_request = UpdateRequest{};
                    update_request.name = try bun.default_allocator.dupe(u8, pkg.name);
                    update_request.name_hash = String.Builder.stringHash(pkg.name);
                    update_request.version_buf = try bun.default_allocator.dupe(u8, pkg.update_version);
                    
                    // For npm packages, we use the version directly
                    if (strings.hasPrefixComptime(pkg.update_version, "^") or 
                        strings.hasPrefixComptime(pkg.update_version, "~") or
                        strings.hasPrefixComptime(pkg.update_version, ">=") or
                        strings.hasPrefixComptime(pkg.update_version, ">") or
                        strings.hasPrefixComptime(pkg.update_version, "<") or
                        strings.hasPrefixComptime(pkg.update_version, "<=") or
                        (pkg.update_version[0] >= '0' and pkg.update_version[0] <= '9')) {
                        update_request.version = .{
                            .tag = .npm,
                            .value = .{ .npm = .{} },
                            .literal = String.init(update_request.version_buf, update_request.version_buf),
                        };
                    } else {
                        // dist tag
                        update_request.version = .{
                            .tag = .dist_tag,
                            .value = .{ .dist_tag = .{ .tag = String.init(update_request.version_buf, update_request.version_buf) } },
                            .literal = String.init(update_request.version_buf, update_request.version_buf),
                        };
                    }
                    
                    try update_requests.append(update_request);
                }
                
                // Store the dependency types on the manager for later use
                manager.update_dependency_types = dep_types;
                
                if (update_requests.items.len == 0) {
                    Output.prettyln("<r><yellow>!</r> No packages selected for update", .{});
                    return;
                }
                
                // Perform the update
                Output.prettyln("\n<r><cyan>Installing updates...<r>", .{});
                Output.flush();
                
                try updatePackages(
                    bun.default_allocator,
                    manager,
                    ctx,
                    update_requests.items,
                    original_cwd,
                );
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
                
                const update_version = if (resolved_version.tag == .npm)
                    manifest.findBestVersion(resolved_version.value.npm.version, string_buf) orelse continue
                else
                    manifest.findByDistTag(resolved_version.value.dist_tag.tag.slice(string_buf)) orelse continue;
                
                if (resolution.value.npm.version.order(latest.version, string_buf, manifest.string_buf) != .lt) continue;
                
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
                
                try outdated_packages.append(.{
                    .name = try allocator.dupe(u8, name_slice),
                    .current_version = try allocator.dupe(u8, current_version_buf),
                    .latest_version = try allocator.dupe(u8, latest_version_buf),
                    .update_version = try allocator.dupe(u8, update_version_buf),
                    .package_id = package_id,
                    .dep_id = dep_id,
                    .workspace_pkg_id = workspace_pkg_id,
                    .dependency_type = dep_type,
                });
            }
        }
        
        return try outdated_packages.toOwnedSlice();
    }

    const MultiSelectState = struct {
        packages: []const OutdatedPackage,
        selected: []bool,
        cursor: usize = 0,
        toggle_all: bool = false,
    };

    fn promptForUpdates(allocator: std.mem.Allocator, packages: []const OutdatedPackage) ![]bool {
        if (packages.len == 0) {
            Output.prettyln("<r><green>✓<r> All packages are up to date!", .{});
            return allocator.alloc(bool, 0);
        }

        const selected = try allocator.alloc(bool, packages.len);
        @memset(selected, false);

        var state = MultiSelectState{
            .packages = packages,
            .selected = selected,
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

        // Print the prompt
        Output.prettyln("<r><cyan>?<r> Select packages to update<d> - Space to toggle, Enter to confirm, a to select all, n to select none<r>", .{});
        Output.prettyln("", .{});

        if (colors) Output.print("\x1b[?25l", .{}); // hide cursor
        defer if (colors) Output.print("\x1b[?25h", .{}); // show cursor

        var initial_draw = true;
        var reprint_menu = true;
        errdefer reprint_menu = false;
        defer {
            if (!initial_draw) {
                Output.up(state.packages.len + 2);
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
                Output.up(state.packages.len);
            }
            initial_draw = false;

            // Print packages
            for (state.packages, state.selected, 0..) |pkg, selected, i| {
                const is_cursor = i == state.cursor;
                const cursor_symbol = if (colors) "❯" else ">";
                const checkbox = if (selected) "[x]" else "[ ]";
                
                if (is_cursor) {
                    if (colors) {
                        Output.pretty("<r><cyan>{s}<r> ", .{cursor_symbol});
                        Output.print("\x1B[4m{s} {s} {s} → {s}\x1B[24m\x1B[0K\n", .{ checkbox, pkg.name, pkg.current_version, pkg.latest_version });
                    } else {
                        Output.pretty("<r><cyan>{s}<r> {s} {s} {s} → {s}\x1B[0K\n", .{ cursor_symbol, checkbox, pkg.name, pkg.current_version, pkg.latest_version });
                    }
                } else {
                    Output.print("  {s} {s} {s} → {s}\x1B[0K\n", .{ checkbox, pkg.name, pkg.current_version, pkg.latest_version });
                }
            }
            Output.clearToEnd();
            Output.flush();

            // Read input
            const byte = std.io.getStdIn().reader().readByte() catch return state.selected;

            switch (byte) {
                '\n', '\r' => return state.selected,
                3, 4 => return error.EndOfStream, // ctrl+c, ctrl+d
                ' ' => {
                    state.selected[state.cursor] = !state.selected[state.cursor];
                    if (state.cursor < state.packages.len - 1) {
                        state.cursor += 1;
                    }
                },
                'a', 'A' => {
                    @memset(state.selected, true);
                },
                'n', 'N' => {
                    @memset(state.selected, false);
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

    fn updateManifestsIfNecessary(
        manager: *PackageManager,
        workspace_pkg_ids: []const PackageID,
    ) !void {
        const log_level = manager.options.log_level;
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
                const resolved_version = resolveCatalogDependency(manager, dep) orelse continue;
                if (resolved_version.tag != .npm and resolved_version.tag != .dist_tag) continue;
                const resolution: Install.Resolution = pkg_resolutions[package_id];
                if (resolution.tag != .npm) continue;

                const package_name = pkg_names[package_id].slice(string_buf);
                _ = manager.manifests.byName(
                    manager,
                    manager.scopeForPackageName(package_name),
                    package_name,
                    .load_from_memory_fallback_to_disk,
                ) orelse {
                    const task_id = Install.Task.Id.forManifest(package_name);
                    if (manager.hasCreatedNetworkTask(task_id, dep.behavior.optional)) continue;

                    manager.startProgressBarIfNone();

                    var task = manager.getNetworkTask();
                    task.* = .{
                        .package_manager = manager,
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
                        closure.manager.options.log_level,
                    ) catch |err| {
                        closure.err = err;
                        return true;
                    };
                    return false;
                }
                return true;
            }
        };

        var run = RunClosure{ .manager = manager };
        manager.sleepUntil(&run, &RunClosure.isDone);
        if (run.err) |err| {
            return err;
        }
    }
};
