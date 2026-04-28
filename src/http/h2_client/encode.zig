//! Outbound request encoding for the fetch() HTTP/2 client: connection
//! preface, HEADERS/CONTINUATION serialisation via HPACK, and DATA framing
//! under both flow-control windows. Free functions over `*ClientSession`.

pub fn writePreface(session: *ClientSession) void {
    session.queue(wire.client_preface);

    var settings: [3 * wire.SettingsPayloadUnit.byteSize]u8 = undefined;
    wire.SettingsPayloadUnit.encode(settings[0..6], .SETTINGS_ENABLE_PUSH, 0);
    wire.SettingsPayloadUnit.encode(settings[6..12], .SETTINGS_INITIAL_WINDOW_SIZE, local_initial_window_size);
    wire.SettingsPayloadUnit.encode(settings[12..18], .SETTINGS_MAX_HEADER_LIST_SIZE, local_max_header_list_size);
    session.writeFrame(.HTTP_FRAME_SETTINGS, 0, 0, &settings);

    // Connection-level window starts at 64 KiB regardless of SETTINGS;
    // open it to match the per-stream window so the first response isn't
    // throttled before our first WINDOW_UPDATE.
    session.writeWindowUpdate(0, local_initial_window_size - wire.DEFAULT_WINDOW_SIZE);
    session.preface_sent = true;
}

/// One classification pass per request header replaces a dozen case-insensitive
/// string compares. Names are lowercased once (required for the wire anyway),
/// then dispatched by length+content.
const RequestHeader = enum {
    /// RFC 9113 §8.2.2 hop-by-hop: never forwarded.
    drop,
    /// Promoted to `:authority`, then dropped.
    host,
    /// Forwarded only if value is exactly "trailers".
    te,
    /// Dropped under Expect: 100-continue (body may be abandoned).
    content_length,
    /// Triggers awaiting_continue when value is "100-continue".
    expect,
    /// Forwarded with HPACK never-index so they don't enter the dynamic table.
    sensitive,

    const map = bun.ComptimeStringMap(RequestHeader, .{
        .{ "connection", .drop },
        .{ "keep-alive", .drop },
        .{ "proxy-connection", .drop },
        .{ "transfer-encoding", .drop },
        .{ "upgrade", .drop },
        .{ "host", .host },
        .{ "te", .te },
        .{ "content-length", .content_length },
        .{ "expect", .expect },
        .{ "authorization", .sensitive },
        .{ "cookie", .sensitive },
        .{ "set-cookie", .sensitive },
    });
};

pub fn writeRequest(session: *ClientSession, client: *HTTPClient, stream: *Stream, request: picohttp.Request) !void {
    const encoded = &session.encode_scratch;
    encoded.clearRetainingCapacity();

    if (session.pending_hpack_enc_capacity) |cap| {
        session.pending_hpack_enc_capacity = null;
        session.hpack.setEncoderMaxCapacity(cap);
        try encoded.ensureUnusedCapacity(bun.default_allocator, 8);
        encodeHpackTableSizeUpdate(encoded, cap);
    }

    var authority: []const u8 = client.url.host;
    var has_expect_continue = false;
    for (request.headers) |h| switch (RequestHeader.map.getAnyCase(h.name) orelse continue) {
        .host => authority = h.value,
        .expect => has_expect_continue = strings.eqlCaseInsensitiveASCIIICheckLength(h.value, "100-continue"),
        else => {},
    };

    try encodeHeader(session, encoded, ":method", request.method, false);
    try encodeHeader(session, encoded, ":scheme", "https", false);
    try encodeHeader(session, encoded, ":authority", authority, false);
    try encodeHeader(session, encoded, ":path", if (request.path.len > 0) request.path else "/", false);

    var lower_buf: [256]u8 = undefined;
    for (request.headers) |h| {
        // §8.2.1: field names MUST be lowercase on the wire. copyLowercaseIfNeeded
        // returns the input slice unchanged when it's already lowercase, so
        // the common (Fetch-normalised) case is zero-copy. lshpack rejects
        // names+values >64KiB anyway, so the heap fallback only ever holds a
        // few hundred bytes.
        var heap: ?[]u8 = null;
        defer if (heap) |buf| bun.default_allocator.free(buf);
        const name = if (h.name.len <= lower_buf.len)
            strings.copyLowercaseIfNeeded(h.name, &lower_buf)
        else blk: {
            heap = bun.handleOom(bun.default_allocator.alloc(u8, h.name.len));
            break :blk strings.copyLowercaseIfNeeded(h.name, heap.?);
        };
        var never_index = false;
        if (RequestHeader.map.get(name)) |kind| switch (kind) {
            .drop, .host => continue,
            .te => if (!strings.eqlCaseInsensitiveASCIIICheckLength(strings.trim(h.value, " \t"), "trailers")) continue,
            .content_length => if (has_expect_continue) continue,
            .sensitive => never_index = true,
            .expect => {},
        };
        try encodeHeader(session, encoded, name, h.value, never_index);
    }

    const body = client.state.request_body;
    const has_inline_body = client.state.original_request_body == .bytes and body.len > 0;
    const is_streaming = client.state.original_request_body == .stream;

    if (has_expect_continue and (has_inline_body or is_streaming)) stream.awaiting_continue = true;

    writeHeaderBlock(session, stream.id, encoded.items, !has_inline_body and !is_streaming);
    if (encoded.capacity > 64 * 1024) encoded.clearAndFree(bun.default_allocator);
    if (has_inline_body) {
        stream.pending_body = body;
        drainSendBody(session, stream, std.math.maxInt(usize));
    } else if (!is_streaming) {
        stream.request_body_done = true;
    }
}

