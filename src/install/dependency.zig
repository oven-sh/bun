const Dependency = @This();

const URI = union(Tag) {
    local: String,
    remote: String,

    pub fn eql(lhs: URI, rhs: URI, lhs_buf: []const u8, rhs_buf: []const u8) bool {
        if (@as(Tag, lhs) != @as(Tag, rhs)) {
            return false;
        }

        if (@as(Tag, lhs) == .local) {
            return strings.eqlLong(lhs.local.slice(lhs_buf), rhs.local.slice(rhs_buf), true);
        } else {
            return strings.eqlLong(lhs.remote.slice(lhs_buf), rhs.remote.slice(rhs_buf), true);
        }
    }

    pub const Tag = enum {
        local,
        remote,
    };
};

name_hash: PackageNameHash = 0,
name: String = .{},
version: Dependency.Version = .{},

/// This is how the dependency is specified in the package.json file.
/// This allows us to track whether a package originated in any permutation of:
/// - `dependencies`
/// - `devDependencies`
/// - `optionalDependencies`
/// - `peerDependencies`
/// Technically, having the same package name specified under multiple fields is invalid
/// But we don't want to allocate extra arrays for them. So we use a bitfield instead.
behavior: Behavior = .{},

/// Sorting order for dependencies is:
/// 1. [ `peerDependencies`, `optionalDependencies`, `devDependencies`, `dependencies` ]
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
    return strings.cmpStringsAsc({}, lhs_name, rhs_name);
}

pub fn countWithDifferentBuffers(this: *const Dependency, name_buf: []const u8, version_buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
    builder.count(this.name.slice(name_buf));
    builder.count(this.version.literal.slice(version_buf));
}

pub fn count(this: *const Dependency, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
    this.countWithDifferentBuffers(buf, buf, StringBuilder, builder);
}

pub fn clone(this: *const Dependency, package_manager: *PackageManager, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) !Dependency {
    return this.cloneWithDifferentBuffers(package_manager, buf, buf, StringBuilder, builder);
}

