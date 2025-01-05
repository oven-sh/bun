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
const DependencyIDSlice = BinaryLockfile.DependencyIDSlice;
const Bin = Install.Bin;
const ExternalString = Semver.ExternalString;

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
};

pub const Version = enum(u32) {
    v0 = 0,

    // probably bump when we support nested resolutions
    // v1,

    pub const current: Version = .v0;
};

// For sorting dependencies belonging to a node_modules folder. No duplicate names, so
// only string compare
const TreeDepsSortCtx = struct {
    string_buf: string,
    deps_buf: []const Dependency,

    pub fn isLessThan(this: @This(), lhs: DependencyID, rhs: DependencyID) bool {
        const l = this.deps_buf[lhs];
        const r = this.deps_buf[rhs];
        return strings.cmpStringsAsc({}, l.name.slice(this.string_buf), r.name.slice(this.string_buf));
    }
};

pub const Stringifier = struct {
    const indent_scalar = 2;

    // pub fn save(this: *const Lockfile) void {
    //     _ = this;
    // }

    pub fn saveFromBinary(allocator: std.mem.Allocator, lockfile: *const BinaryLockfile, writer: anytype) @TypeOf(writer).Error!void {
        const buf = lockfile.buffers.string_bytes.items;
        const deps_buf = lockfile.buffers.dependencies.items;
        const resolution_buf = lockfile.buffers.resolutions.items;
        const pkgs = lockfile.packages.slice();
        const pkg_dep_lists: []DependencySlice = pkgs.items(.dependencies);
        const pkg_resolutions: []Resolution = pkgs.items(.resolution);
        const pkg_names: []String = pkgs.items(.name);
        const pkg_name_hashes: []PackageNameHash = pkgs.items(.name_hash);
        const pkg_metas: []BinaryLockfile.Package.Meta = pkgs.items(.meta);
        const pkg_bins = pkgs.items(.bin);

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

            const TreeSortCtx = struct {
                pub const Item = struct { []const DependencyID, string, usize };

                pub fn isLessThan(_: void, l: Item, r: Item) bool {
                    _, const l_rel_path, const l_depth = l;
                    _, const r_rel_path, const r_depth = r;
                    return switch (std.math.order(l_depth, r_depth)) {
                        .lt => true,
                        .gt => false,
                        .eq => strings.order(l_rel_path, r_rel_path) == .lt,
                    };
                }
            };

            var tree_sort_buf: std.ArrayListUnmanaged(TreeSortCtx.Item) = .{};
            defer tree_sort_buf.deinit(allocator);

            var pkgs_iter = BinaryLockfile.Tree.Iterator(.pkg_path).init(lockfile);

            // find trusted and patched dependencies. also overrides
            while (pkgs_iter.next({})) |node| {
                try tree_sort_buf.append(allocator, .{
                    node.dependencies,
                    try allocator.dupe(u8, node.relative_path),
                    node.depth,
                });

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

            std.sort.pdq(
                TreeSortCtx.Item,
                tree_sort_buf.items,
                {},
                TreeSortCtx.isLessThan,
            );

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

            var tree_deps_sort_buf: std.ArrayListUnmanaged(DependencyID) = .{};
            defer tree_deps_sort_buf.deinit(allocator);

            var pkg_deps_sort_buf: std.ArrayListUnmanaged(DependencyID) = .{};
            defer pkg_deps_sort_buf.deinit(allocator);

            try writeIndent(writer, indent);
            try writer.writeAll("\"packages\": {");
            var first = true;
            for (tree_sort_buf.items) |item| {
                const dependencies, const relative_path, const depth = item;
                tree_deps_sort_buf.clearRetainingCapacity();
                try tree_deps_sort_buf.appendSlice(allocator, dependencies);

                std.sort.pdq(
                    DependencyID,
                    tree_deps_sort_buf.items,
                    TreeDepsSortCtx{ .string_buf = buf, .deps_buf = deps_buf },
                    TreeDepsSortCtx.isLessThan,
                );

                for (tree_deps_sort_buf.items) |dep_id| {
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
                        try writer.writeAll(",\n\n");
                        try writeIndent(writer, indent);
                    }

                    try writer.writeByte('"');
                    // relative_path is empty string for root resolutions
                    try writer.print("{}", .{
                        bun.fmt.formatJSONStringUTF8(relative_path, .{ .quote = false }),
                    });

                    if (depth != 0) {
                        try writer.writeByte('/');
                    }

                    const dep = deps_buf[dep_id];
                    const dep_name = dep.name.slice(buf);

                    try writer.print("{}\": ", .{
                        bun.fmt.formatJSONStringUTF8(dep_name, .{ .quote = false }),
                    });

                    const pkg_name = pkg_names[pkg_id];
                    const pkg_meta = pkg_metas[pkg_id];
                    const pkg_bin = pkg_bins[pkg_id];
                    const pkg_deps_list = pkg_dep_lists[pkg_id];

                    pkg_deps_sort_buf.clearRetainingCapacity();
                    try pkg_deps_sort_buf.ensureUnusedCapacity(allocator, pkg_deps_list.len);
                    for (pkg_deps_list.begin()..pkg_deps_list.end()) |pkg_dep_id| {
                        pkg_deps_sort_buf.appendAssumeCapacity(@intCast(pkg_dep_id));
                    }

                    // there might be duplicate names due to dependency behaviors,
                    // but we print behaviors in different groups so it won't affect
                    // the result
                    std.sort.pdq(
                        DependencyID,
                        pkg_deps_sort_buf.items,
                        TreeDepsSortCtx{ .string_buf = buf, .deps_buf = deps_buf },
                        TreeDepsSortCtx.isLessThan,
                    );

                    // INFO = { prod/dev/optional/peer dependencies, os, cpu, libc (TODO), bin, binDir }

                    // first index is resolution for each type of package
                    // npm         -> [ "name@version", registry (TODO: remove if default), INFO, integrity]
                    // symlink     -> [ "name@link:path", INFO ]
                    // folder      -> [ "name@file:path", INFO ]
                    // workspace   -> [ "name@workspace:path", INFO ]
                    // tarball     -> [ "name@tarball", INFO ]
                    // root        -> [ "name@root:", { bin, binDir } ]
                    // git         -> [ "name@git+repo", INFO, .bun-tag string (TODO: remove this) ]
                    // github      -> [ "name@github:user/repo", INFO, .bun-tag string (TODO: remove this) ]

                    switch (res.tag) {
                        .root => {
                            try writer.print("[\"{}@root:\", ", .{
                                pkg_name.fmtJson(buf, .{ .quote = false }),
                                // we don't read the root package version into the binary lockfile
                            });

                            try writer.writeByte('{');
                            if (pkg_bin.tag != .none) {
                                try writer.writeAll(if (pkg_bin.tag == .dir) " \"binDir\": " else " \"bin\": ");
                                try pkg_bin.toSingleLineJson(buf, lockfile.buffers.extern_strings.items, writer);
                                try writer.writeAll(" }]");
                            } else {
                                try writer.writeAll("}]");
                            }
                        },
                        .folder => {
                            try writer.print("[\"{}@file:{}\", ", .{
                                pkg_name.fmtJson(buf, .{ .quote = false }),
                                res.value.folder.fmtJson(buf, .{ .quote = false }),
                            });

                            try writePackageInfoObject(writer, dep.behavior, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, &pkg_bin, buf, &optional_peers_buf, lockfile.buffers.extern_strings.items);

                            try writer.writeByte(']');
                        },
                        .local_tarball => {
                            try writer.print("[\"{}@{}\", ", .{
                                pkg_name.fmtJson(buf, .{ .quote = false }),
                                res.value.local_tarball.fmtJson(buf, .{ .quote = false }),
                            });

                            try writePackageInfoObject(writer, dep.behavior, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, &pkg_bin, buf, &optional_peers_buf, lockfile.buffers.extern_strings.items);

                            try writer.writeByte(']');
                        },
                        .remote_tarball => {
                            try writer.print("[\"{}@{}\", ", .{
                                pkg_name.fmtJson(buf, .{ .quote = false }),
                                res.value.remote_tarball.fmtJson(buf, .{ .quote = false }),
                            });

                            try writePackageInfoObject(writer, dep.behavior, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, &pkg_bin, buf, &optional_peers_buf, lockfile.buffers.extern_strings.items);

                            try writer.writeByte(']');
                        },
                        .symlink => {
                            try writer.print("[\"{}@link:{}\", ", .{
                                pkg_name.fmtJson(buf, .{ .quote = false }),
                                res.value.symlink.fmtJson(buf, .{ .quote = false }),
                            });

                            try writePackageInfoObject(writer, dep.behavior, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, &pkg_bin, buf, &optional_peers_buf, lockfile.buffers.extern_strings.items);

                            try writer.writeByte(']');
                        },
                        .npm => {
                            try writer.print("[\"{}@{}\", ", .{
                                pkg_name.fmtJson(buf, .{ .quote = false }),
                                res.value.npm.version.fmt(buf),
                            });

                            // only write the registry if it's not the default. empty string means default registry
                            try writer.print("\"{s}\", ", .{
                                if (strings.hasPrefixComptime(res.value.npm.url.slice(buf), strings.withoutTrailingSlash(Npm.Registry.default_url)))
                                    ""
                                else
                                    res.value.npm.url.slice(buf),
                            });

                            try writePackageInfoObject(writer, dep.behavior, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, &pkg_bin, buf, &optional_peers_buf, lockfile.buffers.extern_strings.items);

                            try writer.print(", \"{}\"]", .{
                                pkg_meta.integrity,
                            });
                        },
                        .workspace => {
                            try writer.print("[\"{}@workspace:{}\", ", .{
                                pkg_name.fmtJson(buf, .{ .quote = false }),
                                res.value.workspace.fmtJson(buf, .{ .quote = false }),
                            });

                            try writePackageInfoObject(writer, dep.behavior, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, &pkg_bin, buf, &optional_peers_buf, lockfile.buffers.extern_strings.items);

                            try writer.writeByte(']');
                        },
                        inline .git, .github => |tag| {
                            const repo: Repository = @field(res.value, @tagName(tag));
                            try writer.print("[\"{}@{}\", ", .{
                                pkg_name.fmtJson(buf, .{ .quote = false }),
                                repo.fmt(if (comptime tag == .git) "git+" else "github:", buf),
                            });

                            try writePackageInfoObject(writer, dep.behavior, deps_buf, pkg_deps_sort_buf.items, &pkg_meta, &pkg_bin, buf, &optional_peers_buf, lockfile.buffers.extern_strings.items);

                            try writer.print(", {}]", .{
                                repo.resolved.fmtJson(buf, .{}),
                            });
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
    }

    /// Writes a single line object. Contains dependencies, os, cpu, libc (soon), and bin
    /// { "devDependencies": { "one": "1.1.1", "two": "2.2.2" }, "os": "none" }
    fn writePackageInfoObject(
        writer: anytype,
        dep_behavior: Dependency.Behavior,
        deps_buf: []const Dependency,
        pkg_dep_ids: []const DependencyID,
        meta: *const Meta,
        bin: *const Install.Bin,
        buf: string,
        optional_peers_buf: *std.ArrayList(String),
        extern_strings: []const ExternalString,
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

                try writer.print("{}: {}", .{
                    bun.fmt.formatJSONStringUTF8(dep.name.slice(buf), .{}),
                    bun.fmt.formatJSONStringUTF8(dep.version.literal.slice(buf), .{}),
                });
            }

            if (!first) {
                try writer.writeAll(" }");
            }
        }

        if (optional_peers_buf.items.len > 0) {
            bun.debugAssert(any);
            try writer.writeAll(
                \\, "optionalPeers": [
            );

            for (optional_peers_buf.items, 0..) |optional_peer, i| {
                try writer.print(
                    \\{s}{}{s}
                , .{
                    if (i != 0) " " else "",
                    bun.fmt.formatJSONStringUTF8(optional_peer.slice(buf), .{}),
                    if (i != optional_peers_buf.items.len - 1) "," else "",
                });
            }

            try writer.writeByte(']');
        }

        if (dep_behavior.isBundled()) {
            if (any) {
                try writer.writeByte(',');
            } else {
                any = true;
            }

            try writer.writeAll(
                \\ "bundled": true
            );
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

        if (bin.tag != .none) {
            if (any) {
                try writer.writeByte(',');
            } else {
                any = true;
            }
            try writer.writeAll(if (bin.tag == .dir) " \"binDir\": " else " \"bin\": ");
            try bin.toSingleLineJson(buf, extern_strings, writer);
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
            const root_name = pkg_names[0].slice(buf);
            if (root_name.len > 0) {
                try writer.writeByte('\n');
                try incIndent(writer, indent);
                try writer.print("\"name\": {}", .{
                    bun.fmt.formatJSONStringUTF8(root_name, .{}),
                });

                // TODO(dylan-conway) should we save version?
                any = true;
            }
        } else {
            try writer.print("{}: {{", .{
                bun.fmt.formatJSONStringUTF8(res.slice(buf), .{}),
            });
            try writer.writeByte('\n');
            try incIndent(writer, indent);
            try writer.print("\"name\": {}", .{
                bun.fmt.formatJSONStringUTF8(pkg_names[pkg_id].slice(buf), .{}),
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

                try writer.print("{}: {}", .{
                    bun.fmt.formatJSONStringUTF8(name, .{}),
                    bun.fmt.formatJSONStringUTF8(version, .{}),
                });
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
                \\"optionalPeers": [
                \\
            );
            indent.* += 1;
            for (optional_peers_buf.items) |optional_peer| {
                try writeIndent(writer, indent);
                try writer.print(
                    \\{},
                    \\
                , .{
                    bun.fmt.formatJSONStringUTF8(optional_peer.slice(buf), .{}),
                });
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

const workspace_dependency_groups = [4]struct { []const u8, Dependency.Behavior }{
    .{ "dependencies", Dependency.Behavior.prod },
    .{ "devDependencies", Dependency.Behavior.dev },
    .{ "optionalDependencies", Dependency.Behavior.optional },
    .{ "peerDependencies", Dependency.Behavior.peer },
};

const ParseError = OOM || error{
    InvalidLockfileVersion,
    UnknownLockfileVersion,
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
    lockfile.initEmpty(allocator);

    const lockfile_version_expr = root.get("lockfileVersion") orelse {
        try log.addError(source, root.loc, "Missing lockfile version");
        return error.InvalidLockfileVersion;
    };

    const lockfile_version: u32 = lockfile_version: {
        err: {
            switch (lockfile_version_expr.data) {
                .e_number => |num| {
                    if (num.value < 0 or num.value > std.math.maxInt(u32)) {
                        break :err;
                    }

                    break :lockfile_version @intFromFloat(std.math.divExact(f64, num.value, 1) catch break :err);
                },
                else => {},
            }
        }

        try log.addError(source, lockfile_version_expr.loc, "Invalid lockfile version");
        return error.InvalidLockfileVersion;
    };

    lockfile.text_lockfile_version = std.meta.intToEnum(Version, lockfile_version) catch {
        try log.addError(source, lockfile_version_expr.loc, "Unknown lockfile version");
        return error.InvalidLockfileVersion;
    };

    var string_buf = lockfile.stringBuf();

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

    const root_pkg_exr = maybe_root_pkg orelse {
        try log.addError(source, workspaces.loc, "Expected root package");
        return error.InvalidWorkspaceObject;
    };

    {
        const maybe_name = if (root_pkg_exr.get("name")) |name| name.asString(allocator) orelse {
            try log.addError(source, name.loc, "Expected a string");
            return error.InvalidWorkspaceObject;
        } else null;

        const off, var len = try parseAppendDependencies(lockfile, allocator, &root_pkg_exr, &string_buf, log, source, &optional_peers_buf);

        var root_pkg: BinaryLockfile.Package = .{};
        root_pkg.meta.id = 0;

        if (maybe_name) |name| {
            const name_hash = String.Builder.stringHash(name);
            root_pkg.name = try string_buf.appendWithHash(name, name_hash);
            root_pkg.name_hash = name_hash;
        }

        workspaces: for (lockfile.workspace_paths.values()) |workspace_path| {
            for (workspaces.data.e_object.properties.slice()) |prop| {
                const key = prop.key.?;
                const value = prop.value.?;
                const path = key.asString(allocator).?;
                if (!strings.eqlLong(path, workspace_path.slice(string_buf.bytes.items), true)) continue;

                const name = value.get("name").?.asString(allocator).?;
                const name_hash = String.Builder.stringHash(name);

                const dep: Dependency = .{
                    .name = try string_buf.appendWithHash(name, name_hash),
                    .name_hash = name_hash,
                    .behavior = Dependency.Behavior.workspace,
                    .version = .{
                        .tag = .workspace,
                        .value = .{
                            .workspace = try string_buf.append(path),
                        },
                    },
                };

                try lockfile.buffers.dependencies.append(allocator, dep);
                len += 1;
                continue :workspaces;
            }
        }

        root_pkg.dependencies = .{ .off = off, .len = len };
        root_pkg.resolutions = .{ .off = off, .len = len };

        root_pkg.meta.id = 0;
        try lockfile.packages.append(allocator, root_pkg);
        try lockfile.getOrPutID(0, root_pkg.name_hash);
    }

    const PkgMapEntry = struct {
        pkg_id: PackageID,
        bundled: bool,
    };
    var pkg_map = bun.StringArrayHashMap(PkgMapEntry).init(allocator);
    defer pkg_map.deinit();

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
                if (i >= pkg_info.len) {
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

            var bundled = false;

            // dependencies, os, cpu, libc
            switch (res.tag) {
                .npm, .folder, .git, .github, .local_tarball, .remote_tarball, .symlink, .workspace => {
                    if (i >= pkg_info.len) {
                        try log.addError(source, value.loc, "Missing dependencies object");
                        return error.InvalidPackageInfo;
                    }

                    const deps_os_cpu_libc_bin_bundle_obj = pkg_info.at(i);
                    i += 1;
                    if (!deps_os_cpu_libc_bin_bundle_obj.isObject()) {
                        try log.addError(source, deps_os_cpu_libc_bin_bundle_obj.loc, "Expected an object");
                        return error.InvalidPackageInfo;
                    }

                    if (deps_os_cpu_libc_bin_bundle_obj.get("bundled")) |bundled_expr| {
                        if (!bundled_expr.isBoolean()) {
                            try log.addError(source, bundled_expr.loc, "Expected a boolean");
                            return error.InvalidPackageInfo;
                        }

                        bundled = bundled_expr.data.e_boolean.value;
                    }

                    const off, const len = try parseAppendDependencies(lockfile, allocator, deps_os_cpu_libc_bin_bundle_obj, &string_buf, log, source, &optional_peers_buf);

                    pkg.dependencies = .{ .off = off, .len = len };
                    pkg.resolutions = .{ .off = off, .len = len };

                    if (deps_os_cpu_libc_bin_bundle_obj.get("bin")) |bin| {
                        pkg.bin = try Bin.parseAppend(allocator, bin, &string_buf, &lockfile.buffers.extern_strings);
                    } else if (deps_os_cpu_libc_bin_bundle_obj.get("binDir")) |bin_dir| {
                        pkg.bin = try Bin.parseAppendFromDirectories(allocator, bin_dir, &string_buf);
                    }

                    if (res.tag != .workspace) {
                        if (deps_os_cpu_libc_bin_bundle_obj.get("os")) |os| {
                            pkg.meta.os = try Negatable(Npm.OperatingSystem).fromJson(allocator, os);
                        }
                        if (deps_os_cpu_libc_bin_bundle_obj.get("cpu")) |arch| {
                            pkg.meta.arch = try Negatable(Npm.Architecture).fromJson(allocator, arch);
                        }
                        // TODO(dylan-conway)
                        // if (os_cpu_libc_obj.get("libc")) |libc| {
                        //     pkg.meta.libc = Negatable(Npm.Libc).fromJson(allocator, libc);
                        // }
                    }
                },
                .root => {
                    if (i >= pkg_info.len) {
                        try log.addError(source, value.loc, "Missing package binaries object");
                        return error.InvalidPackageInfo;
                    }
                    const bin_obj = pkg_info.at(i);
                    i += 1;
                    if (!bin_obj.isObject()) {
                        try log.addError(source, bin_obj.loc, "Expected an object");
                        return error.InvalidPackageInfo;
                    }

                    if (bin_obj.get("bin")) |bin| {
                        pkg.bin = try Bin.parseAppend(allocator, bin, &string_buf, &lockfile.buffers.extern_strings);
                    } else if (bin_obj.get("binDir")) |bin_dir| {
                        pkg.bin = try Bin.parseAppendFromDirectories(allocator, bin_dir, &string_buf);
                    }
                },
                else => {},
            }

            // integrity
            switch (res.tag) {
                .npm => {
                    if (i >= pkg_info.len) {
                        try log.addError(source, value.loc, "Missing integrity");
                        return error.InvalidPackageInfo;
                    }
                    const integrity_expr = pkg_info.at(i);
                    i += 1;
                    const integrity_str = integrity_expr.asString(allocator) orelse {
                        try log.addError(source, integrity_expr.loc, "Expected a string");
                        return error.InvalidPackageInfo;
                    };

                    pkg.meta.integrity = Integrity.parse(integrity_str);
                },
                inline .git, .github => |tag| {
                    // .bun-tag
                    if (i >= pkg_info.len) {
                        try log.addError(source, value.loc, "Missing git dependency tag");
                        return error.InvalidPackageInfo;
                    }

                    const bun_tag = pkg_info.at(i);
                    i += 1;

                    const bun_tag_str = bun_tag.asString(allocator) orelse {
                        try log.addError(source, bun_tag.loc, "Expected a string");
                        return error.InvalidPackageInfo;
                    };

                    @field(res.value, @tagName(tag)).resolved = try string_buf.append(bun_tag_str);
                },
                else => {},
            }

            pkg.name = name;
            pkg.name_hash = name_hash;
            pkg.resolution = res;
            pkg.scripts = .{};

            const pkg_id = try lockfile.appendPackageDedupe(&pkg, string_buf.bytes.items);

            const entry = try pkg_map.getOrPut(pkg_path);
            if (entry.found_existing) {
                try log.addError(source, key.loc, "Duplicate package path");
                return error.InvalidPackageKey;
            }

            entry.value_ptr.* = .{
                .pkg_id = pkg_id,
                .bundled = bundled,
            };
        }

        try lockfile.buffers.resolutions.ensureTotalCapacityPrecise(allocator, lockfile.buffers.dependencies.items.len);
        lockfile.buffers.resolutions.expandToCapacity();
        @memset(lockfile.buffers.resolutions.items, invalid_package_id);

        const pkgs = lockfile.packages.slice();
        const pkg_deps = pkgs.items(.dependencies);
        var pkg_metas = pkgs.items(.meta);
        var pkg_resolutions = pkgs.items(.resolution);

        {
            // first the root dependencies are resolved
            pkg_resolutions[0] = Resolution.init(.{ .root = {} });
            pkg_metas[0].origin = .local;

            for (pkg_deps[0].begin()..pkg_deps[0].end()) |_dep_id| {
                const dep_id: DependencyID = @intCast(_dep_id);
                const dep = lockfile.buffers.dependencies.items[dep_id];

                const entry = pkg_map.get(dep.name.slice(lockfile.buffers.string_bytes.items)) orelse {
                    if (dep.behavior.optional) {
                        continue;
                    }
                    try dependencyResolutionFailure(&dep, null, allocator, lockfile.buffers.string_bytes.items, source, log, root_pkg_exr.loc);
                    return error.InvalidPackageInfo;
                };

                lockfile.buffers.resolutions.items[dep_id] = entry.pkg_id;
                lockfile.buffers.dependencies.items[dep_id].behavior.bundled = entry.bundled;
            }

            // TODO(dylan-conway) should we handle workspaces separately here for custom hoisting

        }

        var path_buf: bun.PathBuffer = undefined;

        // then each package dependency
        for (pkgs_expr.data.e_object.properties.slice()) |prop| {
            const key = prop.key.?;

            const pkg_path = key.asString(allocator).?;

            const pkg_id = (pkg_map.get(pkg_path) orelse {
                return error.InvalidPackagesObject;
            }).pkg_id;

            // find resolutions. iterate up to root through the pkg path.
            deps: for (pkg_deps[pkg_id].begin()..pkg_deps[pkg_id].end()) |_dep_id| {
                const dep_id: DependencyID = @intCast(_dep_id);
                var dep = &lockfile.buffers.dependencies.items[dep_id];
                const dep_name = dep.name.slice(lockfile.buffers.string_bytes.items);

                @memcpy(path_buf[0..pkg_path.len], pkg_path);
                path_buf[pkg_path.len] = '/';
                var offset = pkg_path.len + 1;

                var valid = true;
                while (valid) {
                    @memcpy(path_buf[offset..][0..dep_name.len], dep_name);
                    const res_path = path_buf[0 .. offset + dep_name.len];

                    if (pkg_map.get(res_path)) |entry| {
                        lockfile.buffers.resolutions.items[dep_id] = entry.pkg_id;
                        dep.behavior.bundled = entry.bundled;
                        continue :deps;
                    }

                    if (offset == 0) {
                        if (dep.behavior.optional) {
                            continue :deps;
                        }
                        try dependencyResolutionFailure(dep, pkg_path, allocator, lockfile.buffers.string_bytes.items, source, log, key.loc);
                        return error.InvalidPackageInfo;
                    }

                    const slash = strings.lastIndexOfChar(path_buf[0 .. offset - 1], '/') orelse {
                        offset = 0;
                        continue;
                    };

                    // might be a scoped package
                    const at = strings.lastIndexOfChar(path_buf[0 .. offset - 1], '@') orelse {
                        offset = slash + 1;
                        continue;
                    };

                    if (at > slash) {
                        valid = false;
                        continue;
                    }

                    const next_slash = strings.lastIndexOfChar(path_buf[0..slash], '/') orelse {
                        if (at != 0) {
                            try log.addError(source, key.loc, "Invalid package path");
                            return error.InvalidPackageKey;
                        }
                        offset = 0;
                        continue;
                    };

                    if (next_slash > at) {
                        // there's a scoped package but it exists farther up
                        offset = slash + 1;
                        continue;
                    }

                    if (next_slash + 1 != at) {
                        valid = false;
                        continue;
                    }

                    offset = at;
                }

                try log.addError(source, key.loc, "Invalid package path");
                return error.InvalidPackageKey;
            }
        }

        lockfile.resolve(log) catch |err| {
            switch (err) {
                error.OutOfMemory => |oom| return oom,
                else => {
                    return error.InvalidPackagesObject;
                },
            }
        };

        return;
    }

    lockfile.initEmpty(allocator);
}

fn dependencyResolutionFailure(dep: *const Dependency, pkg_path: ?string, allocator: std.mem.Allocator, buf: string, source: *const logger.Source, log: *logger.Log, loc: logger.Loc) OOM!void {
    const behavior_str = if (dep.behavior.dev)
        "dev"
    else if (dep.behavior.optional)
        "optional"
    else if (dep.behavior.peer)
        "peer"
    else if (dep.behavior.isWorkspaceOnly())
        "workspace"
    else
        "prod";

    if (pkg_path) |path| {
        try log.addErrorFmt(source, loc, allocator, "Failed to resolve {s} dependency '{s}' for package '{s}'", .{
            behavior_str,
            dep.name.slice(buf),
            path,
        });
    } else {
        try log.addErrorFmt(source, loc, allocator, "Failed to resolve root {s} dependency '{s}'", .{
            behavior_str,
            dep.name.slice(buf),
        });
    }
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

    if (obj.get("optionalPeers")) |optional_peers| {
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

                const dep: Dependency = .{
                    .name = name.value,
                    .name_hash = name.hash,
                    .behavior = if (group_behavior.peer and optional_peers_buf.contains(name.hash))
                        group_behavior.add(.optional)
                    else
                        group_behavior,
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
