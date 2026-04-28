//! HTTP/3 client over lsquic via packages/bun-usockets/src/quic.c.
//!
//! One `ClientContext` per HTTP-thread loop wraps the lsquic client engine;
//! each `ClientSession` is one QUIC connection to an origin and multiplexes
//! `Stream`s, each bound 1:1 to an `HTTPClient`. The result-delivery surface
//! is the same one H2 uses (`handleResponseMetadata` / `handleResponseBody` /
//! `progressUpdateH3`), so redirect, decompression, and FetchTasklet plumbing
//! are shared with HTTP/1.1.

/// One in-flight request. Created when the request is enqueued; the lsquic
/// stream is bound later from `onStreamOpen` (lsquic creates streams
/// asynchronously once MAX_STREAMS credit is available).
pub const Stream = struct {
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

    pub fn deinit(this: *Stream) void {
        this.decoded_headers.deinit(bun.default_allocator);
        this.body_buffer.deinit(bun.default_allocator);
        _ = live_streams.fetchSub(1, .monotonic);
        bun.destroy(this);
    }

    pub fn abort(this: *Stream) void {
        if (this.qstream) |qs| qs.close();
    }
};

/// One QUIC connection. Owns its UDP endpoint via quic.c; the `qsocket`
/// pointer becomes dangling after `onConnClose`, so every accessor checks
/// `closed` first.
pub const ClientSession = struct {
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

    pub const new = bun.TrivialNew(@This());
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

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
        _ = live_streams.fetchAdd(1, .monotonic);
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
            if (stream.qstream) |qs| drainSendBody(stream, qs);
            return;
        }
    }

    pub fn detach(this: *ClientSession, stream: *Stream) void {
        if (stream.client) |cl| cl.h3 = null;
        stream.client = null;
        if (stream.qstream) |qs| qs.ext(Stream).* = null;
        stream.qstream = null;
        if (std.mem.indexOfScalar(*Stream, this.pending.items, stream)) |i| {
            _ = this.pending.orderedRemove(i);
        }
        stream.deinit();
        this.deref();
    }

    fn fail(this: *ClientSession, stream: *Stream, err: anyerror) void {
        const client = stream.client;
        stream.abort();
        this.detach(stream);
        if (client) |cl| cl.failFromH2(err);
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

    fn writeRequest(this: *ClientSession, stream: *Stream, qs: *quic.Stream) !void {
        const client = stream.client orelse return error.Aborted;
        const request = client.buildRequest(client.state.original_request_body.len());
        if (client.verbose != .none) {
            HTTPClient.printRequest(.http3, request, client.url.href, !client.flags.reject_unauthorized, client.state.request_body, client.verbose == .curl);
        }

        var sfa = std.heap.stackFallback(2048, bun.default_allocator);
        const alloc = sfa.get();
        var headers: std.ArrayListUnmanaged(quic.Header) = .{};
        defer headers.deinit(alloc);
        try headers.ensureTotalCapacityPrecise(alloc, request.headers.len + 4);

        // Names not in the QPACK static table get lowercased into one
        // pre-sized buffer so the pointers stay stable across the batch.
        var name_bytes: usize = 0;
        for (request.headers) |h| name_bytes += h.name.len;
        const lower = try alloc.alloc(u8, name_bytes);
        defer alloc.free(lower);
        var lower_len: usize = 0;

        var authority: []const u8 = client.url.host;
        headers.items.len = 4;
        for (request.headers) |h| {
            if (quic.Qpack.classify(h.name)) |class| switch (class) {
                .forbidden => {},
                .host => authority = h.value,
                .indexed => |i| headers.appendAssumeCapacity(.init(i.name, h.value, i.index)),
            } else {
                const dst = lower[lower_len..][0..h.name.len];
                _ = strings.copyLowercase(h.name, dst);
                lower_len += h.name.len;
                headers.appendAssumeCapacity(.init(dst, h.value, null));
            }
        }
        if (authority.len == 0) authority = this.hostname;
        headers.items[0] = .init(":method", request.method, .method_get);
        headers.items[1] = .init(":scheme", "https", .scheme_https);
        headers.items[2] = .init(":authority", authority, .authority);
        headers.items[3] = .init(":path", if (request.path.len > 0) request.path else "/", .path);

        const body = client.state.request_body;
        const has_inline_body = client.state.original_request_body == .bytes and body.len > 0;
        const is_streaming = client.state.original_request_body == .stream;

        const end_stream = !has_inline_body and !is_streaming;
        if (qs.sendHeaders(headers.items, end_stream) != 0) {
            return error.HTTP3HeaderEncodingError;
        }

        if (has_inline_body) {
            stream.pending_body = body;
            drainSendBody(stream, qs);
        } else if (is_streaming) {
            stream.is_streaming_body = true;
            drainSendBody(stream, qs);
        } else {
            stream.request_body_done = true;
        }

        client.state.request_stage = if (stream.request_body_done) .done else .body;
        client.state.response_stage = .headers;

        // For streaming bodies the JS sink waits for can_stream to start
        // pumping; report progress now so it begins.
        if (is_streaming) client.progressUpdateH3();
    }

    fn drainSendBody(stream: *Stream, qs: *quic.Stream) void {
        if (stream.request_body_done) return;
        const client = stream.client orelse return;

        if (stream.is_streaming_body) {
            const body = &client.state.original_request_body.stream;
            const sb = body.buffer orelse return;
            const buffer = sb.acquire();
            const data = buffer.slice();
            var written: usize = 0;
            while (written < data.len) {
                const w = qs.write(data[written..]);
                if (w <= 0) break;
                written += @intCast(w);
            }
            buffer.cursor += written;
            const drained = buffer.isEmpty();
            if (drained) buffer.reset();
            if (drained and body.ended) {
                stream.request_body_done = true;
                qs.shutdown();
                client.state.request_stage = .done;
            } else if (!drained) {
                qs.wantWrite(true);
            } else if (data.len > 0) {
                sb.reportDrain();
            }
            sb.release();
            if (stream.request_body_done) body.detach();
            return;
        }

        while (stream.pending_body.len > 0) {
            const w = qs.write(stream.pending_body);
            if (w <= 0) break;
            stream.pending_body = stream.pending_body[@intCast(w)..];
        }
        if (stream.pending_body.len == 0) {
            stream.request_body_done = true;
            qs.shutdown();
            client.state.request_stage = .done;
        } else {
            qs.wantWrite(true);
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

    /// Runs from inside lsquic's process_conns via on_stream_{headers,data,close}.
    /// `done` = the lsquic stream is gone; deliver whatever is buffered then
    /// detach. Mirrors H2Client.deliverStream so the HTTPClient state machine
    /// sees the same call sequence regardless of transport.
    fn deliver(this: *ClientSession, stream: *Stream, done: bool) void {
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
                return this.fail(stream, if (stream.status_code == 0)
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
};

const HeaderResult = enum { has_body, finished };

/// Process-global lazily-initialised on the HTTP thread. Owns the lsquic
/// client engine and the live-session registry. Never freed — the engine
/// lives for the process, same as the HTTP thread itself.
pub const ClientContext = struct {
    qctx: *quic.Context,
    sessions: std.ArrayListUnmanaged(*ClientSession) = .{},

    /// One instance per HTTP-thread loop. Stored as a process global only
    /// because `bun.http.http_thread` is itself a process singleton — the
    /// underlying lsquic engine is bound to the `loop` passed to
    /// `quic.Context.createClient` (it lives on `loop->data.quic_head` and is
    /// driven by that loop's pre/post hooks), so a second loop would get its
    /// own engine; this var would just need to become per-loop storage.
    var instance: ?*ClientContext = null;
    var lsquic_init_once = bun.once(quic.globalInit);

    pub fn get() ?*ClientContext {
        return instance;
    }

    pub fn getOrCreate(loop: *uws.Loop) ?*ClientContext {
        if (instance) |i| return i;
        lsquic_init_once.call(.{});
        const qctx = quic.Context.createClient(
            loop,
            0,
            @sizeOf(*ClientSession),
            @sizeOf(*Stream),
        ) orelse return null;
        qctx.onHskDone(onHskDone);
        qctx.onGoaway(onGoaway);
        qctx.onClose(onConnClose);
        qctx.onStreamOpen(onStreamOpen);
        qctx.onStreamHeaders(onStreamHeaders);
        qctx.onStreamData(onStreamData);
        qctx.onStreamWritable(onStreamWritable);
        qctx.onStreamClose(onStreamClose);

        const self = bun.handleOom(bun.default_allocator.create(ClientContext));
        self.* = .{ .qctx = qctx };
        instance = self;
        return self;
    }

    /// Find or open a connection to `hostname:port` and queue `client` on it.
    pub fn connect(this: *ClientContext, client: *HTTPClient, hostname: []const u8, port: u16) bool {
        const reject = client.flags.reject_unauthorized;
        for (this.sessions.items) |s| {
            if (s.matches(hostname, port, reject) and s.hasHeadroom()) {
                log("reuse session {s}:{d}", .{ hostname, port });
                s.enqueue(client);
                return true;
            }
        }

        const host_z = bun.handleOom(bun.default_allocator.dupeZ(u8, hostname));
        const session = ClientSession.new(.{
            .qsocket = null,
            .hostname = host_z,
            .port = port,
            .reject_unauthorized = reject,
        });
        _ = live_sessions.fetchAdd(1, .monotonic);
        session.registry_index = @intCast(this.sessions.items.len);
        bun.handleOom(this.sessions.append(bun.default_allocator, session));
        session.enqueue(client);

        switch (this.qctx.connect(host_z.ptr, port, host_z.ptr, reject, session)) {
            .socket => |qs| {
                session.qsocket = qs;
                qs.ext(ClientSession).* = session;
                log("connect {s}:{d} (sync)", .{ hostname, port });
            },
            .pending => |pending| {
                log("connect {s}:{d} (dns pending)", .{ hostname, port });
                PendingConnect.register(session, pending, this.qctx.loop());
            },
            .err => {
                log("connect {s}:{d} failed", .{ hostname, port });
                this.unregister(session);
                PendingConnect.failSession(session, error.ConnectionRefused);
                return false;
            },
        }
        return true;
    }

    pub fn unregister(this: *ClientContext, session: *ClientSession) void {
        const i = session.registry_index;
        if (i >= this.sessions.items.len or this.sessions.items[i] != session) return;
        _ = this.sessions.swapRemove(i);
        if (i < this.sessions.items.len) this.sessions.items[i].registry_index = i;
        session.registry_index = std.math.maxInt(u32);
    }

    pub fn abortByHttpId(async_http_id: u32) bool {
        const this = instance orelse return false;
        for (this.sessions.items) |s| {
            if (s.abortByHttpId(async_http_id)) return true;
        }
        return false;
    }

    pub fn streamBodyByHttpId(async_http_id: u32, ended: bool) void {
        const this = instance orelse return;
        for (this.sessions.items) |s| s.streamBodyByHttpId(async_http_id, ended);
    }
};

pub const PendingConnect = @import("./h3/PendingConnect.zig");

// ───── lsquic → Zig callbacks ─────

fn onHskDone(qs: *quic.Socket, ok: c_int) callconv(.c) void {
    const session = qs.ext(ClientSession).* orelse return;
    log("hsk_done ok={d} pending={d}", .{ ok, session.pending.items.len });
    if (ok == 0) {
        session.closed = true;
        return;
    }
    session.handshake_done = true;
    for (session.pending.items) |_| qs.makeStream();
}

/// Peer sent GOAWAY: this connection won't accept new streams (RFC 9114
/// §5.2). Mark the session unusable now so the next `connect()` opens a fresh
/// one instead of waiting for `onConnClose`, which only fires after lsquic's
/// draining period. Stay in the registry so abort/body-chunk lookups still
/// reach in-flight streams; `onConnClose` does the actual unregister/deref.
fn onGoaway(qs: *quic.Socket) callconv(.c) void {
    const session = qs.ext(ClientSession).* orelse return;
    log("goaway {s}:{d}", .{ session.hostname, session.port });
    session.closed = true;
}

fn onConnClose(qs: *quic.Socket) callconv(.c) void {
    const session = qs.ext(ClientSession).* orelse return;
    session.closed = true;
    session.qsocket = null;
    var buf: [256]u8 = undefined;
    const st = qs.status(&buf);
    log("conn_close status={d} {s}", .{ st, std.mem.sliceTo(&buf, 0) });
    if (ClientContext.instance) |ctx| ctx.unregister(session);
    // Fail anything still waiting on a stream. Streams that already have a
    // qstream get their own onStreamClose.
    var i: usize = 0;
    while (i < session.pending.items.len) {
        const stream = session.pending.items[i];
        if (stream.qstream != null) {
            i += 1;
            continue;
        }
        const client = stream.client;
        session.detach(stream);
        if (client) |cl| cl.failFromH2(if (session.handshake_done)
            error.ConnectionClosed
        else
            error.HTTP3HandshakeFailed);
    }
    _ = live_sessions.fetchSub(1, .monotonic);
    session.deref();
}

fn onStreamOpen(s: *quic.Stream, is_client: c_int) callconv(.c) void {
    s.ext(Stream).* = null;
    if (is_client == 0) return;
    const qs = s.socket() orelse return;
    const session = qs.ext(ClientSession).* orelse {
        s.close();
        return;
    };
    // Bind the next pending request to this stream.
    const stream: *Stream = for (session.pending.items) |st| {
        if (st.qstream == null) break st;
    } else {
        s.close();
        return;
    };
    stream.qstream = s;
    s.ext(Stream).* = stream;
    log("stream_open", .{});
    session.writeRequest(stream, s) catch |err| {
        session.fail(stream, err);
    };
}

fn onStreamHeaders(s: *quic.Stream) callconv(.c) void {
    const stream = s.ext(Stream).* orelse return;
    const n = s.headerCount();

    stream.decoded_headers.clearRetainingCapacity();
    bun.handleOom(stream.decoded_headers.ensureTotalCapacity(bun.default_allocator, n));
    var status: u16 = 0;
    var i: c_uint = 0;
    while (i < n) : (i += 1) {
        const h = s.header(i) orelse continue;
        const name = h.name[0..h.name_len];
        const value = h.value[0..h.value_len];
        if (strings.hasPrefixComptime(name, ":")) {
            if (strings.eqlComptime(name, ":status")) {
                status = std.fmt.parseInt(u16, value, 10) catch 0;
            }
            continue;
        }
        stream.decoded_headers.appendAssumeCapacity(.{ .name = name, .value = value });
    }
    if (status == 0) {
        // A second HEADERS block after the final response is trailers
        // (RFC 9114 §4.1) and carries no :status; ignore it rather than
        // treating the stream as malformed.
        if (stream.status_code != 0) return;
        stream.session.fail(stream, error.HTTP3ProtocolError);
        return;
    }
    if (status >= 100 and status < 200) return;
    stream.status_code = status;
    stream.session.deliver(stream, false);
}

fn onStreamData(s: *quic.Stream, data: [*]const u8, len: c_uint, fin: c_int) callconv(.c) void {
    const stream = s.ext(Stream).* orelse return;
    if (len > 0) {
        bun.handleOom(stream.body_buffer.appendSlice(bun.default_allocator, data[0..len]));
    }
    stream.session.deliver(stream, fin != 0);
}

fn onStreamWritable(s: *quic.Stream) callconv(.c) void {
    const stream = s.ext(Stream).* orelse return;
    ClientSession.drainSendBody(stream, s);
}

fn onStreamClose(s: *quic.Stream) callconv(.c) void {
    const stream = s.ext(Stream).* orelse return;
    s.ext(Stream).* = null;
    stream.qstream = null;
    log("stream_close status={d} delivered={}", .{ stream.status_code, stream.headers_delivered });
    stream.session.deliver(stream, true);
}

pub var live_sessions = std.atomic.Value(u32).init(0);
pub var live_streams = std.atomic.Value(u32).init(0);

pub const TestingAPIs = struct {
    pub fn liveCounts(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const obj = jsc.JSValue.createEmptyObject(globalThis, 2);
        obj.put(globalThis, jsc.ZigString.static("sessions"), .jsNumber(live_sessions.load(.monotonic)));
        obj.put(globalThis, jsc.ZigString.static("streams"), .jsNumber(live_streams.load(.monotonic)));
        return obj;
    }
};

const log = bun.Output.scoped(.h3_client, .hidden);

const std = @import("std");

const bun = @import("bun");
const HTTPClient = bun.http;
const jsc = bun.jsc;
const picohttp = bun.picohttp;
const strings = bun.strings;

const uws = bun.uws;
const quic = uws.quic;
