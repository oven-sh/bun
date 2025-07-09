const log = Output.scoped(.IsolatedInstall, false);

pub fn installIsolatedPackages(
    manager: *PackageManager,
    command_ctx: Command.Context,
    install_root_dependencies: bool,
    workspace_filters: []const WorkspaceFilter,
) OOM!PackageInstall.Summary {
    bun.Analytics.Features.isolated_bun_install += 1;

    const lockfile = manager.lockfile;

    const store: Store = store: {
        var timer = std.time.Timer.start() catch unreachable;
        const pkgs = lockfile.packages.slice();
        const pkg_dependency_slices = pkgs.items(.dependencies);
        const pkg_resolutions = pkgs.items(.resolution);
        const pkg_names = pkgs.items(.name);

        const resolutions = lockfile.buffers.resolutions.items;
        const dependencies = lockfile.buffers.dependencies.items;
        const string_buf = lockfile.buffers.string_bytes.items;

        var nodes: Store.Node.List = .empty;

        const QueuedNode = struct {
            parent_id: Store.Node.Id,
            dep_id: DependencyID,
            pkg_id: PackageID,
        };

        var node_queue: std.fifo.LinearFifo(QueuedNode, .Dynamic) = .init(lockfile.allocator);
        defer node_queue.deinit();

        try node_queue.writeItem(.{
            .parent_id = .invalid,
            .dep_id = invalid_dependency_id,
            .pkg_id = 0,
        });

        var dep_ids_sort_buf: std.ArrayListUnmanaged(DependencyID) = .empty;
        defer dep_ids_sort_buf.deinit(lockfile.allocator);

        // Used by leaves and linked dependencies. They can be deduplicated early
        // because peers won't change them.
        //
        // In the pnpm repo without this map: 772,471 nodes
        //                 and with this map: 314,022 nodes
        var early_dedupe: std.AutoHashMapUnmanaged(PackageID, Store.Node.Id) = .empty;
        defer early_dedupe.deinit(lockfile.allocator);

        var peer_dep_ids: std.ArrayListUnmanaged(DependencyID) = .empty;
        defer peer_dep_ids.deinit(lockfile.allocator);

        var visited_parent_node_ids: std.ArrayListUnmanaged(Store.Node.Id) = .empty;
        defer visited_parent_node_ids.deinit(lockfile.allocator);

        // First pass: create full dependency tree with resolved peers
        next_node: while (node_queue.readItem()) |entry| {
            {
                // check for cycles
                const nodes_slice = nodes.slice();
                const node_pkg_ids = nodes_slice.items(.pkg_id);
                const node_parent_ids = nodes_slice.items(.parent_id);
                const node_nodes = nodes_slice.items(.nodes);

                var curr_id = entry.parent_id;
                while (curr_id != .invalid) {
                    if (node_pkg_ids[curr_id.get()] == entry.pkg_id) {
                        // skip the new node, and add the previously added node to parent so it appears in
                        // 'node_modules/.bun/parent@version/node_modules'
                        node_nodes[entry.parent_id.get()].appendAssumeCapacity(curr_id);
                        continue :next_node;
                    }
                    curr_id = node_parent_ids[curr_id.get()];
                }
            }

            const node_id: Store.Node.Id = .from(@intCast(nodes.len));
            const pkg_deps = pkg_dependency_slices[entry.pkg_id];

            var skip_dependencies_of_workspace_node = false;
            if (entry.dep_id != invalid_dependency_id) {
                const entry_dep = dependencies[entry.dep_id];
                if (pkg_deps.len == 0 or entry_dep.isWorkspaceDep()) dont_dedupe: {
                    const dedupe_entry = try early_dedupe.getOrPut(lockfile.allocator, entry.pkg_id);
                    if (dedupe_entry.found_existing) {
                        const dedupe_node_id = dedupe_entry.value_ptr.*;

                        const nodes_slice = nodes.slice();
                        const node_nodes = nodes_slice.items(.nodes);
                        const node_dep_ids = nodes_slice.items(.dep_id);

                        const dedupe_dep_id = node_dep_ids[dedupe_node_id.get()];
                        const dedupe_dep = dependencies[dedupe_dep_id];

                        if (dedupe_dep.name_hash != entry_dep.name_hash) {
                            break :dont_dedupe;
                        }

                        if (dedupe_dep.isWorkspaceDep() and entry_dep.isWorkspaceDep()) {
                            if (dedupe_dep.behavior.isWorkspaceOnly() != entry_dep.behavior.isWorkspaceOnly()) {
                                // only attach the dependencies to one of the workspaces
                                skip_dependencies_of_workspace_node = true;
                                break :dont_dedupe;
                            }
                        }

                        node_nodes[entry.parent_id.get()].appendAssumeCapacity(dedupe_node_id);
                        continue;
                    }

                    dedupe_entry.value_ptr.* = node_id;
                }
            }

            try nodes.append(lockfile.allocator, .{
                .pkg_id = entry.pkg_id,
                .dep_id = entry.dep_id,
                .parent_id = entry.parent_id,
                .nodes = if (skip_dependencies_of_workspace_node) .empty else try .initCapacity(lockfile.allocator, pkg_deps.len),
                .dependencies = if (skip_dependencies_of_workspace_node) .empty else try .initCapacity(lockfile.allocator, pkg_deps.len),
            });

            const nodes_slice = nodes.slice();
            const node_parent_ids = nodes_slice.items(.parent_id);
            const node_dependencies = nodes_slice.items(.dependencies);
            const node_peers = nodes_slice.items(.peers);
            const node_nodes = nodes_slice.items(.nodes);

            if (entry.parent_id.tryGet()) |parent_id| {
                node_nodes[parent_id].appendAssumeCapacity(node_id);
            }

            if (skip_dependencies_of_workspace_node) {
                continue;
            }

            dep_ids_sort_buf.clearRetainingCapacity();
            try dep_ids_sort_buf.ensureUnusedCapacity(lockfile.allocator, pkg_deps.len);
            for (pkg_deps.begin()..pkg_deps.end()) |_dep_id| {
                const dep_id: DependencyID = @intCast(_dep_id);
                dep_ids_sort_buf.appendAssumeCapacity(dep_id);
            }

            // TODO: make this sort in an order that allows peers to be resolved last
            // and devDependency handling to match `hoistDependency`
            std.sort.pdq(
                DependencyID,
                dep_ids_sort_buf.items,
                Lockfile.DepSorter{
                    .lockfile = lockfile,
                },
                Lockfile.DepSorter.isLessThan,
            );

            peer_dep_ids.clearRetainingCapacity();
            for (dep_ids_sort_buf.items) |dep_id| {
                if (Tree.isFilteredDependencyOrWorkspace(
                    dep_id,
                    entry.pkg_id,
                    workspace_filters,
                    install_root_dependencies,
                    manager,
                    lockfile,
                )) {
                    continue;
                }

                const pkg_id = resolutions[dep_id];
                const dep = dependencies[dep_id];

                // TODO: handle duplicate dependencies. should be similar logic
                // like we have for dev dependencies in `hoistDependency`

                if (!dep.behavior.isPeer()) {
                    // simple case:
                    // - add it as a dependency
                    // - queue it
                    node_dependencies[node_id.get()].appendAssumeCapacity(.{ .dep_id = dep_id, .pkg_id = pkg_id });
                    try node_queue.writeItem(.{
                        .parent_id = node_id,
                        .dep_id = dep_id,
                        .pkg_id = pkg_id,
                    });
                    continue;
                }

                try peer_dep_ids.append(lockfile.allocator, dep_id);
            }

            next_peer: for (peer_dep_ids.items) |peer_dep_id| {
                const resolved_pkg_id, const auto_installed = resolved_pkg_id: {

                    // Go through the peers parents looking for a package with the same name.
                    // If none is found, use current best version. Parents visited must have
                    // the package id for the chosen peer marked as a transitive peer. Nodes
                    // are deduplicated only if their package id and their transitive peer package
                    // ids are equal.
                    const peer_dep = dependencies[peer_dep_id];

                    // TODO: double check this
                    // Start with the current package. A package
                    // can satisfy it's own peers.
                    var curr_id = node_id;

                    visited_parent_node_ids.clearRetainingCapacity();
                    while (curr_id != .invalid) {
                        for (node_dependencies[curr_id.get()].items) |ids| {
                            const dep = dependencies[ids.dep_id];

                            if (dep.name_hash != peer_dep.name_hash) {
                                continue;
                            }

                            const res = pkg_resolutions[ids.pkg_id];

                            if (peer_dep.version.tag != .npm or res.tag != .npm) {
                                // TODO: print warning for this? we don't have a version
                                // to compare to say if this satisfies or not.
                                break :resolved_pkg_id .{ ids.pkg_id, false };
                            }

                            const peer_dep_version = peer_dep.version.value.npm.version;
                            const res_version = res.value.npm.version;

                            if (!peer_dep_version.satisfies(res_version, string_buf, string_buf)) {
                                // TODO: add warning!
                            }

                            break :resolved_pkg_id .{ ids.pkg_id, false };
                        }

                        const curr_peers = node_peers[curr_id.get()];
                        for (curr_peers.list.items) |ids| {
                            const transitive_peer_dep = dependencies[ids.dep_id];

                            if (transitive_peer_dep.name_hash != peer_dep.name_hash) {
                                continue;
                            }

                            // A transitive peer with the same name has already passed
                            // through this node

                            if (!ids.auto_installed) {
                                // The resolution was found here or above. Choose the same
                                // peer resolution. No need to mark this node or above.

                                // TODO: add warning if not satisfies()!
                                break :resolved_pkg_id .{ ids.pkg_id, false };
                            }

                            // It didn't find a matching name and auto installed
                            // from somewhere this peer can't reach. Choose best
                            // version. Only mark all parents if resolution is
                            // different from this transitive peer.

                            if (peer_dep.behavior.isOptionalPeer()) {
                                // exclude it
                                continue :next_peer;
                            }

                            const best_version = resolutions[peer_dep_id];

                            if (best_version == ids.pkg_id) {
                                break :resolved_pkg_id .{ ids.pkg_id, true };
                            }

                            // add the remaining parent ids
                            while (curr_id != .invalid) {
                                try visited_parent_node_ids.append(lockfile.allocator, curr_id);
                                curr_id = node_parent_ids[curr_id.get()];
                            }

                            break :resolved_pkg_id .{ best_version, true };
                        }

                        // TODO: prevent marking workspace and symlink deps with transitive peers

                        // add to visited parents after searching for a peer resolution.
                        // if a node resolves a transitive peer, it can still be deduplicated
                        try visited_parent_node_ids.append(lockfile.allocator, curr_id);
                        curr_id = node_parent_ids[curr_id.get()];
                    }

                    if (peer_dep.behavior.isOptionalPeer()) {
                        // exclude it
                        continue;
                    }

                    // choose the current best version
                    break :resolved_pkg_id .{ resolutions[peer_dep_id], true };
                };

                bun.debugAssert(resolved_pkg_id != invalid_package_id);

                for (visited_parent_node_ids.items) |visited_parent_id| {
                    const ctx: Store.Node.TransitivePeer.OrderedArraySetCtx = .{
                        .string_buf = string_buf,
                        .pkg_names = pkg_names,
                    };
                    const peer: Store.Node.TransitivePeer = .{
                        .dep_id = peer_dep_id,
                        .pkg_id = resolved_pkg_id,
                        .auto_installed = auto_installed,
                    };
                    try node_peers[visited_parent_id.get()].insert(lockfile.allocator, peer, &ctx);
                }

                if (visited_parent_node_ids.items.len != 0) {
                    // visited parents length == 0 means the node satisfied it's own
                    // peer. don't queue.
                    node_dependencies[node_id.get()].appendAssumeCapacity(.{ .dep_id = peer_dep_id, .pkg_id = resolved_pkg_id });
                    try node_queue.writeItem(.{
                        .parent_id = node_id,
                        .dep_id = peer_dep_id,
                        .pkg_id = resolved_pkg_id,
                    });
                }
            }
        }

        if (manager.options.log_level.isVerbose()) {
            const full_tree_end = timer.read();
            timer.reset();
            Output.prettyErrorln("Resolved peers [{}]", .{bun.fmt.fmtDurationOneDecimal(full_tree_end)});
        }

        const DedupeInfo = struct {
            entry_id: Store.Entry.Id,
            dep_id: DependencyID,
            peers: Store.OrderedArraySet(Store.Node.TransitivePeer, Store.Node.TransitivePeer.OrderedArraySetCtx),
        };

        var dedupe: std.AutoHashMapUnmanaged(PackageID, std.ArrayListUnmanaged(DedupeInfo)) = .empty;
        defer dedupe.deinit(lockfile.allocator);

        var res_fmt_buf: std.ArrayList(u8) = .init(lockfile.allocator);
        defer res_fmt_buf.deinit();

        const nodes_slice = nodes.slice();
        const node_pkg_ids = nodes_slice.items(.pkg_id);
        const node_dep_ids = nodes_slice.items(.dep_id);
        const node_peers: []const Store.Node.Peers = nodes_slice.items(.peers);
        const node_nodes = nodes_slice.items(.nodes);

        var store: Store.Entry.List = .empty;

        const QueuedEntry = struct {
            node_id: Store.Node.Id,
            entry_parent_id: Store.Entry.Id,
        };
        var entry_queue: std.fifo.LinearFifo(QueuedEntry, .Dynamic) = .init(lockfile.allocator);
        defer entry_queue.deinit();

        try entry_queue.writeItem(.{
            .node_id = .from(0),
            .entry_parent_id = .invalid,
        });

        // Second pass: Deduplicate nodes when the pkg_id and peer set match an existing entry.
        next_entry: while (entry_queue.readItem()) |entry| {
            const pkg_id = node_pkg_ids[entry.node_id.get()];

            const dedupe_entry = try dedupe.getOrPut(lockfile.allocator, pkg_id);
            if (!dedupe_entry.found_existing) {
                dedupe_entry.value_ptr.* = .{};
            } else {
                const curr_peers = node_peers[entry.node_id.get()];
                const curr_dep_id = node_dep_ids[entry.node_id.get()];

                for (dedupe_entry.value_ptr.items) |info| {
                    if (info.dep_id != invalid_dependency_id and curr_dep_id != invalid_dependency_id) {
                        const curr_dep = dependencies[curr_dep_id];
                        const existing_dep = dependencies[info.dep_id];

                        if (existing_dep.isWorkspaceDep() and curr_dep.isWorkspaceDep()) {
                            if (existing_dep.behavior.isWorkspaceOnly() != curr_dep.behavior.isWorkspaceOnly()) {
                                continue;
                            }
                        }
                    }

                    const eql_ctx: Store.Node.TransitivePeer.OrderedArraySetCtx = .{
                        .string_buf = string_buf,
                        .pkg_names = pkg_names,
                    };

                    if (info.peers.eql(&curr_peers, &eql_ctx)) {
                        // dedupe! depend on the already created entry

                        const entries = store.slice();
                        const entry_dependencies = entries.items(.dependencies);
                        const entry_parents = entries.items(.parents);

                        var parents = &entry_parents[info.entry_id.get()];

                        if (curr_dep_id != invalid_dependency_id and dependencies[curr_dep_id].behavior.isWorkspaceOnly()) {
                            try parents.append(lockfile.allocator, entry.entry_parent_id);
                            continue :next_entry;
                        }
                        const ctx: Store.Entry.DependenciesOrderedArraySetCtx = .{
                            .string_buf = string_buf,
                            .dependencies = dependencies,
                        };
                        try entry_dependencies[entry.entry_parent_id.get()].insert(
                            lockfile.allocator,
                            .{ .entry_id = info.entry_id, .dep_id = curr_dep_id },
                            &ctx,
                        );
                        try parents.append(lockfile.allocator, entry.entry_parent_id);
                        continue :next_entry;
                    }
                }

                // nothing matched - create a new entry
            }

            const new_entry_peer_hash: Store.Entry.PeerHash = peer_hash: {
                const peers = node_peers[entry.node_id.get()];
                if (peers.len() == 0) {
                    break :peer_hash .none;
                }
                var hasher = bun.Wyhash11.init(0);
                for (peers.slice()) |peer_ids| {
                    const pkg_name = pkg_names[peer_ids.pkg_id];
                    hasher.update(pkg_name.slice(string_buf));
                    const pkg_res = pkg_resolutions[peer_ids.pkg_id];
                    res_fmt_buf.clearRetainingCapacity();
                    try res_fmt_buf.writer().print("{}", .{pkg_res.fmt(string_buf, .posix)});
                    hasher.update(res_fmt_buf.items);
                }
                break :peer_hash .from(hasher.final());
            };

            const new_entry_dep_id = node_dep_ids[entry.node_id.get()];

            const new_entry_is_root = new_entry_dep_id == invalid_dependency_id;
            const new_entry_is_workspace = !new_entry_is_root and dependencies[new_entry_dep_id].isWorkspaceDep();

            const new_entry_dependencies: Store.Entry.Dependencies = if (dedupe_entry.found_existing and new_entry_is_workspace)
                .empty
            else
                try .initCapacity(lockfile.allocator, node_nodes[entry.node_id.get()].items.len);

            var new_entry_parents: std.ArrayListUnmanaged(Store.Entry.Id) = try .initCapacity(lockfile.allocator, 1);
            new_entry_parents.appendAssumeCapacity(entry.entry_parent_id);

            const new_entry: Store.Entry = .{
                .node_id = entry.node_id,
                .dependencies = new_entry_dependencies,
                .parents = new_entry_parents,
                .peer_hash = new_entry_peer_hash,
            };

            const new_entry_id: Store.Entry.Id = .from(@intCast(store.len));
            try store.append(lockfile.allocator, new_entry);

            if (entry.entry_parent_id.tryGet()) |entry_parent_id| skip_adding_dependency: {
                if (new_entry_dep_id != invalid_dependency_id and dependencies[new_entry_dep_id].behavior.isWorkspaceOnly()) {
                    // skip implicit workspace dependencies on the root.
                    break :skip_adding_dependency;
                }

                const entries = store.slice();
                const entry_dependencies = entries.items(.dependencies);
                const ctx: Store.Entry.DependenciesOrderedArraySetCtx = .{
                    .string_buf = string_buf,
                    .dependencies = dependencies,
                };
                try entry_dependencies[entry_parent_id].insert(
                    lockfile.allocator,
                    .{ .entry_id = new_entry_id, .dep_id = new_entry_dep_id },
                    &ctx,
                );
            }

            try dedupe_entry.value_ptr.append(lockfile.allocator, .{
                .entry_id = new_entry_id,
                .dep_id = new_entry_dep_id,
                .peers = node_peers[entry.node_id.get()],
            });

            for (node_nodes[entry.node_id.get()].items) |node_id| {
                try entry_queue.writeItem(.{
                    .node_id = node_id,
                    .entry_parent_id = new_entry_id,
                });
            }
        }

        if (manager.options.log_level.isVerbose()) {
            const dedupe_end = timer.read();
            Output.prettyErrorln("Created store [{}]", .{bun.fmt.fmtDurationOneDecimal(dedupe_end)});
        }

        break :store .{
            .entries = store,
            .nodes = nodes,
        };
    };

    const cwd = FD.cwd();

    const root_node_modules_dir, const is_new_root_node_modules, const bun_modules_dir, const is_new_bun_modules = root_dirs: {
        const node_modules_path = bun.OSPathLiteral("node_modules");
        const bun_modules_path = bun.OSPathLiteral("node_modules/" ++ Store.modules_dir_name);
        const existing_root_node_modules_dir = sys.openatOSPath(cwd, node_modules_path, bun.O.DIRECTORY | bun.O.RDONLY, 0o755).unwrap() catch {
            sys.mkdirat(cwd, node_modules_path, 0o755).unwrap() catch |err| {
                Output.err(err, "failed to create the './node_modules' directory", .{});
                Global.exit(1);
            };

            sys.mkdirat(cwd, bun_modules_path, 0o755).unwrap() catch |err| {
                Output.err(err, "failed to create the './node_modules/.bun' directory", .{});
                Global.exit(1);
            };

            const new_root_node_modules_dir = sys.openatOSPath(cwd, node_modules_path, bun.O.DIRECTORY | bun.O.RDONLY, 0o755).unwrap() catch |err| {
                Output.err(err, "failed to open the './node_modules' directory", .{});
                Global.exit(1);
            };

            const new_bun_modules_dir = sys.openatOSPath(cwd, bun_modules_path, bun.O.DIRECTORY | bun.O.RDONLY, 0o755).unwrap() catch |err| {
                Output.err(err, "failed to open the './node_modules/.bun' directory", .{});
                Global.exit(1);
            };

            break :root_dirs .{
                new_root_node_modules_dir,
                true,
                new_bun_modules_dir,
                true,
            };
        };

        const existing_bun_modules_dir = sys.openatOSPath(cwd, bun_modules_path, bun.O.DIRECTORY | bun.O.RDONLY, 0o755).unwrap() catch {
            sys.mkdirat(cwd, bun_modules_path, 0o755).unwrap() catch |err| {
                Output.err(err, "failed to create the './node_modules/.bun' directory", .{});
                Global.exit(1);
            };

            const new_bun_modules_dir = sys.openatOSPath(cwd, bun_modules_path, bun.O.DIRECTORY | bun.O.RDONLY, 0o755).unwrap() catch |err| {
                Output.err(err, "failed to open the './node_modules/.bun' directory", .{});
                Global.exit(1);
            };

            break :root_dirs .{
                existing_root_node_modules_dir,
                false,
                new_bun_modules_dir,
                true,
            };
        };

        break :root_dirs .{
            existing_root_node_modules_dir,
            false,
            existing_bun_modules_dir,
            false,
        };
    };
    _ = root_node_modules_dir;
    _ = is_new_root_node_modules;
    _ = bun_modules_dir;
    // _ = is_new_bun_modules;

    {
        var root_node: *Progress.Node = undefined;
        // var download_node: Progress.Node = undefined;
        var install_node: Progress.Node = undefined;
        var scripts_node: Progress.Node = undefined;
        var progress = &manager.progress;

        if (manager.options.log_level.showProgress()) {
            progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
            root_node = progress.start("", 0);
            // download_node = root_node.start(ProgressStrings.download(), 0);
            install_node = root_node.start(ProgressStrings.install(), store.entries.len);
            scripts_node = root_node.start(ProgressStrings.script(), 0);

            manager.downloads_node = null;
            manager.scripts_node = &scripts_node;
        }

        const nodes_slice = store.nodes.slice();
        const node_pkg_ids = nodes_slice.items(.pkg_id);
        const node_dep_ids = nodes_slice.items(.dep_id);

        const entries = store.entries.slice();
        const entry_node_ids = entries.items(.node_id);
        const entry_steps = entries.items(.step);
        const entry_dependencies = entries.items(.dependencies);

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

        var installer: Store.Installer = .{
            .lockfile = lockfile,
            .manager = manager,
            .command_ctx = command_ctx,
            .installed = try .initEmpty(manager.allocator, lockfile.packages.len),
            .install_node = if (manager.options.log_level.showProgress()) &install_node else null,
            .scripts_node = if (manager.options.log_level.showProgress()) &scripts_node else null,
            .store = &store,
            .preallocated_tasks = .init(bun.default_allocator),
            .trusted_dependencies_mutex = .{},
            .trusted_dependencies_from_update_requests = manager.findTrustedDependenciesFromUpdateRequests(),
        };

        // add the pending task count upfront
        _ = manager.incrementPendingTasks(@intCast(store.entries.len));

        for (0..store.entries.len) |_entry_id| {
            const entry_id: Store.Entry.Id = .from(@intCast(_entry_id));

            const node_id = entry_node_ids[entry_id.get()];
            const pkg_id = node_pkg_ids[node_id.get()];

            const pkg_name = pkg_names[pkg_id];
            const pkg_name_hash = pkg_name_hashes[pkg_id];
            const pkg_res: Resolution = pkg_resolutions[pkg_id];

            switch (pkg_res.tag) {
                else => {
                    // this is `uninitialized` or `single_file_module`.
                    bun.debugAssert(false);
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.onTaskComplete(entry_id, .skipped);
                    continue;
                },
                .root => {
                    if (entry_id == .root) {
                        entry_steps[entry_id.get()].store(.symlink_dependencies, .monotonic);
                        installer.startTask(entry_id);
                        continue;
                    }
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.onTaskComplete(entry_id, .skipped);
                    continue;
                },
                .workspace => {
                    // if injected=true this might be false
                    if (!(try seen_workspace_ids.getOrPut(lockfile.allocator, pkg_id)).found_existing) {
                        entry_steps[entry_id.get()].store(.symlink_dependencies, .monotonic);
                        installer.startTask(entry_id);
                        continue;
                    }
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.onTaskComplete(entry_id, .success);
                    continue;
                },
                .symlink => {
                    // no installation required, will only need to be linked to packages that depend on it.
                    bun.debugAssert(entry_dependencies[entry_id.get()].list.items.len == 0);
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
                            const exists = sys.existsZ(store_path.sliceZ());

                            break :needs_install switch (patch_info) {
                                .none => !exists,
                                // checked above
                                .remove => unreachable,
                                .patch => |patch| {
                                    var hash_buf: install.BuntagHashBuf = undefined;
                                    const hash = install.buntaghashbuf_make(&hash_buf, patch.contents_hash);
                                    var patch_tag_path: bun.AbsPath(.{}) = .initTopLevelDir();
                                    defer patch_tag_path.deinit();
                                    installer.appendStorePath(&patch_tag_path, entry_id);
                                    patch_tag_path.append(hash);
                                    break :needs_install !sys.existsZ(patch_tag_path.sliceZ());
                                },
                            };
                        };

                    if (!needs_install) {
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
                        installer.startTask(entry_id);
                        continue;
                    }

                    const ctx: install.TaskCallbackContext = .{
                        .isolated_package_install_context = entry_id,
                    };

                    const dep_id = node_dep_ids[node_id.get()];
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
                                    Output.err(err, "failed to enqueue package for download: {s}@{}", .{
                                        pkg_name.slice(string_buf),
                                        pkg_res.fmt(string_buf, .auto),
                                    });
                                    Output.flush();
                                    if (manager.options.enable.fail_early) {
                                        Global.exit(1);
                                    }
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
                                    Output.err(err, "failed to enqueue github package for download: {s}@{}", .{
                                        pkg_name.slice(string_buf),
                                        pkg_res.fmt(string_buf, .auto),
                                    });
                                    Output.flush();
                                    if (manager.options.enable.fail_early) {
                                        Global.exit(1);
                                    }
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
                                    Output.err(err, "failed to enqueue tarball for download: {s}@{}", .{
                                        pkg_name.slice(string_buf),
                                        pkg_res.fmt(string_buf, .auto),
                                    });
                                    Output.flush();
                                    if (manager.options.enable.fail_early) {
                                        Global.exit(1);
                                    }
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

        if (manager.pendingTaskCount() > 0) {
            const Wait = struct {
                installer: *Store.Installer,
                manager: *PackageManager,
                err: ?anyerror = null,

                pub fn isDone(wait: *@This()) bool {
                    wait.manager.runTasks(
                        *Store.Installer,
                        wait.installer,
                        .{
                            .onExtract = Store.Installer.onPackageExtracted,
                            .onResolve = {},
                            .onPackageManifestError = {},
                            .onPackageDownloadError = {},
                        },
                        true,
                        wait.manager.options.log_level,
                    ) catch |err| {
                        wait.err = err;
                        return true;
                    };

                    return wait.manager.pendingTaskCount() == 0;
                }
            };

            var wait: Wait = .{
                .manager = manager,
                .installer = &installer,
            };

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
                const step = entry_step.load(.monotonic);

                if (step == .done) {
                    continue;
                }

                done = false;

                log("entry not done: {d}, {s}\n", .{ entry_id, @tagName(step) });

                const deps = store.entries.items(.dependencies)[entry_id.get()];
                for (deps.slice()) |dep| {
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

// @sortImports

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const Global = bun.Global;
const OOM = bun.OOM;
const Output = bun.Output;
const Progress = bun.Progress;
const sys = bun.sys;
const Command = bun.CLI.Command;

const install = bun.install;
const DependencyID = install.DependencyID;
const PackageID = install.PackageID;
const PackageInstall = install.PackageInstall;
const Resolution = install.Resolution;
const Store = install.Store;
const invalid_dependency_id = install.invalid_dependency_id;
const invalid_package_id = install.invalid_package_id;

const Lockfile = install.Lockfile;
const Tree = Lockfile.Tree;

const PackageManager = install.PackageManager;
const ProgressStrings = PackageManager.ProgressStrings;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
