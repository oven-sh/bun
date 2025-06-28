/// The version of the lockfile format, intended to prevent data corruption for format changes.
format: FormatVersion = FormatVersion.current,

text_lockfile_version: TextLockfile.Version = TextLockfile.Version.current,

meta_hash: MetaHash = zero_hash,

packages: Lockfile.Package.List = .{},
buffers: Buffers = .{},

/// name -> PackageID || [*]PackageID
/// Not for iterating.
package_index: PackageIndex.Map,
string_pool: StringPool,
allocator: Allocator,
scratch: Scratch = .{},

scripts: Scripts = .{},
workspace_paths: NameHashMap = .{},
workspace_versions: VersionHashMap = .{},

/// Optional because `trustedDependencies` in package.json might be an
/// empty list or it might not exist
trusted_dependencies: ?TrustedDependenciesSet = null,
patched_dependencies: PatchedDependenciesMap = .{},
overrides: OverrideMap = .{},
catalogs: CatalogMap = .{},

pub const Stream = std.io.FixedBufferStream([]u8);
pub const default_filename = "bun.lockb";

pub const Scripts = struct {
    const MAX_PARALLEL_PROCESSES = 10;
    pub const Entry = struct {
        script: string,
    };
    pub const Entries = std.ArrayListUnmanaged(Entry);

    pub const names = [_]string{
        "preinstall",
        "install",
        "postinstall",
        "preprepare",
        "prepare",
        "postprepare",
    };

    const RunCommand = @import("../cli/run_command.zig").RunCommand;

    preinstall: Entries = .{},
    install: Entries = .{},
    postinstall: Entries = .{},
    preprepare: Entries = .{},
    prepare: Entries = .{},
    postprepare: Entries = .{},

    pub fn hasAny(this: *Scripts) bool {
        inline for (Scripts.names) |hook| {
            if (@field(this, hook).items.len > 0) return true;
        }
        return false;
    }

    pub fn count(this: *Scripts) usize {
        var res: usize = 0;
        inline for (Scripts.names) |hook| {
            res += @field(this, hook).items.len;
        }
        return res;
    }

    pub fn deinit(this: *Scripts, allocator: Allocator) void {
        inline for (Scripts.names) |hook| {
            const list = &@field(this, hook);
            for (list.items) |entry| {
                allocator.free(entry.script);
            }
            list.deinit(allocator);
        }
    }
};

pub fn isEmpty(this: *const Lockfile) bool {
    return this.packages.len == 0 or (this.packages.len == 1 and this.packages.get(0).resolutions.len == 0);
}

pub const LoadResult = union(enum) {
    not_found: void,
    err: struct {
        step: Step,
        value: anyerror,
        lockfile_path: stringZ,
        format: LockfileFormat,
    },
    ok: struct {
        lockfile: *Lockfile,
        loaded_from_binary_lockfile: bool,
        was_migrated: bool = false,
        serializer_result: Serializer.SerializerLoadResult,
        format: LockfileFormat,
    },

    pub const LockfileFormat = enum {
        text,
        binary,

        pub fn filename(this: LockfileFormat) stringZ {
            return switch (this) {
                .text => "bun.lock",
                .binary => "bun.lockb",
            };
        }
    };

    pub fn loadedFromTextLockfile(this: LoadResult) bool {
        return switch (this) {
            .not_found => false,
            .err => |err| err.format == .text,
            .ok => |ok| ok.format == .text,
        };
    }

    pub fn loadedFromBinaryLockfile(this: LoadResult) bool {
        return switch (this) {
            .not_found => false,
            .err => |err| err.format == .binary,
            .ok => |ok| ok.format == .binary,
        };
    }

    pub fn saveFormat(this: LoadResult, options: *const PackageManager.Options) LockfileFormat {
        switch (this) {
            .not_found => {
                // saving a lockfile for a new project. default to text lockfile
                // unless saveTextLockfile is false in bunfig
                const save_text_lockfile = options.save_text_lockfile orelse true;
                return if (save_text_lockfile) .text else .binary;
            },
            .err => |err| {
                // an error occurred, but we still loaded from an existing lockfile
                if (options.save_text_lockfile) |save_text_lockfile| {
                    if (save_text_lockfile) {
                        return .text;
                    }
                }
                return err.format;
            },
            .ok => |ok| {
                // loaded from an existing lockfile
                if (options.save_text_lockfile) |save_text_lockfile| {
                    if (save_text_lockfile) {
                        return .text;
                    }

                    if (ok.was_migrated) {
                        return .binary;
                    }
                }

                if (ok.was_migrated) {
                    return .text;
                }

                return ok.format;
            },
        }
    }

    pub const Step = enum { open_file, read_file, parse_file, migrating };
};

pub fn loadFromCwd(
    this: *Lockfile,
    manager: ?*PackageManager,
    allocator: Allocator,
    log: *logger.Log,
    comptime attempt_loading_from_other_lockfile: bool,
) LoadResult {
    return loadFromDir(this, bun.FD.cwd(), manager, allocator, log, attempt_loading_from_other_lockfile);
}

pub fn loadFromDir(
    this: *Lockfile,
    dir: bun.FD,
    manager: ?*PackageManager,
    allocator: Allocator,
    log: *logger.Log,
    comptime attempt_loading_from_other_lockfile: bool,
) LoadResult {
    if (comptime Environment.allow_assert) assert(FileSystem.instance_loaded);

    var lockfile_format: LoadResult.LockfileFormat = .text;
    const file = File.openat(dir, "bun.lock", bun.O.RDONLY, 0).unwrap() catch |text_open_err| file: {
        if (text_open_err != error.ENOENT) {
            return .{ .err = .{
                .step = .open_file,
                .value = text_open_err,
                .lockfile_path = "bun.lock",
                .format = .text,
            } };
        }

        lockfile_format = .binary;

        break :file File.openat(dir, "bun.lockb", bun.O.RDONLY, 0).unwrap() catch |binary_open_err| {
            if (binary_open_err != error.ENOENT) {
                return .{ .err = .{
                    .step = .open_file,
                    .value = binary_open_err,
                    .lockfile_path = "bun.lockb",
                    .format = .binary,
                } };
            }

            if (comptime attempt_loading_from_other_lockfile) {
                if (manager) |pm| {
                    const migrate_result = migration.detectAndLoadOtherLockfile(
                        this,
                        dir,
                        pm,
                        allocator,
                        log,
                    );

                    if (migrate_result == .ok) {
                        lockfile_format = .text;
                    }

                    return migrate_result;
                }
            }

            return .not_found;
        };
    };

    const buf = file.readToEnd(allocator).unwrap() catch |err| {
        return .{ .err = .{
            .step = .read_file,
            .value = err,
            .lockfile_path = if (lockfile_format == .text) "bun.lock" else "bun.lockb",
            .format = lockfile_format,
        } };
    };

    if (lockfile_format == .text) {
        const source = &logger.Source.initPathString("bun.lock", buf);
        initializeStore();
        const json = JSON.parsePackageJSONUTF8(source, log, allocator) catch |err| {
            return .{
                .err = .{
                    .step = .parse_file,
                    .value = err,
                    .lockfile_path = "bun.lock",
                    .format = lockfile_format,
                },
            };
        };

        TextLockfile.parseIntoBinaryLockfile(this, allocator, json, source, log, manager) catch |err| {
            switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
                else => {
                    return .{
                        .err = .{
                            .step = .parse_file,
                            .value = err,
                            .lockfile_path = "bun.lock",
                            .format = lockfile_format,
                        },
                    };
                },
            }
        };

        bun.Analytics.Features.text_lockfile += 1;

        return .{
            .ok = .{
                .lockfile = this,
                .serializer_result = .{},
                .loaded_from_binary_lockfile = false,
                .format = lockfile_format,
            },
        };
    }

    const result = this.loadFromBytes(manager, buf, allocator, log);

    switch (result) {
        .ok => {
            if (bun.getenvZ("BUN_DEBUG_TEST_TEXT_LOCKFILE") != null and manager != null) {

                // Convert the loaded binary lockfile into a text lockfile in memory, then
                // parse it back into a binary lockfile.

                var writer_buf = MutableString.initEmpty(allocator);
                var buffered_writer = writer_buf.bufferedWriter();
                const writer = buffered_writer.writer();

                TextLockfile.Stringifier.saveFromBinary(allocator, result.ok.lockfile, &result, writer) catch |err| {
                    Output.panic("failed to convert binary lockfile to text lockfile: {s}", .{@errorName(err)});
                };

                buffered_writer.flush() catch bun.outOfMemory();

                const text_lockfile_bytes = writer_buf.list.items;

                const source = &logger.Source.initPathString("bun.lock", text_lockfile_bytes);
                initializeStore();
                const json = JSON.parsePackageJSONUTF8(source, log, allocator) catch |err| {
                    Output.panic("failed to print valid json from binary lockfile: {s}", .{@errorName(err)});
                };

                TextLockfile.parseIntoBinaryLockfile(this, allocator, json, source, log, manager) catch |err| {
                    Output.panic("failed to parse text lockfile converted from binary lockfile: {s}", .{@errorName(err)});
                };

                bun.Analytics.Features.text_lockfile += 1;
            }
        },
        else => {},
    }

    return result;
}

