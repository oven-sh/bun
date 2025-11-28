const PackagePath = struct {
    pkg_path: []PackageID,
    dep_path: []DependencyID,
};

pub const SecurityAdvisoryLevel = enum { fatal, warn };

pub const SecurityAdvisory = struct {
    level: SecurityAdvisoryLevel,
    package: []const u8,
    url: ?[]const u8,
    description: ?[]const u8,
    pkg_path: ?[]const PackageID = null,
};

pub const SecurityScanResults = struct {
    advisories: []SecurityAdvisory,
    fatal_count: usize,
    warn_count: usize,
    packages_scanned: usize,
    duration_ms: i64,
    security_scanner: []const u8,
    allocator: std.mem.Allocator,

    pub fn deinit(this: *SecurityScanResults) void {
        for (this.advisories) |advisory| {
            this.allocator.free(advisory.package);
            if (advisory.description) |desc| this.allocator.free(desc);
            if (advisory.url) |url| this.allocator.free(url);
            if (advisory.pkg_path) |path| this.allocator.free(path);
        }
        this.allocator.free(this.advisories);
    }

    pub fn hasFatalAdvisories(this: *const SecurityScanResults) bool {
        return this.fatal_count > 0;
    }

    pub fn hasWarnings(this: *const SecurityScanResults) bool {
        return this.warn_count > 0;
    }

    pub fn hasAdvisories(this: *const SecurityScanResults) bool {
        return this.advisories.len > 0;
    }
};

pub fn doPartialInstallOfSecurityScanner(
    manager: *PackageManager,
    ctx: bun.cli.Command.Context,
    log_level: bun.install.PackageManager.Options.LogLevel,
    security_scanner_pkg_id: PackageID,
    original_cwd: []const u8,
) !void {
    const workspace_filters, const install_root_dependencies = try InstallWithManager.getWorkspaceFilters(manager, original_cwd);
    defer manager.allocator.free(workspace_filters);

    if (!manager.options.do.install_packages) {
        return;
    }

    if (security_scanner_pkg_id == invalid_package_id) {
        Output.errGeneric("Cannot perform partial install: security scanner package ID is invalid", .{});
        return error.InvalidPackageID;
    }

    const packages_to_install: ?[]const PackageID = &[_]PackageID{security_scanner_pkg_id};

    const summary = switch (manager.options.node_linker) {
        .hoisted,
        // TODO
        .auto,
        => try HoistedInstall.installHoistedPackages(
            manager,
            ctx,
            workspace_filters,
            install_root_dependencies,
            log_level,
            packages_to_install,
        ),

        .isolated => try IsolatedInstall.installIsolatedPackages(
            manager,
            ctx,
            install_root_dependencies,
            workspace_filters,
            packages_to_install,
        ),
    };

    if (bun.Environment.isDebug) {
        bun.Output.debugWarn("Partial install summary - success: {d}, fail: {d}, skipped: {d}", .{ summary.success, summary.fail, summary.skipped });
    }

    if (summary.fail > 0) {
        Output.errGeneric("Failed to install security scanner package (failed: {d}, success: {d})", .{ summary.fail, summary.success });
        return error.PartialInstallFailed;
    }

    if (summary.success == 0 and summary.skipped == 0) {
        Output.errGeneric("No packages were installed during security scanner installation", .{});
        return error.NoPackagesInstalled;
    }
}

pub const ScanAttemptResult = union(enum) {
    success: SecurityScanResults,
    needs_install: PackageID,
    @"error": anyerror,
};

const ScannerFinder = struct {
    manager: *PackageManager,
    scanner_name: []const u8,

    pub fn findInRootDependencies(this: ScannerFinder) ?PackageID {
        const pkgs = this.manager.lockfile.packages.slice();
        const pkg_dependencies = pkgs.items(.dependencies);
        const pkg_resolutions = pkgs.items(.resolution);
        const string_buf = this.manager.lockfile.buffers.string_bytes.items;

        const root_pkg_id: PackageID = 0;
        const root_deps = pkg_dependencies[root_pkg_id];

        for (root_deps.begin()..root_deps.end()) |_dep_id| {
            const dep_id: DependencyID = @intCast(_dep_id);
            const dep_pkg_id = this.manager.lockfile.buffers.resolutions.items[dep_id];

            if (dep_pkg_id == invalid_package_id) continue;

            const dep_res = pkg_resolutions[dep_pkg_id];
            if (dep_res.tag != .npm) continue;

            const dep_name = this.manager.lockfile.buffers.dependencies.items[dep_id].name;
            if (std.mem.eql(u8, dep_name.slice(string_buf), this.scanner_name)) {
                return dep_pkg_id;
            }
        }

        return null;
    }

    pub fn validateNotInWorkspaces(this: ScannerFinder) !void {
        const pkgs = this.manager.lockfile.packages.slice();
        const pkg_deps = pkgs.items(.dependencies);
        const pkg_res = pkgs.items(.resolution);
        const string_buf = this.manager.lockfile.buffers.string_bytes.items;

        for (0..pkgs.len) |pkg_idx| {
            if (pkg_res[pkg_idx].tag != .workspace) continue;

            const deps = pkg_deps[pkg_idx];
            for (deps.begin()..deps.end()) |_dep_id| {
                const dep_id: DependencyID = @intCast(_dep_id);
                const dep = this.manager.lockfile.buffers.dependencies.items[dep_id];

                if (std.mem.eql(u8, dep.name.slice(string_buf), this.scanner_name)) {
                    Output.errGeneric("Security scanner '{s}' cannot be a dependency of a workspace package. It must be a direct dependency of the root package.", .{this.scanner_name});
                    return error.SecurityScannerInWorkspace;
                }
            }
        }
    }
};

