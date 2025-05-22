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

pub const AuditCommand = struct {
    pub fn exec(ctx: Command.Context, pm: *PackageManager, args: [][:0]u8) !void {
        _ = args;
        Output.prettyError("<r><b>bun pm audit <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{});
        Output.flush();

        const load_lockfile = pm.lockfile.loadFromCwd(pm, ctx.allocator, ctx.log, true);
        @import("./package_manager_command.zig").PackageManagerCommand.handleLoadLockfileErrors(load_lockfile, pm);
        try pm.updateLockfileIfNeeded(load_lockfile);

        const packages = pm.lockfile.packages.slice();
        const pkg_names = packages.items(.name);
        const pkg_resolutions = packages.items(.resolution);
        const buf = pm.lockfile.buffers.string_bytes.items;
        const root_id = pm.root_package_id.get(pm.lockfile, pm.workspace_name_hash);

        // Use a simple array approach to avoid hash map stability issues
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

            // Find existing package or create new one
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

            // Check if version already exists
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
            Output.prettyErrorln("<red>error<r>: audit request failed (status {d})", .{res.status_code});
            Global.crash();
        }

        Output.writer().writeAll(response_buf.slice()) catch {};
        Output.writer().writeByte('\n') catch {};
    }
};
