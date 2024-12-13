const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const stringZ = bun.stringZ;
const strings = bun.strings;
const URL = bun.URL;
const PackageManager = bun.install.PackageManager;
const OOM = bun.OOM;
const logger = bun.logger;
const BinaryLockfile = bun.install.Lockfile;
const JSON = bun.JSON;
const Output = bun.Output;
const Expr = bun.js_parser.Expr;
const MutableString = bun.MutableString;
const DependencySlice = BinaryLockfile.DependencySlice;
const Install = bun.install;
const Dependency = Install.Dependency;
const PackageID = Install.PackageID;
const Semver = bun.Semver;
const String = Semver.String;
const Resolution = Install.Resolution;
const PackageNameHash = Install.PackageNameHash;
const NameHashMap = BinaryLockfile.NameHashMap;
const Repository = Install.Repository;
const Progress = bun.Progress;
const Environment = bun.Environment;
const Global = bun.Global;
const LoadResult = BinaryLockfile.LoadResult;
const TruncatedPackageNameHash = Install.TruncatedPackageNameHash;
const invalid_package_id = Install.invalid_package_id;
const Npm = Install.Npm;
const ExtractTarball = @import("./extract_tarball.zig");
const Integrity = @import("./integrity.zig").Integrity;
const Meta = BinaryLockfile.Package.Meta;
const Negatable = Npm.Negatable;
const DependencyID = Install.DependencyID;
const invalid_dependency_id = Install.invalid_dependency_id;

/// A property key in the `packages` field of the lockfile
pub const PkgPath = struct {
    raw: string,
    depth: u8,

    /// raw must be valid
    /// fills buf with the path to dependency in node_modules.
    /// e.g. loose-envify/js-tokens@4.0.0 -> node_modules/loose-envify/node_modules/js-tokens
    pub fn path(this: PkgPath, path_buf: []u8, comptime sep: u8) stringZ {
        var buf = path_buf;
        var remain = this.raw;

        const end = loop: while (true) {
            @memcpy(buf[0.."node_modules/".len], "node_modules" ++ [1]u8{sep});
            buf = buf["node_modules/".len..];

            var at = strings.indexOfChar(remain, '@') orelse unreachable;
            var slash = strings.indexOfChar(remain, '/') orelse break :loop at;

            if (at == 0) {
                // scoped package, find next '@' and '/'
                at += 1 + (strings.indexOfChar(remain[1..], '@') orelse unreachable);
                slash += 1 + (strings.indexOfChar(remain[slash + 1 ..], '/') orelse {
                    break :loop at;
                });
            }

            if (at < slash) {
                // slash is in the version
                break :loop at;
            }

            @memcpy(buf[0..slash], remain[0..slash]);
            buf[slash] = sep;
            buf = buf[slash + 1 ..];
            remain = remain[slash + 1 ..];
        };

        @memcpy(buf[0..end], remain[0..end]);
        buf = buf[end..];
        buf[0] = 0;
        return path_buf[0 .. @intFromPtr(buf.ptr) - @intFromPtr(path_buf.ptr) :0];
    }

    pub fn reverseIterator(input: string) Iterator {
        return .{
            .input = input,
            .i = @intCast(input.len),
        };
    }

    pub const ReverseIterator = struct {
        input: string,
        i: u32,

        pub fn next(this: *ReverseIterator) error{InvalidPackageKey}!?string {
            if (this.i == 0) return null;

            const remain = this.input[0..this.i];
            if (remain.len == 0) return error.InvalidPackageKey;

            const slash = strings.indexOfCharNeg(remain, '/') orelse {
                // the end
                const name = remain;
                this.i = 0;
                return name;
            };

            // if this is the second component of a scoped package an '@'
            // will begin the next
            const at = strings.indexOfCharNeg(remain, '@') orelse {
                const name = this.input[slash + 1 .. this.i];
                this.i = slash;
                return name;
            };

            if (at < slash) {
                return error.InvalidPackageKey;
            }

            const next_slash = strings.indexOfCharNeg(remain[0..slash]) orelse {
                // if `@` exists there must be another slash unless the first package
                // is a scoped package
                if (at != 0) {
                    return error.InvalidPackageKey;
                }

                const name = remain;
                this.i = 0;
                return name;
            };

            if (next_slash + 1 != at) {
                return error.InvalidPackageKey;
            }

            const name = this.input[next_slash + 1 .. this.i];
            this.i = next_slash;
            return name;
        }

        pub fn first(this: *ReverseIterator) error{InvalidPackageKey}!string {
            bun.debugAssert(this.i == this.input.len);

            return this.next() orelse return error.InvalidPackageKey;
        }
    };

    pub fn iterator(input: string) Iterator {
        return .{
            .input = input,
            .i = 0,
        };
    }

    pub const Iterator = struct {
        input: string,
        i: u32,
        version_offset: ?u32 = null,

        pub fn next(this: *Iterator) error{InvalidPackageKey}!?string {
            if (this.i == this.input.len) return null;

            var remain = this.input[this.i..];

            var maybe_at = strings.indexOfChar(remain, '@');
            var slash = strings.indexOfChar(remain, '/') orelse {
                // no slashes left, it's the last dependency name.
                // '@' will only exist if '/' exists (scoped package)
                if (maybe_at != null) return error.InvalidPackageKey;
                this.i = @intCast(this.input.len);
                return remain;
            };

            if (maybe_at == null) {
                if (slash + 1 == this.input.len) return error.InvalidPackageKey;
                this.i += slash + 1;
                return remain[0..slash];
            }

            if (maybe_at.? == 0) {
                // scoped package, find next '/' and '@' if it exists
                maybe_at = strings.indexOfChar(remain[1..], '@');
                slash += 1 + (strings.indexOfChar(remain[slash + 1 ..], '/') orelse {
                    if (maybe_at != null) return error.InvalidPackageKey;
                    this.i = @intCast(this.input.len);
                    return remain;
                });
            }

            if (maybe_at) |at| {
                if (at + 1 < slash) {
                    // both '@' and '/' exist and it's not a scoped package, so
                    // '@' must be greater than '/'
                    return error.InvalidPackageKey;
                }
            }

            this.i += slash + 1;
            return remain[0..slash];
        }

        /// There will always be at least one component to this path. Return
        /// an error if none is found (empty string)
        pub fn first(this: *Iterator) error{InvalidPackageKey}!string {
            bun.assertWithLocation(this.i == 0, @src());
            return try this.next() orelse error.InvalidPackageKey;
        }
    };

    pub fn fromLockfile(input: string) PkgPath {
        return .{
            .raw = input,
            .depth = 0,
        };
    }

    pub const Map = struct {
        root: Node,

        const Nodes = bun.StringArrayHashMapUnmanaged(Node);

        pub const Node = struct {
            pkg_id: PackageID,
            dep_id: DependencyID,
            parent: ?*Node,
            nodes: Nodes,

            pub fn deinit(this: *Node, allocator: std.mem.Allocator) void {
                for (this.nodes.values()) |*node| {
                    node.deinit(allocator);
                }

                this.nodes.deinit(allocator);
            }
        };

        pub fn init() Map {
            return .{
                .root = .{
                    .pkg_id = 0,
                    .dep_id = invalid_dependency_id,
                    .parent = null,
                    .nodes = .{},
                },
            };
        }

        pub fn deinit(this: *Map, allocator: std.mem.Allocator) void {
            for (this.root.nodes.values()) |*node| {
                node.deinit(allocator);
            }
        }

        const InsertError = OOM || error{
            InvalidPackageKey,
            DuplicatePackagePath,
        };

        pub fn insert(this: *Map, allocator: std.mem.Allocator, pkg_path: string, id: PackageID) InsertError!void {
            var iter = PkgPath.iterator(pkg_path);

            var parent: ?*Node = null;
            var curr: *Node = &this.root;
            while (try iter.next()) |name| {
                const entry = try curr.nodes.getOrPut(allocator, name);
                if (!entry.found_existing) {
                    // probably should use String.Buf for small strings and
                    // deduplication.
                    entry.key_ptr.* = try allocator.dupe(u8, name);
                    entry.value_ptr.* = .{
                        .pkg_id = invalid_package_id,
                        .dep_id = invalid_dependency_id,
                        .parent = parent,
                        .nodes = .{},
                    };
                }

                parent = curr;
                curr = entry.value_ptr;
            }

            if (parent == null) {
                return error.InvalidPackageKey;
            }

            if (curr.pkg_id != invalid_package_id) {
                return error.DuplicatePackagePath;
            }

            curr.pkg_id = id;
        }

        pub fn get(this: *Map, pkg_path: string) error{InvalidPackageKey}!?*Node {
            var iter = iterator(pkg_path);
            var curr: *Node = &this.root;
            while (try iter.next()) |name| {
                curr = curr.nodes.getPtr(name) orelse return null;
            }

            return curr;
        }

        pub fn iterate(this: *const Map, allocator: std.mem.Allocator) OOM!Map.Iterator {
            var tree_buf: std.ArrayListUnmanaged(Map.Iterator.TreeInfo) = .{};
            try tree_buf.append(allocator, .{
                .nodes = this.root.nodes,
                .pkg_id = 0,
                .dep_id = BinaryLockfile.Tree.root_dep_id,
                .id = 0,
                .parent_id = BinaryLockfile.Tree.invalid_id,
            });
            return .{
                .tree_buf = tree_buf,
                .deps_buf = .{},
            };
        }

        /// Breadth-first iterator
        pub const Iterator = struct {
            tree_buf: std.ArrayListUnmanaged(TreeInfo),

            deps_buf: std.ArrayListUnmanaged(DependencyID),

            pub const TreeInfo = struct {
                // name: String,
                nodes: Nodes,
                pkg_id: PackageID,
                dep_id: DependencyID,
                id: BinaryLockfile.Tree.Id,
                parent_id: BinaryLockfile.Tree.Id,
            };

            pub const Next = struct {
                id: BinaryLockfile.Tree.Id,
                parent_id: BinaryLockfile.Tree.Id,
                tree_dep_id: DependencyID,
                dep_ids: []const DependencyID,
            };

            pub fn deinit(this: *Map.Iterator, allocator: std.mem.Allocator) void {
                this.tree_buf.deinit(allocator);
                this.deps_buf.deinit(allocator);
            }

            pub fn next(this: *Map.Iterator, allocator: std.mem.Allocator) OOM!?Next {
                if (this.tree_buf.items.len == 0) {
                    return null;
                }

                this.deps_buf.clearRetainingCapacity();

                var next_id = this.tree_buf.getLast().id + 1;

                // TODO(dylan-conway): try doubly linked list
                const tree = this.tree_buf.orderedRemove(0);

                for (tree.nodes.values()) |node| {
                    if (node.nodes.count() > 0) {
                        try this.tree_buf.append(allocator, .{
                            .nodes = node.nodes,
                            .id = next_id,
                            .parent_id = tree.id,
                            .pkg_id = node.pkg_id,
                            .dep_id = node.dep_id,
                        });
                        next_id += 1;
                    }

                    try this.deps_buf.append(allocator, node.dep_id);
                }

                return .{
                    .id = tree.id,
                    .parent_id = tree.parent_id,
                    .tree_dep_id = tree.dep_id,
                    .dep_ids = this.deps_buf.items,
                };

                // return tree;
                //     .dep_id = tree.dep_id,
                //     .pkg_id = tree.pkg_id,
                //     .id = tree.tree_id,
                //     .parent_id = tree.parent_id,
                //     .nodes = tree.nodes,
                // };
            }
        };
    };
};

