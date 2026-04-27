//! Parses an HTTP `Range: bytes=...` request header against a known total
//! size. Only single-range `bytes=start-end` / `bytes=start-` / `bytes=-suffix`
//! forms are supported; multi-range and non-`bytes` units fall back to `.none`
//! (serve full body) rather than 416, matching common static-server behavior.

pub const Result = union(enum) {
    /// No Range header (or unsupported form) — serve 200 with the full body.
    none,
    /// Serve 206 with `Content-Range: bytes start-end/total`. `end` is inclusive.
    satisfiable: struct { start: u64, end: u64 },
    /// Serve 416 with `Content-Range: bytes */total`.
    unsatisfiable,
};

/// Parsed Range header before the total size is known. Safe to store on a
/// request context: it owns no slices into the uWS request buffer.
pub const Raw = union(enum) {
    none,
    suffix: u64, // bytes=-N
    bounded: struct { start: u64, end: ?u64 }, // bytes=N-[M]

    pub fn resolve(this: Raw, total: u64) Result {
        return switch (this) {
            .none => .none,
            .suffix => |n| {
                if (n == 0) return .unsatisfiable;
                // RFC 9110 §14.1.3: a positive suffix-length is satisfiable;
                // for an empty representation we serve the whole (0-byte) body.
                if (total == 0) return .none;
                return .{ .satisfiable = .{ .start = total -| n, .end = total - 1 } };
            },
            .bounded => |b| {
                if (b.start >= total) return .unsatisfiable;
                var end = b.end orelse (total - 1);
                if (end < b.start) return .none;
                if (end >= total) end = total - 1;
                return .{ .satisfiable = .{ .start = b.start, .end = end } };
            },
        };
    }
};

/// Match WebKit's parseRange (HTTPParsers.cpp): case-insensitive "bytes",
/// optional whitespace before "=". https://fetch.spec.whatwg.org/#simple-range-header-value
pub fn parseRaw(header: []const u8) Raw {
    var rest = header;
    if (rest.len < 5 or !bun.strings.eqlCaseInsensitiveASCII(rest[0..5], "bytes", false)) return .none;
    rest = bun.strings.trim(rest[5..], " \t");
    if (rest.len == 0 or rest[0] != '=') return .none;
    rest = rest[1..];

    // Multi-range — not supported, fall through to full body.
    if (bun.strings.indexOfChar(rest, ',') != null) return .none;

    const dash = bun.strings.indexOfChar(rest, '-') orelse return .none;
    const start_s = bun.strings.trim(rest[0..dash], " \t");
    const end_s = bun.strings.trim(rest[dash + 1 ..], " \t");

    if (start_s.len == 0) {
        const n = std.fmt.parseUnsigned(u64, end_s, 10) catch return .none;
        return .{ .suffix = n };
    }

    const start = std.fmt.parseUnsigned(u64, start_s, 10) catch return .none;
    const end: ?u64 = if (end_s.len == 0) null else std.fmt.parseUnsigned(u64, end_s, 10) catch return .none;
    return .{ .bounded = .{ .start = start, .end = end } };
}

pub fn parse(header: []const u8, total: u64) Result {
    return parseRaw(header).resolve(total);
}

pub fn fromRequest(req: anytype, total: u64) Result {
    const h = req.header("range") orelse return .none;
    return parse(h, total);
}

pub fn rawFromRequest(req: anytype) Raw {
    const h = req.header("range") orelse return .none;
    return parseRaw(h);
}

const std = @import("std");

const bun = @import("bun");