pub fn loadFromBytes(this: *Lockfile, pm: ?*PackageManager, buf: []u8, allocator: Allocator, log: *logger.Log) LoadResult {
    var stream = Stream{ .buffer = buf, .pos = 0 };

    this.format = FormatVersion.current;
    this.scripts = .{};
    this.trusted_dependencies = null;
    this.workspace_paths = .{};
    this.workspace_versions = .{};
    this.overrides = .{};
    this.catalogs = .{};
    this.patched_dependencies = .{};

    const load_result = Lockfile.Serializer.load(this, &stream, allocator, log, pm) catch |err| {
        return LoadResult{ .err = .{ .step = .parse_file, .value = err, .lockfile_path = "bun.lockb", .format = .binary } };
    };

    if (Environment.allow_assert) {
        this.verifyData() catch @panic("lockfile data is corrupt");
    }

    return LoadResult{
        .ok = .{
            .lockfile = this,
            .serializer_result = load_result,
            .loaded_from_binary_lockfile = true,
            .format = .binary,
        },
    };
}

pub const InstallResult = struct {
    lockfile: *Lockfile,
    summary: PackageInstall.Summary,
};

pub fn isResolvedDependencyDisabled(
    lockfile: *const Lockfile,
    dep_id: DependencyID,
    features: Features,
    meta: *const Package.Meta,
) bool {
    if (meta.isDisabled()) return true;

    const dep = lockfile.buffers.dependencies.items[dep_id];

    return dep.behavior.isBundled() or !dep.behavior.isEnabled(features);
}

/// This conditionally clones the lockfile with root packages marked as non-resolved
/// that do not satisfy `Features`. The package may still end up installed even
/// if it was e.g. in "devDependencies" and its a production install. In that case,
/// it would be installed because another dependency or transient dependency needed it.
///
/// Warning: This potentially modifies the existing lockfile in-place. That is
/// safe to do because at this stage, the lockfile has already been saved to disk.
/// Our in-memory representation is all that's left.
pub fn maybeCloneFilteringRootPackages(
    old: *Lockfile,
    manager: *PackageManager,
    features: Features,
    exact_versions: bool,
    log_level: PackageManager.Options.LogLevel,
) !*Lockfile {
    const old_packages = old.packages.slice();
    const old_dependencies_lists = old_packages.items(.dependencies);
    const old_resolutions_lists = old_packages.items(.resolutions);
    const old_resolutions = old_packages.items(.resolution);
    var any_changes = false;
    const end: PackageID = @truncate(old.packages.len);

    // set all disabled dependencies of workspaces to `invalid_package_id`
    for (0..end) |package_id| {
        if (package_id != 0 and old_resolutions[package_id].tag != .workspace) continue;

        const old_workspace_dependencies_list = old_dependencies_lists[package_id];
        var old_workspace_resolutions_list = old_resolutions_lists[package_id];

        const old_workspace_dependencies = old_workspace_dependencies_list.get(old.buffers.dependencies.items);
        const old_workspace_resolutions = old_workspace_resolutions_list.mut(old.buffers.resolutions.items);

        for (old_workspace_dependencies, old_workspace_resolutions) |dependency, *resolution| {
            if (!dependency.behavior.isEnabled(features) and resolution.* < end) {
                resolution.* = invalid_package_id;
                any_changes = true;
            }
        }
    }

    if (!any_changes) return old;

    return try old.clean(manager, &.{}, exact_versions, log_level);
}

fn preprocessUpdateRequests(old: *Lockfile, manager: *PackageManager, updates: []PackageManager.UpdateRequest, exact_versions: bool) !void {
    const workspace_package_id = manager.root_package_id.get(old, manager.workspace_name_hash);
    const root_deps_list: Lockfile.DependencySlice = old.packages.items(.dependencies)[workspace_package_id];

    if (@as(usize, root_deps_list.off) < old.buffers.dependencies.items.len) {
        var string_builder = old.stringBuilder();

        {
            const root_deps: []const Dependency = root_deps_list.get(old.buffers.dependencies.items);
            const old_resolutions_list = old.packages.items(.resolutions)[workspace_package_id];
            const old_resolutions: []const PackageID = old_resolutions_list.get(old.buffers.resolutions.items);
            const resolutions_of_yore: []const Resolution = old.packages.items(.resolution);

            for (updates) |update| {
                if (update.package_id == invalid_package_id) {
                    for (root_deps, old_resolutions) |dep, old_resolution| {
                        if (dep.name_hash == String.Builder.stringHash(update.name)) {
                            if (old_resolution > old.packages.len) continue;
                            const res = resolutions_of_yore[old_resolution];
                            if (res.tag != .npm or update.version.tag != .dist_tag) continue;

                            // TODO(dylan-conway): this will need to handle updating dependencies (exact, ^, or ~) and aliases

                            const len = switch (exact_versions) {
                                else => |exact| std.fmt.count("{s}{}", .{
                                    if (exact) "" else "^",
                                    res.value.npm.version.fmt(old.buffers.string_bytes.items),
                                }),
                            };

                            if (len >= String.max_inline_len) {
                                string_builder.cap += len;
                            }
                        }
                    }
                }
            }
        }

        try string_builder.allocate();
        defer string_builder.clamp();

        {
            var temp_buf: [513]u8 = undefined;

            const root_deps: []Dependency = root_deps_list.mut(old.buffers.dependencies.items);
            const old_resolutions_list_lists = old.packages.items(.resolutions);
            const old_resolutions_list = old_resolutions_list_lists[workspace_package_id];
            const old_resolutions: []const PackageID = old_resolutions_list.get(old.buffers.resolutions.items);
            const resolutions_of_yore: []const Resolution = old.packages.items(.resolution);

            for (updates) |*update| {
                if (update.package_id == invalid_package_id) {
                    for (root_deps, old_resolutions) |*dep, old_resolution| {
                        if (dep.name_hash == String.Builder.stringHash(update.name)) {
                            if (old_resolution > old.packages.len) continue;
                            const res = resolutions_of_yore[old_resolution];
                            if (res.tag != .npm or update.version.tag != .dist_tag) continue;

                            // TODO(dylan-conway): this will need to handle updating dependencies (exact, ^, or ~) and aliases

                            const buf = switch (exact_versions) {
                                else => |exact| std.fmt.bufPrint(&temp_buf, "{s}{}", .{
                                    if (exact) "" else "^",
                                    res.value.npm.version.fmt(old.buffers.string_bytes.items),
                                }) catch break,
                            };

                            const external_version = string_builder.append(ExternalString, buf);
                            const sliced = external_version.value.sliced(old.buffers.string_bytes.items);
                            dep.version = Dependency.parse(
                                old.allocator,
                                dep.name,
                                dep.name_hash,
                                sliced.slice,
                                &sliced,
                                null,
                                manager,
                            ) orelse Dependency.Version{};
                        }
                    }
                }

                update.e_string = null;
            }
        }
    }
}
pub fn clean(
    old: *Lockfile,
    manager: *PackageManager,
    updates: []PackageManager.UpdateRequest,
    exact_versions: bool,
    log_level: PackageManager.Options.LogLevel,
) !*Lockfile {
    // This is wasteful, but we rarely log anything so it's fine.
    var log = logger.Log.init(bun.default_allocator);
    defer {
        for (log.msgs.items) |*item| {
            item.deinit(bun.default_allocator);
        }
        log.deinit();
    }

    return old.cleanWithLogger(manager, updates, &log, exact_versions, log_level);
}

/// Is this a direct dependency of the workspace root package.json?
pub fn isWorkspaceRootDependency(this: *const Lockfile, id: DependencyID) bool {
    return this.packages.items(.dependencies)[0].contains(id);
}

/// Is this a direct dependency of the workspace the install is taking place in?
pub fn isRootDependency(this: *const Lockfile, manager: *PackageManager, id: DependencyID) bool {
    return this.packages.items(.dependencies)[manager.root_package_id.get(this, manager.workspace_name_hash)].contains(id);
}

/// Is this a direct dependency of any workspace (including workspace root)?
/// TODO make this faster by caching the workspace package ids
pub fn isWorkspaceDependency(this: *const Lockfile, id: DependencyID) bool {
    return getWorkspacePkgIfWorkspaceDep(this, id) != invalid_package_id;
}

pub fn getWorkspacePkgIfWorkspaceDep(this: *const Lockfile, id: DependencyID) PackageID {
    const packages = this.packages.slice();
    const resolutions = packages.items(.resolution);
    const dependencies_lists = packages.items(.dependencies);
    for (resolutions, dependencies_lists, 0..) |resolution, dependencies, pkg_id| {
        if (resolution.tag != .workspace and resolution.tag != .root) continue;
        if (dependencies.contains(id)) return @intCast(pkg_id);
    }

    return invalid_package_id;
}

