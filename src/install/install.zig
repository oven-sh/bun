usingnamespace @import("../global.zig");
const std = @import("std");

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");
const alloc = @import("../alloc.zig");
const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const json_parser = @import("../json_parser.zig");
const js_printer = @import("../js_printer.zig");
const JSAst = @import("../js_ast.zig");
const linker = @import("../linker.zig");
usingnamespace @import("../ast/base.zig");
usingnamespace @import("../defines.zig");
const panicky = @import("../panic_handler.zig");
const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../javascript/jsc/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
const NewBunQueue = @import("../bun_queue.zig").NewBunQueue;
const HTTPClient = @import("../http_client.zig");
const Fs = @import("../fs.zig");
const Lock = @import("../lock.zig").Lock;
var path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
var path_buf2: [std.fs.MAX_PATH_BYTES]u8 = undefined;
const URL = @import("../query_string_map.zig").URL;

pub const URI = union(Tag) {
    local: string,
    remote: URL,

    pub const Tag = enum {
        local,
        remote,
    };
};

const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const StringBuilder = @import("../string_builder.zig");
const SlicedString = Semver.SlicedString;

pub fn ExternalSlice(comptime Type: type) type {
    return extern struct {
        const Slice = @This();

        off: u32 = 0,
        len: u32 = 0,

        pub inline fn get(this: Slice, in: []const Type) []const Type {
            return in[this.off .. this.off + this.len];
        }

        pub inline fn mut(this: Slice, in: []Type) []Type {
            return in[this.off .. this.off + this.len];
        }

        pub fn init(buf: []const Type, in: []const Type) Slice {
            // if (comptime isDebug or isTest) {
            //     std.debug.assert(@ptrToInt(buf.ptr) <= @ptrToInt(in.ptr));
            //     std.debug.assert((@ptrToInt(in.ptr) + in.len) <= (@ptrToInt(buf.ptr) + buf.len));
            // }

            return Slice{
                .off = @truncate(u32, (@ptrToInt(in.ptr) - @ptrToInt(buf.ptr)) / @sizeOf(Type)),
                .len = @truncate(u32, in.len),
            };
        }
    };
}

const PackageID = u32;
const invalid_package_id = std.math.maxInt(PackageID);

const ExternalStringList = ExternalSlice(ExternalString);
const VersionSlice = ExternalSlice(Semver.Version);

pub const ExternalStringMap = extern struct {
    name: ExternalStringList = ExternalStringList{},
    value: ExternalStringList = ExternalStringList{},
};

pub const Dependency = struct {
    name: string,
    name_hash: u32,
    request: DependencyRequest,

    pub const Version = union(Tag) {
        pub const Tag = enum(u8) {
            /// Semver range
            npm = 1,

            /// NPM dist tag, e.g. "latest"
            dist_tag = 2,

            /// URI to a .tgz or .tar.gz
            tarball = 3,

            /// Local folder
            folder = 4,

            /// TODO:
            symlink = 5,
            /// TODO:
            workspace = 6,
            /// TODO:
            git = 7,
            /// TODO:
            github = 8,

            pub fn isGitHubRepoPath(dependency: string) bool {
                var slash_count: u8 = 0;

                for (dependency) |c| {
                    slash_count += @as(u8, @boolToInt(c == '/'));
                    if (slash_count > 1 or c == '#') break;

                    // Must be alphanumeric
                    switch (c) {
                        '\\', '/', 'a'...'z', 'A'...'Z', '0'...'9', '%' => {},
                        else => return false,
                    }
                }

                return (slash_count == 1);
            }

            // this won't work for query string params
            // i'll let someone file an issue before I add that
            pub fn isTarball(dependency: string) bool {
                return strings.endsWithComptime(dependency, ".tgz") or strings.endsWithComptime(dependency, ".tar.gz");
            }

            pub fn infer(dependency: string) Tag {
                switch (dependency[0]) {
                    // npm package
                    '~', '0'...'9', '^', '*', '~', '|' => return Tag.npm,

                    // MIGHT be semver, might not be.
                    'x', 'X' => {
                        if (dependecy.len == 1) {
                            return Tag.npm;
                        }

                        if (dependency[1] == '.') {
                            return Tag.npm;
                        }

                        return .dist_tag;
                    },

                    // git://, git@, git+ssh
                    'g' => {
                        if (strings.eqlComptime(
                            dependency[0..@minimum("git://".len, dependency.len)],
                            "git://",
                        ) or strings.eqlComptime(
                            dependency[0..@minimum("git@".len, dependency.len)],
                            "git@",
                        ) or strings.eqlComptime(
                            dependency[0..@minimum("git+ssh".len, dependency.len)],
                            "git+ssh",
                        )) {
                            return .git;
                        }

                        if (strings.eqlComptime(
                            dependency[0..@minimum("github".len, dependency.len)],
                            "github",
                        ) or isGitHubRepoPath(dependency)) {
                            return .github;
                        }

                        return .dist_tag;
                    },

                    '/' => {
                        if (isTarball(dependency)) {
                            return .tarball;
                        }

                        return .folder;
                    },

                    // https://, http://
                    'h' => {
                        if (isTarball(dependency)) {
                            return .tarball;
                        }

                        var remainder = dependency;
                        if (strings.eqlComptime(
                            remainder[0..@minimum("https://".len, remainder.len)],
                            "https://",
                        )) {
                            remainder = remainder["https://".len..];
                        }

                        if (strings.eqlComptime(
                            remainder[0..@minimum("http://".len, remainder.len)],
                            "http://",
                        )) {
                            remainder = remainder["http://".len..];
                        }

                        if (strings.eqlComptime(
                            remainder[0..@minimum("github".len, remainder.len)],
                            "github",
                        ) or isGitHubRepoPath(remainder)) {
                            return .github;
                        }

                        return .dist_tag;
                    },

                    // file://
                    'f' => {
                        if (isTarball(dependency))
                            return .tarball;

                        if (strings.eqlComptime(
                            dependency[0..@minimum("file://".len, dependency.len)],
                            "file://",
                        )) {
                            return .folder;
                        }

                        if (isGitHubRepoPath(dependency)) {
                            return .github;
                        }

                        return .dist_tag;
                    },

                    // link://
                    'l' => {
                        if (isTarball(dependency))
                            return .tarball;

                        if (strings.eqlComptime(
                            dependency[0..@minimum("link://".len, dependency.len)],
                            "link://",
                        )) {
                            return .symlink;
                        }

                        if (isGitHubRepoPath(dependency)) {
                            return .github;
                        }

                        return .dist_tag;
                    },

                    // workspace://
                    'w' => {
                        if (strings.eqlComptime(
                            dependency[0..@minimum("workspace://".len, dependency.len)],
                            "workspace://",
                        )) {
                            return .workspace;
                        }

                        if (isTarball(dependency))
                            return .tarball;

                        if (isGitHubRepoPath(dependency)) {
                            return .github;
                        }

                        return .dist_tag;
                    },

                    else => {
                        if (isTarball(dependency))
                            return .tarball;

                        if (isGitHubRepoPath(dependency)) {
                            return .github;
                        }

                        return .dist_tag;
                    },
                }
            }
        };

        npm: Semver.Query.Group,
        dist_tag: string,
        tarball: URI,
        folder: string,

        /// Unsupported, but still parsed so an error can be thrown
        symlink: void,
        /// Unsupported, but still parsed so an error can be thrown
        workspace: void,
        /// Unsupported, but still parsed so an error can be thrown
        git: void,
        /// Unsupported, but still parsed so an error can be thrown
        github: void,
    };

    pub const List = std.MultiArrayList(Dependency);

    pub fn parse(allocator: *std.mem.Allocator, dependency_: string, log: *logger.Log) ?Version {
        const dependency = std.mem.trimLeft(u8, dependency_, " \t\n\r");

        if (dependency.len == 0) return null;

        const tag = Tag.infer(dependency);

        switch (tag) {
            .npm => {
                const version = Semver.Query.parse(allocator, dependency) catch |err| {
                    log.addErrorFmt(null, logger.Loc.Empty, allocator, "{s} parsing dependency \"{s}\"", .{ @errorName(err), dependency }) catch unreachable;
                    return null;
                };

                return Version{ .npm = version };
            },
            .dist_tag => {
                return Version{ .dist_tag = dependency };
            },
            .tarball => {
                if (strings.contains(dependency, "://")) {
                    if (strings.startsWith(dependency, "file://")) {
                        return Version{ .tarball = URI{ .local = dependency[7..] } };
                    } else if (strings.startsWith(dependency, "https://") or strings.startsWith(dependency, "http://")) {
                        return Version{ .tarball = URI{ .remote = dependency } };
                    } else {
                        log.addErrorFmt(null, logger.Loc.Empty, allocator, "invalid dependency \"{s}\"", .{dependency}) catch unreachable;
                        return null;
                    }
                }

                return Version{ .tarball = URI{ .local = dependency } };
            },
            .folder => {
                if (strings.contains(dependency, "://")) {
                    if (strings.startsWith(dependency, "file://")) {
                        return Version{ .folder = dependency[7..] };
                    }

                    log.addErrorFmt(null, logger.Loc.Empty, allocator, "Unsupported protocol {s}", .{dependency}) catch unreachable;
                    return null;
                }

                return Version{ .folder = dependency };
            },
            .symlink, .workspace, .git, .github => {
                log.addErrorFmt(null, logger.Loc.Empty, allocator, "Unsupported dependency type {s} for \"{s}\"", .{ @tagName(tag), dependency }) catch unreachable;
                return null;
            },
        }
    }
};

