pub fn installHoistedPackages(
    this: *PackageManager,
    ctx: Command.Context,
    workspace_filters: []const WorkspaceFilter,
    install_root_dependencies: bool,
    log_level: PackageManager.Options.LogLevel,
    packages_to_install: ?[]const PackageID,
) !PackageInstall.Summary {
    bun.analytics.Features.hoisted_bun_install += 1;

    const original_trees = this.lockfile.buffers.trees;
    const original_tree_dep_ids = this.lockfile.buffers.hoisted_dependencies;

    try this.lockfile.filter(this.log, this, install_root_dependencies, workspace_filters, packages_to_install);

    defer {
        this.lockfile.buffers.trees = original_trees;
        this.lockfile.buffers.hoisted_dependencies = original_tree_dep_ids;
    }

    var root_node: *Progress.Node = undefined;
    var download_node: Progress.Node = undefined;
    var install_node: Progress.Node = undefined;
    var scripts_node: Progress.Node = undefined;
    const options = &this.options;
    var progress = &this.progress;

    if (log_level.showProgress()) {
        progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
        root_node = progress.start("", 0);
        download_node = root_node.start(ProgressStrings.download(), 0);

        install_node = root_node.start(ProgressStrings.install(), this.lockfile.buffers.hoisted_dependencies.items.len);
        scripts_node = root_node.start(ProgressStrings.script(), 0);
        this.downloads_node = &download_node;
        this.scripts_node = &scripts_node;
    }

    defer {
        if (log_level.showProgress()) {
            progress.root.end();
            progress.* = .{};
        }
    }

    // If there was already a valid lockfile and so we did not resolve, i.e. there was zero network activity
    // the packages could still not be in the cache dir
    // this would be a common scenario in a CI environment
    // or if you just cloned a repo
    // we want to check lazily though
    // no need to download packages you've already installed!!
    var new_node_modules = false;
    const cwd = bun.FD.cwd();
    const node_modules_folder = brk: {
        // Attempt to open the existing node_modules folder
        switch (bun.sys.openatOSPath(cwd, bun.OSPathLiteral("node_modules"), bun.O.DIRECTORY | bun.O.RDONLY, 0o755)) {
            .result => |fd| break :brk std.fs.Dir{ .fd = fd.cast() },
            .err => {},
        }

        new_node_modules = true;

        // Attempt to create a new node_modules folder
        if (bun.sys.mkdir("node_modules", 0o755).asErr()) |err| {
            if (err.errno != @intFromEnum(bun.sys.E.EXIST)) {
                Output.err(err, "could not create the <b>\"node_modules\"<r> directory", .{});
                Global.crash();
            }
        }
        break :brk bun.openDir(cwd.stdDir(), "node_modules") catch |err| {
            Output.err(err, "could not open the <b>\"node_modules\"<r> directory", .{});
            Global.crash();
        };
    };

    var skip_delete = new_node_modules;
    var skip_verify_installed_version_number = new_node_modules;

    if (options.enable.force_install) {
        skip_verify_installed_version_number = true;
        skip_delete = false;
    }

    // Remove stale packages from workspace `node_modules` directories.
    // A previous install (especially a package-local one) may have placed packages
    // inside `packages/<workspace>/node_modules` that the current hoisted layout
    // no longer expects. Those directories would shadow hoisted copies during
    // module resolution. The installer only visits trees that still have
    // dependencies, so stale entries are otherwise never deleted.
    //
    // We build the expected set from `original_trees` (pre-filter) on purpose:
    // with `--filter`, the filtered tree omits excluded workspaces entirely,
    // but their node_modules still belong to them and must not be touched
    // based on what the _current_ install would re-create.
    if (this.lockfile.workspace_paths.count() > 0) {
        pruneStaleWorkspaceNodeModules(this, original_trees.items, original_tree_dep_ids.items) catch {};
    }

    var summary = PackageInstall.Summary{};

    {
        var iterator = Lockfile.Tree.Iterator(.node_modules).init(this.lockfile);
        if (comptime Environment.isPosix) {
            Bin.Linker.ensureUmask();
        }
        var installer: PackageInstaller = brk: {
            const completed_trees, const tree_ids_to_trees_the_id_depends_on = trees: {
                const trees = this.lockfile.buffers.trees.items;
                const completed_trees = try Bitset.initEmpty(this.allocator, trees.len);
                var tree_ids_to_trees_the_id_depends_on = try Bitset.List.initEmpty(this.allocator, trees.len, trees.len);

                {
                    // For each tree id, traverse through it's parents and mark all visited tree
                    // ids as dependents for the current tree parent
                    var deps = try Bitset.initEmpty(this.allocator, trees.len);
                    defer deps.deinit(this.allocator);
                    for (trees) |_curr| {
                        var curr = _curr;
                        tree_ids_to_trees_the_id_depends_on.set(curr.id, curr.id);

                        while (curr.parent != Lockfile.Tree.invalid_id) {
                            deps.set(curr.id);
                            tree_ids_to_trees_the_id_depends_on.setUnion(curr.parent, deps);
                            curr = trees[curr.parent];
                        }

                        deps.setAll(false);
                    }
                }

                if (comptime Environment.allow_assert) {
                    if (trees.len > 0) {
                        // last tree should only depend on one other
                        bun.assertWithLocation(tree_ids_to_trees_the_id_depends_on.at(trees.len - 1).count() == 1, @src());
                        // and it should be itself
                        bun.assertWithLocation(tree_ids_to_trees_the_id_depends_on.at(trees.len - 1).isSet(trees.len - 1), @src());

                        // root tree should always depend on all trees
                        bun.assertWithLocation(tree_ids_to_trees_the_id_depends_on.at(0).count() == trees.len, @src());
                    }

                    // a tree should always depend on itself
                    for (0..trees.len) |j| {
                        bun.assertWithLocation(tree_ids_to_trees_the_id_depends_on.at(j).isSet(j), @src());
                    }
                }

                break :trees .{
                    completed_trees,
                    tree_ids_to_trees_the_id_depends_on,
                };
            };

            // These slices potentially get resized during iteration
            // so we want to make sure they're not accessible to the rest of this function
            // to make mistakes harder
            var parts = this.lockfile.packages.slice();

            break :brk PackageInstaller{
                .manager = this,
                .options = &this.options,
                .metas = parts.items(.meta),
                .bins = parts.items(.bin),
                .root_node_modules_folder = node_modules_folder,
                .names = parts.items(.name),
                .pkg_name_hashes = parts.items(.name_hash),
                .resolutions = parts.items(.resolution),
                .pkg_dependencies = parts.items(.dependencies),
                .lockfile = this.lockfile,
                .node = &install_node,
                .node_modules = .{
                    .path = std.array_list.Managed(u8).fromOwnedSlice(
                        this.allocator,
                        try this.allocator.dupe(
                            u8,
                            strings.withoutTrailingSlash(FileSystem.instance.top_level_dir),
                        ),
                    ),
                    .tree_id = 0,
                },
                .progress = progress,
                .skip_verify_installed_version_number = skip_verify_installed_version_number,
                .skip_delete = skip_delete,
                .summary = &summary,
                .force_install = options.enable.force_install,
                .successfully_installed = try Bitset.initEmpty(
                    this.allocator,
                    this.lockfile.packages.len,
                ),
                .command_ctx = ctx,
                .tree_ids_to_trees_the_id_depends_on = tree_ids_to_trees_the_id_depends_on,
                .completed_trees = completed_trees,
                .trees = trees: {
                    const trees = bun.handleOom(this.allocator.alloc(TreeContext, this.lockfile.buffers.trees.items.len));
                    for (0..this.lockfile.buffers.trees.items.len) |i| {
                        trees[i] = .{
                            .binaries = Bin.PriorityQueue.init(this.allocator, .{
                                .dependencies = &this.lockfile.buffers.dependencies,
                                .string_buf = &this.lockfile.buffers.string_bytes,
                            }),
                        };
                    }
                    break :trees trees;
                },
                .trusted_dependencies_from_update_requests = this.findTrustedDependenciesFromUpdateRequests(),
                .seen_bin_links = bun.StringHashMap(void).init(this.allocator),
            };
        };

        try installer.node_modules.path.append(std.fs.path.sep);

        defer installer.deinit();

        while (iterator.next(&installer.completed_trees)) |node_modules| {
            installer.node_modules.path.items.len = strings.withoutTrailingSlash(FileSystem.instance.top_level_dir).len + 1;
            try installer.node_modules.path.appendSlice(node_modules.relative_path);
            installer.node_modules.tree_id = node_modules.tree_id;
            var remaining = node_modules.dependencies;
            installer.current_tree_id = node_modules.tree_id;

            // cache line is 64 bytes on ARM64 and x64
            // PackageIDs are 4 bytes
            // Hence, we can fit up to 64 / 4 = 16 package IDs in a cache line
            const unroll_count = comptime 64 / @sizeOf(PackageID);

            while (remaining.len > unroll_count) {
                comptime var i: usize = 0;
                inline while (i < unroll_count) : (i += 1) {
                    installer.installPackage(remaining[i], log_level);
                }
                remaining = remaining[unroll_count..];

                // We want to minimize how often we call this function
                // That's part of why we unroll this loop
                if (this.pendingTaskCount() > 0) {
                    try this.runTasks(
                        *PackageInstaller,
                        &installer,
                        .{
                            .onExtract = PackageInstaller.installEnqueuedPackagesAfterExtraction,
                            .onResolve = {},
                            .onPackageManifestError = {},
                            .onPackageDownloadError = {},
                        },
                        true,
                        log_level,
                    );
                    if (!installer.options.do.install_packages) return error.InstallFailed;
                }
                this.tickLifecycleScripts();
                this.reportSlowLifecycleScripts();
            }

            for (remaining) |dependency_id| {
                installer.installPackage(dependency_id, log_level);
            }

            try this.runTasks(
                *PackageInstaller,
                &installer,
                .{
                    .onExtract = PackageInstaller.installEnqueuedPackagesAfterExtraction,
                    .onResolve = {},
                    .onPackageManifestError = {},
                    .onPackageDownloadError = {},
                },
                true,
                log_level,
            );
            if (!installer.options.do.install_packages) return error.InstallFailed;

            this.tickLifecycleScripts();
            this.reportSlowLifecycleScripts();
        }

        while (this.pendingTaskCount() > 0 and installer.options.do.install_packages) {
            const Closure = struct {
                installer: *PackageInstaller,
                err: ?anyerror = null,
                manager: *PackageManager,

                pub fn isDone(closure: *@This()) bool {
                    const pm = closure.manager;
                    closure.manager.runTasks(
                        *PackageInstaller,
                        closure.installer,
                        .{
                            .onExtract = PackageInstaller.installEnqueuedPackagesAfterExtraction,
                            .onResolve = {},
                            .onPackageManifestError = {},
                            .onPackageDownloadError = {},
                        },
                        true,
                        pm.options.log_level,
                    ) catch |err| {
                        closure.err = err;
                    };

                    if (closure.err != null) {
                        return true;
                    }

                    closure.manager.reportSlowLifecycleScripts();

                    if (PackageManager.verbose_install and closure.manager.pendingTaskCount() > 0) {
                        const pending_task_count = closure.manager.pendingTaskCount();
                        if (pending_task_count > 0 and PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) {
                            Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} tasks\n", .{pending_task_count});
                        }
                    }

                    return closure.manager.pendingTaskCount() == 0 and closure.manager.hasNoMorePendingLifecycleScripts();
                }
            };

            var closure = Closure{
                .installer = &installer,
                .manager = this,
            };

            // Whenever the event loop wakes up, we need to call `runTasks`
            // If we call sleep() instead of sleepUntil(), it will wait forever until there are no more lifecycle scripts
            // which means it will not call runTasks until _all_ current lifecycle scripts have finished running
            this.sleepUntil(&closure, &Closure.isDone);

            if (closure.err) |err| {
                return err;
            }
        } else {
            this.tickLifecycleScripts();
            this.reportSlowLifecycleScripts();
        }

        for (installer.trees) |tree| {
            if (comptime Environment.allow_assert) {
                bun.assert(tree.pending_installs.items.len == 0);
            }
            const force = true;
            installer.installAvailablePackages(log_level, force);
        }

        // .monotonic is okay because this value is only accessed on this thread.
        this.finished_installing.store(true, .monotonic);
        if (log_level.showProgress()) {
            scripts_node.activate();
        }

        if (!installer.options.do.install_packages) return error.InstallFailed;

        summary.successfully_installed = installer.successfully_installed;

        // need to make sure bins are linked before completing any remaining scripts.
        // this can happen if a package fails to download
        installer.linkRemainingBins(log_level);
        installer.completeRemainingScripts(log_level);

        // .monotonic is okay because this value is only accessed on this thread.
        while (this.pending_lifecycle_script_tasks.load(.monotonic) > 0) {
            this.reportSlowLifecycleScripts();

            this.sleep();
        }

        if (log_level.showProgress()) {
            scripts_node.end();
        }
    }

    return summary;
}

