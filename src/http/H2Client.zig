//! HTTP/2 path for Bun's fetch HTTP client.
//!
//! `ClientSession` owns the TLS socket once ALPN selects "h2" and is the
//! `ActiveSocket` variant the HTTPContext handlers dispatch to. It holds the
//! connection-scoped state — HPACK tables, write/read buffers, server
//! SETTINGS — and a map of active `Stream`s, each bound to one `HTTPClient`.
//! Response frames are parsed into per-stream buffers and then handed to the
//! same `picohttp.Response` / `handleResponseBody` machinery the HTTP/1.1
//! path uses, so redirects, decompression and the result callback are shared.

/// Advertised as SETTINGS_INITIAL_WINDOW_SIZE; replenished via WINDOW_UPDATE
/// once half has been consumed.
pub const local_initial_window_size: u31 = 1 << 24;

pub const Stream = struct {
    pub const new = bun.TrivialNew(@This());

    id: u31,
    session: *ClientSession,
    client: ?*HTTPClient,

    /// HEADERS + CONTINUATION fragments, decoded once END_HEADERS arrives.
    header_block: std.ArrayListUnmanaged(u8) = .{},
    /// DATA payload accumulated across one onData() pass.
    body_buffer: std.ArrayListUnmanaged(u8) = .{},

    end_stream_received: bool = false,
    seen_headers: bool = false,
    headers_ready: bool = false,
    headers_end_stream: bool = false,
    /// Set once the END_STREAM flag has been written on the request side.
    request_body_done: bool = false,
    fatal_error: ?anyerror = null,
    /// DATA bytes consumed since the last WINDOW_UPDATE for this stream.
    unacked_bytes: u32 = 0,
    /// Per-stream send window (server's INITIAL_WINDOW_SIZE plus any
    /// WINDOW_UPDATEs minus DATA bytes already framed).
    send_window: i32,
    /// Unsent suffix of a `.bytes` request body, parked while the send
    /// window is exhausted. Borrows from `client.state.request_body`.
    pending_body: []const u8 = "",

    pub fn deinit(this: *Stream) void {
        this.header_block.deinit(bun.default_allocator);
        this.body_buffer.deinit(bun.default_allocator);
        bun.destroy(this);
    }

    pub fn rst(this: *Stream, code: wire.ErrorCode) void {
        var value: u32 = @byteSwap(@intFromEnum(code));
        this.session.writeFrame(.HTTP_FRAME_RST_STREAM, 0, this.id, std.mem.asBytes(&value));
    }
};