pub const Package = struct {
    name: string = "",
    version: Semver.Version = Semver.Version{},
    name_hash: u32 = 0,
    dependencies: Dependency.List = Dependency.List{},
    dev_dependencies: Dependency.List = Dependency.List{},
    peer_dependencies: Dependency.List = Dependency.List{},
    optional_dependencies: Dependency.List = Dependency.List{},

    npm_count: u32 = 0,

    pub const Features = struct {
        optional_dependencies: bool = false,
        dev_dependencies: bool = false,
        scripts: bool = false,
        peer_dependencies: bool = true,
        is_main: bool = false,
    };

    fn parseDependencyList(
        allocator: *std.mem.Allocator,
        package_id: DependencyRequest,
        log: *logger.Log,
        npm_count_: *u32,
        expr: JSAst.Expr,
    ) ?Dependency.List {
        if (expr.data != .e_object) return null;

        const properties = expr.data.e_object.properties;
        if (properties.len == 0) return null;

        var dependencies = Dependency.List{};
        dependencies.ensureTotalCapacity(allocator, properties.len) catch @panic("OOM while parsing dependencies?");

        var npm_count = npm_count_.*;
        defer npm_count_.* = npm_count;
        for (properties) |prop| {
            const name = prop.key.?.asString(allocator) orelse continue;
            const value = prop.value.?.asString(allocator) orelse continue;

            const version = Dependency.parse(allocator, value, log) orelse continue;
            const dependency = Dependency{
                .name = name,
                .name_hash = @truncate(u32, std.hash.Wyhash.hash(0, name)),
                .request = DependencyRequest{ .version = version, .from = package_id },
            };
            npm_count += @as(u32, @boolToInt(@enumToInt(dependency.version) > @enumToInt(Version.Tag.npm)));
            dependencies.appendAssumeCapacity(dependency);
        }
        return dependencies;
    }

    pub fn parse(
        package_id: PackageID,
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        source: logger.Source,
        comptime features: Features,
    ) !Package {
        var json = json_parser.ParseJSON(&source, log, allocator) catch |err| {
            if (Output.enable_ansi_colors) {
                log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }

            Output.panic("<r><red>{s}<r> parsing package.json for <b>\"{s}\"<r>", .{ @errorName(err), source.path.prettyDir() });
        };

        var package = Package{};

        if (json.asProperty("name")) |name_q| {
            if (name_q.expr.asString(allocator)) |name| {
                package.name = name;
            }
        }

        if (comptime !features.is_main) {
            if (json.asProperty("version")) |version_q| {
                if (version_q.expr.asString(allocator)) |version_str| {
                    const semver_version = Semver.Version.parse(allocator, version_str);

                    if (semver_version.valid) {
                        package.version = semver_version.version;
                    } else {
                        log.addErrorFmt(null, logger.Loc.Empty, allocator, "invalid version \"{s}\"", .{version_str}) catch unreachable;
                    }
                }
            }
        }

        if (json.asProperty("dependencies")) |dependencies_q| {
            package.dependencies = parseDependencyList(allocator, package_id, log, &package.npm_count, dependencies_q.expr) orelse Dependency.List{};
        }

        if (comptime features.dev_dependencies) {
            if (json.asProperty("devDependencies")) |dependencies_q| {
                package.dev_dependencies = parseDependencyList(allocator, package_id, log, &package.npm_count, dependencies_q.expr) orelse Dependency.List{};
            }
        }

        if (comptime features.optional_dependencies) {
            if (json.asProperty("optionalDependencies")) |dependencies_q| {
                package.optional_dependencies = parseDependencyList(allocator, package_id, log, &package.npm_count, dependencies_q.expr) orelse Dependency.List{};
            }
        }

        if (comptime features.peer_dependencies) {
            if (json.asProperty("peerDependencies")) |dependencies_q| {
                package.peer_dependencies = parseDependencyList(allocator, package_id, log, &package.npm_count, dependencies_q.expr) orelse Dependency.List{};
            }
        }

        if (comptime !features.is_main) {}

        return package;
    }
};

