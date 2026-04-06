const Ids = struct {
    dep_id: DependencyID,
    pkg_id: PackageID,
};

pub const Store = struct {
    /// Accessed from multiple threads
    entries: Entry.List,
    nodes: Node.List,

    const log = Output.scoped(.Store, .visible);

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
            bun.handleOom(parent_dedupe.put(parent_id, {}));
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
                bun.handleOom(parent_dedupe.put(parent_id, {}));
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

        // if true this entry gets symlinked to `node_modules/.bun/node_modules`
        hoisted: bool,

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

            pub fn format(this: @This(), writer: *std.Io.Writer) std.Io.Writer.Error!void {
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
                    .root => {
                        if (pkg_name.isEmpty()) {
                            try writer.writeAll(std.fs.path.basename(bun.fs.FileSystem.instance.top_level_dir));
                        } else {
                            try writer.print("{f}@root", .{
                                pkg_name.fmtStorePath(string_buf),
                            });
                        }
                    },
                    .folder => {
                        try writer.print("{f}@file+{f}", .{
                            pkg_name.fmtStorePath(string_buf),
                            pkg_res.value.folder.fmtStorePath(string_buf),
                        });
                    },
                    else => {
                        try writer.print("{f}@{f}", .{
                            pkg_name.fmtStorePath(string_buf),
                            pkg_res.fmtStorePath(string_buf),
                        });
                    },
                }

                if (peer_hash != .none) {
                    try writer.print("+{f}", .{
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
                bun.handleOom(parents.put(bun.default_allocator, parent_id, {}));
            }

            len = parents.count();
            while (i < len) {
                for (entry_parents[parents.entries.items(.key)[i].get()].items) |parent_id| {
                    if (parent_id == .invalid) {
                        continue;
                    }
                    bun.handleOom(parents.put(bun.default_allocator, parent_id, {}));
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
            auto_installed: bool,

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

const Semver = bun.Semver;
const String = Semver.String;

const install = bun.install;
const Dependency = install.Dependency;
const DependencyID = install.DependencyID;
const PackageID = install.PackageID;
const invalid_dependency_id = install.invalid_dependency_id;

const Lockfile = install.Lockfile;
const Package = Lockfile.Package;