pub const ClientSession = struct {
    pub const new = bun.TrivialNew(@This());

    /// Ref holders: the socket-ext tag while the session is the ActiveSocket
    /// (1), the context's active_h2_sessions registry while listed (1), and
    /// the keep-alive pool while parked (1). Hand-offs between socket and
    /// pool transfer a ref rather than touching the count.
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    pub const Socket = NewHTTPContext(true).HTTPSocket;

    ref_count: RefCount,

    hpack: *lshpack.HPACK,
    socket: Socket,
    ctx: *NewHTTPContext(true),

    /// Pool key. Owned copy so the session can outlive the originating client.
    hostname: []const u8,
    port: u16,
    ssl_config: ?SSLConfig.SharedPtr,
    did_have_handshaking_error: bool,

    /// Queued bytes for the socket; whole frames are written here and
    /// `flush()` drains as much as the socket accepts.
    write_buffer: bun.io.StreamBuffer = .{},

    /// Inbound bytes until a full 9-byte header + declared payload is
    /// available, so frame handlers always see complete frames.
    read_buffer: std.ArrayListUnmanaged(u8) = .{},

    /// Backing storage for decoded header strings. lshpack returns
    /// thread-local slices clobbered on the next decode call, so we copy
    /// here and point `shared_response_headers_buf` into this buffer until
    /// `cloneMetadata` makes its own copy.
    decoded_header_bytes: std.ArrayListUnmanaged(u8) = .{},

    streams: std.AutoArrayHashMapUnmanaged(u31, *Stream) = .{},
    next_stream_id: u31 = 1,
    /// Stream id whose CONTINUATION sequence is in progress; 0 = none.
    expecting_continuation: u31 = 0,

    /// Cold-start coalesced requests parked until the server's first SETTINGS
    /// frame arrives so the real MAX_CONCURRENT_STREAMS cap can be honoured.
    pending_attach: std.ArrayListUnmanaged(*HTTPClient) = .{},

    preface_sent: bool = false,
    settings_received: bool = false,
    goaway_received: bool = false,
    goaway_last_stream_id: u31 = 0,
    fatal_error: ?anyerror = null,

    remote_max_frame_size: u24 = wire.DEFAULT_MAX_FRAME_SIZE,
    remote_max_concurrent_streams: u32 = 100,
    remote_initial_window_size: u32 = wire.DEFAULT_WINDOW_SIZE,
    /// Connection-level send window. Starts at the spec default regardless of
    /// SETTINGS; only WINDOW_UPDATE on stream 0 grows it.
    conn_send_window: i32 = wire.DEFAULT_WINDOW_SIZE,

    /// DATA bytes consumed since the last connection-level WINDOW_UPDATE.
    conn_unacked_bytes: u32 = 0,

    /// Index in the context's active-session list while reachable for
    /// concurrent attachment; maxInt when not listed.
    registry_index: u32 = std.math.maxInt(u32),

    pub fn create(ctx: *NewHTTPContext(true), socket: Socket, client: *const HTTPClient) *ClientSession {
        const this = ClientSession.new(.{
            .ref_count = .init(),
            .hpack = lshpack.HPACK.init(4096),
            .socket = socket,
            .ctx = ctx,
            .hostname = bun.handleOom(bun.default_allocator.dupe(u8, client.connected_url.hostname)),
            .port = client.connected_url.getPortAuto(),
            .ssl_config = if (client.tls_props) |p| p.clone() else null,
            .did_have_handshaking_error = client.flags.did_have_handshaking_error,
        });
        ctx.registerH2(this);
        return this;
    }

    fn deinit(this: *ClientSession) void {
        bun.debugAssert(this.registry_index == std.math.maxInt(u32));
        this.hpack.deinit();
        this.write_buffer.deinit();
        this.read_buffer.deinit(bun.default_allocator);
        this.decoded_header_bytes.deinit(bun.default_allocator);
        var it = this.streams.iterator();
        while (it.next()) |e| e.value_ptr.*.deinit();
        this.streams.deinit(bun.default_allocator);
        this.pending_attach.deinit(bun.default_allocator);
        bun.default_allocator.free(this.hostname);
        if (this.ssl_config) |*s| s.deinit();
        bun.destroy(this);
    }

    pub fn hasHeadroom(this: *const ClientSession) bool {
        return !this.goaway_received and
            this.fatal_error == null and
            this.streams.count() < this.remote_max_concurrent_streams and
            this.next_stream_id < wire.MAX_STREAM_ID;
    }

    pub fn matches(this: *const ClientSession, hostname: []const u8, port: u16, ssl_config: ?*SSLConfig) bool {
        return this.port == port and SSLConfig.rawPtr(this.ssl_config) == ssl_config and strings.eqlLong(this.hostname, hostname, true);
    }

    pub fn adopt(this: *ClientSession, client: *HTTPClient) void {
        client.registerAbortTracker(true, this.socket);
        this.attach(client);
    }

    /// Park a coalesced request until the server's SETTINGS arrive. Abort
    /// is routed via the session socket so `abortByHttpId` can find it.
    pub fn enqueue(this: *ClientSession, client: *HTTPClient) void {
        client.registerAbortTracker(true, this.socket);
        bun.handleOom(this.pending_attach.append(bun.default_allocator, client));
    }

    fn drainPending(this: *ClientSession) void {
        if (!this.settings_received or this.pending_attach.items.len == 0) return;
        var waiters = this.pending_attach;
        this.pending_attach = .{};
        defer waiters.deinit(bun.default_allocator);
        for (waiters.items) |client| {
            if (this.fatal_error) |err| {
                client.failFromH2(err);
            } else if (client.signals.get(.aborted)) {
                client.failFromH2(error.Aborted);
            } else if (this.hasHeadroom()) {
                this.attach(client);
            } else {
                client.retryAfterH2Coalesce();
            }
        }
    }

    /// True when the connection can be parked in the keep-alive pool: no
    /// active streams, no GOAWAY/error, and no leftover bytes that would
    /// confuse the next request.
    pub fn canPool(this: *const ClientSession) bool {
        return this.streams.count() == 0 and
            !this.goaway_received and
            this.fatal_error == null and
            this.expecting_continuation == 0 and
            this.read_buffer.items.len == 0 and
            this.write_buffer.isEmpty() and
            this.next_stream_id < wire.MAX_STREAM_ID;
    }

    fn queue(this: *ClientSession, bytes: []const u8) void {
        bun.handleOom(this.write_buffer.write(bytes));
    }

    fn writeFrame(this: *ClientSession, frame_type: wire.FrameType, flags: u8, stream_id: u32, payload: []const u8) void {
        var header: wire.FrameHeader = .{
            .type = @intFromEnum(frame_type),
            .flags = flags,
            .streamIdentifier = stream_id,
            .length = @intCast(payload.len),
        };
        std.mem.byteSwapAllFields(wire.FrameHeader, &header);
        this.queue(std.mem.asBytes(&header)[0..wire.FrameHeader.byteSize]);
        this.queue(payload);
    }

    fn isConnectionSpecific(name: []const u8) bool {
        return strings.eqlCaseInsensitiveASCIIICheckLength(name, "connection") or
            strings.eqlCaseInsensitiveASCIIICheckLength(name, "host") or
            strings.eqlCaseInsensitiveASCIIICheckLength(name, "keep-alive") or
            strings.eqlCaseInsensitiveASCIIICheckLength(name, "proxy-connection") or
            strings.eqlCaseInsensitiveASCIIICheckLength(name, "transfer-encoding") or
            strings.eqlCaseInsensitiveASCIIICheckLength(name, "upgrade");
    }

    fn encodeHeader(this: *ClientSession, encoded: *std.ArrayListUnmanaged(u8), name: []const u8, value: []const u8, never_index: bool) !void {
        const required = encoded.items.len + name.len + value.len + 32;
        try encoded.ensureTotalCapacity(bun.default_allocator, required);
        const written = try this.hpack.encode(name, value, never_index, encoded.allocatedSlice(), encoded.items.len);
        encoded.items.len += written;
    }

    fn writePreface(this: *ClientSession) void {
        this.queue(wire.client_preface);

        var settings: [2 * wire.SettingsPayloadUnit.byteSize]u8 = undefined;
        wire.SettingsPayloadUnit.encode(settings[0..6], .SETTINGS_ENABLE_PUSH, 0);
        wire.SettingsPayloadUnit.encode(settings[6..12], .SETTINGS_INITIAL_WINDOW_SIZE, local_initial_window_size);
        this.writeFrame(.HTTP_FRAME_SETTINGS, 0, 0, &settings);

        // Connection-level window starts at 64 KiB regardless of SETTINGS;
        // open it to match the per-stream window so the first response isn't
        // throttled before our first WINDOW_UPDATE.
        this.writeWindowUpdate(0, local_initial_window_size - wire.DEFAULT_WINDOW_SIZE);
        this.preface_sent = true;
    }

    /// Allocate a stream for `client`, serialise its request as HEADERS +
    /// DATA, and flush.
    pub fn attach(this: *ClientSession, client: *HTTPClient) void {
        bun.debugAssert(this.hasHeadroom());

        const stream = Stream.new(.{
            .id = this.next_stream_id,
            .session = this,
            .client = client,
            .send_window = @intCast(@min(this.remote_initial_window_size, @as(u32, wire.MAX_WINDOW_SIZE))),
        });
        this.next_stream_id +|= 2;
        bun.handleOom(this.streams.put(bun.default_allocator, stream.id, stream));
        client.h2 = stream;
        client.flags.protocol = .http2;
        client.allow_retry = false;

        if (!this.preface_sent) this.writePreface();

        client.setTimeout(this.socket, 5);
        const request = client.buildRequest(client.state.original_request_body.len());
        this.writeRequest(client, stream, request) catch |err| {
            this.detachWithFailure(stream, err);
            return;
        };
        if (client.verbose != .none) {
            HTTPClient.printRequest(request, client.url.href, !client.flags.reject_unauthorized, client.state.request_body, client.verbose == .curl);
        }
        client.state.request_stage = if (stream.request_body_done) .done else .body;
        client.state.response_stage = .headers;

        _ = this.flush() catch |err| {
            this.failAll(err);
            return;
        };

        if (client.flags.is_streaming_request_body) {
            client.progressUpdate(true, this.ctx, this.socket);
        }
    }

    /// Remove `stream` from the session, RST it, and fail its client. The
    /// session and socket stay up for siblings.
    pub fn detachWithFailure(this: *ClientSession, stream: *Stream, err: anyerror) void {
        stream.rst(.CANCEL);
        _ = this.flush() catch {};
        const client = stream.client;
        stream.client = null;
        if (client) |c| c.h2 = null;
        _ = this.streams.swapRemove(stream.id);
        stream.deinit();
        if (client) |c| c.failFromH2(err);
    }

    fn writeRequest(this: *ClientSession, client: *HTTPClient, stream: *Stream, request: picohttp.Request) !void {
        var encoded: std.ArrayListUnmanaged(u8) = .{};
        defer encoded.deinit(bun.default_allocator);

        var lower_buf: [256]u8 = undefined;

        try this.encodeHeader(&encoded, ":method", request.method, false);
        try this.encodeHeader(&encoded, ":scheme", "https", false);
        var authority: []const u8 = client.url.host;
        for (request.headers) |header| {
            if (strings.eqlCaseInsensitiveASCIIICheckLength(header.name, "host")) {
                authority = header.value;
                break;
            }
        }
        try this.encodeHeader(&encoded, ":authority", authority, false);
        const path = if (request.path.len > 0) request.path else "/";
        try this.encodeHeader(&encoded, ":path", path, false);

        for (request.headers) |header| {
            if (isConnectionSpecific(header.name)) continue;
            const never_index =
                strings.eqlCaseInsensitiveASCIIICheckLength(header.name, "authorization") or
                strings.eqlCaseInsensitiveASCIIICheckLength(header.name, "cookie") or
                strings.eqlCaseInsensitiveASCIIICheckLength(header.name, "set-cookie");
            const lowered = if (header.name.len <= lower_buf.len) brk: {
                for (header.name, 0..) |c, i| lower_buf[i] = std.ascii.toLower(c);
                break :brk lower_buf[0..header.name.len];
            } else header.name;
            try this.encodeHeader(&encoded, lowered, header.value, never_index);
        }

        const body = client.state.request_body;
        const has_inline_body = client.state.original_request_body == .bytes and body.len > 0;
        const is_streaming = client.state.original_request_body == .stream;

        this.writeHeaderBlock(stream.id, encoded.items, !has_inline_body and !is_streaming);
        if (has_inline_body) {
            stream.pending_body = body;
            this.drainSendBody(stream);
        } else if (!is_streaming) {
            stream.request_body_done = true;
        }
    }

    fn writeHeaderBlock(this: *ClientSession, stream_id: u31, block: []const u8, end_stream: bool) void {
        const max: usize = this.remote_max_frame_size;
        var remaining = block;
        var first = true;
        while (true) {
            const chunk = remaining[0..@min(remaining.len, max)];
            remaining = remaining[chunk.len..];
            const last = remaining.len == 0;
            var flags: u8 = 0;
            if (last) flags |= @intFromEnum(wire.HeadersFrameFlags.END_HEADERS);
            if (first and end_stream) flags |= @intFromEnum(wire.HeadersFrameFlags.END_STREAM);
            this.writeFrame(if (first) .HTTP_FRAME_HEADERS else .HTTP_FRAME_CONTINUATION, flags, stream_id, chunk);
            first = false;
            if (last) break;
        }
    }

    /// Frame `data` into DATA frames respecting `remote_max_frame_size` and
    /// both flow-control windows. Returns bytes consumed; END_STREAM is set
    /// on the final frame only when `end_stream` and all of `data` fit.
    fn writeDataWindowed(this: *ClientSession, stream: *Stream, data: []const u8, end_stream: bool) usize {
        var remaining = data;
        var consumed: usize = 0;
        while (true) {
            const window: usize = @intCast(@max(0, @min(stream.send_window, this.conn_send_window)));
            if (remaining.len > 0 and window == 0) break;
            const chunk_len = @min(remaining.len, @as(usize, this.remote_max_frame_size), window);
            const last = chunk_len == remaining.len;
            const flags: u8 = if (last and end_stream) @intFromEnum(wire.DataFrameFlags.END_STREAM) else 0;
            this.writeFrame(.HTTP_FRAME_DATA, flags, stream.id, remaining[0..chunk_len]);
            stream.send_window -= @intCast(chunk_len);
            this.conn_send_window -= @intCast(chunk_len);
            consumed += chunk_len;
            remaining = remaining[chunk_len..];
            if (last) break;
        }
        return consumed;
    }

    /// Push as much of `stream`'s request body as the send windows allow.
    /// Buffers into `write_buffer`; caller flushes.
    fn drainSendBody(this: *ClientSession, stream: *Stream) void {
        if (stream.request_body_done) return;
        const client = stream.client orelse return;
        switch (client.state.original_request_body) {
            .bytes => {
                const sent = this.writeDataWindowed(stream, stream.pending_body, true);
                stream.pending_body = stream.pending_body[sent..];
                if (stream.pending_body.len == 0) {
                    stream.request_body_done = true;
                    client.state.request_stage = .done;
                }
            },
            .stream => |*body| {
                const sb = body.buffer orelse return;
                const buffer = sb.acquire();
                const data = buffer.slice();
                if (data.len == 0 and !body.ended) {
                    sb.release();
                    return;
                }
                const sent = this.writeDataWindowed(stream, data, body.ended);
                buffer.cursor += sent;
                const drained = buffer.isEmpty();
                if (drained) buffer.reset();
                if (drained and body.ended) {
                    stream.request_body_done = true;
                    client.state.request_stage = .done;
                } else if (drained and data.len > 0) {
                    sb.reportDrain();
                }
                sb.release();
                if (stream.request_body_done) body.detach();
            },
            .sendfile => unreachable,
        }
    }

    fn drainSendBodies(this: *ClientSession) void {
        if (this.conn_send_window <= 0) return;
        for (this.streams.values()) |stream| {
            if (!stream.request_body_done and stream.send_window > 0) {
                this.drainSendBody(stream);
            }
        }
    }

    /// HTTP-thread wake-up from `scheduleRequestWrite`: new body bytes (or
    /// end-of-body) are available in the ThreadSafeStreamBuffer.
    pub fn streamBodyByHttpId(this: *ClientSession, async_http_id: u32, ended: bool) void {
        this.ref();
        defer this.deref();
        for (this.streams.values()) |stream| {
            const client = stream.client orelse continue;
            if (client.async_http_id != async_http_id) continue;
            if (client.state.original_request_body != .stream) return;
            client.state.original_request_body.stream.ended = ended;
            client.setTimeout(this.socket, 5);
            this.drainSendBody(stream);
            _ = this.flush() catch |err| this.failAll(err);
            return;
        }
    }

    fn writeWindowUpdate(this: *ClientSession, stream_id: u32, increment: u31) void {
        var value: u32 = @byteSwap(@as(u32, increment));
        this.writeFrame(.HTTP_FRAME_WINDOW_UPDATE, 0, stream_id, std.mem.asBytes(&value));
    }

    fn stripPadding(payload: []const u8) ?[]const u8 {
        if (payload.len < 1) return null;
        const pad: usize = payload[0];
        if (pad >= payload.len) return null;
        return payload[1 .. payload.len - pad];
    }

    fn replenishWindow(this: *ClientSession) void {
        const threshold = local_initial_window_size / 2;
        if (this.conn_unacked_bytes >= threshold) {
            this.writeWindowUpdate(0, @intCast(this.conn_unacked_bytes));
            this.conn_unacked_bytes = 0;
        }
        var it = this.streams.iterator();
        while (it.next()) |e| {
            const s = e.value_ptr.*;
            if (s.unacked_bytes >= threshold and !s.end_stream_received) {
                this.writeWindowUpdate(s.id, @intCast(s.unacked_bytes));
                s.unacked_bytes = 0;
            }
        }
    }

    pub fn flush(this: *ClientSession) !bool {
        const pending = this.write_buffer.slice();
        if (pending.len == 0) return false;
        var remaining = pending;
        var total: usize = 0;
        while (remaining.len > 0) {
            const wrote = this.socket.write(remaining);
            if (wrote < 0) return error.WriteFailed;
            const n: usize = @intCast(wrote);
            total += n;
            remaining = remaining[n..];
            if (n == 0) break;
        }
        this.write_buffer.wrote(total);
        if (this.write_buffer.isEmpty()) {
            this.write_buffer.reset();
            return false;
        }
        return true;
    }

    fn parseFrames(this: *ClientSession) void {
        var consumed: usize = 0;
        while (true) {
            const buf = this.read_buffer.items[consumed..];
            if (buf.len < wire.FrameHeader.byteSize) break;
            var header: wire.FrameHeader = .{ .flags = 0 };
            wire.FrameHeader.from(&header, buf[0..wire.FrameHeader.byteSize], 0, true);
            header.streamIdentifier = wire.UInt31WithReserved.from(header.streamIdentifier).uint31;
            const frame_len = wire.FrameHeader.byteSize + @as(usize, header.length);
            if (buf.len < frame_len) break;
            this.dispatchFrame(header, buf[wire.FrameHeader.byteSize..frame_len]);
            consumed += frame_len;
            if (this.fatal_error != null) break;
        }
        if (consumed > 0) {
            const tail_len = this.read_buffer.items.len - consumed;
            if (tail_len > 0) {
                std.mem.copyForwards(u8, this.read_buffer.items[0..tail_len], this.read_buffer.items[consumed..]);
            }
            this.read_buffer.items.len = tail_len;
        }
    }

    /// Socket onData entry point. Parse frames into per-stream state, deliver
    /// each ready stream to its client, then pool or close if no streams
    /// remain. Structured "parse all → deliver all" because delivering may
    /// free the client.
    pub fn onData(this: *ClientSession, incoming: []const u8) void {
        this.ref();
        defer this.deref();
        bun.handleOom(this.read_buffer.appendSlice(bun.default_allocator, incoming));
        this.parseFrames();
        this.replenishWindow();

        if (this.flush() catch blk: {
            this.fatal_error = error.WriteFailed;
            break :blk false;
        }) {}

        if (this.fatal_error) |err| return this.failAll(err);

        this.drainPending();
        this.drainSendBodies();
        _ = this.flush() catch |err| return this.failAll(err);

        // Deliver per-stream. Iterate by index because delivery may remove
        // entries (swapRemove keeps earlier indices stable; revisiting the
        // current index after a removal is intentional).
        var i: usize = 0;
        while (i < this.streams.count()) {
            const stream = this.streams.values()[i];
            if (this.deliverStream(stream)) {
                _ = this.streams.swapRemove(stream.id);
                stream.deinit();
            } else {
                i += 1;
            }
        }

        this.maybeRelease();
    }

    /// Socket onWritable entry point.
    pub fn onWritable(this: *ClientSession) void {
        this.ref();
        defer this.deref();
        _ = this.flush() catch |err| return this.failAll(err);
        this.drainSendBodies();
        _ = this.flush() catch |err| return this.failAll(err);
        this.reapAborted();
        this.maybeRelease();
    }

    /// Called while the socket is parked in the pool with no clients; answers
    /// PING/SETTINGS, records GOAWAY, discards anything stream-addressed.
    pub fn onIdleData(this: *ClientSession, incoming: []const u8) void {
        bun.handleOom(this.read_buffer.appendSlice(bun.default_allocator, incoming));
        this.parseFrames();
        this.replenishWindow();
        _ = this.flush() catch {
            this.fatal_error = error.WriteFailed;
        };
    }

    /// Socket onClose / onTimeout entry point. The socket is already gone, so
    /// streams just fail and the session is destroyed.
    pub fn onClose(this: *ClientSession, err: anyerror) void {
        this.ref();
        defer this.deref();
        this.ctx.unregisterH2(this);
        for (this.pending_attach.items) |client| client.failFromH2(err);
        this.pending_attach.clearRetainingCapacity();
        var it = this.streams.iterator();
        while (it.next()) |e| {
            const stream = e.value_ptr.*;
            const client = stream.client;
            stream.client = null;
            if (client) |c| c.h2 = null;
            stream.deinit();
            if (client) |c| c.failFromH2(err);
        }
        this.streams.clearRetainingCapacity();
        this.deref();
    }

    fn failAll(this: *ClientSession, err: anyerror) void {
        this.fatal_error = this.fatal_error orelse err;
        const sock = this.socket;
        NewHTTPContext(true).markSocketAsDead(sock);
        this.onClose(err);
        sock.close(.failure);
    }

    /// Called from the HTTP thread's shutdown queue when a fetch on this
    /// session is aborted. RST_STREAMs that one request; siblings continue.
    pub fn abortByHttpId(this: *ClientSession, async_http_id: u32) void {
        for (this.pending_attach.items, 0..) |client, i| {
            if (client.async_http_id == async_http_id) {
                _ = this.pending_attach.swapRemove(i);
                client.failFromH2(error.Aborted);
                return;
            }
        }
        var it = this.streams.iterator();
        while (it.next()) |e| {
            const stream = e.value_ptr.*;
            const client = stream.client orelse continue;
            if (client.async_http_id == async_http_id) {
                this.detachWithFailure(stream, error.Aborted);
                break;
            }
        }
        this.maybeRelease();
    }

    fn reapAborted(this: *ClientSession) void {
        var i: usize = 0;
        while (i < this.streams.count()) {
            const stream = this.streams.values()[i];
            const client = stream.client orelse {
                i += 1;
                continue;
            };
            if (client.signals.get(.aborted)) {
                this.detachWithFailure(stream, error.Aborted);
            } else {
                i += 1;
            }
        }
    }

    fn maybeRelease(this: *ClientSession) void {
        if (this.streams.count() > 0 or this.pending_attach.items.len > 0) return;
        this.ctx.unregisterH2(this);
        if (this.canPool() and !this.socket.isClosedOrHasError()) {
            this.ctx.releaseSocket(
                this.socket,
                this.did_have_handshaking_error,
                this.hostname,
                this.port,
                this.ssl_config,
                null,
                "",
                0,
                0,
                this,
            );
        } else {
            NewHTTPContext(true).closeSocket(this.socket);
            this.deref();
        }
    }

    /// Deliver any ready headers/body/error on `stream` to its client.
    /// Returns true when the stream is finished and should be removed.
    /// After a true return, neither `stream.client` nor the client's memory
    /// may be touched.
    fn deliverStream(this: *ClientSession, stream: *Stream) bool {
        const client = stream.client orelse return true;

        if (client.signals.get(.aborted)) {
            stream.rst(.CANCEL);
            _ = this.flush() catch {};
            stream.client = null;
            client.h2 = null;
            client.failFromH2(error.Aborted);
            return true;
        }

        if (stream.fatal_error) |err| {
            stream.client = null;
            client.h2 = null;
            client.failFromH2(err);
            return true;
        }

        client.setTimeout(this.socket, 5);

        if (stream.headers_ready) {
            stream.headers_ready = false;
            if (client.state.response_stage == .body) {
                this.decodeAndDiscard(stream);
            } else {
                const should_continue = this.decodeHeaders(stream, client) catch |err| {
                    stream.client = null;
                    client.h2 = null;
                    client.failFromH2(err);
                    return true;
                };
                if (should_continue == .finished or (stream.end_stream_received and stream.body_buffer.items.len == 0)) {
                    stream.client = null;
                    client.h2 = null;
                    if (client.state.flags.is_redirect_pending) {
                        client.doRedirect(true, this.ctx, this.socket);
                        return true;
                    }
                    client.cloneMetadata();
                    client.state.flags.received_last_chunk = true;
                    client.state.content_length = 0;
                    client.progressUpdate(true, this.ctx, this.socket);
                    return true;
                }
                client.cloneMetadata();
            }
        }

        if (client.state.response_stage != .body) return false;

        if (stream.body_buffer.items.len > 0) {
            const terminal = stream.end_stream_received;
            if (terminal) {
                client.state.flags.received_last_chunk = true;
                stream.client = null;
                client.h2 = null;
            }
            const report = client.handleResponseBody(stream.body_buffer.items, false) catch |err| {
                stream.body_buffer.clearRetainingCapacity();
                if (!terminal) {
                    stream.client = null;
                    client.h2 = null;
                }
                client.failFromH2(err);
                return true;
            };
            stream.body_buffer.clearRetainingCapacity();
            if (terminal or report) {
                client.progressUpdate(true, this.ctx, this.socket);
            }
            return terminal;
        }

        if (stream.end_stream_received) {
            stream.client = null;
            client.h2 = null;
            client.state.flags.received_last_chunk = true;
            client.progressUpdate(true, this.ctx, this.socket);
            return true;
        }

        return false;
    }

    fn dispatchFrame(this: *ClientSession, header: wire.FrameHeader, payload: []const u8) void {
        log("frame type={d} len={d} flags={d} stream={d}", .{ header.type, header.length, header.flags, header.streamIdentifier });

        if (this.expecting_continuation != 0 and header.type != @intFromEnum(wire.FrameType.HTTP_FRAME_CONTINUATION)) {
            this.fatal_error = error.HTTP2ProtocolError;
            return;
        }

        switch (@as(wire.FrameType, @enumFromInt(header.type))) {
            .HTTP_FRAME_SETTINGS => {
                if (header.flags & @intFromEnum(wire.SettingsFlags.ACK) != 0) return;
                var i: usize = 0;
                while (i + wire.SettingsPayloadUnit.byteSize <= payload.len) : (i += wire.SettingsPayloadUnit.byteSize) {
                    var unit: wire.SettingsPayloadUnit = undefined;
                    wire.SettingsPayloadUnit.from(&unit, payload[i .. i + wire.SettingsPayloadUnit.byteSize], 0, true);
                    switch (@as(wire.SettingsType, @enumFromInt(unit.type))) {
                        .SETTINGS_MAX_FRAME_SIZE => this.remote_max_frame_size = @truncate(@min(unit.value, wire.MAX_FRAME_SIZE)),
                        .SETTINGS_MAX_CONCURRENT_STREAMS => this.remote_max_concurrent_streams = unit.value,
                        .SETTINGS_INITIAL_WINDOW_SIZE => {
                            const next = @min(unit.value, @as(u32, wire.MAX_WINDOW_SIZE));
                            const delta = @as(i64, next) - @as(i64, this.remote_initial_window_size);
                            this.remote_initial_window_size = next;
                            for (this.streams.values()) |s| {
                                s.send_window = @intCast(std.math.clamp(@as(i64, s.send_window) + delta, std.math.minInt(i32), std.math.maxInt(i32)));
                            }
                        },
                        else => {},
                    }
                }
                this.writeFrame(.HTTP_FRAME_SETTINGS, @intFromEnum(wire.SettingsFlags.ACK), 0, &.{});
                this.settings_received = true;
            },
            .HTTP_FRAME_WINDOW_UPDATE => {
                if (payload.len < 4) return;
                const inc: i32 = @intCast(wire.UInt31WithReserved.fromBytes(payload[0..4]).uint31);
                if (header.streamIdentifier == 0) {
                    this.conn_send_window +|= inc;
                } else if (this.streams.get(@truncate(header.streamIdentifier & 0x7fffffff))) |stream| {
                    stream.send_window +|= inc;
                }
            },
            .HTTP_FRAME_PING => {
                if (header.flags & @intFromEnum(wire.PingFrameFlags.ACK) == 0) {
                    this.writeFrame(.HTTP_FRAME_PING, @intFromEnum(wire.PingFrameFlags.ACK), 0, payload[0..@min(payload.len, 8)]);
                }
            },
            .HTTP_FRAME_HEADERS => {
                const stream = this.streams.get(@intCast(header.streamIdentifier)) orelse return;
                stream.seen_headers = true;
                var fragment = payload;
                if (header.flags & @intFromEnum(wire.HeadersFrameFlags.PADDED) != 0) {
                    fragment = stripPadding(fragment) orelse {
                        this.fatal_error = error.HTTP2ProtocolError;
                        return;
                    };
                }
                if (header.flags & @intFromEnum(wire.HeadersFrameFlags.PRIORITY) != 0) {
                    if (fragment.len < wire.StreamPriority.byteSize) {
                        this.fatal_error = error.HTTP2ProtocolError;
                        return;
                    }
                    fragment = fragment[wire.StreamPriority.byteSize..];
                }
                stream.header_block.clearRetainingCapacity();
                bun.handleOom(stream.header_block.appendSlice(bun.default_allocator, fragment));
                stream.headers_end_stream = header.flags & @intFromEnum(wire.HeadersFrameFlags.END_STREAM) != 0;
                if (header.flags & @intFromEnum(wire.HeadersFrameFlags.END_HEADERS) != 0) {
                    stream.end_stream_received = stream.end_stream_received or stream.headers_end_stream;
                    stream.headers_ready = true;
                } else {
                    this.expecting_continuation = stream.id;
                }
            },
            .HTTP_FRAME_CONTINUATION => {
                if (this.expecting_continuation == 0 or header.streamIdentifier != this.expecting_continuation) {
                    this.fatal_error = error.HTTP2ProtocolError;
                    return;
                }
                const stream = this.streams.get(this.expecting_continuation) orelse {
                    this.fatal_error = error.HTTP2ProtocolError;
                    return;
                };
                bun.handleOom(stream.header_block.appendSlice(bun.default_allocator, payload));
                if (header.flags & @intFromEnum(wire.HeadersFrameFlags.END_HEADERS) != 0) {
                    this.expecting_continuation = 0;
                    stream.end_stream_received = stream.end_stream_received or stream.headers_end_stream;
                    stream.headers_ready = true;
                }
            },
            .HTTP_FRAME_DATA => {
                this.conn_unacked_bytes +|= header.length;
                const stream = this.streams.get(@intCast(header.streamIdentifier)) orelse return;
                if (!stream.seen_headers) {
                    stream.fatal_error = error.HTTP2ProtocolError;
                    return;
                }
                stream.unacked_bytes +|= header.length;
                var fragment = payload;
                if (header.flags & @intFromEnum(wire.DataFrameFlags.PADDED) != 0) {
                    fragment = stripPadding(fragment) orelse {
                        this.fatal_error = error.HTTP2ProtocolError;
                        return;
                    };
                }
                if (header.flags & @intFromEnum(wire.DataFrameFlags.END_STREAM) != 0) {
                    stream.end_stream_received = true;
                }
                if (fragment.len > 0) {
                    bun.handleOom(stream.body_buffer.appendSlice(bun.default_allocator, fragment));
                }
            },
            .HTTP_FRAME_RST_STREAM => {
                const stream = this.streams.get(@intCast(header.streamIdentifier)) orelse return;
                const code: u32 = if (payload.len >= 4) wire.u32FromBytes(payload[0..4]) else 0;
                if (code == @intFromEnum(wire.ErrorCode.NO_ERROR)) {
                    stream.end_stream_received = true;
                } else {
                    stream.fatal_error = error.HTTP2StreamReset;
                }
            },
            .HTTP_FRAME_GOAWAY => {
                this.goaway_received = true;
                this.goaway_last_stream_id = if (payload.len >= 4) wire.UInt31WithReserved.fromBytes(payload[0..4]).uint31 else 0;
                const code: u32 = if (payload.len >= 8) wire.u32FromBytes(payload[4..8]) else 0;
                var it = this.streams.iterator();
                while (it.next()) |e| {
                    const s = e.value_ptr.*;
                    if (code != @intFromEnum(wire.ErrorCode.NO_ERROR) or s.id > this.goaway_last_stream_id) {
                        s.fatal_error = error.HTTP2GoAway;
                    }
                }
            },
            .HTTP_FRAME_PUSH_PROMISE => this.fatal_error = error.HTTP2ProtocolError,
            else => {},
        }
    }

    fn decodeAndDiscard(this: *ClientSession, stream: *Stream) void {
        var offset: usize = 0;
        while (offset < stream.header_block.items.len) {
            const result = this.hpack.decode(stream.header_block.items[offset..]) catch break;
            offset += result.next;
        }
        stream.header_block.clearRetainingCapacity();
    }

    /// HPACK-decode `stream`'s header block into `state.pending_response`
    /// (reusing the shared HTTP/1.1 header buffer) and run
    /// `handleResponseMetadata`.
    fn decodeHeaders(this: *ClientSession, stream: *Stream, client: *HTTPClient) !HTTPClient.ShouldContinue {
        this.decoded_header_bytes.clearRetainingCapacity();

        var status_code: u32 = 0;
        const headers_buf = &HTTPClient.shared_response_headers_buf;
        var bounds: [headers_buf.len][3]u32 = undefined;
        var header_count: usize = 0;

        var offset: usize = 0;
        while (offset < stream.header_block.items.len) {
            const result = this.hpack.decode(stream.header_block.items[offset..]) catch {
                return error.HTTP2CompressionError;
            };
            offset += result.next;

            if (result.name.len > 0 and result.name[0] == ':') {
                if (strings.eqlComptime(result.name, ":status")) {
                    status_code = std.fmt.parseInt(u32, result.value, 10) catch 0;
                }
                continue;
            }
            if (header_count >= headers_buf.len) continue;

            const name_start: u32 = @intCast(this.decoded_header_bytes.items.len);
            bun.handleOom(this.decoded_header_bytes.appendSlice(bun.default_allocator, result.name));
            const value_start: u32 = @intCast(this.decoded_header_bytes.items.len);
            bun.handleOom(this.decoded_header_bytes.appendSlice(bun.default_allocator, result.value));
            const value_end: u32 = @intCast(this.decoded_header_bytes.items.len);
            bounds[header_count] = .{ name_start, value_start, value_end };
            header_count += 1;
        }
        stream.header_block.clearRetainingCapacity();

        const bytes = this.decoded_header_bytes.items;
        for (bounds[0..header_count], 0..) |b, i| {
            headers_buf[i] = .{ .name = bytes[b[0]..b[1]], .value = bytes[b[1]..b[2]] };
        }

        var response = picohttp.Response{
            .minor_version = 0,
            .status_code = status_code,
            .status = "",
            .headers = .{ .list = headers_buf[0..header_count] },
            .bytes_read = 0,
        };
        client.state.pending_response = response;

        const should_continue = try client.handleResponseMetadata(&response);
        // h2 framing delimits the body; chunked transfer-encoding and the
        // HTTP/1.1 "no Content-Length ⇒ no keep-alive" rule don't apply.
        client.state.transfer_encoding = .identity;
        if (client.state.response_stage == .body_chunk) client.state.response_stage = .body;
        client.state.flags.allow_keepalive = true;

        if (client.state.content_encoding_i < response.headers.list.len and !client.state.flags.did_set_content_encoding) {
            client.state.flags.did_set_content_encoding = true;
            client.state.content_encoding_i = std.math.maxInt(@TypeOf(client.state.content_encoding_i));
            client.state.pending_response = response;
        }

        return should_continue;
    }
};

