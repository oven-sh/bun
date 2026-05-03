//! One in-flight HTTP/3 request. Created when the request is enqueued on a
//! `ClientSession`; the lsquic stream is bound later from
//! `callbacks.onStreamOpen` (lsquic creates streams asynchronously once
//! MAX_STREAMS credit is available). Owned by the session's `pending` list
//! until `ClientSession.detach`.

const Stream = @This();

pub const new = bun.TrivialNew(@This());

session: *ClientSession,
client: ?*HTTPClient,
qstream: ?*quic.Stream = null,

/// Slices into the lsquic-owned hset buffer; valid only for the duration
/// of the `onStreamHeaders` callback that populated it. `cloneMetadata`
/// deep-copies synchronously inside that callback, so nothing reads these
/// after they go stale.
decoded_headers: std.ArrayListUnmanaged(picohttp.Header) = .{},
body_buffer: std.ArrayListUnmanaged(u8) = .{},
status_code: u16 = 0,

pending_body: []const u8 = "",
request_body_done: bool = false,
is_streaming_body: bool = false,
headers_delivered: bool = false,
/// Wire bytes delivered to JS via `deliver()` that haven't been reported
/// drained via `scheduleResponseBodyConsumed`. Once over
/// `receive_body_high_water` we stop `lsquic_stream_wantread` so lsquic
/// withholds `MAX_STREAM_DATA` and the server backpressures.
outstanding_body_bytes: usize = 0,
read_paused: bool = false,

pub fn deinit(this: *Stream) void {
    this.decoded_headers.deinit(bun.default_allocator);
    this.body_buffer.deinit(bun.default_allocator);
    _ = H3.live_streams.fetchSub(1, .monotonic);
    bun.destroy(this);
}

pub fn abort(this: *Stream) void {
    if (this.qstream) |qs| qs.close();
}

const ClientSession = @import("./ClientSession.zig");
const H3 = @import("../H3Client.zig");
const std = @import("std");

const bun = @import("bun");
const HTTPClient = bun.http;
const picohttp = bun.picohttp;
const quic = bun.uws.quic;