/// Does this tree id belong to a workspace (including workspace root)?
/// TODO(dylan-conway) fix!
pub fn isWorkspaceTreeId(this: *const Lockfile, id: Tree.Id) bool {
    return id == 0 or this.buffers.dependencies.items[this.buffers.trees.items[id].dependency_id].behavior.isWorkspaceOnly();
}

/// Returns the package id of the workspace the install is taking place in.
pub fn getWorkspacePackageID(this: *const Lockfile, workspace_name_hash: ?PackageNameHash) PackageID {
    return if (workspace_name_hash) |workspace_name_hash_| brk: {
        const packages = this.packages.slice();
        const name_hashes = packages.items(.name_hash);
        const resolutions = packages.items(.resolution);
        for (resolutions, name_hashes, 0..) |res, name_hash, i| {
            if (res.tag == .workspace and name_hash == workspace_name_hash_) {
                break :brk @intCast(i);
            }
        }

        // should not hit this, default to root just in case
        break :brk 0;
    } else 0;
}

pub fn cleanWithLogger(
    old: *Lockfile,
    manager: *PackageManager,
    updates: []PackageManager.UpdateRequest,
    log: *logger.Log,
    exact_versions: bool,
    log_level: PackageManager.Options.LogLevel,
) !*Lockfile {
    var timer: std.time.Timer = undefined;
    if (log_level.isVerbose()) {
        timer = try std.time.Timer.start();
    }

    const old_trusted_dependencies = old.trusted_dependencies;
    const old_scripts = old.scripts;
    // We will only shrink the number of packages here.
    // never grow

    // preinstall_state is used during installPackages. the indexes(package ids) need
    // to be remapped. Also ensure `preinstall_state` has enough capacity to contain
    // all packages. It's possible it doesn't because non-npm packages do not use
    // preinstall state before linking stage.
    manager.ensurePreinstallStateListCapacity(old.packages.len);
    var preinstall_state = manager.preinstall_state;
    var old_preinstall_state = preinstall_state.clone(old.allocator) catch bun.outOfMemory();
    defer old_preinstall_state.deinit(old.allocator);
    @memset(preinstall_state.items, .unknown);

    if (updates.len > 0) {
        try old.preprocessUpdateRequests(manager, updates, exact_versions);
    }

    var new: *Lockfile = try old.allocator.create(Lockfile);
    new.initEmpty(
        old.allocator,
    );
    try new.string_pool.ensureTotalCapacity(old.string_pool.capacity());
    try new.package_index.ensureTotalCapacity(old.package_index.capacity());
    try new.packages.ensureTotalCapacity(old.allocator, old.packages.len);
    try new.buffers.preallocate(old.buffers, old.allocator);
    try new.patched_dependencies.ensureTotalCapacity(old.allocator, old.patched_dependencies.entries.len);

    old.scratch.dependency_list_queue.head = 0;

    {
        var builder = new.stringBuilder();
        old.overrides.count(old, &builder);
        old.catalogs.count(old, &builder);
        try builder.allocate();
        new.overrides = try old.overrides.clone(manager, old, new, &builder);
        new.catalogs = try old.catalogs.clone(manager, old, new, &builder);
    }

    // Step 1. Recreate the lockfile with only the packages that are still alive
    const root = old.rootPackage() orelse return error.NoPackage;

    const package_id_mapping = try old.allocator.alloc(PackageID, old.packages.len);
    @memset(
        package_id_mapping,
        invalid_package_id,
    );
    const clone_queue_ = PendingResolutions.init(old.allocator);
    var cloner = Cloner{
        .old = old,
        .lockfile = new,
        .mapping = package_id_mapping,
        .clone_queue = clone_queue_,
        .log = log,
        .old_preinstall_state = old_preinstall_state,
        .manager = manager,
    };

    // try clone_queue.ensureUnusedCapacity(root.dependencies.len);
    _ = try root.clone(manager, old, new, package_id_mapping, &cloner);

    // Clone workspace_paths and workspace_versions at the end.
    if (old.workspace_paths.count() > 0 or old.workspace_versions.count() > 0) {
        try new.workspace_paths.ensureTotalCapacity(z_allocator, old.workspace_paths.count());
        try new.workspace_versions.ensureTotalCapacity(z_allocator, old.workspace_versions.count());

        var workspace_paths_builder = new.stringBuilder();

        const WorkspacePathSorter = struct {
            string_buf: []const u8,
            entries: NameHashMap.DataList,

            pub fn lessThan(sorter: @This(), a: usize, b: usize) bool {
                const left = sorter.entries.items(.value)[a];
                const right = sorter.entries.items(.value)[b];
                return strings.order(left.slice(sorter.string_buf), right.slice(sorter.string_buf)) == .lt;
            }
        };

        // Sort by name for determinism
        old.workspace_paths.sort(WorkspacePathSorter{
            .entries = old.workspace_paths.entries,
            .string_buf = old.buffers.string_bytes.items,
        });

        for (old.workspace_paths.values()) |*path| {
            workspace_paths_builder.count(old.str(path));
        }
        const versions: []const Semver.Version = old.workspace_versions.values();
        for (versions) |version| {
            version.count(old.buffers.string_bytes.items, @TypeOf(&workspace_paths_builder), &workspace_paths_builder);
        }

        try workspace_paths_builder.allocate();

        new.workspace_paths.entries.len = old.workspace_paths.entries.len;

        for (old.workspace_paths.values(), new.workspace_paths.values()) |*src, *dest| {
            dest.* = workspace_paths_builder.append(String, old.str(src));
        }
        @memcpy(
            new.workspace_paths.keys(),
            old.workspace_paths.keys(),
        );

        try new.workspace_versions.ensureTotalCapacity(z_allocator, old.workspace_versions.count());
        new.workspace_versions.entries.len = old.workspace_versions.entries.len;
        for (versions, new.workspace_versions.values()) |src, *dest| {
            dest.* = src.append(old.buffers.string_bytes.items, @TypeOf(&workspace_paths_builder), &workspace_paths_builder);
        }

        @memcpy(
            new.workspace_versions.keys(),
            old.workspace_versions.keys(),
        );

        workspace_paths_builder.clamp();

        try new.workspace_versions.reIndex(z_allocator);
        try new.workspace_paths.reIndex(z_allocator);
    }

    // When you run `"bun add react"
    // This is where we update it in the lockfile from "latest" to "^17.0.2"
    try cloner.flush();

    new.trusted_dependencies = old_trusted_dependencies;
    new.scripts = old_scripts;
    new.meta_hash = old.meta_hash;

    {
        var builder = new.stringBuilder();
        for (old.patched_dependencies.values()) |patched_dep| builder.count(patched_dep.path.slice(old.buffers.string_bytes.items));
        try builder.allocate();
        for (old.patched_dependencies.keys(), old.patched_dependencies.values()) |k, v| {
            bun.assert(!v.patchfile_hash_is_null);
            var patchdep = v;
            patchdep.path = builder.append(String, patchdep.path.slice(old.buffers.string_bytes.items));
            try new.patched_dependencies.put(new.allocator, k, patchdep);
        }
    }

    // Don't allow invalid memory to happen
    if (updates.len > 0) {
        const string_buf = new.buffers.string_bytes.items;
        const slice = new.packages.slice();

        // updates might be applied to the root package.json or one
        // of the workspace package.json files.
        const workspace_package_id = manager.root_package_id.get(new, manager.workspace_name_hash);

        const dep_list = slice.items(.dependencies)[workspace_package_id];
        const res_list = slice.items(.resolutions)[workspace_package_id];
        const workspace_deps: []const Dependency = dep_list.get(new.buffers.dependencies.items);
        const resolved_ids: []const PackageID = res_list.get(new.buffers.resolutions.items);

        request_updated: for (updates) |*update| {
            if (update.package_id == invalid_package_id) {
                for (resolved_ids, workspace_deps) |package_id, dep| {
                    if (update.matches(dep, string_buf)) {
                        if (package_id > new.packages.len) continue;
                        update.version_buf = string_buf;
                        update.version = dep.version;
                        update.package_id = package_id;

                        continue :request_updated;
                    }
                }
            }
        }
    }

    if (log_level.isVerbose()) {
        Output.prettyErrorln("Clean lockfile: {d} packages -> {d} packages in {}\n", .{
            old.packages.len,
            new.packages.len,
            bun.fmt.fmtDurationOneDecimal(timer.read()),
        });
    }

    return new;
}

pub const MetaHashFormatter = struct {
    meta_hash: *const MetaHash,

    pub fn format(this: MetaHashFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        var remain: []const u8 = this.meta_hash[0..];

        try std.fmt.format(
            writer,
            "{}-{}-{}-{}",
            .{
                std.fmt.fmtSliceHexUpper(remain[0..8]),
                std.fmt.fmtSliceHexLower(remain[8..16]),
                std.fmt.fmtSliceHexUpper(remain[16..24]),
                std.fmt.fmtSliceHexLower(remain[24..32]),
            },
        );
    }
};

pub fn fmtMetaHash(this: *const Lockfile) MetaHashFormatter {
    return .{
        .meta_hash = &this.meta_hash,
    };
}

