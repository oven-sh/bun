//! Resolves Git URLs and metadata.
//!
//! This library mimics https://www.npmjs.com/package/hosted-git-info. At the time of writing, the
//! latest version is 9.0.0. Although @markovejnovic believes there are bugs in the original
//! library, this library aims to be bug-for-bug compatible with the original.
//!
//! One thing that's really notable is that hosted-git-info supports extensions and we currently
//! offer no support for extensions. This could be added in the future if necessary.

// TODO(markovejnovic): This is a fraction of what hosted-git-info actually delivers, but it's the
// fraction that matters for us. If we want to make this API public, we will likely need to expose
// more information.
pub const Representation = enum {
    shortcut,
    sshurl,
    ssh,
    https,
    git,
    http,
};

pub const HostedGitInfo = struct {
    const Self = @This();

    // TODO(markovejnovic): We will likely start to care about a lot of these fields lol.
    //
    // The original JS object has a lot more fields, but we mostly don't care about them.
    // Here is an example of the full object for the URL.
    //   href: "ssh://:password@bitbucket.org/foo/bar.git",
    //   origin: "null",
    //   protocol: "ssh:",
    //   username: "",
    //   password: "password",
    //   host: "bitbucket.org",
    //   hostname: "bitbucket.org",
    //   port: "",
    //   pathname: "/foo/bar.git",
    //   hash: "",
    //   search: "",
    //   searchParams: URLSearchParams {},
    committish: ?[]const u8,
    project: []const u8,
    user: ?[]const u8,
    _allocator: std.mem.Allocator,
    host_provider: HostProvider,
    default_representation: Representation,

    /// Clean up owned memory
    pub fn deinit(self: HostedGitInfo) void {
        if (self.user) |u| self._allocator.free(u);
        if (self.committish) |c| self._allocator.free(c);
        self._allocator.free(self.project);
    }

    /// Generate a URL string based on the default representation.
    /// Mimics hosted-git-info's toString() method
    pub fn toString(self: HostedGitInfo, allocator: std.mem.Allocator) ![]const u8 {
        _ = self;
        _ = allocator;

        @panic("Not Implemented");
    }
};

/// Handles input like git:github.com:user/repo and inserting the // after the first : if necessary
///
/// May error with `error.InvalidGitUrl` if the URL is not valid.
///
/// Note that this may or may not allocate but it manages its own memory.
pub fn parseUrl(allocator: std.mem.Allocator, npa_str: []u8) !*jsc.URL {
    // Certain users can provide values like user:password@github.com:foo/bar and we want to
    // "correct" the protocol to be git+ssh://user:password@github.com:foo/bar
    const proto_pair = normalizeProtocol(npa_str);

    // TODO(markovejnovic): We might be able to avoid this allocation if we rework how jsc.URL
    //                      accepts strings.
    const maybe_url = proto_pair.toUrl(allocator);
    if (maybe_url) |url| return url;

    // Now that may fail, if the URL is not nicely formatted. In that case, we try to correct the
    // URL and parse it.
    const corrected = correctUrlMut(proto_pair);
    const corrected_url = corrected.toUrl(allocator);
    if (corrected_url) |url| return url;

    // Otherwise, we complain.
    return error.InvalidGitUrl;
}

