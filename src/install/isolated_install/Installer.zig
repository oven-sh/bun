pub const Installer = struct {
    trusted_dependencies_mutex: Mutex,
    // this is not const for `lockfile.trusted_dependencies`
    lockfile: *Lockfile,

    summary: PackageInstall.Summary = .{ .successfully_installed = .empty },
    installed: Bitset,
    install_node: ?*Progress.Node,
    scripts_node: ?*Progress.Node,

    manager: *PackageManager,
    command_ctx: Command.Context,

    store: *const Store,

    task_queue: bun.UnboundedQueue(Task, .next) = .{},
    tasks: []Task,

    supported_backend: std.atomic.Value(PackageInstall.Method),

    trusted_dependencies_from_update_requests: std.AutoArrayHashMapUnmanaged(TruncatedPackageNameHash, void),

    pub fn deinit(this: *const Installer) void {
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
            for (removed.value.items) |install_ctx| {
                const entry_id = install_ctx.isolated_package_install_context;
                this.startTask(entry_id);
            }
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
                Output.err(link_err, "failed to link package: {s}@{}", .{
                    pkg_name.slice(string_buf),
                    pkg_res.fmt(string_buf, .auto),
                });
            },
            .symlink_dependencies => |symlink_err| {
                Output.err(symlink_err, "failed to symlink dependencies for package: {s}@{}", .{
                    pkg_name.slice(string_buf),
                    pkg_res.fmt(string_buf, .auto),
                });
            },
            else => {},
        }
        Output.flush();

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

                store_path.appendFmt("node_modules/{}", .{
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

            pub fn clone(this: *const Error, allocator: std.mem.Allocator) Error {
                return switch (this.*) {
                    .link_package => |err| .{ .link_package = err.clone(allocator) },
                    .symlink_dependencies => |err| .{ .symlink_dependencies = err.clone(allocator) },
                    .binaries => |err| .{ .binaries = err },
                    .run_scripts => |err| .{ .run_scripts = err },
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
            const pkg_bins = pkgs.items(.bin);
            const pkg_script_lists = pkgs.items(.scripts);

            const entries = installer.store.entries.slice();
            const entry_node_ids = entries.items(.node_id);
            const entry_dependencies = entries.items(.dependencies);
            const entry_steps = entries.items(.step);
            const entry_scripts = entries.items(.scripts);

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

                    var pkg_cache_dir_subpath: bun.RelPath(.{ .sep = .auto }) = .from(switch (pkg_res.tag) {
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

                        .folder => {
                            // the folder does not exist in the cache. xdev is per folder dependency
                            const folder_dir = switch (bun.openDirForIteration(FD.cwd(), pkg_res.value.folder.slice(string_buf))) {
                                .result => |fd| fd,
                                .err => |err| return .failure(.{ .link_package = err }),
                            };
                            defer folder_dir.close();

                            backend: switch (PackageInstall.Method.hardlink) {
                                .hardlink => {
                                    var src: bun.AbsPath(.{ .unit = .os, .sep = .auto }) = .initTopLevelDirLongPath();
                                    defer src.deinit();
                                    src.appendJoin(pkg_res.value.folder.slice(string_buf));

                                    var dest: bun.RelPath(.{ .unit = .os, .sep = .auto }) = .init();
                                    defer dest.deinit();

                                    installer.appendStorePath(&dest, this.entry_id);

                                    var hardlinker: Hardlinker = .{
                                        .src_dir = folder_dir,
                                        .src = src,
                                        .dest = dest,
                                    };

                                    switch (try hardlinker.link(&.{comptime bun.OSPathLiteral("node_modules")})) {
                                        .result => {},
                                        .err => |err| {
                                            if (err.getErrno() == .XDEV) {
                                                continue :backend .copyfile;
                                            }

                                            if (PackageManager.verbose_install) {
                                                Output.prettyErrorln(
                                                    \\<red><b>error<r><d>:<r>Failed to hardlink package folder
                                                    \\{}
                                                    \\<d>From: {s}<r>
                                                    \\<d>  To: {}<r>
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

                                        if (src_path_len == 0) {
                                            const e = bun.windows.Win32Error.get();
                                            const err = e.toSystemErrno() orelse .EUNKNOWN;
                                            return .failure(
                                                .{ .link_package = .{ .errno = @intFromEnum(err), .syscall = .copyfile } },
                                            );
                                        }

                                        src_path.setLength(src_path_len);
                                    }

                                    var dest: bun.RelPath(.{ .unit = .os, .sep = .auto }) = .init();
                                    defer dest.deinit();
                                    installer.appendStorePath(&dest, this.entry_id);

                                    var file_copier: FileCopier = .{
                                        .src_dir = folder_dir,
                                        .src_path = src_path,
                                        .dest_subpath = dest,
                                    };

                                    switch (try file_copier.copy(&.{})) {
                                        .result => {},
                                        .err => |err| {
                                            if (PackageManager.verbose_install) {
                                                Output.prettyErrorln(
                                                    \\<red><b>error<r><d>:<r>Failed to copy package
                                                    \\{}
                                                    \\<d>From: {s}<r>
                                                    \\<d>  To: {}<r>
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

                    var dest_subpath: bun.RelPath(.{ .sep = .auto, .unit = .os }) = .init();
                    defer dest_subpath.deinit();
                    installer.appendStorePath(&dest_subpath, this.entry_id);

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

                            switch (sys.clonefileat(cache_dir, pkg_cache_dir_subpath.sliceZ(), FD.cwd(), dest_subpath.sliceZ())) {
                                .result => {},
                                .err => |clonefile_err1| {
                                    switch (clonefile_err1.getErrno()) {
                                        .XDEV => {
                                            installer.supported_backend.store(.copyfile, .monotonic);
                                            continue :backend .copyfile;
                                        },
                                        .OPNOTSUPP => {
                                            installer.supported_backend.store(.hardlink, .monotonic);
                                            continue :backend .hardlink;
                                        },
                                        .NOENT => {
                                            const parent_dest_dir = std.fs.path.dirname(dest_subpath.slice()) orelse {
                                                return .failure(.{ .link_package = clonefile_err1 });
                                            };
                                            FD.cwd().makePath(u8, parent_dest_dir) catch {};
                                            switch (sys.clonefileat(cache_dir, pkg_cache_dir_subpath.sliceZ(), FD.cwd(), dest_subpath.sliceZ())) {
                                                .result => {},
                                                .err => |clonefile_err2| return .failure(.{ .link_package = clonefile_err2 }),
                                            }
                                        },
                                        else => {
                                            installer.supported_backend.store(.hardlink, .monotonic);
                                            continue :backend .hardlink;
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

                            var hardlinker: Hardlinker = .{
                                .src_dir = cached_package_dir.?,
                                .src = src,
                                .dest = dest_subpath,
                            };

                            switch (try hardlinker.link(&.{})) {
                                .result => {},
                                .err => |err| {
                                    if (err.getErrno() == .XDEV) {
                                        installer.supported_backend.store(.copyfile, .monotonic);
                                        continue :backend .copyfile;
                                    }
                                    if (PackageManager.verbose_install) {
                                        Output.prettyErrorln(
                                            \\<red><b>error<r><d>:<r>Failed to hardlink package
                                            \\{}
                                            \\<d>From: {s}<r>
                                            \\<d>  To: {}<r>
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
                                            \\{}
                                            \\<d>From: {s}<r>
                                            \\<d>  To: {}<r>
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

                            var file_copier: FileCopier = .{
                                .src_dir = cached_package_dir.?,
                                .src_path = src_path,
                                .dest_subpath = dest_subpath,
                            };

                            switch (try file_copier.copy(&.{})) {
                                .result => {},
                                .err => |err| {
                                    if (PackageManager.verbose_install) {
                                        Output.prettyErrorln(
                                            \\<red><b>error<r><d>:<r>Failed to copy package
                                            \\{}
                                            \\<d>From: {s}<r>
                                            \\<d>  To: {}<r>
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

                    for (entry_dependencies[this.entry_id.get()].slice()) |dep| {
                        const dep_name = dependencies[dep.dep_id].name;

                        var dest: bun.Path(.{ .sep = .auto }) = .initTopLevelDir();
                        defer dest.deinit();

                        installer.appendStoreNodeModulesPath(&dest, this.entry_id);
                        dest.append(dep_name.slice(string_buf));

                        var dep_store_path: bun.AbsPath(.{ .sep = .auto }) = .initTopLevelDir();
                        defer dep_store_path.deinit();

                        installer.appendStorePath(&dep_store_path, dep.entry_id);

                        const target = target: {
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
                            .expect_missing;

                        switch (symlinker.ensureSymlink(link_strategy)) {
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
                            const string_buf = lockfile.buffers.string_bytes.items;

                            var hidden_hoisted_node_modules: bun.Path(.{ .sep = .auto }) = .init();
                            defer hidden_hoisted_node_modules.deinit();

                            hidden_hoisted_node_modules.append(
                                "node_modules" ++ std.fs.path.sep_str ++ ".bun" ++ std.fs.path.sep_str ++ "node_modules",
                            );
                            hidden_hoisted_node_modules.append(pkg_name.slice(installer.lockfile.buffers.string_bytes.items));

                            var target: bun.RelPath(.{ .sep = .auto }) = .init();
                            defer target.deinit();

                            target.append("..");
                            if (strings.containsChar(pkg_name.slice(installer.lockfile.buffers.string_bytes.items), '/')) {
                                target.append("..");
                            }

                            target.appendFmt("{}/node_modules/{s}", .{
                                Store.Entry.fmtStorePath(this.entry_id, installer.store, installer.lockfile),
                                pkg_name.slice(string_buf),
                            });

                            var full_target: bun.AbsPath(.{ .sep = .auto }) = .initTopLevelDir();
                            defer full_target.deinit();

                            installer.appendStorePath(&full_target, this.entry_id);

                            const symlinker: Symlinker = .{
                                .dest = hidden_hoisted_node_modules,
                                .target = target,
                                .fallback_junction_target = full_target,
                            };
                            _ = symlinker.ensureSymlink(.ignore_failure);
                        },
                    }

                    continue :next_step this.nextStep(current_step);
                },
                inline .run_preinstall => |current_step| {
                    if (!installer.manager.options.do.run_scripts or this.entry_id == .root) {
                        continue :next_step this.nextStep(current_step);
                    }

                    const string_buf = installer.lockfile.buffers.string_bytes.items;

                    const dep = installer.lockfile.buffers.dependencies.items[dep_id];
                    const truncated_dep_name_hash: TruncatedPackageNameHash = @truncate(dep.name_hash);

                    const is_trusted, const is_trusted_through_update_request = brk: {
                        if (installer.trusted_dependencies_from_update_requests.contains(truncated_dep_name_hash)) {
                            break :brk .{ true, true };
                        }
                        if (installer.lockfile.hasTrustedDependency(dep.name.slice(string_buf))) {
                            break :brk .{ true, false };
                        }
                        break :brk .{ false, false };
                    };

                    var pkg_cwd: bun.AbsPath(.{ .sep = .auto }) = .initTopLevelDir();
                    defer pkg_cwd.deinit();

                    installer.appendStorePath(&pkg_cwd, this.entry_id);

                    if (pkg_res.tag != .root and (pkg_res.tag == .workspace or is_trusted)) {
                        const pkg_scripts: *Package.Scripts = &pkg_script_lists[pkg_id];

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

                    installer.appendStoreNodeModulesPath(&node_modules_path, this.entry_id);

                    var bin_linker: Bin.Linker = .{
                        .bin = bin,
                        .global_bin_path = installer.manager.options.bin_path,
                        .package_name = strings.StringOrTinyString.init(dep_name),
                        .string_buf = string_buf,
                        .extern_string_buf = installer.lockfile.buffers.extern_strings.items,
                        .seen = &seen,
                        .node_modules_path = &node_modules_path,
                        .abs_target_buf = abs_target_buf,
                        .abs_dest_buf = abs_dest_buf,
                        .rel_buf = rel_buf,
                    };

                    bin_linker.link(false);

                    if (bin_linker.err) |err| {
                        return .failure(.{ .binaries = err });
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
        remove: struct {
            name_and_version_hash: u64,
        },
        patch: struct {
            name_and_version_hash: u64,
            patch_path: string,
            contents_hash: u64,
        },

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
                    try writer.print("{}", .{workspace_version.fmt(string_buf)});
                }
            },
            else => {
                try writer.print("{}", .{pkg_res.fmt(string_buf, .posix)});
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

    pub fn linkDependencyBins(this: *const Installer, parent_entry_id: Store.Entry.Id) !void {
        const lockfile = this.lockfile;
        const store = this.store;

        const string_buf = lockfile.buffers.string_bytes.items;
        const extern_string_buf = lockfile.buffers.extern_strings.items;

        const entries = store.entries.slice();
        const entry_node_ids = entries.items(.node_id);
        const entry_deps = entries.items(.dependencies);

        const nodes = store.nodes.slice();
        const node_pkg_ids = nodes.items(.pkg_id);
        const node_dep_ids = nodes.items(.dep_id);

        const pkgs = lockfile.packages.slice();
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

        this.appendStoreNodeModulesPath(&node_modules_path, parent_entry_id);

        for (entry_deps[parent_entry_id.get()].slice()) |dep| {
            const node_id = entry_node_ids[dep.entry_id.get()];
            const dep_id = node_dep_ids[node_id.get()];
            const pkg_id = node_pkg_ids[node_id.get()];
            const bin = pkg_bins[pkg_id];
            if (bin.tag == .none) {
                continue;
            }

            const alias = lockfile.buffers.dependencies.items[dep_id].name;

            var bin_linker: Bin.Linker = .{
                .bin = bin,
                .global_bin_path = this.manager.options.bin_path,
                .package_name = strings.StringOrTinyString.init(alias.slice(string_buf)),
                .string_buf = string_buf,
                .extern_string_buf = extern_string_buf,
                .seen = &seen,
                .node_modules_path = &node_modules_path,
                .abs_target_buf = link_target_buf,
                .abs_dest_buf = link_dest_buf,
                .rel_buf = link_rel_buf,
            };

            bin_linker.link(false);

            if (bin_linker.err) |err| {
                return err;
            }
        }
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
                buf.appendFmt("node_modules/" ++ Store.modules_dir_name ++ "/{}/node_modules", .{
                    Store.Entry.fmtStorePath(entry_id, this.store, this.lockfile),
                });
            },
        }
    }

    pub fn appendStorePath(this: *const Installer, buf: anytype, entry_id: Store.Entry.Id) void {
        const string_buf = this.lockfile.buffers.string_bytes.items;

        const entries = this.store.entries.slice();
        const entry_node_ids = entries.items(.node_id);

        const nodes = this.store.nodes.slice();
        const node_pkg_ids = nodes.items(.pkg_id);
        // const node_peers = nodes.items(.peers);

        const pkgs = this.lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        const pkg_resolutions = pkgs.items(.resolution);

        const node_id = entry_node_ids[entry_id.get()];
        // const peers = node_peers[node_id.get()];
        const pkg_id = node_pkg_ids[node_id.get()];
        const pkg_res = pkg_resolutions[pkg_id];

        switch (pkg_res.tag) {
            .root => {},
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
                buf.appendFmt("{}", .{
                    Store.Entry.fmtStorePath(entry_id, this.store, this.lockfile),
                });
                buf.append("node_modules");
                buf.append(pkg_name.slice(string_buf));
            },
        }
    }
};

const string = []const u8;

const Hardlinker = @import("./Hardlinker.zig");
const std = @import("std");
const FileCopier = @import("./FileCopier.zig").FileCopier;
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
const PackageInstall = install.PackageInstall;
const PackageManager = install.PackageManager;
const PackageNameHash = install.PackageNameHash;
const Resolution = install.Resolution;
const Store = install.Store;
const TruncatedPackageNameHash = install.TruncatedPackageNameHash;
const invalid_dependency_id = install.invalid_dependency_id;

const Lockfile = install.Lockfile;
const Package = Lockfile.Package;