pub const Cloner = struct {
    clone_queue: PendingResolutions,
    lockfile: *Lockfile,
    old: *Lockfile,
    mapping: []PackageID,
    trees: Tree.List = Tree.List{},
    trees_count: u32 = 1,
    log: *logger.Log,
    old_preinstall_state: std.ArrayListUnmanaged(Install.PreinstallState),
    manager: *PackageManager,

    pub fn flush(this: *Cloner) anyerror!void {
        const max_package_id = this.old.packages.len;
        while (this.clone_queue.pop()) |to_clone| {
            const mapping = this.mapping[to_clone.old_resolution];
            if (mapping < max_package_id) {
                this.lockfile.buffers.resolutions.items[to_clone.resolve_id] = mapping;
                continue;
            }

            const old_package = this.old.packages.get(to_clone.old_resolution);

            this.lockfile.buffers.resolutions.items[to_clone.resolve_id] = try old_package.clone(
                this.manager,
                this.old,
                this.lockfile,
                this.mapping,
                this,
            );
        }

        // cloning finished, items in lockfile buffer might have a different order, meaning
        // package ids and dependency ids have changed
        this.manager.clearCachedItemsDependingOnLockfileBuffer();

        if (this.lockfile.packages.len != 0) {
            try this.lockfile.resolve(this.log);
        }

        // capacity is used for calculating byte size
        // so we need to make sure it's exact
        if (this.lockfile.packages.capacity != this.lockfile.packages.len and this.lockfile.packages.len > 0)
            this.lockfile.packages.shrinkAndFree(this.lockfile.allocator, this.lockfile.packages.len);
    }
};

pub fn resolve(
    lockfile: *Lockfile,
    log: *logger.Log,
) Tree.SubtreeError!void {
    return lockfile.hoist(log, .resolvable, {}, {}, {});
}

pub fn filter(
    lockfile: *Lockfile,
    log: *logger.Log,
    manager: *PackageManager,
    install_root_dependencies: bool,
    workspace_filters: []const WorkspaceFilter,
) Tree.SubtreeError!void {
    return lockfile.hoist(log, .filter, manager, install_root_dependencies, workspace_filters);
}

/// Sets `buffers.trees` and `buffers.hoisted_dependencies`
pub fn hoist(
    lockfile: *Lockfile,
    log: *logger.Log,
    comptime method: Tree.BuilderMethod,
    manager: if (method == .filter) *PackageManager else void,
    install_root_dependencies: if (method == .filter) bool else void,
    workspace_filters: if (method == .filter) []const WorkspaceFilter else void,
) Tree.SubtreeError!void {
    const allocator = lockfile.allocator;
    var slice = lockfile.packages.slice();

    var path_buf: bun.PathBuffer = undefined;

    var builder = Tree.Builder(method){
        .name_hashes = slice.items(.name_hash),
        .queue = .init(allocator),
        .resolution_lists = slice.items(.resolutions),
        .resolutions = lockfile.buffers.resolutions.items,
        .allocator = allocator,
        .dependencies = lockfile.buffers.dependencies.items,
        .log = log,
        .lockfile = lockfile,
        .manager = manager,
        .path_buf = &path_buf,
        .install_root_dependencies = install_root_dependencies,
        .workspace_filters = workspace_filters,
    };

    try (Tree{}).processSubtree(
        Tree.root_dep_id,
        Tree.invalid_id,
        method,
        &builder,
        if (method == .filter) manager.options.log_level,
    );

    // This goes breadth-first
    while (builder.queue.readItem()) |item| {
        try builder.list.items(.tree)[item.tree_id].processSubtree(
            item.dependency_id,
            item.hoist_root_id,
            method,
            &builder,
            if (method == .filter) manager.options.log_level,
        );
    }

    const cleaned = try builder.clean();
    lockfile.buffers.trees = cleaned.trees;
    lockfile.buffers.hoisted_dependencies = cleaned.dep_ids;
}

const PendingResolution = struct {
    old_resolution: PackageID,
    resolve_id: PackageID,
    parent: PackageID,
};

const PendingResolutions = std.ArrayList(PendingResolution);

pub const Printer = struct {
    lockfile: *Lockfile,
    options: PackageManager.Options,
    successfully_installed: ?Bitset = null,

    updates: []const PackageManager.UpdateRequest = &[_]PackageManager.UpdateRequest{},

    pub const Format = enum { yarn };

    pub fn print(
        allocator: Allocator,
        log: *logger.Log,
        input_lockfile_path: string,
        format: Format,
    ) !void {
        @branchHint(.cold);

        // We truncate longer than allowed paths. We should probably throw an error instead.
        const path = input_lockfile_path[0..@min(input_lockfile_path.len, bun.MAX_PATH_BYTES)];

        var lockfile_path_buf1: bun.PathBuffer = undefined;
        var lockfile_path_buf2: bun.PathBuffer = undefined;

        var lockfile_path: stringZ = "";

        if (!std.fs.path.isAbsolute(path)) {
            const cwd = try bun.getcwd(&lockfile_path_buf1);
            var parts = [_]string{path};
            const lockfile_path__ = Path.joinAbsStringBuf(cwd, &lockfile_path_buf2, &parts, .auto);
            lockfile_path_buf2[lockfile_path__.len] = 0;
            lockfile_path = lockfile_path_buf2[0..lockfile_path__.len :0];
        } else if (path.len > 0) {
            @memcpy(lockfile_path_buf1[0..path.len], path);
            lockfile_path_buf1[path.len] = 0;
            lockfile_path = lockfile_path_buf1[0..path.len :0];
        }

        if (lockfile_path.len > 0 and lockfile_path[0] == std.fs.path.sep)
            _ = bun.sys.chdir("", std.fs.path.dirname(lockfile_path) orelse std.fs.path.sep_str);

        _ = try FileSystem.init(null);

        var lockfile = try allocator.create(Lockfile);

        const load_from_disk = lockfile.loadFromCwd(null, allocator, log, false);
        switch (load_from_disk) {
            .err => |cause| {
                switch (cause.step) {
                    .open_file => Output.prettyErrorln("<r><red>error<r> opening lockfile:<r> {s}.", .{
                        @errorName(cause.value),
                    }),
                    .parse_file => Output.prettyErrorln("<r><red>error<r> parsing lockfile:<r> {s}", .{
                        @errorName(cause.value),
                    }),
                    .read_file => Output.prettyErrorln("<r><red>error<r> reading lockfile:<r> {s}", .{
                        @errorName(cause.value),
                    }),
                    .migrating => Output.prettyErrorln("<r><red>error<r> while migrating lockfile:<r> {s}", .{
                        @errorName(cause.value),
                    }),
                }
                if (log.errors > 0) {
                    try log.print(Output.errorWriter());
                }
                Global.crash();
            },
            .not_found => {
                Output.prettyErrorln("<r><red>lockfile not found:<r> {}", .{
                    bun.fmt.QuotedFormatter{ .text = std.mem.sliceAsBytes(lockfile_path) },
                });
                Global.crash();
            },

            .ok => {},
        }

        const writer = Output.writer();
        try printWithLockfile(allocator, lockfile, format, @TypeOf(writer), writer);
        Output.flush();
    }

    pub fn printWithLockfile(
        allocator: Allocator,
        lockfile: *Lockfile,
        format: Format,
        comptime Writer: type,
        writer: Writer,
    ) !void {
        var fs = &FileSystem.instance;
        var options = PackageManager.Options{
            .max_concurrent_lifecycle_scripts = 1,
        };

        const entries_option = try fs.fs.readDirectory(fs.top_level_dir, null, 0, true);

        var env_loader: *DotEnv.Loader = brk: {
            const map = try allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(allocator);

            const loader = try allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, allocator);
            loader.quiet = true;
            break :brk loader;
        };

        env_loader.loadProcess();
        try env_loader.load(entries_option.entries, &[_][]u8{}, .production, false);
        var log = logger.Log.init(allocator);
        try options.load(
            allocator,
            &log,
            env_loader,
            null,
            null,
            .install,
        );

        var printer = Printer{
            .lockfile = lockfile,
            .options = options,
        };

        switch (format) {
            .yarn => {
                try Yarn.print(&printer, Writer, writer);
            },
        }
    }

    pub const Tree = @import("lockfile/printer/tree_printer.zig");
    pub const Yarn = @import("lockfile/printer/Yarn.zig");
};

pub fn verifyData(this: *const Lockfile) !void {
    assert(this.format == Lockfile.FormatVersion.current);
    var i: usize = 0;
    while (i < this.packages.len) : (i += 1) {
        const package: Lockfile.Package = this.packages.get(i);
        assert(this.str(&package.name).len == @as(usize, package.name.len()));
        assert(String.Builder.stringHash(this.str(&package.name)) == @as(usize, package.name_hash));
        assert(package.dependencies.get(this.buffers.dependencies.items).len == @as(usize, package.dependencies.len));
        assert(package.resolutions.get(this.buffers.resolutions.items).len == @as(usize, package.resolutions.len));
        assert(package.resolutions.get(this.buffers.resolutions.items).len == @as(usize, package.dependencies.len));
        const dependencies = package.dependencies.get(this.buffers.dependencies.items);
        for (dependencies) |dependency| {
            assert(this.str(&dependency.name).len == @as(usize, dependency.name.len()));
            assert(String.Builder.stringHash(this.str(&dependency.name)) == dependency.name_hash);
        }
    }
}

