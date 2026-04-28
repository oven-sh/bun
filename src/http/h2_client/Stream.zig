//! One in-flight request on a multiplexed HTTP/2 `ClientSession`. Owned by the
//! session's `streams` map; `client` is a weak back-pointer to the `HTTPClient`
//! that the request belongs to (cleared before any terminal callback so the
//! deliver loop never dereferences a freed client).

pub const new = bun.TrivialNew(@This());

id: u31,
session: *ClientSession,
client: ?*HTTPClient,

/// HEADERS + CONTINUATION fragments, decoded once END_HEADERS arrives.
header_block: std.ArrayListUnmanaged(u8) = .{},
/// DATA payload accumulated across one onData() pass.
body_buffer: std.ArrayListUnmanaged(u8) = .{},

/// HPACK is decoded eagerly at parse time so the dynamic table stays
/// consistent across multiple HEADERS in one read; the resulting strings
/// land here until `deliverStream` hands them to handleResponseMetadata.
decoded_bytes: std.ArrayListUnmanaged(u8) = .{},
decoded_headers: std.ArrayListUnmanaged(picohttp.Header) = .{},
/// Final (non-1xx) status code; 0 until the response HEADERS arrive.
status_code: u32 = 0,

end_stream_received: bool = false,
/// Set once a non-1xx HEADERS block has been decoded and is awaiting
/// delivery. Subsequent HEADERS are trailers and decoded-then-dropped.
headers_ready: bool = false,
headers_end_stream: bool = false,
/// Expect: 100-continue is in effect: hold the request body until a 1xx
/// or final status arrives.
awaiting_continue: bool = false,
/// Set once the END_STREAM flag has been written on the request side.
request_body_done: bool = false,
/// Set once an RST_STREAM has been written *or* received, so the
/// centralised cleanup in onData doesn't emit a redundant one (and never
/// answers an inbound RST with another, per RFC 9113 §5.4.2).
rst_done: bool = false,
fatal_error: ?anyerror = null,
/// DATA bytes consumed since the last WINDOW_UPDATE for this stream.
unacked_bytes: u32 = 0,
/// Σ DATA payload bytes (post-padding) for §8.1.1 Content-Length check —
/// `total_body_received` is clamped at content_length so it can't catch
/// overshoot.
data_bytes_received: u64 = 0,
/// Per-stream send window (server's INITIAL_WINDOW_SIZE plus any
/// WINDOW_UPDATEs minus DATA bytes already framed).
send_window: i32,
/// Unsent suffix of a `.bytes` request body, parked while the send
/// window is exhausted. Borrows from `client.state.request_body`.
pending_body: []const u8 = "",

pub fn deinit(this: *@This()) void {
    _ = H2.live_streams.fetchSub(1, .monotonic);
    this.header_block.deinit(bun.default_allocator);
    this.body_buffer.deinit(bun.default_allocator);
    this.decoded_bytes.deinit(bun.default_allocator);
    this.decoded_headers.deinit(bun.default_allocator);
    bun.destroy(this);
}

pub fn rst(this: *@This(), code: wire.ErrorCode) void {
    if (this.rst_done) return;
    this.rst_done = true;
    var value: u32 = @byteSwap(@intFromEnum(code));
    this.session.writeFrame(.HTTP_FRAME_RST_STREAM, 0, this.id, std.mem.asBytes(&value));
}

const ClientSession = @import("./ClientSession.zig");
const H2 = @import("../H2Client.zig");
const std = @import("std");
const wire = @import("../H2FrameParser.zig");

const bun = @import("bun");
const HTTPClient = bun.http;
const picohttp = bun.picohttp;
