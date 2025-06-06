const std = @import("std");
const bun = @import("bun");
const Command = @import("../cli.zig").Command;
const PackageManager = @import("../install/install.zig").PackageManager;
const Output = bun.Output;
const Global = bun.Global;
const strings = bun.strings;
const http = bun.http;
const HeaderBuilder = http.HeaderBuilder;
const MutableString = bun.MutableString;
const URL = @import("../url.zig").URL;
const logger = bun.logger;
const libdeflate = @import("../deps/libdeflate.zig");

const VulnerabilityInfo = struct {
    severity: []const u8,
    title: []const u8,
    url: []const u8,
    vulnerable_versions: []const u8,
    id: []const u8,
    package_name: []const u8,
};

const PackageInfo = struct {
    package_id: u32,
    name: []const u8,
    version: []const u8,
    vulnerabilities: std.ArrayList(VulnerabilityInfo),
    dependents: std.ArrayList(DependencyPath),

    const DependencyPath = struct {
        path: std.ArrayList([]const u8),
        is_direct: bool,
    };
};

const AuditResult = struct {
    vulnerable_packages: bun.StringHashMap(PackageInfo),
    all_vulnerabilities: std.ArrayList(VulnerabilityInfo),
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) AuditResult {
        return AuditResult{
            .vulnerable_packages = bun.StringHashMap(PackageInfo).init(allocator),
            .all_vulnerabilities = std.ArrayList(VulnerabilityInfo).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *AuditResult) void {
        var iter = self.vulnerable_packages.iterator();
        while (iter.next()) |entry| {
            entry.value_ptr.vulnerabilities.deinit();
            for (entry.value_ptr.dependents.items) |*dependent| {
                dependent.path.deinit();
            }
            entry.value_ptr.dependents.deinit();
        }
        self.vulnerable_packages.deinit();
        self.all_vulnerabilities.deinit();
    }
};

pub const AuditCommand = struct {
    pub fn exec(ctx: Command.Context) !noreturn {
        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .audit);
        const manager, _ = PackageManager.init(ctx, cli, .audit) catch |err| {
            if (err == error.MissingPackageJSON) {
                var cwd_buf: bun.PathBuffer = undefined;
                if (bun.getcwd(&cwd_buf)) |cwd| {
                    Output.errGeneric("No package.json was found for directory \"{s}\"", .{cwd});
                } else |_| {
                    Output.errGeneric("No package.json was found", .{});
                }
                Output.note("Run \"bun init\" to initialize a project", .{});
                Global.exit(1);
            }

            return err;
        };

        const code = try audit(ctx, manager, manager.options.json_output);
        Global.exit(code);
    }

    /// Returns the exit code of the command. 0 if no vulnerabilities were found, 1 if vulnerabilities were found.
    /// The exception is when you pass --json, it will simply return 0 as that was considered a successful "request
    /// for the audit information"
    pub fn audit(ctx: Command.Context, pm: *PackageManager, json_output: bool) bun.OOM!u32 {
        Output.prettyError(comptime Output.prettyFmt("<r><b>bun audit <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", true), .{});
        Output.flush();

        const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
        @import("./package_manager_command.zig").PackageManagerCommand.handleLoadLockfileErrors(load_lockfile, pm);

        var dependency_tree = try buildDependencyTree(ctx.allocator, pm);
        defer dependency_tree.deinit();

        const packages_result = try collectPackagesForAudit(ctx.allocator, pm);
        defer ctx.allocator.free(packages_result.audit_body);
        defer {
            for (packages_result.skipped_packages.items) |package_name| {
                ctx.allocator.free(package_name);
            }
            packages_result.skipped_packages.deinit();
        }

        const response_text = try sendAuditRequest(ctx.allocator, pm, packages_result.audit_body);
        defer ctx.allocator.free(response_text);

        if (json_output) {
            Output.writer().writeAll(response_text) catch {};
            Output.writer().writeByte('\n') catch {};

            if (response_text.len > 0) {
                const source = logger.Source.initPathString("audit-response.json", response_text);
                var log = logger.Log.init(ctx.allocator);
                defer log.deinit();

                const expr = @import("../json_parser.zig").parse(&source, &log, ctx.allocator, true) catch {
                    Output.prettyErrorln("<red>error<r>: audit request failed to parse json. Is the registry down?", .{});
                    return 1; // If we can't parse then safe to assume a similar failure
                };

                // If the response is an empty object, no vulnerabilities
                if (expr.data == .e_object and expr.data.e_object.properties.len == 0) {
                    return 0;
                }

                // If there's any content in the response, there are vulnerabilities
                return 1;
            }

            return 0;
        } else if (response_text.len > 0) {
            const exit_code = try printEnhancedAuditReport(ctx.allocator, response_text, pm, &dependency_tree);

            printSkippedPackages(packages_result.skipped_packages);

            return exit_code;
        } else {
            Output.prettyln("<green>No vulnerabilities found<r>", .{});

            printSkippedPackages(packages_result.skipped_packages);

            return 0;
        }
    }
};

