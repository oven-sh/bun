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

    pub const IdMap = struct {
        root: Node,

        pub const Node = struct {
            id: PackageID,
            parent: ?*const Node,
            nodes: bun.StringArrayHashMapUnmanaged(Node),

            pub fn deinit(this: *Node, allocator: std.mem.Allocator) void {
                for (this.nodes.values()) |*node| {
                    node.deinit(allocator);
                }

                this.nodes.deinit(allocator);
            }
        };

        pub fn init() IdMap {
            return .{
                .root = .{
                    .id = 0,
                    .parent = null,
                    .nodes = .{},
                },
            };
        }

        pub fn deinit(this: *IdMap, allocator: std.mem.Allocator) void {
            for (this.root.nodes.values()) |*node| {
                node.deinit(allocator);
            }
        }

        const InsertError = OOM || error{
            InvalidPackageKey,
            DuplicatePackagePath,
        };

        pub fn insert(this: *IdMap, allocator: std.mem.Allocator, pkg_path: string, id: PackageID) InsertError!void {
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
                        .id = invalid_package_id,
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

            if (curr.id != invalid_package_id) {
                return error.DuplicatePackagePath;
            }

            curr.id = id;
        }

        pub fn get(this: *IdMap, pkg_path: string) error{InvalidPackageKey}!?*Node {
            var iter = iterator(pkg_path);
            var curr: *Node = &this.root;
            while (try iter.next()) |name| {
                curr = curr.nodes.getPtr(name) orelse return null;
            }

            return curr;
        }
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
        const pkg_resolution: []Resolution = pkgs.items(.resolution);
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
                );
                for (0..pkgs.len) |pkg_id| {
                    const res = pkg_resolution[pkg_id];
                    if (res.tag != .workspace) continue;
                    try writer.writeAll(",\n");
                    try writeIndent(writer, indent);
                    try writeWorkspaceDeps(
                        writer,
                        indent,
                        @intCast(pkg_id),
                        res.value.workspace,
                        pkg_names,
                        pkg_name_hashes,
                        pkg_dep_lists,
                        buf,
                        deps_buf,
                        lockfile.workspace_versions,
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
                    const res = pkg_resolution[pkg_id];
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

            try writeIndent(writer, indent);
            try writer.writeAll("\"packages\": {");
            var first = true;
            while (pkgs_iter.next({})) |node| {
                for (node.dependencies) |dep_id| {
                    const pkg_id = resolution_buf[dep_id];
                    if (pkg_id == invalid_package_id) continue;

                    const res = pkg_resolution[pkg_id];
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
                    const pkg_deps = pkg_dep_lists[pkg_id].get(deps_buf);

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

                            try writePackageDeps(writer, pkg_deps, buf);

                            try writer.writeAll(", ");

                            try writeCpuAndOsAndLibc(writer, &pkg_meta);

                            try writer.print(", \"{}\"]", .{pkg_meta.integrity});
                        },
                        .local_tarball => {
                            try writer.print("[\"{s}@{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(res.value.local_tarball.slice(buf), .{ .quote = false }),
                            });

                            try writePackageDeps(writer, pkg_deps, buf);

                            try writer.writeAll(", ");

                            try writeCpuAndOsAndLibc(writer, &pkg_meta);

                            try writer.print(", \"{}\"]", .{pkg_meta.integrity});
                        },
                        .remote_tarball => {
                            try writer.print("[\"{s}@{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(res.value.remote_tarball.slice(buf), .{ .quote = false }),
                            });

                            try writePackageDeps(writer, pkg_deps, buf);

                            try writer.writeAll(", ");

                            try writeCpuAndOsAndLibc(writer, &pkg_meta);

                            try writer.print(", \"{}\"]", .{pkg_meta.integrity});
                        },
                        .symlink => {
                            try writer.print("[\"{s}@link:{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(res.value.symlink.slice(buf), .{ .quote = false }),
                            });

                            try writePackageDeps(writer, pkg_deps, buf);

                            try writer.writeAll(", ");

                            try writeCpuAndOsAndLibc(writer, &pkg_meta);

                            try writer.print(", \"{}\"]", .{pkg_meta.integrity});
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

                            try writePackageDeps(writer, pkg_deps, buf);

                            try writer.writeAll(", ");

                            try writeCpuAndOsAndLibc(writer, &pkg_meta);

                            // TODO(dylan-conway): delete placeholder
                            try writer.print(", \"{s}\"]", .{
                                // pkg_meta.integrity,
                                "hi",
                            });
                        },
                        .workspace => {
                            const workspace_path = res.value.workspace.slice(buf);

                            try writer.print("[\"{s}@workspace:{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(workspace_path, .{ .quote = false }),
                            });

                            try writePackageDeps(writer, pkg_deps, buf);

                            try writer.writeByte(']');
                        },
                        inline .git, .github => |tag| {
                            const repo: Repository = @field(res.value, @tagName(tag));
                            try writer.print("[\"{s}@{}\", ", .{
                                pkg_name,
                                repo.fmt(if (comptime tag == .git) "git+" else "github:", buf),
                            });

                            try writePackageDeps(writer, pkg_deps, buf);

                            try writer.writeAll(", ");

                            try writeCpuAndOsAndLibc(writer, &pkg_meta);

                            try writer.print(", \"{}\"]", .{pkg_meta.integrity});
                        },
                        else => unreachable,
                    }
                }
            }

            if (!first) {
                try writer.writeByte('\n');
                try decIndent(writer, indent);
            }
            try writer.writeAll("}\n");
        }
        try decIndent(writer, indent);
        try writer.writeAll("}\n");

        try buffered_writer.flush();
        return writer_buf.list.items;
    }

    /// writes a one line object with os, cpu, and libc fields
    fn writeCpuAndOsAndLibc(
        writer: anytype,
        meta: *const Meta,
    ) OOM!void {
        try writer.writeByte('{');

        if (meta.os != .all) {
            try writer.writeAll(
                \\"os": 
            );
            try Negatable(Npm.OperatingSystem).toJson(meta.os, writer);
            try writer.writeAll(", ");
        }

        if (meta.arch != .all) {
            try writer.writeAll(
                \\"cpu": 
            );
            try Negatable(Npm.Architecture).toJson(meta.arch, writer);
            try writer.writeAll(", ");
        }

        // TODO(dylan-conway)
        // if (meta.libc != .all) {
        //     try writer.writeAll(
        //         \\"libc": [
        //     );
        //     try Negatable(Npm.Libc).toJson(meta.libc, writer);
        //     try writer.writeAll("], ");
        // }

        try writer.writeByte('}');
    }

    /// Writes a single line object.
    /// { "devDependencies": { "one": "1.1.1", "two": "2.2.2" } }
    fn writePackageDeps(
        writer: anytype,
        deps: []const Dependency,
        buf: string,
    ) OOM!void {
        try writer.writeByte('{');

        var any = false;
        inline for (workspace_dependency_groups) |group| {
            const group_name, const group_behavior = group;

            var first = true;
            for (deps) |dep| {
                if (!dep.behavior.includes(group_behavior)) continue;

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
    ) OOM!void {
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
                try writer.writeByte('\n');
                try decIndent(writer, indent);
                try writer.writeAll("}");
            }
        }
        if (any) {
            try writer.writeByte('\n');
            try decIndent(writer, indent);
        }
        try writer.writeAll("}");
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
    .{ "peerDependencies", Dependency.Behavior.peer },
    .{ "optionalDependencies", Dependency.Behavior.optional },
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

    if (maybe_root_pkg) |root_pkg| {
        // TODO(dylan-conway): maybe sort this. behavior is already sorted, but names are not
        const maybe_name = if (root_pkg.get("name")) |name| name.asString(allocator) orelse {
            try log.addError(source, name.loc, "Expected a string");
            return error.InvalidWorkspaceObject;
        } else null;

        const off, const len = try parseAppendDependencies(lockfile, allocator, &root_pkg, &string_buf, log, source);

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

    var id_map = PkgPath.IdMap.init();
    defer id_map.deinit(allocator);

    if (root.get("packages")) |pkgs_expr| {
        if (!pkgs_expr.isObject()) {
            try log.addError(source, pkgs_expr.loc, "Expected an object");
            return error.InvalidPackagesObject;
        }

        for (pkgs_expr.data.e_object.properties.slice(), 1..) |prop, _pkg_id| {
            const pkg_id: PackageID = @intCast(_pkg_id);
            const key = prop.key.?;
            const value = prop.value.?;

            const pkg_path = key.asString(allocator) orelse {
                try log.addError(source, key.loc, "Expected a string");
                return error.InvalidPackageKey;
            };

            id_map.insert(allocator, pkg_path, pkg_id) catch |err| {
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

            switch (res.tag) {
                .npm => {},
                .workspace => {
                    // if (pkg_info.len < 2) {
                    //     try log.addError(source, value.loc, "Missing workspace version");
                    //     return error.InvalidPackageInfo;
                    // }

                    // i += 1;
                    // const version_expr = pkg_info.at(i);
                    // const version_str = version_expr.asString(allocator) orelse {
                    //     try log.addError(source, version_expr.loc, "Expected a string");
                    //     return error.InvalidPackageInfo;
                    // };
                    // if (version_str.len == 0) {
                    //     // workspace does not have a version
                    // } else {
                    //     const version = try string_buf.append(version_str);
                    //     const parsed = Semver.Version.parse(version.sliced(string_buf.bytes.items));
                    //     if (!parsed.valid or (parsed.version.major == null or parsed.version.minor == null or parsed.version.patch == null)) {
                    //         try log.addError(source, version_expr.loc, "Invalid workspace version");
                    //         return error.InvalidSemver;
                    //     }

                    //     lockfile.workspace_versions.put(allocator, name_hash, parsed.version.min());
                    // }
                },
                else => {},
            }

            var pkg: BinaryLockfile.Package = .{};

            // dependencies
            switch (res.tag) {
                .npm, .folder, .git, .github, .local_tarball, .remote_tarball, .symlink, .workspace => {
                    const deps_obj = pkg_info.at(i);
                    i += 1;
                    if (!deps_obj.isObject()) {
                        try log.addError(source, deps_obj.loc, "Expected an object");
                        return error.InvalidPackageInfo;
                    }

                    // TODO(dylan-conway): maybe sort this. behavior is already sorted, but names are not
                    const off, const len = try parseAppendDependencies(lockfile, allocator, deps_obj, &string_buf, log, source);

                    pkg.dependencies = .{ .off = off, .len = len };
                    pkg.resolutions = .{ .off = off, .len = len };
                },
                else => {},
            }

            // cpu, os, and libc
            switch (res.tag) {
                .folder, .local_tarball, .remote_tarball, .symlink, .npm, .git, .github => {
                    const os_cpu_libc_obj = pkg_info.at(i);
                    i += 1;
                    if (!os_cpu_libc_obj.isObject()) {
                        try log.addError(source, os_cpu_libc_obj.loc, "Expected an object");
                        return error.InvalidPackageInfo;
                    }

                    if (os_cpu_libc_obj.get("os")) |os| {
                        pkg.meta.os = try Negatable(Npm.OperatingSystem).fromJson(allocator, os);
                    }
                    if (os_cpu_libc_obj.get("cpu")) |arch| {
                        pkg.meta.arch = try Negatable(Npm.Architecture).fromJson(allocator, arch);
                    }
                    // TODO(dylan-conway)
                    // if (os_cpu_libc_obj.get("libc")) |libc| {
                    //     pkg.meta.libc = Negatable(Npm.Libc).fromJson(allocator, libc);
                    // }
                },
                else => {},
            }

            // integrity
            switch (res.tag) {
                .npm, .git, .github => {
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

            pkg.meta.id = pkg_id;

            // set later
            pkg.bin = .{};
            pkg.scripts = .{};

            try lockfile.packages.append(allocator, pkg);
        }

        try lockfile.buffers.resolutions.ensureTotalCapacity(allocator, lockfile.buffers.dependencies.items.len);
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
            // root pkg
            pkg_resolutions[0] = Resolution.init(.{ .root = {} });
            pkg_metas[0].origin = .local;

            for (pkg_deps[0].begin()..pkg_deps[0].end()) |dep_id| {
                const dep = lockfile.buffers.dependencies.items[dep_id];

                if (id_map.root.nodes.get(dep.name.slice(string_buf.bytes.items))) |dep_node| {
                    lockfile.buffers.resolutions.items[dep_id] = dep_node.id;
                }
            }
        }

        for (pkgs_expr.data.e_object.properties.slice(), 1..) |prop, _pkg_id| {
            const pkg_id: PackageID = @intCast(_pkg_id);

            const key = prop.key.?;
            const value = prop.value.?;

            const pkg_path = key.asString(allocator).?;
            const i: usize = 0;
            _ = i;
            const pkg_info = value.data.e_array.items;
            _ = pkg_info;

            const id_node = try id_map.get(pkg_path) orelse {
                return error.InvalidPackagesObject;
            };

            // find resolutions. iterate up to root through the pkg path.
            deps: for (pkg_deps[pkg_id].begin()..pkg_deps[pkg_id].end()) |dep_id| {
                const dep = lockfile.buffers.dependencies.items[dep_id];

                var curr: ?*const PkgPath.IdMap.Node = id_node;
                while (curr) |node| {
                    if (node.nodes.get(dep.name.slice(string_buf.bytes.items))) |dep_node| {
                        lockfile.buffers.resolutions.items[dep_id] = dep_node.id;
                        continue :deps;
                    }
                    curr = node.parent orelse if (curr != &id_map.root) &id_map.root else null;
                }
            }
        }
    }

    lockfile.buffers.string_bytes = string_buf.bytes.moveToUnmanaged();
}

fn parseAppendDependencies(
    lockfile: *BinaryLockfile,
    allocator: std.mem.Allocator,
    obj: *const Expr,
    buf: *String.Buf,
    log: *logger.Log,
    source: *const logger.Source,
) ParseError!struct { u32, u32 } {
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

                try lockfile.buffers.dependencies.append(allocator, dep);
            }
        }
    }
    const end = lockfile.buffers.dependencies.items.len;

    return .{ @intCast(off), @intCast(end - off) };
}

