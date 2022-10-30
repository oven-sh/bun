const URL = @import("../url.zig").URL;
const std = @import("std");
const MutableString = @import("../string_mutable.zig").MutableString;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const string = @import("../string_types.zig").string;
const strings = @import("../string_immutable.zig");
const PackageManager = @import("./install.zig").PackageManager;
const ExternalStringMap = @import("./install.zig").ExternalStringMap;
const ExternalStringList = @import("./install.zig").ExternalStringList;
const ExternalSlice = @import("./install.zig").ExternalSlice;
const initializeStore = @import("./install.zig").initializeStore;
const logger = @import("../logger.zig");
const Output = @import("../global.zig").Output;
const Integrity = @import("./integrity.zig").Integrity;
const Bin = @import("./bin.zig").Bin;
const Environment = @import("../global.zig").Environment;
const Aligner = @import("./install.zig").Aligner;
const HTTPClient = @import("http");
const json_parser = @import("../json_parser.zig");
const default_allocator = @import("../global.zig").default_allocator;
const IdentityContext = @import("../identity_context.zig").IdentityContext;
const ArrayIdentityContext = @import("../identity_context.zig").ArrayIdentityContext;
const SlicedString = Semver.SlicedString;
const FileSystem = @import("../fs.zig").FileSystem;
const Dependency = @import("./dependency.zig");
const VersionedURL = @import("./versioned_url.zig");
const VersionSlice = @import("./install.zig").VersionSlice;
const ObjectPool = @import("../pool.zig").ObjectPool;
const Api = @import("../api/schema.zig").Api;
const DotEnv = @import("../env_loader.zig");
const ComptimeStringMap = @import("../comptime_string_map.zig").ComptimeStringMap;

const Npm = @This();

pub const Registry = struct {
    url: URL = URL.parse("https://registry.npmjs.org/"),
    scopes: Map = Map{},

    token: string = "",
    auth: string = "",

    pub const BodyPool = ObjectPool(MutableString, MutableString.init2048, true, 8);

    pub const Scope = struct {
        name: string = "",
        // https://github.com/npm/npm-registry-fetch/blob/main/lib/auth.js#L96
        // base64("${username}:${password}")
        auth: string = "",
        // URL may contain these special suffixes in the pathname:
        //  :_authToken
        //  :username
        //  :_password
        //  :_auth
        url: URL,
        token: string = "",

        pub fn hash(name: string) u64 {
            return String.Builder.stringHash(name);
        }

        pub fn getName(name: string) string {
            if (name.len == 0 or name[0] != '@') return name;

            if (strings.indexOfChar(name, '/')) |i| {
                return name[1..i];
            }

            return name[1..];
        }

        pub fn fromAPI(name: string, registry_: Api.NpmRegistry, allocator: std.mem.Allocator, env: *DotEnv.Loader) !Scope {
            var registry = registry_;
            var url = URL.parse(registry.url);
            var auth: string = "";

            if (registry.token.len == 0) {
                outer: {
                    if (registry.password.len == 0) {
                        var pathname = url.pathname;
                        defer {
                            url.pathname = pathname;
                            url.path = pathname;
                        }

                        while (std.mem.lastIndexOfScalar(u8, pathname, ':')) |colon| {
                            var segment = pathname[colon + 1 ..];
                            pathname = pathname[0..colon];
                            if (pathname.len > 1 and pathname[pathname.len - 1] == '/') {
                                pathname = pathname[0 .. pathname.len - 1];
                            }

                            const eql_i = std.mem.indexOfScalar(u8, segment, '=') orelse continue;
                            var value = segment[eql_i + 1 ..];
                            segment = segment[0..eql_i];

                            // https://github.com/yarnpkg/yarn/blob/6db39cf0ff684ce4e7de29669046afb8103fce3d/src/registries/npm-registry.js#L364
                            // Bearer Token
                            if (strings.eqlComptime(segment, "_authToken")) {
                                registry.token = value;
                                break :outer;
                            }

                            if (strings.eqlComptime(segment, "_auth")) {
                                auth = value;
                                break :outer;
                            }

                            if (strings.eqlComptime(segment, "username")) {
                                registry.username = value;
                                continue;
                            }

                            if (strings.eqlComptime(segment, "_password")) {
                                registry.password = value;
                                continue;
                            }
                        }
                    }

                    registry.username = env.getAuto(registry.username);
                    registry.password = env.getAuto(registry.password);

                    if (registry.username.len > 0 and registry.password.len > 0 and auth.len == 0) {
                        var output_buf = try allocator.alloc(u8, registry.username.len + registry.password.len + 1 + std.base64.standard.Encoder.calcSize(registry.username.len + registry.password.len + 1));
                        var input_buf = output_buf[0 .. registry.username.len + registry.password.len + 1];
                        @memcpy(input_buf.ptr, registry.username.ptr, registry.username.len);
                        input_buf[registry.username.len] = ':';
                        @memcpy(input_buf[registry.username.len + 1 ..].ptr, registry.password.ptr, registry.password.len);
                        output_buf = output_buf[input_buf.len..];
                        auth = std.base64.standard.Encoder.encode(output_buf, input_buf);
                        break :outer;
                    }
                }
            }

            registry.token = env.getAuto(registry.token);

            return Scope{ .name = name, .url = url, .token = registry.token, .auth = auth };
        }
    };

    pub const Map = std.HashMapUnmanaged(u64, Scope, IdentityContext(u64), 80);

    const PackageVersionResponse = union(Tag) {
        pub const Tag = enum {
            cached,
            fresh,
            not_found,
        };

        cached: PackageManifest,
        fresh: PackageManifest,
        not_found: void,
    };

    const Pico = @import("picohttp");
    pub fn getPackageMetadata(
        allocator: std.mem.Allocator,
        response: Pico.Response,
        body: []const u8,
        log: *logger.Log,
        package_name: string,
        loaded_manifest: ?PackageManifest,
        package_manager: *PackageManager,
    ) !PackageVersionResponse {
        switch (response.status_code) {
            400 => return error.BadRequest,
            429 => return error.TooManyRequests,
            404 => return PackageVersionResponse{ .not_found = .{} },
            500...599 => return error.HTTPInternalServerError,
            304 => return PackageVersionResponse{
                .cached = loaded_manifest.?,
            },
            else => {},
        }

        var newly_last_modified: string = "";
        var new_etag: string = "";
        for (response.headers) |header| {
            if (!(header.name.len == "last-modified".len or header.name.len == "etag".len)) continue;

            const hashed = HTTPClient.hashHeaderName(header.name);

            switch (hashed) {
                HTTPClient.hashHeaderName("last-modified") => {
                    newly_last_modified = header.value;
                },
                HTTPClient.hashHeaderName("etag") => {
                    new_etag = header.value;
                },
                else => {},
            }
        }

        initializeStore();
        var new_etag_buf: [64]u8 = undefined;

        if (new_etag.len < new_etag_buf.len) {
            std.mem.copy(u8, &new_etag_buf, new_etag);
            new_etag = new_etag_buf[0..new_etag.len];
        }

        if (try PackageManifest.parse(
            allocator,
            log,
            body,
            package_name,
            newly_last_modified,
            new_etag,
            @truncate(u32, @intCast(u64, @maximum(0, std.time.timestamp()))) + 300,
        )) |package| {
            if (package_manager.options.enable.manifest_cache) {
                PackageManifest.Serializer.save(&package, package_manager.getTemporaryDirectory(), package_manager.getCacheDirectory()) catch {};
            }

            return PackageVersionResponse{ .fresh = package };
        }

        return error.PackageFailedToParse;
    }
};

