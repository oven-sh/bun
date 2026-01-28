pub fn installWithManager(
    manager: *PackageManager,
    ctx: Command.Context,
    root_package_json_path: [:0]const u8,
    original_cwd: []const u8,
) !void {
    const log_level = manager.options.log_level;

    // Start resolving DNS for the default registry immediately.
    // Unless you're behind a proxy.
    if (!manager.env.hasHTTPProxy()) {
        // And don't try to resolve DNS if it's an IP address.
        if (manager.options.scope.url.hostname.len > 0 and !manager.options.scope.url.isIPAddress()) {
            var hostname_stack = std.heap.stackFallback(512, ctx.allocator);
            const allocator = hostname_stack.get();
            const hostname = try allocator.dupeZ(u8, manager.options.scope.url.hostname);
            defer allocator.free(hostname);
            bun.dns.internal.prefetch(manager.event_loop.loop(), hostname, manager.options.scope.url.getPortAuto());
        }
    }

    var load_result: Lockfile.LoadResult = if (manager.options.do.load_lockfile)
        manager.lockfile.loadFromCwd(
            manager,
            manager.allocator,
            manager.log,
            true,
        )
    else
        .{ .not_found = {} };

    try manager.updateLockfileIfNeeded(load_result);

    const config_version, const changed_config_version = load_result.chooseConfigVersion();
    manager.options.config_version = config_version;

    var root = Lockfile.Package{};
    var needs_new_lockfile = load_result != .ok or
        (load_result.ok.lockfile.buffers.dependencies.items.len == 0 and manager.update_requests.len > 0);

    manager.options.enable.force_save_lockfile = manager.options.enable.force_save_lockfile or
        changed_config_version or
        (load_result == .ok and
            // if migrated always save a new lockfile
            (load_result.ok.migrated != .none or

                // if loaded from binary and save-text-lockfile is passed
                (load_result.ok.format == .binary and
                    manager.options.save_text_lockfile orelse false)));

    // this defaults to false
    // but we force allowing updates to the lockfile when you do bun add
    var had_any_diffs = false;
    manager.progress = .{};

    switch (load_result) {
        .err => |cause| {
            if (log_level != .silent) {
                switch (cause.step) {
                    .open_file => Output.err(cause.value, "failed to open lockfile: '{s}'", .{
                        cause.lockfile_path,
                    }),
                    .parse_file => Output.err(cause.value, "failed to parse lockfile: '{s}'", .{
                        cause.lockfile_path,
                    }),
                    .read_file => Output.err(cause.value, "failed to read lockfile: '{s}'", .{
                        cause.lockfile_path,
                    }),
                    .migrating => Output.err(cause.value, "failed to migrate lockfile: '{s}'", .{
                        cause.lockfile_path,
                    }),
                }

                if (!manager.options.enable.fail_early) {
                    Output.printErrorln("", .{});
                    Output.warn("Ignoring lockfile", .{});
                }

                if (ctx.log.errors > 0) {
                    try manager.log.print(Output.errorWriter());
                    manager.log.reset();
                }
                Output.flush();
            }

            if (manager.options.enable.fail_early) Global.crash();
        },
        .ok => {
            if (manager.subcommand == .update) {
                // existing lockfile, get the original version is updating
                const lockfile = manager.lockfile;
                const packages = lockfile.packages.slice();
                const resolutions = packages.items(.resolution);
                const workspace_package_id = manager.root_package_id.get(lockfile, manager.workspace_name_hash);
                const workspace_dep_list = packages.items(.dependencies)[workspace_package_id];
                const workspace_res_list = packages.items(.resolutions)[workspace_package_id];
                const workspace_deps = workspace_dep_list.get(lockfile.buffers.dependencies.items);
                const workspace_package_ids = workspace_res_list.get(lockfile.buffers.resolutions.items);
                for (workspace_deps, workspace_package_ids) |dep, package_id| {
                    if (dep.version.tag != .npm and dep.version.tag != .dist_tag) continue;
                    if (package_id == invalid_package_id) continue;

                    if (manager.updating_packages.getPtr(dep.name.slice(lockfile.buffers.string_bytes.items))) |entry_ptr| {
                        const original_resolution: Resolution = resolutions[package_id];
                        // Just in case check if the resolution is `npm`. It should always be `npm` because the dependency version
                        // is `npm` or `dist_tag`.
                        if (original_resolution.tag != .npm) continue;

                        var original = original_resolution.value.npm.version;
                        const tag_total = original.tag.pre.len() + original.tag.build.len();
                        if (tag_total > 0) {
                            // clone because don't know if lockfile buffer will reallocate
                            const tag_buf = bun.handleOom(manager.allocator.alloc(u8, tag_total));
                            var ptr = tag_buf;
                            original.tag = original_resolution.value.npm.version.tag.cloneInto(
                                lockfile.buffers.string_bytes.items,
                                &ptr,
                            );

                            entry_ptr.original_version_string_buf = tag_buf;
                        }

                        entry_ptr.original_version = original;
                    }
                }
            }
            differ: {
                root = load_result.ok.lockfile.rootPackage() orelse {
                    needs_new_lockfile = true;
                    break :differ;
                };

                if (root.dependencies.len == 0) {
                    needs_new_lockfile = true;
                }

                if (needs_new_lockfile) break :differ;

                var lockfile: Lockfile = undefined;
                lockfile.initEmpty(manager.allocator);
                var maybe_root = Lockfile.Package{};

                const root_package_json_entry = switch (manager.workspace_package_json_cache.getWithPath(
                    manager.allocator,
                    manager.log,
                    root_package_json_path,
                    .{},
                )) {
                    .entry => |entry| entry,
                    .read_err => |err| {
                        if (ctx.log.errors > 0) {
                            try manager.log.print(Output.errorWriter());
                        }
                        Output.err(err, "failed to read '{s}'", .{root_package_json_path});
                        Global.exit(1);
                    },
                    .parse_err => |err| {
                        if (ctx.log.errors > 0) {
                            try manager.log.print(Output.errorWriter());
                        }
                        Output.err(err, "failed to parse '{s}'", .{root_package_json_path});
                        Global.exit(1);
                    },
                };

                const source_copy = root_package_json_entry.source;

                var resolver: void = {};
                try maybe_root.parse(
                    &lockfile,
                    manager,
                    manager.allocator,
                    manager.log,
                    &source_copy,
                    void,
                    &resolver,
                    Features.main,
                );
                const mapping = try manager.lockfile.allocator.alloc(PackageID, maybe_root.dependencies.len);
                @memset(mapping, invalid_package_id);

                manager.summary = try Package.Diff.generate(
                    manager,
                    manager.allocator,
                    manager.log,
                    manager.lockfile,
                    &lockfile,
                    &root,
                    &maybe_root,
                    if (manager.to_update) manager.update_requests else null,
                    mapping,
                );

                had_any_diffs = manager.summary.hasDiffs();

                if (!had_any_diffs) {
                    // always grab latest scripts for root package
                    var builder_ = manager.lockfile.stringBuilder();
                    var builder = &builder_;

                    maybe_root.scripts.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                    try builder.allocate();
                    manager.lockfile.packages.items(.scripts)[0] = maybe_root.scripts.clone(
                        lockfile.buffers.string_bytes.items,
                        *Lockfile.StringBuilder,
                        builder,
                    );
                    builder.clamp();
                } else {
                    var builder_ = manager.lockfile.stringBuilder();
                    // ensure we use one pointer to reference it instead of creating new ones and potentially aliasing
                    var builder = &builder_;
                    // If you changed packages, we will copy over the new package from the new lockfile
                    const new_dependencies = maybe_root.dependencies.get(lockfile.buffers.dependencies.items);

                    for (new_dependencies) |new_dep| {
                        new_dep.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                    }

                    for (lockfile.workspace_paths.values()) |path| builder.count(path.slice(lockfile.buffers.string_bytes.items));
                    for (lockfile.workspace_versions.values()) |version| version.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                    for (lockfile.patched_dependencies.values()) |patch_dep| builder.count(patch_dep.path.slice(lockfile.buffers.string_bytes.items));

                    lockfile.overrides.count(&lockfile, builder);
                    lockfile.catalogs.count(&lockfile, builder);
                    maybe_root.scripts.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);

                    const off = @as(u32, @truncate(manager.lockfile.buffers.dependencies.items.len));
                    const len = @as(u32, @truncate(new_dependencies.len));
                    var packages = manager.lockfile.packages.slice();
                    var dep_lists = packages.items(.dependencies);
                    var resolution_lists = packages.items(.resolutions);
                    const old_resolutions_list = resolution_lists[0];
                    dep_lists[0] = .{ .off = off, .len = len };
                    resolution_lists[0] = .{ .off = off, .len = len };
                    try builder.allocate();

                    const all_name_hashes: []PackageNameHash = brk: {
                        if (!manager.summary.overrides_changed) break :brk &.{};
                        const hashes_len = manager.lockfile.overrides.map.entries.len + lockfile.overrides.map.entries.len;
                        if (hashes_len == 0) break :brk &.{};
                        var all_name_hashes = try bun.default_allocator.alloc(PackageNameHash, hashes_len);
                        @memcpy(all_name_hashes[0..manager.lockfile.overrides.map.entries.len], manager.lockfile.overrides.map.keys());
                        @memcpy(all_name_hashes[manager.lockfile.overrides.map.entries.len..], lockfile.overrides.map.keys());
                        var i = manager.lockfile.overrides.map.entries.len;
                        while (i < all_name_hashes.len) {
                            if (std.mem.indexOfScalar(PackageNameHash, all_name_hashes[0..i], all_name_hashes[i]) != null) {
                                all_name_hashes[i] = all_name_hashes[all_name_hashes.len - 1];
                                all_name_hashes.len -= 1;
                            } else {
                                i += 1;
                            }
                        }
                        break :brk all_name_hashes;
                    };

                    manager.lockfile.overrides = try lockfile.overrides.clone(manager, &lockfile, manager.lockfile, builder);
                    manager.lockfile.catalogs = try lockfile.catalogs.clone(manager, &lockfile, manager.lockfile, builder);

                    manager.lockfile.trusted_dependencies = if (lockfile.trusted_dependencies) |trusted_dependencies|
                        try trusted_dependencies.clone(manager.lockfile.allocator)
                    else
                        null;

                    try manager.lockfile.buffers.dependencies.ensureUnusedCapacity(manager.lockfile.allocator, len);
                    try manager.lockfile.buffers.resolutions.ensureUnusedCapacity(manager.lockfile.allocator, len);

                    const old_resolutions = old_resolutions_list.get(manager.lockfile.buffers.resolutions.items);

                    var dependencies = manager.lockfile.buffers.dependencies.items.ptr[off .. off + len];
                    var resolutions = manager.lockfile.buffers.resolutions.items.ptr[off .. off + len];

                    // It is too easy to accidentally undefined memory
                    @memset(resolutions, invalid_package_id);
                    @memset(dependencies, Dependency{});

                    manager.lockfile.buffers.dependencies.items = manager.lockfile.buffers.dependencies.items.ptr[0 .. off + len];
                    manager.lockfile.buffers.resolutions.items = manager.lockfile.buffers.resolutions.items.ptr[0 .. off + len];

                    for (new_dependencies, 0..) |new_dep, i| {
                        dependencies[i] = try new_dep.clone(manager, lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                        if (mapping[i] != invalid_package_id) {
                            resolutions[i] = old_resolutions[mapping[i]];
                        }
                    }

                    manager.lockfile.packages.items(.scripts)[0] = maybe_root.scripts.clone(
                        lockfile.buffers.string_bytes.items,
                        *Lockfile.StringBuilder,
                        builder,
                    );

                    // Update workspace paths
                    try manager.lockfile.workspace_paths.ensureTotalCapacity(manager.lockfile.allocator, lockfile.workspace_paths.entries.len);
                    {
                        manager.lockfile.workspace_paths.clearRetainingCapacity();
                        var iter = lockfile.workspace_paths.iterator();
                        while (iter.next()) |entry| {
                            // The string offsets will be wrong so fix them
                            const path = entry.value_ptr.slice(lockfile.buffers.string_bytes.items);
                            const str = builder.append(String, path);
                            manager.lockfile.workspace_paths.putAssumeCapacity(entry.key_ptr.*, str);
                        }
                    }

                    // Update workspace versions
                    try manager.lockfile.workspace_versions.ensureTotalCapacity(manager.lockfile.allocator, lockfile.workspace_versions.entries.len);
                    {
                        manager.lockfile.workspace_versions.clearRetainingCapacity();
                        var iter = lockfile.workspace_versions.iterator();
                        while (iter.next()) |entry| {
                            // Copy version string offsets
                            const version = entry.value_ptr.append(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                            manager.lockfile.workspace_versions.putAssumeCapacity(entry.key_ptr.*, version);
                        }
                    }

                    // Update patched dependencies
                    {
                        var iter = lockfile.patched_dependencies.iterator();
                        while (iter.next()) |entry| {
                            const pkg_name_and_version_hash = entry.key_ptr.*;
                            bun.debugAssert(entry.value_ptr.patchfile_hash_is_null);
                            const gop = try manager.lockfile.patched_dependencies.getOrPut(manager.lockfile.allocator, pkg_name_and_version_hash);
                            if (!gop.found_existing) {
                                gop.value_ptr.* = .{
                                    .path = builder.append(String, entry.value_ptr.*.path.slice(lockfile.buffers.string_bytes.items)),
                                };
                                gop.value_ptr.setPatchfileHash(null);
                                // gop.value_ptr.path = gop.value_ptr.path;
                            } else if (!bun.strings.eql(
                                gop.value_ptr.path.slice(manager.lockfile.buffers.string_bytes.items),
                                entry.value_ptr.path.slice(lockfile.buffers.string_bytes.items),
                            )) {
                                gop.value_ptr.path = builder.append(String, entry.value_ptr.*.path.slice(lockfile.buffers.string_bytes.items));
                                gop.value_ptr.setPatchfileHash(null);
                            }
                        }

                        var count: usize = 0;
                        iter = manager.lockfile.patched_dependencies.iterator();
                        while (iter.next()) |entry| {
                            if (!lockfile.patched_dependencies.contains(entry.key_ptr.*)) {
                                count += 1;
                            }
                        }
                        if (count > 0) {
                            try manager.patched_dependencies_to_remove.ensureTotalCapacity(manager.allocator, count);
                            iter = manager.lockfile.patched_dependencies.iterator();
                            while (iter.next()) |entry| {
                                if (!lockfile.patched_dependencies.contains(entry.key_ptr.*)) {
                                    try manager.patched_dependencies_to_remove.put(manager.allocator, entry.key_ptr.*, {});
                                }
                            }
                            for (manager.patched_dependencies_to_remove.keys()) |hash| {
                                _ = manager.lockfile.patched_dependencies.orderedRemove(hash);
                            }
                        }
                    }

                    builder.clamp();

                    if (manager.summary.overrides_changed and all_name_hashes.len > 0) {
                        for (manager.lockfile.buffers.dependencies.items, 0..) |*dependency, dependency_i| {
                            if (std.mem.indexOfScalar(PackageNameHash, all_name_hashes, dependency.name_hash)) |_| {
                                manager.lockfile.buffers.resolutions.items[dependency_i] = invalid_package_id;
                                manager.enqueueDependencyWithMain(
                                    @truncate(dependency_i),
                                    dependency,
                                    invalid_package_id,
                                    false,
                                ) catch |err| {
                                    addDependencyError(manager, dependency, err);
                                };
                            }
                        }
                    }

                    if (manager.summary.catalogs_changed) {
                        for (manager.lockfile.buffers.dependencies.items, 0..) |*dep, _dep_id| {
                            const dep_id: DependencyID = @intCast(_dep_id);
                            if (dep.version.tag != .catalog) continue;

                            manager.lockfile.buffers.resolutions.items[dep_id] = invalid_package_id;
                            manager.enqueueDependencyWithMain(
                                dep_id,
                                dep,
                                invalid_package_id,
                                false,
                            ) catch |err| {
                                addDependencyError(manager, dep, err);
                            };
                        }
                    }

                    // Split this into two passes because the below may allocate memory or invalidate pointers
                    if (manager.summary.add > 0 or manager.summary.update > 0) {
                        const changes = @as(PackageID, @truncate(mapping.len));
                        var counter_i: PackageID = 0;

                        _ = manager.getCacheDirectory();
                        _ = manager.getTemporaryDirectory();

                        while (counter_i < changes) : (counter_i += 1) {
                            if (mapping[counter_i] == invalid_package_id) {
                                const dependency_i = counter_i + off;
                                const dependency = manager.lockfile.buffers.dependencies.items[dependency_i];
                                manager.enqueueDependencyWithMain(
                                    dependency_i,
                                    &dependency,
                                    manager.lockfile.buffers.resolutions.items[dependency_i],
                                    false,
                                ) catch |err| {
                                    addDependencyError(manager, &dependency, err);
                                };
                            }
                        }
                    }

                    if (manager.summary.update > 0) root.scripts = .{};
                }
            }
        },
        else => {},
    }

    if (needs_new_lockfile) {
        root = .{};
        manager.lockfile.initEmpty(manager.allocator);

        if (manager.options.enable.frozen_lockfile and load_result != .not_found) {
            if (log_level != .silent) {
                Output.prettyErrorln("<r><red>error<r>: lockfile had changes, but lockfile is frozen", .{});
            }
            Global.crash();
        }

        const root_package_json_entry = switch (manager.workspace_package_json_cache.getWithPath(
            manager.allocator,
            manager.log,
            root_package_json_path,
            .{},
        )) {
            .entry => |entry| entry,
            .read_err => |err| {
                if (ctx.log.errors > 0) {
                    try manager.log.print(Output.errorWriter());
                }
                Output.err(err, "failed to read '{s}'", .{root_package_json_path});
                Global.exit(1);
            },
            .parse_err => |err| {
                if (ctx.log.errors > 0) {
                    try manager.log.print(Output.errorWriter());
                }
                Output.err(err, "failed to parse '{s}'", .{root_package_json_path});
                Global.exit(1);
            },
        };

        const source_copy = root_package_json_entry.source;

        var resolver: void = {};
        try root.parse(
            manager.lockfile,
            manager,
            manager.allocator,
            manager.log,
            &source_copy,
            void,
            &resolver,
            Features.main,
        );

        root = try manager.lockfile.appendPackage(root);

        if (root.dependencies.len > 0) {
            _ = manager.getCacheDirectory();
            _ = manager.getTemporaryDirectory();
        }
        {
            var iter = manager.lockfile.patched_dependencies.iterator();
            while (iter.next()) |entry| manager.enqueuePatchTaskPre(PatchTask.newCalcPatchHash(manager, entry.key_ptr.*, null));
        }
        manager.enqueueDependencyList(root.dependencies);
    } else {
        {
            var iter = manager.lockfile.patched_dependencies.iterator();
            while (iter.next()) |entry| manager.enqueuePatchTaskPre(PatchTask.newCalcPatchHash(manager, entry.key_ptr.*, null));
        }
        // Anything that needs to be downloaded from an update needs to be scheduled here
        manager.drainDependencyList();
    }

    if (manager.pendingTaskCount() > 0 or manager.peer_dependencies.readableLength() > 0) {
        if (root.dependencies.len > 0) {
            _ = manager.getCacheDirectory();
            _ = manager.getTemporaryDirectory();
        }

        if (log_level.showProgress()) {
            manager.startProgressBar();
        } else if (log_level != .silent) {
            Output.prettyErrorln("Resolving dependencies", .{});
            Output.flush();
        }

        const runAndWaitFn = struct {
            pub fn runAndWaitFn(comptime check_peers: bool, comptime only_pre_patch: bool) *const fn (*PackageManager) anyerror!void {
                return struct {
                    manager: *PackageManager,
                    err: ?anyerror = null,
                    pub fn isDone(closure: *@This()) bool {
                        var this = closure.manager;
                        if (comptime check_peers)
                            this.processPeerDependencyList() catch |err| {
                                closure.err = err;
                                return true;
                            };

                        this.drainDependencyList();

                        this.runTasks(
                            *PackageManager,
                            this,
                            .{
                                .onExtract = {},
                                .onResolve = {},
                                .onPackageManifestError = {},
                                .onPackageDownloadError = {},
                                .progress_bar = true,
                            },
                            check_peers,
                            this.options.log_level,
                        ) catch |err| {
                            closure.err = err;
                            return true;
                        };

                        if (comptime check_peers) {
                            if (this.peer_dependencies.readableLength() > 0) {
                                return false;
                            }
                        }

                        if (comptime only_pre_patch) {
                            const pending_patch = this.pending_pre_calc_hashes.load(.monotonic);
                            return pending_patch == 0;
                        }

                        const pending_tasks = this.pendingTaskCount();

                        if (PackageManager.verbose_install and pending_tasks > 0) {
                            if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} tasks\n", .{pending_tasks});
                        }

                        return pending_tasks == 0;
                    }

                    pub fn runAndWait(this: *PackageManager) !void {
                        var closure = @This(){
                            .manager = this,
                        };

                        this.sleepUntil(&closure, &@This().isDone);

                        if (closure.err) |err| {
                            return err;
                        }
                    }
                }.runAndWait;
            }
        }.runAndWaitFn;

        const waitForCalcingPatchHashes = runAndWaitFn(false, true);
        const waitForEverythingExceptPeers = runAndWaitFn(false, false);
        const waitForPeers = runAndWaitFn(true, false);

        if (manager.lockfile.patched_dependencies.entries.len > 0) {
            try waitForCalcingPatchHashes(manager);
        }

        if (manager.pendingTaskCount() > 0) {
            try waitForEverythingExceptPeers(manager);
        }

        if (manager.peer_dependencies.readableLength() > 0) {
            try manager.processPeerDependencyList();
            manager.drainDependencyList();
        }

        if (manager.pendingTaskCount() > 0) {
            try waitForPeers(manager);
        }

        if (log_level.showProgress()) {
            manager.endProgressBar();
        } else if (log_level != .silent) {
            Output.prettyErrorln("Resolved, downloaded and extracted [{d}]", .{manager.total_tasks});
            Output.flush();
        }
    }

    const had_errors_before_cleaning_lockfile = manager.log.hasErrors();
    try manager.log.print(Output.errorWriter());
    manager.log.reset();

    // This operation doesn't perform any I/O, so it should be relatively cheap.
    const lockfile_before_clean = manager.lockfile;

    manager.lockfile = try manager.lockfile.cleanWithLogger(
        manager,
        manager.update_requests,
        manager.log,
        manager.options.enable.exact_versions,
        log_level,
    );

    if (manager.lockfile.packages.len > 0) {
        root = manager.lockfile.packages.get(0);
    }

    if (manager.lockfile.packages.len > 0) {
        for (manager.update_requests) |request| {
            // prevent redundant errors
            if (request.failed) {
                return error.InstallFailed;
            }
        }

        manager.verifyResolutions(log_level);

        if (manager.options.security_scanner != null) {
            const is_subcommand_to_run_scanner = manager.subcommand == .add or manager.subcommand == .update or manager.subcommand == .install or manager.subcommand == .remove;

            if (is_subcommand_to_run_scanner) {
                if (security_scanner.performSecurityScanAfterResolution(manager, ctx, original_cwd) catch |err| {
                    switch (err) {
                        error.SecurityScannerInWorkspace => {
                            Output.pretty("<red>Security scanner cannot be a dependency of a workspace package. It must be a direct dependency of the root package.<r>\n", .{});
                        },
                        else => {},
                    }

                    Global.exit(1);
                }) |results| {
                    defer {
                        var results_mut = results;
                        results_mut.deinit();
                    }

                    security_scanner.printSecurityAdvisories(manager, &results);

                    if (results.hasFatalAdvisories()) {
                        Output.pretty("<red>Installation aborted due to fatal security advisories<r>\n", .{});
                        Global.exit(1);
                    } else if (results.hasWarnings()) {
                        if (!security_scanner.promptForWarnings()) {
                            Global.exit(1);
                        }
                    }
                }
            }
        }
    }

    // append scripts to lockfile before generating new metahash
    manager.loadRootLifecycleScripts(root);
    defer {
        if (manager.root_lifecycle_scripts) |root_scripts| {
            manager.allocator.free(root_scripts.package_name);
        }
    }

    if (manager.root_lifecycle_scripts) |root_scripts| {
        root_scripts.appendToLockfile(manager.lockfile);
    }
    {
        const packages = manager.lockfile.packages.slice();
        for (packages.items(.resolution), packages.items(.meta), packages.items(.scripts)) |resolution, meta, scripts| {
            if (resolution.tag == .workspace) {
                if (meta.hasInstallScript()) {
                    if (scripts.hasAny()) {
                        const first_index, _, const entries = scripts.getScriptEntries(
                            manager.lockfile,
                            manager.lockfile.buffers.string_bytes.items,
                            .workspace,
                            false,
                        );

                        if (comptime Environment.allow_assert) {
                            bun.assert(first_index != -1);
                        }

                        if (first_index != -1) {
                            inline for (entries, 0..) |maybe_entry, i| {
                                if (maybe_entry) |entry| {
                                    @field(manager.lockfile.scripts, Lockfile.Scripts.names[i]).append(
                                        manager.lockfile.allocator,
                                        entry,
                                    ) catch |err| bun.handleOom(err);
                                }
                            }
                        }
                    } else {
                        const first_index, _, const entries = scripts.getScriptEntries(
                            manager.lockfile,
                            manager.lockfile.buffers.string_bytes.items,
                            .workspace,
                            true,
                        );

                        if (comptime Environment.allow_assert) {
                            bun.assert(first_index != -1);
                        }

                        inline for (entries, 0..) |maybe_entry, i| {
                            if (maybe_entry) |entry| {
                                @field(manager.lockfile.scripts, Lockfile.Scripts.names[i]).append(
                                    manager.lockfile.allocator,
                                    entry,
                                ) catch |err| bun.handleOom(err);
                            }
                        }
                    }
                }
            }
        }
    }

    if (manager.options.global) {
        try manager.setupGlobalDir(ctx);
    }

    const packages_len_before_install = manager.lockfile.packages.len;

    if (manager.options.enable.frozen_lockfile and load_result != .not_found) frozen_lockfile: {
        if (load_result.loadedFromTextLockfile()) {
            if (bun.handleOom(manager.lockfile.eql(lockfile_before_clean, packages_len_before_install, manager.allocator))) {
                break :frozen_lockfile;
            }
        } else {
            if (!(manager.lockfile.hasMetaHashChanged(PackageManager.verbose_install or manager.options.do.print_meta_hash_string, packages_len_before_install) catch false)) {
                break :frozen_lockfile;
            }
        }

        if (log_level != .silent) {
            Output.prettyErrorln("<r><red>error<r><d>:<r> lockfile had changes, but lockfile is frozen", .{});
            Output.note("try re-running without <d>--frozen-lockfile<r> and commit the updated lockfile", .{});
        }
        Global.crash();
    }

    const lockfile_before_install = manager.lockfile;

    const save_format = load_result.saveFormat(&manager.options);

    if (manager.options.lockfile_only) {
        // save the lockfile and exit. make sure metahash is generated for binary lockfile

        manager.lockfile.meta_hash = try manager.lockfile.generateMetaHash(
            PackageManager.verbose_install or manager.options.do.print_meta_hash_string,
            packages_len_before_install,
        );

        try manager.saveLockfile(&load_result, save_format, had_any_diffs, lockfile_before_install, packages_len_before_install, log_level);

        if (manager.options.do.summary) {
            // TODO(dylan-conway): packages aren't installed but we can still print
            // added/removed/updated direct dependencies.
            Output.pretty("\nSaved <green>{s}<r> ({d} package{s}) ", .{
                switch (save_format) {
                    .text => "bun.lock",
                    .binary => "bun.lockb",
                },
                manager.lockfile.packages.len,
                if (manager.lockfile.packages.len == 1) "" else "s",
            });
            Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
            Output.pretty("\n", .{});
        }
        Output.flush();
        return;
    }

    const workspace_filters, const install_root_dependencies = (try getWorkspaceFilters(manager, original_cwd));
    defer manager.allocator.free(workspace_filters);

    const install_summary: PackageInstall.Summary = install_summary: {
        if (!manager.options.do.install_packages) {
            break :install_summary .{};
        }

        linker: switch (manager.options.node_linker) {
            .auto => {
                switch (config_version) {
                    .v0 => continue :linker .hoisted,
                    .v1 => {
                        if (!load_result.migratedFromNpm() and manager.lockfile.workspace_paths.count() > 0) {
                            continue :linker .isolated;
                        }
                        continue :linker .hoisted;
                    },
                }
            },

            .hoisted,
            => break :install_summary try installHoistedPackages(
                manager,
                ctx,
                workspace_filters,
                install_root_dependencies,
                log_level,
                null,
            ),

            .isolated,
            => break :install_summary bun.handleOom(installIsolatedPackages(
                manager,
                ctx,
                install_root_dependencies,
                workspace_filters,
                null,
            )),
        }
    };

    if (log_level != .silent) {
        try manager.log.print(Output.errorWriter());
    }
    if (had_errors_before_cleaning_lockfile or manager.log.hasErrors()) Global.crash();

    const did_meta_hash_change =
        // If the lockfile was frozen, we already checked it
        !manager.options.enable.frozen_lockfile and
        if (load_result.loadedFromTextLockfile())
            !try manager.lockfile.eql(lockfile_before_clean, packages_len_before_install, manager.allocator)
        else
            try manager.lockfile.hasMetaHashChanged(
                PackageManager.verbose_install or manager.options.do.print_meta_hash_string,
                @min(packages_len_before_install, manager.lockfile.packages.len),
            );

    // It's unnecessary work to re-save the lockfile if there are no changes
    const should_save_lockfile =
        (load_result == .ok and ((load_result.ok.format == .binary and save_format == .text) or

            // make sure old versions are updated
            load_result.ok.format == .text and save_format == .text and manager.lockfile.text_lockfile_version != TextLockfile.Version.current)) or

        // check `save_lockfile` after checking if loaded from binary and save format is text
        // because `save_lockfile` is set to false for `--frozen-lockfile`
        (manager.options.do.save_lockfile and
            (did_meta_hash_change or
                had_any_diffs or
                manager.update_requests.len > 0 or
                (load_result == .ok and (load_result.ok.serializer_result.packages_need_update or load_result.ok.serializer_result.migrated_from_lockb_v2)) or
                manager.lockfile.isEmpty() or
                manager.options.enable.force_save_lockfile));

    if (should_save_lockfile) {
        try manager.saveLockfile(&load_result, save_format, had_any_diffs, lockfile_before_install, packages_len_before_install, log_level);
    }

    if (needs_new_lockfile) {
        manager.summary.add = @as(u32, @truncate(manager.lockfile.packages.len));
    }

    if (manager.options.do.save_yarn_lock) {
        var node: *Progress.Node = undefined;
        if (log_level.showProgress()) {
            manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
            node = manager.progress.start("Saving yarn.lock", 0);
            manager.progress.refresh();
        } else if (log_level != .silent) {
            Output.prettyErrorln("Saved yarn.lock", .{});
            Output.flush();
        }

        try manager.writeYarnLock();
        if (log_level.showProgress()) {
            node.completeOne();
            manager.progress.refresh();
            manager.progress.root.end();
            manager.progress = .{};
        }
    }

    if (manager.options.do.run_scripts and install_root_dependencies and !manager.options.global) {
        if (manager.root_lifecycle_scripts) |scripts| {
            if (comptime Environment.allow_assert) {
                bun.assert(scripts.total > 0);
            }

            if (log_level != .silent) {
                Output.printError("\n", .{});
                Output.flush();
            }
            // root lifecycle scripts can run now that all dependencies are installed, dependency scripts
            // have finished, and lockfiles have been saved
            const optional = false;
            const output_in_foreground = true;
            try manager.spawnPackageLifecycleScripts(ctx, scripts, optional, output_in_foreground, null);

            // .monotonic is okay because at this point, this value is only accessed from this
            // thread.
            while (manager.pending_lifecycle_script_tasks.load(.monotonic) > 0) {
                manager.reportSlowLifecycleScripts();
                manager.sleep();
            }
        }
    }

    if (log_level != .silent) {
        try printInstallSummary(manager, ctx, &install_summary, did_meta_hash_change, log_level);
    }

    if (install_summary.fail > 0) {
        manager.any_failed_to_install = true;
    }

    Output.flush();
}

