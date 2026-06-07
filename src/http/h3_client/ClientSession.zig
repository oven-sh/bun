//! One QUIC connection to an origin. Owns its UDP endpoint via quic.c and
//! multiplexes `Stream`s, each bound 1:1 to an `HTTPClient`. The `qsocket`
//! pointer becomes dangling after `callbacks.onConnClose`, so every accessor
//! checks `closed` first. See `src/http/H3Client.zig` for the module-level
//! overview.

const ClientSession = @This();

pub const new = bun.TrivialNew(@This());

/// Ref holders: the `ClientContext.sessions` registry while listed (1), the
/// `quic.Socket` ext slot while connected (1, transferred from the registry
/// add via `connect`), and one per entry in `pending`. `PendingConnect` holds
/// an extra ref while DNS is in flight.
const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

ref_count: RefCount = .init(),
/// Null while DNS is in flight; set once `us_quic_connect_addr` returns.
qsocket: ?*quic.Socket,
hostname: []const u8,
port: u16,
reject_unauthorized: bool,
handshake_done: bool = false,
closed: bool = false,
registry_index: u32 = std.math.maxInt(u32),

/// Requests waiting for `onStreamOpen` to hand them a stream. Order is
/// FIFO; `lsquic_conn_make_stream` was already called once per entry.
pending: std.ArrayListUnmanaged(*Stream) = .{},

pub fn matches(this: *const ClientSession, hostname: []const u8, port: u16, reject_unauthorized: bool) bool {
    return !this.closed and this.port == port and
        this.reject_unauthorized == reject_unauthorized and
        strings.eqlLong(this.hostname, hostname, true);
}

pub fn hasHeadroom(this: *const ClientSession) bool {
    if (this.closed) return false;
    const qs = this.qsocket orelse return this.pending.items.len < 64;
    // After handshake every pending entry has had make_stream called, so
    // lsquic's n_avail_streams already accounts for them — comparing
    // against pending.len would double-subtract. Before handshake nothing
    // is counted yet, so cap optimistically at the default MAX_STREAMS.
    if (!this.handshake_done) return this.pending.items.len < 64;
    return qs.streamsAvail() > 0;
}

/// Queue `client` for a stream on this connection. The lsquic stream is
/// created asynchronously, so the request goes into `pending` until
/// `onStreamOpen` pops it.
pub fn enqueue(this: *ClientSession, client: *HTTPClient) void {
    bun.debugAssert(!this.closed);
    client.h3 = null;
    client.flags.protocol = .http3;
    client.allow_retry = false;

    const stream = Stream.new(.{ .session = this, .client = client });
    _ = H3.live_streams.fetchAdd(1, .monotonic);
    client.h3 = stream;
    bun.handleOom(this.pending.append(bun.default_allocator, stream));
    this.ref();

    if (this.handshake_done) {
        this.qsocket.?.makeStream();
    }
}

pub fn streamBodyByHttpId(this: *ClientSession, async_http_id: u32, ended: bool) void {
    for (this.pending.items) |stream| {
        const client = stream.client orelse continue;
        if (client.async_http_id != async_http_id) continue;
        if (client.state.original_request_body != .stream) return;
        client.state.original_request_body.stream.ended = ended;
        if (stream.qstream) |qs| encode.drainSendBody(stream, qs);
        return;
    }
}

pub fn detach(this: *ClientSession, stream: *Stream) void {
    if (stream.client) |cl| cl.h3 = null;
    stream.client = null;
    if (stream.qstream) |qs| {
        qs.ext(Stream).* = null;
        // The success path can reach here while the request body is still
        // being written (server responded early). FIN would be a
        // content-length violation; RESET_STREAM(H3_REQUEST_CANCELLED)
        // is the correct "I'm abandoning this send half" so lsquic reaps
        // the stream instead of leaking it on the pooled session.
        if (!stream.request_body_done) qs.reset();
    }
    stream.qstream = null;
    if (std.mem.indexOfScalar(*Stream, this.pending.items, stream)) |i| {
        _ = this.pending.orderedRemove(i);
    }
    stream.deinit();
    this.deref();
}

pub fn fail(this: *ClientSession, stream: *Stream, err: anyerror) void {
    const client = stream.client;
    stream.abort();
    this.detach(stream);
    if (client) |cl| cl.failFromH2(err);
}

