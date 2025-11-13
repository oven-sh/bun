/// Called from isolated_install.zig on the main thread.
pub fn runTasks(
    manager: *PackageManager,
    comptime Ctx: type,
    extract_ctx: Ctx,
    comptime callbacks: anytype,
    install_peer: bool,
    log_level: Options.LogLevel,
) !void {
    var has_updated_this_run = false;
    var has_network_error = false;

    var timestamp_this_tick: ?u32 = null;

    defer {
        manager.drainDependencyList();

        if (log_level.showProgress()) {
            manager.startProgressBarIfNone();

            if (@hasField(@TypeOf(callbacks), "progress_bar") and callbacks.progress_bar == true) {
                const completed_items = manager.total_tasks - manager.pendingTaskCount();
                if (completed_items != manager.downloads_node.?.unprotected_completed_items or has_updated_this_run) {
                    manager.downloads_node.?.setCompletedItems(completed_items);
                    manager.downloads_node.?.setEstimatedTotalItems(manager.total_tasks);
                }
            }
            manager.downloads_node.?.activate();
            manager.progress.maybeRefresh();
        }
    }

    var patch_tasks_batch = manager.patch_task_queue.popBatch();
    var patch_tasks_iter = patch_tasks_batch.iterator();
    while (patch_tasks_iter.next()) |ptask| {
        if (comptime Environment.allow_assert) bun.assert(manager.pendingTaskCount() > 0);
        manager.decrementPendingTasks();
        defer ptask.deinit();
        try ptask.runFromMainThread(manager, log_level);
        if (ptask.callback == .apply) {
            if (ptask.callback.apply.logger.errors == 0) {
                if (comptime @TypeOf(callbacks.onExtract) != void) {
                    if (ptask.callback.apply.task_id) |task_id| {
                        _ = task_id; // autofix

                    } else if (Ctx == *PackageInstaller) {
                        if (ptask.callback.apply.install_context) |*ctx| {
                            var installer: *PackageInstaller = extract_ctx;
                            const path = ctx.path;
                            ctx.path = std.array_list.Managed(u8).init(bun.default_allocator);
                            installer.node_modules.path = path;
                            installer.current_tree_id = ctx.tree_id;
                            const pkg_id = ptask.callback.apply.pkg_id;
                            const resolution = &manager.lockfile.packages.items(.resolution)[pkg_id];

                            installer.installPackageWithNameAndResolution(
                                ctx.dependency_id,
                                pkg_id,
                                log_level,
                                ptask.callback.apply.pkgname,
                                resolution,
                                false,
                                false,
                            );
                        }
                    }
                }
            } else {
                // Patch application failed - propagate error to cause install failure
                return error.InstallFailed;
            }
        }
    }

    if (Ctx == *Store.Installer) {
        const installer: *Store.Installer = extract_ctx;
        const batch = installer.task_queue.popBatch();
        var iter = batch.iterator();
        while (iter.next()) |task| {
            switch (task.result) {
                .none => {
                    if (comptime Environment.ci_assert) {
                        bun.assertWithLocation(false, @src());
                    }
                    installer.onTaskComplete(task.entry_id, .success);
                },
                .err => |err| {
                    installer.onTaskFail(task.entry_id, err);
                },
                .blocked => {
                    installer.onTaskBlocked(task.entry_id);
                },
                .run_scripts => |list| {
                    const entries = installer.store.entries.slice();

                    const node_id = entries.items(.node_id)[task.entry_id.get()];
                    const dep_id = installer.store.nodes.items(.dep_id)[node_id.get()];
                    const dep = installer.lockfile.buffers.dependencies.items[dep_id];
                    installer.manager.spawnPackageLifecycleScripts(
                        installer.command_ctx,
                        list.*,
                        dep.behavior.optional,
                        false,
                        .{
                            .entry_id = task.entry_id,
                            .installer = installer,
                        },
                    ) catch |err| {
                        // .monotonic is okay for the same reason as `.done`: we popped this
                        // task from the `UnboundedQueue`, and the task is no longer running.
                        entries.items(.step)[task.entry_id.get()].store(.done, .monotonic);
                        installer.onTaskFail(task.entry_id, .{ .run_scripts = err });
                    };
                },
                .done => {
                    if (comptime Environment.ci_assert) {
                        // .monotonic is okay because we should have already synchronized with the
                        // completed task thread by virtue of popping from the `UnboundedQueue`.
                        const step = installer.store.entries.items(.step)[task.entry_id.get()].load(.monotonic);
                        bun.assertWithLocation(step == .done, @src());
                    }
                    installer.onTaskComplete(task.entry_id, .success);
                },
            }
        }
    }

    var network_tasks_batch = manager.async_network_task_queue.popBatch();
    var network_tasks_iter = network_tasks_batch.iterator();
    while (network_tasks_iter.next()) |task| {
        if (comptime Environment.allow_assert) bun.assert(manager.pendingTaskCount() > 0);
        manager.decrementPendingTasks();
        // We cannot free the network task at the end of this scope.
        // It may continue to be referenced in a future task.

        switch (task.callback) {
            .package_manifest => |*manifest_req| {
                const name = manifest_req.name;
                if (log_level.showProgress()) {
                    if (!has_updated_this_run) {
                        manager.setNodeName(manager.downloads_node.?, name.slice(), ProgressStrings.download_emoji, true);
                        has_updated_this_run = true;
                    }
                }

                if (!has_network_error and task.response.metadata == null) {
                    has_network_error = true;
                    const min = manager.options.min_simultaneous_requests;
                    const max = AsyncHTTP.max_simultaneous_requests.load(.monotonic);
                    if (max > min) {
                        AsyncHTTP.max_simultaneous_requests.store(@max(min, max / 2), .monotonic);
                    }
                }

                // Handle retry-able errors.
                if (task.response.metadata == null or task.response.metadata.?.response.status_code > 499) {
                    const err = task.response.fail orelse error.HTTPError;

                    if (task.retried < manager.options.max_retry_count) {
                        task.retried += 1;
                        manager.enqueueNetworkTask(task);

                        if (manager.options.log_level.isVerbose()) {
                            manager.log.addWarningFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                "{s} downloading package manifest <b>{s}<r>. Retry {d}/{d}...",
                                .{ bun.span(@errorName(err)), name.slice(), task.retried, manager.options.max_retry_count },
                            ) catch unreachable;
                        }

                        continue;
                    }
                }

                const metadata = task.response.metadata orelse {
                    // Handle non-retry-able errors.
                    const err = task.response.fail orelse error.HTTPError;

                    if (@TypeOf(callbacks.onPackageManifestError) != void) {
                        callbacks.onPackageManifestError(
                            extract_ctx,
                            name.slice(),
                            err,
                            task.url_buf,
                        );
                    } else {
                        const fmt = "{s} downloading package manifest <b>{s}<r>";
                        if (manager.isNetworkTaskRequired(task.task_id)) {
                            manager.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                fmt,
                                .{ @errorName(err), name.slice() },
                            ) catch |e| bun.handleOom(e);
                        } else {
                            manager.log.addWarningFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                fmt,
                                .{ @errorName(err), name.slice() },
                            ) catch |e| bun.handleOom(e);
                        }

                        if (manager.subcommand != .remove) {
                            for (manager.update_requests) |*request| {
                                if (strings.eql(request.name, name.slice())) {
                                    request.failed = true;
                                    manager.options.do.save_lockfile = false;
                                    manager.options.do.save_yarn_lock = false;
                                    manager.options.do.install_packages = false;
                                }
                            }
                        }
                    }

                    continue;
                };
                const response = metadata.response;

                if (response.status_code > 399) {
                    if (@TypeOf(callbacks.onPackageManifestError) != void) {
                        const err: PackageManifestError = switch (response.status_code) {
                            400 => error.PackageManifestHTTP400,
                            401 => error.PackageManifestHTTP401,
                            402 => error.PackageManifestHTTP402,
                            403 => error.PackageManifestHTTP403,
                            404 => error.PackageManifestHTTP404,
                            405...499 => error.PackageManifestHTTP4xx,
                            else => error.PackageManifestHTTP5xx,
                        };

                        callbacks.onPackageManifestError(
                            extract_ctx,
                            name.slice(),
                            err,
                            task.url_buf,
                        );

                        continue;
                    }

                    if (manager.isNetworkTaskRequired(task.task_id)) {
                        manager.log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            manager.allocator,
                            "<r><red><b>GET<r><red> {s}<d> - {d}<r>",
                            .{ metadata.url, response.status_code },
                        ) catch |err| bun.handleOom(err);
                    } else {
                        manager.log.addWarningFmt(
                            null,
                            logger.Loc.Empty,
                            manager.allocator,
                            "<r><yellow><b>GET<r><yellow> {s}<d> - {d}<r>",
                            .{ metadata.url, response.status_code },
                        ) catch |err| bun.handleOom(err);
                    }
                    if (manager.subcommand != .remove) {
                        for (manager.update_requests) |*request| {
                            if (strings.eql(request.name, name.slice())) {
                                request.failed = true;
                                manager.options.do.save_lockfile = false;
                                manager.options.do.save_yarn_lock = false;
                                manager.options.do.install_packages = false;
                            }
                        }
                    }

                    continue;
                }

                if (log_level.isVerbose()) {
                    Output.prettyError("    ", .{});
                    Output.printElapsed(@as(f64, @floatFromInt(task.unsafe_http_client.elapsed)) / std.time.ns_per_ms);
                    Output.prettyError("\n<d>Downloaded <r><green>{s}<r> versions\n", .{name.slice()});
                    Output.flush();
                }

                if (response.status_code == 304) {
                    // The HTTP request was cached
                    if (manifest_req.loaded_manifest) |manifest| {
                        // If we requested extended manifest but we somehow got an abbreviated one, this is a bug
                        bun.debugAssert(!manifest_req.is_extended_manifest or manifest.pkg.has_extended_manifest);

                        const entry = try manager.manifests.hash_map.getOrPut(manager.allocator, manifest.pkg.name.hash);
                        entry.value_ptr.* = .{ .manifest = manifest };

                        if (timestamp_this_tick == null) {
                            timestamp_this_tick = @as(u32, @truncate(@as(u64, @intCast(@max(0, std.time.timestamp()))))) +| 300;
                        }

                        entry.value_ptr.manifest.pkg.public_max_age = timestamp_this_tick.?;

                        if (manager.options.enable.manifest_cache) {
                            Npm.PackageManifest.Serializer.saveAsync(
                                &entry.value_ptr.manifest,
                                manager.scopeForPackageName(name.slice()),
                                manager.getTemporaryDirectory().handle,
                                manager.getCacheDirectory(),
                            );
                        }

                        if (@hasField(@TypeOf(callbacks), "manifests_only") and callbacks.manifests_only) {
                            continue;
                        }

                        const dependency_list_entry = manager.task_queue.getEntry(task.task_id).?;

                        const dependency_list = dependency_list_entry.value_ptr.*;
                        dependency_list_entry.value_ptr.* = .{};

                        try manager.processDependencyList(
                            dependency_list,
                            Ctx,
                            extract_ctx,
                            callbacks,
                            install_peer,
                        );

                        continue;
                    }
                }

                manager.task_batch.push(ThreadPool.Batch.from(manager.enqueueParseNPMPackage(task.task_id, name, task)));
            },
            .extract => |*extract| {
                if (!has_network_error and task.response.metadata == null) {
                    has_network_error = true;
                    const min = manager.options.min_simultaneous_requests;
                    const max = AsyncHTTP.max_simultaneous_requests.load(.monotonic);
                    if (max > min) {
                        AsyncHTTP.max_simultaneous_requests.store(@max(min, max / 2), .monotonic);
                    }
                }

                if (task.response.metadata == null or task.response.metadata.?.response.status_code > 499) {
                    const err = task.response.fail orelse error.TarballFailedToDownload;

                    if (task.retried < manager.options.max_retry_count) {
                        task.retried += 1;
                        manager.enqueueNetworkTask(task);

                        if (manager.options.log_level.isVerbose()) {
                            manager.log.addWarningFmt(
                                null,
                                logger.Loc.Empty,
                                manager.allocator,
                                "<r><yellow>warn:<r> {s} downloading tarball <b>{s}@{f}<r>. Retrying {d}/{d}...",
                                .{
                                    bun.span(@errorName(err)),
                                    extract.name.slice(),
                                    extract.resolution.fmt(manager.lockfile.buffers.string_bytes.items, .auto),
                                    task.retried,
                                    manager.options.max_retry_count,
                                },
                            ) catch unreachable;
                        }

                        continue;
                    }
                }

                const metadata = task.response.metadata orelse {
                    const err = task.response.fail orelse error.TarballFailedToDownload;

                    if (@TypeOf(callbacks.onPackageDownloadError) != void) {
                        const package_id = manager.lockfile.buffers.resolutions.items[extract.dependency_id];
                        callbacks.onPackageDownloadError(
                            extract_ctx,
                            package_id,
                            extract.name.slice(),
                            &extract.resolution,
                            err,
                            task.url_buf,
                        );
                        continue;
                    }

                    const fmt = "{s} downloading tarball <b>{s}@{f}<r>";
                    if (manager.isNetworkTaskRequired(task.task_id)) {
                        manager.log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            manager.allocator,
                            fmt,
                            .{
                                @errorName(err),
                                extract.name.slice(),
                                extract.resolution.fmt(manager.lockfile.buffers.string_bytes.items, .auto),
                            },
                        ) catch |e| bun.handleOom(e);
                    } else {
                        manager.log.addWarningFmt(
                            null,
                            logger.Loc.Empty,
                            manager.allocator,
                            fmt,
                            .{
                                @errorName(err),
                                extract.name.slice(),
                                extract.resolution.fmt(manager.lockfile.buffers.string_bytes.items, .auto),
                            },
                        ) catch |e| bun.handleOom(e);
                    }
                    if (manager.subcommand != .remove) {
                        for (manager.update_requests) |*request| {
                            if (strings.eql(request.name, extract.name.slice())) {
                                request.failed = true;
                                manager.options.do.save_lockfile = false;
                                manager.options.do.save_yarn_lock = false;
                                manager.options.do.install_packages = false;
                            }
                        }
                    }

                    continue;
                };

                const response = metadata.response;

                if (response.status_code > 399) {
                    if (@TypeOf(callbacks.onPackageDownloadError) != void) {
                        const err = switch (response.status_code) {
                            400 => error.TarballHTTP400,
                            401 => error.TarballHTTP401,
                            402 => error.TarballHTTP402,
                            403 => error.TarballHTTP403,
                            404 => error.TarballHTTP404,
                            405...499 => error.TarballHTTP4xx,
                            else => error.TarballHTTP5xx,
                        };
                        const package_id = manager.lockfile.buffers.resolutions.items[extract.dependency_id];

                        callbacks.onPackageDownloadError(
                            extract_ctx,
                            package_id,
                            extract.name.slice(),
                            &extract.resolution,
                            err,
                            task.url_buf,
                        );
                        continue;
                    }

                    if (manager.isNetworkTaskRequired(task.task_id)) {
                        manager.log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            manager.allocator,
                            "<r><red><b>GET<r><red> {s}<d> - {d}<r>",
                            .{
                                metadata.url,
                                response.status_code,
                            },
                        ) catch |err| bun.handleOom(err);
                    } else {
                        manager.log.addWarningFmt(
                            null,
                            logger.Loc.Empty,
                            manager.allocator,
                            "<r><yellow><b>GET<r><yellow> {s}<d> - {d}<r>",
                            .{
                                metadata.url,
                                response.status_code,
                            },
                        ) catch |err| bun.handleOom(err);
                    }
                    if (manager.subcommand != .remove) {
                        for (manager.update_requests) |*request| {
                            if (strings.eql(request.name, extract.name.slice())) {
                                request.failed = true;
                                manager.options.do.save_lockfile = false;
                                manager.options.do.save_yarn_lock = false;
                                manager.options.do.install_packages = false;
                            }
                        }
                    }

                    continue;
                }

                if (log_level.isVerbose()) {
                    Output.prettyError("    ", .{});
                    Output.printElapsed(@as(f64, @floatCast(@as(f64, @floatFromInt(task.unsafe_http_client.elapsed)) / std.time.ns_per_ms)));
                    Output.prettyError("<d> Downloaded <r><green>{s}<r> tarball\n", .{extract.name.slice()});
                    Output.flush();
                }

                if (log_level.showProgress()) {
                    if (!has_updated_this_run) {
                        manager.setNodeName(manager.downloads_node.?, extract.name.slice(), ProgressStrings.extract_emoji, true);
                        has_updated_this_run = true;
                    }
                }

                manager.task_batch.push(ThreadPool.Batch.from(manager.enqueueExtractNPMPackage(extract, task)));
            },
            else => unreachable,
        }
    }

    var resolve_tasks_batch = manager.resolve_tasks.popBatch();
    var resolve_tasks_iter = resolve_tasks_batch.iterator();
    while (resolve_tasks_iter.next()) |task| {
        if (comptime Environment.allow_assert) bun.assert(manager.pendingTaskCount() > 0);
        defer manager.preallocated_resolve_tasks.put(task);
        manager.decrementPendingTasks();

        if (task.log.msgs.items.len > 0) {
            try task.log.print(Output.errorWriter());
            if (task.log.errors > 0) {
                manager.any_failed_to_install = true;
            }
            task.log.deinit();
        }

        switch (task.tag) {
            .package_manifest => {
                defer manager.preallocated_network_tasks.put(task.request.package_manifest.network);
                if (task.status == .fail) {
                    const name = task.request.package_manifest.name;
                    const err = task.err orelse error.Failed;

                    if (@TypeOf(callbacks.onPackageManifestError) != void) {
                        callbacks.onPackageManifestError(
                            extract_ctx,
                            name.slice(),
                            err,
                            task.request.package_manifest.network.url_buf,
                        );
                    } else {
                        manager.log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            manager.allocator,
                            "{s} parsing package manifest for <b>{s}<r>",
                            .{
                                @errorName(err),
                                name.slice(),
                            },
                        ) catch |e| bun.handleOom(e);
                    }

                    continue;
                }
                const manifest = &task.data.package_manifest;

                try manager.manifests.insert(manifest.pkg.name.hash, manifest);

                if (@hasField(@TypeOf(callbacks), "manifests_only") and callbacks.manifests_only) {
                    continue;
                }

                const dependency_list_entry = manager.task_queue.getEntry(task.id).?;
                const dependency_list = dependency_list_entry.value_ptr.*;
                dependency_list_entry.value_ptr.* = .{};

                try manager.processDependencyList(dependency_list, Ctx, extract_ctx, callbacks, install_peer);

                if (log_level.showProgress()) {
                    if (!has_updated_this_run) {
                        manager.setNodeName(manager.downloads_node.?, manifest.name(), ProgressStrings.download_emoji, true);
                        has_updated_this_run = true;
                    }
                }
            },
            .extract, .local_tarball => {
                defer {
                    switch (task.tag) {
                        .extract => manager.preallocated_network_tasks.put(task.request.extract.network),
                        else => {},
                    }
                }

                const tarball = switch (task.tag) {
                    .extract => &task.request.extract.tarball,
                    .local_tarball => &task.request.local_tarball.tarball,
                    else => unreachable,
                };
                const dependency_id = tarball.dependency_id;
                var package_id = manager.lockfile.buffers.resolutions.items[dependency_id];
                const alias = tarball.name.slice();
                const resolution = &tarball.resolution;

                if (task.status == .fail) {
                    const err = task.err orelse error.TarballFailedToExtract;

                    if (@TypeOf(callbacks.onPackageDownloadError) != void) {
                        callbacks.onPackageDownloadError(
                            extract_ctx,
                            package_id,
                            alias,
                            resolution,
                            err,
                            switch (task.tag) {
                                .extract => task.request.extract.network.url_buf,
                                .local_tarball => task.request.local_tarball.tarball.url.slice(),
                                else => unreachable,
                            },
                        );
                    } else {
                        manager.log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            manager.allocator,
                            "{s} extracting tarball from <b>{s}<r>",
                            .{
                                @errorName(err),
                                alias,
                            },
                        ) catch |e| bun.handleOom(e);
                    }
                    continue;
                }

                manager.extracted_count += 1;
                bun.analytics.Features.extracted_packages += 1;

                if (comptime @TypeOf(callbacks.onExtract) != void) {
                    switch (Ctx) {
                        *PackageInstaller => {
                            extract_ctx.fixCachedLockfilePackageSlices();
                            callbacks.onExtract(
                                extract_ctx,
                                task.id,
                                dependency_id,
                                &task.data.extract,
                                log_level,
                            );
                        },
                        *Store.Installer => {
                            callbacks.onExtract(
                                extract_ctx,
                                task.id,
                            );
                        },
                        else => @compileError("unexpected context type"),
                    }
                } else if (manager.processExtractedTarballPackage(&package_id, dependency_id, resolution, &task.data.extract, log_level)) |pkg| handle_pkg: {
                    // In the middle of an install, you could end up needing to downlaod the github tarball for a dependency
                    // We need to make sure we resolve the dependencies first before calling the onExtract callback
                    // TODO: move this into a separate function
                    var any_root = false;
                    var dependency_list_entry = manager.task_queue.getEntry(task.id) orelse break :handle_pkg;
                    var dependency_list = dependency_list_entry.value_ptr.*;
                    dependency_list_entry.value_ptr.* = .{};

                    defer {
                        dependency_list.deinit(manager.allocator);
                        if (comptime @TypeOf(callbacks) != void and @TypeOf(callbacks.onResolve) != void) {
                            if (any_root) {
                                callbacks.onResolve(extract_ctx);
                            }
                        }
                    }

                    for (dependency_list.items) |dep| {
                        switch (dep) {
                            .dependency, .root_dependency => |id| {
                                var version = &manager.lockfile.buffers.dependencies.items[id].version;
                                switch (version.tag) {
                                    .git => {
                                        version.value.git.package_name = pkg.name;
                                    },
                                    .github => {
                                        version.value.github.package_name = pkg.name;
                                    },
                                    .tarball => {
                                        version.value.tarball.package_name = pkg.name;
                                    },

                                    // `else` is reachable if this package is from `overrides`. Version in `lockfile.buffer.dependencies`
                                    // will still have the original.
                                    else => {},
                                }
                                try manager.processDependencyListItem(dep, &any_root, install_peer);
                            },
                            else => {
                                // if it's a node_module folder to install, handle that after we process all the dependencies within the onExtract callback.
                                dependency_list_entry.value_ptr.append(manager.allocator, dep) catch unreachable;
                            },
                        }
                    }
                } else if (manager.task_queue.getEntry(Task.Id.forManifest(
                    manager.lockfile.str(&manager.lockfile.packages.items(.name)[package_id]),
                ))) |dependency_list_entry| {
                    // Peer dependencies do not initiate any downloads of their own, thus need to be resolved here instead
                    const dependency_list = dependency_list_entry.value_ptr.*;
                    dependency_list_entry.value_ptr.* = .{};

                    try manager.processDependencyList(dependency_list, void, {}, {}, install_peer);
                }

                manager.setPreinstallState(package_id, manager.lockfile, .done);

                if (log_level.showProgress()) {
                    if (!has_updated_this_run) {
                        manager.setNodeName(manager.downloads_node.?, alias, ProgressStrings.extract_emoji, true);
                        has_updated_this_run = true;
                    }
                }
            },
            .git_clone => {
                const clone = &task.request.git_clone;
                const repo_fd = task.data.git_clone;
                const name = clone.name.slice();
                const url = clone.url.slice();

                manager.git_repositories.put(manager.allocator, task.id, repo_fd) catch unreachable;

                if (task.status == .fail) {
                    const err = task.err orelse error.Failed;

                    if (@TypeOf(callbacks.onPackageManifestError) != void) {
                        callbacks.onPackageManifestError(
                            extract_ctx,
                            name,
                            err,
                            url,
                        );
                    } else if (log_level != .silent) {
                        manager.log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            manager.allocator,
                            "{s} cloning repository for <b>{s}<r>",
                            .{
                                @errorName(err),
                                name,
                            },
                        ) catch |e| bun.handleOom(e);
                    }
                    continue;
                }

                if (comptime @TypeOf(callbacks.onExtract) != void and Ctx == *PackageInstaller) {
                    // Installing!
                    // this dependency might be something other than a git dependency! only need the name and
                    // behavior, use the resolution from the task.
                    const dep_id = clone.dep_id;
                    const dep = manager.lockfile.buffers.dependencies.items[dep_id];
                    const dep_name = dep.name.slice(manager.lockfile.buffers.string_bytes.items);

                    const git = clone.res.value.git;
                    const committish = git.committish.slice(manager.lockfile.buffers.string_bytes.items);
                    const repo = git.repo.slice(manager.lockfile.buffers.string_bytes.items);

                    const resolved = try Repository.findCommit(
                        manager.allocator,
                        manager.env,
                        manager.log,
                        task.data.git_clone.stdDir(),
                        dep_name,
                        committish,
                        task.id,
                    );

                    const checkout_id = Task.Id.forGitCheckout(repo, resolved);

                    if (manager.hasCreatedNetworkTask(checkout_id, dep.behavior.isRequired())) continue;

                    manager.task_batch.push(ThreadPool.Batch.from(manager.enqueueGitCheckout(
                        checkout_id,
                        repo_fd,
                        dep_id,
                        dep_name,
                        clone.res,
                        resolved,
                        null,
                    )));
                } else {
                    // Resolving!
                    const dependency_list_entry = manager.task_queue.getEntry(task.id).?;
                    const dependency_list = dependency_list_entry.value_ptr.*;
                    dependency_list_entry.value_ptr.* = .{};

                    try manager.processDependencyList(dependency_list, Ctx, extract_ctx, callbacks, install_peer);
                }

                if (log_level.showProgress()) {
                    if (!has_updated_this_run) {
                        manager.setNodeName(manager.downloads_node.?, name, ProgressStrings.download_emoji, true);
                        has_updated_this_run = true;
                    }
                }
            },
            .git_checkout => {
                const git_checkout = &task.request.git_checkout;
                const alias = &git_checkout.name;
                const resolution = &git_checkout.resolution;
                var package_id: PackageID = invalid_package_id;

                if (task.status == .fail) {
                    const err = task.err orelse error.Failed;

                    manager.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        manager.allocator,
                        "{s} checking out repository for <b>{s}<r>",
                        .{
                            @errorName(err),
                            alias.slice(),
                        },
                    ) catch |e| bun.handleOom(e);

                    continue;
                }

                if (comptime @TypeOf(callbacks.onExtract) != void) {
                    // We've populated the cache, package already exists in memory. Call the package installer callback
                    // and don't enqueue dependencies
                    switch (Ctx) {
                        *PackageInstaller => {

                            // TODO(dylan-conway) most likely don't need to call this now that the package isn't appended, but
                            // keeping just in case for now
                            extract_ctx.fixCachedLockfilePackageSlices();

                            callbacks.onExtract(
                                extract_ctx,
                                task.id,
                                git_checkout.dependency_id,
                                &task.data.git_checkout,
                                log_level,
                            );
                        },
                        *Store.Installer => {
                            callbacks.onExtract(
                                extract_ctx,
                                task.id,
                            );
                        },
                        else => @compileError("unexpected context type"),
                    }
                } else if (manager.processExtractedTarballPackage(
                    &package_id,
                    git_checkout.dependency_id,
                    resolution,
                    &task.data.git_checkout,
                    log_level,
                )) |pkg| handle_pkg: {
                    var any_root = false;
                    var dependency_list_entry = manager.task_queue.getEntry(task.id) orelse break :handle_pkg;
                    var dependency_list = dependency_list_entry.value_ptr.*;
                    dependency_list_entry.value_ptr.* = .{};

                    defer {
                        dependency_list.deinit(manager.allocator);
                        if (comptime @TypeOf(callbacks) != void and @TypeOf(callbacks.onResolve) != void) {
                            if (any_root) {
                                callbacks.onResolve(extract_ctx);
                            }
                        }
                    }

                    for (dependency_list.items) |dep| {
                        switch (dep) {
                            .dependency, .root_dependency => |id| {
                                var repo = &manager.lockfile.buffers.dependencies.items[id].version.value.git;
                                repo.resolved = pkg.resolution.value.git.resolved;
                                repo.package_name = pkg.name;
                                try manager.processDependencyListItem(dep, &any_root, install_peer);
                            },
                            else => {
                                // if it's a node_module folder to install, handle that after we process all the dependencies within the onExtract callback.
                                dependency_list_entry.value_ptr.append(manager.allocator, dep) catch unreachable;
                            },
                        }
                    }

                    if (@TypeOf(callbacks.onExtract) != void) {
                        @compileError("ctx should be void");
                    }
                }

                if (log_level.showProgress()) {
                    if (!has_updated_this_run) {
                        manager.setNodeName(manager.downloads_node.?, alias.slice(), ProgressStrings.download_emoji, true);
                        has_updated_this_run = true;
                    }
                }
            },
        }
    }
}

