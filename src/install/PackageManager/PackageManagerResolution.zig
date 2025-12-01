pub fn formatLaterVersionInCache(
    this: *PackageManager,
    package_name: string,
    name_hash: PackageNameHash,
    resolution: Resolution,
) ?Semver.Version.Formatter {
    switch (resolution.tag) {
        Resolution.Tag.npm => {
            if (resolution.value.npm.version.tag.hasPre())
                // TODO:
                return null;

            const manifest = this.manifests.byNameHash(
                this,
                this.scopeForPackageName(package_name),
                name_hash,
                .load_from_memory,
                this.options.minimum_release_age_ms != null,
            ) orelse return null;

            if (manifest.findByDistTagWithFilter("latest", this.options.minimum_release_age_ms, this.options.minimum_release_age_excludes).unwrap()) |*latest_version| {
                if (latest_version.version.order(
                    resolution.value.npm.version,
                    manifest.string_buf,
                    this.lockfile.buffers.string_bytes.items,
                ) != .gt) return null;
                return latest_version.version.fmt(manifest.string_buf);
            }

            return null;
        },
        else => return null,
    }
}

pub fn scopeForPackageName(this: *const PackageManager, name: string) *const Npm.Registry.Scope {
    if (name.len == 0 or name[0] != '@') return &this.options.scope;
    return this.options.registries.getPtr(
        Npm.Registry.Scope.hash(
            Npm.Registry.Scope.getName(name),
        ),
    ) orelse &this.options.scope;
}

pub fn getInstalledVersionsFromDiskCache(this: *PackageManager, tags_buf: *std.array_list.Managed(u8), package_name: []const u8, allocator: std.mem.Allocator) !std.array_list.Managed(Semver.Version) {
    var list = std.array_list.Managed(Semver.Version).init(allocator);
    var dir = this.getCacheDirectory().openDir(package_name, .{
        .iterate = true,
    }) catch |err| switch (err) {
        error.FileNotFound, error.NotDir, error.AccessDenied, error.DeviceBusy => return list,
        else => return err,
    };
    defer dir.close();
    var iter = dir.iterate();

    while (try iter.next()) |entry| {
        if (entry.kind != .directory and entry.kind != .sym_link) continue;
        const name = entry.name;
        const sliced = SlicedString.init(name, name);
        const parsed = Semver.Version.parse(sliced);
        if (!parsed.valid or parsed.wildcard != .none) continue;
        // not handling OOM
        // TODO: wildcard
        var version = parsed.version.min();
        const total = version.tag.build.len() + version.tag.pre.len();
        if (total > 0) {
            tags_buf.ensureUnusedCapacity(total) catch unreachable;
            var available = tags_buf.items.ptr[tags_buf.items.len..tags_buf.capacity];
            const new_version = version.cloneInto(name, &available);
            tags_buf.items.len += total;
            version = new_version;
        }

        list.append(version) catch unreachable;
    }

    return list;
}

pub fn resolveFromDiskCache(this: *PackageManager, package_name: []const u8, version: Dependency.Version) ?PackageID {
    if (version.tag != .npm) {
        // only npm supported right now
        // tags are more ambiguous
        return null;
    }

    var arena = bun.ArenaAllocator.init(this.allocator);
    defer arena.deinit();
    const arena_alloc = arena.allocator();
    var stack_fallback = std.heap.stackFallback(4096, arena_alloc);
    const allocator = stack_fallback.get();
    var tags_buf = std.array_list.Managed(u8).init(allocator);
    const installed_versions = this.getInstalledVersionsFromDiskCache(&tags_buf, package_name, allocator) catch |err| {
        Output.debug("error getting installed versions from disk cache: {s}", .{bun.span(@errorName(err))});
        return null;
    };

    // TODO: make this fewer passes
    std.sort.pdq(
        Semver.Version,
        installed_versions.items,
        @as([]const u8, tags_buf.items),
        Semver.Version.sortGt,
    );
    for (installed_versions.items) |installed_version| {
        if (version.value.npm.version.satisfies(installed_version, this.lockfile.buffers.string_bytes.items, tags_buf.items)) {
            var buf: bun.PathBuffer = undefined;
            const npm_package_path = this.pathForCachedNPMPath(&buf, package_name, installed_version) catch |err| {
                Output.debug("error getting path for cached npm path: {s}", .{bun.span(@errorName(err))});
                return null;
            };
            const dependency = Dependency.Version{
                .tag = .npm,
                .value = .{
                    .npm = .{
                        .name = String.init(package_name, package_name),
                        .version = Semver.Query.Group.from(installed_version),
                    },
                },
            };
            switch (FolderResolution.getOrPut(.{ .cache_folder = npm_package_path }, dependency, ".", this)) {
                .new_package_id => |id| {
                    this.enqueueDependencyList(this.lockfile.packages.items(.dependencies)[id]);
                    return id;
                },
                .package_id => |id| {
                    this.enqueueDependencyList(this.lockfile.packages.items(.dependencies)[id]);
                    return id;
                },
                .err => |err| {
                    Output.debug("error getting or putting folder resolution: {s}", .{bun.span(@errorName(err))});
                    return null;
                },
            }
        }
    }

    return null;
}