/// A stream closed before any response headers arrived. If the request
/// hasn't been retried yet and the body wasn't a JS stream (which may
/// already be consumed), re-enqueue it on a fresh session — this is the
/// standard h2/h3 client behavior for the GOAWAY / stateless-reset /
/// port-reuse race where a pooled session goes stale between the
/// `matches()` check and the first stream open.
pub fn retryOrFail(this: *ClientSession, stream: *Stream, err: anyerror) void {
    const client = stream.client orelse return this.fail(stream, err);
    if (client.flags.h3_retried or stream.is_streaming_body) {
        return this.fail(stream, err);
    }
    const ctx = ClientContext.get() orelse return this.fail(stream, err);
    client.flags.h3_retried = true;
    // The old session is dead from our perspective; make sure connect()
    // can't pick it again.
    this.closed = true;
    const port = this.port;
    const host = bun.handleOom(bun.default_allocator.dupe(u8, this.hostname));
    defer bun.default_allocator.free(host);
    log("retry {s}:{d} after {s}", .{ host, port, @errorName(err) });
    stream.abort();
    this.detach(stream);
    if (!ctx.connect(client, host, port)) {
        client.failFromH2(err);
    }
}

pub fn abortByHttpId(this: *ClientSession, async_http_id: u32) bool {
    for (this.pending.items) |stream| {
        const cl = stream.client orelse continue;
        if (cl.async_http_id == async_http_id) {
            this.fail(stream, error.Aborted);
            return true;
        }
    }
    return false;
}

/// Runs from inside lsquic's process_conns via on_stream_{headers,data,close}.
/// `done` = the lsquic stream is gone; deliver whatever is buffered then
/// detach. Mirrors H2's `ClientSession.deliverStream` so the HTTPClient state
/// machine sees the same call sequence regardless of transport.
pub fn deliver(this: *ClientSession, stream: *Stream, done: bool) void {
    const client = stream.client orelse {
        if (done) this.detach(stream);
        return;
    };

    if (client.signals.get(.aborted)) {
        return this.fail(stream, error.Aborted);
    }

    if (stream.status_code != 0 and !stream.headers_delivered) {
        stream.headers_delivered = true;
        const result = this.applyHeaders(stream, client) catch |err| {
            return this.fail(stream, err);
        };
        if (result == .finished or (done and stream.body_buffer.items.len == 0)) {
            if (client.state.flags.is_redirect_pending) {
                this.detach(stream);
                return client.doRedirectH3();
            }
            client.cloneMetadata();
            client.state.flags.received_last_chunk = true;
            if (result == .finished) client.state.content_length = 0;
            this.detach(stream);
            return finish(client);
        }
        client.cloneMetadata();
        if (client.signals.get(.header_progress)) client.progressUpdateH3();
    }

    if (client.state.response_stage != .body) {
        if (done) {
            // Stream closed before headers — handshake/reset failure.
            return this.retryOrFail(stream, if (stream.status_code == 0)
                error.HTTP3StreamReset
            else
                error.ConnectionClosed);
        }
        return;
    }

    if (stream.body_buffer.items.len > 0) {
        if (done) {
            client.state.flags.received_last_chunk = true;
        }
        const report = client.handleResponseBody(stream.body_buffer.items, false) catch |err| {
            stream.body_buffer.clearRetainingCapacity();
            return this.fail(stream, err);
        };
        stream.body_buffer.clearRetainingCapacity();
        if (done) {
            this.detach(stream);
            return finish(client);
        }
        if (report) {
            if (client.state.isDone()) {
                this.detach(stream);
                return client.progressUpdateH3();
            }
            client.progressUpdateH3();
        }
        return;
    }

    if (done) {
        this.detach(stream);
        client.state.flags.received_last_chunk = true;
        return finish(client);
    }
}

fn applyHeaders(_: *ClientSession, stream: *Stream, client: *HTTPClient) !HeaderResult {
    var response = picohttp.Response{
        .minor_version = 0,
        .status_code = stream.status_code,
        .status = "",
        .headers = .{ .list = stream.decoded_headers.items },
        .bytes_read = 0,
    };
    client.state.pending_response = response;
    const should_continue = try client.handleResponseMetadata(&response);
    client.state.pending_response = response;
    client.state.transfer_encoding = .identity;
    if (client.state.response_stage == .body_chunk) client.state.response_stage = .body;
    client.state.flags.allow_keepalive = true;
    return if (should_continue == .finished) .finished else .has_body;
}

fn finish(client: *HTTPClient) void {
    if (client.state.content_length) |cl| {
        if (client.state.total_body_received != cl) {
            return client.failFromH2(error.HTTP3ContentLengthMismatch);
        }
    }
    client.progressUpdateH3();
}

fn deinit(this: *ClientSession) void {
    bun.debugAssert(this.pending.items.len == 0);
    this.pending.deinit(bun.default_allocator);
    bun.default_allocator.free(this.hostname);
    bun.destroy(this);
}

const HeaderResult = enum { has_body, finished };

const log = bun.Output.scoped(.h3_client, .hidden);

const ClientContext = @import("./ClientContext.zig");
const H3 = @import("../H3Client.zig");
const Stream = @import("./Stream.zig");
const encode = @import("./encode.zig");
const std = @import("std");

const bun = @import("bun");
const HTTPClient = bun.http;
const picohttp = bun.picohttp;
const strings = bun.strings;
const quic = bun.uws.quic;
