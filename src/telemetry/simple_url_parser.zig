/// Simple URL parser for telemetry that handles both full URLs and path-only URLs
///
/// HTTP server requests: "/search?foo=bar" (path-only)
/// Fetch requests: "https://example.com/search?foo=bar" (full URL)
const std = @import("std");

pub const URLParts = struct {
    scheme: []const u8 = "",
    host: []const u8 = "",
    port: ?u16 = null,
    path: []const u8 = "",
    query: []const u8 = "",
};

/// Parse a URL string into components
/// Handles both full URLs and path-only URLs from HTTP server
pub fn parseURL(url: []const u8) URLParts {
    // Detect if this is a full URL (has scheme)
    const scheme_end = std.mem.indexOf(u8, url, "://");

    if (scheme_end != null) {
        // Full URL parsing
        return parseFullURL(url, scheme_end.?);
    } else {
        // Path-only URL (from HTTP server)
        return parsePathOnly(url);
    }
}

fn parseFullURL(url: []const u8, scheme_end: usize) URLParts {
    var parts: URLParts = .{};

    parts.scheme = url[0..scheme_end];
    var remainder = url[scheme_end + 3 ..];

    // Find the start of the path (first /)
    const path_start = std.mem.indexOf(u8, remainder, "/") orelse remainder.len;
    const host_and_port = remainder[0..path_start];
    const path_and_query = if (path_start < remainder.len) remainder[path_start..] else "/";

    // Parse host and port (handle IPv6 bracketed forms)
    if (host_and_port.len > 0 and host_and_port[0] == '[') {
        const close_bracket = std.mem.indexOf(u8, host_and_port, "]") orelse {
            // Malformed IPv6 host; treat as empty
            parts.host = "";
            parts.port = null;
            return parts;
        };
        parts.host = host_and_port[1..close_bracket];
        if (close_bracket + 1 < host_and_port.len and host_and_port[close_bracket + 1] == ':') {
            const port_str = host_and_port[close_bracket + 2 ..];
            parts.port = std.fmt.parseInt(u16, port_str, 10) catch null;
        }
    } else if (std.mem.lastIndexOf(u8, host_and_port, ":")) |port_colon| {
        parts.host = host_and_port[0..port_colon];
        const port_str = host_and_port[port_colon + 1 ..];
        parts.port = std.fmt.parseInt(u16, port_str, 10) catch null;
    } else {
        parts.host = host_and_port;
    }

    // Set default port if not specified
    if (parts.port == null) {
        if (std.mem.eql(u8, parts.scheme, "https")) {
            parts.port = 443;
        } else {
            parts.port = 80;
        }
    }

    // Parse path and query
    if (std.mem.indexOf(u8, path_and_query, "?")) |query_start| {
        parts.path = path_and_query[0..query_start];
        parts.query = path_and_query[query_start + 1 ..];
    } else {
        parts.path = path_and_query;
    }

    return parts;
}

fn parsePathOnly(url: []const u8) URLParts {
    var parts: URLParts = .{};

    // Parse path and query from path-only URL
    if (std.mem.indexOf(u8, url, "?")) |query_start| {
        parts.path = url[0..query_start];
        parts.query = url[query_start + 1 ..];
    } else {
        parts.path = url;
    }

    return parts;
}

/// Parse a Host header value to extract host and port
/// Handles: example.com, example.com:8080, 192.168.1.1:3000, [::1]:8080, [2001:db8::1]
pub fn parseHostHeader(host_header: []const u8) URLParts {
    var parts: URLParts = .{};

    if (host_header.len == 0) {
        return parts;
    }

    // Handle IPv6: [::1]:8080 or [2001:db8::1]
    if (host_header[0] == '[') {
        const close_bracket = std.mem.indexOf(u8, host_header, "]") orelse {
            // Malformed IPv6, return empty
            return parts;
        };

        parts.host = host_header[1..close_bracket];

        // Check for port after closing bracket
        if (close_bracket + 1 < host_header.len and host_header[close_bracket + 1] == ':') {
            const port_str = host_header[close_bracket + 2 ..];
            parts.port = std.fmt.parseInt(u16, port_str, 10) catch null;
        }

        return parts;
    }

    // Handle IPv4 and domain: example.com:8080 or 192.168.1.1:3000
    if (std.mem.lastIndexOf(u8, host_header, ":")) |colon_idx| {
        parts.host = host_header[0..colon_idx];
        const port_str = host_header[colon_idx + 1 ..];
        parts.port = std.fmt.parseInt(u16, port_str, 10) catch null;
    } else {
        // No port specified
        parts.host = host_header;
    }

    return parts;
}

// ============================================================================
// Tests
// ============================================================================