pub fn saveToDisk(this: *Lockfile, load_result: *const LoadResult, options: *const PackageManager.Options) void {
    const save_format = load_result.saveFormat(options);
    if (comptime Environment.allow_assert) {
        this.verifyData() catch |err| {
            Output.prettyErrorln("<r><red>error:<r> failed to verify lockfile: {s}", .{@errorName(err)});
            Global.crash();
        };
        assert(FileSystem.instance_loaded);
    }

    const bytes = bytes: {
        if (save_format == .text) {
            var writer_buf = MutableString.initEmpty(bun.default_allocator);
            var buffered_writer = writer_buf.bufferedWriter();
            const writer = buffered_writer.writer();

            TextLockfile.Stringifier.saveFromBinary(bun.default_allocator, this, load_result, writer) catch |err| switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            };

            buffered_writer.flush() catch |err| switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            };

            break :bytes writer_buf.list.items;
        }

        var bytes = std.ArrayList(u8).init(bun.default_allocator);

        var total_size: usize = 0;
        var end_pos: usize = 0;
        Lockfile.Serializer.save(this, options.log_level.isVerbose(), &bytes, &total_size, &end_pos) catch |err| {
            Output.err(err, "failed to serialize lockfile", .{});
            Global.crash();
        };
        if (bytes.items.len >= end_pos)
            bytes.items[end_pos..][0..@sizeOf(usize)].* = @bitCast(total_size);
        break :bytes bytes.items;
    };
    defer bun.default_allocator.free(bytes);

    var tmpname_buf: [512]u8 = undefined;
    var base64_bytes: [8]u8 = undefined;
    bun.csprng(&base64_bytes);
    const tmpname = if (save_format == .text)
        std.fmt.bufPrintZ(&tmpname_buf, ".lock-{s}.tmp", .{std.fmt.fmtSliceHexLower(&base64_bytes)}) catch unreachable
    else
        std.fmt.bufPrintZ(&tmpname_buf, ".lockb-{s}.tmp", .{std.fmt.fmtSliceHexLower(&base64_bytes)}) catch unreachable;

    const file = switch (File.openat(.cwd(), tmpname, bun.O.CREAT | bun.O.WRONLY, 0o777)) {
        .err => |err| {
            Output.err(err, "failed to create temporary file to save lockfile", .{});
            Global.crash();
        },
        .result => |f| f,
    };

    switch (file.writeAll(bytes)) {
        .err => |e| {
            file.close();
            _ = bun.sys.unlink(tmpname);
            Output.err(e, "failed to write lockfile", .{});
            Global.crash();
        },
        .result => {},
    }

    if (comptime Environment.isPosix) {
        // chmod 755 for binary, 644 for plaintext
        var filemode: bun.Mode = 0o755;
        if (save_format == .text) {
            filemode = 0o644;
        }
        switch (bun.sys.fchmod(file.handle, filemode)) {
            .err => |err| {
                file.close();
                _ = bun.sys.unlink(tmpname);
                Output.err(err, "failed to change lockfile permissions", .{});
                Global.crash();
            },
            .result => {},
        }
    }

    file.closeAndMoveTo(tmpname, save_format.filename()) catch |err| {
        bun.handleErrorReturnTrace(err, @errorReturnTrace());

        // note: file is already closed here.
        _ = bun.sys.unlink(tmpname);

        Output.err(err, "Failed to replace old lockfile with new lockfile on disk", .{});
        Global.crash();
    };
}

pub fn rootPackage(this: *const Lockfile) ?Lockfile.Package {
    if (this.packages.len == 0) {
        return null;
    }

    return this.packages.get(0);
}

pub inline fn str(this: *const Lockfile, slicable: anytype) string {
    return strWithType(this, @TypeOf(slicable), slicable);
}

inline fn strWithType(this: *const Lockfile, comptime Type: type, slicable: Type) string {
    if (comptime Type == String) {
        @compileError("str must be a *const String. Otherwise it is a pointer to a temporary which is undefined behavior");
    }

    if (comptime Type == ExternalString) {
        @compileError("str must be a *const ExternalString. Otherwise it is a pointer to a temporary which is undefined behavior");
    }

    return slicable.slice(this.buffers.string_bytes.items);
}

pub fn initEmpty(this: *Lockfile, allocator: Allocator) void {
    this.* = .{
        .format = Lockfile.FormatVersion.current,
        .packages = .{},
        .buffers = .{},
        .package_index = PackageIndex.Map.initContext(allocator, .{}),
        .string_pool = StringPool.init(allocator),
        .allocator = allocator,
        .scratch = Scratch.init(allocator),
        .scripts = .{},
        .trusted_dependencies = null,
        .workspace_paths = .{},
        .workspace_versions = .{},
        .overrides = .{},
        .catalogs = .{},
        .meta_hash = zero_hash,
    };
}

pub fn getPackageID(
    this: *Lockfile,
    name_hash: u64,
    // If non-null, attempt to use an existing package
    // that satisfies this version range.
    version: ?Dependency.Version,
    resolution: *const Resolution,
) ?PackageID {
    const entry = this.package_index.get(name_hash) orelse return null;
    const resolutions: []const Resolution = this.packages.items(.resolution);
    const npm_version = if (version) |v| switch (v.tag) {
        .npm => v.value.npm.version,
        else => null,
    } else null;
    const buf = this.buffers.string_bytes.items;

    switch (entry) {
        .id => |id| {
            if (comptime Environment.allow_assert) assert(id < resolutions.len);

            if (resolutions[id].eql(resolution, buf, buf)) {
                return id;
            }

            if (resolutions[id].tag == .npm and npm_version != null) {
                if (npm_version.?.satisfies(resolutions[id].value.npm.version, buf, buf)) return id;
            }
        },
        .ids => |ids| {
            for (ids.items) |id| {
                if (comptime Environment.allow_assert) assert(id < resolutions.len);

                if (resolutions[id].eql(resolution, buf, buf)) {
                    return id;
                }

                if (resolutions[id].tag == .npm and npm_version != null) {
                    if (npm_version.?.satisfies(resolutions[id].value.npm.version, buf, buf)) return id;
                }
            }
        },
    }

    return null;
}

/// Appends `pkg` to `this.packages`, and adds to `this.package_index`
pub fn appendPackageDedupe(this: *Lockfile, pkg: *Package, buf: string) OOM!PackageID {
    const entry = try this.package_index.getOrPut(pkg.name_hash);

    if (!entry.found_existing) {
        const new_id: PackageID = @intCast(this.packages.len);
        pkg.meta.id = new_id;
        try this.packages.append(this.allocator, pkg.*);
        entry.value_ptr.* = .{ .id = new_id };
        return new_id;
    }

    var resolutions = this.packages.items(.resolution);

    return switch (entry.value_ptr.*) {
        .id => |existing_id| {
            if (pkg.resolution.eql(&resolutions[existing_id], buf, buf)) {
                pkg.meta.id = existing_id;
                return existing_id;
            }

            const new_id: PackageID = @intCast(this.packages.len);
            pkg.meta.id = new_id;
            try this.packages.append(this.allocator, pkg.*);

            resolutions = this.packages.items(.resolution);

            var ids = try PackageIDList.initCapacity(this.allocator, 8);
            ids.items.len = 2;

            ids.items[0..2].* = if (pkg.resolution.order(&resolutions[existing_id], buf, buf) == .gt)
                .{ new_id, existing_id }
            else
                .{ existing_id, new_id };

            entry.value_ptr.* = .{
                .ids = ids,
            };

            return new_id;
        },
        .ids => |*existing_ids| {
            for (existing_ids.items) |existing_id| {
                if (pkg.resolution.eql(&resolutions[existing_id], buf, buf)) {
                    pkg.meta.id = existing_id;
                    return existing_id;
                }
            }

            const new_id: PackageID = @intCast(this.packages.len);
            pkg.meta.id = new_id;
            try this.packages.append(this.allocator, pkg.*);

            resolutions = this.packages.items(.resolution);

            for (existing_ids.items, 0..) |existing_id, i| {
                if (pkg.resolution.order(&resolutions[existing_id], buf, buf) == .gt) {
                    try existing_ids.insert(this.allocator, i, new_id);
                    return new_id;
                }
            }

            try existing_ids.append(this.allocator, new_id);

            return new_id;
        },
    };
}