pub fn performSecurityScanAfterResolution(manager: *PackageManager, command_ctx: bun.cli.Command.Context, original_cwd: []const u8) !?SecurityScanResults {
    const security_scanner = manager.options.security_scanner orelse return null;

    if (manager.options.dry_run or !manager.options.do.install_packages) return null;

    // For remove/uninstall, scan all remaining packages after removal
    // For other commands, scan all if no update requests, otherwise scan update packages
    const scan_all = manager.subcommand == .remove or manager.update_requests.len == 0;
    const result = try attemptSecurityScan(manager, security_scanner, scan_all, command_ctx, original_cwd);

    switch (result) {
        .success => |scan_results| return scan_results,
        .needs_install => |pkg_id| {
            Output.prettyln("<r><yellow>Attempting to install security scanner from npm...<r>", .{});
            try doPartialInstallOfSecurityScanner(manager, command_ctx, manager.options.log_level, pkg_id, original_cwd);
            Output.prettyln("<r><green><b>Security scanner installed successfully.<r>", .{});

            const retry_result = try attemptSecurityScanWithRetry(manager, security_scanner, scan_all, command_ctx, original_cwd, true);
            switch (retry_result) {
                .success => |scan_results| return scan_results,
                else => return error.SecurityScannerRetryFailed,
            }
        },
        .@"error" => |err| return err,
    }
}

pub fn performSecurityScanForAll(manager: *PackageManager, command_ctx: bun.cli.Command.Context, original_cwd: []const u8) !?SecurityScanResults {
    const security_scanner = manager.options.security_scanner orelse return null;

    const result = try attemptSecurityScan(manager, security_scanner, true, command_ctx, original_cwd);
    switch (result) {
        .success => |scan_results| return scan_results,
        .needs_install => |pkg_id| {
            Output.prettyln("<r><yellow>Attempting to install security scanner from npm...<r>", .{});
            try doPartialInstallOfSecurityScanner(manager, command_ctx, manager.options.log_level, pkg_id, original_cwd);
            Output.prettyln("<r><green><b>Security scanner installed successfully.<r>", .{});

            const retry_result = try attemptSecurityScanWithRetry(manager, security_scanner, true, command_ctx, original_cwd, true);
            switch (retry_result) {
                .success => |scan_results| return scan_results,
                .needs_install => {
                    // Should not happen after retry - we just installed it
                    Output.errGeneric("Security scanner still required installation after partial install. This is probably a bug in Bun. Please report it to https://github.com/oven-sh/bun/issues", .{});
                    return error.SecurityScannerRetryFailed;
                },
                .@"error" => |err| return err,
            }
        },
        .@"error" => |err| return err,
    }
}

pub fn printSecurityAdvisories(manager: *PackageManager, results: *const SecurityScanResults) void {
    if (!results.hasAdvisories()) return;

    const pkgs = manager.lockfile.packages.slice();
    const pkg_names = pkgs.items(.name);
    const string_buf = manager.lockfile.buffers.string_bytes.items;

    for (results.advisories) |advisory| {
        Output.print("\n", .{});

        switch (advisory.level) {
            .fatal => {
                Output.pretty("  <red>FATAL<r>: {s}\n", .{advisory.package});
            },
            .warn => {
                Output.pretty("  <yellow>WARNING<r>: {s}\n", .{advisory.package});
            },
        }

        if (advisory.pkg_path) |pkg_path| {
            if (pkg_path.len > 1) {
                Output.pretty("    <d>via ", .{});
                for (pkg_path[0 .. pkg_path.len - 1], 0..) |ancestor_id, idx| {
                    if (idx > 0) Output.pretty(" › ", .{});
                    const ancestor_name = pkg_names[ancestor_id].slice(string_buf);
                    Output.pretty("{s}", .{ancestor_name});
                }
                Output.pretty(" › <red>{s}<r>\n", .{advisory.package});
            } else {
                Output.pretty("    <d>(direct dependency)<r>\n", .{});
            }
        }

        if (advisory.description) |desc| {
            if (desc.len > 0) {
                Output.pretty("    {s}\n", .{desc});
            }
        }
        if (advisory.url) |url| {
            if (url.len > 0) {
                Output.pretty("    <cyan>{s}<r>\n", .{url});
            }
        }
    }

    Output.print("\n", .{});
    const total = results.fatal_count + results.warn_count;
    if (total == 1) {
        if (results.fatal_count == 1) {
            Output.pretty("<b>1 advisory (<red>1 fatal<r>)<r>\n", .{});
        } else {
            Output.pretty("<b>1 advisory (<yellow>1 warning<r>)<r>\n", .{});
        }
    } else {
        if (results.fatal_count > 0 and results.warn_count > 0) {
            Output.pretty("<b>{d} advisories (<red>{d} fatal<r>, <yellow>{d} warning{s}<r>)<r>\n", .{ total, results.fatal_count, results.warn_count, if (results.warn_count == 1) "" else "s" });
        } else if (results.fatal_count > 0) {
            Output.pretty("<b>{d} advisories (<red>{d} fatal<r>)<r>\n", .{ total, results.fatal_count });
        } else {
            Output.pretty("<b>{d} advisories (<yellow>{d} warning{s}<r>)<r>\n", .{ total, results.warn_count, if (results.warn_count == 1) "" else "s" });
        }
    }
}

