//! `us_quic_header_t` plus the QPACK static-table index (`enum lsqpack_tnv`,
//! RFC 9204 Appendix A). Passing the index lets the lsqpack encoder skip its
//! XXH32 name lookup; the canonical lowercase name string is the map key, so
//! a hit also avoids lowercasing on the caller side.

pub const Header = extern struct {
    name: [*]const u8,
    name_len: c_uint,
    value: [*]const u8,
    value_len: c_uint,
    qpack_index: c_int = -1,

    pub fn init(name_: []const u8, value_: []const u8, idx: ?Qpack) Header {
        return .{
            .name = name_.ptr,
            .name_len = @intCast(name_.len),
            .value = value_.ptr,
            .value_len = @intCast(value_.len),
            .qpack_index = if (idx) |i| @intFromEnum(i) else -1,
        };
    }
};

/// `enum lsqpack_tnv`. Only the entries a request encoder actually emits are
/// named; the rest are still reachable via `@enumFromInt`.
pub const Qpack = enum(u8) {
    authority = 0,
    path = 1,
    content_disposition = 3,
    content_length = 4,
    cookie = 5,
    date = 6,
    etag = 7,
    if_modified_since = 8,
    if_none_match = 9,
    last_modified = 10,
    link = 11,
    location = 12,
    referer = 13,
    set_cookie = 14,
    method_get = 17,
    scheme_https = 23,
    accept = 29,
    accept_encoding = 31,
    accept_ranges = 32,
    cache_control = 36,
    content_encoding = 43,
    content_type = 44,
    range = 55,
    vary = 59,
    accept_language = 72,
    authorization = 84,
    forwarded = 88,
    if_range = 89,
    origin = 90,
    server = 92,
    user_agent = 95,
    x_forwarded_for = 96,
    _,

    pub const Class = union(enum) {
        /// RFC 9114 §4.2 connection-specific field — MUST NOT be sent.
        forbidden,
        /// Host header — drop and use the value as `:authority`.
        host,
        /// In the QPACK static table; `name` is the canonical lowercase form.
        indexed: struct { name: []const u8, index: Qpack },

        fn idx(comptime name: []const u8, i: Qpack) Class {
            return .{ .indexed = .{ .name = name, .index = i } };
        }
    };

    /// Case-insensitive header-name → encoding disposition. Null means the
    /// name is neither forbidden nor in the static table; lowercase it and
    /// send with no index hint.
    pub fn classify(name: []const u8) ?Class {
        return map.getAnyCase(name);
    }

    const map = bun.ComptimeStringMap(Class, .{
        .{ "connection", .forbidden },
        .{ "host", .host },
        .{ "keep-alive", .forbidden },
        .{ "proxy-connection", .forbidden },
        .{ "transfer-encoding", .forbidden },
        .{ "upgrade", .forbidden },

        .{ "accept", Class.idx("accept", .accept) },
        .{ "accept-encoding", Class.idx("accept-encoding", .accept_encoding) },
        .{ "accept-language", Class.idx("accept-language", .accept_language) },
        .{ "accept-ranges", Class.idx("accept-ranges", .accept_ranges) },
        .{ "authorization", Class.idx("authorization", .authorization) },
        .{ "cache-control", Class.idx("cache-control", .cache_control) },
        .{ "content-disposition", Class.idx("content-disposition", .content_disposition) },
        .{ "content-encoding", Class.idx("content-encoding", .content_encoding) },
        .{ "content-length", Class.idx("content-length", .content_length) },
        .{ "content-type", Class.idx("content-type", .content_type) },
        .{ "cookie", Class.idx("cookie", .cookie) },
        .{ "date", Class.idx("date", .date) },
        .{ "etag", Class.idx("etag", .etag) },
        .{ "forwarded", Class.idx("forwarded", .forwarded) },
        .{ "if-modified-since", Class.idx("if-modified-since", .if_modified_since) },
        .{ "if-none-match", Class.idx("if-none-match", .if_none_match) },
        .{ "if-range", Class.idx("if-range", .if_range) },
        .{ "last-modified", Class.idx("last-modified", .last_modified) },
        .{ "link", Class.idx("link", .link) },
        .{ "location", Class.idx("location", .location) },
        .{ "origin", Class.idx("origin", .origin) },
        .{ "range", Class.idx("range", .range) },
        .{ "referer", Class.idx("referer", .referer) },
        .{ "server", Class.idx("server", .server) },
        .{ "set-cookie", Class.idx("set-cookie", .set_cookie) },
        .{ "user-agent", Class.idx("user-agent", .user_agent) },
        .{ "vary", Class.idx("vary", .vary) },
        .{ "x-forwarded-for", Class.idx("x-forwarded-for", .x_forwarded_for) },
    });
};

const bun = @import("bun");
