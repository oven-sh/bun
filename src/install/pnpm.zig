const string = []const u8;

/// Represents a pnpm package path with optional peer dependency suffixes
/// This parser handles both PNPM v6 and v9 formats correctly
const PnpmPackagePath = struct {
    name: string,
    version: string,
    peer_suffix: ?string = null,

    /// Parse a pnpm package path (supports v6 and v9 formats)
    /// Handles complex peer deps like: pkg@1.0.0(@jest/globals@29.7.0)(vitest@3.0.4(@types/node@20.17.6(patch_hash=xyz)))
    pub fn parse(path: string) PnpmPackagePath {
        if (path.len == 0) return .{ .name = "", .version = "" };

        const start: usize = if (path[0] == '/') 1 else 0;

        const first_paren = strings.indexOfChar(path, '(');
        const base_end = first_paren orelse path.len;

        var name_end: usize = start;
        var version_start: usize = base_end;

        if (start < base_end and path[start] == '@') {
            var i = start + 1;
            var found_slash = false;
            while (i < base_end) : (i += 1) {
                if (path[i] == '/') {
                    found_slash = true;
                } else if (path[i] == '@' and found_slash) {
                    name_end = i;
                    version_start = i + 1;
                    break;
                }
            }
        } else {
            var i = start;
            while (i < base_end) : (i += 1) {
                if (path[i] == '@') {
                    name_end = i;
                    version_start = i + 1;
                    break;
                }
            }
        }

        var cleaned_suffix: ?string = null;
        if (first_paren) |idx| {
            const suffix = path[idx..];
            if (strings.hasPrefixComptime(suffix, "(patch_hash=")) {
                if (strings.indexOfChar(suffix, ')')) |close_idx| {
                    if (close_idx + 1 < suffix.len and suffix[close_idx + 1] == '(') {
                        cleaned_suffix = suffix[close_idx + 1 ..];
                    }
                }
            } else {
                cleaned_suffix = suffix;
            }
        }

        return .{
            .name = if (name_end > start) path[start..name_end] else path[start..base_end],
            .version = if (version_start < base_end) path[version_start..base_end] else "",
            .peer_suffix = cleaned_suffix,
        };
    }
};

/// Catalog entry from pnpm lockfile
const CatalogEntry = struct {
    specifier: string,
    version: string,
};

/// Represents the parsed pnpm lockfile structure
const PnpmLockfile = struct {
    lockfile_version: string,
    settings: ?*E.Object = null,
    importers: ?*E.Object = null,
    packages: ?*E.Object = null,
    snapshots: ?*E.Object = null,
    catalogs: ?*E.Object = null,
    dependencies: ?*E.Object = null,
    specifiers: ?*E.Object = null,
    overrides: ?*E.Object = null,
    patchedDependencies: ?*E.Object = null,

    /// Parse catalogs section and return a map of catalog_name:package_name -> version
    pub fn parseCatalogs(
        self: PnpmLockfile,
        allocator: Allocator,
        string_buf: *String.Buf,
        log: *logger.Log,
        manager: *Install.PackageManager,
    ) !bun.StringHashMap(Dependency.Version) {
        var catalog_map = bun.StringHashMap(Dependency.Version).init(allocator);

        if (self.catalogs) |catalogs_obj| {
            const catalog_iter = catalogs_obj.properties.slice();
            for (catalog_iter) |catalog_entry| {
                const catalog_name = catalog_entry.key.?.asString(allocator) orelse continue;
                if (catalog_entry.value == null or catalog_entry.value.?.data != .e_object) continue;

                const pkg_iter = catalog_entry.value.?.data.e_object.properties.slice();
                for (pkg_iter) |pkg_entry| {
                    const pkg_name = pkg_entry.key.?.asString(allocator) orelse continue;

                    const catalog_key = if (strings.eqlComptime(catalog_name, "default"))
                        try std.fmt.allocPrint(allocator, "catalog:{s}", .{pkg_name})
                    else
                        try std.fmt.allocPrint(allocator, "catalog:{s}:{s}", .{ catalog_name, pkg_name });
                    defer allocator.free(catalog_key);

                    if (pkg_entry.value) |version_obj| {
                        if (version_obj.data == .e_object) {
                            const version_props = version_obj.data.e_object;
                            if (version_props.get("version")) |version_expr| {
                                if (version_expr.data == .e_string) {
                                    const version_str = version_expr.data.e_string.data;

                                    const stored_version = try string_buf.append(version_str);
                                    const sliced = Semver.SlicedString.init(stored_version.slice(string_buf.bytes.items), stored_version.slice(string_buf.bytes.items));
                                    const parsed_dep = Dependency.parse(
                                        allocator,
                                        try string_buf.append(pkg_name),
                                        stringHash(pkg_name),
                                        stored_version.slice(string_buf.bytes.items),
                                        &sliced,
                                        log,
                                        manager,
                                    ) orelse continue;

                                    const catalog_key_dup = try allocator.dupe(u8, catalog_key);
                                    try catalog_map.put(catalog_key_dup, parsed_dep);
                                }
                            }
                        } else if (version_obj.data == .e_string) {
                            const version_str = version_obj.data.e_string.data;
                            const stored_version = try string_buf.append(version_str);
                            const sliced = Semver.SlicedString.init(stored_version.slice(string_buf.bytes.items), stored_version.slice(string_buf.bytes.items));
                            const parsed_dep = Dependency.parse(
                                allocator,
                                try string_buf.append(pkg_name),
                                stringHash(pkg_name),
                                stored_version.slice(string_buf.bytes.items),
                                &sliced,
                                log,
                                manager,
                            ) orelse continue;

                            const catalog_key_dup = try allocator.dupe(u8, catalog_key);
                            try catalog_map.put(catalog_key_dup, parsed_dep);
                        }
                    }
                }
            }
        }

        return catalog_map;
    }
};

/// Parse an alias specifier like "npm:eslint@^8.57.0"
fn parseNpmAliasSpecifier(specifier: string) ?struct { package: string, version: string } {
    if (!strings.hasPrefixComptime(specifier, "npm:")) return null;
    const body = specifier["npm:".len..];
    if (strings.indexOfChar(body, '@')) |at_idx| {
        const pkg = body[0..at_idx];
        const ver = if (at_idx + 1 < body.len) body[at_idx + "@".len ..] else "*";
        return .{ .package = pkg, .version = ver };
    }
    return .{ .package = body, .version = "*" };
}

/// Parse a "name@version" string (supports scoped names like "@scope/name@1.2.3")
fn parseNameAtVersion(spec: string) ?struct { name: string, version: string } {
    if (spec.len == 0) return null;
    if (spec[0] == '@') {
        if (strings.indexOfChar(spec[1..], '@')) |second_at_rel| {
            const second_at = second_at_rel + "@".len;
            return .{ .name = spec[0..second_at], .version = if (second_at + 1 < spec.len) spec[second_at + 1 ..] else "" };
        }
        return null;
    }
    if (strings.indexOfChar(spec, '@')) |idx| {
        return .{ .name = spec[0..idx], .version = if (idx + 1 < spec.len) spec[idx + 1 ..] else "" };
    }
    return null;
}

/// Strip PNPM snapshot/patch suffixes and peer suffixes from version
fn sanitizeVersionAppend(this: *Lockfile, string_buf: *String.Buf, version_in: []const u8) ![]const u8 {
    _ = this;
    var v = version_in;

    if (strings.indexOfChar(v, '(')) |idx| {
        v = v[0..idx];
    }

    if (v.len == 0) v = version_in;

    const stored = try string_buf.append(v);
    const result = stored.slice(string_buf.bytes.items);

    return result;
}