// fn loadFromJson(allocator: std.mem.Allocator, json: Expr, source: *const logger.Source, log: *logger.Log) !*Lockfile {
//     var string_buf = String.Buf.init(allocator);

//     const version_expr: Expr = json.get("lockfileVersion") orelse {
//         try log.addError(source, logger.Loc.Empty, "Missing lockfile version");
//         return error.InvalidLockfileVersion;
//     };

//     const version: u32 = switch (version_expr.data) {
//         .e_number => |num| @intFromFloat(std.math.divExact(f64, num.value, 1) catch return error.InvalidLockfileVersion),
//         else => return error.InvalidLockfileVersion,
//     };

//     const optional = if (json.get("optional")) |optional_expr|
//         switch (optional_expr.data) {
//             .e_boolean => optional_expr.data.e_boolean.value,
//             else => {
//                 try log.addError(source, optional_expr.loc, "Expected a boolean");
//                 return error.InvalidOptionalValue;
//             },
//         }
//     else
//         true;

//     const peer = if (json.get("peer")) |peer_expr|
//         switch (peer_expr.data) {
//             .e_boolean => peer_expr.data.e_boolean.value,
//             else => {
//                 try log.addError(source, peer_expr.loc, "Expected a boolean");
//                 return error.InvalidPeerValue;
//             },
//         }
//     else
//         true;