fn printSkippedPackages(skipped_packages: std.ArrayList([]const u8)) void {
    if (skipped_packages.items.len > 0) {
        Output.pretty("<d>Skipped<r> ", .{});
        for (skipped_packages.items, 0..) |package_name, i| {
            if (i > 0) Output.pretty(", ", .{});
            Output.pretty("{s}", .{package_name});
        }

        if (skipped_packages.items.len > 1) {
            Output.prettyln(" <d>because they do not come from the default registry<r>", .{});
        } else {
            Output.prettyln(" <d>because it does not come from the default registry<r>", .{});
        }

        Output.prettyln("", .{});
    }
}

fn buildDependencyTree(allocator: std.mem.Allocator, pm: *PackageManager) bun.OOM!bun.StringHashMap(std.ArrayList([]const u8)) {
    var dependency_tree = bun.StringHashMap(std.ArrayList([]const u8)).init(allocator);

    const packages = pm.lockfile.packages.slice();
    const pkg_names = packages.items(.name);
    const pkg_dependencies = packages.items(.dependencies);
    const pkg_resolutions = packages.items(.resolutions);
    const buf = pm.lockfile.buffers.string_bytes.items;
    const dependencies = pm.lockfile.buffers.dependencies.items;
    const resolutions = pm.lockfile.buffers.resolutions.items;

    for (pkg_names, pkg_dependencies, pkg_resolutions, 0..) |pkg_name, deps, res_list, pkg_idx| {
        const package_name = pkg_name.slice(buf);

        if (packages.items(.resolution)[pkg_idx].tag != .npm) continue;

        const dep_slice = deps.get(dependencies);
        const res_slice = res_list.get(resolutions);

        for (dep_slice, res_slice) |_, resolved_pkg_id| {
            if (resolved_pkg_id >= pkg_names.len) continue;

            const resolved_name = pkg_names[resolved_pkg_id].slice(buf);

            const result = try dependency_tree.getOrPut(resolved_name);
            if (!result.found_existing) {
                result.key_ptr.* = try allocator.dupe(u8, resolved_name);
                result.value_ptr.* = std.ArrayList([]const u8).init(allocator);
            }
            try result.value_ptr.append(try allocator.dupe(u8, package_name));
        }
    }

    return dependency_tree;
}

