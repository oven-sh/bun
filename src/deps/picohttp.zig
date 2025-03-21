///
/// PicoHTTP: Pure Zig HTTP Parser
/// Inspired by picohttpparser, but rewritten to be idiomatic Zig
///
/// This is a high-performance HTTP/1.x parser with focus on memory efficiency and speed
///
const std = @import("std");
const bun = @import("root").bun;
const builtin = @import("builtin");
const mem = std.mem;
const assert = std.debug.assert;

const ExactSizeMatcher = bun.ExactSizeMatcher;
const Output = bun.Output;
const Environment = bun.Environment;
const StringBuilder = bun.StringBuilder;
const string = bun.string;
const strings = bun.strings;
const fmt = std.fmt;

// --------------------- Error Types ---------------------

pub const HTTPError = error{
    BadRequest,
    ShortRead,
    BadHeaders,
    InvalidMethod,
    InvalidPath,
    InvalidHTTPVersion,
    InvalidStatusCode,
    MalformedRequest,
    MalformedResponse,
    // This is the same as MalformedResponse but needed for WebSocket HTTP client compatibility
    Malformed_HTTP_Response,
    HeadersTooLarge,
    ChunkedEncodingError,
};

// --------------------- HTTP Constants ---------------------

/// HTTP version enum - uses only 2 bits of storage
pub const HTTPVersion = enum(u2) {
    HTTP_0_9 = 0,
    HTTP_1_0 = 1,
    HTTP_1_1 = 2,
    HTTP_1_2 = 3,

    pub fn toString(self: HTTPVersion) []const u8 {
        return switch (self) {
            .HTTP_0_9 => "HTTP/0.9",
            .HTTP_1_0 => "HTTP/1.0",
            .HTTP_1_1 => "HTTP/1.1",
            .HTTP_1_2 => "HTTP/1.2",
        };
    }

    pub fn fromMinorVersion(major: u1, minor: u2) HTTPVersion {
        if (major == 0) {
            return .HTTP_0_9;
        } else {
            return switch (minor) {
                0 => .HTTP_1_0,
                1 => .HTTP_1_1,
                2 => .HTTP_1_2,
                3 => .HTTP_1_2, // Treat unknown values as 1.2
            };
        }
    }

    /// Returns true if the version supports trailer headers
    pub fn supportsTrailers(self: HTTPVersion) bool {
        // Only HTTP/1.1 and above support trailers
        return switch (self) {
            .HTTP_0_9, .HTTP_1_0 => false,
            .HTTP_1_1, .HTTP_1_2 => true,
        };
    }

    /// Returns true if the version supports chunked encoding
    pub fn supportsChunkedEncoding(self: HTTPVersion) bool {
        // Only HTTP/1.1 and above support chunked encoding
        return switch (self) {
            .HTTP_0_9, .HTTP_1_0 => false,
            .HTTP_1_1, .HTTP_1_2 => true,
        };
    }
};

// --------------------- HTTP Types ---------------------

/// A header name/value pair
pub const Header = struct {
    name: []const u8,
    value: []const u8,

    pub const List = struct {
        list: []Header = &.{},

        pub fn get(this: *const List, name: string) ?string {
            for (this.list) |header| {
                if (strings.eqlCaseInsensitiveASCII(header.name, name, true)) {
                    return header.value;
                }
            }
            return null;
        }

        pub fn getIfOtherIsAbsent(this: *const List, name: string, other: string) ?string {
            var value: ?string = null;
            for (this.list) |header| {
                if (strings.eqlCaseInsensitiveASCII(header.name, other, true)) {
                    return null;
                }

                if (value == null and strings.eqlCaseInsensitiveASCII(header.name, name, true)) {
                    value = header.value;
                }
            }

            return value;
        }
    };

    pub fn isMultiline(self: Header) bool {
        return self.name.len == 0;
    }

    pub fn format(self: Header, comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        if (Output.enable_ansi_colors_stderr) {
            if (self.isMultiline()) {
                try fmt.format(writer, comptime Output.prettyFmt("<r><cyan>{s}", true), .{self.value});
            } else {
                try fmt.format(writer, comptime Output.prettyFmt("<r><cyan>{s}<r><d>: <r>{s}", true), .{ self.name, self.value });
            }
        } else {
            if (self.isMultiline()) {
                try fmt.format(writer, comptime Output.prettyFmt("<r><cyan>{s}", false), .{self.value});
            } else {
                try fmt.format(writer, comptime Output.prettyFmt("<r><cyan>{s}<r><d>: <r>{s}", false), .{ self.name, self.value });
            }
        }
    }

    pub fn count(this: *const Header, builder: *StringBuilder) void {
        builder.count(this.name);
        builder.count(this.value);
    }

    pub fn clone(this: *const Header, builder: *StringBuilder) Header {
        return .{
            .name = builder.append(this.name),
            .value = builder.append(this.value),
        };
    }

    pub const CURLFormatter = struct {
        header: *const Header,

        pub fn format(self: @This(), comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
            const header = self.header;
            if (header.value.len > 0) {
                try fmt.format(writer, "-H \"{s}: {s}\"", .{ header.name, header.value });
            } else {
                try fmt.format(writer, "-H \"{s}\"", .{header.name});
            }
        }
    };

    pub fn curl(self: *const Header) Header.CURLFormatter {
        return .{ .header = self };
    }
};

/// Chunked decoder state for HTTP chunked transfer encoding
pub const ChunkedDecoder = struct {
    /// Number of bytes left in the current chunk
    bytes_left_in_chunk: usize = 0,

    /// Whether to consume trailer headers (true) or stop at end of chunks (false)
    consume_trailer: bool = false,

    /// Number of hex digits read for the current chunk size
    hex_count: u4 = 0, // Max 16 hex digits needed (u4 = 0-15)

    /// Collected trailer headers
    trailer_headers: ?*Header.List = null,

    /// Current state of the chunked decoder
    state: State = .CHUNK_SIZE,

    /// Possible states for the chunked decoder state machine - uses only 3 bits
    pub const State = enum(u3) {
        /// Reading the chunk size (hexadecimal)
        CHUNK_SIZE,

        /// Reading chunk extension (skipping to end of line)
        CHUNK_EXT,

        /// Reading chunk data
        CHUNK_DATA,

        /// Reading CRLF after chunk data
        CHUNK_CRLF,

        /// Reading the start of a trailer header line
        TRAILERS_LINE_HEAD,

        /// Reading the middle/end of a trailer header line
        TRAILERS_LINE_MIDDLE,
    };

    /// Returns true if the chunked decoder is currently in chunk data state
    pub fn isInDataState(self: *const ChunkedDecoder) bool {
        return self.state == .CHUNK_DATA;
    }

    /// Options for the chunked decoder
    pub const DecoderOptions = struct {
        /// Whether to collect trailer headers
        collect_trailers: bool = false,
        /// Where to store the trailer headers if collect_trailers is true
        trailer_headers: ?*Header.List = null,
    };

    /// Initialize the decoder with specified options
    pub fn init(options: DecoderOptions) ChunkedDecoder {
        return .{
            .bytes_left_in_chunk = 0,
            .consume_trailer = options.collect_trailers,
            .hex_count = 0,
            .trailer_headers = options.trailer_headers,
            .state = .CHUNK_SIZE,
        };
    }

    /// Returns true if the decoder has trailer headers
    pub fn hasTrailerHeaders(self: *const ChunkedDecoder) bool {
        return self.trailer_headers != null and self.consume_trailer;
    }

    /// Resets the chunked decoder to initial state
    pub fn reset(self: *ChunkedDecoder) void {
        self.bytes_left_in_chunk = 0;
        self.hex_count = 0;
        self.state = .CHUNK_SIZE;

        // Clear any trailer headers list
        if (self.trailer_headers) |headers| {
            headers.list = &.{};
        }
    }
};