pub inline fn pendingTaskCount(manager: *const PackageManager) u32 {
    return manager.pending_tasks.load(.acquire);
}

pub inline fn incrementPendingTasks(manager: *PackageManager, count: u32) void {
    manager.total_tasks += count;
    // .monotonic is okay because the start of a task doesn't carry any side effects that other
    // threads depend on (but finishing a task does). Note that this method should usually be called
    // before the task is actually spawned.
    _ = manager.pending_tasks.fetchAdd(count, .monotonic);
}

pub inline fn decrementPendingTasks(manager: *PackageManager) void {
    _ = manager.pending_tasks.fetchSub(1, .release);
}

pub fn flushNetworkQueue(this: *PackageManager) void {
    var network = &this.network_task_fifo;

    while (network.readItem()) |network_task| {
        network_task.schedule(if (network_task.callback == .extract) &this.network_tarball_batch else &this.network_resolve_batch);
    }
}

pub fn flushPatchTaskQueue(this: *PackageManager) void {
    var patch_task_fifo = &this.patch_task_fifo;

    while (patch_task_fifo.readItem()) |patch_task| {
        patch_task.schedule(if (patch_task.callback == .apply) &this.patch_apply_batch else &this.patch_calc_hash_batch);
    }
}

fn doFlushDependencyQueue(this: *PackageManager) void {
    var lockfile = this.lockfile;
    var dependency_queue = &lockfile.scratch.dependency_list_queue;

    while (dependency_queue.readItem()) |dependencies_list| {
        var i: u32 = dependencies_list.off;
        const end = dependencies_list.off + dependencies_list.len;
        while (i < end) : (i += 1) {
            const dependency = lockfile.buffers.dependencies.items[i];
            this.enqueueDependencyWithMain(
                i,
                &dependency,
                lockfile.buffers.resolutions.items[i],
                false,
            ) catch {};
        }
    }

    this.flushNetworkQueue();
}
pub fn flushDependencyQueue(this: *PackageManager) void {
    var last_count = this.total_tasks;
    while (true) : (last_count = this.total_tasks) {
        this.flushNetworkQueue();
        doFlushDependencyQueue(this);
        this.flushNetworkQueue();
        this.flushPatchTaskQueue();

        if (this.total_tasks == last_count) break;
    }
}