test "parseURL: full URL with query" {
    const url = "http://localhost:3000/api/users?limit=10";
    const parts = parseURL(url);

    try std.testing.expectEqualStrings("http", parts.scheme);
    try std.testing.expectEqualStrings("localhost", parts.host);
    try std.testing.expectEqual(@as(u16, 3000), parts.port.?);
    try std.testing.expectEqualStrings("/api/users", parts.path);
    try std.testing.expectEqualStrings("limit=10", parts.query);
}

test "parseURL: https default port" {
    const url = "https://example.com/path";
    const parts = parseURL(url);

    try std.testing.expectEqualStrings("https", parts.scheme);
    try std.testing.expectEqualStrings("example.com", parts.host);
    try std.testing.expectEqual(@as(u16, 443), parts.port.?);
    try std.testing.expectEqualStrings("/path", parts.path);
    try std.testing.expectEqual(@as(usize, 0), parts.query.len);
}

test "parseURL: path-only with query (HTTP server)" {
    const url = "/search?foo=bar&baz=qux";
    const parts = parseURL(url);

    try std.testing.expectEqualStrings("", parts.scheme);
    try std.testing.expectEqualStrings("", parts.host);
    try std.testing.expectEqual(@as(?u16, null), parts.port);
    try std.testing.expectEqualStrings("/search", parts.path);
    try std.testing.expectEqualStrings("foo=bar&baz=qux", parts.query);
}

test "parseURL: path-only without query" {
    const url = "/api/users";
    const parts = parseURL(url);

    try std.testing.expectEqualStrings("/api/users", parts.path);
    try std.testing.expectEqual(@as(usize, 0), parts.query.len);
}

test "parseURL: root path" {
    const url = "/";
    const parts = parseURL(url);

    try std.testing.expectEqualStrings("/", parts.path);
    try std.testing.expectEqual(@as(usize, 0), parts.query.len);
}

test "parseURL: IPv4 address" {
    const url = "http://192.168.1.1:8080/api";
    const parts = parseURL(url);

    try std.testing.expectEqualStrings("http", parts.scheme);
    try std.testing.expectEqualStrings("192.168.1.1", parts.host);
    try std.testing.expectEqual(@as(u16, 8080), parts.port.?);
    try std.testing.expectEqualStrings("/api", parts.path);
}

test "parseHostHeader: domain with port" {
    const host = "example.com:8080";
    const parts = parseHostHeader(host);

    try std.testing.expectEqualStrings("example.com", parts.host);
    try std.testing.expectEqual(@as(u16, 8080), parts.port.?);
}

test "parseHostHeader: domain without port" {
    const host = "example.com";
    const parts = parseHostHeader(host);

    try std.testing.expectEqualStrings("example.com", parts.host);
    try std.testing.expectEqual(@as(?u16, null), parts.port);
}

test "parseHostHeader: IPv4 with port" {
    const host = "127.0.0.1:3000";
    const parts = parseHostHeader(host);

    try std.testing.expectEqualStrings("127.0.0.1", parts.host);
    try std.testing.expectEqual(@as(u16, 3000), parts.port.?);
}

test "parseHostHeader: IPv4 without port" {
    const host = "192.168.1.1";
    const parts = parseHostHeader(host);

    try std.testing.expectEqualStrings("192.168.1.1", parts.host);
    try std.testing.expectEqual(@as(?u16, null), parts.port);
}

test "parseHostHeader: IPv6 with port" {
    const host = "[::1]:8080";
    const parts = parseHostHeader(host);

    try std.testing.expectEqualStrings("::1", parts.host);
    try std.testing.expectEqual(@as(u16, 8080), parts.port.?);
}

test "parseHostHeader: IPv6 without port" {
    const host = "[2001:db8::1]";
    const parts = parseHostHeader(host);

    try std.testing.expectEqualStrings("2001:db8::1", parts.host);
    try std.testing.expectEqual(@as(?u16, null), parts.port);
}

test "parseURL: IPv6 without port" {
    const url = "http://[2001:db8::1]/api";
    const parts = parseURL(url);
    try std.testing.expectEqualStrings("http", parts.scheme);
    try std.testing.expectEqualStrings("2001:db8::1", parts.host);
    try std.testing.expectEqual(@as(u16, 80), parts.port.?);
    try std.testing.expectEqualStrings("/api", parts.path);
}

test "parseURL: IPv6 with port" {
    const url = "https://[::1]:8443/path";
    const parts = parseURL(url);
    try std.testing.expectEqualStrings("https", parts.scheme);
    try std.testing.expectEqualStrings("::1", parts.host);
    try std.testing.expectEqual(@as(u16, 8443), parts.port.?);
    try std.testing.expectEqualStrings("/path", parts.path);
}

test "parseHostHeader: empty string" {
    const host = "";
    const parts = parseHostHeader(host);

    try std.testing.expectEqualStrings("", parts.host);
    try std.testing.expectEqual(@as(?u16, null), parts.port);
}