/// The Request type encapsulates a parsed HTTP request
pub const Request = struct {
    method: []const u8,
    path: []const u8,
    headers: []const Header,
    bytes_read: u32 = 0,
    /// For compatibility with existing code that expects the specific HTTP version
    minor_version: i32 = 1, // Default to HTTP/1.1
    // Added version field with a default value for backward compatibility
    version: HTTPVersion = .HTTP_1_1,

    pub const CURLFormatter = struct {
        request: *const Request,
        ignore_insecure: bool = false,
        body: []const u8 = "",

        pub fn format(self: @This(), comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
            const request = self.request;
            if (Output.enable_ansi_colors_stderr) {
                _ = try writer.write(Output.prettyFmt("<r><d>[fetch] $<r> ", true));

                try fmt.format(writer, Output.prettyFmt("<b><cyan>curl<r> <d>--http1.1<r> <b>\"{s}\"<r>", true), .{request.path});
            } else {
                try fmt.format(writer, "curl --http1.1 \"{s}\"", .{request.path});
            }

            if (!bun.strings.eqlComptime(request.method, "GET")) {
                try fmt.format(writer, " -X {s}", .{request.method});
            }

            if (self.ignore_insecure) {
                _ = try writer.writeAll(" -k");
            }

            var content_type: []const u8 = "";

            for (request.headers) |*header| {
                _ = try writer.writeAll(" ");
                if (content_type.len == 0) {
                    if (bun.strings.eqlCaseInsensitiveASCII("content-type", header.name, true)) {
                        content_type = header.value;
                    }
                }

                try header.curl().format("", .{}, writer);

                if (bun.strings.eqlCaseInsensitiveASCII("accept-encoding", header.name, true)) {
                    _ = try writer.writeAll(" --compressed");
                }
            }

            if (self.body.len > 0 and (content_type.len > 0 and bun.strings.hasPrefixComptime(content_type, "application/json") or bun.strings.hasPrefixComptime(content_type, "text/") or bun.strings.containsComptime(content_type, "json"))) {
                _ = try writer.writeAll(" --data-raw ");
                try bun.js_printer.writeJSONString(self.body, @TypeOf(writer), writer, .utf8);
            }
        }
    };

    pub fn curl(self: *const Request, ignore_insecure: bool, body: []const u8) Request.CURLFormatter {
        return .{
            .request = self,
            .ignore_insecure = ignore_insecure,
            .body = body,
        };
    }

    pub fn clone(this: *const Request, headers: []Header, builder: *StringBuilder) Request {
        for (this.headers, 0..) |header, i| {
            headers[i] = header.clone(builder);
        }

        return .{
            .method = builder.append(this.method),
            .path = builder.append(this.path),
            .version = this.version,
            .minor_version = this.minor_version,
            .headers = headers,
            .bytes_read = this.bytes_read,
        };
    }

    pub fn format(self: Request, comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        if (Output.enable_ansi_colors_stderr) {
            _ = try writer.write(Output.prettyFmt("<r><d>[fetch]<r> ", true));
        }
        try fmt.format(writer, "> {s} {s} {s}\n", .{ self.method, self.path, self.version.toString() });
        for (self.headers) |header| {
            if (Output.enable_ansi_colors_stderr) {
                _ = try writer.write(Output.prettyFmt("<r><d>[fetch]<r> ", true));
            }
            _ = try writer.write("> ");
            try fmt.format(writer, "{s}\n", .{header});
        }
    }

    pub fn parse(buf: []const u8, header_buf: []Header) !Request {
        var method: []const u8 = undefined;
        var path: []const u8 = undefined;
        var version: HTTPVersion = undefined;

        // Parse the request and headers
        const result = try parseRequest(
            buf,
            &method,
            &path,
            &version,
            header_buf,
        );

        // Leave a sentinel value, for JavaScriptCore support.
        @as([*]u8, @ptrFromInt(@intFromPtr(path.ptr)))[path.len] = 0;

        // Determine minor_version based on the parsed version
        const minor_version: i32 = switch (version) {
            .HTTP_0_9 => 0,
            .HTTP_1_0 => 0,
            .HTTP_1_1 => 1,
            .HTTP_1_2 => 2,
        };

        return Request{
            .method = method,
            .path = path,
            .version = version,
            .minor_version = minor_version,
            .headers = header_buf[0..result.header_count],
            .bytes_read = result.bytes_read,
        };
    }
};

const StatusCodeFormatter = struct {
    code: usize,

    pub fn format(self: @This(), comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        if (Output.enable_ansi_colors_stderr) {
            switch (self.code) {
                101, 200...299 => try fmt.format(writer, comptime Output.prettyFmt("<r><green>{d}<r>", true), .{self.code}),
                300...399 => try fmt.format(writer, comptime Output.prettyFmt("<r><yellow>{d}<r>", true), .{self.code}),
                else => try fmt.format(writer, comptime Output.prettyFmt("<r><red>{d}<r>", true), .{self.code}),
            }
        } else {
            try fmt.format(writer, "{d}", .{self.code});
        }
    }
};

pub const Response = struct {
    version: HTTPVersion = .HTTP_1_1,
    status_code: u16 = 0, // Using u16 for compatibility with WebCore
    status: []const u8 = "",
    headers: Header.List = .{},
    bytes_read: u32 = 0,

    pub fn format(self: Response, comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        if (Output.enable_ansi_colors_stderr) {
            _ = try writer.write(Output.prettyFmt("<r><d>[fetch]<r> ", true));
        }

        try fmt.format(
            writer,
            "< {} {s}\n",
            .{
                StatusCodeFormatter{
                    .code = self.status_code,
                },
                self.status,
            },
        );
        for (self.headers.list) |header| {
            if (Output.enable_ansi_colors_stderr) {
                _ = try writer.write(Output.prettyFmt("<r><d>[fetch]<r> ", true));
            }

            _ = try writer.write("< ");
            try fmt.format(writer, "{s}\n", .{header});
        }
    }

    pub fn count(this: *const Response, builder: *StringBuilder) void {
        builder.count(this.status);

        for (this.headers.list) |header| {
            header.count(builder);
        }
    }

    pub fn clone(this: *const Response, headers: []Header, builder: *StringBuilder) Response {
        var that = this.*;
        that.status = builder.append(this.status);

        for (this.headers.list, 0..) |header, i| {
            headers[i] = header.clone(builder);
        }

        that.headers.list = headers[0..this.headers.list.len];

        return that;
    }

    pub fn parseParts(buf: []const u8, src: []Header, offset: ?*usize) !Response {
        var version: HTTPVersion = .HTTP_1_1;
        var status_code: u10 = 0;
        var status_message: []const u8 = "";

        // Parse the response using our Zig implementation
        const result = parseResponse(
            buf,
            &version,
            &status_code,
            &status_message,
            src,
        ) catch |err| {
            if (err == error.ShortRead and offset != null) {
                offset.?.* += buf.len;
            }
            return err;
        };

        if (offset != null) {
            offset.?.* += result.bytes_read;
        }

        return Response{
            .version = version,
            .status_code = status_code,
            .status = status_message,
            .headers = .{ .list = src[0..result.header_count] },
            .bytes_read = result.bytes_read,
        };
    }

    pub fn parse(buf: []const u8, src: []Header) !Response {
        var offset: usize = 0;
        return parseParts(buf, src, &offset);
    }
};

pub const Headers = struct {
    headers: []const Header,

    pub fn format(self: Headers, comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        for (self.headers) |header| {
            try fmt.format(writer, "{s}: {s}\r\n", .{ header.name, header.value });
        }
    }

    pub fn parse(buf: []const u8, src: []Header) !Headers {
        // Parse the headers using our Zig implementation
        const result = try parseHeaders(buf, src);

        return Headers{
            .headers = src[0..result.header_count],
        };
    }
};

// ------------------------------ Parser Implementation ------------------------------

/// Result of parsing an HTTP request
pub const RequestParseResult = struct {
    /// Number of bytes read from the input buffer
    bytes_read: u32,
    /// Number of headers parsed
    header_count: usize,
};

/// Supported HTTP versions (compile-time configuration)
pub const HTTPVersionSupport = struct {
    /// Whether to support HTTP/0.9
    http_0_9: bool = true,
    /// Whether to support HTTP/1.0
    http_1_0: bool = true,
    /// Whether to support HTTP/1.1
    http_1_1: bool = true,
    /// Whether to support HTTP/1.2
    http_1_2: bool = true,
};

