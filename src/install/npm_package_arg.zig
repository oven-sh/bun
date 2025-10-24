//! Package which attempts to clone the npm-package-arg library for Node.js. It mimics the behavior
//! of the original library as closely as possible.
//!
//! The code is quite complex since it really encodes both a parser and a validator, all in one go.
//! I've done this in an attempt to mimic the original library implementation as closely as
//! possible, but it became apparent that this was a poor choice.
//!
//! Moving forward, I there would be value in making a comptime regex engine like so, perhaps:
//! https://github.com/hanickadot/compile-time-regular-expressions, and that would serve to clean
//! up the library by a large amount, all while keeping it very similar to the source javascript.

/// Owns all of its memory.
///
/// Owning its own memory is necessary because NpaSpecs can be nested in the alias type case.
pub const NpaSpec = struct {
    const Self = @This();

    /// The original unmodified input string.
    raw: []const u8,

    /// The package name, if any. URLs resolve to null.
    name: ?[]const u8,

    /// Contains the original specifier string (the part after the '@' in name@spec).
    raw_spec: []const u8,

    /// The spec string formatted for saving to package.json
    save_spec: ?[]const u8,

    /// Encodes additional information on the type of specifier.
    type: Type,

    _allocator: std.mem.Allocator,
    /// Single arena buffer containing all owned strings (raw, name, raw_spec, save_spec,
    /// fetch_spec). All string fields are slices into this buffer (or null)
    _arena_buffer: ?[]u8,
    /// The fetch spec slice (may be null, or a slice into arena_buffer or raw_spec)
    _fetch_spec_slice: ?[]const u8,

    pub const Type = union(enum) {
        /// Package is fetched from a git repository, eg. `git+https://...`, `git+ssh://...`,
        /// `github:...`
        git: struct {
            attrs: ?GitAttrs,
            hosted: ?HostedGitInfo,

            pub fn clone(self: *const Self) !@This() {
                return .{
                    .attrs = if (self.attrs) |a| try a.clone(self._allocator) else null,
                    .hosted = if (self.hosted) |h| try h.clone(self._allocator) else null,
                };
            }

            pub fn deinit(self: *@This(), _: std.mem.Allocator) void {
                if (self.hosted) |*h| h.deinit();
                if (self.attrs) |*a| a.deinit();
            }
        },
        /// Package is fetched from a local file (tarball or directory), eg. `file:...`,
        /// `../some/path`, `./some/path`.
        file,
        /// Package is fetched from a local directory (not a tarball), eg. `../some/dir`,
        directory,
        /// Package is fetched from the npm registry with an exact version, eg. `lodash@1.2.3`
        version,
        /// Package is fetched from the npm registry with a semver range, eg. `lodash@^1.2.3`
        range,
        /// Package is fetched from the npm registry with a tag, eg. `lodash@latest`
        tag,
        /// Package is fetched from the npm registry with an alias, eg. `alias@npm:lodash@^1.2.3`.
        alias: struct {
            // TODO(markovejnovic): This is actually a slightly lazy implementation -- sub_spec
            //                      does not actually need to be a pointer, since alias specs
            //                      cannot be nested. A less lazy implementation could embed an
            //                      "AliasedNpaSpec" struct here, which omits the alias type case.
            //                      That saves a pointer dereference and an allocation.
            sub_spec: *NpaSpec,
            allocator: std.mem.Allocator,

            pub fn clone(self: *const Self) !@This() {
                return .{
                    .sub_spec = try self.sub_spec.clone(),
                    .allocator = self.allocator,
                };
            }

            pub fn deinit(self: *@This()) void {
                self.sub_spec.deinit();
                self.allocator.destroy(self.sub_spec);
            }
        },
        /// Package is fetched from a remote URL, eg. `http://...`, `https://...`
        remote,

        /// Determine whether the spec refers to a file.
        /// Equivalent to /[.](?:tgz|tar\.gz|tar)$/i
        pub fn fromInodePath(spec_str: []const u8) Type {
            const file_extensions = [_][]const u8{ ".tgz", ".tar.gz", ".tar" };
            inline for (file_extensions) |ext| {
                if (bun.strings.endsWithCaseInsensitive(spec_str, ext)) {
                    return .file;
                }
            }

            return .directory;
        }
    };

    /// The caller is responsible for freeing the resulting slice.
    pub fn escapedName(self: *const Self, allocator: std.mem.Allocator) !?[]u8 {
        if (self.name) |n| {
            const size = std.mem.replacementSize(u8, n, "/", "%2f");
            const result = try allocator.alloc(u8, size);
            _ = std.mem.replace(u8, n, "/", "%2f", result);
            return result;
        }

        return null;
    }

    /// Returns a string representation of the type enum.
    pub fn typeStr(self: *const Self) []const u8 {
        return @tagName(self.type);
    }

    /// Returns true if this spec is one of the types referring to the npm registry.
    pub fn isRegistry(self: *const Self) bool {
        return switch (self.type) {
            .version, .range, .tag, .alias => true,
            else => false,
        };
    }

    pub fn clone(self: *const Self) !NpaSpec {
        return .{
            ._allocator = self._allocator,
            ._arena_buffer = if (self._arena_buffer) |buf| self._allocator.dupe(u8, buf) else null,
            .type = switch (self.type) {
                .git => |*g| try .git(g.clone()),
                .alias => |*a| try .alias(a.clone()),
                else => self.type,
            },
        };
    }

    pub fn deinit(self: *Self) void {
        if (self._arena_buffer) |arena| {
            self._allocator.free(arena);
        }

        switch (self.type) {
            .git => |*g| g.deinit(self._allocator),
            .alias => |*a| a.deinit(),
            else => {},
        }
    }

    /// If a name is something like @org/module then the scope field will be
    /// set to @org. If it doesn't have a scoped name, then scope is null.
    pub fn scope(self: *const Self) ?[]const u8 {
        const pkg_name = self.name orelse return null;

        if (pkg_name.len == 0 or pkg_name[0] != '@') {
            return null;
        }

        const slash_idx = bun.strings.indexOfChar(pkg_name, '/') orelse return null;
        return pkg_name[0..slash_idx];
    }

    /// Returns the fetch spec string (the path or URL which would be used to fetch the package).
    pub fn fetchSpec(self: *const Self) ?[]const u8 {
        return self._fetch_spec_slice;
    }

    /// Convert this NpaSpec to a JavaScript object
    pub fn toJS(
        self: *const Self,
        allocator: std.mem.Allocator,
        go: *jsc.JSGlobalObject,
    ) jsc.JSValue {
        var object = jsc.JSValue.createEmptyObject(go, 8);

        object.put(go, "raw", bun.String.fromBytes(self.raw).toJS(go));
        object.put(go, "rawSpec", bun.String.fromBytes(self.raw_spec).toJS(go));
        object.put(go, "name", if (self.name) |n| bun.String.fromBytes(n).toJS(go) else .null);
        object.put(go, "type", bun.String.fromBytes(self.typeStr()).toJS(go));

        object.put(
            go,
            "fetchSpec",
            if (self.fetchSpec()) |f| bun.String.fromBytes(f).toJS(go) else .null,
        );
        object.put(
            go,
            "saveSpec",
            if (self.save_spec) |s| bun.String.fromBytes(s).toJS(go) else .null,
        );

        const escaped_name = bun.handleOom(self.escapedName(allocator));
        defer if (escaped_name) |e| allocator.free(e);
        object.put(
            go,
            "escapedName",
            if (escaped_name) |n| bun.String.fromBytes(n).toJS(go) else .null,
        );

        object.put(
            go,
            "scope",
            if (self.scope()) |s| bun.String.fromBytes(s).toJS(go) else .null,
        );

        if (self.type == .git) {
            if (self.type.git.attrs) |*attrs| {
                object.put(
                    go,
                    "gitCommittish",
                    if (attrs.committish) |gc| bun.String.fromBytes(gc).toJS(go) else .null,
                );
                object.put(
                    go,
                    "gitRange",
                    if (attrs.range) |gr| bun.String.fromBytes(gr).toJS(go) else .null,
                );
                object.put(
                    go,
                    "gitSubdir",
                    if (attrs.subdir) |gs| bun.String.fromBytes(gs).toJS(go) else .null,
                );
            } else {
                object.put(go, "gitCommittish", .null);
                object.put(go, "gitRange", .null);
                object.put(go, "gitSubdir", .null);
            }

            if (self.type.git.hosted) |*hosted| {
                object.put(go, "hosted", hosted.toJS(go));
            } else {
                object.put(go, "hosted", .null);
            }
        }

        if (self.type == .alias) {
            const sub_spec_js = self.type.alias.sub_spec.toJS(allocator, go);
            object.put(go, "subSpec", sub_spec_js);
        }

        if (self.isRegistry()) {
            object.put(go, "registry", .true);
        }

        return object;
    }

    /// Calculate size needed for raw field. Useful for pre-computing StringArena size.
    fn rawFieldLength(raw_arg: ?[]const u8, name: ?[]const u8, raw_spec: []const u8) usize {
        return if (raw_arg) |arg|
            arg.len
        else if (name) |n|
            n.len + 1 + raw_spec.len
        else
            raw_spec.len;
    }

    const StringArena = struct {
        buffer: []u8,
        offset: usize,

        fn init(buffer: []u8) StringArena {
            return .{ .buffer = buffer, .offset = 0 };
        }

        fn copyString(self: *StringArena, str: []const u8) []const u8 {
            bun.debugAssert(self.offset + str.len <= self.buffer.len);

            @memcpy(self.buffer[self.offset..][0..str.len], str);
            const slice = self.buffer[self.offset..][0..str.len];
            self.offset += str.len;
            return slice;
        }

        fn maybeCopy(self: *StringArena, str: ?[]const u8) ?[]const u8 {
            return if (str) |s| self.copyString(s) else null;
        }

        fn copyRawField(
            self: *StringArena,
            raw_arg: ?[]const u8,
            name: ?[]const u8,
            raw_spec: []const u8,
        ) []const u8 {
            const start = self.offset;
            if (raw_arg) |arg| {
                _ = self.copyString(arg);
            } else if (name) |n| {
                _ = self.copyString(n);
                bun.debugAssert(self.offset < self.buffer.len);
                self.buffer[self.offset] = '@';
                self.offset += 1;
                _ = self.copyString(raw_spec);
            } else {
                _ = self.copyString(raw_spec);
            }
            return self.buffer[start..self.offset];
        }
    };

    /// Given a URL-like spec, parses it into an NpaSpec.
    fn fromUrl(
        allocator: std.mem.Allocator,
        name: ?[]const u8,
        raw_spec: []const u8,
        raw_arg: ?[]const u8,
    ) !NpaSpec {
        var raw_spec_mut = raw_spec;
        var raw_spec_to_free: ?[]const u8 = null;
        defer if (raw_spec_to_free) |s| allocator.free(s);

        // Regex: /^git\+ssh:\/\/([^:#]+:[^#]+(?:\.git)?)(?:#(.*))?$/i
        // Looking for: git+ssh://user@host:path (not git+ssh://host:port/path)
        if (SpecStrUtils.gitScpExtractFragmentCommittish(raw_spec)) |scp_result| {
            if (!SpecStrUtils.containsPortNumber(scp_result.fragment)) {
                var arena_size: usize = rawFieldLength(raw_arg, name, raw_spec);
                arena_size += raw_spec.len + scp_result.fragment.len;
                if (name) |n| arena_size += n.len;

                const buffer = try allocator.alloc(u8, arena_size);
                errdefer allocator.free(buffer);

                var arena = StringArena.init(buffer);

                const raw_slice = arena.copyRawField(raw_arg, name, raw_spec);
                const name_slice = arena.maybeCopy(name);
                const raw_spec_slice = arena.copyString(raw_spec);
                const fetch_spec_slice = arena.copyString(scp_result.fragment);

                var git_attrs = if (scp_result.committish) |c|
                    try GitAttrs.fromCommittish(allocator, c)
                else
                    null;
                errdefer if (git_attrs) |*a| a.deinit();

                return .{
                    .raw = raw_slice,
                    .name = name_slice,
                    .raw_spec = raw_spec_slice,
                    ._arena_buffer = arena.buffer,
                    ._fetch_spec_slice = fetch_spec_slice,
                    .save_spec = raw_spec_slice,
                    .type = .{
                        .git = .{
                            .hosted = null,
                            .attrs = git_attrs,
                        },
                    },
                    ._allocator = allocator,
                };
            }
        }

        if (bun.strings.hasPrefixCaseInsensitive(raw_spec, "git+file://")) {
            if (bun.Environment.isWindows) {
                const normalized = try normalizeWindowsPath(allocator, raw_spec);
                raw_spec_mut = normalized;
                raw_spec_to_free = normalized;
            }
        }

        const parsed_url = bun.jsc.URL.fromString(bun.String.init(raw_spec_mut)) orelse {
            return error.InvalidURL;
        };
        defer parsed_url.deinit();

        const protocol_slice = try parsed_url.protocol().toOwnedSlice(allocator);
        defer allocator.free(protocol_slice);

        const protocol_type = WellDefinedProtocol.strings.get(protocol_slice) orelse {
            return error.InvalidURL;
        };

        switch (protocol_type) {
            .http, .https => {
                var arena_size: usize = rawFieldLength(raw_arg, name, raw_spec);
                arena_size += raw_spec.len;
                arena_size += raw_spec_mut.len;
                if (name) |n| arena_size += n.len;

                const buffer = try allocator.alloc(u8, arena_size);
                errdefer allocator.free(buffer);

                var arena = StringArena.init(buffer);

                const raw_slice = arena.copyRawField(raw_arg, name, raw_spec);
                const name_slice = arena.maybeCopy(name);
                const raw_spec_slice = arena.copyString(raw_spec);
                const save_spec_slice = arena.copyString(raw_spec_mut);

                return .{
                    .raw = raw_slice,
                    .name = name_slice,
                    .raw_spec = raw_spec_slice,
                    ._arena_buffer = arena.buffer,
                    ._fetch_spec_slice = raw_spec_slice,
                    .save_spec = save_spec_slice,
                    .type = .remote,
                    ._allocator = allocator,
                };
            },

            .git,
            .git_plus_http,
            .git_plus_https,
            .git_plus_rsync,
            .git_plus_ftp,
            .git_plus_file,
            .git_plus_ssh,
            .ssh,
            => {
                const fetch_spec_temp = if (protocol_type == .git_plus_file) blk: {
                    const after_protocol = raw_spec_mut["git+file://".len..];

                    const starts_w32_drive_letter = if (comptime bun.Environment.isWindows)
                        bun.strings.startsWithWindowsDriveLetter(after_protocol)
                    else
                        false;

                    if (starts_w32_drive_letter) {
                        const parts = try SpecStrUtils.extractHostAndPathnameWithLowercaseHost(
                            allocator,
                            parsed_url,
                        );
                        defer parts.deinit(allocator);

                        if (parts.host_lower.len == 1 and
                            std.ascii.isAlphabetic(parts.host_lower[0]))
                        {
                            break :blk try std.fmt.allocPrint(allocator, "git+file://{s}:{s}", .{
                                parts.host_lower,
                                parts.pathname,
                            });
                        }
                        // Not actually a drive letter, fall through to standard handling
                    }
                    break :blk try SpecStrUtils.getUrlHrefWithoutHash(allocator, parsed_url);
                } else try SpecStrUtils.getUrlHrefWithoutHash(allocator, parsed_url);
                defer allocator.free(fetch_spec_temp);

                const fetch_spec_stripped = bun.strings.withoutPrefixComptime(
                    fetch_spec_temp,
                    "git+",
                );

                var arena_size: usize = rawFieldLength(raw_arg, name, raw_spec);
                arena_size += raw_spec.len + fetch_spec_stripped.len;
                arena_size += raw_spec_mut.len;
                if (name) |n| arena_size += n.len;

                const buffer = try allocator.alloc(u8, arena_size);
                errdefer allocator.free(buffer);

                var arena = StringArena.init(buffer);

                const raw_slice = arena.copyRawField(raw_arg, name, raw_spec);
                const name_slice = arena.maybeCopy(name);
                const raw_spec_slice = arena.copyString(raw_spec);
                const fetch_spec_slice = arena.copyString(fetch_spec_stripped);
                const save_spec_slice = arena.copyString(raw_spec_mut);

                var git_attrs = try GitAttrs.fromUrl(allocator, parsed_url);
                errdefer if (git_attrs) |*a| a.deinit();

                return .{
                    .raw = raw_slice,
                    .name = name_slice,
                    .raw_spec = raw_spec_slice,
                    ._arena_buffer = arena.buffer,
                    ._fetch_spec_slice = fetch_spec_slice,
                    .save_spec = save_spec_slice,
                    .type = .{
                        .git = .{
                            .attrs = git_attrs,
                            .hosted = null,
                        },
                    },
                    ._allocator = allocator,
                };
            },

            // Shortcut protocols (github:, gitlab:, etc.) are not valid in fromUrl
            // They should be handled by fromHosted before reaching this point
            else => {
                return error.InvalidURL;
            },
        }
    }

    /// Parses a spec which is assumed to be a registry spec. Matches `fromRegistry` in npa.js.
    ///
    /// Borrows all arguments.
    fn fromRegistry(
        allocator: std.mem.Allocator,
        name: ?[]const u8,
        raw_spec: []const u8,
        raw_arg: ?[]const u8,
    ) !NpaSpec {
        const trimmed = bun.strings.trimSpaces(raw_spec);

        var arena_size: usize = rawFieldLength(raw_arg, name, raw_spec);
        arena_size += raw_spec.len + trimmed.len;
        if (name) |n| arena_size += n.len;

        const buffer = try allocator.alloc(u8, arena_size);
        errdefer allocator.free(buffer);

        var arena = StringArena.init(buffer);

        const raw_slice = arena.copyRawField(raw_arg, name, raw_spec);
        const name_slice = arena.maybeCopy(name);
        const raw_spec_slice = arena.copyString(raw_spec);
        const fetch_spec_slice = arena.copyString(trimmed);

        var res: NpaSpec = .{
            .raw = raw_slice,
            .name = name_slice,
            .raw_spec = raw_spec_slice,
            ._arena_buffer = arena.buffer,
            ._fetch_spec_slice = fetch_spec_slice,
            .save_spec = null,
            .type = undefined,
            ._allocator = allocator,
        };

        const query = Semver.Query.parse(
            allocator,
            trimmed,
            Semver.SlicedString.init(trimmed, trimmed),
        ) catch {
            if (bun.strings.indexOfNeedsURLEncode(trimmed) != null) {
                return error.InvalidRegistrySpec;
            }
            res.type = .tag;
            return res;
        };
        defer query.deinit();

        if (query.isEmpty()) {
            if (bun.strings.indexOfNeedsURLEncode(trimmed) != null) {
                return error.InvalidRegistrySpec;
            }
            res.type = .tag;
            return res;
        }

        res.type = if (query.isExact()) .version else .range;
        return res;
    }

    /// Parses a spec which is assumed to be an alias spec. Matches `fromAlias` in npa.js.
    fn fromAlias(
        allocator: std.mem.Allocator,
        name: ?[]const u8,
        raw_spec: []const u8,
        where: []const u8,
        raw_arg: ?[]const u8,
    ) NpaError!NpaSpec {
        var sub_spec = try npa(allocator, raw_spec["npm:".len..], where);
        errdefer sub_spec.deinit();

        if (sub_spec.type == .alias) {
            return error.NestedAlias;
        }

        if (!sub_spec.isRegistry()) {
            return error.NotAliasingRegistry;
        }

        if (sub_spec.name == null) {
            return error.AliasMissingName;
        }

        // TODO(markovejnovic): This allocation is a consequence of the lazy implementation. See
        //                      the documentation around the alias type variant.
        const sub_spec_ptr = try allocator.create(NpaSpec);
        errdefer allocator.destroy(sub_spec_ptr);
        sub_spec_ptr.* = sub_spec;

        var arena_size: usize = rawFieldLength(raw_arg, name, raw_spec);
        arena_size += raw_spec.len;
        if (name) |n| arena_size += n.len;

        const buffer = try allocator.alloc(u8, arena_size);
        errdefer allocator.free(buffer);

        var arena = StringArena.init(buffer);

        const raw_slice = arena.copyRawField(raw_arg, name, raw_spec);
        const name_slice = arena.maybeCopy(name);
        const raw_spec_slice = arena.copyString(raw_spec);

        return .{
            .raw = raw_slice,
            .name = name_slice,
            .raw_spec = raw_spec_slice,
            ._arena_buffer = arena.buffer,
            ._fetch_spec_slice = null,
            .save_spec = null,
            .type = .{
                .alias = .{
                    .sub_spec = sub_spec_ptr,
                    .allocator = allocator,
                },
            },
            ._allocator = allocator,
        };
    }

    fn fromGitSpec(
        allocator: std.mem.Allocator,
        name: ?[]const u8,
        raw_spec: []const u8,
        raw_arg: ?[]const u8,
    ) !?NpaSpec {
        const mut_spec_str: []u8 = try allocator.dupe(u8, raw_spec);
        defer allocator.free(mut_spec_str);

        var hosted = try HostedGitInfo.fromUrl(allocator, mut_spec_str) orelse {
            return null;
        };
        errdefer hosted.deinit();

        var git_attrs = if (hosted.committish) |c|
            try GitAttrs.fromCommittish(allocator, c)
        else
            null;
        errdefer if (git_attrs) |*g| g.deinit();

        const specs = try hosted.toStringBoth(allocator);
        defer allocator.free(specs.save_spec);
        defer if (specs.fetch_spec) |f| allocator.free(f);

        var arena_size: usize = rawFieldLength(raw_arg, name, raw_spec);
        arena_size += mut_spec_str.len + specs.save_spec.len;
        if (name) |n| arena_size += n.len;
        if (specs.fetch_spec) |f| arena_size += f.len;

        const buffer = try allocator.alloc(u8, arena_size);
        errdefer allocator.free(buffer);

        var arena = StringArena.init(buffer);

        const raw_slice = arena.copyRawField(raw_arg, name, raw_spec);
        const name_slice = arena.maybeCopy(name);
        const raw_spec_slice = arena.copyString(mut_spec_str);
        const save_spec_slice = arena.copyString(specs.save_spec);
        const fetch_spec_slice = if (specs.fetch_spec) |f|
            arena.copyString(f)
        else
            null;

        return .{
            .raw = raw_slice,
            .name = name_slice,
            .raw_spec = raw_spec_slice,
            ._arena_buffer = arena.buffer,
            ._fetch_spec_slice = fetch_spec_slice,
            .save_spec = save_spec_slice,
            .type = .{
                .git = .{
                    .attrs = git_attrs,
                    .hosted = hosted,
                },
            },
            ._allocator = allocator,
        };
    }

    fn fromFile(
        allocator: std.mem.Allocator,
        name: ?[]const u8,
        raw_spec: []const u8,
        where: []const u8,
        raw_arg: ?[]const u8,
    ) !Self {
        const stack_fallback_bytes = 8192;

        var stack_fallback = std.heap.stackFallback(stack_fallback_bytes, allocator);
        const temp = stack_fallback.get();

        var raw_spec_cleaned = PathToFileUrlUtils.cleanPathToFileUrl(temp, raw_spec) catch {
            return error.InvalidPath;
        };
        defer temp.free(raw_spec_cleaned);

        // Turn file://path into file:/path
        var raw_spec_cleanest = raw_spec_cleaned;
        defer if (raw_spec_cleanest.ptr != raw_spec_cleaned.ptr) temp.free(raw_spec_cleanest);
        if (bun.strings.hasPrefixComptime(raw_spec_cleaned, "file://") and
            bun.strings.charAtT(u8, raw_spec_cleaned, 7) != '/')
        {
            const new_len = raw_spec_cleaned.len - 1;
            const buf = try temp.alloc(u8, new_len);
            @memcpy(buf[0..6], "file:/");
            @memcpy(buf[6..], raw_spec_cleaned[7..]);
            raw_spec_cleanest = buf;
        }

        // Create resolvedUrl: new URL(rawSpec, `${pathToFileURL(path.resolve(where))}/`)
        const resolved_href = blk: {
            var path_buffers: PathHelpers.PathBufferPair = .init();
            defer path_buffers.deinit();

            const resolved_where_path = try PathHelpers.resolve(&.{where}, &path_buffers);

            const where_url_len = PathToFileUrlUtils.pathToFileUrlLength(resolved_where_path);
            const where_with_slash_buf = try temp.alloc(u8, where_url_len + 1);
            defer temp.free(where_with_slash_buf);

            const where_url = PathToFileUrlUtils.pathToFileUrl(
                where_with_slash_buf,
                resolved_where_path,
            );
            where_with_slash_buf[where_url.len] = '/';
            const where_with_slash = where_with_slash_buf[0 .. where_url.len + 1];

            break :blk bun.jsc.URL.join(
                bun.String.init(where_with_slash),
                bun.String.init(raw_spec_cleanest),
            );
        };
        defer resolved_href.deref();

        var spec_path = try PercentEncoding.extractDecodedPathname(
            bun.String.init(raw_spec_cleanest),
            temp,
        );
        defer temp.free(spec_path);

        var resolved_path = try PercentEncoding.extractDecodedPathname(resolved_href, temp);
        defer temp.free(resolved_path);

        if (bun.Environment.isWindows) {
            spec_path = SpecStrUtils.stripWindowsLeadingSlashes(spec_path);
            resolved_path = SpecStrUtils.stripWindowsLeadingSlashes(resolved_path);
        }

        const path_pair = Self.normalizePath(
            allocator,
            spec_path,
            raw_spec_cleanest,
            where,
            resolved_path,
        ) catch {
            return error.InvalidPath;
        };
        defer path_pair.deinit(allocator);

        const fetch_spec_temp = path_pair.fetch_spec;
        var save_spec_temp = path_pair.save_spec;
        var save_spec_extra: ?[]u8 = null;
        defer if (save_spec_extra) |s| temp.free(s);

        if (bun.Environment.isWindows) {
            const mutable_copy = try temp.dupe(u8, save_spec_temp);
            save_spec_extra = mutable_copy;
            save_spec_temp = mutable_copy;
            std.mem.replaceScalar(u8, mutable_copy, '\\', '/');

            // Fix double slashes: file://C:/foo -> file:/C:/foo
            if (bun.strings.hasPrefixComptime(mutable_copy, "file://")) {
                const fixed = try std.fmt.allocPrint(temp, "file:/{s}", .{mutable_copy[7..]});
                temp.free(mutable_copy);
                save_spec_extra = fixed;
                save_spec_temp = fixed;
            }
        }

        var arena_size: usize = rawFieldLength(raw_arg, name, raw_spec);
        arena_size += raw_spec.len + fetch_spec_temp.len + save_spec_temp.len;
        if (name) |n| arena_size += n.len;
        const buffer = try allocator.alloc(u8, arena_size);
        errdefer allocator.free(buffer);

        var arena = StringArena.init(buffer);

        const raw_slice = arena.copyRawField(raw_arg, name, raw_spec);
        const name_slice = arena.maybeCopy(name);
        const raw_spec_slice = arena.copyString(raw_spec);
        const fetch_spec_slice = arena.copyString(fetch_spec_temp);
        const save_spec_slice = arena.copyString(save_spec_temp);

        return .{
            .raw = raw_slice,
            .name = name_slice,
            .raw_spec = raw_spec_slice,
            ._arena_buffer = arena.buffer,
            ._fetch_spec_slice = fetch_spec_slice,
            .save_spec = save_spec_slice,
            .type = Self.Type.fromInodePath(raw_spec),
            ._allocator = allocator,
        };
    }

    // Encapsualtes both fetch_spec and save_spec, along with the backing buffer. Useful to avoid
    // multiple allocations. Some functions return this struct to return both specs at once.
    const PathPair = struct {
        fetch_spec: []const u8,
        save_spec: []const u8,
        buffer: []u8,

        pub fn deinit(self: PathPair, allocator: std.mem.Allocator) void {
            allocator.free(self.buffer);
        }

        /// Creates a PathPair with layout: [fetch_spec]["file:"][save_spec_content]
        /// fetch_spec becomes the first slice, save_spec is "file:" + save_spec_content
        fn init(
            allocator: std.mem.Allocator,
            fetch_spec_str: []const u8,
            save_spec_content: []const u8,
        ) !PathPair {
            const total_size = fetch_spec_str.len + 5 + save_spec_content.len;
            const buffer = try allocator.alloc(u8, total_size);
            errdefer allocator.free(buffer);

            var offset: usize = 0;
            @memcpy(buffer[offset..][0..fetch_spec_str.len], fetch_spec_str);
            offset += fetch_spec_str.len;
            @memcpy(buffer[offset..][0..5], "file:");
            offset += 5;
            @memcpy(buffer[offset..][0..save_spec_content.len], save_spec_content);

            return .{
                .fetch_spec = buffer[0..fetch_spec_str.len],
                .save_spec = buffer[fetch_spec_str.len..total_size],
                .buffer = buffer,
            };
        }
    };

    /// Performs tilde expansion, relative path resolution against `where`, and absolute path
    /// resolution.
    fn normalizePath(
        allocator: std.mem.Allocator,
        spec_path: []const u8,
        raw_spec: []const u8,
        where_path: []const u8,
        resolved_path: []const u8,
    ) !PathPair {
        var path_buffers: PathHelpers.PathBufferPair = .init();
        defer path_buffers.deinit();

        if (bun.strings.hasPrefixComptime(spec_path, "/~/") or
            bun.strings.eqlComptime(spec_path, "/~"))
        {
            if (bun.getenvZ("HOME")) |home_dir| {
                const path_after_tilde = if (spec_path.len > 3) spec_path[3..] else "";
                const resolved = try PathHelpers.resolve(
                    &.{ home_dir, path_after_tilde },
                    &path_buffers,
                );
                return PathPair.init(allocator, resolved, spec_path[1..]);
            } else {
                return error.InvalidPath;
            }
        } else if (!std.fs.path.isAbsolute(bun.strings.substring(raw_spec, 5, null))) {
            var relative_buffers: PathHelpers.PathBufferTriplet = .init();
            const relative_path = try PathHelpers.relative(where_path, resolved_path, &relative_buffers);
            const resolved = try PathHelpers.resolve(&.{ where_path, resolved_path }, &path_buffers);

            return PathPair.init(allocator, resolved, relative_path);
        } else {
            const resolved_for_save = try PathHelpers.resolve(&.{resolved_path}, &path_buffers);
            const resolved_for_fetch = try PathHelpers.resolve(&.{ where_path, resolved_path }, &path_buffers);

            return PathPair.init(allocator, resolved_for_fetch, resolved_for_save);
        }
    }
};

