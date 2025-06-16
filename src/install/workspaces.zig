const std = @import("std");
const bun = @import("bun");
const install = bun.install;
const Lockfile = install.Lockfile;
const PackageManager = install.PackageManager;
const DependencyID = install.DependencyID;
const PackageID = install.PackageID;
const Dependency = install.Dependency;
const Package = Lockfile.Package;
const PackageInstall = install.PackageInstall;
const sys = bun.sys;
const FD = bun.FD;
const File = sys.File;
const Output = bun.Output;
const Global = bun.Global;
const Resolution = install.Resolution;
const OOM = bun.OOM;
const Semver = bun.Semver;
const String = Semver.String;
const invalid_package_id = install.invalid_package_id;
const invalid_dependency_id = install.invalid_dependency_id;
const FileSystem = bun.fs.FileSystem;
const strings = bun.strings;
const Environment = bun.Environment;
const string = bun.string;
const DependencySlice = Lockfile.DependencySlice;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
const Tree = Lockfile.Tree;
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
    bun.Analytics.Features.isolated_bun_install += 1;

    const lockfile = manager.lockfile;

    const store, const nodes = store: {
        var timer = std.time.Timer.start() catch unreachable;
        const pkgs = lockfile.packages.slice();
        const pkg_dependency_slices = pkgs.items(.dependencies);
        const pkg_resolutions = pkgs.items(.resolution);
        const pkg_names = pkgs.items(.name);

        const resolutions = lockfile.buffers.resolutions.items;
        const dependencies = lockfile.buffers.dependencies.items;
        const string_buf = lockfile.buffers.string_bytes.items;

        var filter_path_buf: bun.AbsPath(.{ .normalize_slashes = true }) = .init(FileSystem.instance.top_level_dir);
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
        node_queue: while (node_queue.readItem()) |entry| {
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
                        continue :node_queue;
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
                        const entries = store.slice();
                        const entry_dependencies = entries.items(.dependencies);
                        const ctx: Store.Entry.DependenciesOrderedArraySetCtx = .{
                            .string_buf = string_buf,
                            .dependencies = dependencies,
                        };
                        entry_dependencies[entry.entry_parent_id.get()].insertAssumeCapacity(
                            .{ .id = info.entry_id, .dep_id = curr_dep_id },
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
            const new_entry_is_workspace_only = !new_entry_is_root and dependencies[new_entry_dep_id].behavior.isWorkspaceOnly();

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
                if (new_entry_is_workspace_only) {
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
                    .{ .id = entry_id, .dep_id = new_entry_dep_id },
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

        break :store .{ store, nodes };
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
    _ = is_new_bun_modules;

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

    {
        const nodes_slice = nodes.slice();
        const node_pkg_ids = nodes_slice.items(.pkg_id);
        const node_peers = nodes_slice.items(.peers);

        const entries = store.slice();
        const entry_node_ids = entries.items(.node_id);
        const entry_parent_ids = entries.items(.parent_id);
        const entry_dependencies = entries.items(.dependencies);

        const string_buf = lockfile.buffers.string_bytes.items;

        const pkgs = lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        const pkg_resolutions = pkgs.items(.resolution);
        const pkg_bins = pkgs.items(.bin);
        _ = pkg_bins;

        var seen_workspaces: std.AutoHashMapUnmanaged(PackageID, void) = .empty;
        defer seen_workspaces.deinit(lockfile.allocator);

        var entry_node_modules_path: bun.AbsPath(.{}) = .init(FileSystem.instance.top_level_dir);
        defer entry_node_modules_path.deinit();

        var dep_path = entry_node_modules_path.clone();
        defer dep_path.deinit();

        var target_path: bun.RelPath(.{}) = .init();
        defer target_path.deinit();

        // find leaves and queue their tarball tasks first in order
        // to unblock scripts fastest.
        for (
            entry_node_ids,
            entry_parent_ids,
            entry_dependencies,
            0..,
        ) |
            node_id,
            parent_id,
            dependencies,
            _entry_id,
        | {
            const entry_scope = entry_node_modules_path.save();
            defer entry_scope.restore();

            const entry_id: Store.Entry.Id = .from(@intCast(_entry_id));
            _ = parent_id;
            _ = entry_id;

            const pkg_id = node_pkg_ids[node_id.get()];
            const peers = node_peers[node_id.get()];

            Store.Entry.appendNodeModulesStorePath(&entry_node_modules_path, pkg_id, peers, string_buf, pkg_names, pkg_resolutions);

            const maybe_entry_node_modules_dir: ?FD = null;
            defer if (maybe_entry_node_modules_dir) |entry_node_modules_dir| entry_node_modules_dir.close();

            std.debug.print("entry: '{s}'\n", .{entry_node_modules_path.slice()});
            for (dependencies.slice()) |store_dep| {
                const dep_scope = dep_path.save();
                defer dep_scope.restore();

                const dep_node_id = entry_node_ids[store_dep.id.get()];
                const dep_pkg_id = node_pkg_ids[dep_node_id.get()];
                const dep_dep = lockfile.buffers.dependencies.items[store_dep.dep_id];
                bun.debugAssert(!dep_dep.behavior.isWorkspaceOnly());
                const dep_dep_name = dep_dep.name;
                const dep_peers = node_peers[dep_node_id.get()];

                const dep_pkg_name = pkg_names[dep_pkg_id];

                Store.Entry.appendNodeModulesStorePath(&dep_path, dep_pkg_id, dep_peers, string_buf, pkg_names, pkg_resolutions);

                entry_node_modules_path.relative(&dep_path, &target_path);

                const target_scope = target_path.save();
                defer target_scope.restore();
                target_path.append(dep_pkg_name.slice(string_buf));
                dep_path.append(dep_pkg_name.slice(string_buf));

                const inner_entry_scope = entry_node_modules_path.save();
                defer inner_entry_scope.restore();
                entry_node_modules_path.append(dep_dep_name.slice(string_buf));

                std.debug.print(" - '{s}' -> '{s}'\n", .{ entry_node_modules_path.slice(), target_path.slice() });

                bun.sys.symlinkOrJunction(
                    entry_node_modules_path.sliceZ(),
                    target_path.sliceZ(),
                    dep_path.sliceZ(),
                ).unwrap() catch |err1| switch (err1) {
                    else => {
                        Output.err(err1, "failed to create symlink: '{s}' -\\> '{s}'", .{
                            entry_node_modules_path.slice(),
                            dep_path.slice(),
                        });
                        Global.exit(1);
                    },
                    error.ENOENT => {
                        // ensure the directory exists and try again
                        const undo_scope = entry_node_modules_path.save();
                        entry_node_modules_path.undo(1);
                        cwd.makePath(u8, entry_node_modules_path.slice()) catch |node_modules_err| {
                            Output.err(node_modules_err, "failed to create node_modules for {s}@{}", .{
                                pkg_names[pkg_id].slice(string_buf),
                                pkg_resolutions[pkg_id].fmt(string_buf, .posix),
                            });
                            Global.exit(1);
                        };

                        undo_scope.restore();
                        bun.sys.symlinkOrJunction(
                            entry_node_modules_path.sliceZ(),
                            target_path.sliceZ(),
                            dep_path.sliceZ(),
                        ).unwrap() catch |err2| {
                            Output.err(err2, "failed to create symlink: '{s}' -\\> '{s}'", .{
                                entry_node_modules_path.slice(),
                                dep_path.slice(),
                            });
                            Global.exit(1);
                        };
                    },
                    error.EEXIST => {
                        // TODO: options:
                        //  1. Immediately try deleting the existing file/directory/link, then create a new link.
                        //  2. Try to read the existing link. If it's not equal to the expected path (or isn't a link), delete
                        //     and create a new link.
                        //  3. Assume the link already exists and do nothing.
                        //  4. Keep track of new packages. If it's a new package that didn't exist in the previous
                        //     lockfile, option 1. If it's an existing package, option 2.

                        std.fs.deleteTreeAbsolute(entry_node_modules_path.slice()) catch {
                            // ignore errors
                        };

                        bun.sys.symlinkOrJunction(
                            entry_node_modules_path.sliceZ(),
                            target_path.sliceZ(),
                            dep_path.sliceZ(),
                        ).unwrap() catch |err2| {
                            Output.err(err2, "failed to create symlink: '{s}' -\\> '{s}'", .{
                                entry_node_modules_path.slice(),
                                dep_path.slice(),
                            });
                            Global.exit(1);
                        };
                    },
                };
            }
        }
    }

    return .{};
}

const Ids = struct {
    dep_id: DependencyID,
    pkg_id: PackageID,
};

const Store = struct {

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

        pub const List = bun.MultiArrayList(Entry);

        const DependenciesItem = struct {
            id: Id,
            dep_id: DependencyID,
        };
        pub const Dependencies = OrderedArraySet(DependenciesItem, DependenciesOrderedArraySetCtx);

        const DependenciesOrderedArraySetCtx = struct {
            string_buf: string,
            dependencies: []const Dependency,

            pub fn eql(ctx: *const DependenciesOrderedArraySetCtx, l_item: DependenciesItem, r_item: DependenciesItem) bool {
                if (l_item.id != r_item.id) {
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

                if (l.id == r.id and l_dep.name_hash == r_dep.name_hash) {
                    return .eq;
                }

                // TODO: y r doing
                if (l.id == .invalid) {
                    if (r.id == .invalid) {
                        return .eq;
                    }
                    return .lt;
                } else if (r.id == .invalid) {
                    if (l.id == .invalid) {
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

        pub fn appendNodeModulesStorePath(
            prefix: *bun.AbsPath(.{}),
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
                    prefix.appendFmt("{s}", .{pkg_res.value.workspace.slice(string_buf)});
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
