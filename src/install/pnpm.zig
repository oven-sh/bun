/// returns { peersIndex, patchHashIndex }
/// https://github.com/pnpm/pnpm/blob/102d5a01ddabda1184b88119adccfbe956d30579/packages/dependency-path/src/index.ts#L9-L31
fn indexOfDepPathSuffix(path: []const u8) struct { ?usize, ?usize } {
    if (path.len < 2) {
        return .{ null, null };
    }

    if (path[path.len - 1] != ')') {
        return .{ null, null };
    }

    var open: i64 = 1;
    var i = path.len - 1;
    while (i > 0) {
        i -= 1;

        if (path[i] == '(') {
            open -= 1;
        } else if (path[i] == ')') {
            open += 1;
        } else if (open == 0) {
            if (strings.startsWith(path[i + 1 ..], "(patch_hash=")) {
                const peers_idx = if (strings.indexOfChar(path[i + 2 ..], '(')) |idx|
                    idx + i + 2
                else
                    null;

                return .{ peers_idx, i + 1 };
            }
            return .{ i + 1, null };
        }
    }
    return .{ null, null };
}

/// name@version(hash) -> name@version
/// version(hash) -> version
/// https://github.com/pnpm/pnpm/blob/102d5a01ddabda1184b88119adccfbe956d30579/packages/dependency-path/src/index.ts#L52-L61
fn removeSuffix(path: []const u8) []const u8 {
    const peers_idx, const patch_hash_idx = indexOfDepPathSuffix(path);

    if (patch_hash_idx orelse peers_idx) |idx| {
        return path[0..idx];
    }

    return path;
}

const MigratePnpmLockfileError = OOM || error{
    PnpmLockfileTooOld,
    PnpmLockfileVersionInvalid,
    InvalidPnpmLockfile,
    YamlParseError,
    NonExistentWorkspaceDependency,
    RelativeLinkDependency,
    WorkspaceNameMissing,
    DependencyLoop,
    PnpmLockfileNotObject,
    PnpmLockfileMissingVersion,
    PnpmLockfileMissingImporters,
    PnpmLockfileInvalidImporter,
    PnpmLockfileMissingRootPackage,
    PnpmLockfileInvalidSnapshot,
    PnpmLockfileInvalidPackage,
    PnpmLockfileMissingDependencyVersion,
    PnpmLockfileInvalidDependency,
    PnpmLockfileInvalidOverride,
    PnpmLockfileInvalidPatchedDependency,
    PnpmLockfileMissingCatalogEntry,
    PnpmLockfileUnresolvableDependency,
};

