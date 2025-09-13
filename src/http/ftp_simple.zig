const std = @import("std");
const bun = @import("../bun.zig");
const AsyncHTTP = @import("./AsyncHTTP.zig");
const HTTPClient = @import("../http.zig");
const HTTPClientResult = HTTPClient.HTTPClientResult;
const URL = @import("../url.zig").URL;
const Output = bun.Output;

const log = Output.scoped(.ftp, .visible);

pub fn handleFTPRequest(async_http: *AsyncHTTP) !void {
    const allocator = async_http.allocator;
    const url = async_http.url;

    // For now, create a simple error response for FTP URLs
    // This allows fetch() to accept FTP URLs without crashing
    log("FTP request for URL: {s}", .{url.href});

    // Initialize response buffer if needed
    if (async_http.response_buffer.list.capacity == 0) {
        async_http.response_buffer.allocator = allocator;
    }

    // For now, return a simple test response
    const test_response = "FTP support is being implemented";
    _ = try async_http.response_buffer.append(test_response);

    // Create metadata
    const metadata = HTTPClient.HTTPResponseMetadata{
        .url = url.href,
        .response = .{
            .status = "200",
            .status_code = 200,
        },
    };

    // Create result
    const result = HTTPClientResult{
        .body = async_http.response_buffer,
        .metadata = metadata,
        .body_size = .{ .content_length = test_response.len },
    };

    // Send callback
    async_http.result_callback.run(async_http, result);
}