pub fn promptForWarnings() bool {
    const can_prompt = Output.isStdinTTY();

    if (!can_prompt) {
        Output.pretty("\n<red>Security warnings found. Cannot prompt for confirmation (no TTY).<r>\n", .{});
        Output.pretty("<red>Installation cancelled.<r>\n", .{});
        return false;
    }

    Output.pretty("\n<yellow>Security warnings found.<r> Continue anyway? [y/N] ", .{});
    Output.flush();

    var stdin = std.fs.File.stdin();
    var reader_buffer: [1024]u8 = undefined;
    var buffered = stdin.readerStreaming(&reader_buffer);
    const reader = &buffered.interface;

    const first_byte = reader.takeByte() catch {
        Output.pretty("\n<red>Installation cancelled.<r>\n", .{});
        return false;
    };

    const should_continue = switch (first_byte) {
        '\n' => false,
        '\r' => blk: {
            const next_byte = reader.takeByte() catch {
                break :blk false;
            };
            break :blk next_byte == '\n' and false;
        },
        'y', 'Y' => blk: {
            const next_byte = reader.takeByte() catch {
                break :blk false;
            };
            if (next_byte == '\n') {
                break :blk true;
            } else if (next_byte == '\r') {
                const second_byte = reader.takeByte() catch {
                    break :blk false;
                };
                break :blk second_byte == '\n';
            }
            break :blk false;
        },
        else => blk: {
            while (reader.takeByte()) |b| {
                if (b == '\n' or b == '\r') break;
            } else |_| {}
            break :blk false;
        },
    };

    if (!should_continue) {
        Output.pretty("\n<red>Installation cancelled.<r>\n", .{});
        return false;
    }

    Output.pretty("\n<yellow>Continuing with installation...<r>\n\n", .{});
    return true;
}

const PackageCollector = struct {
    manager: *PackageManager,
    dedupe: std.AutoArrayHashMap(PackageID, void),
    queue: bun.LinearFifo(QueueItem, .Dynamic),
    package_paths: std.AutoArrayHashMap(PackageID, PackagePath),

    const QueueItem = struct {
        pkg_id: PackageID,
        dep_id: DependencyID,
        pkg_path: std.array_list.Managed(PackageID),
        dep_path: std.array_list.Managed(DependencyID),
    };

    pub fn init(manager: *PackageManager) PackageCollector {
        return .{
            .manager = manager,
            .dedupe = std.AutoArrayHashMap(PackageID, void).init(bun.default_allocator),
            .queue = bun.LinearFifo(QueueItem, .Dynamic).init(bun.default_allocator),
            .package_paths = std.AutoArrayHashMap(PackageID, PackagePath).init(manager.allocator),
        };
    }

    pub fn deinit(this: *PackageCollector) void {
        this.dedupe.deinit();
        this.queue.deinit();

        var iter = this.package_paths.iterator();
        while (iter.next()) |entry| {
            this.manager.allocator.free(entry.value_ptr.pkg_path);
            this.manager.allocator.free(entry.value_ptr.dep_path);
        }
        this.package_paths.deinit();
    }

    pub fn collectAllPackages(this: *PackageCollector) !void {
        const pkgs = this.manager.lockfile.packages.slice();
        const pkg_dependencies = pkgs.items(.dependencies);
        const pkg_resolutions = pkgs.items(.resolution);

        const root_pkg_id: PackageID = 0;
        const root_deps = pkg_dependencies[root_pkg_id];

        // collect all npm deps from the root package
        for (root_deps.begin()..root_deps.end()) |_dep_id| {
            const dep_id: DependencyID = @intCast(_dep_id);
            const dep_pkg_id = this.manager.lockfile.buffers.resolutions.items[dep_id];

            if (dep_pkg_id == invalid_package_id) continue;

            const dep_res = pkg_resolutions[dep_pkg_id];
            if (dep_res.tag != .npm) continue;

            if ((try this.dedupe.getOrPut(dep_pkg_id)).found_existing) continue;

            var pkg_path_buf = std.array_list.Managed(PackageID).init(this.manager.allocator);
            try pkg_path_buf.append(root_pkg_id);
            try pkg_path_buf.append(dep_pkg_id);

            var dep_path_buf = std.array_list.Managed(DependencyID).init(this.manager.allocator);
            try dep_path_buf.append(dep_id);

            try this.queue.writeItem(.{
                .pkg_id = dep_pkg_id,
                .dep_id = dep_id,
                .pkg_path = pkg_path_buf,
                .dep_path = dep_path_buf,
            });
        }

        // and collect npm deps from workspace packages
        for (0..pkgs.len) |pkg_idx| {
            const pkg_id: PackageID = @intCast(pkg_idx);
            if (pkg_resolutions[pkg_id].tag != .workspace) continue;

            const workspace_deps = pkg_dependencies[pkg_id];
            for (workspace_deps.begin()..workspace_deps.end()) |_dep_id| {
                const dep_id: DependencyID = @intCast(_dep_id);
                const dep_pkg_id = this.manager.lockfile.buffers.resolutions.items[dep_id];

                if (dep_pkg_id == invalid_package_id) continue;

                const dep_res = pkg_resolutions[dep_pkg_id];
                if (dep_res.tag != .npm) continue;

                if ((try this.dedupe.getOrPut(dep_pkg_id)).found_existing) continue;

                var pkg_path_buf = std.array_list.Managed(PackageID).init(this.manager.allocator);
                try pkg_path_buf.append(pkg_id);
                try pkg_path_buf.append(dep_pkg_id);

                var dep_path_buf = std.array_list.Managed(DependencyID).init(this.manager.allocator);
                try dep_path_buf.append(dep_id);

                try this.queue.writeItem(.{
                    .pkg_id = dep_pkg_id,
                    .dep_id = dep_id,
                    .pkg_path = pkg_path_buf,
                    .dep_path = dep_path_buf,
                });
            }
        }
    }

    pub fn collectUpdatePackages(this: *PackageCollector) !void {
        const pkgs = this.manager.lockfile.packages.slice();
        const pkg_resolutions = pkgs.items(.resolution);
        const pkg_dependencies = pkgs.items(.dependencies);

        for (this.manager.update_requests) |req| {
            for (0..pkgs.len) |_update_pkg_id| {
                const update_pkg_id: PackageID = @intCast(_update_pkg_id);
                if (update_pkg_id != req.package_id) continue;
                if (pkg_resolutions[update_pkg_id].tag != .npm) continue;

                var update_dep_id: DependencyID = invalid_dependency_id;
                var parent_pkg_id: PackageID = invalid_package_id;

                for (0..pkgs.len) |_pkg_id| update_dep_id: {
                    const pkg_id: PackageID = @intCast(_pkg_id);
                    const pkg_res = pkg_resolutions[pkg_id];
                    if (pkg_res.tag != .root and pkg_res.tag != .workspace) continue;

                    const pkg_deps = pkg_dependencies[pkg_id];
                    for (pkg_deps.begin()..pkg_deps.end()) |_dep_id| {
                        const dep_id: DependencyID = @intCast(_dep_id);
                        const dep_pkg_id = this.manager.lockfile.buffers.resolutions.items[dep_id];
                        if (dep_pkg_id == invalid_package_id) continue;
                        if (dep_pkg_id != update_pkg_id) continue;

                        update_dep_id = dep_id;
                        parent_pkg_id = pkg_id;
                        break :update_dep_id;
                    }
                }

                if (update_dep_id == invalid_dependency_id) continue;
                if ((try this.dedupe.getOrPut(update_pkg_id)).found_existing) continue;

                var initial_pkg_path = std.array_list.Managed(PackageID).init(this.manager.allocator);
                if (parent_pkg_id != invalid_package_id) {
                    try initial_pkg_path.append(parent_pkg_id);
                }
                try initial_pkg_path.append(update_pkg_id);

                var initial_dep_path = std.array_list.Managed(DependencyID).init(this.manager.allocator);
                try initial_dep_path.append(update_dep_id);

                try this.queue.writeItem(.{
                    .pkg_id = update_pkg_id,
                    .dep_id = update_dep_id,
                    .pkg_path = initial_pkg_path,
                    .dep_path = initial_dep_path,
                });
            }
        }
    }

    pub fn processQueue(this: *PackageCollector) !void {
        const pkgs = this.manager.lockfile.packages.slice();
        const pkg_resolutions = pkgs.items(.resolution);
        const pkg_dependencies = pkgs.items(.dependencies);

        while (this.queue.readItem()) |item| {
            defer item.pkg_path.deinit();
            defer item.dep_path.deinit();

            const pkg_id = item.pkg_id;
            _ = item.dep_id; // Could be useful in the future for dependency-specific processing

            const pkg_path_copy = try this.manager.allocator.alloc(PackageID, item.pkg_path.items.len);
            @memcpy(pkg_path_copy, item.pkg_path.items);

            const dep_path_copy = try this.manager.allocator.alloc(DependencyID, item.dep_path.items.len);
            @memcpy(dep_path_copy, item.dep_path.items);

            try this.package_paths.put(pkg_id, .{
                .pkg_path = pkg_path_copy,
                .dep_path = dep_path_copy,
            });

            const pkg_deps = pkg_dependencies[pkg_id];
            for (pkg_deps.begin()..pkg_deps.end()) |_next_dep_id| {
                const next_dep_id: DependencyID = @intCast(_next_dep_id);
                const next_pkg_id = this.manager.lockfile.buffers.resolutions.items[next_dep_id];

                if (next_pkg_id == invalid_package_id) continue;

                const next_pkg_res = pkg_resolutions[next_pkg_id];
                if (next_pkg_res.tag != .npm) continue;

                if ((try this.dedupe.getOrPut(next_pkg_id)).found_existing) continue;

                var extended_pkg_path = std.array_list.Managed(PackageID).init(this.manager.allocator);
                try extended_pkg_path.appendSlice(item.pkg_path.items);
                try extended_pkg_path.append(next_pkg_id);

                var extended_dep_path = std.array_list.Managed(DependencyID).init(this.manager.allocator);
                try extended_dep_path.appendSlice(item.dep_path.items);
                try extended_dep_path.append(next_dep_id);

                try this.queue.writeItem(.{
                    .pkg_id = next_pkg_id,
                    .dep_id = next_dep_id,
                    .pkg_path = extended_pkg_path,
                    .dep_path = extended_dep_path,
                });
            }
        }
    }
};