pub const NpaError = error{
    OutOfMemory,
    NestedAlias,
    NotAliasingRegistry,
    AliasMissingName,
    InvalidPath,
    InvalidURL,
    Unexpected,
    CurrentWorkingDirectoryUnlinked,
    InvalidRegistrySpec,
    InvalidCommittish,
};

/// Parsed git attributes from a committish string (the part after `#` in git URLs).
/// Corresponds to npa.js `setGitAttrs()` function (lines 214-252).
///
/// Git URLs support special syntax for specifying:
/// - Plain commit-ish: branch name, tag, or commit SHA
/// - Semver range: `semver:<range>` filters git tags by semver (percent-encoded)
/// - Subdirectory: `path:<dir>` specifies a subdirectory within the repo
///
/// Multiple attributes can be combined with `::` separator.
///
/// Examples:
/// - `github:user/repo#main` → committish = "main"
/// - `github:user/repo#semver:^1.0.0` → range = "^1.0.0"
/// - `github:user/repo#main::path:packages/foo` → committish = "main", subdir = "/packages/foo"
const GitAttrs = struct {
    const Self = @This();

    committish: ?[]const u8,
    range: ?[]const u8,
    subdir: ?[]const u8,

    _allocator: std.mem.Allocator,
    _range_buf: ?[]const u8,

    pub fn clone(self: *Self) !Self {
        return .{
            .committish = if (self.committish) |c| try self._allocator.dupe(u8, c) else null,
            .range = if (self.range) |r| try self._allocator.dupe(u8, r) else null,
            .subdir = if (self.subdir) |s| try self._allocator.dupe(u8, s) else null,
            ._range_buf = if (self._range_buf) |b| try self._allocator.dupe(u8, b) else null,
            ._allocator = self._allocator,
        };
    }

    pub fn deinit(self: *Self) void {
        if (self.committish) |c| self._allocator.free(c);
        // Don't free range - it's a slice into _range_buf
        if (self.subdir) |s| self._allocator.free(s);
        if (self._range_buf) |b| self._allocator.free(b);
    }

    pub fn fromCommittish(allocator: std.mem.Allocator, committish: []const u8) !Self {
        var res: Self = .{
            .committish = null,
            .range = null,
            .subdir = null,
            ._range_buf = null,
            ._allocator = allocator,
        };
        errdefer res.deinit();

        var parts_iter = std.mem.splitSequence(u8, committish, "::");
        while (parts_iter.next()) |part| {
            if (!bun.strings.containsScalar(part, ':')) {
                if (res.range != null or res.committish != null) {
                    return error.InvalidCommittish;
                }

                res.committish = try allocator.dupe(u8, part);
                continue;
            }

            const colon_idx = bun.strings.indexOfScalar(part, ':').?;
            const name = part[0..colon_idx];
            const value = part[colon_idx + 1 ..];

            if (std.mem.eql(u8, name, "semver")) {
                if (res.committish != null or res.range != null) {
                    return error.InvalidCommittish;
                }

                var array_list = bun.handleOom(
                    std.ArrayList(u8).initCapacity(allocator, value.len),
                );
                const bytes_written = PercentEncoding.decode(
                    @TypeOf(array_list.writer()),
                    array_list.writer(),
                    value,
                ) catch {
                    return error.InvalidCommittish;
                };

                res._range_buf = array_list.items[0..array_list.capacity];
                res.range = array_list.items[0..bytes_written];
                continue;
            }

            if (std.mem.eql(u8, name, "path")) {
                if (res.subdir != null) {
                    return error.InvalidCommittish;
                }

                res.subdir = try std.fmt.allocPrint(allocator, "/{s}", .{value});
                continue;
            }
        }

        return res;
    }

    /// Extract and parse git attributes from a URL's hash fragment.
    /// Returns null if the URL has no hash or an empty hash.
    pub fn fromUrl(allocator: std.mem.Allocator, parsed_url: *bun.jsc.URL) !?Self {
        const hash_slice = try parsed_url.hash().toOwnedSlice(allocator);
        defer allocator.free(hash_slice);

        const raw_committish = if (hash_slice.len > 1)
            hash_slice[1..]
        else
            return null;

        return try fromCommittish(allocator, raw_committish);
    }
};

