//! Resolves Git URLs and metadata.
//!
//! This library mimics https://www.npmjs.com/package/hosted-git-info. At the time of writing, the
//! latest version is 9.0.0. Although @markovejnovic believes there are bugs in the original
//! library, this library aims to be bug-for-bug compatible with the original.
//!
//! One thing that's really notable is that hosted-git-info supports extensions and we currently
//! offer no support for extensions. This could be added in the future if necessary.
//!
//! # Core Concepts
//!
//! The goal of this library is to transform a Git URL or a "shortcut" (which is a shorthand for a
//! longer URL) into a structured representation of the relevant Git repository.
//!
//! ## Shortcuts
//!
//! A shortcut is a shorthand for a longer URL. For example, `github:user/repo` is a shortcut which
//! resolves to a full Github URL. `gitlab:user/repo` is another example of a shortcut.
//!
//! # Types
//!
//! This library revolves around a couple core types which are briefly described here.
//!
//! ## `HostedGitInfo`
//!
//! This is the main API point of this library. It encapsulates information about a Git repository.
//! To parse URLs into this structure, use the `fromUrl` member function.
//!
//! ## `HostProvider`
//!
//! This enumeration defines all the known Git host providers. Each provider has slightly different
//! properties which need to be accounted for. Further details are provided in its documentation.
//!
//! ## `UrlProtocol`
//!
//! This is a type that encapsulates the different types of protocols that a URL may have. This
//! includes three different cases:
//!
//!   - `well_defined`: A protocol which is directly supported by this library.
//!   - `custom`: A protocol which is not known by this library, but is specified in the URL.
//!               TODO(markovejnovic): How is this handled?
//!   - `unknown`: A protocol which is not specified in the URL.
//!
//! ## `WellDefinedProtocol`
//!
//! This type represents the set of known protocols by this library. Each protocol has slightly
//! different properties which need to be accounted for.
//!
//! It's noteworthy that `WellDefinedProtocol` doesn't refer to "true" protocols, but includes fake
//! tags like `github:` which are handled as "shortcuts" by this library.

/// Represents how a URL should be reported when formatting it as a string.
///
/// Input strings may be given in any format and they may be formatted in any format. If you wish
/// to format a URL in a specific format, you can use its `format*` methods. However, each input
/// string has a "default" representation which is used when calling `toString()`. Depending on the
/// input, the default representation may be different.
const Representation = enum {
    /// foo/bar
    shortcut,
    /// git+ssh://git@domain/user/project.git#committish
    sshurl,
    /// ssh://domain/user/project.git#committish
    ssh,
    /// https://domain/user/project.git#committish
    https,
    /// git://domain/user/project.git#committish
    git,
    /// http://domain/user/project.git#committish
    http,
};

pub const HostedGitInfo = struct {
    const Self = @This();

    committish: ?[]const u8,
    project: []const u8,
    user: ?[]const u8,
    host_provider: HostProvider,
    default_representation: Representation,

    _memory_buffer: []const u8,
    _allocator: std.mem.Allocator,

    /// Helper function to decode a percent-encoded string and append it to a StringBuilder.
    /// Returns the decoded slice and updates the StringBuilder's length.
    ///
    /// The reason we need to do this is because we get URLs like github:user%20name/repo and we
    /// need to decode them to 'user name/repo'. It would be nice if we could get all the
    /// functionality of jsc.URL WITHOUT the percent-encoding, but alas, we cannot. And we need the
    /// jsc.URL functionality for parsing, validating and punycode-decoding the URL.
    ///
    /// Therefore, we use this function to first take a URL string, encode it into a *jsc.URL and
    /// then decode it back to a normal string. Kind of a lot of work, but it works.
    fn decodeAndAppend(
        sb: *bun.StringBuilder,
        input: []const u8,
    ) error{ OutOfMemory, InvalidURL }![]const u8 {
        const writable = sb.writable();
        var stream = std.io.fixedBufferStream(writable);
        const decoded_len = PercentEncoding.decode(
            @TypeOf(stream.writer()),
            stream.writer(),
            input,
        ) catch {
            return error.InvalidURL;
        };
        sb.len += decoded_len;
        return writable[0..decoded_len];
    }

    fn copyFrom(
        committish: ?[]const u8,
        project: []const u8,
        user: ?[]const u8,
        host_provider: HostProvider,
        default_representation: Representation,
        allocator: std.mem.Allocator,
    ) error{ OutOfMemory, InvalidURL }!Self {
        var sb = bun.StringBuilder{};

        if (user) |u| sb.count(u);
        sb.count(project);
        if (committish) |c| sb.count(c);

        sb.allocate(allocator) catch return error.OutOfMemory;

        // Decode user, project, committish while copying
        const user_part = if (user) |u| try decodeAndAppend(&sb, u) else null;
        const project_part = try decodeAndAppend(&sb, project);
        const committish_part = if (committish) |c| try decodeAndAppend(&sb, c) else null;

        const owned_buffer = sb.allocatedSlice();

        return .{
            .committish = committish_part,
            .project = project_part,
            .user = user_part,
            .host_provider = host_provider,
            .default_representation = default_representation,
            ._memory_buffer = owned_buffer,
            ._allocator = allocator,
        };
    }

    /// Initialize a HostedGitInfo from an extracted structure.
    /// Takes ownership of the extracted structure.
    fn moveFromExtracted(
        extracted: *HostProvider.Config.formatters.extract.Result,
        host_provider: HostProvider,
        default_representation: Representation,
    ) Self {
        const moved = extracted.move();
        return .{
            .committish = extracted.committish,
            .project = extracted.project,
            .user = extracted.user,
            .host_provider = host_provider,
            .default_representation = default_representation,
            ._memory_buffer = moved.buffer,
            ._allocator = moved.allocator,
        };
    }

    /// Clean up owned memory
    pub fn deinit(self: *const Self) void {
        self._allocator.free(self._memory_buffer);
    }

    /// Convert this HostedGitInfo to a JavaScript object
    pub fn toJS(self: *const Self, go: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        const obj = jsc.JSValue.createEmptyObject(go, 6);
        obj.put(
            go,
            jsc.ZigString.static("type"),
            try bun.String.fromBytes(self.host_provider.typeStr()).toJS(go),
        );
        obj.put(
            go,
            jsc.ZigString.static("domain"),
            try bun.String.fromBytes(self.host_provider.domain()).toJS(go),
        );
        obj.put(
            go,
            jsc.ZigString.static("project"),
            try bun.String.fromBytes(self.project).toJS(go),
        );
        obj.put(
            go,
            jsc.ZigString.static("user"),
            if (self.user) |user| try bun.String.fromBytes(user).toJS(go) else .null,
        );
        obj.put(
            go,
            jsc.ZigString.static("committish"),
            if (self.committish) |committish|
                try bun.String.fromBytes(committish).toJS(go)
            else
                .null,
        );
        obj.put(
            go,
            jsc.ZigString.static("default"),
            try bun.String.fromBytes(@tagName(self.default_representation)).toJS(go),
        );

        return obj;
    }

    pub const StringPair = struct {
        save_spec: []const u8,
        fetch_spec: ?[]const u8,
    };

    /// Given a URL-like (including shortcuts) string, parses it into a HostedGitInfo structure.
    /// The HostedGitInfo is valid only for as long as `git_url` is valid.
    pub fn fromUrl(
        allocator: std.mem.Allocator,
        git_url: []const u8,
    ) error{ OutOfMemory, InvalidURL }!?Self {
        // git_url_mut may carry two ownership semantics:
        //  - It aliases `git_url`, in which case it must not be freed.
        //  - It actually points to a new allocation, in which case it must be freed.
        var git_url_mut = git_url;
        defer if (git_url.ptr != git_url_mut.ptr) allocator.free(git_url_mut);

        if (isGitHubShorthand(git_url)) {
            // In this case we have to prefix the url with `github:`.
            //
            // NOTE(markovejnovic): I don't exactly understand why this is treated specially.
            //
            // TODO(markovejnovic): Perhaps we can avoid this allocation...
            // This one seems quite easy to get rid of.
            git_url_mut = bun.handleOom(bun.strings.concat(allocator, &.{ "github:", git_url }));
        }

        const parsed = parseUrl(allocator, git_url_mut) catch {
            return null;
        };
        defer parsed.url.deinit();

        const host_provider = switch (parsed.proto) {
            .well_formed => |p| p.hostProvider() orelse HostProvider.fromUrlDomain(parsed.url),
            .unknown => HostProvider.fromUrlDomain(parsed.url),
            .custom => HostProvider.fromUrl(parsed.url),
        } orelse return null;

        const is_shortcut = parsed.proto == .well_formed and parsed.proto.well_formed.isShortcut();
        if (!is_shortcut) {
            var extracted = try host_provider.extract(allocator, parsed.url) orelse return null;
            return HostedGitInfo.moveFromExtracted(
                &extracted,
                host_provider,
                parsed.proto.defaultRepresentation(),
            );
        }

        // Shortcut path: github:user/repo, gitlab:user/repo, etc. (from-url.js line 68-96)
        const pathname_owned = try parsed.url.pathname().toOwnedSlice(allocator);
        defer allocator.free(pathname_owned);

        // Strip leading / (from-url.js line 69)
        var pathname = bun.strings.trimPrefixComptime(u8, pathname_owned, "/");

        // Strip auth (from-url.js line 70-74)
        if (bun.strings.indexOfChar(pathname, '@')) |first_at| {
            pathname = pathname[first_at + 1 ..];
        }

        // extract user and project from pathname (from-url.js line 76-86)
        var user_part: ?[]const u8 = null;
        const project_part: []const u8 = blk: {
            if (bun.strings.lastIndexOfChar(pathname, '/')) |last_slash| {
                const user_str = pathname[0..last_slash];
                // We want nulls only, never empty strings (from-url.js line 79-82)
                if (user_str.len > 0) {
                    user_part = user_str;
                }
                break :blk pathname[last_slash + 1 ..];
            } else {
                break :blk pathname;
            }
        };

        // Strip .git suffix (from-url.js line 88-90)
        const project_trimmed = bun.strings.trimSuffixComptime(project_part, ".git");

        // Get committish from URL fragment (from-url.js line 92-94)
        const fragment = try parsed.url.fragmentIdentifier().toOwnedSlice(allocator);
        defer allocator.free(fragment);
        const committish: ?[]const u8 = if (fragment.len > 0) fragment else null;

        // copyFrom will URL-decode user, project, and committish
        return try HostedGitInfo.copyFrom(
            committish,
            project_trimmed,
            user_part,
            host_provider,
            .shortcut, // Shortcuts always use shortcut representation
            allocator,
        );
    }
};

