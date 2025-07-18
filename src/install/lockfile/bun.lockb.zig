pub const version = "bun-lockfile-format-v0\n";
const header_bytes: string = "#!/usr/bin/env bun\n" ++ version;

const has_patched_dependencies_tag: u64 = @bitCast(@as([8]u8, "pAtChEdD".*));
const has_workspace_package_ids_tag: u64 = @bitCast(@as([8]u8, "wOrKsPaC".*));
const has_trusted_dependencies_tag: u64 = @bitCast(@as([8]u8, "tRuStEDd".*));
const has_empty_trusted_dependencies_tag: u64 = @bitCast(@as([8]u8, "eMpTrUsT".*));
const has_overrides_tag: u64 = @bitCast(@as([8]u8, "oVeRriDs".*));
const has_catalogs_tag: u64 = @bitCast(@as([8]u8, "cAtAlOgS".*));

pub fn save(this: *Lockfile, verbose_log: bool, bytes: *std.ArrayList(u8), total_size: *usize, end_pos: *usize) !void {

    // we clone packages with the z_allocator to make sure bytes are zeroed.
    // TODO: investigate if we still need this now that we have `padding_checker.zig`
    var old_packages_list = this.packages;
    this.packages = try this.packages.clone(z_allocator);
    old_packages_list.deinit(this.allocator);

    var writer = bytes.writer();
    try writer.writeAll(header_bytes);
    try writer.writeInt(u32, @intFromEnum(this.format), .little);

    try writer.writeAll(&this.meta_hash);

    end_pos.* = bytes.items.len;
    try writer.writeInt(u64, 0, .little);

    const StreamType = struct {
        bytes: *std.ArrayList(u8),
        pub inline fn getPos(s: @This()) anyerror!usize {
            return s.bytes.items.len;
        }

        pub fn pwrite(
            s: @This(),
            data: []const u8,
            index: usize,
        ) usize {
            @memcpy(s.bytes.items[index..][0..data.len], data);
            return data.len;
        }
    };
    const stream = StreamType{ .bytes = bytes };

    if (comptime Environment.allow_assert) {
        for (this.packages.items(.resolution)) |res| {
            switch (res.tag) {
                .folder => {
                    assert(!strings.containsChar(this.str(&res.value.folder), std.fs.path.sep_windows));
                },
                .symlink => {
                    assert(!strings.containsChar(this.str(&res.value.symlink), std.fs.path.sep_windows));
                },
                .local_tarball => {
                    assert(!strings.containsChar(this.str(&res.value.local_tarball), std.fs.path.sep_windows));
                },
                .workspace => {
                    assert(!strings.containsChar(this.str(&res.value.workspace), std.fs.path.sep_windows));
                },
                else => {},
            }
        }
    }

    try Lockfile.Package.Serializer.save(this.packages, StreamType, stream, @TypeOf(writer), writer);
    try Lockfile.Buffers.save(this, verbose_log, z_allocator, StreamType, stream, @TypeOf(writer), writer);
    try writer.writeInt(u64, 0, .little);

    // < Bun v1.0.4 stopped right here when reading the lockfile
    // So we add an extra 8 byte tag to say "hey, there's more data here"
    if (this.workspace_versions.count() > 0) {
        try writer.writeAll(std.mem.asBytes(&has_workspace_package_ids_tag));

        // We need to track the "version" field in "package.json" of workspace member packages
        // We do not necessarily have that in the Resolution struct. So we store it here.
        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []PackageNameHash,
            this.workspace_versions.keys(),
        );
        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []Semver.Version,
            this.workspace_versions.values(),
        );

        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []PackageNameHash,
            this.workspace_paths.keys(),
        );
        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []String,
            this.workspace_paths.values(),
        );
    }

    if (this.trusted_dependencies) |trusted_dependencies| {
        if (trusted_dependencies.count() > 0) {
            try writer.writeAll(std.mem.asBytes(&has_trusted_dependencies_tag));

            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []u32,
                trusted_dependencies.keys(),
            );
        } else {
            try writer.writeAll(std.mem.asBytes(&has_empty_trusted_dependencies_tag));
        }
    }

    if (this.overrides.map.count() > 0) {
        try writer.writeAll(std.mem.asBytes(&has_overrides_tag));

        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []PackageNameHash,
            this.overrides.map.keys(),
        );
        var external_overrides = try std.ArrayListUnmanaged(Dependency.External).initCapacity(z_allocator, this.overrides.map.count());
        defer external_overrides.deinit(z_allocator);
        external_overrides.items.len = this.overrides.map.count();
        for (external_overrides.items, this.overrides.map.values()) |*dest, src| {
            dest.* = src.toExternal();
        }

        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []Dependency.External,
            external_overrides.items,
        );
    }

    if (this.patched_dependencies.entries.len > 0) {
        for (this.patched_dependencies.values()) |patched_dep| bun.assert(!patched_dep.patchfile_hash_is_null);

        try writer.writeAll(std.mem.asBytes(&has_patched_dependencies_tag));

        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []PackageNameAndVersionHash,
            this.patched_dependencies.keys(),
        );

        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []PatchedDep,
            this.patched_dependencies.values(),
        );
    }

    if (this.catalogs.hasAny()) {
        try writer.writeAll(std.mem.asBytes(&has_catalogs_tag));

        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []String,
            this.catalogs.default.keys(),
        );

        var external_deps_buf: std.ArrayListUnmanaged(Dependency.External) = try .initCapacity(z_allocator, this.catalogs.default.count());
        defer external_deps_buf.deinit(z_allocator);
        external_deps_buf.items.len = this.catalogs.default.count();
        for (external_deps_buf.items, this.catalogs.default.values()) |*dest, src| {
            dest.* = src.toExternal();
        }

        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []Dependency.External,
            external_deps_buf.items,
        );
        external_deps_buf.clearRetainingCapacity();

        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []String,
            this.catalogs.groups.keys(),
        );

        for (this.catalogs.groups.values()) |catalog_deps| {
            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []String,
                catalog_deps.keys(),
            );

            try external_deps_buf.ensureTotalCapacity(z_allocator, catalog_deps.count());
            external_deps_buf.items.len = catalog_deps.count();
            defer external_deps_buf.clearRetainingCapacity();

            for (external_deps_buf.items, catalog_deps.values()) |*dest, src| {
                dest.* = src.toExternal();
            }

            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []Dependency.External,
                external_deps_buf.items,
            );
        }
    }

    total_size.* = try stream.getPos();

    try writer.writeAll(&alignment_bytes_to_repeat_buffer);
}