pub fn cloneWithDifferentBuffers(this: *const Dependency, package_manager: *PackageManager, name_buf: []const u8, version_buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) !Dependency {
    const out_slice = builder.lockfile.buffers.string_bytes.items;
    const new_literal = builder.append(String, this.version.literal.slice(version_buf));
    const sliced = new_literal.sliced(out_slice);
    const new_name = builder.append(String, this.name.slice(name_buf));

    return Dependency{
        .name_hash = this.name_hash,
        .name = new_name,
        .version = NpaBridge.parseWithKnownTag(
            builder.lockfile.allocator,
            new_name,
            String.Builder.stringHash(new_name.slice(out_slice)),
            new_literal.slice(out_slice),
            this.version.tag,
            &sliced,
            null,
            package_manager,
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
    package_manager: ?*PackageManager,
};

/// Get the name of the package as it should appear in a remote registry.
pub inline fn realname(this: *const Dependency) String {
    return switch (this.version.tag) {
        .dist_tag => this.version.value.dist_tag.name,
        .git => this.version.value.git.package_name,
        .github => this.version.value.github.package_name,
        .npm => this.version.value.npm.name,
        .tarball => this.version.value.tarball.package_name,
        else => this.name,
    };
}

pub inline fn isAliased(this: *const Dependency, buf: []const u8) bool {
    return switch (this.version.tag) {
        .npm => !this.version.value.npm.name.eql(this.name, buf, buf),
        .dist_tag => !this.version.value.dist_tag.name.eql(this.name, buf, buf),
        .git => !this.version.value.git.package_name.eql(this.name, buf, buf),
        .github => !this.version.value.github.package_name.eql(this.name, buf, buf),
        .tarball => !this.version.value.tarball.package_name.eql(this.name, buf, buf),
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
    const name_hash: u64 = @bitCast(this[8..16].*);
    return Dependency{
        .name = name,
        .name_hash = name_hash,
        .behavior = @bitCast(this[16]),
        .version = Dependency.Version.toVersion(name, name_hash, this[17..this.len].*, ctx),
    };
}

pub fn toExternal(this: Dependency) External {
    var bytes: External = undefined;
    bytes[0..this.name.bytes.len].* = this.name.bytes;
    bytes[8..16].* = @as([8]u8, @bitCast(this.name_hash));
    bytes[16] = @bitCast(this.behavior);
    bytes[17..bytes.len].* = this.version.toExternal();
    return bytes;
}

pub fn splitVersionAndMaybeName(str: []const u8) struct { []const u8, ?[]const u8 } {
    if (strings.indexOfChar(str, '@')) |at_index| {
        if (at_index != 0) {
            return .{ str[at_index + 1 ..], str[0..at_index] };
        }

        const second_at_index = (strings.indexOfChar(str[1..], '@') orelse return .{ str, null }) + 1;

        return .{ str[second_at_index + 1 ..], str[0..second_at_index] };
    }

    return .{ str, null };
}

/// Turns `foo@1.1.1` into `foo`, `1.1.1`, or `@foo/bar@1.1.1` into `@foo/bar`, `1.1.1`, or `foo` into `foo`, `null`.
pub fn splitNameAndMaybeVersion(str: string) struct { string, ?string } {
    if (strings.indexOfChar(str, '@')) |at_index| {
        if (at_index != 0) {
            return .{ str[0..at_index], if (at_index + 1 < str.len) str[at_index + 1 ..] else null };
        }

        const second_at_index = (strings.indexOfChar(str[1..], '@') orelse return .{ str, null }) + 1;

        return .{ str[0..second_at_index], if (second_at_index + 1 < str.len) str[second_at_index + 1 ..] else null };
    }

    return .{ str, null };
}

pub fn splitNameAndVersionOrLatest(str: string) struct { string, string } {
    const name, const version = splitNameAndMaybeVersion(str);
    return .{
        name,
        version orelse "latest",
    };
}

pub fn splitNameAndVersion(str: string) error{MissingVersion}!struct { string, string } {
    const name, const version = splitNameAndMaybeVersion(str);
    return .{
        name,
        version orelse return error.MissingVersion,
    };
}

/// assumes version is valid
pub fn withoutBuildTag(version: string) string {
    if (strings.indexOfChar(version, '+')) |plus| return version[0..plus] else return version;
}

pub const Version = struct {
    tag: Tag = .uninitialized,
    literal: String = .{},
    value: Value = .{ .uninitialized = {} },

    pub fn toJS(dep: *const Version, buf: []const u8, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        const object = jsc.JSValue.createEmptyObject(globalThis, 2);
        object.put(globalThis, "type", bun.String.static(@tagName(dep.tag)).toJS(globalThis));

        switch (dep.tag) {
            .dist_tag => {
                object.put(globalThis, "name", try dep.value.dist_tag.name.toJS(buf, globalThis));
                object.put(globalThis, "tag", try dep.value.dist_tag.tag.toJS(buf, globalThis));
            },
            .folder => {
                object.put(globalThis, "folder", try dep.value.folder.toJS(buf, globalThis));
            },
            .git => {
                object.put(globalThis, "owner", try dep.value.git.owner.toJS(buf, globalThis));
                object.put(globalThis, "repo", try dep.value.git.repo.toJS(buf, globalThis));
                object.put(globalThis, "ref", try dep.value.git.committish.toJS(buf, globalThis));
            },
            .github => {
                object.put(globalThis, "owner", try dep.value.github.owner.toJS(buf, globalThis));
                object.put(globalThis, "repo", try dep.value.github.repo.toJS(buf, globalThis));
                object.put(globalThis, "ref", try dep.value.github.committish.toJS(buf, globalThis));
            },
            .npm => {
                object.put(globalThis, "name", try dep.value.npm.name.toJS(buf, globalThis));
                var version_str = try bun.String.createFormat("{}", .{dep.value.npm.version.fmt(buf)});
                object.put(globalThis, "version", version_str.transferToJS(globalThis));
                object.put(globalThis, "alias", jsc.JSValue.jsBoolean(dep.value.npm.is_alias));
            },
            .symlink => {
                object.put(globalThis, "path", try dep.value.symlink.toJS(buf, globalThis));
            },
            .workspace => {
                object.put(globalThis, "name", try dep.value.workspace.toJS(buf, globalThis));
            },
            .tarball => {
                object.put(globalThis, "name", try dep.value.tarball.package_name.toJS(buf, globalThis));
                switch (dep.value.tarball.uri) {
                    .local => |*local| {
                        object.put(globalThis, "path", try local.toJS(buf, globalThis));
                    },
                    .remote => |*remote| {
                        object.put(globalThis, "url", try remote.toJS(buf, globalThis));
                    },
                }
            },
            else => {
                return globalThis.throwTODO("Unsupported dependency type");
            },
        }

        return object;
    }
    pub inline fn npm(this: *const Version) ?NpmInfo {
        return if (this.tag == .npm) this.value.npm else null;
    }

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
        this: *const Version,
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
        if (comptime Environment.allow_assert) bun.assert(lhs.tag == rhs.tag);
        return strings.cmpStringsAsc({}, lhs.literal.slice(string_buf), rhs.literal.slice(string_buf));
    }

    pub fn isLessThanWithTag(string_buf: []const u8, lhs: Dependency.Version, rhs: Dependency.Version) bool {
        const tag_order = lhs.tag.cmp(rhs.tag);
        if (tag_order != .eq)
            return tag_order == .lt;

        return strings.cmpStringsAsc({}, lhs.literal.slice(string_buf), rhs.literal.slice(string_buf));
    }

    pub const External = [9]u8;

    pub fn toVersion(
        alias: String,
        alias_hash: PackageNameHash,
        bytes: Version.External,
        ctx: Dependency.Context,
    ) Dependency.Version {
        const slice = String{ .bytes = bytes[1..9].* };
        const tag = @as(Dependency.Version.Tag, @enumFromInt(bytes[0]));
        const sliced = &slice.sliced(ctx.buffer);
        return NpaBridge.parseWithKnownTag(
            ctx.allocator,
            alias,
            alias_hash,
            sliced.slice,
            tag,
            sliced,
            ctx.log,
            ctx.package_manager,
        ) orelse Dependency.Version.zeroed;
    }

    pub inline fn toExternal(this: Version) Version.External {
        var bytes: Version.External = undefined;
        bytes[0] = @intFromEnum(this.tag);
        bytes[1..9].* = this.literal.bytes;
        return bytes;
    }

    pub inline fn eql(
        lhs: *const Version,
        rhs: *const Version,
        lhs_buf: []const u8,
        rhs_buf: []const u8,
    ) bool {
        if (lhs.tag != rhs.tag) {
            return false;
        }

        return switch (lhs.tag) {
            // if the two versions are identical as strings, it should often be faster to compare that than the actual semver version
            // semver ranges involve a ton of pointer chasing
            .npm => strings.eqlLong(lhs.literal.slice(lhs_buf), rhs.literal.slice(rhs_buf), true) or
                lhs.value.npm.eql(rhs.value.npm, lhs_buf, rhs_buf),
            .folder, .dist_tag => lhs.literal.eql(rhs.literal, lhs_buf, rhs_buf),
            .git => lhs.value.git.eql(&rhs.value.git, lhs_buf, rhs_buf),
            .github => lhs.value.github.eql(&rhs.value.github, lhs_buf, rhs_buf),
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

        /// Local path specified under `workspaces`
        workspace = 6,

        /// Git Repository (via `git` CLI)
        git = 7,

        /// GitHub Repository (via REST API)
        github = 8,

        catalog = 9,

        pub const map = bun.ComptimeStringMap(Tag, .{
            .{ "npm", .npm },
            .{ "dist_tag", .dist_tag },
            .{ "tarball", .tarball },
            .{ "folder", .folder },
            .{ "symlink", .symlink },
            .{ "workspace", .workspace },
            .{ "git", .git },
            .{ "github", .github },
            .{ "catalog", .catalog },
        });
        pub const fromJS = map.fromJS;

        pub fn cmp(this: Tag, other: Tag) std.math.Order {
            // TODO: align with yarn
            return std.math.order(@intFromEnum(this), @intFromEnum(other));
        }

        pub inline fn isNPM(this: Tag) bool {
            return @intFromEnum(this) < 3;
        }

        pub fn inferFromJS(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            const arguments = callframe.arguments_old(1).slice();
            if (arguments.len == 0 or !arguments[0].isString()) {
                return .js_undefined;
            }

            const tag = try Tag.fromJS(globalObject, arguments[0]) orelse return .js_undefined;
            var str = bun.String.init(@tagName(tag));
            return str.transferToJS(globalObject);
        }
    };

    pub const NpmInfo = struct {
        name: String,
        version: Semver.Query.Group,
        is_alias: bool = false,

        fn eql(this: NpmInfo, that: NpmInfo, this_buf: []const u8, that_buf: []const u8) bool {
            return this.name.eql(that.name, this_buf, that_buf) and this.version.eql(that.version);
        }
    };

    pub const TagInfo = struct {
        name: String,
        tag: String,

        fn eql(this: TagInfo, that: TagInfo, this_buf: []const u8, that_buf: []const u8) bool {
            return this.name.eql(that.name, this_buf, that_buf) and this.tag.eql(that.tag, this_buf, that_buf);
        }
    };

    pub const TarballInfo = struct {
        uri: URI,
        package_name: String = .{},

        fn eql(this: TarballInfo, that: TarballInfo, this_buf: []const u8, that_buf: []const u8) bool {
            return this.uri.eql(that.uri, this_buf, that_buf);
        }
    };

    pub const Value = union {
        uninitialized: void,

        npm: NpmInfo,
        dist_tag: TagInfo,
        tarball: TarballInfo,
        folder: String,

        /// Equivalent to npm link
        symlink: String,

        workspace: String,
        git: Repository,
        github: Repository,

        // dep version without 'catalog:' protocol
        // empty string == default catalog
        catalog: String,
    };
};

pub fn eql(
    a: *const Dependency,
    b: *const Dependency,
    lhs_buf: []const u8,
    rhs_buf: []const u8,
) bool {
    return a.name_hash == b.name_hash and a.name.len() == b.name.len() and a.version.eql(&b.version, lhs_buf, rhs_buf);
}

/// Bridge between npm_package_arg.zig and dependency.zig.
///
/// As we migrate away from dependency.zig, this will eventually be removed and simply become
/// npm_package_arg.zig.
pub const NpaBridge = struct {
    /// Helper for converting strings from NpaSpec's arena to Bun's String/SlicedString types.
    /// NpaSpec allocates its own arena for parsed strings, which are not part of the lockfile
    /// buffer. This helper ensures we create self-referential String instances instead of trying
    /// to use sliced.sub() which would panic since the strings aren't substrings of the lockfile
    /// buffer.
    const StringConverter = struct {
        /// Convert an optional NpaSpec string to a String, with fallback
        inline fn stringOrDefault(str: ?[]const u8, default: String) String {
            return if (str) |s| String.init(s, s) else default;
        }

        /// Convert an optional NpaSpec string to a String, with empty string fallback
        inline fn stringOrEmpty(str: ?[]const u8) String {
            return stringOrDefault(str, String.from(""));
        }

        /// Convert a required NpaSpec string to a String
        inline fn string(str: []const u8) String {
            return String.init(str, str);
        }

        /// Convert a required NpaSpec string to a SlicedString
        inline fn sliced(str: []const u8) SlicedString {
            return SlicedString.init(str, str);
        }
    };

    /// Convert NpaSpec to Dependency.Version for git repositories
    fn convertGit(
        spec: *const npm_package_arg.NpaSpec,
        sliced: *const SlicedString,
    ) ?Version {
        const fetch_spec = spec.fetchSpec() orelse return null;

        const fetch_spec_string = StringConverter.string(fetch_spec);
        const name_string = StringConverter.stringOrEmpty(spec.name);

        // Check if this is a GitHub hosted repo
        if (spec.type == .git and spec.type.git.hosted != null) {
            const hosted = spec.type.git.hosted.?;
            if (hosted.host_provider == .github) {
                // Convert to .github type
                return .{
                    .literal = sliced.value(),
                    .value = .{
                        .github = .{
                            .owner = StringConverter.stringOrEmpty(hosted.user),
                            .repo = StringConverter.string(hosted.project),
                            .committish = StringConverter.stringOrEmpty(hosted.committish),
                            .resolved = String.from(""),
                            .package_name = name_string,
                        },
                    },
                    .tag = .github,
                };
            }
        }

        // Generic git repo
        const committish = if (spec.type == .git and spec.type.git.attrs != null)
            StringConverter.stringOrEmpty(spec.type.git.attrs.?.committish)
        else
            String.from("");

        return .{
            .literal = sliced.value(),
            .value = .{
                .git = .{
                    .owner = String.from(""),
                    .repo = fetch_spec_string,
                    .committish = committish,
                    .resolved = String.from(""),
                    .package_name = name_string,
                },
            },
            .tag = .git,
        };
    }

    /// Convert NpaSpec to Dependency.Version for file/directory specs
    fn convertFile(
        spec: *const npm_package_arg.NpaSpec,
        sliced: *const SlicedString,
    ) ?Version {
        const fetch_spec = spec.fetchSpec() orelse return null;

        const fetch_spec_string = StringConverter.string(fetch_spec);
        const name_string = StringConverter.stringOrEmpty(spec.name);

        if (spec.type == .file) {
            // It's a tarball
            return .{
                .tag = .tarball,
                .literal = sliced.value(),
                .value = .{ .tarball = .{
                    .uri = .{ .local = fetch_spec_string },
                    .package_name = name_string,
                } },
            };
        } else {
            // It's a directory
            return .{
                .value = .{ .folder = fetch_spec_string },
                .tag = .folder,
                .literal = sliced.value(),
            };
        }
    }

    /// Convert NpaSpec to Dependency.Version for npm version/range specs
    fn convertNpm(
        allocator: std.mem.Allocator,
        alias: String,
        alias_hash: ?PackageNameHash,
        spec: *const npm_package_arg.NpaSpec,
        sliced: *const SlicedString,
        package_manager: ?*PackageManager,
    ) ?Version {
        const fetch_spec = spec.fetchSpec() orelse "*";

        // Strip single leading v (npa doesn't do this, but Bun does)
        // v1.0.0 -> 1.0.0
        const version_str = if (fetch_spec.len > 1 and fetch_spec[0] == 'v')
            fetch_spec[1..]
        else
            fetch_spec;

        // Parse with Semver
        const version_sliced = StringConverter.sliced(version_str);
        const version = Semver.Query.parse(
            allocator,
            version_str,
            version_sliced,
        ) catch |err| {
            switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            }
        };

        // Determine if this is an alias
        const name = if (spec.type == .alias) blk: {
            if (spec.type.alias.sub_spec.name) |n| {
                break :blk StringConverter.string(n);
            }
            break :blk alias;
        } else if (spec.name) |n|
            StringConverter.string(n)
        else
            alias;

        const is_alias = spec.type == .alias or
            (spec.name != null and alias_hash != null and !name.eql(alias, sliced.buf, sliced.buf));

        const result = Version{
            .literal = sliced.value(),
            .value = .{
                .npm = .{
                    .is_alias = is_alias,
                    .name = name,
                    .version = version,
                },
            },
            .tag = .npm,
        };

        if (is_alias and alias_hash != null) {
            if (package_manager) |pm| {
                pm.known_npm_aliases.put(
                    allocator,
                    alias_hash.?,
                    result,
                ) catch unreachable;
            }
        }

        return result;
    }

    /// Convert NpaSpec to Dependency.Version for dist-tag specs
    fn convertDistTag(
        alias: String,
        spec: *const npm_package_arg.NpaSpec,
        sliced: *const SlicedString,
    ) ?Version {
        const name = StringConverter.stringOrDefault(spec.name, alias);
        const tag = spec.fetchSpec() orelse "latest";

        return .{
            .literal = sliced.value(),
            .value = .{
                .dist_tag = .{
                    .name = name,
                    .tag = StringConverter.string(tag),
                },
            },
            .tag = .dist_tag,
        };
    }

    /// Convert NpaSpec to Dependency.Version for remote tarball specs
    fn convertRemote(
        spec: *const npm_package_arg.NpaSpec,
        sliced: *const SlicedString,
    ) ?Version {
        const fetch_spec = spec.fetchSpec() orelse return null;

        return .{
            .tag = .tarball,
            .literal = sliced.value(),
            .value = .{ .tarball = .{
                .uri = .{ .remote = StringConverter.string(fetch_spec) },
                .package_name = StringConverter.stringOrEmpty(spec.name),
            } },
        };
    }

    /// Convert an already-parsed NpaSpec to Dependency.Version
    pub fn toVersion(
        allocator: std.mem.Allocator,
        alias: String,
        alias_hash: ?PackageNameHash,
        spec: *const npm_package_arg.NpaSpec,
        sliced: *const SlicedString,
        package_manager: ?*PackageManager,
    ) ?Version {
        return switch (spec.type) {
            .git => convertGit(spec, sliced),
            .file, .directory => convertFile(spec, sliced),
            .version, .range => convertNpm(allocator, alias, alias_hash, spec, sliced, package_manager),
            .tag => convertDistTag(alias, spec, sliced),
            .alias => convertNpm(allocator, alias, alias_hash, spec, sliced, package_manager),
            .remote => convertRemote(spec, sliced),
        };
    }

    /// Parse a dependency string using npm_package_arg and convert to Dependency.Version
    pub fn parse(
        allocator: std.mem.Allocator,
        alias: String,
        alias_hash: ?PackageNameHash,
        dependency: string,
        sliced: *const SlicedString,
        log: ?*logger.Log,
        package_manager: ?*PackageManager,
    ) ?Version {
        const where = "."; // Use current directory as base

        var spec = npm_package_arg.npa(allocator, dependency, where) catch |err| {
            if (log) |l| {
                l.addErrorFmt(null, logger.Loc.Empty, allocator, "Failed to parse dependency \"{s}\": {s}", .{ dependency, @errorName(err) }) catch {};
            }
            return null;
        };
        defer spec.deinit();

        return toVersion(allocator, alias, alias_hash, &spec, sliced, package_manager);
    }

    /// Parse workspace: protocol dependency (Bun-specific)
    pub fn parseWorkspace(
        dependency: string,
        sliced: *const SlicedString,
    ) ?Version {
        var input = dependency;
        if (strings.hasPrefixComptime(input, "workspace:")) {
            input = input["workspace:".len..];
        }
        return .{
            .value = .{ .workspace = sliced.sub(input).value() },
            .tag = .workspace,
            .literal = sliced.value(),
        };
    }

    /// Parse catalog: protocol dependency (Bun-specific)
    pub fn parseCatalog(
        dependency: string,
        sliced: *const SlicedString,
    ) ?Version {
        bun.assert(strings.hasPrefixComptime(dependency, "catalog:"));

        const group = dependency["catalog:".len..];
        const trimmed = strings.trim(group, &strings.whitespace_chars);

        return .{
            .value = .{ .catalog = sliced.sub(trimmed).value() },
            .tag = .catalog,
            .literal = sliced.value(),
        };
    }

    /// Parse link: protocol dependency (Bun-specific symlink)
    pub fn parseSymlink(
        dependency: string,
        sliced: *const SlicedString,
    ) ?Version {
        if (strings.indexOfChar(dependency, ':')) |colon| {
            return .{
                .value = .{ .symlink = sliced.sub(dependency[colon + 1 ..]).value() },
                .tag = .symlink,
                .literal = sliced.value(),
            };
        }

        return .{
            .value = .{ .symlink = sliced.value() },
            .tag = .symlink,
            .literal = sliced.value(),
        };
    }

    /// Parse dependency with a pre-determined tag (for deserialization/re-cloning)
    pub fn parseWithKnownTag(
        allocator: std.mem.Allocator,
        alias: String,
        alias_hash: ?PackageNameHash,
        dependency: string,
        tag: Version.Tag,
        sliced: *const SlicedString,
        log: ?*logger.Log,
        package_manager: ?*PackageManager,
    ) ?Version {
        // Handle Bun-specific tags directly
        switch (tag) {
            .workspace => return parseWorkspace(dependency, sliced),
            .catalog => return parseCatalog(dependency, sliced),
            .symlink => return parseSymlink(dependency, sliced),
            .uninitialized => return null,
            else => {},
        }

        // For npm-compatible tags, use npm_package_arg
        // It will infer the tag from the dependency string
        return NpaBridge.parse(
            allocator,
            alias,
            alias_hash,
            dependency,
            sliced,
            log,
            package_manager,
        );
    }

    /// Parse dependency with an optional pre-determined tag.
    /// If tag is null, infer it from the dependency string.
    /// If tag is non-null, use it directly.
    pub fn parseWithOptionalTag(
        allocator: std.mem.Allocator,
        alias: String,
        alias_hash: ?PackageNameHash,
        dependency: string,
        tag: ?Version.Tag,
        sliced: *const SlicedString,
        log: ?*logger.Log,
        package_manager: ?*PackageManager,
    ) ?Version {
        return if (tag) |known_tag|
            parseWithKnownTag(
                allocator,
                alias,
                alias_hash,
                dependency,
                known_tag,
                sliced,
                log,
                package_manager,
            )
        else
            NpaBridge.parse(
                allocator,
                alias,
                alias_hash,
                dependency,
                sliced,
                log,
                package_manager,
            );
    }

    /// Infer the Version.Tag for a dependency string using npm_package_arg.
    ///
    /// This replaces the legacy Tag.infer() function with npm-compatible parsing.
    /// Uses a stack allocator to avoid heap allocations for temporary parsing.
    pub fn inferTag(dependency: string) Version.Tag {
        const dep = std.mem.trimLeft(u8, dependency, " \t\n\r");
        if (dep.len == 0) return .dist_tag;

        // Handle Bun-specific protocols that npm_package_arg doesn't know about
        if (strings.hasPrefixComptime(dep, "workspace:")) return .workspace;
        if (strings.hasPrefixComptime(dep, "catalog:")) return .catalog;
        if (strings.hasPrefixComptime(dep, "link:")) return .symlink;

        // Use a stack allocator for temporary parsing (avoids heap allocation)
        var stack_fallback = std.heap.stackFallback(2048, bun.default_allocator);
        const allocator = stack_fallback.get();

        var spec = npm_package_arg.npa(allocator, dep, ".") catch {
            // If parsing fails, default to dist_tag (safest fallback)
            return .dist_tag;
        };

        defer spec.deinit();

        // Determine the tag by reading the type before deinit
        const result = switch (spec.type) {
            .git => blk: {
                // CRITICAL: Distinguish GitHub from generic git
                if (spec.type.git.hosted) |hosted| {
                    if (hosted.host_provider == .github) {
                        break :blk Version.Tag.github;
                    }
                }
                break :blk Version.Tag.git;
            },
            .file => Version.Tag.tarball,
            .directory => Version.Tag.folder,
            .version, .range => Version.Tag.npm,
            .tag => Version.Tag.dist_tag,
            .alias => Version.Tag.npm, // Aliases resolve to npm packages
            .remote => Version.Tag.tarball,
        };

        return result;
    }

    /// Check if a path string refers to a tarball file (.tgz, .tar.gz, .tar).
    ///
    /// This uses npm_package_arg's file type detection which is case-insensitive
    /// and handles all standard tarball extensions.
    pub inline fn isTarballPath(dependency: string) bool {
        return npm_package_arg.NpaSpec.Type.fromInodePath(dependency) == .file;
    }

    /// Check if a URL string is a remote HTTP(S) URL.
    ///
    /// This replaces legacy isRemoteTarball() and consolidates duplicate implementations.
    /// Uses npm_package_arg's protocol detection for http:// and https:// URLs.
    pub inline fn isRemoteUrl(url: string) bool {
        return strings.hasPrefixComptime(url, "https://") or strings.hasPrefixComptime(url, "http://");
    }

    /// Check if a string matches Git SCP-like path syntax: user@host.domain:path
    ///
    /// This uses npm_package_arg's Git detection which requires:
    /// - @ symbol present
    /// - Hostname with a dot (e.g., github.com)
    /// - Colon separator before path
    ///
    /// Matches pattern: /^[^@]+@[^:.]+\.[^:]+:.+$/i
    /// Examples: git@github.com:user/repo, user@gitlab.com:path/to/repo.git
    pub inline fn isGitSCPPath(spec: string) bool {
        return npm_package_arg.SpecStrUtils.isGit(spec);
    }

    /// Check if a package name is scoped (starts with @org/).
    ///
    /// This is a temporary wrapper that uses npm_package_arg internally for validation.
    /// Returns error.InvalidPackageName if the name is empty or malformed.
    /// Returns true if properly scoped (@org/package), false if unscoped (package).
    pub fn isScopedPackageName(name: string) error{InvalidPackageName}!bool {
        if (name.len == 0) return error.InvalidPackageName;
        if (name[0] != '@') return false;

        // Use npa to validate the package name format
        var stack_fallback = std.heap.stackFallback(512, bun.default_allocator);
        const allocator = stack_fallback.get();

        var spec = npm_package_arg.npa(allocator, name, ".") catch {
            return error.InvalidPackageName;
        };
        defer spec.deinit();

        // Check if it has a scope using npa's scope() function
        const has_scope = spec.scope() != null;

        // If it starts with @ but has no scope, it's malformed
        if (!has_scope) return error.InvalidPackageName;

        return true;
    }

    /// Get the unscoped part of a package name.
    ///
    /// Examples:
    /// - "@org/package" -> "package"
    /// - "package" -> "package"
    pub inline fn unscopedPackageName(name: string) string {
        if (name.len == 0 or name[0] != '@') return name;

        const slash_idx = strings.indexOfChar(name[1..], '/') orelse return name;
        return name[slash_idx + 2 ..]; // +2 to skip the '/' itself
    }
};

pub inline fn parse(
    allocator: std.mem.Allocator,
    alias: String,
    alias_hash: ?PackageNameHash,
    dependency: string,
    sliced: *const SlicedString,
    log: ?*logger.Log,
    manager: ?*PackageManager,
) ?Version {
    const dep = std.mem.trimLeft(u8, dependency, " \t\n\r");

    // Handle Bun-specific protocols that npm_package_arg doesn't know about
    if (strings.hasPrefixComptime(dep, "workspace:")) {
        return NpaBridge.parseWorkspace(dep, sliced);
    }
    if (strings.hasPrefixComptime(dep, "catalog:")) {
        return NpaBridge.parseCatalog(dep, sliced);
    }
    if (strings.hasPrefixComptime(dep, "link:")) {
        return NpaBridge.parseSymlink(dep, sliced);
    }

    // Use npm_package_arg for everything else
    return NpaBridge.parse(allocator, alias, alias_hash, dep, sliced, log, manager);
}

pub fn fromJS(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(2).slice();
    if (arguments.len == 1) {
        return try bun.install.PackageManager.UpdateRequest.fromJS(globalThis, arguments[0]);
    }
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack.get();

    const alias_value: jsc.JSValue = if (arguments.len > 0) arguments[0] else .js_undefined;

    if (!alias_value.isString()) {
        return .js_undefined;
    }
    const alias_slice = try alias_value.toSlice(globalThis, allocator);
    defer alias_slice.deinit();

    if (alias_slice.len == 0) {
        return .js_undefined;
    }

    const name_value: jsc.JSValue = if (arguments.len > 1) arguments[1] else .js_undefined;
    const name_slice = try name_value.toSlice(globalThis, allocator);
    defer name_slice.deinit();

    var name = alias_slice.slice();
    var alias = alias_slice.slice();

    var buf = alias;

    if (name_value.isString()) {
        var builder = bun.handleOom(bun.StringBuilder.initCapacity(allocator, name_slice.len + alias_slice.len));
        name = builder.append(name_slice.slice());
        alias = builder.append(alias_slice.slice());
        buf = builder.allocatedSlice();
    }

    var log = logger.Log.init(allocator);
    const sliced = SlicedString.init(buf, name);

    const dep: Version = Dependency.parse(allocator, SlicedString.init(buf, alias).value(), null, buf, &sliced, &log, null) orelse {
        if (log.msgs.items.len > 0) {
            return globalThis.throwValue(try log.toJS(globalThis, bun.default_allocator, "Failed to parse dependency"));
        }

        return .js_undefined;
    };

    if (log.msgs.items.len > 0) {
        return globalThis.throwValue(try log.toJS(globalThis, bun.default_allocator, "Failed to parse dependency"));
    }
    log.deinit();

    return dep.toJS(buf, globalThis);
}

pub const Behavior = packed struct(u8) {
    _unused_1: u1 = 0,
    prod: bool = false,
    optional: bool = false,
    dev: bool = false,
    peer: bool = false,
    workspace: bool = false,
    /// Is not set for transitive bundled dependencies
    bundled: bool = false,
    _unused_2: u1 = 0,

    pub inline fn isProd(this: Behavior) bool {
        return this.prod;
    }

    pub inline fn isOptional(this: Behavior) bool {
        return this.optional and !this.peer;
    }

    pub inline fn isOptionalPeer(this: Behavior) bool {
        return this.optional and this.peer;
    }

    pub inline fn isDev(this: Behavior) bool {
        return this.dev;
    }

    pub inline fn isPeer(this: Behavior) bool {
        return this.peer;
    }

    pub inline fn isWorkspace(this: Behavior) bool {
        return this.workspace;
    }

    pub inline fn isBundled(this: Behavior) bool {
        return this.bundled;
    }

    pub inline fn eq(lhs: Behavior, rhs: Behavior) bool {
        return @as(u8, @bitCast(lhs)) == @as(u8, @bitCast(rhs));
    }

    pub inline fn includes(lhs: Behavior, rhs: Behavior) bool {
        return @as(u8, @bitCast(lhs)) & @as(u8, @bitCast(rhs)) != 0;
    }

    pub inline fn add(this: Behavior, kind: @Type(.enum_literal)) Behavior {
        var new = this;
        @field(new, @tagName(kind)) = true;
        return new;
    }

    pub inline fn set(this: Behavior, kind: @Type(.enum_literal), value: bool) Behavior {
        var new = this;
        @field(new, @tagName(kind)) = value;
        return new;
    }

    pub inline fn cmp(lhs: Behavior, rhs: Behavior) std.math.Order {
        if (eq(lhs, rhs)) {
            return .eq;
        }

        if (lhs.isWorkspace() != rhs.isWorkspace()) {
            // ensure workspaces are placed at the beginning
            return if (lhs.isWorkspace())
                .lt
            else
                .gt;
        }

        if (lhs.isDev() != rhs.isDev()) {
            return if (lhs.isDev())
                .lt
            else
                .gt;
        }

        if (lhs.isOptional() != rhs.isOptional()) {
            return if (lhs.isOptional())
                .lt
            else
                .gt;
        }

        if (lhs.isProd() != rhs.isProd()) {
            return if (lhs.isProd())
                .lt
            else
                .gt;
        }

        if (lhs.isPeer() != rhs.isPeer()) {
            return if (lhs.isPeer())
                .lt
            else
                .gt;
        }

        return .eq;
    }

    pub inline fn isRequired(this: Behavior) bool {
        return !isOptional(this);
    }

    pub fn isEnabled(this: Behavior, features: Features) bool {
        return this.isProd() or
            (features.optional_dependencies and this.isOptional()) or
            (features.dev_dependencies and this.isDev()) or
            (features.peer_dependencies and this.isPeer()) or
            (features.workspaces and this.isWorkspace());
    }

    comptime {
        bun.assert(@as(u8, @bitCast(Behavior{ .prod = true })) == (1 << 1));
        bun.assert(@as(u8, @bitCast(Behavior{ .optional = true })) == (1 << 2));
        bun.assert(@as(u8, @bitCast(Behavior{ .dev = true })) == (1 << 3));
        bun.assert(@as(u8, @bitCast(Behavior{ .peer = true })) == (1 << 4));
        bun.assert(@as(u8, @bitCast(Behavior{ .workspace = true })) == (1 << 5));
    }
};

const string = []const u8;

const Environment = @import("../env.zig");
const npm_package_arg = @import("./npm_package_arg.zig");
const std = @import("std");
const Repository = @import("./repository.zig").Repository;

const Install = @import("./install.zig");
const Features = Install.Features;
const PackageManager = Install.PackageManager;
const PackageNameHash = Install.PackageNameHash;

const bun = @import("bun");
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;

const Semver = bun.Semver;
const SlicedString = Semver.SlicedString;
const String = Semver.String;