/// Matches the semantics of the default export of npa.
pub fn npa(allocator: std.mem.Allocator, raw_spec: []const u8, where: []const u8) NpaError!NpaSpec {
    var name: ?[]const u8 = null;
    var spec: []const u8 = undefined;
    var spec_allocated: []const u8 = &[_]u8{};
    defer if (spec_allocated.len > 0) allocator.free(spec_allocated);

    const name_ends_at = bun.strings.indexOfCharPos(raw_spec, '@', 1);
    const name_part = if (name_ends_at) |idx| raw_spec[0..idx] else raw_spec;

    if (SpecStrUtils.isUrl(raw_spec)) {
        spec = raw_spec;
    } else if (SpecStrUtils.isGit(raw_spec)) {
        spec = try std.fmt.allocPrint(allocator, "git+ssh://{s}", .{raw_spec});
        spec_allocated = spec;
    } else if (!bun.strings.hasPrefixComptime(name_part, "@") and
        (bun.path.hasPlatformPathSeparators(name_part) or NpaSpec.Type.fromInodePath(name_part) == .file))
    {
        spec = raw_spec;
    } else if (name_ends_at) |idx| {
        name = name_part;
        const spec_start = idx + 1;
        spec = if (spec_start < raw_spec.len) raw_spec[spec_start..] else "*";
    } else {
        const valid = validate_npm_package_name.validate(raw_spec);
        if (valid.validForOldPackages()) {
            name = raw_spec;
            spec = "*";
        } else {
            spec = raw_spec;
        }
    }

    return resolve(allocator, name, spec, where, raw_spec);
}