pub fn migratePnpmLockfile(
    lockfile: *Lockfile,
    manager: *PackageManager,
    allocator: std.mem.Allocator,
    log: *logger.Log,
    data: []const u8,
    dir: bun.FD,
) MigratePnpmLockfileError!LoadResult {
    var buf: std.array_list.Managed(u8) = .init(allocator);
    defer buf.deinit();

    lockfile.initEmpty(allocator);
    bun.install.initializeStore();
    bun.analytics.Features.pnpm_migration += 1;

    var yaml_arena = bun.ArenaAllocator.init(allocator);
    defer yaml_arena.deinit();

    const yaml_source = &logger.Source.initPathString("pnpm-lock.yaml", data);
    const _root = YAML.parse(yaml_source, log, yaml_arena.allocator()) catch {
        return error.YamlParseError;
    };

    const root = try _root.deepClone(allocator);

    if (root.data != .e_object) {
        try log.addErrorFmt(null, logger.Loc.Empty, allocator, "pnpm-lock.yaml root must be an object, got {s}", .{@tagName(root.data)});
        return error.PnpmLockfileNotObject;
    }

    const lockfile_version_expr = root.get("lockfileVersion") orelse {
        try log.addError(null, logger.Loc.Empty, "pnpm-lock.yaml missing 'lockfileVersion' field");
        return error.PnpmLockfileMissingVersion;
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

                    const end = strings.indexOfChar(str, '.') orelse str.len;
                    break :lockfile_version std.fmt.parseFloat(f64, str[0..end]) catch break :err;
                },
                else => {},
            }
        }

        try log.addErrorFmt(null, logger.Loc.Empty, allocator, "pnpm-lock.yaml 'lockfileVersion' must be a number or string, got {s}", .{@tagName(lockfile_version_expr.data)});
        return error.PnpmLockfileVersionInvalid;
    };

    if (lockfile_version_num < 7) {
        return error.PnpmLockfileTooOld;
    }

    var found_patches: bun.StringArrayHashMap([]const u8) = .init(allocator);
    defer found_patches.deinit();

    const pkg_map, const importer_dep_res_versions, const workspace_pkgs_off, const workspace_pkgs_end = build: {
        var string_buf = lockfile.stringBuf();

        if (root.getObject("catalogs")) |catalogs_expr| {
            try Lockfile.CatalogMap.fromPnpmLockfile(lockfile, allocator, log, catalogs_expr.data.e_object, &string_buf);
        }

        if (root.getObject("overrides")) |overrides_expr| {
            for (overrides_expr.data.e_object.properties.slice()) |prop| {
                const key = prop.key.?;
                const value = prop.value.?;

                const name_str = key.asString(allocator) orelse {
                    return invalidPnpmLockfile();
                };
                const name_hash = String.Builder.stringHash(name_str);
                const name = try string_buf.appendWithHash(name_str, name_hash);

                if (!value.isString()) {
                    // TODO:
                    return invalidPnpmLockfile();
                }

                const version_str = value.asString(allocator).?;
                const version_hash = String.Builder.stringHash(version_str);
                const version = try string_buf.appendWithHash(version_str, version_hash);
                const version_sliced = version.sliced(string_buf.bytes.items);

                const dep: Dependency = .{
                    .name = name,
                    .name_hash = name_hash,
                    .version = Dependency.parse(
                        allocator,
                        name,
                        name_hash,
                        version_sliced.slice,
                        &version_sliced,
                        log,
                        manager,
                    ) orelse {
                        return invalidPnpmLockfile();
                    },
                };

                try lockfile.overrides.map.put(allocator, name_hash, dep);
            }
        }

        const Patch = struct {
            path: String,
            dep_name: []const u8,
        };
        var patches: bun.StringArrayHashMap(Patch) = .init(allocator);
        defer patches.deinit();
        var patch_join_buf: std.array_list.Managed(u8) = .init(allocator);
        defer patch_join_buf.deinit();

        if (root.getObject("patchedDependencies")) |patched_dependencies_expr| {
            for (patched_dependencies_expr.data.e_object.properties.slice()) |prop| {
                const dep_name_expr = prop.key.?;
                const value = prop.value.?;

                const dep_name_str = dep_name_expr.asString(allocator) orelse {
                    return invalidPnpmLockfile();
                };

                const path_str, _ = try value.getString(allocator, "path") orelse {
                    return invalidPnpmLockfile();
                };

                const hash_str, _ = try value.getString(allocator, "hash") orelse {
                    return invalidPnpmLockfile();
                };

                const entry = try patches.getOrPut(hash_str);
                if (entry.found_existing) {
                    return invalidPnpmLockfile();
                }
                entry.value_ptr.* = .{
                    .path = try string_buf.append(path_str),
                    .dep_name = dep_name_str,
                };
            }
        }

        const importers_obj = root.getObject("importers") orelse {
            try log.addError(null, logger.Loc.Empty, "pnpm-lock.yaml missing 'importers' field");
            return error.PnpmLockfileMissingImporters;
        };

        var has_root_pkg_expr: ?Expr = null;

        for (importers_obj.data.e_object.properties.slice()) |prop| {
            const importer_path = prop.key.?.asString(allocator) orelse {
                return invalidPnpmLockfile();
            };
            const value = prop.value.?;

            if (strings.eqlComptime(importer_path, ".")) {
                if (has_root_pkg_expr != null) {
                    return invalidPnpmLockfile();
                }
                has_root_pkg_expr = value;
                continue;
            }

            var pkg_json_path: bun.AutoAbsPath = .initTopLevelDir();
            defer pkg_json_path.deinit();

            pkg_json_path.append(importer_path);
            pkg_json_path.append("package.json");

            const importer_pkg_json = manager.workspace_package_json_cache.getWithPath(allocator, log, pkg_json_path.slice(), .{}).unwrap() catch {
                return invalidPnpmLockfile();
            };

            const workspace_root = importer_pkg_json.root;

            const name, _ = try workspace_root.getString(allocator, "name") orelse {
                // we require workspace names.
                return error.WorkspaceNameMissing;
            };

            const name_hash = String.Builder.stringHash(name);

            try lockfile.workspace_paths.put(allocator, name_hash, try string_buf.append(importer_path));

            if (value.get("version")) |version_expr| {
                const version_str = try string_buf.append(version_expr.asString(allocator) orelse {
                    return invalidPnpmLockfile();
                });

                const parsed = Semver.Version.parse(version_str.sliced(string_buf.bytes.items));
                if (!parsed.valid) {
                    return invalidPnpmLockfile();
                }

                try lockfile.workspace_versions.put(allocator, name_hash, parsed.version.min());
            }
        }

        const root_pkg_expr = has_root_pkg_expr orelse {
            try log.addError(null, logger.Loc.Empty, "pnpm-lock.yaml missing root package entry (importers['.'])");
            return error.PnpmLockfileMissingRootPackage;
        };

        var importer_dep_res_versions: bun.StringArrayHashMap(bun.StringArrayHashMap([]const u8)) = .init(allocator);

        {
            var pkg_json_path: bun.AutoAbsPath = .initTopLevelDir();
            defer pkg_json_path.deinit();

            pkg_json_path.append("package.json");

            const pkg_json = manager.workspace_package_json_cache.getWithPath(allocator, log, pkg_json_path.slice(), .{}).unwrap() catch {
                return invalidPnpmLockfile();
            };

            var root_pkg: Lockfile.Package = .{};

            if (try pkg_json.root.getString(allocator, "name")) |name_info| {
                const name, _ = name_info;
                const name_hash = String.Builder.stringHash(name);
                root_pkg.name = try string_buf.appendWithHash(name, name_hash);
                root_pkg.name_hash = name_hash;
            }

            const importer_versions = try importer_dep_res_versions.getOrPut(".");
            importer_versions.value_ptr.* = .init(allocator);

            const off, const len = try parseAppendImporterDependencies(
                lockfile,
                manager,
                allocator,
                &root_pkg_expr,
                &string_buf,
                log,
                true,
                &importers_obj,
                importer_versions.value_ptr,
            );

            root_pkg.dependencies = .{ .off = off, .len = len };
            root_pkg.resolutions = .{ .off = off, .len = len };

            root_pkg.meta.id = 0;
            root_pkg.resolution = .init(.{ .root = {} });
            try lockfile.packages.append(allocator, root_pkg);
            try lockfile.getOrPutID(0, root_pkg.name_hash);
        }

        var pkg_map: bun.StringArrayHashMap(PackageID) = .init(allocator);

        try pkg_map.putNoClobber(bun.fs.FileSystem.instance.top_level_dir, 0);

        const workspace_pkgs_off = lockfile.packages.len;

        workspaces: for (lockfile.workspace_paths.values()) |workspace_path| {
            for (importers_obj.data.e_object.properties.slice()) |prop| {
                const key = prop.key.?;
                const value = prop.value.?;

                const path = key.asString(allocator).?;
                if (!strings.eqlLong(path, workspace_path.slice(string_buf.bytes.items), true)) {
                    continue;
                }

                var pkg: Lockfile.Package = .{};

                pkg.resolution = .{
                    .tag = .workspace,
                    .value = .{ .workspace = try string_buf.append(path) },
                };

                var path_buf: bun.AutoAbsPath = .initTopLevelDir();
                defer path_buf.deinit();

                path_buf.append(path);
                const abs_path = try allocator.dupe(u8, path_buf.slice());
                path_buf.append("package.json");

                const workspace_pkg_json = manager.workspace_package_json_cache.getWithPath(allocator, log, path_buf.slice(), .{}).unwrap() catch {
                    return invalidPnpmLockfile();
                };

                const workspace_root = workspace_pkg_json.root;

                const name = workspace_root.get("name").?.asString(allocator).?;
                const name_hash = String.Builder.stringHash(name);

                pkg.name = try string_buf.appendWithHash(name, name_hash);
                pkg.name_hash = name_hash;

                const importer_versions = try importer_dep_res_versions.getOrPut(path);
                if (importer_versions.found_existing) {
                    return invalidPnpmLockfile();
                }
                importer_versions.value_ptr.* = .init(allocator);

                const off, const len = try parseAppendImporterDependencies(
                    lockfile,
                    manager,
                    allocator,
                    &value,
                    &string_buf,
                    log,
                    false,
                    &importers_obj,
                    importer_versions.value_ptr,
                );

                pkg.dependencies = .{ .off = off, .len = len };
                pkg.resolutions = .{ .off = off, .len = len };

                if (workspace_root.get("bin")) |bin_expr| {
                    pkg.bin = try Bin.parseAppend(allocator, bin_expr, &string_buf, &lockfile.buffers.extern_strings);
                } else if (workspace_root.get("directories")) |directories_expr| {
                    if (directories_expr.get("bin")) |bin_expr| {
                        pkg.bin = try Bin.parseAppendFromDirectories(allocator, bin_expr, &string_buf);
                    }
                }

                const pkg_id = try lockfile.appendPackageDedupe(&pkg, string_buf.bytes.items);

                const entry = try pkg_map.getOrPut(abs_path);
                if (entry.found_existing) {
                    return invalidPnpmLockfile();
                }

                entry.value_ptr.* = pkg_id;

                continue :workspaces;
            }
        }

        const workspace_pkgs_end = lockfile.packages.len;

        // add packages for symlink dependencies. pnpm-lock does not add an entry
        // for these dependencies in packages/snapshots
        for (0..workspace_pkgs_end) |_pkg_id| {
            const pkg_id: PackageID = @intCast(_pkg_id);

            const workspace_path = if (pkg_id == 0) "." else workspace_path: {
                const workspace_res = lockfile.packages.items(.resolution)[pkg_id];
                break :workspace_path workspace_res.value.workspace.slice(string_buf.bytes.items);
            };

            const importer_versions = importer_dep_res_versions.get(workspace_path) orelse {
                return invalidPnpmLockfile();
            };

            const deps = lockfile.packages.items(.dependencies)[pkg_id];
            next_dep: for (deps.begin()..deps.end()) |_dep_id| {
                const dep_id: DependencyID = @intCast(_dep_id);

                const dep = &lockfile.buffers.dependencies.items[dep_id];

                if (dep.behavior.isWorkspace()) {
                    continue;
                }

                switch (dep.version.tag) {
                    .folder, .workspace => {
                        const version_str = importer_versions.get(dep.name.slice(string_buf.bytes.items)) orelse {
                            return invalidPnpmLockfile();
                        };
                        const version_without_suffix = removeSuffix(version_str);

                        if (strings.withoutPrefixIfPossibleComptime(version_without_suffix, "link:")) |link_path| {
                            // create a link package for the workspace dependency only if it doesn't already exist
                            if (dep.version.tag == .workspace) {
                                var link_path_buf: bun.AutoAbsPath = .initTopLevelDir();
                                defer link_path_buf.deinit();
                                link_path_buf.append(workspace_path);
                                link_path_buf.join(&.{link_path});

                                for (lockfile.workspace_paths.values()) |existing_workspace_path| {
                                    var workspace_path_buf: bun.AutoAbsPath = .initTopLevelDir();
                                    defer workspace_path_buf.deinit();
                                    workspace_path_buf.append(existing_workspace_path.slice(string_buf.bytes.items));

                                    if (strings.eqlLong(workspace_path_buf.slice(), link_path_buf.slice(), true)) {
                                        continue :next_dep;
                                    }
                                }

                                return error.NonExistentWorkspaceDependency;
                            }

                            var pkg: Lockfile.Package = .{
                                .name = dep.name,
                                .name_hash = dep.name_hash,
                                .resolution = .init(.{ .symlink = try string_buf.append(link_path) }),
                            };

                            var abs_link_path: bun.AutoAbsPath = .initTopLevelDir();
                            defer abs_link_path.deinit();

                            abs_link_path.join(&.{ workspace_path, link_path });

                            const pkg_entry = try pkg_map.getOrPut(abs_link_path.slice());
                            if (pkg_entry.found_existing) {
                                // they point to the same package
                                continue;
                            }

                            pkg_entry.value_ptr.* = try lockfile.appendPackageDedupe(&pkg, string_buf.bytes.items);
                        }
                    },
                    .symlink => {
                        if (!strings.isNPMPackageName(dep.version.value.symlink.slice(string_buf.bytes.items))) {
                            try log.addWarningFmt(null, .Empty, allocator, "relative link dependency not supported: {s}@{s}\n", .{
                                dep.name.slice(string_buf.bytes.items),
                                dep.version.literal.slice(string_buf.bytes.items),
                            });
                            return error.RelativeLinkDependency;
                        }
                    },
                    else => {},
                }
            }
        }

        const SnapshotEntry = struct {
            obj: Expr,
        };
        var snapshots: bun.StringArrayHashMap(SnapshotEntry) = .init(allocator);
        defer snapshots.deinit();

        if (root.getObject("packages")) |packages_obj| {
            const snapshots_obj = root.getObject("snapshots") orelse {
                try log.addError(null, logger.Loc.Empty, "pnpm-lock.yaml has 'packages' but missing 'snapshots' field");
                return error.PnpmLockfileInvalidSnapshot;
            };

            for (snapshots_obj.data.e_object.properties.slice()) |snapshot_prop| {
                const key = snapshot_prop.key.?;
                const value = snapshot_prop.value.?;

                const key_str = key.asString(allocator) orelse {
                    return invalidPnpmLockfile();
                };

                if (!value.isObject()) {
                    return invalidPnpmLockfile();
                }

                const peer_hash_idx, const patch_hash_idx = indexOfDepPathSuffix(key_str);

                const key_str_without_suffix = if (patch_hash_idx orelse peer_hash_idx) |idx| key_str[0..idx] else key_str;

                if (patch_hash_idx) |idx| try_patch: {
                    const patch_hash_str = key_str[idx + "(patch_hash=".len ..];
                    const end_idx = strings.indexOfChar(patch_hash_str, ')') orelse {
                        return invalidPnpmLockfile();
                    };
                    const patch = patches.fetchSwapRemove(patch_hash_str[0..end_idx]) orelse {
                        break :try_patch;
                    };

                    _, const res_str = Dependency.splitNameAndVersion(key_str_without_suffix) catch {
                        return invalidPnpmLockfile();
                    };

                    try found_patches.put(patch.value.dep_name, res_str);

                    patch_join_buf.clearRetainingCapacity();
                    try patch_join_buf.writer().print("{s}@{s}", .{
                        patch.value.dep_name,
                        res_str,
                    });

                    const patch_hash = String.Builder.stringHash(patch_join_buf.items);
                    try lockfile.patched_dependencies.put(allocator, patch_hash, .{ .path = patch.value.path });
                }

                const entry = try snapshots.getOrPut(key_str_without_suffix);
                if (entry.found_existing) {
                    continue;
                }

                entry.value_ptr.* = .{ .obj = value };
            }

            for (packages_obj.data.e_object.properties.slice()) |packages_prop| {
                const key = packages_prop.key.?;
                const package_obj = packages_prop.value.?;

                const key_str = key.asString(allocator) orelse {
                    return invalidPnpmLockfile();
                };

                if (!package_obj.isObject()) {
                    return invalidPnpmLockfile();
                }

                const snapshot = snapshots.get(key_str) orelse {
                    try log.addErrorFmt(null, logger.Loc.Empty, allocator, "pnpm-lock.yaml package '{s}' missing corresponding snapshot entry", .{key_str});
                    return error.PnpmLockfileInvalidSnapshot;
                };

                const name_str, const res_str = Dependency.splitNameAndVersion(key_str) catch {
                    return invalidPnpmLockfile();
                };

                const name_hash = String.Builder.stringHash(name_str);
                const name = try string_buf.appendWithHash(name_str, name_hash);

                var res = try Resolution.fromPnpmLockfile(res_str, &string_buf);

                if (res.tag == .npm) {
                    const scope = manager.scopeForPackageName(name_str);
                    const url = try ExtractTarball.buildURL(
                        scope.url.href,
                        strings.StringOrTinyString.init(name.slice(string_buf.bytes.items)),
                        res.value.npm.version,
                        string_buf.bytes.items,
                    );
                    res.value.npm.url = try string_buf.append(url);
                }

                var pkg: Lockfile.Package = .{
                    .name = name,
                    .name_hash = name_hash,
                };

                if (package_obj.get("resolution")) |res_expr| {
                    if (!res_expr.isObject()) {
                        return invalidPnpmLockfile();
                    }

                    if (res_expr.get("integrity")) |integrity_expr| {
                        const integrity_str = integrity_expr.asString(allocator) orelse {
                            return invalidPnpmLockfile();
                        };

                        pkg.meta.integrity = Integrity.parse(integrity_str);
                    }
                }

                if (package_obj.get("os")) |os_expr| {
                    pkg.meta.os = try Negatable(Npm.OperatingSystem).fromJson(allocator, os_expr);
                }
                if (package_obj.get("cpu")) |cpu_expr| {
                    pkg.meta.arch = try Negatable(Npm.Architecture).fromJson(allocator, cpu_expr);
                }
                // TODO: libc
                // if (package_obj.get("libc")) |libc_expr| {
                //     pkg.meta.libc = try Negatable(Npm.Libc).fromJson(allocator, libc_expr);
                // }

                const off, const len = try parseAppendPackageDependencies(
                    lockfile,
                    allocator,
                    &package_obj,
                    &snapshot.obj,
                    &string_buf,
                    log,
                );

                pkg.dependencies = .{ .off = off, .len = len };
                pkg.resolutions = .{ .off = off, .len = len };
                pkg.resolution = res.copy();

                const pkg_id = try lockfile.appendPackageDedupe(&pkg, string_buf.bytes.items);

                const entry = try pkg_map.getOrPut(key_str);
                if (entry.found_existing) {
                    return invalidPnpmLockfile();
                }

                entry.value_ptr.* = pkg_id;
            }
        }

        break :build .{
            pkg_map,
            importer_dep_res_versions,
            workspace_pkgs_off,
            workspace_pkgs_end,
        };
    };

    const string_buf = lockfile.buffers.string_bytes.items;

    var res_buf: std.array_list.Managed(u8) = .init(allocator);
    defer res_buf.deinit();

    try lockfile.buffers.resolutions.ensureTotalCapacityPrecise(allocator, lockfile.buffers.dependencies.items.len);
    lockfile.buffers.resolutions.expandToCapacity();
    @memset(lockfile.buffers.resolutions.items, invalid_package_id);

    const pkgs = lockfile.packages.slice();
    const pkg_deps = pkgs.items(.dependencies);
    const pkg_names = pkgs.items(.name);
    _ = pkg_names;
    const pkg_resolutions = pkgs.items(.resolution);

    {
        const importer_versions = importer_dep_res_versions.get(".") orelse {
            return invalidPnpmLockfile();
        };

        // resolve root dependencies first
        for (pkg_deps[0].begin()..pkg_deps[0].end()) |_dep_id| {
            const dep_id: DependencyID = @intCast(_dep_id);
            const dep = &lockfile.buffers.dependencies.items[dep_id];

            // implicit workspace dependencies
            if (dep.behavior.isWorkspace()) {
                const workspace_path = dep.version.value.workspace.slice(string_buf);
                var path_buf: bun.AutoAbsPath = .initTopLevelDir();
                defer path_buf.deinit();
                path_buf.join(&.{workspace_path});
                if (pkg_map.get(path_buf.slice())) |workspace_pkg_id| {
                    lockfile.buffers.resolutions.items[dep_id] = workspace_pkg_id;
                    continue;
                }
            }

            const dep_name = dep.name.slice(string_buf);
            var version_maybe_alias = importer_versions.get(dep_name) orelse {
                try log.addErrorFmt(null, logger.Loc.Empty, allocator, "pnpm-lock.yaml cannot resolve root dependency '{s}' - missing version in importer", .{dep_name});
                return error.PnpmLockfileUnresolvableDependency;
            };
            if (strings.hasPrefixComptime(version_maybe_alias, "npm:")) {
                version_maybe_alias = version_maybe_alias["npm:".len..];
            }
            const version, const has_alias = Dependency.splitVersionAndMaybeName(version_maybe_alias);
            const version_without_suffix = removeSuffix(version);

            if (strings.withoutPrefixIfPossibleComptime(version_without_suffix, "link:")) |maybe_symlink_or_folder_or_workspace_path| {
                var path_buf: bun.AutoAbsPath = .initTopLevelDir();
                defer path_buf.deinit();
                path_buf.join(&.{maybe_symlink_or_folder_or_workspace_path});
                if (pkg_map.get(path_buf.slice())) |pkg_id| {
                    lockfile.buffers.resolutions.items[dep_id] = pkg_id;
                    continue;
                }
            }

            res_buf.clearRetainingCapacity();
            try res_buf.writer().print("{s}@{s}", .{
                if (has_alias) |alias| alias else dep_name,
                version_without_suffix,
            });

            const pkg_id = pkg_map.get(res_buf.items) orelse {
                return invalidPnpmLockfile();
            };

            lockfile.buffers.resolutions.items[dep_id] = pkg_id;
        }
    }

    for (workspace_pkgs_off..workspace_pkgs_end) |_pkg_id| {
        const pkg_id: PackageID = @intCast(_pkg_id);

        const workspace_res = pkg_resolutions[pkg_id];
        const workspace_path = workspace_res.value.workspace.slice(string_buf);

        const importer_versions = importer_dep_res_versions.get(workspace_path) orelse {
            return invalidPnpmLockfile();
        };

        const deps = pkg_deps[pkg_id];
        for (deps.begin()..deps.end()) |_dep_id| {
            const dep_id: DependencyID = @intCast(_dep_id);
            const dep = &lockfile.buffers.dependencies.items[dep_id];
            const dep_name = dep.name.slice(string_buf);
            var version_maybe_alias = importer_versions.get(dep_name) orelse {
                try log.addErrorFmt(null, logger.Loc.Empty, allocator, "pnpm-lock.yaml cannot resolve workspace dependency '{s}' in '{s}' - missing version", .{ dep_name, workspace_path });
                return error.PnpmLockfileUnresolvableDependency;
            };
            if (strings.hasPrefixComptime(version_maybe_alias, "npm:")) {
                version_maybe_alias = version_maybe_alias["npm:".len..];
            }
            const version, const has_alias = Dependency.splitVersionAndMaybeName(version_maybe_alias);
            const version_without_suffix = removeSuffix(version);

            if (strings.withoutPrefixIfPossibleComptime(version_without_suffix, "link:")) |maybe_symlink_or_folder_or_workspace_path| {
                var path_buf: bun.AutoAbsPath = .initTopLevelDir();
                defer path_buf.deinit();
                path_buf.join(&.{ workspace_path, maybe_symlink_or_folder_or_workspace_path });
                if (pkg_map.get(path_buf.slice())) |link_pkg_id| {
                    lockfile.buffers.resolutions.items[dep_id] = link_pkg_id;
                    continue;
                }
            }

            res_buf.clearRetainingCapacity();
            try res_buf.writer().print("{s}@{s}", .{
                if (has_alias) |alias| alias else dep_name,
                version_without_suffix,
            });

            const res_pkg_id = pkg_map.get(res_buf.items) orelse {
                return invalidPnpmLockfile();
            };

            lockfile.buffers.resolutions.items[dep_id] = res_pkg_id;
        }
    }

    for (workspace_pkgs_end..lockfile.packages.len) |_pkg_id| {
        const pkg_id: PackageID = @intCast(_pkg_id);

        const deps = pkg_deps[pkg_id];
        for (deps.begin()..deps.end()) |_dep_id| {
            const dep_id: DependencyID = @intCast(_dep_id);
            const dep = &lockfile.buffers.dependencies.items[dep_id];
            var version_maybe_alias = dep.version.literal.slice(string_buf);
            if (strings.hasPrefixComptime(version_maybe_alias, "npm:")) {
                version_maybe_alias = version_maybe_alias["npm:".len..];
            }
            const version, const has_alias = Dependency.splitVersionAndMaybeName(version_maybe_alias);
            const version_without_suffix = removeSuffix(version);

            switch (dep.version.tag) {
                .folder, .symlink, .workspace => {
                    const maybe_symlink_or_folder_or_workspace_path = strings.withoutPrefixComptime(version_without_suffix, "link:");
                    var path_buf: bun.AutoAbsPath = .initTopLevelDir();
                    defer path_buf.deinit();
                    path_buf.join(&.{maybe_symlink_or_folder_or_workspace_path});
                    if (pkg_map.get(path_buf.slice())) |link_pkg_id| {
                        lockfile.buffers.resolutions.items[dep_id] = link_pkg_id;
                        continue;
                    }
                },
                else => {},
            }

            res_buf.clearRetainingCapacity();
            try res_buf.writer().print("{s}@{s}", .{
                if (has_alias) |alias| alias else dep.name.slice(string_buf),
                version_without_suffix,
            });

            const res_pkg_id = pkg_map.get(res_buf.items) orelse {
                return invalidPnpmLockfile();
            };

            lockfile.buffers.resolutions.items[dep_id] = res_pkg_id;
        }
    }

    try lockfile.resolve(log);

    try lockfile.fetchNecessaryPackageMetadataAfterYarnOrPnpmMigration(manager, false);

    try updatePackageJsonAfterMigration(allocator, manager, log, dir, found_patches);

    return .{
        .ok = .{
            .lockfile = lockfile,
            .loaded_from_binary_lockfile = false,
            .migrated = .pnpm,
            .serializer_result = .{},
            .format = .text,
        },
    };
}

