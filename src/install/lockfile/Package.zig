pub fn Package(comptime SemverIntType: type) type {
    return extern struct {
        name: String = .{},
        name_hash: PackageNameHash = 0,

        /// How this package has been resolved
        /// When .tag is uninitialized, that means the package is not resolved yet.
        resolution: Resolution = .{},

        /// dependencies & resolutions must be the same length
        /// resolutions[i] is the resolved package ID for dependencies[i]
        /// if resolutions[i] is an invalid package ID, then dependencies[i] is not resolved
        dependencies: DependencySlice = .{},

        /// The resolved package IDs for this package's dependencies. Instead of storing this
        /// on the `Dependency` struct within `.dependencies`, it is stored on the package itself
        /// so we can access it faster.
        ///
        /// Each index in this array corresponds to the same index in dependencies.
        /// Each value in this array corresponds to the resolved package ID for that dependency.
        ///
        /// So this is how you say "what package ID for lodash does this package actually resolve to?"
        ///
        /// By default, the underlying buffer is filled with "invalid_id" to indicate this package ID
        /// was not resolved
        resolutions: PackageIDSlice = .{},

        meta: Meta = Meta.init(),
        bin: Bin = .{},

        /// If any of these scripts run, they will run in order:
        /// 1. preinstall
        /// 2. install
        /// 3. postinstall
        /// 4. preprepare
        /// 5. prepare
        /// 6. postprepare
        scripts: Scripts = .{},

        const PackageType = @This();

        const Resolution = ResolutionType(SemverIntType);

        pub const Scripts = @import("./Package/Scripts.zig").Scripts;
        pub const Meta = @import("./Package/Meta.zig").Meta;
        pub const WorkspaceMap = @import("./Package/WorkspaceMap.zig");

        pub const DependencyGroup = struct {
            prop: string,
            field: string,
            behavior: Behavior,

            pub const dependencies = DependencyGroup{ .prop = "dependencies", .field = "dependencies", .behavior = .{ .prod = true } };
            pub const dev = DependencyGroup{ .prop = "devDependencies", .field = "dev_dependencies", .behavior = .{ .dev = true } };
            pub const optional = DependencyGroup{ .prop = "optionalDependencies", .field = "optional_dependencies", .behavior = .{ .optional = true } };
            pub const peer = DependencyGroup{ .prop = "peerDependencies", .field = "peer_dependencies", .behavior = .{ .peer = true } };
            pub const workspaces = DependencyGroup{ .prop = "workspaces", .field = "workspaces", .behavior = .{ .workspace = true } };
        };

        pub inline fn isDisabled(this: *const @This(), cpu: Npm.Architecture, os: Npm.OperatingSystem) bool {
            return this.meta.isDisabled(cpu, os);
        }

        pub const Alphabetizer = struct {
            names: []const String,
            buf: []const u8,
            resolutions: []const Resolution,

            pub fn isAlphabetical(ctx: Alphabetizer, lhs: PackageID, rhs: PackageID) bool {
                return switch (ctx.names[lhs].order(&ctx.names[rhs], ctx.buf, ctx.buf)) {
                    .eq => ctx.resolutions[lhs].order(&ctx.resolutions[rhs], ctx.buf, ctx.buf) == .lt,
                    .lt => true,
                    .gt => false,
                };
            }
        };

        const debug = Output.scoped(.Lockfile, .hidden);

        pub fn clone(
            this: *const @This(),
            pm: *PackageManager,
            old: *Lockfile,
            new: *Lockfile,
            package_id_mapping: []PackageID,
            cloner: *Cloner,
        ) !PackageID {
            const old_string_buf = old.buffers.string_bytes.items;
            const old_extern_string_buf = old.buffers.extern_strings.items;
            var builder_ = new.stringBuilder();
            var builder = &builder_;
            debug("Clone: {s}@{f} ({s}, {d} dependencies)", .{
                this.name.slice(old_string_buf),
                this.resolution.fmt(old_string_buf, .auto),
                @tagName(this.resolution.tag),
                this.dependencies.len,
            });

            builder.count(this.name.slice(old_string_buf));
            this.resolution.count(old_string_buf, *Lockfile.StringBuilder, builder);
            this.meta.count(old_string_buf, *Lockfile.StringBuilder, builder);
            this.scripts.count(old_string_buf, *Lockfile.StringBuilder, builder);
            for (old.patched_dependencies.values()) |patched_dep| builder.count(patched_dep.path.slice(old.buffers.string_bytes.items));
            const new_extern_string_count = this.bin.count(old_string_buf, old_extern_string_buf, *Lockfile.StringBuilder, builder);
            const old_dependencies: []const Dependency = this.dependencies.get(old.buffers.dependencies.items);
            const old_resolutions: []const PackageID = this.resolutions.get(old.buffers.resolutions.items);

            for (old_dependencies) |dependency| {
                dependency.count(old_string_buf, *Lockfile.StringBuilder, builder);
            }

            try builder.allocate();

            // should be unnecessary, but Just In Case
            try new.buffers.dependencies.ensureUnusedCapacity(new.allocator, old_dependencies.len);
            try new.buffers.resolutions.ensureUnusedCapacity(new.allocator, old_dependencies.len);
            try new.buffers.extern_strings.ensureUnusedCapacity(new.allocator, new_extern_string_count);

            const prev_len = @as(u32, @truncate(new.buffers.dependencies.items.len));
            const end = prev_len + @as(u32, @truncate(old_dependencies.len));
            const max_package_id = @as(PackageID, @truncate(old.packages.len));

            new.buffers.dependencies.items = new.buffers.dependencies.items.ptr[0..end];
            new.buffers.resolutions.items = new.buffers.resolutions.items.ptr[0..end];

            new.buffers.extern_strings.items.len += new_extern_string_count;
            const new_extern_strings = new.buffers.extern_strings.items[new.buffers.extern_strings.items.len - new_extern_string_count ..];

            const dependencies: []Dependency = new.buffers.dependencies.items[prev_len..end];
            const resolutions: []PackageID = new.buffers.resolutions.items[prev_len..end];

            const id = @as(PackageID, @truncate(new.packages.len));
            const new_package = try new.appendPackageWithID(
                .{
                    .name = builder.appendWithHash(
                        String,
                        this.name.slice(old_string_buf),
                        this.name_hash,
                    ),
                    .bin = this.bin.clone(
                        old_string_buf,
                        old_extern_string_buf,
                        new.buffers.extern_strings.items,
                        new_extern_strings,
                        *Lockfile.StringBuilder,
                        builder,
                    ),
                    .name_hash = this.name_hash,
                    .meta = this.meta.clone(
                        id,
                        old_string_buf,
                        *Lockfile.StringBuilder,
                        builder,
                    ),
                    .resolution = this.resolution.clone(
                        old_string_buf,
                        *Lockfile.StringBuilder,
                        builder,
                    ),
                    .scripts = this.scripts.clone(
                        old_string_buf,
                        *Lockfile.StringBuilder,
                        builder,
                    ),
                    .dependencies = .{ .off = prev_len, .len = end - prev_len },
                    .resolutions = .{ .off = prev_len, .len = end - prev_len },
                },
                id,
            );

            package_id_mapping[this.meta.id] = new_package.meta.id;

            if (cloner.manager.preinstall_state.items.len > 0) {
                cloner.manager.preinstall_state.items[new_package.meta.id] = cloner.old_preinstall_state.items[this.meta.id];
            }

            for (old_dependencies, dependencies) |old_dep, *new_dep| {
                new_dep.* = try old_dep.clone(
                    pm,
                    old_string_buf,
                    *Lockfile.StringBuilder,
                    builder,
                );
            }

            builder.clamp();

            cloner.trees_count += @as(u32, @intFromBool(old_resolutions.len > 0));

            for (old_resolutions, resolutions, 0..) |old_resolution, *resolution, i| {
                if (old_resolution >= max_package_id) {
                    resolution.* = invalid_package_id;
                    continue;
                }

                const mapped = package_id_mapping[old_resolution];
                if (mapped < max_package_id) {
                    resolution.* = mapped;
                } else {
                    try cloner.clone_queue.append(.{
                        .old_resolution = old_resolution,
                        .parent = new_package.meta.id,
                        .resolve_id = new_package.resolutions.off + @as(PackageID, @intCast(i)),
                    });
                }
            }

            return new_package.meta.id;
        }

        pub fn fromPackageJSON(
            lockfile: *Lockfile,
            pm: *PackageManager,
            package_json: *PackageJSON,
            comptime features: Features,
        ) !@This() {
            var package = @This(){};

            // var string_buf = package_json;

            var string_builder = lockfile.stringBuilder();

            var total_dependencies_count: u32 = 0;
            // var bin_extern_strings_count: u32 = 0;

            // --- Counting
            {
                string_builder.count(package_json.name);
                string_builder.count(package_json.version);
                const dependencies = package_json.dependencies.map.values();
                for (dependencies) |dep| {
                    if (dep.behavior.isEnabled(features)) {
                        dep.count(package_json.dependencies.source_buf, @TypeOf(&string_builder), &string_builder);
                        total_dependencies_count += 1;
                    }
                }
            }

            // string_builder.count(manifest.str(&package_version_ptr.tarball_url));

            try string_builder.allocate();
            defer string_builder.clamp();
            // var extern_strings_list = &lockfile.buffers.extern_strings;
            var dependencies_list = &lockfile.buffers.dependencies;
            var resolutions_list = &lockfile.buffers.resolutions;
            try dependencies_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
            try resolutions_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
            // try extern_strings_list.ensureUnusedCapacity(lockfile.allocator, bin_extern_strings_count);
            // extern_strings_list.items.len += bin_extern_strings_count;

            // -- Cloning
            {
                const package_name: ExternalString = string_builder.append(ExternalString, package_json.name);
                package.name_hash = package_name.hash;
                package.name = package_name.value;

                package.resolution = .{
                    .tag = .root,
                    .value = .{ .root = {} },
                };

                const total_len = dependencies_list.items.len + total_dependencies_count;
                if (comptime Environment.allow_assert) assert(dependencies_list.items.len == resolutions_list.items.len);

                var dependencies: []Dependency = dependencies_list.items.ptr[dependencies_list.items.len..total_len];
                @memset(dependencies, Dependency{});

                const package_dependencies = package_json.dependencies.map.values();
                const source_buf = package_json.dependencies.source_buf;
                for (package_dependencies) |dep| {
                    if (!dep.behavior.isEnabled(features)) continue;

                    dependencies[0] = try dep.clone(pm, source_buf, @TypeOf(&string_builder), &string_builder);
                    dependencies = dependencies[1..];
                    if (dependencies.len == 0) break;
                }

                // We lose the bin info here
                // package.bin = package_version.bin.clone(string_buf, manifest.extern_strings_bin_entries, extern_strings_list.items, extern_strings_slice, @TypeOf(&string_builder), &string_builder);
                // and the integriy hash
                // package.meta.integrity = package_version.integrity;

                package.meta.arch = package_json.arch;
                package.meta.os = package_json.os;

                package.dependencies.off = @as(u32, @truncate(dependencies_list.items.len));
                package.dependencies.len = total_dependencies_count - @as(u32, @truncate(dependencies.len));
                package.resolutions.off = package.dependencies.off;
                package.resolutions.len = package.dependencies.len;

                const new_length = package.dependencies.len + dependencies_list.items.len;

                @memset(resolutions_list.items.ptr[package.dependencies.off .. package.dependencies.off + package.dependencies.len], invalid_package_id);

                dependencies_list.items = dependencies_list.items.ptr[0..new_length];
                resolutions_list.items = resolutions_list.items.ptr[0..new_length];

                return package;
            }
        }

        pub fn fromNPM(
            pm: *PackageManager,
            allocator: Allocator,
            lockfile: *Lockfile,
            log: *logger.Log,
            manifest: *const Npm.PackageManifest,
            version: Semver.Version,
            package_version_ptr: *const Npm.PackageVersion,
            comptime features: Features,
        ) !@This() {
            var package = @This(){};

            const package_version = package_version_ptr.*;

            const dependency_groups = comptime brk: {
                var out_groups: [
                    @as(usize, @intFromBool(features.dependencies)) +
                        @as(usize, @intFromBool(features.dev_dependencies)) +
                        @as(usize, @intFromBool(features.optional_dependencies)) +
                        @as(usize, @intFromBool(features.peer_dependencies))
                ]DependencyGroup = undefined;
                var out_group_i: usize = 0;

                if (features.dependencies) {
                    out_groups[out_group_i] = DependencyGroup.dependencies;
                    out_group_i += 1;
                }
                if (features.dev_dependencies) {
                    out_groups[out_group_i] = DependencyGroup.dev;
                    out_group_i += 1;
                }

                if (features.optional_dependencies) {
                    out_groups[out_group_i] = DependencyGroup.optional;
                    out_group_i += 1;
                }

                if (features.peer_dependencies) {
                    out_groups[out_group_i] = DependencyGroup.peer;
                    out_group_i += 1;
                }

                break :brk out_groups;
            };

            var string_builder = lockfile.stringBuilder();

            var total_dependencies_count: u32 = 0;
            var bin_extern_strings_count: u32 = 0;

            // --- Counting
            {
                string_builder.count(manifest.name());
                version.count(manifest.string_buf, @TypeOf(&string_builder), &string_builder);

                inline for (dependency_groups) |group| {
                    const map: ExternalStringMap = @field(package_version, group.field);
                    const keys = map.name.get(manifest.external_strings);
                    const version_strings = map.value.get(manifest.external_strings_for_versions);
                    total_dependencies_count += map.value.len;

                    if (comptime Environment.isDebug) assert(keys.len == version_strings.len);

                    for (keys, version_strings) |key, ver| {
                        string_builder.count(key.slice(manifest.string_buf));
                        string_builder.count(ver.slice(manifest.string_buf));
                    }
                }

                bin_extern_strings_count = package_version.bin.count(manifest.string_buf, manifest.extern_strings_bin_entries, @TypeOf(&string_builder), &string_builder);
            }

            string_builder.count(manifest.str(&package_version_ptr.tarball_url));

            try string_builder.allocate();
            defer string_builder.clamp();
            var extern_strings_list = &lockfile.buffers.extern_strings;
            var dependencies_list = &lockfile.buffers.dependencies;
            var resolutions_list = &lockfile.buffers.resolutions;
            try dependencies_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
            try resolutions_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
            try extern_strings_list.ensureUnusedCapacity(lockfile.allocator, bin_extern_strings_count);
            extern_strings_list.items.len += bin_extern_strings_count;
            const extern_strings_slice = extern_strings_list.items[extern_strings_list.items.len - bin_extern_strings_count ..];

            // -- Cloning
            {
                const package_name: ExternalString = string_builder.appendWithHash(ExternalString, manifest.name(), manifest.pkg.name.hash);
                package.name_hash = package_name.hash;
                package.name = package_name.value;
                package.resolution = Resolution{
                    .value = .{
                        .npm = .{
                            .version = version.append(
                                manifest.string_buf,
                                @TypeOf(&string_builder),
                                &string_builder,
                            ),
                            .url = string_builder.append(String, manifest.str(&package_version_ptr.tarball_url)),
                        },
                    },
                    .tag = .npm,
                };

                const total_len = dependencies_list.items.len + total_dependencies_count;
                if (comptime Environment.allow_assert) assert(dependencies_list.items.len == resolutions_list.items.len);

                var dependencies = dependencies_list.items.ptr[dependencies_list.items.len..total_len];
                @memset(dependencies, .{});

                total_dependencies_count = 0;
                inline for (dependency_groups) |group| {
                    const map: ExternalStringMap = @field(package_version, group.field);
                    const keys = map.name.get(manifest.external_strings);
                    const version_strings = map.value.get(manifest.external_strings_for_versions);

                    if (comptime Environment.isDebug) assert(keys.len == version_strings.len);
                    const is_peer = comptime strings.eqlComptime(group.field, "peer_dependencies");

                    list: for (keys, version_strings, 0..) |key, version_string_, i| {
                        // Duplicate peer & dev dependencies are promoted to whichever appeared first
                        // In practice, npm validates this so it shouldn't happen
                        var duplicate_at: ?usize = null;
                        if (comptime group.behavior.isPeer() or group.behavior.isDev() or group.behavior.isOptional()) {
                            for (dependencies[0..total_dependencies_count], 0..) |dependency, j| {
                                if (dependency.name_hash == key.hash) {
                                    if (comptime group.behavior.isOptional()) {
                                        duplicate_at = j;
                                        break;
                                    }

                                    continue :list;
                                }
                            }
                        }

                        const name: ExternalString = string_builder.appendWithHash(ExternalString, key.slice(manifest.string_buf), key.hash);
                        const dep_version = string_builder.appendWithHash(String, version_string_.slice(manifest.string_buf), version_string_.hash);
                        const sliced = dep_version.sliced(lockfile.buffers.string_bytes.items);

                        var behavior = group.behavior;
                        if (comptime is_peer) {
                            behavior.optional = i < package_version.non_optional_peer_dependencies_start;
                        }
                        if (package_version_ptr.allDependenciesBundled()) {
                            behavior.bundled = true;
                        } else for (package_version.bundled_dependencies.get(manifest.bundled_deps_buf)) |bundled_dep_name_hash| {
                            if (bundled_dep_name_hash == name.hash) {
                                behavior.bundled = true;
                                break;
                            }
                        }

                        const dependency = Dependency{
                            .name = name.value,
                            .name_hash = name.hash,
                            .behavior = behavior,
                            .version = Dependency.parse(
                                allocator,
                                name.value,
                                name.hash,
                                sliced.slice,
                                &sliced,
                                log,
                                pm,
                            ) orelse Dependency.Version{},
                        };

                        // If a dependency appears in both "dependencies" and "optionalDependencies", it is considered optional!
                        if (comptime group.behavior.isOptional()) {
                            if (duplicate_at) |j| {
                                // need to shift dependencies after the duplicate to maintain sort order
                                for (j + 1..total_dependencies_count) |k| {
                                    dependencies[k - 1] = dependencies[k];
                                }

                                // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies
                                // > Entries in optionalDependencies will override entries of the same name in dependencies, so it's usually best to only put in one place.
                                dependencies[total_dependencies_count - 1] = dependency;
                                continue :list;
                            }
                        }

                        dependencies[total_dependencies_count] = dependency;
                        total_dependencies_count += 1;
                    }
                }

                package.bin = package_version.bin.clone(manifest.string_buf, manifest.extern_strings_bin_entries, extern_strings_list.items, extern_strings_slice, @TypeOf(&string_builder), &string_builder);

                package.meta.arch = package_version.cpu;
                package.meta.os = package_version.os;
                package.meta.integrity = package_version.integrity;
                package.meta.setHasInstallScript(package_version.has_install_script);

                package.dependencies.off = @as(u32, @truncate(dependencies_list.items.len));
                package.dependencies.len = total_dependencies_count;
                package.resolutions.off = package.dependencies.off;
                package.resolutions.len = package.dependencies.len;

                const new_length = package.dependencies.len + dependencies_list.items.len;

                @memset(resolutions_list.items.ptr[package.dependencies.off .. package.dependencies.off + package.dependencies.len], invalid_package_id);

                dependencies_list.items = dependencies_list.items.ptr[0..new_length];
                resolutions_list.items = resolutions_list.items.ptr[0..new_length];

                if (comptime Environment.isDebug) {
                    if (package.resolution.value.npm.url.isEmpty()) {
                        Output.panic("tarball_url is empty for package {s}@{}", .{ manifest.name(), version });
                    }
                }

                return package;
            }
        }

        pub const Diff = struct {
            pub const Op = enum {
                add,
                remove,
                update,
                unlink,
                link,
            };

            pub const Summary = struct {
                add: u32 = 0,
                remove: u32 = 0,
                update: u32 = 0,
                overrides_changed: bool = false,
                catalogs_changed: bool = false,

                // bool for if this dependency should be added to lockfile trusted dependencies.
                // it is false when the new trusted dependency is coming from the default list.
                added_trusted_dependencies: std.ArrayHashMapUnmanaged(TruncatedPackageNameHash, bool, ArrayIdentityContext, false) = .{},
                removed_trusted_dependencies: TrustedDependenciesSet = .{},

                patched_dependencies_changed: bool = false,

                pub inline fn sum(this: *Summary, that: Summary) void {
                    this.add += that.add;
                    this.remove += that.remove;
                    this.update += that.update;
                }

                pub inline fn hasDiffs(this: Summary) bool {
                    return this.add > 0 or this.remove > 0 or this.update > 0 or this.overrides_changed or this.catalogs_changed or
                        this.added_trusted_dependencies.count() > 0 or
                        this.removed_trusted_dependencies.count() > 0 or
                        this.patched_dependencies_changed;
                }
            };

            pub fn generate(
                pm: *PackageManager,
                allocator: Allocator,
                log: *logger.Log,
                from_lockfile: *Lockfile,
                to_lockfile: *Lockfile,
                from: *PackageType,
                to: *PackageType,
                update_requests: ?[]PackageManager.UpdateRequest,
                id_mapping: ?[]PackageID,
            ) !Summary {
                var summary = Summary{};
                const is_root = id_mapping != null;
                var to_deps = to.dependencies.get(to_lockfile.buffers.dependencies.items);
                const from_deps = from.dependencies.get(from_lockfile.buffers.dependencies.items);
                const from_resolutions = from.resolutions.get(from_lockfile.buffers.resolutions.items);
                var to_i: usize = 0;

                if (from_lockfile.overrides.map.count() != to_lockfile.overrides.map.count()) {
                    summary.overrides_changed = true;

                    if (PackageManager.verbose_install) {
                        Output.prettyErrorln("Overrides changed since last install", .{});
                    }
                } else {
                    from_lockfile.overrides.sort(from_lockfile);
                    to_lockfile.overrides.sort(to_lockfile);
                    for (
                        from_lockfile.overrides.map.keys(),
                        from_lockfile.overrides.map.values(),
                        to_lockfile.overrides.map.keys(),
                        to_lockfile.overrides.map.values(),
                    ) |from_k, *from_override, to_k, *to_override| {
                        if ((from_k != to_k) or (!from_override.eql(to_override, from_lockfile.buffers.string_bytes.items, to_lockfile.buffers.string_bytes.items))) {
                            summary.overrides_changed = true;
                            if (PackageManager.verbose_install) {
                                Output.prettyErrorln("Overrides changed since last install", .{});
                            }
                            break;
                        }
                    }
                }

                if (is_root) catalogs: {

                    // don't sort if lengths are different
                    if (from_lockfile.catalogs.default.count() != to_lockfile.catalogs.default.count()) {
                        summary.catalogs_changed = true;
                        break :catalogs;
                    }

                    if (from_lockfile.catalogs.groups.count() != to_lockfile.catalogs.groups.count()) {
                        summary.catalogs_changed = true;
                        break :catalogs;
                    }

                    from_lockfile.catalogs.sort(from_lockfile);
                    to_lockfile.catalogs.sort(to_lockfile);

                    for (
                        from_lockfile.catalogs.default.keys(),
                        from_lockfile.catalogs.default.values(),
                        to_lockfile.catalogs.default.keys(),
                        to_lockfile.catalogs.default.values(),
                    ) |from_dep_name, *from_dep, to_dep_name, *to_dep| {
                        if (!from_dep_name.eql(to_dep_name, from_lockfile.buffers.string_bytes.items, to_lockfile.buffers.string_bytes.items)) {
                            summary.catalogs_changed = true;
                            break :catalogs;
                        }

                        if (!from_dep.eql(to_dep, from_lockfile.buffers.string_bytes.items, to_lockfile.buffers.string_bytes.items)) {
                            summary.catalogs_changed = true;
                            break :catalogs;
                        }
                    }

                    for (
                        from_lockfile.catalogs.groups.keys(),
                        from_lockfile.catalogs.groups.values(),
                        to_lockfile.catalogs.groups.keys(),
                        to_lockfile.catalogs.groups.values(),
                    ) |from_catalog_name, from_catalog_deps, to_catalog_name, to_catalog_deps| {
                        if (!from_catalog_name.eql(to_catalog_name, from_lockfile.buffers.string_bytes.items, to_lockfile.buffers.string_bytes.items)) {
                            summary.catalogs_changed = true;
                            break :catalogs;
                        }

                        if (from_catalog_deps.count() != to_catalog_deps.count()) {
                            summary.catalogs_changed = true;
                            break :catalogs;
                        }

                        for (
                            from_catalog_deps.keys(),
                            from_catalog_deps.values(),
                            to_catalog_deps.keys(),
                            to_catalog_deps.values(),
                        ) |from_dep_name, *from_dep, to_dep_name, *to_dep| {
                            if (!from_dep_name.eql(to_dep_name, from_lockfile.buffers.string_bytes.items, to_lockfile.buffers.string_bytes.items)) {
                                summary.catalogs_changed = true;
                                break :catalogs;
                            }

                            if (!from_dep.eql(to_dep, from_lockfile.buffers.string_bytes.items, to_lockfile.buffers.string_bytes.items)) {
                                summary.catalogs_changed = true;
                                break :catalogs;
                            }
                        }
                    }
                }

                trusted_dependencies: {
                    // trusted dependency diff
                    //
                    // situations:
                    // 1 - Both old lockfile and new lockfile use default trusted dependencies, no diffs
                    // 2 - Both exist, only diffs are from additions and removals
                    //
                    // 3 - Old lockfile has trusted dependencies, new lockfile does not. Added are dependencies
                    //     from default list that didn't exist previously. We need to be careful not to add these
                    //     to the new lockfile. Removed are dependencies from old list that
                    //     don't exist in the default list.
                    //
                    // 4 - Old lockfile used the default list, new lockfile has trusted dependencies. Added
                    //     are dependencies are all from the new lockfile. Removed is empty because the default
                    //     list isn't appended to the lockfile.

                    // 1
                    if (from_lockfile.trusted_dependencies == null and to_lockfile.trusted_dependencies == null) break :trusted_dependencies;

                    // 2
                    if (from_lockfile.trusted_dependencies != null and to_lockfile.trusted_dependencies != null) {
                        const from_trusted_dependencies = from_lockfile.trusted_dependencies.?;
                        const to_trusted_dependencies = to_lockfile.trusted_dependencies.?;

                        {
                            // added
                            var to_trusted_iter = to_trusted_dependencies.iterator();
                            while (to_trusted_iter.next()) |entry| {
                                const to_trusted = entry.key_ptr.*;
                                if (!from_trusted_dependencies.contains(to_trusted)) {
                                    try summary.added_trusted_dependencies.put(allocator, to_trusted, true);
                                }
                            }
                        }

                        {
                            // removed
                            var from_trusted_iter = from_trusted_dependencies.iterator();
                            while (from_trusted_iter.next()) |entry| {
                                const from_trusted = entry.key_ptr.*;
                                if (!to_trusted_dependencies.contains(from_trusted)) {
                                    try summary.removed_trusted_dependencies.put(allocator, from_trusted, {});
                                }
                            }
                        }

                        break :trusted_dependencies;
                    }

                    // 3
                    if (from_lockfile.trusted_dependencies != null and to_lockfile.trusted_dependencies == null) {
                        const from_trusted_dependencies = from_lockfile.trusted_dependencies.?;

                        {
                            // added
                            for (default_trusted_dependencies.entries) |entry| {
                                if (!from_trusted_dependencies.contains(@truncate(entry.hash))) {
                                    // although this is a new trusted dependency, it is from the default
                                    // list so it shouldn't be added to the lockfile
                                    try summary.added_trusted_dependencies.put(allocator, @truncate(entry.hash), false);
                                }
                            }
                        }

                        {
                            // removed
                            var from_trusted_iter = from_trusted_dependencies.iterator();
                            while (from_trusted_iter.next()) |entry| {
                                const from_trusted = entry.key_ptr.*;
                                if (!default_trusted_dependencies.hasWithHash(@intCast(from_trusted))) {
                                    try summary.removed_trusted_dependencies.put(allocator, from_trusted, {});
                                }
                            }
                        }

                        break :trusted_dependencies;
                    }

                    // 4
                    if (from_lockfile.trusted_dependencies == null and to_lockfile.trusted_dependencies != null) {
                        const to_trusted_dependencies = to_lockfile.trusted_dependencies.?;

                        {
                            // add all to trusted dependencies, even if they exist in default because they weren't in the
                            // lockfile originally
                            var to_trusted_iter = to_trusted_dependencies.iterator();
                            while (to_trusted_iter.next()) |entry| {
                                const to_trusted = entry.key_ptr.*;
                                try summary.added_trusted_dependencies.put(allocator, to_trusted, true);
                            }
                        }

                        {
                            // removed
                            // none
                        }

                        break :trusted_dependencies;
                    }
                }

                summary.patched_dependencies_changed = patched_dependencies_changed: {
                    if (from_lockfile.patched_dependencies.entries.len != to_lockfile.patched_dependencies.entries.len) break :patched_dependencies_changed true;
                    var iter = to_lockfile.patched_dependencies.iterator();
                    while (iter.next()) |entry| {
                        if (from_lockfile.patched_dependencies.get(entry.key_ptr.*)) |val| {
                            if (!std.mem.eql(
                                u8,
                                val.path.slice(from_lockfile.buffers.string_bytes.items),
                                entry.value_ptr.path.slice(to_lockfile.buffers.string_bytes.items),
                            )) break :patched_dependencies_changed true;
                        } else break :patched_dependencies_changed true;
                    }
                    iter = from_lockfile.patched_dependencies.iterator();
                    while (iter.next()) |entry| {
                        if (!to_lockfile.patched_dependencies.contains(entry.key_ptr.*)) break :patched_dependencies_changed true;
                    }
                    break :patched_dependencies_changed false;
                };

                for (from_deps, 0..) |*from_dep, i| {
                    found: {
                        const prev_i = to_i;

                        // common case, dependency is present in both versions:
                        // - in the same position
                        // - shifted by a constant offset
                        while (to_i < to_deps.len) : (to_i += 1) {
                            if (from_dep.name_hash == to_deps[to_i].name_hash) {
                                const from_behavior = from_dep.behavior;
                                const to_behavior = to_deps[to_i].behavior;

                                if (from_behavior != to_behavior) {
                                    continue;
                                }

                                break :found;
                            }
                        }

                        // less common, o(n^2) case
                        to_i = 0;
                        while (to_i < prev_i) : (to_i += 1) {
                            if (from_dep.name_hash == to_deps[to_i].name_hash) {
                                const from_behavior = from_dep.behavior;
                                const to_behavior = to_deps[to_i].behavior;

                                if (from_behavior != to_behavior) {
                                    continue;
                                }

                                break :found;
                            }
                        }

                        // We found a removed dependency!
                        // We don't need to remove it
                        // It will be cleaned up later
                        summary.remove += 1;
                        continue;
                    }
                    defer to_i += 1;

                    if (to_deps[to_i].eql(from_dep, to_lockfile.buffers.string_bytes.items, from_lockfile.buffers.string_bytes.items)) {
                        if (update_requests) |updates| {
                            if (updates.len == 0 or brk: {
                                for (updates) |request| {
                                    if (from_dep.name_hash == request.name_hash) break :brk true;
                                }
                                break :brk false;
                            }) {
                                // Listed as to be updated
                                summary.update += 1;
                                continue;
                            }
                        }

                        if (id_mapping) |mapping| {
                            const update_mapping = update_mapping: {
                                if (!is_root or !from_dep.behavior.isWorkspace()) {
                                    break :update_mapping true;
                                }

                                const workspace_path = to_lockfile.workspace_paths.getPtr(from_dep.name_hash) orelse {
                                    break :update_mapping false;
                                };

                                var package_json_path: bun.AbsPath(.{ .sep = .auto }) = .initTopLevelDir();
                                defer package_json_path.deinit();

                                package_json_path.append(workspace_path.slice(to_lockfile.buffers.string_bytes.items));
                                package_json_path.append("package.json");

                                const source = &(bun.sys.File.toSource(package_json_path.sliceZ(), allocator, .{}).unwrap() catch {
                                    break :update_mapping false;
                                });

                                var workspace_pkg: PackageType = .{};

                                const json = pm.workspace_package_json_cache.getWithSource(bun.default_allocator, log, source, .{}).unwrap() catch {
                                    break :update_mapping false;
                                };

                                var resolver: void = {};
                                try workspace_pkg.parseWithJSON(
                                    to_lockfile,
                                    pm,
                                    allocator,
                                    log,
                                    source,
                                    json.root,
                                    void,
                                    &resolver,
                                    Features.workspace,
                                );

                                to_deps = to.dependencies.get(to_lockfile.buffers.dependencies.items);

                                var from_pkg = from_lockfile.packages.get(from_resolutions[i]);
                                const diff = try generate(
                                    pm,
                                    allocator,
                                    log,
                                    from_lockfile,
                                    to_lockfile,
                                    &from_pkg,
                                    &workspace_pkg,
                                    update_requests,
                                    null,
                                );

                                if (pm.options.log_level.isVerbose() and (diff.add + diff.remove + diff.update) > 0) {
                                    Output.prettyErrorln("Workspace package \"{s}\" has added <green>{d}<r> dependencies, removed <red>{d}<r> dependencies, and updated <cyan>{d}<r> dependencies", .{
                                        workspace_path.slice(to_lockfile.buffers.string_bytes.items),
                                        diff.add,
                                        diff.remove,
                                        diff.update,
                                    });
                                }

                                break :update_mapping !diff.hasDiffs();
                            };

                            if (update_mapping) {
                                mapping[to_i] = @truncate(i);
                                continue;
                            }
                        } else {
                            continue;
                        }
                    }

                    // We found a changed dependency!
                    summary.update += 1;
                }

                // Use saturating arithmetic here because a migrated
                // package-lock.json could be out of sync with the package.json, so the
                // number of from_deps could be greater than to_deps.
                summary.add = @truncate((to_deps.len) -| (from_deps.len -| summary.remove));

                if (from.resolution.tag != .root) {
                    inline for (Lockfile.Scripts.names) |hook| {
                        if (!@field(to.scripts, hook).eql(
                            @field(from.scripts, hook),
                            to_lockfile.buffers.string_bytes.items,
                            from_lockfile.buffers.string_bytes.items,
                        )) {
                            // We found a changed life-cycle script
                            summary.update += 1;
                        }
                    }
                }

                return summary;
            }
        };

        pub fn hash(name: string, version: Semver.Version) u64 {
            var hasher = bun.Wyhash.init(0);
            hasher.update(name);
            hasher.update(std.mem.asBytes(&version));
            return hasher.final();
        }

        pub fn parse(
            package: *@This(),
            lockfile: *Lockfile,
            pm: *PackageManager,
            allocator: Allocator,
            log: *logger.Log,
            source: *const logger.Source,
            comptime ResolverContext: type,
            resolver: *ResolverContext,
            comptime features: Features,
        ) !void {
            initializeStore();
            const json = JSON.parsePackageJSONUTF8(source, log, allocator) catch |err| {
                log.print(Output.errorWriter()) catch {};
                Output.prettyErrorln("<r><red>{s}<r> parsing package.json in <b>\"{s}\"<r>", .{ @errorName(err), source.path.prettyDir() });
                Global.crash();
            };

            try package.parseWithJSON(
                lockfile,
                pm,
                allocator,
                log,
                source,
                json,
                ResolverContext,
                resolver,
                features,
            );
        }

        fn parseDependency(
            lockfile: *Lockfile,
            pm: *PackageManager,
            allocator: Allocator,
            log: *logger.Log,
            source: *const logger.Source,
            comptime group: DependencyGroup,
            string_builder: *StringBuilder,
            comptime features: Features,
            package_dependencies: []Dependency,
            dependencies_count: u32,
            comptime tag: ?Dependency.Version.Tag,
            workspace_ver: ?Semver.Version,
            external_alias: ExternalString,
            version: string,
            key_loc: logger.Loc,
            value_loc: logger.Loc,
        ) !?Dependency {
            const external_version = brk: {
                if (comptime Environment.isWindows) {
                    switch (tag orelse Dependency.Version.Tag.infer(version)) {
                        .workspace, .folder, .symlink, .tarball => {
                            if (String.canInline(version)) {
                                var copy = string_builder.append(String, version);
                                bun.path.dangerouslyConvertPathToPosixInPlace(u8, &copy.bytes);
                                break :brk copy;
                            } else {
                                const str_ = string_builder.append(String, version);
                                const ptr = str_.ptr();
                                bun.path.dangerouslyConvertPathToPosixInPlace(u8, lockfile.buffers.string_bytes.items[ptr.off..][0..ptr.len]);
                                break :brk str_;
                            }
                        },
                        else => {},
                    }
                }

                break :brk string_builder.append(String, version);
            };

            const buf = lockfile.buffers.string_bytes.items;
            const sliced = external_version.sliced(buf);

            var dependency_version = Dependency.parseWithOptionalTag(
                allocator,
                external_alias.value,
                external_alias.hash,
                sliced.slice,
                tag,
                &sliced,
                log,
                pm,
            ) orelse Dependency.Version{};
            var workspace_range: ?Semver.Query.Group = null;
            const name_hash = switch (dependency_version.tag) {
                .npm => String.Builder.stringHash(dependency_version.value.npm.name.slice(buf)),
                .workspace => if (strings.hasPrefixComptime(sliced.slice, "workspace:")) brk: {
                    const input = sliced.slice["workspace:".len..];
                    const trimmed = strings.trim(input, &strings.whitespace_chars);
                    if (trimmed.len != 1 or (trimmed[0] != '*' and trimmed[0] != '^' and trimmed[0] != '~')) {
                        const at = strings.lastIndexOfChar(input, '@') orelse 0;
                        if (at > 0) {
                            workspace_range = Semver.Query.parse(allocator, input[at + 1 ..], sliced) catch |err| {
                                switch (err) {
                                    error.OutOfMemory => bun.outOfMemory(),
                                }
                            };
                            break :brk String.Builder.stringHash(input[0..at]);
                        }
                        workspace_range = Semver.Query.parse(allocator, input, sliced) catch |err| {
                            switch (err) {
                                error.OutOfMemory => bun.outOfMemory(),
                            }
                        };
                    }
                    break :brk external_alias.hash;
                } else external_alias.hash,
                else => external_alias.hash,
            };

            var workspace_path: ?String = null;
            var workspace_version = workspace_ver;
            if (comptime tag == null) {
                workspace_path = lockfile.workspace_paths.get(name_hash);
                workspace_version = lockfile.workspace_versions.get(name_hash);
            }

            if (comptime tag != null) {
                bun.assert(dependency_version.tag != .npm and dependency_version.tag != .dist_tag);
            }

            switch (dependency_version.tag) {
                .folder => {
                    const relative = Path.relative(
                        FileSystem.instance.top_level_dir,
                        Path.joinAbsString(
                            FileSystem.instance.top_level_dir,
                            &[_]string{
                                source.path.name.dir,
                                dependency_version.value.folder.slice(buf),
                            },
                            .auto,
                        ),
                    );
                    // if relative is empty, we are linking the package to itself
                    dependency_version.value.folder = string_builder.append(String, if (relative.len == 0) "." else relative);
                },
                .npm => {
                    const npm = dependency_version.value.npm;
                    if (workspace_version != null) {
                        if (pm.options.link_workspace_packages and npm.version.satisfies(workspace_version.?, buf, buf)) {
                            const path = workspace_path.?.sliced(buf);
                            if (Dependency.parseWithTag(
                                allocator,
                                external_alias.value,
                                external_alias.hash,
                                path.slice,
                                .workspace,
                                &path,
                                log,
                                pm,
                            )) |dep| {
                                dependency_version.tag = dep.tag;
                                dependency_version.value = dep.value;
                            }
                        } else {
                            // It doesn't satisfy, but a workspace shares the same name. Override the workspace with the other dependency
                            for (package_dependencies[0..dependencies_count]) |*dep| {
                                if (dep.name_hash == name_hash and dep.behavior.isWorkspace()) {
                                    dep.* = .{
                                        .behavior = group.behavior,
                                        .name = external_alias.value,
                                        .name_hash = external_alias.hash,
                                        .version = dependency_version,
                                    };
                                    return null;
                                }
                            }
                        }
                    }
                },
                .workspace => workspace: {
                    if (workspace_path) |path| {
                        if (workspace_range) |range| {
                            if (workspace_version) |ver| {
                                if (range.satisfies(ver, buf, buf)) {
                                    dependency_version.value.workspace = path;
                                    break :workspace;
                                }
                            }

                            // important to trim before len == 0 check. `workspace:foo@      ` should install successfully
                            const version_literal = strings.trim(range.input, &strings.whitespace_chars);
                            if (version_literal.len == 0 or range.@"is *"() or Semver.Version.isTaggedVersionOnly(version_literal)) {
                                dependency_version.value.workspace = path;
                                break :workspace;
                            }

                            // workspace is not required to have a version, but if it does
                            // and this version doesn't match it, fail to install
                            try log.addErrorFmt(
                                source,
                                logger.Loc.Empty,
                                allocator,
                                "No matching version for workspace dependency \"{s}\". Version: \"{s}\"",
                                .{
                                    external_alias.slice(buf),
                                    dependency_version.literal.slice(buf),
                                },
                            );
                            return error.InstallFailed;
                        }

                        dependency_version.value.workspace = path;
                    } else {
                        const workspace = dependency_version.value.workspace.slice(buf);
                        const path = string_builder.append(String, if (strings.eqlComptime(workspace, "*")) "*" else brk: {
                            var buf2: bun.PathBuffer = undefined;
                            const rel = Path.relativePlatform(
                                FileSystem.instance.top_level_dir,
                                Path.joinAbsStringBuf(
                                    FileSystem.instance.top_level_dir,
                                    &buf2,
                                    &[_]string{
                                        source.path.name.dir,
                                        workspace,
                                    },
                                    .auto,
                                ),
                                .auto,
                                false,
                            );
                            if (comptime Environment.isWindows) {
                                bun.path.dangerouslyConvertPathToPosixInPlace(u8, Path.relative_to_common_path_buf[0..rel.len]);
                            }
                            break :brk rel;
                        });
                        if (comptime Environment.allow_assert) {
                            assert(path.len() > 0);
                            assert(!std.fs.path.isAbsolute(path.slice(buf)));
                        }
                        dependency_version.value.workspace = path;

                        const workspace_entry = try lockfile.workspace_paths.getOrPut(allocator, name_hash);
                        const found_matching_workspace = workspace_entry.found_existing;

                        if (workspace_version) |ver| {
                            try lockfile.workspace_versions.put(allocator, name_hash, ver);
                            for (package_dependencies[0..dependencies_count]) |*package_dep| {
                                if (switch (package_dep.version.tag) {
                                    // `dependencies` & `workspaces` defined within the same `package.json`
                                    .npm => String.Builder.stringHash(package_dep.realname().slice(buf)) == name_hash and
                                        package_dep.version.value.npm.version.satisfies(ver, buf, buf),
                                    // `workspace:*`
                                    .workspace => found_matching_workspace and
                                        String.Builder.stringHash(package_dep.realname().slice(buf)) == name_hash,
                                    else => false,
                                }) {
                                    package_dep.version = dependency_version;
                                    workspace_entry.value_ptr.* = path;
                                    return null;
                                }
                            }
                        } else if (workspace_entry.found_existing) {
                            for (package_dependencies[0..dependencies_count]) |*package_dep| {
                                if (package_dep.version.tag == .workspace and
                                    String.Builder.stringHash(package_dep.realname().slice(buf)) == name_hash)
                                {
                                    package_dep.version = dependency_version;
                                    return null;
                                }
                            }
                            return error.InstallFailed;
                        }

                        workspace_entry.value_ptr.* = path;
                    }
                },
                else => {},
            }

            const this_dep = Dependency{
                .behavior = group.behavior,
                .name = external_alias.value,
                .name_hash = external_alias.hash,
                .version = dependency_version,
            };

            // `peerDependencies` may be specified on existing dependencies. Packages in `workspaces` are deduplicated when
            // the array is processed
            if (comptime features.check_for_duplicate_dependencies and !group.behavior.isPeer() and !group.behavior.isWorkspace()) {
                const entry = lockfile.scratch.duplicate_checker_map.getOrPutAssumeCapacity(external_alias.hash);
                if (entry.found_existing) {
                    // duplicate dependencies are allowed in optionalDependencies
                    if (comptime group.behavior.isOptional()) {
                        for (package_dependencies[0..dependencies_count]) |*package_dep| {
                            if (package_dep.name_hash == this_dep.name_hash) {
                                package_dep.* = this_dep;
                                break;
                            }
                        }
                        return null;
                    } else {
                        var notes = try allocator.alloc(logger.Data, 1);

                        notes[0] = .{
                            .text = try std.fmt.allocPrint(lockfile.allocator, "\"{s}\" originally specified here", .{external_alias.slice(buf)}),
                            .location = logger.Location.initOrNull(source, source.rangeOfString(entry.value_ptr.*)),
                        };

                        try log.addRangeWarningFmtWithNotes(
                            source,
                            source.rangeOfString(key_loc),
                            lockfile.allocator,
                            notes,
                            "Duplicate dependency: \"{s}\" specified in package.json",
                            .{external_alias.slice(buf)},
                        );
                    }
                }

                entry.value_ptr.* = value_loc;
            }

            return this_dep;
        }

        pub fn parseWithJSON(
            package: *@This(),
            lockfile: *Lockfile,
            pm: *PackageManager,
            allocator: Allocator,
            log: *logger.Log,
            source: *const logger.Source,
            json: Expr,
            comptime ResolverContext: type,
            resolver: *ResolverContext,
            comptime features: Features,
        ) !void {
            var string_builder = lockfile.stringBuilder();
            var total_dependencies_count: u32 = 0;

            package.meta.origin = if (features.is_main) .local else .npm;
            package.name = String{};
            package.name_hash = 0;

            // -- Count the sizes
            name: {
                if (json.asProperty("name")) |name_q| {
                    if (name_q.expr.asString(allocator)) |name| {
                        if (name.len != 0) {
                            string_builder.count(name);
                            break :name;
                        }
                    }
                }

                // name is not validated by npm, so fallback to creating a new from the version literal
                if (ResolverContext == PackageManager.GitResolver) {
                    const resolution: *const Resolution = resolver.resolution;
                    const repo = switch (resolution.tag) {
                        .git => resolution.value.git,
                        .github => resolution.value.github,

                        else => break :name,
                    };

                    resolver.new_name = Repository.createDependencyNameFromVersionLiteral(
                        lockfile.allocator,
                        &repo,
                        lockfile,
                        resolver.dep_id,
                    );

                    string_builder.count(resolver.new_name);
                }
            }

            if (json.asProperty("patchedDependencies")) |patched_deps| {
                const obj = patched_deps.expr.data.e_object;
                for (obj.properties.slice()) |prop| {
                    const key = prop.key.?;
                    const value = prop.value.?;
                    if (key.isString() and value.isString()) {
                        string_builder.count(value.asString(allocator).?);
                    }
                }
            }

            if (comptime !features.is_main) {
                if (json.asProperty("version")) |version_q| {
                    if (version_q.expr.asString(allocator)) |version_str| {
                        string_builder.count(version_str);
                    }
                }
            }
            bin: {
                if (json.asProperty("bin")) |bin| {
                    switch (bin.expr.data) {
                        .e_object => |obj| {
                            for (obj.properties.slice()) |bin_prop| {
                                string_builder.count(bin_prop.key.?.asString(allocator) orelse break :bin);
                                string_builder.count(bin_prop.value.?.asString(allocator) orelse break :bin);
                            }
                            break :bin;
                        },
                        .e_string => {
                            if (bin.expr.asString(allocator)) |str_| {
                                string_builder.count(str_);
                                break :bin;
                            }
                        },
                        else => {},
                    }
                }

                if (json.asProperty("directories")) |dirs| {
                    if (dirs.expr.asProperty("bin")) |bin_prop| {
                        if (bin_prop.expr.asString(allocator)) |str_| {
                            string_builder.count(str_);
                            break :bin;
                        }
                    }
                }
            }

            Scripts.parseCount(allocator, &string_builder, json);

            if (comptime ResolverContext != void) {
                resolver.count(*Lockfile.StringBuilder, &string_builder, json);
            }

            const dependency_groups = comptime brk: {
                var out_groups: [
                    @as(usize, @intFromBool(features.workspaces)) +
                        @as(usize, @intFromBool(features.dependencies)) +
                        @as(usize, @intFromBool(features.dev_dependencies)) +
                        @as(usize, @intFromBool(features.optional_dependencies)) +
                        @as(usize, @intFromBool(features.peer_dependencies))
                ]DependencyGroup = undefined;
                var out_group_i: usize = 0;

                if (features.workspaces) {
                    out_groups[out_group_i] = DependencyGroup.workspaces;
                    out_group_i += 1;
                }

                if (features.dependencies) {
                    out_groups[out_group_i] = DependencyGroup.dependencies;
                    out_group_i += 1;
                }

                if (features.dev_dependencies) {
                    out_groups[out_group_i] = DependencyGroup.dev;
                    out_group_i += 1;
                }
                if (features.optional_dependencies) {
                    out_groups[out_group_i] = DependencyGroup.optional;
                    out_group_i += 1;
                }

                if (features.peer_dependencies) {
                    out_groups[out_group_i] = DependencyGroup.peer;
                    out_group_i += 1;
                }

                break :brk out_groups;
            };

            var workspace_names = WorkspaceMap.init(allocator);
            defer workspace_names.deinit();

            var optional_peer_dependencies = std.ArrayHashMap(PackageNameHash, void, ArrayIdentityContext.U64, false).init(allocator);
            defer optional_peer_dependencies.deinit();

            if (json.asProperty("peerDependenciesMeta")) |peer_dependencies_meta| {
                if (peer_dependencies_meta.expr.data == .e_object) {
                    const props = peer_dependencies_meta.expr.data.e_object.properties.slice();
                    try optional_peer_dependencies.ensureUnusedCapacity(props.len);
                    for (props) |prop| {
                        if (prop.value.?.asProperty("optional")) |optional| {
                            if (optional.expr.data != .e_boolean or !optional.expr.data.e_boolean.value) {
                                continue;
                            }

                            optional_peer_dependencies.putAssumeCapacity(
                                String.Builder.stringHash(prop.key.?.asString(allocator) orelse unreachable),
                                {},
                            );
                        }
                    }
                }
            }

            inline for (dependency_groups) |group| {
                if (json.asProperty(group.prop)) |dependencies_q| brk: {
                    switch (dependencies_q.expr.data) {
                        .e_array => |arr| {
                            if (!group.behavior.isWorkspace()) {
                                log.addErrorFmt(source, dependencies_q.loc, allocator,
                                    \\{0s} expects a map of specifiers, e.g.
                                    \\  <r><green>"{0s}"<r>: {{
                                    \\    <green>"bun"<r>: <green>"latest"<r>
                                    \\  }}
                                , .{group.prop}) catch {};
                                return error.InvalidPackageJSON;
                            }
                            total_dependencies_count += try workspace_names.processNamesArray(
                                allocator,
                                &pm.workspace_package_json_cache,
                                log,
                                arr,
                                source,
                                dependencies_q.loc,
                                &string_builder,
                            );
                        },
                        .e_object => |obj| {
                            if (group.behavior.isWorkspace()) {

                                // yarn workspaces expects a "workspaces" property shaped like this:
                                //
                                //    "workspaces": {
                                //        "packages": [
                                //           "path/to/package"
                                //        ]
                                //    }
                                //
                                if (obj.get("packages")) |packages_query| {
                                    if (packages_query.data != .e_array) {
                                        log.addErrorFmt(source, packages_query.loc, allocator,
                                            // TODO: what if we could comptime call the syntax highlighter
                                            \\"workspaces.packages" expects an array of strings, e.g.
                                            \\  "workspaces": {{
                                            \\    "packages": [
                                            \\      "path/to/package"
                                            \\    ]
                                            \\  }}
                                        , .{}) catch {};
                                        return error.InvalidPackageJSON;
                                    }
                                    total_dependencies_count += try workspace_names.processNamesArray(
                                        allocator,
                                        &pm.workspace_package_json_cache,
                                        log,
                                        packages_query.data.e_array,
                                        source,
                                        packages_query.loc,
                                        &string_builder,
                                    );
                                }

                                break :brk;
                            }
                            for (obj.properties.slice()) |item| {
                                const key = item.key.?.asString(allocator).?;
                                const value = item.value.?.asString(allocator) orelse {
                                    log.addErrorFmt(source, item.value.?.loc, allocator,
                                        // TODO: what if we could comptime call the syntax highlighter
                                        \\{0s} expects a map of specifiers, e.g.
                                        \\  <r><green>"{0s}"<r>: {{
                                        \\    <green>"bun"<r>: <green>"latest"<r>
                                        \\  }}
                                    , .{group.prop}) catch {};
                                    return error.InvalidPackageJSON;
                                };

                                string_builder.count(key);
                                string_builder.count(value);

                                // If it's a folder or workspace, pessimistically assume we will need a maximum path
                                switch (Dependency.Version.Tag.infer(value)) {
                                    .folder, .workspace => string_builder.cap += bun.MAX_PATH_BYTES,
                                    else => {},
                                }
                            }
                            total_dependencies_count += @as(u32, @truncate(obj.properties.len));
                        },
                        else => {
                            if (group.behavior.isWorkspace()) {
                                log.addErrorFmt(source, dependencies_q.loc, allocator,
                                    // TODO: what if we could comptime call the syntax highlighter
                                    \\"workspaces" expects an array of strings, e.g.
                                    \\  <r><green>"workspaces"<r>: [
                                    \\    <green>"path/to/package"<r>
                                    \\  ]
                                , .{}) catch {};
                            } else {
                                log.addErrorFmt(source, dependencies_q.loc, allocator,
                                    \\{0s} expects a map of specifiers, e.g.
                                    \\  <r><green>"{0s}"<r>: {{
                                    \\    <green>"bun"<r>: <green>"latest"<r>
                                    \\  }}
                                , .{group.prop}) catch {};
                            }
                            return error.InvalidPackageJSON;
                        },
                    }
                }
            }

            if (comptime features.trusted_dependencies) {
                if (json.asProperty("trustedDependencies")) |q| {
                    switch (q.expr.data) {
                        .e_array => |arr| {
                            if (lockfile.trusted_dependencies == null) lockfile.trusted_dependencies = .{};
                            try lockfile.trusted_dependencies.?.ensureUnusedCapacity(allocator, arr.items.len);
                            for (arr.slice()) |item| {
                                const name = item.asString(allocator) orelse {
                                    log.addErrorFmt(source, q.loc, allocator,
                                        \\trustedDependencies expects an array of strings, e.g.
                                        \\  <r><green>"trustedDependencies"<r>: [
                                        \\    <green>"package_name"<r>
                                        \\  ]
                                    , .{}) catch {};
                                    return error.InvalidPackageJSON;
                                };
                                lockfile.trusted_dependencies.?.putAssumeCapacity(@as(TruncatedPackageNameHash, @truncate(String.Builder.stringHash(name))), {});
                            }
                        },
                        else => {
                            log.addErrorFmt(source, q.loc, allocator,
                                \\trustedDependencies expects an array of strings, e.g.
                                \\  <r><green>"trustedDependencies"<r>: [
                                \\    <green>"package_name"<r>
                                \\  ]
                            , .{}) catch {};
                            return error.InvalidPackageJSON;
                        },
                    }
                }
            }

            if (comptime features.is_main) {
                lockfile.overrides.parseCount(lockfile, json, &string_builder);

                if (json.get("workspaces")) |workspaces_expr| {
                    lockfile.catalogs.parseCount(lockfile, workspaces_expr, &string_builder);
                }

                // Count catalog strings in top-level package.json as well, since parseAppend
                // might process them later if no catalogs were found in workspaces
                lockfile.catalogs.parseCount(lockfile, json, &string_builder);

                try install.PostinstallOptimizer.fromPackageJSON(&pm.postinstall_optimizer, &json, allocator);
            }

            try string_builder.allocate();
            try lockfile.buffers.dependencies.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
            try lockfile.buffers.resolutions.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);

            const off = lockfile.buffers.dependencies.items.len;
            const total_len = off + total_dependencies_count;
            if (comptime Environment.allow_assert) assert(lockfile.buffers.dependencies.items.len == lockfile.buffers.resolutions.items.len);

            const package_dependencies = lockfile.buffers.dependencies.items.ptr[off..total_len];

            name: {
                if (ResolverContext == PackageManager.GitResolver) {
                    if (resolver.new_name.len != 0) {
                        defer lockfile.allocator.free(resolver.new_name);
                        const external_string = string_builder.append(ExternalString, resolver.new_name);
                        package.name = external_string.value;
                        package.name_hash = external_string.hash;
                        break :name;
                    }
                }

                if (json.asProperty("name")) |name_q| {
                    if (name_q.expr.asString(allocator)) |name| {
                        if (name.len != 0) {
                            const external_string = string_builder.append(ExternalString, name);

                            package.name = external_string.value;
                            package.name_hash = external_string.hash;
                            break :name;
                        }
                    }
                }
            }

            if (comptime !features.is_main) {
                if (comptime ResolverContext != void) {
                    package.resolution = try resolver.resolve(
                        *Lockfile.StringBuilder,
                        &string_builder,
                        json,
                    );
                }
            } else {
                package.resolution = .{
                    .tag = .root,
                    .value = .{ .root = {} },
                };
            }

            if (json.asProperty("patchedDependencies")) |patched_deps| {
                const obj = patched_deps.expr.data.e_object;
                lockfile.patched_dependencies.ensureTotalCapacity(allocator, obj.properties.len) catch unreachable;
                for (obj.properties.slice()) |prop| {
                    const key = prop.key.?;
                    const value = prop.value.?;
                    if (key.isString() and value.isString()) {
                        var sfb = std.heap.stackFallback(1024, allocator);
                        const keyhash = try key.asStringHash(sfb.get(), String.Builder.stringHash) orelse unreachable;
                        const patch_path = string_builder.append(String, value.asString(allocator).?);
                        lockfile.patched_dependencies.put(allocator, keyhash, .{ .path = patch_path }) catch unreachable;
                    }
                }
            }

            bin: {
                if (json.asProperty("bin")) |bin| {
                    switch (bin.expr.data) {
                        .e_object => |obj| {
                            switch (obj.properties.len) {
                                0 => {},
                                1 => {
                                    const bin_name = obj.properties.ptr[0].key.?.asString(allocator) orelse break :bin;
                                    const value = obj.properties.ptr[0].value.?.asString(allocator) orelse break :bin;

                                    package.bin = .{
                                        .tag = .named_file,
                                        .value = .{
                                            .named_file = .{
                                                string_builder.append(String, bin_name),
                                                string_builder.append(String, value),
                                            },
                                        },
                                    };
                                },
                                else => {
                                    const current_len = lockfile.buffers.extern_strings.items.len;
                                    const count = @as(usize, obj.properties.len * 2);
                                    try lockfile.buffers.extern_strings.ensureTotalCapacityPrecise(
                                        lockfile.allocator,
                                        current_len + count,
                                    );
                                    var extern_strings = lockfile.buffers.extern_strings.items.ptr[current_len .. current_len + count];
                                    lockfile.buffers.extern_strings.items.len += count;

                                    var i: usize = 0;
                                    for (obj.properties.slice()) |bin_prop| {
                                        extern_strings[i] = string_builder.append(ExternalString, bin_prop.key.?.asString(allocator) orelse break :bin);
                                        i += 1;
                                        extern_strings[i] = string_builder.append(ExternalString, bin_prop.value.?.asString(allocator) orelse break :bin);
                                        i += 1;
                                    }
                                    if (comptime Environment.allow_assert) assert(i == extern_strings.len);
                                    package.bin = .{
                                        .tag = .map,
                                        .value = .{ .map = ExternalStringList.init(lockfile.buffers.extern_strings.items, extern_strings) },
                                    };
                                },
                            }

                            break :bin;
                        },
                        .e_string => |stri| {
                            if (stri.data.len > 0) {
                                package.bin = .{
                                    .tag = .file,
                                    .value = .{
                                        .file = string_builder.append(String, stri.data),
                                    },
                                };
                                break :bin;
                            }
                        },
                        else => {},
                    }
                }

                if (json.asProperty("directories")) |dirs| {
                    // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#directoriesbin
                    // Because of the way the bin directive works,
                    // specifying both a bin path and setting
                    // directories.bin is an error. If you want to
                    // specify individual files, use bin, and for all
                    // the files in an existing bin directory, use
                    // directories.bin.
                    if (dirs.expr.asProperty("bin")) |bin_prop| {
                        if (bin_prop.expr.asString(allocator)) |str_| {
                            if (str_.len > 0) {
                                package.bin = .{
                                    .tag = .dir,
                                    .value = .{
                                        .dir = string_builder.append(String, str_),
                                    },
                                };
                                break :bin;
                            }
                        }
                    }
                }
            }

            package.scripts.parseAlloc(allocator, &string_builder, json);
            package.scripts.filled = true;

            // It is allowed for duplicate dependencies to exist in optionalDependencies and regular dependencies
            if (comptime features.check_for_duplicate_dependencies) {
                lockfile.scratch.duplicate_checker_map.clearRetainingCapacity();
                try lockfile.scratch.duplicate_checker_map.ensureTotalCapacity(total_dependencies_count);
            }

            var bundled_deps = bun.StringSet.init(allocator);
            defer bundled_deps.deinit();
            var bundle_all_deps = false;
            if (comptime ResolverContext != void and ResolverContext.checkBundledDependencies()) {
                if (json.get("bundleDependencies") orelse json.get("bundledDependencies")) |bundled_deps_expr| {
                    switch (bundled_deps_expr.data) {
                        .e_boolean => |boolean| {
                            bundle_all_deps = boolean.value;
                        },
                        .e_array => |arr| {
                            for (arr.slice()) |item| {
                                try bundled_deps.insert(item.asString(allocator) orelse continue);
                            }
                        },
                        else => {},
                    }
                }
            }

            total_dependencies_count = 0;

            inline for (dependency_groups) |group| {
                if (group.behavior.isWorkspace()) {
                    var seen_workspace_names = TrustedDependenciesSet{};
                    defer seen_workspace_names.deinit(allocator);
                    for (workspace_names.values(), workspace_names.keys()) |entry, path| {

                        // workspace names from their package jsons. duplicates not allowed
                        const gop = try seen_workspace_names.getOrPut(allocator, @truncate(String.Builder.stringHash(entry.name)));
                        if (gop.found_existing) {
                            // this path does alot of extra work to format the error message
                            // but this is ok because the install is going to fail anyways, so this
                            // has zero effect on the happy path.
                            var cwd_buf: bun.PathBuffer = undefined;
                            const cwd = try bun.getcwd(&cwd_buf);

                            const num_notes = count: {
                                var i: usize = 0;
                                for (workspace_names.values()) |value| {
                                    if (strings.eqlLong(value.name, entry.name, true))
                                        i += 1;
                                }
                                break :count i;
                            };
                            const notes = notes: {
                                var notes = try allocator.alloc(logger.Data, num_notes);
                                var i: usize = 0;
                                for (workspace_names.values(), workspace_names.keys()) |value, note_path| {
                                    if (note_path.ptr == path.ptr) continue;
                                    if (strings.eqlLong(value.name, entry.name, true)) {
                                        const note_abs_path = bun.handleOom(allocator.dupeZ(u8, Path.joinAbsStringZ(cwd, &.{ note_path, "package.json" }, .auto)));

                                        const note_src = bun.sys.File.toSource(note_abs_path, allocator, .{}).unwrap() catch logger.Source.initEmptyFile(note_abs_path);

                                        notes[i] = .{
                                            .text = "Package name is also declared here",
                                            .location = logger.Location.initOrNull(&note_src, note_src.rangeOfString(value.name_loc)),
                                        };
                                        i += 1;
                                    }
                                }
                                break :notes notes[0..i];
                            };

                            const abs_path = Path.joinAbsStringZ(cwd, &.{ path, "package.json" }, .auto);

                            const src = bun.sys.File.toSource(abs_path, allocator, .{}).unwrap() catch logger.Source.initEmptyFile(abs_path);

                            log.addRangeErrorFmtWithNotes(
                                &src,
                                src.rangeOfString(entry.name_loc),
                                allocator,
                                notes,
                                "Workspace name \"{s}\" already exists",
                                .{
                                    entry.name,
                                },
                            ) catch {};
                            return error.InstallFailed;
                        }

                        const external_name = string_builder.append(ExternalString, entry.name);

                        const workspace_version = brk: {
                            if (entry.version) |version_string| {
                                const external_version = string_builder.append(ExternalString, version_string);
                                allocator.free(version_string);
                                const sliced = external_version.value.sliced(lockfile.buffers.string_bytes.items);
                                const result = Semver.Version.parse(sliced);
                                if (result.valid and result.wildcard == .none) {
                                    break :brk result.version.min();
                                }
                            }

                            break :brk null;
                        };

                        if (try parseDependency(
                            lockfile,
                            pm,
                            allocator,
                            log,
                            source,
                            group,
                            &string_builder,
                            features,
                            package_dependencies,
                            total_dependencies_count,
                            .workspace,
                            workspace_version,
                            external_name,
                            path,
                            logger.Loc.Empty,
                            logger.Loc.Empty,
                        )) |_dep| {
                            var dep = _dep;
                            if (group.behavior.isPeer() and optional_peer_dependencies.contains(external_name.hash)) {
                                dep.behavior = dep.behavior.add(.optional);
                            }

                            package_dependencies[total_dependencies_count] = dep;
                            total_dependencies_count += 1;

                            try lockfile.workspace_paths.put(allocator, external_name.hash, dep.version.value.workspace);
                            if (workspace_version) |version| {
                                try lockfile.workspace_versions.put(allocator, external_name.hash, version);
                            }
                        }
                    }
                } else {
                    if (json.asProperty(group.prop)) |dependencies_q| {
                        switch (dependencies_q.expr.data) {
                            .e_object => |obj| {
                                for (obj.properties.slice()) |item| {
                                    const key = item.key.?;
                                    const value = item.value.?;
                                    const external_name = string_builder.append(ExternalString, key.asString(allocator).?);
                                    const version = value.asString(allocator) orelse "";

                                    if (try parseDependency(
                                        lockfile,
                                        pm,
                                        allocator,
                                        log,
                                        source,
                                        group,
                                        &string_builder,
                                        features,
                                        package_dependencies,
                                        total_dependencies_count,
                                        null,
                                        null,
                                        external_name,
                                        version,
                                        key.loc,
                                        value.loc,
                                    )) |_dep| {
                                        var dep = _dep;
                                        if (group.behavior.isPeer() and optional_peer_dependencies.contains(external_name.hash)) {
                                            dep.behavior.optional = true;
                                        }

                                        if (bundle_all_deps or bundled_deps.contains(dep.name.slice(lockfile.buffers.string_bytes.items))) {
                                            dep.behavior.bundled = true;
                                        }

                                        package_dependencies[total_dependencies_count] = dep;
                                        total_dependencies_count += 1;
                                    }
                                }
                            },
                            else => unreachable,
                        }
                    }
                }
            }

            std.sort.pdq(
                Dependency,
                package_dependencies[0..total_dependencies_count],
                lockfile.buffers.string_bytes.items,
                Dependency.isLessThan,
            );

            package.dependencies.off = @as(u32, @truncate(off));
            package.dependencies.len = @as(u32, @truncate(total_dependencies_count));

            package.resolutions = @as(@TypeOf(package.resolutions), @bitCast(package.dependencies));

            @memset(lockfile.buffers.resolutions.items.ptr[off..total_len], invalid_package_id);

            const new_len = off + total_dependencies_count;
            lockfile.buffers.dependencies.items = lockfile.buffers.dependencies.items.ptr[0..new_len];
            lockfile.buffers.resolutions.items = lockfile.buffers.resolutions.items.ptr[0..new_len];

            // This function depends on package.dependencies being set, so it is done at the very end.
            if (comptime features.is_main) {
                try lockfile.overrides.parseAppend(pm, lockfile, package, log, source, json, &string_builder);

                var found_any_catalog_or_catalog_object = false;
                var has_workspaces = false;
                if (json.get("workspaces")) |workspaces_expr| {
                    found_any_catalog_or_catalog_object = try lockfile.catalogs.parseAppend(pm, lockfile, log, source, workspaces_expr, &string_builder);
                    has_workspaces = true;
                }

                // `"workspaces"` being an object instead of an array is sometimes
                // unexpected to people. therefore if you also are using workspaces,
                // allow "catalog" and "catalogs" in top-level "package.json"
                // so it's easier to guess.
                if (!found_any_catalog_or_catalog_object and has_workspaces) {
                    _ = try lockfile.catalogs.parseAppend(pm, lockfile, log, source, json, &string_builder);
                }
            }

            string_builder.clamp();
        }

        pub const List = bun.MultiArrayList(PackageType);

        pub const Serializer = struct {
            pub const sizes = blk: {
                const fields = std.meta.fields(PackageType);
                const Data = struct {
                    size: usize,
                    size_index: usize,
                    alignment: usize,
                    Type: type,
                };
                var data: [fields.len]Data = undefined;
                for (fields, &data, 0..) |field_info, *elem, i| {
                    elem.* = .{
                        .size = @sizeOf(field_info.type),
                        .size_index = i,
                        .Type = field_info.type,
                        .alignment = if (@sizeOf(field_info.type) == 0) 1 else field_info.alignment,
                    };
                }
                const SortContext = struct {
                    data: []Data,
                    pub fn swap(comptime ctx: @This(), comptime lhs: usize, comptime rhs: usize) void {
                        const tmp = ctx.data[lhs];
                        ctx.data[lhs] = ctx.data[rhs];
                        ctx.data[rhs] = tmp;
                    }
                    pub fn lessThan(comptime ctx: @This(), comptime lhs: usize, comptime rhs: usize) bool {
                        return ctx.data[lhs].alignment > ctx.data[rhs].alignment;
                    }
                };
                std.sort.insertionContext(0, fields.len, SortContext{
                    .data = &data,
                });
                var sizes_bytes: [fields.len]usize = undefined;
                var field_indexes: [fields.len]usize = undefined;
                var Types: [fields.len]type = undefined;
                for (data, &sizes_bytes, &field_indexes, &Types) |elem, *size, *index, *Type| {
                    size.* = elem.size;
                    index.* = elem.size_index;
                    Type.* = elem.Type;
                }
                break :blk .{
                    .bytes = sizes_bytes,
                    .fields = field_indexes,
                    .Types = Types,
                };
            };

            const FieldsEnum = @typeInfo(List.Field).@"enum";

            pub fn byteSize(list: List) usize {
                const sizes_vector: std.meta.Vector(sizes.bytes.len, usize) = sizes.bytes;
                const capacity_vector: @Vector(sizes.bytes.len, usize) = @splat(list.len);
                return @reduce(.Add, capacity_vector * sizes_vector);
            }

            const AlignmentType = sizes.Types[sizes.fields[0]];

            pub fn save(list: List, comptime StreamType: type, stream: StreamType, comptime Writer: type, writer: Writer) !void {
                try writer.writeInt(u64, list.len, .little);
                try writer.writeInt(u64, @alignOf(@TypeOf(list.bytes)), .little);
                try writer.writeInt(u64, sizes.Types.len, .little);
                const begin_at = try stream.getPos();
                try writer.writeInt(u64, 0, .little);
                const end_at = try stream.getPos();
                try writer.writeInt(u64, 0, .little);

                _ = try Aligner.write(@TypeOf(list.bytes), Writer, writer, try stream.getPos());

                const really_begin_at = try stream.getPos();
                var sliced = list.slice();

                inline for (FieldsEnum.fields) |field| {
                    const value = sliced.items(@field(List.Field, field.name));
                    if (comptime Environment.allow_assert) {
                        debug("save(\"{s}\") = {d} bytes", .{ field.name, std.mem.sliceAsBytes(value).len });
                        if (comptime strings.eqlComptime(field.name, "meta")) {
                            for (value) |meta| {
                                assert(meta.has_install_script != .old);
                            }
                        }
                    }
                    comptime assertNoUninitializedPadding(@TypeOf(value));
                    if (comptime strings.eqlComptime(field.name, "resolution")) {
                        // copy each resolution to make sure the union is zero initialized
                        for (value) |val| {
                            const copy = val.copy();
                            try writer.writeAll(std.mem.asBytes(&copy));
                        }
                    } else {
                        try writer.writeAll(std.mem.sliceAsBytes(value));
                    }
                }

                const really_end_at = try stream.getPos();

                _ = stream.pwrite(std.mem.asBytes(&really_begin_at), begin_at);
                _ = stream.pwrite(std.mem.asBytes(&really_end_at), end_at);
            }

            const PackagesLoadResult = struct {
                list: List,
                needs_update: bool = false,
            };

            pub fn load(
                stream: *Stream,
                end: usize,
                allocator: Allocator,
                migrate_from_v2: bool,
            ) !PackagesLoadResult {
                var reader = stream.reader();

                const list_len = try reader.readInt(u64, .little);
                if (list_len > std.math.maxInt(u32) - 1)
                    return error.@"Lockfile validation failed: list is impossibly long";

                const input_alignment = try reader.readInt(u64, .little);

                var list = List{};

                const Alingee = @TypeOf(list.bytes);
                const expected_alignment = @alignOf(Alingee);
                if (expected_alignment != input_alignment) {
                    return error.@"Lockfile validation failed: alignment mismatch";
                }

                const field_count = try reader.readInt(u64, .little);
                switch (field_count) {
                    sizes.Types.len => {},
                    // "scripts" field is absent before v0.6.8
                    // we will back-fill from each package.json
                    sizes.Types.len - 1 => {},
                    else => {
                        return error.@"Lockfile validation failed: unexpected number of package fields";
                    },
                }

                const begin_at = try reader.readInt(u64, .little);
                const end_at = try reader.readInt(u64, .little);
                if (begin_at > end or end_at > end or begin_at > end_at) {
                    return error.@"Lockfile validation failed: invalid package list range";
                }
                stream.pos = begin_at;
                try list.ensureTotalCapacity(allocator, list_len);

                var needs_update = false;
                if (migrate_from_v2) {
                    const OldPackageV2 = Package(u32);
                    var list_for_migrating_from_v2 = OldPackageV2.List{};
                    defer list_for_migrating_from_v2.deinit(allocator);

                    try list_for_migrating_from_v2.ensureTotalCapacity(allocator, list_len);
                    list_for_migrating_from_v2.len = list_len;

                    try loadFields(stream, end_at, OldPackageV2.List, &list_for_migrating_from_v2, &needs_update);

                    for (0..list_for_migrating_from_v2.len) |_pkg_id| {
                        const pkg_id: PackageID = @intCast(_pkg_id);
                        const old = list_for_migrating_from_v2.get(pkg_id);
                        const new: PackageType = .{
                            .name = old.name,
                            .name_hash = old.name_hash,
                            .meta = old.meta,
                            .bin = old.bin,
                            .dependencies = old.dependencies,
                            .resolutions = old.resolutions,
                            .scripts = old.scripts,
                            .resolution = switch (old.resolution.tag) {
                                .uninitialized => .init(.{ .uninitialized = old.resolution.value.uninitialized }),
                                .root => .init(.{ .root = old.resolution.value.root }),
                                .npm => .init(.{ .npm = old.resolution.value.npm.migrate() }),
                                .folder => .init(.{ .folder = old.resolution.value.folder }),
                                .local_tarball => .init(.{ .local_tarball = old.resolution.value.local_tarball }),
                                .github => .init(.{ .github = old.resolution.value.github }),
                                .git => .init(.{ .git = old.resolution.value.git }),
                                .symlink => .init(.{ .symlink = old.resolution.value.symlink }),
                                .workspace => .init(.{ .workspace = old.resolution.value.workspace }),
                                .remote_tarball => .init(.{ .remote_tarball = old.resolution.value.remote_tarball }),
                                .single_file_module => .init(.{ .single_file_module = old.resolution.value.single_file_module }),
                                else => .init(.{ .uninitialized = {} }),
                            },
                        };

                        list.appendAssumeCapacity(new);
                    }
                } else {
                    list.len = list_len;
                    try loadFields(stream, end_at, List, &list, &needs_update);
                }

                return .{
                    .list = list,
                    .needs_update = needs_update,
                };
            }

            fn loadFields(stream: *Stream, end_at: u64, comptime ListType: type, list: *ListType, needs_update: *bool) !void {
                var sliced = list.slice();

                inline for (FieldsEnum.fields) |field| {
                    const value = sliced.items(@field(List.Field, field.name));

                    comptime assertNoUninitializedPadding(@TypeOf(value));
                    const bytes = std.mem.sliceAsBytes(value);
                    const end_pos = stream.pos + bytes.len;
                    if (end_pos <= end_at) {
                        @memcpy(bytes, stream.buffer[stream.pos..][0..bytes.len]);
                        stream.pos = end_pos;
                        if (comptime strings.eqlComptime(field.name, "meta")) {
                            // need to check if any values were created from an older version of bun
                            // (currently just `has_install_script`). If any are found, the values need
                            // to be updated before saving the lockfile.
                            for (value) |*meta| {
                                if (meta.needsUpdate()) {
                                    needs_update.* = true;
                                    break;
                                }
                            }
                        }
                    } else if (comptime strings.eqlComptime(field.name, "scripts")) {
                        @memset(bytes, 0);
                    } else {
                        return error.@"Lockfile validation failed: invalid package list range";
                    }
                }
            }
        };
    };
}

