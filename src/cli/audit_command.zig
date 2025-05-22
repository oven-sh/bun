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

pub const AuditCommand = struct {
    pub fn exec(ctx: Command.Context, pm: *PackageManager, args: [][:0]u8) !void {
        _ = args;
        Output.prettyError(comptime Output.prettyFmt("<r><b>bun pm audit <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", true), .{});
        Output.flush();

        const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
        @import("./package_manager_command.zig").PackageManagerCommand.handleLoadLockfileErrors(load_lockfile, pm);

        const packages = pm.lockfile.packages.slice();
        const pkg_names = packages.items(.name);
        const pkg_resolutions = packages.items(.resolution);
        const buf = pm.lockfile.buffers.string_bytes.items;
        const root_id = pm.root_package_id.get(pm.lockfile, pm.workspace_name_hash);

        var packages_list = std.ArrayList(struct {
            name: []const u8,
            versions: std.ArrayList([]const u8),
        }).init(ctx.allocator);
        defer {
            for (packages_list.items) |item| {
                ctx.allocator.free(item.name);
                for (item.versions.items) |version| {
                    ctx.allocator.free(version);
                }
                item.versions.deinit();
            }
            packages_list.deinit();
        }

        for (pkg_names, pkg_resolutions, 0..) |name, res, idx| {
            if (idx == root_id) continue;
            if (res.tag != .npm) continue;

            const name_slice = name.slice(buf);
            const ver_str = try std.fmt.allocPrint(ctx.allocator, "{}", .{res.value.npm.version.fmt(buf)});

            var found_package: ?*@TypeOf(packages_list.items[0]) = null;
            for (packages_list.items) |*item| {
                if (std.mem.eql(u8, item.name, name_slice)) {
                    found_package = item;
                    break;
                }
            }

            if (found_package == null) {
                try packages_list.append(.{
                    .name = try ctx.allocator.dupe(u8, name_slice),
                    .versions = std.ArrayList([]const u8).init(ctx.allocator),
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
                ctx.allocator.free(ver_str);
            }
        }

        var body = try MutableString.init(ctx.allocator, 1024);
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

        var headers: HeaderBuilder = .{};
        headers.count("accept", "application/json");
        headers.count("content-type", "application/json");
        if (pm.options.scope.token.len > 0) {
            headers.count("authorization", "");
            headers.content.cap += "Bearer ".len + pm.options.scope.token.len;
        } else if (pm.options.scope.auth.len > 0) {
            headers.count("authorization", "");
            headers.content.cap += "Basic ".len + pm.options.scope.auth.len;
        }
        try headers.allocate(ctx.allocator);
        headers.append("accept", "application/json");
        headers.append("content-type", "application/json");
        if (pm.options.scope.token.len > 0) {
            headers.appendFmt("authorization", "Bearer {s}", .{pm.options.scope.token});
        } else if (pm.options.scope.auth.len > 0) {
            headers.appendFmt("authorization", "Basic {s}", .{pm.options.scope.auth});
        }

        const url_str = try std.fmt.allocPrint(ctx.allocator, "{s}/-/npm/v1/security/advisories/bulk", .{strings.withoutTrailingSlash(pm.options.scope.url.href)});
        defer ctx.allocator.free(url_str);
        const url = URL.parse(url_str);

        var response_buf = try MutableString.init(ctx.allocator, 1024);
        var req = http.AsyncHTTP.initSync(
            ctx.allocator,
            .POST,
            url,
            headers.entries,
            headers.content.ptr.?[0..headers.content.len],
            &response_buf,
            body.slice(),
            null,
            null,
            .follow,
        );
        const res = req.sendSync() catch |err| {
            Output.err(err, "audit request failed", .{});
            Global.crash();
        };

        if (res.status_code >= 400) {
            Output.prettyErrorln(comptime Output.prettyFmt("<red>error<r>: audit request failed (status {d})", true), .{res.status_code});
            Global.crash();
        }

        const response_text = response_buf.slice();
        if (response_text.len > 0) {
            printAuditReport(response_text) catch {
                Output.writer().writeAll(response_text) catch {};
                Output.writer().writeByte('\n') catch {};
            };
        } else {
            Output.prettyln("No vulnerabilities found.", .{});
        }
    }
};

fn printVulnerability(package_name: []const u8, vuln: bun.JSAst.Expr, vuln_counts: anytype) void {
    var severity: []const u8 = "moderate";
    var title: []const u8 = "Vulnerability found";
    var url: []const u8 = "";
    var vulnerable_versions: []const u8 = "";
    var id: []const u8 = "";

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
                                severity = field_value;
                            } else if (std.mem.eql(u8, field_name, "title")) {
                                title = field_value;
                            } else if (std.mem.eql(u8, field_name, "url")) {
                                url = field_value;
                            } else if (std.mem.eql(u8, field_name, "vulnerable_versions")) {
                                vulnerable_versions = field_value;
                            } else if (std.mem.eql(u8, field_name, "id")) {
                                id = field_value;
                            }
                        } else if (value.data == .e_number) {
                            if (std.mem.eql(u8, field_name, "id")) {
                                id = std.fmt.allocPrint(bun.default_allocator, "{d}", .{@as(u64, @intFromFloat(value.data.e_number.value))}) catch "";
                            }
                        }
                    }
                }
            }
        }
    }

    if (std.mem.eql(u8, severity, "low")) {
        vuln_counts.low += 1;
    } else if (std.mem.eql(u8, severity, "moderate")) {
        vuln_counts.moderate += 1;
    } else if (std.mem.eql(u8, severity, "high")) {
        vuln_counts.high += 1;
    } else if (std.mem.eql(u8, severity, "critical")) {
        vuln_counts.critical += 1;
    } else {
        vuln_counts.moderate += 1; //default
    }

    if (vulnerable_versions.len > 0) {
        Output.prettyln(comptime Output.prettyFmt("<red>{s}<r>  {s}", true), .{ package_name, vulnerable_versions });
    } else {
        Output.prettyln(comptime Output.prettyFmt("<red>{s}<r>", true), .{package_name});
    }

    if (std.mem.eql(u8, severity, "critical")) {
        Output.prettyln(comptime Output.prettyFmt("Severity: <red>critical<r>", true), .{});
    } else if (std.mem.eql(u8, severity, "high")) {
        Output.prettyln(comptime Output.prettyFmt("Severity: <red>high<r>", true), .{});
    } else if (std.mem.eql(u8, severity, "moderate")) {
        Output.prettyln(comptime Output.prettyFmt("Severity: <yellow>moderate<r>", true), .{});
    } else {
        Output.prettyln(comptime Output.prettyFmt("Severity: <cyan>low<r>", true), .{});
    }

    if (title.len > 0) {
        Output.prettyln("{s}", .{title});
    }

    if (url.len > 0) {
        Output.prettyln(comptime Output.prettyFmt("<blue>{s}<r>", true), .{url});
    }

    Output.prettyln("fix available via `bun update`", .{});
    Output.prettyln("", .{});
}

