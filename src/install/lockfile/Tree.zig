id: Id = invalid_id,

// Should not be used for anything other than name
// through `folderName()`. There is not guarantee a dependency
// id chosen for a tree node is the same behavior or has the
// same version literal for packages hoisted.
dependency_id: DependencyID = invalid_dependency_id,

parent: Id = invalid_id,
dependencies: Lockfile.DependencyIDSlice = .{},

pub const external_size = @sizeOf(Id) + @sizeOf(PackageID) + @sizeOf(Id) + @sizeOf(Lockfile.DependencyIDSlice);
pub const External = [external_size]u8;
pub const Slice = ExternalSlice(Tree);
pub const List = std.ArrayListUnmanaged(Tree);
pub const Id = u32;

pub fn folderName(this: *const Tree, deps: []const Dependency, buf: string) string {
    const dep_id = this.dependency_id;
    if (dep_id == invalid_dependency_id) return "";
    return deps[dep_id].name.slice(buf);
}

pub fn toExternal(this: Tree) External {
    var out = External{};
    out[0..4].* = @as(Id, @bitCast(this.id));
    out[4..8].* = @as(Id, @bitCast(this.dependency_id));
    out[8..12].* = @as(Id, @bitCast(this.parent));
    out[12..16].* = @as(u32, @bitCast(this.dependencies.off));
    out[16..20].* = @as(u32, @bitCast(this.dependencies.len));
    if (out.len != 20) @compileError("Tree.External is not 20 bytes");
    return out;
}

pub fn toTree(out: External) Tree {
    return .{
        .id = @bitCast(out[0..4].*),
        .dependency_id = @bitCast(out[4..8].*),
        .parent = @bitCast(out[8..12].*),
        .dependencies = .{
            .off = @bitCast(out[12..16].*),
            .len = @bitCast(out[16..20].*),
        },
    };
}

pub const root_dep_id: DependencyID = invalid_package_id - 1;
pub const invalid_id: Id = std.math.maxInt(Id);

pub const HoistDependencyResult = union(enum) {
    dependency_loop,
    hoisted,
    placement: struct {
        id: Id,
        bundled: bool = false,
    },
    // replace: struct {
    //     dest_id: Id,
    //     dep_id: DependencyID,
    // },
};

pub const SubtreeError = OOM || error{DependencyLoop};

// max number of node_modules folders
pub const max_depth = (bun.MAX_PATH_BYTES / "node_modules".len) + 1;

pub const DepthBuf = [max_depth]Id;

const IteratorPathStyle = enum {
    /// `relative_path` will have the form `node_modules/jquery/node_modules/zod`.
    /// Path separators are platform.
    node_modules,
    /// `relative_path` will have the form `jquery/zod`. Path separators are always
    /// posix separators.
    pkg_path,
};

pub fn Iterator(comptime path_style: IteratorPathStyle) type {
    return struct {
        tree_id: Id,
        path_buf: bun.PathBuffer = undefined,

        lockfile: *const Lockfile,

        depth_stack: DepthBuf = undefined,

        pub fn init(lockfile: *const Lockfile) @This() {
            var iter: @This() = .{
                .tree_id = 0,
                .lockfile = lockfile,
            };
            if (comptime path_style == .node_modules) {
                @memcpy(iter.path_buf[0.."node_modules".len], "node_modules");
            }
            return iter;
        }

        pub fn reset(this: *@This()) void {
            this.tree_id = 0;
        }

        pub const Next = struct {
            relative_path: stringZ,
            dependencies: []const DependencyID,
            tree_id: Tree.Id,

            /// depth of the node_modules folder in the tree
            ///
            ///            0 (./node_modules)
            ///           / \
            ///          1   1
            ///         /
            ///        2
            depth: usize,
        };

        pub fn next(this: *@This(), completed_trees: if (path_style == .node_modules) ?*Bitset else void) ?Next {
            const trees = this.lockfile.buffers.trees.items;

            if (this.tree_id >= trees.len) return null;

            while (trees[this.tree_id].dependencies.len == 0) {
                if (comptime path_style == .node_modules) {
                    if (completed_trees) |_completed_trees| {
                        _completed_trees.set(this.tree_id);
                    }
                }
                this.tree_id += 1;
                if (this.tree_id >= trees.len) return null;
            }

            const current_tree_id = this.tree_id;
            const tree = trees[current_tree_id];
            const tree_dependencies = tree.dependencies.get(this.lockfile.buffers.hoisted_dependencies.items);

            const relative_path, const depth = relativePathAndDepth(
                this.lockfile,
                current_tree_id,
                &this.path_buf,
                &this.depth_stack,
                path_style,
            );

            this.tree_id += 1;

            return .{
                .relative_path = relative_path,
                .dependencies = tree_dependencies,
                .tree_id = current_tree_id,
                .depth = depth,
            };
        }
    };
}

