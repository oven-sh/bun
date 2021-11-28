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
const NetworkThread = @import("../http/network_thread.zig");
const AsyncHTTP = @import("../http/http_client_async.zig").AsyncHTTP;
const HTTPChannel = @import("../http/http_client_async.zig").HTTPChannel;

threadlocal var initialized_store = false;
pub fn initializeStore() void {
    if (initialized_store) {
        JSAst.Expr.Data.Store.reset();
        JSAst.Stmt.Data.Store.reset();
        return;
    }

    initialized_store = true;
    JSAst.Expr.Data.Store.create(default_allocator);
    JSAst.Stmt.Data.Store.create(default_allocator);
}

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

const StructBuilder = @import("../builder.zig");
const ExternalStringBuilder = StructBuilder.Builder(ExternalString);

pub fn ExternalSlice(comptime Type: type) type {
    return extern struct {
        const Slice = @This();

        off: u32 = 0,
        len: u32 = 0,

        pub inline fn get(this: Slice, in: []align(1) const Type) []align(1) const Type {
            return in[this.off..@minimum(in.len, this.off + this.len)];
        }

        pub inline fn mut(this: Slice, in: []align(1) Type) []align(1) Type {
            return in[this.off..@minimum(in.len, this.off + this.len)];
        }

        pub fn init(buf: []align(1) const Type, in: []align(1) const Type) Slice {
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

const NetworkTask = struct {
    http: AsyncHTTP = undefined,
    task_id: u64,
    url_buf: []const u8 = &[_]u8{},
    allocator: *std.mem.Allocator,
    request_buffer: MutableString = undefined,
    response_buffer: MutableString = undefined,
    callback: union(Task.Tag) {
        package_manifest: struct {
            loaded_manifest: ?Npm.PackageManifest = null,
            name: string,
        },
        extract: ExtractTarball,
    },

    pub fn notify(http: *AsyncHTTP) void {
        PackageManager.instance.network_channel.writeItem(@fieldParentPtr(NetworkTask, "http", http)) catch {};
    }

    const default_headers_buf: string = "Acceptapplication/vnd.npm.install-v1+json";
    pub fn forManifest(
        this: *NetworkTask,
        name: string,
        allocator: *std.mem.Allocator,
        registry_url: URL,
        loaded_manifest: ?Npm.PackageManifest,
    ) !void {
        this.url_buf = try std.fmt.allocPrint(allocator, "{s}://{s}/{s}", .{ registry_url.displayProtocol(), registry_url.hostname, name });
        var last_modified: string = "";
        var etag: string = "";
        if (loaded_manifest) |manifest| {
            last_modified = manifest.pkg.last_modified.slice(manifest.string_buf);
            etag = manifest.pkg.etag.slice(manifest.string_buf);
        }

        var header_builder = HTTPClient.HeaderBuilder{};

        if (etag.len != 0) {
            header_builder.count("If-None-Match", etag);
        } else if (last_modified.len != 0) {
            header_builder.count("If-Modified-Since", last_modified);
        }

        if (header_builder.header_count > 0) {
            header_builder.count("Accept", "application/vnd.npm.install-v1+json");
            if (last_modified.len > 0 and etag.len > 0) {
                header_builder.content.count(last_modified);
            }
            try header_builder.allocate(allocator);

            if (etag.len != 0) {
                header_builder.append("If-None-Match", etag);
            } else if (last_modified.len != 0) {
                header_builder.append("If-Modified-Since", last_modified);
            }

            header_builder.append("Accept", "application/vnd.npm.install-v1+json");

            if (last_modified.len > 0 and etag.len > 0) {
                last_modified = header_builder.content.append(last_modified);
            }
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

        this.request_buffer = try MutableString.init(allocator, 0);
        this.response_buffer = try MutableString.init(allocator, 0);
        this.allocator = allocator;
        this.http = try AsyncHTTP.init(
            allocator,
            .GET,
            URL.parse(this.url_buf),
            header_builder.entries,
            header_builder.content.ptr.?[0..header_builder.content.len],
            &this.response_buffer,
            &this.request_buffer,
            0,
        );
        this.callback = .{
            .package_manifest = .{
                .name = name,
                .loaded_manifest = loaded_manifest,
            },
        };

        if (verbose_install) {
            this.http.verbose = true;
            this.http.client.verbose = true;
        }

        // Incase the ETag causes invalidation, we fallback to the last modified date.
        if (last_modified.len != 0) {
            this.http.client.force_last_modified = true;
            this.http.client.if_modified_since = last_modified;
        }

        this.http.callback = notify;
    }

    pub fn schedule(this: *NetworkTask, batch: *ThreadPool.Batch) void {
        this.http.schedule(this.allocator, batch);
    }

    pub fn forTarball(
        this: *NetworkTask,
        allocator: *std.mem.Allocator,
        tarball: ExtractTarball,
    ) !void {
        this.url_buf = try ExtractTarball.buildURL(
            allocator,
            tarball.registry,
            tarball.name,
            tarball.version,
            tarball.package.string_buf,
        );

        this.request_buffer = try MutableString.init(allocator, 0);
        this.response_buffer = try MutableString.init(allocator, 0);
        this.allocator = allocator;

        this.http = try AsyncHTTP.init(
            allocator,
            .GET,
            URL.parse(this.url_buf),
            .{},
            "",
            &this.response_buffer,
            &this.request_buffer,
            0,
        );
        this.http.callback = notify;
        this.callback = .{ .extract = tarball };
    }
};

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
    version: Dependency.Version,
    from: PackageID = invalid_package_id,
    resolution: PackageID = invalid_package_id,
    required: bool = true,

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

            pub fn isNPM(this: Tag) bool {
                return @enumToInt(this) < 3;
            }

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
                    '=', '>', '<', '0'...'9', '^', '*', '~', '|' => return Tag.npm,

                    // MIGHT be semver, might not be.
                    'x', 'X' => {
                        if (dependency.len == 1) {
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

    pub const List = std.ArrayHashMapUnmanaged(u32, Dependency, ArrayIdentityContext, false);

    pub fn parse(
        allocator: *std.mem.Allocator,
        dependency_: string,
        sliced: SlicedString,
        log: *logger.Log,
    ) ?Version {
        const dependency = std.mem.trimLeft(u8, dependency_, " \t\n\r");

        if (dependency.len == 0) return null;
        const tag = Version.Tag.infer(dependency);
        switch (tag) {
            .npm => {
                const version = Semver.Query.parse(
                    allocator,
                    dependency,
                    sliced.sub(dependency),
                ) catch |err| {
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
                        return Version{ .tarball = URI{ .remote = URL.parse(dependency) } };
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
    id: PackageID,
    parent_id: PackageID = 0,

    name: string = "",
    version: Semver.Version = Semver.Version{},
    name_hash: u32 = 0,
    dependencies: Dependency.List = Dependency.List{},
    dev_dependencies: Dependency.List = Dependency.List{},
    peer_dependencies: Dependency.List = Dependency.List{},
    optional_dependencies: Dependency.List = Dependency.List{},

    is_main: bool = false,

    origin: Origin = Origin.npm,

    npm_count: u32 = 0,

    preinstall_state: PreinstallState = PreinstallState.unknown,
    string_buf: []const u8,
    cpu_matches: bool = true,
    os_matches: bool = true,

    const Version = Dependency.Version;

    pub fn isDisabled(this: *const Package) bool {
        return !this.cpu_matches or !this.os_matches;
    }

    pub fn fromNPM(
        allocator: *std.mem.Allocator,
        package_id: PackageID,
        log: *logger.Log,
        manifest: *const Npm.PackageManifest,
        version: Semver.Version,
        package_version: *align(1) const Npm.PackageVersion,
        features: Features,
        string_buf: []const u8,
    ) Package {
        var npm_count: u32 = 0;

        const dependencies = Package.createDependencyList(
            allocator,
            package_id,
            log,
            &npm_count,
            package_version.dependencies.name.get(manifest.external_strings),
            package_version.dependencies.value.get(manifest.external_strings),
            manifest.string_buf,
            true,
        ) orelse Dependency.List{};

        const optional_dependencies = if (features.optional_dependencies)
            Package.createDependencyList(
                allocator,
                package_id,
                log,
                &npm_count,
                package_version.optional_dependencies.name.get(manifest.external_strings),
                package_version.optional_dependencies.value.get(manifest.external_strings),
                manifest.string_buf,
                false,
            ) orelse Dependency.List{}
        else
            Dependency.List{};

        const peer_dependencies = if (features.peer_dependencies)
            Package.createDependencyList(
                allocator,
                package_id,
                log,
                &npm_count,
                package_version.peer_dependencies.name.get(manifest.external_strings),
                package_version.peer_dependencies.value.get(manifest.external_strings),
                manifest.string_buf,
                true,
            ) orelse Dependency.List{}
        else
            Dependency.List{};

        return Package{
            .id = package_id,
            .string_buf = string_buf,
            .name = manifest.name,
            .version = version,
            .dependencies = dependencies,
            .optional_dependencies = optional_dependencies,
            .peer_dependencies = peer_dependencies,
            .cpu_matches = package_version.cpu_matches,
            .os_matches = package_version.os_matches,
        };
    }

    fn createDependencyList(
        allocator: *std.mem.Allocator,
        package_id: PackageID,
        log: *logger.Log,
        npm_count_: *u32,
        names: []align(1) const ExternalString,
        values: []align(1) const ExternalString,
        string_buf: []const u8,
        required: bool,
    ) ?Dependency.List {
        if (names.len == 0 or names.len != values.len) return null;

        var dependencies = Dependency.List{};
        dependencies.ensureTotalCapacity(allocator, names.len) catch @panic("OOM while parsing dependencies?");

        var npm_count = npm_count_.*;
        defer npm_count_.* = npm_count;
        for (names) |name_, i| {
            const name = name_.slice(string_buf);
            const value = values[i].slice(string_buf);
            const version = Dependency.parse(
                allocator,
                value,
                SlicedString.init(value, value),
                log,
            ) orelse continue;

            const name_hash = @truncate(u32, std.hash.Wyhash.hash(0, name));
            const dependency = Dependency{
                .name = name,
                .name_hash = name_hash,
                .version = version,
                .from = package_id,
                .required = required,
            };
            var entry = dependencies.getOrPutAssumeCapacityContext(name_hash, ArrayIdentityContext{});

            entry.value_ptr.* = dependency;
            npm_count += @as(u32, @boolToInt(@enumToInt(dependency.version) > @enumToInt(Version.Tag.npm))) * @as(u32, @boolToInt(!entry.found_existing));
        }
        return dependencies;
    }

    pub const Origin = enum {
        local,
        npm,
        tarball,
    };

    pub const Features = struct {
        optional_dependencies: bool = false,
        dev_dependencies: bool = false,
        scripts: bool = false,
        peer_dependencies: bool = true,
        is_main: bool = false,
    };

    pub const PreinstallState = enum {
        unknown,
        done,
        extract,
        extracting,
    };

    pub fn determinePreinstallState(this: *Package, manager: *PackageManager) PreinstallState {
        switch (this.preinstall_state) {
            .unknown => {
                const folder_path = PackageManager.cachedNPMPackageFolderName(this.name, this.version);
                if (manager.isFolderInCache(folder_path)) {
                    this.preinstall_state = .done;
                    return this.preinstall_state;
                }

                this.preinstall_state = .extract;
                return this.preinstall_state;
            },
            else => return this.preinstall_state,
        }
    }

    pub fn hash(name: string, version: Semver.Version) u64 {
        var hasher = std.hash.Wyhash.init(0);
        hasher.update(name);
        hasher.update(std.mem.asBytes(&version));
        return hasher.final();
    }

    fn parseDependencyList(
        allocator: *std.mem.Allocator,
        string_builder: *StringBuilder,
        package_id: PackageID,
        log: *logger.Log,
        npm_count_: *u32,
        expr: JSAst.Expr,
        required: bool,
    ) ?Dependency.List {
        if (expr.data != .e_object) return null;

        const properties = expr.data.e_object.properties;
        if (properties.len == 0) return null;

        var dependencies = Dependency.List{};
        dependencies.ensureTotalCapacity(allocator, properties.len) catch @panic("OOM while parsing dependencies?");

        var npm_count = npm_count_.*;
        defer npm_count_.* = npm_count;
        for (properties) |prop| {
            const name = string_builder.append(prop.key.?.asString(allocator) orelse continue);
            const value = string_builder.append(prop.value.?.asString(allocator) orelse continue);
            const version = Dependency.parse(
                allocator,
                value,
                SlicedString.init(string_builder.ptr.?[0..string_builder.cap], value),
                log,
            ) orelse continue;

            const name_hash = @truncate(u32, std.hash.Wyhash.hash(0, name));
            const dependency = Dependency{
                .name = name,
                .name_hash = name_hash,
                .version = version,
                .from = package_id,
                .required = required,
            };
            var entry = dependencies.getOrPutAssumeCapacityContext(name_hash, ArrayIdentityContext{});

            entry.value_ptr.* = dependency;
            npm_count += @as(u32, @boolToInt(@enumToInt(dependency.version) > @enumToInt(Version.Tag.npm))) * @as(u32, @boolToInt(!entry.found_existing));
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
        initializeStore();

        var json = json_parser.ParseJSON(&source, log, allocator) catch |err| {
            if (Output.enable_ansi_colors) {
                log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }

            Output.panic("<r><red>{s}<r> parsing package.json for <b>\"{s}\"<r>", .{ @errorName(err), source.path.prettyDir() });
        };

        var string_builder: StringBuilder = StringBuilder{};

        var package = Package{
            .id = package_id,
            .origin = if (features.is_main) .local else .npm,
            .string_buf = "",
        };

        // -- Count the sizes
        if (json.asProperty("name")) |name_q| {
            if (name_q.expr.asString(allocator)) |name| {
                string_builder.count(name);
            }
        }

        if (comptime !features.is_main) {
            if (json.asProperty("version")) |version_q| {
                if (version_q.expr.asString(allocator)) |version_str| {
                    string_builder.count(version_str);
                }
            }
        }

        if (json.asProperty("dependencies")) |dependencies_q| {
            if (dependencies_q.expr.data == .e_object) {
                for (dependencies_q.expr.data.e_object.properties) |item| {
                    string_builder.count(item.key.?.asString(allocator) orelse "");
                    string_builder.count(item.value.?.asString(allocator) orelse "");
                }
            }
        }

        if (comptime features.dev_dependencies) {
            if (json.asProperty("devDependencies")) |dependencies_q| {
                if (dependencies_q.expr.data == .e_object) {
                    for (dependencies_q.expr.data.e_object.properties) |item| {
                        string_builder.count(item.key.?.asString(allocator) orelse "");
                        string_builder.count(item.value.?.asString(allocator) orelse "");
                    }
                }
            }
        }

        if (comptime features.optional_dependencies) {
            if (json.asProperty("optionalDependencies")) |dependencies_q| {
                if (dependencies_q.expr.data == .e_object) {
                    for (dependencies_q.expr.data.e_object.properties) |item| {
                        string_builder.count(item.key.?.asString(allocator) orelse "");
                        string_builder.count(item.value.?.asString(allocator) orelse "");
                    }
                }
            }
        }

        if (comptime features.peer_dependencies) {
            if (json.asProperty("peerDependencies")) |dependencies_q| {
                if (dependencies_q.expr.data == .e_object) {
                    for (dependencies_q.expr.data.e_object.properties) |item| {
                        string_builder.count(item.key.?.asString(allocator) orelse "");
                        string_builder.count(item.value.?.asString(allocator) orelse "");
                    }
                }
            }
        }

        try string_builder.allocate(allocator);

        if (comptime !features.is_main) {
            if (json.asProperty("version")) |version_q| {
                if (version_q.expr.asString(allocator)) |version_str_| {
                    const version_str = string_builder.append(version_str_);
                    const semver_version = Semver.Version.parse(version_str, allocator);

                    if (semver_version.valid) {
                        package.version = semver_version.version;
                    } else {
                        log.addErrorFmt(null, logger.Loc.Empty, allocator, "invalid version \"{s}\"", .{version_str}) catch unreachable;
                    }
                }
            }
        }

        if (json.asProperty("dependencies")) |dependencies_q| {
            package.dependencies = parseDependencyList(allocator, &string_builder, package_id, log, &package.npm_count, dependencies_q.expr, true) orelse Dependency.List{};
        }

        if (comptime features.dev_dependencies) {
            if (json.asProperty("devDependencies")) |dependencies_q| {
                package.dev_dependencies = parseDependencyList(allocator, &string_builder, package_id, log, &package.npm_count, dependencies_q.expr, true) orelse Dependency.List{};
            }
        }

        if (comptime features.optional_dependencies) {
            if (json.asProperty("optionalDependencies")) |dependencies_q| {
                package.optional_dependencies = parseDependencyList(allocator, &string_builder, package_id, log, &package.npm_count, dependencies_q.expr, false) orelse Dependency.List{};
            }
        }

        if (comptime features.peer_dependencies) {
            if (json.asProperty("peerDependencies")) |dependencies_q| {
                package.peer_dependencies = parseDependencyList(allocator, &string_builder, package_id, log, &package.npm_count, dependencies_q.expr, true) orelse Dependency.List{};
            }
        }

        if (comptime !features.is_main) {}
        if (string_builder.ptr) |ptr| {
            package.string_buf = ptr[0..string_builder.len];
        }

        return package;
    }
};

fn ObjectPool(comptime Type: type, comptime Init: (fn (allocator: *std.mem.Allocator) anyerror!Type)) type {
    return struct {
        const LinkedList = std.SinglyLinkedList(Type);
        // mimalloc crashes on realloc across threads
        threadlocal var list: LinkedList = undefined;
        threadlocal var loaded: bool = false;
        pub fn get(allocator: *std.mem.Allocator) *LinkedList.Node {
            if (loaded) {
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
                list.prepend(node);
                return;
            }

            list = LinkedList{ .first = node };
            loaded = true;
        }
    };
}

const Npm = struct {
    pub const Registry = struct {
        url: URL = URL.parse("https://registry.npmjs.org/"),
        pub const BodyPool = ObjectPool(MutableString, MutableString.init2048);

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
            allocator: *std.mem.Allocator,
            response: Pico.Response,
            body: []const u8,
            log: *logger.Log,
            package_name: string,
            loaded_manifest: ?PackageManifest,
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

            JSAst.Expr.Data.Store.create(default_allocator);
            JSAst.Stmt.Data.Store.create(default_allocator);
            defer {
                JSAst.Expr.Data.Store.reset();
                JSAst.Stmt.Data.Store.reset();
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
                if (PackageManager.instance.enable_manifest_cache) {
                    var tmpdir = Fs.FileSystem.instance.tmpdir();

                    PackageManifest.Serializer.save(&package, tmpdir, PackageManager.instance.cache_directory) catch {};
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

        pub fn findKeyIndex(this: ExternVersionMap, buf: []align(1) const Semver.Version, find: Semver.Version) ?u32 {
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
        peer_dependencies: ExternalStringMap = ExternalStringMap{},
        bins: ExternalStringMap = ExternalStringMap{},

        // 24 bytes each
        integrity: ExternalString = ExternalString{},
        shasum: ExternalString = ExternalString{},
        bin_dir: ExternalString = ExternalString{},
        man_dir: ExternalString = ExternalString{},

        unpacked_size: u32 = 0,
        file_count: u32 = 0,

        os_matches: bool = true,
        cpu_matches: bool = true,
    };

    const BigExternalString = Semver.BigExternalString;

    /// Efficient, serializable NPM package metadata
    /// All the "content" is stored in three separate arrays,
    /// Everything inside here is just pointers to one of the three arrays
    const NpmPackage = extern struct {
        name: ExternalString = ExternalString{},
        /// HTTP response headers
        last_modified: ExternalString = ExternalString{},
        etag: ExternalString = ExternalString{},

        /// "modified" in the JSON
        modified: ExternalString = ExternalString{},

        releases: ExternVersionMap = ExternVersionMap{},
        prereleases: ExternVersionMap = ExternVersionMap{},
        dist_tags: DistTagMap = DistTagMap{},

        versions_buf: VersionSlice = VersionSlice{},
        string_lists_buf: ExternalStringList = ExternalStringList{},
        string_buf: BigExternalString = BigExternalString{},
        public_max_age: u32 = 0,
    };

    const PackageManifest = struct {
        name: string,

        pkg: NpmPackage = NpmPackage{},

        string_buf: []const u8 = &[_]u8{},
        versions: []align(1) const Semver.Version = &[_]Semver.Version{},
        external_strings: []align(1) const ExternalString = &[_]ExternalString{},
        package_versions: []align(1) const PackageVersion = &[_]PackageVersion{},

        pub const Serializer = struct {
            pub const version = "bun-npm-manifest-cache-v0.0.1\n";
            const header_bytes: string = "#!/usr/bin/env bun\n" ++ version;

            pub fn writeArray(comptime Writer: type, writer: Writer, comptime Type: type, array: []align(1) const Type, pos: *u64) !void {
                const bytes = std.mem.sliceAsBytes(array);
                if (bytes.len == 0) {
                    try writer.writeIntNative(u64, 0);
                    pos.* += 8;
                    return;
                }

                try writer.writeAll(std.mem.asBytes(&array.len));
                pos.* += 8;
                try writer.writeAll(
                    bytes,
                );
                pos.* += bytes.len;
            }

            pub fn readArray(stream: *std.io.FixedBufferStream([]const u8), comptime Type: type) ![]align(1) const Type {
                var reader = stream.reader();
                const len = try reader.readIntNative(u64);
                if (len == 0) {
                    return &[_]Type{};
                }
                const result = @ptrCast([*]align(1) const Type, &stream.buffer[stream.pos])[0..len];
                stream.pos += std.mem.sliceAsBytes(result).len;
                return result;
            }

            pub fn write(this: *const PackageManifest, comptime Writer: type, writer: Writer) !void {
                var pos: u64 = 0;
                try writer.writeAll(header_bytes);
                pos += header_bytes.len;

                // try writer.writeAll(&std.mem.zeroes([header_bytes.len % @alignOf(NpmPackage)]u8));

                // package metadata first
                try writer.writeAll(std.mem.asBytes(&this.pkg));
                pos += std.mem.asBytes(&this.pkg).len;

                try writeArray(Writer, writer, PackageVersion, this.package_versions, &pos);
                try writeArray(Writer, writer, Semver.Version, this.versions, &pos);
                try writeArray(Writer, writer, ExternalString, this.external_strings, &pos);

                // strings
                try writer.writeAll(std.mem.asBytes(&this.string_buf.len));
                if (this.string_buf.len > 0) try writer.writeAll(this.string_buf);
            }

            pub fn save(this: *const PackageManifest, tmpdir: std.fs.Dir, cache_dir: std.fs.Dir) !void {
                const file_id = std.hash.Wyhash.hash(0, this.name);
                var dest_path_buf: [512 + 64]u8 = undefined;
                var out_path_buf: ["-18446744073709551615".len + ".npm".len + 1]u8 = undefined;
                var dest_path_stream = std.io.fixedBufferStream(&dest_path_buf);
                var dest_path_stream_writer = dest_path_stream.writer();
                try dest_path_stream_writer.print("{x}.npm-{x}", .{ file_id, @maximum(std.time.milliTimestamp(), 0) });
                try dest_path_stream_writer.writeByte(0);
                var tmp_path: [:0]u8 = dest_path_buf[0 .. dest_path_stream.pos - 1 :0];
                {
                    var tmpfile = try tmpdir.createFileZ(tmp_path, .{
                        .truncate = true,
                    });
                    var writer = tmpfile.writer();
                    try Serializer.write(this, @TypeOf(writer), writer);
                    tmpfile.close();
                }

                var out_path = std.fmt.bufPrintZ(&out_path_buf, "{x}.npm", .{file_id}) catch unreachable;
                try std.os.renameatZ(tmpdir.fd, tmp_path, cache_dir.fd, out_path);
            }

            pub fn load(allocator: *std.mem.Allocator, cache_dir: std.fs.Dir, package_name: string) !?PackageManifest {
                const file_id = std.hash.Wyhash.hash(0, package_name);
                var file_path_buf: [512 + 64]u8 = undefined;
                var file_path = try std.fmt.bufPrintZ(&file_path_buf, "{x}.npm", .{file_id});
                var cache_file = cache_dir.openFileZ(
                    file_path,
                    .{
                        .read = true,
                    },
                ) catch return null;
                var timer: std.time.Timer = undefined;
                if (verbose_install) {
                    timer = std.time.Timer.start() catch @panic("timer fail");
                }
                defer cache_file.close();
                var bytes = try cache_file.readToEndAlloc(allocator, std.math.maxInt(u32));
                errdefer allocator.free(bytes);
                if (bytes.len < header_bytes.len) return null;
                const result = try readAll(bytes);
                if (verbose_install) {
                    Output.prettyError("\n ", .{});
                    Output.printTimer(&timer);
                    Output.prettyErrorln("<d> [cache hit] {s}<r>", .{package_name});
                }
                return result;
            }

            pub fn readAll(bytes: []const u8) !PackageManifest {
                var remaining = bytes;
                if (!strings.eqlComptime(bytes[0..header_bytes.len], header_bytes)) {
                    return error.InvalidPackageManifest;
                }
                remaining = remaining[header_bytes.len..];
                var pkg_stream = std.io.fixedBufferStream(remaining);
                var pkg_reader = pkg_stream.reader();
                var package_manifest = PackageManifest{
                    .name = "",
                    .pkg = try pkg_reader.readStruct(NpmPackage),
                };

                package_manifest.package_versions = try readArray(&pkg_stream, PackageVersion);
                package_manifest.versions = try readArray(&pkg_stream, Semver.Version);
                package_manifest.external_strings = try readArray(&pkg_stream, ExternalString);

                {
                    const len = try pkg_reader.readIntNative(u64);
                    const start = pkg_stream.pos;
                    pkg_stream.pos += len;
                    if (len > 0) package_manifest.string_buf = remaining[start .. start + len];
                }

                package_manifest.name = package_manifest.pkg.name.slice(package_manifest.string_buf);

                return package_manifest;
            }
        };

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

        pub const FindResult = struct {
            version: Semver.Version,
            package: *align(1) const PackageVersion,
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

        /// This parses [Abbreviated metadata](https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#abbreviated-metadata-format)
        pub fn parse(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            json_buffer: []const u8,
            expected_name: []const u8,
            last_modified: []const u8,
            etag: []const u8,
            public_max_age: u32,
        ) !?PackageManifest {
            const source = logger.Source.initPathString(expected_name, json_buffer);
            initializeStore();
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
            get_versions: {
                if (json.asProperty("versions")) |versions_q| {
                    if (versions_q.expr.data != .e_object) break :get_versions;

                    const versions = versions_q.expr.data.e_object.properties;
                    for (versions) |prop| {
                        const name = prop.key.?.asString(allocator) orelse continue;

                        if (std.mem.indexOfScalar(u8, name, '-') != null) {
                            pre_versions_len += 1;
                            extern_string_count += 1;
                        } else {
                            extern_string_count += @as(usize, @boolToInt(std.mem.indexOfScalar(u8, name, '+') != null));
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

                        inline for (dependency_groups) |pair| {
                            if (prop.value.?.asProperty(pair.prop)) |versioned_deps| {
                                if (versioned_deps.expr.data == .e_object) {
                                    dependency_sum += versioned_deps.expr.data.e_object.properties.len;
                                    const properties = versioned_deps.expr.data.e_object.properties;
                                    for (properties) |property| {
                                        if (property.key.?.asString(allocator)) |key| {
                                            string_builder.count(key);
                                            string_builder.cap += property.value.?.data.e_string.len();
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            extern_string_count += dependency_sum * 2;

            var dist_tags_count: usize = 0;
            if (json.asProperty("dist-tags")) |dist| {
                if (dist.expr.data == .e_object) {
                    const tags = dist.expr.data.e_object.properties;
                    for (tags) |tag| {
                        if (tag.key.?.asString(allocator)) |key| {
                            string_builder.count(key);
                            extern_string_count += 2;

                            string_builder.cap += (tag.value.?.asString(allocator) orelse "").len;
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

            var versioned_packages = try allocator.allocAdvanced(PackageVersion, 1, release_versions_len + pre_versions_len, .exact);
            var all_semver_versions = try allocator.allocAdvanced(Semver.Version, 1, release_versions_len + pre_versions_len + dist_tags_count, .exact);
            var all_extern_strings = try allocator.allocAdvanced(ExternalString, 1, extern_string_count, .exact);

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
            string_builder.cap += 1;
            try string_builder.allocate(allocator);

            var string_buf: string = "";
            if (string_builder.ptr) |ptr| {
                // 0 it out for better determinism
                @memset(ptr, 0, string_builder.cap);

                string_buf = ptr[0..string_builder.cap];
            }

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

                    const DedupString = std.StringArrayHashMap(
                        ExternalString,
                    );
                    var deduper = DedupString.init(allocator);
                    defer deduper.deinit();

                    for (versions) |prop, version_i| {
                        const version_name = prop.key.?.asString(allocator) orelse continue;

                        var sliced_string = SlicedString.init(version_name, version_name);

                        // We only need to copy the version tags if it's a pre/post
                        if (std.mem.indexOfAny(u8, version_name, "-+") != null) {
                            sliced_string = SlicedString.init(string_buf, string_builder.append(version_name));
                        }

                        const parsed_version = Semver.Version.parse(sliced_string, allocator);
                        std.debug.assert(parsed_version.valid);

                        if (!parsed_version.valid) {
                            log.addErrorFmt(&source, prop.value.?.loc, allocator, "Failed to parse dependency {s}", .{version_name}) catch unreachable;
                            continue;
                        }

                        var package_version = PackageVersion{};

                        const cpu_prop = prop.value.?.asProperty("cpu");
                        const os_prop = prop.value.?.asProperty("os");

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

                        inline for (dependency_groups) |pair| {
                            if (prop.value.?.asProperty(comptime pair.prop)) |versioned_deps| {
                                const items = versioned_deps.expr.data.e_object.properties;
                                var count = items.len;

                                var this_names = dependency_names[0..count];
                                var this_versions = dependency_values[0..count];

                                var i: usize = 0;
                                for (items) |item| {
                                    const name_str = item.key.?.asString(allocator) orelse if (comptime isDebug or isTest) unreachable else continue;
                                    const version_str = item.value.?.asString(allocator) orelse if (comptime isDebug or isTest) unreachable else continue;

                                    var name_entry = try deduper.getOrPut(name_str);
                                    var version_entry = try deduper.getOrPut(version_str);

                                    unique_string_count += @as(usize, @boolToInt(!name_entry.found_existing)) + @as(usize, @boolToInt(!version_entry.found_existing));
                                    unique_string_len += @as(usize, @boolToInt(!name_entry.found_existing) * name_str.len) + @as(usize, @boolToInt(!version_entry.found_existing) * version_str.len);

                                    // if (!name_entry.found_existing) {
                                    const name_hash = std.hash.Wyhash.hash(0, name_str);
                                    name_entry.value_ptr.* = ExternalString.init(string_buf, string_builder.append(name_str), name_hash);
                                    // }

                                    // if (!version_entry.found_existing) {
                                    const version_hash = std.hash.Wyhash.hash(0, version_str);
                                    version_entry.value_ptr.* = ExternalString.init(string_buf, string_builder.append(version_str), version_hash);
                                    // }

                                    this_versions[i] = version_entry.value_ptr.*;
                                    this_names[i] = name_entry.value_ptr.*;

                                    i += 1;
                                }
                                count = i;

                                this_names = this_names[0..count];
                                this_versions = this_versions[0..count];

                                dependency_names = dependency_names[count..];
                                dependency_values = dependency_values[count..];

                                @field(package_version, pair.field) = ExternalStringMap{
                                    .name = ExternalStringList.init(all_extern_strings, this_names),
                                    .value = ExternalStringList.init(all_extern_strings, this_versions),
                                };

                                if (comptime isDebug or isTest) {
                                    const dependencies_list = @field(package_version, pair.field);

                                    std.debug.assert(dependencies_list.name.off < all_extern_strings.len);
                                    std.debug.assert(dependencies_list.value.off < all_extern_strings.len);
                                    std.debug.assert(dependencies_list.name.off + dependencies_list.name.len < all_extern_strings.len);
                                    std.debug.assert(dependencies_list.value.off + dependencies_list.value.len < all_extern_strings.len);

                                    std.debug.assert(std.meta.eql(dependencies_list.name.get(all_extern_strings), this_names));
                                    std.debug.assert(std.meta.eql(dependencies_list.value.get(all_extern_strings), this_versions));
                                    var j: usize = 0;
                                    const name_dependencies = dependencies_list.name.get(all_extern_strings);
                                    while (j < name_dependencies.len) : (j += 1) {
                                        const name = name_dependencies[j];
                                        std.debug.assert(std.mem.eql(u8, name.slice(string_buf), this_names[j].slice(string_buf)));
                                        std.debug.assert(std.mem.eql(u8, name.slice(string_buf), items[j].key.?.asString(allocator).?));
                                    }

                                    j = 0;
                                    while (j < dependencies_list.value.len) : (j += 1) {
                                        const name = dependencies_list.value.get(all_extern_strings)[j];

                                        std.debug.assert(std.mem.eql(u8, name.slice(string_buf), this_versions[j].slice(string_buf)));
                                        std.debug.assert(std.mem.eql(u8, name.slice(string_buf), items[j].value.?.asString(allocator).?));
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

                    extern_strings = all_extern_strings[all_dependency_names_and_values.len..];
                }
            }

            if (last_modified.len > 0) {
                result.pkg.last_modified = string_slice.sub(string_builder.append(last_modified)).external();
            }

            if (etag.len > 0) {
                result.pkg.etag = string_slice.sub(string_builder.append(etag)).external();
            }

            if (json.asProperty("dist-tags")) |dist| {
                if (dist.expr.data == .e_object) {
                    const tags = dist.expr.data.e_object.properties;
                    var extern_strings_slice = extern_strings[0..dist_tags_count];
                    var dist_tag_i: usize = 0;

                    for (tags) |tag, i| {
                        if (tag.key.?.asString(allocator)) |key| {
                            extern_strings_slice[dist_tag_i] = SlicedString.init(string_buf, string_builder.append(key)).external();

                            const version_name = tag.value.?.asString(allocator) orelse continue;

                            const sliced_string = SlicedString.init(string_buf, string_builder.append(version_name));
                            dist_tag_versions[dist_tag_i] = Semver.Version.parse(sliced_string, allocator).version;
                            dist_tag_i += 1;
                        }
                    }

                    result.pkg.dist_tags = DistTagMap{
                        .tags = ExternalStringList.init(all_extern_strings, extern_strings_slice[0..dist_tag_i]),
                        .versions = VersionSlice.init(all_semver_versions, dist_tag_versions[0..dist_tag_i]),
                    };

                    if (isDebug) {
                        std.debug.assert(std.meta.eql(result.pkg.dist_tags.versions.get(all_semver_versions), dist_tag_versions[0..dist_tag_i]));
                        std.debug.assert(std.meta.eql(result.pkg.dist_tags.tags.get(all_extern_strings), extern_strings_slice[0..dist_tag_i]));
                    }

                    extern_strings = extern_strings[dist_tag_i..];
                }
            }

            if (json.asProperty("modified")) |name_q| {
                const name = name_q.expr.asString(allocator) orelse return null;

                result.pkg.modified = string_slice.sub(string_builder.append(name)).external();
            }

            result.pkg.releases.keys = VersionSlice.init(all_semver_versions, all_release_versions);
            result.pkg.releases.values = PackageVersionList.init(versioned_packages, all_versioned_package_releases);

            result.pkg.prereleases.keys = VersionSlice.init(all_semver_versions, all_prerelease_versions);
            result.pkg.prereleases.values = PackageVersionList.init(versioned_packages, all_versioned_package_prereleases);

            result.pkg.string_lists_buf.off = 0;
            result.pkg.string_lists_buf.len = @truncate(u32, all_extern_strings.len);

            result.pkg.versions_buf.off = 0;
            result.pkg.versions_buf.len = @truncate(u32, all_semver_versions.len);

            result.versions = all_semver_versions;
            result.external_strings = all_extern_strings;
            result.package_versions = versioned_packages;
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
};

pub const DependencyLevel = enum { dependency, dev, optional, peer };
pub const Dependents = std.EnumArray(DependencyLevel, std.ArrayListUnmanaged(PackageID));

pub const Download = struct {
    tarball_path: string,
};

const PackageBlock = struct {
    pub const block_size = 256;
    items: [block_size]Package = undefined,
    dependents: [block_size]Dependents = undefined,
    downloads: [block_size]Download = undefined,
    len: u16 = 0,

    pub fn append(this: *PackageBlock, package: Package) *Package {
        // this.lock.lock();
        // defer this.lock.unlock();
        const i = this.len;
        this.len += 1;
        this.items[i] = package;
        this.dependents[i] = Dependents.initFill(std.ArrayListUnmanaged(PackageID){});
        return &this.items[i];
    }
};

const PackageList = struct {
    head: PackageBlock = PackageBlock{},
    blocks: [PackageBlock.block_size]*PackageBlock = undefined,
    block_i: usize = 0,

    allocator: *std.mem.Allocator = undefined,

    pub fn at(this: *PackageList, index: PackageID) ?*Package {
        if (index == invalid_package_id) return null;

        const block_id = index >> 8;
        std.debug.assert(this.block_i >= block_id);
        return if (block_id == 0)
            &this.head.items[index]
        else
            &this.blocks[block_id].items[index % comptime (PackageBlock.block_size - 1)];
    }
    pub fn append(this: *PackageList, package: Package) !*Package {
        var block: *PackageBlock = this.blocks[this.block_i];

        if (block.len >= PackageBlock.block_size) {
            // block.lock.lock();
            // defer block.lock.unlock();
            var tail = try this.allocator.create(PackageBlock);
            tail.* = PackageBlock{};
            tail.items[0] = package;
            tail.dependents[0] = Dependents.initFill(std.ArrayListUnmanaged(PackageID){});
            tail.len = 1;
            this.block_i += 1;
            this.blocks[this.block_i] = tail;

            return &tail.items[0];
        } else {
            return block.append(package);
        }
    }

    pub fn reserveOne(this: *PackageList) !PackageID {
        var block: *PackageBlock = this.blocks[this.block_i];

        if (block.len >= PackageBlock.block_size) {
            // block.lock.lock();
            // defer block.lock.unlock();
            var tail = try this.allocator.create(PackageBlock);
            tail.* = PackageBlock{};
            tail.items[0] = undefined;
            tail.dependents[0] = Dependents.initFill(std.ArrayListUnmanaged(PackageID){});
            tail.len = 1;
            this.block_i += 1;
            this.blocks[this.block_i] = tail;
            const result = this.block_i << 8;
            return @truncate(u32, result);
        } else {
            const result = @truncate(PackageID, @as(usize, block.len) + (this.block_i << 8));
            block.len += 1;
            return result;
        }
    }
};

pub fn IdentityContext(comptime Key: type) type {
    return struct {
        pub fn hash(this: @This(), key: Key) u64 {
            return key;
        }

        pub fn eql(this: @This(), a: Key, b: Key) bool {
            return a == b;
        }
    };
}

const ArrayIdentityContext = struct {
    pub fn hash(this: @This(), key: u32) u32 {
        return key;
    }

    pub fn eql(this: @This(), a: u32, b: u32) bool {
        return a == b;
    }
};

const ExtractTarball = struct {
    name: string,
    version: Semver.Version,
    registry: string,
    cache_dir: string,
    package: *Package,
    extracted_file_count: usize = 0,

    pub inline fn run(this: ExtractTarball, bytes: []const u8) !string {
        return this.extract(bytes);
    }

    fn buildURL(allocator: *std.mem.Allocator, registry_: string, full_name: string, version: Semver.Version, string_buf: []const u8) !string {
        const registry = std.mem.trimRight(u8, registry_, "/");

        var name = full_name;
        if (name[0] == '@') {
            if (std.mem.indexOfScalar(u8, name, '/')) |i| {
                name = name[i + 1 ..];
            }
        }

        const default_format = "{s}/{s}/-/";

        if (!version.tag.hasPre() and !version.tag.hasBuild()) {
            return try std.fmt.allocPrint(
                allocator,
                default_format ++ "{s}-{d}.{d}.{d}.tgz",
                .{ registry, full_name, name, version.major, version.minor, version.patch },
            );
            // TODO: tarball URLs for build/pre
        } else if (version.tag.hasPre() and version.tag.hasBuild()) {
            return try std.fmt.allocPrint(
                allocator,
                default_format ++ "{s}-{d}.{d}.{d}-{s}+{s}.tgz",
                .{ registry, full_name, name, version.major, version.minor, version.patch, version.tag.pre.slice(string_buf), version.tag.build.slice(string_buf) },
            );
            // TODO: tarball URLs for build/pre
        } else if (version.tag.hasPre()) {
            return try std.fmt.allocPrint(
                allocator,
                default_format ++ "{s}-{d}.{d}.{d}-{s}.tgz",
                .{ registry, full_name, name, version.major, version.minor, version.patch, version.tag.pre.slice(string_buf) },
            );
            // TODO: tarball URLs for build/pre
        } else if (version.tag.hasBuild()) {
            return try std.fmt.allocPrint(
                allocator,
                default_format ++ "{s}-{d}.{d}.{d}+{s}.tgz",
                .{ registry, full_name, name, version.major, version.minor, version.patch, version.tag.build.slice(string_buf) },
            );
        } else {
            unreachable;
        }
    }

    fn download(this: *const ExtractTarball, body: *MutableString) !void {
        var url_str = try buildURL(default_allocator, this.registry, this.name, this.version, this.package.string_buf);
        defer default_allocator.free(url_str);
        var client = HTTPClient.init(default_allocator, .GET, URL.parse(url_str), .{}, "");

        if (verbose_install) {
            Output.prettyErrorln("<d>[{s}] GET - {s} 1/2<r>", .{ this.name, url_str });
            Output.flush();
        }

        const response = try client.send("", body);

        if (verbose_install) {
            Output.prettyErrorln("[{s}] {d} GET {s}<r>", .{ this.name, response.status_code, url_str });
            Output.flush();
        }

        switch (response.status_code) {
            200 => {},
            else => return error.HTTPError,
        }
    }

    threadlocal var abs_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    threadlocal var abs_buf2: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    fn extract(this: *const ExtractTarball, tgz_bytes: []const u8) !string {
        var tmpdir = Fs.FileSystem.instance.tmpdir();
        var tmpname_buf: [128]u8 = undefined;

        var basename = this.name;
        if (basename[0] == '@') {
            if (std.mem.indexOfScalar(u8, basename, '/')) |i| {
                basename = basename[i + 1 ..];
            }
        }

        var tmpname = try Fs.FileSystem.instance.tmpname(basename, &tmpname_buf, tgz_bytes.len);

        var cache_dir = tmpdir.makeOpenPath(std.mem.span(tmpname), .{ .iterate = true }) catch |err| {
            Output.panic("err: {s} when create temporary directory named {s} (while extracting {s})", .{ @errorName(err), tmpname, this.name });
        };
        var temp_destination = std.os.getFdPath(cache_dir.fd, &abs_buf) catch |err| {
            Output.panic("err: {s} when resolve path for temporary directory named {s} (while extracting {s})", .{ @errorName(err), tmpname, this.name });
        };
        cache_dir.close();

        if (verbose_install) {
            Output.prettyErrorln("[{s}] Start extracting {s}<r>", .{ this.name, tmpname });
            Output.flush();
        }

        const Archive = @import("../libarchive/libarchive.zig").Archive;
        const Zlib = @import("../zlib.zig");
        var zlib_pool = Npm.Registry.BodyPool.get(default_allocator);
        zlib_pool.data.reset();
        defer Npm.Registry.BodyPool.release(zlib_pool);

        var zlib_entry = try Zlib.ZlibReaderArrayList.init(tgz_bytes, &zlib_pool.data.list, default_allocator);
        zlib_entry.readAll() catch |err| {
            Output.prettyErrorln(
                "<r><red>Error {s}<r> decompressing {s}",
                .{
                    @errorName(err),
                    this.name,
                },
            );
            Output.flush();
            Global.crash();
        };
        const extracted_file_count = try Archive.extractToDisk(
            zlib_pool.data.list.items,
            temp_destination,
            null,
            void,
            void{},
            // for npm packages, the root dir is always "package"
            1,
            true,
            verbose_install,
        );

        if (extracted_file_count != this.extracted_file_count) {
            Output.prettyErrorln(
                "[{s}] <red>Extracted file count mismatch<r>:\n    Expected: <b>{d}<r>\n    Received: <b>{d}<r>",
                .{
                    this.name,
                    this.extracted_file_count,
                    extracted_file_count,
                },
            );
        }

        if (verbose_install) {
            Output.prettyErrorln(
                "[{s}] Extracted<r>",
                .{
                    this.name,
                },
            );
            Output.flush();
        }

        var folder_name = PackageManager.cachedNPMPackageFolderNamePrint(&abs_buf2, this.name, this.version);
        if (folder_name.len == 0 or (folder_name.len == 1 and folder_name[0] == '/')) @panic("Tried to delete root and stopped it");
        PackageManager.instance.cache_directory.deleteTree(folder_name) catch {};

        // e.g. @next
        // if it's a namespace package, we need to make sure the @name folder exists
        if (basename.len != this.name.len) {
            PackageManager.instance.cache_directory.makeDir(std.mem.trim(u8, this.name[0 .. this.name.len - basename.len], "/")) catch {};
        }

        // Now that we've extracted the archive, we rename.
        std.os.renameatZ(tmpdir.fd, tmpname, PackageManager.instance.cache_directory.fd, folder_name) catch |err| {
            Output.prettyErrorln(
                "<r><red>Error {s}<r> moving {s} to cache dir:\n   From: {s}    To: {s}",
                .{
                    @errorName(err),
                    this.name,
                    tmpname,
                    folder_name,
                },
            );
            Output.flush();
            Global.crash();
        };

        // We return a resolved absolute absolute file path to the cache dir.
        // To get that directory, we open the directory again.
        var final_dir = PackageManager.instance.cache_directory.openDirZ(folder_name, .{ .iterate = true }) catch |err| {
            Output.prettyErrorln(
                "<r><red>Error {s}<r> failed to verify cache dir for {s}",
                .{
                    @errorName(err),
                    this.name,
                },
            );
            Output.flush();
            Global.crash();
        };
        defer final_dir.close();
        // and get the fd path
        var final_path = std.os.getFdPath(
            final_dir.fd,
            &abs_buf,
        ) catch |err| {
            Output.prettyErrorln(
                "<r><red>Error {s}<r> failed to verify cache dir for {s}",
                .{
                    @errorName(err),
                    this.name,
                },
            );
            Output.flush();
            Global.crash();
        };
        return try Fs.FileSystem.instance.dirname_store.append(@TypeOf(final_path), final_path);
    }
};

/// Schedule long-running callbacks for a task
/// Slow stuff is broken into tasks, each can run independently without locks
const Task = struct {
    tag: Tag,
    request: Request,
    data: Data,
    status: Status = Status.waiting,
    threadpool_task: ThreadPool.Task = ThreadPool.Task{ .callback = callback },
    log: logger.Log,
    id: u64,

    /// An ID that lets us register a callback without keeping the same pointer around
    pub const Id = packed struct {
        tag: Task.Tag,
        bytes: u60 = 0,

        pub fn forPackage(tag: Task.Tag, package_name: string, package_version: Semver.Version) u64 {
            var hasher = std.hash.Wyhash.init(0);
            hasher.update(package_name);
            hasher.update("@");
            hasher.update(std.mem.asBytes(&package_version));
            return @bitCast(u64, Task.Id{ .tag = tag, .bytes = @truncate(u60, hasher.final()) });
        }

        pub fn forManifest(
            tag: Task.Tag,
            name: string,
        ) u64 {
            return @bitCast(u64, Task.Id{ .tag = tag, .bytes = @truncate(u60, std.hash.Wyhash.hash(0, name)) });
        }
    };

    pub fn callback(task: *ThreadPool.Task) void {
        Output.Source.configureThread();
        defer Output.flush();

        var this = @fieldParentPtr(Task, "threadpool_task", task);

        switch (this.tag) {
            .package_manifest => {
                var allocator = PackageManager.instance.allocator;

                const package_manifest = Npm.Registry.getPackageMetadata(
                    allocator,
                    this.request.package_manifest.network.http.response.?,
                    this.request.package_manifest.network.response_buffer.toOwnedSliceLeaky(),
                    &this.log,
                    this.request.package_manifest.name,
                    this.request.package_manifest.network.callback.package_manifest.loaded_manifest,
                ) catch |err| {
                    this.status = Status.fail;
                    PackageManager.instance.resolve_tasks.writeItem(this.*) catch unreachable;
                    return;
                };

                this.data = .{ .package_manifest = .{ .name = "" } };

                switch (package_manifest) {
                    .cached => unreachable,
                    .fresh => |manifest| {
                        this.data = .{ .package_manifest = manifest };
                        this.status = Status.success;
                        PackageManager.instance.resolve_tasks.writeItem(this.*) catch unreachable;
                        return;
                    },
                    .not_found => {
                        this.log.addErrorFmt(null, logger.Loc.Empty, allocator, "404 - GET {s}", .{this.request.package_manifest.name}) catch unreachable;
                        this.status = Status.fail;
                        PackageManager.instance.resolve_tasks.writeItem(this.*) catch unreachable;
                        return;
                    },
                }
            },
            .extract => {
                const result = this.request.extract.tarball.run(
                    this.request.extract.network.response_buffer.toOwnedSliceLeaky(),
                ) catch |err| {
                    this.status = Status.fail;
                    this.data = .{ .extract = "" };
                    PackageManager.instance.resolve_tasks.writeItem(this.*) catch unreachable;
                    return;
                };

                this.data = .{ .extract = result };
                this.status = Status.success;
                PackageManager.instance.resolve_tasks.writeItem(this.*) catch unreachable;
            },
        }
    }

    pub const Tag = enum(u4) {
        package_manifest = 1,
        extract = 2,
    };

    pub const Status = enum {
        waiting,
        success,
        fail,
    };

    pub const Data = union {
        package_manifest: Npm.PackageManifest,
        extract: string,
    };

    pub const Request = union {
        /// package name
        // todo: Registry URL
        package_manifest: struct {
            name: string,
            network: *NetworkTask,
        },
        extract: struct {
            network: *NetworkTask,
            tarball: ExtractTarball,
        },
    };
};

const TaggedPointer = @import("../tagged_pointer.zig");
const TaskCallbackContext = TaggedPointer.TaggedPointerUnion(.{
    Dependency,
    Package,
});

const TaskCallbackList = std.ArrayListUnmanaged(TaskCallbackContext);
const TaskDependencyQueue = std.HashMapUnmanaged(u64, TaskCallbackList, IdentityContext(u64), 80);
const TaskChannel = sync.Channel(Task, .{ .Static = 4096 });
const NetworkChannel = sync.Channel(*NetworkTask, .{ .Static = 8192 });
const ThreadPool = @import("../thread_pool.zig");

pub const CacheLevel = struct {
    use_cache_control_headers: bool,
    use_etag: bool,
    use_last_modified: bool,
};

// We can't know all the package s we need until we've downloaded all the packages
// The easy way wouild be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependnecies for resolution
// 2.
pub const PackageManager = struct {
    enable_cache: bool = true,
    enable_manifest_cache: bool = true,
    enable_manifest_cache_public: bool = true,
    cache_directory_path: string = "",
    cache_directory: std.fs.Dir = undefined,
    root_dir: *Fs.FileSystem.DirEntry,
    env_loader: *DotEnv.Loader,
    allocator: *std.mem.Allocator,
    root_package: *Package,
    log: *logger.Log,
    resolve_tasks: TaskChannel,

    default_features: Package.Features = Package.Features{},

    registry: Npm.Registry = Npm.Registry{},

    thread_pool: ThreadPool,

    manifests: PackageManifestMap = PackageManifestMap{},
    resolved_package_index: PackageIndex = PackageIndex{},

    task_queue: TaskDependencyQueue = TaskDependencyQueue{},
    network_task_queue: NetworkTaskQueue = .{},
    network_channel: NetworkChannel = NetworkChannel.init(),
    network_tarball_batch: ThreadPool.Batch = ThreadPool.Batch{},
    network_resolve_batch: ThreadPool.Batch = ThreadPool.Batch{},
    preallocated_network_tasks: PreallocatedNetworkTasks = PreallocatedNetworkTasks{ .buffer = undefined, .len = 0 },
    pending_tasks: u32 = 0,
    total_tasks: u32 = 0,

    pub var package_list = PackageList{};
    const PreallocatedNetworkTasks = std.BoundedArray(NetworkTask, 1024);
    const NetworkTaskQueue = std.HashMapUnmanaged(u64, void, IdentityContext(u64), 80);
    const PackageIndex = std.AutoHashMapUnmanaged(u64, *Package);
    const PackageManifestMap = std.HashMapUnmanaged(u32, Npm.PackageManifest, IdentityContext(u32), 80);
    const PackageDedupeList = std.HashMapUnmanaged(
        u32,
        void,
        IdentityContext(u32),
        80,
    );

    var cached_package_folder_name_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    pub var instance: PackageManager = undefined;

    pub fn getNetworkTask(this: *PackageManager) *NetworkTask {
        if (this.preallocated_network_tasks.len + 1 < this.preallocated_network_tasks.buffer.len) {
            const len = this.preallocated_network_tasks.len;
            this.preallocated_network_tasks.len += 1;
            return &this.preallocated_network_tasks.buffer[len];
        }

        return this.allocator.create(NetworkTask) catch @panic("Memory allocation failure creating NetworkTask!");
    }

    // TODO: normalize to alphanumeric
    pub fn cachedNPMPackageFolderName(name: string, version: Semver.Version) stringZ {
        return cachedNPMPackageFolderNamePrint(&cached_package_folder_name_buf, name, version);
    }

    // TODO: normalize to alphanumeric
    pub fn cachedNPMPackageFolderNamePrint(buf: []u8, name: string, version: Semver.Version) stringZ {
        if (!version.tag.hasPre() and !version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(buf, "{s}@{d}.{d}.{d}", .{ name, version.major, version.minor, version.patch }) catch unreachable;
        } else if (version.tag.hasPre() and version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}-{x}+{X}",
                .{ name, version.major, version.minor, version.patch, version.tag.pre.hash, version.tag.build.hash },
            ) catch unreachable;
        } else if (version.tag.hasPre()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}-{x}",
                .{ name, version.major, version.minor, version.patch, version.tag.pre.hash },
            ) catch unreachable;
        } else if (version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}+{X}",
                .{ name, version.major, version.minor, version.patch, version.tag.build.hash },
            ) catch unreachable;
        } else {
            unreachable;
        }

        unreachable;
    }

    pub fn isFolderInCache(this: *PackageManager, folder_path: stringZ) bool {
        // TODO: is this slow?
        var dir = this.cache_directory.openDirZ(folder_path, .{ .iterate = true }) catch return false;
        dir.close();
        return true;
    }

    const ResolvedPackageResult = struct {
        package: *Package,

        /// Is this the first time we've seen this package?
        is_first_time: bool = false,

        /// Pending network task to schedule
        network_task: ?*NetworkTask = null,
    };

    pub fn getOrPutResolvedPackageWithFindResult(
        this: *PackageManager,
        name_hash: u32,
        name: string,
        version: Dependency.Version,
        resolution: *PackageID,
        manifest: *const Npm.PackageManifest,
        find_result: Npm.PackageManifest.FindResult,
    ) !?ResolvedPackageResult {
        var resolved_package_entry = try this.resolved_package_index.getOrPut(this.allocator, Package.hash(name, find_result.version));

        // Was this package already allocated? Let's reuse the existing one.
        if (resolved_package_entry.found_existing) {
            var existing = resolved_package_entry.value_ptr.*;
            resolution.* = existing.id;
            // package_list.
            return ResolvedPackageResult{ .package = existing };
        }

        const id = package_list.reserveOne() catch unreachable;
        resolution.* = id;
        var ptr = package_list.at(id).?;
        ptr.* = Package.fromNPM(
            this.allocator,
            id,
            this.log,
            manifest,
            find_result.version,
            find_result.package,
            this.default_features,
            manifest.string_buf,
        );
        resolved_package_entry.value_ptr.* = ptr;

        switch (ptr.determinePreinstallState(this)) {
            // Is this package already in the cache?
            // We don't need to download the tarball, but we should enqueue dependencies
            .done => {
                return ResolvedPackageResult{ .package = ptr, .is_first_time = true };
            },

            // Do we need to download the tarball?
            .extract => {
                const task_id = Task.Id.forPackage(Task.Tag.extract, ptr.name, ptr.version);
                const dedupe_entry = try this.network_task_queue.getOrPut(this.allocator, task_id);

                // Assert that we don't end up downloading the tarball twice.
                std.debug.assert(!dedupe_entry.found_existing);
                var network_task = this.getNetworkTask();
                network_task.* = NetworkTask{
                    .task_id = task_id,
                    .callback = undefined,
                    .allocator = this.allocator,
                };

                try network_task.forTarball(
                    this.allocator,
                    ExtractTarball{
                        .name = name,
                        .version = ptr.version,
                        .cache_dir = this.cache_directory_path,
                        .registry = this.registry.url.href,
                        .package = ptr,
                        .extracted_file_count = find_result.package.file_count,
                    },
                );

                return ResolvedPackageResult{
                    .package = ptr,
                    .is_first_time = true,
                    .network_task = network_task,
                };
            },
            else => unreachable,
        }

        return ResolvedPackageResult{ .package = ptr };
    }

    pub fn getOrPutResolvedPackage(
        this: *PackageManager,
        name_hash: u32,
        name: string,
        version: Dependency.Version,
        resolution: *PackageID,
    ) !?ResolvedPackageResult {
        // Have we already resolved this package?
        if (package_list.at(resolution.*)) |pkg| {
            return ResolvedPackageResult{ .package = pkg };
        }

        switch (version) {
            .npm, .dist_tag => {
                // Resolve the version from the loaded NPM manifest
                const manifest = this.manifests.getPtr(name_hash) orelse return null; // manifest might still be downloading. This feels unreliable.
                const find_result: Npm.PackageManifest.FindResult = switch (version) {
                    .dist_tag => manifest.findByDistTag(version.dist_tag),
                    .npm => manifest.findBestVersion(version.npm),
                    else => unreachable,
                } orelse return switch (version) {
                    .npm => error.NoMatchingVersion,
                    .dist_tag => error.DistTagNotFound,
                    else => unreachable,
                };

                return try getOrPutResolvedPackageWithFindResult(this, name_hash, name, version, resolution, manifest, find_result);
            },

            else => return null,
        }
    }

    pub fn resolvePackageFromManifest(
        this: *PackageManager,
        semver: Semver.Version,
        version: *const Npm.PackageVersion,
        manifest: *const Npm.PackageManifest,
    ) !void {}

    fn enqueueParseNPMPackage(
        this: *PackageManager,
        task_id: u64,
        name: string,
        network_task: *NetworkTask,
    ) *ThreadPool.Task {
        var task = this.allocator.create(Task) catch unreachable;
        task.* = Task{
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.package_manifest,
            .request = .{
                .package_manifest = .{
                    .network = network_task,
                    .name = name,
                },
            },
            .id = task_id,
            .data = undefined,
        };
        return &task.threadpool_task;
    }

    fn enqueueExtractNPMPackage(
        this: *PackageManager,
        tarball: ExtractTarball,
        network_task: *NetworkTask,
    ) *ThreadPool.Task {
        var task = this.allocator.create(Task) catch unreachable;
        task.* = Task{
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.extract,
            .request = .{
                .extract = .{
                    .network = network_task,
                    .tarball = tarball,
                },
            },
            .id = network_task.task_id,
            .data = undefined,
        };
        return &task.threadpool_task;
    }

    fn enqueueDependency(this: *PackageManager, dependency: *Dependency, required: bool) !?ThreadPool.Batch {
        const name = dependency.name;
        const name_hash = dependency.name_hash;
        const version: Dependency.Version = dependency.version;
        var batch = ThreadPool.Batch{};
        var loaded_manifest: ?Npm.PackageManifest = null;

        switch (dependency.version) {
            .npm, .dist_tag => {
                retry_from_manifests_ptr: while (true) {
                    var resolve_result_ = this.getOrPutResolvedPackage(name_hash, name, version, &dependency.resolution);

                    retry_with_new_resolve_result: while (true) {
                        const resolve_result = resolve_result_ catch |err| {
                            switch (err) {
                                error.DistTagNotFound => {
                                    if (required) {
                                        this.log.addErrorFmt(
                                            null,
                                            logger.Loc.Empty,
                                            this.allocator,
                                            "Package \"{s}\" with tag \"{s}\" not found, but package exists",
                                            .{
                                                name,
                                                version.dist_tag,
                                            },
                                        ) catch unreachable;
                                    }

                                    return null;
                                },
                                error.NoMatchingVersion => {
                                    if (required) {
                                        this.log.addErrorFmt(
                                            null,
                                            logger.Loc.Empty,
                                            this.allocator,
                                            "No version matching \"{s}\" found for package {s} (but package exists)",
                                            .{
                                                version.npm.input,
                                                name,
                                            },
                                        ) catch unreachable;
                                    }
                                    return null;
                                },
                                else => return err,
                            }
                        };

                        if (resolve_result) |result| {
                            if (result.package.isDisabled()) return null;

                            // First time?
                            if (result.is_first_time) {
                                if (verbose_install) {
                                    const label: string = switch (version) {
                                        .npm => version.npm.input,
                                        .dist_tag => version.dist_tag,
                                        else => unreachable,
                                    };

                                    Output.prettyErrorln("   -> \"{s}\": \"{s}\" -> {s}@{}", .{
                                        result.package.name,
                                        label,
                                        result.package.name,
                                        result.package.version.fmt(result.package.string_buf),
                                    });
                                }
                                // Resolve dependencies first
                                batch.push(this.enqueuePackages(result.package.dependencies, true));
                                if (this.default_features.peer_dependencies) batch.push(this.enqueuePackages(result.package.peer_dependencies, true));
                                if (this.default_features.optional_dependencies) batch.push(this.enqueuePackages(result.package.optional_dependencies, false));
                            }

                            if (result.network_task) |network_task| {
                                if (result.package.preinstall_state == .extract) {
                                    Output.prettyErrorln("  ↓📦 {s}@{}", .{
                                        result.package.name,
                                        result.package.version.fmt(result.package.string_buf),
                                    });
                                    result.package.preinstall_state = .extracting;
                                    network_task.schedule(&this.network_tarball_batch);
                                }
                            }

                            if (batch.len > 0) {
                                return batch;
                            }
                        } else {
                            const task_id = Task.Id.forManifest(Task.Tag.package_manifest, name);
                            var network_entry = try this.network_task_queue.getOrPutContext(this.allocator, task_id, .{});
                            if (!network_entry.found_existing) {
                                if (this.enable_manifest_cache) {
                                    if (Npm.PackageManifest.Serializer.load(this.allocator, this.cache_directory, name) catch null) |manifest_| {
                                        const manifest: Npm.PackageManifest = manifest_;
                                        loaded_manifest = manifest;

                                        if (this.enable_manifest_cache_public and manifest.pkg.public_max_age > @truncate(u32, @intCast(u64, @maximum(std.time.timestamp(), 0)))) {
                                            try this.manifests.put(this.allocator, @truncate(u32, manifest.pkg.name.hash), manifest);
                                        }

                                        // If it's an exact package version already living in the cache
                                        // We can skip the network request, even if it's beyond the caching period
                                        if (dependency.version == .npm and dependency.version.npm.isExact()) {
                                            if (loaded_manifest.?.findByVersion(dependency.version.npm.head.head.range.left.version)) |find_result| {
                                                if (this.getOrPutResolvedPackageWithFindResult(
                                                    name_hash,
                                                    name,
                                                    version,
                                                    &dependency.resolution,
                                                    &loaded_manifest.?,
                                                    find_result,
                                                ) catch null) |new_resolve_result| {
                                                    resolve_result_ = new_resolve_result;
                                                    _ = this.network_task_queue.remove(task_id);
                                                    continue :retry_with_new_resolve_result;
                                                }
                                            }
                                        }

                                        // Was it recent enough to just load it without the network call?
                                        if (this.enable_manifest_cache_public and manifest.pkg.public_max_age > @truncate(u32, @intCast(u64, @maximum(std.time.timestamp(), 0)))) {
                                            _ = this.network_task_queue.remove(task_id);
                                            continue :retry_from_manifests_ptr;
                                        }
                                    }
                                }

                                if (verbose_install) {
                                    Output.prettyErrorln("Enqueue package manifest for download: {s}", .{name});
                                }

                                var network_task = this.getNetworkTask();
                                network_task.* = NetworkTask{
                                    .callback = undefined,
                                    .task_id = task_id,
                                    .allocator = this.allocator,
                                };
                                try network_task.forManifest(name, this.allocator, this.registry.url, loaded_manifest);
                                network_task.schedule(&this.network_resolve_batch);
                            }

                            var manifest_entry_parse = try this.task_queue.getOrPutContext(this.allocator, task_id, .{});
                            if (!manifest_entry_parse.found_existing) {
                                manifest_entry_parse.value_ptr.* = TaskCallbackList{};
                            }

                            try manifest_entry_parse.value_ptr.append(this.allocator, TaskCallbackContext.init(dependency));
                        }

                        return null;
                    }
                }
            },
            else => {},
        }
        return null;
    }

    fn enqueuePackages(this: *PackageManager, dependencies: Dependency.List, required: bool) ThreadPool.Batch {
        var batch = ThreadPool.Batch{};
        var count: u32 = 0;
        var slice = dependencies.entries.slice();
        const values = slice.items(.value);
        const keys = slice.items(.key);
        var i: usize = 0;
        while (i < values.len) : (i += 1) {
            var new_batch = (this.enqueueDependency(&values[i], required) catch null) orelse continue;
            batch.push(new_batch);
        }

        if (verbose_install) Output.flush();

        return batch;
    }

    pub fn enqueueDependencyList(this: *PackageManager, package: *const Package, features: Package.Features) void {
        this.task_queue.ensureUnusedCapacity(this.allocator, package.npm_count) catch unreachable;

        var batch = this.enqueuePackages(package.dependencies, true);

        if (features.dev_dependencies) {
            batch.push(this.enqueuePackages(package.dev_dependencies, true));
        }

        if (features.peer_dependencies) {
            batch.push(this.enqueuePackages(package.peer_dependencies, true));
        }

        if (features.optional_dependencies) {
            batch.push(this.enqueuePackages(package.optional_dependencies, false));
        }

        const count = batch.len + this.network_resolve_batch.len + this.network_tarball_batch.len;
        this.pending_tasks += @truncate(u32, count);
        this.total_tasks += @truncate(u32, count);
        this.thread_pool.schedule(batch);
        this.network_resolve_batch.push(this.network_tarball_batch);
        NetworkThread.global.pool.schedule(this.network_resolve_batch);
        this.network_tarball_batch = .{};
        this.network_resolve_batch = .{};
    }

    const Hoister = struct {};

    /// Hoisting means "find the topmost path to insert the node_modules folder in"
    /// We must hoist for many reasons.
    /// 1. File systems have a maximum file path length. Without hoisting, it is easy to exceed that.
    /// 2. It's faster due to fewer syscalls
    /// 3. It uses less disk space
    pub fn hoist(this: *PackageManager) !void {}
    pub fn link(this: *PackageManager) !void {}

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
            return Fs.FileSystem.instance.abs(&parts);
        }

        if (env_loader.map.get("HOME")) |dir| {
            var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
            return Fs.FileSystem.instance.abs(&parts);
        }

        if (env_loader.map.get("XDG_CACHE_HOME")) |dir| {
            var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
            return Fs.FileSystem.instance.abs(&parts);
        }

        if (env_loader.map.get("TMPDIR")) |dir| {
            var parts = [_]string{ dir, ".bun-cache" };
            return Fs.FileSystem.instance.abs(&parts);
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

                    std.os.chdirZ(chdir) catch |err| {
                        Output.prettyErrorln("Error {s} while chdir - {s}", .{ @errorName(err), chdir });
                        Output.flush();
                        return;
                    };

                    break :brk std.fs.cwd().openFileZ("package.json", .{ .read = true, .write = true }) catch |err| {
                        this_cwd = parent;
                        continue :outer;
                    };
                }

                Output.prettyErrorln("<r><green>No package.json<r> Nothing to install.", .{});
                Output.flush();
                return;
            };
        };

        fs.top_level_dir = try std.os.getcwd(&cwd_buf);
        cwd_buf[fs.top_level_dir.len] = '/';
        cwd_buf[fs.top_level_dir.len + 1] = 0;
        fs.top_level_dir = cwd_buf[0 .. fs.top_level_dir.len + 1];
        std.mem.copy(u8, &package_json_cwd_buf, fs.top_level_dir);
        std.mem.copy(u8, package_json_cwd_buf[fs.top_level_dir.len..], "package.json");
        var package_json_contents = package_json_file.readToEndAlloc(ctx.allocator, std.math.maxInt(usize)) catch |err| {
            Output.prettyErrorln("<r><red>{s} reading package.json<r> :(", .{@errorName(err)});
            Output.flush();
            return;
        };
        // Step 2. Parse the package.json file
        //
        var package_json_source = logger.Source.initPathString(
            package_json_cwd_buf[0 .. fs.top_level_dir.len + "package.json".len],
            package_json_contents,
        );

        package_list.allocator = ctx.allocator;
        package_list.blocks[0] = &package_list.head;

        var root = try package_list.append(try Package.parse(
            0,
            ctx.allocator,
            ctx.log,
            package_json_source,
            Package.Features{
                .optional_dependencies = true,
                .dev_dependencies = true,
                .is_main = true,
            },
        ));
        var env_loader: *DotEnv.Loader = brk: {
            var map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            var loader = try ctx.allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, ctx.allocator);
            break :brk loader;
        };

        var entries_option = try fs.fs.readDirectory(fs.top_level_dir, null);
        var enable_cache = false;
        var cache_directory_path: string = "";
        var cache_directory: std.fs.Dir = undefined;
        env_loader.loadProcess();
        try env_loader.load(&fs.fs, &entries_option.entries, false);

        if (PackageManager.fetchCacheDirectoryPath(ctx.allocator, env_loader, &entries_option.entries)) |cache_dir_path| {
            enable_cache = true;
            cache_directory_path = try fs.dirname_store.append(@TypeOf(cache_dir_path), cache_dir_path);
            cache_directory = std.fs.cwd().makeOpenPath(cache_directory_path, .{ .iterate = true }) catch |err| brk: {
                enable_cache = false;
                Output.prettyErrorln("Cache is disabled due to error: {s}", .{@errorName(err)});
                break :brk undefined;
            };
        } else {}

        if (verbose_install) {
            Output.prettyErrorln("Cache Dir: {s}", .{cache_directory_path});
            Output.flush();
        }

        var cpu_count = @truncate(u32, (try std.Thread.getCpuCount()) + 1);

        if (env_loader.map.get("GOMAXPROCS")) |max_procs| {
            if (std.fmt.parseInt(u32, max_procs, 10)) |cpu_count_| {
                cpu_count = @minimum(cpu_count, cpu_count_);
            } else |err| {}
        }

        try NetworkThread.init();

        var manager = &instance;
        // var progress = std.Progress{};
        // var node = progress.start(name: []const u8, estimated_total_items: usize)
        manager.* = PackageManager{
            .enable_cache = enable_cache,
            .cache_directory_path = cache_directory_path,
            .cache_directory = cache_directory,
            .env_loader = env_loader,
            .allocator = ctx.allocator,
            .log = ctx.log,
            .root_dir = &entries_option.entries,
            .root_package = root,
            .thread_pool = ThreadPool.init(.{
                .max_threads = cpu_count,
            }),
            .resolve_tasks = TaskChannel.init(),
            // .progress
        };

        if (!enable_cache) {
            manager.enable_manifest_cache = false;
            manager.enable_manifest_cache_public = false;
        }

        if (env_loader.map.get("BUN_MANIFEST_CACHE")) |manifest_cache| {
            if (strings.eqlComptime(manifest_cache, "1")) {
                manager.enable_manifest_cache = true;
                manager.enable_manifest_cache_public = false;
            } else if (strings.eqlComptime(manifest_cache, "2")) {
                manager.enable_manifest_cache = true;
                manager.enable_manifest_cache_public = true;
            } else {
                manager.enable_manifest_cache = false;
                manager.enable_manifest_cache_public = false;
            }
        }

        manager.enqueueDependencyList(
            root,
            Package.Features{
                .optional_dependencies = true,
                .dev_dependencies = true,
                .is_main = true,
            },
        );
        var extracted_count: usize = 0;
        while (manager.pending_tasks > 0) {
            var batch = ThreadPool.Batch{};
            while (manager.network_channel.tryReadItem() catch null) |task_| {
                var task: *NetworkTask = task_;
                manager.pending_tasks -= 1;

                switch (task.callback) {
                    .package_manifest => |manifest_req| {
                        const name = manifest_req.name;
                        const response = task.http.response orelse {
                            Output.prettyErrorln("Failed to download package manifest for package {s}", .{name});
                            Output.flush();
                            continue;
                        };

                        if (response.status_code > 399) {
                            Output.prettyErrorln(
                                "<r><red><b>GET<r><red> {s}<d>  - {d}<r>",
                                .{
                                    name,
                                    response.status_code,
                                },
                            );
                            Output.flush();
                            continue;
                        }

                        if (verbose_install) {
                            Output.prettyError("    ", .{});
                            Output.printElapsed(@floatCast(f64, @intToFloat(f128, task.http.elapsed) / std.time.ns_per_ms));
                            Output.prettyError(" <d>Downloaded <r><green>{s}<r> versions\n", .{name});
                            Output.flush();
                        }

                        if (response.status_code == 304) {
                            // The HTTP request was cached
                            if (manifest_req.loaded_manifest) |manifest| {
                                var entry = try manager.manifests.getOrPut(ctx.allocator, @truncate(u32, manifest.pkg.name.hash));
                                entry.value_ptr.* = manifest;
                                entry.value_ptr.*.pkg.public_max_age = @truncate(u32, @intCast(u64, @maximum(0, std.time.timestamp()))) + 300;
                                {
                                    var tmpdir = Fs.FileSystem.instance.tmpdir();
                                    Npm.PackageManifest.Serializer.save(entry.value_ptr, tmpdir, PackageManager.instance.cache_directory) catch {};
                                }

                                const dependency_list = manager.task_queue.get(task.task_id).?;

                                for (dependency_list.items) |item| {
                                    var dependency: *Dependency = TaskCallbackContext.get(item, Dependency).?;
                                    if (try manager.enqueueDependency(dependency, dependency.required)) |new_batch| {
                                        batch.push(new_batch);
                                    }
                                }
                                continue;
                            }
                        }

                        batch.push(ThreadPool.Batch.from(manager.enqueueParseNPMPackage(task.task_id, name, task)));
                    },
                    .extract => |extract| {
                        const response = task.http.response orelse {
                            Output.prettyErrorln("Failed to download package tarball for package {s}", .{extract.name});
                            Output.flush();
                            continue;
                        };

                        if (response.status_code > 399) {
                            Output.prettyErrorln(
                                "<r><red><b>GET<r><red> {s}<d>  - {d}<r>",
                                .{
                                    task.http.url.href,
                                    response.status_code,
                                },
                            );
                            Output.flush();
                            continue;
                        }

                        if (verbose_install) {
                            Output.prettyError("    ", .{});
                            Output.printElapsed(@floatCast(f64, @intToFloat(f128, task.http.elapsed) / std.time.ns_per_ms));
                            Output.prettyError(" <d>Downloaded <r><green>{s}<r> tarball\n", .{extract.name});
                            Output.flush();
                        }

                        batch.push(ThreadPool.Batch.from(manager.enqueueExtractNPMPackage(extract, task)));
                    },
                }
            }

            while (manager.resolve_tasks.tryReadItem() catch null) |task_| {
                manager.pending_tasks -= 1;

                var task: Task = task_;
                if (task.log.msgs.items.len > 0) {
                    if (Output.enable_ansi_colors) {
                        try task.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
                    } else {
                        try task.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
                    }
                }

                switch (task.tag) {
                    .package_manifest => {
                        if (task.status == .fail) {
                            Output.prettyErrorln("Failed to parse package manifest for {s}", .{task.request.package_manifest.name});
                            Output.flush();
                            continue;
                        }
                        const manifest = task.data.package_manifest;
                        var entry = try manager.manifests.getOrPutValue(ctx.allocator, @truncate(u32, manifest.pkg.name.hash), manifest);
                        const dependency_list = manager.task_queue.get(task.id).?;

                        for (dependency_list.items) |item| {
                            var dependency: *Dependency = TaskCallbackContext.get(item, Dependency).?;
                            if (try manager.enqueueDependency(dependency, dependency.required)) |new_batch| {
                                batch.push(new_batch);
                            }
                        }
                    },
                    .extract => {
                        if (task.status == .fail) {
                            Output.prettyErrorln("Failed to extract tarball for {s}", .{
                                task.request.extract.tarball.name,
                            });
                            Output.flush();
                            continue;
                        }
                        extracted_count += 1;
                        task.request.extract.tarball.package.preinstall_state = Package.PreinstallState.done;
                    },
                }
            }

            {
                const count = batch.len + manager.network_resolve_batch.len + manager.network_tarball_batch.len;
                manager.pending_tasks += @truncate(u32, count);
                manager.total_tasks += @truncate(u32, count);
                manager.thread_pool.schedule(batch);
                manager.network_resolve_batch.push(manager.network_tarball_batch);
                NetworkThread.global.pool.schedule(manager.network_resolve_batch);
                manager.network_tarball_batch = .{};
                manager.network_resolve_batch = .{};
            }
        }

        if (verbose_install) {
            Output.prettyErrorln("Preinstall complete.\n       Extracted: {d}         Tasks: {d}", .{ extracted_count, manager.total_tasks });
        }

        if (Output.enable_ansi_colors) {
            try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
        } else {
            try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
        }

        if (manager.log.errors > 0) {
            Output.flush();
            std.os.exit(1);
        }

        try manager.hoist();
        try manager.link();
    }
};

const verbose_install = false;

test "getPackageMetadata" {
    Output.initTest();

    var registry = Npm.Registry{};
    var log = logger.Log.init(default_allocator);

    var response = try registry.getPackageMetadata(default_allocator, &log, "react", "", "");

    switch (response) {
        .cached, .not_found => unreachable,
        .fresh => |package| {
            package.reportSize();
            const react = package.findByString("beta") orelse return try std.testing.expect(false);
            try std.testing.expect(react.package.file_count > 0);
            try std.testing.expect(react.package.unpacked_size > 0);
            // try std.testing.expectEqualStrings("loose-envify", entry.slice(package.string_buf));
        },
    }
}

test "dumb wyhash" {
    var i: usize = 0;
    var j: usize = 0;
    var z: usize = 0;

    while (i < 100) {
        j = 0;
        while (j < 100) {
            while (z < 100) {
                try std.testing.expectEqual(
                    std.hash.Wyhash.hash(0, try std.fmt.allocPrint(default_allocator, "{d}.{d}.{d}", .{ i, j, z })),
                    std.hash.Wyhash.hash(0, try std.fmt.allocPrint(default_allocator, "{d}.{d}.{d}", .{ i, j, z })),
                );
                z += 1;
            }
            j += 1;
        }
        i += 1;
    }
}