/// Handles input like git:github.com:user/repo and inserting the // after the first : if necessary
///
/// May error with `error.InvalidGitUrl` if the URL is not valid.
///
/// Note that this may or may not allocate but it manages its own memory.
fn parseUrl(allocator: std.mem.Allocator, npa_str: []const u8) error{ InvalidGitUrl, OutOfMemory }!struct {
    url: *jsc.URL,
    proto: UrlProtocol,
} {
    // Certain users can provide values like user:password@github.com:foo/bar and we want to
    // "correct" the protocol to be git+ssh://user:password@github.com:foo/bar
    var proto_pair = normalizeProtocol(npa_str);
    defer proto_pair.deinit();

    // TODO(markovejnovic): We might be able to avoid this allocation if we rework how jsc.URL
    //                      accepts strings.
    const maybe_url = proto_pair.toUrl(allocator);
    if (maybe_url) |url| return .{ .url = url, .proto = proto_pair.protocol };

    // Now that may fail, if the URL is not nicely formatted. In that case, we try to correct the
    // URL and parse it.
    var corrected = try correctUrl(&proto_pair, allocator);
    defer corrected.deinit();
    const corrected_url = corrected.toUrl(allocator);
    if (corrected_url) |url| return .{ .url = url, .proto = corrected.protocol };

    // Otherwise, we complain.
    return error.InvalidGitUrl;
}

