pub fn getAllWorkspaces(
    allocator: std.mem.Allocator,
    manager: *PackageManager,
) OOM![]const PackageID {
    const lockfile = manager.lockfile;

    if (lockfile.packages.len == 0) {
        return try allocator.alloc(PackageID, 0);
    }

    const packages = lockfile.packages.slice();
    const pkg_resolutions = packages.items(.resolution);

    var workspace_pkg_ids: std.ArrayListUnmanaged(PackageID) = .{};
    for (pkg_resolutions, 0..) |resolution, pkg_id| {
        if (resolution.tag != .workspace and resolution.tag != .root) continue;
        try workspace_pkg_ids.append(allocator, @intCast(pkg_id));
    }

    return workspace_pkg_ids.toOwnedSlice(allocator);
}

pub fn findMatchingWorkspaces(
    allocator: std.mem.Allocator,
    original_cwd: string,
    manager: *PackageManager,
    filters: []const string,
) OOM![]const PackageID {
    const lockfile = manager.lockfile;

    if (lockfile.packages.len == 0) {
        return try allocator.alloc(PackageID, 0);
    }

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
        const buf = try allocator.alloc(PackageManager.WorkspaceFilter, filters.len);
        for (filters, buf) |filter, *converted| {
            converted.* = try PackageManager.WorkspaceFilter.init(allocator, filter, original_cwd, &path_buf);
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

                        if (!glob.match(pattern, strings.withoutTrailingSlash(abs_res_path)).matches()) {
                            break :matched false;
                        }
                    },
                    .name => |pattern| {
                        const name = pkg_names[workspace_pkg_id].slice(string_buf);

                        if (!glob.match(pattern, name).matches()) {
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

    return workspace_pkg_ids.toOwnedSlice(allocator);
}

pub fn buildWorkspacePackageJsonPath(
    root_dir: []const u8,
    workspace_path: []const u8,
    path_buf: *bun.PathBuffer,
) struct { path: []const u8, path_z: [:0]const u8 } {
    const package_json_path = if (workspace_path.len > 0)
        bun.path.joinAbsStringBuf(
            root_dir,
            path_buf,
            &[_]string{ workspace_path, "package.json" },
            .auto,
        )
    else
        bun.path.joinAbsStringBuf(
            root_dir,
            path_buf,
            &[_]string{"package.json"},
            .auto,
        );

    path_buf[package_json_path.len] = 0;
    const package_json_path_z = path_buf[0..package_json_path.len :0];

    return .{
        .path = package_json_path,
        .path_z = package_json_path_z,
    };
}

const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const glob = bun.glob;
const path = bun.path;

const OOM = bun.OOM;
const PackageID = bun.install.PackageID;
const PackageManager = bun.install.PackageManager;
const FileSystem = bun.fs.FileSystem;

const string = []const u8;