/// Parse an HTTP request
/// buf: The input buffer containing the HTTP request
/// method: Will be set to point to the method string in the buffer
/// path: Will be set to point to the path string in the buffer
/// version: Will be set to the HTTP version
/// headers: A buffer to store the parsed headers
/// Returns the number of bytes read and headers parsed, or an error
pub fn parseRequest(
    buf: []const u8,
    method: *[]const u8,
    path: *[]const u8,
    version: *HTTPVersion,
    headers: []Header,
) HTTPError!RequestParseResult {
    // Initialize output variables
    method.* = "";
    path.* = "";

    // Minimum viable HTTP request length check
    if (buf.len < 16) { // "GET / HTTP/1.1\r\n\r\n" minimum
        return error.ShortRead;
    }

    // Check if the request is complete
    if (isComplete(buf) == null) {
        return error.ShortRead;
    }

    // Parse the request line
    var pos: usize = 0;

    // Parse method
    const method_start = pos;
    while (pos < buf.len and buf[pos] != ' ') {
        if (!isTokenChar(buf[pos])) {
            return error.InvalidMethod;
        }
        pos += 1;
    }

    if (pos == method_start or pos >= buf.len) {
        return error.BadRequest;
    }

    method.* = buf[method_start..pos];
    pos += 1; // Skip space

    if (pos >= buf.len) {
        return error.BadRequest;
    }

    // Parse path
    const path_start = pos;
    while (pos < buf.len and buf[pos] != ' ' and buf[pos] != '\r' and buf[pos] != '\n') {
        // Check for invalid characters in path
        if (buf[pos] < 0x20 or buf[pos] == 0x7F) {
            return error.InvalidPath;
        }
        pos += 1;
    }

    if (pos == path_start) {
        return error.BadRequest;
    }

    path.* = buf[path_start..pos];

    // Check if this is an HTTP/0.9 Simple-Request (no version, no headers)
    if (pos >= buf.len or buf[pos] == '\r' or buf[pos] == '\n') {
        // This is HTTP/0.9 (Simple-Request)
        version.* = .HTTP_0_9;

        // Skip CRLF
        if (pos < buf.len and buf[pos] == '\r') {
            pos += 1;
            if (pos >= buf.len or buf[pos] != '\n') {
                return error.BadRequest;
            }
            pos += 1; // Skip \n
        } else if (pos < buf.len and buf[pos] == '\n') {
            pos += 1; // Skip \n
        }

        // HTTP/0.9 has no headers
        return RequestParseResult{
            .bytes_read = @intCast(pos),
            .header_count = 0,
        };
    }

    // For HTTP/1.x, there must be a space after path
    if (pos >= buf.len or buf[pos] != ' ') {
        return error.BadRequest;
    }

    pos += 1; // Skip space

    if (pos + 8 >= buf.len) { // Need at least "HTTP/1.1"
        return error.BadRequest;
    }

    // Parse HTTP version
    if (!mem.eql(u8, buf[pos .. pos + 5], "HTTP/")) {
        return error.InvalidHTTPVersion;
    }
    pos += 5;

    if (pos + 2 >= buf.len) {
        return error.BadRequest;
    }

    // Extract major and minor version
    var major_version: u1 = undefined;
    var minor_version: u2 = undefined;

    // Parse major version (0 or 1)
    if (buf[pos] == '0') {
        major_version = 0;
    } else if (buf[pos] == '1') {
        major_version = 1;
    } else {
        return error.InvalidHTTPVersion; // Unsupported major version
    }
    pos += 1;

    // Check for dot separator
    if (buf[pos] != '.') {
        return error.InvalidHTTPVersion;
    }
    pos += 1;

    // Parse minor version
    switch (buf[pos]) {
        '0' => minor_version = 0,
        '1' => minor_version = 1,
        '2' => minor_version = 2,
        else => return error.InvalidHTTPVersion,
    }
    pos += 1;

    // Set the HTTP version
    version.* = HTTPVersion.fromMinorVersion(major_version, minor_version);

    // Skip to end of line
    if (pos >= buf.len or (buf[pos] != '\r' and buf[pos] != '\n')) {
        return error.BadRequest;
    }

    // Skip CRLF
    if (buf[pos] == '\r') {
        pos += 1;
        if (pos >= buf.len or buf[pos] != '\n') {
            return error.BadRequest;
        }
    }
    pos += 1;

    // Parse headers
    const header_result = try parseHeadersInternal(buf[pos..], headers);

    return RequestParseResult{
        .bytes_read = @intCast(pos + header_result.bytes_read),
        .header_count = header_result.header_count,
    };
}

/// Result of parsing an HTTP response
pub const ResponseParseResult = struct {
    /// Number of bytes read from the input buffer
    bytes_read: u32,
    /// Number of headers parsed
    header_count: usize,
};

/// Parse an HTTP response
/// buf: The input buffer containing the HTTP response
/// version: Will be set to the HTTP version
/// status_code: Will be set to the status code as a number
/// status_message: Will be set to point to the status message string in the buffer
/// headers: A buffer to store the parsed headers
/// Returns the number of bytes read and headers parsed, or an error
pub fn parseResponse(
    buf: []const u8,
    version: *HTTPVersion,
    status_code: *u10,
    status_message: *[]const u8,
    headers: []Header,
) HTTPError!ResponseParseResult {
    // Initialize output variables
    status_code.* = 0;
    status_message.* = "";

    // Quick check for minimum viable HTTP response
    if (buf.len < 15) { // "HTTP/1.1 200 OK\r\n\r\n" minimum
        return error.ShortRead;
    }

    // Parse HTTP version
    if (buf.len < 8 or !mem.eql(u8, buf[0..5], "HTTP/")) {
        return error.InvalidHTTPVersion;
    }

    // We only support HTTP/1.x
    if (buf[5] != '1' or buf[6] != '.') {
        return error.InvalidHTTPVersion;
    }

    // Parse minor version (0 or 1)
    const major_version: u1 = 1; // HTTP/1.x only
    const minor_version: u2 = switch (buf[7]) {
        '0' => 0,
        '1' => 1,
        '2' => 2,
        else => return error.InvalidHTTPVersion,
    };

    // Set the HTTP version
    version.* = HTTPVersion.fromMinorVersion(major_version, minor_version);

    // Skip to status code (must be preceded by a space)
    if (buf.len < 9 or buf[8] != ' ') {
        return error.BadRequest;
    }
    var pos: usize = 9;

    // Skip any additional spaces
    while (pos < buf.len and buf[pos] == ' ') pos += 1;
    if (pos + 3 > buf.len) {
        return error.ShortRead;
    }

    // Parse 3-digit status code
    if (buf[pos] < '0' or buf[pos] > '9' or
        buf[pos + 1] < '0' or buf[pos + 1] > '9' or
        buf[pos + 2] < '0' or buf[pos + 2] > '9')
    {
        return error.InvalidStatusCode;
    }

    status_code.* = @as(u10, buf[pos] - '0') * 100 +
        @as(u10, buf[pos + 1] - '0') * 10 +
        @as(u10, buf[pos + 2] - '0');
    pos += 3;

    // Skip to status message (must be preceded by a space)
    if (pos >= buf.len or buf[pos] != ' ') {
        return error.BadRequest;
    }
    pos += 1;

    // Skip any additional spaces
    while (pos < buf.len and buf[pos] == ' ') pos += 1;

    // Parse status message
    const status_start = pos;
    while (pos < buf.len) {
        if (buf[pos] == '\r' or buf[pos] == '\n') break;
        if (buf[pos] < 0x20 and buf[pos] != '\t') return error.BadRequest;
        pos += 1;
    }

    status_message.* = buf[status_start..pos];

    // Skip CRLF
    if (pos >= buf.len) {
        return error.ShortRead;
    }
    if (buf[pos] == '\r') {
        pos += 1;
        if (pos >= buf.len or buf[pos] != '\n') {
            return error.BadRequest;
        }
    }
    pos += 1;

    // Parse headers
    const header_result = try parseHeadersInternal(buf[pos..], headers);

    return ResponseParseResult{
        .bytes_read = @intCast(pos + header_result.bytes_read),
        .header_count = header_result.header_count,
    };
}

/// Result of parsing HTTP headers
pub const HeadersParseResult = struct {
    /// Number of bytes read from the input buffer
    bytes_read: u32,
    /// Number of headers parsed
    header_count: usize,
};