/// Enumeration of possible URL protocols.
pub const WellDefinedProtocol = enum {
    const Self = @This();

    git,
    git_plus_file,
    git_plus_ftp,
    git_plus_http,
    git_plus_https,
    git_plus_rsync,
    git_plus_ssh,
    http,
    https,
    ssh,

    // Non-standard protocols.
    github,
    bitbucket,
    gitlab,
    gist,
    sourcehut,

    /// Mapping from protocol string (without colon) to WellDefinedProtocol.
    pub const strings = bun.ComptimeStringMap(Self, .{
        .{ "bitbucket", .bitbucket },
        .{ "gist", .gist },
        .{ "git+file", .git_plus_file },
        .{ "git+ftp", .git_plus_ftp },
        .{ "git+http", .git_plus_http },
        .{ "git+https", .git_plus_https },
        .{ "git+rsync", .git_plus_rsync },
        .{ "git+ssh", .git_plus_ssh },
        .{ "git", .git },
        .{ "github", .github },
        .{ "gitlab", .gitlab },
        .{ "http", .http },
        .{ "https", .https },
        .{ "sourcehut", .sourcehut },
        .{ "ssh", .ssh },
    });

    /// Look up a protocol from a string that includes the trailing colon (e.g., "https:").
    /// This method strips the colon before looking up in the strings map.
    pub fn fromStringWithColon(protocol_with_colon: []const u8) ?Self {
        return if (protocol_with_colon.len == 0)
            return null
        else
            strings.get(bun.strings.trimSuffixComptime(protocol_with_colon, ":"));
    }

    /// Maximum length of any protocol string in the strings map (computed at compile time).
    pub const max_protocol_length: comptime_int = blk: {
        var max: usize = 0;
        for (strings.kvs) |kv| {
            if (kv.key.len > max) {
                max = kv.key.len;
            }
        }
        break :blk max;
    };

    /// Buffer type for holding a protocol string with colon (e.g., "git+rsync:").
    /// Sized to hold the longest protocol name plus one character for the colon.
    pub const StringWithColonBuffer = [max_protocol_length + 1]u8;

    /// Get the protocol string with colon (e.g., "https:") for a given protocol enum.
    /// Takes a buffer pointer to hold the result.
    /// Returns a slice into that buffer containing the protocol string with colon.
    pub fn toStringWithColon(self: Self, buf: *StringWithColonBuffer) []const u8 {
        // Look up the protocol string (without colon) from the map
        const protocol_str = strings.getKey(self).?;

        // Copy to buffer and append colon
        @memcpy(buf[0..protocol_str.len], protocol_str);
        buf[protocol_str.len] = ':';
        return buf[0 .. protocol_str.len + 1];
    }

    /// The set of characters that must appear between <protocol><resource-identifier>.
    /// For example, in `git+ssh://user@host:repo`, the `//` is the magic string. Some protocols
    /// don't support this, for example `github:user/repo` is valid.
    ///
    /// Kind of arbitrary and implemented to match hosted-git-info's behavior.
    fn protocolResourceIdentifierConcatenationToken(self: Self) []const u8 {
        return switch (self) {
            .git,
            .git_plus_file,
            .git_plus_ftp,
            .git_plus_http,
            .git_plus_https,
            .git_plus_rsync,
            .git_plus_ssh,
            .http,
            .https,
            .ssh,
            => "//",
            .github, .bitbucket, .gitlab, .gist, .sourcehut => "",
        };
    }

    /// Determine the default representation for this protocol.
    /// Mirrors the logic in from-url.js line 110.
    fn defaultRepresentation(self: Self) Representation {
        return switch (self) {
            .git_plus_ssh, .ssh, .git_plus_http => .sshurl,
            .git_plus_https => .https,
            .git_plus_file, .git_plus_ftp, .git_plus_rsync, .git => .git,
            .http => .http,
            .https => .https,
            .github, .bitbucket, .gitlab, .gist, .sourcehut => .shortcut,
        };
    }

    /// Certain protocols will have associated host providers. This method returns the associated
    /// host provider, if one exists.
    fn hostProvider(self: Self) ?HostProvider {
        return switch (self) {
            .github => .github,
            .bitbucket => .bitbucket,
            .gitlab => .gitlab,
            .gist => .gist,
            .sourcehut => .sourcehut,
            else => null,
        };
    }

    fn isShortcut(self: Self) bool {
        return switch (self) {
            .github, .bitbucket, .gitlab, .gist, .sourcehut => true,
            else => false,
        };
    }
};

/// Test whether the given node-package-arg string is a GitHub shorthand.
///
/// This mirrors the implementation of hosted-git-info, though it is significantly faster.
pub fn isGitHubShorthand(npa_str: []const u8) bool {
    // The implementation in hosted-git-info is a multi-pass algorithm. We've opted to implement a
    // single-pass algorithm for better performance.
    //
    // This could be even faster with SIMD but this is probably good enough for now.
    if (npa_str.len < 1) {
        return false;
    }

    // Implements doesNotStartWithDot
    if (npa_str[0] == '.' or npa_str[0] == '/') {
        return false;
    }

    var pound_idx: ?usize = null;
    var seen_slash = false;

    for (npa_str, 0..) |c, i| {
        switch (c) {
            // Implement atOnlyAfterHash and colonOnlyAfterHash
            ':', '@' => {
                if (pound_idx == null) {
                    return false;
                }
            },

            '#' => {
                pound_idx = i;
            },
            '/' => {
                // Implements secondSlashOnlyAfterHash
                if (seen_slash and pound_idx == null) {
                    return false;
                }

                seen_slash = true;
            },
            else => {
                // Implement spaceOnlyAfterHash
                if (std.ascii.isWhitespace(c) and pound_idx == null) {
                    return false;
                }
            },
        }
    }

    // Implements doesNotEndWithSlash
    const does_not_end_with_slash =
        if (pound_idx) |pi|
            pi == 0 or npa_str[pi - 1] != '/'
        else
            npa_str.len >= 1 and npa_str[npa_str.len - 1] != '/';

    // Implement hasSlash
    return seen_slash and does_not_end_with_slash;
}

pub const UrlProtocol = union(enum) {
    well_formed: WellDefinedProtocol,

    // A protocol which is not known by the library. Includes the : character, but not the
    // double-slash, so `foo://bar` would yield `foo:`.
    custom: []const u8,

    // Either no protocol was specified or the library couldn't figure it out.
    unknown,

    /// Deduces the default representation for this protocol.
    pub fn defaultRepresentation(self: UrlProtocol) Representation {
        return switch (self) {
            .well_formed => self.well_formed.defaultRepresentation(),
            else => .sshurl, // Unknown/custom protocols default to sshurl
        };
    }
};

pub const UrlProtocolPair = struct {
    const Self = @This();

    url: union(enum) {
        managed: struct {
            buf: []const u8,
            allocator: std.mem.Allocator,
        },
        unmanaged: []const u8,
    },
    protocol: UrlProtocol,

    pub fn urlSlice(self: *const Self) []const u8 {
        return switch (self.url) {
            .managed => |s| s.buf,
            .unmanaged => |s| s,
        };
    }

    pub fn deinit(self: *Self) void {
        switch (self.url) {
            .managed => |*u| {
                u.allocator.free(u.buf);
            },
            .unmanaged => |_| {},
        }
    }

    /// Given a protocol pair, create a jsc.URL if possible. May allocate, but owns its memory.
    fn toUrl(self: *const UrlProtocolPair, allocator: std.mem.Allocator) ?*jsc.URL {
        // Ehhh.. Old IE's max path length was 2K so let's just use that. I searched for a
        // statistical distribution of URL lengths and found nothing.
        const long_url_thresh = 2048;

        var alloc = std.heap.stackFallback(long_url_thresh, allocator);

        var protocol_buf: WellDefinedProtocol.StringWithColonBuffer = undefined;

        return concatPartsToUrl(
            alloc.get(),
            switch (self.protocol) {
                // If we have no protocol, we can assume it is git+ssh.
                .unknown => &.{ "git+ssh://", self.urlSlice() },
                .custom => |proto_str| &.{ proto_str, "//", self.urlSlice() },
                // This feels counter-intuitive but is correct. It's not github://foo/bar, it's
                // github:foo/bar.
                .well_formed => |proto_tag| &.{
                    proto_tag.toStringWithColon(&protocol_buf),
                    // Wordy name for a double-slash or empty string. github:foo/bar is valid, but
                    // git+ssh://foo/bar is also valid.
                    proto_tag.protocolResourceIdentifierConcatenationToken(),
                    self.urlSlice(),
                },
            },
        );
    }

    fn concatPartsToUrl(allocator: std.mem.Allocator, parts: []const []const u8) ?*jsc.URL {
        // TODO(markovejnovic): There is a sad unnecessary allocation here that I don't know how to
        // get rid of -- in theory, URL.zig could allocate once.
        const new_str = bun.handleOom(bun.strings.concat(allocator, parts));
        defer allocator.free(new_str);
        return jsc.URL.fromString(bun.String.init(new_str));
    }
};

