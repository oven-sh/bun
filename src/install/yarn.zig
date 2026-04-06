pub const YarnLock = struct {
    const Entry = struct {
        specs: []const []const u8,
        version: string,
        resolved: ?string = null,
        integrity: ?string = null,
        dependencies: ?bun.StringHashMap(string) = null,
        optionalDependencies: ?bun.StringHashMap(string) = null,
        peerDependencies: ?bun.StringHashMap(string) = null,
        devDependencies: ?bun.StringHashMap(string) = null,
        commit: ?string = null,
        workspace: bool = false,
        file: ?string = null,
        os: ?[]const []const u8 = null,
        cpu: ?[]const []const u8 = null,
        git_repo_name: ?string = null,

        pub fn deinit(self: *Entry, allocator: Allocator) void {
            allocator.free(self.specs);
            if (self.dependencies) |*deps| {
                deps.deinit();
            }
            if (self.optionalDependencies) |*deps| {
                deps.deinit();
            }
            if (self.peerDependencies) |*deps| {
                deps.deinit();
            }
            if (self.devDependencies) |*deps| {
                deps.deinit();
            }
            if (self.os) |os_list| {
                allocator.free(os_list);
            }
            if (self.cpu) |cpu_list| {
                allocator.free(cpu_list);
            }
            if (self.git_repo_name) |name| {
                allocator.free(name);
            }
        }

        pub fn getNameFromSpec(spec: []const u8) []const u8 {
            const unquoted = if (spec[0] == '"' and spec[spec.len - 1] == '"')
                spec[1 .. spec.len - 1]
            else
                spec;

            if (unquoted[0] == '@') {
                if (strings.indexOf(unquoted[1..], "@")) |second_at| {
                    const end_idx = second_at + 1;
                    return unquoted[0..end_idx];
                }
                return unquoted;
            }

            if (strings.indexOf(unquoted, "@npm:")) |npm_idx| {
                return unquoted[0..npm_idx];
            } else if (strings.indexOf(unquoted, "@https://")) |url_idx| {
                return unquoted[0..url_idx];
            } else if (strings.indexOf(unquoted, "@git+")) |git_idx| {
                return unquoted[0..git_idx];
            } else if (strings.indexOf(unquoted, "@github:")) |gh_idx| {
                return unquoted[0..gh_idx];
            } else if (strings.indexOf(unquoted, "@file:")) |file_idx| {
                return unquoted[0..file_idx];
            } else if (strings.indexOf(unquoted, "@")) |idx| {
                return unquoted[0..idx];
            }
            return unquoted;
        }

        pub fn getVersionFromSpec(spec: []const u8) ?[]const u8 {
            const unquoted = if (spec[0] == '"' and spec[spec.len - 1] == '"')
                spec[1 .. spec.len - 1]
            else
                spec;

            if (unquoted[0] == '@') {
                if (strings.indexOfChar(unquoted[1..], '@')) |second_at_pos| {
                    const version_start = second_at_pos + "@".len + 1;
                    const version_part = unquoted[version_start..];

                    if (strings.hasPrefixComptime(version_part, "npm:") and version_part.len > 4) {
                        return version_part["npm:".len..];
                    }
                    return version_part;
                }
                return null;
            } else if (strings.indexOf(unquoted, "@npm:")) |npm_idx| {
                const after_npm = npm_idx + "npm:".len + 1;
                if (after_npm < unquoted.len) {
                    return unquoted[after_npm..];
                }
                return null;
            } else if (strings.indexOf(unquoted, "@https://")) |url_idx| {
                const after_at = url_idx + '@'.len;
                if (after_at < unquoted.len) {
                    return unquoted[after_at..];
                }
                return null;
            } else if (strings.indexOf(unquoted, "@git+")) |git_idx| {
                const after_at = git_idx + '@'.len;
                if (after_at < unquoted.len) {
                    return unquoted[after_at..];
                }
                return null;
            } else if (strings.indexOf(unquoted, "@github:")) |gh_idx| {
                const after_at = gh_idx + '@'.len;
                if (after_at < unquoted.len) {
                    return unquoted[after_at..];
                }
                return null;
            } else if (strings.indexOf(unquoted, "@file:")) |file_idx| {
                const after_at = file_idx + '@'.len;
                if (after_at < unquoted.len) {
                    return unquoted[after_at..];
                }
                return null;
            } else if (strings.indexOf(unquoted, "@")) |idx| {
                const after_at = idx + '@'.len;
                if (after_at < unquoted.len) {
                    return unquoted[after_at..];
                }
                return null;
            }
            return null;
        }

        pub fn isGitDependency(version: []const u8) bool {
            return strings.hasPrefixComptime(version, "git+") or
                strings.hasPrefixComptime(version, "git://") or
                strings.hasPrefixComptime(version, "github:") or
                strings.hasPrefixComptime(version, "https://github.com/");
        }

        pub fn isNpmAlias(version: []const u8) bool {
            return strings.hasPrefixComptime(version, "npm:");
        }

        pub fn isRemoteTarball(version: []const u8) bool {
            return strings.hasPrefixComptime(version, "https://") and strings.endsWithComptime(version, ".tgz");
        }

        pub fn isWorkspaceDependency(version: []const u8) bool {
            return strings.hasPrefixComptime(version, "workspace:") or
                strings.eqlComptime(version, "*");
        }

        pub fn isFileDependency(version: []const u8) bool {
            return strings.hasPrefixComptime(version, "file:") or
                strings.hasPrefixComptime(version, "./") or
                strings.hasPrefixComptime(version, "../");
        }

        pub fn parseGitUrl(self: *const YarnLock, version: []const u8) !struct { url: []const u8, commit: ?[]const u8, owner: ?[]const u8, repo: ?[]const u8 } {
            var url = version;
            var commit: ?[]const u8 = null;
            var owner: ?[]const u8 = null;
            var repo: ?[]const u8 = null;

            if (strings.hasPrefixComptime(url, "git+")) {
                url = url[4..];
            }

            if (strings.indexOf(url, "#")) |hash_idx| {
                commit = url[hash_idx + 1 ..];
                url = url[0..hash_idx];
            }

            if (strings.hasPrefixComptime(version, "github:")) {
                const github_path = version["github:".len..];
                const path_without_commit = if (strings.indexOf(github_path, "#")) |idx| github_path[0..idx] else github_path;

                if (strings.indexOf(path_without_commit, "/")) |slash_idx| {
                    owner = path_without_commit[0..slash_idx];
                    repo = path_without_commit[slash_idx + 1 ..];
                }
                url = try std.fmt.allocPrint(
                    self.allocator,
                    "https://github.com/{s}",
                    .{path_without_commit},
                );
            } else if (strings.contains(url, "github.com")) {
                var remaining = url;
                if (strings.indexOf(remaining, "github.com/")) |idx| {
                    remaining = remaining[idx + "github.com/".len ..];
                }
                if (strings.indexOf(remaining, "/")) |slash_idx| {
                    owner = remaining[0..slash_idx];
                    const after_owner = remaining[slash_idx + 1 ..];
                    if (strings.endsWithComptime(after_owner, ".git")) {
                        repo = after_owner[0 .. after_owner.len - ".git".len];
                    } else {
                        repo = after_owner;
                    }
                }
            }

            return .{ .url = url, .commit = commit, .owner = owner, .repo = repo };
        }

        pub fn parseNpmAlias(version: []const u8) struct { package: []const u8, version: []const u8 } {
            if (version.len <= 4) {
                return .{ .package = "", .version = "*" };
            }

            const npm_part = version[4..];
            if (strings.indexOf(npm_part, "@")) |at_idx| {
                return .{
                    .package = npm_part[0..at_idx],
                    .version = if (at_idx + 1 < npm_part.len) npm_part[at_idx + 1 ..] else "*",
                };
            }
            return .{ .package = npm_part, .version = "*" };
        }

        pub fn getPackageNameFromResolvedUrl(url: []const u8) ?[]const u8 {
            if (strings.indexOf(url, "/-/")) |dash_idx| {
                var slash_count: usize = 0;
                var last_slash: usize = 0;
                var second_last_slash: usize = 0;

                var i = dash_idx;
                while (i > 0) : (i -= 1) {
                    if (url[i - 1] == '/') {
                        slash_count += 1;
                        if (slash_count == 1) {
                            last_slash = i - 1;
                        } else if (slash_count == 2) {
                            second_last_slash = i - 1;
                            break;
                        }
                    }
                }

                if (last_slash < dash_idx and url[last_slash + 1] == '@') {
                    return url[second_last_slash + 1 .. dash_idx];
                } else {
                    return url[last_slash + 1 .. dash_idx];
                }
            }

            return null;
        }
    };

    entries: std.array_list.Managed(Entry),
    allocator: Allocator,

    pub fn init(allocator: Allocator) YarnLock {
        return .{
            .entries = std.array_list.Managed(Entry).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *YarnLock) void {
        for (self.entries.items) |*entry| {
            entry.deinit(self.allocator);
        }
        self.entries.deinit();
    }

    pub fn parse(self: *YarnLock, content: []const u8) !void {
        var lines = strings.split(content, "\n");
        var current_entry: ?Entry = null;
        var current_specs = std.array_list.Managed([]const u8).init(self.allocator);
        defer current_specs.deinit();

        var current_deps: ?bun.StringHashMap(string) = null;
        var current_optional_deps: ?bun.StringHashMap(string) = null;
        var current_peer_deps: ?bun.StringHashMap(string) = null;
        var current_dev_deps: ?bun.StringHashMap(string) = null;
        var current_dep_type: ?DependencyType = null;

        while (lines.next()) |line_| {
            const line = std.mem.trimRight(u8, line_, " \r\t");
            if (line.len == 0 or line[0] == '#') continue;

            var indent: usize = 0;
            while (indent < line.len and line[indent] == ' ') indent += 1;

            const trimmed = strings.trim(line[indent..], " \r\t");
            if (trimmed.len == 0) continue;

            if (indent == 0 and strings.endsWithComptime(trimmed, ":")) {
                if (current_entry) |*entry| {
                    entry.dependencies = current_deps;
                    entry.optionalDependencies = current_optional_deps;
                    entry.peerDependencies = current_peer_deps;
                    entry.devDependencies = current_dev_deps;
                    try self.consolidateAndAppendEntry(entry.*);
                }

                current_specs.clearRetainingCapacity();
                const specs_str = trimmed[0 .. trimmed.len - 1];
                var specs_it = strings.split(specs_str, ",");
                while (specs_it.next()) |spec| {
                    const spec_trimmed = strings.trim(spec, " \"");
                    try current_specs.append(try self.allocator.dupe(u8, spec_trimmed));
                }

                current_entry = Entry{
                    .specs = try self.allocator.dupe([]const u8, current_specs.items),
                    .version = undefined,
                };

                for (current_specs.items) |spec| {
                    if (strings.indexOf(spec, "@file:")) |at_index| {
                        const file_path = spec[at_index + 6 ..];
                        current_entry.?.file = try self.allocator.dupe(u8, file_path);
                        break;
                    }
                }

                current_deps = null;
                current_optional_deps = null;
                current_peer_deps = null;
                current_dev_deps = null;
                current_dep_type = null;
                continue;
            }

            if (current_entry == null) continue;

            if (indent > 0) {
                if (strings.eqlComptime(trimmed, "dependencies:")) {
                    current_dep_type = .production;
                    current_deps = bun.StringHashMap(string).init(self.allocator);
                    continue;
                }

                if (strings.eqlComptime(trimmed, "optionalDependencies:")) {
                    current_dep_type = .optional;
                    current_optional_deps = bun.StringHashMap(string).init(self.allocator);
                    continue;
                }

                if (strings.eqlComptime(trimmed, "peerDependencies:")) {
                    current_dep_type = .peer;
                    current_peer_deps = bun.StringHashMap(string).init(self.allocator);
                    continue;
                }

                if (strings.eqlComptime(trimmed, "devDependencies:")) {
                    current_dep_type = .development;
                    current_dev_deps = bun.StringHashMap(string).init(self.allocator);
                    continue;
                }

                if (current_dep_type) |dep_type| {
                    if (strings.indexOf(trimmed, " ")) |space_idx| {
                        const key = strings.trim(trimmed[0..space_idx], " \"");
                        const value = strings.trim(trimmed[space_idx + 1 ..], " \"");
                        const map = switch (dep_type) {
                            .production => &current_deps.?,
                            .optional => &current_optional_deps.?,
                            .peer => &current_peer_deps.?,
                            .development => &current_dev_deps.?,
                        };
                        try map.put(key, value);
                    }
                    continue;
                }

                if (strings.indexOf(trimmed, " ")) |space_idx| {
                    const key = strings.trim(trimmed[0..space_idx], " ");
                    const value = strings.trim(trimmed[space_idx + 1 ..], " \"");

                    if (strings.eqlComptime(key, "version")) {
                        current_entry.?.version = value;

                        if (Entry.isWorkspaceDependency(value)) {
                            current_entry.?.workspace = true;
                        } else if (Entry.isFileDependency(value)) {
                            current_entry.?.file = if (strings.hasPrefixComptime(value, "file:") and value.len > "file:".len) value["file:".len..] else value;
                        } else if (Entry.isGitDependency(value)) {
                            const git_info = try Entry.parseGitUrl(self, value);
                            current_entry.?.resolved = git_info.url;
                            current_entry.?.commit = git_info.commit;
                            if (git_info.repo) |repo_name| {
                                current_entry.?.git_repo_name = try self.allocator.dupe(u8, repo_name);
                            }
                        } else if (Entry.isNpmAlias(value)) {
                            const alias_info = Entry.parseNpmAlias(value);
                            current_entry.?.version = alias_info.version;
                        } else if (Entry.isRemoteTarball(value)) {
                            current_entry.?.resolved = value;
                        }
                    } else if (strings.eqlComptime(key, "resolved")) {
                        current_entry.?.resolved = value;
                        if (Entry.isGitDependency(value)) {
                            const git_info = try Entry.parseGitUrl(self, value);
                            current_entry.?.resolved = git_info.url;
                            current_entry.?.commit = git_info.commit;
                            if (git_info.repo) |repo_name| {
                                current_entry.?.git_repo_name = try self.allocator.dupe(u8, repo_name);
                            }
                        }
                    } else if (strings.eqlComptime(key, "integrity")) {
                        current_entry.?.integrity = value;
                    } else if (strings.eqlComptime(key, "os")) {
                        var os_list = std.array_list.Managed([]const u8).init(self.allocator);
                        var os_it = strings.split(value[1 .. value.len - 1], ",");
                        while (os_it.next()) |os| {
                            const trimmed_os = strings.trim(os, " \"");
                            try os_list.append(trimmed_os);
                        }
                        current_entry.?.os = try os_list.toOwnedSlice();
                    } else if (strings.eqlComptime(key, "cpu")) {
                        var cpu_list = std.array_list.Managed([]const u8).init(self.allocator);
                        var cpu_it = strings.split(value[1 .. value.len - 1], ",");
                        while (cpu_it.next()) |cpu| {
                            const trimmed_cpu = strings.trim(cpu, " \"");
                            try cpu_list.append(trimmed_cpu);
                        }
                        current_entry.?.cpu = try cpu_list.toOwnedSlice();
                    }
                }
            }
        }

        if (current_entry) |*entry| {
            entry.dependencies = current_deps;
            entry.optionalDependencies = current_optional_deps;
            entry.peerDependencies = current_peer_deps;
            entry.devDependencies = current_dev_deps;
            try self.consolidateAndAppendEntry(entry.*);
        }
    }

    fn findEntryBySpec(self: *YarnLock, spec: []const u8) ?*Entry {
        for (self.entries.items) |*entry| {
            for (entry.specs) |entry_spec| {
                if (strings.eql(entry_spec, spec)) {
                    return entry;
                }
            }
        }
        return null;
    }

    fn consolidateAndAppendEntry(self: *YarnLock, new_entry: Entry) !void {
        if (new_entry.specs.len == 0) return;
        const package_name = Entry.getNameFromSpec(new_entry.specs[0]);

        for (self.entries.items) |*existing_entry| {
            if (existing_entry.specs.len == 0) continue;
            const existing_name = Entry.getNameFromSpec(existing_entry.specs[0]);

            if (strings.eql(package_name, existing_name) and
                strings.eql(new_entry.version, existing_entry.version))
            {
                const old_specs = existing_entry.specs;
                const combined_specs = try self.allocator.alloc([]const u8, old_specs.len + new_entry.specs.len);
                @memcpy(combined_specs[0..old_specs.len], old_specs);
                @memcpy(combined_specs[old_specs.len..], new_entry.specs);

                self.allocator.free(old_specs);
                existing_entry.specs = combined_specs;

                self.allocator.free(new_entry.specs);
                return;
            }
        }

        try self.entries.append(new_entry);
    }
};

const DependencyType = enum {
    production,
    development,
    optional,
    peer,
};
fn processDeps(
    deps: bun.StringHashMap(string),
    dep_type: DependencyType,
    yarn_lock_: *YarnLock,
    string_buf_: *Semver.String.Buf,
    deps_buf: []Dependency,
    res_buf: []Install.PackageID,
    log: *logger.Log,
    manager: *Install.PackageManager,
    yarn_entry_to_package_id: []const Install.PackageID,
) ![]Install.PackageID {
    var deps_it = deps.iterator();
    var count: usize = 0;
    var dep_spec_name_stack = std.heap.stackFallback(1024, bun.default_allocator);
    const temp_allocator = dep_spec_name_stack.get();

    while (deps_it.next()) |dep| {
        const dep_name = dep.key_ptr.*;
        const dep_version = dep.value_ptr.*;
        const dep_spec = try std.fmt.allocPrint(
            temp_allocator,
            "{s}@{s}",
            .{ dep_name, dep_version },
        );
        defer temp_allocator.free(dep_spec);

        if (yarn_lock_.findEntryBySpec(dep_spec)) |dep_entry| {
            const dep_name_hash = stringHash(dep_name);
            const dep_name_str = try string_buf_.appendWithHash(dep_name, dep_name_hash);

            const parsed_version = if (YarnLock.Entry.isNpmAlias(dep_version)) blk: {
                const alias_info = YarnLock.Entry.parseNpmAlias(dep_version);
                break :blk alias_info.version;
            } else dep_version;

            deps_buf[count] = Dependency{
                .name = dep_name_str,
                .name_hash = dep_name_hash,
                .version = Dependency.parse(
                    yarn_lock_.allocator,
                    dep_name_str,
                    dep_name_hash,
                    parsed_version,
                    &Semver.SlicedString.init(parsed_version, parsed_version),
                    log,
                    manager,
                ) orelse Dependency.Version{},
                .behavior = .{
                    .prod = dep_type == .production,
                    .optional = dep_type == .optional,
                    .dev = dep_type == .development,
                    .peer = dep_type == .peer,
                    .workspace = dep_entry.workspace,
                },
            };
            var found_package_id: ?Install.PackageID = null;
            outer: for (yarn_lock_.entries.items, 0..) |entry_, yarn_idx| {
                for (entry_.specs) |entry_spec| {
                    if (strings.eql(entry_spec, dep_spec)) {
                        found_package_id = yarn_entry_to_package_id[yarn_idx];
                        break :outer;
                    }
                }
            }

            if (found_package_id) |pkg_id| {
                res_buf[count] = pkg_id;
                count += 1;
            }
        }
    }
    return res_buf[0..count];
}

pub fn migrateYarnLockfile(
    this: *Lockfile,
    manager: *Install.PackageManager,
    allocator: Allocator,
    log: *logger.Log,
    data: string,
    dir: bun.FD,
) !LoadResult {
    // todo yarn v2+ support
    if (!strings.containsComptime(data, "# yarn lockfile v1")) {
        return error.UnsupportedYarnLockfileVersion;
    }

    var yarn_lock = YarnLock.init(allocator);
    defer yarn_lock.deinit();

    try yarn_lock.parse(data);

    this.initEmpty(allocator);
    Install.initializeStore();
    bun.analytics.Features.yarn_migration += 1;

    var string_buf = this.stringBuf();

    var num_deps: u32 = 0;
    var root_dep_count: u32 = 0;
    var root_dep_count_from_package_json: u32 = 0;

    var root_dependencies = std.array_list.Managed(struct { name: []const u8, version: []const u8, dep_type: DependencyType }).init(allocator);
    defer {
        for (root_dependencies.items) |dep| {
            allocator.free(dep.name);
            allocator.free(dep.version);
        }
        root_dependencies.deinit();
    }

    {
        // read package.json to get specified dependencies
        const package_json_fd = bun.sys.File.openat(dir, "package.json", bun.O.RDONLY, 0).unwrap() catch return error.InvalidPackageJSON;
        defer package_json_fd.close();
        const package_json_contents = package_json_fd.readToEnd(allocator).unwrap() catch return error.InvalidPackageJSON;
        defer allocator.free(package_json_contents);

        const package_json_source = brk: {
            var package_json_path_buf: bun.PathBuffer = undefined;
            const package_json_path = bun.getFdPath(package_json_fd.handle, &package_json_path_buf) catch return error.InvalidPackageJSON;
            break :brk logger.Source.initPathString(package_json_path, package_json_contents);
        };
        const package_json_expr = JSON.parsePackageJSONUTF8WithOpts(
            &package_json_source,
            log,
            allocator,
            .{
                .is_json = true,
                .allow_comments = true,
                .allow_trailing_commas = true,
                .guess_indentation = true,
            },
        ) catch return error.InvalidPackageJSON;

        const package_json = package_json_expr.root;

        const package_name: ?[]const u8 = blk: {
            if (package_json.asProperty("name")) |name_prop| {
                if (name_prop.expr.data == .e_string) {
                    const name_slice = name_prop.expr.data.e_string.string(allocator) catch "";
                    if (name_slice.len > 0) {
                        break :blk try allocator.dupe(u8, name_slice);
                    }
                }
            }
            break :blk null;
        };
        defer if (package_name) |name| allocator.free(name);
        const package_name_hash = if (package_name) |name| String.Builder.stringHash(name) else 0;

        const sections = [_]struct { key: []const u8, dep_type: DependencyType }{
            .{ .key = "dependencies", .dep_type = .production },
            .{ .key = "devDependencies", .dep_type = .development },
            .{ .key = "optionalDependencies", .dep_type = .optional },
            .{ .key = "peerDependencies", .dep_type = .peer },
        };
        for (sections) |section_info| {
            const prop = package_json.asProperty(section_info.key) orelse continue;
            if (prop.expr.data != .e_object) continue;

            for (prop.expr.data.e_object.properties.slice()) |p| {
                const key = p.key orelse continue;
                if (key.data != .e_string) continue;

                const name_slice = key.data.e_string.string(allocator) catch continue;
                const value = p.value orelse continue;
                if (value.data != .e_string) continue;

                const version_slice = value.data.e_string.string(allocator) catch continue;
                if (version_slice.len == 0) continue;

                const name = try allocator.dupe(u8, name_slice);
                const version = try allocator.dupe(u8, version_slice);
                try root_dependencies.append(.{
                    .name = name,
                    .version = version,
                    .dep_type = section_info.dep_type,
                });
                root_dep_count_from_package_json += 1;
            }
        }

        root_dep_count = @max(root_dep_count_from_package_json, 10);
        num_deps += root_dep_count;

        for (yarn_lock.entries.items) |entry| {
            if (entry.dependencies) |deps| {
                num_deps += @intCast(deps.count());
            }
            if (entry.optionalDependencies) |deps| {
                num_deps += @intCast(deps.count());
            }
            if (entry.peerDependencies) |deps| {
                num_deps += @intCast(deps.count());
            }
            if (entry.devDependencies) |deps| {
                num_deps += @intCast(deps.count());
            }
        }

        const num_packages = @as(u32, @intCast(yarn_lock.entries.items.len + 1));

        try this.buffers.dependencies.ensureTotalCapacity(allocator, num_deps);
        try this.buffers.resolutions.ensureTotalCapacity(allocator, num_deps);
        try this.packages.ensureTotalCapacity(allocator, num_packages);
        try this.package_index.ensureTotalCapacity(num_packages);

        const root_name = if (package_name) |name| try string_buf.appendWithHash(name, package_name_hash) else try string_buf.append("");

        try this.packages.append(allocator, Lockfile.Package{
            .name = root_name,
            .name_hash = package_name_hash,
            .resolution = Resolution.init(.{ .root = {} }),
            .dependencies = .{},
            .resolutions = .{},
            .meta = .{
                .id = 0,
                .origin = .local,
                .arch = .all,
                .os = .all,
                .man_dir = String{},
                .has_install_script = .false,
                .integrity = Integrity{},
            },
            .bin = Bin.init(),
            .scripts = .{},
        });

        if (package_json.asProperty("resolutions")) |resolutions| {
            var root_package = this.packages.get(0);
            var string_builder = this.stringBuilder();

            if (resolutions.expr.data == .e_object) {
                string_builder.cap += resolutions.expr.data.e_object.properties.len * 128;
            }
            if (string_builder.cap > 0) {
                try string_builder.allocate();
            }
            try this.overrides.parseAppend(manager, this, &root_package, log, &package_json_source, package_json, &string_builder);
            this.packages.set(0, root_package);
        }
    }

    var dependencies_buf = this.buffers.dependencies.items.ptr[0..num_deps];
    var resolutions_buf = this.buffers.resolutions.items.ptr[0..num_deps];

    var yarn_entry_to_package_id = try allocator.alloc(Install.PackageID, yarn_lock.entries.items.len);
    defer allocator.free(yarn_entry_to_package_id);

    const VersionInfo = struct {
        version: string,
        package_id: Install.PackageID,
        yarn_idx: usize,
    };

    var package_versions = bun.StringHashMap(VersionInfo).init(allocator);
    defer package_versions.deinit();

    var scoped_packages = bun.StringHashMap(std.array_list.Managed(VersionInfo)).init(allocator);
    defer {
        var it = scoped_packages.iterator();
        while (it.next()) |entry| {
            entry.value_ptr.deinit();
        }
        scoped_packages.deinit();
    }

    var next_package_id: Install.PackageID = 1; // 0 is root

    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        var is_npm_alias = false;
        var is_direct_url = false;
        for (entry.specs) |spec| {
            if (strings.contains(spec, "@npm:")) {
                is_npm_alias = true;
                break;
            }
            if (strings.contains(spec, "@https://") or strings.contains(spec, "@http://")) {
                is_direct_url = true;
            }
        }

        const name = if (is_npm_alias and entry.resolved != null)
            YarnLock.Entry.getPackageNameFromResolvedUrl(entry.resolved.?) orelse YarnLock.Entry.getNameFromSpec(entry.specs[0])
        else if (is_direct_url)
            YarnLock.Entry.getNameFromSpec(entry.specs[0])
        else if (entry.git_repo_name) |repo_name|
            repo_name
        else
            YarnLock.Entry.getNameFromSpec(entry.specs[0]);
        const version = entry.version;

        if (package_versions.get(name)) |existing| {
            if (!strings.eql(existing.version, version)) {
                var list = scoped_packages.get(name) orelse std.array_list.Managed(VersionInfo).init(allocator);

                var found_existing = false;
                var found_new = false;
                for (list.items) |item| {
                    if (strings.eql(item.version, existing.version)) found_existing = true;
                    if (strings.eql(item.version, version)) found_new = true;
                }

                if (!found_existing) {
                    try list.append(.{
                        .yarn_idx = existing.yarn_idx,
                        .version = existing.version,
                        .package_id = existing.package_id,
                    });
                }

                if (!found_new) {
                    const package_id = next_package_id;
                    next_package_id += 1;
                    try list.append(.{
                        .yarn_idx = yarn_idx,
                        .version = version,
                        .package_id = package_id,
                    });
                    yarn_entry_to_package_id[yarn_idx] = package_id;
                } else {
                    for (list.items) |item| {
                        if (strings.eql(item.version, version)) {
                            yarn_entry_to_package_id[yarn_idx] = item.package_id;
                            break;
                        }
                    }
                }

                try scoped_packages.put(name, list);
            } else {
                yarn_entry_to_package_id[yarn_idx] = existing.package_id;
            }
        } else {
            const package_id = next_package_id;
            next_package_id += 1;
            yarn_entry_to_package_id[yarn_idx] = package_id;
            try package_versions.put(name, .{
                .version = version,
                .package_id = package_id,
                .yarn_idx = yarn_idx,
            });
        }
    }

    var package_id_to_yarn_idx = try allocator.alloc(usize, next_package_id);
    defer allocator.free(package_id_to_yarn_idx);
    @memset(package_id_to_yarn_idx, std.math.maxInt(usize));

    var created_packages = bun.StringHashMap(bool).init(allocator);
    defer created_packages.deinit();

    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        var is_npm_alias = false;
        for (entry.specs) |spec| {
            if (strings.contains(spec, "@npm:")) {
                is_npm_alias = true;
                break;
            }
        }

        var is_direct_url_dep = false;
        for (entry.specs) |spec| {
            if (strings.contains(spec, "@https://") or strings.contains(spec, "@http://")) {
                is_direct_url_dep = true;
                break;
            }
        }

        const base_name = if (is_npm_alias and entry.resolved != null)
            YarnLock.Entry.getPackageNameFromResolvedUrl(entry.resolved.?) orelse YarnLock.Entry.getNameFromSpec(entry.specs[0])
        else
            YarnLock.Entry.getNameFromSpec(entry.specs[0]);
        const package_id = yarn_entry_to_package_id[yarn_idx];

        if (package_id < package_id_to_yarn_idx.len and package_id_to_yarn_idx[package_id] != std.math.maxInt(usize)) {
            continue;
        }

        package_id_to_yarn_idx[package_id] = yarn_idx;

        const name_to_use = blk: {
            if (entry.commit != null and entry.git_repo_name != null) {
                break :blk entry.git_repo_name.?;
            } else if (entry.resolved) |resolved| {
                if (is_direct_url_dep or YarnLock.Entry.isRemoteTarball(resolved) or strings.endsWithComptime(resolved, ".tgz")) {
                    // https://registry.npmjs.org/package/-/package-version.tgz
                    if (strings.contains(resolved, "registry.npmjs.org/") or strings.contains(resolved, "registry.yarnpkg.com/")) {
                        if (strings.indexOf(resolved, "/-/")) |separator_idx| {
                            if (strings.indexOf(resolved, "registry.")) |registry_idx| {
                                const after_registry = resolved[registry_idx..];
                                if (strings.indexOf(after_registry, "/")) |domain_slash| {
                                    const package_start = registry_idx + domain_slash + 1;
                                    const extracted_name = resolved[package_start..separator_idx];
                                    break :blk extracted_name;
                                }
                            }
                        }
                    }
                    break :blk base_name;
                }
            }
            break :blk base_name;
        };

        const name_hash = stringHash(name_to_use);

        try this.packages.append(allocator, Lockfile.Package{
            .name = try string_buf.appendWithHash(name_to_use, name_hash),
            .name_hash = name_hash,
            .resolution = blk: {
                if (entry.workspace) {
                    break :blk Resolution.init(.{ .workspace = try string_buf.append(base_name) });
                } else if (entry.file) |file| {
                    if (strings.endsWithComptime(file, ".tgz") or strings.endsWithComptime(file, ".tar.gz")) {
                        break :blk Resolution.init(.{ .local_tarball = try string_buf.append(file) });
                    } else {
                        break :blk Resolution.init(.{ .folder = try string_buf.append(file) });
                    }
                } else if (entry.commit) |commit| {
                    if (entry.resolved) |resolved| {
                        var owner_str: []const u8 = "";
                        var repo_str: []const u8 = resolved;

                        if (strings.contains(resolved, "github.com/")) {
                            if (strings.indexOf(resolved, "github.com/")) |idx| {
                                const after_github = resolved[idx + "github.com/".len ..];
                                if (strings.indexOf(after_github, "/")) |slash_idx| {
                                    owner_str = after_github[0..slash_idx];
                                    repo_str = after_github[slash_idx + 1 ..];
                                    if (strings.endsWithComptime(repo_str, ".git")) {
                                        repo_str = repo_str[0 .. repo_str.len - 4];
                                    }
                                }
                            }
                        }

                        const actual_name = if (entry.git_repo_name) |repo_name| repo_name else repo_str;

                        if (owner_str.len > 0 and repo_str.len > 0) {
                            break :blk Resolution.init(.{
                                .github = .{
                                    .owner = try string_buf.append(owner_str),
                                    .repo = try string_buf.append(repo_str),
                                    .committish = try string_buf.append(commit[0..@min("github:".len, commit.len)]),
                                    .resolved = String{},
                                    .package_name = try string_buf.append(actual_name),
                                },
                            });
                        } else {
                            break :blk Resolution.init(.{
                                .git = .{
                                    .owner = try string_buf.append(owner_str),
                                    .repo = try string_buf.append(repo_str),
                                    .committish = try string_buf.append(commit),
                                    .resolved = String{},
                                    .package_name = try string_buf.append(actual_name),
                                },
                            });
                        }
                    }
                    break :blk Resolution{};
                } else if (entry.resolved) |resolved| {
                    if (is_direct_url_dep) {
                        break :blk Resolution.init(.{
                            .remote_tarball = try string_buf.append(resolved),
                        });
                    }

                    if (YarnLock.Entry.isRemoteTarball(resolved)) {
                        break :blk Resolution.init(.{
                            .remote_tarball = try string_buf.append(resolved),
                        });
                    } else if (strings.endsWithComptime(resolved, ".tgz")) {
                        break :blk Resolution.init(.{
                            .remote_tarball = try string_buf.append(resolved),
                        });
                    }

                    const version = try string_buf.append(entry.version);
                    const result = Semver.Version.parse(version.sliced(this.buffers.string_bytes.items));
                    if (!result.valid) {
                        break :blk Resolution{};
                    }

                    const is_default_registry = strings.hasPrefixComptime(resolved, "https://registry.yarnpkg.com/") or
                        strings.hasPrefixComptime(resolved, "https://registry.npmjs.org/");

                    const url = if (is_default_registry) String{} else try string_buf.append(resolved);

                    break :blk Resolution.init(.{
                        .npm = .{
                            .url = url,
                            .version = result.version.min(),
                        },
                    });
                } else {
                    break :blk Resolution{};
                }
            },
            .dependencies = .{},
            .resolutions = .{},
            .meta = .{
                .id = package_id,
                .origin = .npm,
                .arch = if (entry.cpu) |cpu_list| arch: {
                    var arch = Npm.Architecture.none.negatable();
                    for (cpu_list) |cpu| {
                        arch.apply(cpu);
                    }
                    break :arch arch.combine();
                } else .all,
                .os = if (entry.os) |os_list| os: {
                    var os = Npm.OperatingSystem.none.negatable();
                    for (os_list) |os_str| {
                        os.apply(os_str);
                    }
                    break :os os.combine();
                } else .all,
                .man_dir = String{},
                .has_install_script = .false,
                .integrity = if (entry.integrity) |integrity|
                    Integrity.parse(integrity)
                else
                    Integrity{},
            },
            .bin = Bin.init(),
            .scripts = .{},
        });
    }

    var dependencies_list = this.packages.items(.dependencies);
    var resolution_list = this.packages.items(.resolutions);

    var actual_root_dep_count: u32 = 0;

    if (root_dependencies.items.len > 0) {
        for (root_dependencies.items) |dep| {
            const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep.name, dep.version });
            defer allocator.free(dep_spec);

            var found_idx: ?usize = null;
            for (yarn_lock.entries.items, 0..) |entry, idx| {
                for (entry.specs) |spec| {
                    if (strings.eql(spec, dep_spec)) {
                        found_idx = idx;
                        break;
                    }
                }
                if (found_idx != null) break;
            }

            if (found_idx) |idx| {
                const name_hash = stringHash(dep.name);
                const dep_name_string = try string_buf.appendWithHash(dep.name, name_hash);
                const version_string = try string_buf.append(dep.version);

                dependencies_buf[actual_root_dep_count] = Dependency{
                    .name = dep_name_string,
                    .name_hash = name_hash,
                    .version = Dependency.parse(
                        allocator,
                        dep_name_string,
                        name_hash,
                        version_string.slice(this.buffers.string_bytes.items),
                        &version_string.sliced(this.buffers.string_bytes.items),
                        log,
                        manager,
                    ) orelse Dependency.Version{},
                    .behavior = .{
                        .prod = dep.dep_type == .production,
                        .dev = dep.dep_type == .development,
                        .optional = dep.dep_type == .optional,
                        .peer = dep.dep_type == .peer,
                        .workspace = false,
                    },
                };

                resolutions_buf[actual_root_dep_count] = yarn_entry_to_package_id[idx];
                actual_root_dep_count += 1;
            }
        }
    }

    dependencies_list[0] = .{
        .off = 0,
        .len = actual_root_dep_count,
    };
    resolution_list[0] = .{
        .off = 0,
        .len = actual_root_dep_count,
    };

    dependencies_buf = dependencies_buf[actual_root_dep_count..];
    resolutions_buf = resolutions_buf[actual_root_dep_count..];

    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        const package_id = yarn_entry_to_package_id[yarn_idx];
        if (package_id == Install.invalid_package_id) continue;

        const dependencies_start = dependencies_buf.ptr;
        const resolutions_start = resolutions_buf.ptr;
        if (entry.dependencies) |deps| {
            const processed = try processDeps(deps, .production, &yarn_lock, &string_buf, dependencies_buf, resolutions_buf, log, manager, yarn_entry_to_package_id);
            dependencies_buf = dependencies_buf[processed.len..];
            resolutions_buf = resolutions_buf[processed.len..];
        }

        if (entry.optionalDependencies) |deps| {
            const processed = try processDeps(deps, .optional, &yarn_lock, &string_buf, dependencies_buf, resolutions_buf, log, manager, yarn_entry_to_package_id);
            dependencies_buf = dependencies_buf[processed.len..];
            resolutions_buf = resolutions_buf[processed.len..];
        }

        if (entry.peerDependencies) |deps| {
            const processed = try processDeps(deps, .peer, &yarn_lock, &string_buf, dependencies_buf, resolutions_buf, log, manager, yarn_entry_to_package_id);
            dependencies_buf = dependencies_buf[processed.len..];
            resolutions_buf = resolutions_buf[processed.len..];
        }

        if (entry.devDependencies) |deps| {
            const processed = try processDeps(deps, .development, &yarn_lock, &string_buf, dependencies_buf, resolutions_buf, log, manager, yarn_entry_to_package_id);
            dependencies_buf = dependencies_buf[processed.len..];
            resolutions_buf = resolutions_buf[processed.len..];
        }

        const deps_len = @intFromPtr(dependencies_buf.ptr) - @intFromPtr(dependencies_start);
        const deps_off = @intFromPtr(dependencies_start) - @intFromPtr(this.buffers.dependencies.items.ptr);
        dependencies_list[package_id] = .{
            .off = @intCast(deps_off / @sizeOf(Dependency)),
            .len = @intCast(deps_len / @sizeOf(Dependency)),
        };
        resolution_list[package_id] = .{
            .off = @intCast((@intFromPtr(resolutions_start) - @intFromPtr(this.buffers.resolutions.items.ptr)) / @sizeOf(Install.PackageID)),
            .len = @intCast((@intFromPtr(resolutions_buf.ptr) - @intFromPtr(resolutions_start)) / @sizeOf(Install.PackageID)),
        };
    }

    this.buffers.dependencies.items.len = @intCast((@intFromPtr(dependencies_buf.ptr) - @intFromPtr(this.buffers.dependencies.items.ptr)) / @sizeOf(Dependency));
    this.buffers.resolutions.items.len = this.buffers.dependencies.items.len;

    try this.buffers.hoisted_dependencies.ensureTotalCapacity(allocator, this.buffers.dependencies.items.len * 2);

    try this.buffers.trees.append(allocator, Tree{
        .id = 0,
        .parent = Tree.invalid_id,
        .dependency_id = Tree.root_dep_id,
        .dependencies = .{
            .off = 0,
            .len = 0,
        },
    });

    var package_dependents = try allocator.alloc(std.array_list.Managed(Install.PackageID), next_package_id);
    defer {
        for (package_dependents) |*list| {
            list.deinit();
        }
        allocator.free(package_dependents);
    }
    for (package_dependents) |*list| {
        list.* = std.array_list.Managed(Install.PackageID).init(allocator);
    }

    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        const parent_package_id = yarn_entry_to_package_id[yarn_idx];

        const dep_maps = [_]?bun.StringHashMap(string){
            entry.dependencies,
            entry.optionalDependencies,
            entry.peerDependencies,
            entry.devDependencies,
        };

        for (dep_maps) |maybe_deps| {
            if (maybe_deps) |deps| {
                var deps_it = deps.iterator();
                while (deps_it.next()) |dep| {
                    const dep_name = dep.key_ptr.*;
                    const dep_version = dep.value_ptr.*;
                    const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep_name, dep_version });
                    defer allocator.free(dep_spec);

                    if (yarn_lock.findEntryBySpec(dep_spec)) |dep_entry| {
                        for (yarn_lock.entries.items, 0..) |*e, idx| {
                            var found = false;
                            for (e.specs) |spec| {
                                for (dep_entry.specs) |dep_spec_item| {
                                    if (strings.eql(spec, dep_spec_item)) {
                                        found = true;
                                        break;
                                    }
                                }
                                if (found) break;
                            }

                            if (found) {
                                const dep_package_id = yarn_entry_to_package_id[idx];
                                try package_dependents[dep_package_id].append(parent_package_id);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    for (root_dependencies.items) |dep| {
        const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep.name, dep.version });
        defer allocator.free(dep_spec);

        for (yarn_lock.entries.items, 0..) |entry, idx| {
            for (entry.specs) |spec| {
                if (strings.eql(spec, dep_spec)) {
                    const dep_package_id = yarn_entry_to_package_id[idx];
                    try package_dependents[dep_package_id].append(0); // 0 is root package
                    break;
                }
            }
        }
    }

    var packages_slice = this.packages.slice();

    var scoped_it = scoped_packages.iterator();
    while (scoped_it.next()) |entry| {
        const base_name = entry.key_ptr.*;
        const versions = entry.value_ptr.*;

        std.sort.pdq(VersionInfo, versions.items, {}, struct {
            fn lessThan(_: void, a: VersionInfo, b: VersionInfo) bool {
                return a.package_id < b.package_id;
            }
        }.lessThan);

        const original_name_hash = stringHash(base_name);
        if (this.package_index.getPtr(original_name_hash)) |original_entry| {
            switch (original_entry.*) {
                .id => {
                    _ = this.package_index.remove(original_name_hash);
                },
                .ids => |*existing_ids| {
                    existing_ids.deinit(this.allocator);
                    _ = this.package_index.remove(original_name_hash);
                },
            }
        } else {}
    }

    var final_check_it = scoped_packages.iterator();
    while (final_check_it.next()) |entry| {
        const base_name = entry.key_ptr.*;
        const versions = entry.value_ptr.*;

        for (versions.items) |version_info| {
            const package_id = version_info.package_id;

            var found_in_index = false;
            var check_it = this.package_index.iterator();
            while (check_it.next()) |index_entry| {
                switch (index_entry.value_ptr.*) {
                    .id => |id| {
                        if (id == package_id) {
                            found_in_index = true;
                            break;
                        }
                    },
                    .ids => |ids| {
                        for (ids.items) |id| {
                            if (id == package_id) {
                                found_in_index = true;
                                break;
                            }
                        }
                        if (found_in_index) break;
                    },
                }
            }

            if (!found_in_index) {
                const fallback_name = try std.fmt.allocPrint(allocator, "{s}#{}", .{ base_name, package_id });
                defer allocator.free(fallback_name);

                const fallback_hash = stringHash(fallback_name);
                try this.getOrPutID(package_id, fallback_hash);
            }
        }
    }

    var package_names = try allocator.alloc([]const u8, next_package_id);
    defer allocator.free(package_names);
    @memset(package_names, "");

    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        const package_id = yarn_entry_to_package_id[yarn_idx];
        if (package_names[package_id].len == 0) {
            package_names[package_id] = YarnLock.Entry.getNameFromSpec(entry.specs[0]);
        }
    }

    var root_packages = bun.StringHashMap(PackageID).init(allocator);
    defer root_packages.deinit();

    var usage_count = bun.StringHashMap(u32).init(allocator);
    defer usage_count.deinit();
    for (yarn_lock.entries.items, 0..) |_, entry_idx| {
        const package_id = yarn_entry_to_package_id[entry_idx];
        if (package_id == Install.invalid_package_id) continue;
        const base_name = package_names[package_id];

        for (yarn_lock.entries.items) |dep_entry| {
            if (dep_entry.dependencies) |deps| {
                var deps_iter = deps.iterator();
                while (deps_iter.next()) |dep| {
                    if (strings.eql(dep.key_ptr.*, base_name)) {
                        const count = usage_count.get(base_name) orelse 0;
                        try usage_count.put(base_name, count + 1);
                    }
                }
            }
        }
    }

    for (yarn_lock.entries.items, 0..) |_, entry_idx| {
        const package_id = yarn_entry_to_package_id[entry_idx];
        if (package_id == Install.invalid_package_id) continue;
        const base_name = package_names[package_id];

        if (root_packages.get(base_name) == null) {
            try root_packages.put(base_name, package_id);
            const name_hash = stringHash(base_name);
            try this.getOrPutID(package_id, name_hash);
        }
    }

    var scoped_names = std.AutoHashMap(PackageID, []const u8).init(allocator);
    defer scoped_names.deinit();
    var scoped_count: u32 = 0;
    for (yarn_lock.entries.items, 0..) |_, entry_idx| {
        const package_id = yarn_entry_to_package_id[entry_idx];
        if (package_id == Install.invalid_package_id) continue;
        const base_name = package_names[package_id];

        if (root_packages.get(base_name)) |root_pkg_id| {
            if (root_pkg_id == package_id) {
                continue;
            }
        } else {
            continue;
        }

        var scoped_name: ?[]const u8 = null;
        for (yarn_lock.entries.items, 0..) |dep_entry, dep_entry_idx| {
            const dep_package_id = yarn_entry_to_package_id[dep_entry_idx];
            if (dep_package_id == Install.invalid_package_id) continue;

            if (dep_entry.dependencies) |deps| {
                var deps_iter = deps.iterator();
                while (deps_iter.next()) |dep| {
                    if (strings.eql(dep.key_ptr.*, base_name)) {
                        if (dep_package_id != package_id) {
                            const parent_name = package_names[dep_package_id];

                            const potential_name = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ parent_name, base_name });

                            var name_already_used = false;
                            var value_iter = scoped_names.valueIterator();
                            while (value_iter.next()) |existing_name| {
                                if (strings.eql(existing_name.*, potential_name)) {
                                    name_already_used = true;
                                    break;
                                }
                            }

                            if (!name_already_used) {
                                scoped_name = potential_name;
                                break;
                            } else {
                                allocator.free(potential_name);
                            }
                        }
                    }
                }
                if (scoped_name != null) break;
            }
        }

        if (scoped_name == null) {
            const version_str = switch (this.packages.get(package_id).resolution.tag) {
                .npm => brk: {
                    var version_buf: [64]u8 = undefined;
                    const formatted = std.fmt.bufPrint(&version_buf, "{f}", .{this.packages.get(package_id).resolution.value.npm.version.fmt(this.buffers.string_bytes.items)}) catch "";
                    break :brk formatted;
                },
                else => "unknown",
            };
            scoped_name = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ base_name, version_str });
        }

        if (scoped_name) |final_scoped_name| {
            const name_hash = stringHash(final_scoped_name);
            try this.getOrPutID(package_id, name_hash);
            try scoped_names.put(package_id, final_scoped_name);
            scoped_count += 1;
        }
    }

    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        const package_id = yarn_entry_to_package_id[yarn_idx];
        if (package_id == Install.invalid_package_id) continue;

        if (entry.resolved) |resolved| {
            if (YarnLock.Entry.getPackageNameFromResolvedUrl(resolved)) |real_name| {
                for (entry.specs) |spec| {
                    const alias_name = YarnLock.Entry.getNameFromSpec(spec);

                    if (!strings.eql(alias_name, real_name)) {
                        const alias_hash = stringHash(alias_name);
                        try this.getOrPutID(package_id, alias_hash);
                    }
                }
            }
        }
    }

    this.buffers.trees.items[0].dependencies = .{ .off = 0, .len = 0 };

    var spec_to_package_id = bun.StringHashMap(Install.PackageID).init(allocator);
    defer spec_to_package_id.deinit();

    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        const package_id = yarn_entry_to_package_id[yarn_idx];
        if (package_id == Install.invalid_package_id) continue;

        for (entry.specs) |spec| {
            try spec_to_package_id.put(spec, package_id);
        }
    }

    const root_deps_off = @as(u32, @intCast(this.buffers.dependencies.items.len));
    const root_resolutions_off = @as(u32, @intCast(this.buffers.resolutions.items.len));

    if (root_dependencies.items.len > 0) {
        for (root_dependencies.items) |root_dep| {
            _ = @as(DependencyID, @intCast(this.buffers.dependencies.items.len));

            const name_hash = stringHash(root_dep.name);
            const dep_name_string = try string_buf.appendWithHash(root_dep.name, name_hash);
            const dep_version_string = try string_buf.append(root_dep.version);
            const sliced_string = Semver.SlicedString.init(dep_version_string.slice(this.buffers.string_bytes.items), dep_version_string.slice(this.buffers.string_bytes.items));

            var parsed_version = Dependency.parse(
                allocator,
                dep_name_string,
                name_hash,
                dep_version_string.slice(this.buffers.string_bytes.items),
                &sliced_string,
                log,
                manager,
            ) orelse Dependency.Version{};

            parsed_version.literal = dep_version_string;

            const dep = Dependency{
                .name_hash = name_hash,
                .name = dep_name_string,
                .version = parsed_version,
                .behavior = .{
                    .prod = root_dep.dep_type == .production,
                    .dev = root_dep.dep_type == .development,
                    .optional = root_dep.dep_type == .optional,
                    .peer = root_dep.dep_type == .peer,
                    .workspace = false,
                },
            };

            try this.buffers.dependencies.append(allocator, dep);

            const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ root_dep.name, root_dep.version });
            defer allocator.free(dep_spec);

            if (spec_to_package_id.get(dep_spec)) |pkg_id| {
                try this.buffers.resolutions.append(allocator, pkg_id);
            } else {
                try this.buffers.resolutions.append(allocator, Install.invalid_package_id);
            }
        }
    }

    packages_slice.items(.dependencies)[0] = .{
        .off = root_deps_off,
        .len = @as(u32, @intCast(root_dependencies.items.len)),
    };
    packages_slice.items(.resolutions)[0] = .{
        .off = root_resolutions_off,
        .len = @as(u32, @intCast(root_dependencies.items.len)),
    };

    for (yarn_lock.entries.items, 0..) |entry, yarn_idx| {
        const package_id = yarn_entry_to_package_id[yarn_idx];
        if (package_id == Install.invalid_package_id) continue;

        var dep_count: u32 = 0;
        const deps_off = @as(u32, @intCast(this.buffers.dependencies.items.len));
        const resolutions_off = @as(u32, @intCast(this.buffers.resolutions.items.len));

        if (entry.dependencies) |deps| {
            var dep_iter = deps.iterator();
            while (dep_iter.next()) |dep_entry| {
                const dep_name = dep_entry.key_ptr.*;
                const dep_version_literal = dep_entry.value_ptr.*;

                const name_hash = stringHash(dep_name);
                const dep_name_string = try string_buf.appendWithHash(dep_name, name_hash);
                const dep_version_string = try string_buf.append(dep_version_literal);
                const sliced_string = Semver.SlicedString.init(dep_version_string.slice(this.buffers.string_bytes.items), dep_version_string.slice(this.buffers.string_bytes.items));

                var parsed_version = Dependency.parse(
                    allocator,
                    dep_name_string,
                    name_hash,
                    dep_version_string.slice(this.buffers.string_bytes.items),
                    &sliced_string,
                    log,
                    manager,
                ) orelse Dependency.Version{};

                parsed_version.literal = dep_version_string;

                try this.buffers.dependencies.append(allocator, Dependency{
                    .name = dep_name_string,
                    .name_hash = name_hash,
                    .version = parsed_version,
                    .behavior = .{ .prod = true },
                });

                const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep_name, dep_version_literal });
                defer allocator.free(dep_spec);

                if (spec_to_package_id.get(dep_spec)) |res_pkg_id| {
                    try this.buffers.resolutions.append(allocator, res_pkg_id);
                } else {
                    try this.buffers.resolutions.append(allocator, Install.invalid_package_id);
                }

                dep_count += 1;
            }
        }

        if (entry.optionalDependencies) |optional_deps| {
            var opt_dep_iter = optional_deps.iterator();
            while (opt_dep_iter.next()) |dep_entry| {
                const dep_name = dep_entry.key_ptr.*;
                const dep_version_literal = dep_entry.value_ptr.*;

                const name_hash = stringHash(dep_name);
                const dep_name_string = try string_buf.appendWithHash(dep_name, name_hash);

                const dep_version_string = try string_buf.append(dep_version_literal);
                const sliced_string = Semver.SlicedString.init(dep_version_string.slice(this.buffers.string_bytes.items), dep_version_string.slice(this.buffers.string_bytes.items));

                var parsed_version = Dependency.parse(
                    allocator,
                    dep_name_string,
                    name_hash,
                    dep_version_string.slice(this.buffers.string_bytes.items),
                    &sliced_string,
                    log,
                    manager,
                ) orelse Dependency.Version{};

                parsed_version.literal = dep_version_string;

                try this.buffers.dependencies.append(allocator, Dependency{
                    .name = dep_name_string,
                    .name_hash = name_hash,
                    .version = parsed_version,
                    .behavior = .{ .optional = true },
                });

                const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep_name, dep_version_literal });
                defer allocator.free(dep_spec);

                if (spec_to_package_id.get(dep_spec)) |res_pkg_id| {
                    try this.buffers.resolutions.append(allocator, res_pkg_id);
                } else {
                    try this.buffers.resolutions.append(allocator, Install.invalid_package_id);
                }

                dep_count += 1;
            }
        }

        if (entry.peerDependencies) |peer_deps| {
            var peer_dep_iter = peer_deps.iterator();
            while (peer_dep_iter.next()) |dep_entry| {
                const dep_name = dep_entry.key_ptr.*;
                const dep_version_literal = dep_entry.value_ptr.*;

                const name_hash = stringHash(dep_name);
                const dep_name_string = try string_buf.appendWithHash(dep_name, name_hash);

                const dep_version_string = try string_buf.append(dep_version_literal);
                const sliced_string = Semver.SlicedString.init(dep_version_string.slice(this.buffers.string_bytes.items), dep_version_string.slice(this.buffers.string_bytes.items));

                var parsed_version = Dependency.parse(
                    allocator,
                    dep_name_string,
                    name_hash,
                    dep_version_string.slice(this.buffers.string_bytes.items),
                    &sliced_string,
                    log,
                    manager,
                ) orelse Dependency.Version{};

                parsed_version.literal = dep_version_string;

                try this.buffers.dependencies.append(allocator, Dependency{
                    .name = dep_name_string,
                    .name_hash = name_hash,
                    .version = parsed_version,
                    .behavior = .{ .peer = true },
                });

                const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep_name, dep_version_literal });
                defer allocator.free(dep_spec);

                if (spec_to_package_id.get(dep_spec)) |res_pkg_id| {
                    try this.buffers.resolutions.append(allocator, res_pkg_id);
                } else {
                    try this.buffers.resolutions.append(allocator, Install.invalid_package_id);
                }

                dep_count += 1;
            }
        }

        if (entry.devDependencies) |dev_deps| {
            var dev_dep_iter = dev_deps.iterator();
            while (dev_dep_iter.next()) |dep_entry| {
                const dep_name = dep_entry.key_ptr.*;
                const dep_version_literal = dep_entry.value_ptr.*;

                const name_hash = stringHash(dep_name);
                const dep_name_string = try string_buf.appendWithHash(dep_name, name_hash);

                const dep_version_string = try string_buf.append(dep_version_literal);
                const sliced_string = Semver.SlicedString.init(dep_version_string.slice(this.buffers.string_bytes.items), dep_version_string.slice(this.buffers.string_bytes.items));

                var parsed_version = Dependency.parse(
                    allocator,
                    dep_name_string,
                    name_hash,
                    dep_version_string.slice(this.buffers.string_bytes.items),
                    &sliced_string,
                    log,
                    manager,
                ) orelse Dependency.Version{};

                parsed_version.literal = dep_version_string;

                try this.buffers.dependencies.append(allocator, Dependency{
                    .name = dep_name_string,
                    .name_hash = name_hash,
                    .version = parsed_version,
                    .behavior = .{ .dev = true },
                });

                const dep_spec = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ dep_name, dep_version_literal });
                defer allocator.free(dep_spec);

                if (spec_to_package_id.get(dep_spec)) |res_pkg_id| {
                    try this.buffers.resolutions.append(allocator, res_pkg_id);
                } else {
                    try this.buffers.resolutions.append(allocator, Install.invalid_package_id);
                }

                dep_count += 1;
            }
        }

        packages_slice.items(.dependencies)[package_id] = .{
            .off = deps_off,
            .len = dep_count,
        };

        packages_slice.items(.resolutions)[package_id] = .{
            .off = resolutions_off,
            .len = dep_count,
        };
    }

    try this.resolve(log);

    try this.fetchNecessaryPackageMetadataAfterYarnOrPnpmMigration(manager, true);

    if (Environment.allow_assert) {
        try this.verifyData();
    }

    this.meta_hash = try this.generateMetaHash(false, this.packages.len);

    const result = LoadResult{ .ok = .{
        .lockfile = this,
        .migrated = .yarn,
        .loaded_from_binary_lockfile = false,
        .serializer_result = .{},
        .format = .binary,
    } };

    return result;
}

const string = []const u8;

const Dependency = @import("./dependency.zig");
const Npm = @import("./npm.zig");
const std = @import("std");
const Bin = @import("./bin.zig").Bin;
const Integrity = @import("./integrity.zig").Integrity;
const Resolution = @import("./resolution.zig").Resolution;
const Allocator = std.mem.Allocator;

const Semver = @import("../semver.zig");
const String = Semver.String;
const stringHash = String.Builder.stringHash;

const Install = @import("./install.zig");
const DependencyID = Install.DependencyID;
const PackageID = Install.PackageID;

const Lockfile = @import("./lockfile.zig");
const LoadResult = Lockfile.LoadResult;
const Tree = Lockfile.Tree;

const bun = @import("bun");
const Environment = bun.Environment;
const JSON = bun.json;
const logger = bun.logger;
const strings = bun.strings;