fn resolve(
    allocator: std.mem.Allocator,
    name: ?[]const u8,
    spec: []const u8,
    maybe_where: ?[]const u8,
    raw_arg: ?[]const u8,
) !NpaSpec {
    const where = maybe_where orelse try std.process.getCwdAlloc(allocator);
    defer if (maybe_where == null) allocator.free(where);

    if (SpecStrUtils.isFile(spec)) {
        return NpaSpec.fromFile(allocator, name, spec, where, raw_arg);
    }

    if (SpecStrUtils.isAlias(spec)) {
        return NpaSpec.fromAlias(allocator, name, spec, where, raw_arg);
    }

    if (try NpaSpec.fromGitSpec(allocator, name, spec, raw_arg)) |git_s| {
        return git_s;
    }

    if (SpecStrUtils.isUrl(spec)) {
        return NpaSpec.fromUrl(allocator, name, spec, raw_arg);
    }

    // TODO(markovejnovic): This feels like an odd heuristic but it's what npm-package-arg does.
    // Notice how we don't use the SpecStrUtils.isFile function here. This matches npa.
    if (bun.path.hasPlatformPathSeparators(spec) or NpaSpec.Type.fromInodePath(spec) == .file) {
        return NpaSpec.fromFile(allocator, name, spec, where, raw_arg);
    }

    return NpaSpec.fromRegistry(allocator, name, spec, raw_arg);
}

