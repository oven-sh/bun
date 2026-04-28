//! One TCP+TLS connection running the HTTP/2 protocol for `fetch()`. Owns the
//! socket, the connection-scoped HPACK tables, and a map of active `Stream`s.
//! See `src/http/H2Client.zig` for the module-level overview.

const ClientSession = @This();

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
/// Set when the HPACK encoder's dynamic table has diverged from the
/// server's view (writeRequest failed mid-encode). Existing siblings whose
/// HEADERS already went out are unaffected, but no new stream may be
/// opened on this connection.
encoder_poisoned: bool = false,
/// True while onData's deliver loop is running. retryFromH2/doRedirect
/// re-dispatch may try to adopt back onto this same session; blocking
/// that during delivery prevents `streams` mutation under iteration and
/// the failAll → onClose → double-free path.
delivering: bool = false,
/// Set by `dispatchFrame` when the inbound batch carried a frame that
/// advanced an active stream (HEADERS/DATA/WINDOW_UPDATE on a tracked id).
/// `onData` only re-arms the idle timer when this is true so a server
/// can't keep a stalled upload alive forever with bare PINGs.
stream_progressed: bool = false,
goaway_last_stream_id: u31 = 0,
fatal_error: ?anyerror = null,
/// HEADERS/CONTINUATION fragments for a stream we no longer track (e.g.
/// in flight when we RST'd it). RFC 9113 §4.3 still requires the block be
/// fed to the HPACK decoder so the connection-level dynamic table stays
/// in sync.
orphan_header_block: std.ArrayListUnmanaged(u8) = .{},
/// Reused HPACK-encode scratch for `writeRequest` so each request doesn't
/// alloc/free its own header-block buffer.
encode_scratch: std.ArrayListUnmanaged(u8) = .{},

remote_max_frame_size: u24 = wire.DEFAULT_MAX_FRAME_SIZE,
remote_max_concurrent_streams: u32 = 100,
remote_initial_window_size: u32 = wire.DEFAULT_WINDOW_SIZE,
/// SETTINGS_HEADER_TABLE_SIZE received from the peer that hasn't yet been
/// acknowledged with a Dynamic Table Size Update (RFC 7541 §6.3) at the
/// start of a header block. lshpack's encoder doesn't emit that opcode
/// itself, so writeRequest must prepend it before the first encode call.
pending_hpack_enc_capacity: ?u32 = null,
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
    _ = H2.live_sessions.fetchAdd(1, .monotonic);
    ctx.registerH2(this);
    return this;
}

fn deinit(this: *ClientSession) void {
    _ = H2.live_sessions.fetchSub(1, .monotonic);
    bun.debugAssert(this.registry_index == std.math.maxInt(u32));
    this.hpack.deinit();
    this.write_buffer.deinit();
    this.read_buffer.deinit(bun.default_allocator);
    var it = this.streams.iterator();
    while (it.next()) |e| e.value_ptr.*.deinit();
    this.streams.deinit(bun.default_allocator);
    this.pending_attach.deinit(bun.default_allocator);
    this.orphan_header_block.deinit(bun.default_allocator);
    this.encode_scratch.deinit(bun.default_allocator);
    bun.default_allocator.free(this.hostname);
    if (this.ssl_config) |*s| s.deinit();
    bun.destroy(this);
}

pub fn hasHeadroom(this: *const ClientSession) bool {
    return !this.goaway_received and
        !this.encoder_poisoned and
        this.fatal_error == null and
        this.streams.count() < this.remote_max_concurrent_streams and
        this.next_stream_id < wire.MAX_STREAM_ID;
}

pub fn matches(this: *const ClientSession, hostname: []const u8, port: u16, ssl_config: ?*SSLConfig) bool {
    return this.port == port and SSLConfig.rawPtr(this.ssl_config) == ssl_config and strings.eqlLong(this.hostname, hostname, true);
}