/// Parse HTTP headers only (not a complete request/response)
/// buf: The input buffer containing the HTTP headers
/// headers: A buffer to store the parsed headers
/// Returns the number of bytes read and headers parsed, or an error
pub fn parseHeaders(
    buf: []const u8,
    headers: []Header,
) HTTPError!HeadersParseResult {
    return parseHeadersInternal(buf, headers);
}

/// Result of decoding chunked data
pub const ChunkedDecodeResult = enum(c_int) {
    /// There was an error in the chunked encoding
    Error = -1,
    /// Decoding is incomplete, needs more data
    Incomplete = -2,
    /// Decoding finished successfully
    Success = 0,
    /// Decoding finished successfully with trailer headers
    SuccessWithTrailers = 1,
};

/// Helper function to check if the chunked decoder is in data state
/// Used by the http.zig implementation to check decoder state
pub fn decodeChunkedIsInData(decoder: *ChunkedDecoder) bool {
    return decoder.isInDataState();
}

/// Decode chunked-encoded data
/// decoder: Chunked decoder state
/// buf: The buffer containing chunked data (will be modified in-place)
/// bufsz: The size of the buffer (input), and the new size after decoding (output)
/// Returns a ChunkedDecodeResult indicating success, error, or need for more data
pub fn decodeChunked(
    decoder: *ChunkedDecoder,
    buf: [*]u8,
    bufsz: *usize,
) ChunkedDecodeResult {
    var dst: usize = 0;
    var src: usize = 0;
    const buf_size = bufsz.*;

    // Process the chunked data
    while (true) {
        switch (decoder.state) {
            .CHUNK_SIZE => {
                // Parse the hexadecimal chunk size
                while (src < buf_size) {
                    // Convert hex digit to value
                    const hex_val = switch (buf[src]) {
                        '0'...'9' => buf[src] - '0',
                        'A'...'F' => buf[src] - 'A' + 10,
                        'a'...'f' => buf[src] - 'a' + 10,
                        else => {
                            // If not a hex digit, we've reached the end of chunk size
                            if (decoder.hex_count == 0) {
                                // Error: no hex digits found
                                return .Error;
                            }
                            break;
                        },
                    };

                    // Avoid overflow: max 16 hex digits for 64-bit size
                    if (decoder.hex_count == 16) {
                        return .Error;
                    }

                    // Update chunk size
                    decoder.bytes_left_in_chunk = decoder.bytes_left_in_chunk * 16 + hex_val;
                    decoder.hex_count += 1;
                    src += 1;
                }

                // If we didn't find the end of the chunk size and hit EOF
                if (src == buf_size) {
                    copyRemainingData(buf, dst, src, bufsz);
                    return .Incomplete;
                }

                // Reset hex count and move to extension parsing
                decoder.hex_count = 0;
                decoder.state = .CHUNK_EXT;
            },

            .CHUNK_EXT => {
                // Skip extensions until end of line
                while (src < buf_size) {
                    if (buf[src] == '\n') break;
                    src += 1;
                }

                // If we hit EOF before finding end of line
                if (src == buf_size) {
                    copyRemainingData(buf, dst, src, bufsz);
                    return .Incomplete;
                }

                // Skip the newline
                src += 1;

                // If this was the last chunk (size 0)
                if (decoder.bytes_left_in_chunk == 0) {
                    if (decoder.consume_trailer) {
                        // Process trailer headers
                        decoder.state = .TRAILERS_LINE_HEAD;
                    } else {
                        // We're done, return success with the remaining buffer size
                        copyRemainingData(buf, dst, src, bufsz);
                        return .Success;
                    }
                } else {
                    // Start processing the chunk data
                    decoder.state = .CHUNK_DATA;
                }
            },

            .CHUNK_DATA => {
                const avail = buf_size - src;

                // If we have less data available than needed for this chunk
                if (avail < decoder.bytes_left_in_chunk) {
                    // Copy what we have and return incomplete
                    if (dst != src and avail > 0) {
                        mem.copyForwards(u8, buf[dst..][0..avail], buf[src..][0..avail]);
                    }
                    dst += avail;
                    src += avail;
                    decoder.bytes_left_in_chunk -= avail;

                    bufsz.* = dst;
                    return .Incomplete;
                }

                // Copy the chunk data if needed
                if (dst != src and decoder.bytes_left_in_chunk > 0) {
                    mem.copyForwards(u8, buf[dst..][0..decoder.bytes_left_in_chunk], buf[src..][0..decoder.bytes_left_in_chunk]);
                }

                // Update positions
                dst += decoder.bytes_left_in_chunk;
                src += decoder.bytes_left_in_chunk;
                decoder.bytes_left_in_chunk = 0;
                decoder.state = .CHUNK_CRLF;
            },

            .CHUNK_CRLF => {
                // Skip carriage returns
                while (src < buf_size and buf[src] == '\r') {
                    src += 1;
                }

                // If we hit EOF
                if (src == buf_size) {
                    copyRemainingData(buf, dst, src, bufsz);
                    return .Incomplete;
                }

                // Expect a newline
                if (buf[src] != '\n') {
                    return .Error;
                }

                // Skip the newline and go back to reading chunk size
                src += 1;
                decoder.state = .CHUNK_SIZE;
            },

            .TRAILERS_LINE_HEAD => {
                // Skip carriage returns
                while (src < buf_size and buf[src] == '\r') {
                    src += 1;
                }

                // If we hit EOF
                if (src == buf_size) {
                    copyRemainingData(buf, dst, src, bufsz);
                    return .Incomplete;
                }

                // If we see a newline, we're at the end of trailers
                if (buf[src] == '\n') {
                    src += 1;
                    copyRemainingData(buf, dst, src, bufsz);

                    // If we're collecting trailers and we have a headers list, return success with trailers
                    if (decoder.hasTrailerHeaders()) {
                        return .SuccessWithTrailers;
                    } else {
                        return .Success;
                    }
                }

                // Otherwise process a trailer field
                decoder.state = .TRAILERS_LINE_MIDDLE;
            },

            .TRAILERS_LINE_MIDDLE => {
                // Track trailer header for collection
                const trailer_start = src;

                // Skip to end of trailer line
                while (src < buf_size) {
                    if (buf[src] == '\n') break;
                    src += 1;
                }

                // If we hit EOF
                if (src == buf_size) {
                    copyRemainingData(buf, dst, src, bufsz);
                    return .Incomplete;
                }

                // If collecting trailers and we have a header, parse and add it
                if (decoder.hasTrailerHeaders()) {
                    const headers = decoder.trailer_headers.?;
                    const trailer_end = src;
                    const trailer_line = buf[trailer_start..trailer_end];

                    // Ignore empty lines
                    if (trailer_line.len > 0) {
                        // Parse as a header line
                        if (parseTrailerHeader(trailer_line)) |trailer_header| {
                            // If we have room in the headers list, add this header
                            if (headers.list.len < headers.list.len) {
                                // Add to the trailer headers list
                                const header_count = headers.list.len;
                                headers.list[header_count].name = trailer_header.name;
                                headers.list[header_count].value = trailer_header.value;

                                // Update the trailer headers count
                                headers.list = headers.list[0 .. header_count + 1];
                            }
                        } else |err| {
                            switch (err) {
                                // If we hit an error parsing the trailer header,
                                // just skip this header and continue
                                error.BadHeaders => {},
                                else => return .Error, // For any other error, fail the chunked decoding
                            }
                        }
                    }
                }

                // Skip the newline and continue to next trailer line
                src += 1;
                decoder.state = .TRAILERS_LINE_HEAD;
            },
        }
    }

    // This shouldn't be reached, but just in case
    copyRemainingData(buf, dst, src, bufsz);
    return .Incomplete;
}

/// Result of parsing a trailer header
pub const TrailerHeader = struct {
    /// Name of the trailer header
    name: []const u8,
    /// Value of the trailer header
    value: []const u8,
};