fn collectPackagesForAudit(allocator: std.mem.Allocator, pm: *PackageManager) bun.OOM!struct { audit_body: []u8, skipped_packages: std.ArrayList([]const u8) } {
    const packages = pm.lockfile.packages.slice();
    const pkg_names = packages.items(.name);
    const pkg_resolutions = packages.items(.resolution);
    const buf = pm.lockfile.buffers.string_bytes.items;
    const root_id = pm.root_package_id.get(pm.lockfile, pm.workspace_name_hash);

    var packages_list = std.ArrayList(struct {
        name: []const u8,
        versions: std.ArrayList([]const u8),
    }).init(allocator);
    defer {
        for (packages_list.items) |item| {
            allocator.free(item.name);
            for (item.versions.items) |version| {
                allocator.free(version);
            }
            item.versions.deinit();
        }
        packages_list.deinit();
    }

    var skipped_packages = std.ArrayList([]const u8).init(allocator);

    for (pkg_names, pkg_resolutions, 0..) |name, res, idx| {
        if (idx == root_id) continue;
        if (res.tag != .npm) continue;

        const name_slice = name.slice(buf);

        const package_scope = pm.scopeForPackageName(name_slice);
        if (package_scope.url_hash != pm.options.scope.url_hash) {
            try skipped_packages.append(try allocator.dupe(u8, name_slice));
            continue;
        }

        const ver_str = try std.fmt.allocPrint(allocator, "{}", .{res.value.npm.version.fmt(buf)});

        var found_package: ?*@TypeOf(packages_list.items[0]) = null;
        for (packages_list.items) |*item| {
            if (std.mem.eql(u8, item.name, name_slice)) {
                found_package = item;
                break;
            }
        }

        if (found_package == null) {
            try packages_list.append(.{
                .name = try allocator.dupe(u8, name_slice),
                .versions = std.ArrayList([]const u8).init(allocator),
            });
            found_package = &packages_list.items[packages_list.items.len - 1];
        }

        var version_exists = false;
        for (found_package.?.versions.items) |existing_ver| {
            if (std.mem.eql(u8, existing_ver, ver_str)) {
                version_exists = true;
                break;
            }
        }

        if (!version_exists) {
            try found_package.?.versions.append(ver_str);
        } else {
            allocator.free(ver_str);
        }
    }

    var body = try MutableString.init(allocator, 1024);
    body.appendChar('{') catch {};

    for (packages_list.items, 0..) |package, pkg_idx| {
        if (pkg_idx > 0) body.appendChar(',') catch {};
        body.appendChar('"') catch {};
        body.appendSlice(package.name) catch {};
        body.appendChar('"') catch {};
        body.appendChar(':') catch {};
        body.appendChar('[') catch {};
        for (package.versions.items, 0..) |version, ver_idx| {
            if (ver_idx > 0) body.appendChar(',') catch {};
            body.appendChar('"') catch {};
            body.appendSlice(version) catch {};
            body.appendChar('"') catch {};
        }
        body.appendChar(']') catch {};
    }
    body.appendChar('}') catch {};

    return .{
        .audit_body = try allocator.dupe(u8, body.slice()),
        .skipped_packages = skipped_packages,
    };
}

