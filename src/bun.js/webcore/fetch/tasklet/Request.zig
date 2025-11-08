const FetchTaskletRequest = @This();
request_body: ?HTTPRequestBody = null,
request_body_streaming_buffer: ?*http.ThreadSafeStreamBuffer = null,

state: enum {
    created,
    enqueued,
    // information_headers,
    headers_sent,
    sending_body, // can be sent with the headers or separately
    // sending_trailer_headers,
    failed,
    done,
} = .created,

pub fn deinit(this: *FetchTaskletRequest) void {
    if (this.request_body) |body| {
        body.detach();
        this.request_body = null;
    }
    if (this.request_body_streaming_buffer) |buffer| {
        this.request_body_streaming_buffer = null;
        buffer.deref();
    }
}

const HTTPRequestBody = @import("HTTPRequestBody.zig").HTTPRequestBody;
const std = @import("std");
const bun = @import("bun");
const http = bun.http;