/// Returns relative path and the depth of the tree
pub fn relativePathAndDepth(
    lockfile: *const Lockfile,
    tree_id: Id,
    path_buf: *bun.PathBuffer,
    depth_buf: *DepthBuf,
    comptime path_style: IteratorPathStyle,
) struct { stringZ, usize } {
    const trees = lockfile.buffers.trees.items;
    var depth: usize = 0;

    const tree = trees[tree_id];

    var parent_id = tree.id;
    var path_written: usize = switch (comptime path_style) {
        .node_modules => "node_modules".len,
        .pkg_path => 0,
    };

    depth_buf[0] = 0;

    if (tree.id > 0) {
        const dependencies = lockfile.buffers.dependencies.items;
        const buf = lockfile.buffers.string_bytes.items;
        var depth_buf_len: usize = 1;

        while (parent_id > 0 and parent_id < trees.len) {
            depth_buf[depth_buf_len] = parent_id;
            parent_id = trees[parent_id].parent;
            depth_buf_len += 1;
        }

        depth_buf_len -= 1;

        depth = depth_buf_len;
        while (depth_buf_len > 0) : (depth_buf_len -= 1) {
            if (comptime path_style == .pkg_path) {
                if (depth_buf_len != depth) {
                    path_buf[path_written] = '/';
                    path_written += 1;
                }
            } else {
                path_buf[path_written] = std.fs.path.sep;
                path_written += 1;
            }

            const id = depth_buf[depth_buf_len];
            const name = trees[id].folderName(dependencies, buf);
            @memcpy(path_buf[path_written..][0..name.len], name);
            path_written += name.len;

            if (comptime path_style == .node_modules) {
                @memcpy(path_buf[path_written..][0.."/node_modules".len], std.fs.path.sep_str ++ "node_modules");
                path_written += "/node_modules".len;
            }
        }
    }
    path_buf[path_written] = 0;
    const rel = path_buf[0..path_written :0];

    return .{ rel, depth };
}

pub const BuilderMethod = enum {
    /// Hoist, but include every dependency so it's resolvable if configuration
    /// changes. For saving to disk.
    resolvable,

    /// This will filter out disabled dependencies, resulting in more aggresive
    /// hoisting compared to `hoist()`. We skip dependencies based on 'os', 'cpu',
    /// 'libc' (TODO), and omitted dependency types (`--omit=dev/peer/optional`).
    /// Dependencies of a disabled package are not included in the output.
    filter,
};

pub fn Builder(comptime method: BuilderMethod) type {
    return struct {
        allocator: Allocator,
        name_hashes: []const PackageNameHash,
        list: bun.MultiArrayList(Entry) = .{},
        resolutions: []const PackageID,
        dependencies: []const Dependency,
        resolution_lists: []const Lockfile.DependencyIDSlice,
        queue: TreeFiller,
        log: *logger.Log,
        lockfile: *const Lockfile,
        manager: if (method == .filter) *const PackageManager else void,
        sort_buf: std.ArrayListUnmanaged(DependencyID) = .{},
        workspace_filters: if (method == .filter) []const WorkspaceFilter else void = if (method == .filter) &.{},
        install_root_dependencies: if (method == .filter) bool else void,
        path_buf: []u8,

        pub fn maybeReportError(this: *@This(), comptime fmt: string, args: anytype) void {
            this.log.addErrorFmt(null, logger.Loc.Empty, this.allocator, fmt, args) catch {};
        }

        pub fn buf(this: *const @This()) []const u8 {
            return this.lockfile.buffers.string_bytes.items;
        }

        pub fn packageName(this: *@This(), id: PackageID) String.Formatter {
            return this.lockfile.packages.items(.name)[id].fmt(this.lockfile.buffers.string_bytes.items);
        }

        pub fn packageVersion(this: *@This(), id: PackageID) Resolution.Formatter {
            return this.lockfile.packages.items(.resolution)[id].fmt(this.lockfile.buffers.string_bytes.items, .auto);
        }

        pub const Entry = struct {
            tree: Tree,
            dependencies: Lockfile.DependencyIDList,
        };

        pub const CleanResult = struct {
            trees: std.ArrayListUnmanaged(Tree),
            dep_ids: std.ArrayListUnmanaged(DependencyID),
        };

        /// Flatten the multi-dimensional ArrayList of package IDs into a single easily serializable array
        pub fn clean(this: *@This()) OOM!CleanResult {
            var total: u32 = 0;

            const list_ptr = this.list.bytes;
            const slice = this.list.toOwnedSlice();
            var trees = slice.items(.tree);
            const dependencies = slice.items(.dependencies);

            for (trees) |*tree| {
                total += tree.dependencies.len;
            }

            var dependency_ids = try DependencyIDList.initCapacity(z_allocator, total);
            var next = PackageIDSlice{};

            for (trees, dependencies) |*tree, *child| {
                if (tree.dependencies.len > 0) {
                    const len = @as(PackageID, @truncate(child.items.len));
                    next.off += next.len;
                    next.len = len;
                    tree.dependencies = next;
                    dependency_ids.appendSliceAssumeCapacity(child.items);
                    child.deinit(this.allocator);
                }
            }
            this.queue.deinit();
            this.sort_buf.deinit(this.allocator);

            // take over the `builder.list` pointer for only trees
            if (@intFromPtr(trees.ptr) != @intFromPtr(list_ptr)) {
                var new: [*]Tree = @ptrCast(list_ptr);
                bun.copy(Tree, new[0..trees.len], trees);
                trees = new[0..trees.len];
            }

            return .{
                .trees = std.ArrayListUnmanaged(Tree).fromOwnedSlice(trees),
                .dep_ids = dependency_ids,
            };
        }
    };
}