const VersionMap = std.ArrayHashMapUnmanaged(Semver.Version, PackageVersion, Semver.Version.HashContext, false);
const DistTagMap = extern struct {
    tags: ExternalStringList = ExternalStringList{},
    versions: VersionSlice = VersionSlice{},
};

const PackageVersionList = ExternalSlice(PackageVersion);
const ExternVersionMap = extern struct {
    keys: VersionSlice = VersionSlice{},
    values: PackageVersionList = PackageVersionList{},

    pub fn findKeyIndex(this: ExternVersionMap, buf: []const Semver.Version, find: Semver.Version) ?u32 {
        for (this.keys.get(buf)) |key, i| {
            if (key.eql(find)) {
                return @truncate(u32, i);
            }
        }

        return null;
    }
};

/// https://nodejs.org/api/os.html#osplatform
pub const OperatingSystem = enum(u16) {
    none = 0,
    all = all_value,

    _,

    pub const aix: u16 = 1 << 1;
    pub const darwin: u16 = 1 << 2;
    pub const freebsd: u16 = 1 << 3;
    pub const linux: u16 = 1 << 4;
    pub const openbsd: u16 = 1 << 5;
    pub const sunos: u16 = 1 << 6;
    pub const win32: u16 = 1 << 7;
    pub const android: u16 = 1 << 8;

    pub const all_value: u16 = aix | darwin | freebsd | linux | openbsd | sunos | win32 | android;

    pub fn isMatch(this: OperatingSystem) bool {
        if (comptime Environment.isLinux) {
            return (@enumToInt(this) & linux) != 0;
        } else if (comptime Environment.isMac) {
            return (@enumToInt(this) & darwin) != 0;
        } else {
            return false;
        }
    }

    const NameMap = ComptimeStringMap(u16, .{
        .{ "aix", aix },
        .{ "darwin", darwin },
        .{ "freebsd", freebsd },
        .{ "linux", linux },
        .{ "openbsd", openbsd },
        .{ "sunos", sunos },
        .{ "win32", win32 },
        .{ "android", android },
    });

    pub fn apply(this_: OperatingSystem, str: []const u8) OperatingSystem {
        if (str.len == 0) {
            return this_;
        }
        const this = @enumToInt(this_);

        const is_not = str[0] == '!';
        const offset: usize = if (str[0] == '!') 1 else 0;

        const field: u16 = NameMap.get(str[offset..]) orelse return this_;

        if (is_not) {
            return @intToEnum(OperatingSystem, this & ~field);
        } else {
            return @intToEnum(OperatingSystem, this | field);
        }
    }
};

/// https://docs.npmjs.com/cli/v8/configuring-npm/package-json#cpu
/// https://nodejs.org/api/os.html#osarch
pub const Architecture = enum(u16) {
    none = 0,
    all = all_value,
    _,

    pub const arm: u16 = 1 << 1;
    pub const arm64: u16 = 1 << 2;
    pub const ia32: u16 = 1 << 3;
    pub const mips: u16 = 1 << 4;
    pub const mipsel: u16 = 1 << 5;
    pub const ppc: u16 = 1 << 6;
    pub const ppc64: u16 = 1 << 7;
    pub const s390: u16 = 1 << 8;
    pub const s390x: u16 = 1 << 9;
    pub const x32: u16 = 1 << 10;
    pub const x64: u16 = 1 << 11;

    pub const all_value: u16 = arm | arm64 | ia32 | mips | mipsel | ppc | ppc64 | s390 | s390x | x32 | x64;

    const NameMap = ComptimeStringMap(u16, .{
        .{ "arm", arm },
        .{ "arm64", arm64 },
        .{ "ia32", ia32 },
        .{ "mips", mips },
        .{ "mipsel", mipsel },
        .{ "ppc", ppc },
        .{ "ppc64", ppc64 },
        .{ "s390", s390 },
        .{ "s390x", s390x },
        .{ "x32", x32 },
        .{ "x64", x64 },
    });

    pub fn isMatch(this: Architecture) bool {
        if (comptime Environment.isAarch64) {
            return (@enumToInt(this) & arm64) != 0;
        } else if (comptime Environment.isX64) {
            return (@enumToInt(this) & x64) != 0;
        } else {
            return false;
        }
    }

    pub fn apply(this_: Architecture, str: []const u8) Architecture {
        if (str.len == 0) {
            return this_;
        }
        const this = @enumToInt(this_);

        const is_not = str[0] == '!';
        const offset: usize = if (str[0] == '!') 1 else 0;
        const input = str[offset..];

        const field: u16 = NameMap.get(input) orelse return this_;

        if (is_not) {
            return @intToEnum(Architecture, this & ~field);
        } else {
            return @intToEnum(Architecture, this | field);
        }
    }
};
const BigExternalString = Semver.BigExternalString;

pub const PackageVersion = extern struct {
    /// `"integrity"` field || `"shasum"` field
    /// https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#dist
    // Splitting this into it's own array ends up increasing the final size a little bit.
    integrity: Integrity = Integrity{},

    /// "dependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#dependencies)
    dependencies: ExternalStringMap = ExternalStringMap{},

    /// `"optionalDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies)
    optional_dependencies: ExternalStringMap = ExternalStringMap{},

    /// `"peerDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#peerdependencies)
    /// if `optional_peer_dependencies_len` is > 0, then instead of alphabetical, the first N items are optional
    peer_dependencies: ExternalStringMap = ExternalStringMap{},

    /// `"devDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#devdependencies)
    /// We deliberately choose not to populate this field.
    /// We keep it in the data layout so that if it turns out we do need it, we can add it without invalidating everyone's history.
    dev_dependencies: ExternalStringMap = ExternalStringMap{},

    /// `"bin"` field in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#bin)
    bin: Bin = Bin{},

    /// `"engines"` field in package.json
    engines: ExternalStringMap = ExternalStringMap{},

    /// `"peerDependenciesMeta"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#peerdependenciesmeta)
    /// if `optional_peer_dependencies_len` is > 0, then instead of alphabetical, the first N items of `peer_dependencies` are optional
    optional_peer_dependencies_len: u32 = 0,

    man_dir: ExternalString = ExternalString{},

    /// can be empty!
    /// When empty, it means that the tarball URL can be inferred
    tarball_url: ExternalString = ExternalString{},

    unpacked_size: u32 = 0,
    file_count: u32 = 0,

    /// `"os"` field in package.json
    os: OperatingSystem = OperatingSystem.all,
    /// `"cpu"` field in package.json
    cpu: Architecture = Architecture.all,
};