pub fn getOrPutID(this: *Lockfile, id: PackageID, name_hash: PackageNameHash) OOM!void {
    const gpe = try this.package_index.getOrPut(name_hash);

    if (gpe.found_existing) {
        const index: *PackageIndex.Entry = gpe.value_ptr;

        switch (index.*) {
            .id => |existing_id| {
                var ids = try PackageIDList.initCapacity(this.allocator, 8);
                ids.items.len = 2;

                const resolutions = this.packages.items(.resolution);
                const buf = this.buffers.string_bytes.items;

                ids.items[0..2].* = if (resolutions[id].order(&resolutions[existing_id], buf, buf) == .gt)
                    .{ id, existing_id }
                else
                    .{ existing_id, id };

                index.* = .{
                    .ids = ids,
                };
            },
            .ids => |*existing_ids| {
                const resolutions = this.packages.items(.resolution);
                const buf = this.buffers.string_bytes.items;

                for (existing_ids.items, 0..) |existing_id, i| {
                    if (resolutions[id].order(&resolutions[existing_id], buf, buf) == .gt) {
                        try existing_ids.insert(this.allocator, i, id);
                        return;
                    }
                }

                // append to end because it's the smallest or equal to the smallest
                try existing_ids.append(this.allocator, id);
            },
        }
    } else {
        gpe.value_ptr.* = .{ .id = id };
    }
}

pub fn appendPackage(this: *Lockfile, package_: Lockfile.Package) OOM!Lockfile.Package {
    const id: PackageID = @truncate(this.packages.len);
    return try appendPackageWithID(this, package_, id);
}

pub fn appendPackageWithID(this: *Lockfile, package_: Lockfile.Package, id: PackageID) OOM!Lockfile.Package {
    defer {
        if (comptime Environment.allow_assert) {
            assert(this.getPackageID(package_.name_hash, null, &package_.resolution) != null);
        }
    }
    var package = package_;
    package.meta.id = id;
    try this.packages.append(this.allocator, package);
    try this.getOrPutID(id, package.name_hash);

    return package;
}

pub inline fn stringBuilder(this: *Lockfile) Lockfile.StringBuilder {
    return .{
        .lockfile = this,
    };
}

pub fn stringBuf(this: *Lockfile) String.Buf {
    return .{
        .bytes = &this.buffers.string_bytes,
        .allocator = this.allocator,
        .pool = &this.string_pool,
    };
}

pub const Scratch = struct {
    pub const DuplicateCheckerMap = std.HashMap(PackageNameHash, logger.Loc, IdentityContext(PackageNameHash), 80);
    pub const DependencyQueue = std.fifo.LinearFifo(DependencySlice, .Dynamic);

    duplicate_checker_map: DuplicateCheckerMap = undefined,
    dependency_list_queue: DependencyQueue = undefined,

    pub fn init(allocator: Allocator) Scratch {
        return Scratch{
            .dependency_list_queue = DependencyQueue.init(allocator),
            .duplicate_checker_map = DuplicateCheckerMap.init(allocator),
        };
    }
};

pub const StringBuilder = struct {
    len: usize = 0,
    cap: usize = 0,
    off: usize = 0,
    ptr: ?[*]u8 = null,
    lockfile: *Lockfile,

    pub inline fn count(this: *StringBuilder, slice: string) void {
        this.assertNotAllocated();

        if (String.canInline(slice)) return;
        this._countWithHash(slice, String.Builder.stringHash(slice));
    }

    pub inline fn countWithHash(this: *StringBuilder, slice: string, hash: u64) void {
        this.assertNotAllocated();

        if (String.canInline(slice)) return;
        this._countWithHash(slice, hash);
    }

    inline fn assertNotAllocated(this: *const StringBuilder) void {
        if (comptime Environment.allow_assert) {
            if (this.ptr != null) {
                Output.panic("StringBuilder.count called after StringBuilder.allocate. This is a bug in Bun. Please make sure to call StringBuilder.count before allocating.", .{});
            }
        }
    }

    inline fn _countWithHash(this: *StringBuilder, slice: string, hash: u64) void {
        this.assertNotAllocated();

        if (!this.lockfile.string_pool.contains(hash)) {
            this.cap += slice.len;
        }
    }

    pub fn allocatedSlice(this: *StringBuilder) []const u8 {
        return if (this.ptr) |ptr| ptr[0..this.cap] else "";
    }

    pub fn clamp(this: *StringBuilder) void {
        if (comptime Environment.allow_assert) {
            assert(this.cap >= this.len);
            // assert that no other builder was allocated while this builder was being used
            assert(this.lockfile.buffers.string_bytes.items.len == this.off + this.cap);
        }

        const excess = this.cap - this.len;

        if (excess > 0)
            this.lockfile.buffers.string_bytes.items = this.lockfile.buffers.string_bytes.items[0 .. this.lockfile.buffers.string_bytes.items.len - excess];
    }

    pub fn allocate(this: *StringBuilder) !void {
        var string_bytes = &this.lockfile.buffers.string_bytes;
        try string_bytes.ensureUnusedCapacity(this.lockfile.allocator, this.cap);
        const prev_len = string_bytes.items.len;
        this.off = prev_len;
        string_bytes.items = string_bytes.items.ptr[0 .. string_bytes.items.len + this.cap];
        this.ptr = string_bytes.items.ptr[prev_len .. prev_len + this.cap].ptr;
        this.len = 0;
    }

    pub fn append(this: *StringBuilder, comptime Type: type, slice: string) Type {
        return @call(bun.callmod_inline, appendWithHash, .{ this, Type, slice, String.Builder.stringHash(slice) });
    }

    // SlicedString is not supported due to inline strings.
    pub fn appendWithoutPool(this: *StringBuilder, comptime Type: type, slice: string, hash: u64) Type {
        if (String.canInline(slice)) {
            return switch (Type) {
                String => String.init(this.lockfile.buffers.string_bytes.items, slice),
                ExternalString => ExternalString.init(this.lockfile.buffers.string_bytes.items, slice, hash),
                else => @compileError("Invalid type passed to StringBuilder"),
            };
        }
        if (comptime Environment.allow_assert) {
            assert(this.len <= this.cap); // didn't count everything
            assert(this.ptr != null); // must call allocate first
        }

        bun.copy(u8, this.ptr.?[this.len..this.cap], slice);
        const final_slice = this.ptr.?[this.len..this.cap][0..slice.len];
        this.len += slice.len;

        if (comptime Environment.allow_assert) assert(this.len <= this.cap);

        return switch (Type) {
            String => String.init(this.lockfile.buffers.string_bytes.items, final_slice),
            ExternalString => ExternalString.init(this.lockfile.buffers.string_bytes.items, final_slice, hash),
            else => @compileError("Invalid type passed to StringBuilder"),
        };
    }

    pub fn appendWithHash(this: *StringBuilder, comptime Type: type, slice: string, hash: u64) Type {
        if (String.canInline(slice)) {
            return switch (Type) {
                String => String.init(this.lockfile.buffers.string_bytes.items, slice),
                ExternalString => ExternalString.init(this.lockfile.buffers.string_bytes.items, slice, hash),
                else => @compileError("Invalid type passed to StringBuilder"),
            };
        }

        if (comptime Environment.allow_assert) {
            assert(this.len <= this.cap); // didn't count everything
            assert(this.ptr != null); // must call allocate first
        }

        const string_entry = this.lockfile.string_pool.getOrPut(hash) catch unreachable;
        if (!string_entry.found_existing) {
            bun.copy(u8, this.ptr.?[this.len..this.cap], slice);
            const final_slice = this.ptr.?[this.len..this.cap][0..slice.len];
            this.len += slice.len;

            string_entry.value_ptr.* = String.init(this.lockfile.buffers.string_bytes.items, final_slice);
        }

        if (comptime Environment.allow_assert) assert(this.len <= this.cap);

        return switch (Type) {
            String => string_entry.value_ptr.*,
            ExternalString => .{
                .value = string_entry.value_ptr.*,
                .hash = hash,
            },
            else => @compileError("Invalid type passed to StringBuilder"),
        };
    }
};

pub const PackageIndex = struct {
    pub const Map = std.HashMap(PackageNameHash, PackageIndex.Entry, IdentityContext(PackageNameHash), 80);
    pub const Entry = union(Tag) {
        id: PackageID,
        ids: PackageIDList,

        pub const Tag = enum(u8) {
            id = 0,
            ids = 1,
        };
    };
};

pub const FormatVersion = enum(u32) {
    v0 = 0,
    // bun v0.0.x - bun v0.1.6
    v1 = 1,
    // bun v0.1.7+
    // This change added tarball URLs to npm-resolved packages
    v2 = 2,

    _,
    pub const current = FormatVersion.v2;
};

pub const PackageIDSlice = ExternalSlice(PackageID);
pub const DependencySlice = ExternalSlice(Dependency);
pub const DependencyIDSlice = ExternalSlice(DependencyID);

pub const PackageIDList = std.ArrayListUnmanaged(PackageID);
pub const DependencyList = std.ArrayListUnmanaged(Dependency);
pub const DependencyIDList = std.ArrayListUnmanaged(DependencyID);

pub const StringBuffer = std.ArrayListUnmanaged(u8);
pub const ExternalStringBuffer = std.ArrayListUnmanaged(ExternalString);

