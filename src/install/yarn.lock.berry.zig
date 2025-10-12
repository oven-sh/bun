/// Yarn Berry (v4+) lockfile migration
/// Format: YAML with specific structure
/// Example lockfile: https://github.com/yarnpkg/berry/blob/master/yarn.lock
const MigrateYarnBerryLockfileError = OOM || error{
    YarnBerryLockfileTooOld,
    YarnBerryLockfileVersionInvalid,
    InvalidYarnBerryLockfile,
    YamlParseError,
    YarnBerryLockfileNotObject,
    YarnBerryLockfileMissingVersion,
    YarnBerryLockfileInvalidPackage,
    YarnBerryLockfileMissingResolution,
    DependencyLoop,
};

pub fn migrateYarnBerryLockfile(
    lockfile: *Lockfile,
    manager: *PackageManager,
    allocator: std.mem.Allocator,
    log: *logger.Log,
    data: []const u8,
    _: bun.FD,
) MigrateYarnBerryLockfileError!LoadResult {
    lockfile.initEmpty(allocator);
    bun.install.initializeStore();
    bun.analytics.Features.yarn_migration += 1;

    var yaml_arena = bun.ArenaAllocator.init(allocator);
    defer yaml_arena.deinit();

    const yaml_source = &logger.Source.initPathString("yarn.lock", data);
    const _root = YAML.parse(yaml_source, log, yaml_arena.allocator()) catch {
        return error.YamlParseError;
    };

    const root = try _root.deepClone(allocator);

    if (root.data != .e_object) {
        try log.addErrorFmt(null, logger.Loc.Empty, allocator, "yarn.lock root must be an object, got {s}", .{@tagName(root.data)});
        return error.YarnBerryLockfileNotObject;
    }

    // Check version in __metadata
    const metadata_expr = root.get("__metadata") orelse {
        try log.addError(null, logger.Loc.Empty, "yarn.lock missing '__metadata' field");
        return error.YarnBerryLockfileMissingVersion;
    };

    if (metadata_expr.data != .e_object) {
        try log.addError(null, logger.Loc.Empty, "yarn.lock '__metadata' must be an object");
        return error.YarnBerryLockfileNotObject;
    }

    const lockfile_version_expr = metadata_expr.get("version") orelse {
        try log.addError(null, logger.Loc.Empty, "yarn.lock __metadata missing 'version' field");
        return error.YarnBerryLockfileMissingVersion;
    };

    const lockfile_version_num: f64 = lockfile_version: {
        err: {
            switch (lockfile_version_expr.data) {
                .e_number => |num| {
                    if (num.value < 0) {
                        break :err;
                    }
                    break :lockfile_version num.value;
                },
                .e_string => |version_str| {
                    const str = version_str.slice(allocator);
                    break :lockfile_version std.fmt.parseFloat(f64, str) catch break :err;
                },
                else => {},
            }
        }

        try log.addErrorFmt(null, logger.Loc.Empty, allocator, "yarn.lock 'version' must be a number or string, got {s}", .{@tagName(lockfile_version_expr.data)});
        return error.YarnBerryLockfileVersionInvalid;
    };

    if (lockfile_version_num < 4) {
        return error.YarnBerryLockfileTooOld;
    }

    var string_buf = lockfile.stringBuf();

    // Parse packages
    var pkg_map: bun.StringArrayHashMap(PackageID) = .init(allocator);
    defer pkg_map.deinit();

    // Read root package.json for workspace info
    var pkg_json_path: bun.AbsPath(.{}) = .initTopLevelDir();
    defer pkg_json_path.deinit();
    pkg_json_path.append("package.json");

    const root_pkg_json = manager.workspace_package_json_cache.getWithPath(
        allocator,
        log,
        pkg_json_path.slice(),
        .{},
    ).unwrap() catch {
        return invalidYarnBerryLockfile();
    };

    const root_package_json = root_pkg_json.root;

    // Create root package
    const root_name: ?[]const u8 = if (root_package_json.get("name")) |name_expr|
        name_expr.asString(allocator)
    else
        null;

    const root_name_hash = if (root_name) |name| String.Builder.stringHash(name) else 0;

    var root_pkg: Lockfile.Package = .{};

    if (root_name) |name| {
        root_pkg.name = try string_buf.appendWithHash(name, root_name_hash);
        root_pkg.name_hash = root_name_hash;
    }

    root_pkg.meta.id = 0;
    root_pkg.resolution = Resolution.init(.{ .root = {} });
    try lockfile.packages.append(allocator, root_pkg);
    try lockfile.getOrPutID(0, root_name_hash);

    try pkg_map.putNoClobber(".", 0);

    var packages_to_process = std.ArrayList(struct {
        key: []const u8,
        value: Expr,
    }).init(allocator);
    defer packages_to_process.deinit();

    // Collect all package entries (skip __metadata)
    for (root.data.e_object.properties.slice()) |prop| {
        const key = prop.key.?;
        const value = prop.value.?;

        const key_str = key.asString(allocator) orelse continue;

        // Skip metadata
        if (strings.eqlComptime(key_str, "__metadata")) continue;

        if (value.data != .e_object) continue;

        try packages_to_process.append(.{
            .key = key_str,
            .value = value,
        });
    }

    var next_package_id: PackageID = 1;

    // Process all packages
    for (packages_to_process.items) |pkg_entry| {
        const key_str = pkg_entry.key;
        const pkg_obj = pkg_entry.value;

        // Parse package descriptor: "name@npm:version" or "name@workspace:path"
        const at_idx = strings.lastIndexOfChar(key_str, '@') orelse continue;

        var pkg_name = key_str[0..at_idx];
        if (pkg_name.len > 0 and pkg_name[0] == '@') {
            // Scoped package: @scope/package@npm:version
            const second_at = strings.indexOfChar(key_str[at_idx + 1 ..], '@');
            if (second_at) |idx| {
                pkg_name = key_str[0 .. at_idx + 1 + idx];
            }
        }

        const version_str = key_str[pkg_name.len + 1 ..];

        // Get version field
        const version_field = if (pkg_obj.get("version")) |v_expr|
            v_expr.asString(allocator)
        else
            null;

        _ = if (pkg_obj.get("linkType")) |link_expr|
            link_expr.asString(allocator)
        else
            null;

        // Check if workspace
        const is_workspace = strings.hasPrefixComptime(version_str, "workspace:");

        const name_hash = String.Builder.stringHash(pkg_name);
        const name = try string_buf.appendWithHash(pkg_name, name_hash);

        var pkg: Lockfile.Package = .{
            .name = name,
            .name_hash = name_hash,
        };

        // Parse resolution
        pkg.resolution = if (is_workspace) blk: {
            const workspace_path = if (strings.hasPrefixComptime(version_str, "workspace:"))
                version_str["workspace:".len..]
            else
                version_str;
            break :blk Resolution.init(.{ .workspace = try string_buf.append(workspace_path) });
        } else if (version_field) |ver| blk: {
            // Yarn berry always has a version field for npm packages
            // Construct the npm registry URL
            const registry = manager.scopeForPackageName(pkg_name);

            const version = try string_buf.append(ver);
            const result = Semver.Version.parse(version.sliced(string_buf.bytes.items));
            if (!result.valid) {
                // Skip packages with invalid versions
                continue;
            }

            // Build registry URL: https://registry.npmjs.org/package/-/package-version.tgz
            var url_buf: [2048]u8 = undefined;
            const url = if (pkg_name[0] == '@') scoped: {
                // Scoped package: @scope/name -> @scope/name/-/name-version.tgz
                const slash_idx = strings.indexOfChar(pkg_name, '/') orelse {
                    continue;
                };
                const short_name = pkg_name[slash_idx + 1 ..];
                break :scoped std.fmt.bufPrint(&url_buf, "{s}{s}/-/{s}-{s}.tgz", .{
                    registry.url.href,
                    pkg_name,
                    short_name,
                    ver,
                }) catch continue;
            } else normal: {
                // Normal package: name -> name/-/name-version.tgz
                break :normal std.fmt.bufPrint(&url_buf, "{s}{s}/-/{s}-{s}.tgz", .{
                    registry.url.href,
                    pkg_name,
                    pkg_name,
                    ver,
                }) catch continue;
            };

            break :blk Resolution.init(.{
                .npm = .{
                    .url = try string_buf.append(url),
                    .version = result.version.min(),
                },
            });
        } else {
            // No version field - skip this package
            continue;
        };

        // Parse checksum/integrity
        if (pkg_obj.get("checksum")) |checksum_expr| {
            if (checksum_expr.asString(allocator)) |checksum_str| {
                // Yarn berry uses format: "10/hash" where 10 is the algorithm
                const slash_idx = strings.indexOfChar(checksum_str, '/');
                const hash_str = if (slash_idx) |idx| checksum_str[idx + 1 ..] else checksum_str;

                // Convert to standard integrity format (sha512-...)
                const integrity_str = try std.fmt.allocPrint(allocator, "sha512-{s}", .{hash_str});
                defer allocator.free(integrity_str);
                pkg.meta.integrity = Integrity.parse(integrity_str);
            }
        }

        // Parse dependencies
        const deps_off = lockfile.buffers.dependencies.items.len;

        const dependency_groups = [_]struct { []const u8, Dependency.Behavior }{
            .{ "dependencies", .{ .prod = true } },
            .{ "devDependencies", .{ .dev = true } },
            .{ "peerDependencies", .{ .peer = true } },
            .{ "optionalDependencies", .{ .optional = true } },
        };

        for (dependency_groups) |dep_group| {
            const group_name, const group_behavior = dep_group;
            if (pkg_obj.get(group_name)) |deps_expr| {
                if (deps_expr.data != .e_object) continue;

                for (deps_expr.data.e_object.properties.slice()) |dep_prop| {
                    const dep_key = dep_prop.key.?;
                    const dep_value = dep_prop.value.?;

                    const dep_name_str = dep_key.asString(allocator) orelse continue;
                    var dep_version_str = dep_value.asString(allocator) orelse continue;

                    // Strip "npm:" prefix from yarn berry dependency versions
                    if (strings.hasPrefixComptime(dep_version_str, "npm:")) {
                        dep_version_str = dep_version_str["npm:".len..];
                    }

                    const dep_name_hash = String.Builder.stringHash(dep_name_str);
                    const dep_name = try string_buf.appendWithHash(dep_name_str, dep_name_hash);

                    const dep_version = try string_buf.append(dep_version_str);
                    const dep_version_sliced = dep_version.sliced(string_buf.bytes.items);

                    const dep: Dependency = .{
                        .name = dep_name,
                        .name_hash = dep_name_hash,
                        .behavior = group_behavior,
                        .version = Dependency.parse(
                            allocator,
                            dep_name,
                            dep_name_hash,
                            dep_version_sliced.slice,
                            &dep_version_sliced,
                            log,
                            manager,
                        ) orelse {
                            return invalidYarnBerryLockfile();
                        },
                    };

                    try lockfile.buffers.dependencies.append(allocator, dep);
                }
            }
        }

        const deps_end = lockfile.buffers.dependencies.items.len;
        const deps_len: u32 = @intCast(deps_end - deps_off);

        pkg.dependencies = .{ .off = @intCast(deps_off), .len = deps_len };
        pkg.resolutions = .{ .off = @intCast(deps_off), .len = deps_len };

        const pkg_id = try lockfile.appendPackageDedupe(&pkg, string_buf.bytes.items);
        try pkg_map.put(key_str, pkg_id);

        if (pkg_id >= next_package_id) {
            next_package_id = pkg_id + 1;
        }
    }

    // Resolve dependencies
    try lockfile.buffers.resolutions.ensureTotalCapacityPrecise(allocator, lockfile.buffers.dependencies.items.len);
    lockfile.buffers.resolutions.expandToCapacity();
    @memset(lockfile.buffers.resolutions.items, invalid_package_id);

    // Match dependencies to package IDs
    // In yarn berry, dependencies are resolved by matching "name@descriptor" patterns
    const string_bytes = string_buf.bytes.items;
    var resolution_idx: usize = 0;

    for (lockfile.packages.items(.dependencies), lockfile.packages.items(.name)) |dep_list, pkg_name| {
        _ = pkg_name; // Not needed for resolution lookup

        for (dep_list.off..dep_list.off + dep_list.len) |dep_idx| {
            const dep = lockfile.buffers.dependencies.items[dep_idx];
            const dep_name_str = dep.name.slice(string_bytes);
            const dep_version_str = dep.version.literal.slice(string_bytes);

            // Build the yarn berry lookup key: "name@npm:version" or similar
            // Try to find matching package in pkg_map
            var found_pkg_id: ?PackageID = null;

            // Try different formats:
            // 1. "name@npm:version"
            var lookup_buf: [1024]u8 = undefined;
            const lookup_key = std.fmt.bufPrint(&lookup_buf, "{s}@npm:{s}", .{ dep_name_str, dep_version_str }) catch {
                resolution_idx += 1;
                continue;
            };

            if (pkg_map.get(lookup_key)) |pkg_id| {
                found_pkg_id = pkg_id;
            }

            // 2. Try just "name@version" for non-npm deps
            if (found_pkg_id == null) {
                const lookup_key2 = std.fmt.bufPrint(&lookup_buf, "{s}@{s}", .{ dep_name_str, dep_version_str }) catch {
                    resolution_idx += 1;
                    continue;
                };
                if (pkg_map.get(lookup_key2)) |pkg_id| {
                    found_pkg_id = pkg_id;
                }
            }

            // 3. Try workspace format
            if (found_pkg_id == null and strings.hasPrefixComptime(dep_version_str, "workspace:")) {
                const lookup_key3 = std.fmt.bufPrint(&lookup_buf, "{s}@{s}", .{ dep_name_str, dep_version_str }) catch {
                    resolution_idx += 1;
                    continue;
                };
                if (pkg_map.get(lookup_key3)) |pkg_id| {
                    found_pkg_id = pkg_id;
                }
            }

            if (found_pkg_id) |pkg_id| {
                lockfile.buffers.resolutions.items[resolution_idx] = pkg_id;
            }

            resolution_idx += 1;
        }
    }

    // Verify all packages have valid resolutions (not uninitialized)
    for (lockfile.packages.items(.resolution), lockfile.packages.items(.name), 0..) |res, name, i| {
        if (res.tag == .uninitialized) {
            const name_str = name.slice(string_bytes);
            try log.addErrorFmt(null, logger.Loc.Empty, allocator, "Package {d} ({s}) has uninitialized resolution", .{ i, name_str });
            return error.InvalidYarnBerryLockfile;
        }
    }

    return .{
        .ok = .{
            .lockfile = lockfile,
            .loaded_from_binary_lockfile = false,
            .migrated = .yarn,
            .serializer_result = .{},
            .format = .text,
        },
    };
}

fn invalidYarnBerryLockfile() error{InvalidYarnBerryLockfile} {
    return error.InvalidYarnBerryLockfile;
}

const Dependency = @import("./dependency.zig");
const Npm = @import("./npm.zig");
const Bin = @import("./bin.zig").Bin;
const Integrity = @import("./integrity.zig").Integrity;
const Resolution = @import("./resolution.zig").Resolution;

const Lockfile = @import("./lockfile.zig");
const LoadResult = Lockfile.LoadResult;

const bun = @import("bun");
const OOM = bun.OOM;
const logger = bun.logger;
const strings = bun.strings;
const YAML = bun.interchange.yaml.YAML;

const Semver = bun.Semver;
const ExternalString = Semver.ExternalString;
const String = Semver.String;

const JSAst = bun.ast;
const E = JSAst.E;
const Expr = JSAst.Expr;

const DependencyID = bun.install.DependencyID;
const PackageID = bun.install.PackageID;
const PackageManager = bun.install.PackageManager;
const invalid_package_id = bun.install.invalid_package_id;

const std = @import("std");
const Allocator = std.mem.Allocator;
