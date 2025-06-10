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
const path = bun.path;
const DependencySlice = Lockfile.DependencySlice;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
const Tree = Lockfile.Tree;
const PackageNameHash = install.PackageNameHash;

const IsolatedInstaller = struct {
    manager: *PackageManager,
    lockfile: *Lockfile,

    root_node_modules_dir: FD,
    is_new_root_node_modules_dir: bool,
    bun_modules_dir: FD,
    is_new_bun_modules_dir: bool,

    // workspace_dir: FD,
    // workspace_node_modules_dir: FD,
    // is_new_workspace_node_modules: bool,

    cwd_path: bun.AbsPath(.{}),
    bun_modules_path: bun.AbsPath(.{}),

    pub fn deinit(this: *IsolatedInstaller) void {
        this.cwd_path.deinit();
        this.bun_modules_path.deinit();
    }
};

pub fn installIsolatedPackages(manager: *PackageManager, install_root_dependencies: bool, workspace_filters: []const WorkspaceFilter) OOM!PackageInstall.Summary {
    _ = install_root_dependencies;
    _ = workspace_filters;
    bun.Analytics.Features.isolated_bun_install += 1;

    const original_trees = manager.lockfile.buffers.trees;
    const original_tree_dep_ids = manager.lockfile.buffers.hoisted_dependencies;

    // manager.lockfile.isolate(
    //     manager.log,
    //     manager,
    //     install_root_dependencies,
    //     workspace_filters,
    // ) catch |err| switch (err) {
    //     error.OutOfMemory => |oom| return oom,
    //     error.DependencyLoop => {
    //         @panic("oops!");
    //     },
    // };

    defer {
        manager.lockfile.buffers.trees = original_trees;
        manager.lockfile.buffers.hoisted_dependencies = original_tree_dep_ids;
    }

    const lockfile = manager.lockfile;

    const cwd = FD.cwd();

    const node_modules_path = bun.OSPathLiteral("node_modules");

    const root_node_modules_dir, const is_new_root_node_modules, const bun_modules_dir, const is_new_bun_modules = root_dirs: {
        const bun_modules_path = bun.OSPathLiteral("node_modules/.bun");
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

    const cwd_path: bun.AbsPath(.{}) = .init(FileSystem.instance.top_level_dir);
    var bun_modules_path = cwd_path.clone();
    bun_modules_path.append("node_modules/.bun");

    var ctx: IsolatedInstaller = .{
        .manager = manager,
        .lockfile = lockfile,

        .root_node_modules_dir = root_node_modules_dir,
        .is_new_root_node_modules_dir = is_new_root_node_modules,
        .bun_modules_dir = bun_modules_dir,
        .is_new_bun_modules_dir = is_new_bun_modules,

        .cwd_path = cwd_path.move(),
        .bun_modules_path = bun_modules_path.move(),
    };
    defer ctx.deinit();

    {
        var timer = std.time.Timer.start() catch unreachable;
        const pkgs = lockfile.packages.slice();
        const pkg_dependency_slices = pkgs.items(.dependencies);
        const pkg_resolutions = pkgs.items(.resolution);
        const pkg_names = pkgs.items(.name);

        const resolutions = lockfile.buffers.resolutions.items;
        const dependencies = lockfile.buffers.dependencies.items;
        const string_buf = lockfile.buffers.string_bytes.items;

        var nodes: Store.Node.List = .empty;

        const NodeEntry = struct {
            parent_id: Store.Node.Id,
            dep_id: DependencyID,
            pkg_id: PackageID,
        };

        var node_queue: std.fifo.LinearFifo(NodeEntry, .Dynamic) = .init(lockfile.allocator);
        defer node_queue.deinit();

        try node_queue.writeItem(.{
            .parent_id = .invalid,
            .dep_id = invalid_dependency_id,
            .pkg_id = 0,
        });

        var peer_dep_ids: std.ArrayListUnmanaged(DependencyID) = .empty;
        defer peer_dep_ids.deinit(lockfile.allocator);

        var visited_node_ids: std.ArrayListUnmanaged(Store.Node.Id) = .empty;
        defer visited_node_ids.deinit(lockfile.allocator);

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
                        // skip the node, but add the dependency so it appears in
                        // `node_modules/.bun/name@version/node_modules`
                        try node_nodes[entry.parent_id.get()].append(lockfile.allocator, curr_id);
                        continue :node_queue;
                    }
                    curr_id = node_parent_ids[curr_id.get()];
                }
            }

            const node_id: Store.Node.Id = .from(@intCast(nodes.len));
            try nodes.append(lockfile.allocator, .{
                .pkg_id = entry.pkg_id,
                .dep_id = entry.dep_id,
                .parent_id = entry.parent_id,
                .nodes = .empty,
            });

            const nodes_slice = nodes.slice();
            const node_parent_ids = nodes_slice.items(.parent_id);
            const node_dependencies = nodes_slice.items(.dependencies);
            const node_peers = nodes_slice.items(.peers);
            const node_nodes = nodes_slice.items(.nodes);

            if (entry.parent_id != .invalid) {
                try node_nodes[entry.parent_id.get()].append(lockfile.allocator, node_id);
            }

            const pkg_deps = pkg_dependency_slices[entry.pkg_id];

            peer_dep_ids.clearRetainingCapacity();

            for (pkg_deps.begin()..pkg_deps.end()) |_dep_id| {
                const dep_id: DependencyID = @intCast(_dep_id);

                const pkg_id = resolutions[dep_id];

                if (pkg_id >= pkgs.len) {
                    continue;
                }

                const dep = dependencies[dep_id];

                // TODO: handle duplicate dependencies. should be similar logic
                // like we have for dev dependencies in `hoistDependency`

                if (!dep.behavior.isPeer()) {
                    // simple case:
                    // - add it as a dependency
                    // - queue it
                    try node_dependencies[node_id.get()].append(lockfile.allocator, .{ .dep_id = dep_id, .pkg_id = pkg_id });
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

                    visited_node_ids.clearRetainingCapacity();
                    while (curr_id != .invalid) {
                        try visited_node_ids.append(lockfile.allocator, curr_id);

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
                                _ = visited_node_ids.pop();
                                break :resolved_pkg_id .{ ids.pkg_id, true };
                            }

                            // add the remaining parent ids
                            curr_id = node_parent_ids[curr_id.get()];
                            while (curr_id != .invalid) {
                                try visited_node_ids.append(lockfile.allocator, curr_id);
                                curr_id = node_parent_ids[curr_id.get()];
                            }

                            break :resolved_pkg_id .{ best_version, true };
                        }

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

                for (visited_node_ids.items) |visited_parent_id| {
                    try node_peers[visited_parent_id.get()].append(
                        lockfile.allocator,
                        .{
                            .dep_id = peer_dep_id,
                            .pkg_id = resolved_pkg_id,
                            .auto_installed = auto_installed,
                        },
                        .{
                            .string_buf = string_buf,
                            .pkg_names = pkg_names,
                        },
                    );
                }

                if (visited_node_ids.items.len != 1) {
                    // visited parents length == 1 means the node satisfied it's own
                    // peer. don't queue.
                    try node_dependencies[node_id.get()].append(lockfile.allocator, .{ .dep_id = peer_dep_id, .pkg_id = resolved_pkg_id });
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

        const PlacedInfo = struct {
            store_id: Store.Entry.Id,
            peers: Store.Node.TransitivePeer.OrderedList,
        };

        var placed: std.AutoHashMap(PackageID, std.ArrayListUnmanaged(PlacedInfo)) = .init(lockfile.allocator);
        defer placed.deinit();

        const nodes_slice = nodes.slice();
        const node_pkg_ids = nodes_slice.items(.pkg_id);
        const node_dep_ids = nodes_slice.items(.dep_id);
        const node_peers = nodes_slice.items(.peers);
        const node_nodes = nodes_slice.items(.nodes);

        var store: Store.Entry.List = .empty;

        var store_queue: std.fifo.LinearFifo(struct { node_id: Store.Node.Id, store_parent_id: Store.Entry.Id }, .Dynamic) = .init(lockfile.allocator);
        defer store_queue.deinit();

        try store_queue.writeItem(.{
            .node_id = .from(0),
            .store_parent_id = .invalid,
        });

        // Second pass: deduplicate nodes when the pkg_id and peer set match an existing entry
        next_store: while (store_queue.readItem()) |entry| {
            const pkg_id = node_pkg_ids[entry.node_id.get()];

            const placed_entry = try placed.getOrPut(pkg_id);
            if (!placed_entry.found_existing) {
                placed_entry.value_ptr.* = .{};
            } else {
                const curr_peers = node_peers[entry.node_id.get()];
                for (placed_entry.value_ptr.items) |info| {
                    if (info.peers.eql(&curr_peers)) {
                        // dedupe!
                        store.items(.dependencies)[entry.store_parent_id.get()].appendAssumeCapacity(info.store_id);
                        continue :next_store;
                    }
                }

                // nothing matched - create a new entry
            }

            const new_entry_dep_id = node_dep_ids[entry.node_id.get()];
            const new_entry_dep_name: String = if (new_entry_dep_id == invalid_dependency_id)
                .{}
            else
                dependencies[new_entry_dep_id].name;

            const new_entry: Store.Entry = .{
                .pkg_id = pkg_id,
                .dep_name = new_entry_dep_name,
                .parent_id = entry.store_parent_id,
                // starts empty, filled when visiting the dependencies
                .dependencies = try .initCapacity(lockfile.allocator, node_nodes[entry.node_id.get()].items.len),
            };

            const store_id: Store.Entry.Id = .from(@intCast(store.len));
            try store.append(lockfile.allocator, new_entry);

            if (entry.store_parent_id.tryGet()) |store_parent_id| {
                store.items(.dependencies)[store_parent_id].appendAssumeCapacity(store_id);
            }

            try placed_entry.value_ptr.append(lockfile.allocator, .{
                .store_id = store_id,
                .peers = node_peers[entry.node_id.get()],
            });

            for (node_nodes[entry.node_id.get()].items) |node_id| {
                try store_queue.writeItem(.{
                    .node_id = node_id,
                    .store_parent_id = store_id,
                });
            }
        }

        const dedupe_end = timer.read();

        // Store.Entry.debugPrintList(&store, lockfile);

        std.debug.print(
            \\Build tree: [{}]
            \\Deduplicate tree: [{}]
            \\Total: [{}]
            \\
        , .{
            bun.fmt.fmtDurationOneDecimal(full_tree_end),
            bun.fmt.fmtDurationOneDecimal(dedupe_end),
            bun.fmt.fmtDurationOneDecimal(full_tree_end + dedupe_end),
        });
    }

    // TODO: install with `store`

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
        /// Dependency the package originates from. Using `dep_name`
        /// instead of `dep_id` because entries are deduplicated and
        /// may not share the same dependency (name will be the same though)
        dep_name: String,
        /// The resolved package
        pkg_id: PackageID,

        parent_id: Id,
        dependencies: std.ArrayListUnmanaged(Id) = .empty,

        pub const List = bun.MultiArrayList(Entry);

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

    // A possibly non-unique node used to represent the full dependency tree
    pub const Node = struct {
        dep_id: DependencyID,
        pkg_id: PackageID,
        parent_id: Id,
        dependencies: std.ArrayListUnmanaged(Ids) = .empty,

        peers: TransitivePeer.OrderedList = .{},
        nodes: std.ArrayListUnmanaged(Id) = .empty,

        const TransitivePeer = struct {
            dep_id: DependencyID,
            pkg_id: PackageID,
            auto_installed: bool,

            pub const OrderedList = struct {
                list: std.ArrayListUnmanaged(TransitivePeer) = .empty,

                pub fn deinit(this: *const OrderedList, allocator: std.mem.Allocator) void {
                    this.list.deinit(allocator);
                }

                pub fn eql(l: *const OrderedList, r: *const OrderedList) bool {
                    if (l.list.items.len != r.list.items.len) {
                        return false;
                    }

                    for (l.list.items, r.list.items) |l_item, r_item| {
                        if (l_item.pkg_id != r_item.pkg_id) {
                            return false;
                        }
                    }

                    return true;
                }

                pub fn contains(this: *const OrderedList, item: TransitivePeer, context: anytype) bool {
                    for (this.list.items) |existing| {
                        if (context.eql(item, existing)) {
                            return true;
                        }
                    }
                    return false;
                }

                pub fn append(
                    this: *OrderedList,
                    allocator: std.mem.Allocator,
                    new: TransitivePeer,
                    bufs: struct {
                        string_buf: string,
                        pkg_names: []const String,
                    },
                ) OOM!void {
                    const new_pkg_name = bufs.pkg_names[new.pkg_id];
                    for (0..this.list.items.len) |i| {
                        const existing = this.list.items[i];
                        if (new.pkg_id == existing.pkg_id) {
                            return;
                        }

                        const existing_pkg_name = bufs.pkg_names[existing.pkg_id];

                        const order = new_pkg_name.order(&existing_pkg_name, bufs.string_buf, bufs.string_buf);

                        bun.debugAssert(order != .eq);

                        if (order == .lt) {
                            try this.list.insert(allocator, i, new);
                            return;
                        }
                    }

                    try this.list.append(allocator, new);
                }
            };
        };

        pub const List = bun.MultiArrayList(Node);

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