pub fn adopt(this: *ClientSession, client: *HTTPClient) void {
    client.registerAbortTracker(true, this.socket);
    // Park instead of attaching when (a) we're inside onData's deliver
    // loop — attach() mustn't mutate `streams` under iteration — or (b)
    // the server's first SETTINGS hasn't arrived yet, so the real
    // MAX_CONCURRENT_STREAMS isn't known and a non-replayable body
    // shouldn't risk a REFUSED_STREAM. The leader bypasses adopt() and
    // attaches directly so the preface still goes out.
    if (this.delivering or !this.settings_received) {
        bun.handleOom(this.pending_attach.append(bun.default_allocator, client));
        this.rearmTimeout();
        return;
    }
    // Belt-and-suspenders: callers gate on hasHeadroom(), but a session
    // pulled from the keep-alive pool (HTTPContext.existingSocket) may have
    // remote_max_concurrent_streams == 0 if a mid-connection SETTINGS
    // dropped it. Re-dispatch instead of asserting in attach().
    if (!this.hasHeadroom()) {
        client.retryAfterH2Coalesce();
        this.maybeRelease();
        return;
    }
    this.attach(client);
}

/// Park a coalesced request until the server's SETTINGS arrive. Abort
/// is routed via the session socket so `abortByHttpId` can find it.
pub fn enqueue(this: *ClientSession, client: *HTTPClient) void {
    client.registerAbortTracker(true, this.socket);
    bun.handleOom(this.pending_attach.append(bun.default_allocator, client));
    this.rearmTimeout();
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
        !this.encoder_poisoned and
        this.fatal_error == null and
        this.expecting_continuation == 0 and
        this.read_buffer.items.len == 0 and
        this.write_buffer.isEmpty() and
        this.remote_max_concurrent_streams > 0 and
        this.next_stream_id < wire.MAX_STREAM_ID;
}

pub fn queue(this: *ClientSession, bytes: []const u8) void {
    bun.handleOom(this.write_buffer.write(bytes));
}

pub fn writeFrame(this: *ClientSession, frame_type: wire.FrameType, flags: u8, stream_id: u32, payload: []const u8) void {
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
    _ = H2.live_streams.fetchAdd(1, .monotonic);
    this.next_stream_id +|= 2;
    bun.handleOom(this.streams.put(bun.default_allocator, stream.id, stream));
    client.h2 = stream;
    client.flags.protocol = .http2;
    client.allow_retry = false;

    if (!this.preface_sent) encode.writePreface(this);

    this.rearmTimeout();
    const request = client.buildRequest(client.state.original_request_body.len());
    encode.writeRequest(this, client, stream, request) catch |err| {
        // encodeHeader pushes into the HPACK encoder's dynamic table per
        // call, so a mid-encode failure leaves entries the server will
        // never see. Mark the session unusable for future streams and
        // remove without RST — from the server's view this stream id was
        // never opened (RST on an idle stream is a connection error per
        // RFC 9113 §5.1).
        this.encoder_poisoned = true;
        _ = this.streams.swapRemove(stream.id);
        stream.deinit();
        client.h2 = null;
        client.failFromH2(err);
        // The poisoned session is dead for new work; bounce any waiters
        // and let maybeRelease() drop the registration so the next fetch
        // opens a fresh connection instead of waiting for idle-timeout.
        for (this.pending_attach.items) |c| c.retryAfterH2Coalesce();
        this.pending_attach.clearRetainingCapacity();
        _ = this.flush() catch {};
        this.maybeRelease();
        return;
    };
    if (client.verbose != .none) {
        HTTPClient.printRequest(request, client.url.href, !client.flags.reject_unauthorized, client.state.request_body, client.verbose == .curl);
    }
    client.state.request_stage = if (stream.localClosed()) .done else .body;
    client.state.response_stage = .headers;

    _ = this.flush() catch |err| {
        this.failAll(err);
        return;
    };

    if (client.flags.is_streaming_request_body) {
        client.progressUpdate(true, this.ctx, this.socket);
    }
}

/// Unlink `stream` from the session map and free it. If the stream was
/// mid-CONTINUATION (HEADERS arrived without END_HEADERS), the buffered
/// fragment is moved to `orphan_header_block` so the trailing CONTINUATION
/// frames decode against the full block — otherwise HPACK-decoding the
/// suffix alone desyncs the dynamic table for every sibling stream.
fn removeStream(this: *ClientSession, stream: *Stream) void {
    if (this.expecting_continuation == stream.id) {
        this.orphan_header_block.deinit(bun.default_allocator);
        this.orphan_header_block = stream.header_block;
        stream.header_block = .{};
    }
    _ = this.streams.swapRemove(stream.id);
    stream.deinit();
}

