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
const Walker = @import("../walker_skippable.zig");
const Bin = install.Bin;
const TruncatedPackageNameHash = install.TruncatedPackageNameHash;
const Package = Lockfile.Package;
const Command = bun.CLI.Command;

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

pub fn installIsolatedPackages(
    manager: *PackageManager,
    command_ctx: Command.Context,
    install_root_dependencies: bool,
    workspace_filters: []const WorkspaceFilter,
) OOM!PackageInstall.Summary {
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
            {
                // nodes.get(entry.node_id.get()).debugPrint(entry.node_id, lockfile);
            }

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

        const entries = store.entries.slice();
        const entry_node_ids = entries.items(.node_id);
        const entry_steps = entries.items(.step);

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

        // TODO: delete
        var seen_workspace_ids: std.AutoHashMapUnmanaged(PackageID, void) = .empty;
        defer seen_workspace_ids.deinit(lockfile.allocator);

        var installer: Store.Installer = .{
            .lockfile = lockfile,
            .manager = manager,
            .command_ctx = command_ctx,
            .store = store,
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

            const patch_info = try installer.packagePatchInfo(pkg_name, pkg_name_hash, &pkg_res);

            // determine if the package already exists in the store. root and workspace
            // packages always ensure their node_module symlinks exist and are valid. other
            // packages in the store add this only if the package needs to be installed.
            const needs_install = needs_install: switch (pkg_res.tag) {
                .root => {
                    if (entry_id == .root) {
                        entry_steps[entry_id.get()].store(.@"symlink dependencies and their binaries", .monotonic);
                        installer.startTask(entry_id);
                        continue;
                    }
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.resumeAvailableTasks();
                    continue;
                },
                .workspace => {
                    if (!(try seen_workspace_ids.getOrPut(lockfile.allocator, pkg_id)).found_existing) {
                        entry_steps[entry_id.get()].store(.@"symlink dependencies and their binaries", .monotonic);
                        installer.startTask(entry_id);
                        continue;
                    }
                    entry_steps[entry_id.get()].store(.done, .monotonic);
                    installer.resumeAvailableTasks();
                    continue;
                },
                .symlink,
                .folder,
                => {
                    @panic("link these!!!!");
                },

                else => manager.options.enable.force_install or is_new_bun_modules or patch_info == .remove or {
                    const exists = exists: {
                        if (comptime Environment.isWindows) {
                            var store_path: bun.AbsPath(.{}) = .initTopLevelDir();
                            defer store_path.deinit();
                            installer.appendStorePath(&store_path, entry_id);
                            break :exists sys.existsZ(store_path.sliceZ());
                        }

                        var rel_path: bun.RelPath(.{}) = .init();
                        defer rel_path.deinit();
                        installer.appendStorePath(&rel_path, entry_id);
                        break :exists sys.directoryExistsAt(cwd, rel_path.sliceZ()).unwrapOr(false);
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
                                installer.appendStorePath(&patch_tag_path, entry_id);
                                patch_tag_path.append(hash);
                                break :needs_install !sys.existsZ(patch_tag_path.sliceZ());
                            }

                            var patch_tag_path: bun.RelPath(.{}) = .init();
                            defer patch_tag_path.deinit();
                            installer.appendStorePath(&patch_tag_path, entry_id);
                            patch_tag_path.append(hash);
                            break :needs_install !sys.existsAt(cwd, patch_tag_path.sliceZ());
                        },
                    };
                },
            };

            if (!needs_install) {
                summary.skipped += 1;
                entry_steps[entry_id.get()].store(.done, .monotonic);
                installer.resumeAvailableTasks();
                continue;
            }

            // determine if the package is cached. if it's not, enqueue it and go to the next package.
            const cache_dir, const cache_dir_path, var pkg_cache_dir_subpath = installer.packageCacheDirAndSubpath(pkg_name, &pkg_res, patch_info);
            defer {
                cache_dir_path.deinit();
                pkg_cache_dir_subpath.deinit();
            }

            const missing_from_cache = switch (manager.getPreinstallState(pkg_id)) {
                .done => false,
                else => missing_from_cache: {
                    if (patch_info == .none) {
                        const exists = switch (pkg_res.tag) {
                            .npm => exists: {
                                var cache_dir_subpath_save = pkg_cache_dir_subpath.save();
                                defer cache_dir_subpath_save.restore();
                                pkg_cache_dir_subpath.append("package.json");

                                break :exists sys.existsAt(cache_dir, pkg_cache_dir_subpath.sliceZ());
                            },
                            else => sys.directoryExistsAt(cache_dir, pkg_cache_dir_subpath.sliceZ()).unwrapOr(false),
                        };
                        if (exists) manager.setPreinstallState(pkg_id, installer.lockfile, .done);
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
                            @panic("error");
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
                            @panic("ooopsies");
                        },
                    };
                },
                else => {
                    unreachable;
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

        {
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
                        const parent_ids = Store.Entry.debugGatherAllParents(entry_id, store);
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
            const existing_link = sys.readlinkat(dest_dir, dest_subpath, readlink_buf).unwrap() catch |readlink_err| switch (readlink_err) {
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

            sys.unlinkat(dest_dir, dest_subpath).unwrap() catch {};

            sys.symlinkat(target, dest_dir, dest_subpath).unwrap() catch |err| {
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

fn ensureSymlinkPosix(target: [:0]const u8, dest: [:0]const u8) void {
    return switch (sys.symlink(target, dest)) {
        .result => {},
        .err => |symlink_err1| {
            switch (symlink_err1.getErrno()) {
                .NOENT => {
                    const parent_dir = std.fs.path.dirname(dest) orelse {
                        Output.err(symlink_err1, "failed to create symlink: '{s}' -\\> '{s}'", .{
                            dest,
                            target,
                        });
                        Global.exit(1);
                    };

                    FD.cwd().makePath(u8, parent_dir) catch {};

                    switch (sys.symlink(target, dest)) {
                        .result => {},
                        .err => |symlink_err2| {
                            Output.err(symlink_err2, "failed to create symlink: '{s}' -\\> '{s}'", .{
                                dest,
                                target,
                            });
                            Global.exit(1);
                        },
                    }
                },
                .EXIST => {
                    FD.cwd().deleteTree(dest) catch {};

                    switch (sys.symlink(target, dest)) {
                        .result => {},
                        .err => |symlink_err2| {
                            Output.err(symlink_err2, "failed to create symlink: '{s}' -\\> '{s}'", .{
                                dest,
                                target,
                            });
                            Global.exit(1);
                        },
                    }
                },
                else => {
                    Output.err(symlink_err1, "failed to create symlink: '{s}' -\\> '{s}'", .{
                        dest,
                        target,
                    });
                    Global.exit(1);
                },
            }
        },
    };
}

fn ensureSymlinkWindows(rel_target: [:0]const u8, abs_target: [:0]const u8, dest: [:0]const u8) void {
    return sys.symlinkOrJunction(dest, rel_target, abs_target).unwrap() catch |symlink_err1| switch (symlink_err1) {
        error.ENOENT => {
            const parent_dir = std.fs.path.dirname(dest) orelse {
                Output.err(symlink_err1, "failed to link: '{s}' -\\> '{s}'", .{
                    dest,
                    rel_target,
                });
                Global.exit(1);
            };

            FD.cwd().makePath(u8, parent_dir) catch {};

            sys.symlinkOrJunction(dest, rel_target, abs_target).unwrap() catch |symlink_err2| {
                Output.err(symlink_err2, "failed to link: '{s}' -\\> '{s}'", .{
                    dest,
                    rel_target,
                });
                Global.exit(1);
            };
        },
        error.EEXIST => {
            FD.cwd().stdDir().deleteTree(dest) catch {};

            sys.symlinkOrJunction(dest, rel_target, abs_target).unwrap() catch |symlink_err2| {
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
            };

            this.manager.thread_pool.schedule(.from(&task.task));
        }

        pub fn startTask(this: *Installer, entry_id: Entry.Id) void {
            const task = this.preallocated_tasks.get();

            task.* = .{
                .entry_id = entry_id,
                .installer = this,
            };

            _ = this.manager.incrementPendingTasks(1);
            this.manager.thread_pool.schedule(.from(&task.task));
        }

        pub fn onPackageExtracted(this: *Installer, task_id: install.Task.Id) void {
            if (this.manager.task_queue.fetchRemove(task_id)) |removed| {
                for (removed.value.items) |install_ctx| {
                    const entry_id = install_ctx.isolated_package_install_context;
                    this.startTask(entry_id);
                }
            }
        }

        pub fn onTask(this: *Installer, task: *Installer.Task) void {
            const entries = this.store.entries.slice();
            const entry_steps = entries.items(.step);
            const step = entry_steps[task.entry_id.get()].load(.monotonic);

            if (step != .done) {
                // only done will unblock other packages
                return;
            }

            this.resumeAvailableTasks();
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

                entry_steps[entry_id.get()].store(.@"symlink dependencies and their binaries", .monotonic);
                this.resumeTask(entry_id);
            }
        }

        const Task = struct {
            const Preallocated = bun.HiveArray(Task, 128).Fallback;

            entry_id: Entry.Id,
            installer: *Installer,

            task: ThreadPool.Task = .{ .callback = &callback },
            next: ?*Task = null,

            const Error = union(enum) {
                oom,

                linking_package,
            };

            pub const Step = enum(u8) {
                link_package,

                // blocked can only happen here

                @"symlink dependencies and their binaries",
                @"run preinstall",

                // pause here while preinstall runs

                binaries,
                @"run (post)install and (pre/post)prepare",

                // pause again while remaining scripts run.

                done,
                blocked,

                pub fn next(this: @This()) @This() {
                    bun.debugAssert(this != .blocked);
                    return @enumFromInt(@intFromEnum(this) + 1);
                }
            };

            fn setStep(this: *Task, new_step: Step) void {
                this.installer.store.entries.items(.step)[this.entry_id.get()].store(new_step, .monotonic);
            }

            fn nextStep(this: *Task) Step {
                const current_step = this.installer.store.entries.items(.step)[this.entry_id.get()].load(.monotonic);
                if (current_step == .done) return .done;

                const next_step = current_step.next();
                this.installer.store.entries.items(.step)[this.entry_id.get()].store(next_step, .monotonic);

                return next_step;
            }

            fn done(this: *Task) void {
                this.installer.tasks.push(this);
                this.installer.manager.decrementPendingTasks();
                this.installer.manager.wake();
            }

            fn pause(this: *Task) void {
                this.installer.tasks.push(this);
                this.installer.manager.wake();
            }

            fn blocked(this: *Task) void {
                // std.debug.print("BLOCKED!!!!!\n", .{});
                this.installer.store.entries.items(.step)[this.entry_id.get()].store(.blocked, .monotonic);
                this.installer.tasks.push(this);
                this.installer.manager.wake();
            }

            fn run(this: *Task) OOM!void {
                const installer = this.installer;

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

                return next_step: switch (installer.store.entries.items(.step)[this.entry_id.get()].load(.monotonic)) {
                    .link_package => {
                        const patch_info = try installer.packagePatchInfo(
                            pkg_name,
                            pkg_name_hash,
                            &pkg_res,
                        );

                        const cache_dir, const cache_dir_path, const pkg_cache_dir_subpath = installer.packageCacheDirAndSubpath(
                            pkg_name,
                            &pkg_res,
                            patch_info,
                        );
                        defer {
                            cache_dir_path.deinit();
                            pkg_cache_dir_subpath.deinit();
                        }

                        var dest_subpath: bun.RelPath(.{ .normalize_slashes = true }) = .init();
                        defer dest_subpath.deinit();

                        installer.appendStorePath(&dest_subpath, this.entry_id);

                        // link the package
                        if (comptime Environment.isMac) {
                            if (install.PackageInstall.supported_method == .clonefile) hardlink_fallback: {
                                switch (sys.clonefileat(cache_dir, pkg_cache_dir_subpath.sliceZ(), FD.cwd(), dest_subpath.sliceZ())) {
                                    .result => {
                                        // success! move to next step
                                        continue :next_step this.nextStep();
                                    },
                                    .err => |err| {
                                        switch (err.getErrno()) {
                                            .XDEV => break :hardlink_fallback,
                                            .OPNOTSUPP => break :hardlink_fallback,
                                            .NOENT => {
                                                const parent_dest_dir = std.fs.path.dirname(dest_subpath.slice()) orelse {
                                                    @panic("TODO: return error.ENOENT back to main thread");
                                                };

                                                FD.cwd().makePath(u8, parent_dest_dir) catch {};

                                                switch (sys.clonefileat(cache_dir, pkg_cache_dir_subpath.sliceZ(), FD.cwd(), dest_subpath.sliceZ())) {
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
                        }

                        var cached_package_dir = (if (comptime Environment.isWindows)
                            bun.openDirNoRenamingOrDeletingWindows(cache_dir, pkg_cache_dir_subpath.sliceZ())
                        else
                            bun.openDir(cache_dir.stdDir(), pkg_cache_dir_subpath.sliceZ())) catch {
                            @panic("TODO: report error");
                        };
                        defer cached_package_dir.close();

                        var walker: Walker = try .walk(
                            cached_package_dir,
                            bun.default_allocator,
                            &.{},
                            &.{},
                        );
                        defer walker.deinit();

                        if (comptime Environment.isWindows) {
                            var src_buf: bun.WPathBuffer = undefined;
                            var src: [:0]u16 = src: {
                                const cache_dir_path_w = bun.strings.toNTPath(&src_buf, strings.withoutTrailingSlash(cache_dir_path.slice()));
                                src_buf[cache_dir_path_w.len] = std.fs.path.sep;
                                const pkg_cache_dir_subpath_w = bun.strings.convertUTF8toUTF16InBufferZ(src_buf[cache_dir_path_w.len + 1 ..], pkg_cache_dir_subpath.slice());
                                src_buf[cache_dir_path_w.len + 1 + pkg_cache_dir_subpath_w.len] = std.fs.path.sep;
                                src_buf[cache_dir_path_w.len + 1 + pkg_cache_dir_subpath_w.len + 1] = 0;
                                break :src src_buf[0 .. cache_dir_path_w.len + 1 + pkg_cache_dir_subpath_w.len + 1 :0];
                            };

                            var dest_buf: bun.WPathBuffer = undefined;
                            var dest: [:0]u16 = bun.strings.convertUTF8toUTF16InBufferZ(&dest_buf, dest_subpath.slice());
                            dest_buf[dest.len] = std.fs.path.sep;
                            dest.len += 1;

                            while (walker.next() catch @panic("todo!")) |entry| {
                                // TODO: add support for utf16 in AbsPath and RelPath
                                const saved_src_len = src.len;
                                defer src.len = saved_src_len;

                                @memcpy(src_buf[src.len..][0..entry.path.len], entry.path);
                                src_buf[src.len + entry.path.len] = 0;
                                src = src_buf[0 .. src.len + entry.path.len :0];

                                const saved_dest_len = dest.len;
                                defer dest.len = saved_dest_len;

                                @memcpy(dest_buf[dest.len..][0..entry.path.len], entry.path);
                                dest_buf[dest.len + entry.path.len] = 0;
                                dest = dest_buf[0 .. dest.len + entry.path.len :0];

                                switch (entry.kind) {
                                    .directory => {
                                        FD.cwd().makePath(u16, dest) catch {};
                                    },
                                    .file => {
                                        if (bun.windows.CreateHardLinkW(dest.ptr, src.ptr, null) != 0) {
                                            continue;
                                        }

                                        switch (bun.windows.GetLastError()) {
                                            .ALREADY_EXISTS, .FILE_EXISTS, .CANNOT_MAKE => {
                                                _ = bun.windows.DeleteFileW(dest.ptr);
                                                if (bun.windows.CreateHardLinkW(dest.ptr, src.ptr, null) != 0) {
                                                    continue;
                                                }
                                            },
                                            .PATH_NOT_FOUND, .FILE_NOT_FOUND, .NOT_FOUND => {
                                                const parent = bun.Dirname.dirname(u16, dest) orelse {
                                                    @panic("failed to create hardlink");
                                                };
                                                FD.cwd().makePath(u16, parent) catch {};

                                                if (bun.windows.CreateHardLinkW(dest.ptr, src.ptr, null) != 0) {
                                                    continue;
                                                }
                                                @panic("hardlink failed!");
                                            },
                                            else => {
                                                @panic("hardlink failed!");
                                            },
                                        }
                                    },
                                    else => {},
                                }
                            }

                            continue :next_step this.nextStep();
                        } else {
                            while (walker.next() catch @panic("todo!")) |entry| {
                                var dest_subpath_save = dest_subpath.save();
                                defer dest_subpath_save.restore();

                                dest_subpath.append(entry.path);

                                switch (entry.kind) {
                                    .directory => {
                                        bun.MakePath.makePath(u8, FD.cwd().stdDir(), dest_subpath.slice()) catch {};
                                    },
                                    .file => {
                                        sys.linkatZ(.fromStdDir(entry.dir), entry.basename, FD.cwd(), dest_subpath.sliceZ()).unwrap() catch |err| {
                                            switch (err) {
                                                error.EEXIST => {
                                                    sys.unlinkat(FD.cwd(), dest_subpath.sliceZ()).unwrap() catch {};
                                                    sys.linkatZ(.fromStdDir(entry.dir), entry.basename, FD.cwd(), dest_subpath.sliceZ()).unwrap() catch {
                                                        @panic("OOOPS!");
                                                    };
                                                },
                                                error.ENOENT => {
                                                    if (dest_subpath.dirname()) |dest_dir_dir_path| {
                                                        bun.MakePath.makePath(u8, FD.cwd().stdDir(), dest_dir_dir_path) catch {};
                                                    }
                                                    sys.linkatZ(.fromStdDir(entry.dir), entry.basename, FD.cwd(), dest_subpath.sliceZ()).unwrap() catch {
                                                        @panic("OOOPS!!");
                                                    };
                                                },
                                                else => {
                                                    @panic("OOPS!");
                                                },
                                            }
                                        };
                                    },
                                    else => {},
                                }
                            }
                            continue :next_step this.nextStep();
                        }

                        unreachable;
                    },
                    .@"symlink dependencies and their binaries" => {
                        {
                            // before dependencies can be symlinked to the node_modules for this package, the dependencies
                            // need to have their binaries linked. Before their binaries can be linked, they need to run their
                            // preinstall scripts. Stop here if any dependencies are not `done`

                            var parent_dedupe: std.AutoArrayHashMap(Entry.Id, void) = .init(bun.default_allocator);
                            defer parent_dedupe.deinit();

                            const dependencies = entry_dependencies[this.entry_id.get()];
                            for (dependencies.slice()) |dep| {
                                if (entry_steps[dep.entry_id.get()].load(.monotonic) != .done) {
                                    if (installer.store.isCycle(this.entry_id, dep.entry_id, &parent_dedupe)) {
                                        parent_dedupe.clearRetainingCapacity();
                                        continue;
                                    }

                                    this.blocked();
                                    return;
                                }
                            }
                        }

                        installer.linkDependencies(this.entry_id);
                        installer.linkDependencyBins(this.entry_id);

                        if (pkg_res.tag != .root and pkg_res.tag != .workspace) hoisted_symlink: {
                            var hidden_hoisted_node_modules: bun.RelPath(.{}) = .init();
                            defer hidden_hoisted_node_modules.deinit();

                            hidden_hoisted_node_modules.append(
                                "node_modules" ++ std.fs.path.sep_str ++ ".bun" ++ std.fs.path.sep_str ++ "node_modules",
                            );
                            hidden_hoisted_node_modules.append(pkg_name.slice(installer.lockfile.buffers.string_bytes.items));

                            var target: bun.RelPath(.{}) = .init();
                            defer target.deinit();

                            target.append("..");
                            if (strings.containsChar(pkg_name.slice(installer.lockfile.buffers.string_bytes.items), '/')) {
                                // assume valid scoped package name
                                target.append("..");
                            }

                            installer.appendEntryPath(&target, this.entry_id);

                            if (comptime Environment.isWindows) {
                                var full_target: bun.AbsPath(.{}) = .initTopLevelDir();
                                defer full_target.deinit();

                                installer.appendStorePath(&full_target, this.entry_id);

                                sys.symlinkOrJunction(hidden_hoisted_node_modules.sliceZ(), target.sliceZ(), full_target.sliceZ()).unwrap() catch |err| switch (err) {
                                    error.ENOENT => {
                                        bun.MakePath.makePath(u8, FD.cwd().stdDir(), hidden_hoisted_node_modules.dirname() orelse unreachable) catch {
                                            break :hoisted_symlink;
                                        };
                                        sys.symlinkOrJunction(hidden_hoisted_node_modules.sliceZ(), target.sliceZ(), full_target.sliceZ()).unwrap() catch {
                                            break :hoisted_symlink;
                                        };
                                    },
                                    else => {
                                        break :hoisted_symlink;
                                    },
                                };
                            } else {
                                sys.symlink(target.sliceZ(), hidden_hoisted_node_modules.sliceZ()).unwrap() catch |err| switch (err) {
                                    error.ENOENT => {
                                        bun.MakePath.makePath(u8, FD.cwd().stdDir(), hidden_hoisted_node_modules.dirname() orelse unreachable) catch {
                                            break :hoisted_symlink;
                                        };
                                        sys.symlink(target.sliceZ(), hidden_hoisted_node_modules.sliceZ()).unwrap() catch {
                                            break :hoisted_symlink;
                                        };
                                    },
                                    else => {
                                        break :hoisted_symlink;
                                    },
                                };
                            }
                        }

                        continue :next_step this.nextStep();
                    },
                    .@"run preinstall" => {
                        if (!installer.manager.options.do.run_scripts or this.entry_id == .root) {
                            continue :next_step this.nextStep();
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

                        var pkg_cwd: bun.AbsPath(.{ .normalize_slashes = true }) = .initTopLevelDir();
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
                            ) catch {
                                @panic("ooops!");
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
                                    continue :next_step this.nextStep();
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
                                ) catch {
                                    @panic("ooops!");
                                };

                                this.pause();
                                return;
                            }
                        }

                        continue :next_step this.nextStep();
                    },
                    .binaries => {
                        if (this.entry_id == .root) {
                            continue :next_step this.nextStep();
                        }

                        const bin = pkg_bins[pkg_id];
                        if (bin.tag == .none) {
                            continue :next_step this.nextStep();
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

                        installer.appendStorePath(&node_modules_path, this.entry_id);

                        node_modules_path.append("node_modules");

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

                        if (bin_linker.err != null) {
                            @panic("TODOO ERROR");
                        }

                        continue :next_step this.nextStep();
                    },
                    .@"run (post)install and (pre/post)prepare" => {
                        if (!installer.manager.options.do.run_scripts or this.entry_id == .root) {
                            continue :next_step this.nextStep();
                        }

                        var list = entry_scripts[this.entry_id.get()] orelse {
                            continue :next_step this.nextStep();
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
                            continue :next_step this.nextStep();
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
                        ) catch {
                            @panic("ooops!");
                        };

                        this.pause();
                        return;
                    },

                    .done => {
                        this.done();
                        return;
                    },

                    .blocked => {
                        bun.debugAssert(false);
                        this.done();
                        return;
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

        pub fn packageCacheDirAndSubpath(
            this: *Installer,
            pkg_name: String,
            pkg_res: *const Resolution,
            patch_info: PatchInfo,
        ) struct { FD, bun.AbsPath(.{}), bun.RelPath(.{ .normalize_slashes = true }) } {
            const string_buf = this.lockfile.buffers.string_bytes.items;

            const subpath = switch (pkg_res.tag) {
                .npm => this.manager.cachedNPMPackageFolderName(pkg_name.slice(string_buf), pkg_res.value.npm.version, patch_info.contentsHash()),
                .git => this.manager.cachedGitFolderName(&pkg_res.value.git, patch_info.contentsHash()),
                .github => this.manager.cachedGitHubFolderName(&pkg_res.value.github, patch_info.contentsHash()),
                .local_tarball => this.manager.cachedTarballFolderName(pkg_res.value.local_tarball, patch_info.contentsHash()),
                .remote_tarball => this.manager.cachedTarballFolderName(pkg_res.value.remote_tarball, patch_info.contentsHash()),

                // should never reach this function. they aren't cached!
                .workspace => unreachable,
                .root => unreachable,
                .folder => unreachable,
                .symlink => unreachable,

                else => {
                    @panic("oops!!!!");
                },
            };

            const cache_dir, const abs_cache_dir_path = this.manager.getCacheDirectoryAndAbsPath();

            return .{ .fromStdDir(cache_dir), .init(abs_cache_dir_path), .from(subpath) };
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

        pub fn linkDependencyBins(this: *const Installer, parent_entry_id: Entry.Id) void {
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

                if (bin_linker.err != null) {

                    // Output.err(err, "failed to link binary in '{s}' for {s}@{}", .{
                    //     node_modules_path.slice(),
                    //     pkg_names[pkg_id].slice(string_buf),
                    //     pkg_resolutions[pkg_id].fmt(string_buf, .posix),
                    // });
                    // Global.exit(1);
                    @panic("TODO bin link error");
                }
            }
        }

        fn linkDependencies(this: *const Installer, entry_id: Entry.Id) void {
            const lockfile = this.lockfile;
            const store = this.store;

            const string_buf = lockfile.buffers.string_bytes.items;
            const dependencies = lockfile.buffers.dependencies.items;

            const entries = store.entries.slice();
            const entry_node_ids = entries.items(.node_id);
            const entry_dependency_lists = entries.items(.dependencies);

            const nodes_slice = store.nodes.slice();
            // const node_pkg_ids = nodes_slice.items(.pkg_id);
            const node_dep_ids = nodes_slice.items(.dep_id);
            // const node_peers = nodes_slice.items(.peers);

            // const pkgs = lockfile.packages.slice();
            // const pkg_names = pkgs.items(.name);
            // const pkg_resolutions = pkgs.items(.resolution);

            for (entry_dependency_lists[entry_id.get()].slice()) |dep| {
                // link the dep from the store's node_modules to the dep store entry

                const dep_node_id = entry_node_ids[dep.entry_id.get()];
                const dep_id = node_dep_ids[dep_node_id.get()];
                const dep_name = dependencies[dep_id].name.slice(string_buf);

                var dest: bun.AbsPath(.{ .normalize_slashes = true }) = .initTopLevelDir();
                defer dest.deinit();

                this.appendStoreNodeModulesPath(&dest, entry_id);
                dest.append(dep_name);

                var dep_store_path: bun.AbsPath(.{ .normalize_slashes = true }) = .initTopLevelDir();
                defer dep_store_path.deinit();

                this.appendStorePath(&dep_store_path, dep.entry_id);

                var target: bun.RelPath(.{ .normalize_slashes = true }) = .init();
                defer target.deinit();

                {
                    var dest_save = dest.save();
                    defer dest_save.restore();

                    dest.undo(1);
                    dest.relative(&dep_store_path, &target);
                }

                if (comptime Environment.isWindows) {
                    ensureSymlink(target.sliceZ(), dep_store_path.sliceZ(), dest.sliceZ());
                } else {
                    ensureSymlink(target.sliceZ(), dest.sliceZ());
                }
            }
        }

        pub fn appendStoreNodeModulesPath(this: *const Installer, buf: anytype, entry_id: Entry.Id) void {
            const string_buf = this.lockfile.buffers.string_bytes.items;

            const entries = this.store.entries.slice();
            const entry_node_ids = entries.items(.node_id);

            const nodes = this.store.nodes.slice();
            const node_pkg_ids = nodes.items(.pkg_id);
            const node_peers = nodes.items(.peers);

            const pkgs = this.lockfile.packages.slice();
            const pkg_names = pkgs.items(.name);
            const pkg_resolutions = pkgs.items(.resolution);

            const node_id = entry_node_ids[entry_id.get()];
            const peers = node_peers[node_id.get()];
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
                    const pkg_name = pkg_names[pkg_id];
                    buf.appendFmt("node_modules/" ++ modules_dir_name ++ "/{s}@{}{}/node_modules", .{
                        pkg_name.fmtStorePath(string_buf),
                        pkg_res.fmt(string_buf, .posix),
                        Node.TransitivePeer.fmtStorePath(peers.list.items, string_buf, pkg_names, pkg_resolutions),
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
            const node_peers = nodes.items(.peers);

            const pkgs = this.lockfile.packages.slice();
            const pkg_names = pkgs.items(.name);
            const pkg_resolutions = pkgs.items(.resolution);

            const node_id = entry_node_ids[entry_id.get()];
            const peers = node_peers[node_id.get()];
            const pkg_id = node_pkg_ids[node_id.get()];
            const pkg_res = pkg_resolutions[pkg_id];

            switch (pkg_res.tag) {
                .root => {},
                .workspace => {
                    buf.append(pkg_res.value.workspace.slice(string_buf));
                },
                else => {
                    const pkg_name = pkg_names[pkg_id];
                    buf.appendFmt("node_modules/" ++ modules_dir_name ++ "/{s}@{}{}/node_modules/{s}", .{
                        pkg_name.fmtStorePath(string_buf),
                        pkg_res.fmt(string_buf, .posix),
                        Node.TransitivePeer.fmtStorePath(peers.list.items, string_buf, pkg_names, pkg_resolutions),
                        pkg_name.slice(string_buf),
                    });
                },
            }
        }

        pub fn appendEntryPath(this: *const Installer, buf: anytype, entry_id: Entry.Id) void {
            const string_buf = this.lockfile.buffers.string_bytes.items;

            const entries = this.store.entries.slice();
            const entry_node_ids = entries.items(.node_id);

            const nodes = this.store.nodes.slice();
            const node_pkg_ids = nodes.items(.pkg_id);
            const node_peers = nodes.items(.peers);

            const pkgs = this.lockfile.packages.slice();
            const pkg_names = pkgs.items(.name);
            const pkg_resolutions = pkgs.items(.resolution);

            const node_id = entry_node_ids[entry_id.get()];
            const peers = node_peers[node_id.get()];
            const pkg_id = node_pkg_ids[node_id.get()];
            const pkg_res = pkg_resolutions[pkg_id];

            switch (pkg_res.tag) {
                .root => {},
                .workspace => {},
                else => {
                    const pkg_name = pkg_names[pkg_id];
                    buf.appendFmt("{s}@{}{}/node_modules/{s}", .{
                        pkg_name.fmtStorePath(string_buf),
                        pkg_res.fmt(string_buf, .posix),
                        Node.TransitivePeer.fmtStorePath(peers.list.items, string_buf, pkg_names, pkg_resolutions),
                        pkg_name.slice(string_buf),
                    });
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

        scripts: ?*Package.Scripts.List = null,

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
