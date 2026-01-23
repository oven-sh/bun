pub fn enqueueDependencyWithMain(
    this: *PackageManager,
    id: DependencyID,
    /// This must be a *const to prevent UB
    dependency: *const Dependency,
    resolution: PackageID,
    install_peer: bool,
) !void {
    return this.enqueueDependencyWithMainAndSuccessFn(
        id,
        dependency,
        resolution,
        install_peer,
        assignResolution,
        null,
    );
}

pub fn enqueueDependencyList(
    this: *PackageManager,
    dependencies_list: Lockfile.DependencySlice,
) void {
    this.task_queue.ensureUnusedCapacity(this.allocator, dependencies_list.len) catch unreachable;
    const lockfile = this.lockfile;

    // Step 1. Go through main dependencies
    var begin = dependencies_list.off;
    const end = dependencies_list.off +| dependencies_list.len;

    // if dependency is peer and is going to be installed
    // through "dependencies", skip it
    if (end - begin > 1 and lockfile.buffers.dependencies.items[0].behavior.isPeer()) {
        var peer_i: usize = 0;
        var peer = &lockfile.buffers.dependencies.items[peer_i];
        while (peer.behavior.isPeer()) {
            var dep_i: usize = end - 1;
            var dep = lockfile.buffers.dependencies.items[dep_i];
            while (!dep.behavior.isPeer()) {
                if (!dep.behavior.isDev()) {
                    if (peer.name_hash == dep.name_hash) {
                        peer.* = lockfile.buffers.dependencies.items[begin];
                        begin += 1;
                        break;
                    }
                }
                dep_i -= 1;
                dep = lockfile.buffers.dependencies.items[dep_i];
            }
            peer_i += 1;
            if (peer_i == end) break;
            peer = &lockfile.buffers.dependencies.items[peer_i];
        }
    }

    var i = begin;

    // we have to be very careful with pointers here
    while (i < end) : (i += 1) {
        const dependency = lockfile.buffers.dependencies.items[i];
        const resolution = lockfile.buffers.resolutions.items[i];
        this.enqueueDependencyWithMain(
            i,
            &dependency,
            resolution,
            false,
        ) catch |err| {
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
                this.log.addWarningWithNote(null, .{}, this.allocator, @errorName(err), note.fmt, note.args) catch unreachable
            else
                this.log.addZigErrorWithNote(this.allocator, err, note.fmt, note.args) catch unreachable;

            continue;
        };
    }

    this.drainDependencyList();
}

pub fn enqueueTarballForDownload(
    this: *PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
    url: string,
    task_context: TaskCallbackContext,
    patch_name_and_version_hash: ?u64,
) EnqueueTarballForDownloadError!void {
    const task_id = Task.Id.forTarball(url);
    var task_queue = try this.task_queue.getOrPut(this.allocator, task_id);
    if (!task_queue.found_existing) {
        task_queue.value_ptr.* = .{};
    }

    try task_queue.value_ptr.append(
        this.allocator,
        task_context,
    );

    if (task_queue.found_existing) return;

    if (try this.generateNetworkTaskForTarball(
        task_id,
        url,
        this.lockfile.buffers.dependencies.items[dependency_id].behavior.isRequired(),
        dependency_id,
        this.lockfile.packages.get(package_id),
        patch_name_and_version_hash,
        .no_authorization,
    )) |task| {
        task.schedule(&this.network_tarball_batch);
        if (this.network_tarball_batch.len > 0) {
            _ = this.scheduleTasks();
        }
    }
}

pub fn enqueueTarballForReading(
    this: *PackageManager,
    dependency_id: DependencyID,
    alias: string,
    resolution: *const Resolution,
    task_context: TaskCallbackContext,
) void {
    const path = this.lockfile.str(&resolution.value.local_tarball);
    const task_id = Task.Id.forTarball(path);
    var task_queue = this.task_queue.getOrPut(this.allocator, task_id) catch unreachable;
    if (!task_queue.found_existing) {
        task_queue.value_ptr.* = .{};
    }

    task_queue.value_ptr.append(
        this.allocator,
        task_context,
    ) catch unreachable;

    if (task_queue.found_existing) return;

    this.task_batch.push(ThreadPool.Batch.from(enqueueLocalTarball(
        this,
        task_id,
        dependency_id,
        alias,
        path,
        resolution.*,
    )));
}

pub fn enqueueGitForCheckout(
    this: *PackageManager,
    dependency_id: DependencyID,
    alias: string,
    resolution: *const Resolution,
    task_context: TaskCallbackContext,
    patch_name_and_version_hash: ?u64,
) void {
    const repository = &resolution.value.git;
    const url = this.lockfile.str(&repository.repo);
    const clone_id = Task.Id.forGitClone(url);
    const resolved = this.lockfile.str(&repository.resolved);
    const checkout_id = Task.Id.forGitCheckout(url, resolved);
    var checkout_queue = this.task_queue.getOrPut(this.allocator, checkout_id) catch unreachable;
    if (!checkout_queue.found_existing) {
        checkout_queue.value_ptr.* = .{};
    }

    checkout_queue.value_ptr.append(
        this.allocator,
        task_context,
    ) catch unreachable;

    if (checkout_queue.found_existing) return;

    if (this.git_repositories.get(clone_id)) |repo_fd| {
        this.task_batch.push(ThreadPool.Batch.from(this.enqueueGitCheckout(checkout_id, repo_fd, dependency_id, alias, resolution.*, resolved, patch_name_and_version_hash)));
    } else {
        var clone_queue = this.task_queue.getOrPut(this.allocator, clone_id) catch unreachable;
        if (!clone_queue.found_existing) {
            clone_queue.value_ptr.* = .{};
        }

        clone_queue.value_ptr.append(
            this.allocator,
            .{ .dependency = dependency_id },
        ) catch unreachable;

        if (clone_queue.found_existing) return;

        this.task_batch.push(ThreadPool.Batch.from(enqueueGitClone(
            this,
            clone_id,
            alias,
            repository,
            dependency_id,
            &this.lockfile.buffers.dependencies.items[dependency_id],
            resolution,
            null,
        )));
    }
}

pub fn enqueueParseNPMPackage(
    this: *PackageManager,
    task_id: Task.Id,
    name: strings.StringOrTinyString,
    network_task: *NetworkTask,
) *ThreadPool.Task {
    var task = this.preallocated_resolve_tasks.get();
    task.* = Task{
        .package_manager = this,
        .log = logger.Log.init(this.allocator),
        .tag = Task.Tag.package_manifest,
        .request = .{
            .package_manifest = .{
                .network = network_task,
                .name = name,
            },
        },
        .id = task_id,
        .data = undefined,
    };
    return &task.threadpool_task;
}

pub fn enqueuePackageForDownload(
    this: *PackageManager,
    name: []const u8,
    dependency_id: DependencyID,
    package_id: PackageID,
    version: bun.Semver.Version,
    url: []const u8,
    task_context: TaskCallbackContext,
    patch_name_and_version_hash: ?u64,
) EnqueuePackageForDownloadError!void {
    const task_id = Task.Id.forNPMPackage(name, version);
    var task_queue = try this.task_queue.getOrPut(this.allocator, task_id);
    if (!task_queue.found_existing) {
        task_queue.value_ptr.* = .{};
    }

    try task_queue.value_ptr.append(
        this.allocator,
        task_context,
    );

    if (task_queue.found_existing) return;

    const is_required = this.lockfile.buffers.dependencies.items[dependency_id].behavior.isRequired();

    if (try this.generateNetworkTaskForTarball(
        task_id,
        url,
        is_required,
        dependency_id,
        this.lockfile.packages.get(package_id),
        patch_name_and_version_hash,
        .allow_authorization,
    )) |task| {
        task.schedule(&this.network_tarball_batch);
        if (this.network_tarball_batch.len > 0) {
            _ = this.scheduleTasks();
        }
    }
}