const JSONBuilder = struct {
    manager: *PackageManager,
    collector: *PackageCollector,

    pub fn buildPackageJSON(this: JSONBuilder) ![]const u8 {
        var json_buf = std.array_list.Managed(u8).init(this.manager.allocator);
        var writer = json_buf.writer();

        const pkgs = this.manager.lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        const pkg_resolutions = pkgs.items(.resolution);
        const string_buf = this.manager.lockfile.buffers.string_bytes.items;

        try writer.writeAll("[\n");

        var first = true;
        var iter = this.collector.package_paths.iterator();
        while (iter.next()) |entry| {
            const pkg_id = entry.key_ptr.*;
            const paths = entry.value_ptr.*;

            const dep_id = if (paths.dep_path.len > 0) paths.dep_path[paths.dep_path.len - 1] else invalid_dependency_id;

            const pkg_name = pkg_names[pkg_id];
            const pkg_res = pkg_resolutions[pkg_id];

            if (!first) try writer.writeAll(",\n");

            if (dep_id == invalid_dependency_id) {
                try writer.print(
                    \\  {{
                    \\    "name": {f},
                    \\    "version": "{f}",
                    \\    "requestedRange": "{f}",
                    \\    "tarball": {f}
                    \\  }}
                , .{
                    bun.fmt.formatJSONStringUTF8(pkg_name.slice(string_buf), .{}),
                    pkg_res.value.npm.version.fmt(string_buf),
                    pkg_res.value.npm.version.fmt(string_buf),
                    bun.fmt.formatJSONStringUTF8(pkg_res.value.npm.url.slice(string_buf), .{}),
                });
            } else {
                const dep_version = this.manager.lockfile.buffers.dependencies.items[dep_id].version;
                try writer.print(
                    \\  {{
                    \\    "name": {f},
                    \\    "version": "{f}",
                    \\    "requestedRange": {f},
                    \\    "tarball": {f}
                    \\  }}
                , .{
                    bun.fmt.formatJSONStringUTF8(pkg_name.slice(string_buf), .{}),
                    pkg_res.value.npm.version.fmt(string_buf),
                    bun.fmt.formatJSONStringUTF8(dep_version.literal.slice(string_buf), .{}),
                    bun.fmt.formatJSONStringUTF8(pkg_res.value.npm.url.slice(string_buf), .{}),
                });
            }

            first = false;
        }

        try writer.writeAll("\n]");
        return json_buf.toOwnedSlice();
    }
};