pub fn writeHeaderBlock(session: *ClientSession, stream_id: u31, block: []const u8, end_stream: bool) void {
    const max: usize = session.remote_max_frame_size;
    var remaining = block;
    var first = true;
    while (true) {
        const chunk = remaining[0..@min(remaining.len, max)];
        remaining = remaining[chunk.len..];
        const last = remaining.len == 0;
        var flags: u8 = 0;
        if (last) flags |= @intFromEnum(wire.HeadersFrameFlags.END_HEADERS);
        if (first and end_stream) flags |= @intFromEnum(wire.HeadersFrameFlags.END_STREAM);
        session.writeFrame(if (first) .HTTP_FRAME_HEADERS else .HTTP_FRAME_CONTINUATION, flags, stream_id, chunk);
        first = false;
        if (last) break;
    }
}

/// Frame `data` into DATA frames respecting `remote_max_frame_size` and
/// both flow-control windows. Returns bytes consumed; END_STREAM is set
/// on the final frame only when `end_stream` and all of `data` fit.
pub fn writeDataWindowed(session: *ClientSession, stream: *Stream, data: []const u8, end_stream: bool, cap: usize) usize {
    var remaining = data;
    var consumed: usize = 0;
    while (true) {
        const window: usize = @intCast(@max(0, @min(stream.send_window, session.conn_send_window)));
        if (remaining.len > 0 and window == 0) break;
        // Socket-side backpressure: don't keep memcpy'ing into write_buffer
        // once it's past the high-water mark — onWritable resumes us.
        if (remaining.len > 0 and session.write_buffer.size() >= write_buffer_high_water) break;
        if (consumed >= cap and remaining.len > 0) break;
        const chunk_len = @min(remaining.len, @as(usize, session.remote_max_frame_size), window);
        const last = chunk_len == remaining.len;
        const flags: u8 = if (last and end_stream) @intFromEnum(wire.DataFrameFlags.END_STREAM) else 0;
        session.writeFrame(.HTTP_FRAME_DATA, flags, stream.id, remaining[0..chunk_len]);
        stream.send_window -= @intCast(chunk_len);
        session.conn_send_window -= @intCast(chunk_len);
        consumed += chunk_len;
        remaining = remaining[chunk_len..];
        if (last) break;
    }
    return consumed;
}

/// Push as much of `stream`'s request body as the send windows allow.
/// Buffers into `write_buffer`; caller flushes.
pub fn drainSendBody(session: *ClientSession, stream: *Stream, cap: usize) void {
    if (stream.request_body_done or stream.awaiting_continue) return;
    if (stream.rst_done or stream.fatal_error != null) return;
    const client = stream.client orelse return;
    switch (client.state.original_request_body) {
        .bytes => {
            const sent = writeDataWindowed(session, stream, stream.pending_body, true, cap);
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
            const sent = writeDataWindowed(session, stream, data, body.ended, cap);
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

pub fn drainSendBodies(session: *ClientSession) void {
    // Round-robin: each pass gives every uploader at most one
    // remote_max_frame_size slice before the next stream gets a turn, so
    // the lowest-index stream can't monopolise conn_send_window.
    const slice: usize = session.remote_max_frame_size;
    while (session.conn_send_window > 0 and session.write_buffer.size() < write_buffer_high_water) {
        var progressed = false;
        for (session.streams.values()) |stream| {
            if (stream.request_body_done or stream.send_window <= 0) continue;
            const before = session.conn_send_window;
            drainSendBody(session, stream, slice);
            if (session.conn_send_window != before or stream.request_body_done) progressed = true;
        }
        if (!progressed) break;
    }
}

pub fn encodeHeader(session: *ClientSession, encoded: *std.ArrayListUnmanaged(u8), name: []const u8, value: []const u8, never_index: bool) !void {
    const required = encoded.items.len + name.len + value.len + 32;
    try encoded.ensureTotalCapacity(bun.default_allocator, required);
    const written = try session.hpack.encode(name, value, never_index, encoded.allocatedSlice(), encoded.items.len);
    encoded.items.len += written;
}

/// RFC 7541 §6.3 Dynamic Table Size Update: `001` prefix, 5-bit-prefix
/// integer. Must be the first opcode in a header block. Caller guarantees
/// at least 6 bytes of capacity (max for a u32).
pub fn encodeHpackTableSizeUpdate(encoded: *std.ArrayListUnmanaged(u8), value: u32) void {
    if (value < 31) {
        encoded.appendAssumeCapacity(0x20 | @as(u8, @intCast(value)));
        return;
    }
    encoded.appendAssumeCapacity(0x20 | 31);
    var rest = value - 31;
    while (rest >= 128) : (rest >>= 7) {
        encoded.appendAssumeCapacity(@as(u8, @truncate(rest)) | 0x80);
    }
    encoded.appendAssumeCapacity(@as(u8, @truncate(rest)));
}

const ClientSession = @import("./ClientSession.zig");
const Stream = @import("./Stream.zig");
const std = @import("std");
const wire = @import("../H2FrameParser.zig");

const H2 = @import("../H2Client.zig");
const local_initial_window_size = H2.local_initial_window_size;
const local_max_header_list_size = H2.local_max_header_list_size;
const write_buffer_high_water = H2.write_buffer_high_water;

const bun = @import("bun");
const HTTPClient = bun.http;
const picohttp = bun.picohttp;
const strings = bun.strings;