const DependencyToEnqueue = union(enum) {
    pending: DependencyID,
    resolution: struct { package_id: PackageID, resolution: Resolution },
    not_found: void,
    failure: anyerror,
};

pub fn enqueueDependencyToRoot(
    this: *PackageManager,
    name: []const u8,
    version: *const Dependency.Version,
    version_buf: []const u8,
    behavior: Dependency.Behavior,
) DependencyToEnqueue {
    const dep_id = @as(DependencyID, @truncate(brk: {
        const str_buf = this.lockfile.buffers.string_bytes.items;
        for (this.lockfile.buffers.dependencies.items, 0..) |dep, id| {
            if (!strings.eqlLong(dep.name.slice(str_buf), name, true)) continue;
            if (!dep.version.eql(version, str_buf, version_buf)) continue;
            break :brk id;
        }

        var builder = this.lockfile.stringBuilder();
        const dummy = Dependency{
            .name = String.init(name, name),
            .name_hash = String.Builder.stringHash(name),
            .version = version.*,
            .behavior = behavior,
        };
        dummy.countWithDifferentBuffers(name, version_buf, @TypeOf(&builder), &builder);

        builder.allocate() catch |err| return .{ .failure = err };

        const dep = dummy.cloneWithDifferentBuffers(this, name, version_buf, @TypeOf(&builder), &builder) catch unreachable;
        builder.clamp();
        const index = this.lockfile.buffers.dependencies.items.len;
        this.lockfile.buffers.dependencies.append(this.allocator, dep) catch unreachable;
        this.lockfile.buffers.resolutions.append(this.allocator, invalid_package_id) catch unreachable;
        if (comptime Environment.allow_assert) bun.assert(this.lockfile.buffers.dependencies.items.len == this.lockfile.buffers.resolutions.items.len);
        break :brk index;
    }));

    if (this.lockfile.buffers.resolutions.items[dep_id] == invalid_package_id) {
        this.enqueueDependencyWithMainAndSuccessFn(
            dep_id,
            &this.lockfile.buffers.dependencies.items[dep_id],
            invalid_package_id,
            false,
            assignRootResolution,
            failRootResolution,
        ) catch |err| {
            return .{ .failure = err };
        };
    }

    const resolution_id = switch (this.lockfile.buffers.resolutions.items[dep_id]) {
        invalid_package_id => brk: {
            this.drainDependencyList();

            const Closure = struct {
                // https://github.com/ziglang/zig/issues/19586
                pub fn issue_19586_workaround() type {
                    return struct {
                        err: ?anyerror = null,
                        manager: *PackageManager,
                        pub fn isDone(closure: *@This()) bool {
                            const manager = closure.manager;
                            if (manager.pendingTaskCount() > 0) {
                                manager.runTasks(
                                    void,
                                    {},
                                    .{
                                        .onExtract = {},
                                        .onResolve = {},
                                        .onPackageManifestError = {},
                                        .onPackageDownloadError = {},
                                    },
                                    false,
                                    manager.options.log_level,
                                ) catch |err| {
                                    closure.err = err;
                                    return true;
                                };

                                if (PackageManager.verbose_install and manager.pendingTaskCount() > 0) {
                                    if (PackageManager.hasEnoughTimePassedBetweenWaitingMessages()) Output.prettyErrorln("<d>[PackageManager]<r> waiting for {d} tasks\n", .{closure.manager.pendingTaskCount()});
                                }
                            }

                            return manager.pendingTaskCount() == 0;
                        }
                    };
                }
            }.issue_19586_workaround();

            if (this.options.log_level.showProgress()) {
                this.startProgressBarIfNone();
            }

            var closure = Closure{ .manager = this };
            this.sleepUntil(&closure, &Closure.isDone);

            if (this.options.log_level.showProgress()) {
                this.endProgressBar();
                Output.flush();
            }

            if (closure.err) |err| {
                return .{ .failure = err };
            }

            break :brk this.lockfile.buffers.resolutions.items[dep_id];
        },
        // we managed to synchronously resolve the dependency
        else => |pkg_id| pkg_id,
    };

    if (resolution_id == invalid_package_id) {
        return .{
            .not_found = {},
        };
    }

    return .{
        .resolution = .{
            .resolution = this.lockfile.packages.items(.resolution)[resolution_id],
            .package_id = resolution_id,
        },
    };
}

pub fn enqueueNetworkTask(this: *PackageManager, task: *NetworkTask) void {
    if (this.network_task_fifo.writableLength() == 0) {
        this.flushNetworkQueue();
    }

    this.network_task_fifo.writeItemAssumeCapacity(task);
}

pub fn enqueuePatchTask(this: *PackageManager, task: *PatchTask) void {
    debug("Enqueue patch task: 0x{x} {s}", .{ @intFromPtr(task), @tagName(task.callback) });
    if (this.patch_task_fifo.writableLength() == 0) {
        this.flushPatchTaskQueue();
    }

    this.patch_task_fifo.writeItemAssumeCapacity(task);
}

/// We need to calculate all the patchfile hashes at the beginning so we don't run into problems with stale hashes
pub fn enqueuePatchTaskPre(this: *PackageManager, task: *PatchTask) void {
    debug("Enqueue patch task pre: 0x{x} {s}", .{ @intFromPtr(task), @tagName(task.callback) });
    task.pre = true;
    if (this.patch_task_fifo.writableLength() == 0) {
        this.flushPatchTaskQueue();
    }

    this.patch_task_fifo.writeItemAssumeCapacity(task);
    _ = this.pending_pre_calc_hashes.fetchAdd(1, .monotonic);
}

