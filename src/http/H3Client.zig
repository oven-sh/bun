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
    qstream: ?*c.us_quic_stream_t = null,

    decoded_headers: std.ArrayListUnmanaged(picohttp.Header) = .{},
    decoded_bytes: std.ArrayListUnmanaged(u8) = .{},
    body_buffer: std.ArrayListUnmanaged(u8) = .{},
    status_code: u32 = 0,

    pending_body: []const u8 = "",
    request_body_done: bool = false,
    is_streaming_body: bool = false,
    headers_delivered: bool = false,

    pub fn deinit(this: *Stream) void {
        this.decoded_headers.deinit(bun.default_allocator);
        this.decoded_bytes.deinit(bun.default_allocator);
        this.body_buffer.deinit(bun.default_allocator);
        _ = live_streams.fetchSub(1, .monotonic);
        bun.destroy(this);
    }

    pub fn abort(this: *Stream) void {
        if (this.qstream) |qs| c.us_quic_stream_close(qs);
    }
};

/// One QUIC connection. Owns its UDP endpoint via quic.c; the `qsocket`
/// pointer becomes dangling after `onConnClose`, so every accessor checks
/// `closed` first.
pub const ClientSession = struct {
    ref_count: RefCount = .init(),
    /// Null while DNS is in flight; set once `us_quic_connect_addr` returns.
    qsocket: ?*c.us_quic_socket_t,
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
        return c.us_quic_socket_streams_avail(qs) > 0;
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
            c.us_quic_socket_make_stream(this.qsocket.?);
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

    fn detach(this: *ClientSession, stream: *Stream) void {
        if (stream.client) |cl| cl.h3 = null;
        stream.client = null;
        if (stream.qstream) |qs| streamExt(qs).* = null;
        stream.qstream = null;
        for (this.pending.items, 0..) |s, i| {
            if (s == stream) {
                _ = this.pending.orderedRemove(i);
                break;
            }
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

    fn writeRequest(this: *ClientSession, stream: *Stream, qs: *c.us_quic_stream_t) !void {
        const client = stream.client orelse return error.Aborted;
        const request = client.buildRequest(client.state.original_request_body.len());
        if (client.verbose != .none) {
            HTTPClient.printRequest(.http3, request, client.url.href, !client.flags.reject_unauthorized, client.state.request_body, client.verbose == .curl);
        }

        var headers: std.ArrayListUnmanaged(c.us_quic_header_t) = .{};
        defer headers.deinit(bun.default_allocator);
        var lower: std.ArrayListUnmanaged(u8) = .{};
        defer lower.deinit(bun.default_allocator);
        try headers.ensureTotalCapacity(bun.default_allocator, request.headers.len + 4);

        const push = struct {
            fn push(list: *std.ArrayListUnmanaged(c.us_quic_header_t), name: []const u8, value: []const u8) void {
                list.appendAssumeCapacity(.{
                    .name = name.ptr,
                    .name_len = @intCast(name.len),
                    .value = value.ptr,
                    .value_len = @intCast(value.len),
                });
            }
        }.push;

        push(&headers, ":method", request.method);
        push(&headers, ":scheme", "https");
        var authority: []const u8 = client.url.host;
        for (request.headers) |h| {
            if (strings.eqlCaseInsensitiveASCIIICheckLength(h.name, "host")) {
                authority = h.value;
                break;
            }
        }
        if (authority.len == 0) authority = this.hostname;
        push(&headers, ":authority", authority);
        push(&headers, ":path", if (request.path.len > 0) request.path else "/");

        // RFC 9114 §4.2: field names MUST be lowercase. Stage them into one
        // pre-sized buffer so the us_quic_header_t name pointers stay valid
        // for the whole batch (no realloc between push calls).
        var name_bytes: usize = 0;
        for (request.headers) |h| name_bytes += h.name.len;
        try lower.ensureTotalCapacityPrecise(bun.default_allocator, name_bytes);
        for (request.headers) |h| {
            if (isConnectionSpecific(h.name)) continue;
            const off = lower.items.len;
            for (h.name) |ch| lower.appendAssumeCapacity(std.ascii.toLower(ch));
            try headers.ensureUnusedCapacity(bun.default_allocator, 1);
            push(&headers, lower.items[off..], h.value);
        }

        const body = client.state.request_body;
        const has_inline_body = client.state.original_request_body == .bytes and body.len > 0;
        const is_streaming = client.state.original_request_body == .stream;

        const end_stream = !has_inline_body and !is_streaming;
        if (c.us_quic_stream_send_headers(qs, headers.items.ptr, @intCast(headers.items.len), @intFromBool(end_stream)) != 0) {
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

    fn drainSendBody(stream: *Stream, qs: *c.us_quic_stream_t) void {
        if (stream.request_body_done) return;
        const client = stream.client orelse return;

        if (stream.is_streaming_body) {
            const body = &client.state.original_request_body.stream;
            const sb = body.buffer orelse return;
            const buffer = sb.acquire();
            const data = buffer.slice();
            var written: usize = 0;
            while (written < data.len) {
                const w = c.us_quic_stream_write(qs, data.ptr + written, @intCast(data.len - written));
                if (w <= 0) break;
                written += @intCast(w);
            }
            buffer.cursor += written;
            const drained = buffer.isEmpty();
            if (drained) buffer.reset();
            if (drained and body.ended) {
                stream.request_body_done = true;
                c.us_quic_stream_shutdown(qs);
                client.state.request_stage = .done;
            } else if (!drained) {
                c.us_quic_stream_want_write(qs, 1);
            } else if (data.len > 0) {
                sb.reportDrain();
            }
            sb.release();
            if (stream.request_body_done) body.detach();
            return;
        }

        while (stream.pending_body.len > 0) {
            const w = c.us_quic_stream_write(qs, stream.pending_body.ptr, @intCast(stream.pending_body.len));
            if (w <= 0) break;
            stream.pending_body = stream.pending_body[@intCast(w)..];
        }
        if (stream.pending_body.len == 0) {
            stream.request_body_done = true;
            c.us_quic_stream_shutdown(qs);
            client.state.request_stage = .done;
        } else {
            c.us_quic_stream_want_write(qs, 1);
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

fn isConnectionSpecific(name: []const u8) bool {
    return strings.eqlCaseInsensitiveASCIIICheckLength(name, "connection") or
        strings.eqlCaseInsensitiveASCIIICheckLength(name, "host") or
        strings.eqlCaseInsensitiveASCIIICheckLength(name, "keep-alive") or
        strings.eqlCaseInsensitiveASCIIICheckLength(name, "proxy-connection") or
        strings.eqlCaseInsensitiveASCIIICheckLength(name, "transfer-encoding") or
        strings.eqlCaseInsensitiveASCIIICheckLength(name, "upgrade");
}

/// Process-global lazily-initialised on the HTTP thread. Owns the lsquic
/// client engine and the live-session registry. Never freed — the engine
/// lives for the process, same as the HTTP thread itself.
pub const ClientContext = struct {
    qctx: *c.us_quic_socket_context_t,
    sessions: std.ArrayListUnmanaged(*ClientSession) = .{},

    var instance: ?*ClientContext = null;
    var init_once = std.once(globalInit);

    fn globalInit() void {
        c.us_quic_global_init();
    }

    pub fn get() ?*ClientContext {
        return instance;
    }

    pub fn getOrCreate(loop: *uws.Loop) ?*ClientContext {
        if (instance) |i| return i;
        init_once.call();
        const qctx = c.us_create_quic_client_context(
            loop,
            0,
            @sizeOf(*ClientSession),
            @sizeOf(*Stream),
        ) orelse return null;
        c.us_quic_socket_context_on_hsk_done(qctx, onHskDone);
        c.us_quic_socket_context_on_close(qctx, onConnClose);
        c.us_quic_socket_context_on_stream_open(qctx, onStreamOpen);
        c.us_quic_socket_context_on_stream_headers(qctx, onStreamHeaders);
        c.us_quic_socket_context_on_stream_data(qctx, onStreamData);
        c.us_quic_socket_context_on_stream_writable(qctx, onStreamWritable);
        c.us_quic_socket_context_on_stream_close(qctx, onStreamClose);

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

        var qsocket: ?*c.us_quic_socket_t = null;
        var pending: ?*c.us_quic_pending_connect_t = null;
        const rc = c.us_quic_socket_context_connect(
            this.qctx,
            host_z.ptr,
            @intCast(port),
            host_z.ptr,
            @intFromBool(reject),
            &qsocket,
            &pending,
            session,
        );
        switch (rc) {
            1 => {
                session.qsocket = qsocket.?;
                sessionExt(qsocket.?).* = session;
                log("connect {s}:{d} (sync)", .{ hostname, port });
            },
            0 => {
                log("connect {s}:{d} (dns pending)", .{ hostname, port });
                const pc = PendingConnect.new(.{
                    .session = session,
                    .pc = pending.?,
                    .loop_ptr = c.us_quic_socket_context_loop(this.qctx),
                });
                session.ref();
                bun.dns.internal.registerQuic(
                    @ptrCast(@alignCast(c.us_quic_pending_connect_addrinfo(pending.?))),
                    pc,
                );
            },
            else => {
                log("connect {s}:{d} failed", .{ hostname, port });
                this.unregister(session);
                session.closed = true;
                while (session.pending.items.len > 0) {
                    const stream = session.pending.items[0];
                    const cl = stream.client;
                    session.detach(stream);
                    if (cl) |cl_| cl_.failFromH2(error.ConnectionRefused);
                }
                _ = live_sessions.fetchSub(1, .monotonic);
                session.deref();
                return false;
            },
        }
        return true;
    }

    fn unregister(this: *ClientContext, session: *ClientSession) void {
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

/// DNS-pending QUIC connect. Created when `us_quic_socket_context_connect`
/// returns 0 (cache miss); the global DNS cache notifies us via
/// `onDNSResolved[Threadsafe]`, at which point we hand the resolved address
/// to lsquic and bind the resulting `us_quic_socket_t` to the waiting
/// session.
pub const PendingConnect = struct {
    pub const new = bun.TrivialNew(@This());

    session: *ClientSession,
    pc: *c.us_quic_pending_connect_t,
    loop_ptr: *uws.Loop,
    next: ?*PendingConnect = null,

    pub fn loop(this: *PendingConnect) *uws.Loop {
        return this.loop_ptr;
    }

    pub fn onDNSResolved(this: *PendingConnect) void {
        const session = this.session;
        defer {
            session.deref();
            bun.destroy(this);
        }
        if (session.closed or session.pending.items.len == 0) {
            // Every waiter was aborted while DNS was in flight; don't open a
            // connection nobody will use.
            c.us_quic_pending_connect_cancel(this.pc);
            if (!session.closed) failSession(session, error.Aborted);
            return;
        }
        const qs = c.us_quic_pending_connect_resolved(this.pc) orelse {
            failSession(session, error.DNSResolutionFailed);
            return;
        };
        session.qsocket = qs;
        sessionExt(qs).* = session;
        log("dns resolved {s}:{d}", .{ session.hostname, session.port });
    }

    /// DNS worker may call from off the HTTP thread; mirror
    /// us_internal_dns_callback_threadsafe: push onto a mutex-protected list
    /// and wake the loop. `drainResolved` runs from `HTTPThread.drainEvents`
    /// on the next loop iteration after the wakeup.
    pub fn onDNSResolvedThreadsafe(this: *PendingConnect) void {
        resolved_mutex.lock();
        this.next = resolved_head;
        resolved_head = this;
        resolved_mutex.unlock();
        this.loop_ptr.wakeup();
    }

    var resolved_mutex: bun.Mutex = .{};
    var resolved_head: ?*PendingConnect = null;

    pub fn drainResolved() void {
        resolved_mutex.lock();
        var head = resolved_head;
        resolved_head = null;
        resolved_mutex.unlock();
        while (head) |pc| {
            const next = pc.next;
            pc.onDNSResolved();
            head = next;
        }
    }

    fn failSession(session: *ClientSession, err: anyerror) void {
        session.closed = true;
        if (ClientContext.instance) |ctx| ctx.unregister(session);
        while (session.pending.items.len > 0) {
            const stream = session.pending.items[0];
            const cl = stream.client;
            session.detach(stream);
            if (cl) |cl_| cl_.failFromH2(err);
        }
        _ = live_sessions.fetchSub(1, .monotonic);
        session.deref();
    }
};

// ───── lsquic → Zig callbacks ─────

fn sessionExt(qs: *c.us_quic_socket_t) *?*ClientSession {
    return @ptrCast(@alignCast(c.us_quic_socket_ext(qs)));
}

fn streamExt(s: *c.us_quic_stream_t) *?*Stream {
    return @ptrCast(@alignCast(c.us_quic_stream_ext(s)));
}

fn onHskDone(qs: *c.us_quic_socket_t, ok: c_int) callconv(.c) void {
    const session = sessionExt(qs).* orelse return;
    log("hsk_done ok={d} pending={d}", .{ ok, session.pending.items.len });
    if (ok == 0) {
        session.closed = true;
        return;
    }
    session.handshake_done = true;
    for (session.pending.items) |_| c.us_quic_socket_make_stream(qs);
}

fn onConnClose(qs: *c.us_quic_socket_t) callconv(.c) void {
    const session = sessionExt(qs).* orelse return;
    session.closed = true;
    session.qsocket = null;
    var buf: [256]u8 = undefined;
    const st = c.us_quic_socket_status(qs, &buf, buf.len);
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

fn onStreamOpen(s: *c.us_quic_stream_t, is_client: c_int) callconv(.c) void {
    streamExt(s).* = null;
    if (is_client == 0) return;
    const qs = c.us_quic_stream_socket(s) orelse return;
    const session = sessionExt(qs).* orelse {
        c.us_quic_stream_close(s);
        return;
    };
    // Bind the next pending request to this stream.
    const stream: *Stream = for (session.pending.items) |st| {
        if (st.qstream == null) break st;
    } else {
        c.us_quic_stream_close(s);
        return;
    };
    stream.qstream = s;
    streamExt(s).* = stream;
    log("stream_open", .{});
    session.writeRequest(stream, s) catch |err| {
        session.fail(stream, err);
    };
}

fn onStreamHeaders(s: *c.us_quic_stream_t) callconv(.c) void {
    const stream = streamExt(s).* orelse return;
    const n = c.us_quic_stream_header_count(s);
    var status: u32 = 0;
    stream.decoded_bytes.clearRetainingCapacity();
    stream.decoded_headers.clearRetainingCapacity();
    var bounds: std.ArrayListUnmanaged([3]u32) = .{};
    defer bounds.deinit(bun.default_allocator);
    var i: c_uint = 0;
    while (i < n) : (i += 1) {
        const h = c.us_quic_stream_header(s, i) orelse continue;
        const name = h.name[0..h.name_len];
        const value = h.value[0..h.value_len];
        if (name.len > 0 and name[0] == ':') {
            if (strings.eqlComptime(name, ":status")) {
                status = std.fmt.parseInt(u32, value, 10) catch 0;
            }
            continue;
        }
        const ns: u32 = @intCast(stream.decoded_bytes.items.len);
        bun.handleOom(stream.decoded_bytes.appendSlice(bun.default_allocator, name));
        const vs: u32 = @intCast(stream.decoded_bytes.items.len);
        bun.handleOom(stream.decoded_bytes.appendSlice(bun.default_allocator, value));
        bun.handleOom(bounds.append(bun.default_allocator, .{ ns, vs, @intCast(stream.decoded_bytes.items.len) }));
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
    const bytes = stream.decoded_bytes.items;
    bun.handleOom(stream.decoded_headers.ensureTotalCapacityPrecise(bun.default_allocator, bounds.items.len));
    for (bounds.items) |b| {
        stream.decoded_headers.appendAssumeCapacity(.{ .name = bytes[b[0]..b[1]], .value = bytes[b[1]..b[2]] });
    }
    stream.session.deliver(stream, false);
}

fn onStreamData(s: *c.us_quic_stream_t, data: [*]const u8, len: c_uint, fin: c_int) callconv(.c) void {
    const stream = streamExt(s).* orelse return;
    if (len > 0) {
        bun.handleOom(stream.body_buffer.appendSlice(bun.default_allocator, data[0..len]));
    }
    stream.session.deliver(stream, fin != 0);
}

fn onStreamWritable(s: *c.us_quic_stream_t) callconv(.c) void {
    const stream = streamExt(s).* orelse return;
    ClientSession.drainSendBody(stream, s);
}

fn onStreamClose(s: *c.us_quic_stream_t) callconv(.c) void {
    const stream = streamExt(s).* orelse return;
    streamExt(s).* = null;
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

const c = struct {
    pub const us_quic_socket_context_t = opaque {};
    pub const us_quic_socket_t = opaque {};
    pub const us_quic_stream_t = opaque {};
    pub const us_quic_pending_connect_t = opaque {};
    pub const us_quic_header_t = extern struct {
        name: [*]const u8,
        name_len: c_uint,
        value: [*]const u8,
        value_len: c_uint,
    };

    pub extern fn us_quic_global_init() void;
    pub extern fn us_create_quic_client_context(loop: *uws.Loop, ext: c_uint, conn_ext: c_uint, stream_ext: c_uint) ?*us_quic_socket_context_t;
    pub extern fn us_quic_socket_context_loop(ctx: *us_quic_socket_context_t) *uws.Loop;
    pub extern fn us_quic_socket_context_connect(ctx: *us_quic_socket_context_t, host: [*:0]const u8, port: c_int, sni: [*:0]const u8, reject_unauthorized: c_int, out_qs: *?*us_quic_socket_t, out_pending: *?*us_quic_pending_connect_t, user: *anyopaque) c_int;
    pub extern fn us_quic_pending_connect_addrinfo(pc: *us_quic_pending_connect_t) *anyopaque;
    pub extern fn us_quic_pending_connect_resolved(pc: *us_quic_pending_connect_t) ?*us_quic_socket_t;
    pub extern fn us_quic_pending_connect_cancel(pc: *us_quic_pending_connect_t) void;
    pub extern fn us_quic_socket_make_stream(s: *us_quic_socket_t) void;
    pub extern fn us_quic_socket_streams_avail(s: *us_quic_socket_t) c_uint;
    pub extern fn us_quic_socket_status(s: *us_quic_socket_t, buf: [*]u8, len: c_uint) c_int;
    pub extern fn us_quic_socket_ext(s: *us_quic_socket_t) *anyopaque;
    pub extern fn us_quic_socket_close(s: *us_quic_socket_t) void;

    pub extern fn us_quic_socket_context_on_hsk_done(ctx: *us_quic_socket_context_t, cb: *const fn (*us_quic_socket_t, c_int) callconv(.c) void) void;
    pub extern fn us_quic_socket_context_on_close(ctx: *us_quic_socket_context_t, cb: *const fn (*us_quic_socket_t) callconv(.c) void) void;
    pub extern fn us_quic_socket_context_on_stream_open(ctx: *us_quic_socket_context_t, cb: *const fn (*us_quic_stream_t, c_int) callconv(.c) void) void;
    pub extern fn us_quic_socket_context_on_stream_headers(ctx: *us_quic_socket_context_t, cb: *const fn (*us_quic_stream_t) callconv(.c) void) void;
    pub extern fn us_quic_socket_context_on_stream_data(ctx: *us_quic_socket_context_t, cb: *const fn (*us_quic_stream_t, [*]const u8, c_uint, c_int) callconv(.c) void) void;
    pub extern fn us_quic_socket_context_on_stream_writable(ctx: *us_quic_socket_context_t, cb: *const fn (*us_quic_stream_t) callconv(.c) void) void;
    pub extern fn us_quic_socket_context_on_stream_close(ctx: *us_quic_socket_context_t, cb: *const fn (*us_quic_stream_t) callconv(.c) void) void;

    pub extern fn us_quic_stream_ext(s: *us_quic_stream_t) *anyopaque;
    pub extern fn us_quic_stream_socket(s: *us_quic_stream_t) ?*us_quic_socket_t;
    pub extern fn us_quic_stream_send_headers(s: *us_quic_stream_t, h: [*]const us_quic_header_t, n: c_uint, end_stream: c_int) c_int;
    pub extern fn us_quic_stream_write(s: *us_quic_stream_t, data: [*]const u8, len: c_uint) c_int;
    pub extern fn us_quic_stream_shutdown(s: *us_quic_stream_t) void;
    pub extern fn us_quic_stream_close(s: *us_quic_stream_t) void;
    pub extern fn us_quic_stream_want_write(s: *us_quic_stream_t, want: c_int) void;
    pub extern fn us_quic_stream_header_count(s: *us_quic_stream_t) c_uint;
    pub extern fn us_quic_stream_header(s: *us_quic_stream_t, i: c_uint) ?*const us_quic_header_t;
};

const log = bun.Output.scoped(.h3_client, .hidden);

const std = @import("std");

const bun = @import("bun");
const HTTPClient = bun.http;
const jsc = bun.jsc;
const picohttp = bun.picohttp;
const strings = bun.strings;
const uws = bun.uws;