// Security scanner subprocess entry point - uses IPC protocol for communication
// Note: scanner-entry.ts must be in JavaScriptSources.txt for the build
// scanner-entry.d.ts is NOT included in the build (type definitions only)
const scanner_entry_source = @embedFile("./scanner-entry.ts");

fn attemptSecurityScan(manager: *PackageManager, security_scanner: []const u8, scan_all: bool, command_ctx: bun.cli.Command.Context, original_cwd: []const u8) !ScanAttemptResult {
    return attemptSecurityScanWithRetry(manager, security_scanner, scan_all, command_ctx, original_cwd, false);
}

fn attemptSecurityScanWithRetry(manager: *PackageManager, security_scanner: []const u8, scan_all: bool, command_ctx: bun.cli.Command.Context, original_cwd: []const u8, is_retry: bool) !ScanAttemptResult {
    if (manager.options.log_level == .verbose) {
        Output.prettyErrorln("<d>[SecurityProvider]<r> Running at '{s}'", .{security_scanner});
        Output.prettyErrorln("<d>[SecurityProvider]<r> top_level_dir: '{s}'", .{FileSystem.instance.top_level_dir});
        Output.prettyErrorln("<d>[SecurityProvider]<r> original_cwd: '{s}'", .{original_cwd});
    }
    const start_time = std.time.milliTimestamp();

    const finder = ScannerFinder{ .manager = manager, .scanner_name = security_scanner };
    try finder.validateNotInWorkspaces();

    // After a partial install, the package might exist but not be in the lockfile yet
    // In that case, we'll get null here but should still try to run the scanner
    const security_scanner_pkg_id = finder.findInRootDependencies();
    // Suppress JavaScript error output unless in verbose mode
    const suppress_error_output = manager.options.log_level != .verbose;

    var collector = PackageCollector.init(manager);
    defer collector.deinit();

    if (scan_all) {
        try collector.collectAllPackages();
    } else {
        try collector.collectUpdatePackages();
    }

    try collector.processQueue();

    const json_builder = JSONBuilder{ .manager = manager, .collector = &collector };
    const json_data = try json_builder.buildPackageJSON();
    defer manager.allocator.free(json_data);

    var code = std.array_list.Managed(u8).init(manager.allocator);
    defer code.deinit();

    var temp_source: []const u8 = scanner_entry_source;

    const scanner_placeholder = "__SCANNER_MODULE__";
    if (std.mem.indexOf(u8, temp_source, scanner_placeholder)) |index| {
        try code.appendSlice(temp_source[0..index]);
        try code.appendSlice(security_scanner);
        try code.appendSlice(temp_source[index + scanner_placeholder.len ..]);
        temp_source = code.items;
    }

    const packages_placeholder = "__PACKAGES_JSON__";
    if (std.mem.indexOf(u8, temp_source, packages_placeholder)) |index| {
        var new_code = std.array_list.Managed(u8).init(manager.allocator);
        try new_code.appendSlice(temp_source[0..index]);
        try new_code.appendSlice(json_data);
        try new_code.appendSlice(temp_source[index + packages_placeholder.len ..]);
        code.deinit();
        code = new_code;
        temp_source = code.items;
    }

    const suppress_placeholder = "__SUPPRESS_ERROR__";
    if (std.mem.indexOf(u8, temp_source, suppress_placeholder)) |index| {
        var new_code = std.array_list.Managed(u8).init(manager.allocator);
        try new_code.appendSlice(temp_source[0..index]);
        try new_code.appendSlice(if (suppress_error_output) "true" else "false");
        try new_code.appendSlice(temp_source[index + suppress_placeholder.len ..]);
        code.deinit();
        code = new_code;
    }

    var scanner = SecurityScanSubprocess.new(.{
        .manager = manager,
        .code = try manager.allocator.dupe(u8, code.items),
        .json_data = try manager.allocator.dupe(u8, json_data),
        .ipc_data = undefined,
        .stderr_data = undefined,
    });

    defer {
        manager.allocator.free(scanner.code);
        manager.allocator.free(scanner.json_data);
        bun.destroy(scanner);
    }

    try scanner.spawn();

    var closure = struct {
        scanner: *SecurityScanSubprocess,

        pub fn isDone(this: *@This()) bool {
            return this.scanner.isDone();
        }
    }{ .scanner = scanner };

    manager.sleepUntil(&closure, &@TypeOf(closure).isDone);

    const packages_scanned = collector.dedupe.count();
    return try scanner.handleResults(&collector.package_paths, start_time, packages_scanned, security_scanner, security_scanner_pkg_id, command_ctx, original_cwd, is_retry);
}