/// Q: "What do we do with a dependency in a package.json?"
/// A: "We enqueue it!"
pub fn enqueueDependencyWithMainAndSuccessFn(
    this: *PackageManager,
    id: DependencyID,
    /// This must be a *const to prevent UB
    dependency: *const Dependency,
    resolution: PackageID,
    install_peer: bool,
    comptime successFn: SuccessFn,
    comptime failFn: ?FailFn,
) !void {
    if (dependency.behavior.isOptionalPeer()) return;

    var name = dependency.realname();
    var name_hash = switch (dependency.version.tag) {
        .dist_tag, .git, .github, .npm, .tarball, .workspace => String.Builder.stringHash(this.lockfile.str(&name)),
        else => dependency.name_hash,
    };

    const version = version: {
        if (dependency.version.tag == .npm) {
            if (this.known_npm_aliases.get(name_hash)) |aliased| {
                const group = dependency.version.value.npm.version;
                const buf = this.lockfile.buffers.string_bytes.items;
                var curr_list: ?*const Semver.Query.List = &aliased.value.npm.version.head;
                while (curr_list) |queries| {
                    var curr: ?*const Semver.Query = &queries.head;
                    while (curr) |query| {
                        if (group.satisfies(query.range.left.version, buf, buf) or group.satisfies(query.range.right.version, buf, buf)) {
                            name = aliased.value.npm.name;
                            name_hash = String.Builder.stringHash(this.lockfile.str(&name));
                            break :version aliased;
                        }
                        curr = query.next;
                    }
                    curr_list = queries.next;
                }

                // fallthrough. a package that matches the name of an alias but does not match
                // the version should be enqueued as a normal npm dependency, overrides allowed
            }
        }

        // allow overriding all dependencies unless the dependency is coming directly from an alias, "npm:<this dep>" or
        // if it's a workspaceOnly dependency
        if (!dependency.behavior.isWorkspace() and (dependency.version.tag != .npm or !dependency.version.value.npm.is_alias)) {
            if (this.lockfile.overrides.get(name_hash)) |new| {
                debug("override: {s} -> {s}", .{ this.lockfile.str(&dependency.version.literal), this.lockfile.str(&new.literal) });

                name, name_hash = updateNameAndNameHashFromVersionReplacement(this.lockfile, name, name_hash, new);

                if (new.tag == .catalog) {
                    if (this.lockfile.catalogs.get(this.lockfile, new.value.catalog, name)) |catalog_dep| {
                        name, name_hash = updateNameAndNameHashFromVersionReplacement(this.lockfile, name, name_hash, catalog_dep.version);
                        break :version catalog_dep.version;
                    }
                }

                // `name_hash` stays the same
                break :version new;
            }

            if (dependency.version.tag == .catalog) {
                if (this.lockfile.catalogs.get(this.lockfile, dependency.version.value.catalog, name)) |catalog_dep| {
                    name, name_hash = updateNameAndNameHashFromVersionReplacement(this.lockfile, name, name_hash, catalog_dep.version);

                    break :version catalog_dep.version;
                }
            }
        }

        // explicit copy here due to `dependency.version` becoming undefined
        // when `getOrPutResolvedPackageWithFindResult` is called and resizes the list.
        break :version Dependency.Version{
            .literal = dependency.version.literal,
            .tag = dependency.version.tag,
            .value = dependency.version.value,
        };
    };
    var loaded_manifest: ?Npm.PackageManifest = null;

    switch (version.tag) {
        .dist_tag, .folder, .npm => {
            retry_from_manifests_ptr: while (true) {
                var resolve_result_ = getOrPutResolvedPackage(
                    this,
                    name_hash,
                    name,
                    dependency,
                    version,
                    dependency.behavior,
                    id,
                    resolution,
                    install_peer,
                    successFn,
                );

                retry_with_new_resolve_result: while (true) {
                    const resolve_result = resolve_result_ catch |err| {
                        switch (err) {
                            error.DistTagNotFound => {
                                if (dependency.behavior.isRequired()) {
                                    if (failFn) |fail| {
                                        fail(
                                            this,
                                            dependency,
                                            id,
                                            err,
                                        );
                                    } else {
                                        this.log.addErrorFmt(
                                            null,
                                            logger.Loc.Empty,
                                            this.allocator,
                                            "Package \"{s}\" with tag \"{s}\" not found, but package exists",
                                            .{
                                                this.lockfile.str(&name),
                                                this.lockfile.str(&version.value.dist_tag.tag),
                                            },
                                        ) catch unreachable;
                                    }
                                }

                                return;
                            },
                            error.NoMatchingVersion => {
                                if (dependency.behavior.isRequired()) {
                                    if (failFn) |fail| {
                                        fail(
                                            this,
                                            dependency,
                                            id,
                                            err,
                                        );
                                    } else {
                                        this.log.addErrorFmt(
                                            null,
                                            logger.Loc.Empty,
                                            this.allocator,
                                            "No version matching \"{s}\" found for specifier \"{s}\"<r> <d>(but package exists)<r>",
                                            .{
                                                this.lockfile.str(&version.literal),
                                                this.lockfile.str(&name),
                                            },
                                        ) catch unreachable;
                                    }
                                }
                                return;
                            },
                            error.TooRecentVersion => {
                                if (dependency.behavior.isRequired()) {
                                    if (failFn) |fail| {
                                        fail(
                                            this,
                                            dependency,
                                            id,
                                            err,
                                        );
                                    } else {
                                        const age_gate_ms = this.options.minimum_release_age_ms orelse 0;
                                        if (version.tag == .dist_tag) {
                                            this.log.addErrorFmt(
                                                null,
                                                logger.Loc.Empty,
                                                this.allocator,
                                                "Package \"{s}\" with tag \"{s}\" not found<r> <d>(all versions blocked by minimum-release-age: {d} seconds)<r>",
                                                .{
                                                    this.lockfile.str(&name),
                                                    this.lockfile.str(&version.value.dist_tag.tag),
                                                    age_gate_ms / std.time.ms_per_s,
                                                },
                                            ) catch unreachable;
                                        } else {
                                            this.log.addErrorFmt(
                                                null,
                                                logger.Loc.Empty,
                                                this.allocator,
                                                "No version matching \"{s}\" found for specifier \"{s}\"<r> <d>(blocked by minimum-release-age: {d} seconds)<r>",
                                                .{
                                                    this.lockfile.str(&name),
                                                    this.lockfile.str(&version.literal),
                                                    age_gate_ms / std.time.ms_per_s,
                                                },
                                            ) catch unreachable;
                                        }
                                    }
                                }
                                return;
                            },
                            else => {
                                if (failFn) |fail| {
                                    fail(
                                        this,
                                        dependency,
                                        id,
                                        err,
                                    );
                                    return;
                                }

                                return err;
                            },
                        }
                    };

                    if (resolve_result) |result| {
                        // First time?
                        if (result.is_first_time) {
                            if (PackageManager.verbose_install) {
                                const label: string = this.lockfile.str(&version.literal);

                                Output.prettyErrorln("   -> \"{s}\": \"{s}\" -> {s}@{f}", .{
                                    this.lockfile.str(&result.package.name),
                                    label,
                                    this.lockfile.str(&result.package.name),
                                    result.package.resolution.fmt(this.lockfile.buffers.string_bytes.items, .auto),
                                });
                            }
                            // Resolve dependencies first
                            if (result.package.dependencies.len > 0) {
                                try this.lockfile.scratch.dependency_list_queue.writeItem(result.package.dependencies);
                            }
                        }

                        if (result.task != null) {
                            switch (result.task.?) {
                                .network_task => |network_task| {
                                    if (this.getPreinstallState(result.package.meta.id) == .extract) {
                                        this.setPreinstallState(result.package.meta.id, this.lockfile, .extracting);
                                        this.enqueueNetworkTask(network_task);
                                    }
                                },
                                .patch_task => |patch_task| {
                                    if (patch_task.callback == .calc_hash and this.getPreinstallState(result.package.meta.id) == .calc_patch_hash) {
                                        this.setPreinstallState(result.package.meta.id, this.lockfile, .calcing_patch_hash);
                                        this.enqueuePatchTask(patch_task);
                                    } else if (patch_task.callback == .apply and this.getPreinstallState(result.package.meta.id) == .apply_patch) {
                                        this.setPreinstallState(result.package.meta.id, this.lockfile, .applying_patch);
                                        this.enqueuePatchTask(patch_task);
                                    }
                                },
                            }
                        }

                        if (comptime Environment.allow_assert)
                            debug(
                                "enqueueDependency({d}, {s}, {s}, {s}) = {d}",
                                .{
                                    id,
                                    @tagName(version.tag),
                                    this.lockfile.str(&name),
                                    this.lockfile.str(&version.literal),
                                    result.package.meta.id,
                                },
                            );
                    } else if (version.tag.isNPM()) {
                        const name_str = this.lockfile.str(&name);
                        const task_id = Task.Id.forManifest(name_str);

                        if (comptime Environment.allow_assert) bun.assert(task_id.get() != 0);

                        if (comptime Environment.allow_assert)
                            debug(
                                "enqueueDependency({d}, {s}, {s}, {s}) = task {d}",
                                .{
                                    id,
                                    @tagName(version.tag),
                                    this.lockfile.str(&name),
                                    this.lockfile.str(&version.literal),
                                    task_id,
                                },
                            );

                        if (!dependency.behavior.isPeer() or install_peer) {
                            if (!this.hasCreatedNetworkTask(task_id, dependency.behavior.isRequired())) {
                                const needs_extended_manifest = this.options.minimum_release_age_ms != null;
                                if (this.options.enable.manifest_cache) {
                                    var expired = false;
                                    if (this.manifests.byNameHashAllowExpired(
                                        this,
                                        this.scopeForPackageName(name_str),
                                        name_hash,
                                        &expired,
                                        .load_from_memory_fallback_to_disk,
                                        needs_extended_manifest,
                                    )) |manifest| {
                                        loaded_manifest = manifest.*;

                                        // If it's an exact package version already living in the cache
                                        // We can skip the network request, even if it's beyond the caching period
                                        if (version.tag == .npm and version.value.npm.version.isExact()) {
                                            if (loaded_manifest.?.findByVersion(version.value.npm.version.head.head.range.left.version)) |find_result| {
                                                if (this.options.minimum_release_age_ms) |min_age_ms| {
                                                    if (!loaded_manifest.?.shouldExcludeFromAgeFilter(this.options.minimum_release_age_excludes) and Npm.PackageManifest.isPackageVersionTooRecent(find_result.package, min_age_ms)) {
                                                        const package_name = this.lockfile.str(&name);
                                                        const min_age_seconds = min_age_ms / std.time.ms_per_s;
                                                        this.log.addErrorFmt(null, logger.Loc.Empty, this.allocator, "Version \"{s}@{f}\" was published within minimum release age of {d} seconds", .{ package_name, find_result.version.fmt(this.lockfile.buffers.string_bytes.items), min_age_seconds }) catch {};
                                                        return;
                                                    }
                                                }
                                                if (getOrPutResolvedPackageWithFindResult(
                                                    this,
                                                    name_hash,
                                                    name,
                                                    dependency,
                                                    version,
                                                    id,
                                                    dependency.behavior,
                                                    &loaded_manifest.?,
                                                    find_result,
                                                    install_peer,
                                                    successFn,
                                                ) catch null) |new_resolve_result| {
                                                    resolve_result_ = new_resolve_result;
                                                    _ = this.network_dedupe_map.remove(task_id);
                                                    continue :retry_with_new_resolve_result;
                                                }
                                            }
                                        }

                                        // Was it recent enough to just load it without the network call?
                                        if (this.options.enable.manifest_cache_control and !expired) {
                                            _ = this.network_dedupe_map.remove(task_id);
                                            continue :retry_from_manifests_ptr;
                                        }
                                    }
                                }

                                if (PackageManager.verbose_install) {
                                    Output.prettyErrorln("Enqueue package manifest for download: {s}", .{name_str});
                                }

                                var network_task = this.getNetworkTask();
                                network_task.* = .{
                                    .package_manager = this,
                                    .callback = undefined,
                                    .task_id = task_id,
                                    .allocator = this.allocator,
                                };

                                try network_task.forManifest(
                                    name_str,
                                    this.allocator,
                                    this.scopeForPackageName(name_str),
                                    if (loaded_manifest) |*manifest| manifest else null,
                                    dependency.behavior.isOptional(),
                                    needs_extended_manifest,
                                );
                                this.enqueueNetworkTask(network_task);
                            }
                        } else {
                            try this.peer_dependencies.writeItem(id);
                            return;
                        }

                        var manifest_entry_parse = try this.task_queue.getOrPutContext(this.allocator, task_id, .{});
                        if (!manifest_entry_parse.found_existing) {
                            manifest_entry_parse.value_ptr.* = TaskCallbackList{};
                        }

                        const callback_tag = comptime if (successFn == assignRootResolution) "root_dependency" else "dependency";
                        try manifest_entry_parse.value_ptr.append(this.allocator, @unionInit(TaskCallbackContext, callback_tag, id));
                    }
                    return;
                }
            }
            return;
        },
        .git => {
            const dep = &version.value.git;
            const res = Resolution{
                .tag = .git,
                .value = .{
                    .git = dep.*,
                },
            };

            // First: see if we already loaded the git package in-memory
            if (this.lockfile.getPackageID(name_hash, null, &res)) |pkg_id| {
                successFn(this, id, pkg_id);
                return;
            }

            const alias = this.lockfile.str(&dependency.name);
            const url = this.lockfile.str(&dep.repo);
            const clone_id = Task.Id.forGitClone(url);
            const ctx = @unionInit(
                TaskCallbackContext,
                if (successFn == assignRootResolution) "root_dependency" else "dependency",
                id,
            );

            if (comptime Environment.allow_assert)
                debug(
                    "enqueueDependency({d}, {s}, {s}, {s}) = {s}",
                    .{
                        id,
                        @tagName(version.tag),
                        this.lockfile.str(&name),
                        this.lockfile.str(&version.literal),
                        url,
                    },
                );

            if (this.git_repositories.get(clone_id)) |repo_fd| {
                const resolved = try Repository.findCommit(
                    this.allocator,
                    this.env,
                    this.log,
                    repo_fd.stdDir(),
                    alias,
                    this.lockfile.str(&dep.committish),
                    clone_id,
                );
                const checkout_id = Task.Id.forGitCheckout(url, resolved);

                var entry = this.task_queue.getOrPutContext(this.allocator, checkout_id, .{}) catch unreachable;
                if (!entry.found_existing) entry.value_ptr.* = .{};
                if (this.lockfile.buffers.resolutions.items[id] == invalid_package_id) {
                    try entry.value_ptr.append(this.allocator, ctx);
                }

                if (dependency.behavior.isPeer()) {
                    if (!install_peer) {
                        try this.peer_dependencies.writeItem(id);
                        return;
                    }
                }

                if (this.hasCreatedNetworkTask(checkout_id, dependency.behavior.isRequired())) return;

                this.task_batch.push(ThreadPool.Batch.from(this.enqueueGitCheckout(
                    checkout_id,
                    repo_fd,
                    id,
                    alias,
                    res,
                    resolved,
                    null,
                )));
            } else {
                var entry = this.task_queue.getOrPutContext(this.allocator, clone_id, .{}) catch unreachable;
                if (!entry.found_existing) entry.value_ptr.* = .{};
                try entry.value_ptr.append(this.allocator, ctx);

                if (dependency.behavior.isPeer()) {
                    if (!install_peer) {
                        try this.peer_dependencies.writeItem(id);
                        return;
                    }
                }

                if (this.hasCreatedNetworkTask(clone_id, dependency.behavior.isRequired())) return;

                this.task_batch.push(ThreadPool.Batch.from(enqueueGitClone(this, clone_id, alias, dep, id, dependency, &res, null)));
            }
        },
        .github => {
            const dep = &version.value.github;
            const res = Resolution{
                .tag = .github,
                .value = .{
                    .github = dep.*,
                },
            };

            // First: see if we already loaded the github package in-memory
            if (this.lockfile.getPackageID(name_hash, null, &res)) |pkg_id| {
                successFn(this, id, pkg_id);
                return;
            }

            const url = this.allocGitHubURL(dep);
            defer this.allocator.free(url);
            const task_id = Task.Id.forTarball(url);
            var entry = this.task_queue.getOrPutContext(this.allocator, task_id, .{}) catch unreachable;
            if (!entry.found_existing) {
                entry.value_ptr.* = TaskCallbackList{};
            }

            if (comptime Environment.allow_assert)
                debug(
                    "enqueueDependency({d}, {s}, {s}, {s}) = {s}",
                    .{
                        id,
                        @tagName(version.tag),
                        this.lockfile.str(&name),
                        this.lockfile.str(&version.literal),
                        url,
                    },
                );

            const callback_tag = comptime if (successFn == assignRootResolution) "root_dependency" else "dependency";
            try entry.value_ptr.append(this.allocator, @unionInit(TaskCallbackContext, callback_tag, id));

            if (dependency.behavior.isPeer()) {
                if (!install_peer) {
                    try this.peer_dependencies.writeItem(id);
                    return;
                }
            }

            if (try this.generateNetworkTaskForTarball(
                task_id,
                url,
                dependency.behavior.isRequired(),
                id,
                .{
                    .name = dependency.name,
                    .name_hash = dependency.name_hash,
                    .resolution = res,
                },
                null,
                .no_authorization,
            )) |network_task| {
                this.enqueueNetworkTask(network_task);
            }
        },
        inline .symlink, .workspace => |dependency_tag| {
            const _result = getOrPutResolvedPackage(
                this,
                name_hash,
                name,
                dependency,
                version,
                dependency.behavior,
                id,
                resolution,
                install_peer,
                successFn,
            ) catch |err| brk: {
                if (err == error.MissingPackageJSON) {
                    break :brk @as(?ResolvedPackageResult, null);
                }

                return err;
            };

            const workspace_not_found_fmt =
                \\Workspace dependency "{[name]s}" not found
                \\
                \\Searched in <b>{[search_path]f}<r>
                \\
                \\Workspace documentation: https://bun.com/docs/install/workspaces
                \\
            ;
            const link_not_found_fmt =
                \\Package "{[name]s}" is not linked
                \\
                \\To install a linked package:
                \\   <cyan>bun link my-pkg-name-from-package-json<r>
                \\
                \\Tip: the package name is from package.json, which can differ from the folder name.
                \\
            ;
            if (_result) |result| {
                // First time?
                if (result.is_first_time) {
                    if (PackageManager.verbose_install) {
                        const label: string = this.lockfile.str(&version.literal);

                        Output.prettyErrorln("   -> \"{s}\": \"{s}\" -> {s}@{f}", .{
                            this.lockfile.str(&result.package.name),
                            label,
                            this.lockfile.str(&result.package.name),
                            result.package.resolution.fmt(this.lockfile.buffers.string_bytes.items, .auto),
                        });
                    }
                    // We shouldn't see any dependencies
                    if (result.package.dependencies.len > 0) {
                        try this.lockfile.scratch.dependency_list_queue.writeItem(result.package.dependencies);
                    }
                }

                // should not trigger a network call
                if (comptime Environment.allow_assert) bun.assert(result.task == null);

                if (comptime Environment.allow_assert)
                    debug(
                        "enqueueDependency({d}, {s}, {s}, {s}) = {d}",
                        .{
                            id,
                            @tagName(version.tag),
                            this.lockfile.str(&name),
                            this.lockfile.str(&version.literal),
                            result.package.meta.id,
                        },
                    );
            } else if (dependency.behavior.isRequired()) {
                if (comptime dependency_tag == .workspace) {
                    this.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        this.allocator,
                        workspace_not_found_fmt,
                        .{
                            .name = this.lockfile.str(&name),
                            .search_path = FolderResolution.PackageWorkspaceSearchPathFormatter{ .manager = this, .version = version },
                        },
                    ) catch unreachable;
                } else {
                    this.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        this.allocator,
                        link_not_found_fmt,
                        .{
                            .name = this.lockfile.str(&name),
                        },
                    ) catch unreachable;
                }
            } else if (this.options.log_level.isVerbose()) {
                if (comptime dependency_tag == .workspace) {
                    this.log.addWarningFmt(
                        null,
                        logger.Loc.Empty,
                        this.allocator,
                        workspace_not_found_fmt,
                        .{
                            .name = this.lockfile.str(&name),
                            .search_path = FolderResolution.PackageWorkspaceSearchPathFormatter{ .manager = this, .version = version },
                        },
                    ) catch unreachable;
                } else {
                    this.log.addWarningFmt(
                        null,
                        logger.Loc.Empty,
                        this.allocator,
                        link_not_found_fmt,
                        .{
                            .name = this.lockfile.str(&name),
                        },
                    ) catch unreachable;
                }
            }
        },
        .tarball => {
            const res: Resolution = switch (version.value.tarball.uri) {
                .local => |path| .{
                    .tag = .local_tarball,
                    .value = .{
                        .local_tarball = path,
                    },
                },
                .remote => |url| .{
                    .tag = .remote_tarball,
                    .value = .{
                        .remote_tarball = url,
                    },
                },
            };

            // First: see if we already loaded the tarball package in-memory
            if (this.lockfile.getPackageID(name_hash, null, &res)) |pkg_id| {
                successFn(this, id, pkg_id);
                return;
            }

            const url = switch (version.value.tarball.uri) {
                .local => |path| this.lockfile.str(&path),
                .remote => |url| this.lockfile.str(&url),
            };
            const task_id = Task.Id.forTarball(url);
            var entry = this.task_queue.getOrPutContext(this.allocator, task_id, .{}) catch unreachable;
            if (!entry.found_existing) {
                entry.value_ptr.* = TaskCallbackList{};
            }

            if (comptime Environment.allow_assert)
                debug(
                    "enqueueDependency({d}, {s}, {s}, {s}) = {s}",
                    .{
                        id,
                        @tagName(version.tag),
                        this.lockfile.str(&name),
                        this.lockfile.str(&version.literal),
                        url,
                    },
                );

            const callback_tag = comptime if (successFn == assignRootResolution) "root_dependency" else "dependency";
            try entry.value_ptr.append(this.allocator, @unionInit(TaskCallbackContext, callback_tag, id));

            if (dependency.behavior.isPeer()) {
                if (!install_peer) {
                    try this.peer_dependencies.writeItem(id);
                    return;
                }
            }

            switch (version.value.tarball.uri) {
                .local => {
                    if (this.hasCreatedNetworkTask(task_id, dependency.behavior.isRequired())) return;

                    this.task_batch.push(ThreadPool.Batch.from(enqueueLocalTarball(
                        this,
                        task_id,
                        id,
                        this.lockfile.str(&dependency.name),
                        url,
                        res,
                    )));
                },
                .remote => {
                    if (try this.generateNetworkTaskForTarball(
                        task_id,
                        url,
                        dependency.behavior.isRequired(),
                        id,
                        .{
                            .name = dependency.name,
                            .name_hash = dependency.name_hash,
                            .resolution = res,
                        },
                        null,
                        .no_authorization,
                    )) |network_task| {
                        this.enqueueNetworkTask(network_task);
                    }
                },
            }
        },
        else => {},
    }
}