pub const jsonStringify = @import("lockfile/lockfile_json_stringify_for_debugging.zig").jsonStringify;
pub const assertNoUninitializedPadding = @import("./padding_checker.zig").assertNoUninitializedPadding;
pub const Buffers = @import("lockfile/Buffers.zig");
pub const Serializer = @import("lockfile/bun.lockb.zig");
pub const CatalogMap = @import("lockfile/CatalogMap.zig");
pub const OverrideMap = @import("lockfile/OverrideMap.zig");
pub const Package = @import("lockfile/Package.zig").Package;
pub const Tree = @import("lockfile/Tree.zig");

pub fn deinit(this: *Lockfile) void {
    this.buffers.deinit(this.allocator);
    this.packages.deinit(this.allocator);
    this.string_pool.deinit();
    this.scripts.deinit(this.allocator);
    if (this.trusted_dependencies) |*trusted_dependencies| {
        trusted_dependencies.deinit(this.allocator);
    }
    this.patched_dependencies.deinit(this.allocator);
    this.workspace_paths.deinit(this.allocator);
    this.workspace_versions.deinit(this.allocator);
    this.overrides.deinit(this.allocator);
    this.catalogs.deinit(this.allocator);
}

pub const EqlSorter = struct {
    string_buf: string,
    pkg_names: []const String,

    // Basically placement id
    pub const PathToId = struct {
        pkg_id: PackageID,
        tree_path: string,
    };

    pub fn isLessThan(this: @This(), l: PathToId, r: PathToId) bool {
        switch (strings.order(l.tree_path, r.tree_path)) {
            .lt => return true,
            .gt => return false,
            .eq => {},
        }

        // they exist in the same tree, name can't be the same so string
        // compare.
        const l_name = this.pkg_names[l.pkg_id];
        const r_name = this.pkg_names[r.pkg_id];
        return l_name.order(&r_name, this.string_buf, this.string_buf) == .lt;
    }
};

/// `cut_off_pkg_id` should be removed when we stop appending packages to lockfile during install step
pub fn eql(l: *const Lockfile, r: *const Lockfile, cut_off_pkg_id: usize, allocator: std.mem.Allocator) OOM!bool {
    const l_hoisted_deps = l.buffers.hoisted_dependencies.items;
    const r_hoisted_deps = r.buffers.hoisted_dependencies.items;
    const l_string_buf = l.buffers.string_bytes.items;
    const r_string_buf = r.buffers.string_bytes.items;

    const l_len = l_hoisted_deps.len;
    const r_len = r_hoisted_deps.len;

    if (l_len != r_len) return false;

    const sort_buf = try allocator.alloc(EqlSorter.PathToId, l_len + r_len);
    defer l.allocator.free(sort_buf);
    var l_buf = sort_buf[0..l_len];
    var r_buf = sort_buf[r_len..];

    var path_buf: bun.PathBuffer = undefined;
    var depth_buf: Tree.DepthBuf = undefined;

    var i: usize = 0;
    for (l.buffers.trees.items) |l_tree| {
        const rel_path, _ = Tree.relativePathAndDepth(l, l_tree.id, &path_buf, &depth_buf, .pkg_path);
        const tree_path = try allocator.dupe(u8, rel_path);
        for (l_tree.dependencies.get(l_hoisted_deps)) |l_dep_id| {
            if (l_dep_id == invalid_dependency_id) continue;
            const l_pkg_id = l.buffers.resolutions.items[l_dep_id];
            if (l_pkg_id == invalid_package_id or l_pkg_id >= cut_off_pkg_id) continue;
            l_buf[i] = .{
                .pkg_id = l_pkg_id,
                .tree_path = tree_path,
            };
            i += 1;
        }
    }
    l_buf = l_buf[0..i];

    i = 0;
    for (r.buffers.trees.items) |r_tree| {
        const rel_path, _ = Tree.relativePathAndDepth(r, r_tree.id, &path_buf, &depth_buf, .pkg_path);
        const tree_path = try allocator.dupe(u8, rel_path);
        for (r_tree.dependencies.get(r_hoisted_deps)) |r_dep_id| {
            if (r_dep_id == invalid_dependency_id) continue;
            const r_pkg_id = r.buffers.resolutions.items[r_dep_id];
            if (r_pkg_id == invalid_package_id or r_pkg_id >= cut_off_pkg_id) continue;
            r_buf[i] = .{
                .pkg_id = r_pkg_id,
                .tree_path = tree_path,
            };
            i += 1;
        }
    }
    r_buf = r_buf[0..i];

    if (l_buf.len != r_buf.len) return false;

    const l_pkgs = l.packages.slice();
    const r_pkgs = r.packages.slice();
    const l_pkg_names = l_pkgs.items(.name);
    const r_pkg_names = r_pkgs.items(.name);

    std.sort.pdq(
        EqlSorter.PathToId,
        l_buf,
        EqlSorter{
            .pkg_names = l_pkg_names,
            .string_buf = l_string_buf,
        },
        EqlSorter.isLessThan,
    );

    std.sort.pdq(
        EqlSorter.PathToId,
        r_buf,
        EqlSorter{
            .pkg_names = r_pkg_names,
            .string_buf = r_string_buf,
        },
        EqlSorter.isLessThan,
    );

    const l_pkg_name_hashes = l_pkgs.items(.name_hash);
    const l_pkg_resolutions = l_pkgs.items(.resolution);
    const l_pkg_bins = l_pkgs.items(.bin);
    const l_pkg_scripts = l_pkgs.items(.scripts);
    const r_pkg_name_hashes = r_pkgs.items(.name_hash);
    const r_pkg_resolutions = r_pkgs.items(.resolution);
    const r_pkg_bins = r_pkgs.items(.bin);
    const r_pkg_scripts = r_pkgs.items(.scripts);

    const l_extern_strings = l.buffers.extern_strings.items;
    const r_extern_strings = r.buffers.extern_strings.items;

    for (l_buf, r_buf) |l_ids, r_ids| {
        const l_pkg_id = l_ids.pkg_id;
        const r_pkg_id = r_ids.pkg_id;
        if (l_pkg_name_hashes[l_pkg_id] != r_pkg_name_hashes[r_pkg_id]) {
            return false;
        }
        const l_res = l_pkg_resolutions[l_pkg_id];
        const r_res = r_pkg_resolutions[r_pkg_id];

        if (l_res.tag == .uninitialized or r_res.tag == .uninitialized) {
            if (l_res.tag != r_res.tag) {
                return false;
            }
        } else if (!l_res.eql(&r_res, l_string_buf, r_string_buf)) {
            return false;
        }

        if (!l_pkg_bins[l_pkg_id].eql(
            &r_pkg_bins[r_pkg_id],
            l_string_buf,
            l_extern_strings,
            r_string_buf,
            r_extern_strings,
        )) {
            return false;
        }

        if (!l_pkg_scripts[l_pkg_id].eql(&r_pkg_scripts[r_pkg_id], l_string_buf, r_string_buf)) {
            return false;
        }
    }

    return true;
}

pub fn hasMetaHashChanged(this: *Lockfile, print_name_version_string: bool, packages_len: usize) !bool {
    const previous_meta_hash = this.meta_hash;
    this.meta_hash = try this.generateMetaHash(print_name_version_string, packages_len);
    return !strings.eqlLong(&previous_meta_hash, &this.meta_hash, false);
}
pub fn generateMetaHash(this: *Lockfile, print_name_version_string: bool, packages_len: usize) !MetaHash {
    if (packages_len <= 1)
        return zero_hash;

    var string_builder = GlobalStringBuilder{};
    defer string_builder.deinit(this.allocator);
    const names: []const String = this.packages.items(.name)[0..packages_len];
    const resolutions: []const Resolution = this.packages.items(.resolution)[0..packages_len];
    const bytes = this.buffers.string_bytes.items;
    var alphabetized_names = try this.allocator.alloc(PackageID, packages_len -| 1);
    defer this.allocator.free(alphabetized_names);

    const hash_prefix = "\n-- BEGIN SHA512/256(`${alphabetize(name)}@${order(version)}`) --\n";
    const hash_suffix = "-- END HASH--\n";
    string_builder.cap += hash_prefix.len + hash_suffix.len;
    {
        var i: usize = 1;

        while (i + 16 < packages_len) : (i += 16) {
            comptime var j: usize = 0;
            inline while (j < 16) : (j += 1) {
                alphabetized_names[(i + j) - 1] = @as(PackageID, @truncate((i + j)));
                // posix path separators because we only use posix in the lockfile
                string_builder.fmtCount("{s}@{}\n", .{ names[i + j].slice(bytes), resolutions[i + j].fmt(bytes, .posix) });
            }
        }

        while (i < packages_len) : (i += 1) {
            alphabetized_names[i - 1] = @as(PackageID, @truncate(i));
            // posix path separators because we only use posix in the lockfile
            string_builder.fmtCount("{s}@{}\n", .{ names[i].slice(bytes), resolutions[i].fmt(bytes, .posix) });
        }
    }

    const scripts_begin = "\n-- BEGIN SCRIPTS --\n";
    const scripts_end = "\n-- END SCRIPTS --\n";
    var has_scripts = false;

    inline for (comptime std.meta.fieldNames(Lockfile.Scripts)) |field_name| {
        const scripts = @field(this.scripts, field_name);
        for (scripts.items) |script| {
            if (script.script.len > 0) {
                string_builder.fmtCount("{s}: {s}\n", .{ field_name, script.script });
                has_scripts = true;
            }
        }
    }

    if (has_scripts) {
        string_builder.count(scripts_begin);
        string_builder.count(scripts_end);
    }

    std.sort.pdq(
        PackageID,
        alphabetized_names,
        Lockfile.Package.Alphabetizer{
            .names = names,
            .buf = bytes,
            .resolutions = resolutions,
        },
        Lockfile.Package.Alphabetizer.isAlphabetical,
    );

    string_builder.allocate(this.allocator) catch unreachable;
    string_builder.ptr.?[0..hash_prefix.len].* = hash_prefix.*;
    string_builder.len += hash_prefix.len;

    for (alphabetized_names) |i| {
        _ = string_builder.fmt("{s}@{}\n", .{ names[i].slice(bytes), resolutions[i].fmt(bytes, .any) });
    }

    if (has_scripts) {
        _ = string_builder.append(scripts_begin);
        inline for (comptime std.meta.fieldNames(Lockfile.Scripts)) |field_name| {
            const scripts = @field(this.scripts, field_name);
            for (scripts.items) |script| {
                if (script.script.len > 0) {
                    _ = string_builder.fmt("{s}: {s}\n", .{ field_name, script.script });
                }
            }
        }
        _ = string_builder.append(scripts_end);
    }

    string_builder.ptr.?[string_builder.len..string_builder.cap][0..hash_suffix.len].* = hash_suffix.*;
    string_builder.len += hash_suffix.len;

    const alphabetized_name_version_string = string_builder.ptr.?[0..string_builder.len];
    if (print_name_version_string) {
        Output.flush();
        Output.disableBuffering();
        Output.writer().writeAll(alphabetized_name_version_string) catch unreachable;
        Output.enableBuffering();
    }

    var digest = zero_hash;
    Crypto.SHA512_256.hash(alphabetized_name_version_string, &digest);

    return digest;
}

