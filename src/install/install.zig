usingnamespace @import("../global.zig");
const std = @import("std");

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");
const alloc = @import("../alloc.zig");
const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const json_parser = @import("../json_parser.zig");
const js_printer = @import("../js_printer.zig");
const js_ast = @import("../js_ast.zig");
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

pub const Dependency = struct {
    name: string,
    name_hash: u32,
    version: Version,

    pub const Version = union(Tag) {
        pub const Tag = enum {
            /// Semver range
            npm,

            /// NPM dist tag, e.g. "latest"
            dist_tag,

            /// URI to a .tgz or .tar.gz
            tarball,

            /// Local folder
            folder,

            /// TODO:
            symlink,
            /// TODO:
            workspace,
            /// TODO:
            git,
            /// TODO:
            github,

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

    pub const Features = struct {
        optional_dependencies: bool = false,
        dev_dependencies: bool = false,
        scripts: bool = false,
        peer_dependencies: bool = true,
        is_main: bool = false,
    };

    fn parseDependencyList(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        expr: js_ast.Expr,
    ) ?Dependency.List {
        if (expr.data != .e_object) return null;

        const properties = expr.data.e_object.properties;
        if (properties.len == 0) return null;

        var dependencies = Dependency.List{};
        dependencies.ensureTotalCapacity(allocator, properties.len) catch @panic("OOM while parsing dependencies?");

        for (properties) |prop| {
            const name = prop.key.?.asString(allocator) orelse continue;
            const value = prop.value.?.asString(allocator) orelse continue;

            if (Dependency.parse(allocator, value, log)) |version| {
                const dependency = Dependency{
                    .name = name,
                    .name_hash = std.hash.Murmur2_32.hash(name),
                    .version = version,
                };

                dependencies.appendAssumeCapacity(dependency);
            }
        }
        return dependencies;
    }

    pub fn parse(
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
            package.dependencies = parseDependencyList(allocator, dependencies_q.expr) orelse Dependency.List{};
        }

        if (comptime features.dev_dependencies) {
            if (json.asProperty("devDependencies")) |dependencies_q| {
                package.dev_dependencies = parseDependencyList(allocator, dependencies_q.expr) orelse Dependency.List{};
            }
        }

        if (comptime features.optional_dependencies) {
            if (json.asProperty("optionalDependencies")) |dependencies_q| {
                package.optional_dependencies = parseDependencyList(allocator, dependencies_q.expr) orelse Dependency.List{};
            }
        }

        if (comptime features.peer_dependencies) {
            if (json.asProperty("peerDependencies")) |dependencies_q| {
                package.peer_dependencies = parseDependencyList(allocator, dependencies_q.expr) orelse Dependency.List{};
            }
        }

        if (comptime !features.is_main) {}

        return package;
    }
};

const Npm = struct {
    pub const Registry = struct {
        url: URL,
    };

    /// A package's "dependencies" field by their Semver version.
    ///
    /// Ordered by NPM registry version
    ///
    /// When the dependencies haven't changed between package versions,
    /// Consider Dependency.List to be immutable. It may share a pointer with other entries in this map.
    const DependencyMap = std.ArrayHashMap(Semver.Version, Dependency.List, Semver.Version.HashContext, true);

    const ResolvedPackage = struct {
        name: string,
        name_hash: u32,

        release_versions: DependencyMap,
        pre_versions: DependencyMap,

        pub fn parse(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            json_buffer: []const u8,
            expected_name: []const u8,
        ) !?ResolvedPackage {
            const source = logger.Source.initPathString(expected_name, json_buffer);
            const json = json_parser.ParseJSON(&source, log, allocator) catch |err| {
                return null;
            };

            if (json.asProperty("error")) |error_q| {
                if (error_q.asString(allocator)) |err| {
                    log.addErrorFmt(&source, logger.Loc.Empty, allocator, "npm error: {s}", .{err}) catch unreachable;
                    return null;
                }
            }

            if (json.asProperty("name")) |name_q| {
                const name = name_q.expr.asString(allocator) orelse return null;

                if (name != expected_name) {
                    Output.panic("<r>internal: <red>package name mismatch<r> expected \"{s}\" but received <b>\"{s}\"<r>", .{ expected_name, name });
                    return null;
                }
            }
        }
    };
};

pub const Install = struct {
    root_package: *Package = undefined,
};
