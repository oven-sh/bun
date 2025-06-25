const std = @import("std");
const bun = @import("bun");
const install = bun.install;
const Lockfile = install.Lockfile;
const PackageManager = install.PackageManager;
const DependencyID = install.DependencyID;
const PackageID = install.PackageID;
const Dependency = install.Dependency;
const PackageInstall = install.PackageInstall;
const sys = bun.sys;
const FD = bun.FD;
const Output = bun.Output;
const Global = bun.Global;
const Resolution = install.Resolution;
const OOM = bun.OOM;
const Semver = bun.Semver;
const String = Semver.String;
const invalid_package_id = install.invalid_package_id;
const invalid_dependency_id = install.invalid_dependency_id;
const FileSystem = bun.fs.FileSystem;
const string = bun.string;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
const Tree = Lockfile.Tree;
const strings = bun.strings;
const Environment = bun.Environment;
const ThreadPool = bun.ThreadPool;
const PackageNameHash = install.PackageNameHash;

// const IsolatedInstaller = struct {
//     manager: *PackageManager,
//     lockfile: *Lockfile,

//     root_node_modules_dir: FD,
//     is_new_root_node_modules_dir: bool,
//     bun_modules_dir: FD,
//     is_new_bun_modules_dir: bool,

//     // workspace_dir: FD,
//     // workspace_node_modules_dir: FD,
//     // is_new_workspace_node_modules: bool,

//     cwd_path: bun.AbsPath(.{}),
//     bun_modules_path: bun.AbsPath(.{}),

//     pub fn deinit(this: *IsolatedInstaller) void {
//         this.cwd_path.deinit();
//         this.bun_modules_path.deinit();
//     }
// };

const modules_dir_name = ".bun";