pub fn scheduleTasks(manager: *PackageManager) usize {
    const count = manager.task_batch.len + manager.network_resolve_batch.len + manager.network_tarball_batch.len + manager.patch_apply_batch.len + manager.patch_calc_hash_batch.len;

    manager.incrementPendingTasks(@intCast(count));
    manager.thread_pool.schedule(manager.patch_apply_batch);
    manager.thread_pool.schedule(manager.patch_calc_hash_batch);
    manager.thread_pool.schedule(manager.task_batch);
    manager.network_resolve_batch.push(manager.network_tarball_batch);
    HTTP.http_thread.schedule(manager.network_resolve_batch);
    manager.task_batch = .{};
    manager.network_tarball_batch = .{};
    manager.network_resolve_batch = .{};
    manager.patch_apply_batch = .{};
    manager.patch_calc_hash_batch = .{};
    return count;
}

pub fn drainDependencyList(this: *PackageManager) void {
    // Step 2. If there were cached dependencies, go through all of those but don't download the devDependencies for them.
    this.flushDependencyQueue();

    if (PackageManager.verbose_install) Output.flush();

    // It's only network requests here because we don't store tarballs.
    _ = this.scheduleTasks();
}

pub fn getNetworkTask(this: *PackageManager) *NetworkTask {
    return this.preallocated_network_tasks.get();
}

