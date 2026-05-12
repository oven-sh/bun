const StartManifestTaskError = bun.OOM || error{InvalidURL};
fn startManifestTask(manager: *PackageManager, pkg_name: []const u8, dep: *const Dependency, needs_extended_manifest: bool) StartManifestTaskError!void {
    const task_id = Task.Id.forManifest(pkg_name);
    if (manager.hasCreatedNetworkTask(task_id, dep.behavior.optional)) {
        return;
    }
    manager.startProgressBarIfNone();
    var task = manager.getNetworkTask();
    task.* = .{
        .package_manager = manager,
        .callback = undefined,
        .task_id = task_id,
        .allocator = manager.allocator,
    };
    try task.forManifest(pkg_name, manager.allocator, manager.scopeForPackageName(pkg_name), null, dep.behavior.optional, needs_extended_manifest);
    manager.enqueueNetworkTask(task);
}

const Packages = union(enum) {
    all,
    ids: []const PackageID,
};

/// Populate the manifest cache for packages included from `root_pkg_ids`. Only manifests of
/// direct dependencies of the `root_pkg_ids` are populated. If `root_pkg_ids` has length 0
/// all packages in the lockfile will have their manifests fetched if necessary.
pub fn populateManifestCache(manager: *PackageManager, packages: Packages) !void {
    const log_level = manager.options.log_level;
    const lockfile = manager.lockfile;
    const resolutions = lockfile.buffers.resolutions.items;
    const dependencies = lockfile.buffers.dependencies.items;
    const string_buf = lockfile.buffers.string_bytes.items;
    const pkgs = lockfile.packages.slice();
    const pkg_resolutions = pkgs.items(.resolution);
    const pkg_names = pkgs.items(.name);
    const pkg_dependencies = pkgs.items(.dependencies);

    switch (packages) {
        .all => {
            var seen_pkg_ids: std.AutoHashMap(PackageID, void) = .init(manager.allocator);
            defer seen_pkg_ids.deinit();

            for (dependencies, 0..) |*dep, _dep_id| {
                const dep_id: DependencyID = @intCast(_dep_id);

                const pkg_id = resolutions[dep_id];
                if (pkg_id == invalid_package_id) {
                    continue;
                }

                if ((try seen_pkg_ids.getOrPut(pkg_id)).found_existing) {
                    continue;
                }

                const res = pkg_resolutions[pkg_id];
                if (res.tag != .npm) {
                    continue;
                }

                const pkg_name = pkg_names[pkg_id];
                const needs_extended_manifest = manager.options.minimum_release_age_ms != null;

                _ = manager.manifests.byName(
                    manager,
                    manager.scopeForPackageName(pkg_name.slice(string_buf)),
                    pkg_name.slice(string_buf),
                    .load_from_memory_fallback_to_disk,
                    needs_extended_manifest,
                ) orelse {
                    try startManifestTask(manager, pkg_name.slice(string_buf), dep, needs_extended_manifest);
                };

                manager.flushNetworkQueue();
                _ = manager.scheduleTasks();
            }
        },
        .ids => |ids| {
            for (ids) |root_pkg_id| {
                const pkg_deps = pkg_dependencies[root_pkg_id];
                for (pkg_deps.begin()..pkg_deps.end()) |dep_id| {
                    if (dep_id >= dependencies.len) continue;
                    const pkg_id = resolutions[dep_id];
                    if (pkg_id == invalid_package_id) continue;
                    const dep = &dependencies[dep_id];

                    const resolution: Resolution = pkg_resolutions[pkg_id];
                    if (resolution.tag != .npm) continue;

                    const needs_extended_manifest = manager.options.minimum_release_age_ms != null;
                    const package_name = pkg_names[pkg_id].slice(string_buf);
                    _ = manager.manifests.byName(
                        manager,
                        manager.scopeForPackageName(package_name),
                        package_name,
                        .load_from_memory_fallback_to_disk,
                        needs_extended_manifest,
                    ) orelse {
                        try startManifestTask(manager, package_name, dep, needs_extended_manifest);

                        manager.flushNetworkQueue();
                        _ = manager.scheduleTasks();
                    };
                }
            }
        },
    }

    manager.flushNetworkQueue();
    _ = manager.scheduleTasks();

    if (manager.pendingTaskCount() > 0) {
        const RunClosure = struct {
            manager: *PackageManager,
            err: ?anyerror = null,
            pub fn isDone(closure: *@This()) bool {
                closure.manager.runTasks(
                    *PackageManager,
                    closure.manager,
                    .{
                        .onExtract = {},
                        .onResolve = {},
                        .onPackageManifestError = {},
                        .onPackageDownloadError = {},
                        .progress_bar = true,
                        .manifests_only = true,
                    },
                    true,
                    closure.manager.options.log_level,
                ) catch |err| {
                    closure.err = err;
                    return true;
                };

                return closure.manager.pendingTaskCount() == 0;
            }
        };

        var run_closure: RunClosure = .{ .manager = manager };
        manager.sleepUntil(&run_closure, &RunClosure.isDone);

        if (log_level.showProgress()) {
            manager.endProgressBar();
            Output.flush();
        }

        if (run_closure.err) |err| {
            return err;
        }
    }
}