pub fn processSubtree(
    this: *const Tree,
    dependency_id: DependencyID,
    hoist_root_id: Tree.Id,
    comptime method: BuilderMethod,
    builder: *Builder(method),
    log_level: if (method == .filter) PackageManager.Options.LogLevel else void,
) SubtreeError!void {
    const parent_pkg_id = switch (dependency_id) {
        root_dep_id => 0,
        else => |id| builder.resolutions[id],
    };
    const resolution_list = builder.resolution_lists[parent_pkg_id];

    if (resolution_list.len == 0) return;

    try builder.list.append(builder.allocator, .{
        .tree = .{
            .parent = this.id,
            .id = @as(Id, @truncate(builder.list.len)),
            .dependency_id = dependency_id,
        },
        .dependencies = .{},
    });

    const list_slice = builder.list.slice();
    const trees = list_slice.items(.tree);
    const dependency_lists = list_slice.items(.dependencies);
    const next: *Tree = &trees[builder.list.len - 1];
    const name_hashes: []const PackageNameHash = builder.name_hashes;
    const max_package_id = @as(PackageID, @truncate(name_hashes.len));

    const pkgs = builder.lockfile.packages.slice();
    const pkg_resolutions = pkgs.items(.resolution);
    const pkg_metas = pkgs.items(.meta);
    const pkg_names = pkgs.items(.name);

    builder.sort_buf.clearRetainingCapacity();
    try builder.sort_buf.ensureUnusedCapacity(builder.allocator, resolution_list.len);

    for (resolution_list.begin()..resolution_list.end()) |dep_id| {
        builder.sort_buf.appendAssumeCapacity(@intCast(dep_id));
    }

    const DepSorter = struct {
        lockfile: *const Lockfile,

        pub fn isLessThan(sorter: @This(), l: DependencyID, r: DependencyID) bool {
            const deps_buf = sorter.lockfile.buffers.dependencies.items;
            const string_buf = sorter.lockfile.buffers.string_bytes.items;

            const l_dep = deps_buf[l];
            const r_dep = deps_buf[r];

            return switch (l_dep.behavior.cmp(r_dep.behavior)) {
                .lt => true,
                .gt => false,
                .eq => strings.order(l_dep.name.slice(string_buf), r_dep.name.slice(string_buf)) == .lt,
            };
        }
    };

    std.sort.pdq(
        DependencyID,
        builder.sort_buf.items,
        DepSorter{
            .lockfile = builder.lockfile,
        },
        DepSorter.isLessThan,
    );

    for (builder.sort_buf.items) |dep_id| {
        const pkg_id = builder.resolutions[dep_id];
        // Skip unresolved packages, e.g. "peerDependencies"
        if (pkg_id >= max_package_id) continue;

        // filter out disabled dependencies
        if (comptime method == .filter) {
            if (builder.lockfile.isResolvedDependencyDisabled(
                dep_id,
                switch (pkg_resolutions[parent_pkg_id].tag) {
                    .root, .workspace, .folder => builder.manager.options.local_package_features,
                    else => builder.manager.options.remote_package_features,
                },
                &pkg_metas[pkg_id],
            )) {
                if (log_level.isVerbose()) {
                    const meta = &pkg_metas[pkg_id];
                    const name = builder.lockfile.str(&pkg_names[pkg_id]);
                    if (!meta.os.isMatch() and !meta.arch.isMatch()) {
                        Output.prettyErrorln("<d>Skip installing '<b>{s}<r><d>' cpu & os mismatch", .{name});
                    } else if (!meta.os.isMatch()) {
                        Output.prettyErrorln("<d>Skip installing '<b>{s}<r><d>' os mismatch", .{name});
                    } else if (!meta.arch.isMatch()) {
                        Output.prettyErrorln("<d>Skip installing '<b>{s}<r><d>' cpu mismatch", .{name});
                    }
                }

                continue;
            }

            if (builder.manager.subcommand == .install) dont_skip: {
                // only do this when parent is root. workspaces are always dependencies of the root
                // package, and the root package is always called with `processSubtree`
                if (parent_pkg_id == 0 and builder.workspace_filters.len > 0) {
                    if (!builder.dependencies[dep_id].behavior.isWorkspaceOnly()) {
                        if (builder.install_root_dependencies) {
                            break :dont_skip;
                        }

                        continue;
                    }

                    var match = false;

                    for (builder.workspace_filters) |workspace_filter| {
                        const res_id = builder.resolutions[dep_id];

                        const pattern, const path_or_name = switch (workspace_filter) {
                            .name => |pattern| .{ pattern, pkg_names[res_id].slice(builder.buf()) },

                            .path => |pattern| path: {
                                const res = &pkg_resolutions[res_id];
                                if (res.tag != .workspace) {
                                    break :dont_skip;
                                }
                                const res_path = res.value.workspace.slice(builder.buf());

                                // occupy `builder.path_buf`
                                var abs_res_path = strings.withoutTrailingSlash(bun.path.joinAbsStringBuf(
                                    FileSystem.instance.top_level_dir,
                                    builder.path_buf,
                                    &.{res_path},
                                    .auto,
                                ));

                                if (comptime Environment.isWindows) {
                                    abs_res_path = abs_res_path[Path.windowsVolumeNameLen(abs_res_path)[0]..];
                                    Path.dangerouslyConvertPathToPosixInPlace(u8, builder.path_buf[0..abs_res_path.len]);
                                }

                                break :path .{
                                    pattern,
                                    abs_res_path,
                                };
                            },

                            .all => {
                                match = true;
                                continue;
                            },
                        };

                        switch (bun.glob.walk.matchImpl(builder.allocator, pattern, path_or_name)) {
                            .match, .negate_match => match = true,

                            .negate_no_match => {
                                // always skip if a pattern specifically says "!<name>"
                                match = false;
                                break;
                            },

                            .no_match => {
                                // keep current
                            },
                        }
                    }

                    if (!match) {
                        continue;
                    }
                }
            }
        }

        const hoisted: HoistDependencyResult = hoisted: {
            const dependency = builder.dependencies[dep_id];

            // don't hoist if it's a folder dependency or a bundled dependency.
            if (dependency.behavior.isBundled()) {
                break :hoisted .{ .placement = .{ .id = next.id, .bundled = true } };
            }

            if (pkg_resolutions[pkg_id].tag == .folder) {
                break :hoisted .{ .placement = .{ .id = next.id } };
            }

            break :hoisted try next.hoistDependency(
                true,
                hoist_root_id,
                pkg_id,
                &dependency,
                dependency_lists,
                trees,
                method,
                builder,
            );
        };

        switch (hoisted) {
            .dependency_loop, .hoisted => continue,
            .placement => |dest| {
                dependency_lists[dest.id].append(builder.allocator, dep_id) catch bun.outOfMemory();
                trees[dest.id].dependencies.len += 1;
                if (builder.resolution_lists[pkg_id].len > 0) {
                    try builder.queue.writeItem(.{
                        .tree_id = dest.id,
                        .dependency_id = dep_id,

                        // if it's bundled, start a new hoist root
                        .hoist_root_id = if (dest.bundled) dest.id else hoist_root_id,
                    });
                }
            },
        }
    }

    if (next.dependencies.len == 0) {
        if (comptime Environment.allow_assert) assert(builder.list.len == next.id + 1);
        _ = builder.list.pop();
    }
}