/// Parse a trailer header line
/// line: The line to parse
/// Returns a TrailerHeader on success, or an error if parsing fails
fn parseTrailerHeader(line: []const u8) HTTPError!TrailerHeader {
    // Skip any leading whitespace or \r
    var pos: usize = 0;
    while (pos < line.len and (line[pos] == ' ' or line[pos] == '\t' or line[pos] == '\r')) {
        pos += 1;
    }

    // If this is an empty line, it's not valid
    if (pos >= line.len) {
        return error.BadHeaders;
    }

    // Check if this is a continuation line (starts with whitespace)
    if (line[0] == ' ' or line[0] == '\t') {
        // Header continuations are a special case, but we don't support
        // them in trailers - would need to return this for appending to previous header
        return error.BadHeaders;
    }

    // Parse header name
    const name_start = pos;
    while (pos < line.len and line[pos] != ':') {
        if (!isTokenChar(line[pos])) {
            return error.BadHeaders;
        }
        pos += 1;
    }

    // We need a colon
    if (pos >= line.len or line[pos] != ':') {
        return error.BadHeaders;
    }

    // Make sure the name is not empty
    if (pos == name_start) {
        return error.BadHeaders;
    }

    const name = line[name_start..pos];
    pos += 1; // Skip colon

    // Skip whitespace before value
    while (pos < line.len and (line[pos] == ' ' or line[pos] == '\t')) {
        pos += 1;
    }

    // Parse value until CR or end of line
    const value_start = pos;
    var value_end = line.len;

    // Find the end of the value by skipping backwards from the end
    // to trim trailing whitespace and CR
    var end_pos = line.len;
    while (end_pos > value_start) {
        const c = line[end_pos - 1];
        if (c != ' ' and c != '\t' and c != '\r') break;
        end_pos -= 1;
    }

    value_end = end_pos;
    const value = line[value_start..value_end];

    return TrailerHeader{
        .name = name,
        .value = value,
    };
}

/// Helper function to copy remaining data and update buffer size
fn copyRemainingData(buf: [*]u8, dst: usize, src: usize, bufsz: *usize) void {
    // Only copy if source and destination are different
    const remaining = bufsz.* - src;
    if (dst != src and remaining > 0) {
        mem.copyForwards(u8, buf[dst..][0..remaining], buf[src..][0..remaining]);
    }
    bufsz.* = dst;
}

// Implementation of Headers parsing
pub fn parseHeadersInternal(buf: []const u8, headers: []Header) HTTPError!HeadersParseResult {
    // Check for minimum viable headers
    if (buf.len < 2) { // Need at least "\r\n" or "\n"
        return error.ShortRead;
    }

    var pos: usize = 0;
    var header_count: usize = 0;

    // Process headers until we find the end (empty line)
    while (pos < buf.len) {
        // Check for end of headers
        if ((pos + 1 < buf.len and buf[pos] == '\r' and buf[pos + 1] == '\n') or
            buf[pos] == '\n')
        {
            // Skip CRLF
            if (buf[pos] == '\r') pos += 2 else pos += 1;

            // End of headers reached
            return HeadersParseResult{
                .bytes_read = @intCast(pos),
                .header_count = header_count,
            };
        }

        // Check for multiline header continuation
        if (header_count > 0 and (buf[pos] == ' ' or buf[pos] == '\t')) {
            // This is a multiline header continuation
            headers[header_count] = .{
                .name = "",
                .value = "",
            };

            // Find value start (skip whitespace)
            var value_start = pos;
            while (value_start < buf.len and (buf[value_start] == ' ' or buf[value_start] == '\t')) {
                value_start += 1;
            }

            // Find end of line
            var value_end = value_start;
            while (value_end < buf.len) {
                if (buf[value_end] == '\r' or buf[value_end] == '\n') break;
                value_end += 1;
            }

            // Make sure we're not at the end
            if (value_end == buf.len) {
                return error.ShortRead;
            }

            // Trim trailing whitespace
            var trim_end = value_end;
            while (trim_end > value_start and (buf[trim_end - 1] == ' ' or buf[trim_end - 1] == '\t')) {
                trim_end -= 1;
            }

            // Set the continuation value
            headers[header_count].value = buf[value_start..trim_end];

            // Skip CRLF
            pos = value_end;
            if (pos < buf.len and buf[pos] == '\r') pos += 1;
            if (pos < buf.len and buf[pos] == '\n') pos += 1;

            header_count += 1;
            continue;
        }

        // Make sure we have room for more headers
        if (header_count >= headers.len) {
            return error.HeadersTooLarge;
        }

        // Parse header name
        const name_start = pos;
        while (pos < buf.len and buf[pos] != ':') {
            if (!isTokenChar(buf[pos])) {
                return error.BadHeaders;
            }
            pos += 1;
        }

        // Make sure we have a colon
        if (pos >= buf.len) {
            return error.ShortRead;
        }

        // Make sure header name is not empty
        if (pos == name_start) {
            return error.BadHeaders;
        }

        // Set the header name
        headers[header_count].name = buf[name_start..pos];

        // Skip colon and whitespace
        pos += 1; // Skip colon
        while (pos < buf.len and (buf[pos] == ' ' or buf[pos] == '\t')) {
            pos += 1;
        }

        // Parse header value until end of line
        const value_start = pos;
        while (pos < buf.len) {
            if (buf[pos] == '\r' or buf[pos] == '\n') break;
            pos += 1;
        }

        // Make sure we're not at the end
        if (pos == buf.len) {
            return error.ShortRead;
        }

        // Trim trailing whitespace
        var value_end = pos;
        while (value_end > value_start and (buf[value_end - 1] == ' ' or buf[value_end - 1] == '\t')) {
            value_end -= 1;
        }

        // Set the header value
        headers[header_count].value = buf[value_start..value_end];

        // Skip CRLF
        if (buf[pos] == '\r') {
            pos += 1;
            if (pos >= buf.len or buf[pos] != '\n') {
                return error.BadHeaders;
            }
        }
        pos += 1; // Skip \n

        header_count += 1;
    }

    // If we get here, we didn't find the end of headers
    return error.ShortRead;
}

// ------------------------------ Internal Helper Functions ------------------------------

/// Check if the HTTP message is complete by looking for the double CRLF/LF
/// that separates headers from body (or indicates end of headers if no body)
/// Returns the position after the end of headers, or null if incomplete
fn isComplete(buf: []const u8) ?usize {
    var empty_line_count: u2 = 0;
    var i: usize = 0;

    while (i < buf.len) {
        if (buf[i] == '\r') {
            i += 1;
            if (i >= buf.len) return null; // Incomplete

            if (buf[i] == '\n') {
                i += 1;
                empty_line_count += 1;
            } else {
                empty_line_count = 0; // Reset counter for malformed input
            }
        } else if (buf[i] == '\n') {
            i += 1;
            empty_line_count += 1;
        } else {
            empty_line_count = 0;
            i += 1;
        }

        // Two empty lines (or a single empty line at the start) indicates
        // the end of headers
        if (empty_line_count == 2) {
            return i;
        }
    }

    return null; // Incomplete
}

// Utility functions

/// Checks if a character is valid in an HTTP token (per RFC 7230)
/// Token characters are: DIGIT / ALPHA / "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
fn isTokenChar(c: u8) bool {
    return switch (c) {
        '0'...'9', 'a'...'z', 'A'...'Z', '!', '#', '$', '%', '&', '\'', '*', '+', '-', '.', '^', '_', '`', '|', '~' => true,
        else => false,
    };
}

/// Decodes a hexadecimal digit to an integer value
/// Returns the decoded value for valid hex digit, or -1 for invalid inputs
fn decodeHex(c: u8) i32 {
    return switch (c) {
        '0'...'9' => @as(i32, c - '0'),
        'a'...'f' => @as(i32, c - 'a' + 10),
        'A'...'F' => @as(i32, c - 'A' + 10),
        else => -1,
    };
}

// ------------------------------ Tests ------------------------------

