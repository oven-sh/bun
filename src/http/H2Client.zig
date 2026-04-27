//! HTTP/2 path for Bun's fetch HTTP client.
//!
//! A `ClientSession` owns the connection-scoped state — HPACK tables,
//! outbound write buffer, inbound frame buffer, and the server's SETTINGS —
//! and survives across requests via the keep-alive pool. Each request runs on
//! a `Stream` carved out of the session with a fresh odd stream id; the
//! response side parses frames back into the existing `picohttp.Response` /
//! `handleResponseBody` machinery so redirects, decompression and the result
//! callback are shared with the HTTP/1.1 path.

/// We advertise this as SETTINGS_INITIAL_WINDOW_SIZE and replenish it via
/// WINDOW_UPDATE once half has been consumed.
pub const local_initial_window_size: u31 = 1 << 24;

pub const Stream = struct {
    id: u31,

    /// Concatenated header-block fragment from HEADERS + any CONTINUATION
    /// frames, decoded once END_HEADERS arrives.
    header_block: std.ArrayListUnmanaged(u8) = .{},

    /// DATA payload accumulated across one onData() pass; handed to
    /// `handleResponseBody` once after all frames in the current read have
    /// been parsed so the client callback runs at most once per socket read.
    body_buffer: std.ArrayListUnmanaged(u8) = .{},

    end_stream_received: bool = false,
    headers_ready: bool = false,
    expecting_continuation: bool = false,
    headers_end_stream: bool = false,
    fatal_error: ?anyerror = null,

    /// DATA bytes consumed since the last WINDOW_UPDATE for this stream.
    unacked_bytes: u32 = 0,

    fn deinit(this: *Stream) void {
        this.header_block.deinit(bun.default_allocator);
        this.body_buffer.deinit(bun.default_allocator);
    }
};