/// Walks each workspace's `node_modules/` directory on disk and deletes any
/// package folder the current hoisted tree does not list as belonging there.
///
/// Motivates: a previous package-local install (or a manual edit) may have left
/// `packages/<workspace>/node_modules/<pkg>` behind. When the current install
/// hoists `<pkg>` to the root, the leftover workspace-local copy shadows the
/// hoisted one during module resolution. The tree iterator only visits
/// `node_modules` directories that still contain entries, so those stale
/// folders are otherwise never seen, let alone removed.
///
/// Only operates on top-level entries of each workspace's `node_modules/`
/// (plus one level into `@scope/` directories). Transitive `node_modules`
/// nested inside surviving packages are handled by the normal install
/// verify/uninstall path.
///
/// `trees` and `tree_dep_ids` are the **unfiltered** tree buffers captured
/// before `Lockfile.filter()` runs. Using the unfiltered layout matters: with
/// `bun install --filter <subset>`, the filtered tree omits excluded
/// workspaces, but those workspaces' node_modules still belong to them and we
/// must only remove entries that are genuinely not placed anywhere by the
/// lockfile — not everything the current install happens to skip.
fn pruneStaleWorkspaceNodeModules(
    this: *PackageManager,
    trees: []const Lockfile.Tree,
    tree_dep_ids: []const install.DependencyID,
) !void {
    if (trees.len == 0) return;

    const lockfile = this.lockfile;
    const string_buf = lockfile.buffers.string_bytes.items;
    const deps = lockfile.buffers.dependencies.items;
    const resolutions = lockfile.buffers.resolutions.items;
    const pkg_resolutions = lockfile.packages.items(.resolution);

    var arena = std.heap.ArenaAllocator.init(this.allocator);
    defer arena.deinit();
    const scratch = arena.allocator();

    // Build a lookup from workspace package id → filesystem-relative path of
    // the workspace. We need this because a tree whose `dependency_id` points
    // to a workspace dep represents that workspace's `node_modules`, but the
    // tree's iterator path uses the dependency's **package name**
    // (`node_modules/@repro/backend/node_modules`) whereas on disk the
    // workspace lives at its filesystem path (`packages/backend/node_modules`).
    var workspace_fs_path_by_pkg_id = std.AutoHashMap(PackageID, []const u8).init(scratch);
    {
        const workspace_hashes = lockfile.workspace_paths.keys();
        const workspace_paths = lockfile.workspace_paths.values();
        for (workspace_hashes, workspace_paths) |name_hash, ws_path| {
            const pkg_id = lockfile.getWorkspacePackageID(name_hash);
            if (pkg_id == 0) continue; // getWorkspacePackageID returns 0 when not found.
            const fs_path = ws_path.slice(string_buf);
            if (fs_path.len == 0) continue;
            try workspace_fs_path_by_pkg_id.put(pkg_id, fs_path);
        }
    }

    if (workspace_fs_path_by_pkg_id.count() == 0) return;

    // Map of workspace filesystem-relative `node_modules` path (posix
    // separators) to the set of folder names the tree places directly in that
    // directory. Only workspace-scope trees are indexed — transitive nested
    // trees aren't workspace node_modules we need to prune.
    var expected_by_ws_path = bun.StringArrayHashMap(bun.StringHashMap(void)).init(scratch);

    for (trees) |tree| {
        // Only trees whose `dependency_id` resolves to a workspace package
        // correspond to a workspace's `node_modules` directory.
        if (tree.dependency_id == install.invalid_dependency_id) continue;
        if (tree.dependency_id == Lockfile.Tree.root_dep_id) continue;
        if (tree.dependency_id >= deps.len) continue;
        if (tree.dependency_id >= resolutions.len) continue;

        const pkg_id = resolutions[tree.dependency_id];
        if (pkg_id >= pkg_resolutions.len) continue;
        if (pkg_resolutions[pkg_id].tag != .workspace) continue;

        const ws_fs_path = workspace_fs_path_by_pkg_id.get(pkg_id) orelse continue;

        const key = try workspaceNodeModulesKey(scratch, ws_fs_path);

        const gop = try expected_by_ws_path.getOrPut(key);
        if (!gop.found_existing) {
            gop.value_ptr.* = bun.StringHashMap(void).init(scratch);
        }

        const tree_deps = tree.dependencies.get(tree_dep_ids);
        for (tree_deps) |dep_id| {
            if (dep_id >= deps.len) continue;
            const dep_name = deps[dep_id].name.slice(string_buf);
            if (dep_name.len == 0) continue;
            try gop.value_ptr.put(try scratch.dupe(u8, dep_name), {});
        }
    }

    // For each workspace, walk its node_modules and drop any entry that the
    // tree layout doesn't place there. A workspace with no tree entry in the
    // lockfile (no deps anywhere in the layout) still gets walked — empty
    // expected set means every non-dotfile entry is stale, which matches the
    // reported bug: a leftover workspace-local package after everything
    // hoisted out.
    const workspace_paths = lockfile.workspace_paths.values();
    for (workspace_paths) |ws_path_str| {
        const ws_path = ws_path_str.slice(string_buf);
        if (ws_path.len == 0) continue;

        const key = try workspaceNodeModulesKey(scratch, ws_path);
        const expected: ?*const bun.StringHashMap(void) = if (expected_by_ws_path.getPtr(key)) |p| p else null;

        pruneNodeModulesAt(key, expected) catch continue;
    }
}