pub fn resolvePackageFromNameAndVersion(this: *Lockfile, package_name: []const u8, version: Dependency.Version) ?PackageID {
    const name_hash = String.Builder.stringHash(package_name);
    const entry = this.package_index.get(name_hash) orelse return null;
    const buf = this.buffers.string_bytes.items;

    switch (version.tag) {
        .npm => switch (entry) {
            .id => |id| {
                const resolutions = this.packages.items(.resolution);

                if (comptime Environment.allow_assert) assert(id < resolutions.len);
                if (version.value.npm.version.satisfies(resolutions[id].value.npm.version, buf, buf)) {
                    return id;
                }
            },
            .ids => |ids| {
                const resolutions = this.packages.items(.resolution);

                for (ids.items) |id| {
                    if (comptime Environment.allow_assert) assert(id < resolutions.len);
                    if (version.value.npm.version.satisfies(resolutions[id].value.npm.version, buf, buf)) {
                        return id;
                    }
                }
            },
        },
        else => {},
    }

    return null;
}

const max_default_trusted_dependencies = 512;

// TODO
pub const default_trusted_dependencies_list: []const []const u8 = brk: {
    // This file contains a list of dependencies that Bun runs `postinstall` on by default.
    const data = @embedFile("./default-trusted-dependencies.txt");
    @setEvalBranchQuota(999999);
    var buf: [max_default_trusted_dependencies][]const u8 = undefined;
    var i: usize = 0;
    var iter = std.mem.tokenizeAny(u8, data, " \r\n\t");
    while (iter.next()) |package_ptr| {
        const package = package_ptr[0..].*;
        buf[i] = &package;
        i += 1;
    }

    const Sorter = struct {
        pub fn lessThan(_: void, lhs: []const u8, rhs: []const u8) bool {
            return std.mem.order(u8, lhs, rhs) == .lt;
        }
    };

    // alphabetical so we don't need to sort in `bun pm trusted --default`
    std.sort.pdq([]const u8, buf[0..i], {}, Sorter.lessThan);

    var names: [i][]const u8 = undefined;
    @memcpy(names[0..i], buf[0..i]);
    const final = names;
    break :brk &final;
};

/// The default list of trusted dependencies is a static hashmap
pub const default_trusted_dependencies = brk: {
    const StringHashContext = struct {
        pub fn hash(_: @This(), s: []const u8) u64 {
            @setEvalBranchQuota(999999);
            // truncate to u32 because Lockfile.trustedDependencies uses the same u32 string hash
            return @intCast(@as(u32, @truncate(String.Builder.stringHash(s))));
        }
        pub fn eql(_: @This(), a: []const u8, b: []const u8) bool {
            @setEvalBranchQuota(999999);
            return std.mem.eql(u8, a, b);
        }
    };

    var map: StaticHashMap([]const u8, void, StringHashContext, max_default_trusted_dependencies) = .{};

    for (default_trusted_dependencies_list) |dep| {
        if (map.len == max_default_trusted_dependencies) {
            @compileError("default-trusted-dependencies.txt is too large, please increase 'max_default_trusted_dependencies' in lockfile.zig");
        }

        // just in case there's duplicates from truncating
        if (map.has(dep)) @compileError("Duplicate hash due to u64 -> u32 truncation");

        map.putAssumeCapacity(dep, {});
    }

    const final = map;
    break :brk &final;
};

pub fn hasTrustedDependency(this: *Lockfile, name: []const u8) bool {
    if (this.trusted_dependencies) |trusted_dependencies| {
        const hash = @as(u32, @truncate(String.Builder.stringHash(name)));
        return trusted_dependencies.contains(hash);
    }

    return default_trusted_dependencies.has(name);
}

pub const NameHashMap = std.ArrayHashMapUnmanaged(PackageNameHash, String, ArrayIdentityContext.U64, false);
pub const TrustedDependenciesSet = std.ArrayHashMapUnmanaged(TruncatedPackageNameHash, void, ArrayIdentityContext, false);
pub const VersionHashMap = std.ArrayHashMapUnmanaged(PackageNameHash, Semver.Version, ArrayIdentityContext.U64, false);
pub const PatchedDependenciesMap = std.ArrayHashMapUnmanaged(PackageNameAndVersionHash, PatchedDep, ArrayIdentityContext.U64, false);
pub const PatchedDep = extern struct {
    /// e.g. "patches/is-even@1.0.0.patch"
    path: String,
    _padding: [7]u8 = [_]u8{0} ** 7,
    patchfile_hash_is_null: bool = true,
    /// the hash of the patch file contents
    __patchfile_hash: u64 = 0,

    pub fn setPatchfileHash(this: *PatchedDep, val: ?u64) void {
        this.patchfile_hash_is_null = val == null;
        this.__patchfile_hash = if (val) |v| v else 0;
    }
    pub fn patchfileHash(this: *const PatchedDep) ?u64 {
        return if (this.patchfile_hash_is_null) null else this.__patchfile_hash;
    }
};

const Lockfile = @This();
const MetaHash = [std.crypto.hash.sha2.Sha512T256.digest_length]u8;
const zero_hash = std.mem.zeroes(MetaHash);
const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("bun");
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const string = bun.string;
const stringZ = bun.stringZ;
const strings = bun.strings;
const assert = bun.assert;
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const Environment = bun.Environment;
const File = bun.sys.File;
const Global = bun.Global;
const GlobalStringBuilder = bun.StringBuilder;
const Install = bun.install;
const JSON = bun.JSON;
const MutableString = bun.MutableString;
const OOM = bun.OOM;
const Output = bun.Output;
const PackageID = Install.PackageID;
const PackageInstall = Install.PackageInstall;
const PackageManager = Install.PackageManager;
const PackageNameAndVersionHash = Install.PackageNameAndVersionHash;
const PackageNameHash = Install.PackageNameHash;
const Semver = bun.Semver;
const SlicedString = Semver.SlicedString;
const String = Semver.String;
const TruncatedPackageNameHash = Install.TruncatedPackageNameHash;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
const initializeStore = Install.initializeStore;
const invalid_dependency_id = Install.invalid_dependency_id;
const invalid_package_id = Install.invalid_package_id;
pub const StringPool = String.Builder.StringPool;
const DependencyID = Install.DependencyID;
const ExternalSlice = Install.ExternalSlice;
const ExternalString = Semver.ExternalString;
const Features = Install.Features;
const z_allocator = @import("../allocators/memory_allocator.zig").z_allocator;
const DotEnv = @import("../env_loader.zig");
const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;
const ArrayIdentityContext = @import("../identity_context.zig").ArrayIdentityContext;
const IdentityContext = @import("../identity_context.zig").IdentityContext;
const Path = @import("../resolver/resolve_path.zig");
const Crypto = @import("../sha.zig").Hashers;
const StaticHashMap = @import("../StaticHashMap.zig").StaticHashMap;
const which = @import("../which.zig").which;
const Dependency = @import("./dependency.zig");
const TextLockfile = @import("./lockfile/bun.lock.zig");
const migration = @import("./migration.zig");
const Resolution = @import("./resolution.zig").Resolution;
