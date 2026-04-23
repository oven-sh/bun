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

        // DFS so a deduplicated node's full subtree (and therefore its `peers`)
        // is finalized before any later sibling encounters it.
        var node_queue: std.ArrayListUnmanaged(QueuedNode) = .empty;
        defer node_queue.deinit(lockfile.allocator);

        try node_queue.append(lockfile.allocator, .{
            .parent_id = .invalid,
            .dep_id = invalid_dependency_id,
            .pkg_id = 0,
        });

        var dep_ids_sort_buf: std.ArrayListUnmanaged(DependencyID) = .empty;
        defer dep_ids_sort_buf.deinit(lockfile.allocator);

        // For each package, the peer dependency names declared anywhere in its
        // transitive closure that are not satisfied within that closure (i.e., the
        // walk-up in the loop below would continue past this package).
        //
        // A node's `peers` set (the second-pass dedup key) is exactly the resolved
        // package for each of these names as seen from the node's ancestor chain, so
        // two nodes with the same package and the same ancestor resolution for each
        // name will produce identical subtrees and identical second-pass entries.
        //
        // The universe of distinct peer-dependency names is small even in large
        // lockfiles, so each per-package set is a bitset over that universe and the
        // fixpoint is bitwise OR/ANDNOT on a contiguous buffer.
        var peer_name_idx: std.AutoArrayHashMapUnmanaged(PackageNameHash, void) = .empty;
        defer peer_name_idx.deinit(lockfile.allocator);
        for (dependencies) |dep| {
            if (dep.behavior.isPeer()) {
                try peer_name_idx.put(lockfile.allocator, dep.name_hash, {});
            }
        }
        const peer_name_count: u32 = @intCast(peer_name_idx.count());

        var leaking_peers: bun.bit_set.DynamicBitSetUnmanaged.List = try .initEmpty(
            lockfile.allocator,
            lockfile.packages.len,
            peer_name_count,
        );
        defer leaking_peers.deinit(lockfile.allocator);

        if (peer_name_count != 0) {
            // The runtime child of a peer edge is whichever package an ancestor's
            // dependency with that name resolves to, which may be an `npm:`-aliased
            // target whose package name differs. Index resolutions by *dependency*
            // name so the union below covers every package a peer could become.
            const peer_targets: []std.ArrayListUnmanaged(PackageID) = try lockfile.allocator.alloc(
                std.ArrayListUnmanaged(PackageID),
                peer_name_count,
            );
            @memset(peer_targets, .empty);
            defer {
                for (peer_targets) |*list| list.deinit(lockfile.allocator);
                lockfile.allocator.free(peer_targets);
            }
            for (dependencies, resolutions) |dep, res| {
                if (res == invalid_package_id) continue;
                const bit = peer_name_idx.getIndex(dep.name_hash) orelse continue;
                if (std.mem.indexOfScalar(PackageID, peer_targets[bit].items, res) == null) {
                    try peer_targets[bit].append(lockfile.allocator, res);
                }
            }

            // Per-package bits computed once: own peer-dep names, and non-peer
            // dependency names that will appear in `node_dependencies` (i.e., not
            // filtered out by bundled/disabled/unresolved).
            var own_peers: bun.bit_set.DynamicBitSetUnmanaged.List = try .initEmpty(
                lockfile.allocator,
                lockfile.packages.len,
                peer_name_count,
            );
            defer own_peers.deinit(lockfile.allocator);
            var provides: bun.bit_set.DynamicBitSetUnmanaged.List = try .initEmpty(
                lockfile.allocator,
                lockfile.packages.len,
                peer_name_count,
            );
            defer provides.deinit(lockfile.allocator);
            for (0..lockfile.packages.len) |pkg_idx| {
                const pkg_id: PackageID = @intCast(pkg_idx);
                const deps = pkg_dependency_slices[pkg_id];
                for (deps.begin()..deps.end()) |_dep_id| {
                    const dep_id: DependencyID = @intCast(_dep_id);
                    const dep = dependencies[dep_id];
                    const bit = peer_name_idx.getIndex(dep.name_hash) orelse continue;
                    if (dep.behavior.isPeer()) {
                        own_peers.set(pkg_id, bit);
                    } else if (!Tree.isFilteredDependencyOrWorkspace(
                        dep_id,
                        pkg_id,
                        workspace_filters,
                        install_root_dependencies,
                        manager,
                        lockfile,
                    )) {
                        provides.set(pkg_id, bit);
                    }
                }
            }

            var scratch = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(lockfile.allocator, peer_name_count);
            defer scratch.deinit(lockfile.allocator);

            var changed = true;
            while (changed) {
                changed = false;
                for (0..lockfile.packages.len) |pkg_idx| {
                    const pkg_id: PackageID = @intCast(pkg_idx);
                    const deps = pkg_dependency_slices[pkg_id];

                    scratch.copyInto(own_peers.at(pkg_id));

                    for (deps.begin()..deps.end()) |_dep_id| {
                        const dep_id: DependencyID = @intCast(_dep_id);
                        const dep = dependencies[dep_id];
                        if (dep.behavior.isPeer()) {
                            if (peer_name_idx.getIndex(dep.name_hash)) |bit| {
                                for (peer_targets[bit].items) |child| {
                                    scratch.setUnion(leaking_peers.at(child));
                                }
                            }
                        } else {
                            const res_pkg = resolutions[dep_id];
                            if (res_pkg != invalid_package_id) {
                                scratch.setUnion(leaking_peers.at(res_pkg));
                            }
                        }
                    }
                    scratch.setExclude(provides.at(pkg_id));

                    var dst = leaking_peers.at(pkg_id);
                    if (!scratch.eql(dst)) {
                        dst.copyInto(scratch);
                        changed = true;
                    }
                }
            }
        }

        // Two would-be nodes with the same (pkg_id, ctx_hash) will end up with the
        // same `peers` set and therefore become the same entry in the second pass.
        // ctx_hash is 0 when the package has no leaking peers (or is a workspace).
        const EarlyDedupeKey = struct { pkg_id: PackageID, ctx_hash: u64 };
        var early_dedupe: std.AutoHashMap(EarlyDedupeKey, Store.Node.Id) = .init(lockfile.allocator);
        defer early_dedupe.deinit();

        var root_declares_workspace = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(lockfile.allocator, lockfile.packages.len);
        defer root_declares_workspace.deinit(lockfile.allocator);
        for (pkg_dependency_slices[0].begin()..pkg_dependency_slices[0].end()) |_dep_idx| {
            const dep_idx: DependencyID = @intCast(_dep_idx);
            if (!dependencies[dep_idx].behavior.isWorkspace()) continue;
            const res = resolutions[dep_idx];
            if (res == invalid_package_id) continue;
            // Only mark workspaces that root will actually queue; an entry excluded
            // by --filter or `bun install <pkgs>` never gets a root-declared node,
            // so a `workspace:` reference must keep its dependencies.
            if (Tree.isFilteredDependencyOrWorkspace(
                dep_idx,
                0,
                workspace_filters,
                install_root_dependencies,
                manager,
                lockfile,
            )) continue;
            if (packages_to_install) |packages| {
                if (std.mem.indexOfScalar(PackageID, packages, res) == null) continue;
            }
            root_declares_workspace.set(res);
        }

        var peer_dep_ids: std.array_list.Managed(DependencyID) = .init(lockfile.allocator);
        defer peer_dep_ids.deinit();

        var visited_parent_node_ids: std.array_list.Managed(Store.Node.Id) = .init(lockfile.allocator);
        defer visited_parent_node_ids.deinit();

        // First pass: create full dependency tree with resolved peers
        next_node: while (node_queue.pop()) |entry| {
            check_cycle: {
                // check for cycles
                const nodes_slice = nodes.slice();
                const node_pkg_ids = nodes_slice.items(.pkg_id);
                const node_dep_ids = nodes_slice.items(.dep_id);
                const node_parent_ids = nodes_slice.items(.parent_id);
                const node_nodes = nodes_slice.items(.nodes);

                var curr_id = entry.parent_id;
                while (curr_id != .invalid) {
                    if (node_pkg_ids[curr_id.get()] == entry.pkg_id) {
                        // skip the new node, and add the previously added node to parent so it appears in
                        // 'node_modules/.bun/parent@version/node_modules'.

                        const dep_id = node_dep_ids[curr_id.get()];
                        if (dep_id == invalid_dependency_id and entry.dep_id == invalid_dependency_id) {
                            node_nodes[entry.parent_id.get()].appendAssumeCapacity(curr_id);
                            continue :next_node;
                        }

                        if (dep_id == invalid_dependency_id or entry.dep_id == invalid_dependency_id) {
                            // one is the root package, one is a dependency on the root package (it has a valid dep_id)
                            // create a new node for it.
                            break :check_cycle;
                        }

                        const curr_dep = dependencies[dep_id];
                        const entry_dep = dependencies[entry.dep_id];

                        // ensure the dependency name is the same before skipping the cycle. if they aren't
                        // we lose dependency name information for the symlinks
                        if (curr_dep.name_hash == entry_dep.name_hash and
                            // also ensure workspace self deps are not skipped.
                            // implicit workspace dep != explicit workspace dep
                            curr_dep.behavior.workspace == entry_dep.behavior.workspace)
                        {
                            node_nodes[entry.parent_id.get()].appendAssumeCapacity(curr_id);
                            continue :next_node;
                        }
                    }
                    curr_id = node_parent_ids[curr_id.get()];
                }
            }

            const node_id: Store.Node.Id = .from(@intCast(nodes.len));
            const pkg_deps = pkg_dependency_slices[entry.pkg_id];

            // for skipping dependnecies of workspace packages and the root package. the dependencies
            // of these packages should only be pulled in once, but we might need to create more than
            // one entry if there's multiple dependencies on the workspace or root package.
            var skip_dependencies = entry.pkg_id == 0 and entry.dep_id != invalid_dependency_id;

            if (entry.dep_id != invalid_dependency_id) {
                const entry_dep = dependencies[entry.dep_id];

                // A `workspace:` protocol reference does not own the workspace's
                // dependencies when root also declares that workspace; the
                // root-declared entry does. (If root does not declare it, the
                // protocol reference is the only one and must keep them.)
                if (entry_dep.version.tag == .workspace and
                    !entry_dep.behavior.isWorkspace() and
                    root_declares_workspace.isSet(entry.pkg_id))
                {
                    skip_dependencies = true;
                }

                dont_dedupe: {
                    const nodes_slice = nodes.slice();
                    const node_nodes = nodes_slice.items(.nodes);
                    const node_dep_ids = nodes_slice.items(.dep_id);
                    const node_parent_ids = nodes_slice.items(.parent_id);
                    const node_dependencies = nodes_slice.items(.dependencies);
                    const node_peers = nodes_slice.items(.peers);

                    const ctx_hash: u64 = if (entry_dep.version.tag == .workspace or peer_name_count == 0)
                        0
                    else ctx: {
                        const leaks = leaking_peers.at(entry.pkg_id);
                        if (leaks.count() == 0) break :ctx 0;

                        const peer_names = peer_name_idx.keys();
                        var hasher = bun.Wyhash11.init(0);
                        var it = leaks.iterator(.{});
                        while (it.next()) |bit| {
                            const peer_name_hash = peer_names[bit];
                            const resolved: PackageID = resolved: {
                                var curr_id = entry.parent_id;
                                while (curr_id != .invalid) {
                                    for (node_dependencies[curr_id.get()].items) |ids| {
                                        if (dependencies[ids.dep_id].name_hash == peer_name_hash) {
                                            break :resolved ids.pkg_id;
                                        }
                                    }
                                    for (node_peers[curr_id.get()].list.items) |ids| {
                                        if (!ids.auto_installed and dependencies[ids.dep_id].name_hash == peer_name_hash) {
                                            break :resolved ids.pkg_id;
                                        }
                                    }
                                    curr_id = node_parent_ids[curr_id.get()];
                                }
                                break :resolved invalid_package_id;
                            };
                            // Auto-install fallback is declarer-specific; let the
                            // second pass handle this position rather than risk an
                            // unsound key.
                            if (resolved == invalid_package_id) break :dont_dedupe;
                            hasher.update(std.mem.asBytes(&peer_name_hash));
                            hasher.update(std.mem.asBytes(&resolved));
                        }
                        break :ctx hasher.final();
                    };

                    const dedupe_entry = try early_dedupe.getOrPut(.{ .pkg_id = entry.pkg_id, .ctx_hash = ctx_hash });
                    if (dedupe_entry.found_existing) {
                        const dedupe_node_id = dedupe_entry.value_ptr.*;

                        const dedupe_dep_id = node_dep_ids[dedupe_node_id.get()];
                        if (dedupe_dep_id == invalid_dependency_id) {
                            break :dont_dedupe;
                        }
                        const dedupe_dep = dependencies[dedupe_dep_id];

                        if (dedupe_dep.name_hash != entry_dep.name_hash) {
                            break :dont_dedupe;
                        }

                        if ((dedupe_dep.version.tag == .workspace) != (entry_dep.version.tag == .workspace)) {
                            break :dont_dedupe;
                        }

                        if (dedupe_dep.version.tag == .workspace and entry_dep.version.tag == .workspace) {
                            if (dedupe_dep.behavior.isWorkspace() != entry_dep.behavior.isWorkspace()) {
                                break :dont_dedupe;
                            }
                        }

                        // The skipped subtree would have walked up through this
                        // ancestor chain marking each node with its leaking peers.
                        // DFS guarantees `dedupe_node`'s subtree is fully processed,
                        // so its `peers` is exactly that set; propagate it here.
                        const set_ctx: Store.Node.TransitivePeer.OrderedArraySetCtx = .{
                            .string_buf = string_buf,
                            .pkg_names = pkg_names,
                        };
                        for (node_peers[dedupe_node_id.get()].list.items) |peer| {
                            const peer_name_hash = dependencies[peer.dep_id].name_hash;
                            var curr_id = entry.parent_id;
                            walk: while (curr_id != .invalid) {
                                for (node_dependencies[curr_id.get()].items) |ids| {
                                    if (dependencies[ids.dep_id].name_hash == peer_name_hash) break :walk;
                                }
                                try node_peers[curr_id.get()].insert(lockfile.allocator, peer, &set_ctx);
                                curr_id = node_parent_ids[curr_id.get()];
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
                .nodes = if (skip_dependencies) .empty else try .initCapacity(lockfile.allocator, pkg_deps.len),
                .dependencies = if (skip_dependencies) .empty else try .initCapacity(lockfile.allocator, pkg_deps.len),
            });

            const nodes_slice = nodes.slice();
            const node_parent_ids = nodes_slice.items(.parent_id);
            const node_dependencies = nodes_slice.items(.dependencies);
            const node_peers = nodes_slice.items(.peers);
            const node_nodes = nodes_slice.items(.nodes);

            if (entry.parent_id.tryGet()) |parent_id| {
                node_nodes[parent_id].appendAssumeCapacity(node_id);
            }

            if (skip_dependencies) {
                continue;
            }

            const queue_mark = node_queue.items.len;

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

            queue_deps: {
                if (packages_to_install) |packages| {
                    if (node_id == .root) { // TODO: print an error when scanner is actually a dependency of a workspace (we should not support this)
                        for (dep_ids_sort_buf.items) |dep_id| {
                            const pkg_id = resolutions[dep_id];
                            if (pkg_id == invalid_package_id) {
                                continue;
                            }

                            for (packages) |package_to_install| {
                                if (package_to_install == pkg_id) {
                                    node_dependencies[node_id.get()].appendAssumeCapacity(.{ .dep_id = dep_id, .pkg_id = pkg_id });
                                    try node_queue.append(lockfile.allocator, .{
                                        .parent_id = node_id,
                                        .dep_id = dep_id,
                                        .pkg_id = pkg_id,
                                    });
                                    break;
                                }
                            }
                        }
                        break :queue_deps;
                    }
                }

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
                        try node_queue.append(lockfile.allocator, .{
                            .parent_id = node_id,
                            .dep_id = dep_id,
                            .pkg_id = pkg_id,
                        });
                        continue;
                    }

                    try peer_dep_ids.append(dep_id);
                }
            }

            for (peer_dep_ids.items) |peer_dep_id| {
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

                            const best_version = resolutions[peer_dep_id];

                            if (best_version == invalid_package_id) {
                                break :resolved_pkg_id .{ invalid_package_id, true };
                            }

                            if (best_version == ids.pkg_id) {
                                break :resolved_pkg_id .{ ids.pkg_id, true };
                            }

                            // add the remaining parent ids
                            while (curr_id != .invalid) {
                                try visited_parent_node_ids.append(curr_id);
                                curr_id = node_parent_ids[curr_id.get()];
                            }

                            break :resolved_pkg_id .{ best_version, true };
                        }

                        // TODO: prevent marking workspace and symlink deps with transitive peers

                        // add to visited parents after searching for a peer resolution.
                        // if a node resolves a transitive peer, it can still be deduplicated
                        try visited_parent_node_ids.append(curr_id);
                        curr_id = node_parent_ids[curr_id.get()];
                    }

                    // choose the current best version
                    break :resolved_pkg_id .{ resolutions[peer_dep_id], true };
                };

                if (resolved_pkg_id == invalid_package_id) {
                    // these are optional peers that failed to find any dependency with a matching
                    // name. they are completely excluded
                    continue;
                }

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
                    try node_queue.append(lockfile.allocator, .{
                        .parent_id = node_id,
                        .dep_id = peer_dep_id,
                        .pkg_id = resolved_pkg_id,
                    });
                }
            }

            // node_queue is a stack: reverse children so the first one pushed is the
            // first popped, matching BFS sibling order.
            std.mem.reverse(QueuedNode, node_queue.items[queue_mark..]);
        }

        if (manager.options.log_level.isVerbose()) {
            const full_tree_end = timer.read();
            timer.reset();
            Output.prettyErrorln("Resolved peers [{f}]", .{bun.fmt.fmtDurationOneDecimal(full_tree_end)});
        }

        const DedupeInfo = struct {
            entry_id: Store.Entry.Id,
            dep_id: DependencyID,
            peers: Store.OrderedArraySet(Store.Node.TransitivePeer, Store.Node.TransitivePeer.OrderedArraySetCtx),
        };

        var dedupe: std.AutoHashMapUnmanaged(PackageID, std.ArrayListUnmanaged(DedupeInfo)) = .empty;
        defer dedupe.deinit(lockfile.allocator);

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
        var entry_queue: bun.LinearFifo(QueuedEntry, .Dynamic) = .init(lockfile.allocator);
        defer entry_queue.deinit();

        try entry_queue.writeItem(.{
            .node_id = .from(0),
            .entry_parent_id = .invalid,
        });

        var public_hoisted: bun.StringArrayHashMap(void) = .init(manager.allocator);
        defer public_hoisted.deinit();

        var hidden_hoisted: bun.StringArrayHashMap(void) = .init(manager.allocator);
        defer hidden_hoisted.deinit();

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
                    if (info.dep_id == invalid_dependency_id or curr_dep_id == invalid_dependency_id) {
                        if (info.dep_id != curr_dep_id) {
                            continue;
                        }
                    }
                    if (info.dep_id != invalid_dependency_id and curr_dep_id != invalid_dependency_id) {
                        const curr_dep = dependencies[curr_dep_id];
                        const existing_dep = dependencies[info.dep_id];

                        if (existing_dep.version.tag == .workspace and curr_dep.version.tag == .workspace) {
                            if (existing_dep.behavior.isWorkspace() != curr_dep.behavior.isWorkspace()) {
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

                        if (curr_dep_id != invalid_dependency_id and dependencies[curr_dep_id].behavior.isWorkspace()) {
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
                    // Only hash peer names, not their resolved versions. This
                    // ensures a stable store path when workspaces resolve the
                    // same peer dependency to different compatible versions.
                }
                break :peer_hash .from(hasher.final());
            };

            const new_entry_dep_id = node_dep_ids[entry.node_id.get()];

            const new_entry_is_root = new_entry_dep_id == invalid_dependency_id;
            const new_entry_is_workspace = !new_entry_is_root and dependencies[new_entry_dep_id].version.tag == .workspace;

            const new_entry_dependencies: Store.Entry.Dependencies = if (dedupe_entry.found_existing and new_entry_is_workspace)
                .empty
            else
                try .initCapacity(lockfile.allocator, node_nodes[entry.node_id.get()].items.len);

            var new_entry_parents: std.ArrayListUnmanaged(Store.Entry.Id) = try .initCapacity(lockfile.allocator, 1);
            new_entry_parents.appendAssumeCapacity(entry.entry_parent_id);

            const hoisted = hoisted: {
                if (new_entry_dep_id == invalid_dependency_id) {
                    break :hoisted false;
                }

                const dep_name = dependencies[new_entry_dep_id].name.slice(string_buf);

                const hoist_pattern = manager.options.hoist_pattern orelse {
                    const hoist_entry = try hidden_hoisted.getOrPut(dep_name);
                    break :hoisted !hoist_entry.found_existing;
                };

                if (hoist_pattern.isMatch(dep_name)) {
                    const hoist_entry = try hidden_hoisted.getOrPut(dep_name);
                    break :hoisted !hoist_entry.found_existing;
                }

                break :hoisted false;
            };

            const new_entry: Store.Entry = .{
                .node_id = entry.node_id,
                .dependencies = new_entry_dependencies,
                .parents = new_entry_parents,
                .peer_hash = new_entry_peer_hash,
                .hoisted = hoisted,
            };

            const new_entry_id: Store.Entry.Id = .from(@intCast(store.len));
            try store.append(lockfile.allocator, new_entry);

            if (entry.entry_parent_id.tryGet()) |entry_parent_id| skip_adding_dependency: {
                if (new_entry_dep_id != invalid_dependency_id and dependencies[new_entry_dep_id].behavior.isWorkspace()) {
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

                if (new_entry_dep_id != invalid_dependency_id) {
                    if (entry.entry_parent_id == .root) {
                        // make sure direct dependencies are not replaced
                        const dep_name = dependencies[new_entry_dep_id].name.slice(string_buf);
                        try public_hoisted.put(dep_name, {});
                    } else {
                        // transitive dependencies (also direct dependencies of workspaces!)
                        const dep_name = dependencies[new_entry_dep_id].name.slice(string_buf);
                        if (manager.options.public_hoist_pattern) |public_hoist_pattern| {
                            if (public_hoist_pattern.isMatch(dep_name)) {
                                const hoist_entry = try public_hoisted.getOrPut(dep_name);
                                if (!hoist_entry.found_existing) {
                                    try entry_dependencies[0].insert(
                                        lockfile.allocator,
                                        .{ .entry_id = new_entry_id, .dep_id = new_entry_dep_id },
                                        &ctx,
                                    );
                                }
                            }
                        }
                    }
                }
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
            Output.prettyErrorln("Created store [{f}]", .{bun.fmt.fmtDurationOneDecimal(dedupe_end)});
        }

        break :store .{
            .entries = store,
            .nodes = nodes,
        };
    };

    // Compute entry_hash for the global virtual store. The hash makes a
    // global-store directory name unique to this entry's *resolved* dependency
    // closure, so two projects that resolve `react@18.3.1` to the same set of
    // transitive versions share one on-disk entry, while a project that
    // resolves a transitive dep to a different version gets its own.
    //
    // Eligibility propagates: an entry is only global-store-eligible (hash != 0)
    // when the package itself comes from an immutable cache (npm/git/tarball,
    // unpatched, no lifecycle scripts) *and* every dependency it links to is
    // also eligible. The second condition matters because dep symlinks live
    // inside the global entry; baking a project-local path (workspace, folder)
    // into a shared directory would break for every other consumer.
    const WyhashWriter = struct {
        hasher: *std.hash.Wyhash,
        const E = error{};
        pub fn writer(self: *@This()) std.io.GenericWriter(*@This(), E, write) {
            return .{ .context = self };
        }
        fn write(self: *@This(), bytes: []const u8) E!usize {
            self.hasher.update(bytes);
            return bytes.len;
        }
    };

    const global_store_path: ?[:0]const u8 = if (manager.options.enable.global_virtual_store) global_store_path: {
        const entries = store.entries.slice();
        const entry_hashes = entries.items(.entry_hash);
        const entry_node_ids = entries.items(.node_id);
        const entry_dependencies = entries.items(.dependencies);

        const node_pkg_ids = store.nodes.items(.pkg_id);
        const node_dep_ids = store.nodes.items(.dep_id);

        const pkgs = lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        const pkg_name_hashes = pkgs.items(.name_hash);
        const pkg_resolutions = pkgs.items(.resolution);
        const pkg_metas = pkgs.items(.meta);

        const string_buf = lockfile.buffers.string_bytes.items;
        const dependencies = lockfile.buffers.dependencies.items;

        // Packages newly trusted via `bun add --trust` (not yet written to the
        // lockfile) will have their lifecycle scripts run this install; treat
        // them the same as lockfile-trusted packages for eligibility.
        var trusted_from_update = manager.findTrustedDependenciesFromUpdateRequests();
        defer trusted_from_update.deinit(manager.allocator);

        const State = enum { unvisited, in_progress, ineligible, done };
        const states = try manager.allocator.alloc(State, store.entries.len);
        defer manager.allocator.free(states);
        @memset(states, .unvisited);

        // Iterative DFS so dependency cycles (which the isolated graph permits)
        // can't overflow the stack and are handled deterministically: a back-edge
        // contributes the dependency *name* to the parent's hash but not the
        // child's own hash (still being computed). Two entries that only differ
        // by which side of a cycle they sit on still get distinct hashes via
        // their own store-path bytes.
        var stack: std.ArrayListUnmanaged(struct { id: Store.Entry.Id, dep_idx: u32, hasher: std.hash.Wyhash }) = .empty;
        defer stack.deinit(manager.allocator);

        for (0..store.entries.len) |_root_id| {
            if (states[_root_id] != .unvisited) continue;
            try stack.append(manager.allocator, .{ .id = .from(@intCast(_root_id)), .dep_idx = 0, .hasher = undefined });

            while (stack.items.len > 0) {
                const top = &stack.items[stack.items.len - 1];
                const id = top.id;
                const idx = id.get();

                if (states[idx] == .unvisited) {
                    states[idx] = .in_progress;

                    const node_id = entry_node_ids[idx];
                    const pkg_id = node_pkg_ids[node_id.get()];
                    const dep_id = node_dep_ids[node_id.get()];
                    const pkg_res = pkg_resolutions[pkg_id];

                    const eligible = switch (pkg_res.tag) {
                        .npm, .git, .github, .local_tarball, .remote_tarball => eligible: {
                            // Patched packages and packages with lifecycle scripts
                            // mutate (or may mutate) their install directory, so a
                            // shared global copy would either diverge from the
                            // patch or be mutated underneath other projects.
                            if (lockfile.patched_dependencies.count() > 0) {
                                var name_version_buf: bun.PathBuffer = undefined;
                                const name_version = std.fmt.bufPrint(&name_version_buf, "{s}@{f}", .{
                                    pkg_names[pkg_id].slice(string_buf),
                                    pkg_res.fmt(string_buf, .posix),
                                }) catch {
                                    // Overflow is implausible (PathBuffer ≫
                                    // any name+version), but if it ever fired
                                    // the safe answer is "not eligible" rather
                                    // than letting a possibly-patched package
                                    // slip into the shared store.
                                    break :eligible false;
                                };
                                if (lockfile.patched_dependencies.contains(bun.Semver.String.Builder.stringHash(name_version))) {
                                    break :eligible false;
                                }
                            }
                            // `run_preinstall()` authorizes scripts by the
                            // dependency *alias* name, so an aliased install
                            // like `foo: npm:bar@1` is trusted if `foo` is in
                            // trustedDependencies even though the package name
                            // is `bar`. Mirror that here so the alias case
                            // can't slip past the eligibility check.
                            //
                            // Intentionally *not* gated on `do.run_scripts`
                            // (a later install without `--ignore-scripts`
                            // would run the postinstall through the project
                            // symlink and mutate the shared directory) *or*
                            // on `meta.hasInstallScript()` (that flag is not
                            // serialised in `bun.lock`, so it reads `false`
                            // on every install after the first; a trusted
                            // scripted package would flip from project-local
                            // on the cold install to global on the warm one).
                            // Over-excludes the rare "trusted but actually no
                            // scripts" case in exchange for not needing a
                            // lockfile-format change.
                            const dep_name, const dep_name_hash = if (dep_id != invalid_dependency_id)
                                .{ dependencies[dep_id].name.slice(string_buf), dependencies[dep_id].name_hash }
                            else
                                .{ pkg_names[pkg_id].slice(string_buf), pkg_name_hashes[pkg_id] };
                            if (lockfile.hasTrustedDependency(dep_name, &pkg_res) or
                                trusted_from_update.contains(@truncate(dep_name_hash)))
                            {
                                break :eligible false;
                            }
                            break :eligible true;
                        },
                        else => false,
                    };

                    if (!eligible) {
                        states[idx] = .ineligible;
                        entry_hashes[idx] = 0;
                        _ = stack.pop();
                        continue;
                    }

                    // Seed the hash with this entry's own store-path string so
                    // entries with identical dep sets but different package
                    // versions never collide. Hashed through a writer so an
                    // unusually long store path (long scope + git URL + peer
                    // hash) can't overflow a fixed buffer and feed
                    // uninitialized stack bytes into the hash.
                    top.hasher = .init(0x9E3779B97F4A7C15);
                    {
                        var hw: WyhashWriter = .{ .hasher = &top.hasher };
                        var w = hw.writer();
                        w.print("{f}", .{Store.Entry.fmtStorePath(id, &store, lockfile)}) catch unreachable;
                    }
                    // The store path for `.npm` is just `name@version`, which
                    // is *not* unique across registries (an enterprise proxy
                    // can serve a patched `foo@1.0.0`). Fold in the tarball
                    // integrity so a cross-registry / cross-tarball collision
                    // gets a different global directory instead of reusing the
                    // first project's bytes.
                    top.hasher.update(std.mem.asBytes(&pkg_metas[pkg_id].integrity));
                }

                if (states[idx] == .ineligible) {
                    _ = stack.pop();
                    continue;
                }

                const deps = entry_dependencies[idx].slice();
                var advanced = false;
                while (top.dep_idx < deps.len) : (top.dep_idx += 1) {
                    const dep = deps[top.dep_idx];
                    const dep_idx = dep.entry_id.get();
                    const dep_name_hash = dependencies[dep.dep_id].name_hash;
                    switch (states[dep_idx]) {
                        .done => {
                            top.hasher.update(std.mem.asBytes(&dep_name_hash));
                            top.hasher.update(std.mem.asBytes(&entry_hashes[dep_idx]));
                        },
                        .ineligible => {
                            // A dep that can't live in the global store poisons
                            // this entry too: its symlink would point at a
                            // project-local path.
                            states[idx] = .ineligible;
                            entry_hashes[idx] = 0;
                        },
                        .in_progress => {
                            // Cycle back-edge: the dep's hash isn't known yet.
                            // Fold a placeholder; the SCC pass below replaces
                            // every cycle member's hash with one that's
                            // independent of which edge happened to be the
                            // back-edge in this DFS.
                            top.hasher.update(std.mem.asBytes(&dep_name_hash));
                        },
                        .unvisited => {
                            try stack.append(manager.allocator, .{ .id = dep.entry_id, .dep_idx = 0, .hasher = undefined });
                            advanced = true;
                            // re-fetch `top` after potential realloc
                            break;
                        },
                    }
                    if (states[idx] == .ineligible) break;
                }

                if (advanced) continue;

                if (states[idx] != .ineligible) {
                    var h = top.hasher.final();
                    // 0 is the "not eligible" sentinel.
                    if (h == 0) h = 1;
                    entry_hashes[idx] = h;
                    states[idx] = .done;
                }
                _ = stack.pop();
            }
        }

        // SCC pass: the DFS hash above is visit-order-dependent for cycle
        // members (which edge becomes the back-edge depends on which member
        // the outer loop reached first, which depends on entry IDs, which
        // depend on the *whole project's* dependency set). That's harmless
        // for correctness — different orderings just give different keys —
        // but it means a package that's part of an npm cycle never shares a
        // global entry across projects, defeating the feature for chunks of
        // the ecosystem (`es-abstract`↔`object.assign`, the babel core
        // cycle, etc.).
        //
        // Tarjan's algorithm groups entries into strongly-connected
        // components. For singleton SCCs the pass-1 hash is already
        // visit-order-independent and is left alone. For multi-member SCCs
        // every member gets the same hash, computed from the sorted member
        // store-paths plus the sorted external-dep hashes — inputs that are
        // identical regardless of which member the project happened to list
        // first. The dep symlinks inside the SCC then point at siblings with
        // the same hash suffix, so they resolve in any project that produces
        // the same SCC closure.
        {
            const n: u32 = @intCast(store.entries.len);
            const tarjan_index = try manager.allocator.alloc(u32, n);
            defer manager.allocator.free(tarjan_index);
            @memset(tarjan_index, std.math.maxInt(u32));
            const lowlink = try manager.allocator.alloc(u32, n);
            defer manager.allocator.free(lowlink);
            const on_stack = try manager.allocator.alloc(bool, n);
            defer manager.allocator.free(on_stack);
            @memset(on_stack, false);

            var scc_stack: std.ArrayListUnmanaged(u32) = .empty;
            defer scc_stack.deinit(manager.allocator);
            var work: std.ArrayListUnmanaged(struct { v: u32, child: u32 }) = .empty;
            defer work.deinit(manager.allocator);
            var scc_ext: std.AutoArrayHashMapUnmanaged(u64, void) = .empty;
            defer scc_ext.deinit(manager.allocator);

            var index_counter: u32 = 0;
            for (0..n) |root| {
                if (tarjan_index[root] != std.math.maxInt(u32)) continue;
                try work.append(manager.allocator, .{ .v = @intCast(root), .child = 0 });
                while (work.items.len > 0) {
                    const frame = &work.items[work.items.len - 1];
                    const v = frame.v;
                    if (frame.child == 0) {
                        tarjan_index[v] = index_counter;
                        lowlink[v] = index_counter;
                        index_counter += 1;
                        try scc_stack.append(manager.allocator, v);
                        on_stack[v] = true;
                    }
                    const deps = entry_dependencies[v].slice();
                    var recursed = false;
                    while (frame.child < deps.len) : (frame.child += 1) {
                        const w = deps[frame.child].entry_id.get();
                        if (tarjan_index[w] == std.math.maxInt(u32)) {
                            frame.child += 1;
                            try work.append(manager.allocator, .{ .v = w, .child = 0 });
                            recursed = true;
                            break;
                        } else if (on_stack[w]) {
                            lowlink[v] = @min(lowlink[v], tarjan_index[w]);
                        }
                    }
                    if (recursed) continue;
                    if (lowlink[v] == tarjan_index[v]) {
                        const start = blk: {
                            var i = scc_stack.items.len;
                            while (i > 0) : (i -= 1) {
                                if (scc_stack.items[i - 1] == v) break :blk i - 1;
                            }
                            unreachable;
                        };
                        const members = scc_stack.items[start..];
                        for (members) |m| on_stack[m] = false;
                        if (members.len == 1) {
                            // Singleton SCC. Tarjan emits SCCs in reverse
                            // topological order, so every dep's hash is final
                            // by now (including any cycle-member deps that
                            // just got their SCC hash). Recompute this entry's
                            // hash from those final values so a dependent of
                            // a cycle picks up the order-independent SCC hash
                            // rather than the pass-1 placeholder.
                            const m = members[0];
                            if (entry_hashes[m] != 0) {
                                var sub: std.hash.Wyhash = .init(0x9E3779B97F4A7C15);
                                var hw: WyhashWriter = .{ .hasher = &sub };
                                var w_ = hw.writer();
                                w_.print("{f}", .{Store.Entry.fmtStorePath(.from(m), &store, lockfile)}) catch unreachable;
                                sub.update(std.mem.asBytes(&pkg_metas[node_pkg_ids[entry_node_ids[m].get()]].integrity));
                                var poisoned = false;
                                for (entry_dependencies[m].slice()) |dep| {
                                    const dh = entry_hashes[dep.entry_id.get()];
                                    if (dh == 0) {
                                        poisoned = true;
                                        break;
                                    }
                                    const dep_name_hash = dependencies[dep.dep_id].name_hash;
                                    sub.update(std.mem.asBytes(&dep_name_hash));
                                    sub.update(std.mem.asBytes(&dh));
                                }
                                if (poisoned) {
                                    entry_hashes[m] = 0;
                                } else {
                                    var h = sub.final();
                                    if (h == 0) h = 1;
                                    entry_hashes[m] = h;
                                }
                            }
                        } else if (members.len > 1) {
                            // One order-independent hash for the whole SCC:
                            // collect a sub-hash per member (store path +
                            // integrity), collect every external-dep hash,
                            // sort both lists, then hash the concatenation.
                            // Sorting by *content* (not entry index) is what
                            // makes this stable across projects.
                            scc_ext.clearRetainingCapacity();
                            var member_sub: std.ArrayListUnmanaged(u64) = .empty;
                            defer member_sub.deinit(manager.allocator);
                            var any_ineligible = false;
                            for (members) |m| {
                                if (entry_hashes[m] == 0) any_ineligible = true;
                                var sub: std.hash.Wyhash = .init(0);
                                var hw: WyhashWriter = .{ .hasher = &sub };
                                var w_ = hw.writer();
                                w_.print("{f}", .{Store.Entry.fmtStorePath(.from(m), &store, lockfile)}) catch unreachable;
                                sub.update(std.mem.asBytes(&pkg_metas[node_pkg_ids[entry_node_ids[m].get()]].integrity));
                                try member_sub.append(manager.allocator, sub.final());
                                for (entry_dependencies[m].slice()) |dep| {
                                    const di = dep.entry_id.get();
                                    // Skip intra-SCC edges; those are captured
                                    // by member_sub.
                                    if (std.mem.indexOfScalar(u32, members, di) != null) continue;
                                    if (entry_hashes[di] == 0) any_ineligible = true;
                                    // Dep symlinks inside the entry are named
                                    // by the dependency *alias*, so two SCCs
                                    // that reach the same external entry under
                                    // different aliases must hash differently.
                                    var ext: std.hash.Wyhash = .init(0);
                                    ext.update(std.mem.asBytes(&dependencies[dep.dep_id].name_hash));
                                    ext.update(std.mem.asBytes(&entry_hashes[di]));
                                    try scc_ext.put(manager.allocator, ext.final(), {});
                                }
                            }
                            std.mem.sort(u64, member_sub.items, {}, std.sort.asc(u64));
                            const ext_keys = scc_ext.keys();
                            std.mem.sort(u64, ext_keys, {}, std.sort.asc(u64));
                            var hasher: std.hash.Wyhash = .init(0x42A7C15F9E3779B9);
                            for (member_sub.items) |k| hasher.update(std.mem.asBytes(&k));
                            for (ext_keys) |k| hasher.update(std.mem.asBytes(&k));
                            var h = hasher.final();
                            if (h == 0) h = 1;
                            const final_h: u64 = if (any_ineligible) 0 else h;
                            for (members) |m| entry_hashes[m] = final_h;
                        }
                        scc_stack.items.len = start;
                    }
                    _ = work.pop();
                    if (work.items.len > 0) {
                        const parent = &work.items[work.items.len - 1];
                        lowlink[parent.v] = @min(lowlink[parent.v], lowlink[v]);
                    }
                }
            }
        }

        // Ineligibility can surface mid-cycle: A→B→A where B turns out to
        // depend on a workspace package. The DFS above already finalised A's
        // hash via the `.in_progress` back-edge before B was marked
        // ineligible, so A would wrongly land in the global store with a
        // dangling dep symlink. Close the gap with a fixed-point pass: any
        // entry that still links to an ineligible dep becomes ineligible too.
        var changed = true;
        while (changed) {
            changed = false;
            for (0..store.entries.len) |idx| {
                if (entry_hashes[idx] == 0) continue;
                for (entry_dependencies[idx].slice()) |dep| {
                    if (entry_hashes[dep.entry_id.get()] == 0) {
                        entry_hashes[idx] = 0;
                        changed = true;
                        break;
                    }
                }
            }
        }

        // <cache_dir>/links — created lazily by the first task that misses.
        // getCacheDirectory() populates `cache_directory_path` as a side-effect.
        _ = manager.getCacheDirectory();
        const cache_dir_path = manager.cache_directory_path;
        if (cache_dir_path.len == 0) break :global_store_path null;
        break :global_store_path try manager.allocator.dupeZ(
            u8,
            bun.path.joinAbsString(cache_dir_path, &.{"links"}, .auto),
        );
    } else null;
    defer if (global_store_path) |p| manager.allocator.free(p);

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
            .is_new_bun_modules = is_new_bun_modules,
            .global_store_path = global_store_path,
            .global_store_tmp_suffix = bun.fastRandom(),
        };
        defer installer.deinit();

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

                    const uses_global_store = installer.entryUsesGlobalStore(entry_id);

                    // An entry that lost global-store eligibility since the
                    // previous install (newly patched, newly trusted, a dep
                    // that became a workspace package) still has a stale
                    // `node_modules/.bun/<storepath>` symlink/junction into
                    // `<cache>/links/`. The existence check below would pass
                    // *through* it and skip the task, leaving the project to
                    // run against the shared entry (and, if the task did run,
                    // write the new project-local tree through the link into
                    // the shared cache). Treat the stale link as
                    // needs-install so `link_package` detaches and rebuilds.
                    const has_stale_gvs_link = !uses_global_store and stale: {
                        if (installer.global_store_path == null) break :stale false;
                        var local: bun.Path(.{ .sep = .auto }) = .initTopLevelDir();
                        defer local.deinit();
                        installer.appendLocalStoreEntryPath(&local, entry_id);
                        if (comptime bun.Environment.isWindows) {
                            break :stale if (sys.getFileAttributes(local.sliceZ())) |a| a.is_reparse_point else false;
                        }
                        break :stale if (sys.lstat(local.sliceZ()).asValue()) |st|
                            std.posix.S.ISLNK(@intCast(st.mode))
                        else
                            false;
                    };

                    const needs_install =
                        manager.options.enable.force_install or
                        // A freshly-created `node_modules/.bun` only implies the
                        // *project-local* entries are missing; global virtual-
                        // store entries persist across `rm -rf node_modules` and
                        // should still take the cheap symlink-only path.
                        (is_new_bun_modules and !uses_global_store) or
                        has_stale_gvs_link or
                        patch_info == .remove or
                        needs_install: {
                            var store_path: bun.AbsPath(.{}) = .initTopLevelDir();
                            defer store_path.deinit();
                            if (uses_global_store) {
                                // Global entries are built under a per-process
                                // staging path and renamed into place as the
                                // final step, so the directory existing at its
                                // final path is the completeness signal.
                                installer.appendGlobalStoreEntryPath(&store_path, entry_id, .final);
                                break :needs_install !(sys.directoryExistsAt(FD.cwd(), store_path.sliceZ()).asValue() orelse false);
                            }
                            installer.appendRealStorePath(&store_path, entry_id, .final);
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
                        if (uses_global_store) {
                            // Warm hit: the global virtual store already holds
                            // this entry's files, dep symlinks, and bin links.
                            // The only per-install work is the project-level
                            // `node_modules/.bun/<storepath>` → global symlink.
                            switch (installer.linkProjectToGlobalStore(entry_id)) {
                                .result => {},
                                .err => |err| {
                                    entry_steps[entry_id.get()].store(.done, .monotonic);
                                    installer.onTaskFail(entry_id, .{ .symlink_dependencies = err });
                                    continue;
                                },
                            }
                        }
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
                                pkg_id,
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
                        .onPackageDownloadError = Store.Installer.onPackageDownloadError,
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
const DependencyID = install.DependencyID;
const PackageID = install.PackageID;
const PackageInstall = install.PackageInstall;
const PackageNameHash = install.PackageNameHash;
const Resolution = install.Resolution;
const Store = install.Store;
const invalid_dependency_id = install.invalid_dependency_id;
const invalid_package_id = install.invalid_package_id;

const Lockfile = install.Lockfile;
const Tree = Lockfile.Tree;

const PackageManager = install.PackageManager;
const ProgressStrings = PackageManager.ProgressStrings;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