/// Builds the normalized `<ws_path>/node_modules` key used both to index the
/// expected-set map and to look it up during the walk. Must be the single
/// source of truth for that string so the two call sites cannot silently
/// diverge — a mismatch would route pruning through the `expected == null`
/// branch and `deleteTree` legitimate entries.
fn workspaceNodeModulesKey(allocator: std.mem.Allocator, ws_path: []const u8) ![]u8 {
    // Tolerate a stray trailing slash (either separator) from unusual lockfile
    // sources, then append `/node_modules`.
    var trimmed = ws_path;
    if (trimmed.len > 0 and (trimmed[trimmed.len - 1] == '/' or trimmed[trimmed.len - 1] == '\\')) {
        trimmed = trimmed[0 .. trimmed.len - 1];
    }
    const key = try std.fmt.allocPrint(allocator, "{s}/node_modules", .{trimmed});
    // The on-disk walk uses the returned string as-is, so on Windows we
    // normalize any backslash separators that snuck in to forward slashes — the
    // kernel accepts either, but the hash lookup needs a canonical form.
    if (comptime Environment.isWindows) {
        bun.path.dangerouslyConvertPathToPosixInPlace(u8, key);
    }
    return key;
}

/// Opens `<cwd>/<rel_path>` and removes each top-level directory entry whose
/// name is not present in `expected`. Also descends one level into `@scope/`
/// directories so scoped packages are handled. Missing directories are
/// ignored — nothing to prune.
fn pruneNodeModulesAt(
    rel_path: []const u8,
    expected: ?*const bun.StringHashMap(void),
) !void {
    const cwd = bun.FD.cwd();

    var dir = switch (bun.openDirForIteration(cwd, rel_path)) {
        .result => |fd| fd,
        .err => return,
    };
    defer dir.close();

    var iter = bun.DirIterator.iterate(dir, .u8);
    while (iter.next().unwrap() catch return) |entry| {
        const name = entry.name.slice();
        if (name.len == 0) continue;
        // Skip hidden / metadata entries (`.bin`, `.cache`, `.modules.yaml`, etc.)
        if (name[0] == '.') continue;

        if (name[0] == '@') {
            // Scoped package directory. Recurse one level to look at `@scope/<pkg>`
            // entries; the expected set stores them as `@scope/pkg`.
            pruneScopedNodeModules(dir, name, expected) catch continue;
            continue;
        }

        if (expected) |exp| {
            if (exp.contains(name)) continue;
        }

        // Not expected — delete.
        dir.deleteTree(name) catch {};
    }
}

