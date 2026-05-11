const ETag = @This();

/// Parse a single entity tag from a string, returns the tag without quotes and whether it's weak
fn parse(tag_str: []const u8) struct { tag: []const u8, is_weak: bool } {
    var str = std.mem.trim(u8, tag_str, " \t");

    // Check for weak indicator
    var is_weak = false;
    if (bun.strings.hasPrefix(str, "W/")) {
        is_weak = true;
        str = str[2..];
        str = std.mem.trimLeft(u8, str, " \t");
    }

    // Remove surrounding quotes
    if (str.len >= 2 and str[0] == '"' and str[str.len - 1] == '"') {
        str = str[1 .. str.len - 1];
    }

    return .{ .tag = str, .is_weak = is_weak };
}

/// Perform weak comparison between two entity tags according to RFC 9110 Section 8.8.3.2
fn weakMatch(tag1: []const u8, is_weak1: bool, tag2: []const u8, is_weak2: bool) bool {
    _ = is_weak1;
    _ = is_weak2;
    // For weak comparison, we only compare the opaque tag values, ignoring weak indicators
    return std.mem.eql(u8, tag1, tag2);
}

pub fn appendToHeaders(bytes: []const u8, headers: *bun.http.Headers) !void {
    const hash = std.hash.XxHash64.hash(0, bytes);

    var etag_buf: [40]u8 = undefined;
    const etag_str = std.fmt.bufPrint(&etag_buf, "\"{f}\"", .{bun.fmt.hexIntLower(hash)}) catch unreachable;
    try headers.append("etag", etag_str);
}

pub fn ifNoneMatch(
    /// "ETag" header
    etag: []const u8,
    /// "If-None-Match" header
    if_none_match: []const u8,
) bool {
    const our_parsed = parse(etag);

    // Handle "*" case
    if (std.mem.eql(u8, std.mem.trim(u8, if_none_match, " \t"), "*")) {
        return true; // Condition is false, so we should return 304
    }

    // Parse comma-separated list of entity tags
    var iter = std.mem.splitScalar(u8, if_none_match, ',');
    while (iter.next()) |tag_str| {
        const parsed = parse(tag_str);
        if (weakMatch(our_parsed.tag, our_parsed.is_weak, parsed.tag, parsed.is_weak)) {
            return true; // Condition is false, so we should return 304
        }
    }

    return false; // Condition is true, continue with normal processing
}

const bun = @import("bun");
const std = @import("std");
