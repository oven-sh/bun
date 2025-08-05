const HTTP2Integration = @This();

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const HTTPClient = bun.http;
const HTTP2Client = @import("HTTP2Client.zig");
const AsyncHTTP = @import("AsyncHTTP.zig");
const HTTPThread = bun.http.http_thread;
const URL = bun.URL;
const Method = bun.http.Method;
const Headers = bun.http.Headers;
const HTTPRequestBody = HTTPClient.HTTPRequestBody;
const HTTPClientResult = HTTPClient.HTTPClientResult;
const FetchRedirect = HTTPClient.FetchRedirect;
const MutableString = bun.MutableString;

const log = bun.Output.scoped(.HTTP2Integration, false);

// HTTP/2 capability detection flags
pub const HTTP2Capability = enum {
    unknown,
    supported,
    not_supported,
    forced_http2,
    forced_http1,
};

// Enhanced HTTP client that can handle both HTTP/1.1 and HTTP/2
pub const EnhancedHTTPClient = struct {
    base_client: HTTPClient = undefined,
    http2_client: ?HTTP2Client = null,
    http2_capability: HTTP2Capability = .unknown,
    force_http2: bool = false,
    force_http1: bool = false,

    const Self = @This();

    pub fn init(
        allocator: std.mem.Allocator,
        method: Method,
        url: URL,
        headers: Headers.Entry.List,
        header_buf: []const u8,
        body: HTTPRequestBody,
        response_buffer: *MutableString,
        callback: HTTPClientResult.Callback,
        redirect_type: FetchRedirect,
        options: struct {
            force_http2: bool = false,
            force_http1: bool = false,
            http_proxy: ?URL = null,
            hostname: ?[]u8 = null,
            signals: ?bun.http.Signals = null,
            unix_socket_path: ?bun.jsc.ZigString.Slice = null,
            disable_timeout: ?bool = null,
            verbose: ?bun.http.HTTPVerboseLevel = null,
            disable_keepalive: ?bool = null,
            disable_decompression: ?bool = null,
            reject_unauthorized: ?bool = null,
            tls_props: ?*bun.api.server.ServerConfig.SSLConfig = null,
        },
    ) !Self {
        var self = Self{
            .force_http2 = options.force_http2,
            .force_http1 = options.force_http1,
            .http2_capability = if (options.force_http2) .forced_http2 else if (options.force_http1) .forced_http1 else .unknown,
        };

        // Determine protocol to use
        const should_try_http2 = self.shouldTryHTTP2(url);

        if (should_try_http2) {
            log("Attempting HTTP/2 connection for {s}", .{url.href});

            // Initialize HTTP/2 client
            self.http2_client = try HTTP2Client.init(
                allocator,
                method,
                url,
                headers,
                header_buf,
                body,
                response_buffer,
                callback,
                redirect_type,
            );

            // Set HTTP/2 specific options
            if (options.http_proxy) |proxy| self.http2_client.?.http_proxy = proxy;
            if (options.verbose) |v| self.http2_client.?.verbose = v;
            if (options.disable_timeout) |dt| self.http2_client.?.flags.disable_timeout = dt;
            if (options.disable_keepalive) |dk| self.http2_client.?.flags.disable_keepalive = dk;
            if (options.disable_decompression) |dd| self.http2_client.?.flags.disable_decompression = dd;
            if (options.reject_unauthorized) |ru| self.http2_client.?.flags.reject_unauthorized = ru;
            if (options.tls_props) |tls| self.http2_client.?.tls_props = tls;
        } else {
            log("Using HTTP/1.1 connection for {s}", .{url.href});

            // Initialize traditional HTTP/1.1 client
            self.base_client = HTTPClient{
                .allocator = allocator,
                .method = method,
                .url = url,
                .header_entries = headers,
                .header_buf = header_buf,
                .hostname = options.hostname,
                .signals = options.signals orelse .{},
                .http_proxy = options.http_proxy,
                .unix_socket_path = options.unix_socket_path orelse jsc.ZigString.Slice.empty,
            };

            // Set HTTP/1.1 options
            if (options.http_proxy) |proxy| self.base_client.http_proxy = proxy;
            if (options.hostname) |h| self.base_client.hostname = h;
            if (options.signals) |s| self.base_client.signals = s;
            if (options.unix_socket_path) |usp| self.base_client.unix_socket_path = usp;
            if (options.disable_timeout) |dt| self.base_client.flags.disable_timeout = dt;
            if (options.verbose) |v| self.base_client.verbose = v;
            if (options.disable_decompression) |dd| self.base_client.flags.disable_decompression = dd;
            if (options.disable_keepalive) |dk| self.base_client.flags.disable_keepalive = dk;
            if (options.reject_unauthorized) |ru| self.base_client.flags.reject_unauthorized = ru;
            if (options.tls_props) |tls| self.base_client.tls_props = tls;

            self.base_client.redirect_type = redirect_type;
            self.base_client.result_callback = callback;
        }

        return self;
    }

    pub fn start(self: *Self, body: HTTPRequestBody, response_buffer: *MutableString) void {
        if (self.http2_client) |*h2_client| {
            h2_client.start(body, response_buffer);
        } else {
            self.base_client.start(body, response_buffer);
        }
    }

    pub fn deinit(self: *Self) void {
        if (self.http2_client) |*h2_client| {
            h2_client.deinit();
        } else {
            self.base_client.deinit();
        }
    }

    fn shouldTryHTTP2(self: *Self, url: URL) bool {
        // Force HTTP/2 if explicitly requested
        if (self.force_http2) {
            return true;
        }

        // Don't use HTTP/2 if explicitly disabled
        if (self.force_http1) {
            return false;
        }

        // Only try HTTP/2 for HTTPS connections
        if (!url.isHTTPS()) {
            return false;
        }

        // Try HTTP/2 for HTTPS by default
        // ALPN negotiation will determine the final protocol
        return true;
    }

    pub fn onHTTP2Fallback(self: *Self, allocator: std.mem.Allocator, callback: HTTPClientResult.Callback) !void {
        log("Falling back to HTTP/1.1 from HTTP/2", .{});

        // Clean up HTTP/2 client
        if (self.http2_client) |*h2_client| {
            const url = h2_client.url;
            const method = h2_client.method;
            const headers = h2_client.headers;
            const response_buffer = h2_client.response_buffer;
            const redirect_type = h2_client.redirect_type;

            // Reconstruct header buffer from headers
            var header_buf = std.ArrayList(u8).init(allocator);
            defer header_buf.deinit();

            var headers_iter = headers.iterator();
            while (headers_iter.next()) |header| {
                try header_buf.appendSlice(header.name.slice());
                try header_buf.appendSlice(": ");
                try header_buf.appendSlice(header.value.slice());
                try header_buf.appendSlice("\r\n");
            }

            const reconstructed_header_buf = try allocator.dupe(u8, header_buf.items);

            h2_client.deinit();
            self.http2_client = null;

            // Initialize HTTP/1.1 client with reconstructed headers
            self.base_client = try HTTPClient.init(
                allocator,
                method,
                url,
                headers,
                reconstructed_header_buf,
                false, // not aborted
            );

            self.base_client.redirect_type = redirect_type;
            self.base_client.result_callback = callback;
            self.http2_capability = .not_supported;

            // Restart with HTTP/1.1
            self.base_client.start(.{ .bytes = "" }, response_buffer);
        }
    }
};

