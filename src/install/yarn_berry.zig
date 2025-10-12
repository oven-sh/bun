const std = @import("std");
const bun = @import("bun");
const String = bun.Semver.String;
const strings = bun.strings;
const Lockfile = @import("./lockfile.zig");
const PackageManager = @import("./install.zig").PackageManager;
const Semver = bun.Semver;
const Resolution = @import("./resolution.zig").Resolution;
const Dependency = @import("./dependency.zig");
const PackageID = @import("./install.zig").PackageID;
const DependencyID = @import("./install.zig").DependencyID;
const logger = bun.logger;
const Allocator = std.mem.Allocator;
const JSAst = bun.ast;
const Expr = JSAst.Expr;
const Install = bun.install;
const Integrity = @import("./integrity.zig").Integrity;
const Bin = @import("./bin.zig").Bin;
const glob = bun.glob;
const YAML = bun.interchange.yaml.YAML;
const ExtractTarball = @import("./extract_tarball.zig");
const yarn_common = @import("./yarn_common.zig");

const debug = bun.Output.scoped(.yarn_berry_migration, .visible);

pub fn migrateYarnBerryLockfile(
    lockfile: *Lockfile,
    allocator: std.mem.Allocator,
    log: *logger.Log,
    manager: *PackageManager,
    data: []const u8,
    dir: bun.FD,
) !Lockfile.LoadResult {
    _ = dir;

    debug("Starting Yarn Berry lockfile migration", .{});

    lockfile.initEmpty(allocator);
    Install.initializeStore();

    const yaml_source = logger.Source.initPathString("yarn.lock", data);
    const json = YAML.parse(&yaml_source, log, allocator) catch {
        try log.addError(null, logger.Loc.Empty, "Failed to parse yarn.lock as YAML");
        return error.YarnBerryParseError;
    };

    if (json.data != .e_object) {
        try log.addError(null, logger.Loc.Empty, "Yarn Berry lockfile root is not an object");
        return error.InvalidYarnBerryLockfile;
    }

    const root = json;

    const metadata = root.get("__metadata") orelse {
        try log.addError(null, logger.Loc.Empty, "Missing __metadata in yarn.lock (not a valid Yarn Berry lockfile)");
        return error.InvalidYarnBerryLockfile;
    };

    if (metadata.data != .e_object) {
        try log.addError(null, logger.Loc.Empty, "__metadata is not an object");
        return error.InvalidYarnBerryLockfile;
    }

    if (metadata.get("version")) |version_node| {
        if (version_node.data == .e_string) {
            const version_str = version_node.data.e_string.data;
            const version = std.fmt.parseInt(u32, version_str, 10) catch {
                try log.addError(null, logger.Loc.Empty, "Invalid __metadata.version format");
                return error.InvalidYarnBerryLockfile;
            };
            if (version < 6) {
                try log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    allocator,
                    "Yarn Berry lockfile version {d} is too old. Please upgrade to v6+.",
                    .{version},
                );
                return error.YarnBerryVersionTooOld;
            }
            debug("Detected Yarn Berry lockfile version {d}", .{version});
        }
    }

    bun.analytics.Features.yarn_berry_migration += 1;

    bun.Output.prettyErrorln("<yellow>Note:<r> Yarn Berry (v2+) migration is experimental. Some features may not work correctly.", .{});

    var string_buf = lockfile.stringBuf();

    var root_pkg_json_path: bun.AutoAbsPath = .initTopLevelDir();
    defer root_pkg_json_path.deinit();
    root_pkg_json_path.append("package.json");

    const root_pkg_json = manager.workspace_package_json_cache.getWithPath(allocator, log, root_pkg_json_path.slice(), .{}).unwrap() catch {
        try log.addError(null, logger.Loc.Empty, "Failed to read root package.json");
        return error.MissingRootPackageJson;
    };

    const root_json = root_pkg_json.root;

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

    {
        var root_pkg: Lockfile.Package = .{};

        if (try root_json.getString(allocator, "name")) |name_info| {
            const name, _ = name_info;
            const name_hash = String.Builder.stringHash(name);
            root_pkg.name = try string_buf.appendWithHash(name, name_hash);
            root_pkg.name_hash = name_hash;
        }

        const root_deps_off, var root_deps_len = try parsePackageJsonDependencies(
            lockfile,
            manager,
            allocator,
            &root_json,
            &string_buf,
            log,
        );

        const workspace_deps_start = lockfile.buffers.dependencies.items.len;
        for (lockfile.workspace_paths.values()) |workspace_path| {
            var ws_pkg_json_path: bun.AutoAbsPath = .initTopLevelDir();
            defer ws_pkg_json_path.deinit();

            ws_pkg_json_path.append(workspace_path.slice(string_buf.bytes.items));
            ws_pkg_json_path.append("package.json");

            const ws_pkg_json = manager.workspace_package_json_cache.getWithPath(allocator, log, ws_pkg_json_path.slice(), .{}).unwrap() catch continue;
            const ws_json = ws_pkg_json.root;

            const ws_name, _ = try ws_json.getString(allocator, "name") orelse continue;
            const ws_name_hash = String.Builder.stringHash(ws_name);

            const ws_dep: Dependency = .{
                .name = try string_buf.appendWithHash(ws_name, ws_name_hash),
                .name_hash = ws_name_hash,
                .behavior = .{ .workspace = true },
                .version = .{
                    .tag = .workspace,
                    .value = .{ .workspace = workspace_path },
                },
            };

            try lockfile.buffers.dependencies.append(allocator, ws_dep);
        }
        const workspace_deps_count: u32 = @intCast(lockfile.buffers.dependencies.items.len - workspace_deps_start);
        root_deps_len += workspace_deps_count;

        root_pkg.dependencies = .{ .off = root_deps_off, .len = root_deps_len };
        root_pkg.resolutions = .{ .off = root_deps_off, .len = root_deps_len };
        root_pkg.meta.id = 0;
        root_pkg.resolution = .init(.{ .root = {} });

        if (root_json.get("bin")) |bin_expr| {
            root_pkg.bin = try Bin.parseAppend(allocator, bin_expr, &string_buf, &lockfile.buffers.extern_strings);
        } else if (root_json.get("directories")) |directories_expr| {
            if (directories_expr.get("bin")) |bin_expr| {
                root_pkg.bin = try Bin.parseAppendFromDirectories(allocator, bin_expr, &string_buf);
            }
        }

        try lockfile.packages.append(allocator, root_pkg);
        try lockfile.getOrPutID(0, root_pkg.name_hash);
    }

    var pkg_map = std.StringHashMap(PackageID).init(allocator);
    defer pkg_map.deinit();

    for (lockfile.workspace_paths.values()) |workspace_path| {
        var ws_pkg_json_path: bun.AutoAbsPath = .initTopLevelDir();
        defer ws_pkg_json_path.deinit();

        ws_pkg_json_path.append(workspace_path.slice(string_buf.bytes.items));
        const abs_path = try allocator.dupe(u8, ws_pkg_json_path.slice());
        ws_pkg_json_path.append("package.json");

        const ws_pkg_json = manager.workspace_package_json_cache.getWithPath(allocator, log, ws_pkg_json_path.slice(), .{}).unwrap() catch continue;
        const ws_json = ws_pkg_json.root;

        const name, _ = try ws_json.getString(allocator, "name") orelse continue;
        const name_hash = String.Builder.stringHash(name);

        var pkg: Lockfile.Package = .{
            .name = try string_buf.appendWithHash(name, name_hash),
            .name_hash = name_hash,
            .resolution = .init(.{ .workspace = workspace_path }),
        };

        const deps_off, const deps_len = try parsePackageJsonDependencies(
            lockfile,
            manager,
            allocator,
            &ws_json,
            &string_buf,
            log,
        );

        pkg.dependencies = .{ .off = deps_off, .len = deps_len };
        pkg.resolutions = .{ .off = deps_off, .len = deps_len };

        if (ws_json.get("bin")) |bin_expr| {
            pkg.bin = try Bin.parseAppend(allocator, bin_expr, &string_buf, &lockfile.buffers.extern_strings);
        } else if (ws_json.get("directories")) |directories_expr| {
            if (directories_expr.get("bin")) |bin_expr| {
                pkg.bin = try Bin.parseAppendFromDirectories(allocator, bin_expr, &string_buf);
            }
        }

        const pkg_id = try lockfile.appendPackageDedupe(&pkg, string_buf.bytes.items);

        const entry = try pkg_map.getOrPut(abs_path);
        if (entry.found_existing) {
            try log.addError(null, logger.Loc.Empty, "Duplicate workspace package");
            return error.InvalidYarnBerryLockfile;
        }

        entry.value_ptr.* = pkg_id;
    }

    var skipped_virtual: usize = 0;
    var skipped_patch: usize = 0;
    var skipped_link: usize = 0;
    var skipped_file: usize = 0;
    var skipped_portal: usize = 0;
    var skipped_exec: usize = 0;
    var skipped_other: usize = 0;
    var added_count: usize = 0;

    var spec_to_pkg_id = std.StringHashMap(PackageID).init(allocator);


    for (root.data.e_object.properties.slice()) |prop| {
        const key = prop.key orelse continue;
        const value = prop.value orelse continue;

        const key_str = key.asString(allocator) orelse continue;

        if (strings.eqlComptime(key_str, "__metadata")) continue;

        if (value.data != .e_object) continue;
        const entry_obj = value;

        const resolution_node = entry_obj.get("resolution") orelse continue;
        const resolution_str = resolution_node.asString(allocator) orelse continue;

        if (strings.contains(resolution_str, "@workspace:")) continue;

        if (strings.contains(resolution_str, "@virtual:")) {
            skipped_virtual += 1;
            continue;
        }

        if (strings.contains(resolution_str, "@patch:")) {
            skipped_patch += 1;
            continue;
        }

        if (strings.contains(resolution_str, "@link:")) {
            skipped_link += 1;
            continue;
        }

        if (strings.contains(resolution_str, "@file:")) {
            skipped_file += 1;
            continue;
        }

        if (strings.contains(resolution_str, "@portal:")) {
            skipped_portal += 1;
            continue;
        }

        if (strings.contains(resolution_str, "@exec:")) {
            skipped_exec += 1;
            continue;
        }

        if (!strings.contains(resolution_str, "@npm:")) {
            skipped_other += 1;
            continue;
        }

        const version_node = entry_obj.get("version") orelse continue;
        const version_str = version_node.asString(allocator) orelse continue;

        const at_npm_idx = strings.indexOf(resolution_str, "@npm:") orelse continue;
        const pkg_name = if (at_npm_idx == 0) blk: {
            const after_npm = resolution_str[5..];
            if (strings.indexOfChar(after_npm, '@')) |at_idx| {
                break :blk after_npm[0..at_idx];
            }
            break :blk after_npm;
        } else resolution_str[0..at_npm_idx];

        const name_hash = String.Builder.stringHash(pkg_name);
        const name = try string_buf.appendWithHash(pkg_name, name_hash);

        const version_string = try string_buf.append(version_str);
        const sliced_version = version_string.sliced(string_buf.bytes.items);
        const parsed = Semver.Version.parse(sliced_version);
        if (!parsed.valid) continue;

        const scope = manager.scopeForPackageName(name.slice(string_buf.bytes.items));
        const url = try ExtractTarball.buildURL(
            scope.url.href,
            strings.StringOrTinyString.init(pkg_name),
            parsed.version.min(),
            string_buf.bytes.items,
        );

        const res = Resolution.init(.{
            .npm = .{
                .version = parsed.version.min(),
                .url = try string_buf.append(url),
            },
        });

        var pkg: Lockfile.Package = .{
            .name = name,
            .name_hash = name_hash,
            .resolution = res,
        };

        const deps_off = lockfile.buffers.dependencies.items.len;

        if (entry_obj.get("dependencies")) |deps_node| {
            if (deps_node.data == .e_object) {
                for (deps_node.data.e_object.properties.slice()) |dep_prop| {
                    const dep_key = dep_prop.key orelse continue;
                    const dep_value = dep_prop.value orelse continue;

                    const dep_name_str = dep_key.asString(allocator) orelse continue;
                    var dep_version_raw = dep_value.asString(allocator) orelse continue;

                    if (strings.hasPrefixComptime(dep_version_raw, "npm:")) {
                        dep_version_raw = dep_version_raw[4..];
                    }

                    const dep_name_hash = String.Builder.stringHash(dep_name_str);
                    const dep_name = try string_buf.appendExternalWithHash(dep_name_str, dep_name_hash);

                    const dep_version = try string_buf.append(dep_version_raw);
                    const dep_version_sliced = dep_version.sliced(string_buf.bytes.items);

                    const dep: Dependency = .{
                        .name = dep_name.value,
                        .name_hash = dep_name.hash,
                        .behavior = .{ .prod = true },
                        .version = Dependency.parse(
                            allocator,
                            dep_name.value,
                            dep_name.hash,
                            dep_version_sliced.slice,
                            &dep_version_sliced,
                            log,
                            manager,
                        ) orelse continue,
                    };

                    try lockfile.buffers.dependencies.append(allocator, dep);
                }
            }
        }

        const deps_end = lockfile.buffers.dependencies.items.len;
        pkg.dependencies = .{ .off = @intCast(deps_off), .len = @intCast(deps_end - deps_off) };
        pkg.resolutions = .{ .off = @intCast(deps_off), .len = @intCast(deps_end - deps_off) };

        if (entry_obj.get("checksum")) |checksum_node| {
            if (checksum_node.asString(allocator)) |checksum_str| {
                const maybe_integrity = yarn_common.convertBerryChecksum(checksum_str, allocator) catch null;
                if (maybe_integrity) |integrity_str| {
                    defer allocator.free(integrity_str);
                    pkg.meta.integrity = Integrity.parse(integrity_str);
                }
            }
        }
        const pkg_id = try lockfile.appendPackageDedupe(&pkg, string_buf.bytes.items);

        var spec_iter = std.mem.splitSequence(u8, key_str, ", ");
        while (spec_iter.next()) |spec_raw| {
            const spec = strings.trim(spec_raw, " \t\"");
            const spec_copy = try allocator.dupe(u8, spec);
            try spec_to_pkg_id.put(spec_copy, pkg_id);
        }

        added_count += 1;
    }

    if (skipped_virtual > 0) {
        debug("Skipped {d} virtual: packages (not yet supported)", .{skipped_virtual});
    }
    if (skipped_patch > 0) {
        debug("Skipped {d} patch: packages (not yet supported)", .{skipped_patch});
    }
    if (skipped_link > 0) {
        debug("Skipped {d} link: packages (not yet supported)", .{skipped_link});
    }
    if (skipped_file > 0) {
        debug("Skipped {d} file: packages (not yet supported)", .{skipped_file});
    }
    if (skipped_portal > 0) {
        debug("Skipped {d} portal: packages (not yet supported)", .{skipped_portal});
    }
    if (skipped_exec > 0) {
        debug("Skipped {d} exec: packages (not yet supported)", .{skipped_exec});
    }
    if (skipped_other > 0) {
        debug("Skipped {d} other protocol packages", .{skipped_other});
    }

    debug("Migrated {d} npm packages from Yarn Berry lockfile", .{added_count});

    try lockfile.resolve(log);

    try lockfile.fetchNecessaryPackageMetadataAfterYarnOrPnpmMigration(manager, true);

    return .{
        .ok = .{
            .lockfile = lockfile,
            .loaded_from_binary_lockfile = false,
            .migrated = .yarn_berry,
            .serializer_result = .{},
            .format = .text,
        },
    };
}