//     const default_registry: URL = if (json.get("defaultRegistry")) |default_registry_expr|
//         switch (default_registry_expr.data) {
//             .e_string => URL.parse(try default_registry_expr.data.e_string.stringCloned(allocator)),
//             else => {
//                 try log.addError(source, default_registry_expr.loc, "Expected a string");
//                 return error.InvalidDefaultRegistry;
//             },
//         }
//     else
//         .{};

//     var workspace_paths: bun.StringHashMapUnmanaged(string) = .{};
//     const workspace_versions: bun.StringHashMapUnmanaged(string) = .{};
//     if (json.get("workspaces")) |workspaces| {
//         if (!workspaces.isObject()) {
//             try log.addError(source, workspaces.loc, "Expected an object");
//             return error.InvalidWorkspacesObject;
//         }

//         const workspaces_obj = workspaces.data.e_object;

//         {
//             const root: Expr = workspaces_obj.get("") orelse {
//                 try log.addError(source, workspaces.loc, "Expected root \"\" property");
//                 return error.InvalidWorkspacesObject;
//             };

//             try loadWorkspace(allocator, root, source, log, .root);
//         }

//         const props = workspaces_obj.properties.slice();
//         for (props) |prop| {
//             const key: Expr = prop.key orelse {
//                 try log.addError(source, logger.Loc.Empty, "Expected a key");
//                 return error.InvalidWorkspacesObject;
//             };

