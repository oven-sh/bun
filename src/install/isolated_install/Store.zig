const Ids = struct {
    dep_id: DependencyID,
    pkg_id: PackageID,
};

pub const Store = struct {
    /// Accessed from multiple threads
    entries: Entry.List = .empty,
    nodes: Node.List = .empty,

    const log = Output.scoped(.Store, false);

    pub const modules_dir_name = ".bun";

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

    pub const Installer = @import("./Installer.zig").Installer;

    pub fn create(
        manager: *PackageManager,
        install_root_dependencies: bool,
        workspace_filters: []const WorkspaceFilter,
    ) OOM!Store {
        var timer = std.time.Timer.start() catch unreachable;

        const NextNode = struct {
            parent_id: Node.Id,
            dep_id: DependencyID,
            pkg_id: PackageID,
        };

        var next_node_stack: std.ArrayList(NextNode) = .init(manager.allocator);
        defer next_node_stack.deinit();

        try next_node_stack.append(.{
            .parent_id = .invalid,
            .dep_id = invalid_dependency_id,
            .pkg_id = 0,
        });

        // struct holding up-to-date pointers to multi array list fields
        // and some code moved into functions for reuse
        const BuilderCtx = struct {
            store: Store,
            allocator: std.mem.Allocator,

            // lockfile buffers
            string_buf: []const u8,
            dependencies: []const Dependency,
            resolutions: []const PackageID,
            pkg_names: []const String,
            pkg_resolutions: []const Resolution,
            pkg_name_hashes: []const PackageNameHash,
            pkg_dependency_slices: []const DependencySlice,

            node_dep_ids: []DependencyID,
            node_pkg_ids: []PackageID,
            node_parent_ids: []Node.Id,
            node_dependencies: []std.ArrayListUnmanaged(Ids),
            node_peers: []Node.Peers,
            node_nodes: []std.ArrayListUnmanaged(Node.Id),

            node_dedupe: std.AutoArrayHashMap(PackageID, Node.Id),

            entry_dependencies: []Entry.Dependencies,
            entry_parents: []std.ArrayListUnmanaged(Entry.Id),

            pub fn init(allocator: std.mem.Allocator, lockfile: *const Lockfile) OOM!@This() {
                const pkgs = lockfile.packages.slice();
                var ctx: @This() = .{
                    .store = .{},
                    .allocator = allocator,
                    .string_buf = lockfile.buffers.string_bytes.items,
                    .dependencies = lockfile.buffers.dependencies.items,
                    .resolutions = lockfile.buffers.resolutions.items,
                    .pkg_names = pkgs.items(.name),
                    .pkg_resolutions = pkgs.items(.resolution),
                    .pkg_name_hashes = pkgs.items(.name_hash),
                    .pkg_dependency_slices = pkgs.items(.dependencies),
                    .node_dep_ids = &.{},
                    .node_pkg_ids = &.{},
                    .node_parent_ids = &.{},
                    .node_dependencies = &.{},
                    .node_peers = &.{},
                    .node_nodes = &.{},
                    .node_dedupe = .init(allocator),
                    .entry_dependencies = &.{},
                    .entry_parents = &.{},
                };

                // Both of these will be similar in size to packages.len. Peer dependencies will make them slightly larger.
                try ctx.store.nodes.ensureUnusedCapacity(ctx.allocator, ctx.pkg_names.len);
                try ctx.store.entries.ensureUnusedCapacity(ctx.allocator, ctx.pkg_names.len);

                return ctx;
            }

            pub fn deinit(this: *@This()) void {
                this.node_dedupe.deinit();
            }

            const NodeParentIterator = struct {
                next_id: Node.Id,
                node_parent_ids: []const Node.Id,

                pub fn next(this: *@This()) ?Node.Id {
                    if (this.next_id == .invalid) {
                        return null;
                    }
                    const curr_id = this.next_id;
                    this.next_id = this.node_parent_ids[curr_id.get()];
                    return curr_id;
                }
            };

            pub fn iterateNodeParents(this: *const @This(), first_parent_id: Node.Id) NodeParentIterator {
                return .{ .next_id = first_parent_id, .node_parent_ids = this.node_parent_ids };
            }

            const AppendNodeResult = union(enum) {
                new_node: Node.Id,
                deduplicated,
            };

            pub fn appendNode(this: *@This(), next_node: NextNode) OOM!AppendNodeResult {
                if (this.node_dedupe.get(next_node.pkg_id)) |dedupe_node_id| create_new_node: {
                    const node_dep = this.dependencies[next_node.dep_id];

                    const dedupe_dep_id = this.node_dep_ids[dedupe_node_id.get()];
                    const dedupe_dep = this.dependencies[dedupe_dep_id];

                    if (dedupe_dep.name_hash != node_dep.name_hash) {
                        // create a new node if it's an alias so we don't lose the alias name
                        break :create_new_node;
                    }

                    try this.addNodeToParentNodes(next_node.parent_id, dedupe_node_id);
                    return .deduplicated;
                }

                const pkg_deps = this.pkg_dependency_slices[next_node.pkg_id];

                const node_id: Node.Id = .from(@intCast(this.store.nodes.len));
                try this.store.nodes.append(this.allocator, .{
                    .pkg_id = next_node.pkg_id,
                    .dep_id = next_node.dep_id,
                    .parent_id = next_node.parent_id,
                    // capacity is set to the expected size after we
                    // find the exact dependency count
                    .nodes = .empty,
                    .dependencies = try .initCapacity(this.allocator, pkg_deps.len),
                });

                // update pointers
                const nodes = this.store.nodes.slice();
                this.node_dep_ids = nodes.items(.dep_id);
                this.node_pkg_ids = nodes.items(.pkg_id);
                this.node_parent_ids = nodes.items(.parent_id);
                this.node_dependencies = nodes.items(.dependencies);
                this.node_peers = nodes.items(.peers);
                this.node_nodes = nodes.items(.nodes);

                return .{ .new_node = node_id };
            }

            pub fn addNodeToParentNodes(this: *@This(), parent_id: Node.Id, node_id: Node.Id) OOM!void {
                this.node_nodes[parent_id.get()].appendAssumeCapacity(node_id);

                if (this.node_nodes[parent_id.get()].items.len == this.node_dependencies[parent_id.get()].items.len) {
                    // we've visited all the children nodes of the parent, see if we can add to the dedupe map.
                    try this.maybeAddNodeToDedupeMap(parent_id);
                }
            }

            pub fn maybeAddNodeToDedupeMap(this: *@This(), node_id: Node.Id) OOM!void {
                if (this.node_peers[node_id.get()].list.items.len != 0) {
                    // only nodes without peers (transitive or direct) are added to the map.
                    return;
                }

                const dep_id = this.node_dep_ids[node_id.get()];
                if (dep_id == invalid_dependency_id) {
                    // no need to add the root package
                    return;
                }

                const dep = this.dependencies[dep_id];
                const pkg_id = this.node_pkg_ids[node_id.get()];

                if (dep.name_hash != this.pkg_name_hashes[pkg_id]) {
                    // don't add to the dedupe map if the dependency name does not match
                    // the package name. this means it's an alias, and won't be as common
                    // as a normal dependency on this package.
                    return;
                }

                const dedupe = try this.node_dedupe.getOrPut(pkg_id);
                if (comptime Environment.ci_assert) {
                    bun.assertWithLocation(!dedupe.found_existing, @src());
                }

                dedupe.value_ptr.* = node_id;
            }

            pub fn appendEntry(this: *@This(), entry: Entry) OOM!Entry.Id {
                const entry_id: Entry.Id = .from(@intCast(this.store.entries.len));
                try this.store.entries.append(this.allocator, entry);

                // update pointers
                const entries = this.store.entries.slice();
                this.entry_dependencies = entries.items(.dependencies);
                this.entry_parents = entries.items(.parents);

                return entry_id;
            }
        };

        var ctx: BuilderCtx = try .init(manager.allocator, manager.lockfile);
        defer ctx.deinit();

        var dep_ids_sort_buf: std.ArrayList(DependencyID) = .init(ctx.allocator);
        defer dep_ids_sort_buf.deinit();

        var peer_dep_ids_buf: std.ArrayList(DependencyID) = .init(ctx.allocator);
        defer peer_dep_ids_buf.deinit();

        var visited_node_ids_buf: std.ArrayList(Node.Id) = .init(ctx.allocator);
        defer visited_node_ids_buf.deinit();

        // First pass: create full dependency tree with resolved peers
        next_node: while (next_node_stack.pop()) |next_node| {
            {
                // check for cycles
                var parent_iter = ctx.iterateNodeParents(next_node.parent_id);
                while (parent_iter.next()) |parent_id| {
                    if (ctx.node_pkg_ids[parent_id.get()] == next_node.pkg_id) {
                        // skip the new node, and add the previously added node to parent so it appears in
                        // 'node_modules/.bun/parent@version/node_modules'.

                        const dep_id = ctx.node_dep_ids[parent_id.get()];
                        if (dep_id == invalid_dependency_id or next_node.dep_id == invalid_dependency_id) {
                            try ctx.addNodeToParentNodes(next_node.parent_id, parent_id);
                            continue :next_node;
                        }

                        // ensure the dependency name is the same before skipping the cycle. if they aren't
                        // we lose dependency name information for the symlinks
                        if (ctx.dependencies[dep_id].name_hash == ctx.dependencies[next_node.dep_id].name_hash) {
                            try ctx.addNodeToParentNodes(next_node.parent_id, parent_id);
                            continue :next_node;
                        }
                    }
                }
            }

            const node_id = switch (try ctx.appendNode(next_node)) {
                .new_node => |id| id,
                .deduplicated => continue,
            };

            const pkg_deps = ctx.pkg_dependency_slices[next_node.pkg_id];
            dep_ids_sort_buf.clearRetainingCapacity();
            try dep_ids_sort_buf.ensureUnusedCapacity(pkg_deps.len);
            for (pkg_deps.begin()..pkg_deps.end()) |_dep_id| {
                const dep_id: DependencyID = @intCast(_dep_id);
                dep_ids_sort_buf.appendAssumeCapacity(dep_id);
            }

            // TODO: make this sort in an order that allows peers to be resolved last
            // and devDependency handling to match `hoistDependency`
            std.sort.pdq(
                DependencyID,
                dep_ids_sort_buf.items,
                Lockfile.DepSorter{ .lockfile = manager.lockfile },
                Lockfile.DepSorter.isLessThan,
            );

            peer_dep_ids_buf.clearRetainingCapacity();
            for (dep_ids_sort_buf.items) |dep_id| {
                if (Tree.isFilteredDependencyOrWorkspace(
                    dep_id,
                    next_node.pkg_id,
                    workspace_filters,
                    install_root_dependencies,
                    manager,
                    manager.lockfile,
                )) {
                    continue;
                }

                const pkg_id = ctx.resolutions[dep_id];
                const dep = ctx.dependencies[dep_id];

                // TODO: handle duplicate dependencies. should be similar logic
                // like we have for dev dependencies in `hoistDependency`

                if (dep.behavior.isPeer()) {
                    try peer_dep_ids_buf.append(dep_id);
                    continue;
                }

                // simple case:
                // - add it as a dependency
                // - queue it
                ctx.node_dependencies[node_id.get()].appendAssumeCapacity(.{ .dep_id = dep_id, .pkg_id = pkg_id });
                try next_node_stack.append(.{
                    .parent_id = node_id,
                    .dep_id = dep_id,
                    .pkg_id = pkg_id,
                });
            }

            for (peer_dep_ids_buf.items) |peer_dep_id| {
                const resolved_pkg_id = resolved_pkg_id: {

                    // Go through the peers parents looking for a package with the same name.
                    // If none is found, use current best version. Parents visited must have
                    // the package id for the chosen peer marked as a transitive peer. Nodes
                    // are deduplicated only if their package id and their transitive peer package
                    // ids are equal.
                    const peer_dep = ctx.dependencies[peer_dep_id];

                    // Start with the parent of the new node. A package
                    // cannot resolve it's own peer.
                    // var curr_id = ctx.node_parent_ids[node_id.get()];
                    var parent_iter = ctx.iterateNodeParents(ctx.node_parent_ids[node_id.get()]);

                    visited_node_ids_buf.clearRetainingCapacity();
                    try visited_node_ids_buf.append(node_id);

                    while (parent_iter.next()) |parent_id| {
                        for (ctx.node_dependencies[parent_id.get()].items) |ids| {
                            const dep = ctx.dependencies[ids.dep_id];

                            if (dep.name_hash != peer_dep.name_hash) {
                                continue;
                            }

                            const res = ctx.pkg_resolutions[ids.pkg_id];

                            if (peer_dep.version.tag != .npm or res.tag != .npm) {
                                // TODO: print warning for this? we don't have a version
                                // to compare to say if this satisfies or not.
                                break :resolved_pkg_id ids.pkg_id;
                            }

                            const peer_dep_version = peer_dep.version.value.npm.version;
                            const res_version = res.value.npm.version;

                            if (!peer_dep_version.satisfies(res_version, ctx.string_buf, ctx.string_buf)) {
                                // TODO: add warning!
                            }

                            break :resolved_pkg_id ids.pkg_id;
                        }

                        const curr_peers = ctx.node_peers[parent_id.get()];
                        for (curr_peers.list.items) |ids| {
                            const transitive_peer_dep = ctx.dependencies[ids.dep_id];

                            if (transitive_peer_dep.name_hash != peer_dep.name_hash) {
                                continue;
                            }

                            // A transitive peer with the same name has already passed
                            // through this node

                            break :resolved_pkg_id ids.pkg_id;
                        }

                        // TODO: prevent marking workspace and symlink deps with transitive peers

                        // add to visited parents after searching for a peer resolution.
                        // if a node resolves a transitive peer, it can still be deduplicated
                        try visited_node_ids_buf.append(parent_id);
                    }

                    if (peer_dep.behavior.isOptionalPeer()) {
                        // exclude it
                        continue;
                    }

                    // set the length to 1 so we only add this peer to the current node
                    visited_node_ids_buf.items.len = 1;

                    // choose the current best version
                    break :resolved_pkg_id ctx.resolutions[peer_dep_id];
                };

                if (comptime Environment.ci_assert) {
                    bun.assertWithLocation(resolved_pkg_id != invalid_package_id, @src());
                }

                for (visited_node_ids_buf.items) |visited_id| {
                    const insert_ctx: Node.TransitivePeer.OrderedArraySetCtx = .{
                        .string_buf = ctx.string_buf,
                        .pkg_names = ctx.pkg_names,
                    };
                    const peer: Node.TransitivePeer = .{
                        .dep_id = peer_dep_id,
                        .pkg_id = resolved_pkg_id,
                    };
                    try ctx.node_peers[visited_id.get()].insert(ctx.allocator, peer, &insert_ctx);
                }

                ctx.node_dependencies[node_id.get()].appendAssumeCapacity(.{ .dep_id = peer_dep_id, .pkg_id = resolved_pkg_id });
                try next_node_stack.append(.{
                    .parent_id = node_id,
                    .dep_id = peer_dep_id,
                    .pkg_id = resolved_pkg_id,
                });
            }

            const node_dependencies_count = ctx.node_dependencies[node_id.get()].items.len;

            try ctx.node_nodes[node_id.get()].ensureTotalCapacityPrecise(ctx.allocator, node_dependencies_count);

            if (node_dependencies_count == 0) {
                // it's a leaf. we can try adding it to the dedupe map now
                try ctx.maybeAddNodeToDedupeMap(node_id);
            }

            if (next_node.parent_id != .invalid) {
                try ctx.addNodeToParentNodes(next_node.parent_id, node_id);
            }
        }

        if (manager.options.log_level.isVerbose()) {
            const full_tree_end = timer.read();
            timer.reset();
            Output.prettyErrorln("Resolved peers: {d} nodes [{}]", .{
                ctx.store.nodes.len,
                bun.fmt.fmtDurationOneDecimal(full_tree_end),
            });
        }

        const EntryDedupe = struct {
            entry_id: Entry.Id,
            dep_id: DependencyID,
            peers: OrderedArraySet(Node.TransitivePeer, Node.TransitivePeer.OrderedArraySetCtx),
        };

        var entry_dedupe: std.AutoArrayHashMap(PackageID, std.ArrayList(EntryDedupe)) = .init(ctx.allocator);
        defer entry_dedupe.deinit();

        var res_fmt_buf: std.ArrayList(u8) = .init(ctx.allocator);
        defer res_fmt_buf.deinit();

        const NextEntry = struct {
            node_id: Node.Id,
            parent_id: Entry.Id,
        };

        var next_entry_queue: std.fifo.LinearFifo(NextEntry, .Dynamic) = .init(ctx.allocator);
        defer next_entry_queue.deinit();

        try next_entry_queue.writeItem(.{
            .node_id = .from(0),
            .parent_id = .invalid,
        });

        // Second pass: Deduplicate nodes when the pkg_id and peer set match an existing entry.
        next_entry: while (next_entry_queue.readItem()) |next_entry| {
            const pkg_id = ctx.node_pkg_ids[next_entry.node_id.get()];
            const dep_id = ctx.node_dep_ids[next_entry.node_id.get()];

            const dedupe = try entry_dedupe.getOrPut(pkg_id);
            if (!dedupe.found_existing) {
                dedupe.value_ptr.* = .init(ctx.allocator);
            } else {
                const peers = ctx.node_peers[next_entry.node_id.get()];

                for (dedupe.value_ptr.items) |info| {
                    // if (info.dep_id != invalid_dependency_id and dep_id != invalid_dependency_id) {
                    //     const curr_dep = dependencies[dep_id];
                    //     const existing_dep = dependencies[info.dep_id];

                    //     if (existing_dep.version.tag == .workspace and curr_dep.version.tag == .workspace) {
                    //         if (existing_dep.behavior.isWorkspace() != curr_dep.behavior.isWorkspace()) {
                    //             continue;
                    //         }
                    //     }
                    // }

                    const eql_ctx: Node.TransitivePeer.OrderedArraySetCtx = .{
                        .string_buf = ctx.string_buf,
                        .pkg_names = ctx.pkg_names,
                    };

                    if (info.peers.eql(&peers, &eql_ctx)) {
                        // dedupe! depend on the already created entry

                        var parents = &ctx.entry_parents[info.entry_id.get()];

                        // if (dep_id != invalid_dependency_id and dependencies[dep_id].behavior.isWorkspace()) {
                        //     try parents.append(lockfile.allocator, next_entry.parent_id);
                        //     continue :next_entry;
                        // }
                        const insert_ctx: Entry.DependenciesOrderedArraySetCtx = .{
                            .string_buf = ctx.string_buf,
                            .dependencies = ctx.dependencies,
                        };
                        try ctx.entry_dependencies[next_entry.parent_id.get()].insert(
                            ctx.allocator,
                            .{ .entry_id = info.entry_id, .dep_id = dep_id },
                            &insert_ctx,
                        );
                        try parents.append(ctx.allocator, next_entry.parent_id);
                        continue :next_entry;
                    }
                }

                // nothing matched - create a new entry
            }

            const entry_id = try ctx.appendEntry(.{
                .node_id = next_entry.node_id,
                .dependencies = dependencies: {
                    if (dedupe.found_existing and dep_id != invalid_dependency_id and ctx.dependencies[dep_id].version.tag == .workspace) {
                        break :dependencies .empty;
                    }

                    break :dependencies try .initCapacity(ctx.allocator, ctx.node_nodes[next_entry.node_id.get()].items.len);
                },
                .parents = parents: {
                    var parents: std.ArrayListUnmanaged(Entry.Id) = try .initCapacity(ctx.allocator, 1);
                    parents.appendAssumeCapacity(next_entry.parent_id);
                    break :parents parents;
                },
                .peer_hash = peer_hash: {
                    const peers = ctx.node_peers[next_entry.node_id.get()];
                    if (peers.len() == 0) {
                        break :peer_hash .none;
                    }
                    var hasher = bun.Wyhash11.init(0);
                    for (peers.slice()) |peer_ids| {
                        const pkg_name = ctx.pkg_names[peer_ids.pkg_id];
                        hasher.update(pkg_name.slice(ctx.string_buf));
                        const pkg_res = ctx.pkg_resolutions[peer_ids.pkg_id];
                        res_fmt_buf.clearRetainingCapacity();
                        try res_fmt_buf.writer().print("{}", .{pkg_res.fmt(ctx.string_buf, .posix)});
                        hasher.update(res_fmt_buf.items);
                    }
                    break :peer_hash .from(hasher.final());
                },
            });

            if (next_entry.parent_id != .invalid) skip_adding_dependency: {
                if (dep_id != invalid_dependency_id and ctx.dependencies[dep_id].behavior.isWorkspace()) {
                    // skip implicit workspace dependencies on the root.
                    break :skip_adding_dependency;
                }

                const insert_ctx: Entry.DependenciesOrderedArraySetCtx = .{
                    .string_buf = ctx.string_buf,
                    .dependencies = ctx.dependencies,
                };
                try ctx.entry_dependencies[next_entry.parent_id.get()].insert(
                    ctx.allocator,
                    .{ .entry_id = entry_id, .dep_id = dep_id },
                    &insert_ctx,
                );
            }

            try dedupe.value_ptr.append(.{
                .entry_id = entry_id,
                .dep_id = dep_id,
                .peers = ctx.node_peers[next_entry.node_id.get()],
            });

            for (ctx.node_nodes[next_entry.node_id.get()].items) |node_id| {
                try next_entry_queue.writeItem(.{
                    .node_id = node_id,
                    .parent_id = entry_id,
                });
            }
        }

        if (manager.options.log_level.isVerbose()) {
            const dedupe_end = timer.read();
            Output.prettyErrorln("Created store: {d} entries [{}]", .{
                ctx.store.entries.len,
                bun.fmt.fmtDurationOneDecimal(dedupe_end),
            });
        }

        return ctx.store;
    }

    /// Called from multiple threads. `parent_dedupe` should not be shared between threads.
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
                            pkg_res.fmtStorePath(string_buf),
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

        pub const DependenciesOrderedArraySetCtx = struct {
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

            for (0..list.len) |entry_id| {
                const entry = list.get(entry_id);
                const entry_pkg_name = pkg_names[entry.pkg_id].slice(string_buf);
                log(
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

                log("  dependencies ({d}):\n", .{entry.dependencies.items.len});
                for (entry.dependencies.items) |dep_entry_id| {
                    const dep_entry = list.get(dep_entry_id.get());
                    log("    {s}@{}\n", .{
                        pkg_names[dep_entry.pkg_id].slice(string_buf),
                        pkg_resolutions[dep_entry.pkg_id].fmt(string_buf, .posix),
                    });
                }
            }
        }
    };

    pub fn OrderedArraySet(comptime T: type, comptime Ctx: type) type {
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

                    if (order == .eq) {
                        return;
                    }

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

                    if (order == .eq) {
                        return;
                    }

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

        pub const TransitivePeer = struct {
            dep_id: DependencyID,
            pkg_id: PackageID,

            pub const OrderedArraySetCtx = struct {
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

            log(
                \\node({d})
                \\  deps: {s}@{s}
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

            for (0..list.len) |node_id| {
                const node = list.get(node_id);
                const node_pkg_name = pkg_names[node.pkg_id].slice(string_buf);
                log(
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

                log("  dependencies ({d}):\n", .{node.dependencies.items.len});
                for (node.dependencies.items) |ids| {
                    const dep = dependencies[ids.dep_id];
                    const dep_name = dep.name.slice(string_buf);

                    const pkg_name = pkg_names[ids.pkg_id].slice(string_buf);
                    const pkg_res = pkg_resolutions[ids.pkg_id];

                    log("    {s}@{} ({s}@{s})\n", .{
                        pkg_name,
                        pkg_res.fmt(string_buf, .posix),
                        dep_name,
                        dep.version.literal.slice(string_buf),
                    });
                }

                log("  nodes ({d}): ", .{node.nodes.items.len});
                for (node.nodes.items, 0..) |id, i| {
                    log("{d}", .{id.get()});
                    if (i != node.nodes.items.len - 1) {
                        log(",", .{});
                    }
                }

                log("\n  peers ({d}):\n", .{node.peers.list.items.len});
                for (node.peers.list.items) |ids| {
                    const dep = dependencies[ids.dep_id];
                    const dep_name = dep.name.slice(string_buf);
                    const pkg_name = pkg_names[ids.pkg_id].slice(string_buf);
                    const pkg_res = pkg_resolutions[ids.pkg_id];

                    log("    {s}@{} ({s}@{s})\n", .{
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

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const OOM = bun.OOM;
const Output = bun.Output;
const Environment = bun.Environment;

const Semver = bun.Semver;
const String = Semver.String;

const install = bun.install;
const Dependency = install.Dependency;
const DependencyID = install.DependencyID;
const PackageID = install.PackageID;
const invalid_package_id = install.invalid_package_id;
const invalid_dependency_id = install.invalid_dependency_id;

const Lockfile = install.Lockfile;
const Package = Lockfile.Package;
const PackageManager = install.PackageManager;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
const Tree = Lockfile.Tree;
const DependencySlice = Lockfile.DependencySlice;
const PackageNameHash = install.PackageNameHash;
const Resolution = install.Resolution;
const PackageIDList = Lockfile.PackageIDList;