// Integration with AsyncHTTP for backward compatibility
pub fn createEnhancedAsyncHTTP(
    allocator: std.mem.Allocator,
    method: Method,
    url: URL,
    headers: Headers.Entry.List,
    headers_buf: []const u8,
    response_buffer: *MutableString,
    request_body: []const u8,
    callback: HTTPClientResult.Callback,
    redirect_type: FetchRedirect,
    options: AsyncHTTP.Options,
) !AsyncHTTP {
    // Check if we should attempt HTTP/2
    const force_http2 = options.verbose != null and options.verbose.? == .headers; // Temporary flag
    const should_try_http2 = url.isHTTPS() and !force_http2;

    if (should_try_http2) {
        // Create a custom AsyncHTTP that uses HTTP/2 internally
        const async_http = AsyncHTTP.init(
            allocator,
            method,
            url,
            headers,
            headers_buf,
            response_buffer,
            request_body,
            callback,
            redirect_type,
            options,
        );

        // Mark this as an HTTP/2 enhanced client
        // This would require extending AsyncHTTP structure
        return async_http;
    } else {
        // Use standard HTTP/1.1 AsyncHTTP
        return AsyncHTTP.init(
            allocator,
            method,
            url,
            headers,
            headers_buf,
            response_buffer,
            request_body,
            callback,
            redirect_type,
            options,
        );
    }
}

// Helper function to detect HTTP/2 support from server response
pub fn detectHTTP2Support(response_headers: []const bun.picohttp.Header) HTTP2Capability {
    for (response_headers) |header| {
        if (std.ascii.eqlIgnoreCase(header.name, "upgrade")) {
            if (std.mem.indexOf(u8, header.value, "h2c") != null) {
                return .supported;
            }
        }
        if (std.ascii.eqlIgnoreCase(header.name, "alt-svc")) {
            if (std.mem.indexOf(u8, header.value, "h2=") != null) {
                return .supported;
            }
        }
    }
    return .unknown;
}

// Export for use in other modules
pub const HTTP2EnhancedClient = EnhancedHTTPClient;