fn ObjectPool(comptime Type: type, comptime Init: (fn (allocator: *std.mem.Allocator) anyerror!Type)) type {
    return struct {
        const LinkedList = std.SinglyLinkedList(Type);
        var list: LinkedList = undefined;
        var loaded: bool = false;
        var lock: Lock = undefined;
        pub fn get(allocator: *std.mem.Allocator) *LinkedList.Node {
            if (loaded) {
                lock.lock();
                defer lock.unlock();
                if (list.popFirst()) |node| {
                    node.data.reset();
                    return node;
                }
            }

            var new_node = allocator.create(LinkedList.Node) catch unreachable;
            new_node.* = LinkedList.Node{
                .data = Init(
                    allocator,
                ) catch unreachable,
            };

            return new_node;
        }

        pub fn release(node: *LinkedList.Node) void {
            if (loaded) {
                lock.lock();
                defer lock.unlock();
                list.prepend(node);
                return;
            }

            list = LinkedList{ .first = node };
            loaded = true;
            lock = Lock.init();
        }
    };
}

const Npm = struct {
    pub const Registry = struct {
        url: URL = URL.parse("https://registry.npmjs.org/"),
        const JSONPool = ObjectPool(MutableString, MutableString.init2048);

        const default_headers_buf: string = "Acceptapplication/vnd.npm.install-v1+json";

        const PackageVersionResponse = union(Tag) {
            pub const Tag = enum {
                cached,
                fresh,
                not_found,
            };

            cached: void,
            fresh: PackageManifest,
            not_found: void,
        };

        pub fn getPackageMetadata(
            this: *Registry,
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            package_name: string,
            last_modified: []const u8,
            etag: []const u8,
        ) !PackageVersionResponse {
            var url_buf = try std.fmt.allocPrint(allocator, "{s}://{s}/{s}", .{ this.url.displayProtocol(), this.url.hostname, package_name });
            defer allocator.free(url_buf);

            var json_pooled = JSONPool.get(allocator);
            defer JSONPool.release(json_pooled);

            var header_builder = HTTPClient.HeaderBuilder{};

            if (last_modified.len != 0) {
                header_builder.count("If-Modified-Since", last_modified);
            }

            if (etag.len != 0) {
                header_builder.count("If-None-Match", etag);
            }

            if (header_builder.content.len > 0) {
                header_builder.count("Accept", "application/vnd.npm.install-v1+json");

                if (last_modified.len != 0) {
                    header_builder.append("If-Modified-Since", last_modified);
                }

                if (etag.len != 0) {
                    header_builder.append("If-None-Match", etag);
                }

                header_builder.append("Accept", "application/vnd.npm.install-v1+json");
            } else {
                try header_builder.entries.append(
                    allocator,
                    .{
                        .name = .{ .offset = 0, .length = @truncate(u32, "Accept".len) },
                        .value = .{ .offset = "Accept".len, .length = @truncate(u32, default_headers_buf.len - "Accept".len) },
                    },
                );
                header_builder.header_count = 1;
                header_builder.content = StringBuilder{ .ptr = @intToPtr([*]u8, @ptrToInt(std.mem.span(default_headers_buf).ptr)), .len = default_headers_buf.len, .cap = default_headers_buf.len };
            }

            var client = HTTPClient.init(allocator, .GET, URL.parse(url_buf), header_builder.entries, header_builder.content.ptr.?[0..header_builder.content.len]);

            var response = try client.send("", &json_pooled.data);

            switch (response.status_code) {
                429 => return error.TooManyRequests,
                404 => return PackageVersionResponse{ .not_found = .{} },
                500...599 => return error.HTTPInternalServerError,
                304 => return PackageVersionResponse{ .cached = .{} },
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

            var json_body = json_pooled.data.toOwnedSliceLeaky();

            JSAst.Expr.Data.Store.create(default_allocator);
            JSAst.Stmt.Data.Store.create(default_allocator);
            defer {
                JSAst.Expr.Data.Store.reset();
                JSAst.Stmt.Data.Store.reset();
            }

            if (try PackageManifest.parse(allocator, log, json_body, package_name, newly_last_modified, new_etag, 300)) |package| {
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

    // ~384 bytes each?
    pub const PackageVersion = extern struct {
        // 32 bytes each
        dependencies: ExternalStringMap = ExternalStringMap{},
        optional_dependencies: ExternalStringMap = ExternalStringMap{},
        bins: ExternalStringMap = ExternalStringMap{},

        // 24 bytes each
        integrity: ExternalString = ExternalString{},
        shasum: ExternalString = ExternalString{},
        bin_dir: ExternalString = ExternalString{},
        man_dir: ExternalString = ExternalString{},

        unpacked_size: u64 = 0,
        file_count: u64 = 0,

        os_matches: bool = true,
        cpu_matches: bool = true,

        loaded_dependencies: ?*Dependency.List = null,
        loaded_optional_dependencies: ?*Dependency.List = null,
    };

    const BigExternalString = Semver.BigExternalString;

    /// Efficient, serializable NPM package metadata
    /// All the "content" is stored in three separate arrays,
    /// Everything inside here is just pointers to one of the three arrays
    const NpmPackage = extern struct {
        name: ExternalString = ExternalString{},

        releases: ExternVersionMap = ExternVersionMap{},
        prereleases: ExternVersionMap = ExternVersionMap{},
        dist_tags: DistTagMap = DistTagMap{},

        /// "modified" in the JSON
        modified: ExternalString = ExternalString{},

        /// HTTP response headers
        last_modified: ExternalString = ExternalString{},
        etag: ExternalString = ExternalString{},
        public_max_age: u32 = 0,

        string_buf: BigExternalString = BigExternalString{},
        versions_buf: VersionSlice = VersionSlice{},
        string_lists_buf: ExternalStringList = ExternalStringList{},
    };

    const PackageManifest = struct {
        name: string,

        pkg: NpmPackage = NpmPackage{},

        string_buf: []const u8 = &[_]u8{},
        versions: []const Semver.Version = &[_]Semver.Version{},
        external_strings: []const ExternalString = &[_]ExternalString{},
        package_versions: []PackageVersion = &[_]PackageVersion{},

        pub fn str(self: *const PackageManifest, external: ExternalString) string {
            return external.slice(self.string_buf);
        }

        pub fn reportSize(this: *const PackageManifest) void {
            const versions = std.mem.sliceAsBytes(this.versions);
            const external_strings = std.mem.sliceAsBytes(this.external_strings);
            const package_versions = std.mem.sliceAsBytes(this.package_versions);
            const string_buf = std.mem.sliceAsBytes(this.string_buf);

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

        pub fn findBestVersion(this: *const PackageManifest, group: Semver.Query.Group) ?*PackageVersion {
            const left = group.head.head.range.left;
            // Fast path: exact version
            if (left.op == .eql) {
                if (!left.version.tag.hasPre()) {
                    return &this.pkg.releases.values.mut(this.package_versions)[this.pkg.releases.findKeyIndex(this.versions, left.version) orelse return null];
                } else {
                    return &this.pkg.prereleases.values.mut(this.package_versions)[this.pkg.prereleases.findKeyIndex(this.versions, left.version) orelse return null];
                }
            }

            // // For now, this is the dumb way
            // for (this.pkg.releases.keys) |version| {
            //     if (group.satisfies(version)) {
            //         return this.releases.getPtr(version);
            //     }
            // }

            // for (this.prereleases.keys()) |version| {
            //     if (group.satisfies(version)) {
            //         return this.prereleases.getPtr(version);
            //     }
            // }

            return null;
        }

        /// This parses [Abbreviated metadata](https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#abbreviated-metadata-format)
        pub fn parse(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            json_buffer: []const u8,
            expected_name: []const u8,
            etag: []const u8,
            last_modified: []const u8,
            public_max_age: u32,
        ) !?PackageManifest {
            const source = logger.Source.initPathString(expected_name, json_buffer);
            const json = json_parser.ParseJSON(&source, log, allocator) catch |err| {
                return null;
            };

            if (json.asProperty("error")) |error_q| {
                if (error_q.expr.asString(allocator)) |err| {
                    log.addErrorFmt(&source, logger.Loc.Empty, allocator, "npm error: {s}", .{err}) catch unreachable;
                    return null;
                }
            }

            var result = PackageManifest{
                .name = "",
            };

            var string_builder = StringBuilder{};
            string_builder.count(last_modified);
            string_builder.count(etag);

            if (json.asProperty("name")) |name_q| {
                const name = name_q.expr.asString(allocator) orelse return null;

                if (!strings.eql(name, expected_name)) {
                    Output.panic("<r>internal: <red>package name mismatch<r> expected <b>\"{s}\"<r> but received <red>\"{s}\"<r>", .{ expected_name, name });
                    return null;
                }

                string_builder.count(name);
            }

            if (json.asProperty("modified")) |name_q| {
                const name = name_q.expr.asString(allocator) orelse return null;

                string_builder.count(name);
            }

            var release_versions_len: usize = 0;
            var pre_versions_len: usize = 0;
            var dependency_sum: usize = 0;

            get_versions: {
                if (json.asProperty("versions")) |versions_q| {
                    if (versions_q.expr.data != .e_object) break :get_versions;

                    const versions = versions_q.expr.data.e_object.properties;

                    for (versions) |prop| {
                        const name = prop.key.?.asString(allocator) orelse continue;
                        if (std.mem.indexOfScalar(u8, name, '-') != null) {
                            pre_versions_len += 1;
                        } else {
                            release_versions_len += 1;
                        }

                        string_builder.count(name);

                        integrity: {
                            if (prop.value.?.asProperty("dist")) |dist| {
                                if (dist.expr.data == .e_object) {
                                    if (dist.expr.asProperty("integrity")) |shasum| {
                                        if (shasum.expr.asString(allocator)) |shasum_str| {
                                            string_builder.count(shasum_str);
                                            break :integrity;
                                        }
                                    }

                                    if (dist.expr.asProperty("shasum")) |shasum| {
                                        if (shasum.expr.asString(allocator)) |shasum_str| {
                                            string_builder.count(shasum_str);
                                        }
                                    }
                                }
                            }
                        }

                        if (prop.value.?.asProperty("dependencies")) |versioned_deps| {
                            if (versioned_deps.expr.data == .e_object) {
                                dependency_sum += versioned_deps.expr.data.e_object.properties.len;
                                const properties = versioned_deps.expr.data.e_object.properties;
                                for (properties) |property| {
                                    if (property.key.?.asString(allocator)) |key| {
                                        string_builder.count(key);
                                        string_builder.count(property.value.?.data.e_string.utf8);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            var extern_string_count: usize = dependency_sum * 2;

            if (json.asProperty("dist-tags")) |dist| {
                if (dist.expr.data == .e_object) {
                    const tags = dist.expr.data.e_object.properties;
                    for (tags) |tag| {
                        if (tag.key.?.asString(allocator)) |key| {
                            string_builder.count(key);
                            extern_string_count += 1;
                        }
                    }
                }
            }

            var versioned_packages = try allocator.alloc(PackageVersion, release_versions_len + pre_versions_len);
            std.mem.set(
                PackageVersion,
                versioned_packages,

                PackageVersion{},
            );
            var all_semver_versions = try allocator.alloc(Semver.Version, release_versions_len + pre_versions_len);
            std.mem.set(Semver.Version, all_semver_versions, Semver.Version{});
            var all_extern_strings = try allocator.alloc(ExternalString, extern_string_count);
            std.mem.set(
                ExternalString,
                all_extern_strings,

                ExternalString{},
            );
            var versioned_package_releases = versioned_packages[0..release_versions_len];
            var versioned_package_prereleases = versioned_packages[release_versions_len..][0..pre_versions_len];
            var all_release_versions = all_semver_versions[0..release_versions_len];
            var all_prerelease_versions = all_semver_versions[release_versions_len..][0..pre_versions_len];
            var release_versions = all_release_versions;
            var prerelease_versions = all_prerelease_versions;

            var extern_strings = all_extern_strings;
            try string_builder.allocate(allocator);
            var string_buf = string_builder.ptr.?[0..string_builder.cap];

            if (json.asProperty("name")) |name_q| {
                const name = name_q.expr.asString(allocator) orelse return null;
                result.name = string_builder.append(name);
                result.pkg.name = ExternalString.init(string_buf, result.name, std.hash.Wyhash.hash(0, name));
            }

            var unique_string_count: usize = 0;
            var unique_string_len: usize = 0;
            var string_slice = SlicedString.init(string_buf, string_buf);
            get_versions: {
                if (json.asProperty("versions")) |versions_q| {
                    if (versions_q.expr.data != .e_object) break :get_versions;

                    const versions = versions_q.expr.data.e_object.properties;

                    var all_dependency_names_and_values = all_extern_strings[0 .. dependency_sum * 2];

                    var dependency_names = all_dependency_names_and_values[0..dependency_sum];
                    var dependency_values = all_dependency_names_and_values[dependency_sum..];

                    var prev_names: []ExternalString = &[_]ExternalString{};
                    var prev_versions: []ExternalString = &[_]ExternalString{};
                    const DedupString = std.HashMap(
                        u64,
                        ExternalString,
                        struct {
                            pub fn hash(this: @This(), key: u64) u64 {
                                return key;
                            }
                            pub fn eql(this: @This(), a: u64, b: u64) bool {
                                return a == b;
                            }
                        },
                        80,
                    );
                    var deduper = DedupString.init(allocator);
                    defer deduper.deinit();

                    for (versions) |prop, version_i| {
                        const version_name = prop.key.?.asString(allocator) orelse continue;

                        const parsed_version = Semver.Version.parse(SlicedString.init(version_name, version_name), allocator);
                        std.debug.assert(parsed_version.valid);

                        if (!parsed_version.valid) {
                            log.addErrorFmt(&source, prop.value.?.loc, allocator, "Failed to parse dependency {s}", .{version_name}) catch unreachable;
                            continue;
                        }

                        var package_version = PackageVersion{};

                        var count: usize = 0;
                        const versioned_deps_ = prop.value.?.asProperty("dependencies");
                        const cpu_prop = prop.value.?.asProperty("cpu");
                        const os_prop = prop.value.?.asProperty("os");
                        if (versioned_deps_) |versioned_deps| {
                            if (versioned_deps.expr.data == .e_object) {
                                count = versioned_deps.expr.data.e_object.properties.len;
                            }
                        }

                        if (cpu_prop) |cpu| {
                            const CPU = comptime if (Environment.isAarch64) "arm64" else "x64";
                            package_version.cpu_matches = false;

                            switch (cpu.expr.data) {
                                .e_array => |arr| {
                                    for (arr.items) |item| {
                                        if (item.asString(allocator)) |cpu_str| {
                                            if (strings.eqlComptime(cpu_str, CPU)) {
                                                package_version.cpu_matches = true;
                                                break;
                                            }
                                        }
                                    }
                                },
                                .e_string => |str| {
                                    package_version.cpu_matches = strings.eql(str.utf8, CPU);
                                },
                                else => {},
                            }
                        }

                        if (os_prop) |os| {
                            // TODO: musl
                            const OS = comptime if (Environment.isLinux) "linux" else "darwin";
                            package_version.os_matches = false;

                            switch (os.expr.data) {
                                .e_array => |arr| {
                                    for (arr.items) |item| {
                                        if (item.asString(allocator)) |os_str| {
                                            if (strings.eqlComptime(os_str, OS)) {
                                                package_version.os_matches = true;
                                                break;
                                            }
                                        }
                                    }
                                },
                                .e_string => |str| {
                                    package_version.os_matches = strings.eql(str.utf8, OS);
                                },
                                else => {},
                            }
                        }

                        integrity: {
                            if (prop.value.?.asProperty("dist")) |dist| {
                                if (dist.expr.data == .e_object) {
                                    if (dist.expr.asProperty("fileCount")) |file_count_| {
                                        if (file_count_.expr.data == .e_number) {
                                            package_version.file_count = file_count_.expr.data.e_number.toU64();
                                        }
                                    }

                                    if (dist.expr.asProperty("unpackedSize")) |file_count_| {
                                        if (file_count_.expr.data == .e_number) {
                                            package_version.unpacked_size = file_count_.expr.data.e_number.toU64();
                                        }
                                    }

                                    if (dist.expr.asProperty("integrity")) |shasum| {
                                        if (shasum.expr.asString(allocator)) |shasum_str| {
                                            package_version.integrity = string_slice.sub(string_builder.append(shasum_str)).external();
                                            break :integrity;
                                        }
                                    }

                                    if (dist.expr.asProperty("shasum")) |shasum| {
                                        if (shasum.expr.asString(allocator)) |shasum_str| {
                                            package_version.shasum = string_slice.sub(string_builder.append(shasum_str)).external();
                                        }
                                    }
                                }
                            }
                        }
                        if (versioned_deps_) |versioned_deps| {
                            var this_names = dependency_names[0..count];
                            var this_versions = dependency_values[0..count];

                            const items = versioned_deps.expr.data.e_object.properties;
                            var any_differences = false;
                            for (items) |item, i| {

                                // Often, npm packages have the same dependency names/versions many times.
                                // This is a cheap way to usually dedup these dependencies.
                                const name_str = item.key.?.asString(allocator) orelse continue;
                                const version_str = item.value.?.asString(allocator) orelse continue;

                                const name_hash = std.hash.Wyhash.hash(0, name_str);
                                const version_hash = std.hash.Wyhash.hash(0, version_str);
                                var name_entry = try deduper.getOrPut(name_hash);
                                var version_entry = try deduper.getOrPut(version_hash);

                                unique_string_count += @as(usize, @boolToInt(!name_entry.found_existing)) + @as(usize, @boolToInt(!version_entry.found_existing));
                                unique_string_len += @as(usize, @boolToInt(!name_entry.found_existing) * name_str.len) + @as(usize, @boolToInt(!version_entry.found_existing) * version_str.len);

                                if (!name_entry.found_existing) {
                                    any_differences = true;
                                    this_names[i] = ExternalString.init(string_buf, string_builder.append(name_str), name_hash);
                                }

                                if (prev_versions.len > i) this_versions[i] = prev_versions[i];
                                if (!(prev_versions.len > i and prev_versions[i].hash == version_hash)) {
                                    any_differences = true;
                                    this_versions[i] = ExternalString.init(string_buf, string_builder.append(version_str), version_hash);
                                }

                                count = i;
                            }

                            this_names = this_names[0..count];
                            this_versions = this_versions[0..count];

                            if (any_differences) {
                                dependency_names = dependency_names[count..];
                                dependency_values = dependency_values[count..];
                            } else {
                                this_names = prev_names;
                                this_versions = prev_versions;
                            }

                            if (this_names.len > 0) {
                                package_version.dependencies = ExternalStringMap{
                                    .name = ExternalStringList.init(all_extern_strings, this_names),
                                    .value = ExternalStringList.init(all_extern_strings, this_versions),
                                };
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
                }
            }

            result.pkg.last_modified = string_slice.sub(string_builder.append(last_modified)).external();
            result.pkg.etag = string_slice.sub(string_builder.append(etag)).external();

            result.pkg.releases.keys.len = @truncate(u32, release_versions_len);
            result.pkg.releases.values.len = @truncate(u32, release_versions_len);

            result.pkg.prereleases.keys.off = result.pkg.releases.keys.len;
            result.pkg.prereleases.values.len = @truncate(u32, pre_versions_len);

            result.pkg.string_lists_buf.off = 0;
            result.pkg.string_lists_buf.len = @truncate(u32, all_extern_strings.len);

            result.pkg.versions_buf.off = 0;
            result.pkg.versions_buf.len = @truncate(u32, all_semver_versions.len);

            result.versions = all_semver_versions;
            result.external_strings = all_extern_strings;
            result.package_versions = versioned_packages;

            if (json.asProperty("modified")) |name_q| {
                const name = name_q.expr.asString(allocator) orelse return null;

                result.pkg.modified = string_slice.sub(string_builder.append(name)).external();
            }

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
};

pub const DownloadPackageManifestTask = struct {
    ctx: *PackageManager,
    name: string,

    task: ThreadPool.Task,

    pub fn download(task: *ThreadPool.Task) void {
        var this: *DownloadPackageManifestTask = @fieldParentPtr(DownloadPackageManifestTask, "task", task);
        defer {
            var node = @fieldParentPtr(Pool.LinkedList.Node, "data", this);
            this.name = "";
            Pool.release(node);
        }

        var log = logger.Log.init(this.ctx.allocator);
        defer if (log.msgs.items.len > 0) this.ctx.mergeLog(log);
        var package_manifest = this.ctx.registry.getPackageMetadata(this.ctx.allocator, &log, this.name, "", "") catch |err| {
            log.addErrorFmt(null, logger.Loc.Empty, this.ctx.allocator, "Error fetching package manifest: {s}", .{@errorName(err)}) catch unreachable;
            return;
        };
        switch (package_manifest) {
            .not_found => {
                log.addErrorFmt(null, logger.Loc.Empty, this.ctx.allocator, "Package not found: {s}", this.name);
                return;
            },
            .fresh => |resolved| {
                this.ctx.appendPackageResolution(resolved);
            },
            else => unreachable,
        }
    }

    pub fn initFn(allocator: *std.mem.Allocator) !DownloadPackageManifestTask {
        return DownloadPackageManifestTask{ .ctx = undefined, .name = "", .task = .{ .callback = download } };
    }

    pub const Pool = ObjectPool(DownloadPackageManifestTask, initFn);
};

const Task = union(Tag) {
    resolve: ResolveTask,
    install: InstallTask,

    pub const Tag = enum {
        resolve,
        install,
    };
};

pub const DependencyLevel = enum { dependency, dev, optional, peer };
pub const Dependents = std.EnumArray(DependencyLevel, std.ArrayListUnmanaged(PackageID));

pub const Installation = struct {
    tarball_path: string = "",
    cached_dir: string = "",
};

const PackageBlock = struct {
    pub const block_size = 256;
    items: [block_size]Package = undefined,
    dependents: [block_size]Dependents = undefined,
    installations: [block_size]Installation = undefined,
    next: std.atomic.Atomic(?*PackageBlock) = std.atomic.Atomic(?*PackageBlock).init(null),
    lock: Lock = Lock.init(),
    len: std.atomic.Atomic(u16) = std.atomic.Atomic(u16).init(0),

    pub fn append(this: *PackageBlock, package: Package) *Package {
        this.lock.lock();
        defer this.lock.unlock();
        const i = this.len.fetchAdd(1, .Monotonic);
        this.items[i] = package;
        this.dependents[i] = Dependents.initFill(std.ArrayListUnmanaged(PackageID){});
        return &this.items[i];
    }
};

const PackageList = struct {
    head: PackageBlock = PackageBlock{},
    tail: std.atomic.Atomic(?*PackageBlock) = std.atomic.Atomic(?*PackageBlock).init(null),
    allocator: *std.mem.Allocator = undefined,
    pub fn append(this: *PackageList, package: Package) !*Package {
        var block: *PackageBlock = this.tail.load(.Monotonic) orelse &this.head;
        std.debug.assert(block.next.load(.Monotonic) == null);

        if (block.len.fetchMin(PackageBlock.block_size, .Monotonic) >= PackageBlock.block_size) {
            block.lock.lock();
            defer block.lock.unlock();
            var tail = try this.allocator.create(PackageBlock);
            tail.* = PackageBlock{};
            tail.items[0] = package;
            tail.dependents[0] = Dependents.initFill(std.ArrayListUnmanaged(PackageID){});
            tail.len.storeUnchecked(1);
            block.next = tail;
            this.tail.store(tail, .Monotonic);
            return &tail.items[0];
        } else {
            return block.append(package);
        }
    }
};

const IdentityContext = struct {
    pub fn hash(this: @This(), key: u32) u64 {
        return key;
    }

    pub fn eql(this: @This(), a: u32, b: u32) bool {
        return a == b;
    }
};

const ArrayIdentityContext = struct {
    pub fn hash(this: @This(), key: u32) u32 {
        return key;
    }

    pub fn eql(this: @This(), a: u32, b: u32) bool {
        return a == b;
    }
};

const DependencyRequest = struct {
    version: Dependency.Version,
    from: PackageID = invalid_package_id,
    resolution: PackageID = invalid_package_id,
};

/// Versions & ranges to resolve for a package
/// A linked list so that we can append without allocating
/// We expect individual queues to not be 100s long, so it shouldn't be so bad to use pointers here
const ResolveQueue = std.SinglyLinkedList(*Dependency);
// Hash table mapping Manifest.name_hash to
const ResolveMap = std.ArrayHashMap(u32, ResolveQueue, ArrayIdentityContext, false);

const ThreadPool = @import("../thread_pool.zig");

// We can't know all the package s we need until we've downloaded all the packages
// The easy way wouild be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependnecies for resolution
// 2.
pub const PackageManager = struct {
    pub var package_list = PackageList{};

    enable_cache: bool = true,
    cache_directory_path: string = "",
    cache_directory: std.fs.Dir = undefined,
    root_dir: *Fs.FileSystem.DirEntry,
    env_loader: *DotEnv.Loader,
    allocator: *std.mem.Allocator,
    root_package: *Package,
    log: *logger.Log,

    default_features: Package.Features = Package.Features{},

    registry: Npm.Registry = Npm.Registry{},

    /// Tracks a list of packages we have already enqueued for downloading
    /// The key is Dependency.name_hash
    /// The queue for actually downloading is separate
    seen_npm_packages: PackageDedupeList = PackageDedupeList{},
    seen_npm_packages_lock: Lock = Lock.init(),

    seen_tarball_urls: PackageDedupeList = PackageDedupeList{},
    seen_tarball_urls_lock: Lock = Lock.init(),
    thread_pool: ThreadPool,

    manifests_lock: Lock = Lock.init(),
    manifests: PackageManifestMap = PackageManifestMap{},

    resolve_lock: Lock = Lock.init(),
    pending_resolve_queue: ResolveMap = ResolveMap{},
    pending_resolutions_count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),

    const PackageManifestMap = std.StringHashMapUnmanaged(Npm.PackageManifest);
    const PackageDedupeList = std.HashMapUnmanaged(
        u32,
        void,
        IdentityContext,
        80,
    );

    fn doesNeedToDownloadPackageManifest(this: *PackageManager, name_hash: u32) bool {
        return !this.seen_npm_packages.getOrPutAssumeCapacity(name_hash).found_existing;
    }

    inline fn enqueueNpmPackage(this: *PackageManager, batch: *ThreadPool.Batch, name: string) *DownloadPackageManifestTask {
        var node = DownloadPackageManifestTask.Pool.get(this.allocator);
        node.data.name = name;
        node.data.ctx = this;
        return node;
    }

    fn enqueuePackages(this: *PackageManager, dependencies: Dependency.List) ThreadPool.Batch {
        var batch = ThreadPool.Batch{};
        var count: u32 = 0;
        var slice = dependencies.unmanaged.entries.slice();
        const values = slice.items(.value);
        var i: usize = 0;
        var last_npm_package: ?*DownloadPackageManifestTask = null;
        while (i < values.len) : (i += 1) {
            const dependency: Dependency = values[i];
            switch (dependency.version) {
                .npm, .dist_tag => {
                    if (this.doesNeedToDownloadPackageManifest(dependency.name_hash)) {
                        var current = this.enqueueNpmPackage(dependency);
                        if (last_npm_package != null) {
                            batch.tail.?.node.next = &current.task.node;
                            batch.len += 1;
                        } else {
                            batch = ThreadPool.Batch.from(current);
                        }
                        if (verbose_install) {
                            Output.prettyErrorln("Enqueue dependency: {s}", .{dependency.name});
                        }
                        batch.tail = current;
                        last_npm_package = current;
                    }
                },
                else => {},
            }
        }

        if (verbose_install) Output.flush();

        return batch;
    }

    pub fn enqueueDependencyList(this: *PackageManager, package: *const Package, features: Package.Features) void {

        // Step 2. Allocate the list
        if (package.npm_count > 0) {
            this.seen_npm_packages_lock.lock();
            defer this.seen_npm_packages_lock.unlock();
            this.seen_npm_packages.ensureUnusedCapacity(package.npm_count) catch unreachable;
            var batch = this.enqueuePackages(package.dependencies);

            if (features.dev_dependencies) {
                batch = batch.push(this.enqueuePackages(package.dev_dependencies));
            }

            if (features.peer_dependencies) {
                batch = batch.push(this.enqueuePackages(package.peer_dependencies));
            }

            if (features.optional_dependencies) {
                batch = batch.push(this.enqueuePackages(package.optional_dependencies));
            }

            this.thread_pool.schedule(batch);
        }
    }

    pub fn appendPackageResolution(this: *PackageManager, manifest: Npm.PackageManifest) void {
        const name_hash = @truncate(u32, manifest.pkg.name.hash);
        {
            this.manifests_lock.lock();
            defer this.manifests_lock.unlock();

            this.manifests.getOrPutValue(this.allocator, name_hash, manifest) catch unreachable;
        }

        {
            this.resolve_lock.lock();
            defer this.resolve_lock.unlock();
            if (this.pending_resolve_queue.get(name_hash)) |pending| {
                while (pending.popFirst()) |semver_group| {}
            }
        }
    }

    pub fn fetchCacheDirectoryPath(
        allocator: *std.mem.Allocator,
        env_loader: *DotEnv.Loader,
        root_dir: *Fs.FileSystem.DirEntry,
    ) ?string {
        if (env_loader.map.get("BUN_INSTALL_CACHE_DIR")) |dir| {
            return dir;
        }

        if (env_loader.map.get("BUN_INSTALL")) |dir| {
            var parts = [_]string{ dir, "install/", "cache/" };
            return Fs.FileSystem.instance.joinBuf(&parts);
        }

        if (env_loader.map.get("HOME")) |dir| {
            var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
            return Fs.FileSystem.instance.joinBuf(&parts);
        }

        if (env_loader.map.get("XDG_CACHE_HOME")) |dir| {
            var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
            return Fs.FileSystem.instance.joinBuf(&parts);
        }

        return null;
    }

    fn loadAllDependencies(this: *PackageManager) !void {}
    fn installDependencies(this: *PackageManager) !void {}

    var cwd_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    var package_json_cwd_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    pub fn install(
        ctx: Command.Context,
    ) !void {
        var fs = try Fs.FileSystem.init1(ctx.allocator, null);
        var original_cwd = std.mem.trimRight(u8, fs.top_level_dir, "/");

        std.mem.copy(u8, &cwd_buf, original_cwd);

        // Step 1. Find the nearest package.json directory
        //
        // We will walk up from the cwd, calling chdir on each directory until we find a package.json
        // If we fail to find one, we will report an error saying no packages to install
        var package_json_file: std.fs.File = brk: {
            break :brk std.fs.cwd().openFileZ("package.json", .{ .read = true, .write = true }) catch |err2| {
                var this_cwd = original_cwd;
                outer: while (std.fs.path.dirname(this_cwd)) |parent| {
                    cwd_buf[parent.len + 1] = 0;
                    var chdir = cwd_buf[0..parent.len :0];

                    std.os.chdirZ(chdir) catch break :brk null;
                    std.fs.cwd().openFileZ("package.json", .{ .read = true, .write = true }) catch |err| {
                        this_cwd = parent;
                        continue :outer;
                    };
                }

                break :brk null;
            };
        } orelse {
            Output.prettyErrorln("<r><red>Missing package.json<r>! Nothing to install.", .{});
            Output.flush();
            return;
        };

        fs.top_level_dir = try std.os.getcwd(&cwd_buf);
        cwd_buf[fs.top_level_dir.len] = '/';
        cwd_buf[fs.top_level_dir.len + 1] = 0;
        fs.top_level_dir = cwd_buf[0 .. fs.top_level_dir.len + 1];
        std.mem.copy(u8, &package_json_cwd_buf, fs.top_level_dir);
        std.mem.copy(u8, package_json_cwd_buf[fs.top_level_dir.len..], "package.json");
        var package_json_contents = package_json_file.readToEndAlloc(ctx.allocator, std.math.maxInt(usize)) catch |err| {
            Output.prettyErrorln("<r><red>{s} reading package.json<r>!", .{@errorName(err)});
            Output.flush();
            return;
        };
        // Step 2. Parse the package.json file
        //
        var package_json_source = logger.Source.initPathString(
            package_json_cwd_buf[0 .. fs.top_level_dir.len + "package.json".len],
        );
        package_list.items[0] = try Package.parse(
            ctx.allocator,
            ctx.log,
            package_json_source,
            Package.Features{
                .optional_dependencies = true,
                .dev_dependencies = true,
                .is_main = true,
            },
        );
        var root = &package_list.items[0];
        package_list.len = 1;
        var env_loader: DotEnv.Loader = brk: {
            var map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            break :brk DotEnv.Loader.init(map, ctx.allocator);
        };

        var entries_option = try fs.fs.readDirectory(fs.top_Level_dir, std.fs.cwd());
        var enable_cache = false;
        var cache_directory_path: string = "";

        if (Install.fetchCacheDirectoryPath(ctx.allocator, env_loader, entries_option.dir)) |cache_dir_path| {
            enable_cache = true;
            cache_directory_path = try fs.dirname_store.append(@TypeOf(cache_dir_path), cache_dir_path);
        }

        if (verbose_install) {
            Output.prettyErrorln("Cache Dir: {s}", .{cache_directory_path});
            Output.flush();
        }

        var manager = PackageManager{
            .enable_cache = enable_cache,
            .cache_directory_path = cache_directory_path,
            .env_loader = env_loader,
            .allocator = ctx.allocator,
            .log = ctx.log,
            .root_dir = entries_option.dir,
            .root_package = root,
            .thread_pool = ThreadPool.init(.{}),
        };
        package_list.allocator = ctx.allocator;

        try manager.enqueueDependencyList(
            &package_list.items[0],
            Package.Features{
                .optional_dependencies = true,
                .dev_dependencies = true,
                .is_main = true,
            },
        );

        try manager.loadAllDependencies();
        try manager.installDependencies();
    }
};

const verbose_install = true;

test "getPackageMetadata" {
    Output.initTest();

    var registry = Npm.Registry{};
    var log = logger.Log.init(default_allocator);

    var response = try registry.getPackageMetadata(default_allocator, &log, "lodash", "", "");

    const react_17 = try Semver.Query.parse(default_allocator, "1.2.0");

    switch (response) {
        .cached, .not_found => unreachable,
        .fresh => |package| {
            package.reportSize();
            const react = package.findBestVersion(react_17) orelse unreachable;

            const entry = react.dependencies.name.get(package.external_strings)[0];
            // try std.testing.expectEqualStrings("loose-envify", entry.slice(package.string_buf));
        },
    }
}