fn parsePackageJsonDependencies(
    lockfile: *Lockfile,
    manager: *PackageManager,
    allocator: std.mem.Allocator,
    pkg_json: *const Expr,
    string_buf: *String.Buf,
    log: *logger.Log,
) !struct { u32, u32 } {
    const dependency_groups = [_]struct { []const u8, Dependency.Behavior }{
        .{ "dependencies", .{ .prod = true } },
        .{ "devDependencies", .{ .dev = true } },
        .{ "optionalDependencies", .{ .optional = true } },
        .{ "peerDependencies", .{ .peer = true } },
    };

    const off = lockfile.buffers.dependencies.items.len;

    for (dependency_groups) |group| {
        const group_name, const group_behavior = group;
        if (pkg_json.get(group_name)) |deps| {
            if (!deps.isObject()) continue;

            for (deps.data.e_object.properties.slice()) |prop| {
                const key = prop.key.?;
                const value = prop.value.?;

                const name_str = key.asString(allocator) orelse continue;
                const name_hash = String.Builder.stringHash(name_str);
                const name = try string_buf.appendExternalWithHash(name_str, name_hash);

                const version_str = value.asString(allocator) orelse continue;
                const version = try string_buf.append(version_str);
                const version_sliced = version.sliced(string_buf.bytes.items);

                const dep: Dependency = .{
                    .name = name.value,
                    .name_hash = name.hash,
                    .behavior = group_behavior,
                    .version = Dependency.parse(
                        allocator,
                        name.value,
                        name.hash,
                        version_sliced.slice,
                        &version_sliced,
                        log,
                        manager,
                    ) orelse continue,
                };

                try lockfile.buffers.dependencies.append(allocator, dep);
            }
        }
    }

    const end = lockfile.buffers.dependencies.items.len;

    std.sort.pdq(
        Dependency,
        lockfile.buffers.dependencies.items[off..],
        string_buf.bytes.items,
        Dependency.isLessThan,
    );

    return .{ @intCast(off), @intCast(end - off) };
}