pub fn installIsolatedPackages(manager: *PackageManager, install_root_dependencies: bool, workspace_filters: []const WorkspaceFilter) OOM!PackageInstall.Summary {
    var total_time = std.time.Timer.start() catch unreachable;
    bun.Analytics.Features.isolated_bun_install += 1;

    var summary: PackageInstall.Summary = .{};

    const lockfile = manager.lockfile;

    const store = store: {
        var timer = std.time.Timer.start() catch unreachable;
        const pkgs = lockfile.packages.slice();
        const pkg_dependency_slices = pkgs.items(.dependencies);
        const pkg_resolutions = pkgs.items(.resolution);
        const pkg_names = pkgs.items(.name);

        const resolutions = lockfile.buffers.resolutions.items;
        const dependencies = lockfile.buffers.dependencies.items;
        const string_buf = lockfile.buffers.string_bytes.items;

        var filter_path_buf: bun.AbsPath(.{ .normalize_slashes = true }) = .initTopLevelDir();
        defer filter_path_buf.deinit();

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
                    &filter_path_buf,
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

        const full_tree_end = timer.read();

        // Store.Node.debugPrintList(&nodes, lockfile);

        timer.reset();

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
        const node_peers = nodes_slice.items(.peers);
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

                const eql_ctx: Store.Node.TransitivePeer.OrderedArraySetCtx = .{
                    .string_buf = string_buf,
                    .pkg_names = pkg_names,
                };

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

                    if (info.peers.eql(&curr_peers, &eql_ctx)) {
                        // dedupe! depend on the already created entry
                        if (curr_dep_id != invalid_dependency_id and dependencies[curr_dep_id].behavior.isWorkspaceOnly()) {
                            continue :next_entry;
                        }
                        const entries = store.slice();
                        const entry_dependencies = entries.items(.dependencies);
                        const ctx: Store.Entry.DependenciesOrderedArraySetCtx = .{
                            .string_buf = string_buf,
                            .dependencies = dependencies,
                        };
                        entry_dependencies[entry.entry_parent_id.get()].insertAssumeCapacity(
                            .{ .entry_id = info.entry_id, .dep_id = curr_dep_id },
                            &ctx,
                        );
                        continue :next_entry;
                    }
                }

                // nothing matched - create a new entry
            }

            const new_entry_dep_id = node_dep_ids[entry.node_id.get()];

            const new_entry_is_root = new_entry_dep_id == invalid_dependency_id;
            const new_entry_is_workspace = !new_entry_is_root and dependencies[new_entry_dep_id].isWorkspaceDep();

            const new_entry_dependencies: Store.Entry.Dependencies = if (dedupe_entry.found_existing and new_entry_is_workspace)
                .empty
            else
                try .initCapacity(lockfile.allocator, node_nodes[entry.node_id.get()].items.len);

            const new_entry: Store.Entry = .{
                .node_id = entry.node_id,
                .parent_id = entry.entry_parent_id,
                .dependencies = new_entry_dependencies,
            };

            const entry_id: Store.Entry.Id = .from(@intCast(store.len));
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
                    .{ .entry_id = entry_id, .dep_id = new_entry_dep_id },
                    &ctx,
                );
            }

            try dedupe_entry.value_ptr.append(lockfile.allocator, .{
                .entry_id = entry_id,
                .dep_id = new_entry_dep_id,
                .peers = node_peers[entry.node_id.get()],
            });

            for (node_nodes[entry.node_id.get()].items) |node_id| {
                try entry_queue.writeItem(.{
                    .node_id = node_id,
                    .entry_parent_id = entry_id,
                });
            }
        }

        const dedupe_end = timer.read();

        // Store.Entry.debugPrintList(&store, lockfile);

        std.debug.print(
            \\Build tree ({d}): [{}]
            \\Deduplicate tree ({d}): [{}]
            \\Total: [{}]
            \\
            \\
        , .{
            nodes.len,
            bun.fmt.fmtDurationOneDecimal(full_tree_end),
            store.len,
            bun.fmt.fmtDurationOneDecimal(dedupe_end),
            bun.fmt.fmtDurationOneDecimal(full_tree_end + dedupe_end),
        });

        // Store.Node.deinitList(&nodes, lockfile.allocator);

        break :store bun.create(lockfile.allocator, Store, .{
            .entries = store,
            .nodes = nodes,
        });
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

    // const cwd_path: bun.AbsPath(.{}) = .init(FileSystem.instance.top_level_dir);
    // defer cwd_path.deinit();

    // var bun_modules_path = cwd_path.clone();
    // defer bun_modules_path.deinit();
    // bun_modules_path.append("node_modules/" ++ modules_dir_name);

    // var ctx: IsolatedInstaller = .{
    //     .manager = manager,
    //     .lockfile = lockfile,

    //     .root_node_modules_dir = root_node_modules_dir,
    //     .is_new_root_node_modules_dir = is_new_root_node_modules,
    //     .bun_modules_dir = bun_modules_dir,
    //     .is_new_bun_modules_dir = is_new_bun_modules,

    //     .cwd_path = cwd_path.move(),
    //     .bun_modules_path = bun_modules_path.move(),
    // };
    // defer ctx.deinit();

    var link_timer = std.time.Timer.start() catch unreachable;
    const total_links: usize = 0;

    {
        const nodes_slice = store.nodes.slice();
        const node_pkg_ids = nodes_slice.items(.pkg_id);
        const node_dep_ids = nodes_slice.items(.dep_id);
        const node_peers = nodes_slice.items(.peers);

        const entries = store.entries.slice();
        const entry_node_ids = entries.items(.node_id);
        const entry_parent_ids = entries.items(.parent_id);
        const entry_dependencies = entries.items(.dependencies);

        const string_buf = lockfile.buffers.string_bytes.items;

        const pkgs = lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        const pkg_name_hashes = pkgs.items(.name_hash);
        const pkg_resolutions = pkgs.items(.resolution);
        const pkg_bins = pkgs.items(.bin);
        _ = pkg_bins;

        // var seen_workspaces: std.AutoHashMapUnmanaged(PackageID, void) = .empty;
        // defer seen_workspaces.deinit(lockfile.allocator);

        var seen_entry_ids: std.AutoHashMapUnmanaged(Store.Entry.Id, void) = .empty;
        defer seen_entry_ids.deinit(lockfile.allocator);
        try seen_entry_ids.ensureTotalCapacity(lockfile.allocator, @intCast(store.entries.len));

        var installer: Store.Installer = .{
            .lockfile = lockfile,
            .manager = manager,
            .store = store,
            .preallocated_tasks = .init(bun.default_allocator),
        };

        var install_queue: std.fifo.LinearFifo(Store.Entry.Id, .Dynamic) = .init(lockfile.allocator);
        defer install_queue.deinit();
        try install_queue.ensureTotalCapacity(store.entries.len);

        // find and queue entries without dependencies. we want to start downloading
        // their tarballs first because their lifecycle scripts can start running
        // immediately
        for (0..store.entries.len) |_entry_id| {
            const entry_id: Store.Entry.Id = .from(@intCast(_entry_id));

            const dependencies = entry_dependencies[entry_id.get()];

            if (dependencies.list.items.len != 0) {
                continue;
            }

            seen_entry_ids.putAssumeCapacityNoClobber(entry_id, {});
            install_queue.writeItemAssumeCapacity(entry_id);
        }

        while (install_queue.readItem()) |entry_id| {
            const parent_entry_id = entry_parent_ids[entry_id.get()];
            if (parent_entry_id != .invalid) {
                const entry = try seen_entry_ids.getOrPut(lockfile.allocator, parent_entry_id);
                if (!entry.found_existing) {
                    install_queue.writeItemAssumeCapacity(parent_entry_id);
                }
            }

            const node_id = entry_node_ids[entry_id.get()];
            const pkg_id = node_pkg_ids[node_id.get()];

            const pkg_name = pkg_names[pkg_id];
            const pkg_name_hash = pkg_name_hashes[pkg_id];
            const pkg_res: Resolution = pkg_resolutions[pkg_id];

            // std.debug.print("checking: {s}@{}\n", .{ pkg_name.slice(string_buf), pkg_res.fmt(string_buf, .posix) });

            const patch_info = try installer.packagePatchInfo(pkg_name, pkg_name_hash, &pkg_res);

            // determine if the package already exists in the store. root and workspace
            // packages always ensure their node_module symlinks exist and are valid. other
            // packages in the store add this only if the package needs to be installed.
            const needs_install = needs_install: switch (pkg_res.tag) {
                .root => {
                    if (entry_id == .root) {
                        store.linkDependencies(installer.lockfile, entry_id);
                    }
                    break :needs_install false;
                },
                .workspace => {
                    store.linkDependencies(installer.lockfile, entry_id);
                    break :needs_install false;
                },
                .symlink,
                .folder,
                => {
                    @panic("link these!!!!");
                },

                else => manager.options.enable.force_install or is_new_bun_modules or patch_info == .remove or {
                    const peers = node_peers[node_id.get()];

                    const exists = exists: {
                        if (comptime Environment.isWindows) {
                            var store_path: bun.AbsPath(.{}) = .initTopLevelDir();
                            defer store_path.deinit();
                            Store.Entry.appendStorePath(&store_path, pkg_id, peers, string_buf, pkg_names, pkg_resolutions);

                            break :exists bun.sys.existsZ(store_path.sliceZ());
                        }

                        var rel_path: bun.RelPath(.{}) = .init();
                        defer rel_path.deinit();
                        Store.Entry.appendStorePath(&rel_path, pkg_id, peers, string_buf, pkg_names, pkg_resolutions);
                        break :exists bun.sys.directoryExistsAt(cwd, rel_path.sliceZ()).unwrapOr(false);
                    };

                    break :needs_install switch (patch_info) {
                        .none => !exists,
                        // checked above
                        .remove => unreachable,
                        .patch => |patch| {
                            var hash_buf: install.BuntagHashBuf = undefined;
                            const hash = install.buntaghashbuf_make(&hash_buf, patch.contents_hash);

                            if (comptime Environment.isWindows) {
                                var patch_tag_path: bun.AbsPath(.{}) = .initTopLevelDir();
                                defer patch_tag_path.deinit();
                                Store.Entry.appendStorePath(&patch_tag_path, pkg_id, peers, string_buf, pkg_names, pkg_resolutions);
                                patch_tag_path.append(hash);
                                break :needs_install !bun.sys.existsZ(patch_tag_path.sliceZ());
                            }

                            var patch_tag_path: bun.RelPath(.{}) = .init();
                            defer patch_tag_path.deinit();
                            Store.Entry.appendStorePath(&patch_tag_path, pkg_id, peers, string_buf, pkg_names, pkg_resolutions);
                            patch_tag_path.append(hash);
                            break :needs_install !bun.sys.existsAt(cwd, patch_tag_path.sliceZ());
                        },
                    };
                },
            };

            if (!needs_install) {
                // TODO: onPackageInstall or something for starting parent tasks that
                // were blocked.
                summary.skipped += 1;
                continue;
            }

            // determine if the package is cached. if it's not, enqueue it and go to the next package.
            const cache_dir, var cache_dir_subpath = installer.packageCacheDirAndSubpath(pkg_name, &pkg_res, patch_info);
            defer cache_dir_subpath.deinit();

            const missing_from_cache = switch (manager.getPreinstallState(pkg_id)) {
                .done => false,
                else => missing_from_cache: {
                    if (patch_info == .none) {
                        const exists = switch (pkg_res.tag) {
                            .npm => exists: {
                                var cache_dir_subpath_save = cache_dir_subpath.save();
                                defer cache_dir_subpath_save.restore();
                                cache_dir_subpath.append("package.json");

                                break :exists sys.existsAt(cache_dir, cache_dir_subpath.sliceZ());
                            },
                            else => sys.directoryExistsAt(cache_dir, cache_dir_subpath.sliceZ()).unwrapOr(false),
                        };
                        if (exists) manager.setPreinstallState(pkg_id, installer.lockfile, .done);
                        break :missing_from_cache !exists;
                    }

                    // TODO: why does this look like it will never work?
                    break :missing_from_cache true;
                },
            };

            if (!missing_from_cache) {
                installer.scheduleTask(entry_id, .link_package);
                continue;
            }

            const ctx: install.TaskCallbackContext = .{
                .isolated_package_install_context = entry_id,
            };

            const dep_id = node_dep_ids[node_id.get()];

            switch (pkg_res.tag) {
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
                            @panic("TODOO!!!!");
                        },
                    };
                },
                else => {
                    @panic("todo!!!!");
                },
            }

            // _ = manager.incrementPendingTasks(1);

            // total_links += entry_dependencies[entry_id.get()].list.items.len;

            // const link_task = Store.LinkTask.new(.{
            //     .store = store,
            //     .entry_id = entry_id,
            // });

            // manager.thread_pool.schedule(.from(&link_task.task));

            // store.linkDependencies(entry_id);
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

        // find leaves and queue their tarball tasks first in order
        // to unblock scripts fastest.
        // for (
        //     entry_node_ids,
        //     entry_parent_ids,
        //     entry_dependencies,
        //     0..,
        // ) |
        //     node_id,
        //     parent_id,
        //     dependencies,
        //     _entry_id,
        // | {
        //     const entry_scope = entry_node_modules_path.save();
        //     defer entry_scope.restore();

        //     const entry_id: Store.Entry.Id = .from(@intCast(_entry_id));
        //     _ = parent_id;
        //     _ = entry_id;

        //     const pkg_id = node_pkg_ids[node_id.get()];
        //     const peers = node_peers[node_id.get()];

        //     Store.Entry.appendStoreNodeModulesPath(&entry_node_modules_path, pkg_id, peers, string_buf, pkg_names, pkg_resolutions);

        //     var maybe_entry_node_modules_dir: ?FD = null;
        //     defer if (maybe_entry_node_modules_dir) |entry_node_modules_dir| entry_node_modules_dir.close();

        //     // std.debug.print("entry: '{s}'\n", .{entry_node_modules_path.slice()});
        //     for (dependencies.slice()) |store_dep| {
        //         const dep_scope = dep_path.save();
        //         defer dep_scope.restore();

        //         const dep_node_id = entry_node_ids[store_dep.entry_id.get()];
        //         const dep_pkg_id = node_pkg_ids[dep_node_id.get()];
        //         const dep_dep = lockfile.buffers.dependencies.items[store_dep.dep_id];
        //         bun.debugAssert(!dep_dep.behavior.isWorkspaceOnly());
        //         const dep_dep_name = dep_dep.name;
        //         const dep_peers = node_peers[dep_node_id.get()];

        //         const dep_pkg_name = pkg_names[dep_pkg_id];

        //         Store.Entry.appendStoreNodeModulesPath(&dep_path, dep_pkg_id, dep_peers, string_buf, pkg_names, pkg_resolutions);

        //         entry_node_modules_path.relative(&dep_path, &target_path);

        //         const target_scope = target_path.save();
        //         defer target_scope.restore();
        //         target_path.append(dep_pkg_name.slice(string_buf));
        //         dep_path.append(dep_pkg_name.slice(string_buf));

        //         // const inner_entry_scope = entry_node_modules_path.save();
        //         // defer inner_entry_scope.restore();
        //         // entry_node_modules_path.append(dep_dep_name.slice(string_buf));

        //         // std.debug.print(" - '{s}' -> '{s}'\n", .{ entry_node_modules_path.slice(), target_path.slice() });

        //         if (comptime Environment.isWindows) {
        //             const inner_entry_scope = entry_node_modules_path.save();
        //             defer inner_entry_scope.restore();
        //             entry_node_modules_path.append(dep_dep_name.slice(string_buf));
        //             ensureSymlink(entry_node_modules_path.sliceZ(), target_path.sliceZ(), dep_path.sliceZ());
        //         } else {
        //             const entry_node_modules_dir = maybe_entry_node_modules_dir orelse open: {
        //                 maybe_entry_node_modules_dir = FD.makeOpenPath(cwd, u8, entry_node_modules_path.slice()) catch |err| {
        //                     Output.err(err, "failed to create and open node_modules: '{s}'", .{entry_node_modules_path.slice()});
        //                     Global.exit(1);
        //                 };
        //                 break :open maybe_entry_node_modules_dir.?;
        //             };
        //             const inner_entry_scope = entry_node_modules_path.save();
        //             defer inner_entry_scope.restore();
        //             entry_node_modules_path.append(dep_dep_name.slice(string_buf));
        //             ensureSymlink(target_path.sliceZ(), entry_node_modules_dir, entry_node_modules_path.basenameZ());
        //         }

        //         // bun.sys.symlinkOrJunction(
        //         //     entry_node_modules_path.sliceZ(),
        //         //     target_path.sliceZ(),
        //         //     dep_path.sliceZ(),
        //         // ).unwrap() catch |link_err1| switch (link_err1) {
        //         //     else => {
        //         //         Output.err(link_err1, "failed to create symlink: '{s}' -\\> '{s}'", .{
        //         //             entry_node_modules_path.slice(),
        //         //             dep_path.slice(),
        //         //         });
        //         //         Global.exit(1);
        //         //     },
        //         //     error.ENOENT => {
        //         //         // ensure the directory exists and try again
        //         //         const undo_scope = entry_node_modules_path.save();
        //         //         entry_node_modules_path.undo(1);
        //         //         cwd.makePath(u8, entry_node_modules_path.slice()) catch |node_modules_err| {
        //         //             Output.err(node_modules_err, "failed to create node_modules for {s}@{}", .{
        //         //                 pkg_names[pkg_id].slice(string_buf),
        //         //                 pkg_resolutions[pkg_id].fmt(string_buf, .posix),
        //         //             });
        //         //             Global.exit(1);
        //         //         };

        //         //         undo_scope.restore();
        //         //         bun.sys.symlinkOrJunction(
        //         //             entry_node_modules_path.sliceZ(),
        //         //             target_path.sliceZ(),
        //         //             dep_path.sliceZ(),
        //         //         ).unwrap() catch |link_err2| {
        //         //             Output.err(link_err2, "failed to create symlink: '{s}' -\\> '{s}'", .{
        //         //                 entry_node_modules_path.slice(),
        //         //                 dep_path.slice(),
        //         //             });
        //         //             Global.exit(1);
        //         //         };
        //         //     },
        //         //     error.EEXIST => {
        //         //         // TODO: options:
        //         //         //  1. Immediately try deleting the existing file/directory/link, then create a new link.
        //         //         //  2. Try to read the existing link. If it's not equal to the expected path (or isn't a link), delete
        //         //         //     and create a new link.
        //         //         //  3. Assume the link already exists and do nothing.
        //         //         //  4. Keep track of new packages. If it's a new package that didn't exist in the previous
        //         //         //     lockfile, option 1. If it's an existing package, option 2.

        //         //         std.fs.deleteTreeAbsolute(entry_node_modules_path.slice()) catch {
        //         //             // ignore errors
        //         //         };

        //         //         bun.sys.symlinkOrJunction(
        //         //             entry_node_modules_path.sliceZ(),
        //         //             target_path.sliceZ(),
        //         //             dep_path.sliceZ(),
        //         //         ).unwrap() catch |link_err2| {
        //         //             Output.err(link_err2, "failed to create symlink: '{s}' -\\> '{s}'", .{
        //         //                 entry_node_modules_path.slice(),
        //         //                 dep_path.slice(),
        //         //             });
        //         //             Global.exit(1);
        //         //         };
        //         //     },
        //         // };
        //     }
        // }
    }

    const link_time = link_timer.read();

    std.debug.print("\n\ninstallIsolatedPackages [{}]\n  Total links: {d} [{}]\n", .{
        bun.fmt.fmtDurationOneDecimal(total_time.read()),
        total_links,
        bun.fmt.fmtDurationOneDecimal(link_time),
    });

    return summary;
}