pub const SecurityScanSubprocess = struct {
    manager: *PackageManager,
    code: []const u8,
    json_data: []const u8,
    process: ?*bun.spawn.Process = null,
    ipc_reader: bun.io.BufferedReader = bun.io.BufferedReader.init(@This()),
    ipc_data: std.array_list.Managed(u8),
    stderr_data: std.array_list.Managed(u8),
    has_process_exited: bool = false,
    has_received_ipc: bool = false,
    exit_status: ?bun.spawn.Status = null,
    remaining_fds: i8 = 0,

    pub const new = bun.TrivialNew(@This());

    pub fn spawn(this: *SecurityScanSubprocess) !void {
        this.ipc_data = std.array_list.Managed(u8).init(this.manager.allocator);
        this.stderr_data = std.array_list.Managed(u8).init(this.manager.allocator);
        this.ipc_reader.setParent(this);

        const pipe_result = bun.sys.pipe();
        const pipe_fds = switch (pipe_result) {
            .err => {
                return error.IPCPipeFailed;
            },
            .result => |fds| fds,
        };

        const exec_path = try bun.selfExePath();

        var argv = [_]?[*:0]const u8{
            try this.manager.allocator.dupeZ(u8, exec_path),
            "--no-install",
            "-e",
            try this.manager.allocator.dupeZ(u8, this.code),
            null,
        };
        defer {
            this.manager.allocator.free(bun.span(argv[0].?));
            this.manager.allocator.free(bun.span(argv[3].?));
        }

        const spawn_cwd = FileSystem.instance.top_level_dir;

        const spawn_options = bun.spawn.SpawnOptions{
            .stdout = .inherit,
            .stderr = .inherit,
            .stdin = .inherit,
            .cwd = spawn_cwd,
            .extra_fds = &.{.{ .pipe = pipe_fds[1] }},
            .windows = if (Environment.isWindows) .{
                .loop = jsc.EventLoopHandle.init(&this.manager.event_loop),
            },
        };

        var spawned = try (try bun.spawn.spawnProcess(&spawn_options, @ptrCast(&argv), @ptrCast(std.os.environ.ptr))).unwrap();

        pipe_fds[1].close();

        if (comptime bun.Environment.isPosix) {
            _ = bun.sys.setNonblocking(pipe_fds[0]);
        }
        this.remaining_fds = 1;
        this.ipc_reader.flags.nonblocking = true;
        if (comptime bun.Environment.isPosix) {
            this.ipc_reader.flags.socket = false;
        }
        try this.ipc_reader.start(pipe_fds[0], true).unwrap();

        var process = spawned.toProcess(&this.manager.event_loop, false);
        this.process = process;
        process.setExitHandler(this);

        switch (process.watchOrReap()) {
            .err => {
                return error.ProcessWatchFailed;
            },
            .result => {},
        }
    }

    pub fn isDone(this: *SecurityScanSubprocess) bool {
        return this.has_process_exited and this.remaining_fds == 0;
    }

    pub fn eventLoop(this: *const SecurityScanSubprocess) *jsc.AnyEventLoop {
        return &this.manager.event_loop;
    }

    pub fn loop(this: *const SecurityScanSubprocess) *bun.Async.Loop {
        if (comptime bun.Environment.isWindows) {
            return this.manager.event_loop.loop().uv_loop;
        } else {
            return this.manager.event_loop.loop();
        }
    }

    pub fn onReaderDone(this: *SecurityScanSubprocess) void {
        this.has_received_ipc = true;
        this.remaining_fds -= 1;
    }

    pub fn onReaderError(this: *SecurityScanSubprocess, err: bun.sys.Error) void {
        Output.errGeneric("Failed to read security scanner IPC: {f}", .{err});
        this.has_received_ipc = true;
        this.remaining_fds -= 1;
    }

    pub fn onStderrChunk(this: *SecurityScanSubprocess, chunk: []const u8) void {
        bun.handleOom(this.stderr_data.appendSlice(chunk));
    }

    pub fn getReadBuffer(this: *SecurityScanSubprocess) []u8 {
        const available = this.ipc_data.unusedCapacitySlice();
        if (available.len < 4096) {
            bun.handleOom(this.ipc_data.ensureTotalCapacity(this.ipc_data.capacity + 4096));
            return this.ipc_data.unusedCapacitySlice();
        }
        return available;
    }

    pub fn onReadChunk(this: *SecurityScanSubprocess, chunk: []const u8, hasMore: bun.io.ReadState) bool {
        _ = hasMore;
        bun.handleOom(this.ipc_data.appendSlice(chunk));
        return true;
    }

    pub fn onProcessExit(this: *SecurityScanSubprocess, _: *bun.spawn.Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        this.has_process_exited = true;
        this.exit_status = status;

        if (this.remaining_fds > 0 and !this.has_received_ipc) {
            this.ipc_reader.deinit();
            this.remaining_fds = 0;
        }
    }

    pub fn handleResults(this: *SecurityScanSubprocess, package_paths: *std.AutoArrayHashMap(PackageID, PackagePath), start_time: i64, packages_scanned: usize, security_scanner: []const u8, security_scanner_pkg_id: ?PackageID, command_ctx: bun.cli.Command.Context, original_cwd: []const u8, is_retry: bool) !ScanAttemptResult {
        _ = command_ctx; // Reserved for future use
        _ = original_cwd; // Reserved for future use
        defer {
            this.ipc_data.deinit();
            this.stderr_data.deinit();
        }

        if (this.exit_status == null) {
            Output.errGeneric("Security scanner terminated without an exit status. This is a bug in Bun.", .{});
            return error.SecurityScannerProcessFailedWithoutExitStatus;
        }

        const status = this.exit_status.?;

        if (this.ipc_data.items.len == 0) {
            switch (status) {
                .exited => |exit| {
                    Output.errGeneric("Security scanner exited with code {d} without sending data", .{exit.code});
                },
                .signaled => |sig| {
                    Output.errGeneric("Security scanner terminated by signal {s} without sending data", .{@tagName(sig)});
                },
                else => {
                    Output.errGeneric("Security scanner terminated abnormally without sending data", .{});
                },
            }
            return error.NoSecurityScanData;
        }

        const json_source = logger.Source{
            .contents = this.ipc_data.items,
            .path = bun.fs.Path.init("ipc-message.json"),
        };

        var temp_log = logger.Log.init(this.manager.allocator);
        defer temp_log.deinit();

        const json_expr = bun.json.parseUTF8(&json_source, &temp_log, this.manager.allocator) catch |err| {
            Output.errGeneric("Security scanner sent invalid JSON: {s}", .{@errorName(err)});
            if (this.ipc_data.items.len < 1000) {
                Output.errGeneric("Response: {s}", .{this.ipc_data.items});
            }
            return error.InvalidIPCMessage;
        };

        if (json_expr.data != .e_object) {
            Output.errGeneric("Security scanner IPC message must be a JSON object", .{});
            return error.InvalidIPCFormat;
        }

        const obj = json_expr.data.e_object;
        const type_expr = obj.get("type") orelse {
            Output.errGeneric("Security scanner IPC message missing 'type' field", .{});
            return error.MissingIPCType;
        };

        const type_str = type_expr.asString(this.manager.allocator) orelse {
            Output.errGeneric("Security scanner IPC 'type' must be a string", .{});
            return error.InvalidIPCType;
        };

        if (std.mem.eql(u8, type_str, "error")) {
            const code_expr = obj.get("code") orelse {
                Output.errGeneric("Security scanner error missing 'code' field", .{});
                return error.MissingErrorCode;
            };

            const code_str = code_expr.asString(this.manager.allocator) orelse {
                Output.errGeneric("Security scanner error 'code' must be a string", .{});
                return error.InvalidErrorCode;
            };

            const error_code = std.meta.stringToEnum(enum {
                MODULE_NOT_FOUND,
                INVALID_VERSION,
                SCAN_FAILED,
            }, code_str);

            switch (error_code orelse {
                Output.errGeneric("Unknown security scanner error code: {s}", .{code_str});
                return error.UnknownErrorCode;
            }) {
                .MODULE_NOT_FOUND => {
                    // If this is a retry after partial install, we need to handle it differently
                    // The scanner might have been installed but the lockfile wasn't updated
                    if (is_retry) {
                        // Check if the scanner is an npm package name (not a file path)
                        const is_package_name = bun.resolver.isPackagePath(security_scanner);

                        if (is_package_name) {
                            // For npm packages, after install they should be resolvable
                            // If not, there was a real problem with the installation
                            Output.errGeneric("Security scanner '{s}' could not be found after installation attempt.\n  <d>If this is a local file, please check that the file exists and the path is correct.<r>", .{security_scanner});
                            return error.SecurityScannerNotFound;
                        } else {
                            // For local files, the error is expected - they can't be installed
                            Output.errGeneric("Security scanner '{s}' is configured in bunfig.toml but the file could not be found.\n  <d>Please check that the file exists and the path is correct.<r>", .{security_scanner});
                            return error.SecurityScannerNotFound;
                        }
                    }

                    // First attempt - only try to install if we have a package ID
                    if (security_scanner_pkg_id) |pkg_id| {
                        return ScanAttemptResult{ .needs_install = pkg_id };
                    } else {
                        // No package ID means it's not in dependencies
                        const is_package_name = bun.resolver.isPackagePath(security_scanner);

                        if (is_package_name) {
                            Output.errGeneric("Security scanner '{s}' is configured in bunfig.toml but is not installed.\n  <d>To install it, run: bun add --dev {s}<r>", .{ security_scanner, security_scanner });
                        } else {
                            Output.errGeneric("Security scanner '{s}' is configured in bunfig.toml but the file could not be found.\n  <d>Please check that the file exists and the path is correct.<r>", .{security_scanner});
                        }
                        return error.SecurityScannerNotInDependencies;
                    }
                },
                .INVALID_VERSION => {
                    if (obj.get("message")) |msg| {
                        if (msg.asString(this.manager.allocator)) |msg_str| {
                            Output.errGeneric("Security scanner error: {s}", .{msg_str});
                        }
                    }
                    return error.InvalidScannerVersion;
                },
                .SCAN_FAILED => {
                    if (obj.get("message")) |msg| {
                        if (msg.asString(this.manager.allocator)) |msg_str| {
                            Output.errGeneric("Security scanner failed: {s}", .{msg_str});
                        }
                    }
                    return error.ScannerFailed;
                },
            }
        } else if (!std.mem.eql(u8, type_str, "result")) {
            Output.errGeneric("Unknown security scanner message type: {s}", .{type_str});
            return error.UnknownMessageType;
        }

        // if we got here then we got a result message so we can continue like normal
        const duration = std.time.milliTimestamp() - start_time;

        if (this.manager.options.log_level == .verbose) {
            switch (status) {
                .exited => |exit| {
                    if (exit.code == 0) {
                        Output.prettyErrorln("<d>[SecurityProvider]<r> Completed with exit code {d} [{d}ms]", .{ exit.code, duration });
                    } else {
                        Output.prettyErrorln("<d>[SecurityProvider]<r> Failed with exit code {d} [{d}ms]", .{ exit.code, duration });
                    }
                },
                .signaled => |sig| {
                    Output.prettyErrorln("<d>[SecurityProvider]<r> Terminated by signal {s} [{d}ms]", .{ @tagName(sig), duration });
                },
                else => {
                    Output.prettyErrorln("<d>[SecurityProvider]<r> Completed with unknown status [{d}ms]", .{duration});
                },
            }
        } else if (this.manager.options.log_level != .silent and duration >= 1000) {
            const maybeHourglass = if (Output.enable_ansi_colors_stderr) "⏳" else "";
            if (packages_scanned == 1) {
                Output.prettyErrorln("<d>{s}[{s}] Scanning 1 package took {d}ms<r>", .{ maybeHourglass, security_scanner, duration });
            } else {
                Output.prettyErrorln("<d>{s}[{s}] Scanning {d} packages took {d}ms<r>", .{ maybeHourglass, security_scanner, packages_scanned, duration });
            }
        }

        const advisories_expr = obj.get("advisories") orelse {
            Output.errGeneric("Security scanner result missing 'advisories' field", .{});
            return error.MissingAdvisoriesField;
        };

        const advisories = try parseSecurityAdvisoriesFromExpr(this.manager, advisories_expr, package_paths);

        if (!status.isOK()) {
            switch (status) {
                .exited => |exited| {
                    if (exited.code != 0) {
                        Output.errGeneric("Security scanner failed with exit code: {d}", .{exited.code});
                        return error.SecurityScannerFailed;
                    }
                },
                .signaled => |signal| {
                    Output.errGeneric("Security scanner was terminated by signal: {s}", .{@tagName(signal)});
                    return error.SecurityScannerTerminated;
                },
                else => {
                    Output.errGeneric("Security scanner failed", .{});
                    return error.SecurityScannerFailed;
                },
            }
        }

        var fatal_count: usize = 0;
        var warn_count: usize = 0;
        for (advisories) |advisory| {
            switch (advisory.level) {
                .fatal => fatal_count += 1,
                .warn => warn_count += 1,
            }
        }

        return ScanAttemptResult{ .success = SecurityScanResults{
            .advisories = advisories,
            .fatal_count = fatal_count,
            .warn_count = warn_count,
            .packages_scanned = packages_scanned,
            .duration_ms = duration,
            .security_scanner = security_scanner,
            .allocator = this.manager.allocator,
        } };
    }
};

