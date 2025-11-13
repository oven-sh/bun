const log = Output.scoped(.IsolatedInstall, .visible);

/// Runs on main thread
pub fn installIsolatedPackages(
    manager: *PackageManager,
    command_ctx: Command.Context,
    install_root_dependencies: bool,
    workspace_filters: []const WorkspaceFilter,
    packages_to_install: ?[]const PackageID,
) OOM!PackageInstall.Summary {
    bun.analytics.Features.isolated_bun_install += 1;

    const store: Store = try .create(
        manager,
        install_root_dependencies,
        workspace_filters,
        packages_to_install,
    );

    // setup node_modules/.bun
    const is_new_bun_modules = is_new_bun_modules: {
        const node_modules_path = bun.OSPathLiteral("node_modules");
        const bun_modules_path = bun.OSPathLiteral("node_modules/" ++ Store.modules_dir_name);

        sys.mkdirat(FD.cwd(), node_modules_path, 0o755).unwrap() catch {
            sys.mkdirat(FD.cwd(), bun_modules_path, 0o755).unwrap() catch {
                break :is_new_bun_modules false;
            };

            // 'node_modules' exists and 'node_modules/.bun' doesn't

            if (comptime Environment.isWindows) {
                // Windows:
                // 1. create 'node_modules/.old_modules-{hex}'
                // 2. for each entry in 'node_modules' rename into 'node_modules/.old_modules-{hex}'
                // 3. for each workspace 'node_modules' rename into 'node_modules/.old_modules-{hex}/old_{basename}_modules'

                var rename_path: bun.AutoRelPath = .init();
                defer rename_path.deinit();

                {
                    var mkdir_path: bun.RelPath(.{ .sep = .auto, .unit = .u16 }) = .from("node_modules");
                    defer mkdir_path.deinit();

                    mkdir_path.appendFmt(".old_modules-{s}", .{&std.fmt.bytesToHex(std.mem.asBytes(&bun.fastRandom()), .lower)});
                    rename_path.append(mkdir_path.slice());

                    // 1
                    sys.mkdirat(FD.cwd(), mkdir_path.sliceZ(), 0o755).unwrap() catch {
                        break :is_new_bun_modules true;
                    };
                }

                const node_modules = bun.openDirForIteration(FD.cwd(), "node_modules").unwrap() catch {
                    break :is_new_bun_modules true;
                };

                var entry_path: bun.AutoRelPath = .from("node_modules");
                defer entry_path.deinit();

                // 2
                var node_modules_iter = bun.DirIterator.iterate(node_modules, .u8);
                while (node_modules_iter.next().unwrap() catch break :is_new_bun_modules true) |entry| {
                    if (bun.strings.startsWithChar(entry.name.slice(), '.')) {
                        continue;
                    }

                    var entry_path_save = entry_path.save();
                    defer entry_path_save.restore();

                    entry_path.append(entry.name.slice());

                    var rename_path_save = rename_path.save();
                    defer rename_path_save.restore();

                    rename_path.append(entry.name.slice());

                    sys.renameat(FD.cwd(), entry_path.sliceZ(), FD.cwd(), rename_path.sliceZ()).unwrap() catch {};
                }

                // 3
                for (lockfile.workspace_paths.values()) |workspace_path| {
                    var workspace_node_modules: bun.AutoRelPath = .from(workspace_path.slice(lockfile.buffers.string_bytes.items));
                    defer workspace_node_modules.deinit();

                    const basename = workspace_node_modules.basename();

                    workspace_node_modules.append("node_modules");

                    var rename_path_save = rename_path.save();
                    defer rename_path_save.restore();

                    rename_path.appendFmt(".old_{s}_modules", .{basename});

                    sys.renameat(FD.cwd(), workspace_node_modules.sliceZ(), FD.cwd(), rename_path.sliceZ()).unwrap() catch {};
                }
            } else {

                // Posix:
                // 1. rename existing 'node_modules' to temp location
                // 2. create new 'node_modules' directory
                // 3. rename temp into 'node_modules/.old_modules-{hex}'
                // 4. attempt renaming 'node_modules/.old_modules-{hex}/.cache' to 'node_modules/.cache'
                // 5. rename each workspace 'node_modules' into 'node_modules/.old_modules-{hex}/old_{basename}_modules'
                var temp_node_modules_buf: bun.PathBuffer = undefined;
                const temp_node_modules = bun.fs.FileSystem.tmpname("tmp_modules", &temp_node_modules_buf, bun.fastRandom()) catch unreachable;

                // 1
                sys.renameat(FD.cwd(), "node_modules", FD.cwd(), temp_node_modules).unwrap() catch {
                    break :is_new_bun_modules true;
                };

                // 2
                sys.mkdirat(FD.cwd(), node_modules_path, 0o755).unwrap() catch |err| {
                    Output.err(err, "failed to create './node_modules'", .{});
                    Global.exit(1);
                };

                sys.mkdirat(FD.cwd(), bun_modules_path, 0o755).unwrap() catch |err| {
                    Output.err(err, "failed to create './node_modules/.bun'", .{});
                    Global.exit(1);
                };

                var rename_path: bun.AutoRelPath = .from("node_modules");
                defer rename_path.deinit();

                rename_path.appendFmt(".old_modules-{s}", .{&std.fmt.bytesToHex(std.mem.asBytes(&bun.fastRandom()), .lower)});

                // 3
                sys.renameat(FD.cwd(), temp_node_modules, FD.cwd(), rename_path.sliceZ()).unwrap() catch {
                    break :is_new_bun_modules true;
                };

                rename_path.append(".cache");

                var cache_path: bun.AutoRelPath = .from("node_modules");
                defer cache_path.deinit();

                cache_path.append(".cache");

                // 4
                sys.renameat(FD.cwd(), rename_path.sliceZ(), FD.cwd(), cache_path.sliceZ()).unwrap() catch {};

                // remove .cache so we can append destination for each workspace
                rename_path.undo(1);

                // 5
                for (lockfile.workspace_paths.values()) |workspace_path| {
                    var workspace_node_modules: bun.AutoRelPath = .from(workspace_path.slice(lockfile.buffers.string_bytes.items));
                    defer workspace_node_modules.deinit();

                    const basename = workspace_node_modules.basename();

                    workspace_node_modules.append("node_modules");

                    var rename_path_save = rename_path.save();
                    defer rename_path_save.restore();

                    rename_path.appendFmt(".old_{s}_modules", .{basename});

                    sys.renameat(FD.cwd(), workspace_node_modules.sliceZ(), FD.cwd(), rename_path.sliceZ()).unwrap() catch {};
                }
            }

            break :is_new_bun_modules true;
        };

        sys.mkdirat(FD.cwd(), bun_modules_path, 0o755).unwrap() catch |err| {
            Output.err(err, "failed to create './node_modules/.bun'", .{});
            Global.exit(1);
        };

        break :is_new_bun_modules true;
    };

    {
        var root_node: *Progress.Node = undefined;
        var download_node: Progress.Node = undefined;
        var install_node: Progress.Node = undefined;
        var scripts_node: Progress.Node = undefined;
        var progress = &manager.progress;

        if (manager.options.log_level.showProgress()) {
            progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
            root_node = progress.start("", 0);
            download_node = root_node.start(ProgressStrings.download(), 0);
            install_node = root_node.start(ProgressStrings.install(), store.entries.len);
            scripts_node = root_node.start(ProgressStrings.script(), 0);

            manager.downloads_node = null;
            manager.scripts_node = &scripts_node;
            manager.downloads_node = &download_node;
        }

        const nodes_slice = store.nodes.slice();
        const node_pkg_ids = nodes_slice.items(.pkg_id);
        const node_dep_ids = nodes_slice.items(.dep_id);

        const entries = store.entries.slice();
        const entry_node_ids = entries.items(.node_id);
        const entry_steps = entries.items(.step);
        const entry_dependencies = entries.items(.dependencies);
        const entry_hoisted = entries.items(.hoisted);

        const lockfile = manager.lockfile;
        const string_buf = lockfile.buffers.string_bytes.items;

        const pkgs = lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        const pkg_name_hashes = pkgs.items(.name_hash);
        const pkg_resolutions = pkgs.items(.resolution);

        var seen_entry_ids: std.AutoHashMapUnmanaged(Store.Entry.Id, void) = .empty;
        defer seen_entry_ids.deinit(lockfile.allocator);
        try seen_entry_ids.ensureTotalCapacity(lockfile.allocator, @intCast(store.entries.len));

        // TODO: delete
        var seen_workspace_ids: std.AutoHashMapUnmanaged(PackageID, void) = .empty;
        defer seen_workspace_ids.deinit(lockfile.allocator);

        const tasks = try manager.allocator.alloc(Store.Installer.Task, store.entries.len);
        defer manager.allocator.free(tasks);

        var installer: Store.Installer = .{
            .lockfile = lockfile,
            .manager = manager,
            .command_ctx = command_ctx,
            .installed = try .initEmpty(manager.allocator, lockfile.packages.len),
            .install_node = if (manager.options.log_level.showProgress()) &install_node else null,
            .scripts_node = if (manager.options.log_level.showProgress()) &scripts_node else null,
            .store = &store,
            .tasks = tasks,
            .trusted_dependencies_mutex = .{},
            .trusted_dependencies_from_update_requests = manager.findTrustedDependenciesFromUpdateRequests(),
            .supported_backend = .init(PackageInstall.supported_method),
            .active_tasks = if (comptime Environment.ci_assert) try manager.allocator.alloc(std.atomic.Value(bool), store.entries.len) else {},
            .is_new_bun_modules = is_new_bun_modules,
        };

        if (comptime Environment.ci_assert) {
            @memset(installer.active_tasks, .init(false));
        }

        for (tasks, 0..) |*task, _entry_id| {
            const entry_id: Store.Entry.Id = .from(@intCast(_entry_id));
            task.* = .{
                .entry_id = entry_id,
                .installer = &installer,
                .result = .none,

                .task = .{ .callback = &Store.Installer.Task.callback },
                .next = null,
            };
        }

        // add the pending task count upfront
        manager.incrementPendingTasks(@intCast(store.entries.len));
        for (0..store.entries.len) |_entry_id| {
            const entry_id: Store.Entry.Id = .from(@intCast(_entry_id));

            const node_id = entry_node_ids[entry_id.get()];
            const pkg_id = node_pkg_ids[node_id.get()];
            const dep_id = node_dep_ids[node_id.get()];

            const pkg_name = pkg_names[pkg_id];
            const pkg_name_hash = pkg_name_hashes[pkg_id];
            const pkg_res: Resolution = pkg_resolutions[pkg_id];

            switch (pkg_res.tag) {
                else => {
                    // this is `uninitialized` or `single_file_module`.
                    bun.debugAssert(false);
                    // .monotonic is okay because the task isn't running on another thread.
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.onTaskComplete(entry_id, .skipped);
                    continue;
                },
                .root => {
                    if (dep_id == invalid_dependency_id) {
                        // .monotonic is okay in this block because the task isn't running on another
                        // thread.
                        entry_steps[entry_id.get()].store(.symlink_dependencies, .monotonic);
                    } else {
                        // dep_id is valid meaning this was a dependency that resolved to the root
                        // package. it gets an entry in the store.
                    }
                    installer.startTask(entry_id);
                    continue;
                },
                .workspace => {
                    // .monotonic is okay in this block because the task isn't running on another
                    // thread.

                    // if injected=true this might be false
                    if (!(try seen_workspace_ids.getOrPut(lockfile.allocator, pkg_id)).found_existing) {
                        entry_steps[entry_id.get()].store(.symlink_dependencies, .monotonic);
                        installer.startTask(entry_id);
                        continue;
                    }
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.onTaskComplete(entry_id, .skipped);
                    continue;
                },
                .symlink => {
                    // no installation required, will only need to be linked to packages that depend on it.
                    bun.debugAssert(entry_dependencies[entry_id.get()].list.items.len == 0);
                    // .monotonic is okay because the task isn't running on another thread.
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.onTaskComplete(entry_id, .skipped);
                    continue;
                },
                .folder => {
                    // folders are always hardlinked to keep them up-to-date
                    installer.startTask(entry_id);
                    continue;
                },

                inline .npm,
                .git,
                .github,
                .local_tarball,
                .remote_tarball,
                => |pkg_res_tag| {
                    const patch_info = try installer.packagePatchInfo(pkg_name, pkg_name_hash, &pkg_res);

                    const needs_install =
                        manager.options.enable.force_install or
                        is_new_bun_modules or
                        patch_info == .remove or
                        needs_install: {
                            var store_path: bun.AbsPath(.{}) = .initTopLevelDir();
                            defer store_path.deinit();
                            installer.appendStorePath(&store_path, entry_id);
                            const scope_for_patch_tag_path = store_path.save();
                            if (pkg_res_tag == .npm)
                                // if it's from npm, it should always have a package.json.
                                // in other cases, probably yes but i'm less confident.
                                store_path.append("package.json");
                            const exists = sys.existsZ(store_path.sliceZ());

                            break :needs_install switch (patch_info) {
                                .none => !exists,
                                // checked above
                                .remove => unreachable,
                                .patch => |patch| {
                                    var hash_buf: install.BuntagHashBuf = undefined;
                                    const hash = install.buntaghashbuf_make(&hash_buf, patch.contents_hash);
                                    scope_for_patch_tag_path.restore();
                                    store_path.append(hash);
                                    break :needs_install !sys.existsZ(store_path.sliceZ());
                                },
                            };
                        };

                    if (!needs_install) {
                        if (entry_hoisted[entry_id.get()]) {
                            installer.linkToHiddenNodeModules(entry_id);
                        }
                        // .monotonic is okay because the task isn't running on another thread.
                        entry_steps[entry_id.get()].store(.done, .monotonic);
                        installer.onTaskComplete(entry_id, .skipped);
                        continue;
                    }

                    var pkg_cache_dir_subpath: bun.RelPath(.{ .sep = .auto }) = .from(switch (pkg_res_tag) {
                        .npm => manager.cachedNPMPackageFolderName(pkg_name.slice(string_buf), pkg_res.value.npm.version, patch_info.contentsHash()),
                        .git => manager.cachedGitFolderName(&pkg_res.value.git, patch_info.contentsHash()),
                        .github => manager.cachedGitHubFolderName(&pkg_res.value.github, patch_info.contentsHash()),
                        .local_tarball => manager.cachedTarballFolderName(pkg_res.value.local_tarball, patch_info.contentsHash()),
                        .remote_tarball => manager.cachedTarballFolderName(pkg_res.value.remote_tarball, patch_info.contentsHash()),

                        else => comptime unreachable,
                    });
                    defer pkg_cache_dir_subpath.deinit();

                    const cache_dir, const cache_dir_path = manager.getCacheDirectoryAndAbsPath();
                    defer cache_dir_path.deinit();

                    const missing_from_cache = switch (manager.getPreinstallState(pkg_id)) {
                        .done => false,
                        else => missing_from_cache: {
                            if (patch_info == .none) {
                                const exists = switch (pkg_res_tag) {
                                    .npm => exists: {
                                        var cache_dir_path_save = pkg_cache_dir_subpath.save();
                                        defer cache_dir_path_save.restore();
                                        pkg_cache_dir_subpath.append("package.json");
                                        break :exists sys.existsAt(cache_dir, pkg_cache_dir_subpath.sliceZ());
                                    },
                                    else => sys.directoryExistsAt(cache_dir, pkg_cache_dir_subpath.sliceZ()).unwrapOr(false),
                                };
                                if (exists) {
                                    manager.setPreinstallState(pkg_id, installer.lockfile, .done);
                                }
                                break :missing_from_cache !exists;
                            }

                            // TODO: why does this look like it will never work?
                            break :missing_from_cache true;
                        },
                    };

                    if (!missing_from_cache) {
                        if (patch_info == .patch) {
                            var patch_log: bun.logger.Log = .init(manager.allocator);
                            installer.applyPackagePatch(entry_id, patch_info.patch, &patch_log);
                            if (patch_log.hasErrors()) {
                                // monotonic is okay because we haven't started the task yet (it isn't running
                                // on another thread)
                                entry_steps[entry_id.get()].store(.done, .monotonic);
                                installer.onTaskFail(entry_id, .{ .patching = patch_log });
                                continue;
                            }
                        }
                        installer.startTask(entry_id);
                        continue;
                    }

                    const ctx: install.TaskCallbackContext = .{
                        .isolated_package_install_context = entry_id,
                    };

                    const dep = lockfile.buffers.dependencies.items[dep_id];

                    switch (pkg_res_tag) {
                        .npm => {
                            manager.enqueuePackageForDownload(
                                pkg_name.slice(string_buf),
                                dep_id,
                                pkg_id,
                                pkg_res.value.npm.version,
                                pkg_res.value.npm.url.slice(string_buf),
                                ctx,
                                patch_info.nameAndVersionHash(),
                            ) catch |err| switch (err) {
                                error.OutOfMemory => |oom| return oom,
                                error.InvalidURL => {
                                    Output.err(err, "failed to enqueue package for download: {s}@{f}", .{
                                        pkg_name.slice(string_buf),
                                        pkg_res.fmt(string_buf, .auto),
                                    });
                                    Output.flush();
                                    if (manager.options.enable.fail_early) {
                                        Global.exit(1);
                                    }
                                    // .monotonic is okay because an error means the task isn't
                                    // running on another thread.
                                    entry_steps[entry_id.get()].store(.done, .monotonic);
                                    installer.onTaskComplete(entry_id, .fail);
                                    continue;
                                },
                            };
                        },
                        .git => {
                            manager.enqueueGitForCheckout(
                                dep_id,
                                dep.name.slice(string_buf),
                                &pkg_res,
                                ctx,
                                patch_info.nameAndVersionHash(),
                            );
                        },
                        .github => {
                            const url = manager.allocGitHubURL(&pkg_res.value.git);
                            defer manager.allocator.free(url);
                            manager.enqueueTarballForDownload(
                                dep_id,
                                pkg_id,
                                url,
                                ctx,
                                patch_info.nameAndVersionHash(),
                            ) catch |err| switch (err) {
                                error.OutOfMemory => bun.outOfMemory(),
                                error.InvalidURL => {
                                    Output.err(err, "failed to enqueue github package for download: {s}@{f}", .{
                                        pkg_name.slice(string_buf),
                                        pkg_res.fmt(string_buf, .auto),
                                    });
                                    Output.flush();
                                    if (manager.options.enable.fail_early) {
                                        Global.exit(1);
                                    }
                                    // .monotonic is okay because an error means the task isn't
                                    // running on another thread.
                                    entry_steps[entry_id.get()].store(.done, .monotonic);
                                    installer.onTaskComplete(entry_id, .fail);
                                    continue;
                                },
                            };
                        },
                        .local_tarball => {
                            manager.enqueueTarballForReading(
                                dep_id,
                                dep.name.slice(string_buf),
                                &pkg_res,
                                ctx,
                            );
                        },
                        .remote_tarball => {
                            manager.enqueueTarballForDownload(
                                dep_id,
                                pkg_id,
                                pkg_res.value.remote_tarball.slice(string_buf),
                                ctx,
                                patch_info.nameAndVersionHash(),
                            ) catch |err| switch (err) {
                                error.OutOfMemory => bun.outOfMemory(),
                                error.InvalidURL => {
                                    Output.err(err, "failed to enqueue tarball for download: {s}@{f}", .{
                                        pkg_name.slice(string_buf),
                                        pkg_res.fmt(string_buf, .auto),
                                    });
                                    Output.flush();
                                    if (manager.options.enable.fail_early) {
                                        Global.exit(1);
                                    }
                                    // .monotonic is okay because an error means the task isn't
                                    // running on another thread.
                                    entry_steps[entry_id.get()].store(.done, .monotonic);
                                    installer.onTaskComplete(entry_id, .fail);
                                    continue;
                                },
                            };
                        },
                        else => comptime unreachable,
                    }
                },
            }
        }

        const Wait = struct {
            installer: *Store.Installer,
            err: ?anyerror = null,

            pub fn isDone(wait: *@This()) bool {
                const pkg_manager = wait.installer.manager;
                pkg_manager.runTasks(
                    *Store.Installer,
                    wait.installer,
                    .{
                        .onExtract = Store.Installer.onPackageExtracted,
                        .onResolve = {},
                        .onPackageManifestError = {},
                        .onPackageDownloadError = {},
                    },
                    true,
                    pkg_manager.options.log_level,
                ) catch |err| {
                    wait.err = err;
                    return true;
                };

                if (pkg_manager.scripts_node) |node| {
                    // if we're just waiting for scripts, make it known.

                    // .monotonic is okay because this is just used for progress; we don't rely on
                    // any side effects from completed tasks.
                    const pending_lifecycle_scripts = pkg_manager.pending_lifecycle_script_tasks.load(.monotonic);
                    // `+ 1` because the root task needs to wait for everything
                    if (pending_lifecycle_scripts > 0 and pkg_manager.pendingTaskCount() <= pending_lifecycle_scripts + 1) {
                        node.activate();
                        pkg_manager.progress.refresh();
                    }
                }

                return pkg_manager.pendingTaskCount() == 0;
            }
        };

        if (manager.pendingTaskCount() > 0) {
            var wait = Wait{ .installer = &installer };
            manager.sleepUntil(&wait, &Wait.isDone);

            if (wait.err) |err| {
                Output.err(err, "failed to install packages", .{});
                Global.exit(1);
            }
        }

        if (manager.options.log_level.showProgress()) {
            progress.root.end();
            progress.* = .{};
        }

        if (comptime Environment.ci_assert) {
            var done = true;
            next_entry: for (store.entries.items(.step), 0..) |entry_step, _entry_id| {
                const entry_id: Store.Entry.Id = .from(@intCast(_entry_id));
                // .monotonic is okay because `Wait.isDone` should have already synchronized with
                // the completed task threads, via popping from the `UnboundedQueue` in `runTasks`,
                // and the .acquire load `pendingTaskCount`.
                const step = entry_step.load(.monotonic);

                if (step == .done) {
                    continue;
                }

                done = false;

                log("entry not done: {d}, {s}\n", .{ entry_id, @tagName(step) });

                const deps = store.entries.items(.dependencies)[entry_id.get()];
                for (deps.slice()) |dep| {
                    // .monotonic is okay because `Wait.isDone` already synchronized with the tasks.
                    const dep_step = entry_steps[dep.entry_id.get()].load(.monotonic);
                    if (dep_step != .done) {
                        log(", parents:\n - ", .{});
                        const parent_ids = Store.Entry.debugGatherAllParents(entry_id, installer.store);
                        for (parent_ids) |parent_id| {
                            if (parent_id == .root) {
                                log("root ", .{});
                            } else {
                                log("{d} ", .{parent_id.get()});
                            }
                        }

                        log("\n", .{});
                        continue :next_entry;
                    }
                }

                log(" and is able to run\n", .{});
            }

            bun.debugAssert(done);
        }

        installer.summary.successfully_installed = installer.installed;

        return installer.summary;
    }
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const Global = bun.Global;
const OOM = bun.OOM;
const Output = bun.Output;
const Progress = bun.Progress;
const sys = bun.sys;
const Command = bun.cli.Command;

const install = bun.install;
const PackageID = install.PackageID;
const PackageInstall = install.PackageInstall;
const Resolution = install.Resolution;
const Store = install.Store;

const PackageManager = install.PackageManager;
const ProgressStrings = PackageManager.ProgressStrings;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