pub const ClientSession = struct {
    pub const new = bun.TrivialNew(@This());

    hpack: *lshpack.HPACK,

    /// Bytes queued for the socket. Whole frames are written here and
    /// `flush()` drains as much as the socket accepts.
    write_buffer: bun.io.StreamBuffer = .{},

    /// Accumulates incoming bytes until a full 9-byte frame header + declared
    /// payload length is available, so frame handlers always see complete
    /// frames regardless of how the kernel chunked the reads.
    read_buffer: std.ArrayListUnmanaged(u8) = .{},

    /// Backing storage for decoded header name/value strings. lshpack returns
    /// thread-local slices that are clobbered on the next decode call, so we
    /// copy them here and point `shared_response_headers_buf` entries into
    /// this buffer until `cloneMetadata` makes its own copy.
    decoded_header_bytes: std.ArrayListUnmanaged(u8) = .{},

    stream: Stream = .{ .id = 1 },
    next_stream_id: u31 = 1,
    preface_sent: bool = false,
    goaway_received: bool = false,
    fatal_error: ?anyerror = null,

    remote_max_frame_size: u24 = wire.DEFAULT_MAX_FRAME_SIZE,
    remote_max_concurrent_streams: u32 = std.math.maxInt(u32),

    /// DATA bytes consumed since the last connection-level WINDOW_UPDATE.
    conn_unacked_bytes: u32 = 0,

    pub fn create() *ClientSession {
        return ClientSession.new(.{
            .hpack = lshpack.HPACK.init(4096),
        });
    }

    pub fn deinit(this: *ClientSession) void {
        this.hpack.deinit();
        this.write_buffer.deinit();
        this.read_buffer.deinit(bun.default_allocator);
        this.decoded_header_bytes.deinit(bun.default_allocator);
        this.stream.deinit();
        bun.destroy(this);
    }

    /// Allocate a fresh stream id for the next request on this connection.
    /// Connection-scoped state (HPACK, settings, read/write buffers) is
    /// preserved; per-stream parse state is reset.
    pub fn beginStream(this: *ClientSession) void {
        this.stream.deinit();
        this.stream = .{ .id = this.next_stream_id };
        this.next_stream_id +|= 2;
    }

    /// True when the connection can be returned to the keep-alive pool: no
    /// GOAWAY, no protocol error, no leftover bytes that would confuse the
    /// next request, and stream-id space not exhausted.
    pub fn canPool(this: *const ClientSession) bool {
        return !this.goaway_received and
            this.fatal_error == null and
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
        // RFC 9113 §8.2.2: connection-specific headers MUST NOT appear in an
        // HTTP/2 field block. `Host` is mapped to :authority.
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

    /// Serialise the request as HEADERS frame(s) + DATA frame(s) into the
    /// outbound buffer. The connection preface goes out once per session.
    pub fn writeRequest(this: *ClientSession, client: *HTTPClient, request: picohttp.Request) !void {
        if (!this.preface_sent) this.writePreface();

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
            // RFC 9113 §8.2.1: field names MUST be lowercase.
            const lowered = if (header.name.len <= lower_buf.len) brk: {
                for (header.name, 0..) |c, i| lower_buf[i] = std.ascii.toLower(c);
                break :brk lower_buf[0..header.name.len];
            } else header.name;
            try this.encodeHeader(&encoded, lowered, header.value, never_index);
        }

        const body = client.state.request_body;
        const has_body = client.state.original_request_body == .bytes and body.len > 0;

        this.writeHeaderBlock(encoded.items, !has_body);
        if (has_body) this.writeData(body, true);
    }

    fn writeHeaderBlock(this: *ClientSession, block: []const u8, end_stream: bool) void {
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
            this.writeFrame(if (first) .HTTP_FRAME_HEADERS else .HTTP_FRAME_CONTINUATION, flags, this.stream.id, chunk);
            first = false;
            if (last) break;
        }
    }

    fn writeData(this: *ClientSession, body: []const u8, end_stream: bool) void {
        const max: usize = this.remote_max_frame_size;
        var remaining = body;
        while (true) {
            const chunk = remaining[0..@min(remaining.len, max)];
            remaining = remaining[chunk.len..];
            const last = remaining.len == 0;
            const flags: u8 = if (last and end_stream) @intFromEnum(wire.DataFrameFlags.END_STREAM) else 0;
            this.writeFrame(.HTTP_FRAME_DATA, flags, this.stream.id, chunk);
            if (last) break;
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

    fn decodeAndDiscard(this: *ClientSession) void {
        var offset: usize = 0;
        while (offset < this.stream.header_block.items.len) {
            const result = this.hpack.decode(this.stream.header_block.items[offset..]) catch break;
            offset += result.next;
        }
        this.stream.header_block.clearRetainingCapacity();
    }

    /// Credit consumed DATA bytes back to the peer once half the advertised
    /// window has been used, on both the connection and the active stream.
    fn replenishWindow(this: *ClientSession) void {
        const threshold = local_initial_window_size / 2;
        if (this.conn_unacked_bytes >= threshold) {
            this.writeWindowUpdate(0, @intCast(this.conn_unacked_bytes));
            this.conn_unacked_bytes = 0;
        }
        if (this.stream.unacked_bytes >= threshold and !this.stream.end_stream_received) {
            this.writeWindowUpdate(this.stream.id, @intCast(this.stream.unacked_bytes));
            this.stream.unacked_bytes = 0;
        }
    }

    /// Process frames that arrive while the session is parked in the
    /// keep-alive pool with no request attached. Answers PING/SETTINGS,
    /// records GOAWAY (so `canPool()` flips false), and discards anything
    /// addressed to a now-closed stream.
    pub fn onIdleData(this: *ClientSession, comptime is_ssl: bool, incoming: []const u8, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
        bun.handleOom(this.read_buffer.appendSlice(bun.default_allocator, incoming));
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
        }
        if (consumed > 0) {
            const tail_len = this.read_buffer.items.len - consumed;
            if (tail_len > 0) {
                std.mem.copyForwards(u8, this.read_buffer.items[0..tail_len], this.read_buffer.items[consumed..]);
            }
            this.read_buffer.items.len = tail_len;
        }
        this.stream.body_buffer.clearRetainingCapacity();
        this.stream.header_block.clearRetainingCapacity();
        _ = this.flush(is_ssl, socket) catch {
            this.fatal_error = error.WriteFailed;
        };
    }

    /// Drain the outbound buffer to the socket. Returns true when bytes
    /// remain (backpressure) so the caller knows to wait for onWritable.
    pub fn flush(this: *ClientSession, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) !bool {
        const pending = this.write_buffer.slice();
        if (pending.len == 0) return false;
        var remaining = pending;
        var total: usize = 0;
        while (remaining.len > 0) {
            const wrote = socket.write(remaining);
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

    /// Parse every complete frame in `incoming` into session-local state, then
    /// hand the accumulated headers/body to the HTTPClient. Structured as
    /// "parse all, then deliver once" because `progressUpdate` may free the
    /// client (and this session) synchronously when the request finishes.
    pub fn onData(
        this: *ClientSession,
        client: *HTTPClient,
        comptime is_ssl: bool,
        incoming: []const u8,
        ctx: *NewHTTPContext(is_ssl),
        socket: NewHTTPContext(is_ssl).HTTPSocket,
    ) void {
        bun.handleOom(this.read_buffer.appendSlice(bun.default_allocator, incoming));

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

        this.replenishWindow();
        _ = this.flush(is_ssl, socket) catch |err| {
            return client.closeAndFail(err, is_ssl, socket);
        };

        const stream = &this.stream;

        if (this.fatal_error) |err| return client.closeAndFail(err, is_ssl, socket);
        if (stream.fatal_error) |err| {
            if (client.allow_retry) return client.retryH2(is_ssl, socket);
            return client.closeAndFail(err, is_ssl, socket);
        }

        if (stream.headers_ready) {
            stream.headers_ready = false;
            if (client.state.response_stage == .body) {
                // Trailer block: decode to keep HPACK state coherent but
                // don't replace the already-delivered response metadata.
                this.decodeAndDiscard();
            } else {
                const should_continue = this.deliverHeaders(client) catch |err| {
                    return client.closeAndFail(err, is_ssl, socket);
                };
                if (should_continue == .finished or (stream.end_stream_received and stream.body_buffer.items.len == 0)) {
                    if (client.state.flags.is_redirect_pending) {
                        return client.doRedirect(is_ssl, ctx, socket);
                    }
                    client.cloneMetadata();
                    client.state.flags.received_last_chunk = true;
                    client.state.content_length = 0;
                    return client.progressUpdate(is_ssl, ctx, socket);
                }
                client.cloneMetadata();
            }
        }

        if (client.state.response_stage != .body) return;

        if (stream.body_buffer.items.len > 0) {
            if (stream.end_stream_received) client.state.flags.received_last_chunk = true;
            const report = client.handleResponseBody(stream.body_buffer.items, false) catch |err| {
                return client.closeAndFail(err, is_ssl, socket);
            };
            stream.body_buffer.clearRetainingCapacity();
            if (report or stream.end_stream_received) {
                return client.progressUpdate(is_ssl, ctx, socket);
            }
            return;
        }

        if (stream.end_stream_received) {
            client.state.flags.received_last_chunk = true;
            return client.progressUpdate(is_ssl, ctx, socket);
        }
    }

    fn dispatchFrame(this: *ClientSession, header: wire.FrameHeader, payload: []const u8) void {
        log("frame type={d} len={d} flags={d} stream={d}", .{ header.type, header.length, header.flags, header.streamIdentifier });

        const stream = &this.stream;

        if (stream.expecting_continuation and header.type != @intFromEnum(wire.FrameType.HTTP_FRAME_CONTINUATION)) {
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
                        else => {},
                    }
                }
                this.writeFrame(.HTTP_FRAME_SETTINGS, @intFromEnum(wire.SettingsFlags.ACK), 0, &.{});
            },
            .HTTP_FRAME_WINDOW_UPDATE => {},
            .HTTP_FRAME_PING => {
                if (header.flags & @intFromEnum(wire.PingFrameFlags.ACK) == 0) {
                    this.writeFrame(.HTTP_FRAME_PING, @intFromEnum(wire.PingFrameFlags.ACK), 0, payload[0..@min(payload.len, 8)]);
                }
            },
            .HTTP_FRAME_HEADERS => {
                if (header.streamIdentifier != stream.id) return;
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
                    stream.expecting_continuation = true;
                }
            },
            .HTTP_FRAME_CONTINUATION => {
                if (!stream.expecting_continuation or header.streamIdentifier != stream.id) {
                    this.fatal_error = error.HTTP2ProtocolError;
                    return;
                }
                bun.handleOom(stream.header_block.appendSlice(bun.default_allocator, payload));
                if (header.flags & @intFromEnum(wire.HeadersFrameFlags.END_HEADERS) != 0) {
                    stream.expecting_continuation = false;
                    stream.end_stream_received = stream.end_stream_received or stream.headers_end_stream;
                    stream.headers_ready = true;
                }
            },
            .HTTP_FRAME_DATA => {
                // Padding counts against flow control even when the payload is
                // for a stale stream, so credit the connection window first.
                this.conn_unacked_bytes +|= header.length;
                if (header.streamIdentifier != stream.id) return;
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
                if (header.streamIdentifier != stream.id) return;
                const code: u32 = if (payload.len >= 4) wire.u32FromBytes(payload[0..4]) else 0;
                if (code == @intFromEnum(wire.ErrorCode.NO_ERROR)) {
                    stream.end_stream_received = true;
                } else {
                    stream.fatal_error = error.HTTP2StreamReset;
                }
            },
            .HTTP_FRAME_GOAWAY => {
                this.goaway_received = true;
                const last_id: u32 = if (payload.len >= 4) wire.UInt31WithReserved.fromBytes(payload[0..4]).uint31 else 0;
                const code: u32 = if (payload.len >= 8) wire.u32FromBytes(payload[4..8]) else 0;
                if (code != @intFromEnum(wire.ErrorCode.NO_ERROR) or stream.id > last_id) {
                    stream.fatal_error = error.HTTP2GoAway;
                }
            },
            .HTTP_FRAME_PUSH_PROMISE => {
                // We sent SETTINGS_ENABLE_PUSH=0; receiving one is a protocol error.
                this.fatal_error = error.HTTP2ProtocolError;
            },
            else => {},
        }
    }

    /// HPACK-decode the accumulated header block into `state.pending_response`
    /// (reusing the shared HTTP/1.1 header buffer) and run
    /// `handleResponseMetadata` so redirects, content-encoding and
    /// content-length follow the same logic as the HTTP/1.1 path.
    fn deliverHeaders(this: *ClientSession, client: *HTTPClient) !HTTPClient.ShouldContinue {
        this.decoded_header_bytes.clearRetainingCapacity();

        var status_code: u32 = 0;
        const headers_buf = &HTTPClient.shared_response_headers_buf;
        // Record byte offsets while appending; resolve to slices once the
        // backing buffer has stopped growing so reallocs can't invalidate them.
        var bounds: [headers_buf.len][3]u32 = undefined;
        var header_count: usize = 0;

        var offset: usize = 0;
        while (offset < this.stream.header_block.items.len) {
            const result = this.hpack.decode(this.stream.header_block.items[offset..]) catch {
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
        this.stream.header_block.clearRetainingCapacity();

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
        // h2 framing delimits the body, so neither chunked transfer-encoding
        // nor the HTTP/1.1 "no Content-Length ⇒ no keep-alive" rule apply.
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

const log = bun.Output.scoped(.h2_client, .hidden);

const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const picohttp = bun.picohttp;

const HTTPClient = bun.http;
const NewHTTPContext = HTTPClient.NewHTTPContext;

const wire = @import("./H2FrameParser.zig");
const lshpack = @import("../bun.js/api/bun/lshpack.zig");
