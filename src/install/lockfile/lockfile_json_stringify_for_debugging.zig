fn jsonStringifyDependency(this: *const Lockfile, w: anytype, dep_id: DependencyID, dep: Dependency, res: PackageID) !void {
    const sb = this.buffers.string_bytes.items;

    try w.beginObject();
    defer w.endObject() catch {};

    try w.objectField("name");
    try w.write(dep.name.slice(sb));

    if (dep.version.tag == .npm and dep.version.value.npm.is_alias) {
        try w.objectField("is_alias");
        try w.write(true);
    }

    try w.objectField("literal");
    try w.write(dep.version.literal.slice(sb));

    try w.objectField(@tagName(dep.version.tag));
    switch (dep.version.tag) {
        .uninitialized => try w.write(null),
        .npm => {
            try w.beginObject();
            defer w.endObject() catch {};

            const info: Dependency.Version.NpmInfo = dep.version.value.npm;

            try w.objectField("name");
            try w.write(info.name.slice(sb));

            try w.objectField("version");
            try w.print("\"{}\"", .{info.version.fmt(sb)});
        },
        .dist_tag => {
            try w.beginObject();
            defer w.endObject() catch {};

            const info: Dependency.Version.TagInfo = dep.version.value.dist_tag;

            try w.objectField("name");
            try w.write(info.name.slice(sb));

            try w.objectField("tag");
            try w.write(info.name.slice(sb));
        },
        .tarball => {
            try w.beginObject();
            defer w.endObject() catch {};

            const info: Dependency.Version.TarballInfo = dep.version.value.tarball;
            try w.objectField(@tagName(info.uri));
            try w.write(switch (info.uri) {
                inline else => |s| s.slice(sb),
            });

            try w.objectField("package_name");
            try w.write(info.package_name.slice(sb));
        },
        .folder => {
            try w.write(dep.version.value.folder.slice(sb));
        },
        .symlink => {
            try w.write(dep.version.value.symlink.slice(sb));
        },
        .workspace => {
            try w.write(dep.version.value.workspace.slice(sb));
        },
        .git => {
            try w.beginObject();
            defer w.endObject() catch {};

            const info: Repository = dep.version.value.git;

            try w.objectField("owner");
            try w.write(info.owner.slice(sb));
            try w.objectField("repo");
            try w.write(info.repo.slice(sb));
            try w.objectField("committish");
            try w.write(info.committish.slice(sb));
            try w.objectField("resolved");
            try w.write(info.resolved.slice(sb));
            try w.objectField("package_name");
            try w.write(info.package_name.slice(sb));
        },
        .github => {
            try w.beginObject();
            defer w.endObject() catch {};

            const info: Repository = dep.version.value.github;

            try w.objectField("owner");
            try w.write(info.owner.slice(sb));
            try w.objectField("repo");
            try w.write(info.repo.slice(sb));
            try w.objectField("committish");
            try w.write(info.committish.slice(sb));
            try w.objectField("resolved");
            try w.write(info.resolved.slice(sb));
            try w.objectField("package_name");
            try w.write(info.package_name.slice(sb));
        },
        .catalog => {
            try w.beginObject();
            defer w.endObject() catch {};

            const info = dep.version.value.catalog;

            try w.objectField("name");
            try w.write(dep.name.slice(sb));

            try w.objectField("version");
            try w.print("catalog:{s}", .{info.fmtJson(sb, .{ .quote = false })});
        },
    }

    try w.objectField("package_id");
    try w.write(if (res == invalid_package_id) null else res);

    try w.objectField("behavior");
    {
        try w.beginObject();
        defer w.endObject() catch {};

        const fields = @typeInfo(Behavior).@"struct".fields;
        inline for (fields[1 .. fields.len - 1]) |field| {
            if (@field(dep.behavior, field.name)) {
                try w.objectField(field.name);
                try w.write(true);
            }
        }
    }

    try w.objectField("id");
    try w.write(dep_id);
}