pub fn enqueueExtractNPMPackage(
    this: *PackageManager,
    tarball: *const ExtractTarball,
    network_task: *NetworkTask,
) *ThreadPool.Task {
    var task = this.preallocated_resolve_tasks.get();
    task.* = Task{
        .package_manager = this,
        .log = logger.Log.init(this.allocator),
        .tag = Task.Tag.extract,
        .request = .{
            .extract = .{
                .network = network_task,
                .tarball = tarball.*,
            },
        },
        .id = network_task.task_id,
        .data = undefined,
    };
    task.request.extract.tarball.skip_verify = !this.options.do.verify_integrity;
    return &task.threadpool_task;
}

fn enqueueGitClone(
    this: *PackageManager,
    task_id: Task.Id,
    name: string,
    repository: *const Repository,
    dep_id: DependencyID,
    dependency: *const Dependency,
    res: *const Resolution,
    /// if patched then we need to do apply step after network task is done
    patch_name_and_version_hash: ?u64,
) *ThreadPool.Task {
    var task = this.preallocated_resolve_tasks.get();
    task.* = Task{
        .package_manager = this,
        .log = logger.Log.init(this.allocator),
        .tag = Task.Tag.git_clone,
        .request = .{
            .git_clone = .{
                .name = strings.StringOrTinyString.initAppendIfNeeded(
                    name,
                    *FileSystem.FilenameStore,
                    FileSystem.FilenameStore.instance,
                ) catch unreachable,
                .url = strings.StringOrTinyString.initAppendIfNeeded(
                    this.lockfile.str(&repository.repo),
                    *FileSystem.FilenameStore,
                    FileSystem.FilenameStore.instance,
                ) catch unreachable,
                .env = Repository.shared_env.get(this.allocator, this.env),
                .dep_id = dep_id,
                .res = res.*,
            },
        },
        .id = task_id,
        .apply_patch_task = if (patch_name_and_version_hash) |h| brk: {
            const dep = dependency;
            const pkg_id = switch (this.lockfile.package_index.get(dep.name_hash) orelse @panic("Package not found")) {
                .id => |p| p,
                .ids => |ps| ps.items[0], // TODO is this correct
            };
            const patch_hash = this.lockfile.patched_dependencies.get(h).?.patchfileHash().?;
            const pt = PatchTask.newApplyPatchHash(this, pkg_id, patch_hash, h);
            pt.callback.apply.task_id = task_id;
            break :brk pt;
        } else null,
        .data = undefined,
    };
    return &task.threadpool_task;
}