// Test data for HTTP requests
const test_requests = [_]struct {
    name: []const u8,
    input: []const u8,
    expected_method: []const u8,
    expected_path: []const u8,
    expected_version: HTTPVersion,
    expected_headers_count: usize,
    expected_success: bool,
}{
    .{
        .name = "Basic GET request",
        .input =
        \\GET /index.html HTTP/1.1
        \\Host: example.com
        \\User-Agent: Mozilla/5.0
        \\Accept: text/html
        \\
        \\
        ,
        .expected_method = "GET",
        .expected_path = "/index.html",
        .expected_version = .HTTP_1_1,
        .expected_headers_count = 3,
        .expected_success = true,
    },
    .{
        .name = "Basic POST request",
        .input =
        \\POST /submit HTTP/1.0
        \\Host: example.com
        \\Content-Type: application/x-www-form-urlencoded
        \\Content-Length: 27
        \\
        \\username=test&password=1234
        ,
        .expected_method = "POST",
        .expected_path = "/submit",
        .expected_version = .HTTP_1_0,
        .expected_headers_count = 3,
        .expected_success = true,
    },
    .{
        .name = "Request with no headers",
        .input =
        \\GET / HTTP/1.1
        \\
        \\
        ,
        .expected_method = "GET",
        .expected_path = "/",
        .expected_version = .HTTP_1_1,
        .expected_headers_count = 0,
        .expected_success = true,
    },
    .{
        .name = "Invalid HTTP version",
        .input =
        \\GET / HTTP/2.0
        \\Host: example.com
        \\
        \\
        ,
        .expected_method = "",
        .expected_path = "",
        .expected_version = .HTTP_1_1, // Default but should fail
        .expected_headers_count = 0,
        .expected_success = false,
    },
    .{
        .name = "Missing HTTP version",
        .input =
        \\GET /
        \\Host: example.com
        \\
        \\
        ,
        .expected_method = "",
        .expected_path = "",
        .expected_version = .HTTP_1_1, // Default but should fail
        .expected_headers_count = 0,
        .expected_success = false,
    },
    .{
        .name = "Invalid header name",
        .input =
        \\GET / HTTP/1.1
        \\Host@: example.com
        \\
        \\
        ,
        .expected_method = "",
        .expected_path = "",
        .expected_version = .HTTP_1_1, // Parsed but should fail on headers
        .expected_headers_count = 0,
        .expected_success = false,
    },
    .{
        .name = "Multiline header",
        .input =
        \\GET / HTTP/1.1
        \\User-Agent: Mozilla/5.0
        \\ (Windows NT 10.0; Win64; x64)
        \\Host: example.com
        \\
        \\
        ,
        .expected_method = "GET",
        .expected_path = "/",
        .expected_version = .HTTP_1_1,
        .expected_headers_count = 3, // The multiline is a separate header with empty name
        .expected_success = true,
    },
};

// Test data for HTTP responses
const test_responses = [_]struct {
    name: []const u8,
    input: []const u8,
    expected_version: HTTPVersion,
    expected_status: i32,
    expected_message: []const u8,
    expected_headers_count: usize,
    expected_success: bool,
}{
    .{
        .name = "Basic 200 OK response",
        .input =
        \\HTTP/1.1 200 OK
        \\Content-Type: text/html
        \\Content-Length: 123
        \\Server: Test
        \\
        \\
        ,
        .expected_version = .HTTP_1_1,
        .expected_status = 200,
        .expected_message = "OK",
        .expected_headers_count = 3,
        .expected_success = true,
    },
    .{
        .name = "404 Not Found response",
        .input =
        \\HTTP/1.0 404 Not Found
        \\Content-Type: text/plain
        \\Content-Length: 13
        \\
        \\Page not found
        ,
        .expected_version = .HTTP_1_0,
        .expected_status = 404,
        .expected_message = "Not Found",
        .expected_headers_count = 2,
        .expected_success = true,
    },
    .{
        .name = "Response with no headers",
        .input =
        \\HTTP/1.1 204 No Content
        \\
        \\
        ,
        .expected_version = .HTTP_1_1,
        .expected_status = 204,
        .expected_message = "No Content",
        .expected_headers_count = 0,
        .expected_success = true,
    },
    .{
        .name = "Response with no message",
        .input =
        \\HTTP/1.1 200 
        \\Content-Type: text/plain
        \\
        \\
        ,
        .expected_version = .HTTP_1_1,
        .expected_status = 200,
        .expected_message = "",
        .expected_headers_count = 1,
        .expected_success = true,
    },
    .{
        .name = "Invalid status code",
        .input =
        \\HTTP/1.1 abc OK
        \\Server: Test
        \\
        \\
        ,
        .expected_version = .HTTP_1_1, // Version parsed but should fail on status
        .expected_status = 0,
        .expected_message = "",
        .expected_headers_count = 0,
        .expected_success = false,
    },
    .{
        .name = "Invalid HTTP version",
        .input =
        \\HTTP/3.0 200 OK
        \\Server: Test
        \\
        \\
        ,
        .expected_version = .HTTP_1_1, // Default but should fail
        .expected_status = 0,
        .expected_message = "",
        .expected_headers_count = 0,
        .expected_success = false,
    },
};

// Test data for chunked encoding
const test_chunked_data = [_]struct {
    name: []const u8,
    input: []const u8,
    expected_output: []const u8,
    expected_success: bool,
}{
    .{
        .name = "Basic chunked data",
        .input =
        \\4
        \\Wiki
        \\5
        \\pedia
        \\E
        \\ in
        \\
        \\chunks.
        \\0
        \\
        \\
        ,
        .expected_output = "Wikipedia in\r\n\r\nchunks.",
        .expected_success = true,
    },
    .{
        .name = "Empty chunk",
        .input =
        \\0
        \\
        \\
        ,
        .expected_output = "",
        .expected_success = true,
    },
    .{
        .name = "Single chunk",
        .input =
        \\B
        \\Hello World!
        \\0
        \\
        \\
        ,
        .expected_output = "Hello World!",
        .expected_success = true,
    },
    .{
        .name = "Chunk with extensions",
        .input =
        \\A;extension=value
        \\0123456789
        \\0
        \\
        \\
        ,
        .expected_output = "0123456789",
        .expected_success = true,
    },
    .{
        .name = "Invalid hex digit",
        .input =
        \\X
        \\Invalid
        \\0
        \\
        \\
        ,
        .expected_output = "", // Should fail
        .expected_success = false,
    },
};

test "HTTP parser data-driven tests" {
    // Test HTTP request parsing
    for (test_requests) |test_case| {
        var method: []const u8 = undefined;
        var path: []const u8 = undefined;
        var version: HTTPVersion = undefined;
        var headers: [10]Header = undefined;

        const result = parseRequest(test_case.input, &method, &path, &version, &headers) catch |err| {
            if (test_case.expected_success) {
                // If we expected success but got an error
                std.debug.print("Error parsing request: {}\n", .{err});
                try std.testing.expect(false);
            }
            continue; // Skip to next test case
        };

        // If we got here, parsing succeeded
        if (!test_case.expected_success) {
            // If we expected failure but got success
            std.debug.print("Expected parsing failure, but got success\n", .{});
            try std.testing.expect(false);
            continue;
        }

        // Check results
        try std.testing.expectEqualStrings(test_case.expected_method, method);
        try std.testing.expectEqualStrings(test_case.expected_path, path);
        try std.testing.expectEqual(test_case.expected_version, version);
        try std.testing.expectEqual(test_case.expected_headers_count, result.header_count);
    }

    // Test HTTP response parsing
    for (test_responses) |test_case| {
        var version: HTTPVersion = undefined;
        var status_code: u10 = undefined;
        var status_message: []const u8 = undefined;
        var headers: [10]Header = undefined;

        const result = parseResponse(test_case.input, &version, &status_code, &status_message, &headers) catch |err| {
            if (test_case.expected_success) {
                // If we expected success but got an error
                std.debug.print("Error parsing response: {}\n", .{err});
                try std.testing.expect(false);
            }
            continue; // Skip to next test case
        };

        // If we got here, parsing succeeded
        if (!test_case.expected_success) {
            // If we expected failure but got success
            std.debug.print("Expected parsing failure, but got success\n", .{});
            try std.testing.expect(false);
            continue;
        }

        // Check results
        try std.testing.expectEqual(test_case.expected_version, version);
        try std.testing.expectEqual(@as(u10, @intCast(test_case.expected_status)), status_code);
        try std.testing.expectEqualStrings(test_case.expected_message, status_message);
        try std.testing.expectEqual(test_case.expected_headers_count, result.header_count);
    }
}

