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
const BinaryResolution = Install.Resolution;
const PackageNameHash = Install.PackageNameHash;
const NameHashMap = BinaryLockfile.NameHashMap;
const Repository = Install.Repository;
const Progress = bun.Progress;
const Environment = bun.Environment;
const Global = bun.Global;
const LoadResult = BinaryLockfile.LoadResult;

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

        pub fn next(this: *Iterator) error{InvalidPackagePath}!?string {
            if (this.i == this.input.len) return null;

            var remain = this.input[this.i..];

            var maybe_at = strings.indexOfChar(remain, '@');
            var slash = strings.indexOfChar(remain, '/') orelse {
                // no slashes left, it's the last dependency name.
                // '@' will only exist if '/' exists (scoped package)
                if (maybe_at != null) return error.InvalidPackagePath;
                this.i = @intCast(this.input.len);
                return remain;
            };

            if (maybe_at == null) {
                if (slash + 1 == this.input.len) return error.InvalidPackagePath;
                this.i += slash + 1;
                return remain[0..slash];
            }

            if (maybe_at.? == 0) {
                // scoped package, find next '/' and '@' if it exists
                maybe_at = strings.indexOfChar(remain[1..], '@');
                slash = 1 + (strings.indexOfChar(remain[slash + 1 ..], '/') orelse {
                    if (maybe_at != null) return error.InvalidPackagePath;
                    this.i = @intCast(this.input.len);
                    return remain;
                });
            }

            if (maybe_at) |at| {
                if (at + 1 < slash) {
                    // both '@' and '/' exist and it's not a scoped package, so
                    // '@' must be greater than '/'
                    return error.InvalidPackagePath;
                }
            }

            this.i += slash + 1;
            return remain[0..slash];
        }

        /// There will always be at least one component to this path. Return
        /// an error if none is found (empty string)
        pub fn first(this: *Iterator) error{InvalidPackagePath}!string {
            bun.assertWithLocation(this.i == 0, @src());
            return try this.next() orelse error.InvalidPackagePath;
        }
    };

    pub fn fromLockfile(input: string) PkgPath {
        return .{
            .raw = input,
            .depth = 0,
        };
    }
};