fn sendAuditRequest(allocator: std.mem.Allocator, pm: *PackageManager, body: []const u8) bun.OOM![]u8 {
    libdeflate.load();
    var compressor = libdeflate.Compressor.alloc(6) orelse return error.OutOfMemory;
    defer compressor.deinit();

    const max_compressed_size = compressor.maxBytesNeeded(body, .gzip);
    const compressed_body = try allocator.alloc(u8, max_compressed_size);
    defer allocator.free(compressed_body);

    const compression_result = compressor.gzip(body, compressed_body);
    const final_compressed_body = compressed_body[0..compression_result.written];

    var headers: HeaderBuilder = .{};
    headers.count("accept", "application/json");
    headers.count("content-type", "application/json");
    headers.count("content-encoding", "gzip");
    if (pm.options.scope.token.len > 0) {
        headers.count("authorization", "");
        headers.content.cap += "Bearer ".len + pm.options.scope.token.len;
    } else if (pm.options.scope.auth.len > 0) {
        headers.count("authorization", "");
        headers.content.cap += "Basic ".len + pm.options.scope.auth.len;
    }
    try headers.allocate(allocator);
    headers.append("accept", "application/json");
    headers.append("content-type", "application/json");
    headers.append("content-encoding", "gzip");
    if (pm.options.scope.token.len > 0) {
        headers.appendFmt("authorization", "Bearer {s}", .{pm.options.scope.token});
    } else if (pm.options.scope.auth.len > 0) {
        headers.appendFmt("authorization", "Basic {s}", .{pm.options.scope.auth});
    }

    const url_str = try std.fmt.allocPrint(allocator, "{s}/-/npm/v1/security/advisories/bulk", .{strings.withoutTrailingSlash(pm.options.scope.url.href)});
    defer allocator.free(url_str);
    const url = URL.parse(url_str);

    var response_buf = try MutableString.init(allocator, 1024);
    var req = http.AsyncHTTP.initSync(
        allocator,
        .POST,
        url,
        headers.entries,
        headers.content.ptr.?[0..headers.content.len],
        &response_buf,
        final_compressed_body,
        null,
        null,
        .follow,
    );
    const res = req.sendSync() catch |err| {
        Output.err(err, "audit request failed", .{});
        Global.crash();
    };

    if (res.status_code >= 400) {
        Output.prettyErrorln("<red>error<r>: audit request failed (status {d})", .{res.status_code});
        Global.crash();
    }

    return try allocator.dupe(u8, response_buf.slice());
}

fn parseVulnerability(allocator: std.mem.Allocator, package_name: []const u8, vuln: bun.JSAst.Expr) bun.OOM!VulnerabilityInfo {
    var vulnerability = VulnerabilityInfo{
        .severity = "moderate",
        .title = "Vulnerability found",
        .url = "",
        .vulnerable_versions = "",
        .id = "",
        .package_name = try allocator.dupe(u8, package_name),
    };

    if (vuln.data == .e_object) {
        const props = vuln.data.e_object.properties.slice();
        for (props) |prop| {
            if (prop.key) |key| {
                if (key.data == .e_string) {
                    const field_name = key.data.e_string.data;
                    if (prop.value) |value| {
                        if (value.data == .e_string) {
                            const field_value = value.data.e_string.data;
                            if (std.mem.eql(u8, field_name, "severity")) {
                                vulnerability.severity = field_value;
                            } else if (std.mem.eql(u8, field_name, "title")) {
                                vulnerability.title = field_value;
                            } else if (std.mem.eql(u8, field_name, "url")) {
                                vulnerability.url = field_value;
                            } else if (std.mem.eql(u8, field_name, "vulnerable_versions")) {
                                vulnerability.vulnerable_versions = field_value;
                            } else if (std.mem.eql(u8, field_name, "id")) {
                                vulnerability.id = field_value;
                            }
                        } else if (value.data == .e_number) {
                            if (std.mem.eql(u8, field_name, "id")) {
                                vulnerability.id = try std.fmt.allocPrint(allocator, "{d}", .{@as(u64, @intFromFloat(value.data.e_number.value))});
                            }
                        }
                    }
                }
            }
        }
    }

    return vulnerability;
}