test "parseRequest basic" {
    const request =
        \\GET /index.html HTTP/1.1
        \\Host: example.com
        \\User-Agent: Mozilla/5.0
        \\Accept: text/html
        \\
        \\
    ;

    var method: []const u8 = undefined;
    var path: []const u8 = undefined;
    var version: HTTPVersion = undefined;
    var headers: [4]Header = undefined;

    const result = try parseRequest(request, &method, &path, &version, &headers);

    try std.testing.expectEqual(@as(u32, request.len), result.bytes_read);
    try std.testing.expectEqualStrings("GET", method);
    try std.testing.expectEqualStrings("/index.html", path);
    try std.testing.expectEqual(HTTPVersion.HTTP_1_1, version);
    try std.testing.expectEqual(@as(usize, 3), result.header_count);

    try std.testing.expectEqualStrings("Host", headers[0].name);
    try std.testing.expectEqualStrings("example.com", headers[0].value);

    try std.testing.expectEqualStrings("User-Agent", headers[1].name);
    try std.testing.expectEqualStrings("Mozilla/5.0", headers[1].value);

    try std.testing.expectEqualStrings("Accept", headers[2].name);
    try std.testing.expectEqualStrings("text/html", headers[2].value);
}

test "parseResponse basic" {
    const response =
        \\HTTP/1.1 200 OK
        \\Content-Type: text/html
        \\Content-Length: 123
        \\Server: Test
        \\
        \\
    ;

    var version: HTTPVersion = undefined;
    var status_code: u10 = undefined;
    var status_message: []const u8 = undefined;
    var headers: [4]Header = undefined;

    const result = try parseResponse(response, &version, &status_code, &status_message, &headers);

    try std.testing.expectEqual(@as(u32, response.len), result.bytes_read);
    try std.testing.expectEqual(HTTPVersion.HTTP_1_1, version);
    try std.testing.expectEqual(@as(u10, 200), status_code);
    try std.testing.expectEqualStrings("OK", status_message);
    try std.testing.expectEqual(@as(usize, 3), result.header_count);

    try std.testing.expectEqualStrings("Content-Type", headers[0].name);
    try std.testing.expectEqualStrings("text/html", headers[0].value);

    try std.testing.expectEqualStrings("Content-Length", headers[1].name);
    try std.testing.expectEqualStrings("123", headers[1].value);

    try std.testing.expectEqualStrings("Server", headers[2].name);
    try std.testing.expectEqualStrings("Test", headers[2].value);
}

test "parseHeaders basic" {
    const headers_text =
        \\Content-Type: text/html
        \\Content-Length: 123
        \\Server: Test
        \\
        \\
    ;

    var headers: [4]Header = undefined;

    const result = try parseHeaders(headers_text, &headers);

    try std.testing.expectEqual(@as(u32, headers_text.len), result.bytes_read);
    try std.testing.expectEqual(@as(usize, 3), result.header_count);

    try std.testing.expectEqualStrings("Content-Type", headers[0].name);
    try std.testing.expectEqualStrings("text/html", headers[0].value);

    try std.testing.expectEqualStrings("Content-Length", headers[1].name);
    try std.testing.expectEqualStrings("123", headers[1].value);

    try std.testing.expectEqualStrings("Server", headers[2].name);
    try std.testing.expectEqualStrings("Test", headers[2].value);
}

test "Chunked encoding tests" {
    for (test_chunked_data) |test_case| {
        var buf: [1024]u8 = undefined;
        std.mem.copy(u8, &buf, test_case.input);

        var decoder = ChunkedDecoder{};
        var bufsz: usize = test_case.input.len;

        const result = decodeChunked(&decoder, &buf, &bufsz);

        if (test_case.expected_success) {
            try std.testing.expect(result != .Error);
            try std.testing.expectEqualStrings(test_case.expected_output, buf[0..bufsz]);
        } else {
            try std.testing.expect(result == .Error);
        }
    }
}

test "HTTP version parsing" {
    // Test valid versions
    {
        const major: u1 = 1;
        const minor: u2 = 1;
        const version = HTTPVersion.fromMinorVersion(major, minor);
        try std.testing.expectEqual(HTTPVersion.HTTP_1_1, version);
        try std.testing.expectEqualStrings("HTTP/1.1", version.toString());
        try std.testing.expect(version.supportsTrailers());
        try std.testing.expect(version.supportsChunkedEncoding());
    }

    {
        const major: u1 = 1;
        const minor: u2 = 0;
        const version = HTTPVersion.fromMinorVersion(major, minor);
        try std.testing.expectEqual(HTTPVersion.HTTP_1_0, version);
        try std.testing.expectEqualStrings("HTTP/1.0", version.toString());
        try std.testing.expect(!version.supportsTrailers());
        try std.testing.expect(!version.supportsChunkedEncoding());
    }

    {
        const major: u1 = 1;
        const minor: u2 = 2;
        const version = HTTPVersion.fromMinorVersion(major, minor);
        try std.testing.expectEqual(HTTPVersion.HTTP_1_2, version);
        try std.testing.expectEqualStrings("HTTP/1.2", version.toString());
        try std.testing.expect(version.supportsTrailers());
        try std.testing.expect(version.supportsChunkedEncoding());
    }

    {
        const major: u1 = 0;
        const minor: u2 = 0;
        const version = HTTPVersion.fromMinorVersion(major, minor);
        try std.testing.expectEqual(HTTPVersion.HTTP_0_9, version);
        try std.testing.expectEqualStrings("HTTP/0.9", version.toString());
        try std.testing.expect(!version.supportsTrailers());
        try std.testing.expect(!version.supportsChunkedEncoding());
    }
}

test "decodeHex function" {
    // Test valid hex digits
    try std.testing.expectEqual(@as(i32, 0), decodeHex('0'));
    try std.testing.expectEqual(@as(i32, 9), decodeHex('9'));
    try std.testing.expectEqual(@as(i32, 10), decodeHex('a'));
    try std.testing.expectEqual(@as(i32, 15), decodeHex('f'));
    try std.testing.expectEqual(@as(i32, 10), decodeHex('A'));
    try std.testing.expectEqual(@as(i32, 15), decodeHex('F'));

    // Test invalid hex digits
    try std.testing.expectEqual(@as(i32, -1), decodeHex('g'));
    try std.testing.expectEqual(@as(i32, -1), decodeHex('G'));
    try std.testing.expectEqual(@as(i32, -1), decodeHex(' '));
    try std.testing.expectEqual(@as(i32, -1), decodeHex('-'));
}

test "Header edge cases" {
    // Test header with no value
    {
        const headers_text =
            \\X-Empty: 
            \\Content-Type: text/plain
            \\
            \\
        ;

        var headers: [2]Header = undefined;

        const result = try parseHeaders(headers_text, &headers);

        try std.testing.expectEqual(@as(u32, headers_text.len), result.bytes_read);
        try std.testing.expectEqual(@as(usize, 2), result.header_count);
        try std.testing.expectEqualStrings("X-Empty", headers[0].name);
        try std.testing.expectEqualStrings("", headers[0].value);
    }

    // Test header with lots of whitespace
    {
        const headers_text =
            \\X-Whitespace:     lots of spaces     
            \\
            \\
        ;

        var headers: [1]Header = undefined;

        const result = try parseHeaders(headers_text, &headers);

        try std.testing.expectEqual(@as(u32, headers_text.len), result.bytes_read);
        try std.testing.expectEqual(@as(usize, 1), result.header_count);
        try std.testing.expectEqualStrings("X-Whitespace", headers[0].name);
        try std.testing.expectEqualStrings("lots of spaces", headers[0].value);
    }
}

test "Header List get function" {
    var headers: [3]Header = .{
        .{ .name = "Content-Type", .value = "text/plain" },
        .{ .name = "X-Test", .value = "value1" },
        .{ .name = "X-Test", .value = "value2" },
    };

    const header_list = Header.List{ .list = &headers };

    try std.testing.expectEqualStrings("text/plain", header_list.get("content-type") orelse "");
    try std.testing.expectEqualStrings("value1", header_list.get("x-test") orelse "");
    try std.testing.expect(header_list.get("not-found") == null);
}