pub fn fromUrl(allocator: std.mem.Allocator, git_url: []u8) !?HostedGitInfo {
    // git_url_mut may carry two ownership semantics:
    //  - It aliases `git_url`, in which case it must not be freed.
    //  - It actually points to a new allocation, in which case it must be freed.
    var git_url_mut = git_url;
    defer if (git_url.ptr != git_url_mut.ptr) allocator.free(git_url_mut);

    if (isGithubShorthand(git_url)) {
        // In this case we have to prefix the url with `github:`.
        //
        // NOTE(markovejnovic): I don't exactly understand why this is treated specially.
        //
        // TODO(markovejnovic): Perhaps we can avoid this allocation...
        // This one seems quite easy to get rid of.
        git_url_mut = bun.handleOom(bun.strings.concat(allocator, &.{ "github:", git_url }));
    }

    // Extract committish from the original string before URL parsing to avoid encoding issues
    const raw_committish: ?[]const u8 = if (bun.strings.indexOfChar(git_url_mut, '#')) |hash_idx|
        if (hash_idx + 1 < git_url_mut.len)
            git_url_mut[hash_idx + 1 ..]
        else
            null
    else
        null;

    const parsed: *jsc.URL = parseUrl(allocator, git_url_mut) catch |err| {
        debug("fromUrl: parseUrl failed: {any}\n", .{err});
        return null;
    };
    defer parsed.deinit();

    const host_provider = HostProvider.fromUrl(parsed) orelse {
        return null;
    };

    // TODO(markovejnovic): From this point on, Claude implemented this method. It's really not
    // that great...
    // Check if this is a shortcut URL (github:, gitlab:, etc.) - from-url.js line 68
    const proto_str = parsed.protocol();
    defer proto_str.deref();
    const protocol = proto_str.toUTF8(allocator);
    defer protocol.deinit();
    const protocol_slice = protocol.slice();

    const is_shortcut = HostProvider.fromShortcut(protocol_slice, .without_colon) != null;

    var user: ?[]const u8 = null;
    var project: []const u8 = undefined;
    var committish: ?[]const u8 = null;

    if (is_shortcut) {
        // Shortcut path: github:user/repo, gitlab:user/repo, etc. (from-url.js line 68-96)
        const pathname_str = parsed.pathname();
        defer pathname_str.deref();
        const pathname_utf8 = pathname_str.toUTF8(allocator);
        defer pathname_utf8.deinit();
        var pathname = pathname_utf8.slice();

        // Strip leading / (from-url.js line 69)
        if (bun.strings.hasPrefixComptime(pathname, "/")) {
            pathname = pathname[1..];
        }

        // Strip auth (from-url.js line 70-74)
        if (bun.strings.indexOfChar(pathname, '@')) |first_at| {
            pathname = pathname[first_at + 1 ..];
        }

        // Extract user and project from pathname (from-url.js line 76-86)
        if (bun.strings.lastIndexOfChar(pathname, '/')) |last_slash| {
            const user_part = pathname[0..last_slash];
            // We want nulls only, never empty strings (from-url.js line 79-82)
            if (user_part.len > 0) {
                user = try allocator.dupe(u8, user_part);
            }
            project = try allocator.dupe(u8, pathname[last_slash + 1 ..]);
        } else {
            project = try allocator.dupe(u8, pathname);
        }

        // Strip .git suffix (from-url.js line 88-90)
        if (bun.strings.hasSuffixComptime(project, ".git")) {
            const new_project = try allocator.dupe(u8, project[0 .. project.len - 4]);
            allocator.free(project);
            project = new_project;
        }

        // Use the raw committish we extracted earlier (from-url.js line 92-94)
        if (raw_committish) |rc| {
            committish = try allocator.dupe(u8, rc);
        }
    } else {
        // Regular URL path: git+ssh://github.com/user/repo (from-url.js line 97-111)
        // Use host-specific extract logic
        const extracted = host_provider.extract(allocator, parsed) orelse {
            return null;
        };
        defer extracted.deinit();

        // Duplicate all fields from extracted (they are slices into extracted's buffer)
        user = if (extracted.user) |u| try allocator.dupe(u8, u) else null;
        project = try allocator.dupe(u8, extracted.project);

        // We prefer raw_committish if available, otherwise use extracted committish
        if (raw_committish) |rc| {
            committish = try allocator.dupe(u8, rc);
        } else {
            committish = if (extracted.committish) |c| try allocator.dupe(u8, c) else null;
        }
    }

    // Determine the default representation based on the protocol
    const default_repr = if (is_shortcut)
        Representation.shortcut
    else blk: {
        // Get the protocol and append colon (URL.protocol() returns without colon)
        const proto_slice = proto_str.byteSlice();
        var proto_with_colon_buf: [32]u8 = undefined;
        const proto_with_colon = std.fmt.bufPrint(
            &proto_with_colon_buf,
            "{s}:",
            .{proto_slice},
        ) catch unreachable;
        const result = defaultRepresentationFromProtocol(proto_with_colon);
        debug("fromUrl: protocol={s}, default_repr={s}\n", .{ proto_with_colon, @tagName(result) });
        break :blk result;
    };

    return .{
        .host_provider = host_provider,
        .user = user,
        .project = project,
        .committish = committish,
        .default_representation = default_repr,
        ._allocator = allocator,
    };
}