/// Remove `stream` from the session, RST it, and fail its client. The
/// session and socket stay up for siblings.
pub fn detachWithFailure(this: *ClientSession, stream: *Stream, err: anyerror) void {
    stream.rst(.CANCEL);
    _ = this.flush() catch {};
    const client = stream.client;
    stream.client = null;
    if (client) |c| c.h2 = null;
    this.removeStream(stream);
    if (client) |c| c.failFromH2(err);
}

/// Re-arm the shared socket's idle timer based on the aggregate of every
/// attached client. With multiplexed streams the per-request
/// `disable_timeout` flag can't drive the socket directly (last writer
/// would win and a `{timeout:false}` long-poll could be killed by a
/// sibling re-arming, or strip the safety net from one that wants it),
/// so the session disarms only when *every* attached client opted out.
fn rearmTimeout(this: *ClientSession) void {
    const want = blk: {
        for (this.streams.values()) |s| {
            const c = s.client orelse continue;
            if (!c.flags.disable_timeout) break :blk true;
        }
        for (this.pending_attach.items) |c| {
            if (!c.flags.disable_timeout) break :blk true;
        }
        break :blk false;
    };
    this.socket.timeout(0);
    this.socket.setTimeoutMinutes(if (want) 5 else 0);
}

/// HTTP-thread wake-up from `scheduleResponseBodyDrain`: JS just enabled
/// `response_body_streaming`, so flush any body bytes that arrived between
/// metadata delivery and `getReader()`.
pub fn drainResponseBodyByHttpId(this: *ClientSession, async_http_id: u32) void {
    this.ref();
    defer this.deref();
    for (this.streams.values()) |stream| {
        const client = stream.client orelse continue;
        if (client.async_http_id != async_http_id) continue;
        client.drainResponseBody(true, this.socket);
        return;
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
        this.rearmTimeout();
        encode.drainSendBody(this, stream, std.math.maxInt(usize));
        _ = this.flush() catch |err| this.failAll(err);
        return;
    }
}