test "Header List getIfOtherIsAbsent function" {
    var headers: [3]Header = .{
        .{ .name = "Content-Type", .value = "text/plain" },
        .{ .name = "X-Test-1", .value = "value1" },
        .{ .name = "X-Test-2", .value = "value2" },
    };

    const header_list = Header.List{ .list = &headers };

    try std.testing.expectEqualStrings("text/plain", header_list.getIfOtherIsAbsent("content-type", "x-not-present") orelse "");
    try std.testing.expect(header_list.getIfOtherIsAbsent("content-type", "x-test-1") == null);
}

test "isTokenChar function" {
    // Test valid token characters
    try std.testing.expect(isTokenChar('a'));
    try std.testing.expect(isTokenChar('Z'));
    try std.testing.expect(isTokenChar('0'));
    try std.testing.expect(isTokenChar('9'));
    try std.testing.expect(isTokenChar('-'));
    try std.testing.expect(isTokenChar('.'));
    try std.testing.expect(isTokenChar('_'));
    try std.testing.expect(isTokenChar('~'));

    // Test invalid token characters
    try std.testing.expect(!isTokenChar(' '));
    try std.testing.expect(!isTokenChar('\t'));
    try std.testing.expect(!isTokenChar('\r'));
    try std.testing.expect(!isTokenChar('\n'));
    try std.testing.expect(!isTokenChar(':'));
    try std.testing.expect(!isTokenChar(';'));
    try std.testing.expect(!isTokenChar(','));
    try std.testing.expect(!isTokenChar('/'));
    try std.testing.expect(!isTokenChar('\\'));
    try std.testing.expect(!isTokenChar('"'));
    try std.testing.expect(!isTokenChar('('));
    try std.testing.expect(!isTokenChar(')'));
    try std.testing.expect(!isTokenChar('<'));
    try std.testing.expect(!isTokenChar('>'));
    try std.testing.expect(!isTokenChar('@'));
    try std.testing.expect(!isTokenChar('['));
    try std.testing.expect(!isTokenChar(']'));
    try std.testing.expect(!isTokenChar('{'));
    try std.testing.expect(!isTokenChar('}'));
}

// Test robustness against HTTP request smuggling and injection
test "HTTP request smuggling prevention" {
    // Test with CR injection
    const cr_injection =
        \\GET / HTTP/1.1
        \\Host: example.com
        \\X-Injected: test\r
        \\Smuggled: header
        \\
        \\
    ;

    var method: []const u8 = undefined;
    var path: []const u8 = undefined;
    var minor_version: i32 = undefined;
    var headers: [4]Header = undefined;
    var num_headers: usize = 4;

    // Should fail with an error
    const ret = parseRequest(cr_injection, &method, &path, &minor_version, &headers, &num_headers, 0);

    try std.testing.expect(ret < 0);
}

test "HTTP response robustness" {
    // Test with malformed status line
    const malformed_status =
        \\HTTP/1.1 2XX OK
        \\Server: Test
        \\
        \\
    ;

    var minor_version: i32 = undefined;
    var status: i32 = undefined;
    var msg: []const u8 = undefined;
    var headers: [2]Header = undefined;
    var num_headers: usize = 2;

    // Should fail with an error
    const ret = parseResponse(malformed_status, &minor_version, &status, &msg, &headers, &num_headers, 0);

    try std.testing.expect(ret < 0);
}

// Test HTTP version conversion
test "HTTPVersion conversions" {
    try std.testing.expectEqualStrings("HTTP/1.0", HTTPVersion.HTTP_1_0.toString());
    try std.testing.expectEqualStrings("HTTP/1.1", HTTPVersion.HTTP_1_1.toString());

    try std.testing.expectEqual(HTTPVersion.HTTP_1_0, HTTPVersion.fromMinorVersion(0));
    try std.testing.expectEqual(HTTPVersion.HTTP_1_1, HTTPVersion.fromMinorVersion(1));
    try std.testing.expectEqual(HTTPVersion.HTTP_1_1, HTTPVersion.fromMinorVersion(2)); // Default to 1.1 for unknown

    try std.testing.expectEqual(@as(i32, 0), HTTPVersion.HTTP_1_0.toMinorVersion());
    try std.testing.expectEqual(@as(i32, 1), HTTPVersion.HTTP_1_1.toMinorVersion());
}

// Test chunked decoder state functions
test "ChunkedDecoder state functions" {
    var decoder = ChunkedDecoder{};

    try std.testing.expect(!decoder.isInDataState());
    try std.testing.expectEqual(ChunkedDecoder.State.CHUNK_SIZE, decoder.state);

    decoder.state = .CHUNK_DATA;
    try std.testing.expect(decoder.isInDataState());

    decoder.reset();
    try std.testing.expectEqual(ChunkedDecoder.State.CHUNK_SIZE, decoder.state);
    try std.testing.expectEqual(@as(usize, 0), decoder.bytes_left_in_chunk);
    try std.testing.expectEqual(@as(u4, 0), decoder.hex_count);
}

test "Parse trailer header" {
    // Valid simple header
    {
        const line = "Content-Type: text/plain";
        const result = try parseTrailerHeader(line);
        try std.testing.expectEqualStrings("Content-Type", result.name);
        try std.testing.expectEqualStrings("text/plain", result.value);
    }

    // Valid header with whitespace
    {
        const line = "Content-Length:  123  ";
        const result = try parseTrailerHeader(line);
        try std.testing.expectEqualStrings("Content-Length", result.name);
        try std.testing.expectEqualStrings("123", result.value);
    }

    // Valid header with special characters in value
    {
        const line = "X-Custom: value with (parentheses) and [brackets]";
        const result = try parseTrailerHeader(line);
        try std.testing.expectEqualStrings("X-Custom", result.name);
        try std.testing.expectEqualStrings("value with (parentheses) and [brackets]", result.value);
    }

    // Invalid header: no colon
    {
        const line = "InvalidHeader";
        try std.testing.expectError(error.BadHeaders, parseTrailerHeader(line));
    }

    // Invalid header: empty name
    {
        const line = ": value";
        try std.testing.expectError(error.BadHeaders, parseTrailerHeader(line));
    }

    // Invalid header: invalid character in name
    {
        const line = "Invalid@Header: value";
        try std.testing.expectError(error.BadHeaders, parseTrailerHeader(line));
    }

    // Empty line
    {
        const line = "";
        try std.testing.expectError(error.BadHeaders, parseTrailerHeader(line));
    }

    // Whitespace only
    {
        const line = "   ";
        try std.testing.expectError(error.BadHeaders, parseTrailerHeader(line));
    }

    // Continuation line
    {
        const line = " continuation";
        try std.testing.expectError(error.BadHeaders, parseTrailerHeader(line));
    }
}

test "Chunked encoding with trailers" {
    // Test data with chunks and trailers
    const chunked_data_with_trailers =
        \\4
        \\Wiki
        \\5
        \\pedia
        \\0
        \\X-Trailer1: value1
        \\X-Trailer2: value2
        \\
        \\
    ;

    // Copy the test data to a buffer
    var buf: [1024]u8 = undefined;
    std.mem.copy(u8, &buf, chunked_data_with_trailers);

    // Create a headers buffer for trailers
    var trailer_headers: [4]Header = undefined;
    var trailer_list = Header.List{ .list = trailer_headers[0..0] };

    // Setup the chunked decoder with trailer handling
    var decoder = ChunkedDecoder.init(.{
        .collect_trailers = true,
        .trailer_headers = &trailer_list,
    });

    // Decode the chunked data
    var bufsz: usize = chunked_data_with_trailers.len;
    const result = decodeChunked(&decoder, &buf, &bufsz);

    // Check the result
    try std.testing.expectEqual(ChunkedDecodeResult.SuccessWithTrailers, result);
    try std.testing.expectEqualStrings("Wikipedia", buf[0..bufsz]);

    // Check the trailers
    try std.testing.expectEqual(@as(usize, 2), trailer_list.list.len);
    try std.testing.expectEqualStrings("X-Trailer1", trailer_list.list[0].name);
    try std.testing.expectEqualStrings("value1", trailer_list.list[0].value);
    try std.testing.expectEqualStrings("X-Trailer2", trailer_list.list[1].name);
    try std.testing.expectEqualStrings("value2", trailer_list.list[1].value);
}
