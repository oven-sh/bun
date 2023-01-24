const bun = @import("bun");
const logger = bun.logger;
const Environment = @import("../env.zig");
const Install = @import("./install.zig");
const ExternalStringList = Install.ExternalStringList;
const Features = Install.Features;
const PackageNameHash = Install.PackageNameHash;
const Repository = @import("./repository.zig").Repository;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const SlicedString = Semver.SlicedString;
const String = Semver.String;
const std = @import("std");
const string = @import("../string_types.zig").string;
const strings = @import("../string_immutable.zig");
const Dependency = @This();

pub const Pair = struct {
    resolution_id: Install.PackageID = Install.invalid_package_id,
    dependency: Dependency = .{},
    failed: ?anyerror = null,
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

pub fn countWithDifferentBuffers(this: *const Dependency, name_buf: []const u8, version_buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
    builder.count(this.name.slice(name_buf));
    builder.count(this.version.literal.slice(version_buf));
}

pub fn count(this: *const Dependency, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
    this.countWithDifferentBuffers(buf, buf, StringBuilder, builder);
}

pub fn clone(this: *const Dependency, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) !Dependency {
    return this.cloneWithDifferentBuffers(buf, buf, StringBuilder, builder);
}

pub fn cloneWithDifferentBuffers(this: *const Dependency, name_buf: []const u8, version_buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) !Dependency {
    const out_slice = builder.lockfile.buffers.string_bytes.items;
    const new_literal = builder.append(String, this.version.literal.slice(version_buf));
    const sliced = new_literal.sliced(out_slice);
    const new_name = builder.append(String, this.name.slice(name_buf));

    return Dependency{
        .name_hash = this.name_hash,
        .name = new_name,
        .version = Dependency.parseWithTag(
            builder.lockfile.allocator,
            new_name,
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

/// Get the name of the package as it should appear in a remote registry.
pub inline fn realname(this: *const Dependency) String {
    return switch (this.version.tag) {
        .npm => this.version.value.npm.name,
        .dist_tag => this.version.value.dist_tag.name,
        else => this.name,
    };
}

pub inline fn isAliased(this: *const Dependency, buf: []const u8) bool {
    return switch (this.version.tag) {
        .npm => !this.version.value.npm.name.eql(this.name, buf, buf),
        .dist_tag => !this.version.value.dist_tag.name.eql(this.name, buf, buf),
        else => false,
    };
}

pub fn toDependency(
    this: External,
    ctx: Context,
) Dependency {
    const name = String{
        .bytes = this[0..8].*,
    };
    return Dependency{
        .name = name,
        .name_hash = @bitCast(u64, this[8..16].*),
        .behavior = @intToEnum(Dependency.Behavior, this[16]),
        .version = Dependency.Version.toVersion(name, this[17..this.len].*, ctx),
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
    tag: Dependency.Version.Tag = .uninitialized,
    literal: String = .{},
    value: Value = .{ .uninitialized = {} },

    pub fn deinit(this: *Version) void {
        switch (this.tag) {
            .npm => {
                this.value.npm.version.deinit();
            },
            else => {},
        }
    }

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
        if (Environment.allow_assert) std.debug.assert(lhs.tag == rhs.tag);
        return strings.cmpStringsAsc({}, lhs.literal.slice(string_buf), rhs.literal.slice(string_buf));
    }

    pub const External = [9]u8;

    pub fn toVersion(
        alias: String,
        bytes: Version.External,
        ctx: Dependency.Context,
    ) Dependency.Version {
        const slice = String{ .bytes = bytes[1..9].* };
        const tag = @intToEnum(Dependency.Version.Tag, bytes[0]);
        const sliced = &slice.sliced(ctx.buffer);
        return Dependency.parseWithTag(
            ctx.allocator,
            alias,
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
                lhs.value.npm.eql(rhs.value.npm, lhs_buf, rhs_buf),
            .folder, .dist_tag => lhs.literal.eql(rhs.literal, lhs_buf, rhs_buf),
            .github => lhs.value.github.eql(rhs.value.github, lhs_buf, rhs_buf),
            .tarball => lhs.value.tarball.eql(rhs.value.tarball, lhs_buf, rhs_buf),
            .symlink => lhs.value.symlink.eql(rhs.value.symlink, lhs_buf, rhs_buf),
            .workspace => lhs.value.workspace.eql(rhs.value.workspace, lhs_buf, rhs_buf),
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

        workspace = 6,
        /// TODO:
        git = 7,
        /// TODO:
        github = 8,

        pub inline fn isNPM(this: Tag) bool {
            return @enumToInt(this) < 3;
        }

        pub inline fn isGitHubRepoPath(dependency: string) bool {
            // Shortest valid expression: u/r
            if (dependency.len < 3) return false;

            var hash_index: usize = 0;
            var slash_index: usize = 0;

            for (dependency) |c, i| {
                switch (c) {
                    '/' => {
                        if (i == 0) return false;
                        if (slash_index > 0) return false;
                        slash_index = i;
                    },
                    '#' => {
                        if (i == 0) return false;
                        if (hash_index > 0) return false;
                        if (slash_index == 0) return false;
                        hash_index = i;
                    },
                    // Not allowed in username
                    '.', '_' => {
                        if (slash_index == 0) return false;
                    },
                    // Must be alphanumeric
                    '-', 'a'...'z', 'A'...'Z', '0'...'9' => {},
                    else => return false,
                }
            }

            return hash_index != dependency.len - 1 and slash_index > 0 and slash_index != dependency.len - 1;
        }

        // this won't work for query string params
        // i'll let someone file an issue before I add that
        pub inline fn isTarball(dependency: string) bool {
            return strings.endsWithComptime(dependency, ".tgz") or strings.endsWithComptime(dependency, ".tar.gz");
        }

        pub fn infer(dependency: string) Tag {
            // empty string means >= 0.0.0
            if (dependency.len == 0) return .npm;
            switch (dependency[0]) {
                // =1
                // >1.2
                // >=1.2.3
                // <1
                // <=1.2
                // ^1.2.3
                // *
                // || 1.x
                '=', '>', '<', '^', '*', '|' => return .npm,
                // ./foo.tgz
                // ./path/to/foo
                // ../path/to/bar
                '.' => {
                    if (isTarball(dependency)) return .tarball;
                    return .folder;
                },
                // ~1.2.3
                // ~/foo.tgz
                // ~/path/to/foo
                '~' => {
                    // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#local-paths
                    if (dependency.len > 1 and dependency[1] == '/') {
                        if (isTarball(dependency)) return .tarball;
                        return .folder;
                    }
                    return .npm;
                },
                // /path/to/foo
                // /path/to/foo.tgz
                '/' => {
                    if (isTarball(dependency)) return .tarball;
                    return .folder;
                },
                // 1.2.3
                // 123.tar.gz
                '0'...'9' => {
                    if (isTarball(dependency)) return .tarball;
                    return .npm;
                },
                // foo.tgz
                // foo/repo
                // file:path/to/foo
                // file:path/to/foo.tar.gz
                'f' => {
                    if (strings.hasPrefixComptime(dependency, "file:")) {
                        if (isTarball(dependency)) return .tarball;
                        return .folder;
                    }
                },
                // git_user/repo
                // git_tarball.tgz
                // github:user/repo
                // git@example.com/repo.git
                // git://user@example.com/repo.git
                'g' => {
                    if (strings.hasPrefixComptime(dependency, "git")) {
                        const url = dependency["git".len..];
                        if (url.len > 2) {
                            switch (url[0]) {
                                ':' => {
                                    if (strings.hasPrefixComptime(url, "://")) return .git;
                                },
                                '+' => {
                                    if (strings.hasPrefixComptime(url, "+ssh") or
                                        strings.hasPrefixComptime(url, "+file") or
                                        strings.hasPrefixComptime(url, "+http") or
                                        strings.hasPrefixComptime(url, "+https"))
                                    {
                                        return .git;
                                    }
                                },
                                'h' => {
                                    if (strings.hasPrefixComptime(url, "hub:")) {
                                        if (isGitHubRepoPath(url["hub:".len..])) return .github;
                                    }
                                },
                                else => {},
                            }
                        }
                    }
                },
                // hello/world
                // hello.tar.gz
                // https://github.com/user/repo
                'h' => {
                    if (strings.hasPrefixComptime(dependency, "http")) {
                        var url = dependency["http".len..];
                        if (url.len > 2) {
                            switch (url[0]) {
                                ':' => {
                                    if (strings.hasPrefixComptime(url, "://")) {
                                        url = url["://".len..];
                                    }
                                },
                                's' => {
                                    if (strings.hasPrefixComptime(url, "s://")) {
                                        url = url["s://".len..];
                                    }
                                },
                                else => {},
                            }
                            if (strings.hasPrefixComptime(url, "github.com/")) {
                                if (isGitHubRepoPath(url["github.com/".len..])) return .github;
                            }
                        }
                    }
                },
                // lisp.tgz
                // lisp/repo
                // link:path/to/foo
                'l' => {
                    if (strings.hasPrefixComptime(dependency, "link:")) return .symlink;
                },
                // newspeak.tgz
                // newspeak/repo
                // npm:package@1.2.3
                'n' => {
                    if (strings.hasPrefixComptime(dependency, "npm:") and dependency.len > "npm:".len) {
                        const remain = dependency["npm:".len + @boolToInt(dependency["npm:".len] == '@') ..];
                        for (remain) |c, i| {
                            if (c == '@') {
                                return infer(remain[i + 1 ..]);
                            }
                        }

                        return .npm;
                    }
                },
                // v1.2.3
                // verilog.tar.gz
                // verilog/repo
                'v' => {
                    if (isTarball(dependency)) return .tarball;
                    if (isGitHubRepoPath(dependency)) return .github;
                    return .npm;
                },
                // x
                // xyz.tar.gz
                // xyz/repo#main
                'x', 'X' => {
                    if (dependency.len == 1) return .npm;
                    if (dependency[1] == '.') return .npm;
                },
                else => {},
            }

            // foo.tgz
            // bar.tar.gz
            if (isTarball(dependency)) return .tarball;
            // user/repo
            // user/repo#main
            if (isGitHubRepoPath(dependency)) return .github;
            // beta
            return .dist_tag;
        }
    };

    const NpmInfo = struct {
        name: String,
        version: Semver.Query.Group,

        fn eql(this: NpmInfo, that: NpmInfo, this_buf: []const u8, that_buf: []const u8) bool {
            return this.name.eql(that.name, this_buf, that_buf) and this.version.eql(that.version);
        }
    };

    const TagInfo = struct {
        name: String,
        tag: String,

        fn eql(this: TagInfo, that: TagInfo, this_buf: []const u8, that_buf: []const u8) bool {
            return this.name.eql(that.name, this_buf, that_buf) and this.tag.eql(that.tag);
        }
    };

    pub const Value = union {
        uninitialized: void,

        npm: NpmInfo,
        dist_tag: TagInfo,
        tarball: URI,
        folder: String,

        /// Equivalent to npm link
        symlink: String,

        workspace: String,
        /// Unsupported, but still parsed so an error can be thrown
        git: void,
        github: Repository,
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

pub inline fn parse(
    allocator: std.mem.Allocator,
    alias: String,
    dependency: string,
    sliced: *const SlicedString,
    log: ?*logger.Log,
) ?Version {
    return parseWithOptionalTag(allocator, alias, dependency, null, sliced, log);
}

pub fn parseWithOptionalTag(
    allocator: std.mem.Allocator,
    alias: String,
    dependency: string,
    tag: ?Dependency.Version.Tag,
    sliced: *const SlicedString,
    log: ?*logger.Log,
) ?Version {
    const dep = std.mem.trimLeft(u8, dependency, " \t\n\r");
    return parseWithTag(
        allocator,
        alias,
        dep,
        tag orelse Version.Tag.infer(dep),
        sliced,
        log,
    );
}

pub fn parseWithTag(
    allocator: std.mem.Allocator,
    alias: String,
    dependency: string,
    tag: Dependency.Version.Tag,
    sliced: *const SlicedString,
    log_: ?*logger.Log,
) ?Version {
    alias.assertDefined();

    switch (tag) {
        .npm => {
            var input = dependency;
            const name = if (strings.hasPrefixComptime(input, "npm:")) sliced.sub(brk: {
                var str = input["npm:".len..];
                var i: usize = @boolToInt(str.len > 0 and str[0] == '@');

                while (i < str.len) : (i += 1) {
                    if (str[i] == '@') {
                        input = str[i + 1 ..];
                        break :brk str[0..i];
                    }
                }
                input = str[i..];
                break :brk str[0..i];
            }).value() else alias;

            // Strip single leading v
            // v1.0.0 -> 1.0.0
            // note: "vx" is valid, it becomes "x". "yarn add react@vx" -> "yarn add react@x" -> "yarn add react@17.0.2"
            if (input.len > 1 and input[0] == 'v') {
                input = input[1..];
            }

            const version = Semver.Query.parse(
                allocator,
                input,
                sliced.sub(input),
            ) catch |err| {
                if (log_) |log| log.addErrorFmt(null, logger.Loc.Empty, allocator, "{s} parsing dependency \"{s}\"", .{ @errorName(err), dependency }) catch unreachable;
                return null;
            };

            return Version{
                .literal = sliced.value(),
                .value = .{
                    .npm = .{
                        .name = name,
                        .version = version,
                    },
                },
                .tag = .npm,
            };
        },
        .dist_tag => {
            var tag_to_use: String = sliced.value();

            const actual = if (strings.hasPrefixComptime(dependency, "npm:") and dependency.len > "npm:".len)
                // npm:@foo/bar@latest
                sliced.sub(brk: {
                    var i: usize = "npm:".len;

                    // npm:@foo/bar@latest
                    //     ^
                    i += @boolToInt(dependency[i] == '@');

                    while (i < dependency.len) : (i += 1) {
                        // npm:@foo/bar@latest
                        //             ^
                        if (dependency[i] == '@') {
                            break;
                        }
                    }

                    tag_to_use = sliced.sub(dependency[i + 1 ..]).value();
                    if (tag_to_use.isEmpty()) {
                        tag_to_use = String.from("latest");
                    }

                    break :brk dependency["npm:".len..i];
                }).value()
            else
                alias;

            // name should never be empty
            if (Environment.allow_assert) std.debug.assert(!actual.isEmpty());

            // tag should never be empty
            if (Environment.allow_assert) std.debug.assert(!tag_to_use.isEmpty());

            return Version{
                .literal = sliced.value(),
                .value = .{
                    .dist_tag = .{
                        .name = actual,
                        .tag = tag_to_use,
                    },
                },
                .tag = .dist_tag,
            };
        },
        .github => {
            var from_url = false;
            var input = dependency;
            if (strings.hasPrefixComptime(input, "github:")) {
                input = input["github:".len..];
            } else if (strings.hasPrefixComptime(input, "http")) {
                var url = input["http".len..];
                if (url.len > 2) {
                    switch (url[0]) {
                        ':' => {
                            if (strings.hasPrefixComptime(url, "://")) {
                                url = url["://".len..];
                            }
                        },
                        's' => {
                            if (strings.hasPrefixComptime(url, "s://")) {
                                url = url["s://".len..];
                            }
                        },
                        else => {},
                    }
                    if (strings.hasPrefixComptime(url, "github.com/")) {
                        input = url["github.com/".len..];
                        from_url = true;
                    }
                }
            }

            if (Environment.allow_assert) std.debug.assert(Version.Tag.isGitHubRepoPath(input));

            var hash_index: usize = 0;
            var slash_index: usize = 0;
            for (input) |c, i| {
                switch (c) {
                    '/' => {
                        slash_index = i;
                    },
                    '#' => {
                        hash_index = i;
                        break;
                    },
                    else => {},
                }
            }

            var repo = if (hash_index == 0) input[slash_index + 1 ..] else input[slash_index + 1 .. hash_index];
            if (from_url and strings.endsWithComptime(repo, ".git")) {
                repo = repo[0 .. repo.len - ".git".len];
            }

            return Version{
                .literal = sliced.value(),
                .value = .{
                    .github = .{
                        .owner = sliced.sub(input[0..slash_index]).value(),
                        .repo = sliced.sub(repo).value(),
                        .committish = if (hash_index == 0) String.from("") else sliced.sub(input[hash_index + 1 ..]).value(),
                    },
                },
                .tag = .github,
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
        .workspace => {
            return Version{
                .value = .{ .workspace = sliced.value() },
                .tag = .workspace,
                .literal = sliced.value(),
            };
        },
        .git => {
            if (log_) |log| log.addErrorFmt(null, logger.Loc.Empty, allocator, "Support for dependency type \"{s}\" is not implemented yet (\"{s}\")", .{ @tagName(tag), dependency }) catch unreachable;
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
    pub const workspace: u8 = 1 << 5;

    pub inline fn isNormal(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.normal) != 0;
    }

    pub inline fn isOptional(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.optional) != 0 and !this.isPeer();
    }

    pub inline fn isDev(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.dev) != 0;
    }

    pub inline fn isPeer(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.peer) != 0;
    }

    pub inline fn isWorkspace(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.workspace) != 0;
    }

    pub inline fn setNormal(this: Behavior, value: bool) Behavior {
        if (value) {
            return @intToEnum(Behavior, @enumToInt(this) | Behavior.normal);
        } else {
            return @intToEnum(Behavior, @enumToInt(this) & ~Behavior.normal);
        }
    }

    pub inline fn setOptional(this: Behavior, value: bool) Behavior {
        if (value) {
            return @intToEnum(Behavior, @enumToInt(this) | Behavior.optional);
        } else {
            return @intToEnum(Behavior, @enumToInt(this) & ~Behavior.optional);
        }
    }

    pub inline fn setDev(this: Behavior, value: bool) Behavior {
        if (value) {
            return @intToEnum(Behavior, @enumToInt(this) | Behavior.dev);
        } else {
            return @intToEnum(Behavior, @enumToInt(this) & ~Behavior.dev);
        }
    }

    pub inline fn setPeer(this: Behavior, value: bool) Behavior {
        if (value) {
            return @intToEnum(Behavior, @enumToInt(this) | Behavior.peer);
        } else {
            return @intToEnum(Behavior, @enumToInt(this) & ~Behavior.peer);
        }
    }

    pub inline fn setWorkspace(this: Behavior, value: bool) Behavior {
        if (value) {
            return @intToEnum(Behavior, @enumToInt(this) | Behavior.workspace);
        } else {
            return @intToEnum(Behavior, @enumToInt(this) & ~Behavior.workspace);
        }
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

        if (lhs.isWorkspace() != rhs.isWorkspace()) {
            return if (lhs.isWorkspace())
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
            (features.optional_dependencies and this.isOptional()) or
            (features.dev_dependencies and this.isDev()) or
            (features.peer_dependencies and this.isPeer()) or
            this.isWorkspace();
    }
};