fn findDependencyPaths(
    allocator: std.mem.Allocator,
    target_package: []const u8,
    dependency_tree: *const bun.StringHashMap(std.ArrayList([]const u8)),
    pm: *PackageManager,
) bun.OOM!std.ArrayList(PackageInfo.DependencyPath) {
    var paths = std.ArrayList(PackageInfo.DependencyPath).init(allocator);

    const packages = pm.lockfile.packages.slice();
    const root_id = pm.root_package_id.get(pm.lockfile, pm.workspace_name_hash);
    const root_deps = packages.items(.dependencies)[root_id];
    const dependencies = pm.lockfile.buffers.dependencies.items;
    const buf = pm.lockfile.buffers.string_bytes.items;
    const pkg_names = packages.items(.name);
    const pkg_resolutions = packages.items(.resolution);
    const pkg_deps = packages.items(.dependencies);

    const dep_slice = root_deps.get(dependencies);
    for (dep_slice) |dependency| {
        const dep_name = dependency.name.slice(buf);
        if (std.mem.eql(u8, dep_name, target_package)) {
            var direct_path = PackageInfo.DependencyPath{
                .path = std.ArrayList([]const u8).init(allocator),
                .is_direct = true,
            };
            try direct_path.path.append(try allocator.dupe(u8, target_package));
            try paths.append(direct_path);
            break;
        }
    }

    for (pkg_resolutions, pkg_deps, pkg_names) |resolution, workspace_deps, pkg_name| {
        if (resolution.tag != .workspace) continue;

        const workspace_name = pkg_name.slice(buf);
        const workspace_dep_slice = workspace_deps.get(dependencies);

        for (workspace_dep_slice) |dependency| {
            const dep_name = dependency.name.slice(buf);
            if (std.mem.eql(u8, dep_name, target_package)) {
                var workspace_path = PackageInfo.DependencyPath{
                    .path = std.ArrayList([]const u8).init(allocator),
                    .is_direct = false,
                };

                const workspace_prefix = try std.fmt.allocPrint(allocator, "workspace:{s}", .{workspace_name});
                try workspace_path.path.append(workspace_prefix);
                try workspace_path.path.append(try allocator.dupe(u8, target_package));
                try paths.append(workspace_path);
                break;
            }
        }
    }

    var queue: std.fifo.LinearFifo([]const u8, .Dynamic) = std.fifo.LinearFifo([]const u8, .Dynamic).init(allocator);
    defer queue.deinit();
    var visited = bun.StringHashMap(void).init(allocator);
    defer visited.deinit();
    var parent_map = bun.StringHashMap([]const u8).init(allocator);
    defer parent_map.deinit();

    if (dependency_tree.get(target_package)) |dependents| {
        for (dependents.items) |dependent| {
            try queue.writeItem(dependent);
            try parent_map.put(dependent, target_package);
        }
    }

    while (queue.readItem()) |*current| {
        if (visited.contains(current.*)) continue;
        try visited.put(current.*, {});

        var is_root_dep = false;
        for (dep_slice) |*dependency| {
            const dep_name = dependency.name.slice(buf);
            if (bun.strings.eql(dep_name, current.*)) {
                is_root_dep = true;
                break;
            }
        }

        var workspace_name_for_dep: ?[]const u8 = null;
        for (pkg_resolutions, pkg_deps, pkg_names) |resolution, workspace_deps, pkg_name| {
            if (resolution.tag != .workspace) continue;

            const workspace_dep_slice = workspace_deps.get(dependencies);
            for (workspace_dep_slice) |*dependency| {
                const dep_name = dependency.name.slice(buf);
                if (bun.strings.eql(dep_name, current.*)) {
                    workspace_name_for_dep = pkg_name.slice(buf);
                    break;
                }
            }
            if (workspace_name_for_dep != null) break;
        }

        if (is_root_dep or workspace_name_for_dep != null) {
            var path = PackageInfo.DependencyPath{
                .path = std.ArrayList([]const u8).init(allocator),
                .is_direct = false,
            };

            var trace = current;
            while (true) {
                try path.path.insert(0, try allocator.dupe(u8, trace.*));
                if (parent_map.get(trace.*)) |*parent| {
                    trace = parent;
                } else {
                    break;
                }
            }

            if (workspace_name_for_dep) |workspace_name| {
                const workspace_prefix = try std.fmt.allocPrint(allocator, "workspace:{s}", .{workspace_name});
                try path.path.insert(0, workspace_prefix);
            }

            try paths.append(path);
        } else {
            if (dependency_tree.get(current.*)) |dependents| {
                for (dependents.items) |dependent| {
                    if (!visited.contains(dependent)) {
                        try queue.writeItem(dependent);
                        try parent_map.put(dependent, current.*);
                    }
                }
            }
        }
    }

    return paths;
}