//             const workspace_path = try key.asStringCloned(allocator) orelse {
//                 try log.addError(source, key.loc, "Expected a workspace path string");
//                 return error.InvalidWorkspacesObject;
//             };

//             if (workspace_path.len == 0) {
//                 // root package already loaded
//                 continue;
//             }

//             const workspace = prop.value orelse {
//                 try log.addError(source, key.loc, "Expected property value");
//                 return error.InvalidWorkspacesObject;
//             };

//             const name = try loadWorkspace(allocator, workspace, source, log, .workspace);
//             const entry = try workspace_paths.getOrPut(allocator, name);
//             if (entry.found_existing) {
//                 try log.addErrorFmt(source, key.loc, allocator, "Duplicate workspace '{s}'", .{name});
//                 return error.InvalidWorkspaceObject;
//             }
//             entry.value_ptr.* = workspace_path;
//         }
//     }

//     // TODO(dylan-conway): we could pause loading here, do the diff, then watch for the removed/changed
//     // dependencies when we continue.

//     var tree = Tree.init(allocator);
//     if (json.get("packages")) |pkgs| {
//         if (!pkgs.isObject()) {
//             try log.addError(source, pkgs.loc, "Expected an object");
//             return error.InvalidPackagesObject;
//         }

//         const pkgs_obj = pkgs.data.e_object;
//         const props = pkgs_obj.properties.slice();
//         for (props, 0..) |prop, i| {
//             _ = i;
//             const key: Expr = prop.key orelse {
//                 try log.addError(source, logger.Loc.Empty, "Expected package key");
//                 return error.InvalidPackagesProp;
//             };
//             const pkg_path = try key.asStringCloned(allocator) orelse {
//                 try log.addError(source, key.loc, "Expected a string");
//                 return error.InvalidPackageKey;
//             };

//             const value: Expr = prop.value orelse {
//                 try log.addError(source, logger.Loc.Empty, "Expected package value");
//                 return error.InvalidPackageInfo;;
//             };

//             if (!value.isArray()) {
//                 try log.addError(source, value.loc, "Expected an array");
//                 return error.InvalidPackageInfo;;
//             }

//             const pkg_items = value.data.e_array.slice();
//             if (pkg_items.len == 0) {
//                 try log.addError(source, value.loc, "Expected non-empty array");
//                 return error.InvalidPackageInfo;;
//             }

//             const name_and_resolution_str = try pkg_items[0].asStringCloned(allocator) orelse {
//                 try log.addError(source, pkg_items[0].loc, "Expected a string");
//                 return error.InvalidPackageSpecifier;
//             };

//             const resolved_name, var res_str = Dependency.splitNameAndVersion(name_and_resolution_str) catch {
//                 try log.addError(source, pkg_items[0].loc, "Expected package resolution");
//                 return error.InvalidPackageInfo;;
//             };

//             const name = try string_buf.append(resolved_name);

//             const resolution: Tree.Package.Resolution = resolution: {
//                 if (strings.hasPrefixComptime(res_str, "root:")) {
//                     break :resolution .root;
//                 } else if (strings.hasPrefixComptime(res_str, "github:")) {
//                     //
//                 } else if (strings.hasPrefixComptime(res_str, "link:")) {
//                     //
//                 } else if (strings.hasPrefixComptime(res_str, "workspace:")) {
//                     //
//                     res_str = res_str["workspace:".len..];
//                 } else if (strings.hasPrefixComptime(res_str, "file:")) {
//                     //
//                 } else if (strings.hasPrefixComptime(res_str, "git+")) {
//                     //
//                 } else if (strings.hasPrefixComptime(res_str, "github:")) {
//                     //
//                 } else if (strings.hasPrefixComptime(res_str, "npm:")) {
//                     //
//                     res_str = res_str["npm:".len..];

//                     const parsed = try Semver.Version.parseAppend(res_str, &string_buf);
//                     if (!parsed.valid) {
//                         try log.addErrorFmt(source, pkg_items[0].loc, allocator, "Invalid semver '{s}'", .{res_str});
//                         return error.InvalidSemver;
//                     }

//                     break :resolution .{
//                         .npm = .{
//                             .version = parsed.version.min(),
//                         },
//                     };
//                 } else {
//                     // must be a local or remote tarball
//                     bun.assertWithLocation(Dependency.isRemoteTarball(res_str) or Dependency.isTarball(res_str), @src());
//                 }

//                 break :resolution .uninitialized;
//             };

//             tree.put(&string_buf, pkg_path, name, resolution) catch |err| return switch (err) {
//                 error.OutOfMemory => |oom| oom,
//                 else => {
//                     try log.addError(source, key.loc, "Invalid package specifier path");
//                     return error.InvalidPackageSpecifier;
//                 },
//             };
//         }

//         var stack: std.ArrayListUnmanaged(Tree.Package.Map) = .{};
//         defer stack.deinit(allocator);

//         try stack.append(allocator, tree.root);

//         while (stack.popOrNull()) |packages| {
//             var iter = packages.iterator();
//             while (iter.next()) |entry| {
//                 const package = entry.value_ptr.*;
//                 if (package.packages.count() > 0) {
//                     try stack.append(allocator, package.packages);
//                 }

