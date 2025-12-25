/// Shared proxy utilities for HTTP and WebSocket clients.
///
/// This module provides common functionality for HTTP proxy tunneling using the CONNECT method.
/// Both the HTTP client (http.zig) and WebSocket upgrade client (WebSocketUpgradeClient.zig)
/// use these helpers to establish tunneled connections through HTTP proxies.
///
/// The CONNECT method establishes a tunnel to the target server through the proxy:
/// 1. Client sends: CONNECT host:port HTTP/1.1
/// 2. Proxy responds: HTTP/1.1 200 Connection Established
/// 3. After that, all data is forwarded transparently by the proxy
///
/// For more information about HTTP CONNECT tunneling, see:
/// - RFC 7231 Section 4.3.6: https://datatracker.ietf.org/doc/html/rfc7231#section-4.3.6
const bun = @import("bun");
const std = @import("std");

const PicoHTTP = bun.picohttp;
const strings = bun.strings;

/// Error codes for proxy operations
pub const ProxyError = error{
    OutOfMemory,
    ProxyConnectFailed,
    ProxyResponseMalformed,
    ProxyResponseIncomplete,
};

/// Result of parsing a proxy CONNECT response
pub const ConnectResponseResult = struct {
    success: bool,
    status_code: u16,
    bytes_read: usize,
};

/// Parse a proxy CONNECT response.
///
/// Returns information about the response, including whether the connection was established
/// and how many bytes were consumed.
///
/// Expected successful response:
/// ```
/// HTTP/1.1 200 Connection Established
/// ... optional headers ...
///
/// ```
pub fn parseConnectResponse(
    data: []const u8,
    headers_buf: []PicoHTTP.Header,
) ProxyError!ConnectResponseResult {
    // Quick check for HTTP/1.x 200 prefix
    const http_200 = "HTTP/1.1 200";
    const http_200_alt = "HTTP/1.0 200";

    if (data.len >= http_200.len) {
        if (!strings.hasPrefixComptime(data, http_200) and !strings.hasPrefixComptime(data, http_200_alt)) {
            // Check if it's a different status code
            if (strings.hasPrefixComptime(data, "HTTP/1.")) {
                // Parse to get actual status code for error reporting
                const response = PicoHTTP.Response.parse(data, headers_buf) catch |err| {
                    return switch (err) {
                        error.ShortRead => ProxyError.ProxyResponseIncomplete,
                        error.Malformed_HTTP_Response => ProxyError.ProxyResponseMalformed,
                    };
                };
                return .{
                    .success = false,
                    .status_code = @intCast(response.status_code),
                    .bytes_read = @intCast(response.bytes_read),
                };
            }
            return ProxyError.ProxyResponseMalformed;
        }
    }

    // Parse the full response
    const response = PicoHTTP.Response.parse(data, headers_buf) catch |err| {
        return switch (err) {
            error.ShortRead => ProxyError.ProxyResponseIncomplete,
            error.Malformed_HTTP_Response => ProxyError.ProxyResponseMalformed,
        };
    };

    return .{
        .success = response.status_code == 200,
        .status_code = @intCast(response.status_code),
        .bytes_read = @intCast(response.bytes_read),
    };
}

/// Write the base CONNECT request line and headers to a Writer.
/// This is the streaming version for use with buffered socket writers.
///
/// Writes:
/// ```
/// CONNECT host:port HTTP/1.1
/// Host: host:port
/// Proxy-Connection: Keep-Alive
/// ```
///
/// Does NOT write the final \r\n - caller should write additional headers
/// then call `writeConnectRequestEnd`.
pub fn writeConnectRequestStart(comptime Writer: type, writer: Writer, host: []const u8, port: []const u8) void {
    _ = writer.write("CONNECT ") catch 0;
    _ = writer.write(host) catch 0;
    _ = writer.write(":") catch 0;
    _ = writer.write(port) catch 0;
    _ = writer.write(" HTTP/1.1\r\n") catch 0;

    _ = writer.write("Host: ") catch 0;
    _ = writer.write(host) catch 0;
    _ = writer.write(":") catch 0;
    _ = writer.write(port) catch 0;

    _ = writer.write("\r\nProxy-Connection: Keep-Alive\r\n") catch 0;
}

/// Write the final CRLF to end the CONNECT request headers.
pub fn writeConnectRequestEnd(comptime Writer: type, writer: Writer) void {
    _ = writer.write("\r\n") catch 0;
}

/// Write a single header to the Writer.
pub fn writeHeader(comptime Writer: type, writer: Writer, name: []const u8, value: []const u8) void {
    _ = writer.write(name) catch 0;
    _ = writer.write(": ") catch 0;
    _ = writer.write(value) catch 0;
    _ = writer.write("\r\n") catch 0;
}

/// Build a complete CONNECT request into an ArrayList buffer.
/// Convenience wrapper around the Writer-based functions.
pub fn buildConnectRequest(
    list: *std.ArrayListUnmanaged(u8),
    allocator: std.mem.Allocator,
    host: []const u8,
    port: u16,
) error{OutOfMemory}![]u8 {
    var port_buf: [5]u8 = undefined;
    const port_str = std.fmt.bufPrint(&port_buf, "{d}", .{port}) catch unreachable;

    const writer = list.writer(allocator);
    writeConnectRequestStart(@TypeOf(writer), writer, host, port_str);
    writeConnectRequestEnd(@TypeOf(writer), writer);

    return list.toOwnedSlice(allocator);
}