// This function does one of three things:
// 1 (return hoisted) - de-duplicate (skip) the package
// 2 (return id) - move the package to the top directory
// 3 (return dependency_loop) - leave the package at the same (relative) directory
fn hoistDependency(
    this: *Tree,
    comptime as_defined: bool,
    hoist_root_id: Id,
    package_id: PackageID,
    dependency: *const Dependency,
    dependency_lists: []Lockfile.DependencyIDList,
    trees: []Tree,
    comptime method: BuilderMethod,
    builder: *Builder(method),
) !HoistDependencyResult {
    const this_dependencies = this.dependencies.get(dependency_lists[this.id].items);
    for (0..this_dependencies.len) |i| {
        const dep_id = this_dependencies[i];
        const dep = builder.dependencies[dep_id];
        if (dep.name_hash != dependency.name_hash) continue;

        if (builder.resolutions[dep_id] == package_id) {
            // this dependency is the same package as the other, hoist
            return .hoisted; // 1
        }

        if (comptime as_defined) {
            if (dep.behavior.isDev() != dependency.behavior.isDev()) {
                // will only happen in workspaces and root package because
                // dev dependencies won't be included in other types of
                // dependencies
                return .hoisted; // 1
            }
        }

        // now we either keep the dependency at this place in the tree,
        // or hoist if peer version allows it

        if (dependency.behavior.isPeer()) {
            if (dependency.version.tag == .npm) {
                const resolution: Resolution = builder.lockfile.packages.items(.resolution)[builder.resolutions[dep_id]];
                const version = dependency.version.value.npm.version;
                if (resolution.tag == .npm and version.satisfies(resolution.value.npm.version, builder.buf(), builder.buf())) {
                    return .hoisted; // 1
                }
            }

            // Root dependencies are manually chosen by the user. Allow them
            // to hoist other peers even if they don't satisfy the version
            if (builder.lockfile.isWorkspaceRootDependency(dep_id)) {
                // TODO: warning about peer dependency version mismatch
                return .hoisted; // 1
            }
        }

        if (as_defined and !dep.behavior.isPeer()) {
            builder.maybeReportError("Package \"{}@{}\" has a dependency loop\n  Resolution: \"{}@{}\"\n  Dependency: \"{}@{}\"", .{
                builder.packageName(package_id),
                builder.packageVersion(package_id),
                builder.packageName(builder.resolutions[dep_id]),
                builder.packageVersion(builder.resolutions[dep_id]),
                dependency.name.fmt(builder.buf()),
                dependency.version.literal.fmt(builder.buf()),
            });
            return error.DependencyLoop;
        }

        return .dependency_loop; // 3
    }

    // this dependency was not found in this tree, try hoisting or placing in the next parent
    if (this.parent != invalid_id and this.id != hoist_root_id) {
        const id = trees[this.parent].hoistDependency(
            false,
            hoist_root_id,
            package_id,
            dependency,
            dependency_lists,
            trees,
            method,
            builder,
        ) catch unreachable;
        if (!as_defined or id != .dependency_loop) return id; // 1 or 2
    }

    // place the dependency in the current tree
    return .{ .placement = .{ .id = this.id } }; // 2
}