/// After resolution, verify every npm-tagged package in the lockfile
/// satisfies the configured `minimumReleaseAge` cooldown.
///
/// The resolution-time filter (`findBestVersionWithFilter`, etc.) only
/// runs when Bun is actually picking a new version. If the lockfile
/// already pins a version — e.g. it was resolved before the cooldown
/// was configured, or by a developer whose local bunfig was less strict
/// — that install path skips the filter entirely. Without this gate,
/// `bun install` (and `bun install --frozen-lockfile`) will happily
/// install a locked version that was published inside the cooldown
/// window, defeating the supply-chain protection the setting is meant
/// to provide.
///
/// This loads manifests for every locked npm package, looks up the
/// exact pinned version's publish timestamp, and aggregates every
/// violation into `manager.log` as an error. Excludes from
/// `minimumReleaseAgeExcludes` are honored.
pub fn enforceLockfileAgeFilter(manager: *PackageManager) !void {
    const min_age_ms = manager.options.minimum_release_age_ms orelse return;

    // Make sure manifests are loaded from disk / network before we
    // inspect publish timestamps. `populateManifestCache` already
    // honors `minimum_release_age_ms` by requesting extended manifests.
    try populateManifestCache(manager, .all);

    const lockfile = manager.lockfile;
    const pkgs = lockfile.packages.slice();
    const pkg_resolutions = pkgs.items(.resolution);
    const pkg_names = pkgs.items(.name);
    const pkg_name_hashes = pkgs.items(.name_hash);
    const string_buf = lockfile.buffers.string_bytes.items;
    const min_age_seconds = min_age_ms / std.time.ms_per_s;

    for (pkg_resolutions, pkg_names, pkg_name_hashes) |resolution, name, name_hash| {
        if (resolution.tag != .npm) continue;

        const name_str = name.slice(string_buf);

        // Fail closed: if we cannot reach the manifest or locate the exact
        // pinned version, we cannot prove the version satisfies the cooldown.
        // Silently skipping would re-open the lockfile bypass this gate is
        // meant to close (e.g. a version that was unpublished from the
        // registry, or a manifest fetch that couldn't be completed).
        const manifest = manager.manifests.byNameHash(
            manager,
            manager.scopeForPackageName(name_str),
            name_hash,
            .load_from_memory_fallback_to_disk,
            true,
        ) orelse {
            if (isExcludedByName(name_str, manager.options.minimum_release_age_excludes)) continue;
            manager.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                manager.allocator,
                "Package \"{s}@{f}\" in lockfile could not be checked against minimum release age (manifest unavailable)",
                .{ name_str, resolution.value.npm.version.fmt(string_buf) },
            ) catch bun.outOfMemory();
            continue;
        };

        if (manifest.shouldExcludeFromAgeFilter(manager.options.minimum_release_age_excludes)) continue;

        const find_result = manifest.findByVersion(resolution.value.npm.version) orelse {
            manager.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                manager.allocator,
                "Package \"{s}@{f}\" in lockfile could not be checked against minimum release age (version not in manifest)",
                .{ name_str, resolution.value.npm.version.fmt(string_buf) },
            ) catch bun.outOfMemory();
            continue;
        };
        if (!Npm.PackageManifest.isPackageVersionTooRecent(find_result.package, min_age_ms)) continue;

        manager.log.addErrorFmt(
            null,
            logger.Loc.Empty,
            manager.allocator,
            "Package \"{s}@{f}\" in lockfile was published within minimum release age of {d} seconds",
            .{
                name_str,
                resolution.value.npm.version.fmt(string_buf),
                min_age_seconds,
            },
        ) catch bun.outOfMemory();
    }
}

/// Mirrors `PackageManifest.shouldExcludeFromAgeFilter` for the code path
/// where no manifest is available (the manifest lookup above returned null).
/// Kept in sync with the real check in `src/install/npm.zig`.
fn isExcludedByName(name: []const u8, exclusions: ?[]const []const u8) bool {
    const excl = exclusions orelse return false;
    for (excl) |entry| {
        if (bun.strings.eql(entry, name)) return true;
    }
    return false;
}

const std = @import("std");

const bun = @import("bun");
const Output = bun.Output;
const logger = bun.logger;

const Dependency = bun.install.Dependency;
const DependencyID = bun.install.DependencyID;
const Npm = bun.install.Npm;
const PackageID = bun.install.PackageID;
const PackageManager = bun.install.PackageManager;
const Resolution = bun.install.Resolution;
const Task = bun.install.Task;
const invalid_package_id = bun.install.invalid_package_id;