pub const SerializerLoadResult = struct {
    packages_need_update: bool = false,
};

pub fn load(
    lockfile: *Lockfile,
    stream: *Stream,
    allocator: Allocator,
    log: *logger.Log,
    manager: ?*PackageManager,
) !SerializerLoadResult {
    var res = SerializerLoadResult{};
    var reader = stream.reader();
    var header_buf_: [header_bytes.len]u8 = undefined;
    const header_buf = header_buf_[0..try reader.readAll(&header_buf_)];

    if (!strings.eqlComptime(header_buf, header_bytes)) {
        return error.InvalidLockfile;
    }

    const format = try reader.readInt(u32, .little);
    if (format != @intFromEnum(Lockfile.FormatVersion.current)) {
        return error.@"Outdated lockfile version";
    }

    lockfile.format = Lockfile.FormatVersion.current;
    lockfile.allocator = allocator;

    _ = try reader.readAll(&lockfile.meta_hash);

    const total_buffer_size = try reader.readInt(u64, .little);
    if (total_buffer_size > stream.buffer.len) {
        return error.@"Lockfile is missing data";
    }

    const packages_load_result = try Lockfile.Package.Serializer.load(
        stream,
        total_buffer_size,
        allocator,
    );

    lockfile.packages = packages_load_result.list;
    res.packages_need_update = packages_load_result.needs_update;

    lockfile.buffers = try Lockfile.Buffers.load(
        stream,
        allocator,
        log,
        manager,
    );
    if ((try stream.reader().readInt(u64, .little)) != 0) {
        return error.@"Lockfile is malformed (expected 0 at the end)";
    }

    const has_workspace_name_hashes = false;
    // < Bun v1.0.4 stopped right here when reading the lockfile
    // So we add an extra 8 byte tag to say "hey, there's more data here"
    {
        const remaining_in_buffer = total_buffer_size -| stream.pos;

        if (remaining_in_buffer > 8 and total_buffer_size <= stream.buffer.len) {
            const next_num = try reader.readInt(u64, .little);
            if (next_num == has_workspace_package_ids_tag) {
                {
                    var workspace_package_name_hashes = try Lockfile.Buffers.readArray(
                        stream,
                        allocator,
                        std.ArrayListUnmanaged(PackageNameHash),
                    );
                    defer workspace_package_name_hashes.deinit(allocator);

                    var workspace_versions_list = try Lockfile.Buffers.readArray(
                        stream,
                        allocator,
                        std.ArrayListUnmanaged(Semver.Version),
                    );
                    comptime {
                        if (PackageNameHash != @TypeOf((VersionHashMap.KV{ .key = undefined, .value = undefined }).key)) {
                            @compileError("VersionHashMap must be in sync with serialization");
                        }
                        if (Semver.Version != @TypeOf((VersionHashMap.KV{ .key = undefined, .value = undefined }).value)) {
                            @compileError("VersionHashMap must be in sync with serialization");
                        }
                    }
                    defer workspace_versions_list.deinit(allocator);
                    try lockfile.workspace_versions.ensureTotalCapacity(allocator, workspace_versions_list.items.len);
                    lockfile.workspace_versions.entries.len = workspace_versions_list.items.len;
                    @memcpy(lockfile.workspace_versions.keys(), workspace_package_name_hashes.items);
                    @memcpy(lockfile.workspace_versions.values(), workspace_versions_list.items);
                    try lockfile.workspace_versions.reIndex(allocator);
                }

                {
                    var workspace_paths_hashes = try Lockfile.Buffers.readArray(
                        stream,
                        allocator,
                        std.ArrayListUnmanaged(PackageNameHash),
                    );
                    defer workspace_paths_hashes.deinit(allocator);
                    var workspace_paths_strings = try Lockfile.Buffers.readArray(
                        stream,
                        allocator,
                        std.ArrayListUnmanaged(String),
                    );
                    defer workspace_paths_strings.deinit(allocator);

                    try lockfile.workspace_paths.ensureTotalCapacity(allocator, workspace_paths_strings.items.len);

                    lockfile.workspace_paths.entries.len = workspace_paths_strings.items.len;
                    @memcpy(lockfile.workspace_paths.keys(), workspace_paths_hashes.items);
                    @memcpy(lockfile.workspace_paths.values(), workspace_paths_strings.items);
                    try lockfile.workspace_paths.reIndex(allocator);
                }
            } else {
                stream.pos -= 8;
            }
        }
    }

    {
        const remaining_in_buffer = total_buffer_size -| stream.pos;

        // >= because `has_empty_trusted_dependencies_tag` is tag only
        if (remaining_in_buffer >= 8 and total_buffer_size <= stream.buffer.len) {
            const next_num = try reader.readInt(u64, .little);
            if (remaining_in_buffer > 8 and next_num == has_trusted_dependencies_tag) {
                var trusted_dependencies_hashes = try Lockfile.Buffers.readArray(
                    stream,
                    allocator,
                    std.ArrayListUnmanaged(u32),
                );
                defer trusted_dependencies_hashes.deinit(allocator);

                lockfile.trusted_dependencies = .{};
                try lockfile.trusted_dependencies.?.ensureTotalCapacity(allocator, trusted_dependencies_hashes.items.len);

                lockfile.trusted_dependencies.?.entries.len = trusted_dependencies_hashes.items.len;
                @memcpy(lockfile.trusted_dependencies.?.keys(), trusted_dependencies_hashes.items);
                try lockfile.trusted_dependencies.?.reIndex(allocator);
            } else if (next_num == has_empty_trusted_dependencies_tag) {
                // trusted dependencies exists in package.json but is an empty array.
                lockfile.trusted_dependencies = .{};
            } else {
                stream.pos -= 8;
            }
        }
    }

    {
        const remaining_in_buffer = total_buffer_size -| stream.pos;

        if (remaining_in_buffer > 8 and total_buffer_size <= stream.buffer.len) {
            const next_num = try reader.readInt(u64, .little);
            if (next_num == has_overrides_tag) {
                var overrides_name_hashes = try Lockfile.Buffers.readArray(
                    stream,
                    allocator,
                    std.ArrayListUnmanaged(PackageNameHash),
                );
                defer overrides_name_hashes.deinit(allocator);

                var map = lockfile.overrides.map;
                defer lockfile.overrides.map = map;

                try map.ensureTotalCapacity(allocator, overrides_name_hashes.items.len);
                const override_versions_external = try Lockfile.Buffers.readArray(
                    stream,
                    allocator,
                    std.ArrayListUnmanaged(Dependency.External),
                );
                const context: Dependency.Context = .{
                    .allocator = allocator,
                    .log = log,
                    .buffer = lockfile.buffers.string_bytes.items,
                    .package_manager = manager,
                };
                for (overrides_name_hashes.items, override_versions_external.items) |name, value| {
                    map.putAssumeCapacity(name, Dependency.toDependency(value, context));
                }
            } else {
                stream.pos -= 8;
            }
        }
    }

    {
        const remaining_in_buffer = total_buffer_size -| stream.pos;

        if (remaining_in_buffer > 8 and total_buffer_size <= stream.buffer.len) {
            const next_num = try reader.readInt(u64, .little);
            if (next_num == has_patched_dependencies_tag) {
                var patched_dependencies_name_and_version_hashes =
                    try Lockfile.Buffers.readArray(
                        stream,
                        allocator,
                        std.ArrayListUnmanaged(PackageNameAndVersionHash),
                    );
                defer patched_dependencies_name_and_version_hashes.deinit(allocator);

                var map = lockfile.patched_dependencies;
                defer lockfile.patched_dependencies = map;

                try map.ensureTotalCapacity(allocator, patched_dependencies_name_and_version_hashes.items.len);
                const patched_dependencies_paths = try Lockfile.Buffers.readArray(
                    stream,
                    allocator,
                    std.ArrayListUnmanaged(PatchedDep),
                );

                for (patched_dependencies_name_and_version_hashes.items, patched_dependencies_paths.items) |name_hash, patch_path| {
                    map.putAssumeCapacity(name_hash, patch_path);
                }
            } else {
                stream.pos -= 8;
            }
        }
    }

    {
        const remaining_in_buffer = total_buffer_size -| stream.pos;

        if (remaining_in_buffer > 8 and total_buffer_size <= stream.buffer.len) {
            const next_num = try reader.readInt(u64, .little);
            if (next_num == has_catalogs_tag) {
                lockfile.catalogs = .{};

                var default_dep_names = try Lockfile.Buffers.readArray(stream, allocator, std.ArrayListUnmanaged(String));
                defer default_dep_names.deinit(allocator);

                var default_deps = try Lockfile.Buffers.readArray(stream, allocator, std.ArrayListUnmanaged(Dependency.External));
                defer default_deps.deinit(allocator);

                try lockfile.catalogs.default.ensureTotalCapacity(allocator, default_deps.items.len);

                const context: Dependency.Context = .{
                    .allocator = allocator,
                    .log = log,
                    .buffer = lockfile.buffers.string_bytes.items,
                    .package_manager = manager,
                };

                for (default_dep_names.items, default_deps.items) |dep_name, dep| {
                    lockfile.catalogs.default.putAssumeCapacityContext(dep_name, Dependency.toDependency(dep, context), String.arrayHashContext(lockfile, null));
                }

                var catalog_names = try Lockfile.Buffers.readArray(stream, allocator, std.ArrayListUnmanaged(String));
                defer catalog_names.deinit(allocator);

                try lockfile.catalogs.groups.ensureTotalCapacity(allocator, catalog_names.items.len);

                for (catalog_names.items) |catalog_name| {
                    var catalog_dep_names = try Lockfile.Buffers.readArray(stream, allocator, std.ArrayListUnmanaged(String));
                    defer catalog_dep_names.deinit(allocator);

                    var catalog_deps = try Lockfile.Buffers.readArray(stream, allocator, std.ArrayListUnmanaged(Dependency.External));
                    defer catalog_deps.deinit(allocator);

                    const group = try lockfile.catalogs.getOrPutGroup(lockfile, catalog_name);

                    try group.ensureTotalCapacity(allocator, catalog_deps.items.len);

                    for (catalog_dep_names.items, catalog_deps.items) |dep_name, dep| {
                        group.putAssumeCapacityContext(dep_name, Dependency.toDependency(dep, context), String.arrayHashContext(lockfile, null));
                    }
                }
            } else {
                stream.pos -= 8;
            }
        }
    }

    lockfile.scratch = Lockfile.Scratch.init(allocator);
    lockfile.package_index = PackageIndex.Map.initContext(allocator, .{});
    lockfile.string_pool = StringPool.init(allocator);
    try lockfile.package_index.ensureTotalCapacity(@as(u32, @truncate(lockfile.packages.len)));

    if (!has_workspace_name_hashes) {
        const slice = lockfile.packages.slice();
        const name_hashes = slice.items(.name_hash);
        const resolutions = slice.items(.resolution);
        for (name_hashes, resolutions, 0..) |name_hash, resolution, id| {
            try lockfile.getOrPutID(@as(PackageID, @truncate(id)), name_hash);

            // compatibility with < Bun v1.0.4
            switch (resolution.tag) {
                .workspace => {
                    try lockfile.workspace_paths.put(allocator, name_hash, resolution.value.workspace);
                },
                else => {},
            }
        }
    } else {
        const slice = lockfile.packages.slice();
        const name_hashes = slice.items(.name_hash);
        for (name_hashes, 0..) |name_hash, id| {
            try lockfile.getOrPutID(@as(PackageID, @truncate(id)), name_hash);
        }
    }

    if (comptime Environment.allow_assert) assert(stream.pos == total_buffer_size);

    // const end = try reader.readInt(u64, .little);
    return res;
}

const Allocator = std.mem.Allocator;
const Dependency = install.Dependency;
const Environment = bun.Environment;
const Lockfile = install.Lockfile;
const PackageID = install.PackageID;
const PackageIndex = Lockfile.PackageIndex;
const PackageManager = install.PackageManager;
const PackageNameAndVersionHash = install.PackageNameAndVersionHash;
const PackageNameHash = install.PackageNameHash;
const PatchedDep = install.PatchedDep;
const Semver = bun.Semver;
const Serializer = @This();
const Stream = Lockfile.Stream;
const String = bun.Semver.String;
const StringPool = Lockfile.StringPool;
const VersionHashMap = Lockfile.VersionHashMap;
const alignment_bytes_to_repeat_buffer = install.alignment_bytes_to_repeat_buffer;
const assert = bun.assert;
const bun = @import("bun");
const install = bun.install;
const logger = bun.logger;
const std = @import("std");
const string = []const u8;
const strings = bun.strings;
const z_allocator = bun.z_allocator;
