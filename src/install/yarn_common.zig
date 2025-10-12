const std = @import("std");
const bun = @import("root").bun;
const String = bun.String;
const strings = bun.strings;
const Lockfile = @import("./lockfile.zig");
const PackageManager = @import("./install.zig").PackageManager;
const logger = bun.logger;
const glob = bun.glob;
const Semver = @import("./semver.zig");
const Dependency = @import("./dependency.zig");

/// Shared workspace scanning logic used by both Yarn v1 and Berry migrations
pub fn scanWorkspaces(
    lockfile: *Lockfile,
    manager: *PackageManager,
    allocator: std.mem.Allocator,
    log: *logger.Log,
    root_json: anytype,
) !void {
    var string_buf = lockfile.stringBuf();
    
    if (root_json.get("workspaces")) |workspaces_expr| {
        var workspace_patterns = std.ArrayList([]const u8).init(allocator);
        defer workspace_patterns.deinit();

        if (workspaces_expr.data == .e_array) {
            for (workspaces_expr.data.e_array.slice()) |pattern_expr| {
                if (pattern_expr.asString(allocator)) |pattern| {
                    try workspace_patterns.append(pattern);
                }
            }
        } else if (workspaces_expr.data == .e_object) {
            if (workspaces_expr.get("packages")) |packages_expr| {
                if (packages_expr.data == .e_array) {
                    for (packages_expr.data.e_array.slice()) |pattern_expr| {
                        if (pattern_expr.asString(allocator)) |pattern| {
                            try workspace_patterns.append(pattern);
                        }
                    }
                }
            }
        }

        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();

        const GlobWalker = glob.GlobWalker(null, glob.walk.SyscallAccessor, false);

        for (workspace_patterns.items) |user_pattern| {
            defer _ = arena.reset(.retain_capacity);

            const glob_pattern = if (user_pattern.len == 0) "package.json" else brk: {
                const parts = [_][]const u8{ user_pattern, "package.json" };
                break :brk bun.handleOom(arena.allocator().dupe(u8, bun.path.join(parts, .auto)));
            };

            var walker: GlobWalker = .{};
            const cwd = bun.fs.FileSystem.instance.top_level_dir;
            if ((try walker.initWithCwd(&arena, glob_pattern, cwd, false, false, false, false, true)).asErr()) |_| {
                continue;
            }
            defer walker.deinit(false);

            var iter: GlobWalker.Iterator = .{
                .walker = &walker,
            };
            defer iter.deinit();
            if ((try iter.init()).asErr()) |_| {
                continue;
            }

            while (switch (try iter.next()) {
                .result => |r| r,
                .err => |_| null,
            }) |matched_path| {
                if (strings.eqlComptime(matched_path, "package.json")) continue;

                const entry_dir = bun.path.dirname(matched_path, .auto);

                var ws_pkg_json_path: bun.AutoAbsPath = .initTopLevelDir();
                defer ws_pkg_json_path.deinit();

                ws_pkg_json_path.append(matched_path);

                const ws_pkg_json = manager.workspace_package_json_cache.getWithPath(allocator, log, ws_pkg_json_path.slice(), .{}).unwrap() catch continue;
                const ws_json = ws_pkg_json.root;

                const name, _ = try ws_json.getString(allocator, "name") orelse continue;
                const name_hash = String.Builder.stringHash(name);

                try lockfile.workspace_paths.put(allocator, name_hash, try string_buf.append(entry_dir));

                if (try ws_json.getString(allocator, "version")) |version_info| {
                    const version, _ = version_info;
                    const version_str = try string_buf.append(version);
                    const parsed = Semver.Version.parse(version_str.sliced(string_buf.bytes.items));
                    if (parsed.valid) {
                        try lockfile.workspace_versions.put(allocator, name_hash, parsed.version.min());
                    }
                }
            }
        }
    }
}

/// Convert Berry checksum format to Bun integrity format
/// Berry: "10c0/base64hash" or "8/base64hash" or "10/base64hash"
/// Bun: "sha512-base64hash" or "sha1-base64hash" or "sha256-base64hash"
pub fn convertBerryChecksum(berry_checksum: []const u8, allocator: std.mem.Allocator) !?[]const u8 {
    const slash_idx = strings.indexOfChar(berry_checksum, '/') orelse return null;
    
    const algorithm_prefix = berry_checksum[0..slash_idx];
    const hash_part = berry_checksum[slash_idx + 1..];
    
    if (hash_part.len == 0) return null;
    
    // Map Berry algorithm prefix to Bun format
    const bun_algorithm = if (strings.eqlComptime(algorithm_prefix, "10c0"))
        "sha512"
    else if (strings.eqlComptime(algorithm_prefix, "10"))
        "sha256"
    else if (strings.eqlComptime(algorithm_prefix, "8"))
        "sha1"
    else
        return null; // Unknown algorithm
    
    return try std.fmt.allocPrint(allocator, "{s}-{s}", .{ bun_algorithm, hash_part });
}