const PathToFileUrlUtils = struct {
    const encoded_path_chars = blk: {
        var map: [256]?[]const u8 = undefined;

        for (&map) |*p| p.* = null;

        map[0] = "%00";
        map['\t'] = "%09";
        map['\n'] = "%0A";
        map['\r'] = "%0D";
        map[' '] = "%20";
        map['"'] = "%22";
        map['#'] = "%23";
        map['%'] = "%25";
        map['?'] = "%3F";
        map['['] = "%5B";
        map['\\'] = if (bun.Environment.isWindows) "/" else "%5C";
        map[']'] = "%5D";
        map['^'] = "%5E";
        map['|'] = "%7C";
        map['~'] = "%7E";
        break :blk map;
    };

    /// Exactly matches npa's pathToFileUrl function.
    /// Writes the encoded path to the provided buffer and returns a slice of what was written.
    ///
    /// It is undefined behavior to provide a buffer that is too small.
    pub fn pathToFileUrl(buffer: []u8, path: []const u8) []u8 {
        const path_it = path;

        const out_len = pathToFileUrlLength(path);
        if (buffer.len < out_len) unreachable;

        var buf_it = buffer;

        if (!bun.strings.hasPrefixComptime(path, "file:")) {
            std.mem.copyForwards(u8, buf_it[0.."file:".len], "file:");
            buf_it = buf_it["file:".len..];
        }

        for (path_it) |c| {
            if (encoded_path_chars[c]) |s| {
                std.mem.copyForwards(u8, buf_it[0..s.len], s);
                buf_it = buf_it[s.len..];
                continue;
            }

            buf_it[0] = c;
            buf_it = buf_it[1..];
        }

        return buffer[0..out_len];
    }

    /// Measures the length of the URL resulting from pathToFileUrl.
    pub fn pathToFileUrlLength(path: []const u8) usize {
        var size: usize = 0;
        for (path) |c| {
            if (encoded_path_chars[c]) |s| {
                size += s.len;
            } else {
                size += 1;
            }
        }

        if (!bun.strings.hasPrefixComptime(path, "file:")) {
            size += "file:".len;
        }

        return size;
    }

    /// Matches the semantics of npa's fromFile path handling. See the implementation of that
    /// function for more details.
    pub fn cleanPathToFileUrl(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
        var total_len = pathToFileUrlLength(path);

        var needs_file_double_slash_fix = false;
        var slashes_to_remove: usize = 0;
        var original_slashes: usize = 0;

        const raw_spec_starts_with_file_slash = bun.strings.hasPrefixComptime(path, "file:/") or
            bun.strings.hasPrefixComptime(path, "/");

        if (raw_spec_starts_with_file_slash) {
            // Check for: file://[^/] pattern (turn file://path into file:/path)
            // npa.js: rawSpec = `file:/${rawSpec.slice(5)}`
            if (bun.strings.hasPrefixComptime(path, "file://")) {
                if (path.len > "file://".len and path["file://".len] != '/') {
                    needs_file_double_slash_fix = true;
                    total_len += 1;
                }
            }

            // Check for: ^\/{1,3}\.\.?(\/|$) pattern after "file:" prefix
            const check_offset: usize =
                if (bun.strings.hasPrefixComptime(path, "file:")) "file:".len else 0;
            const after_file_colon = path[check_offset..];

            if (SpecStrUtils.startsWithRelativePathAfterSlashes(after_file_colon)) {
                const slash_count = bun.strings.countLeadingChar(after_file_colon, '/');

                const effective_slash_count = slash_count +
                    if (needs_file_double_slash_fix) @as(usize, 1) else @as(usize, 0);

                slashes_to_remove = effective_slash_count;
                original_slashes = slash_count;
                total_len -= effective_slash_count;
            }
        }

        var builder = try bun.StringBuilder.initCapacity(allocator, total_len);
        errdefer builder.deinit();
        _ = builder.append("file:");

        const input_has_file_prefix = bun.strings.hasPrefixComptime(path, "file:");
        var path_idx: usize = if (input_has_file_prefix) "file:".len else 0;

        // Write the extra slash if the file://[^/] transformation applies
        // BUT NOT if the relative path fix will remove it
        if (needs_file_double_slash_fix and original_slashes == 0) {
            _ = builder.append("/");
        }

        if (original_slashes > 0) {
            path_idx += original_slashes;
        }

        for (path[path_idx..]) |c| {
            _ = builder.append(if (encoded_path_chars[c]) |s| s else &[_]u8{c});
        }

        return builder.allocatedSlice();
    }
};

