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

pub fn parse(header: []const u8, total: u64) Result {
    // Match WebKit's parseRange (HTTPParsers.cpp): case-insensitive "bytes",
    // optional whitespace before "=". https://fetch.spec.whatwg.org/#simple-range-header-value
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
        // suffix: bytes=-N → last N bytes
        const n = std.fmt.parseUnsigned(u64, end_s, 10) catch return .none;
        if (n == 0) return .unsatisfiable;
        if (total == 0) return .unsatisfiable;
        const start = total -| n;
        return .{ .satisfiable = .{ .start = start, .end = total - 1 } };
    }

    const start = std.fmt.parseUnsigned(u64, start_s, 10) catch return .none;
    if (start >= total) return .unsatisfiable;

    if (end_s.len == 0) {
        // open: bytes=N-
        return .{ .satisfiable = .{ .start = start, .end = total - 1 } };
    }

    var end = std.fmt.parseUnsigned(u64, end_s, 10) catch return .none;
    if (end < start) return .none;
    if (end >= total) end = total - 1;
    return .{ .satisfiable = .{ .start = start, .end = end } };
}

pub fn fromRequest(req: *uws.Request, total: u64) Result {
    const h = req.header("range") orelse return .none;
    return parse(h, total);
}

const std = @import("std");
const bun = @import("bun");
const uws = bun.uws;