//                 if (package.resolution == .uninitialized) {
//                     const name = entry.key_ptr.slice(string_buf.bytes.items);
//                     try log.addErrorFmt(source, pkgs.loc, allocator, "Failed to build package tree, '{s}' is uninitialized", .{
//                         name,
//                     });
//                 }
//             }
//         }

//         if (log.hasErrors()) {
//             return error.InvalidPackagesTree;
//         }
//     }

//     const lockfile = bun.create(allocator, Lockfile, .{
//         .version = @enumFromInt(version),
//         .optional = optional,
//         .peer = peer,
//         .default_registry = default_registry,
//         .tree = tree,
//         .workspace_paths = workspace_paths,
//         .workspace_versions = workspace_versions,
//         .string_buf = string_buf,
//     });

//     return lockfile;
// }

// pub const Lockfile = struct {
// version: Version,

// optional: bool = true,
// peer: bool = true,

// default_registry: URL,

// // tree: Tree,

// workspace_paths: bun.StringHashMapUnmanaged(string),
// workspace_versions: bun.StringHashMapUnmanaged(string),

// // for package names and versions
// string_buf: String.Buf,

// pub const Version = enum(u32) {
//     v0 = 0,
//     v1,

//     pub const current: Version = .v0;
// };

// const Diff = struct {
//     added: usize = 0,
//     removed: usize = 0,
//     changed: usize = 0,
// };

// pub fn diff(prev: *const Lockfile) Diff {
//     _ = prev;
// }

// pub fn load(allocator: std.mem.Allocator, source: *const logger.Source, log: *logger.Log) !*Lockfile {
//     var timer = std.time.Timer.start() catch unreachable;
//     const json = try JSON.parseUTF8(source, log, allocator);
//     std.debug.print("{} - parsed json\n", .{bun.fmt.fmtDuration(timer.read())});
//     return loadFromJson(allocator, json, source, log);
// }

// fn loadWorkspace(
//     allocator: std.mem.Allocator,
//     workspace: Expr,
//     source: *const logger.Source,
//     log: *logger.Log,
//     comptime kind: enum { root, workspace },
// ) !if (kind == .workspace) string else void {
//     if (!workspace.isObject()) {
//         try log.addError(source, workspace.loc, "Expected an object");
//         return error.InvalidWorkspacesObject;
//     }

//     const workspace_obj = workspace.data.e_object;

//     const dependency_groups = &.{
//         "dependencies",
//         "devDependencies",
//         "peerDependencies",
//         "optionalDependencies",
//     };

//     inline for (dependency_groups) |group| {
//         if (workspace_obj.get(group)) |group_expr| {
//             if (!group_expr.isObject()) {
//                 try log.addError(source, group_expr.loc, "Expected an object");
//                 return error.InvalidWorkspacesObject;
//             }
//             const group_obj = group_expr.data.e_object;

//             const props = group_obj.properties.slice();
//             for (props) |prop| {
//                 const key: Expr = prop.key orelse {
//                     try log.addError(source, group_expr.loc, "Expected a property key");
//                     return error.InvalidWorkspacesObject;
//                 };
//                 const dep_name = try key.asStringCloned(allocator) orelse {
//                     try log.addError(source, key.loc, "Expected a string key");
//                     return error.InvalidWorkspacesObject;
//                 };

//                 if (!strings.isNPMPackageName(dep_name)) {
//                     try log.addError(source, key.loc, "Expected valid package name");
//                     return error.InvalidWorkspacesObject;
//                 }
//             }
//         }
//     }

//     if (comptime kind == .workspace) {
//         const name: Expr = workspace_obj.get("name") orelse {
//             try log.addError(source, workspace.loc, "Expected name property");
//             return error.InvalidWorkspaceObject;
//         };

//         const name_str = try name.asStringCloned(allocator) orelse {
//             try log.addError(source, name.loc, "Expected string name");
//             return error.InvalidWorkspaceObject;
//         };

//         if (!strings.isNPMPackageName(name_str)) {
//             try log.addError(source, name.loc, "Expected valid package name");
//             return error.InvalidWorkspaceObject;
//         }

//         return name_str;
//     }
// }

// fn loadFromJson(allocator: std.mem.Allocator, json: Expr, source: *const logger.Source, log: *logger.Log) !*Lockfile {
//     var string_buf = String.Buf.init(allocator);

//     const version_expr: Expr = json.get("lockfileVersion") orelse {
//         try log.addError(source, logger.Loc.Empty, "Missing lockfile version");
//         return error.InvalidLockfileVersion;
//     };

//     const version: u32 = switch (version_expr.data) {
//         .e_number => |num| @intFromFloat(std.math.divExact(f64, num.value, 1) catch return error.InvalidLockfileVersion),
//         else => return error.InvalidLockfileVersion,
//     };

//     const optional = if (json.get("optional")) |optional_expr|
//         switch (optional_expr.data) {
//             .e_boolean => optional_expr.data.e_boolean.value,
//             else => {
//                 try log.addError(source, optional_expr.loc, "Expected a boolean");
//                 return error.InvalidOptionalValue;
//             },
//         }
//     else
//         true;

//     const peer = if (json.get("peer")) |peer_expr|
//         switch (peer_expr.data) {
//             .e_boolean => peer_expr.data.e_boolean.value,
//             else => {
//                 try log.addError(source, peer_expr.loc, "Expected a boolean");
//                 return error.InvalidPeerValue;
//             },
//         }
//     else
//         true;

//     const default_registry: URL = if (json.get("defaultRegistry")) |default_registry_expr|
//         switch (default_registry_expr.data) {
//             .e_string => URL.parse(try default_registry_expr.data.e_string.stringCloned(allocator)),
//             else => {
//                 try log.addError(source, default_registry_expr.loc, "Expected a string");
//                 return error.InvalidDefaultRegistry;
//             },
//         }
//     else
//         .{};