pub const FillItem = struct {
    tree_id: Tree.Id,
    dependency_id: DependencyID,

    /// If valid, dependencies will not hoist
    /// beyond this tree if they're in a subtree
    hoist_root_id: Tree.Id,
};

pub const TreeFiller = std.fifo.LinearFifo(FillItem, .Dynamic);

const Allocator = std.mem.Allocator;
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const Dependency = install.Dependency;
const DependencyID = install.DependencyID;
const DependencyIDList = Lockfile.DependencyIDList;
const Environment = bun.Environment;
const ExternalSlice = Lockfile.ExternalSlice;
const FileSystem = bun.fs.FileSystem;
const Lockfile = install.Lockfile;
const OOM = bun.OOM;
const Output = bun.Output;
const PackageID = install.PackageID;
const PackageIDSlice = Lockfile.PackageIDSlice;
const PackageManager = bun.install.PackageManager;
const PackageNameHash = install.PackageNameHash;
const Path = bun.path;
const Resolution = install.Resolution;
const String = bun.Semver.String;
const Tree = @This();
const WorkspaceFilter = install.PackageManager.WorkspaceFilter;
const assert = bun.assert;
const install = bun.install;
const invalid_dependency_id = install.invalid_dependency_id;
const invalid_package_id = install.invalid_package_id;
const logger = bun.logger;
const string = []const u8;
const stringZ = bun.stringZ;
const strings = bun.strings;
const z_allocator = bun.z_allocator;

const bun = @import("bun");
const std = @import("std");