fn printInstallSummary(
    this: *PackageManager,
    ctx: Command.Context,
    install_summary: *const PackageInstall.Summary,
    did_meta_hash_change: bool,
    log_level: Options.LogLevel,
) !void {
    defer Output.flush();

    var printed_timestamp = false;
    if (this.options.do.summary) {
        var printer = Lockfile.Printer{
            .lockfile = this.lockfile,
            .options = this.options,
            .updates = this.update_requests,
            .successfully_installed = install_summary.successfully_installed,
        };

        {
            Output.flush();
            // Ensure at this point buffering is enabled.
            // We deliberately do not disable it after this.
            Output.enableBuffering();
            const writer = Output.writerBuffered();
            switch (Output.enable_ansi_colors_stdout) {
                inline else => |enable_ansi_colors| {
                    try Lockfile.Printer.Tree.print(&printer, this, @TypeOf(writer), writer, enable_ansi_colors, log_level);
                },
            }
        }

        if (!did_meta_hash_change) {
            this.summary.remove = 0;
            this.summary.add = 0;
            this.summary.update = 0;
        }

        if (install_summary.success > 0) {
            // it's confusing when it shows 3 packages and says it installed 1
            const pkgs_installed = @max(
                install_summary.success,
                @as(
                    u32,
                    @truncate(this.update_requests.len),
                ),
            );
            Output.pretty("<green>{d}<r> package{s}<r> installed ", .{ pkgs_installed, if (pkgs_installed == 1) "" else "s" });
            Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
            printed_timestamp = true;
            printBlockedPackagesInfo(install_summary, this.options.global);

            if (this.summary.remove > 0) {
                Output.pretty("Removed: <cyan>{d}<r>\n", .{this.summary.remove});
            }
        } else if (this.summary.remove > 0) {
            if (this.subcommand == .remove) {
                for (this.update_requests) |request| {
                    Output.prettyln("<r><red>-<r> {s}", .{request.name});
                }
            }

            Output.pretty("<r><b>{d}<r> package{s} removed ", .{ this.summary.remove, if (this.summary.remove == 1) "" else "s" });
            Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
            printed_timestamp = true;
            printBlockedPackagesInfo(install_summary, this.options.global);
        } else if (install_summary.skipped > 0 and install_summary.fail == 0 and this.update_requests.len == 0) {
            const count = @as(PackageID, @truncate(this.lockfile.packages.len));
            if (count != install_summary.skipped) {
                if (!this.options.enable.only_missing) {
                    Output.pretty("Checked <green>{d} install{s}<r> across {d} package{s} <d>(no changes)<r> ", .{
                        install_summary.skipped,
                        if (install_summary.skipped == 1) "" else "s",
                        count,
                        if (count == 1) "" else "s",
                    });
                    Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                }
                printed_timestamp = true;
                printBlockedPackagesInfo(install_summary, this.options.global);
            } else {
                Output.pretty("<r><green>Done<r>! Checked {d} package{s}<r> <d>(no changes)<r> ", .{
                    install_summary.skipped,
                    if (install_summary.skipped == 1) "" else "s",
                });
                Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                printed_timestamp = true;
                printBlockedPackagesInfo(install_summary, this.options.global);
            }
        }

        if (install_summary.fail > 0) {
            Output.prettyln("<r>Failed to install <red><b>{d}<r> package{s}\n", .{ install_summary.fail, if (install_summary.fail == 1) "" else "s" });
            Output.flush();
        }
    }

    if (this.options.do.summary) {
        if (!printed_timestamp) {
            Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
            Output.prettyln("<d> done<r>", .{});
            printed_timestamp = true;
        }
    }
}

