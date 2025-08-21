pub fn installWithManager(
    manager: *PackageManager,
    ctx: Command.Context,
    root_package_json_contents: string,
    original_cwd: string,
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

    var root = Lockfile.Package{};
    var needs_new_lockfile = load_result != .ok or
        (load_result.ok.lockfile.buffers.dependencies.items.len == 0 and manager.update_requests.len > 0);

    manager.options.enable.force_save_lockfile = manager.options.enable.force_save_lockfile or
        (load_result == .ok and
            // if migrated always save a new lockfile
            (load_result.ok.was_migrated or

                // if loaded from binary and save-text-lockfile is passed
                (load_result.ok.format == .binary and
                    manager.options.save_text_lockfile orelse false)));

    // this defaults to false
    // but we force allowing updates to the lockfile when you do bun add
    var had_any_diffs = false;
    manager.progress = .{};

    // Step 2. Parse the package.json file
    const root_package_json_source = &logger.Source.initPathString(PackageManager.package_json_cwd, root_package_json_contents);

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
                            const tag_buf = manager.allocator.alloc(u8, tag_total) catch bun.outOfMemory();
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

                var resolver: void = {};
                try maybe_root.parse(
                    &lockfile,
                    manager,
                    manager.allocator,
                    manager.log,
                    root_package_json_source,
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
                                try manager.enqueueDependencyWithMain(
                                    @truncate(dependency_i),
                                    dependency,
                                    invalid_package_id,
                                    false,
                                );
                            }
                        }
                    }

                    if (manager.summary.catalogs_changed) {
                        for (manager.lockfile.buffers.dependencies.items, 0..) |*dep, _dep_id| {
                            const dep_id: DependencyID = @intCast(_dep_id);
                            if (dep.version.tag != .catalog) continue;

                            manager.lockfile.buffers.resolutions.items[dep_id] = invalid_package_id;
                            try manager.enqueueDependencyWithMain(
                                dep_id,
                                dep,
                                invalid_package_id,
                                false,
                            );
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
                                try manager.enqueueDependencyWithMain(
                                    dependency_i,
                                    &dependency,
                                    manager.lockfile.buffers.resolutions.items[dependency_i],
                                    false,
                                );
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

        var resolver: void = {};
        try root.parse(
            manager.lockfile,
            manager,
            manager.allocator,
            manager.log,
            root_package_json_source,
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

        try waitForPeers(manager);

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

        if (manager.subcommand == .add and manager.options.security_provider != null) {
            try performSecurityScanAfterResolution(manager);
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
                                    ) catch bun.outOfMemory();
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
                                ) catch bun.outOfMemory();
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
            if (manager.lockfile.eql(lockfile_before_clean, packages_len_before_install, manager.allocator) catch bun.outOfMemory()) {
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

    var path_buf: bun.PathBuffer = undefined;
    var workspace_filters: std.ArrayListUnmanaged(WorkspaceFilter) = .{};
    // only populated when subcommand is `.install`
    if (manager.subcommand == .install and manager.options.filter_patterns.len > 0) {
        try workspace_filters.ensureUnusedCapacity(manager.allocator, manager.options.filter_patterns.len);
        for (manager.options.filter_patterns) |pattern| {
            try workspace_filters.append(manager.allocator, try WorkspaceFilter.init(manager.allocator, pattern, original_cwd, &path_buf));
        }
    }
    defer workspace_filters.deinit(manager.allocator);

    var install_root_dependencies = workspace_filters.items.len == 0;
    if (!install_root_dependencies) {
        const pkg_names = manager.lockfile.packages.items(.name);

        const abs_root_path = abs_root_path: {
            if (comptime !Environment.isWindows) {
                break :abs_root_path strings.withoutTrailingSlash(FileSystem.instance.top_level_dir);
            }

            var abs_path = Path.pathToPosixBuf(u8, FileSystem.instance.top_level_dir, &path_buf);
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

            switch (bun.glob.walk.matchImpl(manager.allocator, pattern, path_or_name)) {
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

    const install_summary: PackageInstall.Summary = install_summary: {
        if (!manager.options.do.install_packages) {
            break :install_summary .{};
        }

        switch (manager.options.node_linker) {
            .hoisted,
            // TODO
            .auto,
            => break :install_summary try installHoistedPackages(
                manager,
                ctx,
                workspace_filters.items,
                install_root_dependencies,
                log_level,
            ),

            .isolated => break :install_summary installIsolatedPackages(
                manager,
                ctx,
                install_root_dependencies,
                workspace_filters.items,
            ) catch |err| switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            },
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
                (load_result == .ok and load_result.ok.serializer_result.packages_need_update) or
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
            switch (Output.enable_ansi_colors) {
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

const string = []const u8;

const PackagePath = struct {
    pkg_path: []PackageID,
    dep_path: []DependencyID,
};

fn performSecurityScanAfterResolution(manager: *PackageManager) !void {
    const security_provider = manager.options.security_provider orelse return;

    if (manager.options.dry_run or !manager.options.do.install_packages) return;
    if (manager.update_requests.len == 0) {
        Output.prettyErrorln("No update requests to scan", .{});
        return;
    }

    if (manager.options.log_level == .verbose) {
        Output.prettyErrorln("<d>[SecurityProvider]<r> Running at '{s}'", .{security_provider});
    }
    const start_time = std.time.milliTimestamp();

    var pkg_dedupe: std.AutoArrayHashMap(PackageID, void) = .init(bun.default_allocator);
    defer pkg_dedupe.deinit();

    const QueueItem = struct {
        pkg_id: PackageID,
        dep_id: DependencyID,
        pkg_path: std.ArrayList(PackageID),
        dep_path: std.ArrayList(DependencyID),
    };
    var ids_queue: std.fifo.LinearFifo(QueueItem, .Dynamic) = .init(bun.default_allocator);
    defer ids_queue.deinit();

    var package_paths = std.AutoArrayHashMap(PackageID, PackagePath).init(manager.allocator);
    defer {
        var iter = package_paths.iterator();
        while (iter.next()) |entry| {
            manager.allocator.free(entry.value_ptr.pkg_path);
            manager.allocator.free(entry.value_ptr.dep_path);
        }
        package_paths.deinit();
    }

    const pkgs = manager.lockfile.packages.slice();
    const pkg_names = pkgs.items(.name);
    const pkg_resolutions = pkgs.items(.resolution);
    const pkg_dependencies = pkgs.items(.dependencies);

    for (manager.update_requests) |req| {
        for (0..pkgs.len) |_update_pkg_id| {
            const update_pkg_id: PackageID = @intCast(_update_pkg_id);

            if (update_pkg_id != req.package_id) {
                continue;
            }

            if (pkg_resolutions[update_pkg_id].tag != .npm) {
                continue;
            }

            var update_dep_id: DependencyID = invalid_dependency_id;
            var parent_pkg_id: PackageID = invalid_package_id;

            for (0..pkgs.len) |_pkg_id| update_dep_id: {
                const pkg_id: PackageID = @intCast(_pkg_id);

                const pkg_res = pkg_resolutions[pkg_id];

                if (pkg_res.tag != .root and pkg_res.tag != .workspace) {
                    continue;
                }

                const pkg_deps = pkg_dependencies[pkg_id];
                for (pkg_deps.begin()..pkg_deps.end()) |_dep_id| {
                    const dep_id: DependencyID = @intCast(_dep_id);

                    const dep_pkg_id = manager.lockfile.buffers.resolutions.items[dep_id];

                    if (dep_pkg_id == invalid_package_id) {
                        continue;
                    }

                    if (dep_pkg_id != update_pkg_id) {
                        continue;
                    }

                    update_dep_id = dep_id;
                    parent_pkg_id = pkg_id;
                    break :update_dep_id;
                }
            }

            if (update_dep_id == invalid_dependency_id) {
                continue;
            }

            if ((try pkg_dedupe.getOrPut(update_pkg_id)).found_existing) {
                continue;
            }

            var initial_pkg_path = std.ArrayList(PackageID).init(manager.allocator);
            // If this is a direct dependency from root, start with root package
            if (parent_pkg_id != invalid_package_id) {
                try initial_pkg_path.append(parent_pkg_id);
            }
            try initial_pkg_path.append(update_pkg_id);
            var initial_dep_path = std.ArrayList(DependencyID).init(manager.allocator);
            try initial_dep_path.append(update_dep_id);

            try ids_queue.writeItem(.{
                .pkg_id = update_pkg_id,
                .dep_id = update_dep_id,
                .pkg_path = initial_pkg_path,
                .dep_path = initial_dep_path,
            });
        }
    }

    // For new packages being added via 'bun add', we just scan the update requests directly
    // since they haven't been added to the lockfile yet

    var json_buf = std.ArrayList(u8).init(manager.allocator);
    var writer = json_buf.writer();
    defer json_buf.deinit();

    const string_buf = manager.lockfile.buffers.string_bytes.items;

    try writer.writeAll("[\n");

    var first = true;

    while (ids_queue.readItem()) |item| {
        defer item.pkg_path.deinit();
        defer item.dep_path.deinit();

        const pkg_id = item.pkg_id;
        const dep_id = item.dep_id;

        const pkg_path_copy = try manager.allocator.alloc(PackageID, item.pkg_path.items.len);
        @memcpy(pkg_path_copy, item.pkg_path.items);

        const dep_path_copy = try manager.allocator.alloc(DependencyID, item.dep_path.items.len);
        @memcpy(dep_path_copy, item.dep_path.items);

        try package_paths.put(pkg_id, .{
            .pkg_path = pkg_path_copy,
            .dep_path = dep_path_copy,
        });

        const pkg_name = pkg_names[pkg_id];
        const pkg_res = pkg_resolutions[pkg_id];
        const dep_version = manager.lockfile.buffers.dependencies.items[dep_id].version;

        if (!first) try writer.writeAll(",\n");

        try writer.print(
            \\  {{
            \\    "name": {},
            \\    "version": "{s}",
            \\    "requestedRange": {},
            \\    "tarball": {}
            \\  }}
        , .{ bun.fmt.formatJSONStringUTF8(pkg_name.slice(string_buf), .{}), pkg_res.value.npm.version.fmt(string_buf), bun.fmt.formatJSONStringUTF8(dep_version.literal.slice(string_buf), .{}), bun.fmt.formatJSONStringUTF8(pkg_res.value.npm.url.slice(string_buf), .{}) });

        first = false;

        // then go through it's dependencies and queue them up if
        // valid and first time we've seen them
        const pkg_deps = pkg_dependencies[pkg_id];

        for (pkg_deps.begin()..pkg_deps.end()) |_next_dep_id| {
            const next_dep_id: DependencyID = @intCast(_next_dep_id);

            const next_pkg_id = manager.lockfile.buffers.resolutions.items[next_dep_id];
            if (next_pkg_id == invalid_package_id) {
                continue;
            }

            const next_pkg_res = pkg_resolutions[next_pkg_id];
            if (next_pkg_res.tag != .npm) {
                continue;
            }

            if ((try pkg_dedupe.getOrPut(next_pkg_id)).found_existing) {
                continue;
            }

            var extended_pkg_path = std.ArrayList(PackageID).init(manager.allocator);
            try extended_pkg_path.appendSlice(item.pkg_path.items);
            try extended_pkg_path.append(next_pkg_id);

            var extended_dep_path = std.ArrayList(DependencyID).init(manager.allocator);
            try extended_dep_path.appendSlice(item.dep_path.items);
            try extended_dep_path.append(next_dep_id);

            try ids_queue.writeItem(.{
                .pkg_id = next_pkg_id,
                .dep_id = next_dep_id,
                .pkg_path = extended_pkg_path,
                .dep_path = extended_dep_path,
            });
        }
    }

    try writer.writeAll("\n]");

    var code_buf = std.ArrayList(u8).init(manager.allocator);
    defer code_buf.deinit();
    var code_writer = code_buf.writer();

    try code_writer.print(
        \\try {{
        \\  const {{provider}} = await import('{s}');
        \\  const packages = {s};
        \\
        \\  if (provider.version !== '1') {{
        \\    throw new Error('Security provider must be version 1');
        \\  }}
        \\
        \\  if (typeof provider.scan !== 'function') {{
        \\    throw new Error('provider.scan is not a function');
        \\  }}
        \\
        \\  const result = await provider.scan({{packages:packages}});
        \\
        \\  if (!Array.isArray(result)) {{
        \\    throw new Error('Security provider must return an array of advisories');
        \\  }}
        \\
        \\  const fs = require('fs');
        \\  const data = JSON.stringify({{advisories: result}});
        \\  fs.writeSync(3, data);
        \\  fs.closeSync(3);
        \\
        \\  process.exit(0);
        \\}} catch (error) {{
        \\  console.error(error);
        \\  process.exit(1);
        \\}}
    , .{ security_provider, json_buf.items });

    var scanner = SecurityScanSubprocess.new(.{
        .manager = manager,
        .code = try manager.allocator.dupe(u8, code_buf.items),
        .json_data = try manager.allocator.dupe(u8, json_buf.items),
        .ipc_data = undefined,
        .stderr_data = undefined,
    });

    defer {
        manager.allocator.free(scanner.code);
        manager.allocator.free(scanner.json_data);
        bun.destroy(scanner);
    }

    try scanner.spawn();

    var progress_node: ?*Progress.Node = null;
    if (manager.options.log_level != .verbose and manager.options.log_level != .silent) {
        manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
        const scanner_name = if (Output.isEmojiEnabled()) "  👮 Scanning packages with security provider" else "Scanning packages with security provider";
        progress_node = manager.progress.start(scanner_name, 0);
        if (progress_node) |node| {
            node.activate();
            manager.progress.refresh();
        }
    }

    var closure = struct {
        scanner: *SecurityScanSubprocess,

        pub fn isDone(this: *@This()) bool {
            return this.scanner.isDone();
        }
    }{ .scanner = scanner };

    manager.sleepUntil(&closure, &@TypeOf(closure).isDone);

    if (progress_node) |node| {
        node.end();
        manager.progress.refresh();
        manager.progress.root.end();
        manager.progress = .{};
    }

    const packages_scanned = pkg_dedupe.count();
    try scanner.handleResults(&package_paths, start_time, packages_scanned, security_provider);
}

const SecurityAdvisoryLevel = enum { fatal, warn };

const SecurityAdvisory = struct {
    level: SecurityAdvisoryLevel,
    package: []const u8,
    url: ?[]const u8,
    description: ?[]const u8,
};

pub const SecurityScanSubprocess = struct {
    manager: *PackageManager,
    code: []const u8,
    json_data: []const u8,
    process: ?*bun.spawn.Process = null,
    ipc_reader: bun.io.BufferedReader = bun.io.BufferedReader.init(@This()),
    ipc_data: std.ArrayList(u8),
    stderr_data: std.ArrayList(u8),
    has_process_exited: bool = false,
    has_received_ipc: bool = false,
    exit_status: ?bun.spawn.Status = null,
    remaining_fds: i8 = 0,

    pub const new = bun.TrivialNew(@This());

    pub fn spawn(this: *SecurityScanSubprocess) !void {
        this.ipc_data = std.ArrayList(u8).init(this.manager.allocator);
        this.stderr_data = std.ArrayList(u8).init(this.manager.allocator);
        this.ipc_reader.setParent(this);

        const pipe_result = bun.sys.pipe();
        const pipe_fds = switch (pipe_result) {
            .err => |err| {
                Output.errGeneric("Failed to create IPC pipe: {s}", .{@tagName(err.getErrno())});
                Global.exit(1);
            },
            .result => |fds| fds,
        };

        const exec_path = try bun.selfExePath();

        var argv = [_]?[*:0]const u8{
            try this.manager.allocator.dupeZ(u8, exec_path),
            "-e",
            try this.manager.allocator.dupeZ(u8, this.code),
            null,
        };
        defer {
            this.manager.allocator.free(bun.span(argv[0].?));
            this.manager.allocator.free(bun.span(argv[2].?));
        }

        const spawn_options = bun.spawn.SpawnOptions{
            .stdout = .inherit,
            .stderr = .inherit,
            .stdin = .inherit,
            .cwd = FileSystem.instance.top_level_dir,
            .extra_fds = &.{.{ .pipe = pipe_fds[1] }},
            .windows = if (Environment.isWindows) .{
                .loop = jsc.EventLoopHandle.init(&this.manager.event_loop),
            },
        };

        var spawned = try (try bun.spawn.spawnProcess(&spawn_options, @ptrCast(&argv), @ptrCast(std.os.environ.ptr))).unwrap();

        pipe_fds[1].close();

        if (comptime bun.Environment.isPosix) {
            _ = bun.sys.setNonblocking(pipe_fds[0]);
        }
        this.remaining_fds = 1;
        this.ipc_reader.flags.nonblocking = true;
        if (comptime bun.Environment.isPosix) {
            this.ipc_reader.flags.socket = false;
        }
        try this.ipc_reader.start(pipe_fds[0], true).unwrap();

        var process = spawned.toProcess(&this.manager.event_loop, false);
        this.process = process;
        process.setExitHandler(this);

        switch (process.watchOrReap()) {
            .err => |err| {
                Output.errGeneric("Failed to watch security scanner process: {}", .{err});
                Global.exit(1);
            },
            .result => {},
        }
    }

    pub fn isDone(this: *SecurityScanSubprocess) bool {
        return this.has_process_exited and this.remaining_fds == 0;
    }

    pub fn eventLoop(this: *const SecurityScanSubprocess) *jsc.AnyEventLoop {
        return &this.manager.event_loop;
    }

    pub fn loop(this: *const SecurityScanSubprocess) *bun.uws.Loop {
        return this.manager.event_loop.loop();
    }

    pub fn onReaderDone(this: *SecurityScanSubprocess) void {
        this.has_received_ipc = true;
        this.remaining_fds -= 1;
    }

    pub fn onReaderError(this: *SecurityScanSubprocess, err: bun.sys.Error) void {
        Output.errGeneric("Failed to read security scanner IPC: {}", .{err});
        this.has_received_ipc = true;
        this.remaining_fds -= 1;
    }

    pub fn onStderrChunk(this: *SecurityScanSubprocess, chunk: []const u8) void {
        this.stderr_data.appendSlice(chunk) catch bun.outOfMemory();
    }

    pub fn getReadBuffer(this: *SecurityScanSubprocess) []u8 {
        const available = this.ipc_data.unusedCapacitySlice();
        if (available.len < 4096) {
            this.ipc_data.ensureTotalCapacity(this.ipc_data.capacity + 4096) catch bun.outOfMemory();
            return this.ipc_data.unusedCapacitySlice();
        }
        return available;
    }

    pub fn onReadChunk(this: *SecurityScanSubprocess, chunk: []const u8, hasMore: bun.io.ReadState) bool {
        _ = hasMore;
        this.ipc_data.appendSlice(chunk) catch bun.outOfMemory();
        return true;
    }

    pub fn onProcessExit(this: *SecurityScanSubprocess, _: *bun.spawn.Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        this.has_process_exited = true;
        this.exit_status = status;

        if (this.remaining_fds > 0 and !this.has_received_ipc) {
            this.ipc_reader.deinit();
            this.remaining_fds = 0;
        }
    }

    pub fn handleResults(this: *SecurityScanSubprocess, package_paths: *std.AutoArrayHashMap(PackageID, PackagePath), start_time: i64, packages_scanned: usize, security_provider: []const u8) !void {
        defer {
            this.ipc_data.deinit();
            this.stderr_data.deinit();
        }

        const status = this.exit_status orelse bun.spawn.Status{ .exited = .{ .code = 0 } };

        if (this.ipc_data.items.len == 0) {
            switch (status) {
                .exited => |exit| {
                    if (exit.code != 0) {
                        Output.errGeneric("Security provider exited with code {d} without sending data", .{exit.code});
                    } else {
                        Output.errGeneric("Security provider exited without sending any data", .{});
                    }
                },
                .signaled => |sig| {
                    Output.errGeneric("Security provider terminated by signal {s} without sending data", .{@tagName(sig)});
                },
                else => {
                    Output.errGeneric("Security provider terminated abnormally without sending data", .{});
                },
            }
            Global.exit(1);
        }

        const duration = std.time.milliTimestamp() - start_time;

        if (this.manager.options.log_level == .verbose) {
            switch (status) {
                .exited => |exit| {
                    if (exit.code == 0) {
                        Output.prettyErrorln("<d>[SecurityProvider]<r> Completed with exit code {d} [{d}ms]", .{ exit.code, duration });
                    } else {
                        Output.prettyErrorln("<d>[SecurityProvider]<r> Failed with exit code {d} [{d}ms]", .{ exit.code, duration });
                    }
                },
                .signaled => |sig| {
                    Output.prettyErrorln("<d>[SecurityProvider]<r> Terminated by signal {s} [{d}ms]", .{ @tagName(sig), duration });
                },
                else => {
                    Output.prettyErrorln("<d>[SecurityProvider]<r> Completed with unknown status [{d}ms]", .{duration});
                },
            }
        } else if (this.manager.options.log_level != .silent and duration >= 1000) {
            // Show progress message for non-verbose, non-silent mode when it takes > 1 second
            if (packages_scanned == 1) {
                Output.prettyErrorln("<d>[{s}] Scanning 1 package took {d}ms<r>", .{ security_provider, duration });
            } else {
                Output.prettyErrorln("<d>[{s}] Scanning {d} packages took {d}ms<r>", .{ security_provider, packages_scanned, duration });
            }
        }

        try handleSecurityAdvisories(this.manager, this.ipc_data.items, package_paths);

        if (!status.isOK()) {
            switch (status) {
                .exited => |exited| {
                    if (exited.code != 0) {
                        Output.errGeneric("Security provider failed with exit code: {d}", .{exited.code});
                        Global.exit(1);
                    }
                },
                .signaled => |signal| {
                    Output.errGeneric("Security provider was terminated by signal: {s}", .{@tagName(signal)});
                    Global.exit(1);
                },
                else => {
                    Output.errGeneric("Security provider failed", .{});
                    Global.exit(1);
                },
            }
        }
    }
};

fn handleSecurityAdvisories(manager: *PackageManager, ipc_data: []const u8, package_paths: *std.AutoArrayHashMap(PackageID, PackagePath)) !void {
    if (ipc_data.len == 0) return;

    const json_source = logger.Source{
        .contents = ipc_data,
        .path = bun.fs.Path.init("security-advisories.json"),
    };

    var temp_log = logger.Log.init(manager.allocator);
    defer temp_log.deinit();

    const json_expr = bun.json.parseUTF8(&json_source, &temp_log, manager.allocator) catch |err| {
        Output.errGeneric("Security provider returned invalid JSON: {s}", .{@errorName(err)});
        if (ipc_data.len < 1000) {
            // If the response is reasonably small, show it to help debugging
            Output.errGeneric("Response: {s}", .{ipc_data});
        }
        if (temp_log.errors > 0) {
            temp_log.print(Output.errorWriter()) catch {};
        }
        Global.exit(1);
    };

    var advisories_list = std.ArrayList(SecurityAdvisory).init(manager.allocator);
    defer advisories_list.deinit();

    if (json_expr.data != .e_object) {
        Output.errGeneric("Security provider response must be a JSON object, got: {s}", .{@tagName(json_expr.data)});
        Global.exit(1);
    }

    const obj = json_expr.data.e_object;

    const advisories_expr = obj.get("advisories") orelse {
        Output.errGeneric("Security provider response missing required 'advisories' field", .{});
        Global.exit(1);
    };

    if (advisories_expr.data != .e_array) {
        Output.errGeneric("Security provider 'advisories' field must be an array, got: {s}", .{@tagName(advisories_expr.data)});
        Global.exit(1);
    }

    const array = advisories_expr.data.e_array;
    for (array.items.slice(), 0..) |item, i| {
        if (item.data != .e_object) {
            Output.errGeneric("Security advisory at index {d} must be an object, got: {s}", .{ i, @tagName(item.data) });
            Global.exit(1);
        }

        const item_obj = item.data.e_object;

        const name_expr = item_obj.get("package") orelse {
            Output.errGeneric("Security advisory at index {d} missing required 'package' field", .{i});
            Global.exit(1);
        };
        const name_str = name_expr.asString(manager.allocator) orelse {
            Output.errGeneric("Security advisory at index {d} 'package' field must be a string", .{i});
            Global.exit(1);
        };
        if (name_str.len == 0) {
            Output.errGeneric("Security advisory at index {d} 'package' field cannot be empty", .{i});
            Global.exit(1);
        }

        const desc_str: ?[]const u8 = if (item_obj.get("description")) |desc_expr| blk: {
            if (desc_expr.asString(manager.allocator)) |str| break :blk str;
            if (desc_expr.data == .e_null) break :blk null;
            Output.errGeneric("Security advisory at index {d} 'description' field must be a string or null", .{i});
            Global.exit(1);
        } else null;

        const url_str: ?[]const u8 = if (item_obj.get("url")) |url_expr| blk: {
            if (url_expr.asString(manager.allocator)) |str| break :blk str;
            if (url_expr.data == .e_null) break :blk null;
            Output.errGeneric("Security advisory at index {d} 'url' field must be a string or null", .{i});
            Global.exit(1);
        } else null;

        const level_expr = item_obj.get("level") orelse {
            Output.errGeneric("Security advisory at index {d} missing required 'level' field", .{i});
            Global.exit(1);
        };
        const level_str = level_expr.asString(manager.allocator) orelse {
            Output.errGeneric("Security advisory at index {d} 'level' field must be a string", .{i});
            Global.exit(1);
        };
        const level = if (std.mem.eql(u8, level_str, "fatal"))
            SecurityAdvisoryLevel.fatal
        else if (std.mem.eql(u8, level_str, "warn"))
            SecurityAdvisoryLevel.warn
        else {
            Output.errGeneric("Security advisory at index {d} 'level' field must be 'fatal' or 'warn', got: '{s}'", .{ i, level_str });
            Global.exit(1);
        };

        const advisory = SecurityAdvisory{
            .level = level,
            .package = name_str,
            .url = url_str,
            .description = desc_str,
        };

        try advisories_list.append(advisory);
    }

    if (advisories_list.items.len > 0) {
        var has_fatal = false;
        var has_warn = false;

        for (advisories_list.items) |advisory| {
            Output.print("\n", .{});

            switch (advisory.level) {
                .fatal => {
                    has_fatal = true;
                    Output.pretty("  <red>FATAL<r>: {s}\n", .{advisory.package});
                },
                .warn => {
                    has_warn = true;
                    Output.pretty("  <yellow>WARN<r>: {s}\n", .{advisory.package});
                },
            }

            const pkgs = manager.lockfile.packages.slice();
            const pkg_names = pkgs.items(.name);
            const string_buf = manager.lockfile.buffers.string_bytes.items;

            var found_pkg_id: ?PackageID = null;
            for (pkg_names, 0..) |pkg_name, i| {
                if (std.mem.eql(u8, pkg_name.slice(string_buf), advisory.package)) {
                    found_pkg_id = @intCast(i);
                    break;
                }
            }

            if (found_pkg_id) |pkg_id| {
                if (package_paths.get(pkg_id)) |paths| {
                    if (paths.pkg_path.len > 1) {
                        Output.pretty("    <d>via ", .{});
                        for (paths.pkg_path[0 .. paths.pkg_path.len - 1], 0..) |ancestor_id, idx| {
                            if (idx > 0) Output.pretty(" › ", .{});
                            const ancestor_name = pkg_names[ancestor_id].slice(string_buf);
                            Output.pretty("{s}", .{ancestor_name});
                        }
                        Output.pretty(" › <red>{s}<r>\n", .{advisory.package});
                    } else {
                        Output.pretty("    <d>(direct dependency)<r>\n", .{});
                    }
                }
            }

            if (advisory.description) |desc| {
                if (desc.len > 0) {
                    Output.pretty("    {s}\n", .{desc});
                }
            }
            if (advisory.url) |url| {
                if (url.len > 0) {
                    Output.pretty("    <cyan>{s}<r>\n", .{url});
                }
            }
        }

        if (has_fatal) {
            Output.pretty("\n<red>bun install aborted due to fatal security advisories<r>\n", .{});
            Global.exit(1);
        } else if (has_warn) {
            const can_prompt = Output.enable_ansi_colors_stdout;

            if (can_prompt) {
                Output.pretty("\n<yellow>Security warnings found.<r> Continue anyway? [y/N] ", .{});
                Output.flush();

                var stdin = std.io.getStdIn();
                const unbuffered_reader = stdin.reader();
                var buffered = std.io.bufferedReader(unbuffered_reader);
                var reader = buffered.reader();

                const first_byte = reader.readByte() catch {
                    Output.pretty("\n<red>Installation cancelled.<r>\n", .{});
                    Global.exit(1);
                };

                const should_continue = switch (first_byte) {
                    '\n' => false,
                    '\r' => blk: {
                        const next_byte = reader.readByte() catch {
                            break :blk false;
                        };
                        break :blk next_byte == '\n' and false;
                    },
                    'y', 'Y' => blk: {
                        const next_byte = reader.readByte() catch {
                            break :blk false;
                        };
                        if (next_byte == '\n') {
                            break :blk true;
                        } else if (next_byte == '\r') {
                            const second_byte = reader.readByte() catch {
                                break :blk false;
                            };
                            break :blk second_byte == '\n';
                        }
                        break :blk false;
                    },
                    else => blk: {
                        while (reader.readByte()) |b| {
                            if (b == '\n' or b == '\r') break;
                        } else |_| {}
                        break :blk false;
                    },
                };

                if (!should_continue) {
                    Output.pretty("\n<red>Installation cancelled.<r>\n", .{});
                    Global.exit(1);
                }

                Output.pretty("\n<yellow>Continuing with installation...<r>\n\n", .{});
            } else {
                Output.pretty("\n<red>Security warnings found. Cannot prompt for confirmation (no TTY).<r>\n", .{});
                Output.pretty("<red>Installation cancelled.<r>\n", .{});
                Global.exit(1);
            }
        }
    }
}

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
const jsc = bun.jsc;
const logger = bun.logger;
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
const invalid_dependency_id = bun.install.invalid_dependency_id;
const invalid_package_id = bun.install.invalid_package_id;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;

const PackageManager = bun.install.PackageManager;
const Options = PackageManager.Options;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