const string = []const u8;

const std = @import("std");
const ResolutionType = @import("../resolution.zig").ResolutionType;
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const ArrayIdentityContext = bun.ArrayIdentityContext;
const Environment = bun.Environment;
const Global = bun.Global;
const JSON = bun.json;
const Output = bun.Output;
const PackageJSON = bun.PackageJSON;
const Path = bun.path;
const assert = bun.assert;
const logger = bun.logger;
const strings = bun.strings;
const Expr = bun.ast.Expr;
const FileSystem = bun.fs.FileSystem;

const Semver = bun.Semver;
const ExternalString = Semver.ExternalString;
const String = Semver.String;

const install = bun.install;
const Aligner = install.Aligner;
const Bin = install.Bin;
const ExternalStringList = install.ExternalStringList;
const ExternalStringMap = install.ExternalStringMap;
const Features = install.Features;
const Npm = install.Npm;
const PackageID = bun.install.PackageID;
const PackageManager = install.PackageManager;
const PackageNameHash = install.PackageNameHash;
const Repository = install.Repository;
const TruncatedPackageNameHash = install.TruncatedPackageNameHash;
const initializeStore = install.initializeStore;
const invalid_package_id = install.invalid_package_id;

const Dependency = bun.install.Dependency;
const Behavior = Dependency.Behavior;

const Lockfile = install.Lockfile;
const Cloner = Lockfile.Cloner;
const DependencySlice = Lockfile.DependencySlice;
const PackageIDSlice = Lockfile.PackageIDSlice;
const Stream = Lockfile.Stream;
const StringBuilder = Lockfile.StringBuilder;
const TrustedDependenciesSet = Lockfile.TrustedDependenciesSet;
const assertNoUninitializedPadding = Lockfile.assertNoUninitializedPadding;
const default_trusted_dependencies = Lockfile.default_trusted_dependencies;
