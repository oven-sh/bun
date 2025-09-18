const StartManifestTaskError = bun.OOM || error{InvalidURL};
fn startManifestTask(manager: *PackageManager, pkg_name: []const u8, dep: *const Dependency) StartManifestTaskError!void {
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
    try task.forManifest(pkg_name, manager.allocator, manager.scopeForPackageName(pkg_name), null, dep.behavior.optional);
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
            for (0..pkgs.len) |_pkg_id| {
                const pkg_id: PackageID = @intCast(_pkg_id);

                const dep_id = resolutions[pkg_id];
                if (dep_id >= dependencies.len) {
                    continue;
                }

                const dep = &dependencies[dep_id];
                const resolved_version = lockfile.resolveCatalogDependency(dep) orelse {
                    // catalog doesn't exist in the map, skip because nothing to resolve
                    continue;
                };
                if (resolved_version.tag != .npm and resolved_version.tag != .dist_tag) {
                    continue;
                }
                const res = pkg_resolutions[pkg_id];
                if (res.tag != .npm) {
                    continue;
                }

                const pkg_name = pkg_names[pkg_id].slice(string_buf);

                _ = manager.manifests.byName(
                    manager,
                    manager.scopeForPackageName(pkg_name),
                    pkg_name,
                    .load_from_memory_fallback_to_disk,
                ) orelse {
                    try startManifestTask(manager, pkg_name, dep);
                };

                manager.flushNetworkQueue();
                _ = manager.scheduleTasks();

                if (manager.pendingTaskCount() > 0) {
                    try manager.runTasks(
                        *PackageManager,
                        manager,
                        .{
                            .onExtract = {},
                            .onResolve = {},
                            .onPackageManifestError = {},
                            .onPackageDownloadError = {},
                            .progress_bar = true,
                            .manifests_only = true,
                        },
                        true,
                        log_level,
                    );
                }
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

                    const resolved_version = lockfile.resolveCatalogDependency(dep) orelse continue;
                    if (resolved_version.tag != .npm and resolved_version.tag != .dist_tag) continue;
                    const resolution: Resolution = pkg_resolutions[pkg_id];
                    if (resolution.tag != .npm) continue;

                    const package_name = pkg_names[pkg_id].slice(string_buf);
                    _ = manager.manifests.byName(
                        manager,
                        manager.scopeForPackageName(package_name),
                        package_name,
                        .load_from_memory_fallback_to_disk,
                    ) orelse {
                        try startManifestTask(manager, package_name, dep);
                    };
                }

                manager.flushNetworkQueue();
                _ = manager.scheduleTasks();

                if (manager.pendingTaskCount() > 1) {
                    try manager.runTasks(
                        *PackageManager,
                        manager,
                        .{
                            .onExtract = {},
                            .onResolve = {},
                            .onPackageManifestError = {},
                            .onPackageDownloadError = {},
                            .progress_bar = true,
                            .manifests_only = true,
                        },
                        true,
                        log_level,
                    );
                }
            }
        },
    }

    manager.flushNetworkQueue();
    _ = manager.scheduleTasks();

    const RunClosure = struct {
        manager: *PackageManager,
        err: ?anyerror = null,
        pub fn isDone(closure: *@This()) bool {
            if (closure.manager.pendingTaskCount() > 0) {
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
            }

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

const std = @import("std");
const bun = @import("bun");

const Output = bun.Output;

const PackageManager = bun.install.PackageManager;
const PackageID = bun.install.PackageID;
const invalid_package_id = bun.install.invalid_package_id;
const Resolution = bun.install.Resolution;
const Dependency = bun.install.Dependency;
const Task = bun.install.Task;