fn printAuditReport(response_text: []const u8) !void {
    const source = logger.Source.initPathString("audit-response.json", response_text);
    var log = logger.Log.init(bun.default_allocator);
    defer log.deinit();

    const expr = @import("../json_parser.zig").parse(&source, &log, bun.default_allocator, true) catch {
        Output.writer().writeAll(response_text) catch {};
        Output.writer().writeByte('\n') catch {};
        return;
    };

    if (expr.data == .e_object and expr.data.e_object.properties.len == 0) {
        Output.prettyln(comptime Output.prettyFmt("<green>No vulnerabilities found.<r>", true), .{});
        return;
    }

    Output.prettyln("# bun audit report\n", .{});

    if (expr.data == .e_object) {
        const properties = expr.data.e_object.properties.slice();
        var vuln_counts = struct {
            low: u32 = 0,
            moderate: u32 = 0,
            high: u32 = 0,
            critical: u32 = 0,
        }{};

        for (properties) |prop| {
            if (prop.key) |key| {
                if (key.data == .e_string) {
                    const package_name = key.data.e_string.data;

                    // Parse vulnerability array for this package
                    if (prop.value) |value| {
                        if (value.data == .e_array) {
                            const vulns = value.data.e_array.items.slice();
                            for (vulns) |vuln| {
                                if (vuln.data == .e_object) {
                                    printVulnerability(package_name, vuln, &vuln_counts);
                                }
                            }
                        }
                    }
                }
            }
        }

        const total = vuln_counts.low + vuln_counts.moderate + vuln_counts.high + vuln_counts.critical;
        if (total > 0) {
            Output.prettyln("", .{});
            var severity_parts = std.ArrayList([]const u8).init(bun.default_allocator);
            defer severity_parts.deinit();

            if (vuln_counts.low > 0) {
                const part = std.fmt.allocPrint(bun.default_allocator, "{d} low", .{vuln_counts.low}) catch "";
                severity_parts.append(part) catch {};
            }
            if (vuln_counts.moderate > 0) {
                const part = std.fmt.allocPrint(bun.default_allocator, "{d} moderate", .{vuln_counts.moderate}) catch "";
                severity_parts.append(part) catch {};
            }
            if (vuln_counts.high > 0) {
                const part = std.fmt.allocPrint(bun.default_allocator, "{d} high", .{vuln_counts.high}) catch "";
                severity_parts.append(part) catch {};
            }
            if (vuln_counts.critical > 0) {
                const part = std.fmt.allocPrint(bun.default_allocator, "{d} critical", .{vuln_counts.critical}) catch "";
                severity_parts.append(part) catch {};
            }

            Output.pretty("{d} vulnerabilities (", .{total});
            for (severity_parts.items, 0..) |part, i| {
                if (i > 0) Output.pretty(", ", .{});
                Output.pretty("{s}", .{part});
                bun.default_allocator.free(part);
            }
            Output.prettyln(")", .{});
            Output.prettyln("", .{});
            Output.prettyln("To address issues, run:", .{});
            Output.prettyln("  bun update", .{});
        }
    } else {
        Output.writer().writeAll(response_text) catch {};
        Output.writer().writeByte('\n') catch {};
    }
}