pub fn assignResolution(this: *PackageManager, dependency_id: DependencyID, package_id: PackageID) void {
    const buffers = &this.lockfile.buffers;
    if (comptime Environment.allow_assert) {
        bun.assert(dependency_id < buffers.resolutions.items.len);
        bun.assert(package_id < this.lockfile.packages.len);
        // bun.assert(buffers.resolutions.items[dependency_id] == invalid_package_id);
    }
    buffers.resolutions.items[dependency_id] = package_id;
    const string_buf = buffers.string_bytes.items;
    var dep = &buffers.dependencies.items[dependency_id];
    if (dep.name.isEmpty() or strings.eql(dep.name.slice(string_buf), dep.version.literal.slice(string_buf))) {
        dep.name = this.lockfile.packages.items(.name)[package_id];
        dep.name_hash = this.lockfile.packages.items(.name_hash)[package_id];
    }
}

pub fn assignRootResolution(this: *PackageManager, dependency_id: DependencyID, package_id: PackageID) void {
    const buffers = &this.lockfile.buffers;
    if (comptime Environment.allow_assert) {
        bun.assert(dependency_id < buffers.resolutions.items.len);
        bun.assert(package_id < this.lockfile.packages.len);
        bun.assert(buffers.resolutions.items[dependency_id] == invalid_package_id);
    }
    buffers.resolutions.items[dependency_id] = package_id;
    const string_buf = buffers.string_bytes.items;
    var dep = &buffers.dependencies.items[dependency_id];
    if (dep.name.isEmpty() or strings.eql(dep.name.slice(string_buf), dep.version.literal.slice(string_buf))) {
        dep.name = this.lockfile.packages.items(.name)[package_id];
        dep.name_hash = this.lockfile.packages.items(.name_hash)[package_id];
    }
}

pub fn verifyResolutions(this: *PackageManager, log_level: PackageManager.Options.LogLevel) void {
    const lockfile = this.lockfile;
    const resolutions_lists: []const Lockfile.DependencyIDSlice = lockfile.packages.items(.resolutions);
    const dependency_lists: []const Lockfile.DependencySlice = lockfile.packages.items(.dependencies);
    const pkg_resolutions = lockfile.packages.items(.resolution);
    const dependencies_buffer = lockfile.buffers.dependencies.items;
    const resolutions_buffer = lockfile.buffers.resolutions.items;
    const end: PackageID = @truncate(lockfile.packages.len);

    var any_failed = false;
    const string_buf = lockfile.buffers.string_bytes.items;

    for (resolutions_lists, dependency_lists, 0..) |resolution_list, dependency_list, parent_id| {
        for (resolution_list.get(resolutions_buffer), dependency_list.get(dependencies_buffer)) |package_id, failed_dep| {
            if (package_id < end) continue;

            // TODO lockfile rewrite: remove this and make non-optional peer dependencies error if they did not resolve.
            //      Need to keep this for now because old lockfiles might have a peer dependency without the optional flag set.
            if (failed_dep.behavior.isPeer()) continue;

            const features = switch (pkg_resolutions[parent_id].tag) {
                .root, .workspace, .folder => this.options.local_package_features,
                else => this.options.remote_package_features,
            };
            // even if optional dependencies are enabled, it's still allowed to fail
            if (failed_dep.behavior.optional or !failed_dep.behavior.isEnabled(features)) continue;

            if (log_level != .silent) {
                if (failed_dep.name.isEmpty() or strings.eqlLong(failed_dep.name.slice(string_buf), failed_dep.version.literal.slice(string_buf), true)) {
                    Output.errGeneric("<b>{f}<r><d> failed to resolve<r>", .{
                        failed_dep.version.literal.fmt(string_buf),
                    });
                } else {
                    Output.errGeneric("<b>{s}<r><d>@<b>{f}<r><d> failed to resolve<r>", .{
                        failed_dep.name.slice(string_buf),
                        failed_dep.version.literal.fmt(string_buf),
                    });
                }
            }
            // track this so we can log each failure instead of just the first
            any_failed = true;
        }
    }

    if (any_failed) this.crash();
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const OOM = bun.OOM;
const Output = bun.Output;
const strings = bun.strings;

const Semver = bun.Semver;
const SlicedString = Semver.SlicedString;
const String = Semver.String;

const Dependency = bun.install.Dependency;
const DependencyID = bun.install.DependencyID;
const FolderResolution = bun.install.FolderResolution;
const Lockfile = bun.install.Lockfile;
const Npm = bun.install.Npm;
const PackageID = bun.install.PackageID;
const PackageManager = bun.install.PackageManager;
const PackageNameHash = bun.install.PackageNameHash;
const Resolution = bun.install.Resolution;
const invalid_package_id = bun.install.invalid_package_id;