/// Normalizes a Windows path by replacing backslashes with forward slashes.
///
/// Allocates a new string for the normalized path.
fn normalizeWindowsPath(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    if (!bun.Environment.isWindows) return error.NotWindows;
    const normalized = try allocator.dupe(u8, path);
    errdefer allocator.free(normalized);
    std.mem.replaceScalar(u8, normalized, '\\', '/');
    return normalized;
}

/// Collection of utilities for operating on strings.
///
/// Used to encapsulate logic, nothing more.
pub const SpecStrUtils = struct {
    /// Strips leading slashes before Windows drive letters: /C:/foo -> C:/foo
    /// Matches the regex: /^\/+([a-z]:\/)/i
    pub fn stripWindowsLeadingSlashes(path: anytype) @TypeOf(path) {
        if (path.len < 3) return path;

        var slash_count: usize = 0;
        while (slash_count < path.len and path[slash_count] == '/') {
            slash_count += 1;
        }

        if (slash_count == 0) return path;

        const c = path[slash_count..];
        return if (bun.strings.startsWithWindowsDriveLetter(c)) c else path;
    }

    /// Strips "git+" prefix from an owned string if present, returning a SlicedBuffer.
    /// When the prefix exists, avoids reallocation by returning a slice of the original buffer.
    /// Takes ownership of the input string.
    fn stripGitPlusPrefix(
        allocator: std.mem.Allocator,
        owned_str: []const u8,
    ) bun.strings.SlicedBuffer {
        if (!bun.strings.hasPrefixComptime(owned_str, "git+")) {
            return bun.strings.SlicedBuffer.initUnsliced(allocator, owned_str);
        }
        return bun.strings.SlicedBuffer.init(allocator, owned_str, owned_str[4..]);
    }

    /// Tests whether the given string matches /^(?:git[+])?[a-z]+:/i
    pub fn isUrl(spec_str: []const u8) bool {
        if (bun.strings.hasPrefixCaseInsensitive(spec_str, "git:")) {
            return true;
        }

        if (bun.strings.hasPrefixCaseInsensitive(spec_str, "git+")) {
            for (spec_str["git+".len..]) |c| {
                if (c == ':') {
                    return true;
                }
                // Check if it's a letter (case-insensitive)
                if (!((c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z'))) {
                    return false;
                }
            }
            // If we reach the terminal case, then that means we missed a colon -- not a URL.
            return false;
        }

        // Now, the string may not start with git+ or git: at all, in that case we need to make
        // sure the characters before the first colon are all letters (case-insensitive).
        const colon_idx = bun.strings.indexOf(spec_str, ":") orelse return false;
        if (colon_idx == 0) return false;
        for (spec_str[0..colon_idx]) |c| {
            if (!((c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z'))) {
                return false;
            }
        }
        // Otherwise, it's a URL.
        return true;
    }

    /// Matches the implementation of isAliasSpec in npm-package-arg.
    pub fn isAlias(spec_str: []const u8) bool {
        return bun.strings.hasPrefixCaseInsensitive(spec_str, "npm:");
    }

    /// Test whether the given string matches /^[^@]+@[^:.]+\.[^:]+:.+$/i (isGit in npa.js)
    pub fn isGit(spec_str: []const u8) bool {
        // Matches: /^[^@]+@[^:.]+\.[^:]+:.+$/i
        const at_idx = bun.strings.indexOfChar(spec_str, '@') orelse return false;
        if (at_idx == 0) return false;

        var i = at_idx + 1;
        if (i >= spec_str.len) return false;

        // Match [^:.]+ - at least one character that is not : or .
        const start_after_at = i;
        while (i < spec_str.len) : (i += 1) {
            if (spec_str[i] == ':' or spec_str[i] == '.') break;
        }
        // Ensure we consumed at least one character and hit a dot
        if (i == start_after_at or i >= spec_str.len or spec_str[i] != '.') return false;

        i += 1;
        if (i >= spec_str.len) return false;

        // Match [^:]+ - at least one character that is not :
        const start_after_dot = i;
        while (i < spec_str.len) : (i += 1) {
            if (spec_str[i] == ':') break;
        }
        // Ensure we consumed at least one character and hit a colon
        if (i == start_after_dot or i >= spec_str.len or spec_str[i] != ':') return false;

        // Ensure there's at least one character after the colon (.+)
        return i + 1 < spec_str.len;
    }

    /// Matches the implementation of isFileSpec in npm-package-arg.
    pub fn isFile(spec_str: []const u8) bool {
        if (spec_str.len == 0) {
            return false;
        }

        if (bun.strings.hasPrefixCaseInsensitive(spec_str, "file:")) {
            return true;
        }

        return if (bun.Environment.isWindows)
            isWindowsFile(spec_str)
        else
            isPosixFile(spec_str);
    }

    /// Equivalent to /^(?:[.]|~[/]|[/\\]|[a-zA-Z]:)/ (isWindowsFile in npa.js)
    fn isWindowsFile(spec_str: []const u8) bool {
        // This is the heuristic npm-package-arg uses. You can debate whether it is good or not,
        // but this is what they use.
        if (spec_str.len < 1) return false;

        return switch (spec_str[0]) {
            '.', '/', '\\' => true,
            '~' => spec_str.len >= 2 and spec_str[1] == '/',
            'a'...'z', 'A'...'Z' => spec_str.len >= 2 and spec_str[1] == ':',
            else => false,
        };
    }

    /// Equivalent to /^(?:[.]|~[/]|[/]|[a-zA-Z]:)/ (isPosixFile in npa.js)
    fn isPosixFile(spec_str: []const u8) bool {
        // This is kind of weird but npm-package-arg also supports C: as path prefixes on POSIX
        // platforms. ¯\_(ツ)_/¯ Maybe there's Sun or something.
        if (spec_str.len < 1) return false;

        return switch (spec_str[0]) {
            '.', '/' => true,
            '~' => spec_str.len >= 2 and spec_str[1] == '/',
            'a'...'z', 'A'...'Z' => spec_str.len >= 2 and spec_str[1] == ':',
            else => false,
        };
    }

    /// Given a string git+ssh://<foo>#<committish>, extracts <foo> and <committish> parts.
    /// Matches: /^git\+ssh:\/\/([^:#]+:[^#]+(?:\.git)?)(?:#(.*))?$/i
    pub fn gitScpExtractFragmentCommittish(raw_spec: []const u8) ?struct {
        fragment: []const u8,
        committish: ?[]const u8,
    } {
        if (!bun.strings.hasPrefixCaseInsensitive(raw_spec, "git+ssh://")) {
            return null;
        }

        const after_prefix = raw_spec["git+ssh://".len..];
        if (after_prefix.len == 0) return null;

        // Find the hash (if any) to split fragment and committish
        const hash_idx = bun.strings.indexOfChar(after_prefix, '#');
        const before_hash = if (hash_idx) |h| after_prefix[0..h] else after_prefix;

        // Match pattern: [^:#]+:[^#]+(?:\.git)?
        // Must contain a colon (SCP syntax)
        const colon_idx = bun.strings.indexOfChar(before_hash, ':') orelse return null;

        // Before colon: [^:#]+ (at least one char, no : or #)
        if (colon_idx == 0) return null;
        const before_colon = before_hash[0..colon_idx];

        // Verify no : or # in before_colon
        for (before_colon) |c| {
            if (c == ':' or c == '#') return null;
        }

        // After colon: [^#]+ (at least one char, no #)
        const after_colon = before_hash[colon_idx + 1 ..];
        if (after_colon.len == 0) return null;

        // Verify no # in after_colon (guaranteed by before_hash, but explicit check)
        for (after_colon) |c| {
            if (c == '#') return null;
        }

        // The fragment is the entire before_hash part
        const fragment = before_hash;

        // Extract committish if hash exists
        const committish = if (hash_idx) |h|
            if (h + 1 < after_prefix.len)
                after_prefix[h + 1 ..]
            else
                null
        else
            null;

        return .{
            .fragment = fragment,
            .committish = committish,
        };
    }

    /// Checks if a string contains a port number pattern: :[0-9]+(/|$)
    /// This matches npa.js isPortNumber regex
    pub fn containsPortNumber(str: []const u8) bool {
        var i: usize = 0;
        while (i < str.len) : (i += 1) {
            if (str[i] == ':') {
                // Found a colon, check if followed by digits and then / or end
                var j = i + 1;
                var has_digits = false;
                while (j < str.len and str[j] >= '0' and str[j] <= '9') : (j += 1) {
                    has_digits = true;
                }
                if (has_digits and (j >= str.len or str[j] == '/')) {
                    return true;
                }
            }
        }
        return false;
    }

    /// Extracts the href from a parsed URL and returns it without the hash fragment.
    /// Returns an owned string that must be freed by the caller.
    pub fn getUrlHrefWithoutHash(allocator: std.mem.Allocator, parsed_url: *bun.jsc.URL) ![]u8 {
        const href_slice = try parsed_url.href().toOwnedSlice(allocator);
        defer allocator.free(href_slice);

        const without_hash = if (bun.strings.indexOfChar(href_slice, '#')) |idx|
            href_slice[0..idx]
        else
            href_slice;

        return allocator.dupe(u8, without_hash);
    }

    /// Matches the regex: /^\/{1,3}\.\.?(\/|$)/
    /// Returns true if the string starts with 1-3 slashes, followed by one or two dots,
    /// followed by a slash or end of string.
    /// Examples: "/..", "/./", "//.", "///../", etc.
    pub fn startsWithRelativePathAfterSlashes(str: []const u8) bool {
        if (str.len == 0) return false;

        // Count leading slashes (must be 1-3)
        var slash_count: usize = 0;
        var i: usize = 0;
        while (i < str.len and str[i] == '/' and slash_count < 3) : (i += 1) {
            slash_count += 1;
        }

        // Must have 1-3 slashes
        if (slash_count == 0 or slash_count > 3) return false;

        // Must have at least one more character (the first dot)
        if (i >= str.len or str[i] != '.') return false;
        i += 1;

        // Optionally another dot
        if (i < str.len and str[i] == '.') {
            i += 1;
        }

        // Must be followed by '/' or end of string
        return i >= str.len or str[i] == '/';
    }

    pub const HostAndPathname = struct {
        host_lower: []const u8,
        pathname: []const u8,
        buffer: []u8,

        pub fn deinit(self: HostAndPathname, allocator: std.mem.Allocator) void {
            allocator.free(self.buffer);
        }
    };

    pub fn extractHostAndPathnameWithLowercaseHost(
        allocator: std.mem.Allocator,
        parsed_url: *bun.jsc.URL,
    ) !HostAndPathname {
        const host_slice = try parsed_url.host().toOwnedSlice(allocator);
        defer allocator.free(host_slice);
        const pathname_slice = try parsed_url.pathname().toOwnedSlice(allocator);
        defer allocator.free(pathname_slice);

        const host_len = host_slice.len;
        const pathname_len = pathname_slice.len;
        const buffer = try allocator.alloc(u8, host_len + pathname_len);
        errdefer allocator.free(buffer);

        for (host_slice, 0..) |ch, idx| {
            buffer[idx] = std.ascii.toLower(ch);
        }

        @memcpy(buffer[host_len..][0..pathname_len], pathname_slice);

        return .{
            .host_lower = buffer[0..host_len],
            .pathname = buffer[host_len..][0..pathname_len],
            .buffer = buffer,
        };
    }
};

pub const TestingAPIs = struct {
    /// Shares semantics with npm-package-arg's default export.
    pub fn jsNpa(go: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const allocator = bun.default_allocator;

        if (callframe.argumentsCount() < 1) {
            return go.throw("Npa.npa takes at least 1 argument", .{});
        }

        const rawSpecArg = callframe.argument(0);
        const maybeWhereArg = callframe.argument(1);

        const raw_spec_str = try rawSpecArg.toBunString(go);
        defer raw_spec_str.deref();

        const where: ?bun.String = if (maybeWhereArg.isUndefined())
            null
        else
            try maybeWhereArg.toBunString(go);
        defer if (where) |w| w.deref();

        const raw_spec_utf8 = raw_spec_str.toUTF8(allocator);
        defer raw_spec_utf8.deinit();
        const where_utf8 = if (where) |w| w.toUTF8(allocator) else null;
        defer if (where_utf8) |w| w.deinit();

        const where_slice = if (where_utf8) |w|
            w.slice()
        else
            std.process.getCwdAlloc(allocator) catch |err| {
                return go.throwError(err, "Failed to get current working directory");
            };
        defer if (where_utf8 == null) allocator.free(where_slice);

        var resolved = bun.handleOom(
            npa(allocator, raw_spec_utf8.slice(), where_slice),
        ) catch |err| {
            return go.throwError(err, "Unexpected error in Npa.npa");
        };
        defer resolved.deinit();

        return resolved.toJS(allocator, go);
    }

    /// Shares semantics with npm-package-arg's resolve function.
    pub fn jsResolve(go: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const allocator = bun.default_allocator;

        if (callframe.argumentsCount() < 1) {
            return go.throw("Npa.prototype.resolve takes at least 1 argument", .{});
        }

        const nameArg = callframe.argument(0);
        const maybeSpecArg = callframe.argument(1);
        const maybeWhereArg = callframe.argument(2);

        const name_str: ?bun.String = if (nameArg.isNull() or nameArg.isUndefined())
            null
        else
            try nameArg.toBunString(go);
        defer if (name_str) |n| n.deref();

        const spec: bun.String = try maybeSpecArg.toBunString(go);
        defer spec.deref();

        const where: ?bun.String = if (maybeWhereArg.isUndefined())
            null
        else
            try maybeWhereArg.toBunString(go);
        defer if (where) |w| w.deref();

        const name_utf8 = if (name_str) |n| n.toUTF8(allocator) else null;
        defer if (name_utf8) |n| n.deinit();
        const spec_utf8 = spec.toUTF8(allocator);
        defer spec_utf8.deinit();
        const where_utf8 = if (where) |w| w.toUTF8(allocator) else null;
        defer if (where_utf8) |w| w.deinit();

        const raw_arg = if (name_utf8) |n| blk: {
            const name_slice = n.slice();
            const spec_slice = spec_utf8.slice();
            const total = name_slice.len + 1 + spec_slice.len;
            const buf = try allocator.alloc(u8, total);
            @memcpy(buf[0..name_slice.len], name_slice);
            buf[name_slice.len] = '@';
            @memcpy(buf[name_slice.len + 1 ..], spec_slice);
            break :blk buf;
        } else null;
        defer if (raw_arg) |r| allocator.free(r);

        var resolved = bun.handleOom(resolve(
            allocator,
            if (name_utf8) |n| n.slice() else null,
            spec_utf8.slice(),
            if (where_utf8) |w| w.slice() else null,
            raw_arg,
        )) catch |err| {
            return go.throwError(err, "Unexpected error in Npa.prototype.resolve");
        };
        defer resolved.deinit();

        return resolved.toJS(allocator, go);
    }
};

/// Helper functions for path operations that reduce boilerplate.
/// These return heap-allocated results since we typically need to own the paths anyway.
///
/// TODO(markovejnovic): This feels like it shouldn't be in npm-package-arg, but in a more generic
/// location.
const PathHelpers = struct {
    const Self = @This();

    const PathBufferPair = struct {
        buf1: *bun.PathBuffer,
        buf2: *bun.PathBuffer,

        pub fn init() PathBufferPair {
            return .{
                .buf1 = bun.path_buffer_pool.get(),
                .buf2 = bun.path_buffer_pool.get(),
            };
        }

        pub fn deinit(self: *PathBufferPair) void {
            bun.path_buffer_pool.put(self.buf1);
            bun.path_buffer_pool.put(self.buf2);
        }
    };

    const PathBufferTriplet = struct {
        pair: PathBufferPair,
        buf3: *bun.PathBuffer,

        pub fn init() PathBufferTriplet {
            return .{
                .pair = Self.PathBufferPair.init(),
                .buf3 = bun.path_buffer_pool.get(),
            };
        }

        pub fn deinit(self: *PathBufferTriplet) void {
            self.pair.deinit();
            bun.path_buffer_pool.put(self.buf3);
        }
    };

    /// JS path.resolve equivalent.
    fn resolve(segments: []const []const u8, buffers: *PathBufferPair) ![]const u8 {
        const result = if (bun.Environment.isWindows)
            PathResolver.resolveWindowsT(u8, segments, buffers.buf1, buffers.buf2)
        else
            PathResolver.resolvePosixT(u8, segments, buffers.buf1, buffers.buf2);

        return switch (result) {
            .result => |r| r,
            .err => error.InvalidPath,
        };
    }

    fn resolveWithPrefix(
        allocator: std.mem.Allocator,
        comptime prefix: []const u8,
        segments: []const []const u8,
        buffers: *PathBufferPair,
    ) ![]u8 {
        const resolved = try Self.resolve(segments, buffers);
        return std.fmt.allocPrint(allocator, prefix ++ "{s}", .{resolved});
    }

    /// Computes relative path and returns a stack-backed slice.
    /// The returned slice is valid as long as the buffers struct is in scope.
    fn relative(
        from: []const u8,
        to: []const u8,
        buffers: *PathBufferTriplet,
    ) ![]const u8 {
        const result = if (bun.Environment.isWindows)
            PathResolver.relativeWindowsT(
                u8,
                from,
                to,
                buffers.pair.buf1,
                buffers.pair.buf2,
                buffers.buf3,
            )
        else
            PathResolver.relativePosixT(
                u8,
                from,
                to,
                buffers.pair.buf1,
                buffers.pair.buf2,
                buffers.buf3,
            );

        return switch (result) {
            .result => |r| r,
            .err => error.InvalidPath,
        };
    }
};

const PathResolver = @import("../bun.js/node/path.zig");
const std = @import("std");
const validate_npm_package_name = @import("./validate_npm_package_name.zig");

const url = @import("../url.zig");
const PercentEncoding = @import("../url.zig").PercentEncoding;

const HostedGitInfo = @import("./hosted_git_info.zig").HostedGitInfo;
const WellDefinedProtocol = @import("./hosted_git_info.zig").WellDefinedProtocol;

const bun = @import("bun");
const Semver = bun.Semver;
const jsc = bun.jsc;