const EnsureDependencyLinkStrategy = enum {
    readlink_first,
    symlink_first,
};

fn ensureDependencyLinkPosix(target: [:0]const u8, dest_dir: FD, dest_subpath: [:0]const u8, strategy: EnsureDependencyLinkStrategy) void {
    return switch (strategy) {
        .readlink_first => {
            var readlink_buf = bun.PathBufferPool.get();
            defer readlink_buf.deinit();
            const existing_link = bun.sys.readlinkat(dest_dir, dest_subpath, readlink_buf).unwrap() catch |readlink_err| switch (readlink_err) {
                error.ENOENT => {
                    ensureSymlink(target, dest_dir, dest_subpath);
                    return;
                },
                error.EINVAL => {
                    dest_dir.stdDir().deleteTree(dest_subpath) catch {};
                    ensureSymlink(target, dest_dir, dest_subpath);
                    return;
                },
                else => {
                    Output.err(readlink_err, "failed to readlink: '{}/{s}'", .{
                        dest_dir,
                        dest_subpath,
                    });
                    Global.exit(1);
                },
            };

            if (strings.eqlLong(existing_link, target)) {
                return;
            }

            bun.sys.unlinkat(dest_dir, dest_subpath).unwrap() catch {};

            bun.sys.symlinkat(target, dest_dir, dest_subpath).unwrap() catch |err| {
                Output.err(err, "failed to create symlink: '{}/{s}' -\\> '{s}'", .{
                    dest_dir,
                    dest_subpath,
                    target,
                });
            };
        },
        .symlink_first => {
            ensureSymlink(target, dest_dir, dest_subpath);
        },
    };
}