fn parseSecurityAdvisoriesFromExpr(manager: *PackageManager, advisories_expr: bun.js_parser.Expr, package_paths: *std.AutoArrayHashMap(PackageID, PackagePath)) ![]SecurityAdvisory {
    var advisories_list = std.array_list.Managed(SecurityAdvisory).init(manager.allocator);
    defer advisories_list.deinit();

    if (advisories_expr.data != .e_array) {
        Output.errGeneric("Security scanner 'advisories' field must be an array, got: {s}", .{@tagName(advisories_expr.data)});
        return error.InvalidAdvisoriesFormat;
    }

    const array = advisories_expr.data.e_array;
    for (array.items.slice(), 0..) |item, i| {
        if (item.data != .e_object) {
            Output.errGeneric("Security advisory at index {d} must be an object, got: {s}", .{ i, @tagName(item.data) });
            return error.InvalidAdvisoryFormat;
        }

        const item_obj = item.data.e_object;

        const name_expr = item_obj.get("package") orelse {
            Output.errGeneric("Security advisory at index {d} missing required 'package' field", .{i});
            return error.MissingPackageField;
        };
        const name_str_temp = name_expr.asString(manager.allocator) orelse {
            Output.errGeneric("Security advisory at index {d} 'package' field must be a string", .{i});
            return error.InvalidPackageField;
        };
        if (name_str_temp.len == 0) {
            Output.errGeneric("Security advisory at index {d} 'package' field cannot be empty", .{i});
            return error.EmptyPackageField;
        }
        // Duplicate the string since asString returns temporary memory
        const name_str = try manager.allocator.dupe(u8, name_str_temp);

        const desc_str: ?[]const u8 = if (item_obj.get("description")) |desc_expr| blk: {
            if (desc_expr.asString(manager.allocator)) |str| {
                // Duplicate the string since asString returns temporary memory
                break :blk try manager.allocator.dupe(u8, str);
            }
            if (desc_expr.data == .e_null) break :blk null;
            Output.errGeneric("Security advisory at index {d} 'description' field must be a string or null", .{i});
            return error.InvalidDescriptionField;
        } else null;

        const url_str: ?[]const u8 = if (item_obj.get("url")) |url_expr| blk: {
            if (url_expr.asString(manager.allocator)) |str| {
                // Duplicate the string since asString returns temporary memory
                break :blk try manager.allocator.dupe(u8, str);
            }
            if (url_expr.data == .e_null) break :blk null;
            Output.errGeneric("Security advisory at index {d} 'url' field must be a string or null", .{i});
            return error.InvalidUrlField;
        } else null;

        const level_expr = item_obj.get("level") orelse {
            Output.errGeneric("Security advisory at index {d} missing required 'level' field", .{i});
            return error.MissingLevelField;
        };
        const level_str = level_expr.asString(manager.allocator) orelse {
            Output.errGeneric("Security advisory at index {d} 'level' field must be a string", .{i});
            return error.InvalidLevelField;
        };
        const level = if (std.mem.eql(u8, level_str, "fatal"))
            SecurityAdvisoryLevel.fatal
        else if (std.mem.eql(u8, level_str, "warn"))
            SecurityAdvisoryLevel.warn
        else {
            Output.errGeneric("Security advisory at index {d} 'level' field must be 'fatal' or 'warn', got: '{s}'", .{ i, level_str });
            return error.InvalidLevelValue;
        };

        // Look up the package path for this advisory
        var pkg_path: ?[]const PackageID = null;
        const pkgs = manager.lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        const string_buf = manager.lockfile.buffers.string_bytes.items;

        for (pkg_names, 0..) |pkg_name, j| {
            if (std.mem.eql(u8, pkg_name.slice(string_buf), name_str)) {
                const pkg_id: PackageID = @intCast(j);
                if (package_paths.get(pkg_id)) |paths| {
                    // Duplicate the path so it outlives the package_paths HashMap
                    pkg_path = try manager.allocator.dupe(PackageID, paths.pkg_path);
                }
                break;
            }
        }

        const advisory = SecurityAdvisory{
            .level = level,
            .package = name_str,
            .url = url_str,
            .description = desc_str,
            .pkg_path = pkg_path,
        };

        try advisories_list.append(advisory);
    }

    return try advisories_list.toOwnedSlice();
}

const HoistedInstall = @import("../hoisted_install.zig");
const InstallWithManager = @import("./install_with_manager.zig");
const IsolatedInstall = @import("../isolated_install.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const jsc = bun.jsc;
const logger = bun.logger;
const FileSystem = bun.fs.FileSystem;

const DependencyID = bun.install.DependencyID;
const PackageID = bun.install.PackageID;
const PackageManager = bun.install.PackageManager;
const invalid_dependency_id = bun.install.invalid_dependency_id;
const invalid_package_id = bun.install.invalid_package_id;