/// Enumeration of possible URL protocols. Note that this enumeration has a
/// many-to-one relationship with Protocol.
const UrlProtocol = enum {
    git_plus_ssh,
    ssh,
    git_plus_https,
    git,
    http,
    https,
    git_plus_http,

    // Non-standard protocols.
    github,
    bitbucket,
    gitlab,
    gist,
    sourcehut,

    /// Mapping from string to UrlProtocol.
    pub const strings = bun.ComptimeStringMap(UrlProtocol, .{
        .{ "git+ssh:", .git_plus_ssh },
        .{ "ssh:", .ssh },
        .{ "git+https:", .git_plus_https },
        .{ "git:", .git },
        .{ "http:", .http },
        .{ "https:", .https },
        .{ "git+http:", .git_plus_http },
        .{ "github:", .github },
        .{ "bitbucket:", .bitbucket },
        .{ "gitlab:", .gitlab },
        .{ "gist:", .gist },
        .{ "sourcehut:", .sourcehut },
    });

    /// The set of characters that must appear between <protocol><resource-identifier>.
    /// For example, in `git+ssh://user@host:repo`, the `//` is the magic string. Some protocols
    /// don't support this, for example `github:user/repo` is valid.
    ///
    /// Kind of arbitrary and implemented to match hosted-git-info's behavior.
    pub fn protocolResourceIdentifierConcatenationToken(self: UrlProtocol) []const u8 {
        return switch (self) {
            .git_plus_ssh, .ssh, .git_plus_https, .git_plus_http, .http, .https, .git => "//",
            .github, .bitbucket, .gitlab, .gist, .sourcehut => "",
        };
    }
};
/// Determine the default representation from a protocol string
/// Mirrors the logic in from-url.js line 110: protocols[parsed.protocol]?.name || parsed.protocol.slice(0, -1)
fn defaultRepresentationFromProtocol(protocol_with_colon: []const u8) Representation {
    // Protocol mappings from hosted-git-info/lib/index.js #protocols
    if (bun.strings.eqlComptime(protocol_with_colon, "git+ssh:")) return .sshurl;
    if (bun.strings.eqlComptime(protocol_with_colon, "ssh:")) return .sshurl;
    if (bun.strings.eqlComptime(protocol_with_colon, "git+https:")) return .https;

    // For other protocols, use the protocol name (without colon) as the representation
    // git: -> git, http: -> http, https: -> https, git+http: -> git+http (which falls back to sshurl)
    const protocol_without_colon = protocol_with_colon[0 .. protocol_with_colon.len - 1];

    if (bun.strings.eqlComptime(protocol_without_colon, "git")) return .git;
    if (bun.strings.eqlComptime(protocol_without_colon, "http")) return .http;
    if (bun.strings.eqlComptime(protocol_without_colon, "https")) return .https;

    // Default fallback for unknown protocols (like git+http)
    return .sshurl;
}

/// Test whether the given node-package-arg string is a GitHub shorthand.
///
/// This mirrors the implementation of hosted-git-info, though it is significantly faster.
fn isGithubShorthand(npa_str: []const u8) bool {
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

    var pound_idx: ?u32 = null;
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
                pound_idx = @intCast(i);
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
            npa_str[pi - 1] != '/'
        else
            npa_str.len >= 1 and npa_str[npa_str.len - 1] != '/';

    // Implement hasSlash
    return seen_slash and does_not_end_with_slash;
}