// this function either succeeds or fails and exits immediately
const ensureSymlink = if (Environment.isWindows)
    ensureSymlinkWindows
else
    ensureSymlinkPosix;

fn ensureSymlinkPosix(target: [:0]const u8, dest_dir: FD, dest_subpath: [:0]const u8) void {
    return bun.sys.symlinkat(target, dest_dir, dest_subpath).unwrap() catch |symlink_err1| switch (symlink_err1) {
        error.ENOENT => {
            const parent_dir = std.fs.path.dirname(dest_subpath) orelse {
                Output.err(symlink_err1, "failed to create symlink: '{}/{s}' -\\> '{s}'", .{
                    dest_dir,
                    dest_subpath,
                    target,
                });
                Global.exit(1);
            };

            dest_dir.makePath(u8, parent_dir) catch {};

            bun.sys.symlinkat(target, dest_dir, dest_subpath).unwrap() catch |symlink_err2| {
                Output.err(symlink_err2, "failed to create symlink: '{}/{s}' -\\> '{s}'", .{
                    dest_dir,
                    dest_subpath,
                    target,
                });
                Global.exit(1);
            };
        },
        error.EEXIST => {
            dest_dir.stdDir().deleteTree(dest_subpath) catch {};

            bun.sys.symlinkat(target, dest_dir, dest_subpath).unwrap() catch |symlink_err2| {
                Output.err(symlink_err2, "failed to create symlink: '{}/{s}' -\\> '{s}'", .{
                    dest_dir,
                    dest_subpath,
                    target,
                });
                Global.exit(1);
            };
        },
        else => {
            Output.err(symlink_err1, "failed to create symlink: '{}/{s}' -\\> '{s}'", .{
                dest_dir,
                dest_subpath,
                target,
            });
            Global.exit(1);
        },
    };
}