pub fn enqueueGitCheckout(
    this: *PackageManager,
    task_id: Task.Id,
    dir: bun.FileDescriptor,
    dependency_id: DependencyID,
    name: string,
    resolution: Resolution,
    resolved: string,
    /// if patched then we need to do apply step after network task is done
    patch_name_and_version_hash: ?u64,
) *ThreadPool.Task {
    var task = this.preallocated_resolve_tasks.get();
    task.* = Task{
        .package_manager = this,
        .log = logger.Log.init(this.allocator),
        .tag = Task.Tag.git_checkout,
        .request = .{
            .git_checkout = .{
                .repo_dir = dir,
                .resolution = resolution,
                .dependency_id = dependency_id,
                .name = strings.StringOrTinyString.initAppendIfNeeded(
                    name,
                    *FileSystem.FilenameStore,
                    FileSystem.FilenameStore.instance,
                ) catch unreachable,
                .url = strings.StringOrTinyString.initAppendIfNeeded(
                    this.lockfile.str(&resolution.value.git.repo),
                    *FileSystem.FilenameStore,
                    FileSystem.FilenameStore.instance,
                ) catch unreachable,
                .resolved = strings.StringOrTinyString.initAppendIfNeeded(
                    resolved,
                    *FileSystem.FilenameStore,
                    FileSystem.FilenameStore.instance,
                ) catch unreachable,
                .env = Repository.shared_env.get(this.allocator, this.env),
            },
        },
        .apply_patch_task = if (patch_name_and_version_hash) |h| brk: {
            const dep = this.lockfile.buffers.dependencies.items[dependency_id];
            const pkg_id = switch (this.lockfile.package_index.get(dep.name_hash) orelse @panic("Package not found")) {
                .id => |p| p,
                .ids => |ps| ps.items[0], // TODO is this correct
            };
            const patch_hash = this.lockfile.patched_dependencies.get(h).?.patchfileHash().?;
            const pt = PatchTask.newApplyPatchHash(this, pkg_id, patch_hash, h);
            pt.callback.apply.task_id = task_id;
            break :brk pt;
        } else null,
        .id = task_id,
        .data = undefined,
    };
    return &task.threadpool_task;
}

