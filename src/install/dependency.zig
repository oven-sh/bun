const ExternalStringList = @import("./install.zig").ExternalStringList;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const std = @import("std");
const SlicedString = Semver.SlicedString;
const PackageNameHash = @import("./install.zig").PackageNameHash;
const Features = @import("./install.zig").Features;
const Install = @import("./install.zig");
const logger = @import("../logger.zig");
const Dependency = @This();
const string = @import("../string_types.zig").string;
const strings = @import("../string_immutable.zig");
const bun = @import("../global.zig");

pub const Pair = struct {
    resolution_id: Install.PackageID = Install.invalid_package_id,
    dependency: Dependency = .{},
};

pub const URI = union(Tag) {
    local: String,
    remote: String,

    pub fn eql(lhs: URI, rhs: URI, lhs_buf: []const u8, rhs_buf: []const u8) bool {
        if (@as(Tag, lhs) != @as(Tag, rhs)) {
            return false;
        }

        if (@as(Tag, lhs) == .local) {
            return strings.eql(lhs.local.slice(lhs_buf), rhs.local.slice(rhs_buf));
        } else {
            return strings.eql(lhs.remote.slice(lhs_buf), rhs.remote.slice(rhs_buf));
        }
    }

    pub const Tag = enum {
        local,
        remote,
    };
};

name_hash: PackageNameHash = 0,
name: String = String{},
version: Dependency.Version = Dependency.Version{},

/// This is how the dependency is specified in the package.json file.
/// This allows us to track whether a package originated in any permutation of:
/// - `dependencies`
/// - `devDependencies`
/// - `optionalDependencies`
/// - `peerDependencies`
/// Technically, having the same package name specified under multiple fields is invalid
/// But we don't want to allocate extra arrays for them. So we use a bitfield instead.
behavior: Behavior = Behavior.uninitialized,

/// Sorting order for dependencies is:
/// 1. [`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`]
/// 2. name ASC
/// "name" must be ASC so that later, when we rebuild the lockfile
/// we insert it back in reverse order without an extra sorting pass
pub fn isLessThan(string_buf: []const u8, lhs: Dependency, rhs: Dependency) bool {
    const behavior = lhs.behavior.cmp(rhs.behavior);
    if (behavior != .eq) {
        return behavior == .lt;
    }

    const lhs_name = lhs.name.slice(string_buf);
    const rhs_name = rhs.name.slice(string_buf);
    return strings.cmpStringsAsc(void{}, lhs_name, rhs_name);
}

pub fn count(this: Dependency, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
    builder.count(this.name.slice(buf));
    builder.count(this.version.literal.slice(buf));
}

pub fn clone(this: Dependency, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) !Dependency {
    const out_slice = builder.lockfile.buffers.string_bytes.items;
    const new_literal = builder.append(String, this.version.literal.slice(buf));
    const sliced = new_literal.sliced(out_slice);

    return Dependency{
        .name_hash = this.name_hash,
        .name = builder.append(String, this.name.slice(buf)),
        .version = Dependency.parseWithTag(
            builder.lockfile.allocator,
            new_literal.slice(out_slice),
            this.version.tag,
            &sliced,
            null,
        ) orelse Dependency.Version{},
        .behavior = this.behavior,
    };
}

pub const External = [size]u8;

const size = @sizeOf(Dependency.Version.External) +
    @sizeOf(PackageNameHash) +
    @sizeOf(Dependency.Behavior) +
    @sizeOf(String);

pub const Context = struct {
    allocator: std.mem.Allocator,
    log: *logger.Log,
    buffer: []const u8,
};

pub fn toDependency(
    this: External,
    ctx: Context,
) Dependency {
    return Dependency{
        .name = String{
            .bytes = this[0..8].*,
        },
        .name_hash = @bitCast(u64, this[8..16].*),
        .behavior = @intToEnum(Dependency.Behavior, this[16]),
        .version = Dependency.Version.toVersion(this[17..this.len].*, ctx),
    };
}

pub fn toExternal(this: Dependency) External {
    var bytes: External = undefined;
    bytes[0..this.name.bytes.len].* = this.name.bytes;
    bytes[8..16].* = @bitCast([8]u8, this.name_hash);
    bytes[16] = @enumToInt(this.behavior);
    bytes[17..bytes.len].* = this.version.toExternal();
    return bytes;
}

