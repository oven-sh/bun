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
                .fmt = "error occurred while resolving {}",
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
        if (!dependency.behavior.isWorkspaceOnly() and (dependency.version.tag != .npm or !dependency.version.value.npm.is_alias)) {
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
                var resolve_result_ = this.getOrPutResolvedPackage(
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
                                            "No version matching \"{s}\" found for specifier \"{s}\" (but package exists)",
                                            .{
                                                this.lockfile.str(&version.literal),
                                                this.lockfile.str(&name),
                                            },
                                        ) catch unreachable;
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

                                Output.prettyErrorln("   -> \"{s}\": \"{s}\" -> {s}@{}", .{
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

                        if (comptime Environment.allow_assert) bun.assert(task_id != 0);

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
                                if (this.options.enable.manifest_cache) {
                                    var expired = false;
                                    if (this.manifests.byNameHashAllowExpired(
                                        this,
                                        this.scopeForPackageName(name_str),
                                        name_hash,
                                        &expired,
                                        .load_from_memory_fallback_to_disk,
                                    )) |manifest| {
                                        loaded_manifest = manifest.*;

                                        // If it's an exact package version already living in the cache
                                        // We can skip the network request, even if it's beyond the caching period
                                        if (version.tag == .npm and version.value.npm.version.isExact()) {
                                            if (loaded_manifest.?.findByVersion(version.value.npm.version.head.head.range.left.version)) |find_result| {
                                                if (this.getOrPutResolvedPackageWithFindResult(
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
            const _result = this.getOrPutResolvedPackage(
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
                \\Searched in <b>{[search_path]}<r>
                \\
                \\Workspace documentation: https://bun.sh/docs/install/workspaces
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

                        Output.prettyErrorln("   -> \"{s}\": \"{s}\" -> {s}@{}", .{
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
    task_id: u64,
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
    task_id: u64,
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
    task_id: u64,
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
                    .temp_dir = this.getTemporaryDirectory(),
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

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const Path = bun.path;
const Progress = bun.Progress;
const ThreadPool = bun.ThreadPool;
const logger = bun.logger;
const string = bun.string;
const strings = bun.strings;

const Semver = bun.Semver;
const String = Semver.String;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const Behavior = bun.install.Behavior;
const Dependency = bun.install.Dependency;
const DependencyID = bun.install.DependencyID;
const ExtractTarball = bun.install.ExtractTarball;
const FolderResolution = bun.install.FolderResolution;
const Npm = bun.install.Npm;
const PackageID = bun.install.PackageID;
const PackageManifestError = bun.install.PackageManifestError;
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
const ResolvedPackageResult = PackageManager.ResolvedPackageResult;
const SuccessFn = PackageManager.SuccessFn;
const TaskCallbackList = PackageManager.TaskCallbackList;
const assignResolution = PackageManager.assignResolution;
const assignRootResolution = PackageManager.assignRootResolution;
const debug = PackageManager.debug;
const failRootResolution = PackageManager.failRootResolution;