pub fn jsonStringify(this: *const Lockfile, w: anytype) !void {
    const sb = this.buffers.string_bytes.items;
    try w.beginObject();
    defer w.endObject() catch {};

    try w.objectField("format");
    try w.write(@tagName(this.format));
    try w.objectField("meta_hash");
    try w.write(std.fmt.bytesToHex(this.meta_hash, .lower));

    {
        try w.objectField("package_index");
        try w.beginObject();
        defer w.endObject() catch {};

        var iter = this.package_index.iterator();
        while (iter.next()) |it| {
            const entry: PackageIndex.Entry = it.value_ptr.*;
            const first_id = switch (entry) {
                .id => |id| id,
                .ids => |ids| ids.items[0],
            };
            const name = this.packages.items(.name)[first_id].slice(sb);
            try w.objectField(name);
            switch (entry) {
                .id => |id| try w.write(id),
                .ids => |ids| {
                    try w.beginArray();
                    for (ids.items) |id| {
                        try w.write(id);
                    }
                    try w.endArray();
                },
            }
        }
    }
    {
        try w.objectField("trees");
        try w.beginArray();
        defer w.endArray() catch {};

        const dependencies = this.buffers.dependencies.items;
        const hoisted_deps = this.buffers.hoisted_dependencies.items;
        const resolutions = this.buffers.resolutions.items;
        var depth_buf: Tree.DepthBuf = undefined;
        var path_buf: bun.PathBuffer = undefined;
        @memcpy(path_buf[0.."node_modules".len], "node_modules");

        for (0..this.buffers.trees.items.len) |tree_id| {
            try w.beginObject();
            defer w.endObject() catch {};

            const tree = this.buffers.trees.items[tree_id];

            try w.objectField("id");
            try w.write(tree_id);

            const relative_path, const depth = Lockfile.Tree.relativePathAndDepth(
                this,
                @intCast(tree_id),
                &path_buf,
                &depth_buf,
                .node_modules,
            );

            try w.objectField("path");
            try w.print("\"{}\"", .{bun.fmt.fmtPath(u8, relative_path, .{ .path_sep = .posix })});

            try w.objectField("depth");
            try w.write(depth);

            try w.objectField("dependencies");
            {
                try w.beginObject();
                defer w.endObject() catch {};

                for (tree.dependencies.get(hoisted_deps)) |tree_dep_id| {
                    const dep = dependencies[tree_dep_id];
                    const package_id = resolutions[tree_dep_id];

                    try w.objectField(dep.name.slice(sb));
                    {
                        try w.beginObject();
                        defer w.endObject() catch {};

                        try w.objectField("id");
                        try w.write(tree_dep_id);

                        try w.objectField("package_id");
                        try w.write(package_id);
                    }
                }
            }
        }
    }

    {
        try w.objectField("dependencies");
        try w.beginArray();
        defer w.endArray() catch {};

        const dependencies = this.buffers.dependencies.items;
        const resolutions = this.buffers.resolutions.items;

        for (0..dependencies.len) |dep_id| {
            const dep = dependencies[dep_id];
            const res = resolutions[dep_id];
            try jsonStringifyDependency(this, w, @intCast(dep_id), dep, res);
        }
    }

    {
        try w.objectField("packages");
        try w.beginArray();
        defer w.endArray() catch {};

        for (0..this.packages.len) |i| {
            const pkg: Package = this.packages.get(i);
            try w.beginObject();
            defer w.endObject() catch {};

            try w.objectField("id");
            try w.write(i);

            try w.objectField("name");
            try w.write(pkg.name.slice(sb));

            try w.objectField("name_hash");
            try w.write(pkg.name_hash);

            try w.objectField("resolution");
            {
                const res = pkg.resolution;
                try w.beginObject();
                defer w.endObject() catch {};

                try w.objectField("tag");
                try w.write(@tagName(res.tag));

                try w.objectField("value");
                try w.print("\"{s}\"", .{res.fmt(sb, .posix)});

                try w.objectField("resolved");
                try w.print("\"{}\"", .{res.fmtURL(sb)});
            }

            try w.objectField("dependencies");
            {
                try w.beginArray();
                defer w.endArray() catch {};

                for (pkg.dependencies.off..pkg.dependencies.off + pkg.dependencies.len) |dep_id| {
                    try w.write(dep_id);
                }
            }

            if (@as(u16, @intFromEnum(pkg.meta.arch)) != Npm.Architecture.all_value) {
                try w.objectField("arch");
                try w.beginArray();
                defer w.endArray() catch {};

                for (Npm.Architecture.NameMap.kvs) |kv| {
                    if (pkg.meta.arch.has(kv.value)) {
                        try w.write(kv.key);
                    }
                }
            }

            if (@as(u16, @intFromEnum(pkg.meta.os)) != Npm.OperatingSystem.all_value) {
                try w.objectField("os");
                try w.beginArray();
                defer w.endArray() catch {};

                for (Npm.OperatingSystem.NameMap.kvs) |kv| {
                    if (pkg.meta.os.has(kv.value)) {
                        try w.write(kv.key);
                    }
                }
            }

            try w.objectField("integrity");
            if (pkg.meta.integrity.tag != .unknown) {
                try w.print("\"{}\"", .{pkg.meta.integrity});
            } else {
                try w.write(null);
            }

            try w.objectField("man_dir");
            try w.write(pkg.meta.man_dir.slice(sb));

            try w.objectField("origin");
            try w.write(@tagName(pkg.meta.origin));

            try w.objectField("bin");
            switch (pkg.bin.tag) {
                .none => try w.write(null),
                .file => {
                    try w.beginObject();
                    defer w.endObject() catch {};

                    try w.objectField("file");
                    try w.write(pkg.bin.value.file.slice(sb));
                },
                .named_file => {
                    try w.beginObject();
                    defer w.endObject() catch {};

                    try w.objectField("name");
                    try w.write(pkg.bin.value.named_file[0].slice(sb));

                    try w.objectField("file");
                    try w.write(pkg.bin.value.named_file[1].slice(sb));
                },
                .dir => {
                    try w.objectField("dir");
                    try w.write(pkg.bin.value.dir.slice(sb));
                },
                .map => {
                    try w.beginObject();
                    defer w.endObject() catch {};

                    const data: []const ExternalString = pkg.bin.value.map.get(this.buffers.extern_strings.items);
                    var bin_i: usize = 0;
                    while (bin_i < data.len) : (bin_i += 2) {
                        try w.objectField(data[bin_i].slice(sb));
                        try w.write(data[bin_i + 1].slice(sb));
                    }
                },
            }

            {
                try w.objectField("scripts");
                try w.beginObject();
                defer w.endObject() catch {};

                inline for (comptime std.meta.fieldNames(Lockfile.Scripts)) |field_name| {
                    const script = @field(pkg.scripts, field_name).slice(sb);
                    if (script.len > 0) {
                        try w.objectField(field_name);
                        try w.write(script);
                    }
                }
            }
        }
    }

    var buf: [100]u8 = undefined;

    try w.objectField("workspace_paths");
    {
        try w.beginObject();
        defer w.endObject() catch {};

        for (this.workspace_paths.keys(), this.workspace_paths.values()) |k, v| {
            try w.objectField(std.fmt.bufPrintIntToSlice(&buf, k, 10, .lower, .{}));
            try w.write(v.slice(sb));
        }
    }
    try w.objectField("workspace_versions");
    {
        try w.beginObject();
        defer w.endObject() catch {};

        for (this.workspace_versions.keys(), this.workspace_versions.values()) |k, v| {
            try w.objectField(std.fmt.bufPrintIntToSlice(&buf, k, 10, .lower, .{}));
            try w.print("\"{}\"", .{v.fmt(sb)});
        }
    }
}

const bun = @import("bun");
const std = @import("std");
const install = bun.install;
const Lockfile = install.Lockfile;
const Package = Lockfile.Package;
const PackageIndex = Lockfile.PackageIndex;
const Dependency = install.Dependency;
const DependencyID = install.DependencyID;
const Behavior = Dependency.Behavior;
const Npm = install.Npm;
const Tree = Lockfile.Tree;
const PackageID = install.PackageID;
const invalid_package_id = install.invalid_package_id;
const Repository = install.Repository;
const ExternalString = bun.Semver.ExternalString;
const PathBuffer = bun.PathBuffer;