/// Given a loose string that may or may not be a valid URL, attempt to normalize it.
///
/// Returns a struct containing the URL string with the `protocol://` part removed and a tagged
/// enumeration. If the protocol is known, it is returned as a WellDefinedProtocol. If the protocol
/// is specified in the URL, it is given as a slice and if it is not specified, the `unknown` field
/// is returned. The result is a view into `npa_str` which must, consequently, remain stable.
///
/// This mirrors the `correctProtocol` function in `hosted-git-info/parse-url.js`.
fn normalizeProtocol(npa_str: []const u8) UrlProtocolPair {
    var first_colon_idx: i32 = -1;
    if (bun.strings.indexOfChar(npa_str, ':')) |idx| {
        first_colon_idx = @intCast(idx);
    }

    // The cast here is safe -- first_colon_idx is guaranteed to be [-1, infty)
    const proto_slice = npa_str[0..@intCast(first_colon_idx + 1)];

    if (WellDefinedProtocol.fromStringWithColon(proto_slice)) |url_protocol| {
        // We need to slice off the protocol from the string. Note there are two very annoying
        // cases -- one where the protocol string is foo://bar and one where it is foo:bar.
        var post_colon = bun.strings.substring(npa_str, @intCast(first_colon_idx + 1), null);

        return .{
            .url = .{
                .unmanaged = if (bun.strings.hasPrefixComptime(post_colon, "//"))
                    post_colon[2..post_colon.len]
                else
                    post_colon,
            },
            .protocol = .{ .well_formed = url_protocol },
        };
    }

    // Now we search for the @ character to see if we have a user@host:path GIT+SSH style URL.
    const first_at_idx = bun.strings.indexOfChar(npa_str, '@');
    if (first_at_idx) |at_idx| {
        // We have an @ in the string
        if (first_colon_idx != -1) {
            // We have a : in the string.
            if (at_idx > first_colon_idx) {
                // The @ is after the :, so we have something like user:pass@host which is a valid
                // URL. and should be promoted to git_plus_ssh. It's guaranteed that the issue is
                // not that we have proto://user@host:path because we would've caught that above.
                return .{
                    .url = .{ .unmanaged = npa_str },
                    .protocol = .{ .well_formed = .git_plus_ssh },
                };
            } else {
                // Otherwise we have something like user@host:path which is also a valid URL.
                // Things are, however, different, since we don't really know what the protocol is.
                // Remember, we would've hit the proto://user@host:path above.

                // NOTE(markovejnovic): I don't, at this moment, understand how exactly
                // hosted-git-info and npm-package-arg handle this "unknown" protocol as of now.
                // We can't really guess either -- there's no :// which comes before @
                return .{ .url = .{ .unmanaged = npa_str }, .protocol = .unknown };
            }
        } else {
            // Something like user@host which is also a valid URL. Since no :, that means that the
            // URL is as good as it gets. No need to slice.
            return .{
                .url = .{ .unmanaged = npa_str },
                .protocol = .{ .well_formed = .git_plus_ssh },
            };
        }
    }

    // The next thing we can try is to search for the double slash and treat this protocol as a
    // custom one.
    //
    // NOTE(markovejnovic): I also think this is wrong in parse-url.js.
    // They:
    // 1. Test the protocol against known protocols (which is fine)
    // 2. Then, if not found, they go through that hoop of checking for @ and : guessing if it is a
    //    git+ssh URL or not
    // 3. And finally, they search for ://.
    //
    // The last two steps feel like they should happen in reverse order:
    //
    // If I have a foobar://user:host@path URL (and foobar is not given as a known protocol), their
    // implementation will not report this as a foobar protocol, but rather as
    // git+ssh://foobar://user:host@path which, I think, is wrong.
    //
    // I even tested it: https://tinyurl.com/5y4e6zrw
    //
    // Our goal is to be bug-for-bug compatible, at least for now, so this is how I re-implemented
    // it.
    const maybe_dup_slash_idx = bun.strings.indexOf(npa_str, "//");
    if (maybe_dup_slash_idx) |dup_slash_idx| {
        if (dup_slash_idx == first_colon_idx + 1) {
            return .{
                .url = .{ .unmanaged = bun.strings.substring(npa_str, dup_slash_idx + 2, null) },
                .protocol = .{ .custom = npa_str[0..dup_slash_idx] },
            };
        }
    }

    // Well, otherwise we have to split the original URL into two pieces,
    // right at the colon.
    if (first_colon_idx != -1) {
        return .{
            .url = .{
                .unmanaged = bun.strings.substring(npa_str, @intCast(first_colon_idx + 1), null),
            },
            .protocol = .{ .custom = npa_str[0..@intCast(first_colon_idx + 1)] },
        };
    }

    // Well we couldn't figure out anything.
    return .{ .url = .{ .unmanaged = npa_str }, .protocol = .unknown };
}

/// Attempt to correct an scp-style URL into a proper URL, parsable with jsc.URL.
///
/// This function assumes that the input is an scp-style URL.
pub fn correctUrl(
    url_proto_pair: *const UrlProtocolPair,
    allocator: std.mem.Allocator,
) error{OutOfMemory}!UrlProtocolPair {
    const at_idx: isize = if (bun.strings.lastIndexBeforeChar(
        url_proto_pair.urlSlice(),
        '@',
        '#',
    )) |idx|
        @intCast(idx)
    else
        -1;

    const col_idx: isize = if (bun.strings.lastIndexBeforeChar(
        url_proto_pair.urlSlice(),
        ':',
        '#',
    )) |idx|
        @intCast(idx)
    else
        -1;

    if (col_idx > at_idx) {
        var duped = try allocator.dupe(u8, url_proto_pair.urlSlice());
        duped[@intCast(col_idx)] = '/';

        return .{
            .url = .{
                .managed = .{
                    .buf = duped,
                    .allocator = allocator,
                },
            },
            .protocol = .{ .well_formed = .git_plus_ssh },
        };
    }

    if (col_idx == -1 and url_proto_pair.protocol == .unknown) {
        return .{
            .url = url_proto_pair.url,
            .protocol = .{ .well_formed = .git_plus_ssh },
        };
    }

    return .{ .url = url_proto_pair.url, .protocol = url_proto_pair.protocol };
}