fn printEnhancedAuditReport(
    allocator: std.mem.Allocator,
    response_text: []const u8,
    pm: *PackageManager,
    dependency_tree: *const bun.StringHashMap(std.ArrayList([]const u8)),
) bun.OOM!u32 {
    const source = logger.Source.initPathString("audit-response.json", response_text);
    var log = logger.Log.init(allocator);
    defer log.deinit();

    const expr = @import("../json_parser.zig").parse(&source, &log, allocator, true) catch {
        Output.writer().writeAll(response_text) catch {};
        Output.writer().writeByte('\n') catch {};
        return 1;
    };

    if (expr.data == .e_object and expr.data.e_object.properties.len == 0) {
        Output.prettyln("<green>No vulnerabilities found<r>", .{});
        return 0;
    }

    var audit_result = AuditResult.init(allocator);
    defer audit_result.deinit();

    var vuln_counts = struct {
        low: u32 = 0,
        moderate: u32 = 0,
        high: u32 = 0,
        critical: u32 = 0,
    }{};

    if (expr.data == .e_object) {
        const properties = expr.data.e_object.properties.slice();

        for (properties) |prop| {
            if (prop.key) |key| {
                if (key.data == .e_string) {
                    const package_name = key.data.e_string.data;

                    if (prop.value) |value| {
                        if (value.data == .e_array) {
                            const vulns = value.data.e_array.items.slice();
                            for (vulns) |vuln| {
                                if (vuln.data == .e_object) {
                                    const vulnerability = try parseVulnerability(allocator, package_name, vuln);

                                    if (std.mem.eql(u8, vulnerability.severity, "low")) {
                                        vuln_counts.low += 1;
                                    } else if (std.mem.eql(u8, vulnerability.severity, "moderate")) {
                                        vuln_counts.moderate += 1;
                                    } else if (std.mem.eql(u8, vulnerability.severity, "high")) {
                                        vuln_counts.high += 1;
                                    } else if (std.mem.eql(u8, vulnerability.severity, "critical")) {
                                        vuln_counts.critical += 1;
                                    } else {
                                        vuln_counts.moderate += 1;
                                    }

                                    try audit_result.all_vulnerabilities.append(vulnerability);
                                }
                            }
                        }
                    }
                }
            }
        }

        for (audit_result.all_vulnerabilities.items) |vulnerability| {
            const paths = try findDependencyPaths(allocator, vulnerability.package_name, dependency_tree, pm);

            const result = try audit_result.vulnerable_packages.getOrPut(vulnerability.package_name);
            if (!result.found_existing) {
                result.value_ptr.* = PackageInfo{
                    .package_id = 0,
                    .name = vulnerability.package_name,
                    .version = vulnerability.vulnerable_versions,
                    .vulnerabilities = std.ArrayList(VulnerabilityInfo).init(allocator),
                    .dependents = paths,
                };
            }
            try result.value_ptr.vulnerabilities.append(vulnerability);
        }

        var package_iter = audit_result.vulnerable_packages.iterator();
        while (package_iter.next()) |entry| {
            const package_info = entry.value_ptr;

            if (package_info.vulnerabilities.items.len > 0) {
                const main_vuln = package_info.vulnerabilities.items[0];

                // const is_direct_dependency: bool = brk: {
                //     for (package_info.dependents.items) |path| {
                //         if (path.is_direct) {
                //             break :brk true;
                //         }
                //     }

                //     break :brk false;
                // };

                if (main_vuln.vulnerable_versions.len > 0) {
                    Output.prettyln("<red>{s}<r>  {s}", .{ main_vuln.package_name, main_vuln.vulnerable_versions });
                } else {
                    Output.prettyln("<red>{s}<r>", .{main_vuln.package_name});
                }

                for (package_info.dependents.items) |path| {
                    if (path.path.items.len > 1) {
                        if (std.mem.startsWith(u8, path.path.items[0], "workspace:")) {
                            const vulnerable_pkg = path.path.items[path.path.items.len - 1];
                            const workspace_part = path.path.items[0];

                            Output.prettyln("  <d>{s} › <red>{s}<r>", .{ workspace_part, vulnerable_pkg });
                        } else {
                            const vulnerable_pkg = path.path.items[0];

                            var reversed_items = std.ArrayList([]const u8).init(allocator);
                            for (path.path.items[1..]) |item| try reversed_items.append(item);
                            std.mem.reverse([]const u8, reversed_items.items);
                            defer reversed_items.deinit();

                            const vuln_pkg_path = try std.mem.join(allocator, " › ", reversed_items.items);
                            defer allocator.free(vuln_pkg_path);

                            Output.prettyln("  <d>{s} › <red>{s}<r>", .{ vuln_pkg_path, vulnerable_pkg });
                        }
                    } else {
                        Output.prettyln("  <d>(direct dependency)<r>", .{});
                    }
                }

                for (package_info.vulnerabilities.items) |vuln| {
                    if (vuln.title.len > 0) {
                        if (std.mem.eql(u8, vuln.severity, "critical")) {
                            Output.prettyln("  <red>critical<d>:<r> {s} - <d>{s}<r>", .{ vuln.title, vuln.url });
                        } else if (std.mem.eql(u8, vuln.severity, "high")) {
                            Output.prettyln("  <red>high<d>:<r> {s} - <d>{s}<r>", .{ vuln.title, vuln.url });
                        } else if (std.mem.eql(u8, vuln.severity, "moderate")) {
                            Output.prettyln("  <yellow>moderate<d>:<r> {s} - <d>{s}<r>", .{ vuln.title, vuln.url });
                        } else {
                            Output.prettyln("  <cyan>low<d>:<r> {s} - <d>{s}<r>", .{ vuln.title, vuln.url });
                        }
                    }
                }

                // if (is_direct_dependency) {
                //     Output.prettyln("  To fix: <green>`bun update {s}`<r>", .{package_info.name});
                // } else {
                //     Output.prettyln("  To fix: <green>`bun update --latest`<r><d> (may be a breaking change)<r>", .{});
                // }

                Output.prettyln("", .{});
            }
        }

        const total = vuln_counts.low + vuln_counts.moderate + vuln_counts.high + vuln_counts.critical;
        if (total > 0) {
            Output.pretty("<b>{d} vulnerabilities<r> (", .{total});

            var has_previous = false;
            if (vuln_counts.critical > 0) {
                Output.pretty("<red><b>{d} critical<r>", .{vuln_counts.critical});
                has_previous = true;
            }
            if (vuln_counts.high > 0) {
                if (has_previous) Output.pretty(", ", .{});
                Output.pretty("<red>{d} high<r>", .{vuln_counts.high});
                has_previous = true;
            }
            if (vuln_counts.moderate > 0) {
                if (has_previous) Output.pretty(", ", .{});
                Output.pretty("<yellow>{d} moderate<r>", .{vuln_counts.moderate});
                has_previous = true;
            }
            if (vuln_counts.low > 0) {
                if (has_previous) Output.pretty(", ", .{});
                Output.pretty("<cyan>{d} low<r>", .{vuln_counts.low});
            }
            Output.prettyln(")", .{});

            Output.prettyln("", .{});
            Output.prettyln("To update all dependencies to the latest compatible versions:", .{});
            Output.prettyln("  <green>bun update<r>", .{});
            Output.prettyln("", .{});
            Output.prettyln("To update all dependencies to the latest versions (including breaking changes):", .{});
            Output.prettyln("  <green>bun update --latest<r>", .{});
            Output.prettyln("", .{});
        }

        if (total > 0) {
            return 1;
        }
    } else {
        Output.writer().writeAll(response_text) catch {};
        Output.writer().writeByte('\n') catch {};
    }

    return 0;
}