pub const NpmPackage = extern struct {
    /// HTTP response headers
    last_modified: String = String{},
    etag: String = String{},

    /// "modified" in the JSON
    modified: String = String{},
    public_max_age: u32 = 0,

    name: ExternalString = ExternalString{},

    releases: ExternVersionMap = ExternVersionMap{},
    prereleases: ExternVersionMap = ExternVersionMap{},
    dist_tags: DistTagMap = DistTagMap{},

    versions_buf: VersionSlice = VersionSlice{},
    string_lists_buf: ExternalStringList = ExternalStringList{},
    string_buf: BigExternalString = BigExternalString{},
};

pub const PackageManifest = struct {
    pkg: NpmPackage = NpmPackage{},

    string_buf: []const u8 = &[_]u8{},
    versions: []const Semver.Version = &[_]Semver.Version{},
    external_strings: []const ExternalString = &[_]ExternalString{},
    // We store this in a separate buffer so that we can dedupe contiguous identical versions without an extra pass
    external_strings_for_versions: []const ExternalString = &[_]ExternalString{},
    package_versions: []const PackageVersion = &[_]PackageVersion{},
    extern_strings_bin_entries: []const ExternalString = &[_]ExternalString{},

    pub inline fn name(this: *const PackageManifest) string {
        return this.pkg.name.slice(this.string_buf);
    }

    pub const Serializer = struct {
        pub const version = "bun-npm-manifest-cache-v0.0.2\n";
        const header_bytes: string = "#!/usr/bin/env bun\n" ++ version;

        pub const sizes = blk: {
            // skip name
            const fields = std.meta.fields(Npm.PackageManifest);

            const Data = struct {
                size: usize,
                name: []const u8,
                alignment: usize,
            };
            var data: [fields.len]Data = undefined;
            for (fields) |field_info, i| {
                data[i] = .{
                    .size = @sizeOf(field_info.field_type),
                    .name = field_info.name,
                    .alignment = if (@sizeOf(field_info.field_type) == 0) 1 else field_info.alignment,
                };
            }
            const Sort = struct {
                fn lessThan(trash: *i32, lhs: Data, rhs: Data) bool {
                    _ = trash;
                    return lhs.alignment > rhs.alignment;
                }
            };
            var trash: i32 = undefined; // workaround for stage1 compiler bug
            std.sort.sort(Data, &data, &trash, Sort.lessThan);
            var sizes_bytes: [fields.len]usize = undefined;
            var names: [fields.len][]const u8 = undefined;
            for (data) |elem, i| {
                sizes_bytes[i] = elem.size;
                names[i] = elem.name;
            }
            break :blk .{
                .bytes = sizes_bytes,
                .fields = names,
            };
        };

        pub fn writeArray(comptime Writer: type, writer: Writer, comptime Type: type, array: []const Type, pos: *u64) !void {
            const bytes = std.mem.sliceAsBytes(array);
            if (bytes.len == 0) {
                try writer.writeIntNative(u64, 0);
                pos.* += 8;
                return;
            }

            try writer.writeIntNative(u64, bytes.len);
            pos.* += 8;
            pos.* += try Aligner.write(Type, Writer, writer, pos.*);

            try writer.writeAll(
                bytes,
            );
            pos.* += bytes.len;
        }

        pub fn readArray(stream: *std.io.FixedBufferStream([]const u8), comptime Type: type) ![]const Type {
            var reader = stream.reader();
            const byte_len = try reader.readIntNative(u64);
            if (byte_len == 0) {
                return &[_]Type{};
            }

            stream.pos += Aligner.skipAmount(Type, stream.pos);
            const result_bytes = stream.buffer[stream.pos..][0..byte_len];
            const result = @ptrCast([*]const Type, @alignCast(@alignOf([*]const Type), result_bytes.ptr))[0 .. result_bytes.len / @sizeOf(Type)];
            stream.pos += result_bytes.len;
            return result;
        }

        pub fn write(this: *const PackageManifest, comptime Writer: type, writer: Writer) !void {
            var pos: u64 = 0;
            try writer.writeAll(header_bytes);
            pos += header_bytes.len;

            inline for (sizes.fields) |field_name| {
                if (comptime strings.eqlComptime(field_name, "pkg")) {
                    const bytes = std.mem.asBytes(&this.pkg);
                    pos += try Aligner.write(NpmPackage, Writer, writer, pos);
                    try writer.writeAll(
                        bytes,
                    );
                    pos += bytes.len;
                } else {
                    const field = @field(this, field_name);
                    try writeArray(Writer, writer, std.meta.Child(@TypeOf(field)), field, &pos);
                }
            }
        }

        fn writeFile(this: *const PackageManifest, tmp_path: [:0]const u8, tmpdir: std.fs.Dir) !void {
            var tmpfile = try tmpdir.createFileZ(tmp_path, .{
                .truncate = true,
            });
            defer tmpfile.close();
            var writer = tmpfile.writer();
            try Serializer.write(this, @TypeOf(writer), writer);
        }

        pub fn save(this: *const PackageManifest, tmpdir: std.fs.Dir, cache_dir: std.fs.Dir) !void {
            const file_id = std.hash.Wyhash.hash(0, this.name());
            var dest_path_buf: [512 + 64]u8 = undefined;
            var out_path_buf: ["-18446744073709551615".len + ".npm".len + 1]u8 = undefined;
            var dest_path_stream = std.io.fixedBufferStream(&dest_path_buf);
            var dest_path_stream_writer = dest_path_stream.writer();
            try dest_path_stream_writer.print("{x}.npm-{x}", .{ file_id, @maximum(std.time.milliTimestamp(), 0) });
            try dest_path_stream_writer.writeByte(0);
            var tmp_path: [:0]u8 = dest_path_buf[0 .. dest_path_stream.pos - 1 :0];
            try writeFile(this, tmp_path, tmpdir);
            var out_path = std.fmt.bufPrintZ(&out_path_buf, "{x}.npm", .{file_id}) catch unreachable;
            try std.os.renameatZ(tmpdir.fd, tmp_path, cache_dir.fd, out_path);
        }

        pub fn load(allocator: std.mem.Allocator, cache_dir: std.fs.Dir, package_name: string) !?PackageManifest {
            const file_id = std.hash.Wyhash.hash(0, package_name);
            var file_path_buf: [512 + 64]u8 = undefined;
            var file_path = try std.fmt.bufPrintZ(&file_path_buf, "{x}.npm", .{file_id});
            var cache_file = cache_dir.openFileZ(
                file_path,
                .{ .mode = .read_only },
            ) catch return null;
            var timer: std.time.Timer = undefined;
            if (PackageManager.verbose_install) {
                timer = std.time.Timer.start() catch @panic("timer fail");
            }
            defer cache_file.close();
            var bytes = try cache_file.readToEndAlloc(allocator, std.math.maxInt(u32));
            errdefer allocator.free(bytes);
            if (bytes.len < header_bytes.len) return null;
            const result = try readAll(bytes);
            if (PackageManager.verbose_install) {
                Output.prettyError("\n ", .{});
                Output.printTimer(&timer);
                Output.prettyErrorln("<d> [cache hit] {s}<r>", .{package_name});
            }
            return result;
        }

        pub fn readAll(bytes: []const u8) !PackageManifest {
            if (!strings.eqlComptime(bytes[0..header_bytes.len], header_bytes)) {
                return error.InvalidPackageManifest;
            }
            var pkg_stream = std.io.fixedBufferStream(bytes);
            pkg_stream.pos = header_bytes.len;
            var package_manifest = PackageManifest{};

            inline for (sizes.fields) |field_name| {
                if (comptime strings.eqlComptime(field_name, "pkg")) {
                    pkg_stream.pos = std.mem.alignForward(pkg_stream.pos, @alignOf(Npm.NpmPackage));
                    var reader = pkg_stream.reader();
                    package_manifest.pkg = try reader.readStruct(NpmPackage);
                } else {
                    @field(package_manifest, field_name) = try readArray(
                        &pkg_stream,
                        std.meta.Child(@TypeOf(@field(package_manifest, field_name))),
                    );
                }
            }

            return package_manifest;
        }
    };

    pub fn str(self: *const PackageManifest, external: ExternalString) string {
        return external.slice(self.string_buf);
    }

    pub fn reportSize(this: *const PackageManifest) void {
        Output.prettyErrorln(
            \\ Versions count:            {d} 
            \\ External Strings count:    {d} 
            \\ Package Versions count:    {d}
            \\ 
            \\ Bytes:
            \\
            \\  Versions:   {d} 
            \\  External:   {d} 
            \\  Packages:   {d} 
            \\  Strings:    {d}
            \\  Total:      {d}
        , .{
            this.versions.len,
            this.external_strings.len,
            this.package_versions.len,

            std.mem.sliceAsBytes(this.versions).len,
            std.mem.sliceAsBytes(this.external_strings).len,
            std.mem.sliceAsBytes(this.package_versions).len,
            std.mem.sliceAsBytes(this.string_buf).len,
            std.mem.sliceAsBytes(this.versions).len +
                std.mem.sliceAsBytes(this.external_strings).len +
                std.mem.sliceAsBytes(this.package_versions).len +
                std.mem.sliceAsBytes(this.string_buf).len,
        });
        Output.flush();
    }

    pub const FindResult = struct {
        version: Semver.Version,
        package: *const PackageVersion,
    };

    pub fn findByString(this: *const PackageManifest, version: string) ?FindResult {
        switch (Dependency.Version.Tag.infer(version)) {
            .npm => {
                const group = Semver.Query.parse(default_allocator, version, SlicedString.init(
                    version,
                    version,
                )) catch return null;
                return this.findBestVersion(group);
            },
            .dist_tag => {
                return this.findByDistTag(version);
            },
            else => return null,
        }
    }

    pub fn findByVersion(this: *const PackageManifest, version: Semver.Version) ?FindResult {
        const list = if (!version.tag.hasPre()) this.pkg.releases else this.pkg.prereleases;
        const values = list.values.get(this.package_versions);
        const keys = list.keys.get(this.versions);
        const index = list.findKeyIndex(this.versions, version) orelse return null;
        return FindResult{
            // Be sure to use the struct from the list in the NpmPackage
            // That is the one we can correctly recover the original version string for
            .version = keys[index],
            .package = &values[index],
        };
    }

    pub fn findByDistTag(this: *const PackageManifest, tag: string) ?FindResult {
        const versions = this.pkg.dist_tags.versions.get(this.versions);
        for (this.pkg.dist_tags.tags.get(this.external_strings)) |tag_str, i| {
            if (strings.eql(tag_str.slice(this.string_buf), tag)) {
                return this.findByVersion(versions[i]);
            }
        }

        return null;
    }

    pub fn findBestVersion(this: *const PackageManifest, group: Semver.Query.Group) ?FindResult {
        const left = group.head.head.range.left;
        // Fast path: exact version
        if (left.op == .eql) {
            return this.findByVersion(left.version);
        }

        const releases = this.pkg.releases.keys.get(this.versions);

        if (group.flags.isSet(Semver.Query.Group.Flags.pre)) {
            const prereleases = this.pkg.prereleases.keys.get(this.versions);
            var i = prereleases.len;
            while (i > 0) : (i -= 1) {
                const version = prereleases[i - 1];
                const packages = this.pkg.prereleases.values.get(this.package_versions);

                if (group.satisfies(version)) {
                    return FindResult{ .version = version, .package = &packages[i - 1] };
                }
            }
        }

        {
            var i = releases.len;
            // // For now, this is the dumb way
            while (i > 0) : (i -= 1) {
                const version = releases[i - 1];
                const packages = this.pkg.releases.values.get(this.package_versions);

                if (group.satisfies(version)) {
                    return FindResult{ .version = version, .package = &packages[i - 1] };
                }
            }
        }

        return null;
    }

    const ExternalStringMapDeduper = std.HashMap(u64, ExternalStringList, IdentityContext(u64), 80);

    threadlocal var string_pool_: String.Builder.StringPool = undefined;
    threadlocal var string_pool_loaded: bool = false;

    threadlocal var external_string_maps_: ExternalStringMapDeduper = undefined;
    threadlocal var external_string_maps_loaded: bool = false;

    threadlocal var optional_peer_dep_names_: std.ArrayList(u64) = undefined;
    threadlocal var optional_peer_dep_names_loaded: bool = false;

    /// This parses [Abbreviated metadata](https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#abbreviated-metadata-format)
    pub fn parse(
        allocator: std.mem.Allocator,
        log: *logger.Log,
        json_buffer: []const u8,
        expected_name: []const u8,
        last_modified: []const u8,
        etag: []const u8,
        public_max_age: u32,
    ) !?PackageManifest {
        const source = logger.Source.initPathString(expected_name, json_buffer);
        initializeStore();
        const json = json_parser.ParseJSONUTF8(&source, log, allocator) catch return null;

        if (json.asProperty("error")) |error_q| {
            if (error_q.expr.asString(allocator)) |err| {
                log.addErrorFmt(&source, logger.Loc.Empty, allocator, "npm error: {s}", .{err}) catch unreachable;
                return null;
            }
        }

        var result = PackageManifest{};

        if (!string_pool_loaded) {
            string_pool_ = String.Builder.StringPool.init(default_allocator);
            string_pool_loaded = true;
        }

        if (!external_string_maps_loaded) {
            external_string_maps_ = ExternalStringMapDeduper.initContext(default_allocator, .{});
            external_string_maps_loaded = true;
        }

        if (!optional_peer_dep_names_loaded) {
            optional_peer_dep_names_ = std.ArrayList(u64).init(default_allocator);
            optional_peer_dep_names_loaded = true;
        }

        var string_pool = string_pool_;
        string_pool.clearRetainingCapacity();
        var external_string_maps = external_string_maps_;
        external_string_maps.clearRetainingCapacity();
        var optional_peer_dep_names = optional_peer_dep_names_;
        optional_peer_dep_names.clearRetainingCapacity();

        defer string_pool_ = string_pool;
        defer external_string_maps_ = external_string_maps;
        defer optional_peer_dep_names_ = optional_peer_dep_names;

        var string_builder = String.Builder{
            .string_pool = string_pool,
        };

        if (json.asProperty("name")) |name_q| {
            const field = name_q.expr.asString(allocator) orelse return null;

            if (!strings.eql(field, expected_name)) {
                Output.panic("<r>internal: <red>package name mismatch<r> expected <b>\"{s}\"<r> but received <red>\"{s}\"<r>", .{ expected_name, field });
                return null;
            }

            string_builder.count(field);
        }

        if (json.asProperty("modified")) |name_q| {
            const field = name_q.expr.asString(allocator) orelse return null;

            string_builder.count(field);
        }

        const DependencyGroup = struct { prop: string, field: string };
        const dependency_groups = comptime [_]DependencyGroup{
            .{ .prop = "dependencies", .field = "dependencies" },
            .{ .prop = "optionalDependencies", .field = "optional_dependencies" },
            .{ .prop = "peerDependencies", .field = "peer_dependencies" },
        };

        var release_versions_len: usize = 0;
        var pre_versions_len: usize = 0;
        var dependency_sum: usize = 0;
        var extern_string_count: usize = 0;
        var extern_string_count_bin: usize = 0;
        var tarball_urls_count: usize = 0;
        get_versions: {
            if (json.asProperty("versions")) |versions_q| {
                if (versions_q.expr.data != .e_object) break :get_versions;

                const versions = versions_q.expr.data.e_object.properties.slice();
                for (versions) |prop| {
                    const version_name = prop.key.?.asString(allocator) orelse continue;

                    if (std.mem.indexOfScalar(u8, version_name, '-') != null) {
                        pre_versions_len += 1;
                        extern_string_count += 1;
                    } else {
                        extern_string_count += @as(usize, @boolToInt(std.mem.indexOfScalar(u8, version_name, '+') != null));
                        release_versions_len += 1;
                    }

                    string_builder.count(version_name);

                    if (prop.value.?.asProperty("dist")) |dist_q| {
                        if (dist_q.expr.get("tarball")) |tarball_prop| {
                            if (tarball_prop.data == .e_string) {
                                const tarball = tarball_prop.data.e_string.slice(allocator);
                                string_builder.count(tarball);
                                tarball_urls_count += @as(usize, @boolToInt(tarball.len > 0));
                            }
                        }
                    }

                    bin: {
                        if (prop.value.?.asProperty("bin")) |bin| {
                            switch (bin.expr.data) {
                                .e_object => |obj| {
                                    switch (obj.properties.len) {
                                        0 => {
                                            break :bin;
                                        },
                                        1 => {},
                                        else => {
                                            extern_string_count_bin += obj.properties.len * 2;
                                        },
                                    }

                                    for (obj.properties.slice()) |bin_prop| {
                                        string_builder.count(bin_prop.key.?.asString(allocator) orelse break :bin);
                                        string_builder.count(bin_prop.value.?.asString(allocator) orelse break :bin);
                                    }
                                },
                                .e_string => {
                                    if (bin.expr.asString(allocator)) |str_| {
                                        string_builder.count(str_);
                                        break :bin;
                                    }
                                },
                                else => {},
                            }
                        }

                        if (prop.value.?.asProperty("directories")) |dirs| {
                            if (dirs.expr.asProperty("bin")) |bin_prop| {
                                if (bin_prop.expr.asString(allocator)) |str_| {
                                    string_builder.count(str_);
                                    break :bin;
                                }
                            }
                        }
                    }

                    inline for (dependency_groups) |pair| {
                        if (prop.value.?.asProperty(pair.prop)) |versioned_deps| {
                            if (versioned_deps.expr.data == .e_object) {
                                dependency_sum += versioned_deps.expr.data.e_object.properties.len;
                                const properties = versioned_deps.expr.data.e_object.properties.slice();
                                for (properties) |property| {
                                    if (property.key.?.asString(allocator)) |key| {
                                        string_builder.count(key);
                                        string_builder.count(property.value.?.asString(allocator) orelse "");
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        extern_string_count += dependency_sum;

        var dist_tags_count: usize = 0;
        if (json.asProperty("dist-tags")) |dist| {
            if (dist.expr.data == .e_object) {
                const tags = dist.expr.data.e_object.properties.slice();
                for (tags) |tag| {
                    if (tag.key.?.asString(allocator)) |key| {
                        string_builder.count(key);
                        extern_string_count += 2;

                        string_builder.count((tag.value.?.asString(allocator) orelse ""));
                        dist_tags_count += 1;
                    }
                }
            }
        }

        if (last_modified.len > 0) {
            string_builder.count(last_modified);
        }

        if (etag.len > 0) {
            string_builder.count(etag);
        }

        var versioned_packages = try allocator.allocAdvanced(PackageVersion, null, release_versions_len + pre_versions_len, .exact);
        var all_semver_versions = try allocator.allocAdvanced(Semver.Version, null, release_versions_len + pre_versions_len + dist_tags_count, .exact);
        var all_extern_strings = try allocator.allocAdvanced(ExternalString, null, extern_string_count + tarball_urls_count, .exact);
        var version_extern_strings = try allocator.allocAdvanced(ExternalString, null, dependency_sum, .exact);
        var extern_strings_bin_entries = try allocator.allocAdvanced(ExternalString, null, extern_string_count_bin, .exact);
        var all_extern_strings_bin_entries = extern_strings_bin_entries;
        var all_tarball_url_strings = try allocator.allocAdvanced(ExternalString, null, tarball_urls_count, .exact);
        var tarball_url_strings = all_tarball_url_strings;

        if (versioned_packages.len > 0) {
            var versioned_packages_bytes = std.mem.sliceAsBytes(versioned_packages);
            @memset(versioned_packages_bytes.ptr, 0, versioned_packages_bytes.len);
        }
        if (all_semver_versions.len > 0) {
            var all_semver_versions_bytes = std.mem.sliceAsBytes(all_semver_versions);
            @memset(all_semver_versions_bytes.ptr, 0, all_semver_versions_bytes.len);
        }
        if (all_extern_strings.len > 0) {
            var all_extern_strings_bytes = std.mem.sliceAsBytes(all_extern_strings);
            @memset(all_extern_strings_bytes.ptr, 0, all_extern_strings_bytes.len);
        }
        if (version_extern_strings.len > 0) {
            var version_extern_strings_bytes = std.mem.sliceAsBytes(version_extern_strings);
            @memset(version_extern_strings_bytes.ptr, 0, version_extern_strings_bytes.len);
        }

        var versioned_package_releases = versioned_packages[0..release_versions_len];
        var all_versioned_package_releases = versioned_package_releases;
        var versioned_package_prereleases = versioned_packages[release_versions_len..][0..pre_versions_len];
        var all_versioned_package_prereleases = versioned_package_prereleases;
        var _versions_open = all_semver_versions;
        var all_release_versions = _versions_open[0..release_versions_len];
        _versions_open = _versions_open[release_versions_len..];
        var all_prerelease_versions = _versions_open[0..pre_versions_len];
        _versions_open = _versions_open[pre_versions_len..];
        var dist_tag_versions = _versions_open[0..dist_tags_count];
        var release_versions = all_release_versions;
        var prerelease_versions = all_prerelease_versions;

        var extern_strings = all_extern_strings;
        string_builder.cap += (string_builder.cap % 64) + 64;
        string_builder.cap *= 2;

        try string_builder.allocate(allocator);

        var string_buf: string = "";
        if (string_builder.ptr) |ptr| {
            // 0 it out for better determinism
            @memset(ptr, 0, string_builder.cap);

            string_buf = ptr[0..string_builder.cap];
        }

        if (json.asProperty("name")) |name_q| {
            const field = name_q.expr.asString(allocator) orelse return null;
            result.pkg.name = string_builder.append(ExternalString, field);
        }

        get_versions: {
            if (json.asProperty("versions")) |versions_q| {
                if (versions_q.expr.data != .e_object) break :get_versions;

                const versions = versions_q.expr.data.e_object.properties.slice();

                var all_dependency_names_and_values = all_extern_strings[0..dependency_sum];

                // versions change more often than names
                // so names go last because we are better able to dedupe at the end
                var dependency_values = version_extern_strings;
                var dependency_names = all_dependency_names_and_values;
                var prev_extern_bin_group = extern_strings_bin_entries;

                var version_string__: String = String{};
                for (versions) |prop| {
                    const version_name = prop.key.?.asString(allocator) orelse continue;

                    var sliced_string = SlicedString.init(version_name, version_name);

                    // We only need to copy the version tags if it's a pre/post
                    if (std.mem.indexOfAny(u8, version_name, "-+") != null) {
                        version_string__ = string_builder.append(String, version_name);
                        sliced_string = version_string__.sliced(string_buf);
                    }

                    const parsed_version = Semver.Version.parse(sliced_string, allocator);
                    if (Environment.allow_assert) std.debug.assert(parsed_version.valid);

                    if (!parsed_version.valid) {
                        log.addErrorFmt(&source, prop.value.?.loc, allocator, "Failed to parse dependency {s}", .{version_name}) catch unreachable;
                        continue;
                    }

                    var package_version = PackageVersion{};

                    if (prop.value.?.asProperty("cpu")) |cpu| {
                        package_version.cpu = Architecture.all;

                        switch (cpu.expr.data) {
                            .e_array => |arr| {
                                const items = arr.slice();
                                if (items.len > 0) {
                                    package_version.cpu = Architecture.none;
                                    for (items) |item| {
                                        if (item.asString(allocator)) |cpu_str_| {
                                            package_version.cpu = package_version.cpu.apply(cpu_str_);
                                        }
                                    }
                                }
                            },
                            .e_string => |str| {
                                package_version.cpu = Architecture.apply(Architecture.none, str.data);
                            },
                            else => {},
                        }
                    }

                    if (prop.value.?.asProperty("os")) |os| {
                        package_version.os = OperatingSystem.all;

                        switch (os.expr.data) {
                            .e_array => |arr| {
                                const items = arr.slice();
                                if (items.len > 0) {
                                    package_version.os = OperatingSystem.none;
                                    for (items) |item| {
                                        if (item.asString(allocator)) |cpu_str_| {
                                            package_version.os = package_version.os.apply(cpu_str_);
                                        }
                                    }
                                }
                            },
                            .e_string => |str| {
                                package_version.os = OperatingSystem.apply(OperatingSystem.none, str.data);
                            },
                            else => {},
                        }
                    }

                    bin: {
                        // bins are extremely repetitive
                        // We try to avoid storing copies the string
                        if (prop.value.?.asProperty("bin")) |bin| {
                            switch (bin.expr.data) {
                                .e_object => |obj| {
                                    switch (obj.properties.len) {
                                        0 => {},
                                        1 => {
                                            const bin_name = obj.properties.ptr[0].key.?.asString(allocator) orelse break :bin;
                                            const value = obj.properties.ptr[0].value.?.asString(allocator) orelse break :bin;

                                            package_version.bin = Bin{
                                                .tag = Bin.Tag.named_file,
                                                .value = .{
                                                    .named_file = .{
                                                        string_builder.append(String, bin_name),
                                                        string_builder.append(String, value),
                                                    },
                                                },
                                            };
                                        },
                                        else => {
                                            var group_slice = extern_strings_bin_entries[0 .. obj.properties.len * 2];

                                            var is_identical = prev_extern_bin_group.len == group_slice.len;
                                            var group_i: u32 = 0;

                                            for (obj.properties.slice()) |bin_prop| {
                                                group_slice[group_i] = string_builder.append(ExternalString, bin_prop.key.?.asString(allocator) orelse break :bin);
                                                if (is_identical) {
                                                    is_identical = group_slice[group_i].hash == prev_extern_bin_group[group_i].hash;
                                                }
                                                group_i += 1;

                                                group_slice[group_i] = string_builder.append(ExternalString, bin_prop.value.?.asString(allocator) orelse break :bin);
                                                if (is_identical) {
                                                    is_identical = group_slice[group_i].hash == prev_extern_bin_group[group_i].hash;
                                                }
                                                group_i += 1;
                                            }

                                            if (is_identical) {
                                                group_slice = prev_extern_bin_group;
                                            } else {
                                                prev_extern_bin_group = group_slice;
                                                extern_strings_bin_entries = extern_strings_bin_entries[group_slice.len..];
                                            }

                                            package_version.bin = Bin{
                                                .tag = Bin.Tag.map,
                                                .value = .{ .map = ExternalStringList.init(all_extern_strings_bin_entries, group_slice) },
                                            };
                                        },
                                    }

                                    break :bin;
                                },
                                .e_string => |str| {
                                    if (str.data.len > 0) {
                                        package_version.bin = Bin{
                                            .tag = Bin.Tag.file,
                                            .value = .{
                                                .file = string_builder.append(String, str.data),
                                            },
                                        };
                                        break :bin;
                                    }
                                },
                                else => {},
                            }
                        }

                        if (prop.value.?.asProperty("directories")) |dirs| {
                            // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#directoriesbin
                            // Because of the way the bin directive works,
                            // specifying both a bin path and setting
                            // directories.bin is an error. If you want to
                            // specify individual files, use bin, and for all
                            // the files in an existing bin directory, use
                            // directories.bin.
                            if (dirs.expr.asProperty("bin")) |bin_prop| {
                                if (bin_prop.expr.asString(allocator)) |str_| {
                                    if (str_.len > 0) {
                                        package_version.bin = Bin{
                                            .tag = Bin.Tag.dir,
                                            .value = .{
                                                .dir = string_builder.append(String, str_),
                                            },
                                        };
                                        break :bin;
                                    }
                                }
                            }
                        }
                    }

                    integrity: {
                        if (prop.value.?.asProperty("dist")) |dist| {
                            if (dist.expr.data == .e_object) {
                                if (dist.expr.asProperty("tarball")) |tarball_q| {
                                    if (tarball_q.expr.data == .e_string and tarball_q.expr.data.e_string.len() > 0) {
                                        package_version.tarball_url = string_builder.append(ExternalString, tarball_q.expr.data.e_string.slice(allocator));
                                        tarball_url_strings[0] = package_version.tarball_url;
                                        tarball_url_strings = tarball_url_strings[1..];
                                    }
                                }

                                if (dist.expr.asProperty("fileCount")) |file_count_| {
                                    if (file_count_.expr.data == .e_number) {
                                        package_version.file_count = file_count_.expr.data.e_number.toU32();
                                    }
                                }

                                if (dist.expr.asProperty("unpackedSize")) |file_count_| {
                                    if (file_count_.expr.data == .e_number) {
                                        package_version.unpacked_size = file_count_.expr.data.e_number.toU32();
                                    }
                                }

                                if (dist.expr.asProperty("integrity")) |shasum| {
                                    if (shasum.expr.asString(allocator)) |shasum_str| {
                                        package_version.integrity = Integrity.parse(shasum_str) catch Integrity{};
                                        if (package_version.integrity.tag.isSupported()) break :integrity;
                                    }
                                }

                                if (dist.expr.asProperty("shasum")) |shasum| {
                                    if (shasum.expr.asString(allocator)) |shasum_str| {
                                        package_version.integrity = Integrity.parseSHASum(shasum_str) catch Integrity{};
                                    }
                                }

                                if (dist.expr.asProperty("shasum")) |shasum| {
                                    if (shasum.expr.asString(allocator)) |shasum_str| {
                                        package_version.integrity = Integrity.parseSHASum(shasum_str) catch Integrity{};
                                    }
                                }
                            }
                        }
                    }

                    var peer_dependency_len: usize = 0;

                    inline for (dependency_groups) |pair| {
                        if (prop.value.?.asProperty(comptime pair.prop)) |versioned_deps| {
                            if (versioned_deps.expr.data == .e_object) {
                                const items = versioned_deps.expr.data.e_object.properties.slice();
                                var count = items.len;

                                var this_names = dependency_names[0..count];
                                var this_versions = dependency_values[0..count];

                                var name_hasher = std.hash.Wyhash.init(0);
                                var version_hasher = std.hash.Wyhash.init(0);

                                const is_peer = comptime strings.eqlComptime(pair.prop, "peerDependencies");

                                if (comptime is_peer) {
                                    optional_peer_dep_names.clearRetainingCapacity();

                                    if (prop.value.?.asProperty("peerDependenciesMeta")) |meta| {
                                        if (meta.expr.data == .e_object) {
                                            const meta_props = meta.expr.data.e_object.properties.slice();
                                            try optional_peer_dep_names.ensureUnusedCapacity(meta_props.len);
                                            for (meta_props) |meta_prop| {
                                                if (meta_prop.value.?.asProperty("optional")) |optional| {
                                                    if (optional.expr.data != .e_boolean or !optional.expr.data.e_boolean.value) {
                                                        continue;
                                                    }

                                                    optional_peer_dep_names.appendAssumeCapacity(String.Builder.stringHash(meta_prop.key.?.asString(allocator) orelse unreachable));
                                                }
                                            }
                                        }
                                    }
                                }

                                var i: usize = 0;

                                for (items) |item| {
                                    const name_str = item.key.?.asString(allocator) orelse if (comptime Environment.allow_assert) unreachable else continue;
                                    const version_str = item.value.?.asString(allocator) orelse if (comptime Environment.allow_assert) unreachable else continue;

                                    this_names[i] = string_builder.append(ExternalString, name_str);
                                    this_versions[i] = string_builder.append(ExternalString, version_str);

                                    if (comptime is_peer) {
                                        if (std.mem.indexOfScalar(u64, optional_peer_dep_names.items, this_names[i].hash) != null) {
                                            // For optional peer dependencies, we store a length instead of a whole separate array
                                            // To make that work, we have to move optional peer dependencies to the front of the array
                                            //
                                            if (peer_dependency_len != i) {
                                                const current_name = this_names[i];
                                                this_names[i] = this_names[peer_dependency_len];
                                                this_names[peer_dependency_len] = current_name;

                                                const current_version = this_versions[i];
                                                this_versions[i] = this_versions[peer_dependency_len];
                                                this_versions[peer_dependency_len] = current_version;

                                                peer_dependency_len += 1;
                                            }
                                        }

                                        if (optional_peer_dep_names.items.len == 0) {
                                            const names_hash_bytes = @bitCast([8]u8, this_names[i].hash);
                                            name_hasher.update(&names_hash_bytes);
                                            const versions_hash_bytes = @bitCast([8]u8, this_versions[i].hash);
                                            version_hasher.update(&versions_hash_bytes);
                                        }
                                    } else {
                                        const names_hash_bytes = @bitCast([8]u8, this_names[i].hash);
                                        name_hasher.update(&names_hash_bytes);
                                        const versions_hash_bytes = @bitCast([8]u8, this_versions[i].hash);
                                        version_hasher.update(&versions_hash_bytes);
                                    }

                                    i += 1;
                                }

                                count = i;

                                var name_list = ExternalStringList.init(all_extern_strings, this_names);
                                var version_list = ExternalStringList.init(version_extern_strings, this_versions);

                                if (comptime is_peer) {
                                    package_version.optional_peer_dependencies_len = @truncate(u32, peer_dependency_len);
                                }

                                if (count > 0 and
                                    ((comptime !is_peer) or
                                    optional_peer_dep_names.items.len == 0))
                                {
                                    const name_map_hash = name_hasher.final();
                                    const version_map_hash = version_hasher.final();

                                    var name_entry = try external_string_maps.getOrPut(name_map_hash);
                                    if (name_entry.found_existing) {
                                        name_list = name_entry.value_ptr.*;
                                        this_names = name_list.mut(all_extern_strings);
                                    } else {
                                        name_entry.value_ptr.* = name_list;
                                        dependency_names = dependency_names[count..];
                                    }

                                    var version_entry = try external_string_maps.getOrPut(version_map_hash);
                                    if (version_entry.found_existing) {
                                        version_list = version_entry.value_ptr.*;
                                        this_versions = version_list.mut(version_extern_strings);
                                    } else {
                                        version_entry.value_ptr.* = version_list;
                                        dependency_values = dependency_values[count..];
                                    }
                                }

                                if (comptime is_peer) {
                                    if (optional_peer_dep_names.items.len > 0) {
                                        dependency_names = dependency_names[count..];
                                        dependency_values = dependency_values[count..];
                                    }
                                }

                                @field(package_version, pair.field) = ExternalStringMap{
                                    .name = name_list,
                                    .value = version_list,
                                };

                                if (comptime Environment.allow_assert) {
                                    const dependencies_list = @field(package_version, pair.field);

                                    std.debug.assert(dependencies_list.name.off < all_extern_strings.len);
                                    std.debug.assert(dependencies_list.value.off < all_extern_strings.len);
                                    std.debug.assert(dependencies_list.name.off + dependencies_list.name.len < all_extern_strings.len);
                                    std.debug.assert(dependencies_list.value.off + dependencies_list.value.len < all_extern_strings.len);

                                    std.debug.assert(std.meta.eql(dependencies_list.name.get(all_extern_strings), this_names));
                                    std.debug.assert(std.meta.eql(dependencies_list.value.get(version_extern_strings), this_versions));
                                    var j: usize = 0;
                                    const name_dependencies = dependencies_list.name.get(all_extern_strings);

                                    if (comptime is_peer) {
                                        if (optional_peer_dep_names.items.len == 0) {
                                            while (j < name_dependencies.len) : (j += 1) {
                                                const dep_name = name_dependencies[j];
                                                std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), this_names[j].slice(string_buf)));
                                                std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), items[j].key.?.asString(allocator).?));
                                            }

                                            j = 0;
                                            while (j < dependencies_list.value.len) : (j += 1) {
                                                const dep_name = dependencies_list.value.get(version_extern_strings)[j];

                                                std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), this_versions[j].slice(string_buf)));
                                                std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), items[j].value.?.asString(allocator).?));
                                            }
                                        }
                                    } else {
                                        while (j < name_dependencies.len) : (j += 1) {
                                            const dep_name = name_dependencies[j];
                                            std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), this_names[j].slice(string_buf)));
                                            std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), items[j].key.?.asString(allocator).?));
                                        }

                                        j = 0;
                                        while (j < dependencies_list.value.len) : (j += 1) {
                                            const dep_name = dependencies_list.value.get(version_extern_strings)[j];

                                            std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), this_versions[j].slice(string_buf)));
                                            std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), items[j].value.?.asString(allocator).?));
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (!parsed_version.version.tag.hasPre()) {
                        release_versions[0] = parsed_version.version;
                        versioned_package_releases[0] = package_version;
                        release_versions = release_versions[1..];
                        versioned_package_releases = versioned_package_releases[1..];
                    } else {
                        prerelease_versions[0] = parsed_version.version;
                        versioned_package_prereleases[0] = package_version;
                        prerelease_versions = prerelease_versions[1..];
                        versioned_package_prereleases = versioned_package_prereleases[1..];
                    }
                }

                extern_strings = all_extern_strings[all_dependency_names_and_values.len - dependency_names.len ..];
                version_extern_strings = version_extern_strings[0 .. version_extern_strings.len - dependency_values.len];
            }
        }

        if (json.asProperty("dist-tags")) |dist| {
            if (dist.expr.data == .e_object) {
                const tags = dist.expr.data.e_object.properties.slice();
                var extern_strings_slice = extern_strings[0..dist_tags_count];
                var dist_tag_i: usize = 0;

                for (tags) |tag| {
                    if (tag.key.?.asString(allocator)) |key| {
                        extern_strings_slice[dist_tag_i] = string_builder.append(ExternalString, key);

                        const version_name = tag.value.?.asString(allocator) orelse continue;

                        const dist_tag_value_literal = string_builder.append(ExternalString, version_name);

                        const sliced_string = dist_tag_value_literal.value.sliced(string_buf);

                        dist_tag_versions[dist_tag_i] = Semver.Version.parse(sliced_string, allocator).version;
                        dist_tag_i += 1;
                    }
                }

                result.pkg.dist_tags = DistTagMap{
                    .tags = ExternalStringList.init(all_extern_strings, extern_strings_slice[0..dist_tag_i]),
                    .versions = VersionSlice.init(all_semver_versions, dist_tag_versions[0..dist_tag_i]),
                };

                if (comptime Environment.allow_assert) {
                    std.debug.assert(std.meta.eql(result.pkg.dist_tags.versions.get(all_semver_versions), dist_tag_versions[0..dist_tag_i]));
                    std.debug.assert(std.meta.eql(result.pkg.dist_tags.tags.get(all_extern_strings), extern_strings_slice[0..dist_tag_i]));
                }

                extern_strings = extern_strings[dist_tag_i..];
            }
        }

        if (last_modified.len > 0) {
            result.pkg.last_modified = string_builder.append(String, last_modified);
        }

        if (etag.len > 0) {
            result.pkg.etag = string_builder.append(String, etag);
        }

        if (json.asProperty("modified")) |name_q| {
            const field = name_q.expr.asString(allocator) orelse return null;

            result.pkg.modified = string_builder.append(String, field);
        }

        result.pkg.releases.keys = VersionSlice.init(all_semver_versions, all_release_versions);
        result.pkg.releases.values = PackageVersionList.init(versioned_packages, all_versioned_package_releases);

        result.pkg.prereleases.keys = VersionSlice.init(all_semver_versions, all_prerelease_versions);
        result.pkg.prereleases.values = PackageVersionList.init(versioned_packages, all_versioned_package_prereleases);

        if (extern_strings.len + tarball_urls_count > 0) {
            var src = std.mem.sliceAsBytes(all_tarball_url_strings[0 .. all_tarball_url_strings.len - tarball_url_strings.len]);
            if (src.len > 0) {
                var dst = std.mem.sliceAsBytes(all_extern_strings[all_extern_strings.len - extern_strings.len ..]);
                std.debug.assert(dst.len >= src.len);
                @memcpy(dst.ptr, src.ptr, src.len);
            }

            all_extern_strings = all_extern_strings[0 .. all_extern_strings.len - extern_strings.len];
        }

        result.pkg.string_lists_buf.off = 0;
        result.pkg.string_lists_buf.len = @truncate(u32, all_extern_strings.len);

        result.pkg.versions_buf.off = 0;
        result.pkg.versions_buf.len = @truncate(u32, all_semver_versions.len);

        result.versions = all_semver_versions;
        result.external_strings = all_extern_strings;
        result.external_strings_for_versions = version_extern_strings;
        result.package_versions = versioned_packages;
        result.extern_strings_bin_entries = all_extern_strings_bin_entries[0 .. all_extern_strings_bin_entries.len - extern_strings_bin_entries.len];
        result.pkg.public_max_age = public_max_age;

        if (string_builder.ptr) |ptr| {
            result.string_buf = ptr[0..string_builder.len];
            result.pkg.string_buf = BigExternalString{
                .off = 0,
                .len = @truncate(u32, string_builder.len),
                .hash = 0,
            };
        }

        return result;
    }
};