pub const Stringifier = struct {
    pub const Version = enum(u32) {
        v0 = 0,
        v1,

        pub const current: Version = .v0;
    };

    const dependency_groups = [4]struct { []const u8, Dependency.Behavior }{
        .{ "dependencies", Dependency.Behavior.normal },
        .{ "devDependencies", Dependency.Behavior.dev },
        .{ "peerDependencies", Dependency.Behavior.peer },
        .{ "optionalDependencies", Dependency.Behavior.optional },
    };

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
        const pkg_resolution: []BinaryResolution = pkgs.items(.resolution);
        const pkg_names: []String = pkgs.items(.name);
        const pkg_name_hashes: []PackageNameHash = pkgs.items(.name_hash);
        const pkg_metas: []BinaryLockfile.Package.Meta = pkgs.items(.meta);

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

            try writeIndent(writer, indent);
            try writer.writeAll("\"packages\": {");
            var first = true;
            var iter = BinaryLockfile.Tree.Iterator(.pkg_path).init(lockfile);

            while (iter.next({})) |node| {
                for (node.dependencies) |dep_id| {
                    const pkg_id = resolution_buf[dep_id];
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
                    // npm         -> [ "name@npm:version", deps..., integrity, ... ]
                    // symlink     -> [ "name@link:path", deps..., ... ]
                    // folder      -> [ "name@file:path", deps..., ... ]
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

                            try writer.print(", \"{}\"]", .{pkg_meta.integrity});
                        },
                        .local_tarball => {
                            try writer.print("[\"{s}@{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(res.value.local_tarball.slice(buf), .{ .quote = false }),
                            });

                            try writePackageDeps(writer, pkg_deps, buf);

                            try writer.print(", \"{}\"]", .{pkg_meta.integrity});
                        },
                        .remote_tarball => {
                            try writer.print("[\"{s}@{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(res.value.remote_tarball.slice(buf), .{ .quote = false }),
                            });

                            try writePackageDeps(writer, pkg_deps, buf);

                            try writer.print(", \"{}\"]", .{pkg_meta.integrity});
                        },
                        .symlink => {
                            try writer.print("[\"{s}@link:{}\", ", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(res.value.symlink.slice(buf), .{ .quote = false }),
                            });

                            try writePackageDeps(writer, pkg_deps, buf);

                            try writer.print(", \"{}\"]", .{pkg_meta.integrity});
                        },
                        .npm => {
                            try writer.print("[\"{s}@{}\", ", .{
                                pkg_name,
                                res.value.npm.fmt(buf),
                            });

                            try writePackageDeps(writer, pkg_deps, buf);

                            // TODO(dylan-conway): delete placeholder
                            // const pkg_meta = pkg_metas[pkg_id];
                            // try writer.print(", \"{}\"]", .{
                            //     pkg_meta.integrity,
                            // });
                            try writer.writeAll(", \"SHA512\"]");
                        },
                        .workspace => {
                            const workspace_path = res.value.workspace.slice(buf);

                            try writer.print("[\"{s}@workspace:{}\"", .{
                                pkg_name,
                                bun.fmt.formatJSONStringUTF8(workspace_path, .{ .quote = false }),
                            });

                            if (lockfile.workspace_versions.get(pkg_name_hashes[pkg_id])) |workspace_version| {
                                try writer.print(", \"{}\"", .{workspace_version.fmt(buf)});
                            } else {
                                try writer.writeAll(", \"\"");
                            }

                            try writer.writeByte(']');
                        },
                        inline .git, .github => |tag| {
                            const repo: Repository = @field(res.value, @tagName(tag));
                            try writer.print("[\"{s}@{}\"]", .{
                                pkg_name,
                                repo.fmt(if (comptime tag == .git) "git+" else "github:", buf),
                            });
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

    /// Writes a single line object.
    /// { "devDependencies": { "one": "1.1.1", "two": "2.2.2" } }
    fn writePackageDeps(
        writer: anytype,
        deps: []const Dependency,
        buf: string,
    ) OOM!void {
        try writer.writeByte('{');

        var any = false;
        inline for (dependency_groups) |group| {
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

        inline for (dependency_groups) |group| {
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
    InvalidPackageValue,
    InvalidPackageSpecifier,
    InvalidSemver,
    InvalidPackagesTree,
};

pub fn parseIntoBinaryLockfile(
    lockfile: *BinaryLockfile,
    allocator: std.mem.Allocator,
    root: JSON.Expr,
    source: *const logger.Source,
    log: *logger.Log,
) ParseError!void {
    lockfile.initEmpty(allocator);

    const builder = lockfile.stringBuilder();
    _ = builder;

    const version_expr = root.get("lockfileVersion") orelse {
        try log.addError(source, root.loc, "Missing lockfile version");
        return error.InvalidLockfileVersion;
    };

    const version: u32 = switch (version_expr.data) {
        .e_number => |num| @intFromFloat(std.math.divExact(f64, num.value, 1) catch return error.InvalidLockfileVersion),
        else => return error.InvalidLockfileVersion,
    };
    _ = version;

    if (root.get("workspaces")) |workspaces| {
        if (!workspaces.isObject()) {
            try log.addError(source, workspaces.loc, "Expected an object");
        }
        const root_pkg: Expr = workspaces.get("") orelse {
            try log.addError(source, workspaces.loc, "Expected root package");
            return error.InvalidWorkspaceObject;
        };

        std.debug.print("root_pkg: {s}\n", .{root_pkg.asString(allocator) orelse "ooops"});
    }

    if (root.get("packages")) |pkgs| {
        if (!pkgs.isObject()) {
            try log.addError(source, pkgs.loc, "Expected an object");
            return error.InvalidPackagesObject;
        }
    }
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
//                 return error.InvalidPackageValue;
//             };

//             if (!value.isArray()) {
//                 try log.addError(source, value.loc, "Expected an array");
//                 return error.InvalidPackageValue;
//             }

//             const pkg_items = value.data.e_array.slice();
//             if (pkg_items.len == 0) {
//                 try log.addError(source, value.loc, "Expected non-empty array");
//                 return error.InvalidPackageValue;
//             }

//             const name_and_resolution_str = try pkg_items[0].asStringCloned(allocator) orelse {
//                 try log.addError(source, pkg_items[0].loc, "Expected a string");
//                 return error.InvalidPackageSpecifier;
//             };

//             const resolved_name, var res_str = Dependency.splitNameAndVersion(name_and_resolution_str) catch {
//                 try log.addError(source, pkg_items[0].loc, "Expected package resolution");
//                 return error.InvalidPackageValue;
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
//                 return error.InvalidPackageValue;
//             };

//             if (!value.isArray()) {
//                 try log.addError(source, value.loc, "Expected an array");
//                 return error.InvalidPackageValue;
//             }

//             const pkg_items = value.data.e_array.slice();
//             if (pkg_items.len == 0) {
//                 try log.addError(source, value.loc, "Expected non-empty array");
//                 return error.InvalidPackageValue;
//             }

//             const name_and_resolution_str = try pkg_items[0].asStringCloned(allocator) orelse {
//                 try log.addError(source, pkg_items[0].loc, "Expected a string");
//                 return error.InvalidPackageSpecifier;
//             };

//             const resolved_name, var res_str = Dependency.splitNameAndVersion(name_and_resolution_str) catch {
//                 try log.addError(source, pkg_items[0].loc, "Expected package resolution");
//                 return error.InvalidPackageValue;
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
