const modules_dir_name = ".bun";

pub fn installIsolatedPackages(
    manager: *PackageManager,
    command_ctx: Command.Context,
    install_root_dependencies: bool,
    workspace_filters: []const WorkspaceFilter,
) OOM!PackageInstall.Summary {
    // var total_time = std.time.Timer.start() catch unreachable;
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

            const new_node_nodes: std.ArrayListUnmanaged(Store.Node.Id), const new_node_dependencies: std.ArrayListUnmanaged(Ids) = if (skip_dependencies_of_workspace_node)
                .{ .empty, .empty }
            else
                .{
                    try .initCapacity(lockfile.allocator, pkg_deps.len),
                    try .initCapacity(lockfile.allocator, pkg_deps.len),
                };

            try nodes.append(lockfile.allocator, .{
                .pkg_id = entry.pkg_id,
                .dep_id = entry.dep_id,
                .parent_id = entry.parent_id,
                .nodes = new_node_nodes,
                .dependencies = new_node_dependencies,
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
                    // std.debug.print("filtered: {s}@{s}\n", .{
                    //     dependencies[dep_id].name.slice(string_buf),
                    //     dependencies[dep_id].version.literal.slice(string_buf),
                    // });
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

        // Store.Node.debugPrintList(&nodes, lockfile);

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
                            if (comptime Environment.isDebug) {
                                bun.debugAssert(!bun.contains(entry.entry_parent_id, parents));
                            }
                            try parents.append(lockfile.allocator, entry.entry_parent_id);
                            continue :next_entry;
                        }
                        const ctx: Store.Entry.DependenciesOrderedArraySetCtx = .{
                            .string_buf = string_buf,
                            .dependencies = dependencies,
                        };
                        entry_dependencies[entry.entry_parent_id.get()].insertAssumeCapacity(
                            .{ .entry_id = info.entry_id, .dep_id = curr_dep_id },
                            &ctx,
                        );
                        if (comptime Environment.isDebug) {
                            bun.debugAssert(!bun.contains(entry.entry_parent_id, parents));
                        }
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
                entry_dependencies[entry_parent_id].insertAssumeCapacity(
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

        // Store.Entry.debugPrintList(&store, lockfile);

        // std.debug.print(
        //     \\Build tree ({d}): [{}]
        //     \\Deduplicate tree ({d}): [{}]
        //     \\Total: [{}]
        //     \\
        //     \\
        // , .{
        //     nodes.len,
        //     bun.fmt.fmtDurationOneDecimal(full_tree_end),
        //     store.len,
        //     bun.fmt.fmtDurationOneDecimal(dedupe_end),
        //     bun.fmt.fmtDurationOneDecimal(full_tree_end + dedupe_end),
        // });

        // Store.Node.deinitList(&nodes, lockfile.allocator);

        break :store .{
            .entries = store,
            .nodes = nodes,
        };
    };

    const cwd = FD.cwd();

    const root_node_modules_dir, const is_new_root_node_modules, const bun_modules_dir, const is_new_bun_modules = root_dirs: {
        const node_modules_path = bun.OSPathLiteral("node_modules");
        const bun_modules_path = bun.OSPathLiteral("node_modules/" ++ modules_dir_name);
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

    // var link_timer = std.time.Timer.start() catch unreachable;
    // const total_links: usize = 0;

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

            manager.downloads_node = &download_node;
            manager.scripts_node = &scripts_node;
        }

        defer {
            if (manager.options.log_level.showProgress()) {
                progress.root.end();
                progress.* = .{};
            }
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

        // var install_stack: std.ArrayListUnmanaged(Store.Entry.Id) = try .initCapacity(lockfile.allocator, store.entries.len);
        // defer install_stack.deinit(lockfile.allocator);

        // var curr_entry_id: Store.Entry.Id = .from(0);
        // while (curr_entry_id != .invalid) {
        //     install_stack.appendAssumeCapacity(curr_entry_id);
        //     const deps = entry_dependencies[curr_entry_id.get()];
        //     for (deps.slice()) |entry_id
        // }

        // var install_queue: std.fifo.LinearFifo(Store.Entry.Id, .Dynamic) = .init(lockfile.allocator);
        // defer install_queue.deinit();
        // try install_queue.ensureTotalCapacity(store.entries.len);

        // // find and queue entries without dependencies. we want to start downloading
        // // their tarballs first because their lifecycle scripts can start running
        // // immediately
        // for (0..store.entries.len) |_entry_id| {
        //     const entry_id: Store.Entry.Id = .from(@intCast(_entry_id));

        //     const dependencies = entry_dependencies[entry_id.get()];

        //     if (dependencies.list.items.len != 0) {
        //         continue;
        //     }

        //     seen_entry_ids.putAssumeCapacityNoClobber(entry_id, {});
        //     install_queue.writeItemAssumeCapacity(entry_id);
        // }

        // add the pending task count upfront
        _ = manager.incrementPendingTasks(@intCast(store.entries.len));

        // while (install_queue.readItem()) |entry_id| {
        for (0..store.entries.len) |_entry_id| {
            const entry_id: Store.Entry.Id = .from(@intCast(_entry_id));
            // const parent_entry_id = entry_parent_ids[entry_id.get()];
            // if (parent_entry_id != .invalid) {
            //     const entry = try seen_entry_ids.getOrPut(lockfile.allocator, parent_entry_id);
            //     if (!entry.found_existing) {
            //         install_queue.writeItemAssumeCapacity(parent_entry_id);
            //     }
            // }

            const node_id = entry_node_ids[entry_id.get()];
            const pkg_id = node_pkg_ids[node_id.get()];

            const pkg_name = pkg_names[pkg_id];
            const pkg_name_hash = pkg_name_hashes[pkg_id];
            const pkg_res: Resolution = pkg_resolutions[pkg_id];

            switch (pkg_res.tag) {
                else => {
                    // this is `uninitialized` or `single_file_module`.
                    bun.debugAssert(false);
                    manager.decrementPendingTasks();
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.resumeAvailableTasks();
                    continue;
                },
                .root => {
                    installer.summary.skipped += 1;

                    if (entry_id == .root) {
                        entry_steps[entry_id.get()].store(.symlink_dependencies, .monotonic);
                        installer.resumeTask(entry_id);
                        continue;
                    }
                    manager.decrementPendingTasks();
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.resumeAvailableTasks();
                    continue;
                },
                .workspace => {
                    // if injected=true this might be false
                    installer.summary.skipped += 1;

                    if (!(try seen_workspace_ids.getOrPut(lockfile.allocator, pkg_id)).found_existing) {
                        entry_steps[entry_id.get()].store(.symlink_dependencies, .monotonic);
                        installer.resumeTask(entry_id);
                        continue;
                    }
                    manager.decrementPendingTasks();
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.resumeAvailableTasks();
                    continue;
                },
                .symlink => {
                    // no installation required, will only need to be linked to packages that depend on it.
                    bun.debugAssert(entry_dependencies[entry_id.get()].list.items.len == 0);
                    installer.summary.skipped += 1;
                    manager.decrementPendingTasks();
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.resumeAvailableTasks();
                    continue;
                },
                .folder => {
                    // folders are always hardlinked to keep them up-to-date
                    installer.resumeTask(entry_id);
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
                        installer.summary.skipped += 1;
                        manager.decrementPendingTasks();
                        entry_steps[entry_id.get()].store(.done, .monotonic);
                        if (installer.install_node) |node| {
                            node.completeOne();
                        }
                        installer.resumeAvailableTasks();
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
                        installer.resumeTask(entry_id);
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
                                    installer.summary.fail += 1;
                                    manager.decrementPendingTasks();
                                    entry_steps[entry_id.get()].store(.done, .monotonic);
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
                                    installer.summary.fail += 1;
                                    manager.decrementPendingTasks();
                                    entry_steps[entry_id.get()].store(.done, .monotonic);
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
                                    installer.summary.fail += 1;
                                    manager.decrementPendingTasks();
                                    entry_steps[entry_id.get()].store(.done, .monotonic);
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

                    wait.installer.resumeAvailableTasks();

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

        if (comptime Environment.isDebug) {
            var done = true;
            next_entry: for (store.entries.items(.step), 0..) |entry_step, _entry_id| {
                const entry_id: Store.Entry.Id = .from(@intCast(_entry_id));
                const step = entry_step.load(.monotonic);

                if (step == .done) {
                    continue;
                }

                done = false;

                std.debug.print("entry not done: {d}", .{entry_id});

                const deps = store.entries.items(.dependencies)[entry_id.get()];
                for (deps.slice()) |dep| {
                    const dep_step = entry_steps[dep.entry_id.get()].load(.monotonic);
                    if (dep_step != .done) {
                        std.debug.print(", parents:\n - ", .{});
                        const parent_ids = Store.Entry.debugGatherAllParents(entry_id, installer.store);
                        for (parent_ids) |parent_id| {
                            if (parent_id == .root) {
                                std.debug.print("root ", .{});
                            } else {
                                std.debug.print("{d} ", .{parent_id.get()});
                            }
                        }

                        std.debug.print("\n", .{});
                        continue :next_entry;
                    }
                }

                std.debug.print(" and is able to run\n", .{});
            }

            bun.debugAssert(done);
        }

        installer.summary.successfully_installed = installer.installed;

        return installer.summary;
    }
}

const Ids = struct {
    dep_id: DependencyID,
    pkg_id: PackageID,
};

pub const Store = struct {
    entries: Entry.List,
    nodes: Node.List,

    fn NewId(comptime T: type) type {
        return enum(u32) {
            comptime {
                _ = T;
            }

            root = 0,
            invalid = max,
            _,

            const max = std.math.maxInt(u32);

            pub fn from(id: u32) @This() {
                bun.debugAssert(id != max);
                return @enumFromInt(id);
            }

            pub fn get(id: @This()) u32 {
                bun.debugAssert(id != .invalid);
                return @intFromEnum(id);
            }

            pub fn tryGet(id: @This()) ?u32 {
                return if (id == .invalid) null else @intFromEnum(id);
            }

            pub fn getOr(id: @This(), default: u32) u32 {
                return if (id == .invalid) default else @intFromEnum(id);
            }
        };
    }

    comptime {
        bun.assert(NewId(Entry) != NewId(Node));
        bun.assert(NewId(Entry) == NewId(Entry));
    }

    pub fn isCycle(this: *const Store, id: Entry.Id, maybe_parent_id: Entry.Id, parent_dedupe: *std.AutoArrayHashMap(Entry.Id, void)) bool {
        var i: usize = 0;
        var len: usize = 0;

        const entry_parents = this.entries.items(.parents);

        for (entry_parents[id.get()].items) |parent_id| {
            if (parent_id == .invalid) {
                continue;
            }
            if (parent_id == maybe_parent_id) {
                return true;
            }
            parent_dedupe.put(parent_id, {}) catch bun.outOfMemory();
        }

        len = parent_dedupe.count();
        while (i < len) {
            for (entry_parents[parent_dedupe.keys()[i].get()].items) |parent_id| {
                if (parent_id == .invalid) {
                    continue;
                }
                if (parent_id == maybe_parent_id) {
                    return true;
                }
                parent_dedupe.put(parent_id, {}) catch bun.outOfMemory();
                len = parent_dedupe.count();
            }
            i += 1;
        }

        return false;
    }

    pub const Installer = struct {
        trusted_dependencies_mutex: bun.Mutex,
        // this is not const for `lockfile.trusted_dependencies`
        lockfile: *Lockfile,

        summary: PackageInstall.Summary = .{ .successfully_installed = .empty },
        installed: Bitset,
        install_node: ?*Progress.Node,
        scripts_node: ?*Progress.Node,

        manager: *PackageManager,
        command_ctx: Command.Context,

        store: *const Store,

        tasks: bun.UnboundedQueue(Task, .next) = .{},
        preallocated_tasks: Task.Preallocated,

        trusted_dependencies_from_update_requests: std.AutoArrayHashMapUnmanaged(TruncatedPackageNameHash, void),

        pub fn deinit(this: *const Installer) void {
            this.trusted_dependencies_from_update_requests.deinit(this.lockfile.allocator);
        }

        pub fn resumeTask(this: *Installer, entry_id: Entry.Id) void {
            const task = this.preallocated_tasks.get();

            task.* = .{
                .entry_id = entry_id,
                .installer = this,
                .err = null,
            };

            this.manager.thread_pool.schedule(.from(&task.task));
        }

        pub fn onPackageExtracted(this: *Installer, task_id: install.Task.Id) void {
            if (this.manager.task_queue.fetchRemove(task_id)) |removed| {
                for (removed.value.items) |install_ctx| {
                    const entry_id = install_ctx.isolated_package_install_context;
                    this.resumeTask(entry_id);
                }
            }
        }

        pub fn onTaskFail(this: *Installer, entry_id: Entry.Id, err: Task.Error) void {
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
                        Entry.fmtStorePath(entry_id, this.store, this.lockfile),
                    });

                    _ = sys.unlink(store_path.sliceZ());
                },
            }

            if (this.manager.options.enable.fail_early) {
                Global.exit(1);
            }

            this.manager.decrementPendingTasks();

            this.summary.fail += 1;
            this.store.entries.items(.step)[entry_id.get()].store(.done, .monotonic);
            this.resumeAvailableTasks();
        }

        pub fn onTask(this: *Installer, task_entry_id: Entry.Id) void {
            const entries = this.store.entries.slice();
            const entry_steps = entries.items(.step);
            const step = entry_steps[task_entry_id.get()].load(.monotonic);

            if (step != .done) {
                // only done will unblock other packages
                return;
            }

            this.onTaskSuccess(task_entry_id);
        }

        pub fn onTaskSuccess(this: *Installer, entry_id: Entry.Id) void {
            this.manager.decrementPendingTasks();

            const pkg_id = pkg_id: {
                if (entry_id == .root) {
                    return;
                }

                const node_id = this.store.entries.items(.node_id)[entry_id.get()];
                const nodes = this.store.nodes.slice();

                const dep_id = nodes.items(.dep_id)[node_id.get()];

                if (dep_id == invalid_dependency_id) {
                    // should be coverd by `entry_id == .root` above, but
                    // just in case
                    return;
                }

                const dep = this.lockfile.buffers.dependencies.items[dep_id];

                if (dep.behavior.isWorkspaceOnly()) {
                    return;
                }

                break :pkg_id nodes.items(.pkg_id)[node_id.get()];
            };

            const is_duplicate = this.installed.isSet(pkg_id);
            this.summary.success += @intFromBool(!is_duplicate);
            this.installed.set(pkg_id);
            if (this.install_node) |node| {
                node.completeOne();
            }
        }

        pub fn resumeAvailableTasks(this: *Installer) void {
            const entries = this.store.entries.slice();
            const entry_deps = entries.items(.dependencies);
            const entry_steps = entries.items(.step);

            var parent_dedupe: std.AutoArrayHashMap(Entry.Id, void) = .init(bun.default_allocator);
            defer parent_dedupe.deinit();

            next_entry: for (0..this.store.entries.len) |_entry_id| {
                const entry_id: Entry.Id = .from(@intCast(_entry_id));

                const entry_step = entry_steps[entry_id.get()].load(.monotonic);
                if (entry_step != .blocked) {
                    continue;
                }

                const deps = entry_deps[entry_id.get()];
                for (deps.slice()) |dep| {
                    switch (entry_steps[dep.entry_id.get()].load(.monotonic)) {
                        .done => {},
                        else => {
                            parent_dedupe.clearRetainingCapacity();
                            if (!this.store.isCycle(entry_id, dep.entry_id, &parent_dedupe)) {
                                continue :next_entry;
                            }
                        },
                    }
                }

                entry_steps[entry_id.get()].store(.symlink_dependency_binaries, .monotonic);
                this.resumeTask(entry_id);
            }
        }

        const Task = struct {
            const Preallocated = bun.HiveArray(Task, 128).Fallback;

            entry_id: Entry.Id,
            installer: *Installer,

            task: ThreadPool.Task = .{ .callback = &callback },
            next: ?*Task = null,

            err: ?Error,

            const Error = union(Step) {
                link_package: sys.Error,
                symlink_dependencies: sys.Error,
                check_if_blocked,
                symlink_dependency_binaries,
                run_preinstall: anyerror,
                binaries: anyerror,
                @"run (post)install and (pre/post)prepare": anyerror,
                done,
                blocked,
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
                blocked,
            };

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

                this.installer.store.entries.items(.step)[this.entry_id.get()].store(next_step, .monotonic);

                return next_step;
            }

            fn fail(this: *Task, err: Error) Yield {
                this.err = err;
                this.installer.tasks.push(this);
                this.installer.manager.wake();
                return .yield;
            }

            fn yield(this: *Task) Yield {
                this.installer.tasks.push(this);
                this.installer.manager.wake();
                return .yield;
            }

            const Yield = enum { yield };

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

                return next_step: switch (entry_steps[this.entry_id.get()].load(.monotonic)) {
                    inline .link_package => |current_step| {
                        const string_buf = lockfile.buffers.string_bytes.items;

                        if (pkg_res.tag == .folder) {
                            // the folder does not exist in the cache
                            const folder_dir = switch (bun.openDirForIteration(FD.cwd(), pkg_res.value.folder.slice(string_buf))) {
                                .result => |fd| fd,
                                .err => |err| return this.fail(.{ .link_package = err.clone(bun.default_allocator) }),
                            };
                            defer folder_dir.close();

                            var src: bun.AbsPath(.{ .unit = .os, .sep = .auto }) = .initTopLevelDir();
                            defer src.deinit();
                            src.append(pkg_res.value.folder.slice(string_buf));

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
                                .err => |err| return this.fail(.{ .link_package = err.clone(bun.default_allocator) }),
                            }

                            continue :next_step this.nextStep(current_step);
                        }

                        const patch_info = try installer.packagePatchInfo(
                            pkg_name,
                            pkg_name_hash,
                            &pkg_res,
                        );

                        var pkg_cache_dir_subpath: bun.RelPath(.{ .sep = .auto }) = .from(switch (pkg_res.tag) {
                            .npm => manager.cachedNPMPackageFolderName(pkg_name.slice(string_buf), pkg_res.value.npm.version, patch_info.contentsHash()),
                            .git => manager.cachedGitFolderName(&pkg_res.value.git, patch_info.contentsHash()),
                            .github => manager.cachedGitHubFolderName(&pkg_res.value.github, patch_info.contentsHash()),
                            .local_tarball => manager.cachedTarballFolderName(pkg_res.value.local_tarball, patch_info.contentsHash()),
                            .remote_tarball => manager.cachedTarballFolderName(pkg_res.value.remote_tarball, patch_info.contentsHash()),

                            else => unreachable,
                        });
                        defer pkg_cache_dir_subpath.deinit();

                        const cache_dir, const cache_dir_path = manager.getCacheDirectoryAndAbsPath();
                        defer cache_dir_path.deinit();

                        var dest_subpath: bun.RelPath(.{ .sep = .auto, .unit = .os }) = .init();
                        defer dest_subpath.deinit();

                        installer.appendStorePath(&dest_subpath, this.entry_id);

                        // link the package
                        if (comptime Environment.isMac) {
                            if (install.PackageInstall.supported_method == .clonefile) hardlink_fallback: {
                                switch (sys.clonefileat(cache_dir, pkg_cache_dir_subpath.sliceZ(), FD.cwd(), dest_subpath.sliceZ())) {
                                    .result => {
                                        // success! move to next step
                                        continue :next_step this.nextStep(current_step);
                                    },
                                    .err => |clonefile_err1| {
                                        switch (clonefile_err1.getErrno()) {
                                            .XDEV => break :hardlink_fallback,
                                            .OPNOTSUPP => break :hardlink_fallback,
                                            .NOENT => {
                                                const parent_dest_dir = std.fs.path.dirname(dest_subpath.slice()) orelse {
                                                    return this.fail(.{ .link_package = clonefile_err1 });
                                                };

                                                FD.cwd().makePath(u8, parent_dest_dir) catch {};

                                                switch (sys.clonefileat(cache_dir, pkg_cache_dir_subpath.sliceZ(), FD.cwd(), dest_subpath.sliceZ())) {
                                                    .result => {
                                                        continue :next_step this.nextStep(current_step);
                                                    },
                                                    .err => |clonefile_err2| {
                                                        return this.fail(.{ .link_package = clonefile_err2 });
                                                    },
                                                }
                                            },
                                            else => {
                                                break :hardlink_fallback;
                                            },
                                        }
                                    },
                                }
                            }
                        }

                        const cached_package_dir = cached_package_dir: {
                            if (comptime Environment.isWindows) {
                                break :cached_package_dir switch (sys.openDirAtWindowsA(
                                    cache_dir,
                                    pkg_cache_dir_subpath.slice(),
                                    .{ .iterable = true, .can_rename_or_delete = false, .read_only = true },
                                )) {
                                    .result => |dir_fd| dir_fd,
                                    .err => |err| {
                                        return this.fail(.{ .link_package = err });
                                    },
                                };
                            }
                            break :cached_package_dir switch (sys.openat(
                                cache_dir,
                                pkg_cache_dir_subpath.sliceZ(),
                                bun.O.DIRECTORY | bun.O.CLOEXEC | bun.O.RDONLY,
                                0,
                            )) {
                                .result => |fd| fd,
                                .err => |err| {
                                    return this.fail(.{ .link_package = err });
                                },
                            };
                        };
                        defer cached_package_dir.close();

                        var src: bun.AbsPath(.{ .sep = .auto, .unit = .os }) = .from(cache_dir_path.slice());
                        defer src.deinit();
                        src.append(pkg_cache_dir_subpath.slice());

                        var hardlinker: Hardlinker = .{
                            .src_dir = cached_package_dir,
                            .src = src,
                            .dest = dest_subpath,
                        };

                        switch (try hardlinker.link(&.{})) {
                            .result => {},
                            .err => |err| return this.fail(.{ .link_package = err.clone(bun.default_allocator) }),
                        }

                        continue :next_step this.nextStep(current_step);
                    },
                    inline .symlink_dependencies => |current_step| {
                        const string_buf = lockfile.buffers.string_bytes.items;
                        const dependencies = lockfile.buffers.dependencies.items;

                        for (entry_dependencies[this.entry_id.get()].slice()) |dep| {
                            const dep_node_id = entry_node_ids[dep.entry_id.get()];
                            const dep_dep_id = node_dep_ids[dep_node_id.get()];
                            const dep_name = dependencies[dep_dep_id].name;

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
                                    return this.fail(.{ .symlink_dependencies = err });
                                },
                            }
                        }
                        continue :next_step this.nextStep(current_step);
                    },
                    inline .check_if_blocked => |current_step| {
                        // preinstall scripts need to run before binaries can be linked. Block here if any dependencies
                        // of this entry are not finished. Do not count cycles towards blocking.

                        var parent_dedupe: std.AutoArrayHashMap(Entry.Id, void) = .init(bun.default_allocator);
                        defer parent_dedupe.deinit();

                        const deps = entry_dependencies[this.entry_id.get()];
                        for (deps.slice()) |dep| {
                            if (entry_steps[dep.entry_id.get()].load(.monotonic) != .done) {
                                if (installer.store.isCycle(this.entry_id, dep.entry_id, &parent_dedupe)) {
                                    parent_dedupe.clearRetainingCapacity();
                                    continue;
                                }

                                entry_steps[this.entry_id.get()].store(.blocked, .monotonic);
                                return this.yield();
                            }
                        }

                        continue :next_step this.nextStep(current_step);
                    },
                    inline .symlink_dependency_binaries => |current_step| {
                        installer.linkDependencyBins(this.entry_id) catch |err| {
                            return this.fail(.{ .binaries = err });
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
                                    Entry.fmtStorePath(this.entry_id, installer.store, installer.lockfile),
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
                                return this.fail(.{ .run_preinstall = err });
                            };

                            if (scripts_list) |list| {
                                entry_scripts[this.entry_id.get()] = bun.create(bun.default_allocator, Package.Scripts.List, list);

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

                                installer.manager.spawnPackageLifecycleScripts(
                                    installer.command_ctx,
                                    list,
                                    dep.behavior.optional,
                                    false,
                                    .{
                                        .entry_id = this.entry_id,
                                        .installer = installer,
                                    },
                                ) catch |err| {
                                    return this.fail(.{ .run_preinstall = err });
                                };

                                return this.yield();
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

                        var abs_target_buf: bun.PathBuffer = undefined;
                        var abs_dest_buf: bun.PathBuffer = undefined;
                        var rel_buf: bun.PathBuffer = undefined;

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
                            .abs_target_buf = &abs_target_buf,
                            .abs_dest_buf = &abs_dest_buf,
                            .rel_buf = &rel_buf,
                        };

                        bin_linker.link(false);

                        if (bin_linker.err) |err| {
                            return this.fail(.{ .binaries = err });
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

                        const dep = installer.lockfile.buffers.dependencies.items[dep_id];

                        installer.manager.spawnPackageLifecycleScripts(
                            installer.command_ctx,
                            list.*,
                            dep.behavior.optional,
                            false,
                            .{
                                .entry_id = this.entry_id,
                                .installer = installer,
                            },
                        ) catch |err| {
                            return this.fail(.{ .@"run (post)install and (pre/post)prepare" = err });
                        };

                        // when these scripts finish the package install will be
                        // complete. the task does not have anymore work to complete
                        // so it does not return to the thread pool.

                        return this.yield();
                    },

                    .done => {
                        return this.yield();
                    },

                    .blocked => {
                        bun.debugAssert(false);
                        return this.yield();
                    },
                };
            }

            pub fn callback(task: *ThreadPool.Task) void {
                const this: *Task = @fieldParentPtr("task", task);

                const res = this.run() catch |err| switch (err) {
                    error.OutOfMemory => bun.outOfMemory(),
                };

                switch (res) {
                    .yield => {},
                }
            }
        };

        const Hardlinker = struct {
            src_dir: FD,
            src: bun.AbsPath(.{ .sep = .auto, .unit = .os }),
            dest: bun.RelPath(.{ .sep = .auto, .unit = .os }),

            pub fn link(this: *Hardlinker, skip_dirnames: []const bun.OSPathSlice) OOM!sys.Maybe(void) {
                var walker: Walker = try .walk(
                    this.src_dir,
                    bun.default_allocator,
                    &.{},
                    skip_dirnames,
                );
                defer walker.deinit();

                if (comptime Environment.isWindows) {
                    while (switch (walker.next()) {
                        .result => |res| res,
                        .err => |err| return .initErr(err),
                    }) |entry| {
                        var src_save = this.src.save();
                        defer src_save.restore();

                        this.src.append(entry.path);

                        var dest_save = this.dest.save();
                        defer dest_save.restore();

                        this.dest.append(entry.path);

                        switch (entry.kind) {
                            .directory => {
                                FD.cwd().makePath(u16, this.dest.sliceZ()) catch {};
                            },
                            .file => {
                                switch (sys.link(u16, this.src.sliceZ(), this.dest.sliceZ())) {
                                    .result => {},
                                    .err => |link_err1| switch (link_err1.getErrno()) {
                                        .UV_EEXIST,
                                        .EXIST,
                                        => {
                                            _ = sys.unlinkW(this.dest.sliceZ());
                                            switch (sys.link(u16, this.src.sliceZ(), this.dest.sliceZ())) {
                                                .result => {},
                                                .err => |link_err2| return .initErr(link_err2),
                                            }
                                        },
                                        .UV_ENOENT,
                                        .NOENT,
                                        => {
                                            const dest_parent = this.dest.dirname() orelse {
                                                return .initErr(link_err1);
                                            };

                                            FD.cwd().makePath(u16, dest_parent) catch {};
                                            switch (sys.link(u16, this.src.sliceZ(), this.dest.sliceZ())) {
                                                .result => {},
                                                .err => |link_err2| return .initErr(link_err2),
                                            }
                                        },
                                        else => return .initErr(link_err1),
                                    },
                                }
                            },
                            else => {},
                        }
                    }

                    return .success;
                }

                while (switch (walker.next()) {
                    .result => |res| res,
                    .err => |err| return .initErr(err),
                }) |entry| {
                    var dest_save = this.dest.save();
                    defer dest_save.restore();

                    this.dest.append(entry.path);

                    switch (entry.kind) {
                        .directory => {
                            FD.cwd().makePath(u8, this.dest.sliceZ()) catch {};
                        },
                        .file => {
                            switch (sys.linkatZ(entry.dir, entry.basename, FD.cwd(), this.dest.sliceZ())) {
                                .result => {},
                                .err => |link_err1| {
                                    switch (link_err1.getErrno()) {
                                        .EXIST => {
                                            FD.cwd().deleteTree(this.dest.slice()) catch {};
                                            switch (sys.linkatZ(entry.dir, entry.basename, FD.cwd(), this.dest.sliceZ())) {
                                                .result => {},
                                                .err => |link_err2| return .initErr(link_err2),
                                            }
                                        },
                                        .NOENT => {
                                            const dest_parent = this.dest.dirname() orelse {
                                                return .initErr(link_err1);
                                            };

                                            FD.cwd().makePath(u8, dest_parent) catch {};
                                            switch (sys.linkatZ(entry.dir, entry.basename, FD.cwd(), this.dest.sliceZ())) {
                                                .result => {},
                                                .err => |link_err2| return .initErr(link_err2),
                                            }
                                        },
                                        else => return .initErr(link_err1),
                                    }
                                },
                            }
                        },
                        else => {},
                    }
                }

                return .success;
            }
        };

        const Symlinker = struct {
            dest: bun.Path(.{ .sep = .auto }),
            target: bun.RelPath(.{ .sep = .auto }),
            fallback_junction_target: bun.AbsPath(.{ .sep = .auto }),

            pub fn symlink(this: *const @This()) sys.Maybe(void) {
                if (comptime Environment.isWindows) {
                    return sys.symlinkOrJunction(this.dest.sliceZ(), this.target.sliceZ(), this.fallback_junction_target.sliceZ());
                }
                return sys.symlink(this.target.sliceZ(), this.dest.sliceZ());
            }

            pub const Strategy = enum {
                expect_existing,
                expect_missing,
                ignore_failure,
            };

            pub fn ensureSymlink(
                this: *const @This(),
                strategy: Strategy,
            ) sys.Maybe(void) {
                return switch (strategy) {
                    .ignore_failure => {
                        return switch (this.symlink()) {
                            .result => .success,
                            .err => |symlink_err| switch (symlink_err.getErrno()) {
                                .NOENT => {
                                    const dest_parent = this.dest.dirname() orelse {
                                        return .success;
                                    };

                                    FD.cwd().makePath(u8, dest_parent) catch {};
                                    _ = this.symlink();
                                    return .success;
                                },
                                else => .success,
                            },
                        };
                    },
                    .expect_missing => {
                        return switch (this.symlink()) {
                            .result => .success,
                            .err => |symlink_err1| switch (symlink_err1.getErrno()) {
                                .NOENT => {
                                    const dest_parent = this.dest.dirname() orelse {
                                        return .initErr(symlink_err1);
                                    };

                                    FD.cwd().makePath(u8, dest_parent) catch {};
                                    return this.symlink();
                                },
                                .EXIST => {
                                    FD.cwd().deleteTree(this.dest.sliceZ()) catch {};
                                    return this.symlink();
                                },
                                else => .initErr(symlink_err1),
                            },
                        };
                    },
                    .expect_existing => {
                        const current_link_buf = bun.path_buffer_pool.get();
                        defer bun.path_buffer_pool.put(current_link_buf);
                        const current_link = switch (sys.readlink(this.dest.sliceZ(), current_link_buf)) {
                            .result => |res| res,
                            .err => |readlink_err| return switch (readlink_err.getErrno()) {
                                .NOENT => switch (this.symlink()) {
                                    .result => .success,
                                    .err => |symlink_err| switch (symlink_err.getErrno()) {
                                        .NOENT => {
                                            const dest_parent = this.dest.dirname() orelse {
                                                return .initErr(symlink_err);
                                            };

                                            FD.cwd().makePath(u8, dest_parent) catch {};
                                            return this.symlink();
                                        },
                                        else => .initErr(symlink_err),
                                    },
                                },
                                else => {
                                    FD.cwd().deleteTree(this.dest.sliceZ()) catch {};
                                    return this.symlink();
                                },
                            },
                        };

                        if (strings.eqlLong(current_link, this.target.sliceZ(), true)) {
                            return .success;
                        }

                        // this existing link is pointing to the wrong package
                        _ = sys.unlink(this.dest.sliceZ());
                        return this.symlink();
                    },
                };
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

        pub fn linkDependencyBins(this: *const Installer, parent_entry_id: Entry.Id) !void {
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

            var link_target_buf: bun.PathBuffer = undefined;
            var link_dest_buf: bun.PathBuffer = undefined;
            var link_rel_buf: bun.PathBuffer = undefined;

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
                    .abs_target_buf = &link_target_buf,
                    .abs_dest_buf = &link_dest_buf,
                    .rel_buf = &link_rel_buf,
                };

                bin_linker.link(false);

                if (bin_linker.err) |err| {
                    return err;
                }
            }
        }

        pub fn appendStoreNodeModulesPath(this: *const Installer, buf: anytype, entry_id: Entry.Id) void {
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
                    buf.appendFmt("node_modules/" ++ modules_dir_name ++ "/{}/node_modules", .{
                        Entry.fmtStorePath(entry_id, this.store, this.lockfile),
                    });
                },
            }
        }

        pub fn appendStorePath(this: *const Installer, buf: anytype, entry_id: Entry.Id) void {
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
                    buf.append("node_modules/" ++ modules_dir_name);
                    buf.appendFmt("{}", .{
                        Entry.fmtStorePath(entry_id, this.store, this.lockfile),
                    });
                    buf.append("node_modules");
                    buf.append(pkg_name.slice(string_buf));
                },
            }
        }
    };

    // A unique entry in the store. As a path looks like:
    //   './node_modules/.bun/name@version/node_modules/name'
    // or if peers are involved:
    //   './node_modules/.bun/name@version_peer1@version+peer2@version/node_modules/name'
    //
    // Entries are created for workspaces (including the root), but only in memory. If
    // a module depends on a workspace, a symlink is created pointing outside the store
    // directory to the workspace.
    pub const Entry = struct {
        // Used to get dependency name for destination path and peers
        // for store path
        node_id: Node.Id,
        // parent_id: Id,
        dependencies: Dependencies,
        parents: std.ArrayListUnmanaged(Id) = .empty,
        step: std.atomic.Value(Installer.Task.Step) = .init(.link_package),

        peer_hash: PeerHash,

        scripts: ?*Package.Scripts.List = null,

        pub const PeerHash = enum(u64) {
            none = 0,
            _,

            pub fn from(int: u64) @This() {
                return @enumFromInt(int);
            }

            pub fn cast(this: @This()) u64 {
                return @intFromEnum(this);
            }
        };

        const StorePathFormatter = struct {
            entry_id: Id,
            store: *const Store,
            lockfile: *const Lockfile,

            pub fn format(this: @This(), comptime _: string, _: std.fmt.FormatOptions, writer: anytype) @TypeOf(writer).Error!void {
                const store = this.store;
                const entries = store.entries.slice();
                const entry_peer_hashes = entries.items(.peer_hash);
                const entry_node_ids = entries.items(.node_id);

                const peer_hash = entry_peer_hashes[this.entry_id.get()];
                const node_id = entry_node_ids[this.entry_id.get()];
                const pkg_id = store.nodes.items(.pkg_id)[node_id.get()];

                const string_buf = this.lockfile.buffers.string_bytes.items;

                const pkgs = this.lockfile.packages.slice();
                const pkg_names = pkgs.items(.name);
                const pkg_resolutions = pkgs.items(.resolution);

                const pkg_name = pkg_names[pkg_id];
                const pkg_res = pkg_resolutions[pkg_id];

                switch (pkg_res.tag) {
                    .folder => {
                        try writer.print("{}@file+{}", .{
                            pkg_name.fmtStorePath(string_buf),
                            pkg_res.value.folder.fmtStorePath(string_buf),
                        });
                    },
                    else => {
                        try writer.print("{}@{}", .{
                            pkg_name.fmtStorePath(string_buf),
                            pkg_res.fmt(string_buf, .posix),
                        });
                    },
                }

                if (peer_hash != .none) {
                    try writer.print("+{}", .{
                        bun.fmt.hexIntLower(peer_hash.cast()),
                    });
                }
            }
        };

        pub fn fmtStorePath(entry_id: Id, store: *const Store, lockfile: *const Lockfile) StorePathFormatter {
            return .{ .entry_id = entry_id, .store = store, .lockfile = lockfile };
        }

        pub fn debugGatherAllParents(entry_id: Id, store: *const Store) []const Id {
            var i: usize = 0;
            var len: usize = 0;

            const entry_parents = store.entries.items(.parents);

            var parents: std.AutoArrayHashMapUnmanaged(Entry.Id, void) = .empty;
            // defer parents.deinit(bun.default_allocator);

            for (entry_parents[entry_id.get()].items) |parent_id| {
                if (parent_id == .invalid) {
                    continue;
                }
                parents.put(bun.default_allocator, parent_id, {}) catch bun.outOfMemory();
            }

            len = parents.count();
            while (i < len) {
                for (entry_parents[parents.entries.items(.key)[i].get()].items) |parent_id| {
                    if (parent_id == .invalid) {
                        continue;
                    }
                    parents.put(bun.default_allocator, parent_id, {}) catch bun.outOfMemory();
                    len = parents.count();
                }
                i += 1;
            }

            return parents.keys();
        }

        pub const List = bun.MultiArrayList(Entry);

        const DependenciesItem = struct {
            entry_id: Id,

            // TODO: this can be removed, and instead dep_id can be retrieved through:
            // entry_id -> node_id -> node_dep_ids
            dep_id: DependencyID,
        };
        pub const Dependencies = OrderedArraySet(DependenciesItem, DependenciesOrderedArraySetCtx);

        const DependenciesOrderedArraySetCtx = struct {
            string_buf: string,
            dependencies: []const Dependency,

            pub fn eql(ctx: *const DependenciesOrderedArraySetCtx, l_item: DependenciesItem, r_item: DependenciesItem) bool {
                if (l_item.entry_id != r_item.entry_id) {
                    return false;
                }

                const dependencies = ctx.dependencies;
                const l_dep = dependencies[l_item.dep_id];
                const r_dep = dependencies[r_item.dep_id];

                return l_dep.name_hash == r_dep.name_hash;
            }

            pub fn order(ctx: *const DependenciesOrderedArraySetCtx, l: DependenciesItem, r: DependenciesItem) std.math.Order {
                const dependencies = ctx.dependencies;
                const l_dep = dependencies[l.dep_id];
                const r_dep = dependencies[r.dep_id];

                if (l.entry_id == r.entry_id and l_dep.name_hash == r_dep.name_hash) {
                    return .eq;
                }

                // TODO: y r doing
                if (l.entry_id == .invalid) {
                    if (r.entry_id == .invalid) {
                        return .eq;
                    }
                    return .lt;
                } else if (r.entry_id == .invalid) {
                    if (l.entry_id == .invalid) {
                        return .eq;
                    }
                    return .gt;
                }

                const string_buf = ctx.string_buf;
                const l_dep_name = l_dep.name;
                const r_dep_name = r_dep.name;

                return l_dep_name.order(&r_dep_name, string_buf, string_buf);
            }
        };

        pub const Id = NewId(Entry);

        pub fn debugPrintList(list: *const List, lockfile: *Lockfile) void {
            const string_buf = lockfile.buffers.string_bytes.items;

            const pkgs = lockfile.packages.slice();
            const pkg_names = pkgs.items(.name);
            const pkg_resolutions = pkgs.items(.resolution);

            std.debug.print("ENTRIES ({d}):\n", .{list.len});

            for (0..list.len) |entry_id| {
                const entry = list.get(entry_id);
                const entry_pkg_name = pkg_names[entry.pkg_id].slice(string_buf);
                std.debug.print(
                    \\entry ({d}): '{s}@{}'
                    \\  dep_name: {s}
                    \\  pkg_id: {d}
                    \\  parent_id: {}
                    \\  
                , .{
                    entry_id,
                    entry_pkg_name,
                    pkg_resolutions[entry.pkg_id].fmt(string_buf, .posix),
                    entry.dep_name.slice(string_buf),
                    entry.pkg_id,
                    entry.parent_id,
                });

                std.debug.print("  dependencies ({d}):\n", .{entry.dependencies.items.len});
                for (entry.dependencies.items) |dep_entry_id| {
                    const dep_entry = list.get(dep_entry_id.get());
                    std.debug.print("    {s}@{}\n", .{
                        pkg_names[dep_entry.pkg_id].slice(string_buf),
                        pkg_resolutions[dep_entry.pkg_id].fmt(string_buf, .posix),
                    });
                }
            }
        }
    };

    fn OrderedArraySet(comptime T: type, comptime Ctx: type) type {
        return struct {
            list: std.ArrayListUnmanaged(T) = .empty,

            pub const empty: @This() = .{};

            pub fn initCapacity(allocator: std.mem.Allocator, n: usize) OOM!@This() {
                const list: std.ArrayListUnmanaged(T) = try .initCapacity(allocator, n);
                return .{ .list = list };
            }

            pub fn deinit(this: *@This(), allocator: std.mem.Allocator) void {
                this.list.deinit(allocator);
            }

            pub fn slice(this: *const @This()) []const T {
                return this.list.items;
            }

            pub fn len(this: *const @This()) usize {
                return this.list.items.len;
            }

            pub fn eql(l: *const @This(), r: *const @This(), ctx: *const Ctx) bool {
                if (l.list.items.len != r.list.items.len) {
                    return false;
                }

                for (l.list.items, r.list.items) |l_item, r_item| {
                    if (!ctx.eql(l_item, r_item)) {
                        return false;
                    }
                }

                return true;
            }

            pub fn insert(this: *@This(), allocator: std.mem.Allocator, new: T, ctx: *const Ctx) OOM!void {
                for (0..this.list.items.len) |i| {
                    const existing = this.list.items[i];
                    if (ctx.eql(new, existing)) {
                        return;
                    }

                    const order = ctx.order(new, existing);

                    bun.debugAssert(order != .eq);

                    if (order == .lt) {
                        try this.list.insert(allocator, i, new);
                        return;
                    }
                }

                try this.list.append(allocator, new);
            }

            pub fn insertAssumeCapacity(this: *@This(), new: T, ctx: *const Ctx) void {
                for (0..this.list.items.len) |i| {
                    const existing = this.list.items[i];
                    if (ctx.eql(new, existing)) {
                        return;
                    }

                    const order = ctx.order(new, existing);

                    bun.debugAssert(order != .eq);

                    if (order == .lt) {
                        this.list.insertAssumeCapacity(i, new);
                        return;
                    }
                }

                this.list.appendAssumeCapacity(new);
            }
        };
    }

    // A node used to represent the full dependency tree. Uniqueness is determined
    // from `pkg_id` and `peers`
    pub const Node = struct {
        dep_id: DependencyID,
        pkg_id: PackageID,
        parent_id: Id,

        dependencies: std.ArrayListUnmanaged(Ids) = .empty,
        peers: Peers = .empty,

        // each node in this list becomes a symlink in the package's node_modules
        nodes: std.ArrayListUnmanaged(Id) = .empty,

        pub const Peers = OrderedArraySet(TransitivePeer, TransitivePeer.OrderedArraySetCtx);

        const TransitivePeer = struct {
            dep_id: DependencyID,
            pkg_id: PackageID,
            auto_installed: bool,

            const OrderedArraySetCtx = struct {
                string_buf: string,
                pkg_names: []const String,

                pub fn eql(ctx: *const OrderedArraySetCtx, l_item: TransitivePeer, r_item: TransitivePeer) bool {
                    _ = ctx;
                    return l_item.pkg_id == r_item.pkg_id;
                }

                pub fn order(ctx: *const OrderedArraySetCtx, l: TransitivePeer, r: TransitivePeer) std.math.Order {
                    const l_pkg_id = l.pkg_id;
                    const r_pkg_id = r.pkg_id;
                    if (l_pkg_id == r_pkg_id) {
                        return .eq;
                    }

                    const string_buf = ctx.string_buf;
                    const pkg_names = ctx.pkg_names;
                    const l_pkg_name = pkg_names[l_pkg_id];
                    const r_pkg_name = pkg_names[r_pkg_id];

                    return l_pkg_name.order(&r_pkg_name, string_buf, string_buf);
                }
            };
        };

        pub const List = bun.MultiArrayList(Node);

        pub fn deinitList(list: *const List, allocator: std.mem.Allocator) void {
            const slice = list.slice();
            const list_dependencies = slice.items(.dependencies);
            const list_peers = slice.items(.peers);
            const list_nodes = slice.items(.nodes);

            var total: usize = list.capacity;

            for (list_dependencies, list_peers, list_nodes) |*dependencies, *peers, *nodes| {
                total += dependencies.capacity + peers.list.capacity + nodes.capacity;
                dependencies.deinit(allocator);
                peers.deinit(allocator);
                nodes.deinit(allocator);
            }

            std.debug.print("nodes size: {}\n", .{bun.fmt.size(total, .{})});

            list.deinit(allocator);
        }

        pub fn debugPrint(this: *const Node, id: Id, lockfile: *const Lockfile) void {
            const pkgs = lockfile.packages.slice();
            const pkg_names = pkgs.items(.name);
            const pkg_resolutions = pkgs.items(.resolution);

            const string_buf = lockfile.buffers.string_bytes.items;
            const deps = lockfile.buffers.dependencies.items;

            const dep_name = if (this.dep_id == invalid_dependency_id) "root" else deps[this.dep_id].name.slice(string_buf);
            const dep_version = if (this.dep_id == invalid_dependency_id) "root" else deps[this.dep_id].version.literal.slice(string_buf);

            std.debug.print(
                \\node({d}):
                \\  dep: {s}@{s}
                \\  res: {s}@{}
                \\
            , .{
                id,
                dep_name,
                dep_version,
                pkg_names[this.pkg_id].slice(string_buf),
                pkg_resolutions[this.pkg_id].fmt(string_buf, .posix),
            });
        }

        pub const Id = NewId(Node);

        pub fn debugPrintList(list: *const List, lockfile: *const Lockfile) void {
            const string_buf = lockfile.buffers.string_bytes.items;
            const dependencies = lockfile.buffers.dependencies.items;

            const pkgs = lockfile.packages.slice();
            const pkg_names = pkgs.items(.name);
            const pkg_resolutions = pkgs.items(.resolution);

            std.debug.print("NODE ({d}):\n", .{list.len});

            for (0..list.len) |node_id| {
                const node = list.get(node_id);
                const node_pkg_name = pkg_names[node.pkg_id].slice(string_buf);
                std.debug.print(
                    \\node ({d}): '{s}'
                    \\  dep_id: {d}
                    \\  pkg_id: {d}
                    \\  parent_id: {}
                    \\
                , .{
                    node_id,
                    node_pkg_name,
                    node.dep_id,
                    node.pkg_id,
                    node.parent_id,
                });

                std.debug.print("  dependencies ({d}):\n", .{node.dependencies.items.len});
                for (node.dependencies.items) |ids| {
                    const dep = dependencies[ids.dep_id];
                    const dep_name = dep.name.slice(string_buf);

                    const pkg_name = pkg_names[ids.pkg_id].slice(string_buf);
                    const pkg_res = pkg_resolutions[ids.pkg_id];

                    std.debug.print("    {s}@{} ({s}@{s})\n", .{
                        pkg_name,
                        pkg_res.fmt(string_buf, .posix),
                        dep_name,
                        dep.version.literal.slice(string_buf),
                    });
                }

                std.debug.print("  nodes ({d}): ", .{node.nodes.items.len});
                for (node.nodes.items, 0..) |id, i| {
                    std.debug.print("{d}", .{id.get()});
                    if (i != node.nodes.items.len - 1) {
                        std.debug.print(",", .{});
                    }
                }

                std.debug.print("\n  peers ({d}):\n", .{node.peers.list.items.len});
                for (node.peers.list.items) |ids| {
                    const dep = dependencies[ids.dep_id];
                    const dep_name = dep.name.slice(string_buf);
                    const pkg_name = pkg_names[ids.pkg_id].slice(string_buf);
                    const pkg_res = pkg_resolutions[ids.pkg_id];

                    std.debug.print("    {s}@{} ({s}@{s})\n", .{
                        pkg_name,
                        pkg_res.fmt(string_buf, .posix),
                        dep_name,
                        dep.version.literal.slice(string_buf),
                    });
                }
            }
        }
    };
};

// @sortImports

const Walker = @import("../walker_skippable.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const Global = bun.Global;
const OOM = bun.OOM;
const Output = bun.Output;
const Progress = bun.Progress;
const ThreadPool = bun.ThreadPool;
const string = bun.string;
const strings = bun.strings;
const sys = bun.sys;
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const Command = bun.CLI.Command;

const Semver = bun.Semver;
const String = Semver.String;

const install = bun.install;
const Bin = install.Bin;
const Dependency = install.Dependency;
const DependencyID = install.DependencyID;
const PackageID = install.PackageID;
const PackageInstall = install.PackageInstall;
const PackageNameHash = install.PackageNameHash;
const Resolution = install.Resolution;
const TruncatedPackageNameHash = install.TruncatedPackageNameHash;
const invalid_dependency_id = install.invalid_dependency_id;
const invalid_package_id = install.invalid_package_id;

const Lockfile = install.Lockfile;
const Package = Lockfile.Package;
const Tree = Lockfile.Tree;

const PackageManager = install.PackageManager;
const ProgressStrings = PackageManager.ProgressStrings;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
