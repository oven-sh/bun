pub const NpaSpec = union(enum) {
    const Self = @This();

    git: struct {
        raw: []const u8,
        name: ?[]const u8,
        raw_spec: []const u8,
        fetch_spec: ?[]const u8,
        save_spec: []const u8,
        git_committish: ?[]const u8,
        git_range: ?[]const u8,
        git_subdir: ?[]const u8,
        //hosted: hgi.HostedGitInfo,
        _allocator: std.mem.Allocator,
    },
    file: struct {
        raw: []const u8,
        name: ?[]const u8,
        raw_spec: []const u8,
        fetch_spec: []const u8,
        save_spec: []const u8,
        _allocator: std.mem.Allocator,
    },
    directory: struct {
        raw: []const u8,
        name: ?[]const u8,
        raw_spec: []const u8,
        fetch_spec: []const u8,
        save_spec: []const u8,
        _allocator: std.mem.Allocator,
    },
    version: struct {
        raw: []const u8,
        name: ?[]const u8,
        raw_spec: []const u8,
        fetch_spec: []const u8,
        _allocator: std.mem.Allocator,
    },
    range: struct {
        raw: []const u8,
        name: ?[]const u8,
        raw_spec: []const u8,
        fetch_spec: []const u8,
        _allocator: std.mem.Allocator,
    },
    tag: struct {
        raw: []const u8,
        name: ?[]const u8,
        raw_spec: []const u8,
        fetch_spec: []const u8,
        _allocator: std.mem.Allocator,
    },
    alias: struct {
        raw: []const u8,
        name: ?[]const u8,
        raw_spec: []const u8,
        sub_spec: *Self,
        _allocator: std.mem.Allocator,
    },
    remote: struct {
        raw: []const u8,
        name: ?[]const u8,
        raw_spec: []const u8,
        fetch_spec: []const u8,
        save_spec: []const u8,
        _allocator: std.mem.Allocator,
    },

    /// The caller is responsible for freeing the resulting slice, if one is created.
    pub fn escapedName(self: *const Self, allocator: std.mem.Allocator) !?[]u8 {
        if (self.name()) |n| {
            const size = std.mem.replacementSize(u8, n, "/", "%2f");
            const result = try allocator.alloc(u8, size);
            _ = std.mem.replace(u8, n, "/", "%2f", result);
            return result;
        }

        return null;
    }

    pub fn @"type"(self: *const Self) []const u8 {
        return switch (self.*) {
            .git => "git",
            .file => "file",
            .directory => "directory",
            .version => "version",
            .range => "range",
            .tag => "tag",
            .alias => "alias",
            .remote => "remote",
        };
    }

    pub fn raw(self: *const Self) []const u8 {
        return switch (self.*) {
            .git => |*g| g.raw,
            .file => |*f| f.raw,
            .directory => |*d| d.raw,
            .version => |*v| v.raw,
            .range => |*r| r.raw,
            .tag => |*t| t.raw,
            .alias => |*a| a.raw,
            .remote => |*rem| rem.raw,
        };
    }

    pub fn rawSpec(self: *const Self) []const u8 {
        return switch (self.*) {
            .git => |*g| g.raw_spec,
            .file => |*f| f.raw_spec,
            .directory => |*d| d.raw_spec,
            .version => |*v| v.raw_spec,
            .range => |*r| r.raw_spec,
            .tag => |*t| t.raw_spec,
            .alias => |*a| a.raw_spec,
            .remote => |*rem| rem.raw_spec,
        };
    }

    pub fn fetchSpec(self: *const Self) ?[]const u8 {
        return switch (self.*) {
            .git => |*g| g.fetch_spec,
            .file => |*f| f.fetch_spec,
            .directory => |*d| d.fetch_spec,
            .version => |*v| v.fetch_spec,
            .range => |*r| r.fetch_spec,
            .tag => |*t| t.fetch_spec,
            .remote => |*rem| rem.fetch_spec,
            .alias => null,
        };
    }

    pub fn saveSpec(self: *const Self) ?[]const u8 {
        return switch (self.*) {
            .git => |*g| g.save_spec,
            .file => |*f| f.save_spec,
            .directory => |*d| d.save_spec,
            .remote => |*rem| rem.save_spec,
            // Registry types return null for saveSpec
            .version, .range, .tag, .alias => null,
        };
    }

    pub fn isRegistry(self: *const Self) bool {
        return switch (self.*) {
            .version, .range, .tag, .alias => true,
            else => false,
        };
    }

    pub fn deinit(self: *Self) void {
        switch (self.*) {
            .git => |*g| {
                g._allocator.free(g.raw);
                g._allocator.free(g.raw_spec);
                g._allocator.free(g.save_spec);
                if (g.fetch_spec) |fs| g._allocator.free(fs);
                if (g.git_committish) |gc| g._allocator.free(gc);
                if (g.git_range) |gr| g._allocator.free(gr);
                if (g.git_subdir) |gs| g._allocator.free(gs);
            },
            .file => |*f| {
                f._allocator.free(f.raw);
                f._allocator.free(f.raw_spec);
                f._allocator.free(f.fetch_spec);
                f._allocator.free(f.save_spec);
            },
            .directory => |*d| {
                d._allocator.free(d.raw);
                d._allocator.free(d.raw_spec);
                d._allocator.free(d.fetch_spec);
                d._allocator.free(d.save_spec);
            },
            .version => |*v| {
                v._allocator.free(v.raw);
                v._allocator.free(v.raw_spec);
                v._allocator.free(v.fetch_spec);
            },
            .range => |*r| {
                r._allocator.free(r.raw);
                r._allocator.free(r.raw_spec);
                r._allocator.free(r.fetch_spec);
            },
            .tag => |*t| {
                t._allocator.free(t.raw);
                t._allocator.free(t.raw_spec);
                t._allocator.free(t.fetch_spec);
            },
            .alias => |*a| {
                a._allocator.free(a.raw);
                a._allocator.free(a.raw_spec);
                a.sub_spec.deinit();
                a._allocator.destroy(a.sub_spec);
            },
            .remote => |*rem| {
                rem._allocator.free(rem.raw);
                rem._allocator.free(rem.raw_spec);
                // Note: fetch_spec and save_spec point to the same memory as raw_spec, so we don't free them
            },
        }
    }

    /// If known, the name field expected in the resulting pkg.
    pub fn name(self: *const Self) ?[]const u8 {
        return switch (self.*) {
            .git => |*g| g.name,
            .file => |*f| f.name,
            .directory => |*d| d.name,
            .version => |*v| v.name,
            .range => |*r| r.name,
            .tag => |*t| t.name,
            .alias => |*a| a.name,
            .remote => |*rem| rem.name,
        };
    }

    /// If a name is something like @org/module then the scope field will be
    /// set to @org. If it doesn't have a scoped name, then scope is null.
    pub fn scope(self: *const Self) ?[]const u8 {
        const pkg_name = self.name() orelse return null;

        if (pkg_name.len == 0 or pkg_name[0] != '@') {
            return null;
        }

        // Find the slash to get the scope
        const slash_idx = bun.strings.indexOfChar(pkg_name, '/') orelse return null;

        // Return the substring from @ to / (exclusive)
        return pkg_name[0..slash_idx];
    }

    pub fn fromDepStr(npa_str: []const u8) Self {
        _ = npa_str;
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
    OverridingCommittish,
    OverridingRange,
    OverridingPath,
    DuplicateCommittish,
};

/// Matches the semantics of the default export of npa.
pub fn npa(allocator: std.mem.Allocator, raw_spec: []const u8, where: []const u8) NpaError!NpaSpec {
    var name: ?[]const u8 = null;
    var spec: []const u8 = undefined;
    var spec_allocated: []const u8 = &[_]u8{};
    defer if (spec_allocated.len > 0) allocator.free(spec_allocated);

    const name_ends_at = bun.strings.indexOfCharPos(raw_spec, '@', 1);
    const name_part = if (name_ends_at) |idx| raw_spec[0..idx] else raw_spec;

    if (isUrl(raw_spec)) {
        spec = raw_spec;
    } else if (isGitScp(raw_spec)) {
        // Convert git SCP syntax to git+ssh:// URL (like npa.js line 40)
        spec = try std.fmt.allocPrint(allocator, "git+ssh://{s}", .{raw_spec});
        spec_allocated = spec;
    } else if (!bun.strings.hasPrefixComptime(name_part, "@") and
        (hasSlashes(name_part) or heuristicIsFiletype(name_part)))
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

    // Compute raw as "name@spec" or just spec, matching npa.js Result constructor
    // We always duplicate so the from* functions own the memory
    const raw = if (raw_arg) |arg|
        try allocator.dupe(u8, arg)
    else if (name) |n|
        try std.fmt.allocPrint(allocator, "{s}@{s}", .{ n, spec })
    else
        try allocator.dupe(u8, spec);
    errdefer allocator.free(raw);

    if (isFileSpec(spec)) {
        return fromFile(allocator, name, spec, where, raw);
    }

    if (isAliasSpec(spec)) {
        return fromAlias(allocator, name, spec, where, raw);
    }

    if (try fromGitSpec(allocator, name, spec, raw)) |git_s| {
        return git_s;
    }

    if (isUrl(spec)) {
        return fromURL(allocator, name, spec, raw);
    }

    // These are now best-guesses.
    // TODO(markovejnovic): This feels like an odd heuristic but it's what npm-package-arg does.
    // Notice how we don't use the isFileSpec function here. This matches npa.
    if (hasSlashes(spec) or heuristicIsFiletype(spec)) {
        return fromFile(allocator, name, spec, where, raw);
    }

    return fromRegistry(allocator, name, spec, raw);
}

fn fromAlias(
    allocator: std.mem.Allocator,
    name: ?[]const u8,
    raw_spec: []const u8,
    where: []const u8,
    raw: []const u8,
) NpaError!NpaSpec {
    const sub_spec = try npa(allocator, raw_spec["npm:".len..], where);

    if (sub_spec == .alias) {
        return error.NestedAlias;
    }

    if (!sub_spec.isRegistry()) {
        return error.NotAliasingRegistry;
    }

    if (sub_spec.name() == null) {
        return error.AliasMissingName;
    }

    const sub_spec_ptr = try allocator.create(NpaSpec);
    sub_spec_ptr.* = sub_spec;

    // Duplicate raw_spec so we own it
    const raw_spec_owned = try allocator.dupe(u8, raw_spec);

    return .{
        .alias = .{
            .raw = raw,
            .name = name,
            .raw_spec = raw_spec_owned,
            .sub_spec = sub_spec_ptr,
            ._allocator = allocator,
        },
    };
}

fn inodeType(spec_str: []const u8) enum { file, directory } {
    const file_extensions = [_][]const u8{ ".tgz", ".tar.gz", ".tar" };
    inline for (file_extensions) |ext| {
        if (bun.strings.endsWithComptime(spec_str, ext)) {
            return .file;
        }
    }

    return .directory;
}

fn fromRegistry(
    allocator: std.mem.Allocator,
    name: ?[]const u8,
    raw_spec: []const u8,
    raw: []const u8,
) !NpaSpec {
    const trimmed = bun.strings.trimSpaces(raw_spec);
    const sliced = Semver.SlicedString.init(trimmed, trimmed);

    // Duplicate the strings we need to own
    const raw_spec_owned = try allocator.dupe(u8, raw_spec);
    errdefer allocator.free(raw_spec_owned);
    const fetch_spec_owned = try allocator.dupe(u8, trimmed);
    errdefer allocator.free(fetch_spec_owned);

    const query = Semver.Query.parse(allocator, trimmed, sliced) catch {
        // If parsing fails, treat as a tag if it doesn't need URL encoding
        if (bun.strings.indexOfNeedsURLEncode(trimmed) == null) {
            return .{ .tag = .{
                .raw = raw,
                .name = name,
                .raw_spec = raw_spec_owned,
                .fetch_spec = fetch_spec_owned,
                ._allocator = allocator,
            } };
        }
        return error.InvalidRegistrySpec;
    };
    defer query.deinit();

    // If the query has no left comparator, it means the parser skipped over a tag name
    // (e.g., "baz", "latest", etc.) and returned an empty query
    if (!query.head.head.range.hasLeft()) {
        if (bun.strings.indexOfNeedsURLEncode(trimmed) == null) {
            return .{ .tag = .{
                .raw = raw,
                .name = name,
                .raw_spec = raw_spec_owned,
                .fetch_spec = fetch_spec_owned,
                ._allocator = allocator,
            } };
        }
        return error.InvalidRegistrySpec;
    }

    const is_exact_version = query.head.head.range.left.op == .eql and
        query.head.head.range.right.op == .unset and
        query.head.head.next == null and
        query.head.tail == null and
        query.head.next == null and
        query.tail == null;

    if (is_exact_version) {
        return .{ .version = .{
            .raw = raw,
            .name = name,
            .raw_spec = raw_spec_owned,
            .fetch_spec = fetch_spec_owned,
            ._allocator = allocator,
        } };
    }

    return .{ .range = .{
        .raw = raw,
        .name = name,
        .raw_spec = raw_spec_owned,
        .fetch_spec = fetch_spec_owned,
        ._allocator = allocator,
    } };
}

const PathToFileUrlUtils = struct {
    const encoded_path_cars = blk: {
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
    pub fn pathToFileUrl(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
        const path_it = path;

        const out_len = pathToFileUrlLength(path);
        const result = try allocator.alloc(u8, out_len);
        var buf_it = result;

        if (!bun.strings.hasPrefixComptime(path, "file:")) {
            std.mem.copyForwards(u8, buf_it[0.."file:".len], "file:");
            buf_it = buf_it["file:".len..];
        }

        for (path_it) |c| {
            if (encoded_path_cars[c]) |s| {
                std.mem.copyForwards(u8, buf_it[0..s.len], s);
                buf_it = buf_it[s.len..];
                break;
            }

            buf_it[0] = c;
            buf_it = buf_it[1..];
        }

        return result;
    }

    /// Measures the length of the URL resulting from pathToFileUrl.
    pub fn pathToFileUrlLength(path: []const u8) usize {
        var size: u32 = 0;
        for (path) |c| {
            if (encoded_path_cars[c]) |s| {
                size += @intCast(s.len);
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
    ///
    /// TODO(markovejnovic): This function's implementation is __pure__ unadulterated slop. Somehow
    /// it works and appears to match npa's behavior, but if a human even has a shot at
    /// deciphering this, we'll need to rewrite it.
    ///
    /// Ultimately the goal of this function is to do what a lot of regexes do in npa.js, but
    /// without any of that -- that causes the function to quickly spiral into a mess + I've been
    /// in the office for 14h straight and my brain is mush. I apologize.
    pub fn cleanPathToFileUrl(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
        // Step 1: Measure the length after pathToFileURL and determine transformations
        var total_len = pathToFileUrlLength(path);

        // Determine which transformations we need to apply by analyzing the input
        var needs_file_double_slash_fix = false;
        var needs_relative_path_fix = false;
        var slashes_to_remove: usize = 0; // For length calculation
        var original_slashes: usize = 0; // For skipping in original input

        // After pathToFileURL, the result will start with "file:" if input starts with "/" or already has "file:"
        const raw_spec_starts_with_file_slash = bun.strings.hasPrefixComptime(path, "file:/") or
            bun.strings.hasPrefixComptime(path, "/");

        if (raw_spec_starts_with_file_slash) {
            // Check for: file://[^/] pattern (turn file://path into file:/path)
            // npa.js: rawSpec = `file:/${rawSpec.slice(5)}`
            // This KEEPS everything after index 5 and adds one '/'
            // Example: file://path -> file:/ + //path = file:///path (+1 char)
            if (bun.strings.hasPrefixComptime(path, "file://")) {
                if (path.len > "file://".len and path["file://".len] != '/') {
                    needs_file_double_slash_fix = true;
                    // Adds 1 slash
                    total_len += 1;
                }
            }

            // Check for: ^\/{1,3}\.\.?(\/|$) pattern after "file:" prefix
            const check_offset: usize = if (bun.strings.hasPrefixComptime(path, "file:")) "file:".len else 0;
            const after_file_colon = path[check_offset..];

            var slash_count: usize = 0;
            var idx: usize = 0;
            while (idx < after_file_colon.len and after_file_colon[idx] == '/' and slash_count < 3) : (idx += 1) {
                slash_count += 1;
            }

            // If file://[^/] transformation applies, it adds a slash, so adjust count
            const effective_slash_count = if (needs_file_double_slash_fix) slash_count + 1 else slash_count;

            // Only process 1 or 3 slashes (2 is handled by file:// case above)
            if ((effective_slash_count == 1 or effective_slash_count == 3) and idx < after_file_colon.len) {
                if (after_file_colon[idx] == '.') {
                    idx += 1;
                    // Check for optional second dot
                    const has_second_dot = idx < after_file_colon.len and after_file_colon[idx] == '.';
                    if (has_second_dot) {
                        idx += 1;
                    }
                    // Check for / or end of string
                    const valid_ending = idx == after_file_colon.len or after_file_colon[idx] == '/';
                    if (valid_ending) {
                        needs_relative_path_fix = true;
                        slashes_to_remove = effective_slash_count; // For length calculation
                        original_slashes = slash_count; // For skipping in original
                        total_len -= effective_slash_count;
                    }
                }
            }
        }

        // Step 2: Allocate the final buffer (single allocation)
        const result = try allocator.alloc(u8, total_len);
        var buf_it = result;

        // Step 3: Always write "file:" prefix to output
        std.mem.copyForwards(u8, buf_it[0.."file:".len], "file:");
        buf_it = buf_it["file:".len..];

        // Step 4: Determine where to start reading from input
        const input_has_file_prefix = bun.strings.hasPrefixComptime(path, "file:");
        var path_idx: usize = if (input_has_file_prefix) "file:".len else 0;

        // Write the extra slash if the file://[^/] transformation applies
        // BUT NOT if the relative path fix will remove it
        // This must happen BEFORE copying the rest, as we're inserting a slash
        if (needs_file_double_slash_fix and !needs_relative_path_fix) {
            buf_it[0] = '/';
            buf_it = buf_it[1..];
        }

        // Apply transformations by adjusting path_idx
        // For file://[^/], we just wrote an extra slash above, but don't skip anything
        // For relative path fix, skip the original slashes
        if (needs_relative_path_fix) {
            // file:/{1,3}path -> file:path
            // Skip the original slashes in the input
            path_idx += original_slashes;
        }

        // Step 5: Copy remaining characters with encoding
        for (path[path_idx..]) |c| {
            if (encoded_path_cars[c]) |s| {
                std.mem.copyForwards(u8, buf_it[0..s.len], s);
                buf_it = buf_it[s.len..];
            } else {
                buf_it[0] = c;
                buf_it = buf_it[1..];
            }
        }

        return result;
    }
};

fn fromFile(
    allocator: std.mem.Allocator,
    name: ?[]const u8,
    raw_spec: []const u8,
    where: []const u8,
    raw: []const u8,
) !NpaSpec {
    // Determine type: file or directory based on extension
    const spec_type = inodeType(raw_spec);

    // Clean the raw_spec using pathToFileURL transformations
    var raw_spec_cleaned = PathToFileUrlUtils.cleanPathToFileUrl(allocator, raw_spec) catch return error.InvalidPath;
    defer allocator.free(raw_spec_cleaned);

    // Create resolvedUrl: new URL(rawSpec, `${pathToFileURL(path.resolve(where))}/`)
    // First, resolve the "where" path
    var where_buf: bun.PathBuffer = undefined;
    var where_buf2: bun.PathBuffer = undefined;
    const resolved_where = if (bun.Environment.isWindows)
        PathResolver.resolveWindowsT(u8, &.{where}, &where_buf, &where_buf2)
    else
        PathResolver.resolvePosixT(u8, &.{where}, &where_buf, &where_buf2);

    const resolved_where_path = switch (resolved_where) {
        .result => |r| r,
        .err => return error.InvalidPath,
    };

    // Build where file URL with trailing slash using StringBuilder
    // Calculate the required capacity
    var where_url_len = PathToFileUrlUtils.pathToFileUrlLength(resolved_where_path);
    where_url_len += 1; // Add 1 for trailing slash

    var where_url_builder = bun.StringBuilder{ .cap = where_url_len, .len = 0, .ptr = null };
    try where_url_builder.allocate(allocator);
    defer where_url_builder.deinit(allocator);

    // Manually build the pathToFileURL result with trailing slash in one go
    if (!bun.strings.hasPrefixComptime(resolved_where_path, "file:")) {
        _ = where_url_builder.append("file:");
    }

    // Encode the path
    for (resolved_where_path) |c| {
        if (PathToFileUrlUtils.encoded_path_cars[c]) |encoded| {
            _ = where_url_builder.append(encoded);
        } else {
            _ = where_url_builder.append(&[_]u8{c});
        }
    }

    // Add trailing slash
    _ = where_url_builder.append("/");

    const where_with_slash = where_url_builder.ptr.?[0..where_url_builder.len];

    // RFC 8089 backwards compatibility: turn file://path into file:/path
    // This handles file:// followed by a non-slash character
    if (raw_spec_cleaned.len >= 7 and
        bun.strings.hasPrefixComptime(raw_spec_cleaned, "file://") and
        raw_spec_cleaned[7] != '/')
    {
        // file://path/to/foo -> file:/path/to/foo
        var compat_builder = std.ArrayList(u8).init(allocator);
        defer compat_builder.deinit();
        try compat_builder.appendSlice("file:/");
        try compat_builder.appendSlice(raw_spec_cleaned[7..]);
        const old_cleaned = raw_spec_cleaned;
        raw_spec_cleaned = try compat_builder.toOwnedSlice();
        allocator.free(old_cleaned);
    }

    const resolved_href = bun.jsc.URL.join(bun.String.init(where_with_slash), bun.String.init(raw_spec_cleaned));
    defer resolved_href.deref();

    if (comptime bun.Environment.allow_assert) {
        const resolved_href_utf8 = resolved_href.toUTF8(allocator);
        defer resolved_href_utf8.deinit();
    }

    const resolved_url = bun.jsc.URL.fromString(resolved_href) orelse return error.InvalidURL;
    defer resolved_url.deinit();

    const spec_url = bun.jsc.URL.fromString(bun.String.init(raw_spec_cleaned)) orelse return error.InvalidURL;
    defer spec_url.deinit();

    // Decode spec_url.pathname
    const spec_pathname_str = spec_url.pathname();
    defer spec_pathname_str.deref();
    const spec_pathname = spec_pathname_str.toUTF8(allocator);
    defer spec_pathname.deinit();

    var spec_path_list = std.ArrayList(u8).init(allocator);
    defer spec_path_list.deinit();
    _ = PercentEncoding.decode(@TypeOf(spec_path_list.writer()), spec_path_list.writer(), spec_pathname.slice()) catch return error.InvalidPath;
    var spec_path = try spec_path_list.toOwnedSlice();
    defer allocator.free(spec_path);

    // Decode resolved_url.pathname
    const resolved_pathname_str = resolved_url.pathname();
    defer resolved_pathname_str.deref();

    const resolved_pathname = resolved_pathname_str.toUTF8(allocator);
    defer resolved_pathname.deinit();

    var resolved_path_list = std.ArrayList(u8).init(allocator);
    defer resolved_path_list.deinit();
    _ = PercentEncoding.decode(@TypeOf(resolved_path_list.writer()), resolved_path_list.writer(), resolved_pathname.slice()) catch return error.InvalidPath;
    var resolved_path = try resolved_path_list.toOwnedSlice();
    defer allocator.free(resolved_path);

    // On Windows, strip leading slashes before drive letters
    if (bun.Environment.isWindows) {
        spec_path = stripWindowsLeadingSlashes(spec_path);
        resolved_path = stripWindowsLeadingSlashes(resolved_path);
    }

    // Handle special cases for saveSpec and fetchSpec
    var save_spec: []const u8 = undefined;
    var fetch_spec: []const u8 = undefined;

    // Check for homedir pattern: /~/ or /~
    if (spec_path.len >= 2 and spec_path[0] == '/' and spec_path[1] == '~' and
        (spec_path.len == 2 or spec_path[2] == '/'))
    {
        // res.saveSpec = `file:${specPath.substr(1)}`
        save_spec = try std.fmt.allocPrint(allocator, "file:{s}", .{spec_path[1..]});

        // res.fetchSpec = path.resolve(homedir(), specPath.substr(3))
        // Get the home directory and resolve the path against it
        const home = bun.getenvZ("HOME") orelse return error.InvalidPath;
        const path_after_tilde = spec_path[3..]; // Skip "/~/"

        var fetch_buf: bun.PathBuffer = undefined;
        var fetch_buf2: bun.PathBuffer = undefined;
        const fetch_resolved = if (bun.Environment.isWindows)
            PathResolver.resolveWindowsT(u8, &.{ home, path_after_tilde }, &fetch_buf, &fetch_buf2)
        else
            PathResolver.resolvePosixT(u8, &.{ home, path_after_tilde }, &fetch_buf, &fetch_buf2);

        fetch_spec = try allocator.dupe(u8, switch (fetch_resolved) {
            .result => |r| r,
            .err => return error.InvalidPath,
        });
    } else if (!std.fs.path.isAbsolute(if (raw_spec_cleaned.len > 5) raw_spec_cleaned[5..] else "")) { // Check if path after "file:" is relative
        // res.saveSpec = `file:${path.relative(where, resolvedPath)}`
        var rel_buf: bun.PathBuffer = undefined;
        var rel_buf2: bun.PathBuffer = undefined;
        var rel_buf3: bun.PathBuffer = undefined;
        const relative_result = if (bun.Environment.isWindows)
            PathResolver.relativeWindowsT(u8, resolved_where_path, resolved_path, &rel_buf, &rel_buf2, &rel_buf3)
        else
            PathResolver.relativePosixT(u8, resolved_where_path, resolved_path, &rel_buf, &rel_buf2, &rel_buf3);

        const relative_path = switch (relative_result) {
            .result => |r| r,
            .err => return error.InvalidPath,
        };

        save_spec = try std.fmt.allocPrint(allocator, "file:{s}", .{relative_path});

        // res.fetchSpec = path.resolve(where, resolvedPath)
        var fetch_buf: bun.PathBuffer = undefined;
        var fetch_buf2: bun.PathBuffer = undefined;
        const fetch_resolved = if (bun.Environment.isWindows)
            PathResolver.resolveWindowsT(u8, &.{ where, resolved_path }, &fetch_buf, &fetch_buf2)
        else
            PathResolver.resolvePosixT(u8, &.{ where, resolved_path }, &fetch_buf, &fetch_buf2);

        fetch_spec = try allocator.dupe(u8, switch (fetch_resolved) {
            .result => |r| r,
            .err => return error.InvalidPath,
        });
    } else {
        // res.saveSpec = `file:${path.resolve(resolvedPath)}`
        var save_buf: bun.PathBuffer = undefined;
        var save_buf2: bun.PathBuffer = undefined;
        const save_resolved = if (bun.Environment.isWindows)
            PathResolver.resolveWindowsT(u8, &.{resolved_path}, &save_buf, &save_buf2)
        else
            PathResolver.resolvePosixT(u8, &.{resolved_path}, &save_buf, &save_buf2);

        save_spec = try std.fmt.allocPrint(allocator, "file:{s}", .{switch (save_resolved) {
            .result => |r| r,
            .err => return error.InvalidPath,
        }});

        // res.fetchSpec = path.resolve(where, resolvedPath)
        var fetch_buf: bun.PathBuffer = undefined;
        var fetch_buf2: bun.PathBuffer = undefined;
        const fetch_resolved = if (bun.Environment.isWindows)
            PathResolver.resolveWindowsT(u8, &.{ where, resolved_path }, &fetch_buf, &fetch_buf2)
        else
            PathResolver.resolvePosixT(u8, &.{ where, resolved_path }, &fetch_buf, &fetch_buf2);

        fetch_spec = try allocator.dupe(u8, switch (fetch_resolved) {
            .result => |r| r,
            .err => return error.InvalidPath,
        });
    }

    // Normalize slashes in saveSpec (replace backslashes with forward slashes on Windows)
    if (bun.Environment.isWindows) {
        for (save_spec) |*c| {
            if (c.* == '\\') c.* = '/';
        }

        // Fix double slashes: file://C:/foo -> file:/C:/foo
        if (bun.strings.hasPrefixComptime(save_spec, "file://")) {
            const temp = save_spec;
            save_spec = try std.fmt.allocPrint(allocator, "file:/{s}", .{temp[7..]});
            allocator.free(temp);
        }
    }

    // Duplicate raw_spec so we own it
    const raw_spec_owned = try allocator.dupe(u8, raw_spec);

    return switch (spec_type) {
        .file => .{
            .file = .{
                .raw = raw,
                .name = name,
                .raw_spec = raw_spec_owned,
                .fetch_spec = fetch_spec,
                .save_spec = save_spec,

                ._allocator = allocator,
            },
        },
        .directory => .{
            .directory = .{
                .raw = raw,
                .name = name,
                .raw_spec = raw_spec_owned,
                .fetch_spec = fetch_spec,
                .save_spec = save_spec,

                ._allocator = allocator,
            },
        },
    };
}

/// Strips leading slashes before Windows drive letters: /C:/foo -> C:/foo
/// Matches the regex: /^\/+([a-z]:\/)/i
fn stripWindowsLeadingSlashes(path: []const u8) []const u8 {
    if (path.len < 3) return path;

    var slash_count: usize = 0;
    while (slash_count < path.len and path[slash_count] == '/') {
        slash_count += 1;
    }

    if (slash_count == 0) return path;

    // Check if after the slashes we have a drive letter pattern: [a-zA-Z]:/
    if (slash_count + 2 < path.len) {
        const c = path[slash_count];
        const is_drive_letter = (c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z');
        const has_colon = path[slash_count + 1] == ':';
        const has_slash = path[slash_count + 2] == '/';

        if (is_drive_letter and has_colon and has_slash) {
            // Strip the leading slashes
            return path[slash_count..];
        }
    }

    return path;
}

fn isGitScp(spec_str: []const u8) bool {
    // Matches: /^[^@]+@[^:.]+\.[^:]+:.+$/i
    const at_idx = bun.strings.indexOfChar(spec_str, '@') orelse return false;
    if (at_idx == 0) return false;

    var i = at_idx + 1;
    if (i >= spec_str.len) return false;

    // Find first dot after @, ensuring no : or . before it
    while (i < spec_str.len) : (i += 1) {
        if (spec_str[i] == ':' or spec_str[i] == '.') break;
    }
    if (i >= spec_str.len or spec_str[i] != '.') return false;

    i += 1;
    if (i >= spec_str.len) return false;

    // Find colon after the dot, ensuring no colon before it
    while (i < spec_str.len) : (i += 1) {
        if (spec_str[i] == ':') break;
    }
    if (i >= spec_str.len or spec_str[i] != ':') return false;

    // Ensure there's at least one character after the colon
    return i + 1 < spec_str.len;
}

fn isUrl(spec_str: []const u8) bool {
    // The original regex was ^(?:git[+])?[a-z]+: (note the ^ anchor - must match at START)

    // If the string starts with git:, then it's automatically a URL.
    if (bun.strings.hasPrefixComptime(spec_str, "git:")) {
        return true;
    }

    // If it starts with a git+ prefix, then we need to ensure that it is followed by a legal
    // scheme (which is just a-z letters).
    if (bun.strings.hasPrefixComptime(spec_str, "git+")) {
        for (spec_str["git+".len..]) |c| {
            if (c == ':') {
                return true;
            }

            if (!(c >= 'a' and c <= 'z')) {
                return false;
            }
        }

        // If we reach the terminal case, then that means we missed a colon -- not a URL.
        return false;
    }

    // Now, the string may not start with git+ or git: at all, in that case we need to make sure
    // the characters before the first colon are all a-z letters (and it starts with them).
    const colon_idx = bun.strings.indexOf(spec_str, ":") orelse return false;

    // Must have at least one character before the colon
    if (colon_idx == 0) return false;

    for (spec_str[0..colon_idx]) |c| {
        if (!(c >= 'a' and c <= 'z')) {
            return false;
        }
    }

    // Otherwise, it's a URL.
    return true;
}

/// Matches the implementation of isFileSpec in npm-package-arg.
fn isFileSpec(spec_str: []const u8) bool {
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

fn isWindowsFile(spec_str: []const u8) bool {
    // This is the heuristic npm-package-arg uses. You can debate whether it is good or not, but
    // this is what they use.
    if (spec_str.len < 1) return false;

    return switch (spec_str[0]) {
        '.',
        '/',
        '\\',
        => true,
        '~' => spec_str.len >= 2 and spec_str[1] == '/',
        'a'...'z', 'A'...'Z' => spec_str.len >= 2 and spec_str[1] == ':',
        else => false,
    };
}

fn isPosixFile(spec_str: []const u8) bool {
    // This is kind of weird but npm-package-arg also supports C: as path prefixes on POSIX
    // platforms. ¯\_(ツ)_/¯ Maybe there's Sun or something.
    if (spec_str.len < 1) return false;

    return switch (spec_str[0]) {
        '.',
        '/',
        => true,
        '~' => spec_str.len >= 2 and spec_str[1] == '/',
        'a'...'z', 'A'...'Z' => spec_str.len >= 2 and spec_str[1] == ':',
        else => false,
    };
}

fn isAliasSpec(spec_str: []const u8) bool {
    return bun.strings.hasPrefixCaseInsensitive(spec_str, "npm:");
}

fn fromURL(
    allocator: std.mem.Allocator,
    name: ?[]const u8,
    raw_spec: []const u8,
    raw: []const u8,
) !NpaSpec {
    // TODO(markovejnovic): Most of this function was written by Claude. It would be really
    // beneficial if we refactored this function out to be a little bit more mentally manageable.

    var raw_spec_mut = raw_spec;
    var raw_spec_allocated: ?[]u8 = null;
    defer if (raw_spec_allocated) |s| allocator.free(s);

    // Handle git+ssh:// SCP-style URLs
    // Regex: /^git\+ssh:\/\/([^:#]+:[^#]+(?:\.git)?)(?:#(.*))?$/i
    // Looking for: git+ssh://user@host:path (not git+ssh://host:port/path)
    if (bun.strings.hasPrefixCaseInsensitive(raw_spec, "git+ssh://")) {
        const after_prefix = raw_spec["git+ssh://".len..];

        // Only look for : before the # (SCP detection should not find : in hash part)
        // First, find where the hash starts
        const hash_idx = bun.strings.indexOfChar(after_prefix, '#');
        const before_hash = if (hash_idx) |h| after_prefix[0..h] else after_prefix;

        // Look for the pattern: [^:#]+:[^#]+ (user@host:path, not :1234)
        const colon_idx = bun.strings.indexOfChar(before_hash, ':');
        if (colon_idx) |idx| {
            const before_colon = before_hash[0..idx];

            // Check if the ENTIRE string (before hash) contains a port number pattern: :[0-9]+(/|$)
            // This matches npa.js isPortNumber regex
            var contains_port = false;
            var i: usize = 0;
            while (i < before_hash.len) : (i += 1) {
                if (before_hash[i] == ':') {
                    // Found a colon, check if followed by digits and then / or end
                    var j = i + 1;
                    var has_digits = false;
                    while (j < before_hash.len and before_hash[j] >= '0' and before_hash[j] <= '9') : (j += 1) {
                        has_digits = true;
                    }
                    if (has_digits and (j >= before_hash.len or before_hash[j] == '/')) {
                        contains_port = true;
                        break;
                    }
                }
            }

            // If it doesn't contain a port number, it's SCP-style
            if (!contains_port and before_colon.len > 0) {
                const fetch_spec = try allocator.dupe(u8, before_hash);
                const save_spec = try allocator.dupe(u8, raw_spec);
                const raw_spec_owned = try allocator.dupe(u8, raw_spec);

                // Extract and parse committish from hash
                const raw_committish = if (hash_idx) |h|
                    if (h + 1 < after_prefix.len)
                        after_prefix[h + 1 ..]
                    else
                        null
                else
                    null;

                // Parse the committish for special syntax like semver:, path:
                const git_attrs = try parseGitAttrs(allocator, raw_committish);

                return .{
                    .git = .{
                        .raw = raw,
                        .name = name,
                        .raw_spec = raw_spec_owned,
                        .fetch_spec = fetch_spec,
                        .save_spec = save_spec,
                        .git_committish = git_attrs.committish,
                        .git_range = git_attrs.range,
                        .git_subdir = git_attrs.subdir,
                        ._allocator = allocator,
                    },
                };
            }
        }
    }

    // Handle git+file:// Windows path normalization
    if (bun.strings.hasPrefixCaseInsensitive(raw_spec, "git+file://")) {
        // Replace backslashes with forward slashes for Windows
        if (bun.Environment.isWindows or bun.strings.indexOfChar(raw_spec, '\\') != null) {
            const normalized = try allocator.dupe(u8, raw_spec);
            for (normalized) |*c| {
                if (c.* == '\\') c.* = '/';
            }
            raw_spec_mut = normalized;
            raw_spec_allocated = normalized;
        }
    }

    // Parse the URL
    const parsed_url = bun.jsc.URL.fromString(bun.String.init(raw_spec_mut)) orelse return error.InvalidURL;
    defer parsed_url.deinit();

    const protocol_str = parsed_url.protocol();
    defer protocol_str.deref();
    const protocol = protocol_str.toUTF8(allocator);
    defer protocol.deinit();

    // Switch on protocol
    const protocol_slice = protocol.slice();

    // Git protocols
    // Note: URL.protocol() returns without the trailing colon
    if (bun.strings.eqlComptime(protocol_slice, "git") or
        bun.strings.eqlComptime(protocol_slice, "git+http") or
        bun.strings.eqlComptime(protocol_slice, "git+https") or
        bun.strings.eqlComptime(protocol_slice, "git+rsync") or
        bun.strings.eqlComptime(protocol_slice, "git+ftp") or
        bun.strings.eqlComptime(protocol_slice, "git+file") or
        bun.strings.eqlComptime(protocol_slice, "git+ssh"))
    {
        var fetch_spec: []const u8 = undefined;

        // Special handling for git+file:// with Windows drive letters
        if (bun.strings.eqlComptime(protocol_slice, "git+file")) {
            // Check for pattern: git+file://[a-z]:
            if (raw_spec_mut.len > "git+file://".len + 2) {
                const after_protocol = raw_spec_mut["git+file://".len..];
                if (after_protocol.len >= 2 and after_protocol[1] == ':') {
                    const c = after_protocol[0];
                    if ((c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z')) {
                        // Extract host and pathname
                        const host_str = parsed_url.host();
                        defer host_str.deref();
                        const pathname_str = parsed_url.pathname();
                        defer pathname_str.deref();

                        const host_utf8 = host_str.toUTF8(allocator);
                        defer host_utf8.deinit();
                        const pathname_utf8 = pathname_str.toUTF8(allocator);
                        defer pathname_utf8.deinit();

                        // Convert host to lowercase (npa.js line 412)
                        const host_lower = try allocator.alloc(u8, host_utf8.slice().len);
                        defer allocator.free(host_lower);
                        for (host_utf8.slice(), 0..) |ch, idx| {
                            host_lower[idx] = std.ascii.toLower(ch);
                        }

                        fetch_spec = try std.fmt.allocPrint(allocator, "git+file://{s}:{s}", .{
                            host_lower,
                            pathname_utf8.slice(),
                        });
                    } else {
                        // Regular URL toString without hash
                        const href = parsed_url.href();
                        defer href.deref();
                        const href_utf8 = href.toUTF8(allocator);
                        defer href_utf8.deinit();

                        // Remove hash if present
                        const href_slice = href_utf8.slice();
                        const without_hash = if (bun.strings.indexOfChar(href_slice, '#')) |idx|
                            href_slice[0..idx]
                        else
                            href_slice;

                        fetch_spec = try allocator.dupe(u8, without_hash);
                    }
                } else {
                    const href = parsed_url.href();
                    defer href.deref();
                    const href_utf8 = href.toUTF8(allocator);
                    defer href_utf8.deinit();

                    const href_slice = href_utf8.slice();
                    const without_hash = if (bun.strings.indexOfChar(href_slice, '#')) |idx|
                        href_slice[0..idx]
                    else
                        href_slice;

                    fetch_spec = try allocator.dupe(u8, without_hash);
                }
            } else {
                const href = parsed_url.href();
                defer href.deref();
                const href_utf8 = href.toUTF8(allocator);
                defer href_utf8.deinit();

                const href_slice = href_utf8.slice();
                const without_hash = if (bun.strings.indexOfChar(href_slice, '#')) |idx|
                    href_slice[0..idx]
                else
                    href_slice;

                fetch_spec = try allocator.dupe(u8, without_hash);
            }
        } else {
            // For other git protocols, use URL without hash
            const href = parsed_url.href();
            defer href.deref();
            const href_utf8 = href.toUTF8(allocator);
            defer href_utf8.deinit();

            const href_slice = href_utf8.slice();
            const without_hash = if (bun.strings.indexOfChar(href_slice, '#')) |idx|
                href_slice[0..idx]
            else
                href_slice;

            fetch_spec = try allocator.dupe(u8, without_hash);
        }

        // Strip git+ prefix from fetchSpec if present
        const final_fetch_spec = if (bun.strings.hasPrefixComptime(fetch_spec, "git+")) blk: {
            const without_prefix = try allocator.dupe(u8, fetch_spec[4..]);
            allocator.free(fetch_spec);
            break :blk without_prefix;
        } else fetch_spec;

        const save_spec = try allocator.dupe(u8, raw_spec);
        const raw_spec_owned = try allocator.dupe(u8, raw_spec);

        // Extract and parse committish from hash
        const hash_str = parsed_url.hash();
        defer hash_str.deref();
        const hash_utf8 = hash_str.toUTF8(allocator);
        defer hash_utf8.deinit();
        const hash_slice = hash_utf8.slice();
        const raw_committish = if (hash_slice.len > 1)
            hash_slice[1..] // Skip the # character
        else
            null;

        // Parse the committish for special syntax like semver:, path:
        const git_attrs = try parseGitAttrs(allocator, raw_committish);

        return .{
            .git = .{
                .raw = raw,
                .name = name,
                .raw_spec = raw_spec_owned,
                .fetch_spec = final_fetch_spec,
                .save_spec = save_spec,
                .git_committish = git_attrs.committish,
                .git_range = git_attrs.range,
                .git_subdir = git_attrs.subdir,
                //.hosted = .{ .type = "git" },
                ._allocator = allocator,
            },
        };
    }

    // HTTP/HTTPS protocols - remote type
    // Note: URL.protocol() returns without the trailing colon
    if (bun.strings.eqlComptime(protocol_slice, "http") or
        bun.strings.eqlComptime(protocol_slice, "https"))
    {
        const raw_spec_owned = try allocator.dupe(u8, raw_spec);
        return .{
            .remote = .{
                .raw = raw,
                .name = name,
                .raw_spec = raw_spec_owned,
                .fetch_spec = raw_spec_owned,
                .save_spec = raw_spec_owned,
                ._allocator = allocator,
            },
        };
    }

    // Unsupported protocol
    return error.InvalidURL;
}

fn fromGitSpec(allocator: std.mem.Allocator, name: ?[]const u8, raw_spec: []const u8, raw: []const u8) !?NpaSpec {
    // We need a mutable reference to spec_str
    const mut_spec_str: []u8 = try allocator.dupe(u8, raw_spec);
    errdefer allocator.free(mut_spec_str);

    const hosted = try hgi.fromUrl(allocator, mut_spec_str) orelse {
        allocator.free(mut_spec_str);
        return null;
    };
    defer hosted.deinit();

    // This returns the appropriate format based on default_representation
    const save_spec = try hosted.toString(allocator);

    // Parse the committish to extract gitCommittish, gitRange, and gitSubdir
    const git_attrs = try parseGitAttrs(allocator, hosted.committish);

    // npa.js line 363: res.fetchSpec = hosted.getDefaultRepresentation() === 'shortcut' ? null : hosted.toString()
    // For shortcuts, fetchSpec is null; otherwise it's the string representation
    // fetchSpec should NEVER include the hash/committish
    // Also, fetchSpec has git+ prefix stripped
    const fetch_spec = if (hosted.default_representation == .shortcut)
        null
    else blk: {
        // Always strip committish from fetchSpec by creating temp hosted without it
        const temp_hosted = hgi.HostedGitInfo{
            .host_provider = hosted.host_provider,
            .committish = null, // Always strip committish for fetchSpec
            .project = hosted.project,
            .user = hosted.user,
            .default_representation = hosted.default_representation,
            ._allocator = hosted._allocator,
        };
        const url_str = try temp_hosted.toString(allocator);

        // Strip git+ prefix from fetchSpec
        if (bun.strings.hasPrefixComptime(url_str, "git+")) {
            const without_prefix = try allocator.dupe(u8, url_str[4..]);
            allocator.free(url_str);
            break :blk without_prefix;
        }
        break :blk url_str;
    };

    return .{
        .git = .{
            .raw = raw,
            .name = name,
            .raw_spec = mut_spec_str, // Use the duplicated string
            .fetch_spec = fetch_spec,
            .save_spec = save_spec,
            .git_committish = git_attrs.committish,
            .git_range = git_attrs.range,
            .git_subdir = git_attrs.subdir,
            //.hosted = hosted,
            ._allocator = allocator,
        },
    };
}

/// Parse git committish for special syntax like semver:, path:, and :: separators
/// Matches npa.js setGitAttrs function (lines 214-252)
fn parseGitAttrs(allocator: std.mem.Allocator, committish: ?[]const u8) !struct {
    committish: ?[]const u8,
    range: ?[]const u8,
    subdir: ?[]const u8,
} {
    const c = committish orelse return .{ .committish = null, .range = null, .subdir = null };

    var result_committish: ?[]const u8 = null;
    var result_range: ?[]const u8 = null;
    var result_subdir: ?[]const u8 = null;

    // Split on :: (double colon separator)
    var parts_iter = std.mem.splitSequence(u8, c, "::");
    while (parts_iter.next()) |part| {
        if (part.len == 0) continue;

        // Check if this part has a : (name:value pattern)
        if (std.mem.indexOfScalar(u8, part, ':')) |colon_idx| {
            const key = part[0..colon_idx];
            const value = part[colon_idx + 1 ..];

            if (bun.strings.eqlComptime(key, "semver")) {
                if (result_committish != null) return error.OverridingCommittish;
                if (result_range != null) return error.OverridingRange;
                // URL decode the value (npa.js: decodeURIComponent(value))
                var decoded_list = std.ArrayList(u8).init(allocator);
                defer decoded_list.deinit();
                _ = PercentEncoding.decode(@TypeOf(decoded_list.writer()), decoded_list.writer(), value) catch value;
                result_range = try decoded_list.toOwnedSlice();
            } else if (bun.strings.eqlComptime(key, "path")) {
                if (result_subdir != null) return error.OverridingPath;
                result_subdir = try std.fmt.allocPrint(allocator, "/{s}", .{value});
            }
            // Ignore unknown keys
        } else {
            // No colon, so this is a plain committish
            if (result_range != null) return error.OverridingCommittish;
            if (result_committish != null) return error.DuplicateCommittish;
            result_committish = try allocator.dupe(u8, part);
        }
    }

    return .{
        .committish = result_committish,
        .range = result_range,
        .subdir = result_subdir,
    };
}

fn hasSlashes(spec_str: []const u8) bool {
    return bun.path.hasPathSlashes(spec_str);
}

fn heuristicIsFiletype(spec_str: []const u8) bool {
    return inodeType(spec_str) == .file;
}

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

        return npaSpecToJs(allocator, go, &resolved);
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

        // Construct raw argument as "name@spec" or just spec
        const raw_arg = if (name_utf8) |n|
            try std.fmt.allocPrint(allocator, "{s}@{s}", .{ n.slice(), spec_utf8.slice() })
        else
            null;
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

        return npaSpecToJs(allocator, go, &resolved);
    }

    fn npaSpecToJs(
        allocator: std.mem.Allocator,
        go: *jsc.JSGlobalObject,
        spec: *const NpaSpec,
    ) jsc.JSValue {
        var object = jsc.JSValue.createEmptyObject(go, 8);

        object.put(go, "raw", bun.String.fromBytes(spec.raw()).toJS(go));
        object.put(go, "rawSpec", bun.String.fromBytes(spec.rawSpec()).toJS(go));
        object.put(go, "name", if (spec.name()) |n| bun.String.fromBytes(n).toJS(go) else .null);
        object.put(go, "type", bun.String.fromBytes(spec.type()).toJS(go));
        // Alias types should have fetchSpec as null, not undefined
        // Git shortcuts also have null fetchSpec
        const fetch_spec_value = if (spec.* == .alias)
            .null
        else if (spec.fetchSpec()) |f|
            bun.String.fromBytes(f).toJS(go)
        else
            .null;
        object.put(go, "fetchSpec", fetch_spec_value);
        object.put(
            go,
            "saveSpec",
            if (spec.saveSpec()) |s| bun.String.fromBytes(s).toJS(go) else .null,
        );

        const escaped_name = bun.handleOom(spec.escapedName(allocator));
        defer if (escaped_name) |e| allocator.free(e);
        object.put(
            go,
            "escapedName",
            if (escaped_name) |n| bun.String.fromBytes(n).toJS(go) else .null,
        );

        object.put(
            go,
            "scope",
            if (spec.scope()) |s| bun.String.fromBytes(s).toJS(go) else .null,
        );

        // Add gitCommittish for git types
        if (spec.* == .git) {
            object.put(
                go,
                "gitCommittish",
                if (spec.git.git_committish) |gc| bun.String.fromBytes(gc).toJS(go) else .null,
            );
            object.put(
                go,
                "gitRange",
                if (spec.git.git_range) |gr| bun.String.fromBytes(gr).toJS(go) else .null,
            );
            object.put(
                go,
                "gitSubdir",
                if (spec.git.git_subdir) |gs| bun.String.fromBytes(gs).toJS(go) else .null,
            );
            // TODO(@markovejnovic): Implement hosted field serialization
            // For now, return null to match test expectations
            object.put(go, "hosted", .null);
        }

        if (spec.* == .alias) {
            const sub_spec_js = npaSpecToJs(allocator, go, spec.alias.sub_spec);
            object.put(go, "subSpec", sub_spec_js);
        }

        // Add registry field for registry types
        if (spec.isRegistry()) {
            object.put(go, "registry", jsc.JSValue.jsBoolean(true));
        }

        return object;
    }

    const jsc = bun.jsc;
};

const hgi = @import("./hosted_git_info.zig");
const validate_npm_package_name = @import("./validate_npm_package_name.zig");
const std = @import("std");

const bun = @import("bun");
const Semver = bun.Semver;
const PercentEncoding = @import("../url.zig").PercentEncoding;
const PathResolver = @import("../bun.js/node/path.zig");

const debug = bun.Output.scoped(.npm_package_arg, .visible);