pub fn allocGitHubURL(this: *const PackageManager, repository: *const Repository) string {
    var github_api_url: string = "https://api.github.com";
    if (this.env.get("GITHUB_API_URL")) |url| {
        if (url.len > 0) {
            github_api_url = url;
        }
    }

    const owner = this.lockfile.str(&repository.owner);
    const repo = this.lockfile.str(&repository.repo);
    const committish = this.lockfile.str(&repository.committish);

    return std.fmt.allocPrint(
        this.allocator,
        "{s}/repos/{s}/{s}{s}tarball/{s}",
        .{
            strings.withoutTrailingSlash(github_api_url),
            owner,
            repo,
            // repo might be empty if dep is https://github.com/... style
            if (repo.len > 0) "/" else "",
            committish,
        },
    ) catch unreachable;
}

pub fn hasCreatedNetworkTask(this: *PackageManager, task_id: Task.Id, is_required: bool) bool {
    const gpe = bun.handleOom(this.network_dedupe_map.getOrPut(task_id));

    // if there's an existing network task that is optional, we want to make it non-optional if this one would be required
    gpe.value_ptr.is_required = if (!gpe.found_existing)
        is_required
    else
        gpe.value_ptr.is_required or is_required;

    return gpe.found_existing;
}

pub fn isNetworkTaskRequired(this: *const PackageManager, task_id: Task.Id) bool {
    return (this.network_dedupe_map.get(task_id) orelse return true).is_required;
}

