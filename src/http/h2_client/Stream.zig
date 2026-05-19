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

state: State = .open,
/// `.closed` was reached via RST_STREAM (sent or received). Kept distinct
/// from `state` so `rst()` stays idempotent (never answers an inbound RST,
/// per §5.4.2) and so RST(NO_ERROR) can be told apart from a clean close.
rst_done: bool = false,
/// Set once a non-1xx HEADERS block has been decoded and is awaiting
/// delivery. Subsequent HEADERS are trailers and decoded-then-dropped.
headers_ready: bool = false,
headers_end_stream: bool = false,
/// Expect: 100-continue is in effect: hold the request body until a 1xx
/// or final status arrives.
awaiting_continue: bool = false,
fatal_error: ?anyerror = null,
/// DATA bytes received since the last per-stream WINDOW_UPDATE. For
/// consumers without `body_consumption_tracked` set this alone drives the
/// credit; for tracked consumers it is the ceiling on what
/// `consumed_bytes` may release.
unacked_bytes: u32 = 0,
/// Bytes the JS `ReadableStream` reader has actually drained, reported via
/// `scheduleResponseBodyConsumed`. Only consulted when
/// `body_consumption_tracked` is true; `replenishWindow` credits
/// `min(consumed_bytes, unacked_bytes)` so a stalled reader withholds the
/// per-stream window and a compressed body can't over-credit.
consumed_bytes: u32 = 0,
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

/// RFC 9113 §5.1. A `Stream` is created by sending HEADERS, so it starts
/// `.open`; `idle`/`reserved` are never represented as objects. END_STREAM
/// half-closes one side; both, or any RST_STREAM, transitions to `.closed`.
pub const State = enum(u2) {
    open,
    /// We have written END_STREAM; no more DATA may be queued.
    half_closed_local,
    /// Peer has sent END_STREAM; further DATA is STREAM_CLOSED.
    half_closed_remote,
    closed,
};

pub fn deinit(this: *@This()) void {
    _ = H2.live_streams.fetchSub(1, .monotonic);
    this.header_block.deinit(bun.default_allocator);
    this.body_buffer.deinit(bun.default_allocator);
    this.decoded_bytes.deinit(bun.default_allocator);
    this.decoded_headers.deinit(bun.default_allocator);
    bun.destroy(this);
}

pub fn rst(this: *@This(), code: wire.ErrorCode) void {
    if (this.rst_done or this.state == .closed) return;
    this.rst_done = true;
    this.state = .closed;
    var value: u32 = @byteSwap(@intFromEnum(code));
    this.session.writeFrame(.HTTP_FRAME_RST_STREAM, 0, this.id, std.mem.asBytes(&value));
}

pub fn sentEndStream(this: *@This()) void {
    this.state = switch (this.state) {
        .open => .half_closed_local,
        .half_closed_remote => .closed,
        else => this.state,
    };
}

pub fn recvEndStream(this: *@This()) void {
    this.state = switch (this.state) {
        .open => .half_closed_remote,
        .half_closed_local => .closed,
        else => this.state,
    };
}

/// We have sent END_STREAM (or RST): no more request DATA may be queued.
pub inline fn localClosed(this: *const @This()) bool {
    return this.state == .half_closed_local or this.state == .closed;
}

/// Peer has sent END_STREAM (or RST): the response body is complete and
/// further inbound DATA is a protocol error.
pub inline fn remoteClosed(this: *const @This()) bool {
    return this.state == .half_closed_remote or this.state == .closed;
}

const ClientSession = @import("./ClientSession.zig");
const H2 = @import("../H2Client.zig");
const std = @import("std");
const wire = @import("../H2FrameParser.zig");

const bun = @import("bun");
const HTTPClient = bun.http;
const picohttp = bun.picohttp;