fn printBlockedPackagesInfo(summary: *const PackageInstall.Summary, global: bool) void {
    const packages_count = summary.packages_with_blocked_scripts.count();
    var scripts_count: usize = 0;
    for (summary.packages_with_blocked_scripts.values()) |count| scripts_count += count;

    if (comptime Environment.allow_assert) {
        // if packages_count is greater than 0, scripts_count must also be greater than 0.
        bun.assert(packages_count == 0 or scripts_count > 0);
        // if scripts_count is 1, it's only possible for packages_count to be 1.
        bun.assert(scripts_count != 1 or packages_count == 1);
    }

    if (packages_count > 0) {
        Output.prettyln("\n\n<d>Blocked {d} postinstall{s}. Run `bun pm {s}untrusted` for details.<r>\n", .{
            scripts_count,
            if (scripts_count > 1) "s" else "",
            if (global) "-g " else "",
        });
    } else {
        Output.pretty("<r>\n", .{});
    }
}

pub fn getWorkspaceFilters(manager: *PackageManager, original_cwd: []const u8) !struct {
    []const WorkspaceFilter,
    bool,
} {
    const path_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(path_buf);

    var workspace_filters: std.ArrayListUnmanaged(WorkspaceFilter) = .{};
    // only populated when subcommand is `.install`
    if (manager.subcommand == .install and manager.options.filter_patterns.len > 0) {
        try workspace_filters.ensureUnusedCapacity(manager.allocator, manager.options.filter_patterns.len);
        for (manager.options.filter_patterns) |pattern| {
            try workspace_filters.append(manager.allocator, try WorkspaceFilter.init(manager.allocator, pattern, original_cwd, path_buf[0..]));
        }
    }

    var install_root_dependencies = workspace_filters.items.len == 0;
    if (!install_root_dependencies) {
        const pkg_names = manager.lockfile.packages.items(.name);

        const abs_root_path = abs_root_path: {
            if (comptime !Environment.isWindows) {
                break :abs_root_path strings.withoutTrailingSlash(FileSystem.instance.top_level_dir);
            }

            var abs_path = Path.pathToPosixBuf(u8, FileSystem.instance.top_level_dir, path_buf);
            break :abs_root_path strings.withoutTrailingSlash(abs_path[Path.windowsVolumeNameLen(abs_path)[0]..]);
        };

        for (workspace_filters.items) |filter| {
            const pattern, const path_or_name = switch (filter) {
                .name => |pattern| .{ pattern, pkg_names[0].slice(manager.lockfile.buffers.string_bytes.items) },
                .path => |pattern| .{ pattern, abs_root_path },
                .all => {
                    install_root_dependencies = true;
                    continue;
                },
            };

            switch (bun.glob.match(pattern, path_or_name)) {
                .match, .negate_match => install_root_dependencies = true,

                .negate_no_match => {
                    // always skip if a pattern specifically says "!<name>"
                    install_root_dependencies = false;
                    break;
                },

                .no_match => {},
            }
        }
    }

    return .{ workspace_filters.items, install_root_dependencies };
}