pub fn generateNetworkTaskForTarball(
    this: *PackageManager,
    task_id: Task.Id,
    url: string,
    is_required: bool,
    dependency_id: DependencyID,
    package: Lockfile.Package,
    patch_name_and_version_hash: ?u64,
    authorization: NetworkTask.Authorization,
) NetworkTask.ForTarballError!?*NetworkTask {
    if (this.hasCreatedNetworkTask(task_id, is_required)) {
        return null;
    }

    var network_task = this.getNetworkTask();

    network_task.* = .{
        .task_id = task_id,
        .callback = undefined,
        .allocator = this.allocator,
        .package_manager = this,
        .apply_patch_task = if (patch_name_and_version_hash) |h| brk: {
            const patch_hash = this.lockfile.patched_dependencies.get(h).?.patchfileHash().?;
            const task = PatchTask.newApplyPatchHash(this, package.meta.id, patch_hash, h);
            task.callback.apply.task_id = task_id;
            break :brk task;
        } else null,
    };

    const scope = this.scopeForPackageName(this.lockfile.str(&package.name));

    try network_task.forTarball(
        this.allocator,
        &.{
            .package_manager = this,
            .name = strings.StringOrTinyString.initAppendIfNeeded(
                this.lockfile.str(&package.name),
                *FileSystem.FilenameStore,
                FileSystem.FilenameStore.instance,
            ) catch |err| bun.handleOom(err),
            .resolution = package.resolution,
            .cache_dir = this.getCacheDirectory(),
            .temp_dir = this.getTemporaryDirectory().handle,
            .dependency_id = dependency_id,
            .integrity = package.meta.integrity,
            .url = strings.StringOrTinyString.initAppendIfNeeded(
                url,
                *FileSystem.FilenameStore,
                FileSystem.FilenameStore.instance,
            ) catch |err| bun.handleOom(err),
        },
        scope,
        authorization,
    );

    return network_task;
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const ThreadPool = bun.ThreadPool;
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const strings = bun.strings;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const HTTP = bun.http;
const AsyncHTTP = HTTP.AsyncHTTP;

const DependencyID = bun.install.DependencyID;
const Features = bun.install.Features;
const NetworkTask = bun.install.NetworkTask;
const Npm = bun.install.Npm;
const PackageID = bun.install.PackageID;
const PackageManifestError = bun.install.PackageManifestError;
const PatchTask = bun.install.PatchTask;
const Repository = bun.install.Repository;
const Store = bun.install.Store;
const Task = bun.install.Task;
const invalid_package_id = bun.install.invalid_package_id;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;

const PackageManager = bun.install.PackageManager;
const Options = PackageManager.Options;
const PackageInstaller = PackageManager.PackageInstaller;
const ProgressStrings = PackageManager.ProgressStrings;