fn isLikelyExactVersion(spec: string) bool {
    if (spec.len == 0) return false;

    if (spec[0] == '^' or spec[0] == '~' or spec[0] == '*' or spec[0] == '>') return false;
    if (strings.hasPrefixComptime(spec, ">=") or strings.hasPrefixComptime(spec, "<=") or strings.hasPrefixComptime(spec, "<")) return false;
    if (strings.hasPrefixComptime(spec, "workspace:") or strings.hasPrefixComptime(spec, "catalog:") or strings.hasPrefixComptime(spec, "link:")) return false;
    if (strings.hasPrefixComptime(spec, "npm:")) return true;

    var has_letter_or_dash = false;
    for (spec) |c| {
        if ((c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or c == '-') {
            has_letter_or_dash = true;
            break;
        }
    }

    if (strings.indexOfChar(spec, ' ') != null or strings.indexOfChar(spec, '|') != null) return false;

    return true;
}

/// Parse git+https:// and git+ssh:// URLs to extract owner, repo, and commit hash
fn parseGitUrl(url: []const u8) struct { owner: []const u8, repo: []const u8, commit: []const u8 } {
    var working_url = url;
    var commit: []const u8 = "";
    var owner: []const u8 = "";
    var repo: []const u8 = "";

    if (strings.hasPrefixComptime(working_url, "git+")) {
        working_url = working_url["git+".len..];
    }

    if (strings.indexOfChar(working_url, '#')) |hash_idx| {
        commit = working_url[hash_idx + "#".len ..];
        working_url = working_url[0..hash_idx];
    }

    if (strings.containsComptime(working_url, "github.com")) {
        if (strings.indexOf(working_url, "github.com:")) |github_idx| {
            const after_github = working_url[github_idx + "github.com:".len ..];
            if (strings.indexOfChar(after_github, '/')) |slash_idx| {
                owner = after_github[0..slash_idx];
                var repo_part = after_github[slash_idx + "/".len ..];

                if (strings.endsWithComptime(repo_part, ".git")) {
                    repo_part = repo_part[0 .. repo_part.len - 4];
                }
                repo = repo_part;
            }
        } else if (strings.indexOf(working_url, "github.com/")) |github_idx| {
            const after_github = working_url[github_idx + "github.com/".len ..];
            if (strings.indexOfChar(after_github, '/')) |slash_idx| {
                owner = after_github[0..slash_idx];
                var repo_part = after_github[slash_idx + "/".len ..];

                if (strings.endsWithComptime(repo_part, ".git")) {
                    repo_part = repo_part[0 .. repo_part.len - 4];
                }
                repo = repo_part;
            }
        }
    }

    return .{ .owner = owner, .repo = repo, .commit = commit };
}

/// Main migration function - convert PNPM lockfile to Bun lockfile
pub fn migratePnpmLockfile(
    this: *Lockfile,
    manager: *Install.PackageManager,
    allocator: Allocator,
    log: *logger.Log,
    data: string,
    dir: bun.FD,
) !LoadResult {
    this.initEmpty(allocator);
    Install.initializeStore();

    var arena = bun.ArenaAllocator.init(allocator);
    defer arena.deinit();

    const source = logger.Source.initPathString("pnpm-lock.yaml", data);
    const json = YAML.parse(&source, log, arena.allocator()) catch {
        return error.YamlParseError;
    };

    if (json.data != .e_object) {
        return error.InvalidPnpmLockfile;
    }

    const root = json.data.e_object;

    var lockfile_version = if (root.get("lockfileVersion")) |version_obj| version_obj.asString(arena.allocator()) orelse "" else "";
    if (lockfile_version.len == 0) {
        return error.PnpmLockfileVersionMissing;
    }

    // Parse version number (handle both "9.0" and "9" formats)
    const major_version = std.fmt.parseInt(u32, if (strings.indexOfChar(lockfile_version, '.')) |dot_idx|
        lockfile_version[0..dot_idx]
    else
        lockfile_version, 10) catch {
        return error.PnpmLockfileVersionInvalid;
    };

    if (major_version != 7 and major_version != 8 and major_version != 9) {
        if (major_version < 7) {
            return error.PnpmLockfileTooOld;
        } else {
            return error.PnpmLockfileTooNew;
        }
    }

    var string_buf = this.stringBuf();

    const estimated_strings = if (root.get("packages")) |packages_obj|
        if (packages_obj.data == .e_object) packages_obj.data.e_object.properties.len * 8 else 100
    else
        100;
    const estimated_capacity = estimated_strings * 50;
    try string_buf.bytes.ensureTotalCapacity(string_buf.allocator, estimated_capacity);

    const packages_obj = root.get("packages");

    var pnpm = PnpmLockfile{
        .lockfile_version = lockfile_version,
        .settings = if (root.get("settings")) |s| (if (s.data == .e_object) s.data.e_object else null) else null,
        .importers = if (root.get("importers")) |i| (if (i.data == .e_object) i.data.e_object else null) else null,
        .packages = if (packages_obj) |p| (if (p.data == .e_object) p.data.e_object else null) else null,
        .snapshots = if (root.get("snapshots")) |s| (if (s.data == .e_object) s.data.e_object else null) else null,
        .catalogs = if (root.get("catalogs")) |c| (if (c.data == .e_object) c.data.e_object else null) else null,
        .dependencies = if (root.get("dependencies")) |d| (if (d.data == .e_object) d.data.e_object else null) else null,
        .specifiers = if (root.get("specifiers")) |s| (if (s.data == .e_object) s.data.e_object else null) else null,
        .overrides = if (root.get("overrides")) |o| (if (o.data == .e_object) o.data.e_object else null) else null,
        .patchedDependencies = if (root.get("patchedDependencies")) |p| (if (p.data == .e_object) p.data.e_object else null) else null,
    };

    var catalog_map = try pnpm.parseCatalogs(allocator, &string_buf, log, manager);
    defer catalog_map.deinit();

    var workspace_map: ?Lockfile.Package.WorkspaceMap = null;
    if (pnpm.importers) |importers| {
        var has_workspaces = false;
        for (importers.properties.slice()) |entry| {
            const importer_path = entry.key.?.asString(allocator) orelse continue;
            if (!strings.eqlComptime(importer_path, ".")) {
                has_workspaces = true;
                break;
            }
        }

        workspace_map = Lockfile.Package.WorkspaceMap.init(allocator);

        for (importers.properties.slice()) |entry| {
            const importer_path = entry.key.?.asString(allocator) orelse continue;

            var workspace_name: []const u8 = importer_path;
            var workspace_version: ?[]const u8 = null;

            // Use openat to read the package.json relative to the dir file descriptor
            const package_json_path: [:0]const u8 = if (strings.eqlComptime(importer_path, "."))
                "package.json"
            else brk: {
                var path_buf: bun.PathBuffer = undefined;
                const path = std.fmt.bufPrintZ(&path_buf, "{s}/package.json", .{importer_path}) catch break :brk "package.json";
                break :brk path;
            };

            const package_json_file = bun.sys.File.openat(dir, package_json_path, bun.O.RDONLY, 0).unwrap() catch {
                // If we can't open the package.json, continue with default name
                // We can't add it here since we don't have workspace_map yet
                continue;
            };
            defer package_json_file.close();

            if (package_json_file.readToEnd(allocator).unwrap() catch null) |package_json_content| {
                defer allocator.free(package_json_content);

                const pkg_source = logger.Source.initPathString(package_json_path, package_json_content);
                if (bun.json.parseUTF8(&pkg_source, log, allocator) catch null) |pkg_json| {
                    if (pkg_json.data == .e_object) {
                        const pkg_obj = pkg_json.data.e_object;

                        if (pkg_obj.get("name")) |name_expr| {
                            if (name_expr.data == .e_string) {
                                workspace_name = try allocator.dupe(u8, name_expr.data.e_string.data);
                            }
                        }

                        if (pkg_obj.get("version")) |version_expr| {
                            if (version_expr.data == .e_string) {
                                workspace_version = try allocator.dupe(u8, version_expr.data.e_string.data);
                            }
                        }
                    }
                } else {
                    workspace_name = try allocator.dupe(u8, importer_path);
                }
            } else {
                workspace_name = try allocator.dupe(u8, importer_path);
            }

            try workspace_map.?.map.put(importer_path, .{
                .name = workspace_name,
                .version = workspace_version,
                .name_loc = logger.Loc.Empty,
            });
        }
    }

    const root_name: []const u8 = blk: {
        if (workspace_map) |wksp| {
            if (wksp.map.get(".")) |root_info| {
                break :blk root_info.name;
            }
        }

        break :blk "root";
    };

    const root_name_hash = stringHash(root_name);
    _ = try this.appendPackage(.{
        .name = try string_buf.appendWithHash(root_name, root_name_hash),
        .name_hash = root_name_hash,
        .resolution = Resolution.init(.{
            .root = {},
        }),
        .meta = .{
            .id = 0,
            .origin = .local,
            .arch = Npm.Architecture.all,
            .os = Npm.OperatingSystem.all,
        },
        .dependencies = .{},
        .resolutions = .{},
        .bin = Bin.init(),
    });

    try this.buffers.trees.append(allocator, Lockfile.Tree{
        .id = 0,
        .parent = Lockfile.Tree.invalid_id,
        .dependency_id = Lockfile.Tree.root_dep_id,
        .dependencies = .{ .off = 0, .len = 0 },
    });

    var package_id_map = bun.StringHashMap(Install.PackageID).init(allocator);
    defer package_id_map.deinit();

    var preferred_versions = bun.StringHashMap([]const u8).init(allocator);
    defer preferred_versions.deinit();

    var package_dependencies = std.AutoHashMap(Install.PackageID, std.ArrayList(Install.DependencyID)).init(allocator);
    defer {
        var iter = package_dependencies.iterator();
        while (iter.next()) |entry| {
            entry.value_ptr.deinit();
        }
        package_dependencies.deinit();
    }

    var package_id: Install.PackageID = 1;

    var workspace_actual_names = bun.StringHashMap([]const u8).init(allocator);
    defer workspace_actual_names.deinit();

    //// todo: these are most important to resync from registry api
    var packages_with_bins = std.ArrayList([]const u8).init(allocator);
    defer {
        for (packages_with_bins.items) |pkg_name| {
            allocator.free(pkg_name);
        }
        packages_with_bins.deinit();
    }

    var package_peer_deps = bun.StringHashMap(bun.StringHashMap(bool)).init(allocator);
    defer {
        var iter = package_peer_deps.iterator();
        while (iter.next()) |entry| {
            entry.value_ptr.deinit();
        }
        package_peer_deps.deinit();
    }

    var package_optional_peers = bun.StringHashMap(bun.StringHashMap(bool)).init(allocator);
    defer {
        var iter = package_optional_peers.iterator();
        while (iter.next()) |entry| {
            entry.value_ptr.deinit();
        }
        package_optional_peers.deinit();
    }

    var peer_dependencies_map = bun.StringHashMap(bun.StringHashMap(bool)).init(allocator);
    defer {
        var iter = peer_dependencies_map.iterator();
        while (iter.next()) |entry| {
            entry.value_ptr.deinit();
        }
        peer_dependencies_map.deinit();
    }

    var optional_peer_dependencies_map = bun.StringHashMap(bun.StringHashMap(bool)).init(allocator);
    defer {
        var iter2 = optional_peer_dependencies_map.iterator();
        while (iter2.next()) |entry| {
            entry.value_ptr.deinit();
        }
        optional_peer_dependencies_map.deinit();
    }

    var peer_version_specs = bun.StringHashMap(bun.StringHashMap([]const u8)).init(allocator);
    defer {
        var iter = peer_version_specs.iterator();
        while (iter.next()) |entry| {
            entry.value_ptr.deinit();
        }
        peer_version_specs.deinit();
    }

    var workspace_version_refs = std.AutoHashMap(u64, String).init(allocator);
    defer workspace_version_refs.deinit();

    if (workspace_map) |wksp| {
        var iter = wksp.map.iterator();
        while (iter.next()) |entry| {
            const workspace_path = entry.key_ptr.*;

            if (strings.eqlComptime(workspace_path, ".")) continue;

            const stored_ws_path = try string_buf.append(workspace_path);
            const workspace_path_hash = stringHash(stored_ws_path.slice(string_buf.bytes.items));

            var bin_obj = Bin.init();
            var actual_workspace_name: ?[]const u8 = null;
            var actual_workspace_version_str: ?String = null;

            // Use openat to read package.json relative to dir
            var workspace_pkg_path_buf: bun.PathBuffer = undefined;
            const workspace_pkg_path = std.fmt.bufPrintZ(&workspace_pkg_path_buf, "{s}/package.json", .{workspace_path}) catch continue;

            const workspace_pkg_file = bun.sys.File.openat(dir, workspace_pkg_path, bun.O.RDONLY, 0).unwrap() catch {
                // If we can't open package.json, skip it
                continue;
            };
            defer workspace_pkg_file.close();

            if (workspace_pkg_file.readToEnd(allocator).unwrap()) |package_json_content| {
                defer allocator.free(package_json_content);
                const pkg_source = logger.Source.initPathString("package.json", package_json_content);
                const pkg_json = bun.json.parseUTF8(&pkg_source, log, allocator) catch null;
                if (pkg_json) |parsed_json| {
                    if (parsed_json.data == .e_object) {
                        const pkg_obj = parsed_json.data.e_object;

                        if (pkg_obj.get("name")) |name_field| {
                            const name_str = name_field.asString(allocator) orelse "";
                            if (name_str.len > 0) {
                                const stored_name = try string_buf.append(name_str);
                                actual_workspace_name = stored_name.slice(string_buf.bytes.items);
                            }
                        }

                        if (pkg_obj.get("version")) |version_field| {
                            const version_str = version_field.asString(allocator) orelse "";
                            if (version_str.len > 0) {
                                actual_workspace_version_str = try string_buf.append(version_str);
                            }
                        }

                        if (pkg_obj.get("peerDependencies")) |peer_deps_field| {
                            if (peer_deps_field.data == .e_object) {
                                var peer_set = bun.StringHashMap(bool).init(allocator);
                                var optional_set = bun.StringHashMap(bool).init(allocator);
                                var has_peers = false;
                                var has_optional = false;

                                var regular_deps = bun.StringHashMap(bool).init(allocator);
                                defer regular_deps.deinit();

                                if (pkg_obj.get("dependencies")) |deps_field| {
                                    if (deps_field.data == .e_object) {
                                        for (deps_field.data.e_object.properties.slice()) |prop| {
                                            const dep_name = prop.key.?.asString(allocator) orelse continue;

                                            try regular_deps.put(dep_name, true);
                                        }
                                    }
                                }

                                var peer_meta = bun.StringHashMap(bool).init(allocator);
                                defer peer_meta.deinit();

                                if (pkg_obj.get("peerDependenciesMeta")) |peer_meta_field| {
                                    if (peer_meta_field.data == .e_object) {
                                        for (peer_meta_field.data.e_object.properties.slice()) |prop| {
                                            const peer_name = prop.key.?.asString(allocator) orelse continue;

                                            if (prop.value) |meta_value| {
                                                if (meta_value.data == .e_object) {
                                                    if (meta_value.data.e_object.get("optional")) |optional_field| {
                                                        const is_optional = optional_field.asBool() orelse false;
                                                        if (is_optional) {
                                                            try peer_meta.put(peer_name, true);
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                var version_spec_map = bun.StringHashMap([]const u8).init(allocator);

                                for (peer_deps_field.data.e_object.properties.slice()) |prop| {
                                    const peer_name = prop.key.?.asString(allocator) orelse continue;

                                    const duped_name = try allocator.dupe(u8, peer_name);
                                    try peer_set.put(duped_name, true);
                                    has_peers = true;

                                    if (prop.value) |value| {
                                        if (value.data == .e_string) {
                                            const version_spec = try allocator.dupe(u8, value.data.e_string.data);
                                            try version_spec_map.put(duped_name, version_spec);
                                        }
                                    }

                                    if (peer_meta.get(peer_name) != null) {
                                        try optional_set.put(duped_name, true);
                                        has_optional = true;
                                    }
                                }

                                if (has_peers) {
                                    const ws_key = try allocator.dupe(u8, workspace_path);

                                    if (package_peer_deps.getPtr(ws_key)) |existing_peers| {
                                        var peer_iter = peer_set.iterator();
                                        while (peer_iter.next()) |peer_entry| {
                                            try existing_peers.put(peer_entry.key_ptr.*, true);
                                        }
                                        peer_set.deinit();
                                    } else {
                                        try package_peer_deps.put(ws_key, peer_set);
                                    }

                                    if (has_optional) {
                                        if (package_optional_peers.getPtr(ws_key)) |existing_optional| {
                                            var optional_iter = optional_set.iterator();
                                            while (optional_iter.next()) |opt_entry| {
                                                try existing_optional.put(opt_entry.key_ptr.*, true);
                                            }
                                            optional_set.deinit();
                                        } else {
                                            try package_optional_peers.put(ws_key, optional_set);
                                        }
                                    } else {
                                        optional_set.deinit();
                                    }

                                    if (version_spec_map.count() > 0) {
                                        try peer_version_specs.put(ws_key, version_spec_map);
                                    } else {
                                        version_spec_map.deinit();
                                    }
                                } else {
                                    peer_set.deinit();
                                    optional_set.deinit();
                                    version_spec_map.deinit();
                                }
                            }
                        }

                        if (pkg_obj.get("bin")) |bin_field| {
                            switch (bin_field.data) {
                                .e_string => {
                                    const str = bin_field.asString(allocator) orelse "";
                                    if (str.len > 0) {
                                        bin_obj = .{
                                            .tag = .file,
                                            .value = .{ .file = try string_buf.append(str) },
                                        };
                                    }
                                },
                                .e_object => |obj| {
                                    if (obj.properties.len == 1) {
                                        const name = obj.properties.ptr[0].key.?.asString(allocator) orelse "";
                                        const value = obj.properties.ptr[0].value.?.asString(allocator) orelse "";
                                        if (name.len > 0 and value.len > 0) {
                                            bin_obj = .{
                                                .tag = .named_file,
                                                .value = .{
                                                    .named_file = .{
                                                        try string_buf.append(name),
                                                        try string_buf.append(value),
                                                    },
                                                },
                                            };
                                        }
                                    } else if (obj.properties.len > 1) {
                                        const start = this.buffers.extern_strings.items.len;
                                        for (obj.properties.slice()) |prop| {
                                            const key = prop.key.?.asString(allocator) orelse "";
                                            const value = prop.value.?.asString(allocator) orelse "";
                                            const key_str = try string_buf.append(key);
                                            const value_str = try string_buf.append(value);
                                            try this.buffers.extern_strings.append(allocator, ExternalString{
                                                .value = key_str,
                                                .hash = stringHash(key),
                                            });
                                            try this.buffers.extern_strings.append(allocator, ExternalString{
                                                .value = value_str,
                                                .hash = stringHash(value),
                                            });
                                        }
                                        const end = this.buffers.extern_strings.items.len;
                                        bin_obj = .{
                                            .tag = .map,
                                            .value = .{ .map = .{
                                                .off = @truncate(start),
                                                .len = @truncate(end - start),
                                            } },
                                        };
                                    }
                                },
                                else => {},
                            }
                        }
                    }
                }
            } else |_| {}

            const package_name = if (actual_workspace_name) |actual_name| blk: {
                if (actual_name.len == 0 or strings.indexOfChar(actual_name, 0) != null) {
                    break :blk stored_ws_path;
                }
                break :blk try string_buf.append(actual_name);
            } else stored_ws_path;

            const package_name_hash = stringHash(package_name.slice(string_buf.bytes.items));

            const workspace_pkg_id = try this.appendPackage(.{
                .name = package_name,
                .name_hash = package_name_hash,
                .resolution = Resolution.init(.{
                    .workspace = try string_buf.append(workspace_path),
                }),
                .meta = .{
                    .id = package_id,
                    .origin = .local,
                    .arch = Npm.Architecture.all,
                    .os = Npm.OperatingSystem.all,
                },
                .dependencies = .{},
                .resolutions = .{},
                .bin = bin_obj,
            });

            const workspace_path_ref = try string_buf.append(workspace_path);
            try this.workspace_paths.put(allocator, package_name_hash, workspace_path_ref);

            if (actual_workspace_version_str) |version_ref| {
                try workspace_version_refs.put(package_name_hash, version_ref);
            }

            try this.getOrPutID(workspace_pkg_id.meta.id, package_name_hash);

            const workspace_path_key = try allocator.dupe(u8, workspace_path);
            try package_id_map.put(workspace_path_key, workspace_pkg_id.meta.id);

            if (actual_workspace_name) |actual_name| {
                if (actual_name.len > 0) {
                    const workspace_name_key = try allocator.dupe(u8, actual_name);
                    try package_id_map.put(workspace_name_key, package_id);

                    if (strings.indexOfChar(actual_name, 0) != null) {
                        const duped_path = try allocator.dupe(u8, workspace_path);
                        try workspace_actual_names.put(duped_path, duped_path);
                    } else {
                        const duped_name = try allocator.dupe(u8, actual_name);
                        const duped_path = try allocator.dupe(u8, workspace_path);
                        try workspace_actual_names.put(duped_path, duped_name);
                    }

                    if (!strings.eql(actual_name, workspace_path)) {
                        try this.getOrPutID(workspace_pkg_id.meta.id, workspace_path_hash);
                    }
                } else {
                    const duped_path = try allocator.dupe(u8, workspace_path);
                    try workspace_actual_names.put(duped_path, duped_path);
                }
            } else {
                const duped_path = try allocator.dupe(u8, workspace_path);
                try workspace_actual_names.put(duped_path, duped_path);
            }

            package_id += 1;
        }

        var version_iter = workspace_version_refs.iterator();
        while (version_iter.next()) |entry| {
            const name_hash = entry.key_ptr.*;
            const version_ref = entry.value_ptr.*;

            const version_slice = version_ref.slice(string_buf.bytes.items);
            const sliced = Semver.SlicedString.init(version_slice, version_slice);
            const parsed_version = Semver.Version.parse(sliced);

            if (parsed_version.valid) {
                var version = parsed_version.version.min();

                if (version.tag.hasPre()) {
                    if (strings.indexOfChar(version_slice, '-')) |dash_pos| {
                        const prerelease_start = dash_pos + 1;

                        var prerelease_len = version_slice.len - prerelease_start;
                        if (strings.indexOfChar(version_slice[prerelease_start..], '+')) |plus_pos| {
                            prerelease_len = plus_pos;
                        }

                        const prerelease_str = version_slice[prerelease_start .. prerelease_start + prerelease_len];
                        const stored_prerelease = try string_buf.append(prerelease_str);

                        version.tag.pre = ExternalString{
                            .value = stored_prerelease,
                            .hash = stringHash(prerelease_str),
                        };
                    }
                }

                try this.workspace_versions.put(allocator, name_hash, version);
            }
        }
    }

    var package_metadata_map = bun.StringHashMap(*E.Object).init(allocator);
    defer package_metadata_map.deinit();

    if (pnpm.packages) |packages_section| {
        for (packages_section.properties.slice()) |entry| {
            const pkg_path = entry.key.?.asString(allocator) orelse continue;
            if (entry.value == null or entry.value.?.data != .e_object) continue;

            const pkg_path_key = try allocator.dupe(u8, pkg_path);
            try package_metadata_map.put(pkg_path_key, entry.value.?.data.e_object);
        }
    }

    const processing_section = pnpm.snapshots orelse pnpm.packages;
    if (processing_section) |section| {
        for (section.properties.slice()) |entry| {
            const pkg_path_raw = entry.key.?.asString(allocator) orelse continue;
            if (entry.value == null or entry.value.?.data != .e_object) continue;
            const pkg_instance = entry.value.?.data.e_object;

            const is_git_dep = strings.containsComptime(pkg_path_raw, "github.com/") or
                strings.containsComptime(pkg_path_raw, "codeload.github.com") or
                strings.containsComptime(pkg_path_raw, "://") or
                strings.hasPrefixComptime(pkg_path_raw, "git+") or
                strings.hasPrefixComptime(pkg_path_raw, "git+https://") or
                strings.hasPrefixComptime(pkg_path_raw, "git+ssh://") or
                strings.hasPrefixComptime(pkg_path_raw, "github:") or
                (strings.indexOfChar(pkg_path_raw, '@') != null and strings.containsComptime(pkg_path_raw, "https://"));

            const pkg_path_str = if (pnpm.snapshots != null) blk: {
                const stored = try string_buf.append(pkg_path_raw);
                break :blk stored.slice(string_buf.bytes.items);
            } else blk: {
                const stored = try string_buf.append(pkg_path_raw);
                break :blk stored.slice(string_buf.bytes.items);
            };

            var permanent_name: String = undefined;
            var permanent_version: String = undefined;
            var permanent_name_str: []const u8 = undefined;
            var permanent_version_str: []const u8 = undefined;

            const is_file_or_link_dep = strings.hasPrefixComptime(pkg_path_str, "file:") or
                strings.hasPrefixComptime(pkg_path_str, "link:");

            if (is_file_or_link_dep or is_git_dep) {
                const metadata_instance = package_metadata_map.get(pkg_path_raw) orelse pkg_instance;

                const name_from_meta = if (metadata_instance.get("name")) |name_obj| blk: {
                    break :blk if (name_obj.data == .e_string) name_obj.data.e_string.data else "";
                } else "";

                if (is_git_dep and name_from_meta.len > 0) {
                    permanent_name = try string_buf.append(name_from_meta);
                    permanent_version = try string_buf.append(pkg_path_str);
                } else if (is_file_or_link_dep) {
                    permanent_name = try string_buf.append(name_from_meta);
                    permanent_version = try string_buf.append(pkg_path_str);
                } else {
                    const parsed = PnpmPackagePath.parse(pkg_path_str);
                    permanent_name = try string_buf.append(parsed.name);
                    permanent_version = try string_buf.append(parsed.version);
                }
                permanent_name_str = permanent_name.slice(string_buf.bytes.items);
                permanent_version_str = permanent_version.slice(string_buf.bytes.items);
            } else {
                const parsed = PnpmPackagePath.parse(pkg_path_str);

                permanent_name = try string_buf.append(parsed.name);
                permanent_version = try string_buf.append(parsed.version);
                permanent_name_str = permanent_name.slice(string_buf.bytes.items);
                permanent_version_str = permanent_version.slice(string_buf.bytes.items);
            }

            if (!is_git_dep and (permanent_name_str.len == 0 or permanent_version_str.len == 0)) {
                continue;
            }

            if (package_id_map.contains(pkg_path_str)) {
                continue;
            }

            if (strings.hasPrefixComptime(permanent_version_str, "file:")) {
                const file_path = permanent_version_str["file:".len..];

                const is_workspace_dep = package_id_map.contains(file_path) or workspace_actual_names.contains(file_path);

                if (is_workspace_dep) {
                    continue;
                }

                var resolution: Resolution = undefined;

                if (strings.endsWithComptime(file_path, ".tgz") or
                    strings.endsWithComptime(file_path, ".tar.gz") or
                    strings.endsWithComptime(file_path, ".tar.bz2") or
                    strings.endsWithComptime(file_path, ".tar.xz"))
                {
                    resolution = Resolution.init(.{ .local_tarball = try string_buf.append(file_path) });
                } else {
                    resolution = Resolution.init(.{ .folder = try string_buf.append(file_path) });
                }

                // Parse OS and CPU constraints for file dependencies
                var arch_file = Npm.Architecture.all;
                var os_file = Npm.OperatingSystem.all;

                const file_metadata = package_metadata_map.get(pkg_path_raw) orelse pkg_instance;
                if (file_metadata.get("cpu")) |cpu_array| {
                    if (cpu_array.data == .e_array and cpu_array.data.e_array.items.len > 0) {
                        var arch_negatable = Npm.Architecture.none.negatable();
                        for (cpu_array.data.e_array.items.slice()) |item| {
                            if (item.data == .e_string) {
                                arch_negatable.apply(item.data.e_string.data);
                            }
                        }
                        arch_file = arch_negatable.combine();
                    }
                }

                if (file_metadata.get("os")) |os_array| {
                    if (os_array.data == .e_array and os_array.data.e_array.items.len > 0) {
                        var os_negatable = Npm.OperatingSystem.none.negatable();
                        for (os_array.data.e_array.items.slice()) |item| {
                            if (item.data == .e_string) {
                                os_negatable.apply(item.data.e_string.data);
                            }
                        }
                        os_file = os_negatable.combine();
                    }
                }

                const name_hash = stringHash(permanent_name_str);
                const pkg_index = try this.appendPackage(.{
                    .name = permanent_name,
                    .name_hash = name_hash,
                    .resolution = resolution,
                    .meta = .{
                        .id = package_id,
                        .origin = .local,
                        .arch = arch_file,
                        .os = os_file,
                        .integrity = Integrity{},
                    },
                    .dependencies = .{},
                    .resolutions = .{},
                    .bin = Bin.init(),
                });

                try this.getOrPutID(pkg_index.meta.id, name_hash);

                const pkg_path_key = try allocator.dupe(u8, pkg_path_str);
                try package_id_map.put(pkg_path_key, package_id);

                package_id += 1;
                continue;
            }

            if (strings.hasPrefixComptime(permanent_version_str, "link:")) {
                const link_path = permanent_version_str["link:".len..];

                const is_workspace_dep = package_id_map.contains(link_path) or
                    workspace_actual_names.contains(link_path);

                if (is_workspace_dep) {
                    continue;
                }

                const resolution = Resolution.init(.{ .symlink = try string_buf.append(link_path) });

                // Parse OS and CPU constraints for link dependencies
                var arch_link = Npm.Architecture.all;
                var os_link = Npm.OperatingSystem.all;

                const link_metadata = package_metadata_map.get(pkg_path_raw) orelse pkg_instance;
                if (link_metadata.get("cpu")) |cpu_array| {
                    if (cpu_array.data == .e_array and cpu_array.data.e_array.items.len > 0) {
                        var arch_negatable = Npm.Architecture.none.negatable();
                        for (cpu_array.data.e_array.items.slice()) |item| {
                            if (item.data == .e_string) {
                                arch_negatable.apply(item.data.e_string.data);
                            }
                        }
                        arch_link = arch_negatable.combine();
                    }
                }

                if (link_metadata.get("os")) |os_array| {
                    if (os_array.data == .e_array and os_array.data.e_array.items.len > 0) {
                        var os_negatable = Npm.OperatingSystem.none.negatable();
                        for (os_array.data.e_array.items.slice()) |item| {
                            if (item.data == .e_string) {
                                os_negatable.apply(item.data.e_string.data);
                            }
                        }
                        os_link = os_negatable.combine();
                    }
                }

                const name_hash = stringHash(permanent_name_str);
                const pkg_index = try this.appendPackage(.{
                    .name = permanent_name,
                    .name_hash = name_hash,
                    .resolution = resolution,
                    .meta = .{
                        .id = package_id,
                        .origin = .local,
                        .arch = arch_link,
                        .os = os_link,
                        .integrity = Integrity{},
                    },
                    .dependencies = .{},
                    .resolutions = .{},
                    .bin = Bin.init(),
                });

                try this.getOrPutID(pkg_index.meta.id, name_hash);

                const pkg_path_key = try allocator.dupe(u8, pkg_path_str);
                try package_id_map.put(pkg_path_key, package_id);

                package_id += 1;
                continue;
            }

            if (is_git_dep) {
                const git_pkg_name = permanent_name_str;

                const git_metadata = package_metadata_map.get(pkg_path_raw) orelse pkg_instance;

                if (git_metadata.get("resolution")) |res_obj| {
                    if (res_obj.data == .e_object) {
                        var tarball_url: ?[]const u8 = null;
                        if (res_obj.data.e_object.get("tarball")) |tarball_obj| {
                            if (tarball_obj.data == .e_string) {
                                tarball_url = tarball_obj.data.e_string.data;
                            }
                        }

                        if (tarball_url) |url| {
                            if (strings.containsComptime(url, "github.com") and git_pkg_name.len > 0) {
                                var commit_hash: []const u8 = "";
                                if (strings.lastIndexOfChar(url, '/')) |last_slash| {
                                    commit_hash = url[last_slash + "/".len ..];
                                }

                                var owner: []const u8 = "";
                                var repo: []const u8 = "";

                                if (strings.containsComptime(url, "codeload.github.com/")) {
                                    const after_domain = url[strings.indexOf(url, "codeload.github.com/").? + "codeload.github.com/".len ..];
                                    if (strings.indexOfChar(after_domain, '/')) |first_slash| {
                                        owner = after_domain[0..first_slash];
                                        const after_owner = after_domain[first_slash + "/".len ..];
                                        if (strings.indexOfChar(after_owner, '/')) |second_slash| {
                                            repo = after_owner[0..second_slash];
                                        }
                                    }
                                }

                                if (owner.len > 0 and repo.len > 0 and commit_hash.len > 0) {
                                    const commit_short = if (commit_hash.len > 7) commit_hash[0..7] else commit_hash;
                                    const resolved_str = try std.fmt.allocPrint(allocator, "{s}-{s}-{s}", .{ owner, repo, commit_short });
                                    defer allocator.free(resolved_str);

                                    const resolution = Resolution.init(.{
                                        .github = .{
                                            .owner = try string_buf.append(owner),
                                            .repo = try string_buf.append(repo),
                                            .committish = try string_buf.append(commit_hash),
                                            .resolved = try string_buf.append(resolved_str),
                                            .package_name = try string_buf.append(git_pkg_name),
                                        },
                                    });

                                    const stored_name = try string_buf.append(git_pkg_name);
                                    const stored_name_str = stored_name.slice(string_buf.bytes.items);
                                    const name_hash = stringHash(stored_name_str);

                                    // Parse OS and CPU constraints for github dependencies
                                    var arch_github = Npm.Architecture.all;
                                    var os_github = Npm.OperatingSystem.all;

                                    const github_metadata = package_metadata_map.get(pkg_path_raw) orelse pkg_instance;
                                    if (github_metadata.get("cpu")) |cpu_array| {
                                        if (cpu_array.data == .e_array and cpu_array.data.e_array.items.len > 0) {
                                            var arch_negatable = Npm.Architecture.none.negatable();
                                            for (cpu_array.data.e_array.items.slice()) |item| {
                                                if (item.data == .e_string) {
                                                    arch_negatable.apply(item.data.e_string.data);
                                                }
                                            }
                                            arch_github = arch_negatable.combine();
                                        }
                                    }

                                    if (github_metadata.get("os")) |os_array| {
                                        if (os_array.data == .e_array and os_array.data.e_array.items.len > 0) {
                                            var os_negatable = Npm.OperatingSystem.none.negatable();
                                            for (os_array.data.e_array.items.slice()) |item| {
                                                if (item.data == .e_string) {
                                                    os_negatable.apply(item.data.e_string.data);
                                                }
                                            }
                                            os_github = os_negatable.combine();
                                        }
                                    }

                                    const pkg_index = try this.appendPackage(.{
                                        .name = stored_name,
                                        .name_hash = name_hash,
                                        .resolution = resolution,
                                        .meta = .{
                                            .id = package_id,
                                            .origin = .npm,
                                            .arch = arch_github,
                                            .os = os_github,
                                            .integrity = Integrity{},
                                        },
                                        .dependencies = .{},
                                        .resolutions = .{},
                                        .bin = Bin.init(),
                                    });

                                    try this.getOrPutID(pkg_index.meta.id, name_hash);

                                    try package_id_map.put(try allocator.dupe(u8, pkg_path_str), pkg_index.meta.id);

                                    if (strings.indexOfChar(pkg_path_str, '@')) |at_idx| {
                                        if (at_idx > 0 and at_idx + 1 < pkg_path_str.len) {
                                            const path_without_name = pkg_path_str[at_idx + "@".len ..];
                                            try package_id_map.put(try allocator.dupe(u8, path_without_name), pkg_index.meta.id);
                                        }
                                    }

                                    const name_key = try std.fmt.allocPrint(allocator, "{s}@github:{s}/{s}#{s}", .{ git_pkg_name, owner, repo, commit_hash });
                                    try package_id_map.put(name_key, pkg_index.meta.id);

                                    package_id += 1;
                                    continue;
                                }
                            }
                        }
                    }
                }

                if (strings.hasPrefixComptime(pkg_path_raw, "git+https://") or strings.hasPrefixComptime(pkg_path_raw, "git+ssh://")) {
                    const git_parsed = parseGitUrl(pkg_path_raw);

                    if (git_parsed.owner.len > 0 and git_parsed.repo.len > 0 and git_parsed.commit.len > 0) {
                        const commit_short = if (git_parsed.commit.len > 7) git_parsed.commit[0..7] else git_parsed.commit;
                        const resolved_str = try std.fmt.allocPrint(allocator, "{s}-{s}-{s}", .{ git_parsed.owner, git_parsed.repo, commit_short });
                        defer allocator.free(resolved_str);

                        const resolution = Resolution.init(.{
                            .github = .{
                                .owner = try string_buf.append(git_parsed.owner),
                                .repo = try string_buf.append(git_parsed.repo),
                                .committish = try string_buf.append(git_parsed.commit),
                                .resolved = try string_buf.append(resolved_str),
                                .package_name = try string_buf.append(git_pkg_name),
                            },
                        });

                        const stored_name = try string_buf.append(git_pkg_name);
                        const stored_name_str = stored_name.slice(string_buf.bytes.items);
                        const name_hash = stringHash(stored_name_str);

                        // Parse OS and CPU constraints for git+https/ssh dependencies
                        var arch_git2 = Npm.Architecture.all;
                        var os_git2 = Npm.OperatingSystem.all;

                        const git_metadata2 = package_metadata_map.get(pkg_path_raw) orelse pkg_instance;
                        if (git_metadata2.get("cpu")) |cpu_array| {
                            if (cpu_array.data == .e_array and cpu_array.data.e_array.items.len > 0) {
                                var arch_negatable = Npm.Architecture.none.negatable();
                                for (cpu_array.data.e_array.items.slice()) |item| {
                                    if (item.data == .e_string) {
                                        arch_negatable.apply(item.data.e_string.data);
                                    }
                                }
                                arch_git2 = arch_negatable.combine();
                            }
                        }

                        if (git_metadata2.get("os")) |os_array| {
                            if (os_array.data == .e_array and os_array.data.e_array.items.len > 0) {
                                var os_negatable = Npm.OperatingSystem.none.negatable();
                                for (os_array.data.e_array.items.slice()) |item| {
                                    if (item.data == .e_string) {
                                        os_negatable.apply(item.data.e_string.data);
                                    }
                                }
                                os_git2 = os_negatable.combine();
                            }
                        }

                        const pkg_index = try this.appendPackage(.{
                            .name = stored_name,
                            .name_hash = name_hash,
                            .resolution = resolution,
                            .meta = .{
                                .id = package_id,
                                .origin = .npm,
                                .arch = arch_git2,
                                .os = os_git2,
                                .integrity = Integrity{},
                            },
                            .dependencies = .{},
                            .resolutions = .{},
                            .bin = Bin.init(),
                        });

                        try this.getOrPutID(pkg_index.meta.id, name_hash);

                        try package_id_map.put(try allocator.dupe(u8, pkg_path_str), pkg_index.meta.id);

                        if (strings.indexOfChar(pkg_path_str, '@')) |at_idx| {
                            if (at_idx > 0 and at_idx + 1 < pkg_path_str.len) {
                                const path_without_name = pkg_path_str[at_idx + "@".len ..];
                                try package_id_map.put(try allocator.dupe(u8, path_without_name), pkg_index.meta.id);
                            }
                        }

                        const name_key2 = try std.fmt.allocPrint(allocator, "{s}@github:{s}/{s}#{s}", .{ git_pkg_name, git_parsed.owner, git_parsed.repo, git_parsed.commit });
                        try package_id_map.put(name_key2, pkg_index.meta.id);

                        package_id += 1;
                        continue;
                    }
                }

                continue;
            }

            const base_pkg_path_v6 = try std.fmt.allocPrint(allocator, "/{s}@{s}", .{ permanent_name_str, permanent_version_str });
            defer allocator.free(base_pkg_path_v6);
            const base_pkg_path_v9 = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ permanent_name_str, permanent_version_str });
            defer allocator.free(base_pkg_path_v9);

            const pkg_metadata = package_metadata_map.get(pkg_path_raw) orelse
                package_metadata_map.get(base_pkg_path_v6) orelse
                package_metadata_map.get(base_pkg_path_v9) orelse
                pkg_instance;

            var canonical_version: []const u8 = permanent_version_str;
            var used_preferred: bool = false;

            if (preferred_versions.get(permanent_name_str)) |pref_ver| {
                canonical_version = pref_ver;
                used_preferred = true;
            }

            if (!used_preferred) {
                if (pkg_metadata.get("version")) |ver_obj_meta| {
                    if (ver_obj_meta.data == .e_string) {
                        const vmeta = ver_obj_meta.data.e_string.data;
                        const stored_vmeta = try string_buf.append(vmeta);
                        canonical_version = stored_vmeta.slice(string_buf.bytes.items);
                        used_preferred = true;
                    }
                }
            }

            const resolution = if (pkg_metadata.get("resolution")) |res_obj| blk: {
                if (res_obj.data == .e_object) {
                    const res = res_obj.data.e_object;

                    var use_url: ?String = null;

                    if (res.get("tarball")) |tarball_expr| {
                        if (tarball_expr.data == .e_string) {
                            const tar = tarball_expr.data.e_string.data;
                            use_url = try string_buf.append(tar);
                        }
                    }

                    const resolution_url = blk_url: {
                        if (use_url) |u| break :blk_url u;
                        const registry = manager.scopeForPackageName(permanent_name_str).url.href;
                        const short_name = if (strings.lastIndexOfChar(permanent_name_str, '/')) |idx|
                            permanent_name_str[idx + "/".len ..]
                        else
                            permanent_name_str;

                        const url = try std.fmt.allocPrint(allocator, "{s}{s}/-/{s}-{s}.tgz", .{ registry, permanent_name_str, short_name, canonical_version });
                        defer allocator.free(url);
                        break :blk_url try string_buf.append(url);
                    };

                    const stored_canonical = try string_buf.append(canonical_version);
                    const stored_canonical_str = stored_canonical.slice(string_buf.bytes.items);

                    const sliced_for_parse = Semver.SlicedString.init(stored_canonical_str, stored_canonical_str);
                    const parsed_version_result = Semver.Version.parse(sliced_for_parse);

                    var string_builder = this.stringBuilder();
                    const version_to_store = if (parsed_version_result.valid) blk_ver: {
                        const parsed_ver = parsed_version_result.version.min();

                        parsed_ver.count(stored_canonical_str, @TypeOf(&string_builder), &string_builder);

                        try string_builder.allocate();

                        const appended_version = parsed_ver.append(stored_canonical_str, @TypeOf(&string_builder), &string_builder);
                        break :blk_ver appended_version;
                    } else Semver.Version{};

                    break :blk Resolution.init(.{
                        .npm = .{
                            .url = resolution_url,
                            .version = version_to_store,
                        },
                    });
                }
                break :blk Resolution{};
            } else Resolution{};

            const integrity = if (pkg_metadata.get("resolution")) |res| blk: {
                if (res.data == .e_object) {
                    if (res.data.e_object.get("integrity")) |int| {
                        if (int.data == .e_string) {
                            break :blk Integrity.parse(int.data.e_string.data);
                        }
                    }
                }
                break :blk Integrity{};
            } else Integrity{};

            const deps_slice = Lockfile.DependencySlice{};
            const res_slice = Lockfile.PackageIDSlice{};

            const stored_name = try string_buf.append(permanent_name_str);
            const stored_name_str = stored_name.slice(string_buf.bytes.items);
            const final_name_hash = stringHash(stored_name_str);

            var arch_npm = Npm.Architecture.all;
            var os_npm = Npm.OperatingSystem.all;

            if (pkg_metadata.get("cpu")) |cpu_array| {
                if (cpu_array.data == .e_array and cpu_array.data.e_array.items.len > 0) {
                    var arch_negatable = Npm.Architecture.none.negatable();
                    for (cpu_array.data.e_array.items.slice()) |item| {
                        if (item.data == .e_string) {
                            arch_negatable.apply(item.data.e_string.data);
                        }
                    }
                    arch_npm = arch_negatable.combine();
                }
            }

            if (pkg_metadata.get("os")) |os_array| {
                if (os_array.data == .e_array and os_array.data.e_array.items.len > 0) {
                    var os_negatable = Npm.OperatingSystem.none.negatable();
                    for (os_array.data.e_array.items.slice()) |item| {
                        if (item.data == .e_string) {
                            os_negatable.apply(item.data.e_string.data);
                        }
                    }
                    os_npm = os_negatable.combine();
                }
            }

            const actual_pkg_id = try this.appendPackage(.{
                .name = stored_name,
                .name_hash = final_name_hash,
                .resolution = resolution,
                .meta = .{
                    .id = package_id,
                    .origin = if (resolution.tag == .workspace) .local else .npm,
                    .arch = arch_npm,
                    .os = os_npm,
                    .integrity = integrity,
                },
                .dependencies = deps_slice,
                .resolutions = res_slice,
                .bin = Bin.init(),
            });

            try this.getOrPutID(actual_pkg_id.meta.id, final_name_hash);

            const pkg_path_key = try allocator.dupe(u8, pkg_path_str);
            try package_id_map.put(pkg_path_key, actual_pkg_id.meta.id);

            const pkg_key_str = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ permanent_name_str, canonical_version });

            try package_id_map.put(pkg_key_str, actual_pkg_id.meta.id);

            package_id += 1;
        }
    } // End of merged packages/snapshots processing

    if (pnpm.snapshots) |snapshots_metadata| {
        for (snapshots_metadata.properties.slice()) |entry| {
            const pkg_path_raw = entry.key.?.asString(allocator) orelse continue;
            if (entry.value == null or entry.value.?.data != .e_object) continue;
            const pkg_instance = entry.value.?.data.e_object;

            if (!package_id_map.contains(pkg_path_raw)) {
                continue;
            }

            const parsed = PnpmPackagePath.parse(pkg_path_raw);
            if (parsed.name.len == 0 or parsed.version.len == 0) {
                continue;
            }

            const permanent_name_str = parsed.name;
            const permanent_version_str = parsed.version;

            const base_pkg_path_v6 = try std.fmt.allocPrint(allocator, "/{s}@{s}", .{ permanent_name_str, permanent_version_str });
            defer allocator.free(base_pkg_path_v6);
            const base_pkg_path_v9 = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ permanent_name_str, permanent_version_str });
            defer allocator.free(base_pkg_path_v9);

            const pkg_metadata = package_metadata_map.get(pkg_path_raw) orelse
                package_metadata_map.get(base_pkg_path_v6) orelse
                package_metadata_map.get(base_pkg_path_v9) orelse
                pkg_instance;

            var canonical_version: []const u8 = permanent_version_str;
            if (preferred_versions.get(permanent_name_str)) |pref_ver| {
                canonical_version = pref_ver;
            } else if (pkg_metadata.get("version")) |ver_obj_meta| {
                if (ver_obj_meta.data == .e_string) {
                    canonical_version = ver_obj_meta.data.e_string.data;
                }
            }

            const has_bin = if (pkg_metadata.get("hasBin")) |bin_field| blk: {
                break :blk bin_field.data == .e_boolean and bin_field.data.e_boolean.value;
            } else false;

            if (has_bin) {
                const pkg_with_bin = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ permanent_name_str, canonical_version });
                try packages_with_bins.append(pkg_with_bin);
            }

            if (pkg_metadata.get("peerDependencies")) |peer_field| {
                if (peer_field.data == .e_object) {
                    var peer_set = bun.StringHashMap(bool).init(allocator);
                    var optional_set = bun.StringHashMap(bool).init(allocator);
                    var has_optional = false;

                    var peer_meta = bun.StringHashMap(bool).init(allocator);
                    defer peer_meta.deinit();

                    if (pkg_metadata.get("peerDependenciesMeta")) |peer_meta_field| {
                        if (peer_meta_field.data == .e_object) {
                            for (peer_meta_field.data.e_object.properties.slice()) |prop| {
                                const peer_name = prop.key.?.asString(allocator) orelse continue;

                                if (prop.value) |meta_value| {
                                    if (meta_value.data == .e_object) {
                                        if (meta_value.data.e_object.get("optional")) |optional_field| {
                                            const is_optional = optional_field.asBool() orelse false;
                                            if (is_optional) {
                                                try peer_meta.put(peer_name, true);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    for (peer_field.data.e_object.properties.slice()) |peer_prop| {
                        const peer_name = peer_prop.key.?.asString(allocator) orelse continue;
                        try peer_set.put(peer_name, true);

                        if (peer_meta.get(peer_name) != null) {
                            try optional_set.put(peer_name, true);
                            has_optional = true;
                        }
                    }

                    const key_with_version = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ permanent_name_str, canonical_version });

                    if (peer_set.count() > 0) {
                        try peer_dependencies_map.put(key_with_version, peer_set);
                    }

                    if (has_optional) {
                        try optional_peer_dependencies_map.put(key_with_version, optional_set);
                    }
                }
            }
        }
    }

    var total_dependencies: u32 = 0;

    if (pnpm.importers) |importers| {
        for (importers.properties.slice()) |importer_entry| {
            if (importer_entry.value == null or importer_entry.value.?.data != .e_object) continue;
            const importer = importer_entry.value.?.data.e_object;

            const dep_types = [_][]const u8{ "dependencies", "devDependencies", "optionalDependencies", "peerDependencies" };
            for (dep_types) |dep_type| {
                if (importer.get(dep_type)) |deps| {
                    if (deps.data == .e_object) {
                        total_dependencies += @intCast(deps.data.e_object.properties.len);
                    }
                }
            }
        }
    }

    if (pnpm.snapshots) |snapshots| {
        for (snapshots.properties.slice()) |snapshot_entry| {
            if (snapshot_entry.value == null or snapshot_entry.value.?.data != .e_object) continue;
            const snapshot = snapshot_entry.value.?.data.e_object;

            const dep_types = [_][]const u8{ "dependencies", "devDependencies", "optionalDependencies", "peerDependencies" };
            for (dep_types) |dep_type| {
                if (snapshot.get(dep_type)) |deps| {
                    if (deps.data == .e_object) {
                        total_dependencies += @intCast(deps.data.e_object.properties.len);
                    }
                }
            }
        }
    }

    try this.buffers.dependencies.ensureTotalCapacity(allocator, total_dependencies);
    try this.buffers.resolutions.ensureTotalCapacity(allocator, total_dependencies);

    if (pnpm.importers) |importers_for_prematerialize| {
        for (importers_for_prematerialize.properties.slice()) |importer_entry| {
            _ = importer_entry.key.?.asString(allocator) orelse continue;
            if (importer_entry.value == null or importer_entry.value.?.data != .e_object) continue;
            const importer_pm = importer_entry.value.?.data.e_object;

            const dep_types_pm = [_][]const u8{ "dependencies", "devDependencies", "optionalDependencies", "peerDependencies" };
            for (dep_types_pm) |dep_type_pm| {
                if (importer_pm.get(dep_type_pm)) |deps_obj| {
                    if (deps_obj.data != .e_object) continue;
                    for (deps_obj.data.e_object.properties.slice()) |dep_entry| {
                        const dep_name_pm = dep_entry.key.?.asString(allocator) orelse continue;
                        if (dep_entry.value == null or dep_entry.value.?.data != .e_object) continue;
                        const dep_obj_pm = dep_entry.value.?.data.e_object;

                        const resolved_version_pm = if (dep_obj_pm.get("version")) |ver_obj| (if (ver_obj.data == .e_string) ver_obj.data.e_string.data else continue) else continue;
                        const specifier_pm = if (dep_obj_pm.get("specifier")) |spec_obj| (if (spec_obj.data == .e_string) spec_obj.data.e_string.data else "") else "";

                        var lookup_name_pm: []const u8 = dep_name_pm;
                        var lookup_version_pm: []const u8 = resolved_version_pm;

                        if (strings.containsComptime(resolved_version_pm, "github.com") or
                            strings.containsComptime(resolved_version_pm, "https://codeload.github.com"))
                        {
                            continue;
                        }

                        if (strings.hasPrefixComptime(resolved_version_pm, "file:") or
                            strings.hasPrefixComptime(resolved_version_pm, "link:"))
                        {
                            continue;
                        }

                        if (strings.hasPrefixComptime(specifier_pm, "npm:")) {
                            if (parseNpmAliasSpecifier(specifier_pm)) |alias| {
                                lookup_name_pm = alias.package;
                                lookup_version_pm = alias.version;
                            }
                        } else if (isLikelyExactVersion(specifier_pm)) {
                            lookup_version_pm = specifier_pm;
                        }

                        if (strings.hasPrefixComptime(lookup_version_pm, "workspace:")) continue;
                        if (lookup_name_pm.len == 0 or lookup_version_pm.len == 0) continue;

                        const key1_pm = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ lookup_name_pm, lookup_version_pm });
                        defer allocator.free(key1_pm);
                        if (package_id_map.get(key1_pm)) |_| continue;
                        const key2_pm = try std.fmt.allocPrint(allocator, "/{s}@{s}", .{ lookup_name_pm, lookup_version_pm });
                        defer allocator.free(key2_pm);
                        if (package_id_map.get(key2_pm)) |_| continue;

                        var integrity_pm: Integrity = Integrity{};
                        var url_from_meta_pm: ?String = null;
                        var arch_peer = Npm.Architecture.all;
                        var os_peer = Npm.OperatingSystem.all;
                        var version_from_meta_pm: ?[]const u8 = null;
                        if (pnpm.packages) |packages_section_pm| {
                            if (packages_section_pm.get(key2_pm) orelse packages_section_pm.get(key1_pm)) |meta_pm| {
                                if (meta_pm.data == .e_object) {
                                    if (meta_pm.data.e_object.get("resolution")) |res_pm| {
                                        if (res_pm.data == .e_object) {
                                            if (res_pm.data.e_object.get("integrity")) |int_pm| {
                                                if (int_pm.data == .e_string) {
                                                    integrity_pm = Integrity.parse(int_pm.data.e_string.data);
                                                }
                                            }

                                            if (res_pm.data.e_object.get("tarball")) |t_obj| {
                                                if (t_obj.data == .e_string) {
                                                    url_from_meta_pm = string_buf.append(t_obj.data.e_string.data) catch null;
                                                }
                                            }
                                        }
                                    }
                                }

                                // Extract version from peer dependency metadata
                                if (meta_pm.data.e_object.get("version")) |ver_obj| {
                                    if (ver_obj.data == .e_string and ver_obj.data.e_string.data.len > 0) {
                                        version_from_meta_pm = ver_obj.data.e_string.data;
                                    }
                                }

                                // Extract OS/CPU constraints from peer dependency metadata
                                if (meta_pm.data.e_object.get("cpu")) |cpu_array| {
                                    if (cpu_array.data == .e_array and cpu_array.data.e_array.items.len > 0) {
                                        var arch_negatable = Npm.Architecture.none.negatable();
                                        for (cpu_array.data.e_array.items.slice()) |item| {
                                            if (item.data == .e_string) {
                                                arch_negatable.apply(item.data.e_string.data);
                                            }
                                        }
                                        arch_peer = arch_negatable.combine();
                                    }
                                }

                                if (meta_pm.data.e_object.get("os")) |os_array| {
                                    if (os_array.data == .e_array and os_array.data.e_array.items.len > 0) {
                                        var os_negatable = Npm.OperatingSystem.none.negatable();
                                        for (os_array.data.e_array.items.slice()) |item| {
                                            if (item.data == .e_string) {
                                                os_negatable.apply(item.data.e_string.data);
                                            }
                                        }
                                        os_peer = os_negatable.combine();
                                    }
                                }
                            }
                        }

                        if (strings.hasPrefixComptime(specifier_pm, "npm:") and !isLikelyExactVersion(lookup_version_pm)) {
                            const name_key_pm = try allocator.dupe(u8, lookup_name_pm);
                            const ver_val_pm = try allocator.dupe(u8, lookup_version_pm);
                            try preferred_versions.put(name_key_pm, ver_val_pm);
                            continue;
                        }

                        const registry_href_pm = manager.scopeForPackageName(lookup_name_pm).url.href;
                        const short_name_pm = if (strings.lastIndexOfChar(lookup_name_pm, '/')) |idx| lookup_name_pm[idx + "/".len ..] else lookup_name_pm;

                        const tar_url_pm = if (url_from_meta_pm) |u| u else blk_tar_pm: {
                            const version_for_url_pm = version_from_meta_pm orelse lookup_version_pm;
                            const u = try std.fmt.allocPrint(allocator, "{s}{s}/-/{s}-{s}.tgz", .{ registry_href_pm, lookup_name_pm, short_name_pm, version_for_url_pm });
                            defer allocator.free(u);
                            break :blk_tar_pm try string_buf.append(u);
                        };

                        const name_str_pm = try string_buf.append(lookup_name_pm);
                        const name_str_pm_str = name_str_pm.slice(string_buf.bytes.items);
                        const name_hash_pm = stringHash(name_str_pm_str);
                        const url_str_pm = tar_url_pm;
                        const actual_version_pm = version_from_meta_pm orelse lookup_version_pm;
                        const stored_ver_pm = try string_buf.append(actual_version_pm);
                        const ver_sliced_pm = Semver.SlicedString.init(stored_ver_pm.slice(string_buf.bytes.items), stored_ver_pm.slice(string_buf.bytes.items));
                        const ver_parsed_pm = Semver.Version.parse(ver_sliced_pm);

                        const actual_id_pm = try this.appendPackage(.{
                            .name = name_str_pm,
                            .name_hash = name_hash_pm,
                            .resolution = Resolution.init(.{ .npm = .{ .url = url_str_pm, .version = if (ver_parsed_pm.valid) ver_parsed_pm.version.min() else Semver.Version{} } }),
                            .meta = .{ .id = package_id, .origin = .npm, .arch = arch_peer, .os = os_peer, .integrity = integrity_pm },
                            .dependencies = .{},
                            .resolutions = .{},
                            .bin = Bin.init(),
                        });

                        try this.getOrPutID(actual_id_pm.meta.id, name_hash_pm);

                        const name_key_pm = try allocator.dupe(u8, lookup_name_pm);
                        const ver_val_pm = try allocator.dupe(u8, lookup_version_pm);
                        try preferred_versions.put(name_key_pm, ver_val_pm);

                        const map_key1_pm = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ lookup_name_pm, lookup_version_pm });

                        try package_id_map.put(map_key1_pm, actual_id_pm.meta.id);
                        const map_key2_pm = try std.fmt.allocPrint(allocator, "/{s}@{s}", .{ lookup_name_pm, lookup_version_pm });

                        try package_id_map.put(map_key2_pm, actual_id_pm.meta.id);

                        package_id += 1;
                    }
                }
            }
        }
    }

    if (pnpm.importers) |importers| {
        var root_dep_names = bun.StringHashMap(void).init(allocator);
        defer root_dep_names.deinit();
        var root_deps_list = std.ArrayList(Dependency).init(allocator);
        defer root_deps_list.deinit();
        var root_resolutions_list = std.ArrayList(Install.PackageID).init(allocator);
        defer root_resolutions_list.deinit();

        for (importers.properties.slice()) |importer_entry| {
            const importer_path = importer_entry.key.?.asString(allocator) orelse continue;
            if (importer_entry.value == null or importer_entry.value.?.data != .e_object) continue;
            const importer = importer_entry.value.?.data.e_object;

            const importer_pkg_id = if (strings.eqlComptime(importer_path, "."))
                0 // Root package
            else blk: {
                if (package_id_map.get(importer_path)) |existing_id| {
                    break :blk existing_id;
                }

                const workspace_name = try string_buf.append(importer_path);
                const workspace_name_hash = stringHash(importer_path);

                const workspace_pkg = try this.appendPackage(.{
                    .name = workspace_name,
                    .name_hash = workspace_name_hash,
                    .resolution = Resolution.init(.{
                        .workspace = workspace_name,
                    }),
                    .meta = .{
                        .id = package_id,
                        .origin = .local,
                        .arch = Npm.Architecture.all,
                        .os = Npm.OperatingSystem.all,
                        .integrity = Integrity{},
                    },
                    .dependencies = .{},
                    .resolutions = .{},
                    .bin = Bin.init(),
                });

                try this.getOrPutID(workspace_pkg.meta.id, workspace_name_hash);
                const key = try allocator.dupe(u8, importer_path);
                try package_id_map.put(key, workspace_pkg.meta.id);
                package_id += 1;

                break :blk workspace_pkg.meta.id;
            };

            var all_dependencies = std.ArrayList(Dependency).init(allocator);
            var all_resolutions = std.ArrayList(Install.PackageID).init(allocator);
            defer all_dependencies.deinit();
            defer all_resolutions.deinit();

            const is_root = importer_pkg_id == 0;

            const dep_types = [_][]const u8{ "dependencies", "devDependencies", "optionalDependencies", "peerDependencies" };
            for (dep_types) |dep_type| {
                if (importer.get(dep_type)) |deps| {
                    if (deps.data == .e_object) {
                        for (deps.data.e_object.properties.slice()) |dep_entry| {
                            const dep_name = dep_entry.key.?.asString(allocator) orelse continue;
                            if (dep_entry.value == null or dep_entry.value.?.data != .e_object) continue;

                            const dep_obj = dep_entry.value.?.data.e_object;
                            const specifier = if (dep_obj.get("specifier")) |spec|
                                (if (spec.data == .e_string) spec.data.e_string.data else continue)
                            else
                                continue;

                            const version_raw = if (dep_obj.get("version")) |ver|
                                (if (ver.data == .e_string) ver.data.e_string.data else continue)
                            else
                                continue;

                            const version = if (strings.indexOfChar(version_raw, '(')) |paren_idx|
                                version_raw[0..paren_idx]
                            else
                                version_raw;

                            const should_be_peer = strings.eqlComptime(dep_type, "peerDependencies");

                            var is_optional_peer = false;
                            if (should_be_peer) {
                                if (package_optional_peers.get(importer_path)) |optional_set| {
                                    if (optional_set.get(dep_name) != null) {
                                        is_optional_peer = true;
                                    }
                                }
                            }

                            const is_workspace_dep = package_id_map.contains(dep_name) or
                                workspace_actual_names.contains(dep_name);

                            var actual_specifier = specifier;

                            if (strings.hasPrefixComptime(specifier, "catalog:")) {
                                actual_specifier = version;
                            }
                            if (!should_be_peer and is_workspace_dep and !strings.hasPrefixComptime(specifier, "workspace:")) {
                                actual_specifier = "workspace:*";
                            }

                            if (!should_be_peer and (strings.hasPrefixComptime(specifier, "file:") or strings.hasPrefixComptime(specifier, "link:"))) {
                                const local_path = specifier["file:".len..];

                                const points_to_workspace = package_id_map.contains(local_path) or
                                    workspace_actual_names.contains(local_path);

                                if (points_to_workspace) {
                                    actual_specifier = "workspace:*";
                                }
                            }

                            var final_specifier = actual_specifier;

                            const is_github_dep = strings.containsComptime(specifier, "#") and
                                (strings.containsComptime(specifier, "/") or strings.containsComptime(version_raw, "github.com") or
                                    strings.containsComptime(version_raw, "https://"));

                            if (is_github_dep) {
                                final_specifier = specifier;
                            }

                            var dependency = Dependency{
                                .name = try string_buf.append(dep_name),
                                .name_hash = stringHash(dep_name),
                                .version = Dependency.Version{
                                    .literal = try string_buf.append(final_specifier),
                                },
                                .behavior = .{
                                    .prod = strings.eqlComptime(dep_type, "dependencies") and !should_be_peer,
                                    .dev = strings.eqlComptime(dep_type, "devDependencies"),
                                    .optional = strings.eqlComptime(dep_type, "optionalDependencies") or is_optional_peer,
                                    .peer = should_be_peer,
                                    .workspace = false,
                                },
                            };

                            if (strings.hasPrefixComptime(actual_specifier, "workspace:")) {
                                dependency.version = .{
                                    .tag = .workspace,
                                    .literal = try string_buf.append(actual_specifier),
                                    .value = .{ .workspace = try string_buf.append("*") },
                                };
                                dependency.behavior.workspace = true;
                            } else if (strings.hasPrefixComptime(version, "link:")) {
                                dependency.version = .{
                                    .tag = .workspace,
                                    .literal = try string_buf.append("workspace:*"),
                                    .value = .{ .workspace = try string_buf.append("*") },
                                };
                                dependency.behavior.workspace = true;
                            } else {
                                const stored_spec = try string_buf.append(actual_specifier);
                                const stored_spec_str = stored_spec.slice(string_buf.bytes.items);
                                const sliced = Semver.SlicedString.init(stored_spec_str, stored_spec_str);
                                var parsed_version = Dependency.parse(
                                    allocator,
                                    dependency.name,
                                    dependency.name_hash,
                                    stored_spec_str,
                                    &sliced,
                                    log,
                                    manager,
                                ) orelse Dependency.Version{};

                                parsed_version.literal = dependency.version.literal;
                                dependency.version = parsed_version;
                            }

                            var resolved_pkg_id: ?Install.PackageID = null;

                            if (is_github_dep and strings.containsComptime(version_raw, "https://")) {
                                resolved_pkg_id = package_id_map.get(version_raw);
                                if (resolved_pkg_id == null) {
                                    const with_name = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep_name, version_raw });
                                    defer allocator.free(with_name);
                                    resolved_pkg_id = package_id_map.get(with_name);
                                }
                            }

                            if (resolved_pkg_id == null and dependency.behavior.workspace) {
                                resolved_pkg_id = package_id_map.get(dep_name);

                                if (resolved_pkg_id == null) {
                                    if (strings.indexOfChar(dep_name, '/')) |slash_pos| {
                                        const name_part = dep_name[slash_pos + "/".len ..];

                                        const pkg_path = try std.fmt.allocPrint(allocator, "packages/{s}", .{name_part});
                                        defer allocator.free(pkg_path);
                                        resolved_pkg_id = package_id_map.get(pkg_path);

                                        if (resolved_pkg_id == null) {
                                            const full_pkg_path = try std.fmt.allocPrint(allocator, "packages/{s}", .{dep_name});
                                            defer allocator.free(full_pkg_path);
                                            resolved_pkg_id = package_id_map.get(full_pkg_path);
                                        }
                                    }
                                }
                            } else {
                                var lookup_name: []const u8 = dep_name;

                                var lookup_version: []const u8 = version;
                                const ver_obj2_opt = dep_obj.get("version");
                                const spec_is_alias = strings.hasPrefixComptime(specifier, "npm:");
                                if (spec_is_alias) {
                                    if (ver_obj2_opt) |ver_obj2| {
                                        if (ver_obj2.data == .e_string) {
                                            const v = ver_obj2.data.e_string.data;
                                            if (parseNameAtVersion(v)) |nv| {
                                                lookup_name = nv.name;
                                                lookup_version = nv.version;
                                            } else if (parseNpmAliasSpecifier(specifier)) |alias| {
                                                lookup_name = alias.package;
                                                lookup_version = alias.version;
                                            }
                                        }
                                    }
                                } else if (isLikelyExactVersion(specifier)) {
                                    lookup_version = specifier;
                                } else if (ver_obj2_opt) |ver_obj2| {
                                    if (ver_obj2.data == .e_string and ver_obj2.data.e_string.data.len != 0) lookup_version = ver_obj2.data.e_string.data;
                                }

                                const pkg_key_buf = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ lookup_name, lookup_version });
                                defer allocator.free(pkg_key_buf);

                                resolved_pkg_id = package_id_map.get(pkg_key_buf);

                                if (resolved_pkg_id == null) {
                                    const v6_key = try std.fmt.allocPrint(allocator, "/{s}@{s}", .{ lookup_name, lookup_version });
                                    defer allocator.free(v6_key);
                                    resolved_pkg_id = package_id_map.get(v6_key);
                                }

                                if (resolved_pkg_id == null and (strings.hasPrefixComptime(lookup_version, "file:") or strings.hasPrefixComptime(lookup_version, "link:"))) {
                                    resolved_pkg_id = package_id_map.get(lookup_version);

                                    if (resolved_pkg_id == null) {
                                        if (strings.hasPrefixComptime(lookup_version, "file:./")) {
                                            const normalized = try std.fmt.allocPrint(allocator, "file:{s}", .{lookup_version[7..]});
                                            defer allocator.free(normalized);
                                            resolved_pkg_id = package_id_map.get(normalized);
                                        } else if (strings.hasPrefixComptime(lookup_version, "link:./")) {
                                            const normalized = try std.fmt.allocPrint(allocator, "link:{s}", .{lookup_version[7..]});
                                            defer allocator.free(normalized);
                                            resolved_pkg_id = package_id_map.get(normalized);
                                        }
                                    }

                                    if (resolved_pkg_id == null) {
                                        if (strings.hasPrefixComptime(lookup_version, "file:") and !strings.hasPrefixComptime(lookup_version, "file:./")) {
                                            const with_dot_slash = try std.fmt.allocPrint(allocator, "file:./{s}", .{lookup_version[5..]});
                                            defer allocator.free(with_dot_slash);
                                            resolved_pkg_id = package_id_map.get(with_dot_slash);
                                        } else if (strings.hasPrefixComptime(lookup_version, "link:") and !strings.hasPrefixComptime(lookup_version, "link:./")) {
                                            const with_dot_slash = try std.fmt.allocPrint(allocator, "link:./{s}", .{lookup_version[5..]});
                                            defer allocator.free(with_dot_slash);
                                            resolved_pkg_id = package_id_map.get(with_dot_slash);
                                        }
                                    }
                                }

                                if (resolved_pkg_id == null and (strings.containsComptime(version_raw, "github.com") or strings.containsComptime(version_raw, "https://"))) {
                                    resolved_pkg_id = package_id_map.get(version_raw);
                                    if (resolved_pkg_id == null) {
                                        const with_name = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep_name, version_raw });
                                        defer allocator.free(with_name);
                                        resolved_pkg_id = package_id_map.get(with_name);
                                    }

                                    if (resolved_pkg_id == null) {
                                        var iter = package_id_map.iterator();
                                        while (iter.next()) |entry| {
                                            if (strings.hasPrefix(entry.key_ptr.*, dep_name) and
                                                strings.containsComptime(entry.key_ptr.*, "https://"))
                                            {
                                                resolved_pkg_id = entry.value_ptr.*;
                                                break;
                                            }
                                        }
                                    }
                                }

                                if (resolved_pkg_id == null and strings.containsComptime(specifier, "#")) {
                                    var iter = package_id_map.iterator();
                                    while (iter.next()) |entry| {
                                        if (strings.containsComptime(entry.key_ptr.*, "github.com") and
                                            strings.contains(entry.key_ptr.*, dep_name))
                                        {
                                            resolved_pkg_id = entry.value_ptr.*;
                                            break;
                                        }
                                    }
                                }

                                if (resolved_pkg_id == null) {
                                    const is_github_version = strings.containsComptime(version_raw, "github.com") or
                                        strings.containsComptime(version_raw, "https://codeload.github.com") or
                                        strings.hasPrefixComptime(version_raw, "github:");

                                    if (is_github_version) {
                                        var found_github_pkg: ?Install.PackageID = null;
                                        var pkg_id: Install.PackageID = 0;
                                        while (pkg_id < this.packages.len) : (pkg_id += 1) {
                                            const pkg = this.packages.get(pkg_id);
                                            const pkg_name = pkg.name.slice(this.buffers.string_bytes.items);
                                            if (strings.eql(pkg_name, dep_name) and pkg.resolution.tag == .github) {
                                                found_github_pkg = pkg_id;
                                                break;
                                            }
                                        }

                                        if (found_github_pkg) |github_pkg_id| {
                                            resolved_pkg_id = github_pkg_id;
                                        } else {
                                            var map_iter = package_id_map.iterator();
                                            var count: usize = 0;
                                            while (map_iter.next()) |entry| {
                                                if (strings.contains(entry.key_ptr.*, dep_name) or strings.contains(entry.key_ptr.*, "ci-info")) {
                                                    count += 1;
                                                }
                                            }
                                            continue;
                                        }
                                    }

                                    var integrity_val: Integrity = Integrity{};
                                    var url_from_meta: ?String = null;
                                    var actual_version_from_meta: ?[]const u8 = null;
                                    var arch_from_meta = Npm.Architecture.all;
                                    var os_from_meta = Npm.OperatingSystem.all;

                                    if (pnpm.packages) |packages_section2| {
                                        const k1 = pkg_key_buf;
                                        const k2 = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ lookup_name, lookup_version });
                                        defer allocator.free(k2);

                                        var meta_obj = packages_section2.get(k1) orelse packages_section2.get(k2);

                                        if (meta_obj == null and strings.hasPrefixComptime(specifier, "catalog:")) {
                                            const catalog_spec = specifier["catalog:".len..];

                                            var catalog_iter = catalog_map.iterator();
                                            while (catalog_iter.next()) |entry| {
                                                const catalog_key = entry.key_ptr.*;

                                                if (strings.hasPrefixComptime(catalog_key, "catalog:") and
                                                    strings.contains(catalog_key, catalog_spec))
                                                {
                                                    const last_colon = strings.lastIndexOfChar(catalog_key, ':') orelse continue;
                                                    const actual_pkg_name = catalog_key[last_colon + 1 ..];

                                                    const actual_key = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ actual_pkg_name, lookup_version });
                                                    defer allocator.free(actual_key);
                                                    meta_obj = packages_section2.get(actual_key);
                                                    if (meta_obj != null) {
                                                        break;
                                                    }
                                                }
                                            }
                                        }

                                        if (meta_obj) |m| {
                                            if (m.data == .e_object) {
                                                if (m.data.e_object.get("resolution")) |res_obj| {
                                                    if (res_obj.data == .e_object) {
                                                        if (res_obj.data.e_object.get("integrity")) |int_obj| {
                                                            if (int_obj.data == .e_string) {
                                                                integrity_val = Integrity.parse(int_obj.data.e_string.data);
                                                            }
                                                        }

                                                        if (res_obj.data.e_object.get("tarball")) |t_obj| {
                                                            if (t_obj.data == .e_string) {
                                                                url_from_meta = string_buf.append(t_obj.data.e_string.data) catch null;
                                                            }
                                                        }
                                                    }
                                                }

                                                // Extract version from metadata
                                                if (m.data.e_object.get("version")) |ver_obj| {
                                                    if (ver_obj.data == .e_string and ver_obj.data.e_string.data.len > 0) {
                                                        actual_version_from_meta = ver_obj.data.e_string.data;
                                                    }
                                                }

                                                // Extract OS/CPU constraints from metadata
                                                if (m.data.e_object.get("cpu")) |cpu_array| {
                                                    if (cpu_array.data == .e_array and cpu_array.data.e_array.items.len > 0) {
                                                        var arch_negatable = Npm.Architecture.none.negatable();
                                                        for (cpu_array.data.e_array.items.slice()) |item| {
                                                            if (item.data == .e_string) {
                                                                arch_negatable.apply(item.data.e_string.data);
                                                            }
                                                        }
                                                        arch_from_meta = arch_negatable.combine();
                                                    }
                                                }

                                                if (m.data.e_object.get("os")) |os_array| {
                                                    if (os_array.data == .e_array and os_array.data.e_array.items.len > 0) {
                                                        var os_negatable = Npm.OperatingSystem.none.negatable();
                                                        for (os_array.data.e_array.items.slice()) |item| {
                                                            if (item.data == .e_string) {
                                                                os_negatable.apply(item.data.e_string.data);
                                                            }
                                                        }
                                                        os_from_meta = os_negatable.combine();
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    const registry_href = manager.scopeForPackageName(lookup_name).url.href;
                                    const short_name = if (strings.lastIndexOfChar(lookup_name, '/')) |idx| lookup_name[idx + "/".len ..] else lookup_name;

                                    const tar_url = if (url_from_meta) |u| u else blk_tar: {
                                        const version_for_url = actual_version_from_meta orelse lookup_version;
                                        const u = try std.fmt.allocPrint(allocator, "{s}{s}/-/{s}-{s}.tgz", .{ registry_href, lookup_name, short_name, version_for_url });
                                        defer allocator.free(u);
                                        break :blk_tar try string_buf.append(u);
                                    };

                                    const name_str2 = try string_buf.append(lookup_name);
                                    const name_str2_str = name_str2.slice(string_buf.bytes.items);
                                    const name_hash2 = stringHash(name_str2_str);

                                    // Use the actual version from metadata if available
                                    const actual_version = actual_version_from_meta orelse lookup_version;
                                    const stored_ver = try string_buf.append(actual_version);
                                    const stored_ver_str = stored_ver.slice(string_buf.bytes.items);
                                    const ver_sliced = Semver.SlicedString.init(stored_ver_str, stored_ver_str);
                                    const ver_parsed = Semver.Version.parse(ver_sliced);

                                    const npm_version = if (ver_parsed.valid) ver_parsed.version.min() else Semver.Version{};

                                    const actual_id2 = try this.appendPackage(.{
                                        .name = name_str2,
                                        .name_hash = name_hash2,
                                        .resolution = Resolution.init(.{ .npm = .{ .url = tar_url, .version = npm_version } }),
                                        .meta = .{ .id = package_id, .origin = .npm, .arch = arch_from_meta, .os = os_from_meta, .integrity = integrity_val },
                                        .dependencies = .{},
                                        .resolutions = .{},
                                        .bin = Bin.init(),
                                    });

                                    try this.getOrPutID(actual_id2.meta.id, name_hash2);

                                    const base_key = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ lookup_name, lookup_version });

                                    try package_id_map.put(base_key, actual_id2.meta.id);
                                    const base_key_v6 = try std.fmt.allocPrint(allocator, "/{s}@{s}", .{ lookup_name, lookup_version });

                                    try package_id_map.put(base_key_v6, actual_id2.meta.id);

                                    resolved_pkg_id = actual_id2.meta.id;
                                    package_id += 1;
                                }
                            }

                            if (resolved_pkg_id) |pkg_id| {
                                try all_dependencies.append(dependency);
                                try all_resolutions.append(pkg_id);

                                if (is_root) {
                                    if (root_dep_names.get(dep_name) == null) {
                                        try root_dep_names.put(dep_name, {});
                                        try root_deps_list.append(dependency);
                                        try root_resolutions_list.append(pkg_id);
                                    } else {
                                        for (root_deps_list.items) |*existing_dep| {
                                            if (existing_dep.name_hash == dependency.name_hash) {
                                                existing_dep.behavior.dev = existing_dep.behavior.dev or dependency.behavior.dev;
                                                existing_dep.behavior.optional = existing_dep.behavior.optional or dependency.behavior.optional;
                                                existing_dep.behavior.peer = existing_dep.behavior.peer or dependency.behavior.peer;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (!is_root) {
                if (package_peer_deps.get(importer_path)) |peer_set| {
                    var added_peers = bun.StringHashMap(bool).init(allocator);
                    defer added_peers.deinit();

                    var regular_and_peer = bun.StringHashMap(bool).init(allocator);
                    defer regular_and_peer.deinit();

                    var peer_resolutions = bun.StringHashMap(Install.PackageID).init(allocator);
                    defer peer_resolutions.deinit();

                    var filtered_deps = std.ArrayList(Dependency).init(allocator);
                    var filtered_resolutions = std.ArrayList(Install.PackageID).init(allocator);

                    for (all_dependencies.items, all_resolutions.items) |dep, res| {
                        const dep_name = dep.name.slice(string_buf.bytes.items);

                        const is_peer_in_pkg_json = peer_set.contains(dep_name);

                        if (is_peer_in_pkg_json) {
                            const duped_name = try allocator.dupe(u8, dep_name);
                            try peer_resolutions.put(duped_name, res);

                            if (dep.behavior.peer) {
                                try filtered_deps.append(dep);
                                try filtered_resolutions.append(res);
                                try added_peers.put(dep_name, true);
                            } else if (dep.behavior.dev) {
                                try filtered_deps.append(dep);
                                try filtered_resolutions.append(res);
                            } else {
                                try filtered_deps.append(dep);
                                try filtered_resolutions.append(res);

                                try regular_and_peer.put(dep_name, true);
                            }
                        } else {
                            try filtered_deps.append(dep);
                            try filtered_resolutions.append(res);
                        }
                    }

                    all_dependencies.deinit();
                    all_resolutions.deinit();
                    all_dependencies = filtered_deps;
                    all_resolutions = filtered_resolutions;

                    var peer_iter = peer_set.iterator();
                    while (peer_iter.next()) |peer_entry| {
                        const peer_name = peer_entry.key_ptr.*;

                        if (!added_peers.contains(peer_name)) {
                            var peer_spec: []const u8 = "*";
                            if (peer_version_specs.get(importer_path)) |spec_map| {
                                if (spec_map.get(peer_name)) |spec| {
                                    peer_spec = spec;
                                }
                            }

                            var dependency = Dependency{
                                .name = try string_buf.append(peer_name),
                                .name_hash = stringHash(peer_name),
                                .version = Dependency.Version{
                                    .literal = try string_buf.append(peer_spec),
                                },
                                .behavior = .{
                                    .peer = true,
                                    .optional = false,
                                    .workspace = false,
                                    .prod = false,
                                    .dev = false,
                                },
                            };

                            if (package_optional_peers.get(importer_path)) |optional_set| {
                                if (optional_set.get(peer_name) != null) {
                                    dependency.behavior.optional = true;
                                }
                            }

                            const stored_spec = dependency.version.literal;
                            const stored_spec_str = stored_spec.slice(string_buf.bytes.items);
                            const sliced = Semver.SlicedString.init(stored_spec_str, stored_spec_str);
                            var parsed_version = Dependency.parse(
                                allocator,
                                dependency.name,
                                dependency.name_hash,
                                stored_spec_str,
                                &sliced,
                                log,
                                manager,
                            ) orelse Dependency.Version{};
                            parsed_version.literal = dependency.version.literal;
                            dependency.version = parsed_version;

                            var resolved_pkg_id: ?Install.PackageID = null;

                            if (peer_resolutions.get(peer_name)) |id| {
                                resolved_pkg_id = id;
                            } else if (package_id_map.get(peer_name)) |id| {
                                resolved_pkg_id = id;
                            } else {
                                var ws_iter = workspace_actual_names.iterator();
                                while (ws_iter.next()) |ws_entry| {
                                    if (strings.eql(ws_entry.key_ptr.*, peer_name)) {
                                        if (package_id_map.get(ws_entry.value_ptr.*)) |id| {
                                            resolved_pkg_id = id;
                                            break;
                                        }
                                    }
                                }
                            }

                            if (resolved_pkg_id) |pkg_id| {
                                try all_dependencies.append(dependency);
                                try all_resolutions.append(pkg_id);
                            }
                        }
                    }
                }
            }

            if (!is_root) {
                var peer_count: usize = 0;
                for (all_dependencies.items) |dep| {
                    if (dep.behavior.peer) peer_count += 1;
                }
            }

            if (!is_root and all_dependencies.items.len > 0) {
                const deps_start = this.buffers.dependencies.items.len;
                const res_start = this.buffers.resolutions.items.len;

                try this.buffers.dependencies.appendSlice(allocator, all_dependencies.items);
                try this.buffers.resolutions.appendSlice(allocator, all_resolutions.items);

                this.packages.items(.dependencies)[importer_pkg_id] = .{
                    .off = @truncate(deps_start),
                    .len = @truncate(all_dependencies.items.len),
                };
                this.packages.items(.resolutions)[importer_pkg_id] = .{
                    .off = @truncate(res_start),
                    .len = @truncate(all_resolutions.items.len),
                };
            }
        }

        var workspace_deps = std.ArrayList(Dependency).init(allocator);
        var workspace_resolutions = std.ArrayList(Install.PackageID).init(allocator);
        defer workspace_deps.deinit();
        defer workspace_resolutions.deinit();

        const pkg_resolutions = this.packages.items(.resolution);
        const pkg_names = this.packages.items(.name);
        const pkg_name_hashes = this.packages.items(.name_hash);

        for (1..this.packages.len) |pkg_id_usize| {
            const pkg_id: Install.PackageID = @intCast(pkg_id_usize);
            const resolution = pkg_resolutions[pkg_id];

            if (resolution.tag == .workspace) {
                const name = pkg_names[pkg_id];
                const name_hash = pkg_name_hashes[pkg_id];

                const workspace_dep = Dependency{
                    .name = name,
                    .name_hash = name_hash,
                    .version = .{
                        .tag = .workspace,
                        .literal = try string_buf.append("workspace:*"),
                        .value = .{ .workspace = try string_buf.append("*") },
                    },
                    .behavior = .{ .workspace = true },
                };

                try workspace_deps.append(workspace_dep);
                try workspace_resolutions.append(pkg_id);
            }
        }

        try root_deps_list.appendSlice(workspace_deps.items);
        try root_resolutions_list.appendSlice(workspace_resolutions.items);

        if (root_deps_list.items.len > 0) {
            const deps_start = this.buffers.dependencies.items.len;
            const res_start = this.buffers.resolutions.items.len;
            try this.buffers.dependencies.appendSlice(allocator, root_deps_list.items);
            try this.buffers.resolutions.appendSlice(allocator, root_resolutions_list.items);
            this.packages.items(.dependencies)[0] = .{ .off = @truncate(deps_start), .len = @truncate(root_deps_list.items.len) };
            this.packages.items(.resolutions)[0] = .{ .off = @truncate(res_start), .len = @truncate(root_resolutions_list.items.len) };
        }
    }

    if (pnpm.snapshots) |snapshots| {
        for (snapshots.properties.slice()) |snapshot_entry| {
            const pkg_path = snapshot_entry.key.?.asString(allocator) orelse continue;
            if (snapshot_entry.value == null or snapshot_entry.value.?.data != .e_object) continue;
            const snapshot = snapshot_entry.value.?.data.e_object;

            const pkg_id = package_id_map.get(pkg_path);
            if (pkg_id == null) {
                continue;
            }

            const actual_pkg_id = pkg_id.?;

            var all_dependencies = std.ArrayList(Dependency).init(allocator);
            var all_resolutions = std.ArrayList(Install.PackageID).init(allocator);
            defer all_dependencies.deinit();
            defer all_resolutions.deinit();

            const dep_types = [_][]const u8{ "dependencies", "devDependencies", "optionalDependencies", "peerDependencies" };
            for (dep_types) |dep_type| {
                if (snapshot.get(dep_type)) |deps| {
                    if (deps.data == .e_object) {
                        for (deps.data.e_object.properties.slice()) |dep_entry| {
                            const dep_name = dep_entry.key.?.asString(allocator) orelse continue;
                            const dep_version = if (dep_entry.value) |val|
                                (if (val.data == .e_string) val.data.e_string.data else continue)
                            else
                                continue;

                            var lookup_name: []const u8 = dep_name;
                            // Strip patch_hash from version (e.g., "1.0.0(patch_hash=abc)" -> "1.0.0")
                            var lookup_version: []const u8 = if (strings.indexOfChar(dep_version, '(')) |paren_idx|
                                (if (strings.hasPrefixComptime(dep_version[paren_idx..], "(patch_hash="))
                                    dep_version[0..paren_idx]
                                else
                                    dep_version)
                            else
                                dep_version;

                            // Check if this is an npm alias (e.g., "string-width-cjs": "string-width@4.2.3")
                            var is_npm_alias = false;
                            var alias_target_name: []const u8 = "";
                            var alias_target_version: []const u8 = "";

                            if (parseNameAtVersion(dep_version)) |nv| {
                                if (!strings.eql(nv.name, dep_name) and nv.version.len > 0) {
                                    // This is an npm alias
                                    is_npm_alias = true;
                                    alias_target_name = nv.name;
                                    // Strip patch_hash from the parsed version
                                    alias_target_version = if (strings.indexOfChar(nv.version, '(')) |paren_idx|
                                        (if (strings.hasPrefixComptime(nv.version[paren_idx..], "(patch_hash="))
                                            nv.version[0..paren_idx]
                                        else
                                            nv.version)
                                    else
                                        nv.version;

                                    // For the lookup, we need to find the actual package
                                    lookup_name = nv.name;
                                    lookup_version = alias_target_version;
                                }
                            }

                            const dep_key = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ lookup_name, lookup_version });
                            defer allocator.free(dep_key);

                            if (package_id_map.get(dep_key)) |dep_pkg_id| {
                                const dep_name_hash = stringHash(dep_name);

                                const dep_name_str = try string_buf.appendWithHash(dep_name, dep_name_hash);

                                // For npm aliases, create the proper version spec
                                const version_spec = if (is_npm_alias) blk: {
                                    // Create "npm:package@version" format
                                    const alias_spec = try std.fmt.allocPrint(allocator, "npm:{s}@{s}", .{ alias_target_name, alias_target_version });
                                    defer allocator.free(alias_spec);
                                    break :blk try string_buf.append(alias_spec);
                                } else try string_buf.append(lookup_version);

                                const sliced = Semver.SlicedString.init(version_spec.slice(string_buf.bytes.items), version_spec.slice(string_buf.bytes.items));
                                const version_parsed = Dependency.parse(allocator, dep_name_str, dep_name_hash, version_spec.slice(string_buf.bytes.items), &sliced, log, manager) orelse Dependency.Version{};

                                var dependency = Dependency{
                                    .name = dep_name_str,
                                    .name_hash = dep_name_hash,
                                    .version = version_parsed,
                                    .behavior = blk_behavior: {
                                        var is_peer = strings.eqlComptime(dep_type, "peerDependencies");
                                        var is_optional_peer = false;

                                        if (!is_peer and strings.eqlComptime(dep_type, "dependencies")) {
                                            if (package_peer_deps.get(pkg_path)) |peer_set| {
                                                if (peer_set.get(dep_name) != null) {
                                                    is_peer = true;

                                                    if (package_optional_peers.get(pkg_path)) |optional_set| {
                                                        if (optional_set.get(dep_name) != null) {
                                                            is_optional_peer = true;
                                                        }
                                                    }
                                                }
                                            }
                                        }

                                        break :blk_behavior .{
                                            .prod = !is_peer and strings.eqlComptime(dep_type, "dependencies"),
                                            .dev = strings.eqlComptime(dep_type, "devDependencies"),
                                            .optional = strings.eqlComptime(dep_type, "optionalDependencies") or is_optional_peer,
                                            .peer = is_peer,
                                            .workspace = false,
                                        };
                                    },
                                };
                                // Use the proper literal (npm alias or regular version)
                                dependency.version.literal = version_spec;

                                try all_dependencies.append(dependency);
                                try all_resolutions.append(dep_pkg_id);

                                if (!strings.eql(lookup_name, dep_name)) {
                                    const alias_hash = stringHash(dep_name);
                                    try this.getOrPutID(dep_pkg_id, alias_hash);
                                }
                            }
                        }
                    }
                }
            }

            if (all_dependencies.items.len > 0) {
                const deps_start = this.buffers.dependencies.items.len;
                const res_start = this.buffers.resolutions.items.len;

                try this.buffers.dependencies.appendSlice(allocator, all_dependencies.items);
                try this.buffers.resolutions.appendSlice(allocator, all_resolutions.items);

                this.packages.items(.dependencies)[actual_pkg_id] = .{
                    .off = @truncate(deps_start),
                    .len = @truncate(all_dependencies.items.len),
                };
                this.packages.items(.resolutions)[actual_pkg_id] = .{
                    .off = @truncate(res_start),
                    .len = @truncate(all_resolutions.items.len),
                };
            }
        }
    }

    for (this.packages.items(.name_hash), 0..) |name_hash, pkg_id_usize| {
        const pkg_id = @as(Install.PackageID, @intCast(pkg_id_usize));
        if (pkg_id == 0) continue;

        try this.getOrPutID(pkg_id, name_hash);
    }

    if (pnpm.overrides) |overrides_obj| {
        try this.overrides.map.ensureTotalCapacity(allocator, overrides_obj.properties.len);

        for (overrides_obj.properties.slice()) |override_entry| {
            const pkg_name = override_entry.key.?.asString(allocator) orelse continue;
            const override_version = override_entry.value.?.asString(allocator) orelse continue;

            const name_hash = stringHash(pkg_name);
            const name_str = try string_buf.appendWithHash(pkg_name, name_hash);

            const stored_version = try string_buf.append(override_version);

            const version_literal = Dependency.Version{
                .tag = .uninitialized,
                .literal = stored_version,
                .value = .{ .uninitialized = {} },
            };

            const override_dep = Dependency{
                .name = name_str,
                .name_hash = name_hash,
                .version = version_literal,
                .behavior = .{},
            };

            try this.overrides.map.put(allocator, name_hash, override_dep);
        }
    }

    if (pnpm.patchedDependencies) |patched_deps_obj| {
        try this.patched_dependencies.ensureTotalCapacity(allocator, patched_deps_obj.properties.len);

        for (patched_deps_obj.properties.slice()) |patch_entry| {
            const pkg_spec = patch_entry.key.?.asString(allocator) orelse continue;
            const patch_value = patch_entry.value orelse continue;

            const patch_path = if (patch_value.data == .e_string)
                patch_value.data.e_string.data
            else if (patch_value.data == .e_object)
                if (patch_value.data.e_object.get("path")) |path_field|
                    (if (path_field.data == .e_string) path_field.data.e_string.data else continue)
                else
                    continue
            else
                continue;

            const combined_hash = stringHash(pkg_spec);

            const patch_dep = PatchedDep{
                .path = try string_buf.append(patch_path),
                .patchfile_hash_is_null = true,
                .__patchfile_hash = 0,
            };

            try this.patched_dependencies.put(allocator, combined_hash, patch_dep);
        }
    }

    try this.resolve(log);

    if (Environment.allow_assert) {
        try this.verifyData();
    }

    this.meta_hash = try this.generateMetaHash(false, this.packages.len);

    if (packages_with_bins.items.len > 0) {
        var bins_list = std.ArrayList(u8).init(allocator);
        defer bins_list.deinit();

        for (packages_with_bins.items, 0..) |pkg_name, i| {
            if (i > 0) try bins_list.appendSlice(", ");
            try bins_list.appendSlice(pkg_name);
        }
    }

    updatePackageJsonAfterMigration(allocator, log, dir) catch {};

    return LoadResult{
        .ok = .{
            .lockfile = this,
            .loaded_from_binary_lockfile = false,
            .was_migrated = true,
            .serializer_result = .{},
            .format = .text,
        },
    };
}

/// Updates package.json with workspace and catalog information after migration
fn updatePackageJsonAfterMigration(allocator: Allocator, log: *logger.Log, dir: bun.FD) !void {
    const package_json_path = "package.json";

    const package_json_file = bun.sys.File.openat(dir, package_json_path, bun.O.RDONLY, 0).unwrap() catch return;
    defer package_json_file.close();

    const package_json_content = package_json_file.readToEnd(allocator).unwrap() catch return;
    defer allocator.free(package_json_content);

    const source = logger.Source.initPathString(package_json_path, package_json_content);
    const json_result = JSON.parsePackageJSONUTF8WithOpts(
        &source,
        log,
        allocator,
        .{
            .is_json = true,
            .allow_comments = true,
            .allow_trailing_commas = true,
            .guess_indentation = true,
        },
    ) catch return;

    var json = json_result.root;
    if (json.data != .e_object) return;

    var needs_update = false;
    var moved_overrides = false;
    var moved_patched_deps = false;

    if (json.asProperty("pnpm")) |pnpm_prop| {
        if (pnpm_prop.expr.data == .e_object) {
            const pnpm_obj = &pnpm_prop.expr.data.e_object;

            if (pnpm_obj.*.get("overrides")) |overrides_field| {
                if (overrides_field.data == .e_object) {
                    if (json.asProperty("overrides")) |existing_prop| {
                        if (existing_prop.expr.data == .e_object) {
                            const existing_overrides = &existing_prop.expr.data.e_object;
                            for (overrides_field.data.e_object.properties.slice()) |prop| {
                                const key = prop.key.?.asString(allocator) orelse continue;
                                try existing_overrides.*.put(allocator, key, prop.value.?);
                            }
                        }
                    } else {
                        try json.data.e_object.put(allocator, "overrides", overrides_field);
                    }
                    moved_overrides = true;
                    needs_update = true;
                }
            }

            if (pnpm_obj.*.get("patchedDependencies")) |patched_field| {
                if (patched_field.data == .e_object) {
                    if (json.asProperty("patchedDependencies")) |existing_prop| {
                        if (existing_prop.expr.data == .e_object) {
                            const existing_patches = &existing_prop.expr.data.e_object;
                            for (patched_field.data.e_object.properties.slice()) |prop| {
                                const key = prop.key.?.asString(allocator) orelse continue;
                                try existing_patches.*.put(allocator, key, prop.value.?);
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
                for (pnpm_obj.*.properties.slice()) |prop| {
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

                    var new_root_props = try allocator.alloc(@TypeOf(json.data.e_object.properties.slice()[0]), new_root_count);
                    var idx: usize = 0;
                    for (json.data.e_object.properties.slice()) |prop| {
                        const key = prop.key.?.asString(allocator) orelse {
                            new_root_props[idx] = prop;
                            idx += 1;
                            continue;
                        };
                        if (!strings.eqlComptime(key, "pnpm")) {
                            new_root_props[idx] = prop;
                            idx += 1;
                        }
                    }

                    const G = JSAst.G;
                    json.data.e_object.properties = G.Property.List.init(new_root_props);
                } else {
                    var new_pnpm_props = try allocator.alloc(@TypeOf(pnpm_obj.*.properties.slice()[0]), remaining_count);
                    var idx: usize = 0;
                    for (pnpm_obj.*.properties.slice()) |prop| {
                        const key = prop.key.?.asString(allocator) orelse {
                            new_pnpm_props[idx] = prop;
                            idx += 1;
                            continue;
                        };
                        if (moved_overrides and strings.eqlComptime(key, "overrides")) continue;
                        if (moved_patched_deps and strings.eqlComptime(key, "patchedDependencies")) continue;
                        new_pnpm_props[idx] = prop;
                        idx += 1;
                    }

                    const G = JSAst.G;
                    pnpm_obj.*.properties = G.Property.List.init(new_pnpm_props);
                }
                needs_update = true;
            }
        }
    }

    var workspace_paths: ?[]const []const u8 = null;
    var catalog_obj: ?JSAst.Expr = null;
    var catalogs_obj: ?JSAst.Expr = null;

    const has_workspace_yaml = blk: {
        std.fs.cwd().access("pnpm-workspace.yaml", .{}) catch break :blk false;
        break :blk true;
    };

    if (has_workspace_yaml) {
        if (std.fs.cwd().readFileAlloc(allocator, "pnpm-workspace.yaml", 1024 * 1024)) |yaml_content| {
            const yaml_source = logger.Source.initPathString("pnpm-workspace.yaml", yaml_content);
            if (YAML.parse(&yaml_source, log, allocator)) |parsed| {
                if (parsed.data == .e_object) {
                    const root = parsed.data.e_object;

                    if (root.get("packages")) |packages_field| {
                        if (packages_field.data == .e_array) {
                            var paths = std.ArrayList([]const u8).init(allocator);
                            defer paths.deinit();

                            for (packages_field.data.e_array.items.slice()) |item| {
                                const path = item.asString(allocator) orelse continue;
                                paths.append(try allocator.dupe(u8, path)) catch continue;
                            }

                            workspace_paths = try allocator.dupe([]const u8, paths.items);
                        }
                    }

                    if (root.get("catalog")) |catalog_field| {
                        if (catalog_field.data == .e_object) {
                            catalog_obj = catalog_field;
                        }
                    }

                    if (root.get("catalogs")) |catalogs_field| {
                        if (catalogs_field.data == .e_object) {
                            catalogs_obj = catalogs_field;
                        }
                    }
                }
            } else |_| {}
        } else |_| {}
    }

    const has_workspace_data = workspace_paths != null or catalog_obj != null or catalogs_obj != null;

    if (has_workspace_data) {
        const use_array_format = workspace_paths != null and catalog_obj == null and catalogs_obj == null;

        const existing_workspaces = json.data.e_object.get("workspaces");
        const is_object_workspaces = existing_workspaces != null and existing_workspaces.?.data == .e_object;

        if (use_array_format) {
            const paths = workspace_paths.?;
            var workspace_exprs = try allocator.alloc(JSAst.Expr, paths.len);
            for (paths, 0..) |path, i| {
                const str = try allocator.create(JSAst.E.String);
                str.* = JSAst.E.String{ .data = path };
                workspace_exprs[i] = JSAst.Expr{
                    .data = .{ .e_string = str },
                    .loc = logger.Loc.Empty,
                };
            }
            const array = try allocator.create(JSAst.E.Array);
            array.* = JSAst.E.Array{
                .items = JSAst.ExprNodeList.init(workspace_exprs),
                .was_originally_macro = false,
            };

            try json.data.e_object.put(allocator, "workspaces", JSAst.Expr{
                .data = .{ .e_array = array },
                .loc = logger.Loc.Empty,
            });
            needs_update = true;
        } else if (is_object_workspaces) {
            const ws_obj = &existing_workspaces.?.data.e_object;

            if (workspace_paths) |paths| {
                if (paths.len > 0) {
                    var workspace_exprs = try allocator.alloc(JSAst.Expr, paths.len);
                    for (paths, 0..) |path, i| {
                        const str = try allocator.create(JSAst.E.String);
                        str.* = JSAst.E.String{ .data = path };
                        workspace_exprs[i] = JSAst.Expr{
                            .data = .{ .e_string = str },
                            .loc = logger.Loc.Empty,
                        };
                    }
                    const array = try allocator.create(JSAst.E.Array);
                    array.* = JSAst.E.Array{
                        .items = JSAst.ExprNodeList.init(workspace_exprs),
                        .was_originally_macro = false,
                    };
                    try ws_obj.*.put(allocator, "packages", JSAst.Expr{
                        .data = .{ .e_array = array },
                        .loc = logger.Loc.Empty,
                    });
                    needs_update = true;
                }
            }

            if (catalog_obj) |catalog| {
                try ws_obj.*.put(allocator, "catalog", catalog);
                needs_update = true;
            }

            if (catalogs_obj) |catalogs| {
                try ws_obj.*.put(allocator, "catalogs", catalogs);
                needs_update = true;
            }
        } else if (!use_array_format) {
            var ws_props = std.ArrayList(JSAst.G.Property).init(allocator);

            if (workspace_paths) |paths| {
                if (paths.len > 0) {
                    var workspace_exprs = try allocator.alloc(JSAst.Expr, paths.len);
                    for (paths, 0..) |path, i| {
                        const str = try allocator.create(JSAst.E.String);
                        str.* = JSAst.E.String{ .data = path };
                        workspace_exprs[i] = JSAst.Expr{
                            .data = .{ .e_string = str },
                            .loc = logger.Loc.Empty,
                        };
                    }
                    const array = try allocator.create(JSAst.E.Array);
                    array.* = JSAst.E.Array{
                        .items = JSAst.ExprNodeList.init(workspace_exprs),
                        .was_originally_macro = false,
                    };

                    const key_str = try allocator.create(JSAst.E.String);
                    key_str.* = JSAst.E.String{ .data = "packages" };
                    try ws_props.append(.{
                        .key = JSAst.Expr{
                            .data = .{ .e_string = key_str },
                            .loc = logger.Loc.Empty,
                        },
                        .value = JSAst.Expr{
                            .data = .{ .e_array = array },
                            .loc = logger.Loc.Empty,
                        },
                    });
                }
            }

            if (catalog_obj) |catalog| {
                const key_str = try allocator.create(JSAst.E.String);
                key_str.* = JSAst.E.String{ .data = "catalog" };
                try ws_props.append(.{
                    .key = JSAst.Expr{
                        .data = .{ .e_string = key_str },
                        .loc = logger.Loc.Empty,
                    },
                    .value = catalog,
                });
            }

            if (catalogs_obj) |catalogs| {
                const key_str = try allocator.create(JSAst.E.String);
                key_str.* = JSAst.E.String{ .data = "catalogs" };
                try ws_props.append(.{
                    .key = JSAst.Expr{
                        .data = .{ .e_string = key_str },
                        .loc = logger.Loc.Empty,
                    },
                    .value = catalogs,
                });
            }

            if (ws_props.items.len > 0) {
                const props_slice = try allocator.alloc(JSAst.G.Property, ws_props.items.len);
                @memcpy(props_slice, ws_props.items);

                const ws_obj = try allocator.create(JSAst.E.Object);
                ws_obj.* = JSAst.E.Object{
                    .properties = JSAst.G.Property.List.init(props_slice),
                };
                const workspace_obj = JSAst.Expr{
                    .data = .{ .e_object = ws_obj },
                    .loc = logger.Loc.Empty,
                };

                try json.data.e_object.put(allocator, "workspaces", workspace_obj);
                needs_update = true;
            }

            ws_props.deinit();
        }
    }

    if (needs_update) {
        var buffer_writer = JSPrinter.BufferWriter.init(allocator);
        defer buffer_writer.buffer.deinit();
        buffer_writer.append_newline = package_json_content.len > 0 and package_json_content[package_json_content.len - 1] == '\n';
        var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

        _ = JSPrinter.printJSON(
            @TypeOf(&package_json_writer),
            &package_json_writer,
            json,
            &source,
            .{
                .indent = json_result.indentation,
                .mangled_props = null,
            },
        ) catch return;

        // Write the updated package.json
        const write_file = bun.sys.File.openat(dir, package_json_path, bun.O.WRONLY | bun.O.TRUNC, 0).unwrap() catch return;
        defer write_file.close();
        _ = write_file.write(package_json_writer.ctx.writtenWithoutTrailingZero()).unwrap() catch return;
    }
}

const Dependency = @import("./dependency.zig");
const Install = @import("./install.zig");
const Npm = @import("./npm.zig");
const Bin = @import("./bin.zig").Bin;
const Integrity = @import("./integrity.zig").Integrity;
const Resolution = @import("./resolution.zig").Resolution;

const Lockfile = @import("./lockfile.zig");
const LoadResult = Lockfile.LoadResult;
const PatchedDep = Lockfile.PatchedDep;

const bun = @import("bun");
const Environment = bun.Environment;
const JSON = bun.json;
const JSPrinter = bun.js_printer;
const logger = bun.logger;
const strings = bun.strings;
const YAML = bun.interchange.yaml.YAML;

const Semver = bun.Semver;
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const stringHash = String.Builder.stringHash;

const JSAst = bun.ast;
const E = JSAst.E;
const Expr = JSAst.Expr;

const std = @import("std");
const os = std.os;
const Allocator = std.mem.Allocator;