/// This enumeration encapsulates all known host providers and their configurations.
///
/// Providers each have different configuration fields and, on top of that, have different
/// mechanisms for formatting URLs. For example, GitHub will format SSH URLs as
/// `git+ssh://git@${domain}/${user}/${project}.git${maybeJoin('#', committish)}`, while `gist`
/// will format URLs as `git+ssh://git@${domain}/${project}.git${maybeJoin('#', committish)}`. This
/// structure encapsulates the differences between providers and how they handle all of that.
///
/// Effectively, this enumeration acts as a registry of all known providers and a vtable for
/// jumping between different behavior for different providers.
const HostProvider = enum {
    const Self = @This();

    bitbucket,
    gist,
    github,
    gitlab,
    sourcehut,

    fn formatSsh(
        self: Self,
        allocator: std.mem.Allocator,
        user: ?[]const u8,
        project: []const u8,
        committish: ?[]const u8,
    ) error{OutOfMemory}![]const u8 {
        return configs.get(self).format_ssh(self, allocator, user, project, committish);
    }

    fn formatSshUrl(
        self: Self,
        allocator: std.mem.Allocator,
        user: ?[]const u8,
        project: []const u8,
        committish: ?[]const u8,
    ) error{OutOfMemory}![]const u8 {
        return configs.get(self).format_sshurl(self, allocator, user, project, committish);
    }

    fn formatHttps(
        self: Self,
        allocator: std.mem.Allocator,
        auth: ?[]const u8,
        user: ?[]const u8,
        project: []const u8,
        committish: ?[]const u8,
    ) error{OutOfMemory}![]const u8 {
        return configs.get(self).format_https(self, allocator, auth, user, project, committish);
    }

    fn formatShortcut(
        self: Self,
        allocator: std.mem.Allocator,
        user: ?[]const u8,
        project: []const u8,
        committish: ?[]const u8,
    ) error{OutOfMemory}![]const u8 {
        return configs.get(self).format_shortcut(self, allocator, user, project, committish);
    }

    fn extract(
        self: Self,
        allocator: std.mem.Allocator,
        url: *jsc.URL,
    ) error{ OutOfMemory, InvalidURL }!?Config.formatters.extract.Result {
        return configs.get(self).format_extract(allocator, url);
    }

    const Config = struct {
        protocols: []const WellDefinedProtocol,
        domain: []const u8,
        shortcut: []const u8,
        tree_path: ?[]const u8,
        blob_path: ?[]const u8,
        edit_path: ?[]const u8,

        format_ssh: formatters.ssh.Type = Self.Config.formatters.ssh.default,
        format_sshurl: formatters.ssh_url.Type = Self.Config.formatters.ssh_url.default,
        format_https: formatters.https.Type = Self.Config.formatters.https.default,
        format_shortcut: formatters.shortcut.Type = Self.Config.formatters.shortcut.default,
        format_git: formatters.git.Type = Self.Config.formatters.git.default,
        format_extract: formatters.extract.Type,

        /// Encapsulates all the various foramtters that different hosts may have. Usually this has
        /// to do with URLs, but could be other things.
        const formatters = struct {
            fn requiresUser(user: ?[]const u8) void {
                if (user == null) {
                    @panic("Attempted to format a default SSH URL without a user. This is an " ++
                        "irrecoverable programming bug in Bun. Please report this issue " ++
                        "on GitHub.");
                }
            }

            /// Mirrors hosts.js's sshtemplate
            const ssh = struct {
                const Type = *const fn (
                    self: Self,
                    allocator: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8;

                fn default(
                    self: Self,
                    alloc: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8 {
                    requiresUser(user);
                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        alloc,
                        "git@{s}:{s}/{s}.git{s}{s}",
                        .{ self.domain(), user.?, project, cmsh_sep, cmsh },
                    );
                }

                fn gist(
                    self: Self,
                    allocator: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8 {
                    _ = user;
                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        allocator,
                        "git@{s}:{s}.git{s}{s}",
                        .{ self.domain(), project, cmsh_sep, cmsh },
                    );
                }
            };

            /// Mirrors hosts.js's sshurltemplate
            const ssh_url = struct {
                const Type = *const fn (
                    self: Self,
                    allocator: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8;

                fn default(
                    self: Self,
                    alloc: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8 {
                    requiresUser(user);
                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        alloc,
                        "git+ssh://git@{s}/{s}/{s}.git{s}{s}",
                        .{ self.domain(), user.?, project, cmsh_sep, cmsh },
                    );
                }

                fn gist(
                    self: Self,
                    allocator: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8 {
                    _ = user;
                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        allocator,
                        "git+ssh://git@{s}/{s}.git{s}{s}",
                        .{ self.domain(), project, cmsh_sep, cmsh },
                    );
                }
            };

            /// Mirrors hosts.js's httpstemplate
            const https = struct {
                const Type = *const fn (
                    self: Self,
                    allocator: std.mem.Allocator,
                    auth: ?[]const u8,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8;

                fn default(
                    self: Self,
                    alloc: std.mem.Allocator,
                    auth: ?[]const u8,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8 {
                    requiresUser(user);

                    const auth_str = if (auth) |a| a else "";
                    const auth_sep = if (auth_str.len > 0) "@" else "";
                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        alloc,
                        "git+https://{s}{s}{s}/{s}/{s}.git{s}{s}",
                        .{ auth_str, auth_sep, self.domain(), user.?, project, cmsh_sep, cmsh },
                    );
                }

                fn gist(
                    self: Self,
                    alloc: std.mem.Allocator,
                    auth: ?[]const u8,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8 {
                    _ = auth;
                    _ = user;

                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        alloc,
                        "git+https://{s}/{s}.git{s}{s}",
                        .{ self.domain(), project, cmsh_sep, cmsh },
                    );
                }

                fn sourcehut(
                    self: Self,
                    alloc: std.mem.Allocator,
                    auth: ?[]const u8,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8 {
                    requiresUser(user);
                    _ = auth;

                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        alloc,
                        "https://{s}/{s}/{s}.git{s}{s}",
                        .{ self.domain(), user.?, project, cmsh_sep, cmsh },
                    );
                }
            };

            /// Mirrors hosts.js's shortcuttemplate
            const shortcut = struct {
                const Type = *const fn (
                    self: Self,
                    allocator: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8;

                fn default(
                    self: Self,
                    alloc: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8 {
                    requiresUser(user);

                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        alloc,
                        "{s}{s}/{s}{s}{s}",
                        .{ self.shortcut(), user.?, project, cmsh_sep, cmsh },
                    );
                }

                fn gist(
                    self: Self,
                    alloc: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8 {
                    _ = user;

                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        alloc,
                        "{s}{s}{s}{s}",
                        .{ self.shortcut(), project, cmsh_sep, cmsh },
                    );
                }
            };

            /// Mirrors hosts.js's extract function
            const extract = struct {
                const Result = struct {
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                    _owned_buffer: ?[]const u8,
                    _allocator: std.mem.Allocator,

                    fn deinit(self: *Result) void {
                        if (self._owned_buffer) |buf| {
                            self._allocator.free(buf);
                        }
                    }

                    /// Return the buffer which owns this Result and the allocator responsible for
                    /// freeing it.
                    ///
                    /// Same semantics as C++ STL. Safe-to-deinit Result after this, not safe to
                    /// use it.
                    fn move(self: *Result) struct {
                        buffer: []const u8,
                        allocator: std.mem.Allocator,
                    } {
                        if (self._owned_buffer == null) {
                            @panic("Cannot move an empty Result. This is a bug in Bun. Please " ++
                                "report this issue on GitHub.");
                        }

                        const buffer = self._owned_buffer.?;
                        const allocator = self._allocator;

                        self._owned_buffer = null;

                        return .{
                            .buffer = buffer,
                            .allocator = allocator,
                        };
                    }
                };

                const Type = *const fn (
                    allocator: std.mem.Allocator,
                    url: *jsc.URL,
                ) error{ OutOfMemory, InvalidURL }!?Result;

                fn github(
                    allocator: std.mem.Allocator,
                    url: *jsc.URL,
                ) error{ OutOfMemory, InvalidURL }!?Result {
                    const pathname_owned = try url.pathname().toOwnedSlice(allocator);
                    defer allocator.free(pathname_owned);
                    const pathname = bun.strings.trimPrefixComptime(u8, pathname_owned, "/");

                    var iter = std.mem.splitScalar(u8, pathname, '/');
                    const user_part = iter.next() orelse return null;
                    const project_part = iter.next() orelse return null;
                    const type_part = iter.next();
                    const committish_part = iter.next();

                    const project = bun.strings.trimSuffixComptime(project_part, ".git");

                    if (user_part.len == 0 or project.len == 0) {
                        return null;
                    }

                    // If the type part says something other than "tree", we're not looking at a
                    // github URL that we understand.
                    if (type_part) |tp| {
                        if (!std.mem.eql(u8, tp, "tree")) {
                            return null;
                        }
                    }

                    var committish: ?[]const u8 = null;
                    if (type_part == null) {
                        const fragment_str = url.fragmentIdentifier();
                        defer fragment_str.deref();
                        const fragment_utf8 = fragment_str.toUTF8(allocator);
                        defer fragment_utf8.deinit();
                        const fragment = fragment_utf8.slice();
                        if (fragment.len > 0) {
                            committish = fragment;
                        }
                    } else {
                        committish = committish_part;
                    }

                    var sb = bun.StringBuilder{};
                    sb.count(user_part);
                    sb.count(project);
                    if (committish) |c| sb.count(c);

                    try sb.allocate(allocator);

                    const user_slice = try HostedGitInfo.decodeAndAppend(&sb, user_part);
                    const project_slice = try HostedGitInfo.decodeAndAppend(&sb, project);
                    const committish_slice =
                        if (committish) |c|
                            try HostedGitInfo.decodeAndAppend(&sb, c)
                        else
                            null;

                    return .{
                        .user = user_slice,
                        .project = project_slice,
                        .committish = committish_slice,
                        ._owned_buffer = sb.allocatedSlice(),
                        ._allocator = allocator,
                    };
                }

                fn bitbucket(
                    allocator: std.mem.Allocator,
                    url: *jsc.URL,
                ) error{ InvalidURL, OutOfMemory }!?Result {
                    const pathname_owned = try url.pathname().toOwnedSlice(allocator);
                    defer allocator.free(pathname_owned);
                    const pathname = bun.strings.trimPrefixComptime(u8, pathname_owned, "/");

                    var iter = std.mem.splitScalar(u8, pathname, '/');
                    const user_part = iter.next() orelse return null;
                    const project_part = iter.next() orelse return null;
                    const aux = iter.next();

                    if (aux) |a| {
                        if (std.mem.eql(u8, a, "get")) {
                            return null;
                        }
                    }

                    const project = bun.strings.trimSuffixComptime(project_part, ".git");

                    if (user_part.len == 0 or project.len == 0) {
                        return null;
                    }

                    const fragment_str = url.fragmentIdentifier();
                    defer fragment_str.deref();
                    const fragment_utf8 = fragment_str.toUTF8(allocator);
                    defer fragment_utf8.deinit();
                    const fragment = fragment_utf8.slice();
                    const committish = if (fragment.len > 0) fragment else null;

                    var sb = bun.StringBuilder{};
                    sb.count(user_part);
                    sb.count(project);
                    if (committish) |c| sb.count(c);

                    try sb.allocate(allocator);

                    const user_slice = try HostedGitInfo.decodeAndAppend(&sb, user_part);
                    const project_slice = try HostedGitInfo.decodeAndAppend(&sb, project);
                    const committish_slice =
                        if (committish) |c|
                            try HostedGitInfo.decodeAndAppend(&sb, c)
                        else
                            null;

                    return .{
                        .user = user_slice,
                        .project = project_slice,
                        .committish = committish_slice,
                        ._owned_buffer = sb.allocatedSlice(),
                        ._allocator = allocator,
                    };
                }

                fn gitlab(
                    allocator: std.mem.Allocator,
                    url: *jsc.URL,
                ) error{ OutOfMemory, InvalidURL }!?Result {
                    const pathname_owned = try url.pathname().toOwnedSlice(allocator);
                    defer allocator.free(pathname_owned);
                    const pathname = bun.strings.trimPrefixComptime(u8, pathname_owned, "/");

                    if (bun.strings.contains(pathname, "/-/") or
                        bun.strings.contains(pathname, "/archive.tar.gz"))
                    {
                        return null;
                    }

                    const end_slash = bun.strings.lastIndexOfChar(pathname, '/') orelse return null;
                    const project_part = pathname[end_slash + 1 ..];
                    const user_part = pathname[0..end_slash];

                    const project = bun.strings.trimSuffixComptime(project_part, ".git");

                    if (user_part.len == 0 or project.len == 0) {
                        return null;
                    }

                    const fragment_str = url.fragmentIdentifier();
                    defer fragment_str.deref();
                    const fragment_utf8 = fragment_str.toUTF8(allocator);
                    defer fragment_utf8.deinit();
                    const committish = fragment_utf8.slice();

                    var sb = bun.StringBuilder{};
                    sb.count(user_part);
                    sb.count(project);
                    if (committish.len > 0) sb.count(committish);

                    try sb.allocate(allocator);

                    const user_slice = try HostedGitInfo.decodeAndAppend(&sb, user_part);
                    const project_slice = try HostedGitInfo.decodeAndAppend(&sb, project);
                    const committish_slice =
                        if (committish.len > 0)
                            HostedGitInfo.decodeAndAppend(&sb, committish) catch return null
                        else
                            null;

                    return .{
                        .user = user_slice,
                        .project = project_slice,
                        .committish = committish_slice,
                        ._owned_buffer = sb.allocatedSlice(),
                        ._allocator = allocator,
                    };
                }

                fn gist(
                    allocator: std.mem.Allocator,
                    url: *jsc.URL,
                ) error{ OutOfMemory, InvalidURL }!?Result {
                    const pathname_owned = try url.pathname().toOwnedSlice(allocator);
                    defer allocator.free(pathname_owned);
                    const pathname = bun.strings.trimPrefixComptime(u8, pathname_owned, "/");

                    var iter = std.mem.splitScalar(u8, pathname, '/');
                    var user_part = iter.next() orelse return null;
                    var project_part = iter.next();
                    const aux = iter.next();

                    if (aux) |a| {
                        if (std.mem.eql(u8, a, "raw")) {
                            return null;
                        }
                    }

                    if (project_part == null or project_part.?.len == 0) {
                        project_part = user_part;
                        user_part = "";
                    }

                    const project = bun.strings.trimSuffixComptime(project_part.?, ".git");
                    const user = if (user_part.len > 0) user_part else null;

                    if (project.len == 0) {
                        return null;
                    }

                    const fragment_str = url.fragmentIdentifier();
                    defer fragment_str.deref();
                    const fragment_utf8 = fragment_str.toUTF8(allocator);
                    defer fragment_utf8.deinit();
                    const fragment = fragment_utf8.slice();
                    const committish = if (fragment.len > 0) fragment else null;

                    var sb = bun.StringBuilder{};
                    if (user) |u| sb.count(u);
                    sb.count(project);
                    if (committish) |c| sb.count(c);

                    sb.allocate(allocator) catch return null;

                    const user_slice =
                        if (user) |u|
                            HostedGitInfo.decodeAndAppend(&sb, u) catch return null
                        else
                            null;
                    const project_slice =
                        HostedGitInfo.decodeAndAppend(&sb, project) catch return null;
                    const committish_slice =
                        if (committish) |c|
                            HostedGitInfo.decodeAndAppend(&sb, c) catch return null
                        else
                            null;

                    return .{
                        .user = user_slice,
                        .project = project_slice,
                        .committish = committish_slice,
                        ._owned_buffer = sb.allocatedSlice(),
                        ._allocator = allocator,
                    };
                }

                fn sourcehut(
                    allocator: std.mem.Allocator,
                    url: *jsc.URL,
                ) error{ InvalidURL, OutOfMemory }!?Result {
                    const pathname_owned = try url.pathname().toOwnedSlice(allocator);
                    defer allocator.free(pathname_owned);
                    const pathname = bun.strings.trimPrefixComptime(u8, pathname_owned, "/");

                    var iter = std.mem.splitScalar(u8, pathname, '/');
                    const user_part = iter.next() orelse return null;
                    const project_part = iter.next() orelse return null;
                    const aux = iter.next();

                    if (aux) |a| {
                        if (std.mem.eql(u8, a, "archive")) {
                            return null;
                        }
                    }

                    const project = bun.strings.trimSuffixComptime(project_part, ".git");

                    if (user_part.len == 0 or project.len == 0) {
                        return null;
                    }

                    const fragment_str = url.fragmentIdentifier();
                    defer fragment_str.deref();
                    const fragment_utf8 = fragment_str.toUTF8(allocator);
                    defer fragment_utf8.deinit();
                    const fragment = fragment_utf8.slice();
                    const committish = if (fragment.len > 0) fragment else null;

                    var sb = bun.StringBuilder{};
                    sb.count(user_part);
                    sb.count(project);
                    if (committish) |c| sb.count(c);

                    sb.allocate(allocator) catch return null;

                    const user_slice = blk: {
                        const writable = sb.writable();
                        var stream = std.io.fixedBufferStream(writable);
                        const decoded_len = PercentEncoding.decode(
                            @TypeOf(stream.writer()),
                            stream.writer(),
                            user_part,
                        ) catch return null;
                        sb.len += decoded_len;
                        break :blk writable[0..decoded_len];
                    };
                    const project_slice = blk: {
                        const writable = sb.writable();
                        var stream = std.io.fixedBufferStream(writable);
                        const decoded_len = PercentEncoding.decode(
                            @TypeOf(stream.writer()),
                            stream.writer(),
                            project,
                        ) catch return null;
                        sb.len += decoded_len;
                        break :blk writable[0..decoded_len];
                    };
                    const committish_slice = if (committish) |c| blk: {
                        const writable = sb.writable();
                        var stream = std.io.fixedBufferStream(writable);
                        const decoded_len = PercentEncoding.decode(
                            @TypeOf(stream.writer()),
                            stream.writer(),
                            c,
                        ) catch return null;
                        sb.len += decoded_len;
                        break :blk writable[0..decoded_len];
                    } else null;

                    return .{
                        .user = user_slice,
                        .project = project_slice,
                        .committish = committish_slice,
                        ._owned_buffer = sb.allocatedSlice(),
                        ._allocator = allocator,
                    };
                }
            };

            /// Mirrors hosts.js's gittemplate
            const git = struct {
                const Type = ?*const fn (
                    self: Self,
                    allocator: std.mem.Allocator,
                    auth: ?[]const u8,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8;

                const default: Type = null;

                fn github(
                    self: Self,
                    allocator: std.mem.Allocator,
                    auth: ?[]const u8,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8 {
                    requiresUser(user);

                    const auth_str = if (auth) |a| a else "";
                    const auth_sep = if (auth_str.len > 0) "@" else "";
                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        allocator,
                        "git://{s}{s}{s}/{s}/{s}.git{s}{s}",
                        .{ auth_str, auth_sep, self.domain(), user.?, project, cmsh_sep, cmsh },
                    );
                }

                fn gist(
                    self: Self,
                    allocator: std.mem.Allocator,
                    auth: ?[]const u8,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]const u8 {
                    _ = auth;
                    _ = user;

                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        allocator,
                        "git://{s}/{s}.git{s}{s}",
                        .{ self.domain(), project, cmsh_sep, cmsh },
                    );
                }
            };
        };
    };

    const configs = std.enums.EnumArray(Self, Config).init(.{
        .bitbucket = .{
            .protocols = &.{ .git_plus_http, .git_plus_https, .ssh, .https },
            .domain = "bitbucket.org",
            .shortcut = "bitbucket:",
            .tree_path = "src",
            .blob_path = "src",
            .edit_path = "?mode=edit",
            .format_extract = Self.Config.formatters.extract.bitbucket,
        },
        .gist = .{
            .protocols = &.{ .git, .git_plus_ssh, .git_plus_https, .ssh, .https },
            .domain = "gist.github.com",
            .shortcut = "gist:",
            .tree_path = null,
            .blob_path = null,
            .edit_path = "edit",
            .format_ssh = Self.Config.formatters.ssh.gist,
            .format_sshurl = Self.Config.formatters.ssh_url.gist,
            .format_https = Self.Config.formatters.https.gist,
            .format_shortcut = Self.Config.formatters.shortcut.gist,
            .format_git = Self.Config.formatters.git.gist,
            .format_extract = Self.Config.formatters.extract.gist,
        },
        .github = .{
            .protocols = &.{ .git, .http, .git_plus_ssh, .git_plus_https, .ssh, .https },
            .domain = "github.com",
            .shortcut = "github:",
            .tree_path = "tree",
            .blob_path = "blob",
            .edit_path = "edit",
            .format_git = Self.Config.formatters.git.github,
            .format_extract = Self.Config.formatters.extract.github,
        },
        .gitlab = .{
            .protocols = &.{ .git_plus_ssh, .git_plus_https, .ssh, .https },
            .domain = "gitlab.com",
            .shortcut = "gitlab:",
            .tree_path = "tree",
            .blob_path = "tree",
            .edit_path = "-/edit",
            .format_extract = Self.Config.formatters.extract.gitlab,
        },
        .sourcehut = .{
            .protocols = &.{ .git_plus_ssh, .https },
            .domain = "git.sr.ht",
            .shortcut = "sourcehut:",
            .tree_path = "tree",
            .blob_path = "tree",
            .edit_path = null,
            .format_https = Self.Config.formatters.https.sourcehut,
            .format_extract = Self.Config.formatters.extract.sourcehut,
        },
    });

    /// Return the string representation of the provider.
    fn typeStr(self: Self) []const u8 {
        return @tagName(self);
    }

    fn shortcut(self: Self) []const u8 {
        return configs.get(self).shortcut;
    }

    fn domain(self: Self) []const u8 {
        return configs.get(self).domain;
    }

    fn protocols(self: Self) []const WellDefinedProtocol {
        return configs.get(self).protocols;
    }

    fn shortcutWithoutColon(self: Self) []const u8 {
        const shct = self.shortcut();
        return shct[0 .. shct.len - 1];
    }

    fn treePath(self: Self) ?[]const u8 {
        return configs.get(self).tree_path;
    }

    fn blobPath(self: Self) ?[]const u8 {
        return configs.get(self).blob_path;
    }

    fn editPath(self: Self) ?[]const u8 {
        return configs.get(self).edit_path;
    }

    /// Find the appropriate host provider by its shortcut (e.g. "github:").
    ///
    /// The second parameter allows you to declare whether the given string includes the protocol:
    /// colon or not.
    fn fromShortcut(
        shortcut_str: []const u8,
        comptime with_colon: enum { with_colon, without_colon },
    ) ?HostProvider {
        inline for (std.meta.fields(Self)) |field| {
            const provider: HostProvider = @enumFromInt(field.value);

            const shortcut_matches = std.mem.eql(
                u8,
                switch (with_colon) {
                    .with_colon => provider.shortcut(),
                    .without_colon => provider.shortcutWithoutColon(),
                },
                shortcut_str,
            );

            if (shortcut_matches) {
                return provider;
            }
        }

        return null;
    }

    /// Find the appropriate host provider by its domain (e.g. "github.com").
    fn fromDomain(domain_str: []const u8) ?HostProvider {
        inline for (std.meta.fields(Self)) |field| {
            const provider: HostProvider = @enumFromInt(field.value);

            if (std.mem.eql(u8, provider.domain(), domain_str)) {
                return provider;
            }
        }

        return null;
    }

    /// Parse a URL and return the appropriate host provider, if any.
    fn fromUrl(url: *jsc.URL) ?HostProvider {
        const proto_str = url.protocol();
        defer proto_str.deref();

        // Try shortcut first (github:, gitlab:, etc.)
        if (HostProvider.fromShortcut(proto_str.byteSlice(), .without_colon)) |provider| {
            return provider;
        }

        return HostProvider.fromUrlDomain(url);
    }

    // Given a URL, use the domain in the URL to find the appropriate host provider.
    fn fromUrlDomain(url: *jsc.URL) ?HostProvider {
        const max_hostname_len: comptime_int = 253;

        const hostname_str = url.hostname();
        defer hostname_str.deref();

        var fba_mem: [max_hostname_len]u8 = undefined;
        var fba = std.heap.FixedBufferAllocator.init(&fba_mem);
        const hostname_utf8 = hostname_str.toUTF8(fba.allocator());
        defer hostname_utf8.deinit();
        const hostname = bun.strings.withoutPrefixComptime(hostname_utf8.slice(), "www.");

        return HostProvider.fromDomain(hostname);
    }
};

pub const TestingAPIs = struct {
    pub fn jsParseUrl(go: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const allocator = bun.default_allocator;

        if (callframe.argumentsCount() != 1) {
            return go.throw("hostedGitInfo.prototype.parseUrl takes exactly 1 argument", .{});
        }

        const arg0 = callframe.argument(0);
        if (!arg0.isString()) {
            return go.throw(
                "hostedGitInfo.prototype.parseUrl takes a string as its " ++
                    "first argument",
                .{},
            );
        }

        // TODO(markovejnovic): This feels like there's too much going on all
        // to give us a slice. Maybe there's a better way to code this up.
        const npa_str = try arg0.toBunString(go);
        defer npa_str.deref();
        var as_utf8 = npa_str.toUTF8(allocator);
        defer as_utf8.deinit();
        const parsed = parseUrl(allocator, as_utf8.mut()) catch |err| {
            return go.throw("Invalid Git URL: {}", .{err});
        };
        defer parsed.url.deinit();

        return parsed.url.href().toJS(go);
    }

    pub fn jsFromUrl(go: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const allocator = bun.default_allocator;

        // TODO(markovejnovic): The original hosted-git-info actually takes another argument that
        //                      allows you to inject options. Seems untested so we didn't implement
        //                      it.
        if (callframe.argumentsCount() != 1) {
            return go.throw("hostedGitInfo.prototype.fromUrl takes exactly 1 argument", .{});
        }

        const arg0 = callframe.argument(0);
        if (!arg0.isString()) {
            return go.throw(
                "hostedGitInfo.prototype.fromUrl takes a string as its first argument",
                .{},
            );
        }

        // TODO(markovejnovic): This feels like there's too much going on all to give us a slice.
        // Maybe there's a better way to code this up.
        const npa_str = try arg0.toBunString(go);
        defer npa_str.deref();
        var as_utf8 = npa_str.toUTF8(allocator);
        defer as_utf8.deinit();
        const parsed = HostedGitInfo.fromUrl(allocator, as_utf8.mut()) catch |err| {
            return go.throw("Invalid Git URL: {}", .{err});
        } orelse {
            return .null;
        };

        return parsed.toJS(go);
    }
};

const std = @import("std");
const PercentEncoding = @import("../url.zig").PercentEncoding;

const bun = @import("bun");
const jsc = bun.jsc;