const UrlProtocolPair = struct {
    url: []u8,
    protocol: union(enum) {
        well_formed: UrlProtocol,

        // A protocol which is not known by the library. Includes the : character, but not the
        // double-slash, so `foo://bar` would yield `foo:`.
        custom: []u8,

        // Either no protocol was specified or the library couldn't figure it out.
        unknown: void,
    },

    /// Given a protocol pair, create a jsc.URL if possible. May allocate, but owns its memory.
    pub fn toUrl(self: *const UrlProtocolPair, allocator: std.mem.Allocator) ?*jsc.URL {
        // Ehhh.. Old IE's max path length was 2K so let's just use that. I searched for a
        // statistical distribution of URL lengths and found nothing.
        const long_url_thresh = 2048;

        var alloc = std.heap.stackFallback(long_url_thresh, allocator);

        return concatPartsToUrl(
            alloc.get(),
            switch (self.protocol) {
                // If we have no protocol, we can assume it is git+ssh.
                .unknown => &.{ "git+ssh://", self.url },
                .custom => |proto_str| &.{ proto_str, "//", self.url },
                // This feels counter-intuitive but is correct. It's not github://foo/bar, it's
                // github:foo/bar.
                .well_formed => |proto_tag| &.{
                    UrlProtocol.strings.getKey(proto_tag).?,
                    // Wordy name for a double-slash or empty string. github:foo/bar is valid, but
                    // git+ssh://foo/bar is also valid.
                    proto_tag.protocolResourceIdentifierConcatenationToken(),
                    self.url,
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
/// enumeration. If the protocol is known, it is returned as a UrlProtocol. If the protocol is
/// specified in the URL, it is given as a slice and if it is not specified, the `unknown` field is
/// returned. The result is a view into `npa_str` which must, consequently, remain stable.
///
/// This mirrors the `correctProtocol` function in `hosted-git-info/parse-url.js`.
fn normalizeProtocol(npa_str: []u8) UrlProtocolPair {
    var first_colon_idx: i32 = -1;
    if (bun.strings.indexOfChar(npa_str, ':')) |idx| {
        first_colon_idx = @intCast(idx);
    }

    // The cast here is safe -- first_colon_idx is guaranteed to be [-1, infty)
    const proto_slice = npa_str[0..@intCast(first_colon_idx + 1)];

    if (UrlProtocol.strings.get(proto_slice)) |url_protocol| {
        // We need to slice off the protocol from the string. Note there are two very annoying
        // cases -- one where the protocol string is foo://bar and one where it is foo:bar.
        var post_colon = bun.strings.drop(npa_str, @intCast(first_colon_idx + 1));

        return .{
            .url = if (bun.strings.hasPrefixComptime(post_colon, "//"))
                post_colon[2..post_colon.len]
            else
                post_colon,
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
                return .{ .url = npa_str, .protocol = .{ .well_formed = .git_plus_ssh } };
            } else {
                // Otherwise we have something like user@host:path which is also a valid URL.
                // Things are, however, different, since we don't really know what the protocol is.
                // Remember, we would've hit the proto://user@host:path above.

                // NOTE(markovejnovic): I don't, at this moment, understand how exactly
                // hosted-git-info and npm-package-arg handle this "unknown" protocol as of now.
                // We can't really guess either -- there's no :// which comes before @
                return .{ .url = npa_str, .protocol = .unknown };
            }
        } else {
            // Something like user@host which is also a valid URL. Since no :, that means that the
            // URL is as good as it gets. No need to slice.
            return .{ .url = npa_str, .protocol = .{ .well_formed = .git_plus_ssh } };
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
                .url = bun.strings.drop(npa_str, dup_slash_idx + 2),
                .protocol = .{ .custom = npa_str[0..dup_slash_idx] },
            };
        }
    }

    // Well, otherwise we have to split the original URL into two pieces,
    // right at the colon.
    if (first_colon_idx != -1) {
        return .{
            .url = bun.strings.drop(npa_str, @intCast(first_colon_idx + 1)),
            .protocol = .{ .custom = npa_str[0..@intCast(first_colon_idx + 1)] },
        };
    }

    // Well we couldn't figure out anything.
    return .{ .url = npa_str, .protocol = .unknown };
}

/// Attempt to correct an scp-style URL into a proper URL, parsable with jsc.URL. Potentially
/// mutates the original input.
///
/// This function assumes that the input is an scp-style URL.
fn correctUrlMut(url_proto_pair: UrlProtocolPair) UrlProtocolPair {
    var at_idx: i32 = undefined;
    var col_idx: i32 = undefined;
    if (bun.strings.lastIndexBeforeChar(url_proto_pair.url, '@', '#')) |idx| {
        at_idx = @intCast(idx);
    } else {
        at_idx = -1;
    }

    if (bun.strings.lastIndexBeforeChar(url_proto_pair.url, ':', '#')) |idx| {
        col_idx = @intCast(idx);
    } else {
        col_idx = -1;
    }

    if (col_idx > at_idx) {
        url_proto_pair.url[@intCast(col_idx)] = '/';
        return url_proto_pair;
    }

    if (col_idx == -1 and url_proto_pair.protocol == .unknown) {
        return .{
            .url = url_proto_pair.url,
            .protocol = .{ .well_formed = .git_plus_ssh },
        };
    }

    return url_proto_pair;
}

/// This enumeration encapsulates all known host providers and their configurations.
///
/// Providers each have different configuration fields and, on top of that, have different
/// mechanisms for formatting URLs. For example, GitHub will format SSH URLs as
/// `git+ssh://git@${domain}/${user}/${project}.git${maybeJoin('#', committish)}`, while `gist`
/// will format URLs as `git+ssh://git@${domain}/${project}.git${maybeJoin('#', committish)}`. This
/// structure encapsulates the differences between providers and how they handle all of that.
///
/// Effectively, this enumeration acts as a registry of all known providers as well as methods on
/// these providers.
const HostProvider = enum {
    const Self = @This();

    bitbucket,
    gist,
    github,
    gitlab,
    sourcehut,

    pub fn formatSsh(
        self: Self,
        allocator: std.mem.Allocator,
        user: ?[]const u8,
        project: []const u8,
        committish: ?[]const u8,
    ) error{OutOfMemory}![]u8 {
        return configs.get(self).format_ssh(self, allocator, user, project, committish);
    }

    pub fn formatSshUrl(
        self: Self,
        allocator: std.mem.Allocator,
        user: ?[]const u8,
        project: []const u8,
        committish: ?[]const u8,
    ) error{OutOfMemory}![]u8 {
        return configs.get(self).format_sshurl(self, allocator, user, project, committish);
    }

    pub fn formatHttps(
        self: Self,
        allocator: std.mem.Allocator,
        auth: ?[]const u8,
        user: ?[]const u8,
        project: []const u8,
        committish: ?[]const u8,
    ) error{OutOfMemory}![]u8 {
        return configs.get(self).format_https(self, allocator, auth, user, project, committish);
    }

    pub fn formatShortcut(
        self: Self,
        allocator: std.mem.Allocator,
        user: ?[]const u8,
        project: []const u8,
        committish: ?[]const u8,
    ) error{OutOfMemory}![]u8 {
        return configs.get(self).format_shortcut(self, allocator, user, project, committish);
    }

    pub fn extract(
        self: Self,
        allocator: std.mem.Allocator,
        url: *jsc.URL,
    ) ?Config.Formatters.Extract.Result {
        return configs.get(self).format_extract(allocator, url);
    }

    const Config = struct {
        protocols: []const UrlProtocol,
        domain: []const u8,
        shortcut: []const u8,
        tree_path: ?[]const u8,
        blob_path: ?[]const u8,
        edit_path: ?[]const u8,

        format_ssh: Formatters.Ssh.Type = Self.Config.Formatters.Ssh.default,
        format_sshurl: Formatters.SshUrl.Type = Self.Config.Formatters.SshUrl.default,
        format_https: Formatters.Https.Type = Self.Config.Formatters.Https.default,
        format_shortcut: Formatters.Shortcut.Type = Self.Config.Formatters.Shortcut.default,
        format_git: Formatters.Git.Type = Self.Config.Formatters.Git.default,
        format_extract: Formatters.Extract.Type,

        /// Encapsulates all the various foramtters that different hosts may have. Usually this has
        /// to do with URLs, but could be other things.
        const Formatters = struct {
            fn requiresUser(user: ?[]const u8) void {
                if (user == null) {
                    @panic("Attempted to format a default SSH URL without a user. This is an " ++
                        "irrecoverable programming bug in Bun. Please report this issue " ++
                        "on GitHub.");
                }
            }

            /// Mirrors hosts.js's sshtemplate
            const Ssh = struct {
                const Type = *const fn (
                    self: Self,
                    allocator: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]u8;

                fn default(
                    self: Self,
                    alloc: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]u8 {
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
                ) error{OutOfMemory}![]u8 {
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
            const SshUrl = struct {
                const Type = *const fn (
                    self: Self,
                    allocator: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]u8;

                fn default(
                    self: Self,
                    alloc: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]u8 {
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
                ) error{OutOfMemory}![]u8 {
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
            const Https = struct {
                const Type = *const fn (
                    self: Self,
                    allocator: std.mem.Allocator,
                    auth: ?[]const u8,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]u8;

                fn default(
                    self: Self,
                    alloc: std.mem.Allocator,
                    auth: ?[]const u8,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]u8 {
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
                ) error{OutOfMemory}![]u8 {
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
                ) error{OutOfMemory}![]u8 {
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
            const Shortcut = struct {
                const Type = *const fn (
                    self: Self,
                    allocator: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]u8;

                fn default(
                    self: Self,
                    alloc: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]u8 {
                    requiresUser(user);

                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        alloc,
                        "{s}:{s}/{s}{s}{s}",
                        .{ self.shortcut(), user.?, project, cmsh_sep, cmsh },
                    );
                }

                fn gist(
                    self: Self,
                    alloc: std.mem.Allocator,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]u8 {
                    _ = user;

                    const cmsh: []const u8 = if (committish) |c| c else "";
                    const cmsh_sep = if (cmsh.len > 0) "#" else "";

                    return std.fmt.allocPrint(
                        alloc,
                        "{s}:{s}{s}{s}",
                        .{ self.shortcut(), project, cmsh_sep, cmsh },
                    );
                }
            };

            /// Mirrors hosts.js's extract function
            const Extract = struct {
                const Result = struct {
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                    _owned_buffer: []const u8,
                    _allocator: std.mem.Allocator,

                    pub fn deinit(self: Result) void {
                        self._allocator.free(self._owned_buffer);
                    }
                };

                const Type = *const fn (allocator: std.mem.Allocator, url: *jsc.URL) ?Result;

                fn github(allocator: std.mem.Allocator, url: *jsc.URL) ?Result {
                    const pathname_str = url.pathname();
                    defer pathname_str.deref();
                    const pathname_utf8 = pathname_str.toUTF8(allocator);
                    defer pathname_utf8.deinit();
                    const pathname = bun.strings.trimPrefixComptime(u8, pathname_utf8.slice(), "/");

                    var iter = std.mem.splitScalar(u8, pathname, '/');
                    const user_part = iter.next() orelse return null;
                    const project_part = iter.next() orelse return null;
                    const type_part = iter.next();
                    const committish_part = iter.next();

                    const project = bun.strings.trimSuffixComptime(u8, project_part, ".git");

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

                    sb.allocate(allocator) catch return null;

                    const user_slice = sb.append(user_part);
                    const project_slice = sb.append(project);
                    const committish_slice = if (committish) |c| sb.append(c) else null;

                    return .{
                        .user = user_slice,
                        .project = project_slice,
                        .committish = committish_slice,
                        ._owned_buffer = sb.allocatedSlice(),
                        ._allocator = allocator,
                    };
                }

                fn bitbucket(allocator: std.mem.Allocator, url: *jsc.URL) ?Result {
                    const pathname_str = url.pathname();
                    defer pathname_str.deref();
                    const pathname_utf8 = pathname_str.toUTF8(allocator);
                    defer pathname_utf8.deinit();
                    const pathname = bun.strings.trimPrefixComptime(u8, pathname_utf8.slice(), "/");

                    var iter = std.mem.splitScalar(u8, pathname, '/');
                    const user_part = iter.next() orelse return null;
                    const project_part = iter.next() orelse return null;
                    const aux = iter.next();

                    if (aux) |a| {
                        if (std.mem.eql(u8, a, "get")) {
                            return null;
                        }
                    }

                    const project = bun.strings.trimSuffixComptime(u8, project_part, ".git");

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

                    const user_slice = sb.append(user_part);
                    const project_slice = sb.append(project);
                    const committish_slice = if (committish) |c| sb.append(c) else null;

                    return .{
                        .user = user_slice,
                        .project = project_slice,
                        .committish = committish_slice,
                        ._owned_buffer = sb.allocatedSlice(),
                        ._allocator = allocator,
                    };
                }

                fn gitlab(allocator: std.mem.Allocator, url: *jsc.URL) ?Result {
                    const pathname_str = url.pathname();
                    defer pathname_str.deref();
                    const pathname_utf8 = pathname_str.toUTF8(allocator);
                    defer pathname_utf8.deinit();
                    const pathname = bun.strings.trimPrefixComptime(u8, pathname_utf8.slice(), "/");

                    if (bun.strings.contains(pathname, "/-/") or
                        bun.strings.contains(pathname, "/archive.tar.gz"))
                    {
                        return null;
                    }

                    const end_slash = bun.strings.lastIndexOfChar(pathname, '/') orelse return null;
                    const project_part = pathname[end_slash + 1 ..];
                    const user_part = pathname[0..end_slash];

                    const project = bun.strings.trimSuffixComptime(u8, project_part, ".git");

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

                    sb.allocate(allocator) catch return null;

                    const user_slice = sb.append(user_part);
                    const project_slice = sb.append(project);
                    const committish_slice = if (committish.len > 0)
                        sb.append(committish)
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

                fn gist(allocator: std.mem.Allocator, url: *jsc.URL) ?Result {
                    const pathname_str = url.pathname();
                    defer pathname_str.deref();
                    const pathname_utf8 = pathname_str.toUTF8(allocator);
                    defer pathname_utf8.deinit();
                    const pathname = bun.strings.trimPrefixComptime(u8, pathname_utf8.slice(), "/");

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

                    const project = bun.strings.trimSuffixComptime(u8, project_part.?, ".git");
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

                    const user_slice = if (user) |u| sb.append(u) else null;
                    const project_slice = sb.append(project);
                    const committish_slice = if (committish) |c| sb.append(c) else null;

                    return .{
                        .user = user_slice,
                        .project = project_slice,
                        .committish = committish_slice,
                        ._owned_buffer = sb.allocatedSlice(),
                        ._allocator = allocator,
                    };
                }

                fn sourcehut(allocator: std.mem.Allocator, url: *jsc.URL) ?Result {
                    const pathname_str = url.pathname();
                    defer pathname_str.deref();
                    const pathname_utf8 = pathname_str.toUTF8(allocator);
                    defer pathname_utf8.deinit();
                    const pathname = bun.strings.trimPrefixComptime(u8, pathname_utf8.slice(), "/");

                    var iter = std.mem.splitScalar(u8, pathname, '/');
                    const user_part = iter.next() orelse return null;
                    const project_part = iter.next() orelse return null;
                    const aux = iter.next();

                    if (aux) |a| {
                        if (std.mem.eql(u8, a, "archive")) {
                            return null;
                        }
                    }

                    const project = bun.strings.trimSuffixComptime(u8, project_part, ".git");

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

                    const user_slice = sb.append(user_part);
                    const project_slice = sb.append(project);
                    const committish_slice = if (committish) |c| sb.append(c) else null;

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
            const Git = struct {
                const Type = ?*const fn (
                    self: Self,
                    allocator: std.mem.Allocator,
                    auth: ?[]const u8,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]u8;

                const default: Type = null;

                fn github(
                    self: Self,
                    allocator: std.mem.Allocator,
                    auth: ?[]const u8,
                    user: ?[]const u8,
                    project: []const u8,
                    committish: ?[]const u8,
                ) error{OutOfMemory}![]u8 {
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
                ) error{OutOfMemory}![]u8 {
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
            .format_extract = Self.Config.Formatters.Extract.bitbucket,
        },
        .gist = .{
            .protocols = &.{ .git, .git_plus_ssh, .git_plus_https, .ssh, .https },
            .domain = "gist.github.com",
            .shortcut = "gist:",
            .tree_path = null,
            .blob_path = null,
            .edit_path = "edit",
            .format_ssh = Self.Config.Formatters.Ssh.gist,
            .format_sshurl = Self.Config.Formatters.SshUrl.gist,
            .format_https = Self.Config.Formatters.Https.gist,
            .format_shortcut = Self.Config.Formatters.Shortcut.gist,
            .format_git = Self.Config.Formatters.Git.gist,
            .format_extract = Self.Config.Formatters.Extract.gist,
        },
        .github = .{
            .protocols = &.{ .git, .http, .git_plus_ssh, .git_plus_https, .ssh, .https },
            .domain = "github.com",
            .shortcut = "github:",
            .tree_path = "tree",
            .blob_path = "blob",
            .edit_path = "edit",
            .format_git = Self.Config.Formatters.Git.github,
            .format_extract = Self.Config.Formatters.Extract.github,
        },
        .gitlab = .{
            .protocols = &.{ .git_plus_ssh, .git_plus_https, .ssh, .https },
            .domain = "gitlab.com",
            .shortcut = "gitlab:",
            .tree_path = "tree",
            .blob_path = "tree",
            .edit_path = "-/edit",
            .format_extract = Self.Config.Formatters.Extract.gitlab,
        },
        .sourcehut = .{
            .protocols = &.{ .git_plus_ssh, .https },
            .domain = "git.sr.ht",
            .shortcut = "sourcehut:",
            .tree_path = "tree",
            .blob_path = "tree",
            .edit_path = null,
            .format_https = Self.Config.Formatters.Https.sourcehut,
            .format_extract = Self.Config.Formatters.Extract.sourcehut,
        },
    });

    /// Return the string representation of the provider.
    pub fn typeStr(self: Self) []const u8 {
        return @tagName(self);
    }

    pub fn shortcut(self: Self) []const u8 {
        return configs.get(self).shortcut;
    }

    pub fn domain(self: Self) []const u8 {
        return configs.get(self).domain;
    }

    pub fn protocols(self: Self) []const UrlProtocol {
        return configs.get(self).protocols;
    }

    pub fn shortcutWithoutColon(self: Self) []const u8 {
        const shct = self.shortcut();
        return shct[0 .. shct.len - 1];
    }

    pub fn treePath(self: Self) ?[]const u8 {
        return configs.get(self).tree_path;
    }

    pub fn blobPath(self: Self) ?[]const u8 {
        return configs.get(self).blob_path;
    }

    pub fn editPath(self: Self) ?[]const u8 {
        return configs.get(self).edit_path;
    }

    /// Find the appropriate host provider by its shortcut (e.g. "github:").
    ///
    /// The second parameter allows you to declare whether the given string includes the protocol:
    /// colon or not.
    pub fn fromShortcut(
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
    pub fn fromDomain(domain_str: []const u8) ?HostProvider {
        inline for (std.meta.fields(Self)) |field| {
            const provider: HostProvider = @enumFromInt(field.value);

            if (std.mem.eql(u8, provider.domain(), domain_str)) {
                return provider;
            }
        }

        return null;
    }

    /// Parse a URL and return the appropriate host provider, if any.
    pub fn fromUrl(url: *jsc.URL) ?HostProvider {
        const max_hostname_len: comptime_int = 253;

        const proto_str = url.protocol();
        defer proto_str.deref();

        // Try shortcut first (github:, gitlab:, etc.)
        if (HostProvider.fromShortcut(proto_str.byteSlice(), .without_colon)) |provider| {
            return provider;
        }

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
        defer parsed.deinit();

        return parsed.href().toJS(go);
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
        const parsed = fromUrl(allocator, as_utf8.mut()) catch |err| {
            return go.throw("Invalid Git URL: {}", .{err});
        } orelse {
            return .null;
        };

        // Create a JavaScript object with all fields
        const obj = jsc.JSValue.createEmptyObject(go, 5);
        obj.put(
            go,
            jsc.ZigString.static("type"),
            bun.String.fromBytes(parsed.host_provider.typeStr()).toJS(go),
        );
        obj.put(
            go,
            jsc.ZigString.static("domain"),
            bun.String.fromBytes(parsed.host_provider.domain()).toJS(go),
        );
        obj.put(
            go,
            jsc.ZigString.static("project"),
            bun.String.fromBytes(parsed.project).toJS(go),
        );
        obj.put(
            go,
            jsc.ZigString.static("user"),
            if (parsed.user) |user| bun.String.fromBytes(user).toJS(go) else .null,
        );
        obj.put(
            go,
            jsc.ZigString.static("committish"),
            if (parsed.committish) |committish|
                bun.String.fromBytes(committish).toJS(go)
            else
                .null,
        );

        return obj;
    }
};

const debug = bun.Output.scoped(.hosted_git_info, .visible);

const bun = @import("bun");
const std = @import("std");
const jsc = bun.jsc;