pub fn writeWindowUpdate(this: *ClientSession, stream_id: u32, increment: u31) void {
    var value: u32 = @byteSwap(@as(u32, increment));
    this.writeFrame(.HTTP_FRAME_WINDOW_UPDATE, 0, stream_id, std.mem.asBytes(&value));
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
        if (s.unacked_bytes >= threshold and !s.remoteClosed()) {
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

/// Socket onData entry point. Parse frames into per-stream state, deliver
/// each ready stream to its client, then pool or close if no streams
/// remain. Structured "parse all → deliver all" because delivering may
/// free the client.
pub fn onData(this: *ClientSession, incoming: []const u8) void {
    this.ref();
    defer this.deref();
    this.stream_progressed = false;
    if (this.read_buffer.items.len == 0) {
        const consumed = dispatch.parseFrames(this, incoming);
        if (consumed < incoming.len and this.fatal_error == null) {
            bun.handleOom(this.read_buffer.appendSlice(bun.default_allocator, incoming[consumed..]));
        }
    } else {
        bun.handleOom(this.read_buffer.appendSlice(bun.default_allocator, incoming));
        const consumed = dispatch.parseFrames(this, this.read_buffer.items);
        const tail = this.read_buffer.items.len - consumed;
        if (tail > 0 and consumed > 0) {
            std.mem.copyForwards(u8, this.read_buffer.items[0..tail], this.read_buffer.items[consumed..]);
        }
        this.read_buffer.items.len = tail;
    }

    if (this.flush() catch blk: {
        this.fatal_error = error.WriteFailed;
        break :blk false;
    }) {}

    if (this.fatal_error) |err| return this.failAll(err);

    this.drainPending();
    // attach()'s flush() can failAll() from inside the loop above; if so the
    // session has already torn down — bail before maybeRelease() double-derefs.
    if (this.fatal_error != null) return;
    encode.drainSendBodies(this);
    _ = this.flush() catch |err| return this.failAll(err);

    // Deliver per-stream. Iterate by index because delivery may remove
    // entries (swapRemove keeps earlier indices stable; revisiting the
    // current index after a removal is intentional). `delivering` makes
    // adopt() park retryFromH2/doRedirect re-dispatches in pending_attach
    // so `streams` isn't mutated under this iteration.
    this.delivering = true;
    var i: usize = 0;
    var rst_any = false;
    while (i < this.streams.count()) {
        const stream = this.streams.values()[i];
        if (this.deliverStream(stream)) {
            // Any detach that leaves the stream open from the server's
            // perspective (we never sent END_STREAM, *or* the server
            // never did and hasn't RST'd) must signal abandonment so the
            // server can release its concurrency slot. rst() is idempotent.
            if (stream.state != .closed) {
                stream.rst(.CANCEL);
                rst_any = true;
            }
            this.removeStream(stream);
        } else {
            i += 1;
        }
    }
    this.delivering = false;
    this.replenishWindow();
    if (rst_any or this.write_buffer.isNotEmpty()) _ = this.flush() catch {};
    // PING/SETTINGS-ACK alone don't reset the idle timer; only frames that
    // moved a stream (HEADERS/DATA/WINDOW_UPDATE on an active id) do.
    if (this.stream_progressed) this.rearmTimeout();

    // Retries/redirects that re-dispatched onto this session during the
    // loop are parked in pending_attach; attach them now that iteration
    // is finished.
    if (this.pending_attach.items.len > 0) {
        this.drainPending();
        if (this.fatal_error != null) return;
        _ = this.flush() catch |err| return this.failAll(err);
    }

    this.maybeRelease();
}

/// Socket onWritable entry point.
pub fn onWritable(this: *ClientSession) void {
    this.ref();
    defer this.deref();
    _ = this.flush() catch |err| return this.failAll(err);
    encode.drainSendBodies(this);
    _ = this.flush() catch |err| return this.failAll(err);
    this.reapAborted();
    this.rearmTimeout();
    this.maybeRelease();
}

/// Called while the socket is parked in the pool with no clients; answers
/// PING/SETTINGS, records GOAWAY, discards anything stream-addressed.
pub fn onIdleData(this: *ClientSession, incoming: []const u8) void {
    bun.handleOom(this.read_buffer.appendSlice(bun.default_allocator, incoming));
    const consumed = dispatch.parseFrames(this, this.read_buffer.items);
    const tail = this.read_buffer.items.len - consumed;
    if (tail > 0 and consumed > 0) {
        std.mem.copyForwards(u8, this.read_buffer.items[0..tail], this.read_buffer.items[consumed..]);
    }
    this.read_buffer.items.len = tail;
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
    // RFC 9113 §5.4.1: an endpoint that encounters a connection error
    // SHOULD first send GOAWAY. Best-effort only; the socket may already
    // be dead.
    if (!sock.isClosedOrHasError()) {
        var goaway: [8]u8 = undefined;
        std.mem.writeInt(u32, goaway[0..4], 0, .big);
        std.mem.writeInt(u32, goaway[4..8], @intFromEnum(dispatch.errorCodeFor(err)), .big);
        this.writeFrame(.HTTP_FRAME_GOAWAY, 0, 0, &goaway);
        _ = this.flush() catch {};
    }
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
            this.rearmTimeout();
            this.maybeRelease();
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
    this.rearmTimeout();
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
        // Only transparently retry when the server refused the stream
        // before producing any of it (REFUSED_STREAM after HEADERS would
        // be a server bug, but retrying then re-streams a body prefix
        // into a Response that JS already holds — silent corruption).
        if (err == error.HTTP2RefusedStream and
            stream.status_code == 0 and
            client.h2_retries < HTTPClient.max_h2_retries and
            client.state.original_request_body == .bytes)
        {
            client.retryFromH2();
        } else {
            client.failFromH2(err);
        }
        return true;
    }

    if (stream.headers_ready) {
        stream.headers_ready = false;
        const result = this.applyHeaders(stream, client) catch |err| {
            stream.rst(.CANCEL);
            _ = this.flush() catch {};
            stream.client = null;
            client.h2 = null;
            client.failFromH2(err);
            return true;
        };
        // handleResponseMetadata set is_redirect_pending. The doRedirect
        // contract assumes the caller already detached the stream
        // (http.zig:1062). Detach + RST here unconditionally so the
        // header_progress path below can never re-enter doRedirect via
        // progressUpdate while the old Stream still points at this
        // client — that path would attach a second Stream to the same
        // HTTPClient and the first one's `stream.client` becomes a
        // dangling pointer once the request completes.
        if (client.state.flags.is_redirect_pending) {
            stream.rst(.CANCEL);
            _ = this.flush() catch {};
            stream.client = null;
            client.h2 = null;
            client.doRedirect(true, this.ctx, this.socket);
            return true;
        }
        if (result == .finished or (stream.remoteClosed() and stream.body_buffer.items.len == 0)) {
            stream.client = null;
            client.h2 = null;
            client.cloneMetadata();
            client.state.flags.received_last_chunk = true;
            // .finished = HEAD/204/304: no body is expected regardless of
            // any Content-Length header, so clear it. Otherwise leave the
            // parsed value so finishStream() enforces §8.1.1 against the
            // (zero) bytes actually received.
            if (result == .finished) client.state.content_length = 0;
            return this.finishStream(stream, client);
        }
        client.cloneMetadata();
        // Mirror the h1 path (http.zig handleOnDataHeaders): deliver headers
        // to JS now so `await fetch()` resolves and `getReader()` can enable
        // response_body_streaming. Without this, a content-length response
        // buffers the entire body before the Response promise settles.
        if (client.signals.get(.header_progress)) {
            client.progressUpdate(true, this.ctx, this.socket);
        }
    }

    if (client.state.response_stage != .body) return false;

    if (stream.body_buffer.items.len > 0) {
        const terminal = stream.remoteClosed();
        if (terminal) {
            client.state.flags.received_last_chunk = true;
            stream.client = null;
            client.h2 = null;
        }
        const report = client.handleResponseBody(stream.body_buffer.items, false) catch |err| {
            stream.body_buffer.clearRetainingCapacity();
            stream.rst(.CANCEL);
            _ = this.flush() catch {};
            if (!terminal) {
                stream.client = null;
                client.h2 = null;
            }
            client.failFromH2(err);
            return true;
        };
        stream.body_buffer.clearRetainingCapacity();
        if (terminal) return this.finishStream(stream, client);
        if (report) {
            // handleResponseBody may report completion before END_STREAM
            // (Content-Length satisfied). The terminal progressUpdate
            // path frees the AsyncHTTP that owns `client`, so detach
            // first; the trailing END_STREAM/trailers land on a stream
            // we no longer track and are discarded.
            if (client.state.isDone()) {
                stream.client = null;
                client.h2 = null;
                client.progressUpdate(true, this.ctx, this.socket);
                return true;
            }
            client.progressUpdate(true, this.ctx, this.socket);
        }
        return false;
    }

    if (stream.remoteClosed()) {
        stream.client = null;
        client.h2 = null;
        client.state.flags.received_last_chunk = true;
        return this.finishStream(stream, client);
    }

    return false;
}

/// Terminal delivery: enforce the announced Content-Length (RFC 9113
/// §8.1.1 — mismatch is malformed) and hand off to progressUpdate.
/// `total_body_received` is clamped at content_length by the body handler,
/// so compare the raw DATA byte count instead — that catches overshoot too.
fn finishStream(this: *ClientSession, stream: *Stream, client: *HTTPClient) bool {
    if (client.state.content_length) |cl| {
        if (stream.data_bytes_received != cl) {
            client.failFromH2(error.HTTP2ContentLengthMismatch);
            return true;
        }
    }
    client.progressUpdate(true, this.ctx, this.socket);
    return true;
}

const HeaderResult = enum { has_body, finished };

/// Hand the pre-decoded response headers to the existing HTTP/1.1
/// metadata pipeline (`handleResponseMetadata` + `cloneMetadata`).
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
    // handleResponseMetadata may mutate *response (e.g. the 304 rewrite for
    // force_last_modified); cloneMetadata reads pending_response, so re-sync.
    client.state.pending_response = response;
    // h2 framing delimits the body; chunked transfer-encoding and the
    // HTTP/1.1 "no Content-Length ⇒ no keep-alive" rule don't apply.
    client.state.transfer_encoding = .identity;
    if (client.state.response_stage == .body_chunk) client.state.response_stage = .body;
    client.state.flags.allow_keepalive = true;

    return if (should_continue == .finished) .finished else .has_body;
}

const Stream = @import("./Stream.zig");
const dispatch = @import("./dispatch.zig");
const encode = @import("./encode.zig");
const lshpack = @import("../../bun.js/api/bun/lshpack.zig");
const std = @import("std");
const wire = @import("../H2FrameParser.zig");

const H2 = @import("../H2Client.zig");
const local_initial_window_size = H2.local_initial_window_size;

const bun = @import("bun");
const picohttp = bun.picohttp;
const strings = bun.strings;
const SSLConfig = bun.api.server.ServerConfig.SSLConfig;

const HTTPClient = bun.http;
const NewHTTPContext = HTTPClient.NewHTTPContext;