//     var workspace_paths: bun.StringHashMapUnmanaged(string) = .{};
//     const workspace_versions: bun.StringHashMapUnmanaged(string) = .{};
//     if (json.get("workspaces")) |workspaces| {
//         if (!workspaces.isObject()) {
//             try log.addError(source, workspaces.loc, "Expected an object");
//             return error.InvalidWorkspacesObject;
//         }

//         const workspaces_obj = workspaces.data.e_object;

//         {
//             const root: Expr = workspaces_obj.get("") orelse {
//                 try log.addError(source, workspaces.loc, "Expected root \"\" property");
//                 return error.InvalidWorkspacesObject;
//             };

//             try loadWorkspace(allocator, root, source, log, .root);
//         }

//         const props = workspaces_obj.properties.slice();
//         for (props) |prop| {
//             const key: Expr = prop.key orelse {
//                 try log.addError(source, logger.Loc.Empty, "Expected a key");
//                 return error.InvalidWorkspacesObject;
//             };

//             const workspace_path = try key.asStringCloned(allocator) orelse {
//                 try log.addError(source, key.loc, "Expected a workspace path string");
//                 return error.InvalidWorkspacesObject;
//             };

//             if (workspace_path.len == 0) {
//                 // root package already loaded
//                 continue;
//             }

//             const workspace = prop.value orelse {
//                 try log.addError(source, key.loc, "Expected property value");
//                 return error.InvalidWorkspacesObject;
//             };

//             const name = try loadWorkspace(allocator, workspace, source, log, .workspace);
//             const entry = try workspace_paths.getOrPut(allocator, name);
//             if (entry.found_existing) {
//                 try log.addErrorFmt(source, key.loc, allocator, "Duplicate workspace '{s}'", .{name});
//                 return error.InvalidWorkspaceObject;
//             }
//             entry.value_ptr.* = workspace_path;
//         }
//     }

//     // TODO(dylan-conway): we could pause loading here, do the diff, then watch for the removed/changed
//     // dependencies when we continue.

//     var tree = Tree.init(allocator);
//     if (json.get("packages")) |pkgs| {
//         if (!pkgs.isObject()) {
//             try log.addError(source, pkgs.loc, "Expected an object");
//             return error.InvalidPackagesObject;
//         }

//         const pkgs_obj = pkgs.data.e_object;
//         const props = pkgs_obj.properties.slice();
//         for (props, 0..) |prop, i| {
//             _ = i;
//             const key: Expr = prop.key orelse {
//                 try log.addError(source, logger.Loc.Empty, "Expected package key");
//                 return error.InvalidPackagesProp;
//             };
//             const pkg_path = try key.asStringCloned(allocator) orelse {
//                 try log.addError(source, key.loc, "Expected a string");
//                 return error.InvalidPackageKey;
//             };

//             const value: Expr = prop.value orelse {
//                 try log.addError(source, logger.Loc.Empty, "Expected package value");
//                 return error.InvalidPackageInfo;;
//             };

//             if (!value.isArray()) {
//                 try log.addError(source, value.loc, "Expected an array");
//                 return error.InvalidPackageInfo;;
//             }

//             const pkg_items = value.data.e_array.slice();
//             if (pkg_items.len == 0) {
//                 try log.addError(source, value.loc, "Expected non-empty array");
//                 return error.InvalidPackageInfo;;
//             }

//             const name_and_resolution_str = try pkg_items[0].asStringCloned(allocator) orelse {
//                 try log.addError(source, pkg_items[0].loc, "Expected a string");
//                 return error.InvalidPackageSpecifier;
//             };

//             const resolved_name, var res_str = Dependency.splitNameAndVersion(name_and_resolution_str) catch {
//                 try log.addError(source, pkg_items[0].loc, "Expected package resolution");
//                 return error.InvalidPackageInfo;;
//             };

//             const name = try string_buf.append(resolved_name);

//             const resolution: Tree.Package.Resolution = resolution: {
//                 if (strings.hasPrefixComptime(res_str, "root:")) {
//                     break :resolution .root;
//                 } else if (strings.hasPrefixComptime(res_str, "github:")) {
//                     //
//                 } else if (strings.hasPrefixComptime(res_str, "link:")) {
//                     //
//                 } else if (strings.hasPrefixComptime(res_str, "workspace:")) {
//                     //
//                     res_str = res_str["workspace:".len..];
//                 } else if (strings.hasPrefixComptime(res_str, "file:")) {
//                     //
//                 } else if (strings.hasPrefixComptime(res_str, "git+")) {
//                     //
//                 } else if (strings.hasPrefixComptime(res_str, "github:")) {
//                     //
//                 } else if (strings.hasPrefixComptime(res_str, "npm:")) {
//                     //
//                     res_str = res_str["npm:".len..];

//                     const parsed = try Semver.Version.parseAppend(res_str, &string_buf);
//                     if (!parsed.valid) {
//                         try log.addErrorFmt(source, pkg_items[0].loc, allocator, "Invalid semver '{s}'", .{res_str});
//                         return error.InvalidSemver;
//                     }

//                     break :resolution .{
//                         .npm = .{
//                             .version = parsed.version.min(),
//                         },
//                     };
//                 } else {
//                     // must be a local or remote tarball
//                     bun.assertWithLocation(Dependency.isRemoteTarball(res_str) or Dependency.isTarball(res_str), @src());
//                 }

//                 break :resolution .uninitialized;
//             };