fn ensureSymlinkWindows(rel_target: [:0]const u8, abs_target: [:0]const u8, dest: [:0]const u8) void {
    return bun.sys.symlinkOrJunction(dest, rel_target, abs_target).unwrap() catch |symlink_err1| switch (symlink_err1) {
        error.ENOENT => {
            const parent_dir = std.fs.path.dirname(dest) orelse {
                Output.err(symlink_err1, "failed to link: '{s}' -\\> '{s}'", .{
                    dest,
                    rel_target,
                });
                Global.exit(1);
            };

            FD.cwd().makePath(u8, parent_dir) catch {};

            bun.sys.symlinkOrJunction(dest, rel_target, abs_target).unwrap() catch |symlink_err2| {
                Output.err(symlink_err2, "failed to link: '{s}' -\\> '{s}'", .{
                    dest,
                    rel_target,
                });
                Global.exit(1);
            };
        },
        error.EEXIST => {
            FD.cwd().stdDir().deleteTree(dest) catch {};

            bun.sys.symlinkOrJunction(dest, rel_target, abs_target).unwrap() catch |symlink_err2| {
                Output.err(symlink_err2, "failed to link: '{s}' -\\> '{s}'", .{
                    dest,
                    rel_target,
                });
                Global.exit(1);
            };
        },
        else => {
            Output.err(symlink_err1, "failed to link: '{s}' -\\> '{s}'", .{
                dest,
                rel_target,
            });
            Global.exit(1);
        },
    };
}

const Ids = struct {
    dep_id: DependencyID,
    pkg_id: PackageID,
};