fn enqueueLocalTarball(
    this: *PackageManager,
    task_id: Task.Id,
    dependency_id: DependencyID,
    name: string,
    path: string,
    resolution: Resolution,
) *ThreadPool.Task {
    var task = this.preallocated_resolve_tasks.get();
    task.* = Task{
        .package_manager = this,
        .log = logger.Log.init(this.allocator),
        .tag = Task.Tag.local_tarball,
        .request = .{
            .local_tarball = .{
                .tarball = .{
                    .package_manager = this,
                    .name = strings.StringOrTinyString.initAppendIfNeeded(
                        name,
                        *FileSystem.FilenameStore,
                        FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                    .resolution = resolution,
                    .cache_dir = this.getCacheDirectory(),
                    .temp_dir = this.getTemporaryDirectory().handle,
                    .dependency_id = dependency_id,
                    .url = strings.StringOrTinyString.initAppendIfNeeded(
                        path,
                        *FileSystem.FilenameStore,
                        FileSystem.FilenameStore.instance,
                    ) catch unreachable,
                },
            },
        },
        .id = task_id,
        .data = undefined,
    };
    return &task.threadpool_task;
}

fn updateNameAndNameHashFromVersionReplacement(
    lockfile: *const Lockfile,
    original_name: String,
    original_name_hash: PackageNameHash,
    new_version: Dependency.Version,
) struct { String, PackageNameHash } {
    return switch (new_version.tag) {
        // only get name hash for npm and dist_tag. git, github, tarball don't have names until after extracting tarball
        .dist_tag => .{ new_version.value.dist_tag.name, String.Builder.stringHash(lockfile.str(&new_version.value.dist_tag.name)) },
        .npm => .{ new_version.value.npm.name, String.Builder.stringHash(lockfile.str(&new_version.value.npm.name)) },
        .git => .{ new_version.value.git.package_name, original_name_hash },
        .github => .{ new_version.value.github.package_name, original_name_hash },
        .tarball => .{ new_version.value.tarball.package_name, original_name_hash },
        else => .{ original_name, original_name_hash },
    };
}

pub const ResolvedPackageResult = struct {
    package: Lockfile.Package,

    /// Is this the first time we've seen this package?
    is_first_time: bool = false,

    task: ?union(enum) {
        /// Pending network task to schedule
        network_task: *NetworkTask,

        /// Apply patch task or calc patch hash task
        patch_task: *PatchTask,
    } = null,
};

fn getOrPutResolvedPackageWithFindResult(
    this: *PackageManager,
    name_hash: PackageNameHash,
    name: String,
    dependency: *const Dependency,
    version: Dependency.Version,
    dependency_id: DependencyID,
    behavior: Behavior,
    manifest: *const Npm.PackageManifest,
    find_result: Npm.PackageManifest.FindResult,
    install_peer: bool,
    comptime successFn: SuccessFn,
) !?ResolvedPackageResult {
    const should_update = this.to_update and
        // If updating, only update packages in the current workspace
        this.lockfile.isRootDependency(this, dependency_id) and
        // no need to do a look up if update requests are empty (`bun update` with no args)
        (this.update_requests.len == 0 or
            this.updating_packages.contains(dependency.name.slice(this.lockfile.buffers.string_bytes.items)));

    // Was this package already allocated? Let's reuse the existing one.
    if (this.lockfile.getPackageID(
        name_hash,
        if (should_update) null else version,
        &.{
            .tag = .npm,
            .value = .{
                .npm = .{
                    .version = find_result.version,
                    .url = find_result.package.tarball_url.value,
                },
            },
        },
    )) |id| {
        successFn(this, dependency_id, id);
        return .{
            .package = this.lockfile.packages.get(id),
            .is_first_time = false,
        };
    } else if (behavior.isPeer() and !install_peer) {
        return null;
    }

    // appendPackage sets the PackageID on the package
    const package = try this.lockfile.appendPackage(try Lockfile.Package.fromNPM(
        this,
        this.allocator,
        this.lockfile,
        this.log,
        manifest,
        find_result.version,
        find_result.package,
        Features.npm,
    ));

    if (comptime Environment.allow_assert) bun.assert(package.meta.id != invalid_package_id);
    defer successFn(this, dependency_id, package.meta.id);

    // non-null if the package is in "patchedDependencies"
    var name_and_version_hash: ?u64 = null;
    var patchfile_hash: ?u64 = null;

    return switch (this.determinePreinstallState(
        package,
        this.lockfile,
        &name_and_version_hash,
        &patchfile_hash,
    )) {
        // Is this package already in the cache?
        // We don't need to download the tarball, but we should enqueue dependencies
        .done => .{ .package = package, .is_first_time = true },
        // Do we need to download the tarball?
        .extract => extract: {
            // Skip tarball download when prefetch_resolved_tarballs is disabled (e.g., --lockfile-only)
            if (!this.options.do.prefetch_resolved_tarballs) {
                break :extract .{ .package = package, .is_first_time = true };
            }

            const task_id = Task.Id.forNPMPackage(this.lockfile.str(&name), package.resolution.value.npm.version);
            bun.debugAssert(!this.network_dedupe_map.contains(task_id));

            break :extract .{
                .package = package,
                .is_first_time = true,
                .task = .{
                    .network_task = try this.generateNetworkTaskForTarball(
                        task_id,
                        manifest.str(&find_result.package.tarball_url),
                        dependency.behavior.isRequired(),
                        dependency_id,
                        package,
                        name_and_version_hash,
                        // its npm.
                        .allow_authorization,
                    ) orelse unreachable,
                },
            };
        },
        .calc_patch_hash => .{
            .package = package,
            .is_first_time = true,
            .task = .{
                .patch_task = PatchTask.newCalcPatchHash(
                    this,
                    name_and_version_hash.?,
                    .{
                        .pkg_id = package.meta.id,
                        .dependency_id = dependency_id,
                        .url = bun.handleOom(this.allocator.dupe(u8, manifest.str(&find_result.package.tarball_url))),
                    },
                ),
            },
        },
        .apply_patch => .{
            .package = package,
            .is_first_time = true,
            .task = .{
                .patch_task = PatchTask.newApplyPatchHash(
                    this,
                    package.meta.id,
                    patchfile_hash.?,
                    name_and_version_hash.?,
                ),
            },
        },
        else => unreachable,
    };
}

fn getOrPutResolvedPackage(
    this: *PackageManager,
    name_hash: PackageNameHash,
    name: String,
    dependency: *const Dependency,
    version: Dependency.Version,
    behavior: Behavior,
    dependency_id: DependencyID,
    resolution: PackageID,
    install_peer: bool,
    comptime successFn: SuccessFn,
) !?ResolvedPackageResult {
    if (install_peer and behavior.isPeer()) {
        if (this.lockfile.package_index.get(name_hash)) |index| {
            const resolutions: []Resolution = this.lockfile.packages.items(.resolution);
            switch (index) {
                .id => |existing_id| {
                    if (existing_id < resolutions.len) {
                        const existing_resolution = resolutions[existing_id];
                        if (resolutionSatisfiesDependency(this, existing_resolution, version)) {
                            successFn(this, dependency_id, existing_id);
                            return .{
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
                                .package = this.lockfile.packages.get(existing_id),
                            };
                        }

                        const res_tag = resolutions[existing_id].tag;
                        const ver_tag = version.tag;
                        if ((res_tag == .npm and ver_tag == .npm) or (res_tag == .git and ver_tag == .git) or (res_tag == .github and ver_tag == .github)) {
                            const existing_package = this.lockfile.packages.get(existing_id);
                            this.log.addWarningFmt(
                                null,
                                logger.Loc.Empty,
                                this.allocator,
                                "incorrect peer dependency \"{f}@{f}\"",
                                .{
                                    existing_package.name.fmt(this.lockfile.buffers.string_bytes.items),
                                    existing_package.resolution.fmt(this.lockfile.buffers.string_bytes.items, .auto),
                                },
                            ) catch unreachable;
                            successFn(this, dependency_id, existing_id);
                            return .{
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
                                .package = this.lockfile.packages.get(existing_id),
                            };
                        }
                    }
                },
                .ids => |list| {
                    for (list.items) |existing_id| {
                        if (existing_id < resolutions.len) {
                            const existing_resolution = resolutions[existing_id];
                            if (resolutionSatisfiesDependency(this, existing_resolution, version)) {
                                successFn(this, dependency_id, existing_id);
                                return .{
                                    .package = this.lockfile.packages.get(existing_id),
                                };
                            }
                        }
                    }

                    if (list.items[0] < resolutions.len) {
                        const res_tag = resolutions[list.items[0]].tag;
                        const ver_tag = version.tag;
                        if ((res_tag == .npm and ver_tag == .npm) or (res_tag == .git and ver_tag == .git) or (res_tag == .github and ver_tag == .github)) {
                            const existing_package_id = list.items[0];
                            const existing_package = this.lockfile.packages.get(existing_package_id);
                            this.log.addWarningFmt(
                                null,
                                logger.Loc.Empty,
                                this.allocator,
                                "incorrect peer dependency \"{f}@{f}\"",
                                .{
                                    existing_package.name.fmt(this.lockfile.buffers.string_bytes.items),
                                    existing_package.resolution.fmt(this.lockfile.buffers.string_bytes.items, .auto),
                                },
                            ) catch unreachable;
                            successFn(this, dependency_id, list.items[0]);
                            return .{
                                // we must fetch it from the packages array again, incase the package array mutates the value in the `successFn`
                                .package = this.lockfile.packages.get(existing_package_id),
                            };
                        }
                    }
                },
            }
        }
    }

    if (resolution < this.lockfile.packages.len) {
        return .{ .package = this.lockfile.packages.get(resolution) };
    }

    switch (version.tag) {
        .npm, .dist_tag => {
            resolve_from_workspace: {
                if (version.tag == .npm) {
                    const workspace_path = if (this.lockfile.workspace_paths.count() > 0) this.lockfile.workspace_paths.get(name_hash) else null;
                    const workspace_version = this.lockfile.workspace_versions.get(name_hash);
                    const buf = this.lockfile.buffers.string_bytes.items;
                    if (this.options.link_workspace_packages and
                        (((workspace_version != null and version.value.npm.version.satisfies(workspace_version.?, buf, buf)) or
                            // https://github.com/oven-sh/bun/pull/10899#issuecomment-2099609419
                            // if the workspace doesn't have a version, it can still be used if
                            // dependency version is wildcard
                            (workspace_path != null and version.value.npm.version.@"is *"()))))
                    {
                        const root_package = this.lockfile.rootPackage() orelse break :resolve_from_workspace;
                        const root_dependencies = root_package.dependencies.get(this.lockfile.buffers.dependencies.items);
                        const root_resolutions = root_package.resolutions.get(this.lockfile.buffers.resolutions.items);

                        for (root_dependencies, root_resolutions) |root_dep, workspace_package_id| {
                            if (workspace_package_id != invalid_package_id and root_dep.version.tag == .workspace and root_dep.name_hash == name_hash) {
                                // make sure verifyResolutions sees this resolution as a valid package id
                                successFn(this, dependency_id, workspace_package_id);
                                return .{
                                    .package = this.lockfile.packages.get(workspace_package_id),
                                    .is_first_time = false,
                                };
                            }
                        }
                    }
                }
            }

            // Resolve the version from the loaded NPM manifest
            const name_str = this.lockfile.str(&name);

            const manifest = this.manifests.byNameHash(
                this,
                this.scopeForPackageName(name_str),
                name_hash,
                .load_from_memory_fallback_to_disk,
                this.options.minimum_release_age_ms != null,
            ) orelse return null; // manifest might still be downloading. This feels unreliable.

            const version_result: Npm.PackageManifest.FindVersionResult = switch (version.tag) {
                .dist_tag => manifest.findByDistTagWithFilter(this.lockfile.str(&version.value.dist_tag.tag), this.options.minimum_release_age_ms, this.options.minimum_release_age_excludes),
                .npm => manifest.findBestVersionWithFilter(version.value.npm.version, this.lockfile.buffers.string_bytes.items, this.options.minimum_release_age_ms, this.options.minimum_release_age_excludes),
                else => unreachable,
            };

            const find_result: Npm.PackageManifest.FindResult = switch (version_result) {
                .found => |result| result,
                .found_with_filter => |filtered| blk: {
                    const package_name = this.lockfile.str(&name);
                    if (this.options.log_level.isVerbose()) {
                        if (filtered.newest_filtered) |newest| {
                            const min_age_seconds = (this.options.minimum_release_age_ms orelse 0) / std.time.ms_per_s;
                            switch (version.tag) {
                                .dist_tag => {
                                    const tag_str = this.lockfile.str(&version.value.dist_tag.tag);
                                    Output.prettyErrorln("<d>[minimum-release-age]<r> <b>{s}@{s}<r> selected <green>{f}<r> instead of <yellow>{f}<r> due to {d}-second filter", .{
                                        package_name,
                                        tag_str,
                                        filtered.result.version.fmt(manifest.string_buf),
                                        newest.fmt(manifest.string_buf),
                                        min_age_seconds,
                                    });
                                },
                                .npm => {
                                    const version_str = version.value.npm.version.fmt(manifest.string_buf);
                                    Output.prettyErrorln("<d>[minimum-release-age]<r> <b>{s}<r>@{f}<r> selected <green>{f}<r> instead of <yellow>{f}<r> due to {d}-second filter", .{
                                        package_name,
                                        version_str,
                                        filtered.result.version.fmt(manifest.string_buf),
                                        newest.fmt(manifest.string_buf),
                                        min_age_seconds,
                                    });
                                },
                                else => unreachable,
                            }
                        }
                    }

                    break :blk filtered.result;
                },
                .err => |err_type| switch (err_type) {
                    .too_recent, .all_versions_too_recent => return error.TooRecentVersion,
                    .not_found => null, // Handle below with existing logic
                },
            } orelse {
                resolve_workspace_from_dist_tag: {
                    // choose a workspace for a dist_tag only if a version was not found
                    if (version.tag == .dist_tag) {
                        const workspace_path = if (this.lockfile.workspace_paths.count() > 0) this.lockfile.workspace_paths.get(name_hash) else null;
                        if (workspace_path != null) {
                            const root_package = this.lockfile.rootPackage() orelse break :resolve_workspace_from_dist_tag;
                            const root_dependencies = root_package.dependencies.get(this.lockfile.buffers.dependencies.items);
                            const root_resolutions = root_package.resolutions.get(this.lockfile.buffers.resolutions.items);

                            for (root_dependencies, root_resolutions) |root_dep, workspace_package_id| {
                                if (workspace_package_id != invalid_package_id and root_dep.version.tag == .workspace and root_dep.name_hash == name_hash) {
                                    // make sure verifyResolutions sees this resolution as a valid package id
                                    successFn(this, dependency_id, workspace_package_id);
                                    return .{
                                        .package = this.lockfile.packages.get(workspace_package_id),
                                        .is_first_time = false,
                                    };
                                }
                            }
                        }
                    }
                }

                if (behavior.isPeer()) {
                    return null;
                }

                return switch (version.tag) {
                    .npm => error.NoMatchingVersion,
                    .dist_tag => error.DistTagNotFound,
                    else => unreachable,
                };
            };

            return try getOrPutResolvedPackageWithFindResult(
                this,
                name_hash,
                name,
                dependency,
                version,
                dependency_id,
                behavior,
                manifest,
                find_result,
                install_peer,
                successFn,
            );
        },

        .folder => {
            const res: FolderResolution = res: {
                if (this.lockfile.isWorkspaceDependency(dependency_id)) {
                    // relative to cwd
                    const folder_path = this.lockfile.str(&version.value.folder);
                    var buf2: bun.PathBuffer = undefined;
                    const folder_path_abs = if (std.fs.path.isAbsolute(folder_path)) folder_path else blk: {
                        break :blk Path.joinAbsStringBuf(
                            FileSystem.instance.top_level_dir,
                            &buf2,
                            &.{folder_path},
                            .auto,
                        );
                        // break :blk Path.joinAbsStringBuf(
                        //     strings.withoutSuffixComptime(this.original_package_json_path, "package.json"),
                        //     &buf2,
                        //     &[_]string{folder_path},
                        //     .auto,
                        // );
                    };

                    // if (strings.eqlLong(strings.withoutTrailingSlash(folder_path_abs), strings.withoutTrailingSlash(FileSystem.instance.top_level_dir), true)) {
                    //     successFn(this, dependency_id, 0);
                    //     return .{ .package = this.lockfile.packages.get(0) };
                    // }

                    break :res FolderResolution.getOrPut(.{ .relative = .folder }, version, folder_path_abs, this);
                }

                // transitive folder dependencies do not have their dependencies resolved
                var name_slice = this.lockfile.str(&name);
                var folder_path = this.lockfile.str(&version.value.folder);
                var package = Lockfile.Package{};

                {
                    // only need name and path
                    var builder = this.lockfile.stringBuilder();

                    builder.count(name_slice);
                    builder.count(folder_path);

                    bun.handleOom(builder.allocate());

                    name_slice = this.lockfile.str(&name);
                    folder_path = this.lockfile.str(&version.value.folder);

                    package.name = builder.append(String, name_slice);
                    package.name_hash = name_hash;

                    package.resolution = Resolution.init(.{
                        .folder = builder.append(String, folder_path),
                    });

                    package.scripts.filled = true;
                    package.meta.setHasInstallScript(false);

                    builder.clamp();
                }

                // these are always new
                package = bun.handleOom(this.lockfile.appendPackage(package));

                break :res .{
                    .new_package_id = package.meta.id,
                };
            };

            switch (res) {
                .err => |err| return err,
                .package_id => |package_id| {
                    successFn(this, dependency_id, package_id);
                    return .{ .package = this.lockfile.packages.get(package_id) };
                },

                .new_package_id => |package_id| {
                    successFn(this, dependency_id, package_id);
                    return .{ .package = this.lockfile.packages.get(package_id), .is_first_time = true };
                },
            }
        },
        .workspace => {
            // package name hash should be used to find workspace path from map
            const workspace_path_raw: *const String = this.lockfile.workspace_paths.getPtr(name_hash) orelse &version.value.workspace;
            const workspace_path = this.lockfile.str(workspace_path_raw);
            var buf2: bun.PathBuffer = undefined;
            const workspace_path_u8 = if (std.fs.path.isAbsolute(workspace_path)) workspace_path else blk: {
                break :blk Path.joinAbsStringBuf(FileSystem.instance.top_level_dir, &buf2, &[_]string{workspace_path}, .auto);
            };

            const res = FolderResolution.getOrPut(.{ .relative = .workspace }, version, workspace_path_u8, this);

            switch (res) {
                .err => |err| return err,
                .package_id => |package_id| {
                    successFn(this, dependency_id, package_id);
                    return .{ .package = this.lockfile.packages.get(package_id) };
                },

                .new_package_id => |package_id| {
                    successFn(this, dependency_id, package_id);
                    return .{ .package = this.lockfile.packages.get(package_id), .is_first_time = true };
                },
            }
        },
        .symlink => {
            const res = FolderResolution.getOrPut(.{ .global = this.globalLinkDirPath() }, version, this.lockfile.str(&version.value.symlink), this);

            switch (res) {
                .err => |err| return err,
                .package_id => |package_id| {
                    successFn(this, dependency_id, package_id);
                    return .{ .package = this.lockfile.packages.get(package_id) };
                },

                .new_package_id => |package_id| {
                    successFn(this, dependency_id, package_id);
                    return .{ .package = this.lockfile.packages.get(package_id), .is_first_time = true };
                },
            }
        },

        else => return null,
    }
}

fn resolutionSatisfiesDependency(this: *PackageManager, resolution: Resolution, dependency: Dependency.Version) bool {
    const buf = this.lockfile.buffers.string_bytes.items;
    if (resolution.tag == .npm and dependency.tag == .npm) {
        return dependency.value.npm.version.satisfies(resolution.value.npm.version, buf, buf);
    }

    if (resolution.tag == .git and dependency.tag == .git) {
        return resolution.value.git.eql(&dependency.value.git, buf, buf);
    }

    if (resolution.tag == .github and dependency.tag == .github) {
        return resolution.value.github.eql(&dependency.value.github, buf, buf);
    }

    return false;
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const Path = bun.path;
const ThreadPool = bun.ThreadPool;
const logger = bun.logger;
const strings = bun.strings;

const Semver = bun.Semver;
const String = Semver.String;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const Behavior = bun.install.Behavior;
const Dependency = bun.install.Dependency;
const DependencyID = bun.install.DependencyID;
const ExtractTarball = bun.install.ExtractTarball;
const Features = bun.install.Features;
const FolderResolution = bun.install.FolderResolution;
const Npm = bun.install.Npm;
const PackageID = bun.install.PackageID;
const PackageNameHash = bun.install.PackageNameHash;
const PatchTask = bun.install.PatchTask;
const Repository = bun.install.Repository;
const Resolution = bun.install.Resolution;
const Task = bun.install.Task;
const TaskCallbackContext = bun.install.TaskCallbackContext;
const invalid_package_id = bun.install.invalid_package_id;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;

const NetworkTask = bun.install.NetworkTask;
const EnqueuePackageForDownloadError = NetworkTask.ForTarballError;
const EnqueueTarballForDownloadError = NetworkTask.ForTarballError;

const PackageManager = bun.install.PackageManager;
const FailFn = PackageManager.FailFn;
const SuccessFn = PackageManager.SuccessFn;
const TaskCallbackList = PackageManager.TaskCallbackList;
const assignResolution = PackageManager.assignResolution;
const assignRootResolution = PackageManager.assignRootResolution;
const debug = PackageManager.debug;
const failRootResolution = PackageManager.failRootResolution;
