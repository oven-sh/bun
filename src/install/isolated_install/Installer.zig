pub const Installer = struct {
    trusted_dependencies_mutex: Mutex,
    // this is not const for `lockfile.trusted_dependencies`
    lockfile: *Lockfile,

    summary: PackageInstall.Summary = .{ .successfully_installed = .empty },
    installed: Bitset,
    install_node: ?*Progress.Node,
    scripts_node: ?*Progress.Node,
    is_new_bun_modules: bool,

    manager: *PackageManager,
    command_ctx: Command.Context,

    store: *const Store,

    task_queue: bun.UnboundedQueue(Task, .next) = .{},
    tasks: []Task,

    supported_backend: std.atomic.Value(PackageInstall.Method),

    trusted_dependencies_from_update_requests: std.AutoArrayHashMapUnmanaged(TruncatedPackageNameHash, void),

    /// Absolute path to the global virtual store (`<cache_dir>/links`). When
    /// non-null, npm/git/tarball entries are materialized once into this
    /// directory and `node_modules/.bun/<storepath>` becomes a symlink into
    /// it, so warm installs are O(packages) symlinks instead of O(files)
    /// clonefile work.
    global_store_path: ?[:0]const u8,

    /// Per-process suffix for staging global-store entries. Each entry is
    /// built under `<cache>/links/<storepath>-<hash>.tmp-<this>/` (package
    /// files, dep symlinks, bin links — all relative within the entry, so
    /// they resolve identically after the rename) and renamed into place as
    /// the final step. The directory existing at its final path is the only
    /// completeness signal the warm-hit check needs.
    global_store_tmp_suffix: u64,

    pub fn deinit(this: *Installer) void {
        this.trusted_dependencies_from_update_requests.deinit(this.lockfile.allocator);
    }

    /// Called from main thread
    pub fn startTask(this: *Installer, entry_id: Store.Entry.Id) void {
        const task = &this.tasks[entry_id.get()];
        bun.debugAssert(switch (task.result) {
            // first time starting the task
            .none => true,
            // the task returned to the main thread because it was blocked
            .blocked => true,
            // the task returned to the main thread to spawn some scripts
            .run_scripts => true,
            else => false,
        });

        task.result = .none;
        this.manager.thread_pool.schedule(.from(&task.task));
    }

    pub fn onPackageExtracted(this: *Installer, task_id: install.Task.Id) void {
        if (this.manager.task_queue.fetchRemove(task_id)) |removed| {
            const store = this.store;

            const node_pkg_ids = store.nodes.items(.pkg_id);

            const entries = store.entries.slice();
            const entry_steps = entries.items(.step);
            const entry_node_ids = entries.items(.node_id);

            const pkgs = this.lockfile.packages.slice();
            const pkg_names = pkgs.items(.name);
            const pkg_name_hashes = pkgs.items(.name_hash);
            const pkg_resolutions = pkgs.items(.resolution);

            for (removed.value.items) |install_ctx| {
                const entry_id = install_ctx.isolated_package_install_context;

                const node_id = entry_node_ids[entry_id.get()];
                const pkg_id = node_pkg_ids[node_id.get()];
                const pkg_name = pkg_names[pkg_id];
                const pkg_name_hash = pkg_name_hashes[pkg_id];
                const pkg_res = &pkg_resolutions[pkg_id];

                const patch_info = bun.handleOom(this.packagePatchInfo(pkg_name, pkg_name_hash, pkg_res));

                if (patch_info == .patch) {
                    var log: bun.logger.Log = .init(this.manager.allocator);
                    this.applyPackagePatch(entry_id, patch_info.patch, &log);
                    if (log.hasErrors()) {
                        // monotonic is okay because we haven't started the task yet (it isn't running
                        // on another thread)
                        entry_steps[entry_id.get()].store(.done, .monotonic);
                        this.onTaskFail(entry_id, .{ .patching = log });
                        continue;
                    }
                }

                this.startTask(entry_id);
            }
        }
    }

    /// Called from main thread when a tarball download or extraction fails.
    /// Without this, the upfront pending-task slot for each waiting entry is
    /// never released and the install loop blocks forever on
    /// `pendingTaskCount() == 0`.
    pub fn onPackageDownloadError(
        this: *Installer,
        task_id: install.Task.Id,
        name: []const u8,
        resolution: *const Resolution,
        err: anyerror,
        url: []const u8,
    ) void {
        if (this.manager.task_queue.fetchRemove(task_id)) |removed| {
            var callbacks = removed.value;
            defer callbacks.deinit(this.manager.allocator);

            const entry_steps = this.store.entries.items(.step);
            for (callbacks.items) |install_ctx| {
                const entry_id = install_ctx.isolated_package_install_context;
                entry_steps[entry_id.get()].store(.done, .monotonic);
                this.onTaskFail(entry_id, .{ .download = .{
                    .err = err,
                    .url = url,
                } });
            }
        } else {
            // No waiting entry — still surface the error so it isn't lost.
            const string_buf = this.lockfile.buffers.string_bytes.items;
            Output.errGeneric("failed to download <b>{s}@{f}<r>: {s}\n  <d>{s}<r>", .{
                name,
                resolution.fmt(string_buf, .auto),
                downloadErrorReason(err),
                url,
            });
            Output.flush();
        }
    }

    fn downloadErrorReason(e: anyerror) []const u8 {
        return switch (e) {
            error.TarballHTTP400 => "400 Bad Request",
            error.TarballHTTP401 => "401 Unauthorized",
            error.TarballHTTP402 => "402 Payment Required",
            error.TarballHTTP403 => "403 Forbidden",
            error.TarballHTTP404 => "404 Not Found",
            error.TarballHTTP4xx => "HTTP 4xx",
            error.TarballHTTP5xx => "HTTP 5xx",
            error.TarballFailedToExtract => "failed to extract",
            error.TarballFailedToDownload => "download failed",
            else => @errorName(e),
        };
    }

    pub fn applyPackagePatch(this: *Installer, entry_id: Store.Entry.Id, patch: PatchInfo.Patch, log: *bun.logger.Log) void {
        const store = this.store;
        const entry_node_ids = store.entries.items(.node_id);
        const node_id = entry_node_ids[entry_id.get()];
        const node_pkg_ids = store.nodes.items(.pkg_id);
        const pkg_id = node_pkg_ids[node_id.get()];
        const patch_task = install.PatchTask.newApplyPatchHash(
            this.manager,
            pkg_id,
            patch.contents_hash,
            patch.name_and_version_hash,
        );
        defer patch_task.deinit();
        bun.handleOom(patch_task.apply());

        if (patch_task.callback.apply.logger.hasErrors()) {
            bun.handleOom(patch_task.callback.apply.logger.cloneToWithRecycled(log, true));
        }
    }

    /// Called from main thread
    pub fn onTaskFail(this: *Installer, entry_id: Store.Entry.Id, err: Task.Error) void {
        const string_buf = this.lockfile.buffers.string_bytes.items;

        const entries = this.store.entries.slice();
        const entry_node_ids = entries.items(.node_id);

        const nodes = this.store.nodes.slice();
        const node_pkg_ids = nodes.items(.pkg_id);

        const pkgs = this.lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        const pkg_resolutions = pkgs.items(.resolution);

        const node_id = entry_node_ids[entry_id.get()];
        const pkg_id = node_pkg_ids[node_id.get()];

        const pkg_name = pkg_names[pkg_id];
        const pkg_res = pkg_resolutions[pkg_id];

        switch (err) {
            .link_package => |link_err| {
                Output.err(link_err, "failed to link package: {s}@{f}", .{
                    pkg_name.slice(string_buf),
                    pkg_res.fmt(string_buf, .auto),
                });
            },
            .symlink_dependencies => |symlink_err| {
                Output.err(symlink_err, "failed to symlink dependencies for package: {s}@{f}", .{
                    pkg_name.slice(string_buf),
                    pkg_res.fmt(string_buf, .auto),
                });
            },
            .patching => |patch_log| {
                Output.errGeneric("failed to patch package: {s}@{f}", .{
                    pkg_name.slice(string_buf),
                    pkg_res.fmt(string_buf, .auto),
                });
                patch_log.print(Output.errorWriter()) catch {};
            },
            .binaries => |bin_err| {
                Output.err(bin_err, "failed to link binaries for package: {s}@{f}", .{
                    pkg_name.slice(string_buf),
                    pkg_res.fmt(string_buf, .auto),
                });
            },
            .download => |dl| {
                Output.errGeneric("failed to download <b>{s}@{f}<r>: {s}\n  <d>{s}<r>", .{
                    pkg_name.slice(string_buf),
                    pkg_res.fmt(string_buf, .auto),
                    downloadErrorReason(dl.err),
                    dl.url,
                });
            },
            else => {},
        }
        Output.flush();

        // Clean up the staging directory so a half-built global-store entry
        // doesn't leak in the cache (it would never be reused — the suffix is
        // random — but it's wasted disk).
        if (this.entryUsesGlobalStore(entry_id)) {
            var staging: bun.AbsPath(.{ .sep = .auto }) = .init();
            defer staging.deinit();
            this.appendGlobalStoreEntryPath(&staging, entry_id, .staging);
            FD.cwd().deleteTree(staging.slice()) catch {};
        }

        // attempt deleting the package so the next install will install it again
        switch (pkg_res.tag) {
            .uninitialized,
            .single_file_module,
            .root,
            .workspace,
            .symlink,
            => {},

            _ => {},

            // to be safe make sure we only delete packages in the store
            .npm,
            .git,
            .github,
            .local_tarball,
            .remote_tarball,
            .folder,
            => {
                var store_path: bun.RelPath(.{ .sep = .auto }) = .init();
                defer store_path.deinit();

                store_path.appendFmt("node_modules/{f}", .{
                    Store.Entry.fmtStorePath(entry_id, this.store, this.lockfile),
                });

                _ = sys.unlink(store_path.sliceZ());
            },
        }

        if (this.manager.options.enable.fail_early) {
            Global.exit(1);
        }

        this.summary.fail += 1;

        this.decrementPendingTasks();
        this.resumeUnblockedTasks();
    }

    pub fn decrementPendingTasks(this: *Installer) void {
        this.manager.decrementPendingTasks();
    }

    /// Called from main thread
    pub fn onTaskBlocked(this: *Installer, entry_id: Store.Entry.Id) void {
        // race condition (fixed now): task decides it is blocked because one of its dependencies
        // has not finished. before the task can mark itself as blocked, the dependency finishes its
        // install, causing the task to never finish because resumeUnblockedTasks is called before
        // its state is set to blocked.
        //
        // fix: check if the task is unblocked after the task returns blocked, and only set/unset
        // blocked from the main thread.

        var parent_dedupe: std.AutoArrayHashMap(Store.Entry.Id, void) = .init(bun.default_allocator);
        defer parent_dedupe.deinit();

        if (!this.isTaskBlocked(entry_id, &parent_dedupe)) {
            // .monotonic is okay because the task isn't running right now.
            this.store.entries.items(.step)[entry_id.get()].store(.symlink_dependency_binaries, .monotonic);
            this.startTask(entry_id);
            return;
        }

        // .monotonic is okay because the task isn't running right now.
        this.store.entries.items(.step)[entry_id.get()].store(.blocked, .monotonic);
    }

    /// Called from both the main thread (via `onTaskBlocked` and `resumeUnblockedTasks`) and the
    /// task thread (via `run`). `parent_dedupe` should not be shared between threads.
    fn isTaskBlocked(this: *Installer, entry_id: Store.Entry.Id, parent_dedupe: *std.AutoArrayHashMap(Store.Entry.Id, void)) bool {
        const entries = this.store.entries.slice();
        const entry_deps = entries.items(.dependencies);
        const entry_steps = entries.items(.step);

        const deps = entry_deps[entry_id.get()];
        for (deps.slice()) |dep| {
            if (entry_steps[dep.entry_id.get()].load(.acquire) != .done) {
                parent_dedupe.clearRetainingCapacity();
                if (this.store.isCycle(entry_id, dep.entry_id, parent_dedupe)) {
                    continue;
                }
                return true;
            }
        }
        return false;
    }

    /// Called from main thread
    pub fn onTaskComplete(this: *Installer, entry_id: Store.Entry.Id, state: enum { success, skipped, fail }) void {
        if (comptime Environment.ci_assert) {
            // .monotonic is okay because we should have already synchronized with the completed
            // task thread by virtue of popping from the `UnboundedQueue`.
            bun.assertWithLocation(this.store.entries.items(.step)[entry_id.get()].load(.monotonic) == .done, @src());
        }

        this.decrementPendingTasks();
        this.resumeUnblockedTasks();

        if (this.install_node) |node| {
            node.completeOne();
        }

        const nodes = this.store.nodes.slice();

        const node_id, const real_state = state: {
            if (entry_id == .root) {
                break :state .{ .root, .skipped };
            }

            const node_id = this.store.entries.items(.node_id)[entry_id.get()];
            const dep_id = nodes.items(.dep_id)[node_id.get()];

            if (dep_id == invalid_dependency_id) {
                // should be coverd by `entry_id == .root` above, but
                // just in case
                break :state .{ .root, .skipped };
            }

            const dep = this.lockfile.buffers.dependencies.items[dep_id];

            if (dep.behavior.isWorkspace()) {
                break :state .{ node_id, .skipped };
            }

            break :state .{ node_id, state };
        };

        switch (real_state) {
            .success => {
                this.summary.success += 1;
            },
            .skipped => {
                this.summary.skipped += 1;
                return;
            },
            .fail => {
                this.summary.fail += 1;
                return;
            },
        }

        const pkg_id = nodes.items(.pkg_id)[node_id.get()];

        const is_duplicate = this.installed.isSet(pkg_id);
        this.summary.success += @intFromBool(!is_duplicate);
        this.installed.set(pkg_id);
    }

    // This function runs only on the main thread. The installer tasks threads
    // will be changing values in `entry_step`, but the blocked state is only
    // set on the main thread, allowing the code between
    // `entry_steps[entry_id.get()].load(.monotonic)`
    // and
    // `entry_steps[entry_id.get()].store(.symlink_dependency_binaries, .monotonic)`
    pub fn resumeUnblockedTasks(this: *Installer) void {
        const entries = this.store.entries.slice();
        const entry_steps = entries.items(.step);

        var parent_dedupe: std.AutoArrayHashMap(Store.Entry.Id, void) = .init(bun.default_allocator);
        defer parent_dedupe.deinit();

        for (0..this.store.entries.len) |id_int| {
            const entry_id: Store.Entry.Id = .from(@intCast(id_int));

            // .monotonic is okay because only the main thread sets this to `.blocked`.
            const entry_step = entry_steps[entry_id.get()].load(.monotonic);
            if (entry_step != .blocked) {
                continue;
            }

            if (this.isTaskBlocked(entry_id, &parent_dedupe)) {
                continue;
            }

            // .monotonic is okay because the task isn't running right now.
            entry_steps[entry_id.get()].store(.symlink_dependency_binaries, .monotonic);
            this.startTask(entry_id);
        }
    }

    pub const Task = struct {
        entry_id: Store.Entry.Id,
        installer: *Installer,

        task: ThreadPool.Task,
        next: ?*Task,

        result: Result,

        const Result = union(enum) {
            none,
            err: Error,
            blocked,
            run_scripts: *Package.Scripts.List,
            done,
        };

        const Error = union(enum) {
            link_package: sys.Error,
            symlink_dependencies: sys.Error,
            run_scripts: anyerror,
            binaries: anyerror,
            patching: bun.logger.Log,
            download: struct { err: anyerror, url: []const u8 },

            pub fn clone(this: *const Error, allocator: std.mem.Allocator) Error {
                return switch (this.*) {
                    .link_package => |err| .{ .link_package = err.clone(allocator) },
                    .symlink_dependencies => |err| .{ .symlink_dependencies = err.clone(allocator) },
                    .binaries => |err| .{ .binaries = err },
                    .run_scripts => |err| .{ .run_scripts = err },
                    .patching => |log| .{ .patching = log },
                    .download => |dl| .{ .download = dl },
                };
            }
        };

        pub const Step = enum(u8) {
            link_package,
            symlink_dependencies,

            check_if_blocked,

            // blocked can only happen here

            symlink_dependency_binaries,
            run_preinstall,

            // pause here while preinstall runs

            binaries,
            @"run (post)install and (pre/post)prepare",

            // pause again while remaining scripts run.

            done,

            // only the main thread sets blocked, and only the main thread
            // sets a blocked task to symlink_dependency_binaries
            blocked,
        };

        /// Called from task thread
        fn nextStep(this: *Task, comptime current_step: Step) Step {
            const next_step: Step = switch (comptime current_step) {
                .link_package => .symlink_dependencies,
                .symlink_dependencies => .check_if_blocked,
                .check_if_blocked => .symlink_dependency_binaries,
                .symlink_dependency_binaries => .run_preinstall,
                .run_preinstall => .binaries,
                .binaries => .@"run (post)install and (pre/post)prepare",
                .@"run (post)install and (pre/post)prepare" => .done,

                .done,
                .blocked,
                => @compileError("unexpected step"),
            };

            this.installer.store.entries.items(.step)[this.entry_id.get()].store(next_step, .release);

            return next_step;
        }

        const Yield = union(enum) {
            yield,
            run_scripts: *Package.Scripts.List,
            done,
            blocked,
            fail: Error,

            pub fn failure(e: Error) Yield {
                // clone here in case a path is kept in a buffer that
                // will be freed at the end of the current scope.
                return .{ .fail = e.clone(bun.default_allocator) };
            }
        };

        /// Called from task thread
        fn run(this: *Task) OOM!Yield {
            const installer = this.installer;
            const manager = installer.manager;
            const lockfile = installer.lockfile;

            const pkgs = installer.lockfile.packages.slice();
            const pkg_names = pkgs.items(.name);
            const pkg_name_hashes = pkgs.items(.name_hash);
            const pkg_resolutions = pkgs.items(.resolution);
            const pkg_resolutions_lists = pkgs.items(.resolutions);
            const pkg_metas: []const Lockfile.Package.Meta = pkgs.items(.meta);
            const pkg_bins = pkgs.items(.bin);
            const pkg_script_lists = pkgs.items(.scripts);

            const entries = installer.store.entries.slice();
            const entry_node_ids = entries.items(.node_id);
            const entry_dependencies = entries.items(.dependencies);
            const entry_steps = entries.items(.step);
            const entry_scripts = entries.items(.scripts);
            const entry_hoisted = entries.items(.hoisted);

            const nodes = installer.store.nodes.slice();
            const node_pkg_ids = nodes.items(.pkg_id);
            const node_dep_ids = nodes.items(.dep_id);

            const node_id = entry_node_ids[this.entry_id.get()];
            const pkg_id = node_pkg_ids[node_id.get()];
            const dep_id = node_dep_ids[node_id.get()];

            const pkg_name = pkg_names[pkg_id];
            const pkg_name_hash = pkg_name_hashes[pkg_id];
            const pkg_res = pkg_resolutions[pkg_id];

            return next_step: switch (entry_steps[this.entry_id.get()].load(.acquire)) {
                inline .link_package => |current_step| {
                    const string_buf = lockfile.buffers.string_bytes.items;

                    var pkg_cache_dir_subpath: bun.AutoRelPath = .from(switch (pkg_res.tag) {
                        else => |tag| pkg_cache_dir_subpath: {
                            const patch_info = try installer.packagePatchInfo(
                                pkg_name,
                                pkg_name_hash,
                                &pkg_res,
                            );

                            break :pkg_cache_dir_subpath switch (tag) {
                                .npm => manager.cachedNPMPackageFolderName(pkg_name.slice(string_buf), pkg_res.value.npm.version, patch_info.contentsHash()),
                                .git => manager.cachedGitFolderName(&pkg_res.value.git, patch_info.contentsHash()),
                                .github => manager.cachedGitHubFolderName(&pkg_res.value.github, patch_info.contentsHash()),
                                .local_tarball => manager.cachedTarballFolderName(pkg_res.value.local_tarball, patch_info.contentsHash()),
                                .remote_tarball => manager.cachedTarballFolderName(pkg_res.value.remote_tarball, patch_info.contentsHash()),

                                else => {
                                    if (comptime Environment.ci_assert) {
                                        bun.assertWithLocation(false, @src());
                                    }

                                    continue :next_step this.nextStep(current_step);
                                },
                            };
                        },

                        .folder, .root => {
                            const path = switch (pkg_res.tag) {
                                .folder => pkg_res.value.folder.slice(string_buf),
                                .root => ".",
                                else => unreachable,
                            };
                            // the folder does not exist in the cache. xdev is per folder dependency
                            const folder_dir = switch (bun.openDirForIteration(FD.cwd(), path)) {
                                .result => |fd| fd,
                                .err => |err| return .failure(.{ .link_package = err }),
                            };
                            defer folder_dir.close();

                            backend: switch (PackageInstall.Method.hardlink) {
                                .hardlink => {
                                    var src: bun.AbsPath(.{ .unit = .os, .sep = .auto }) = .initTopLevelDirLongPath();
                                    defer src.deinit();
                                    src.appendJoin(pkg_res.value.folder.slice(string_buf));

                                    var dest: bun.Path(.{ .unit = .os, .sep = .auto }) = .init();
                                    defer dest.deinit();

                                    installer.appendStorePath(&dest, this.entry_id);

                                    var hardlinker: Hardlinker = try .init(
                                        folder_dir,
                                        src,
                                        dest,
                                        &.{comptime bun.OSPathLiteral("node_modules")},
                                    );
                                    defer hardlinker.deinit();

                                    switch (try hardlinker.link()) {
                                        .result => {},
                                        .err => |err| {
                                            if (err.getErrno() == .XDEV) {
                                                continue :backend .copyfile;
                                            }

                                            if (PackageManager.verbose_install) {
                                                Output.prettyErrorln(
                                                    \\<red><b>error<r><d>:<r>Failed to hardlink package folder
                                                    \\{f}
                                                    \\<d>From: {f}<r>
                                                    \\<d>  To: {f}<r>
                                                    \\<r>
                                                ,
                                                    .{
                                                        err,
                                                        bun.fmt.fmtOSPath(src.slice(), .{ .path_sep = .auto }),
                                                        bun.fmt.fmtOSPath(dest.slice(), .{ .path_sep = .auto }),
                                                    },
                                                );
                                                Output.flush();
                                            }
                                            return .failure(.{ .link_package = err });
                                        },
                                    }
                                },

                                .copyfile => {
                                    var src_path: bun.AbsPath(.{ .sep = .auto, .unit = .os }) = .init();
                                    defer src_path.deinit();

                                    if (comptime Environment.isWindows) {
                                        const src_path_len = bun.windows.GetFinalPathNameByHandleW(
                                            folder_dir.cast(),
                                            src_path.buf().ptr,
                                            @intCast(src_path.buf().len),
                                            0,
                                        );

                                        if (src_path_len == 0 or src_path_len >= src_path.buf().len) {
                                            const err: bun.sys.SystemErrno = if (src_path_len == 0)
                                                (bun.windows.Win32Error.get().toSystemErrno() orelse .EUNKNOWN)
                                            else
                                                .ENAMETOOLONG;
                                            return .failure(
                                                .{ .link_package = .{ .errno = @intFromEnum(err), .syscall = .copyfile } },
                                            );
                                        }

                                        src_path.setLength(src_path_len);
                                    }

                                    var dest: bun.Path(.{ .unit = .os, .sep = .auto }) = .init();
                                    defer dest.deinit();
                                    installer.appendStorePath(&dest, this.entry_id);

                                    var file_copier: FileCopier = try .init(
                                        folder_dir,
                                        src_path,
                                        dest,
                                        &.{comptime bun.OSPathLiteral("node_modules")},
                                    );
                                    defer file_copier.deinit();

                                    switch (file_copier.copy()) {
                                        .result => {},
                                        .err => |err| {
                                            if (PackageManager.verbose_install) {
                                                Output.prettyErrorln(
                                                    \\<red><b>error<r><d>:<r>Failed to copy package
                                                    \\{f}
                                                    \\<d>From: {f}<r>
                                                    \\<d>  To: {f}<r>
                                                    \\<r>
                                                ,
                                                    .{
                                                        err,
                                                        bun.fmt.fmtOSPath(src_path.slice(), .{ .path_sep = .auto }),
                                                        bun.fmt.fmtOSPath(dest.slice(), .{ .path_sep = .auto }),
                                                    },
                                                );
                                                Output.flush();
                                            }
                                            return .failure(.{ .link_package = err });
                                        },
                                    }
                                },

                                else => unreachable,
                            }

                            continue :next_step this.nextStep(current_step);
                        },
                    });
                    defer pkg_cache_dir_subpath.deinit();

                    const cache_dir, const cache_dir_path = manager.getCacheDirectoryAndAbsPath();
                    defer cache_dir_path.deinit();

                    var dest_subpath: bun.Path(.{ .sep = .auto, .unit = .os }) = .init();
                    defer dest_subpath.deinit();
                    installer.appendRealStorePath(&dest_subpath, this.entry_id, .staging);

                    const uses_global_store = installer.entryUsesGlobalStore(this.entry_id);

                    if (!uses_global_store) {
                        // An entry can lose global-store eligibility between
                        // installs — newly patched, newly trusted, a dep that
                        // became a workspace package. The previous install
                        // left `node_modules/.bun/<storepath>` as a symlink
                        // (or junction) into the shared `<cache>/links/`
                        // directory. Writing the new project-local tree
                        // *through* that link would mutate the shared entry
                        // underneath every other consumer; on Windows the
                        // `.expect_missing` dep-symlink rewrite then bakes a
                        // project-absolute junction target into the shared
                        // directory, which dangles after the next
                        // `rm -rf node_modules`. Detach first so the build
                        // lands in a real project-local directory.
                        var local: bun.Path(.{ .sep = .auto }) = .initTopLevelDir();
                        defer local.deinit();
                        installer.appendLocalStoreEntryPath(&local, this.entry_id);
                        const is_stale_link = if (comptime Environment.isWindows)
                            if (sys.getFileAttributes(local.sliceZ())) |a| a.is_reparse_point else false
                        else if (sys.lstat(local.sliceZ()).asValue()) |st|
                            std.posix.S.ISLNK(@intCast(st.mode))
                        else
                            false;
                        if (is_stale_link) {
                            const remove_err: ?sys.Error = if (comptime Environment.isWindows) win: {
                                if (sys.rmdir(local.sliceZ()).asErr()) |_| {
                                    if (sys.unlink(local.sliceZ()).asErr()) |e| break :win e;
                                }
                                break :win null;
                            } else sys.unlink(local.sliceZ()).asErr();
                            if (remove_err) |e| if (e.getErrno() != .NOENT) {
                                // Do NOT proceed: the backend below would
                                // write *through* the still-live symlink
                                // into the shared `<cache>/links/` entry.
                                return .failure(.{ .link_package = e });
                            };
                        }
                    }

                    if (uses_global_store) {
                        // Clear any leftover staging directory from a crashed
                        // earlier run with the same suffix (vanishingly
                        // unlikely with a 64-bit random suffix, but cheap).
                        var staging: bun.AbsPath(.{ .sep = .auto }) = .init();
                        defer staging.deinit();
                        installer.appendGlobalStoreEntryPath(&staging, this.entry_id, .staging);
                        FD.cwd().deleteTree(staging.slice()) catch {};
                    }

                    var cached_package_dir: ?FD = null;
                    defer if (cached_package_dir) |dir| dir.close();

                    // .monotonic access of `supported_backend` is okay because it's an
                    // optimization. It's okay if another thread doesn't see an update to this
                    // value "in time".
                    backend: switch (installer.supported_backend.load(.monotonic)) {
                        .clonefile => {
                            if (comptime !Environment.isMac) {
                                installer.supported_backend.store(.hardlink, .monotonic);
                                continue :backend .hardlink;
                            }

                            if (installer.manager.options.log_level.isVerbose()) {
                                bun.Output.prettyErrorln(
                                    \\Cloning {f} to {f}
                                ,
                                    .{
                                        bun.fmt.fmtOSPath(pkg_cache_dir_subpath.sliceZ(), .{ .path_sep = .auto }),
                                        bun.fmt.fmtOSPath(dest_subpath.sliceZ(), .{ .path_sep = .auto }),
                                    },
                                );
                                bun.Output.flush();
                            }

                            var cloner: FileCloner = .{
                                .cache_dir = cache_dir,
                                .cache_dir_subpath = pkg_cache_dir_subpath,
                                .dest_subpath = dest_subpath,
                            };

                            switch (cloner.clone()) {
                                .result => {},
                                .err => |err| {
                                    switch (err.getErrno()) {
                                        .XDEV => {
                                            installer.supported_backend.store(.copyfile, .monotonic);
                                            continue :backend .copyfile;
                                        },
                                        .OPNOTSUPP => {
                                            installer.supported_backend.store(.hardlink, .monotonic);
                                            continue :backend .hardlink;
                                        },
                                        else => {
                                            return .failure(.{ .link_package = err });
                                        },
                                    }
                                },
                            }

                            continue :next_step this.nextStep(current_step);
                        },

                        .hardlink => {
                            cached_package_dir = switch (bun.openDirForIteration(cache_dir, pkg_cache_dir_subpath.slice())) {
                                .result => |fd| fd,
                                .err => |err| {
                                    if (PackageManager.verbose_install) {
                                        Output.prettyErrorln(
                                            "Failed to open cache directory for hardlink: {s}",
                                            .{
                                                pkg_cache_dir_subpath.slice(),
                                            },
                                        );
                                        Output.flush();
                                    }
                                    return .failure(.{ .link_package = err });
                                },
                            };

                            var src: bun.AbsPath(.{ .sep = .auto, .unit = .os }) = .fromLongPath(cache_dir_path.slice());
                            defer src.deinit();
                            src.appendJoin(pkg_cache_dir_subpath.slice());

                            var hardlinker: Hardlinker = try .init(
                                cached_package_dir.?,
                                src,
                                dest_subpath,
                                &.{},
                            );
                            defer hardlinker.deinit();

                            switch (try hardlinker.link()) {
                                .result => {},
                                .err => |err| {
                                    if (err.getErrno() == .XDEV) {
                                        installer.supported_backend.store(.copyfile, .monotonic);
                                        continue :backend .copyfile;
                                    }
                                    if (PackageManager.verbose_install) {
                                        Output.prettyErrorln(
                                            \\<red><b>error<r><d>:<r>Failed to hardlink package
                                            \\{f}
                                            \\<d>From: {s}<r>
                                            \\<d>  To: {f}<r>
                                            \\<r>
                                        ,
                                            .{
                                                err,
                                                pkg_cache_dir_subpath.slice(),
                                                bun.fmt.fmtOSPath(dest_subpath.slice(), .{ .path_sep = .auto }),
                                            },
                                        );
                                        Output.flush();
                                    }
                                    return .failure(.{ .link_package = err });
                                },
                            }

                            continue :next_step this.nextStep(current_step);
                        },

                        // fallthrough copyfile
                        else => {
                            cached_package_dir = switch (bun.openDirForIteration(cache_dir, pkg_cache_dir_subpath.slice())) {
                                .result => |fd| fd,
                                .err => |err| {
                                    if (PackageManager.verbose_install) {
                                        Output.prettyErrorln(
                                            \\<red><b>error<r><d>:<r>Failed to open cache directory for copyfile
                                            \\{f}
                                            \\<d>From: {s}<r>
                                            \\<d>  To: {f}<r>
                                            \\<r>
                                        ,
                                            .{
                                                err,
                                                pkg_cache_dir_subpath.slice(),
                                                bun.fmt.fmtOSPath(dest_subpath.slice(), .{ .path_sep = .auto }),
                                            },
                                        );
                                        Output.flush();
                                    }
                                    return .failure(.{ .link_package = err });
                                },
                            };

                            var src_path: bun.AbsPath(.{ .sep = .auto, .unit = .os }) = .from(cache_dir_path.slice());
                            defer src_path.deinit();
                            src_path.append(pkg_cache_dir_subpath.slice());

                            var file_copier: FileCopier = try .init(
                                cached_package_dir.?,
                                src_path,
                                dest_subpath,
                                &.{},
                            );
                            defer file_copier.deinit();

                            switch (file_copier.copy()) {
                                .result => {},
                                .err => |err| {
                                    if (PackageManager.verbose_install) {
                                        Output.prettyErrorln(
                                            \\<red><b>error<r><d>:<r>Failed to copy package
                                            \\{f}
                                            \\<d>From: {s}<r>
                                            \\<d>  To: {f}<r>
                                            \\<r>
                                        ,
                                            .{
                                                err,
                                                pkg_cache_dir_subpath.slice(),
                                                bun.fmt.fmtOSPath(dest_subpath.slice(), .{ .path_sep = .auto }),
                                            },
                                        );
                                        Output.flush();
                                    }
                                    return .failure(.{ .link_package = err });
                                },
                            }

                            continue :next_step this.nextStep(current_step);
                        },
                    }
                },
                inline .symlink_dependencies => |current_step| {
                    const string_buf = lockfile.buffers.string_bytes.items;
                    const dependencies = lockfile.buffers.dependencies.items;

                    // For a workspace entry whose declared `<workspace_path>`
                    // traverses a symlink, the string-built staging node_modules
                    // path resolves *physically* to a different directory than
                    // the stored string suggests. Resolve that directory's real
                    // path once so every dep symlink's relative target is
                    // anchored at the location where the symlink is actually
                    // written, not at the symlinked string path. If the path
                    // is already canonical, leave this null so the existing
                    // hot path runs with no extra syscalls.
                    var canonical_entry_node_modules: ?bun.AbsPath(.{ .sep = .auto }) = null;
                    defer if (canonical_entry_node_modules) |*p| p.deinit();
                    if (pkg_res.tag == .workspace) resolve_canonical: {
                        var workspace_abs: bun.AbsPath(.{ .sep = .auto }) = .initTopLevelDir();
                        defer workspace_abs.deinit();
                        workspace_abs.append(pkg_res.value.workspace.slice(string_buf));

                        const dir_fd = switch (bun.sys.open(workspace_abs.sliceZ(), bun.O.DIRECTORY | bun.O.RDONLY, 0)) {
                            .result => |fd| fd,
                            .err => break :resolve_canonical,
                        };
                        defer dir_fd.close();

                        var real_buf: bun.PathBuffer = undefined;
                        const real = switch (bun.sys.getFdPath(dir_fd, &real_buf)) {
                            .result => |r| r,
                            .err => break :resolve_canonical,
                        };

                        if (strings.eqlLong(real, workspace_abs.slice(), true)) {
                            break :resolve_canonical;
                        }

                        var canonical: bun.AbsPath(.{ .sep = .auto }) = .from(real);
                        canonical.append("node_modules");
                        canonical_entry_node_modules = canonical;
                    }

                    for (entry_dependencies[this.entry_id.get()].slice()) |dep| {
                        const dep_name = dependencies[dep.dep_id].name.slice(string_buf);

                        var dest: bun.Path(.{ .sep = .auto }) = .initTopLevelDir();
                        defer dest.deinit();

                        installer.appendRealStoreNodeModulesPath(&dest, this.entry_id, .staging);

                        dest.append(dep_name);

                        if (installer.entryStoreNodeModulesPackageName(dep_id, pkg_id, &pkg_res, pkg_names)) |entry_node_modules_name| {
                            if (strings.eqlLong(dep_name, entry_node_modules_name, true)) {
                                // nest the dependency in another node_modules if the name is the same as the entry name
                                // in the store node_modules to avoid collision
                                dest.append("node_modules");
                                dest.append(dep_name);
                            }
                        }

                        var dep_store_path: bun.AbsPath(.{ .sep = .auto }) = .initTopLevelDir();
                        defer dep_store_path.deinit();

                        // When this entry lives in the global virtual store, its
                        // dep symlinks must point at sibling *global* entries
                        // (relative `../../<dep>-<hash>/...`) so the entry stays
                        // valid for any project. Non-global parents (root,
                        // workspace) keep pointing at the project-local
                        // `.bun/<storepath>` indirection so `node_modules/<pkg>`
                        // remains a relative link into `node_modules/.bun/`.
                        if (installer.entryUsesGlobalStore(this.entry_id)) {
                            // The eligibility DFS + fixed-point pass guarantee
                            // every dep of a global entry is itself global; if
                            // that ever regressed the failure mode is a
                            // dangling symlink with no install-time error.
                            bun.debugAssert(installer.entryUsesGlobalStore(dep.entry_id));
                            // Target the dep's *final* path: the relative
                            // `../../<dep>/...` link is computed against our
                            // staging directory but resolves identically once
                            // we're renamed (same parent), and the dep will
                            // have been (or will be) renamed into that final
                            // path by its own task.
                            installer.appendRealStorePath(&dep_store_path, dep.entry_id, .final);
                        } else {
                            installer.appendStorePath(&dep_store_path, dep.entry_id);
                        }

                        const target = target: {
                            if (canonical_entry_node_modules) |*canonical| {
                                // Symlinked workspace directory: compute the
                                // link string relative to the physical dest
                                // parent so the stored target resolves from
                                // where the symlink lives on disk, not from
                                // the symlinked logical path (which is
                                // shallower in the tree). Append the same
                                // trailing segments as `dest` and then
                                // `undo(1)` so the from-base matches the
                                // symlink's real parent directory — critical
                                // for scoped names like `@scope/pkg`, whose
                                // parent is `<real_ws>/node_modules/@scope/`,
                                // one level deeper than `<real_ws>/node_modules`.
                                var save = canonical.save();
                                defer save.restore();

                                canonical.append(dep_name);
                                if (installer.entryStoreNodeModulesPackageName(dep_id, pkg_id, &pkg_res, pkg_names)) |entry_node_modules_name| {
                                    if (strings.eqlLong(dep_name, entry_node_modules_name, true)) {
                                        canonical.append("node_modules");
                                        canonical.append(dep_name);
                                    }
                                }
                                canonical.undo(1);
                                break :target canonical.relative(&dep_store_path);
                            }

                            var dest_save = dest.save();
                            defer dest_save.restore();

                            dest.undo(1);
                            break :target dest.relative(&dep_store_path);
                        };
                        defer target.deinit();

                        const symlinker: Symlinker = .{
                            .dest = dest,
                            .target = target,
                            .fallback_junction_target = dep_store_path,
                        };

                        const link_strategy: Symlinker.Strategy = if (pkg_res.tag == .root or pkg_res.tag == .workspace)
                            // root and workspace packages ensure their dependency symlinks
                            // exist unconditionally. To make sure it's fast, first readlink
                            // then create the symlink if necessary
                            .expect_existing
                        else
                            // Global-store entries are built under a private
                            // per-process staging directory, so nothing else
                            // is touching this path.
                            .expect_missing;

                        switch (symlinker.ensureSymlink(link_strategy)) {
                            .result => {},
                            .err => |err| {
                                return .failure(.{ .symlink_dependencies = err });
                            },
                        }
                    }

                    if (installer.entryUsesGlobalStore(this.entry_id)) {
                        // The entry now exists in the shared global virtual store.
                        // Project-local `node_modules/.bun/<storepath>` becomes a
                        // symlink into it so that the relative `../../<dep>` links
                        // created above (which live inside the global entry) remain
                        // reachable from the project's node_modules.
                        switch (installer.linkProjectToGlobalStore(this.entry_id)) {
                            .result => {},
                            .err => |err| {
                                return .failure(.{ .symlink_dependencies = err });
                            },
                        }
                    }

                    continue :next_step this.nextStep(current_step);
                },
                inline .check_if_blocked => |current_step| {
                    // preinstall scripts need to run before binaries can be linked. Block here if any dependencies
                    // of this entry are not finished. Do not count cycles towards blocking.

                    var parent_dedupe: std.AutoArrayHashMap(Store.Entry.Id, void) = .init(bun.default_allocator);
                    defer parent_dedupe.deinit();

                    if (installer.isTaskBlocked(this.entry_id, &parent_dedupe)) {
                        return .blocked;
                    }

                    continue :next_step this.nextStep(current_step);
                },
                inline .symlink_dependency_binaries => |current_step| {
                    installer.linkDependencyBins(this.entry_id) catch |err| {
                        return .failure(.{ .binaries = err });
                    };

                    switch (pkg_res.tag) {
                        .uninitialized,
                        .root,
                        .workspace,
                        .folder,
                        .symlink,
                        .single_file_module,
                        => {},

                        _ => {},

                        .npm,
                        .git,
                        .github,
                        .local_tarball,
                        .remote_tarball,
                        => {
                            if (!entry_hoisted[this.entry_id.get()]) {
                                continue :next_step this.nextStep(current_step);
                            }
                            installer.linkToHiddenNodeModules(this.entry_id);
                        },
                    }

                    continue :next_step this.nextStep(current_step);
                },
                inline .run_preinstall => |current_step| {
                    if (!installer.manager.options.do.run_scripts or this.entry_id == .root) {
                        continue :next_step this.nextStep(current_step);
                    }

                    // The eligibility check excludes any package whose
                    // lifecycle scripts are trusted to run, so a global-store
                    // entry should never reach script enqueueing. Guard it
                    // anyway: `meta.hasInstallScript` can be a false negative
                    // (yarn-migrated lockfiles force it to `.false`), and a
                    // script running with cwd inside a shared content-
                    // addressed directory would mutate every other project's
                    // copy.
                    if (installer.entryUsesGlobalStore(this.entry_id)) {
                        continue :next_step this.nextStep(current_step);
                    }

                    const string_buf = installer.lockfile.buffers.string_bytes.items;

                    const dep = installer.lockfile.buffers.dependencies.items[dep_id];
                    const truncated_dep_name_hash: TruncatedPackageNameHash = @truncate(dep.name_hash);

                    const is_trusted, const is_trusted_through_update_request = brk: {
                        if (installer.trusted_dependencies_from_update_requests.contains(truncated_dep_name_hash)) {
                            break :brk .{ true, true };
                        }
                        if (installer.lockfile.hasTrustedDependency(dep.name.slice(string_buf), &pkg_res)) {
                            break :brk .{ true, false };
                        }
                        break :brk .{ false, false };
                    };

                    var pkg_cwd: bun.AbsPath(.{ .sep = .auto }) = .initTopLevelDir();
                    defer pkg_cwd.deinit();

                    installer.appendStorePath(&pkg_cwd, this.entry_id);

                    if (pkg_res.tag != .root and (pkg_res.tag == .workspace or is_trusted)) enqueue_lifecycle_scripts: {
                        var pkg_scripts: Package.Scripts = pkg_script_lists[pkg_id];
                        if (is_trusted and manager.postinstall_optimizer.shouldIgnoreLifecycleScripts(
                            .{
                                .name_hash = pkg_name_hash,
                                .version = if (pkg_res.tag == .npm) pkg_res.value.npm.version else null,
                                .version_buf = lockfile.buffers.string_bytes.items,
                            },
                            installer.lockfile.buffers.resolutions.items,
                            pkg_metas,
                            manager.options.cpu,
                            manager.options.os,
                            null,
                        )) {
                            break :enqueue_lifecycle_scripts;
                        }

                        var log = bun.logger.Log.init(bun.default_allocator);
                        defer log.deinit();

                        const scripts_list = pkg_scripts.getList(
                            &log,
                            installer.lockfile,
                            &pkg_cwd,
                            dep.name.slice(string_buf),
                            &pkg_res,
                        ) catch |err| {
                            return .failure(.{ .run_scripts = err });
                        };

                        if (scripts_list) |list| {
                            const clone = bun.create(bun.default_allocator, Package.Scripts.List, list);
                            entry_scripts[this.entry_id.get()] = clone;

                            if (is_trusted_through_update_request) {
                                const trusted_dep_to_add = try installer.manager.allocator.dupe(u8, dep.name.slice(string_buf));

                                installer.trusted_dependencies_mutex.lock();
                                defer installer.trusted_dependencies_mutex.unlock();

                                try installer.manager.trusted_deps_to_add_to_package_json.append(
                                    installer.manager.allocator,
                                    trusted_dep_to_add,
                                );
                                if (installer.lockfile.trusted_dependencies == null) {
                                    installer.lockfile.trusted_dependencies = .{};
                                }
                                try installer.lockfile.trusted_dependencies.?.put(installer.manager.allocator, truncated_dep_name_hash, {});
                            }

                            if (list.first_index != 0) {
                                // has scripts but not a preinstall
                                continue :next_step this.nextStep(current_step);
                            }

                            return .{ .run_scripts = clone };
                        }
                    }

                    continue :next_step this.nextStep(current_step);
                },
                inline .binaries => |current_step| {
                    if (this.entry_id == .root) {
                        continue :next_step this.nextStep(current_step);
                    }

                    const bin = pkg_bins[pkg_id];
                    if (bin.tag == .none) {
                        switch (installer.commitGlobalStoreEntry(this.entry_id)) {
                            .result => {},
                            .err => |e| return .failure(.{ .link_package = e }),
                        }
                        continue :next_step this.nextStep(current_step);
                    }

                    const string_buf = installer.lockfile.buffers.string_bytes.items;
                    const dependencies = installer.lockfile.buffers.dependencies.items;

                    const dep_name = dependencies[dep_id].name.slice(string_buf);

                    const abs_target_buf = bun.path_buffer_pool.get();
                    defer bun.path_buffer_pool.put(abs_target_buf);
                    const abs_dest_buf = bun.path_buffer_pool.get();
                    defer bun.path_buffer_pool.put(abs_dest_buf);
                    const rel_buf = bun.path_buffer_pool.get();
                    defer bun.path_buffer_pool.put(rel_buf);

                    var seen: bun.StringHashMap(void) = .init(bun.default_allocator);
                    defer seen.deinit();

                    var node_modules_path: bun.AbsPath(.{}) = .initTopLevelDir();
                    defer node_modules_path.deinit();
                    installer.appendRealStoreNodeModulesPath(&node_modules_path, this.entry_id, .staging);

                    var target_node_modules_path: ?bun.AbsPath(.{}) = null;
                    defer if (target_node_modules_path) |*path| path.deinit();

                    var target_package_name: strings.StringOrTinyString = strings.StringOrTinyString.init(dep_name);

                    if (installer.maybeReplaceNodeModulesPath(
                        entry_node_ids,
                        node_pkg_ids,
                        pkg_name_hashes,
                        pkg_resolutions_lists,
                        installer.lockfile.buffers.resolutions.items,
                        installer.lockfile.packages.items(.meta),
                        pkg_id,
                    )) |replacement_entry_id| {
                        target_node_modules_path = bun.AbsPath(.{}).initTopLevelDir();
                        installer.appendRealStoreNodeModulesPath(&target_node_modules_path.?, replacement_entry_id, .final);

                        const replacement_node_id = entry_node_ids[replacement_entry_id.get()];
                        const replacement_pkg_id = node_pkg_ids[replacement_node_id.get()];
                        target_package_name = strings.StringOrTinyString.init(installer.lockfile.str(&pkg_names[replacement_pkg_id]));
                    }

                    var bin_linker: Bin.Linker = .{
                        .bin = bin,
                        .global_bin_path = installer.manager.options.bin_path,
                        .package_name = strings.StringOrTinyString.init(dep_name),
                        .target_package_name = target_package_name,
                        .string_buf = string_buf,
                        .extern_string_buf = installer.lockfile.buffers.extern_strings.items,
                        .seen = &seen,
                        .target_node_modules_path = if (target_node_modules_path) |*path| path else &node_modules_path,
                        .node_modules_path = &node_modules_path,
                        .abs_target_buf = abs_target_buf,
                        .abs_dest_buf = abs_dest_buf,
                        .rel_buf = rel_buf,
                    };

                    bin_linker.link(false);

                    if (target_node_modules_path != null and (bin_linker.skipped_due_to_missing_bin or bin_linker.err != null)) {
                        target_node_modules_path.?.deinit();
                        target_node_modules_path = null;

                        bin_linker.target_node_modules_path = &node_modules_path;
                        bin_linker.target_package_name = strings.StringOrTinyString.init(dep_name);

                        if (this.installer.manager.options.log_level.isVerbose()) {
                            Output.prettyErrorln("<d>[Bin Linker]<r> {s} -> {s} retrying without native bin link", .{
                                dep_name,
                                bin_linker.target_package_name.slice(),
                            });
                        }

                        bin_linker.link(false);
                    }

                    if (bin_linker.err) |err| {
                        return .failure(.{ .binaries = err });
                    }

                    switch (installer.commitGlobalStoreEntry(this.entry_id)) {
                        .result => {},
                        .err => |e| return .failure(.{ .link_package = e }),
                    }

                    continue :next_step this.nextStep(current_step);
                },
                inline .@"run (post)install and (pre/post)prepare" => |current_step| {
                    if (!installer.manager.options.do.run_scripts or this.entry_id == .root) {
                        continue :next_step this.nextStep(current_step);
                    }

                    var list = entry_scripts[this.entry_id.get()] orelse {
                        continue :next_step this.nextStep(current_step);
                    };

                    if (list.first_index == 0) {
                        for (list.items[1..], 1..) |item, i| {
                            if (item != null) {
                                list.first_index = @intCast(i);
                                break;
                            }
                        }
                    }

                    if (list.first_index == 0) {
                        continue :next_step this.nextStep(current_step);
                    }

                    // when these scripts finish the package install will be
                    // complete. the task does not have anymore work to complete
                    // so it does not return to the thread pool.

                    return .{ .run_scripts = list };
                },

                .done => {
                    return .done;
                },

                .blocked => {
                    bun.debugAssert(false);
                    return .yield;
                },
            };
        }

        /// Called from task thread
        pub fn callback(task: *ThreadPool.Task) void {
            const this: *Task = @fieldParentPtr("task", task);

            const res = this.run() catch |err| switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            };

            switch (res) {
                .yield => {},
                .run_scripts => |list| {
                    if (comptime Environment.ci_assert) {
                        bun.assertWithLocation(this.installer.store.entries.items(.scripts)[this.entry_id.get()] != null, @src());
                    }
                    this.result = .{ .run_scripts = list };
                    this.installer.task_queue.push(this);
                    this.installer.manager.wake();
                },
                .done => {
                    if (comptime Environment.ci_assert) {
                        // .monotonic is okay because this should have been set by this thread.
                        bun.assertWithLocation(this.installer.store.entries.items(.step)[this.entry_id.get()].load(.monotonic) == .done, @src());
                    }
                    this.result = .done;
                    this.installer.task_queue.push(this);
                    this.installer.manager.wake();
                },
                .blocked => {
                    if (comptime Environment.ci_assert) {
                        // .monotonic is okay because this should have been set by this thread.
                        bun.assertWithLocation(this.installer.store.entries.items(.step)[this.entry_id.get()].load(.monotonic) == .check_if_blocked, @src());
                    }
                    this.result = .blocked;
                    this.installer.task_queue.push(this);
                    this.installer.manager.wake();
                },
                .fail => |err| {
                    if (comptime Environment.ci_assert) {
                        // .monotonic is okay because this should have been set by this thread.
                        bun.assertWithLocation(this.installer.store.entries.items(.step)[this.entry_id.get()].load(.monotonic) != .done, @src());
                    }
                    this.installer.store.entries.items(.step)[this.entry_id.get()].store(.done, .release);
                    this.result = .{ .err = err };
                    this.installer.task_queue.push(this);
                    this.installer.manager.wake();
                },
            }
        }
    };

    const PatchInfo = union(enum) {
        none,
        remove: Remove,
        patch: Patch,

        pub const Remove = struct {
            name_and_version_hash: u64,
        };

        pub const Patch = struct {
            name_and_version_hash: u64,
            patch_path: string,
            contents_hash: u64,
        };

        pub fn contentsHash(this: *const @This()) ?u64 {
            return switch (this.*) {
                .none, .remove => null,
                .patch => |patch| patch.contents_hash,
            };
        }

        pub fn nameAndVersionHash(this: *const @This()) ?u64 {
            return switch (this.*) {
                .none, .remove => null,
                .patch => |patch| patch.name_and_version_hash,
            };
        }
    };

    pub fn packagePatchInfo(
        this: *Installer,
        pkg_name: String,
        pkg_name_hash: PackageNameHash,
        pkg_res: *const Resolution,
    ) OOM!PatchInfo {
        if (this.lockfile.patched_dependencies.entries.len == 0 and this.manager.patched_dependencies_to_remove.entries.len == 0) {
            return .none;
        }

        const string_buf = this.lockfile.buffers.string_bytes.items;

        var version_buf: std.ArrayListUnmanaged(u8) = .empty;
        defer version_buf.deinit(bun.default_allocator);

        var writer = version_buf.writer(this.lockfile.allocator);
        try writer.print("{s}@", .{pkg_name.slice(string_buf)});

        switch (pkg_res.tag) {
            .workspace => {
                if (this.lockfile.workspace_versions.get(pkg_name_hash)) |workspace_version| {
                    try writer.print("{f}", .{workspace_version.fmt(string_buf)});
                }
            },
            else => {
                try writer.print("{f}", .{pkg_res.fmt(string_buf, .posix)});
            },
        }

        const name_and_version_hash = String.Builder.stringHash(version_buf.items);

        if (this.lockfile.patched_dependencies.get(name_and_version_hash)) |patch| {
            return .{
                .patch = .{
                    .name_and_version_hash = name_and_version_hash,
                    .patch_path = patch.path.slice(string_buf),
                    .contents_hash = patch.patchfileHash().?,
                },
            };
        }

        if (this.manager.patched_dependencies_to_remove.contains(name_and_version_hash)) {
            return .{
                .remove = .{
                    .name_and_version_hash = name_and_version_hash,
                },
            };
        }

        return .none;
    }

    pub fn linkToHiddenNodeModules(this: *const Installer, entry_id: Store.Entry.Id) void {
        const string_buf = this.lockfile.buffers.string_bytes.items;

        const node_id = this.store.entries.items(.node_id)[entry_id.get()];
        const pkg_id = this.store.nodes.items(.pkg_id)[node_id.get()];
        const pkg_name = this.lockfile.packages.items(.name)[pkg_id];

        var hidden_hoisted_node_modules: bun.Path(.{ .sep = .auto }) = .init();
        defer hidden_hoisted_node_modules.deinit();

        hidden_hoisted_node_modules.append(
            "node_modules" ++ std.fs.path.sep_str ++ ".bun" ++ std.fs.path.sep_str ++ "node_modules",
        );
        hidden_hoisted_node_modules.append(pkg_name.slice(string_buf));

        var target: bun.RelPath(.{ .sep = .auto }) = .init();
        defer target.deinit();

        target.append("..");
        if (strings.containsChar(pkg_name.slice(string_buf), '/')) {
            target.append("..");
        }

        target.appendFmt("{f}/node_modules/{s}", .{
            Store.Entry.fmtStorePath(entry_id, this.store, this.lockfile),
            pkg_name.slice(string_buf),
        });

        var full_target: bun.AbsPath(.{ .sep = .auto }) = .initTopLevelDir();
        defer full_target.deinit();

        this.appendStorePath(&full_target, entry_id);

        const symlinker: Symlinker = .{
            .dest = hidden_hoisted_node_modules,
            .target = target,
            .fallback_junction_target = full_target,
        };

        // symlinks won't exist if node_modules/.bun is new
        const link_strategy: Symlinker.Strategy = if (this.is_new_bun_modules)
            .expect_missing
        else
            .expect_existing;

        _ = symlinker.ensureSymlink(link_strategy);
    }

    fn maybeReplaceNodeModulesPath(
        this: *const Installer,
        entry_node_ids: []const Store.Node.Id,
        node_pkg_ids: []const PackageID,
        name_hashes: []const PackageNameHash,
        pkg_resolutions_lists: []const Lockfile.PackageIDSlice,
        pkg_resolutions_buffer: []const PackageID,
        pkg_metas: []const Package.Meta,
        pkg_id: PackageID,
    ) ?Store.Entry.Id {
        const postinstall_optimizer = &this.manager.postinstall_optimizer;
        if (!postinstall_optimizer.isNativeBinlinkEnabled()) {
            return null;
        }
        const name_hash = name_hashes[pkg_id];

        if (postinstall_optimizer.get(.{ .name_hash = name_hash })) |optimizer| {
            switch (optimizer) {
                .native_binlink => {
                    const manager = this.manager;
                    const target_cpu = manager.options.cpu;
                    const target_os = manager.options.os;
                    if (PostinstallOptimizer.getNativeBinlinkReplacementPackageID(
                        pkg_resolutions_lists[pkg_id].get(pkg_resolutions_buffer),
                        pkg_metas,
                        target_cpu,
                        target_os,
                    )) |replacement_pkg_id| {
                        for (entry_node_ids, 0..) |new_node_id, new_entry_id| {
                            if (node_pkg_ids[new_node_id.get()] == replacement_pkg_id) {
                                debug("native bin link {d} -> {d}", .{ pkg_id, replacement_pkg_id });
                                return .from(@intCast(new_entry_id));
                            }
                        }
                    }
                },
                .ignore => {},
            }
        }

        return null;
    }

    pub fn linkDependencyBins(this: *const Installer, parent_entry_id: Store.Entry.Id) !void {
        const lockfile = this.lockfile;
        const store = this.store;

        const string_buf = lockfile.buffers.string_bytes.items;
        const extern_string_buf = lockfile.buffers.extern_strings.items;

        const entries = store.entries.slice();
        const entry_node_ids: []const Store.Node.Id = entries.items(.node_id);
        const entry_deps = entries.items(.dependencies);

        const nodes = store.nodes.slice();
        const node_pkg_ids = nodes.items(.pkg_id);
        const node_dep_ids = nodes.items(.dep_id);

        const pkgs = lockfile.packages.slice();
        const pkg_name_hashes = pkgs.items(.name_hash);
        const pkg_metas = pkgs.items(.meta);
        const pkg_resolutions_lists = pkgs.items(.resolutions);
        const pkg_resolutions_buffer = lockfile.buffers.resolutions.items;
        const pkg_bins = pkgs.items(.bin);

        const link_target_buf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(link_target_buf);
        const link_dest_buf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(link_dest_buf);
        const link_rel_buf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(link_rel_buf);

        var seen: bun.StringHashMap(void) = .init(bun.default_allocator);
        defer seen.deinit();

        var node_modules_path: bun.AbsPath(.{}) = .initTopLevelDir();
        defer node_modules_path.deinit();

        this.appendRealStoreNodeModulesPath(&node_modules_path, parent_entry_id, .staging);

        for (entry_deps[parent_entry_id.get()].slice()) |dep| {
            const node_id = entry_node_ids[dep.entry_id.get()];
            const dep_id = node_dep_ids[node_id.get()];
            const pkg_id = node_pkg_ids[node_id.get()];
            const bin = pkg_bins[pkg_id];
            if (bin.tag == .none) {
                continue;
            }
            const alias = lockfile.buffers.dependencies.items[dep_id].name;

            var target_node_modules_path: ?bun.AbsPath(.{}) = null;
            defer if (target_node_modules_path) |*path| path.deinit();
            const package_name = strings.StringOrTinyString.init(alias.slice(string_buf));

            var target_package_name = package_name;

            if (this.maybeReplaceNodeModulesPath(
                entry_node_ids,
                node_pkg_ids,
                pkg_name_hashes,
                pkg_resolutions_lists,
                pkg_resolutions_buffer,
                pkg_metas,
                pkg_id,
            )) |replacement_entry_id| {
                target_node_modules_path = bun.AbsPath(.{}).initTopLevelDir();
                this.appendRealStoreNodeModulesPath(&target_node_modules_path.?, replacement_entry_id, .final);

                const replacement_node_id = entry_node_ids[replacement_entry_id.get()];
                const replacement_pkg_id = node_pkg_ids[replacement_node_id.get()];
                const pkg_names = pkgs.items(.name);
                target_package_name = strings.StringOrTinyString.init(this.lockfile.str(&pkg_names[replacement_pkg_id]));
            }

            var bin_linker: Bin.Linker = .{
                .bin = bin,
                .global_bin_path = this.manager.options.bin_path,
                .package_name = package_name,
                .string_buf = string_buf,
                .extern_string_buf = extern_string_buf,
                .seen = &seen,
                .node_modules_path = &node_modules_path,
                .target_node_modules_path = if (target_node_modules_path) |*path| path else &node_modules_path,
                .target_package_name = if (target_node_modules_path != null) target_package_name else package_name,
                .abs_target_buf = link_target_buf,
                .abs_dest_buf = link_dest_buf,
                .rel_buf = link_rel_buf,
            };

            bin_linker.link(false);

            if (target_node_modules_path != null and (bin_linker.skipped_due_to_missing_bin or bin_linker.err != null)) {
                target_node_modules_path.?.deinit();
                target_node_modules_path = null;

                bin_linker.target_node_modules_path = &node_modules_path;
                bin_linker.target_package_name = package_name;

                if (this.manager.options.log_level.isVerbose()) {
                    Output.prettyErrorln("<d>[Bin Linker]<r> {s} -> {s} retrying without native bin link", .{
                        package_name.slice(),
                        target_package_name.slice(),
                    });
                }

                bin_linker.link(false);
            }

            if (bin_linker.err) |err| {
                return err;
            }
        }
    }

    /// True when this entry should live in the shared global virtual store
    /// instead of being materialized under the project's `node_modules/.bun/`.
    /// Root, workspace, folder, symlink, and patched packages always stay
    /// project-local because their contents are mutable / project-specific.
    pub fn entryUsesGlobalStore(this: *const Installer, entry_id: Store.Entry.Id) bool {
        if (this.global_store_path == null) return false;
        return this.store.entries.items(.entry_hash)[entry_id.get()] != 0;
    }

    /// Absolute path to the global virtual-store directory for `entry_id`:
    ///   <cache>/links/<storepath>-<entry_hash>
    /// (no trailing `/node_modules`). Pass `.staging` to get the per-process
    /// temp sibling that the build steps write into; the final `binaries`
    /// step renames staging → final.
    pub fn appendGlobalStoreEntryPath(this: *const Installer, buf: anytype, entry_id: Store.Entry.Id, which: Which) void {
        bun.debugAssert(this.entryUsesGlobalStore(entry_id));
        buf.clear();
        buf.append(this.global_store_path.?);
        switch (which) {
            .final => buf.appendFmt("{f}", .{
                Store.Entry.fmtGlobalStorePath(entry_id, this.store, this.lockfile),
            }),
            .staging => buf.appendFmt("{f}.tmp-{x}", .{
                Store.Entry.fmtGlobalStorePath(entry_id, this.store, this.lockfile),
                this.global_store_tmp_suffix,
            }),
        }
    }

    /// Atomically publish a staged global-store entry by renaming
    /// `<entry>.tmp-<suffix>/` → `<entry>/`. The package tree, dep symlinks,
    /// dependency-bin links and own-bin links were all written under the
    /// staging path; every link inside is relative to the entry directory, so
    /// they resolve identically after the rename. The final directory
    /// existing is the only completeness signal — no separate stamp file.
    pub fn commitGlobalStoreEntry(this: *const Installer, entry_id: Store.Entry.Id) sys.Maybe(void) {
        if (!this.entryUsesGlobalStore(entry_id)) return .success;
        var staging: bun.AbsPath(.{ .sep = .auto }) = .init();
        defer staging.deinit();
        this.appendGlobalStoreEntryPath(&staging, entry_id, .staging);
        var final: bun.AbsPath(.{ .sep = .auto }) = .init();
        defer final.deinit();
        this.appendGlobalStoreEntryPath(&final, entry_id, .final);

        switch (sys.renameat(FD.cwd(), staging.sliceZ(), FD.cwd(), final.sliceZ())) {
            .result => return .success,
            .err => |err| {
                if (!isRenameCollision(err)) {
                    FD.cwd().deleteTree(staging.slice()) catch {};
                    return .initErr(err);
                }
                // Under --force, the existing entry may be the corrupt one
                // we were asked to replace. Swap it aside (atomic from a
                // reader's POV: `final` is always either the old or the new
                // tree, never missing), publish staging, then GC the old
                // tree. Without --force, the existing entry came from a
                // concurrent install and is content-identical — keep it and
                // discard ours.
                if (this.manager.options.enable.force_install) {
                    var old: bun.AbsPath(.{ .sep = .auto }) = .init();
                    defer old.deinit();
                    old.append(this.global_store_path.?);
                    old.appendFmt("{f}.old-{x}", .{
                        Store.Entry.fmtGlobalStorePath(entry_id, this.store, this.lockfile),
                        bun.fastRandom(),
                    });
                    if (sys.renameat(FD.cwd(), final.sliceZ(), FD.cwd(), old.sliceZ()).asErr()) |swap_err| {
                        FD.cwd().deleteTree(staging.slice()) catch {};
                        return .initErr(swap_err);
                    }
                    switch (sys.renameat(FD.cwd(), staging.sliceZ(), FD.cwd(), final.sliceZ())) {
                        .result => {
                            FD.cwd().deleteTree(old.slice()) catch {};
                            return .success;
                        },
                        .err => |publish_err| {
                            // Another --force install raced us in the window
                            // between swap-out and publish. Theirs is fresh
                            // too; clean up both temp trees.
                            FD.cwd().deleteTree(staging.slice()) catch {};
                            FD.cwd().deleteTree(old.slice()) catch {};
                            return if (isRenameCollision(publish_err)) .success else .initErr(publish_err);
                        },
                    }
                }
                FD.cwd().deleteTree(staging.slice()) catch {};
                // A concurrent install renamed first; both writers produced
                // the same content-addressed bytes, so theirs is as good as
                // ours.
                return .success;
            },
        }
    }

    fn isRenameCollision(err: sys.Error) bool {
        return switch (err.getErrno()) {
            .EXIST, .NOTEMPTY => true,
            // Windows maps a rename onto an in-use directory to
            // ERROR_ACCESS_DENIED; on POSIX PERM/ACCES are real
            // permission failures and must propagate.
            .PERM, .ACCES => Environment.isWindows,
            else => false,
        };
    }

    /// Project-local path `node_modules/.bun/<storepath>` (the symlink that
    /// points at the global virtual-store entry). Relative to top-level dir.
    pub fn appendLocalStoreEntryPath(this: *const Installer, buf: anytype, entry_id: Store.Entry.Id) void {
        buf.appendFmt("node_modules/" ++ Store.modules_dir_name ++ "/{f}", .{
            Store.Entry.fmtStorePath(entry_id, this.store, this.lockfile),
        });
    }

    /// Create the project-level symlink `node_modules/.bun/<storepath>` →
    /// `<cache>/links/<storepath>-<hash>`. This is the only per-install
    /// filesystem write for a warm global-store hit.
    pub fn linkProjectToGlobalStore(this: *const Installer, entry_id: Store.Entry.Id) sys.Maybe(void) {
        var dest: bun.Path(.{ .sep = .auto }) = .initTopLevelDir();
        defer dest.deinit();
        this.appendLocalStoreEntryPath(&dest, entry_id);

        var target_abs: bun.AbsPath(.{ .sep = .auto }) = .init();
        defer target_abs.deinit();
        this.appendGlobalStoreEntryPath(&target_abs, entry_id, .final);

        // Absolute target so the link is independent of where node_modules
        // lives (project root may itself be behind a symlink). Symlinker's
        // `target` field is RelPath-typed for the common in-tree case, so
        // call sys.symlink/symlinkOrJunction directly here.
        const do_symlink = struct {
            fn call(d: [:0]const u8, t: [:0]const u8) sys.Maybe(void) {
                if (comptime Environment.isWindows) {
                    return sys.symlinkOrJunction(d, t, t);
                }
                return sys.symlink(t, d);
            }
        }.call;

        switch (do_symlink(dest.sliceZ(), target_abs.sliceZ())) {
            .result => return .success,
            .err => |err| switch (err.getErrno()) {
                .NOENT => {
                    if (dest.dirname()) |parent| {
                        FD.cwd().makePath(u8, parent) catch {};
                    }
                },
                .EXIST => {
                    // Existing entry from a previous install. If it's a
                    // symlink, replace it (stale link from a different
                    // hash). If it's a real directory, that's the
                    // pre-global-store layout (`bun patch` detaches
                    // `node_modules/<pkg>`, not this path).
                    const is_symlink = if (comptime Environment.isWindows)
                        if (sys.getFileAttributes(dest.sliceZ())) |a| a.is_reparse_point else true
                    else if (sys.lstat(dest.sliceZ()).asValue()) |st|
                        std.posix.S.ISLNK(@intCast(st.mode))
                    else
                        true;

                    if (is_symlink) {
                        if (comptime Environment.isWindows) {
                            if (sys.rmdir(dest.sliceZ()).asErr()) |_| {
                                _ = sys.unlink(dest.sliceZ());
                            }
                        } else {
                            _ = sys.unlink(dest.sliceZ());
                        }
                    } else {
                        FD.cwd().deleteTree(dest.slice()) catch {};
                    }
                },
                else => return .initErr(err),
            },
        }
        return do_symlink(dest.sliceZ(), target_abs.sliceZ());
    }

    pub fn appendStoreNodeModulesPath(this: *const Installer, buf: anytype, entry_id: Store.Entry.Id) void {
        const string_buf = this.lockfile.buffers.string_bytes.items;

        const entries = this.store.entries.slice();
        const entry_node_ids = entries.items(.node_id);

        const nodes = this.store.nodes.slice();
        const node_pkg_ids = nodes.items(.pkg_id);

        const pkgs = this.lockfile.packages.slice();
        const pkg_resolutions = pkgs.items(.resolution);

        const node_id = entry_node_ids[entry_id.get()];
        const pkg_id = node_pkg_ids[node_id.get()];
        const pkg_res = pkg_resolutions[pkg_id];

        switch (pkg_res.tag) {
            .root => {
                buf.append("node_modules");
            },
            .workspace => {
                buf.append(pkg_res.value.workspace.slice(string_buf));
                buf.append("node_modules");
            },
            else => {
                buf.appendFmt("node_modules/" ++ Store.modules_dir_name ++ "/{f}/node_modules", .{
                    Store.Entry.fmtStorePath(entry_id, this.store, this.lockfile),
                });
            },
        }
    }

    pub const Which = enum {
        /// The published location (`<cache>/links/<entry>`). Use for symlink
        /// *targets* that point at other entries, and for the warm-hit check.
        final,
        /// The per-process temp sibling (`<entry>.tmp-<suffix>`) the build
        /// steps write into. Use for *destinations* of clonefile/hardlink/
        /// dep-symlink/bin-link when building this entry.
        staging,
    };

    /// Like `appendStoreNodeModulesPath`, but resolves to the *physical*
    /// location of the entry's `node_modules` directory: the global virtual
    /// store for global-eligible entries, or the project-local `.bun/` path
    /// otherwise. See `Which` for when to pass `.staging` vs `.final`.
    pub fn appendRealStoreNodeModulesPath(this: *const Installer, buf: anytype, entry_id: Store.Entry.Id, which: Which) void {
        if (this.entryUsesGlobalStore(entry_id)) {
            this.appendGlobalStoreEntryPath(buf, entry_id, which);
            buf.append("node_modules");
            return;
        }
        this.appendStoreNodeModulesPath(buf, entry_id);
    }

    /// `appendStorePath` resolved to the entry's *physical* location. See
    /// `Which` for when to pass `.staging` vs `.final`.
    pub fn appendRealStorePath(this: *const Installer, buf: anytype, entry_id: Store.Entry.Id, which: Which) void {
        if (this.entryUsesGlobalStore(entry_id)) {
            const string_buf = this.lockfile.buffers.string_bytes.items;
            const node_id = this.store.entries.items(.node_id)[entry_id.get()];
            const pkg_id = this.store.nodes.items(.pkg_id)[node_id.get()];
            const pkg_name = this.lockfile.packages.items(.name)[pkg_id];
            this.appendGlobalStoreEntryPath(buf, entry_id, which);
            buf.append("node_modules");
            buf.append(pkg_name.slice(string_buf));
            return;
        }
        this.appendStorePath(buf, entry_id);
    }

    pub fn appendStorePath(this: *const Installer, buf: anytype, entry_id: Store.Entry.Id) void {
        const string_buf = this.lockfile.buffers.string_bytes.items;

        const entries = this.store.entries.slice();
        const entry_node_ids = entries.items(.node_id);

        const nodes = this.store.nodes.slice();
        const node_pkg_ids = nodes.items(.pkg_id);
        const node_dep_ids = nodes.items(.dep_id);
        // const node_peers = nodes.items(.peers);

        const pkgs = this.lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        const pkg_resolutions = pkgs.items(.resolution);

        const node_id = entry_node_ids[entry_id.get()];
        // const peers = node_peers[node_id.get()];
        const pkg_id = node_pkg_ids[node_id.get()];
        const dep_id = node_dep_ids[node_id.get()];
        const pkg_res = pkg_resolutions[pkg_id];

        switch (pkg_res.tag) {
            .root => {
                if (dep_id != invalid_dependency_id) {
                    const pkg_name = pkg_names[pkg_id];
                    buf.append("node_modules/" ++ Store.modules_dir_name);
                    buf.appendFmt("{f}", .{
                        Store.Entry.fmtStorePath(entry_id, this.store, this.lockfile),
                    });
                    buf.append("node_modules");
                    if (pkg_name.isEmpty()) {
                        buf.append(std.fs.path.basename(bun.fs.FileSystem.instance.top_level_dir));
                    } else {
                        buf.append(pkg_name.slice(string_buf));
                    }
                } else {
                    // append nothing. buf is already top_level_dir
                }
            },
            .workspace => {
                buf.append(pkg_res.value.workspace.slice(string_buf));
            },
            .symlink => {
                const symlink_dir_path = this.manager.globalLinkDirPath();

                buf.clear();
                buf.append(symlink_dir_path);
                buf.append(pkg_res.value.symlink.slice(string_buf));
            },
            else => {
                const pkg_name = pkg_names[pkg_id];
                buf.append("node_modules/" ++ Store.modules_dir_name);
                buf.appendFmt("{f}", .{
                    Store.Entry.fmtStorePath(entry_id, this.store, this.lockfile),
                });
                buf.append("node_modules");
                buf.append(pkg_name.slice(string_buf));
            },
        }
    }

    /// The directory name for the entry store node_modules install
    /// folder.
    /// ./node_modules/.bun/jquery@3.7.1/node_modules/jquery
    ///                                               ^ this one
    /// Need to know this to avoid collisions with dependencies
    /// with the same name as the package.
    pub fn entryStoreNodeModulesPackageName(
        this: *const Installer,
        dep_id: DependencyID,
        pkg_id: PackageID,
        pkg_res: *const Resolution,
        pkg_names: []const String,
    ) ?[]const u8 {
        const string_buf = this.lockfile.buffers.string_bytes.items;

        return switch (pkg_res.tag) {
            .root => {
                if (dep_id != invalid_dependency_id) {
                    const pkg_name = pkg_names[pkg_id];
                    if (pkg_name.isEmpty()) {
                        return std.fs.path.basename(bun.fs.FileSystem.instance.top_level_dir);
                    }
                    return pkg_name.slice(string_buf);
                }
                return null;
            },
            .workspace => null,
            .symlink => null,
            else => pkg_names[pkg_id].slice(string_buf),
        };
    }
};

const string = []const u8;

const debug = Output.scoped(.IsolatedInstaller, .hidden);

const FileCloner = @import("./FileCloner.zig");
const Hardlinker = @import("./Hardlinker.zig");
const std = @import("std");
const Symlinker = @import("./Symlinker.zig").Symlinker;

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const Global = bun.Global;
const OOM = bun.OOM;
const Output = bun.Output;
const Progress = bun.Progress;
const ThreadPool = bun.ThreadPool;
const strings = bun.strings;
const sys = bun.sys;
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const Command = bun.cli.Command;
const Mutex = bun.threading.Mutex;
const String = bun.Semver.String;

const install = bun.install;
const Bin = install.Bin;
const DependencyID = install.DependencyID;
const FileCopier = bun.install.FileCopier;
const PackageID = install.PackageID;
const PackageInstall = install.PackageInstall;
const PackageManager = install.PackageManager;
const PackageNameHash = install.PackageNameHash;
const PostinstallOptimizer = install.PostinstallOptimizer;
const Resolution = install.Resolution;
const Store = install.Store;
const TruncatedPackageNameHash = install.TruncatedPackageNameHash;
const invalid_dependency_id = install.invalid_dependency_id;

const Lockfile = install.Lockfile;
const Package = Lockfile.Package;