fn invalidPnpmLockfile() error{InvalidPnpmLockfile} {
    return error.InvalidPnpmLockfile;
}

const ParseAppendDependenciesError = OOM || error{
    InvalidPnpmLockfile,
    PnpmLockfileInvalidDependency,
    PnpmLockfileMissingDependencyVersion,
    PnpmLockfileMissingCatalogEntry,
};

fn parseAppendPackageDependencies(
    lockfile: *Lockfile,
    allocator: std.mem.Allocator,
    package_obj: *const Expr,
    snapshot_obj: *const Expr,
    string_buf: *String.Buf,
    log: *logger.Log,
) ParseAppendDependenciesError!struct { u32, u32 } {
    var version_buf: std.array_list.Managed(u8) = .init(allocator);
    defer version_buf.deinit();

    const off = lockfile.buffers.dependencies.items.len;

    const snapshot_dependency_groups = [2]struct { []const u8, Dependency.Behavior }{
        .{ "devDependencies", .{ .dev = true } },
        .{ "optionalDependencies", .{ .optional = true } },
    };

    inline for (snapshot_dependency_groups) |dependency_group| {
        const group_name, const group_behavior = dependency_group;
        if (snapshot_obj.get(group_name)) |deps| {
            if (!deps.isObject()) {
                return invalidPnpmLockfile();
            }

            for (deps.data.e_object.properties.slice()) |prop| {
                const key = prop.key.?;
                const value = prop.value.?;

                const name_str = key.asString(allocator) orelse {
                    return invalidPnpmLockfile();
                };

                const name_hash = String.Builder.stringHash(name_str);
                const name = try string_buf.appendExternalWithHash(name_str, name_hash);

                const version_str = value.asString(allocator) orelse {
                    return invalidPnpmLockfile();
                };

                const version_without_suffix = removeSuffix(version_str);

                const version = try string_buf.append(version_without_suffix);
                const version_sliced = version.sliced(string_buf.bytes.items);

                const behavior: Dependency.Behavior = group_behavior;

                const dep: Dependency = .{
                    .name = name.value,
                    .name_hash = name_hash,
                    .behavior = behavior,
                    .version = Dependency.parse(
                        allocator,
                        name.value,
                        name.hash,
                        version_sliced.slice,
                        &version_sliced,
                        log,
                        null,
                    ) orelse {
                        return invalidPnpmLockfile();
                    },
                };

                try lockfile.buffers.dependencies.append(allocator, dep);
            }
        }
    }

    if (snapshot_obj.get("dependencies")) |deps| {
        if (!deps.isObject()) {
            return invalidPnpmLockfile();
        }

        // for each dependency first look it up in peerDependencies in package_obj
        next_prod_dep: for (deps.data.e_object.properties.slice()) |prop| {
            const key = prop.key.?;
            const value = prop.value.?;

            const name_str = key.asString(allocator) orelse {
                return invalidPnpmLockfile();
            };

            const name_hash = String.Builder.stringHash(name_str);
            const name = try string_buf.appendExternalWithHash(name_str, name_hash);

            const version_str = value.asString(allocator) orelse {
                return invalidPnpmLockfile();
            };

            const version_without_suffix = removeSuffix(version_str);

            // pnpm-lock.yaml does not prefix aliases with npm: in snapshots
            _, const has_alias = Dependency.splitVersionAndMaybeName(version_without_suffix);

            var alias: ?ExternalString = null;
            const version_sliced = version: {
                if (has_alias) |alias_str| {
                    alias = try string_buf.appendExternal(alias_str);
                    version_buf.clearRetainingCapacity();
                    try version_buf.writer().print("npm:{s}", .{version_without_suffix});
                    const version = try string_buf.append(version_buf.items);
                    const version_sliced = version.sliced(string_buf.bytes.items);
                    break :version version_sliced;
                }

                const version = try string_buf.append(version_without_suffix);
                const version_sliced = version.sliced(string_buf.bytes.items);
                break :version version_sliced;
            };

            if (package_obj.get("peerDependencies")) |peers| {
                if (!peers.isObject()) {
                    return invalidPnpmLockfile();
                }

                for (peers.data.e_object.properties.slice()) |peer_prop| {
                    const peer_name_str = peer_prop.key.?.asString(allocator) orelse {
                        return invalidPnpmLockfile();
                    };

                    // const peer_version_str = peer_prop.value.?.asString(allocator) orelse {
                    //     return invalidPnpmLockfile();
                    // };

                    // const peer_version_without_suffix = removeSuffix(peer_version_str);

                    // const peer_version = try string_buf.append(peer_version_without_suffix);
                    // const peer_version_sliced = peer_version.sliced(string_buf.bytes.items);

                    var behavior: Dependency.Behavior = .{ .peer = true };

                    if (strings.eqlLong(name_str, peer_name_str, true)) {
                        if (package_obj.get("peerDependenciesMeta")) |peers_meta| {
                            if (!peers_meta.isObject()) {
                                return invalidPnpmLockfile();
                            }

                            for (peers_meta.data.e_object.properties.slice()) |peer_meta_prop| {
                                const peer_meta_name_str = peer_meta_prop.key.?.asString(allocator) orelse {
                                    return invalidPnpmLockfile();
                                };

                                if (strings.eqlLong(name_str, peer_meta_name_str, true)) {
                                    const meta_obj = peer_meta_prop.value.?;
                                    if (!meta_obj.isObject()) {
                                        return invalidPnpmLockfile();
                                    }

                                    behavior.optional = meta_obj.getBoolean("optional") orelse false;
                                    break;
                                }
                            }
                        }
                        const dep: Dependency = .{
                            .name = name.value,
                            .name_hash = name.hash,
                            .behavior = behavior,
                            .version = Dependency.parse(
                                allocator,
                                if (alias) |a| a.value else name.value,
                                if (alias) |a| a.hash else name.hash,
                                version_sliced.slice,
                                &version_sliced,
                                log,
                                null,
                            ) orelse {
                                return invalidPnpmLockfile();
                            },
                        };

                        try lockfile.buffers.dependencies.append(allocator, dep);
                        continue :next_prod_dep;
                    }
                }
            }

            const dep: Dependency = .{
                .name = name.value,
                .name_hash = name.hash,
                .behavior = .{ .prod = true },
                .version = Dependency.parse(
                    allocator,
                    if (alias) |a| a.value else name.value,
                    if (alias) |a| a.hash else name.hash,
                    version_sliced.slice,
                    &version_sliced,
                    log,
                    null,
                ) orelse {
                    return invalidPnpmLockfile();
                },
            };

            try lockfile.buffers.dependencies.append(allocator, dep);
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

fn parseAppendImporterDependencies(
    lockfile: *Lockfile,
    manager: *PackageManager,
    allocator: std.mem.Allocator,
    pkg_expr: *const Expr,
    string_buf: *String.Buf,
    log: *logger.Log,
    is_root: bool,
    importers_obj: *const Expr,
    importer_versions: *bun.StringArrayHashMap([]const u8),
) ParseAppendDependenciesError!struct { u32, u32 } {
    const importer_dependency_groups = [3]struct { []const u8, Dependency.Behavior }{
        .{ "dependencies", .{ .prod = true } },
        .{ "devDependencies", .{ .dev = true } },
        .{ "optionalDependencies", .{ .optional = true } },
    };

    const off = lockfile.buffers.dependencies.items.len;

    inline for (importer_dependency_groups) |dependency_group| {
        const group_name, const group_behavior = dependency_group;
        if (pkg_expr.get(group_name)) |deps| {
            if (!deps.isObject()) {
                return invalidPnpmLockfile();
            }

            for (deps.data.e_object.properties.slice()) |prop| {
                const key = prop.key.?;
                const value = prop.value.?;

                const name_str = key.asString(allocator) orelse {
                    return invalidPnpmLockfile();
                };

                const name_hash = String.Builder.stringHash(name_str);
                const name = try string_buf.appendExternalWithHash(name_str, name_hash);

                const specifier_expr = value.get("specifier") orelse {
                    try log.addErrorFmt(null, logger.Loc.Empty, allocator, "pnpm-lock.yaml dependency '{s}' missing 'specifier' field", .{name_str});
                    return error.PnpmLockfileInvalidDependency;
                };

                const version_expr = value.get("version") orelse {
                    try log.addErrorFmt(null, logger.Loc.Empty, allocator, "pnpm-lock.yaml dependency '{s}' missing 'version' field", .{name_str});
                    return error.PnpmLockfileMissingDependencyVersion;
                };

                const version_str = try version_expr.asStringCloned(allocator) orelse {
                    return invalidPnpmLockfile();
                };

                const entry = try importer_versions.getOrPut(name_str);
                if (entry.found_existing) {
                    continue;
                }
                entry.value_ptr.* = removeSuffix(version_str);

                const specifier_str = specifier_expr.asString(allocator) orelse {
                    return invalidPnpmLockfile();
                };

                if (strings.hasPrefixComptime(specifier_str, "catalog:")) {
                    const catalog_group_name_str = specifier_str["catalog:".len..];
                    const catalog_group_name = try string_buf.append(catalog_group_name_str);
                    var dep = lockfile.catalogs.get(lockfile, catalog_group_name, name.value) orelse {
                        // catalog is missing an entry in the "catalogs" object in the lockfile
                        try log.addErrorFmt(null, logger.Loc.Empty, allocator, "pnpm-lock.yaml catalog '{s}' missing entry for dependency '{s}'", .{ catalog_group_name_str, name_str });
                        return error.PnpmLockfileMissingCatalogEntry;
                    };

                    dep.behavior = group_behavior;

                    try lockfile.buffers.dependencies.append(allocator, dep);
                    continue;
                }

                const specifier = try string_buf.append(specifier_str);
                const specifier_sliced = specifier.sliced(string_buf.bytes.items);

                const behavior: Dependency.Behavior = group_behavior;

                // TODO: find peerDependencies from package.json
                if (comptime group_behavior.prod) {
                    //
                }

                const dep: Dependency = .{
                    .name = name.value,
                    .name_hash = name.hash,
                    .behavior = behavior,
                    .version = Dependency.parse(
                        allocator,
                        name.value,
                        name.hash,
                        specifier_sliced.slice,
                        &specifier_sliced,
                        log,
                        null,
                    ) orelse {
                        return invalidPnpmLockfile();
                    },
                };

                try lockfile.buffers.dependencies.append(allocator, dep);
            }
        }
    }

    if (is_root) {
        workspaces: for (lockfile.workspace_paths.values()) |workspace_path| {
            for (importers_obj.data.e_object.properties.slice()) |prop| {
                const key = prop.key.?;
                const path = key.asString(allocator).?;
                if (!strings.eqlLong(path, workspace_path.slice(string_buf.bytes.items), true)) {
                    continue;
                }

                var path_buf: bun.AutoAbsPath = .initTopLevelDir();
                defer path_buf.deinit();

                path_buf.append(path);
                path_buf.append("package.json");

                const workspace_pkg_json = manager.workspace_package_json_cache.getWithPath(allocator, log, path_buf.slice(), .{}).unwrap() catch {
                    return invalidPnpmLockfile();
                };

                const name, _ = try workspace_pkg_json.root.getString(allocator, "name") orelse {
                    return invalidPnpmLockfile();
                };

                const name_hash = String.Builder.stringHash(name);
                const dep: Dependency = .{
                    .name = try string_buf.appendWithHash(name, name_hash),
                    .name_hash = name_hash,
                    .behavior = .{ .workspace = true },
                    .version = .{
                        .tag = .workspace,
                        .value = .{ .workspace = try string_buf.append(path) },
                    },
                };

                try lockfile.buffers.dependencies.append(allocator, dep);
                continue :workspaces;
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

/// Updates package.json with workspace and catalog information after migration
fn updatePackageJsonAfterMigration(allocator: Allocator, manager: *PackageManager, log: *logger.Log, dir: bun.FD, patches: bun.StringArrayHashMap([]const u8)) OOM!void {
    var pkg_json_path: bun.AbsPath(.{}) = .initTopLevelDir();
    defer pkg_json_path.deinit();

    pkg_json_path.append("package.json");

    const root_pkg_json = manager.workspace_package_json_cache.getWithPath(
        manager.allocator,
        log,
        pkg_json_path.slice(),
        .{
            .guess_indentation = true,
        },
    ).unwrap() catch {
        return;
    };

    var json = root_pkg_json.root;
    if (json.data != .e_object) return;

    var needs_update = false;
    var moved_overrides = false;
    var moved_patched_deps = false;

    if (json.asProperty("pnpm")) |pnpm_prop| {
        if (pnpm_prop.expr.data == .e_object) {
            const pnpm_obj = pnpm_prop.expr.data.e_object;

            if (pnpm_obj.get("overrides")) |overrides_field| {
                if (overrides_field.data == .e_object) {
                    if (json.asProperty("overrides")) |existing_prop| {
                        if (existing_prop.expr.data == .e_object) {
                            const existing_overrides = existing_prop.expr.data.e_object;
                            for (overrides_field.data.e_object.properties.slice()) |prop| {
                                const key = prop.key.?.asString(allocator) orelse continue;
                                try existing_overrides.put(allocator, key, prop.value.?);
                            }
                        }
                    } else {
                        try json.data.e_object.put(allocator, "overrides", overrides_field);
                    }
                    moved_overrides = true;
                    needs_update = true;
                }
            }

            if (pnpm_obj.get("patchedDependencies")) |patched_field| {
                if (patched_field.data == .e_object) {
                    if (json.asProperty("patchedDependencies")) |existing_prop| {
                        if (existing_prop.expr.data == .e_object) {
                            const existing_patches = existing_prop.expr.data.e_object;
                            for (patched_field.data.e_object.properties.slice()) |prop| {
                                const key = prop.key.?.asString(allocator) orelse continue;
                                try existing_patches.put(allocator, key, prop.value.?);
                            }
                        }
                    } else {
                        try json.data.e_object.put(allocator, "patchedDependencies", patched_field);
                    }
                    moved_patched_deps = true;
                    needs_update = true;
                }
            }

            if (moved_overrides or moved_patched_deps) {
                var remaining_count: usize = 0;
                for (pnpm_obj.properties.slice()) |prop| {
                    const key = prop.key.?.asString(allocator) orelse {
                        remaining_count += 1;
                        continue;
                    };
                    if (moved_overrides and strings.eqlComptime(key, "overrides")) continue;
                    if (moved_patched_deps and strings.eqlComptime(key, "patchedDependencies")) continue;
                    remaining_count += 1;
                }

                if (remaining_count == 0) {
                    var new_root_count: usize = 0;
                    for (json.data.e_object.properties.slice()) |prop| {
                        const key = prop.key.?.asString(allocator) orelse {
                            new_root_count += 1;
                            continue;
                        };
                        if (!strings.eqlComptime(key, "pnpm")) {
                            new_root_count += 1;
                        }
                    }

                    var new_root_props: JSAst.G.Property.List = try .initCapacity(allocator, new_root_count);
                    for (json.data.e_object.properties.slice()) |prop| {
                        const key = prop.key.?.asString(allocator) orelse {
                            new_root_props.appendAssumeCapacity(prop);
                            continue;
                        };
                        if (!strings.eqlComptime(key, "pnpm")) {
                            new_root_props.appendAssumeCapacity(prop);
                        }
                    }

                    json.data.e_object.properties = new_root_props;
                } else {
                    var new_pnpm_props: JSAst.G.Property.List = try .initCapacity(allocator, remaining_count);
                    for (pnpm_obj.properties.slice()) |prop| {
                        const key = prop.key.?.asString(allocator) orelse {
                            new_pnpm_props.appendAssumeCapacity(prop);
                            continue;
                        };
                        if (moved_overrides and strings.eqlComptime(key, "overrides")) continue;
                        if (moved_patched_deps and strings.eqlComptime(key, "patchedDependencies")) continue;
                        new_pnpm_props.appendAssumeCapacity(prop);
                    }

                    pnpm_obj.properties = new_pnpm_props;
                }
                needs_update = true;
            }
        }
    }

    var workspace_paths: ?std.array_list.Managed([]const u8) = null;
    var catalog_obj: ?Expr = null;
    var catalogs_obj: ?Expr = null;
    var workspace_overrides_obj: ?Expr = null;
    var workspace_patched_deps_obj: ?Expr = null;

    switch (bun.sys.File.readFrom(bun.FD.cwd(), "pnpm-workspace.yaml", allocator)) {
        .result => |contents| read_pnpm_workspace_yaml: {
            const yaml_source = logger.Source.initPathString("pnpm-workspace.yaml", contents);
            const root = YAML.parse(&yaml_source, log, allocator) catch {
                break :read_pnpm_workspace_yaml;
            };

            if (root.get("packages")) |packages_expr| {
                if (packages_expr.asArray()) |_packages| {
                    var packages = _packages;
                    var paths: std.array_list.Managed([]const u8) = .init(allocator);
                    while (packages.next()) |package_path| {
                        if (package_path.asString(allocator)) |package_path_str| {
                            try paths.append(package_path_str);
                        }
                    }

                    workspace_paths = paths;
                }
            }

            if (root.getObject("catalog")) |catalog_expr| {
                catalog_obj = catalog_expr;
            }

            if (root.getObject("catalogs")) |catalogs_expr| {
                catalogs_obj = catalogs_expr;
            }

            if (root.getObject("overrides")) |overrides_expr| {
                workspace_overrides_obj = overrides_expr;
            }

            if (root.getObject("patchedDependencies")) |patched_deps_expr| {
                workspace_patched_deps_obj = patched_deps_expr;
            }
        },
        .err => {},
    }

    const has_workspace_data = workspace_paths != null or catalog_obj != null or catalogs_obj != null;

    if (has_workspace_data) {
        const use_array_format = workspace_paths != null and catalog_obj == null and catalogs_obj == null;

        const existing_workspaces = json.data.e_object.get("workspaces");
        const is_object_workspaces = existing_workspaces != null and existing_workspaces.?.data == .e_object;

        if (use_array_format) {
            const paths = workspace_paths.?;
            var items: JSAst.ExprNodeList = try .initCapacity(allocator, paths.items.len);
            for (paths.items) |path| {
                items.appendAssumeCapacity(Expr.init(E.String, .{ .data = path }, .Empty));
            }
            const array = Expr.init(E.Array, .{ .items = items }, .Empty);
            try json.data.e_object.put(allocator, "workspaces", array);
            needs_update = true;
        } else if (is_object_workspaces) {
            const ws_obj = existing_workspaces.?.data.e_object;

            if (workspace_paths) |paths| {
                if (paths.items.len > 0) {
                    var items: JSAst.ExprNodeList = try .initCapacity(allocator, paths.items.len);
                    for (paths.items) |path| {
                        items.appendAssumeCapacity(Expr.init(E.String, .{ .data = path }, .Empty));
                    }
                    const array = Expr.init(E.Array, .{ .items = items }, .Empty);
                    try ws_obj.put(allocator, "packages", array);

                    needs_update = true;
                }
            }

            if (catalog_obj) |catalog| {
                try ws_obj.put(allocator, "catalog", catalog);
                needs_update = true;
            }

            if (catalogs_obj) |catalogs| {
                try ws_obj.put(allocator, "catalogs", catalogs);
                needs_update = true;
            }
        } else if (!use_array_format) {
            var ws_props: JSAst.G.Property.List = .empty;

            if (workspace_paths) |paths| {
                if (paths.items.len > 0) {
                    var items: JSAst.ExprNodeList = try .initCapacity(allocator, paths.items.len);
                    for (paths.items) |path| {
                        items.appendAssumeCapacity(Expr.init(E.String, .{ .data = path }, .Empty));
                    }
                    const value = Expr.init(E.Array, .{ .items = items }, .Empty);
                    const key = Expr.init(E.String, .{ .data = "packages" }, .Empty);

                    try ws_props.append(allocator, .{ .key = key, .value = value });
                }
            }

            if (catalog_obj) |catalog| {
                const key = Expr.init(E.String, .{ .data = "catalog" }, .Empty);
                try ws_props.append(allocator, .{ .key = key, .value = catalog });
            }

            if (catalogs_obj) |catalogs| {
                const key = Expr.init(E.String, .{ .data = "catalogs" }, .Empty);
                try ws_props.append(allocator, .{ .key = key, .value = catalogs });
            }

            if (ws_props.len > 0) {
                const workspace_obj = Expr.init(E.Object, .{ .properties = ws_props }, .Empty);
                try json.data.e_object.put(allocator, "workspaces", workspace_obj);
                needs_update = true;
            }
        }
    }

    // Handle overrides from pnpm-workspace.yaml
    if (workspace_overrides_obj) |ws_overrides| {
        if (ws_overrides.data == .e_object) {
            if (json.asProperty("overrides")) |existing_prop| {
                if (existing_prop.expr.data == .e_object) {
                    const existing_overrides = existing_prop.expr.data.e_object;
                    for (ws_overrides.data.e_object.properties.slice()) |prop| {
                        const key = prop.key.?.asString(allocator) orelse continue;
                        try existing_overrides.put(allocator, key, prop.value.?);
                    }
                }
            } else {
                try json.data.e_object.put(allocator, "overrides", ws_overrides);
            }
            needs_update = true;
        }
    }

    // Handle patchedDependencies from pnpm-workspace.yaml
    if (workspace_patched_deps_obj) |ws_patched| {
        var join_buf: std.array_list.Managed(u8) = .init(allocator);
        defer join_buf.deinit();

        if (ws_patched.data == .e_object) {
            for (0..ws_patched.data.e_object.properties.len) |prop_i| {
                // convert keys to expected "name@version" instead of only "name"
                var prop = &ws_patched.data.e_object.properties.ptr[prop_i];
                const key_str = prop.key.?.asString(allocator) orelse {
                    continue;
                };
                const res_str = patches.get(key_str) orelse {
                    continue;
                };
                join_buf.clearRetainingCapacity();
                try join_buf.writer().print("{s}@{s}", .{
                    key_str,
                    res_str,
                });
                prop.key = Expr.init(E.String, .{ .data = try allocator.dupe(u8, join_buf.items) }, .Empty);
            }
            if (json.asProperty("patchedDependencies")) |existing_prop| {
                if (existing_prop.expr.data == .e_object) {
                    const existing_patches = existing_prop.expr.data.e_object;
                    for (ws_patched.data.e_object.properties.slice()) |prop| {
                        const key = prop.key.?.asString(allocator) orelse continue;
                        try existing_patches.put(allocator, key, prop.value.?);
                    }
                }
            } else {
                try json.data.e_object.put(allocator, "patchedDependencies", ws_patched);
            }
            needs_update = true;
        }
    }

    if (needs_update) {
        var buffer_writer = JSPrinter.BufferWriter.init(allocator);
        defer buffer_writer.buffer.deinit();
        buffer_writer.append_newline = root_pkg_json.source.contents.len > 0 and root_pkg_json.source.contents[root_pkg_json.source.contents.len - 1] == '\n';
        var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

        _ = JSPrinter.printJSON(
            @TypeOf(&package_json_writer),
            &package_json_writer,
            json,
            &root_pkg_json.source,
            .{
                .indent = root_pkg_json.indentation,
                .mangled_props = null,
            },
        ) catch return;

        package_json_writer.flush() catch {
            return error.OutOfMemory;
        };

        root_pkg_json.source.contents = try allocator.dupe(u8, package_json_writer.ctx.writtenWithoutTrailingZero());

        // Write the updated package.json
        const write_file = bun.sys.File.openat(dir, "package.json", bun.O.WRONLY | bun.O.TRUNC, 0).unwrap() catch return;
        defer write_file.close();
        _ = write_file.write(root_pkg_json.source.contents).unwrap() catch return;
    }
}

const Dependency = @import("./dependency.zig");
const Npm = @import("./npm.zig");
const Bin = @import("./bin.zig").Bin;
const Integrity = @import("./integrity.zig").Integrity;
const Resolution = @import("./resolution.zig").Resolution;

const Lockfile = @import("./lockfile.zig");
const LoadResult = Lockfile.LoadResult;

const bun = @import("bun");
const JSPrinter = bun.js_printer;
const OOM = bun.OOM;
const logger = bun.logger;
const strings = bun.strings;
const sys = bun.sys;
const YAML = bun.interchange.yaml.YAML;

const Semver = bun.Semver;
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const stringHash = String.Builder.stringHash;

const JSAst = bun.ast;
const E = JSAst.E;
const Expr = JSAst.Expr;

const DependencyID = bun.install.DependencyID;
const ExtractTarball = bun.install.ExtractTarball;
const PackageID = bun.install.PackageID;
const PackageManager = bun.install.PackageManager;
const invalid_package_id = bun.install.invalid_package_id;
const Negatable = bun.install.Npm.Negatable;

const std = @import("std");
const os = std.os;
const Allocator = std.mem.Allocator;