/// Adds a contextual error for a dependency resolution failure.
/// This provides better error messages than just propagating the raw error.
/// The error is logged to manager.log, and the install will fail later when
/// manager.log.hasErrors() is checked.
fn addDependencyError(manager: *PackageManager, dependency: *const Dependency, err: anyerror) void {
    const lockfile = manager.lockfile;
    const note = .{
        .fmt = "error occurred while resolving {f}",
        .args = .{bun.fmt.fmtPath(u8, lockfile.str(&dependency.realname()), .{
            .path_sep = switch (dependency.version.tag) {
                .folder => .auto,
                else => .any,
            },
        })},
    };

    if (dependency.behavior.isOptional() or dependency.behavior.isPeer())
        manager.log.addWarningWithNote(null, .{}, manager.allocator, @errorName(err), note.fmt, note.args) catch unreachable
    else
        manager.log.addZigErrorWithNote(manager.allocator, err, note.fmt, note.args) catch unreachable;
}

const security_scanner = @import("./security_scanner.zig");
const std = @import("std");
const installHoistedPackages = @import("../hoisted_install.zig").installHoistedPackages;
const installIsolatedPackages = @import("../isolated_install.zig").installIsolatedPackages;

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const Path = bun.path;
const Progress = bun.Progress;
const default_allocator = bun.default_allocator;
const strings = bun.strings;
const Command = bun.cli.Command;

const Semver = bun.Semver;
const String = Semver.String;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const Dependency = bun.install.Dependency;
const DependencyID = bun.install.DependencyID;
const Features = bun.install.Features;
const PackageID = bun.install.PackageID;
const PackageInstall = bun.install.PackageInstall;
const PackageNameHash = bun.install.PackageNameHash;
const PatchTask = bun.install.PatchTask;
const Resolution = bun.install.Resolution;
const TextLockfile = bun.install.TextLockfile;
const invalid_package_id = bun.install.invalid_package_id;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;

const PackageManager = bun.install.PackageManager;
const Options = PackageManager.Options;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