//             tree.put(&string_buf, pkg_path, name, resolution) catch |err| return switch (err) {
//                 error.OutOfMemory => |oom| oom,
//                 else => {
//                     try log.addError(source, key.loc, "Invalid package specifier path");
//                     return error.InvalidPackageSpecifier;
//                 },
//             };
//         }

//         var stack: std.ArrayListUnmanaged(Tree.Package.Map) = .{};
//         defer stack.deinit(allocator);

//         try stack.append(allocator, tree.root);

//         while (stack.popOrNull()) |packages| {
//             var iter = packages.iterator();
//             while (iter.next()) |entry| {
//                 const package = entry.value_ptr.*;
//                 if (package.packages.count() > 0) {
//                     try stack.append(allocator, package.packages);
//                 }

//                 if (package.resolution == .uninitialized) {
//                     const name = entry.key_ptr.slice(string_buf.bytes.items);
//                     try log.addErrorFmt(source, pkgs.loc, allocator, "Failed to build package tree, '{s}' is uninitialized", .{
//                         name,
//                     });
//                 }
//             }
//         }

//         if (log.hasErrors()) {
//             return error.InvalidPackagesTree;
//         }
//     }

//     const lockfile = bun.create(allocator, Lockfile, .{
//         .version = @enumFromInt(version),
//         .optional = optional,
//         .peer = peer,
//         .default_registry = default_registry,
//         .tree = tree,
//         .workspace_paths = workspace_paths,
//         .workspace_versions = workspace_versions,
//         .string_buf = string_buf,
//     });

//     return lockfile;
// }

// pub const Installer = struct {
//     lockfile: *const Lockfile,
//     manager: *PackageManager,

//     root_node_modules_folder: std.fs.Dir,

//     force_install: bool,

//     pub const TreeContext = PackageManager.TreeContext;
//     pub const Summary = Install.PackageInstall.Summary;

//     pub fn installPackages(this: *Installer, packages: *const Tree.Package.Map) OOM!void {
//         var iter = packages.iterator();
//         while (iter.next()) |entry| {
//             const name = entry.key_ptr.slice(this.lockfile.string_buf.bytes.items);
//             try this.installPackage(name, entry.value_ptr);
//         }
//     }

//     pub fn installPackage(this: *Installer, name: string, package: *const Tree.Package) OOM!void {
//         const pkg_name = package.name.slice(this.lockfile.string_buf.bytes.items);
//         switch (package.resolution) {
//             .transitive => |transitive| {
//                 std.debug.print("installing: {s}@{s}\n", .{ name, transitive.resolution });
//             },
//             .workspace => |workspace| {
//                 std.debug.print("installing: {s}@workspace:{s}\n", .{ name, workspace.rel_path });
//             },
//             .npm => |npm| {
//                 var buf: bun.PathBuffer = undefined;
//                 const cache_path = this.manager.cachedNPMPackageFolderNamePrint(&buf, name, npm.version, null);
//                 var is_expired = false;
//                 if (this.manager.manifests.byNameAllowExpired(this.manager, this.manager.options.scopeForPackageName(pkg_name), pkg_name, &is_expired, .load_from_memory_fallback_to_disk)) |manifest| {
//                     if (manifest.findByVersion(npm.version)) |find| {
//                         _ = find;
//                         // const cpu = find.package.cpu;
//                         // const os = find.package.os;
//                     }
//                 } else {}
//                 std.debug.print("installing: {s}@{} from '{s}'\n", .{ name, npm.version.fmt(this.lockfile.string_buf.bytes.items), cache_path });
//             },
//             .root => {
//                 std.debug.print("installing: {s}@ROOT\n", .{name});
//             },
//             .uninitialized => {
//                 std.debug.print("skipping uninitialized: {s}\n", .{name});
//             },
//         }
//     }
// };

// pub fn install(
//     this: *const Lockfile,
//     manager: *PackageManager,
//     comptime log_level: PackageManager.Options.LogLevel,
// ) OOM!void {
//     var root_node: *Progress.Node = undefined;
//     var download_node: Progress.Node = undefined;
//     var install_node: Progress.Node = undefined;
//     var scripts_node: Progress.Node = undefined;
//     var progress = &manager.progress;

//     if (comptime log_level.showProgress()) {
//         progress.supports_ansi_escape_codes = Output.enable_ansi_colors;
//         root_node = progress.start("", 0);
//         download_node = root_node.start(PackageManager.ProgressStrings.download(), 0);
//         install_node = root_node.start(PackageManager.ProgressStrings.install(), this.tree.package_count);
//         scripts_node = root_node.start(PackageManager.ProgressStrings.script(), 0);
//     }

//     var new_node_modules = false;
//     const cwd = bun.FD.cwd();
//     const node_modules_folder = node_modules_folder: {
//         // Attempt to open the existing node_modules folder
//         switch (bun.sys.openatOSPath(cwd, bun.OSPathLiteral("node_modules"), bun.O.DIRECTORY | bun.O.RDONLY, 0o755)) {
//             .result => |fd| break :node_modules_folder fd.asDir(),
//             .err => {},
//         }

//         new_node_modules = true;

//         // Attempt to create a new node_modules folder
//         bun.sys.mkdir("node_modules", 0o755).unwrap() catch |err| {
//             if (err != error.EEXIST) {
//                 Output.err(err, "failed to create <b>node_modules<r> folder", .{});
//                 Global.crash();
//             }
//         };

//         break :node_modules_folder bun.openDir(cwd.asDir(), "node_modules") catch |err| {
//             Output.err(err, "failed to open <b>node_modules<r> folder", .{});
//             Global.crash();
//         };
//     };

//     var skip_delete = new_node_modules;
//     var skip_verify_installed_version_number = new_node_modules;