/// Placeholder registered while a fresh TLS connect is in flight so that
/// concurrent h2-capable requests to the same origin coalesce onto its
/// eventual session instead of each opening a separate socket.
pub const PendingConnect = struct {
    pub const new = bun.TrivialNew(@This());

    hostname: []const u8,
    port: u16,
    ssl_config: ?*SSLConfig,
    waiters: std.ArrayListUnmanaged(*HTTPClient) = .{},

    pub fn matches(this: *const PendingConnect, hostname: []const u8, port: u16, ssl_config: ?*SSLConfig) bool {
        return this.port == port and this.ssl_config == ssl_config and strings.eqlLong(this.hostname, hostname, true);
    }

    pub fn unregisterFrom(this: *PendingConnect, ctx: *NewHTTPContext(true)) void {
        const list = &ctx.pending_h2_connects;
        for (list.items, 0..) |p, i| {
            if (p == this) {
                _ = list.swapRemove(i);
                return;
            }
        }
    }

    pub fn deinit(this: *PendingConnect) void {
        bun.default_allocator.free(this.hostname);
        this.waiters.deinit(bun.default_allocator);
        bun.destroy(this);
    }
};

const log = bun.Output.scoped(.h2_client, .hidden);

const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const picohttp = bun.picohttp;

const HTTPClient = bun.http;
const NewHTTPContext = HTTPClient.NewHTTPContext;
const SSLConfig = bun.api.server.ServerConfig.SSLConfig;

const wire = @import("./H2FrameParser.zig");
const lshpack = @import("../bun.js/api/bun/lshpack.zig");