fn pruneScopedNodeModules(
    parent_dir: bun.FD,
    scope: []const u8,
    expected: ?*const bun.StringHashMap(void),
) !void {
    var scope_dir = switch (bun.openDirForIteration(parent_dir, scope)) {
        .result => |fd| fd,
        .err => return,
    };
    defer scope_dir.close();

    var has_remaining: bool = false;
    var iter = bun.DirIterator.iterate(scope_dir, .u8);
    while (iter.next().unwrap() catch return) |entry| {
        const name = entry.name.slice();
        if (name.len == 0) continue;
        if (name[0] == '.') {
            has_remaining = true;
            continue;
        }

        var full_name_buf: bun.PathBuffer = undefined;
        @memcpy(full_name_buf[0..scope.len], scope);
        full_name_buf[scope.len] = '/';
        @memcpy(full_name_buf[scope.len + 1 ..][0..name.len], name);
        const full_name = full_name_buf[0 .. scope.len + 1 + name.len];

        if (expected) |exp| {
            if (exp.contains(full_name)) {
                has_remaining = true;
                continue;
            }
        }

        scope_dir.deleteTree(name) catch {
            has_remaining = true;
        };
    }

    // If the scope directory ended up empty, remove it so it doesn't linger.
    if (!has_remaining) {
        var scope_z_buf: bun.PathBuffer = undefined;
        @memcpy(scope_z_buf[0..scope.len], scope);
        scope_z_buf[scope.len] = 0;
        const scope_z = scope_z_buf[0..scope.len :0];
        _ = bun.sys.rmdirat(parent_dir, scope_z);
    }
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const Progress = bun.Progress;
const strings = bun.strings;
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const Command = bun.cli.Command;
const FileSystem = bun.fs.FileSystem;

const install = bun.install;
const Bin = install.Bin;
const Lockfile = install.Lockfile;
const PackageID = install.PackageID;
const PackageInstall = install.PackageInstall;

const PackageManager = install.PackageManager;
const ProgressStrings = PackageManager.ProgressStrings;
const WorkspaceFilter = PackageManager.WorkspaceFilter;

const PackageInstaller = PackageManager.PackageInstaller;
const TreeContext = PackageInstaller.TreeContext;