//     if (manager.options.enable.force_install) {
//         skip_verify_installed_version_number = true;
//         skip_delete = false;
//     }

//     var installer: Installer = .{
//         .lockfile = this,
//         .manager = manager,
//         .force_install = false,
//         .root_node_modules_folder = node_modules_folder,
//     };

//     try installer.installPackages(&this.tree.root);
// }

// pub const Tree = struct {
//     // TODO(dylan-conway): maybe remove allocator
//     allocator: std.mem.Allocator,

//     root: Package.Map,
//     max_depth: u32,
//     package_count: usize,

//     locked: bool = false,

//     pub fn init(allocator: std.mem.Allocator) Tree {
//         return .{
//             .allocator = allocator,
//             .root = .{},
//             .max_depth = 0,
//             .package_count = 0,
//         };
//     }

//     pub fn lock(this: *Tree) void {
//         this.locked = true;
//     }

//     pub fn put(this: *Tree, buf: *String.Buf, pkg_path: string, name: String, resolution: Package.Resolution) !void {
//         var iter = PkgPath.iterator(pkg_path);
//         var pkg: *Package = pkg: {
//             const entry = try this.root.getOrPutContext(
//                 this.allocator,
//                 try buf.append(try iter.first()),
//                 .{ .a_buf = buf.bytes.items, .b_buf = buf.bytes.items },
//             );
//             if (!entry.found_existing) {
//                 entry.value_ptr.* = .{
//                     .packages = .{},
//                     // TODO(dylan-conway): need a better way to ensure each is set
//                     .resolution = .uninitialized,
//                     .name = .{},
//                 };
//                 this.package_count += 1;
//             }

//             break :pkg entry.value_ptr;
//         };

//         var depth: u32 = 0;
//         while (try iter.next()) |component| {
//             depth += 1;
//             const entry = try pkg.packages.getOrPutContext(
//                 this.allocator,
//                 try buf.append(component),
//                 .{ .a_buf = buf.bytes.items, .b_buf = buf.bytes.items },
//             );
//             if (!entry.found_existing) {
//                 entry.value_ptr.* = .{
//                     .packages = .{},
//                     // TODO(dylan-conway): need a better way to ensure each is set
//                     .resolution = .uninitialized,
//                     .name = .{},
//                 };
//                 this.package_count += 1;
//             }
//             pkg = entry.value_ptr;
//         }

//         pkg.resolution = resolution;
//         pkg.name = name;

//         if (this.max_depth < depth) {
//             this.max_depth = depth;
//         }
//     }

//     pub const Package = struct {
//         packages: Map,
//         name: String,
//         resolution: Package.Resolution,

//         pub const Map = std.ArrayHashMapUnmanaged(String, Package, String.ArrayHashContext, false);

//         pub const Id = enum(u32) {
//             none = max,
//             _,

//             const max = std.math.maxInt(u32);

//             pub inline fn unwrap(this: Id) u32 {
//                 bun.assertWithLocation(this != .none, @src());
//                 return @intFromEnum(this);
//             }

//             pub inline fn unwrapOr(this: Id, default: u32) u32 {
//                 return if (this != .none) @intFromEnum(this) else default;
//             }

//             pub inline fn from(val: u32) Id {
//                 bun.assertWithLocation(val != max, @src());
//                 return @enumFromInt(val);
//             }
//         };

//         pub const Resolution = union(enum) {
//             uninitialized,
//             root,
//             npm: struct {
//                 version: Semver.Version,
//             },
//             workspace: struct {
//                 // workspaces aren't required to have a version, but will always
//                 // have a relative path from root.
//                 resolution: ?string,
//                 rel_path: string,
//             },
//             transitive: struct {
//                 resolution: string,
//             },
//         };
//     };
// };

// pub fn dump(this: *const Lockfile) void {
//     var path_buf: bun.PathBuffer = undefined;
//     @memcpy(path_buf[0.."node_modules/".len], "node_modules/");
//     const offset = "node_modules/".len;
//     printPackages(this.tree.root, 0, offset, &path_buf, this.string_buf.bytes.items);
//     Output.flush();
// }

// fn printPackages(packages: Tree.Package.Map, depth: usize, offset: usize, buf: []u8, string_buf: string) void {
//     var iter = packages.iterator();
//     while (iter.next()) |entry| {
//         const name = entry.key_ptr.slice(string_buf);
//         const resolution = entry.value_ptr.resolution;
//         @memcpy(buf[offset..][0..name.len], name);

//         switch (resolution) {
//             .npm => |npm| {
//                 Output.println("{d} - '{s}@{s}'", .{
//                     depth,
//                     buf[0 .. offset + name.len],
//                     npm.version.fmt(string_buf),
//                 });
//             },
//             else => {
//                 Output.println("{d} - '{s}@{s}'", .{
//                     depth,
//                     buf[0 .. offset + name.len],
//                     switch (resolution) {
//                         .uninitialized => "OOPS",
//                         .root => "ROOT",
//                         .npm => unreachable,
//                         .transitive => |transitive| transitive.resolution,
//                         .workspace => |workspace| workspace.rel_path,
//                     },
//                 });
//             },
//         }
//     }

//     iter.reset();
//     while (iter.next()) |entry| {
//         const name = entry.key_ptr.slice(string_buf);
//         @memcpy(buf[offset..][0..name.len], name);
//         @memcpy(buf[offset..][name.len..][0.."/node_modules/".len], "/node_modules/");
//         printPackages(entry.value_ptr.packages, depth + 1, offset + name.len + "/node_modules/".len, buf, string_buf);
//     }
// }
// };