pub const Store = struct {
    entries: Entry.List,
    nodes: Node.List,

    pub const Installer = struct {
        lockfile: *const Lockfile,
        manager: *PackageManager,
        store: *const Store,

        tasks: bun.UnboundedQueue(Task, .next) = .{},
        preallocated_tasks: Task.Preallocated,

        // pub fn enqueueParent(this: *Installer, entry_id: Entry.Id) void {}

        pub fn scheduleTask(this: *Installer, entry_id: Entry.Id, step: Task.Step) void {
            const task = this.preallocated_tasks.get();
            task.* = .{
                .entry_id = entry_id,
                .installer = this,
                .step = step,
            };

            _ = this.manager.incrementPendingTasks(1);
            this.manager.thread_pool.schedule(.from(&task.task));
        }

        const Task = struct {
            const Preallocated = bun.HiveArray(Task, 128).Fallback;

            entry_id: Entry.Id,
            installer: *Installer,

            step: Step,

            task: ThreadPool.Task = .{ .callback = &callback },
            next: ?*Task = null,

            pub const Step = enum(u8) {
                link_package,
                symlink_dependencies,

                @"run preinstall",
                binaries,
                @"run (pre/post)prepare",
                @"run (post)install",
                done,

                blocked,
                waiting_for_script_subprocess,
            };

            fn nextStep(this: *Task) Step {
                if (this.step == .done) return .done;
                const current_step: u8 = @intFromEnum(this.step);
                this.step = @enumFromInt(current_step + 1);

                // switch (this.step) {
                //     .@"run preinstall" => {
                //         // might be blocked
                //         // if (blocked) {
                //         //     return .blocked;
                //         // }

                //         return this.step;
                //     }

                // }
                return this.step;
            }

            fn run(this: *Task) OOM!void {

                // defer {
                //     // _ = PackageManager.get().decrementPendingTasks();
                //     PackageManager.get().wake();
                // }

                const installer = this.installer;

                const pkgs = installer.lockfile.packages.slice();
                const pkg_names = pkgs.items(.name);
                const pkg_name_hashes = pkgs.items(.name_hash);
                const pkg_resolutions = pkgs.items(.resolution);
                const pkg_bins = pkgs.items(.bin);

                const entries = installer.store.entries.slice();
                const entry_node_ids = entries.items(.node_id);
                const entry_dependencies = entries.items(.dependencies);

                const nodes = installer.store.nodes.slice();
                const node_pkg_ids = nodes.items(.pkg_id);
                const node_dep_ids = nodes.items(.dep_id);
                const node_peers = nodes.items(.peers);

                const node_id = entry_node_ids[this.entry_id.get()];
                const pkg_id = node_pkg_ids[node_id.get()];
                const dep_id = node_dep_ids[node_id.get()];
                _ = dep_id;
                const peers = node_peers[node_id.get()];

                const pkg_name = pkg_names[pkg_id];
                const pkg_name_hash = pkg_name_hashes[pkg_id];
                const pkg_res = pkg_resolutions[pkg_id];

                return next_step: switch (this.step) {
                    .link_package => {
                        const patch_info = try installer.packagePatchInfo(
                            pkg_name,
                            pkg_name_hash,
                            &pkg_res,
                        );

                        const cache_dir, const cache_dir_subpath = this.installer.packageCacheDirAndSubpath(
                            pkg_name,
                            &pkg_res,
                            patch_info,
                        );
                        defer cache_dir_subpath.deinit();

                        var dest_dir_subpath: bun.RelPath(.{}) = .init();
                        defer dest_dir_subpath.deinit();

                        Store.Entry.appendStorePath(
                            &dest_dir_subpath,
                            pkg_id,
                            peers,
                            installer.lockfile.buffers.string_bytes.items,
                            pkg_names,
                            pkg_resolutions,
                        );

                        // link the package
                        if (comptime Environment.isMac) hardlink_fallback: {
                            switch (sys.clonefileat(cache_dir, cache_dir_subpath.sliceZ(), FD.cwd(), dest_dir_subpath.sliceZ())) {
                                .result => {
                                    // success! move to next step
                                    continue :next_step this.nextStep();
                                },
                                .err => |err| {
                                    switch (err.getErrno()) {
                                        .XDEV => break :hardlink_fallback,
                                        .OPNOTSUPP => break :hardlink_fallback,
                                        .NOENT => {
                                            const parent_dest_dir = std.fs.path.dirname(dest_dir_subpath.slice()) orelse {
                                                @panic("TODO: return error.ENOENT back to main thread");
                                            };

                                            FD.cwd().makePath(u8, parent_dest_dir) catch {};

                                            switch (sys.clonefileat(cache_dir, cache_dir_subpath.sliceZ(), FD.cwd(), dest_dir_subpath.sliceZ())) {
                                                .result => {
                                                    continue :next_step this.nextStep();
                                                },
                                                .err => {
                                                    @panic("TODO: return error back to main thread");
                                                },
                                            }
                                        },
                                        else => {
                                            @panic("oooopss!");
                                        },
                                    }
                                },
                            }
                        }

                        continue :next_step this.nextStep();
                    },
                    .symlink_dependencies => {
                        installer.store.linkDependencies(installer.lockfile, this.entry_id);
                        continue :next_step this.nextStep();
                    },
                    .@"run preinstall" => {
                        if (!installer.manager.options.do.run_scripts) {
                            continue :next_step this.nextStep();
                        }

                        // const dep_name_hash = installer.lockfile.buffers.dependencies.items[dep_id];
                        // const truncated_dep_name_hash: TruncatedPackageNameHash = @truncate(dep_name_hash);

                        // const is_trusted, const is_trusted_through_update_request = brk: {
                        //     if (this.trusted_dependencies_from_update_requests.contains(truncated_dep_name_hash)) break :brk .{ true, true };
                        //     if (this.lockfile.hasTrustedDependency(alias.slice(this.lockfile.buffers.string_bytes.items))) break :brk .{ true, false };
                        //     break :brk .{ false, false };
                        // };

                        const dependencies = entry_dependencies[this.entry_id.get()];
                        _ = dependencies;

                        // var is_blocked = false;
                        // for (dependencies.slice()) |dep_entry_id| {}
                        continue :next_step this.nextStep();
                    },
                    .binaries => {
                        if (pkg_bins[pkg_id].tag != .none) {}
                        continue :next_step this.nextStep();
                    },
                    // .preinstall => {

                    // },
                    // .binaries => {

                    // },
                    // .install_and_postinstall => {}

                    else => {
                        continue :next_step this.nextStep();
                    },

                    .done => {
                        _ = this.installer.manager.decrementPendingTasks();
                        this.installer.manager.wake();
                    },

                    .blocked => {
                        _ = this.installer.manager.decrementPendingTasks();
                        this.installer.manager.wake();
                    },

                    .waiting_for_script_subprocess => {
                        _ = this.installer.manager.decrementPendingTasks();
                        this.installer.manager.wake();
                    },
                };
            }

            pub fn callback(task: *ThreadPool.Task) void {
                const this: *Task = @fieldParentPtr("task", task);

                this.run() catch |err| switch (err) {
                    error.OutOfMemory => bun.outOfMemory(),
                };
            }
        };

        pub fn onPackageExtracted(this: *Installer, task_id: install.Task.Id) void {
            if (this.manager.task_queue.fetchRemove(task_id.get())) |removed| {
                for (removed.value.items) |install_ctx| {
                    const entry_id = install_ctx.isolated_package_install_context;
                    this.scheduleTask(entry_id, .link_package);
                }
            }
        }

        pub fn packageCacheDirAndSubpath(
            this: *Installer,
            pkg_name: String,
            pkg_res: *const Resolution,
            patch_info: PatchInfo,
        ) struct { FD, bun.RelPath(.{}) } {
            const string_buf = this.lockfile.buffers.string_bytes.items;

            const dir, const subpath = switch (pkg_res.tag) {
                .npm => .{
                    this.manager.getCacheDirectory(),
                    this.manager.cachedNPMPackageFolderName(
                        pkg_name.slice(string_buf),
                        pkg_res.value.npm.version,
                        patch_info.contentsHash(),
                    ),
                },
                .git => .{
                    this.manager.getCacheDirectory(),
                    this.manager.cachedGitFolderName(&pkg_res.value.git, patch_info.contentsHash()),
                },
                .github => .{
                    this.manager.getCacheDirectory(),
                    this.manager.cachedGitHubFolderName(&pkg_res.value.github, patch_info.contentsHash()),
                },
                .local_tarball => .{
                    this.manager.getCacheDirectory(),
                    this.manager.cachedTarballFolderName(pkg_res.value.local_tarball, patch_info.contentsHash()),
                },
                .remote_tarball => .{
                    this.manager.getCacheDirectory(),
                    this.manager.cachedTarballFolderName(pkg_res.value.remote_tarball, patch_info.contentsHash()),
                },

                // should never reach this function. they aren't cached!
                .workspace => unreachable,
                .root => unreachable,
                .folder => unreachable,
                .symlink => unreachable,

                else => {
                    @panic("oops!!!!");
                },
            };

            return .{ .fromStdDir(dir), .from(subpath) };
        }

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
    };

    pub fn linkDependencies(this: *const Store, lockfile: *const Lockfile, entry_id: Entry.Id) void {
        const string_buf = lockfile.buffers.string_bytes.items;
        const dependencies = lockfile.buffers.dependencies.items;

        const entries = this.entries.slice();
        const entry_node_ids = entries.items(.node_id);
        const entry_dependency_lists = entries.items(.dependencies);

        const nodes_slice = this.nodes.slice();
        const node_pkg_ids = nodes_slice.items(.pkg_id);
        const node_dep_ids = nodes_slice.items(.dep_id);
        const node_peers = nodes_slice.items(.peers);

        const pkgs = lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        const pkg_resolutions = pkgs.items(.resolution);

        var entry_node_modules_path: bun.AbsPath(.{}) = .initTopLevelDir();
        defer entry_node_modules_path.deinit();

        var dep_path = entry_node_modules_path.clone();
        defer dep_path.deinit();

        const entry_node_id = entry_node_ids[entry_id.get()];
        const entry_dependencies = entry_dependency_lists[entry_id.get()];
        const entry_pkg_id = node_pkg_ids[entry_node_id.get()];
        const entry_peers = node_peers[entry_node_id.get()];
        Store.Entry.appendStoreNodeModulesPath(
            &entry_node_modules_path,
            entry_pkg_id,
            entry_peers,
            string_buf,
            pkg_names,
            pkg_resolutions,
        );

        var target_path: bun.RelPath(.{}) = .init();
        defer target_path.deinit();

        var maybe_entry_node_modules_dir: ?FD = null;
        defer if (maybe_entry_node_modules_dir) |entry_node_modules_dir| entry_node_modules_dir.close();

        for (entry_dependencies.slice()) |dep_entry_id| {
            const dep_path_save = dep_path.save();
            defer dep_path_save.restore();
            const entry_node_modules_path_save = entry_node_modules_path.save();
            defer entry_node_modules_path_save.restore();
            const target_path_save = target_path.save();
            defer target_path_save.restore();

            const dep_node_id = entry_node_ids[dep_entry_id.entry_id.get()];
            const dep_pkg_id = node_pkg_ids[dep_node_id.get()];
            // const dep_pkg_name = pkg_names[dep_pkg_id];
            const dep_peers = node_peers[dep_node_id.get()];
            const dep_id = node_dep_ids[dep_node_id.get()];
            const dep = dependencies[dep_id];

            Entry.appendStorePath(
                &dep_path,
                dep_pkg_id,
                dep_peers,
                string_buf,
                pkg_names,
                pkg_resolutions,
            );

            entry_node_modules_path.append(dep.name.slice(string_buf));

            // if this is a scoped package we want to be relative to
            // the nested directory
            const rel_save = entry_node_modules_path.save();
            entry_node_modules_path.undo(1);
            entry_node_modules_path.relative(&dep_path, &target_path);
            rel_save.restore();

            if (comptime Environment.isWindows) {
                ensureSymlink(entry_node_modules_path.sliceZ(), target_path.sliceZ(), dep_path.sliceZ());
            } else {
                const dep_name_len = dep.name.len();
                const entry_path = entry_node_modules_path.sliceZ();
                const dest_dir_path = entry_path[entry_path.len - dep_name_len ..][0..dep_name_len :0];

                const entry_node_modules_dir = maybe_entry_node_modules_dir orelse open: {
                    maybe_entry_node_modules_dir = FD.makeOpenPath(FD.cwd(), u8, entry_path[0 .. entry_path.len - dep_name_len]) catch |err| {
                        Output.err(err, "failed to open/create node_modules: '{s}'", .{entry_node_modules_path.slice()});
                        Global.exit(1);
                    };
                    break :open maybe_entry_node_modules_dir.?;
                };

                ensureSymlink(target_path.sliceZ(), entry_node_modules_dir, dest_dir_path);
            }
        }
    }

    // const LinkTask = struct {
    //     pub const new = bun.TrivialNew(@This());
    //     const deinit = bun.TrivialDeinit(@This());

    //     entry_id: Store.Entry.Id,
    //     store: *const Store,

    //     task: ThreadPool.Task = .{ .callback = &run },

    //     pub fn run(task: *ThreadPool.Task) void {
    //         const this: *LinkTask = @fieldParentPtr("task", task);

    //         defer {
    //             _ = PackageManager.get().decrementPendingTasks();
    //             PackageManager.get().wake();
    //             this.deinit();
    //         }

    //         this.store.linkDependencies(this.entry_id);
    //     }
    // };

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
        parent_id: Id,
        dependencies: Dependencies,

        step: std.atomic.Value(Installer.Task.Step) = .init(.link_package),

        // const State = enum(u8) {
        //     uninitialized = 0,
        //     linked,
        //     preinstall_done,
        //     binaries_linked,
        //     install_and_postinstall_done,
        //     install_complete,
        // };

        // tag: enum {
        //     normal,
        //     root_package,
        //     root_link,
        //     workspace_package,
        //     workspace_link,
        // },

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

        pub const Id = enum(u32) {
            root = 0,
            invalid = max,
            _,

            const max = std.math.maxInt(u32);

            pub fn from(id: u32) Id {
                bun.debugAssert(id != max);
                return @enumFromInt(id);
            }

            pub fn get(id: Id) u32 {
                bun.debugAssert(id != .invalid);
                return @intFromEnum(id);
            }

            pub fn tryGet(id: Id) ?u32 {
                return if (id == .invalid) null else @intFromEnum(id);
            }
        };

        pub fn appendStoreNodeModulesPath(
            prefix: anytype,
            pkg_id: PackageID,
            peers: Node.Peers,
            string_buf: string,
            pkg_names: []const String,
            pkg_resolutions: []const Resolution,
        ) void {
            const pkg_res = pkg_resolutions[pkg_id];

            switch (pkg_res.tag) {
                .root => {
                    prefix.append("node_modules");
                },
                .workspace => {
                    prefix.append(pkg_res.value.workspace.slice(string_buf));
                    prefix.append("node_modules");
                },
                else => {
                    const pkg_name = pkg_names[pkg_id];
                    prefix.appendFmt("node_modules/" ++ modules_dir_name ++ "/{s}@{}{}/node_modules", .{
                        pkg_name.fmtStorePath(string_buf),
                        pkg_res.fmt(string_buf, .posix),
                        Node.TransitivePeer.fmtStorePath(peers.list.items, string_buf, pkg_names, pkg_resolutions),
                    });
                },
            }
        }

        pub fn appendStorePath(
            prefix: anytype,
            pkg_id: PackageID,
            peers: Node.Peers,
            string_buf: string,
            pkg_names: []const String,
            pkg_resolutions: []const Resolution,
        ) void {
            const pkg_res = pkg_resolutions[pkg_id];

            switch (pkg_res.tag) {
                .root => {},
                .workspace => {
                    prefix.append(pkg_res.value.workspace.slice(string_buf));
                },
                else => {
                    const pkg_name = pkg_names[pkg_id];
                    prefix.appendFmt("node_modules/" ++ modules_dir_name ++ "/{s}@{}{}/node_modules/{s}", .{
                        pkg_name.fmtStorePath(string_buf),
                        pkg_res.fmt(string_buf, .posix),
                        Node.TransitivePeer.fmtStorePath(peers.list.items, string_buf, pkg_names, pkg_resolutions),
                        pkg_name.slice(string_buf),
                    });
                },
            }
        }

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

        const Peers = OrderedArraySet(TransitivePeer, TransitivePeer.OrderedArraySetCtx);

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

            const StorePathFormatter = struct {
                peers: []const TransitivePeer,
                string_buf: string,
                pkg_names: []const String,
                pkg_resolutions: []const Resolution,

                pub fn format(this: StorePathFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) @TypeOf(writer).Error!void {
                    if (this.peers.len > 0) {
                        try writer.writeByte('_');
                    }
                    for (this.peers, 0..) |peer, i| {
                        try writer.print("{}@{}", .{
                            this.pkg_names[peer.pkg_id].fmtStorePath(this.string_buf),
                            this.pkg_resolutions[peer.pkg_id].fmtStorePath(this.string_buf),
                        });

                        if (i != this.peers.len - 1) {
                            try writer.writeByte('+');
                        }
                    }
                }
            };

            pub fn fmtStorePath(peers: []const TransitivePeer, string_buf: string, pkg_names: []const String, pkg_resolutions: []const Resolution) StorePathFormatter {
                return .{
                    .peers = peers,
                    .string_buf = string_buf,
                    .pkg_names = pkg_names,
                    .pkg_resolutions = pkg_resolutions,
                };
            }
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

        pub const Id = enum(u32) {
            root = 0,
            invalid = max,
            _,

            const max = std.math.maxInt(u32);

            pub fn from(id: u32) Id {
                bun.debugAssert(id != max);
                return @enumFromInt(id);
            }

            pub fn get(id: Id) u32 {
                bun.debugAssert(id != .invalid);
                return @intFromEnum(id);
            }

            pub fn tryGet(id: Id) ?u32 {
                return if (id == .invalid) null else @intFromEnum(id);
            }
        };

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