pub const Version = struct {
    tag: Dependency.Version.Tag = Dependency.Version.Tag.uninitialized,
    literal: String = String{},
    value: Value = Value{ .uninitialized = void{} },

    pub const @"0.0.0" = Version{
        .tag = Dependency.Version.Tag.npm,
        .literal = String.init("0.0.0", "0.0.0"),
        .value = Value{
            .npm = Semver.Query.Group{
                .allocator = bun.default_allocator,
                .head = .{
                    .head = .{
                        .range = .{
                            .left = .{
                                .op = .gte,
                            },
                        },
                    },
                },
            },
        },
    };

    pub const zeroed = Version{};

    pub fn clone(
        this: Version,
        buf: []const u8,
        comptime StringBuilder: type,
        builder: StringBuilder,
    ) !Version {
        return Version{
            .tag = this.tag,
            .literal = builder.append(String, this.literal.slice(buf)),
            .value = try this.value.clone(buf, builder),
        };
    }

    pub fn isLessThan(string_buf: []const u8, lhs: Dependency.Version, rhs: Dependency.Version) bool {
        std.debug.assert(lhs.tag == rhs.tag);
        return strings.cmpStringsAsc(.{}, lhs.literal.slice(string_buf), rhs.literal.slice(string_buf));
    }

    pub const External = [9]u8;

    pub fn toVersion(
        bytes: Version.External,
        ctx: Dependency.Context,
    ) Dependency.Version {
        const slice = String{ .bytes = bytes[1..9].* };
        const tag = @intToEnum(Dependency.Version.Tag, bytes[0]);
        const sliced = &slice.sliced(ctx.buffer);
        return Dependency.parseWithTag(
            ctx.allocator,
            sliced.slice,
            tag,
            sliced,
            ctx.log,
        ) orelse Dependency.Version.zeroed;
    }

    pub inline fn toExternal(this: Version) Version.External {
        var bytes: Version.External = undefined;
        bytes[0] = @enumToInt(this.tag);
        bytes[1..9].* = this.literal.bytes;
        return bytes;
    }

    pub inline fn eql(
        lhs: Version,
        rhs: Version,
        lhs_buf: []const u8,
        rhs_buf: []const u8,
    ) bool {
        if (lhs.tag != rhs.tag) {
            return false;
        }

        return switch (lhs.tag) {
            // if the two versions are identical as strings, it should often be faster to compare that than the actual semver version
            // semver ranges involve a ton of pointer chasing
            .npm => strings.eql(lhs.literal.slice(lhs_buf), rhs.literal.slice(rhs_buf)) or
                lhs.value.npm.eql(rhs.value.npm),
            .folder, .dist_tag => lhs.literal.eql(rhs.literal, lhs_buf, rhs_buf),
            .tarball => lhs.value.tarball.eql(rhs.value.tarball, lhs_buf, rhs_buf),
            .symlink => lhs.value.symlink.eql(rhs.value.symlink, lhs_buf, rhs_buf),
            else => true,
        };
    }

    pub const Tag = enum(u8) {
        uninitialized = 0,

        /// Semver range
        npm = 1,

        /// NPM dist tag, e.g. "latest"
        dist_tag = 2,

        /// URI to a .tgz or .tar.gz
        tarball = 3,

        /// Local folder
        folder = 4,

        /// link:path
        /// https://docs.npmjs.com/cli/v8/commands/npm-link#synopsis
        /// https://stackoverflow.com/questions/51954956/whats-the-difference-between-yarn-link-and-npm-link
        symlink = 5,

        /// TODO:
        workspace = 6,
        /// TODO:
        git = 7,
        /// TODO:
        github = 8,

        pub inline fn isNPM(this: Tag) bool {
            return @enumToInt(this) < 3;
        }

        pub inline fn isGitHubRepoPath(dependency: string) bool {
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
        pub inline fn isTarball(dependency: string) bool {
            return strings.endsWithComptime(dependency, ".tgz") or strings.endsWithComptime(dependency, ".tar.gz");
        }

        pub fn infer(dependency: string) Tag {
            switch (dependency[0]) {
                // npm package
                '=', '>', '<', '0'...'9', '^', '*', '|' => return Tag.npm,

                '.' => return Tag.folder,

                '~' => {

                    // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#local-paths
                    if (dependency.len > 1 and dependency[1] == '/') {
                        return Tag.folder;
                    }

                    return Tag.npm;
                },

                'n' => {
                    if (dependency.len > 4 and strings.eqlComptimeIgnoreLen(dependency[0..4], "npm:")) {
                        return Tag.npm;
                    }
                },

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
                    ) or strings.eqlComptime(
                        dependency[0..@minimum("git+file".len, dependency.len)],
                        "git+file",
                    ) or strings.eqlComptime(
                        dependency[0..@minimum("git+http".len, dependency.len)],
                        "git+http",
                    ) or strings.eqlComptime(
                        dependency[0..@minimum("git+https".len, dependency.len)],
                        "git+https",
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

                // Dependencies can start with v
                // v1.0.0 is the same as 1.0.0
                // However, a github repo or a tarball could start with v
                'v' => {
                    if (isTarball(dependency)) {
                        return .tarball;
                    }

                    if (isGitHubRepoPath(dependency)) {
                        return .github;
                    }

                    return .npm;
                },

                // file:
                'f' => {
                    if (isTarball(dependency))
                        return .tarball;

                    if (strings.eqlComptime(
                        dependency[0..@minimum("file:".len, dependency.len)],
                        "file:",
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
                        dependency[0..@minimum("link:".len, dependency.len)],
                        "link:",
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

                else => {},
            }

            if (isTarball(dependency))
                return .tarball;

            if (isGitHubRepoPath(dependency)) {
                return .github;
            }

            return .dist_tag;
        }
    };

    pub const Value = union {
        uninitialized: void,

        npm: Semver.Query.Group,
        dist_tag: String,
        tarball: URI,
        folder: String,

        /// Equivalent to npm link
        symlink: String,

        /// Unsupported, but still parsed so an error can be thrown
        workspace: void,
        /// Unsupported, but still parsed so an error can be thrown
        git: void,
        /// Unsupported, but still parsed so an error can be thrown
        github: void,
    };
};

pub fn eql(
    a: Dependency,
    b: Dependency,
    lhs_buf: []const u8,
    rhs_buf: []const u8,
) bool {
    return a.name_hash == b.name_hash and a.name.len() == b.name.len() and a.version.eql(b.version, lhs_buf, rhs_buf);
}

pub fn eqlResolved(a: Dependency, b: Dependency) bool {
    if (a.isNPM() and b.tag.isNPM()) {
        return a.resolution == b.resolution;
    }

    return @as(Dependency.Version.Tag, a.version) == @as(Dependency.Version.Tag, b.version) and a.resolution == b.resolution;
}

pub fn parse(
    allocator: std.mem.Allocator,
    dependency_: string,
    sliced: *const SlicedString,
    log: ?*logger.Log,
) ?Version {
    var dependency = std.mem.trimLeft(u8, dependency_, " \t\n\r");

    if (dependency.len == 0) return null;
    const tag = Version.Tag.infer(dependency);

    if (tag == .npm and dependency.len > 4 and strings.eqlComptimeIgnoreLen(dependency[0..4], "npm:")) {
        dependency = dependency[4..];
    }

    // Strip single leading v
    // v1.0.0 -> 1.0.0
    // note: "vx" is valid, it becomes "x". "yarn add react@vx" -> "yarn add react@x" -> "yarn add react@17.0.2"
    if (tag == .npm and dependency.len > 1 and dependency[0] == 'v') {
        dependency = dependency[1..];
    }

    return parseWithTag(
        allocator,
        dependency,
        tag,
        sliced,
        log,
    );
}

pub fn parseWithTag(
    allocator: std.mem.Allocator,
    dependency: string,
    tag: Dependency.Version.Tag,
    sliced: *const SlicedString,
    log_: ?*logger.Log,
) ?Version {
    switch (tag) {
        .npm => {
            const version = Semver.Query.parse(
                allocator,
                dependency,
                sliced.sub(dependency),
            ) catch |err| {
                if (log_) |log| log.addErrorFmt(null, logger.Loc.Empty, allocator, "{s} parsing dependency \"{s}\"", .{ @errorName(err), dependency }) catch unreachable;
                return null;
            };

            return Version{
                .literal = sliced.value(),
                .value = .{ .npm = version },
                .tag = .npm,
            };
        },
        .dist_tag => {
            return Version{
                .literal = sliced.value(),
                .value = .{ .dist_tag = sliced.value() },
                .tag = .dist_tag,
            };
        },
        .tarball => {
            if (strings.hasPrefixComptime(dependency, "https://") or strings.hasPrefixComptime(dependency, "http://")) {
                return Version{
                    .tag = .tarball,
                    .literal = sliced.value(),
                    .value = .{ .tarball = URI{ .remote = sliced.sub(dependency).value() } },
                };
            } else if (strings.hasPrefixComptime(dependency, "file://")) {
                return Version{
                    .tag = .tarball,
                    .literal = sliced.value(),
                    .value = .{ .tarball = URI{ .local = sliced.sub(dependency[7..]).value() } },
                };
            } else if (strings.contains(dependency, "://")) {
                if (log_) |log| log.addErrorFmt(null, logger.Loc.Empty, allocator, "invalid or unsupported dependency \"{s}\"", .{dependency}) catch unreachable;
                return null;
            }

            return Version{
                .literal = sliced.value(),
                .value = .{
                    .tarball = URI{
                        .local = sliced.value(),
                    },
                },
                .tag = .tarball,
            };
        },
        .folder => {
            if (strings.indexOfChar(dependency, ':')) |protocol| {
                if (strings.eqlComptime(dependency[0..protocol], "file")) {
                    if (dependency.len <= protocol) {
                        if (log_) |log| log.addErrorFmt(null, logger.Loc.Empty, allocator, "\"file\" dependency missing a path", .{}) catch unreachable;
                        return null;
                    }

                    return Version{ .literal = sliced.value(), .value = .{ .folder = sliced.sub(dependency[protocol + 1 ..]).value() }, .tag = .folder };
                }

                if (log_) |log| log.addErrorFmt(null, logger.Loc.Empty, allocator, "Unsupported protocol {s}", .{dependency}) catch unreachable;
                return null;
            }

            return Version{
                .value = .{ .folder = sliced.value() },
                .tag = .folder,
                .literal = sliced.value(),
            };
        },
        .uninitialized => return null,
        .symlink => {
            if (strings.indexOfChar(dependency, ':')) |colon| {
                return Version{
                    .value = .{ .symlink = sliced.sub(dependency[colon + 1 ..]).value() },
                    .tag = .symlink,
                    .literal = sliced.value(),
                };
            }

            return Version{
                .value = .{ .symlink = sliced.value() },
                .tag = .symlink,
                .literal = sliced.value(),
            };
        },
        .workspace, .git, .github => {
            if (log_) |log| log.addErrorFmt(null, logger.Loc.Empty, allocator, "Unsupported dependency type {s} for \"{s}\"", .{ @tagName(tag), dependency }) catch unreachable;
            return null;
        },
    }
}

pub const Behavior = enum(u8) {
    uninitialized = 0,
    _,

    pub const normal: u8 = 1 << 1;
    pub const optional: u8 = 1 << 2;
    pub const dev: u8 = 1 << 3;
    pub const peer: u8 = 1 << 4;

    pub inline fn isOptional(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.optional) != 0 and !this.isPeer();
    }

    pub inline fn isDev(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.dev) != 0;
    }

    pub inline fn isPeer(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.peer) != 0;
    }

    pub inline fn isNormal(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.normal) != 0;
    }

    pub inline fn setOptional(this: Behavior, value: bool) Behavior {
        return @intToEnum(Behavior, @enumToInt(this) | (@as(u8, @boolToInt(value))) << 2);
    }

    pub inline fn setDev(this: Behavior, value: bool) Behavior {
        return @intToEnum(Behavior, @enumToInt(this) | (@as(u8, @boolToInt(value))) << 2);
    }

    pub inline fn cmp(lhs: Behavior, rhs: Behavior) std.math.Order {
        if (@enumToInt(lhs) == @enumToInt(rhs)) {
            return .eq;
        }

        if (lhs.isNormal() != rhs.isNormal()) {
            return if (lhs.isNormal())
                .gt
            else
                .lt;
        }

        if (lhs.isDev() != rhs.isDev()) {
            return if (lhs.isDev())
                .gt
            else
                .lt;
        }

        if (lhs.isOptional() != rhs.isOptional()) {
            return if (lhs.isOptional())
                .gt
            else
                .lt;
        }

        if (lhs.isPeer() != rhs.isPeer()) {
            return if (lhs.isPeer())
                .gt
            else
                .lt;
        }

        return .eq;
    }

    pub inline fn isRequired(this: Behavior) bool {
        return !isOptional(this);
    }

    pub fn isEnabled(this: Behavior, features: Features) bool {
        return this.isNormal() or
            (features.dev_dependencies and this.isDev()) or
            (features.peer_dependencies and this.isPeer()) or
            (features.optional_dependencies and this.isOptional());
    }
};
