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

        var node_queue: bun.LinearFifo(QueuedNode, .Dynamic) = .init(lockfile.allocator);
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
        var early_dedupe: std.AutoHashMap(PackageID, Store.Node.Id) = .init(lockfile.allocator);
        defer early_dedupe.deinit();

        var peer_dep_ids: std.array_list.Managed(DependencyID) = .init(lockfile.allocator);
        defer peer_dep_ids.deinit();

        var visited_parent_node_ids: std.array_list.Managed(Store.Node.Id) = .init(lockfile.allocator);
        defer visited_parent_node_ids.deinit();

        // First pass: create full dependency tree with resolved peers
        next_node: while (node_queue.readItem()) |entry| {
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
                if (pkg_deps.len == 0 or entry_dep.version.tag == .workspace) dont_dedupe: {
                    const dedupe_entry = try early_dedupe.getOrPut(entry.pkg_id);
                    if (dedupe_entry.found_existing) {
                        const dedupe_node_id = dedupe_entry.value_ptr.*;

                        const nodes_slice = nodes.slice();
                        const node_nodes = nodes_slice.items(.nodes);
                        const node_dep_ids = nodes_slice.items(.dep_id);

                        const dedupe_dep_id = node_dep_ids[dedupe_node_id.get()];
                        if (dedupe_dep_id == invalid_dependency_id) {
                            break :dont_dedupe;
                        }
                        const dedupe_dep = dependencies[dedupe_dep_id];

                        if (dedupe_dep.name_hash != entry_dep.name_hash) {
                            break :dont_dedupe;
                        }

                        if (dedupe_dep.version.tag == .workspace and entry_dep.version.tag == .workspace) {
                            if (dedupe_dep.behavior.isWorkspace() != entry_dep.behavior.isWorkspace()) {
                                // only attach the dependencies to one of the workspaces
                                skip_dependencies = true;
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
                                    try node_queue.writeItem(.{
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
                        try node_queue.writeItem(.{
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
            Output.prettyErrorln("Resolved peers [{f}]", .{bun.fmt.fmtDurationOneDecimal(full_tree_end)});
        }

        const DedupeInfo = struct {
            entry_id: Store.Entry.Id,
            dep_id: DependencyID,
            peers: Store.OrderedArraySet(Store.Node.TransitivePeer, Store.Node.TransitivePeer.OrderedArraySetCtx),
        };

        var dedupe: std.AutoHashMapUnmanaged(PackageID, std.ArrayListUnmanaged(DedupeInfo)) = .empty;
        defer dedupe.deinit(lockfile.allocator);

        var res_fmt_buf: std.array_list.Managed(u8) = .init(lockfile.allocator);
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
                    const pkg_res = pkg_resolutions[peer_ids.pkg_id];
                    res_fmt_buf.clearRetainingCapacity();
                    try res_fmt_buf.writer().print("{f}", .{pkg_res.fmt(string_buf, .posix)});
                    hasher.update(res_fmt_buf.items);
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
        };

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

                    const needs_install =
                        manager.options.enable.force_install or
                        is_new_bun_modules or
                        patch_info == .remove or
                        needs_install: {
                            var store_path: bun.AbsPath(.{}) = .initTopLevelDir();
                            defer store_path.deinit();
                            installer.appendStorePath(&store_path, entry_id);
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
                        .onPackageDownloadError = {},
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
const Resolution = install.Resolution;
const Store = install.Store;
const invalid_dependency_id = install.invalid_dependency_id;
const invalid_package_id = install.invalid_package_id;

const Lockfile = install.Lockfile;
const Tree = Lockfile.Tree;

const PackageManager = install.PackageManager;
const ProgressStrings = PackageManager.ProgressStrings;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