pub const Version = enum(u32) {
    v0 = 0,

    // probably bump when we support nested resolutions
    // v1,

    pub const current: Version = .v0;
};

pub const Stringifier = struct {
    const indent_scalar = 2;

    // pub fn save(this: *const Lockfile) void {
    //     _ = this;
    // }

    pub fn saveFromBinary(allocator: std.mem.Allocator, lockfile: *const BinaryLockfile) OOM!string {
        var writer_buf = MutableString.initEmpty(allocator);
        var buffered_writer = writer_buf.bufferedWriter();
        var writer = buffered_writer.writer();

        const buf = lockfile.buffers.string_bytes.items;
        const deps_buf = lockfile.buffers.dependencies.items;
        const resolution_buf = lockfile.buffers.resolutions.items;
        const pkgs = lockfile.packages.slice();
        const pkg_dep_lists: []DependencySlice = pkgs.items(.dependencies);
        const pkg_resolutions: []Resolution = pkgs.items(.resolution);
        const pkg_names: []String = pkgs.items(.name);
        const pkg_name_hashes: []PackageNameHash = pkgs.items(.name_hash);
        const pkg_metas: []BinaryLockfile.Package.Meta = pkgs.items(.meta);

        var temp_buf: std.ArrayListUnmanaged(u8) = .{};
        defer temp_buf.deinit(allocator);
        const temp_writer = temp_buf.writer(allocator);

        var found_trusted_dependencies: std.AutoHashMapUnmanaged(u64, String) = .{};
        defer found_trusted_dependencies.deinit(allocator);
        if (lockfile.trusted_dependencies) |trusted_dependencies| {
            try found_trusted_dependencies.ensureTotalCapacity(allocator, @truncate(trusted_dependencies.count()));
        }

        var found_patched_dependencies: std.AutoHashMapUnmanaged(u64, struct { string, String }) = .{};
        defer found_patched_dependencies.deinit(allocator);
        try found_patched_dependencies.ensureTotalCapacity(allocator, @truncate(lockfile.patched_dependencies.count()));

        var found_overrides: std.AutoHashMapUnmanaged(u64, struct { String, Dependency.Version }) = .{};
        defer found_overrides.deinit(allocator);
        try found_overrides.ensureTotalCapacity(allocator, @truncate(lockfile.overrides.map.count()));

        var optional_peers_buf = std.ArrayList(String).init(allocator);
        defer optional_peers_buf.deinit();

        var _indent: u32 = 0;
        const indent = &_indent;
        try writer.writeAll("{\n");
        try incIndent(writer, indent);
        {
            try writer.print("\"lockfileVersion\": {d},\n", .{@intFromEnum(Version.current)});
            try writeIndent(writer, indent);

            try writer.writeAll("\"workspaces\": {\n");
            try incIndent(writer, indent);
            {
                try writeWorkspaceDeps(
                    writer,
                    indent,
                    0,
                    .{},
                    pkg_names,
                    pkg_name_hashes,
                    pkg_dep_lists,
                    buf,
                    deps_buf,
                    lockfile.workspace_versions,
                    &optional_peers_buf,
                );

                var workspace_sort_buf: std.ArrayListUnmanaged(PackageID) = .{};
                defer workspace_sort_buf.deinit(allocator);

                for (0..pkgs.len) |_pkg_id| {
                    const pkg_id: PackageID = @intCast(_pkg_id);
                    const res = pkg_resolutions[pkg_id];
                    if (res.tag != .workspace) continue;
                    try workspace_sort_buf.append(allocator, pkg_id);
                }

                const Sorter = struct {
                    string_buf: string,
                    res_buf: []const Resolution,

                    pub fn isLessThan(this: @This(), l: PackageID, r: PackageID) bool {
                        const l_res = this.res_buf[l];
                        const r_res = this.res_buf[r];
                        return l_res.value.workspace.order(&r_res.value.workspace, this.string_buf, this.string_buf) == .lt;
                    }
                };

                std.sort.pdq(
                    PackageID,
                    workspace_sort_buf.items,
                    Sorter{ .string_buf = buf, .res_buf = pkg_resolutions },
                    Sorter.isLessThan,
                );

                for (workspace_sort_buf.items) |workspace_pkg_id| {
                    const res = pkg_resolutions[workspace_pkg_id];
                    try writer.writeAll("\n");
                    try writeIndent(writer, indent);
                    try writeWorkspaceDeps(
                        writer,
                        indent,
                        @intCast(workspace_pkg_id),
                        res.value.workspace,
                        pkg_names,
                        pkg_name_hashes,
                        pkg_dep_lists,
                        buf,
                        deps_buf,
                        lockfile.workspace_versions,
                        &optional_peers_buf,
                    );
                }
            }
            try writer.writeByte('\n');
            try decIndent(writer, indent);
            try writer.writeAll("},\n");

            var pkgs_iter = BinaryLockfile.Tree.Iterator(.pkg_path).init(lockfile);

            // find trusted and patched dependencies. also overrides
            while (pkgs_iter.next({})) |node| {
                for (node.dependencies) |dep_id| {
                    const pkg_id = resolution_buf[dep_id];
                    if (pkg_id == invalid_package_id) continue;

                    const pkg_name = pkg_names[pkg_id];
                    const pkg_name_hash = pkg_name_hashes[pkg_id];
                    const res = pkg_resolutions[pkg_id];
                    const dep = deps_buf[dep_id];

                    if (lockfile.patched_dependencies.count() > 0) {
                        try temp_writer.print("{s}@", .{pkg_name.slice(buf)});
                        switch (res.tag) {
                            .workspace => {
                                if (lockfile.workspace_versions.get(pkg_name_hash)) |workspace_version| {
                                    try temp_writer.print("{}", .{workspace_version.fmt(buf)});
                                }
                            },
                            else => {
                                try temp_writer.print("{}", .{res.fmt(buf, .posix)});
                            },
                        }
                        defer temp_buf.clearRetainingCapacity();

                        const name_and_version = temp_buf.items;
                        const name_and_version_hash = String.Builder.stringHash(name_and_version);

                        if (lockfile.patched_dependencies.get(name_and_version_hash)) |patch| {
                            try found_patched_dependencies.put(allocator, name_and_version_hash, .{
                                try allocator.dupe(u8, name_and_version),
                                patch.path,
                            });
                        }
                    }

                    // intentionally not checking default trusted dependencies
                    if (lockfile.trusted_dependencies) |trusted_dependencies| {
                        if (trusted_dependencies.contains(@truncate(dep.name_hash))) {
                            try found_trusted_dependencies.put(allocator, dep.name_hash, dep.name);
                        }
                    }

                    if (lockfile.overrides.map.count() > 0) {
                        if (lockfile.overrides.get(dep.name_hash)) |version| {
                            try found_overrides.put(allocator, dep.name_hash, .{ dep.name, version });
                        }
                    }
                }
            }

            pkgs_iter.reset();

            if (found_trusted_dependencies.count() > 0) {
                try writeIndent(writer, indent);
                try writer.writeAll(
                    \\"trustedDependencies": [
                    \\
                );
                indent.* += 1;
                var values_iter = found_trusted_dependencies.valueIterator();
                while (values_iter.next()) |dep_name| {
                    try writeIndent(writer, indent);
                    try writer.print(
                        \\"{s}",
                        \\
                    , .{dep_name.slice(buf)});
                }

                try decIndent(writer, indent);
                try writer.writeAll(
                    \\],
                    \\
                );
            }

            if (found_patched_dependencies.count() > 0) {
                try writeIndent(writer, indent);
                try writer.writeAll(
                    \\"patchedDependencies": {
                    \\
                );
                indent.* += 1;
                var values_iter = found_patched_dependencies.valueIterator();
                while (values_iter.next()) |value| {
                    const name_and_version, const patch_path = value.*;
                    try writeIndent(writer, indent);
                    try writer.print(
                        \\"{s}": "{s}",
                        \\
                    , .{ name_and_version, patch_path.slice(buf) });
                }

                try decIndent(writer, indent);
                try writer.writeAll(
                    \\},
                    \\
                );
            }

            if (found_overrides.count() > 0) {
                try writeIndent(writer, indent);
                try writer.writeAll(
                    \\"overrides": {
                    \\
                );
                indent.* += 1;
                var values_iter = found_overrides.valueIterator();
                while (values_iter.next()) |value| {
                    const name, const version = value.*;
                    try writeIndent(writer, indent);
                    try writer.print(
                        \\"{s}": "{s}",
                        \\
                    , .{ name.slice(buf), version.literal.slice(buf) });
                }

                try decIndent(writer, indent);
                try writer.writeAll(
                    \\},
                    \\
                );
            }

            const DepSortCtx = struct {
                string_buf: string,
                deps_buf: []const Dependency,

                pub fn isLessThan(this: @This(), lhs: DependencyID, rhs: DependencyID) bool {
                    const l = this.deps_buf[lhs];
                    const r = this.deps_buf[rhs];
                    return strings.cmpStringsAsc({}, l.name.slice(this.string_buf), r.name.slice(this.string_buf));
                }
            };

            var deps_sort_buf: std.ArrayListUnmanaged(DependencyID) = .{};
            defer deps_sort_buf.deinit(allocator);

            var pkg_deps_sort_buf: std.ArrayListUnmanaged(DependencyID) = .{};
            defer pkg_deps_sort_buf.deinit(allocator);

            try writeIndent(writer, indent);
            try writer.writeAll("\"packages\": {");
            var first = true;
            while (pkgs_iter.next({})) |node| {
                deps_sort_buf.clearRetainingCapacity();
                try deps_sort_buf.appendSlice(allocator, node.dependencies);

                std.sort.pdq(
                    DependencyID,
                    deps_sort_buf.items,
                    DepSortCtx{ .string_buf = buf, .deps_buf = deps_buf },
                    DepSortCtx.isLessThan,
                );

                for (deps_sort_buf.items) |dep_id| {
                    const pkg_id = resolution_buf[dep_id];
                    if (pkg_id == invalid_package_id) continue;

                    const res = pkg_resolutions[pkg_id];
                    switch (res.tag) {
                        .root, .npm, .folder, .local_tarball, .github, .git, .symlink, .workspace, .remote_tarball => {},
                        .uninitialized => continue,
                        // should not be possible, just being safe
                        .single_file_module => continue,
                        else => continue,
                    }

                    if (first) {
                        first = false;
                        try writer.writeByte('\n');
                        try incIndent(writer, indent);
                    } else {
                        try writer.writeAll(",\n");
                        try writeIndent(writer, indent);
                    }

                    try writer.writeByte('"');
                    // relative_path is empty string for root resolutions
                    try writer.writeAll(node.relative_path);

                    if (node.depth != 0) {
                        try writer.writeByte('/');
                    }

                    const dep = deps_buf[dep_id];
                    const dep_name = dep.name.slice(buf);

                    try writer.print("{s}\": ", .{
                        dep_name,
                    });

                    const pkg_name = pkg_names[pkg_id].slice(buf);
                    const pkg_meta = pkg_metas[pkg_id];
                    const pkg_deps_list = pkg_dep_lists[pkg_id];

                    pkg_deps_sort_buf.clearRetainingCapacity();
                    try pkg_deps_sort_buf.ensureUnusedCapacity(allocator, pkg_deps_list.len);
                    for (pkg_deps_list.begin()..pkg_deps_list.end()) |pkg_dep_id| {
                        pkg_deps_sort_buf.appendAssumeCapacity(@intCast(pkg_dep_id));
                    }

                    std.sort.pdq(
                        DependencyID,
                        pkg_deps_sort_buf.items,
                        DepSortCtx{ .string_buf = buf, .deps_buf = deps_buf },
                        DepSortCtx.isLessThan,
                    );

                    // first index is resolution for all dependency types
                    // npm         -> [ "name@version", registry or "" (default), deps..., integrity, ... ]
                    // symlink     -> [ "name@link:path", deps..., ... ]
                    // folder      -> [ "name@path", deps..., ... ]
                    // workspace   -> [ "name@workspace:path", version or "", deps..., ... ]
                    // tarball     -> [ "name@tarball", deps..., ... ]
                    // root        -> [ "name@root:" ]
                    // git         -> [ "name@git+repo", deps..., ... ]
                    // github      -> [ "name@github:user/repo", deps..., ... ]

                    switch (res.tag) {
                        .root => {
                            try writer.print("[\"{}@root:\"]", .{
                                bun.fmt.formatJSONStringUTF8(pkg_name, .{ .quote = false }),
                                // we don't read the root package version into the binary lockfile
                            });
                        },
                        .folder => {
                            try writer.print("[\"{s}@file:{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(res.value.folder.slice(buf), .{ .quote = false }),
                            });

                            try writePackageDepsAndMeta(writer, dep_id, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, buf, &optional_peers_buf);

                            try writer.writeByte(']');
                        },
                        .local_tarball => {
                            try writer.print("[\"{s}@{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(res.value.local_tarball.slice(buf), .{ .quote = false }),
                            });

                            try writePackageDepsAndMeta(writer, dep_id, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, buf, &optional_peers_buf);

                            try writer.writeByte(']');
                        },
                        .remote_tarball => {
                            try writer.print("[\"{s}@{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(res.value.remote_tarball.slice(buf), .{ .quote = false }),
                            });

                            try writePackageDepsAndMeta(writer, dep_id, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, buf, &optional_peers_buf);

                            try writer.writeByte(']');
                        },
                        .symlink => {
                            try writer.print("[\"{s}@link:{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(res.value.symlink.slice(buf), .{ .quote = false }),
                            });

                            try writePackageDepsAndMeta(writer, dep_id, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, buf, &optional_peers_buf);

                            try writer.writeByte(']');
                        },
                        .npm => {
                            try writer.print("[\"{s}@{}\", ", .{
                                pkg_name,
                                res.value.npm.version.fmt(buf),
                            });

                            // only write the registry if it's not the default. empty string means default registry
                            try writer.print("\"{s}\", ", .{
                                if (strings.hasPrefixComptime(res.value.npm.url.slice(buf), strings.withoutTrailingSlash(Npm.Registry.default_url)))
                                    ""
                                else
                                    res.value.npm.url.slice(buf),
                            });

                            try writePackageDepsAndMeta(writer, dep_id, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, buf, &optional_peers_buf);

                            try writer.print(", \"{}\"]", .{
                                pkg_meta.integrity,
                            });
                        },
                        .workspace => {
                            const workspace_path = res.value.workspace.slice(buf);

                            try writer.print("[\"{s}@workspace:{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(workspace_path, .{ .quote = false }),
                            });

                            try writePackageDepsAndMeta(writer, dep_id, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, buf, &optional_peers_buf);

                            try writer.writeByte(']');
                        },
                        inline .git, .github => |tag| {
                            const repo: Repository = @field(res.value, @tagName(tag));
                            try writer.print("[\"{s}@{}\", ", .{
                                pkg_name,
                                repo.fmt(if (comptime tag == .git) "git+" else "github:", buf),
                            });

                            try writePackageDepsAndMeta(writer, dep_id, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, buf, &optional_peers_buf);

                            try writer.writeByte(']');
                        },
                        else => unreachable,
                    }
                }
            }

            if (!first) {
                try writer.writeAll(",\n");
                try decIndent(writer, indent);
            }
            try writer.writeAll("}\n");
        }
        try decIndent(writer, indent);
        try writer.writeAll("}\n");

        try buffered_writer.flush();
        return writer_buf.list.items;
    }

    /// Writes a single line object.
    /// { "devDependencies": { "one": "1.1.1", "two": "2.2.2" }, "os": "none" }
    fn writePackageDepsAndMeta(
        writer: anytype,
        _: DependencyID,
        deps_buf: []const Dependency,
        pkg_dep_ids: []const DependencyID,
        meta: *const Meta,
        buf: string,
        optional_peers_buf: *std.ArrayList(String),
    ) OOM!void {
        defer optional_peers_buf.clearRetainingCapacity();

        try writer.writeByte('{');

        var any = false;
        inline for (workspace_dependency_groups) |group| {
            const group_name, const group_behavior = group;

            var first = true;
            for (pkg_dep_ids) |dep_id| {
                const dep = deps_buf[dep_id];
                if (!dep.behavior.includes(group_behavior)) continue;

                if (dep.behavior.isOptionalPeer()) {
                    // only write to "peerDependencies"
                    if (group_behavior.isOptional()) continue;

                    try optional_peers_buf.append(dep.name);
                }

                if (first) {
                    if (any) {
                        try writer.writeByte(',');
                    }
                    try writer.writeAll(" \"" ++ group_name ++ "\": { ");
                    first = false;
                    any = true;
                } else {
                    try writer.writeAll(", ");
                }

                try writer.print("\"{s}\": \"{s}\"", .{
                    dep.name.slice(buf),
                    dep.version.literal.slice(buf),
                });
            }

            if (!first) {
                try writer.writeAll(" }");
            }
        }

        if (optional_peers_buf.items.len > 0) {
            bun.debugAssert(any);
            try writer.writeAll(
                \\, "optionalPeerDependencies": [
            );

            for (optional_peers_buf.items, 0..) |optional_peer, i| {
                try writer.print(
                    \\{s}"{s}"{s}
                , .{
                    if (i != 0) " " else "",
                    optional_peer.slice(buf),
                    if (i != optional_peers_buf.items.len - 1) "," else "",
                });
            }

            try writer.writeByte(']');
        }

        // TODO(dylan-conway)
        // if (meta.libc != .all) {
        //     try writer.writeAll(
        //         \\"libc": [
        //     );
        //     try Negatable(Npm.Libc).toJson(meta.libc, writer);
        //     try writer.writeAll("], ");
        // }

        if (meta.os != .all) {
            if (any) {
                try writer.writeByte(',');
            } else {
                any = true;
            }
            try writer.writeAll(
                \\ "os": 
            );
            try Negatable(Npm.OperatingSystem).toJson(meta.os, writer);
        }

        if (meta.arch != .all) {
            if (any) {
                try writer.writeByte(',');
            } else {
                any = true;
            }
            try writer.writeAll(
                \\ "cpu": 
            );
            try Negatable(Npm.Architecture).toJson(meta.arch, writer);
        }

        if (any) {
            try writer.writeAll(" }");
        } else {
            try writer.writeByte('}');
        }
    }

    fn writeWorkspaceDeps(
        writer: anytype,
        indent: *u32,
        pkg_id: PackageID,
        res: String,
        pkg_names: []const String,
        pkg_name_hashes: []const PackageNameHash,
        pkg_deps: []const DependencySlice,
        buf: string,
        deps_buf: []const Dependency,
        workspace_versions: BinaryLockfile.VersionHashMap,
        optional_peers_buf: *std.ArrayList(String),
    ) OOM!void {
        defer optional_peers_buf.clearRetainingCapacity();
        // any - have any properties been written
        var any = false;

        // always print the workspace key even if it doesn't have dependencies because we
        // need a way to detect new/deleted workspaces
        if (pkg_id == 0) {
            try writer.writeAll("\"\": {");
        } else {
            try writer.print("{}: {{", .{
                bun.fmt.formatJSONStringUTF8(res.slice(buf), .{}),
            });
            try writer.writeByte('\n');
            try incIndent(writer, indent);
            try writer.print("\"name\": \"{s}\"", .{
                pkg_names[pkg_id].slice(buf),
            });

            if (workspace_versions.get(pkg_name_hashes[pkg_id])) |version| {
                try writer.writeAll(",\n");
                try writeIndent(writer, indent);
                try writer.print("\"version\": \"{}\"", .{
                    version.fmt(buf),
                });
            }

            any = true;
        }

        inline for (workspace_dependency_groups) |group| {
            const group_name, const group_behavior = group;

            var first = true;
            for (pkg_deps[pkg_id].get(deps_buf)) |dep| {
                if (!dep.behavior.includes(group_behavior)) continue;

                if (dep.behavior.isOptionalPeer()) {
                    if (group_behavior.isOptional()) continue;

                    try optional_peers_buf.append(dep.name);
                }

                if (first) {
                    if (any) {
                        try writer.writeByte(',');
                    }
                    try writer.writeByte('\n');
                    if (any) {
                        try writeIndent(writer, indent);
                    } else {
                        try incIndent(writer, indent);
                    }
                    try writer.writeAll("\"" ++ group_name ++ "\": {\n");
                    try incIndent(writer, indent);
                    any = true;
                    first = false;
                } else {
                    try writer.writeAll(",\n");
                    try writeIndent(writer, indent);
                }

                const name = dep.name.slice(buf);
                const version = dep.version.literal.slice(buf);

                try writer.print("\"{s}\": \"{s}\"", .{ name, version });
            }

            if (!first) {
                try writer.writeAll(",\n");
                try decIndent(writer, indent);
                try writer.writeAll("}");
            }
        }
        if (optional_peers_buf.items.len > 0) {
            bun.debugAssert(any);
            try writer.writeAll(
                \\,
                \\
            );
            try writeIndent(writer, indent);
            try writer.writeAll(
                \\"optionalPeerDependencies": [
                \\
            );
            indent.* += 1;
            for (optional_peers_buf.items) |optional_peer| {
                try writeIndent(writer, indent);
                try writer.print(
                    \\"{s}",
                    \\
                , .{optional_peer.slice(buf)});
            }
            try decIndent(writer, indent);
            try writer.writeByte(']');
        }

        if (any) {
            try writer.writeAll(",\n");
            try decIndent(writer, indent);
        }
        try writer.writeAll("},");
    }

    fn writeIndent(writer: anytype, indent: *const u32) OOM!void {
        for (0..indent.*) |_| {
            try writer.writeAll(" " ** indent_scalar);
        }
    }

    fn incIndent(writer: anytype, indent: *u32) OOM!void {
        indent.* += 1;
        for (0..indent.*) |_| {
            try writer.writeAll(" " ** indent_scalar);
        }
    }

    fn decIndent(writer: anytype, indent: *u32) OOM!void {
        indent.* -= 1;
        for (0..indent.*) |_| {
            try writer.writeAll(" " ** indent_scalar);
        }
    }
};

const dependency_groups = [3]struct { []const u8, Dependency.Behavior }{
    .{ "dependencies", Dependency.Behavior.normal },
    .{ "peerDependencies", Dependency.Behavior.normal },
    .{ "optionalDependencies", Dependency.Behavior.normal },
};

const workspace_dependency_groups = [4]struct { []const u8, Dependency.Behavior }{
    .{ "dependencies", Dependency.Behavior.normal },
    .{ "devDependencies", Dependency.Behavior.dev },
    .{ "optionalDependencies", Dependency.Behavior.optional },
    .{ "peerDependencies", Dependency.Behavior.peer },
};

const ParseError = OOM || error{
    InvalidLockfileVersion,
    InvalidOptionalValue,
    InvalidPeerValue,
    InvalidDefaultRegistry,
    InvalidPatchedDependencies,
    InvalidPatchedDependency,
    InvalidWorkspaceObject,
    InvalidPackagesObject,
    InvalidPackagesProp,
    InvalidPackageKey,
    InvalidPackageInfo,
    InvalidPackageSpecifier,
    InvalidSemver,
    InvalidPackagesTree,
    InvalidTrustedDependenciesSet,
    InvalidOverridesObject,
    InvalidDependencyName,
    InvalidDependencyVersion,
    InvalidPackageResolution,
    UnexpectedResolution,
};

pub fn parseIntoBinaryLockfile(
    lockfile: *BinaryLockfile,
    allocator: std.mem.Allocator,
    root: JSON.Expr,
    source: *const logger.Source,
    log: *logger.Log,
    manager: ?*PackageManager,
) ParseError!void {
    var temp_buf: std.ArrayListUnmanaged(u8) = .{};
    defer temp_buf.deinit(allocator);

    lockfile.initEmpty(allocator);

    const lockfile_version_expr = root.get("lockfileVersion") orelse {
        try log.addError(source, root.loc, "Missing lockfile version");
        return error.InvalidLockfileVersion;
    };

    const lockfile_version: u32 = switch (lockfile_version_expr.data) {
        .e_number => |num| @intFromFloat(std.math.divExact(f64, num.value, 1) catch return error.InvalidLockfileVersion),
        else => return error.InvalidLockfileVersion,
    };

    lockfile.text_lockfile_version = std.meta.intToEnum(Version, lockfile_version) catch {
        try log.addError(source, lockfile_version_expr.loc, "Unknown lockfile version");
        return error.InvalidLockfileVersion;
    };

    var string_buf = String.Buf.init(allocator);

    if (root.get("trustedDependencies")) |trusted_dependencies_expr| {
        var trusted_dependencies: BinaryLockfile.TrustedDependenciesSet = .{};
        if (!trusted_dependencies_expr.isArray()) {
            try log.addError(source, trusted_dependencies_expr.loc, "Expected an array");
            return error.InvalidTrustedDependenciesSet;
        }

        for (trusted_dependencies_expr.data.e_array.items.slice()) |dep| {
            if (!dep.isString()) {
                try log.addError(source, dep.loc, "Expected a string");
                return error.InvalidTrustedDependenciesSet;
            }
            const name_hash: TruncatedPackageNameHash = @truncate((try dep.asStringHash(allocator, String.Builder.stringHash)).?);
            try trusted_dependencies.put(allocator, name_hash, {});
        }

        lockfile.trusted_dependencies = trusted_dependencies;
    }

    if (root.get("patchedDependencies")) |patched_dependencies_expr| {
        if (!patched_dependencies_expr.isObject()) {
            try log.addError(source, patched_dependencies_expr.loc, "Expected an object");
            return error.InvalidPatchedDependencies;
        }

        for (patched_dependencies_expr.data.e_object.properties.slice()) |prop| {
            const key = prop.key.?;
            const value = prop.value.?;
            if (!key.isString()) {
                try log.addError(source, key.loc, "Expected a string");
                return error.InvalidPatchedDependencies;
            }

            if (!value.isString()) {
                try log.addError(source, value.loc, "Expected a string");
                return error.InvalidPatchedDependencies;
            }

            const key_hash = (try key.asStringHash(allocator, String.Builder.stringHash)).?;
            try lockfile.patched_dependencies.put(
                allocator,
                key_hash,
                .{ .path = try string_buf.append(value.asString(allocator).?) },
            );
        }
    }

    if (root.get("overrides")) |overrides_expr| {
        if (!overrides_expr.isObject()) {
            try log.addError(source, overrides_expr.loc, "Expected an object");
            return error.InvalidOverridesObject;
        }

        for (overrides_expr.data.e_object.properties.slice()) |prop| {
            const key = prop.key.?;
            const value = prop.value.?;

            if (!key.isString() or key.data.e_string.len() == 0) {
                try log.addError(source, key.loc, "Expected a non-empty string");
                return error.InvalidOverridesObject;
            }

            const name_str = key.asString(allocator).?;
            const name_hash = String.Builder.stringHash(name_str);
            const name = try string_buf.appendWithHash(name_str, name_hash);

            // TODO(dylan-conway) also accept object when supported
            if (!value.isString()) {
                try log.addError(source, value.loc, "Expected a string");
                return error.InvalidOverridesObject;
            }

            const version_str = value.asString(allocator).?;
            const version_hash = String.Builder.stringHash(version_str);
            const version = try string_buf.appendWithHash(version_str, version_hash);
            const version_sliced = version.sliced(string_buf.bytes.items);

            const dep: Dependency = .{
                .name = name,
                .name_hash = name_hash,
                .version = Dependency.parse(
                    allocator,
                    name,
                    name_hash,
                    version_sliced.slice,
                    &version_sliced,
                    log,
                    manager,
                ) orelse {
                    try log.addError(source, value.loc, "Invalid override version");
                    return error.InvalidOverridesObject;
                },
            };

            try lockfile.overrides.map.put(allocator, name_hash, dep);
        }
    }

    const workspaces = root.getObject("workspaces") orelse {
        try log.addError(source, root.loc, "Missing a workspaces object property");
        return error.InvalidWorkspaceObject;
    };

    var maybe_root_pkg: ?Expr = null;

    for (workspaces.data.e_object.properties.slice()) |prop| {
        const key = prop.key.?;
        const value: Expr = prop.value.?;
        if (!key.isString()) {
            try log.addError(source, key.loc, "Expected a string");
            return error.InvalidWorkspaceObject;
        }
        if (!value.isObject()) {
            try log.addError(source, value.loc, "Expected an object");
            return error.InvalidWorkspaceObject;
        }

        const path = key.asString(allocator).?;

        if (path.len == 0) {
            if (maybe_root_pkg != null) {
                try log.addError(source, key.loc, "Duplicate root package");
                return error.InvalidWorkspaceObject;
            }

            maybe_root_pkg = value;
            continue;
        }

        const name_expr: Expr = value.get("name") orelse {
            try log.addError(source, value.loc, "Expected a string name property");
            return error.InvalidWorkspaceObject;
        };

        const name_hash = try name_expr.asStringHash(allocator, String.Builder.stringHash) orelse {
            try log.addError(source, name_expr.loc, "Expected a string name property");
            return error.InvalidWorkspaceObject;
        };

        try lockfile.workspace_paths.put(allocator, name_hash, try string_buf.append(path));

        // versions are optional
        if (value.get("version")) |version_expr| {
            if (!version_expr.isString()) {
                try log.addError(source, version_expr.loc, "Expected a string version property");
                return error.InvalidWorkspaceObject;
            }

            const version_str = try string_buf.append(version_expr.asString(allocator).?);

            const parsed = Semver.Version.parse(version_str.sliced(string_buf.bytes.items));
            if (!parsed.valid) {
                try log.addError(source, version_expr.loc, "Invalid semver version");
                return error.InvalidSemver;
            }

            try lockfile.workspace_versions.put(allocator, name_hash, parsed.version.min());
        }
    }

    var optional_peers_buf: std.AutoHashMapUnmanaged(u64, void) = .{};
    defer optional_peers_buf.deinit(allocator);

    if (maybe_root_pkg) |root_pkg| {
        // TODO(dylan-conway): maybe sort this. behavior is already sorted, but names are not
        const maybe_name = if (root_pkg.get("name")) |name| name.asString(allocator) orelse {
            try log.addError(source, name.loc, "Expected a string");
            return error.InvalidWorkspaceObject;
        } else null;

        const off, const len = try parseAppendDependencies(lockfile, allocator, &root_pkg, &string_buf, log, source, &optional_peers_buf);

        var pkg: BinaryLockfile.Package = .{};
        pkg.meta.id = 0;

        if (maybe_name) |name| {
            const name_hash = String.Builder.stringHash(name);
            pkg.name = try string_buf.appendWithHash(name, name_hash);
            pkg.name_hash = name_hash;
        }

        pkg.dependencies = .{ .off = off, .len = len };
        pkg.resolutions = .{ .off = off, .len = len };

        try lockfile.packages.append(allocator, pkg);
    } else {
        try log.addError(source, workspaces.loc, "Expected root package");
        return error.InvalidWorkspaceObject;
    }

    var pkg_map = PkgPath.Map.init();
    defer pkg_map.deinit(allocator);

    if (root.get("packages")) |pkgs_expr| {
        if (!pkgs_expr.isObject()) {
            try log.addError(source, pkgs_expr.loc, "Expected an object");
            return error.InvalidPackagesObject;
        }

        for (pkgs_expr.data.e_object.properties.slice()) |prop| {
            const key = prop.key.?;
            const value = prop.value.?;

            const pkg_path = key.asString(allocator) orelse {
                try log.addError(source, key.loc, "Expected a string");
                return error.InvalidPackageKey;
            };

            if (!value.isArray()) {
                try log.addError(source, value.loc, "Expected an array");
                return error.InvalidPackageInfo;
            }

            var i: usize = 0;
            const pkg_info = value.data.e_array.items;

            if (pkg_info.len == 0) {
                try log.addError(source, value.loc, "Missing package info");
                return error.InvalidPackageInfo;
            }

            const res_info = pkg_info.at(i);
            i += 1;

            const res_info_str = res_info.asString(allocator) orelse {
                try log.addError(source, res_info.loc, "Expected a string");
                return error.InvalidPackageResolution;
            };

            const name_str, const res_str = Dependency.splitNameAndVersion(res_info_str) catch {
                try log.addError(source, res_info.loc, "Invalid package resolution");
                return error.InvalidPackageResolution;
            };

            const name_hash = String.Builder.stringHash(name_str);
            const name = try string_buf.append(name_str);

            var res = Resolution.fromTextLockfile(res_str, &string_buf) catch |err| switch (err) {
                error.OutOfMemory => return err,
                error.UnexpectedResolution => {
                    try log.addErrorFmt(source, res_info.loc, allocator, "Unexpected resolution: {s}", .{res_str});
                    return err;
                },
                error.InvalidSemver => {
                    try log.addErrorFmt(source, res_info.loc, allocator, "Invalid package version: {s}", .{res_str});
                    return err;
                },
            };

            if (res.tag == .npm) {
                if (pkg_info.len < 2) {
                    try log.addError(source, value.loc, "Missing npm registry");
                    return error.InvalidPackageInfo;
                }

                const registry_expr = pkg_info.at(i);
                i += 1;

                const registry_str = registry_expr.asString(allocator) orelse {
                    try log.addError(source, registry_expr.loc, "Expected a string");
                    return error.InvalidPackageInfo;
                };

                if (registry_str.len == 0) {
                    const url = try ExtractTarball.buildURL(
                        Npm.Registry.default_url,
                        strings.StringOrTinyString.init(name.slice(string_buf.bytes.items)),
                        res.value.npm.version,
                        string_buf.bytes.items,
                    );

                    res.value.npm.url = try string_buf.append(url);
                } else {
                    res.value.npm.url = try string_buf.append(registry_str);
                }
            }

            var pkg: BinaryLockfile.Package = .{};

            // dependencies, os, cpu, libc
            switch (res.tag) {
                .npm, .folder, .git, .github, .local_tarball, .remote_tarball, .symlink, .workspace => {
                    const deps_os_cpu_libc_obj = pkg_info.at(i);
                    i += 1;
                    if (!deps_os_cpu_libc_obj.isObject()) {
                        try log.addError(source, deps_os_cpu_libc_obj.loc, "Expected an object");
                        return error.InvalidPackageInfo;
                    }

                    // TODO(dylan-conway): maybe sort this. behavior is already sorted, but names are not
                    const off, const len = try parseAppendDependencies(lockfile, allocator, deps_os_cpu_libc_obj, &string_buf, log, source, &optional_peers_buf);

                    pkg.dependencies = .{ .off = off, .len = len };
                    pkg.resolutions = .{ .off = off, .len = len };

                    if (res.tag != .workspace) {
                        if (deps_os_cpu_libc_obj.get("os")) |os| {
                            pkg.meta.os = try Negatable(Npm.OperatingSystem).fromJson(allocator, os);
                        }
                        if (deps_os_cpu_libc_obj.get("cpu")) |arch| {
                            pkg.meta.arch = try Negatable(Npm.Architecture).fromJson(allocator, arch);
                        }
                        // TODO(dylan-conway)
                        // if (os_cpu_libc_obj.get("libc")) |libc| {
                        //     pkg.meta.libc = Negatable(Npm.Libc).fromJson(allocator, libc);
                        // }
                    }
                },
                else => {},
            }

            // integrity
            switch (res.tag) {
                .npm => {
                    const integrity_expr = pkg_info.at(i);
                    i += 1;
                    const integrity_str = integrity_expr.asString(allocator) orelse {
                        try log.addError(source, integrity_expr.loc, "Expected a string");
                        return error.InvalidPackageInfo;
                    };

                    pkg.meta.integrity = Integrity.parse(integrity_str);
                },
                else => {},
            }

            pkg.name = name;
            pkg.name_hash = name_hash;
            pkg.resolution = res;

            // set later
            pkg.bin = .{
                .unset = 1,
            };
            pkg.scripts = .{};

            const pkg_id = try lockfile.appendPackageDedupe(&pkg, string_buf.bytes.items);

            pkg_map.insert(allocator, pkg_path, pkg_id) catch |err| {
                switch (err) {
                    error.OutOfMemory => |oom| return oom,
                    error.DuplicatePackagePath => {
                        try log.addError(source, key.loc, "Duplicate package path");
                    },
                    error.InvalidPackageKey => {
                        try log.addError(source, key.loc, "Invalid package path");
                    },
                }
                return error.InvalidPackageKey;
            };
        }

        try lockfile.buffers.resolutions.ensureTotalCapacityPrecise(allocator, lockfile.buffers.dependencies.items.len);
        lockfile.buffers.resolutions.expandToCapacity();
        @memset(lockfile.buffers.resolutions.items, invalid_package_id);

        const pkgs = lockfile.packages.slice();
        const pkg_names = pkgs.items(.name);
        _ = pkg_names;
        const pkg_name_hashes = pkgs.items(.name_hash);
        _ = pkg_name_hashes;
        const pkg_deps = pkgs.items(.dependencies);
        var pkg_metas = pkgs.items(.meta);
        var pkg_resolutions = pkgs.items(.resolution);
        const pkg_resolution_lists = pkgs.items(.resolutions);
        _ = pkg_resolution_lists;

        {
            // first the root dependencies are resolved
            pkg_resolutions[0] = Resolution.init(.{ .root = {} });
            pkg_metas[0].origin = .local;

            for (pkg_deps[0].begin()..pkg_deps[0].end()) |_dep_id| {
                const dep_id: DependencyID = @intCast(_dep_id);
                const dep = lockfile.buffers.dependencies.items[dep_id];

                if (pkg_map.root.nodes.getPtr(dep.name.slice(string_buf.bytes.items))) |dep_node| {
                    dep_node.dep_id = dep_id;
                    lockfile.buffers.resolutions.items[dep_id] = dep_node.pkg_id;
                }
            }

            // TODO(dylan-conway) should we handle workspaces separately here for custom hoisting

        }

        // then each package dependency
        for (pkgs_expr.data.e_object.properties.slice()) |prop| {
            const key = prop.key.?;
            const value = prop.value.?;

            const pkg_path = key.asString(allocator).?;
            const i: usize = 0;
            _ = i;
            const pkg_info = value.data.e_array.items;
            _ = pkg_info;

            const pkg_map_entry = try pkg_map.get(pkg_path) orelse {
                return error.InvalidPackagesObject;
            };

            const pkg_id = pkg_map_entry.pkg_id;

            // find resolutions. iterate up to root through the pkg path.
            deps: for (pkg_deps[pkg_id].begin()..pkg_deps[pkg_id].end()) |_dep_id| {
                const dep_id: DependencyID = @intCast(_dep_id);
                const dep = lockfile.buffers.dependencies.items[dep_id];

                var curr: ?*PkgPath.Map.Node = pkg_map_entry;
                while (curr) |node| {
                    if (node.nodes.getPtr(dep.name.slice(string_buf.bytes.items))) |dep_node| {
                        dep_node.dep_id = dep_id;
                        lockfile.buffers.resolutions.items[dep_id] = dep_node.pkg_id;

                        continue :deps;
                    }
                    curr = node.parent orelse if (curr != &pkg_map.root) &pkg_map.root else null;
                }
            }
        }

        {
            // ids are assigned, now flatten into `lockfile.buffers.trees` and `lockfile.buffers.hoisted_dependencies`
            var tree_iter = try pkg_map.iterate(allocator);
            defer tree_iter.deinit(allocator);
            var tree_id: BinaryLockfile.Tree.Id = 0;
            while (try tree_iter.next(allocator)) |tree| {
                bun.debugAssert(tree_id == tree.id);
                const deps_off: u32 = @intCast(lockfile.buffers.hoisted_dependencies.items.len);
                const deps_len: u32 = @intCast(tree.dep_ids.len);
                try lockfile.buffers.hoisted_dependencies.appendSlice(allocator, tree.dep_ids);
                try lockfile.buffers.trees.append(
                    allocator,
                    .{
                        .dependency_id = tree.tree_dep_id,
                        .id = tree_id,
                        .parent = tree.parent_id,
                        .dependencies = .{
                            .off = deps_off,
                            .len = deps_len,
                        },
                    },
                );

                tree_id += 1;
            }
        }
    }

    lockfile.buffers.string_bytes = string_buf.bytes.moveToUnmanaged();
    lockfile.string_pool = string_buf.pool;
}

fn parseAppendDependencies(
    lockfile: *BinaryLockfile,
    allocator: std.mem.Allocator,
    obj: *const Expr,
    buf: *String.Buf,
    log: *logger.Log,
    source: *const logger.Source,
    optional_peers_buf: *std.AutoHashMapUnmanaged(u64, void),
) ParseError!struct { u32, u32 } {
    defer optional_peers_buf.clearRetainingCapacity();

    if (obj.get("optionalPeerDependencies")) |optional_peers| {
        if (!optional_peers.isArray()) {
            try log.addError(source, optional_peers.loc, "Expected an array");
            return error.InvalidPackageInfo;
        }

        for (optional_peers.data.e_array.items.slice()) |item| {
            const name_hash = try item.asStringHash(allocator, String.Builder.stringHash) orelse {
                try log.addError(source, item.loc, "Expected a string");
                return error.InvalidPackageInfo;
            };

            try optional_peers_buf.put(allocator, name_hash, {});
        }
    }

    const off = lockfile.buffers.dependencies.items.len;
    inline for (workspace_dependency_groups) |dependency_group| {
        const group_name, const group_behavior = dependency_group;
        if (obj.get(group_name)) |deps| {
            if (!deps.isObject()) {
                try log.addError(source, deps.loc, "Expected an object");
                return error.InvalidPackagesTree;
            }

            for (deps.data.e_object.properties.slice()) |prop| {
                const key = prop.key.?;
                const value = prop.value.?;

                const name_str = key.asString(allocator) orelse {
                    try log.addError(source, key.loc, "Expected a string");
                    return error.InvalidDependencyName;
                };

                const name_hash = String.Builder.stringHash(name_str);
                const name = try buf.appendExternalWithHash(name_str, name_hash);

                const version_str = value.asString(allocator) orelse {
                    try log.addError(source, value.loc, "Expected a string");
                    return error.InvalidDependencyVersion;
                };

                const version = try buf.append(version_str);
                const version_sliced = version.sliced(buf.bytes.items);

                var dep: Dependency = .{
                    .name = name.value,
                    .name_hash = name.hash,
                    .behavior = group_behavior,
                    .version = Dependency.parse(
                        allocator,
                        name.value,
                        name.hash,
                        version_sliced.slice,
                        &version_sliced,
                        log,
                        null,
                    ) orelse {
                        try log.addError(source, value.loc, "Invalid dependency version");
                        return error.InvalidDependencyVersion;
                    },
                };

                if (dep.behavior.isPeer() and optional_peers_buf.contains(name.hash)) {
                    dep.behavior.optional = true;
                }

                try lockfile.buffers.dependencies.append(allocator, dep);
            }
        }
    }
    const end = lockfile.buffers.dependencies.items.len;

    std.sort.pdq(
        Dependency,
        lockfile.buffers.dependencies.items[off..],
        buf.bytes.items,
        Dependency.isLessThan,
    );

    return .{ @intCast(off), @intCast(end - off) };
}
