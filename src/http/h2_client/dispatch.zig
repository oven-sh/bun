//! Inbound frame parsing and dispatch for the fetch() HTTP/2 client.
//! Free functions over `*ClientSession` so the session struct stays focused on
//! lifecycle and delivery; everything that interprets bytes off the wire lives
//! here.

/// Dispatch every complete frame in `buf` and return the number of bytes
/// consumed. The caller spills the unconsumed tail (a partial frame) into
/// `read_buffer`. Operating on a borrowed slice lets `onData` parse
/// straight from the socket chunk in the common case where no partial
/// frame is carried over, saving one memcpy of every body byte.
pub fn parseFrames(session: *ClientSession, buf: []const u8) usize {
    var consumed: usize = 0;
    while (true) {
        const remaining = buf[consumed..];
        if (remaining.len < wire.FrameHeader.byteSize) break;
        var header: wire.FrameHeader = .{ .flags = 0 };
        wire.FrameHeader.from(&header, remaining[0..wire.FrameHeader.byteSize], 0, true);
        header.streamIdentifier = wire.UInt31WithReserved.from(header.streamIdentifier).uint31;
        // RFC 9113 §4.2: a frame larger than the local SETTINGS_MAX_FRAME_SIZE
        // (we never advertise above the 16384 default) is a connection
        // FRAME_SIZE_ERROR. Bounding here also caps `read_buffer` growth.
        if (header.length > wire.DEFAULT_MAX_FRAME_SIZE) {
            session.fatal_error = error.HTTP2FrameSizeError;
            break;
        }
        const frame_len = wire.FrameHeader.byteSize + @as(usize, header.length);
        if (remaining.len < frame_len) break;
        dispatchFrame(session, header, remaining[wire.FrameHeader.byteSize..frame_len]);
        consumed += frame_len;
        if (session.fatal_error != null) break;
    }
    return consumed;
}

pub fn dispatchFrame(session: *ClientSession, header: wire.FrameHeader, payload: []const u8) void {
    log("frame type={d} len={d} flags={d} stream={d}", .{ header.type, header.length, header.flags, header.streamIdentifier });

    if (session.expecting_continuation != 0 and header.type != @intFromEnum(wire.FrameType.HTTP_FRAME_CONTINUATION)) {
        session.fatal_error = error.HTTP2ProtocolError;
        return;
    }
    // RFC 9113 §3.4: the server connection preface is a SETTINGS frame and
    // MUST be the first frame. Without this, GOAWAY-before-SETTINGS leaves
    // coalesced waiters in `pending_attach` forever (drainPending is gated
    // on settings_received and maybeRelease won't run while it's non-empty).
    if (!session.settings_received and header.type != @intFromEnum(wire.FrameType.HTTP_FRAME_SETTINGS)) {
        session.fatal_error = error.HTTP2ProtocolError;
        return;
    }

    switch (@as(wire.FrameType, @enumFromInt(header.type))) {
        .HTTP_FRAME_SETTINGS => {
            // RFC 9113 §6.5: stream id != 0 is PROTOCOL_ERROR; ACK with a
            // payload, or a non-ACK whose length isn't a multiple of 6, is
            // FRAME_SIZE_ERROR.
            if (header.streamIdentifier != 0) {
                session.fatal_error = error.HTTP2ProtocolError;
                return;
            }
            if (header.flags & @intFromEnum(wire.SettingsFlags.ACK) != 0) {
                if (header.length != 0) session.fatal_error = error.HTTP2FrameSizeError;
                return;
            }
            if (header.length % wire.SettingsPayloadUnit.byteSize != 0) {
                session.fatal_error = error.HTTP2FrameSizeError;
                return;
            }
            var i: usize = 0;
            while (i + wire.SettingsPayloadUnit.byteSize <= payload.len) : (i += wire.SettingsPayloadUnit.byteSize) {
                var unit: wire.SettingsPayloadUnit = undefined;
                wire.SettingsPayloadUnit.from(&unit, payload[i .. i + wire.SettingsPayloadUnit.byteSize], 0, true);
                switch (@as(wire.SettingsType, @enumFromInt(unit.type))) {
                    .SETTINGS_MAX_FRAME_SIZE => {
                        // RFC 9113 §6.5.2: values outside [16384, 2^24-1]
                        // are a connection PROTOCOL_ERROR. Without the
                        // lower bound, a 0 here makes writeHeaderBlock /
                        // writeDataWindowed spin forever emitting empty
                        // frames.
                        if (unit.value < wire.DEFAULT_MAX_FRAME_SIZE or unit.value > wire.MAX_FRAME_SIZE) {
                            session.fatal_error = error.HTTP2ProtocolError;
                            return;
                        }
                        session.remote_max_frame_size = @truncate(unit.value);
                    },
                    .SETTINGS_MAX_CONCURRENT_STREAMS => session.remote_max_concurrent_streams = unit.value,
                    .SETTINGS_HEADER_TABLE_SIZE => {
                        // RFC 9113 §4.3.1 / RFC 7541 §4.2: encoder MUST
                        // acknowledge a reduced limit with a Dynamic Table
                        // Size Update at the start of the next header
                        // block. Track the minimum seen so a reduce-then-
                        // raise between two blocks still signals the dip.
                        session.pending_hpack_enc_capacity = @min(session.pending_hpack_enc_capacity orelse unit.value, unit.value);
                    },
                    .SETTINGS_INITIAL_WINDOW_SIZE => {
                        // RFC 9113 §6.5.2 / §6.9.2: values above 2^31-1, or
                        // a delta that pushes any open stream's window past
                        // that, are a connection FLOW_CONTROL_ERROR.
                        if (unit.value > wire.MAX_WINDOW_SIZE) {
                            session.fatal_error = error.HTTP2FlowControlError;
                            return;
                        }
                        const delta = @as(i64, unit.value) - @as(i64, session.remote_initial_window_size);
                        session.remote_initial_window_size = unit.value;
                        for (session.streams.values()) |s| {
                            const next = @as(i64, s.send_window) + delta;
                            if (next > wire.MAX_WINDOW_SIZE) {
                                session.fatal_error = error.HTTP2FlowControlError;
                                return;
                            }
                            s.send_window = @intCast(next);
                        }
                    },
                    else => {},
                }
            }
            if (session.write_buffer.size() >= write_buffer_control_limit) {
                session.fatal_error = error.HTTP2EnhanceYourCalm;
                return;
            }
            session.writeFrame(.HTTP_FRAME_SETTINGS, @intFromEnum(wire.SettingsFlags.ACK), 0, &.{});
            session.settings_received = true;
            session.stream_progressed = true;
        },
        .HTTP_FRAME_WINDOW_UPDATE => {
            if (header.length != 4) {
                session.fatal_error = error.HTTP2FrameSizeError;
                return;
            }
            const inc: i32 = @intCast(wire.UInt31WithReserved.fromBytes(payload[0..4]).uint31);
            if (header.streamIdentifier == 0) {
                // RFC 9113 §6.9: zero increment on stream 0 is a
                // connection PROTOCOL_ERROR; §6.9.1: overflow past
                // 2^31-1 is a connection FLOW_CONTROL_ERROR.
                if (inc == 0) {
                    session.fatal_error = error.HTTP2ProtocolError;
                    return;
                }
                const next = @as(i64, session.conn_send_window) + inc;
                if (next > wire.MAX_WINDOW_SIZE) {
                    session.fatal_error = error.HTTP2FlowControlError;
                    return;
                }
                session.conn_send_window = @intCast(next);
                session.stream_progressed = true;
            } else if (session.streams.get(@truncate(header.streamIdentifier & 0x7fffffff))) |stream| {
                // §6.9/§6.9.1: zero increment / overflow on a stream are
                // stream-level errors; RST_STREAM and fail just that one.
                if (inc == 0) {
                    stream.rst(.PROTOCOL_ERROR);
                    stream.fatal_error = error.HTTP2ProtocolError;
                    return;
                }
                const next = @as(i64, stream.send_window) + inc;
                if (next > wire.MAX_WINDOW_SIZE) {
                    stream.rst(.FLOW_CONTROL_ERROR);
                    stream.fatal_error = error.HTTP2FlowControlError;
                    return;
                }
                stream.send_window = @intCast(next);
                session.stream_progressed = true;
            } else {
                // §5.1: WINDOW_UPDATE on an idle/server-initiated stream
                // is a connection PROTOCOL_ERROR. Silent ignore is correct
                // for closed streams (odd ids we already used).
                const sid: u31 = @intCast(header.streamIdentifier);
                if (sid & 1 == 0 or sid >= session.next_stream_id) {
                    session.fatal_error = error.HTTP2ProtocolError;
                    return;
                }
            }
        },
        .HTTP_FRAME_PING => {
            // RFC 9113 §6.7: length != 8 is a connection FRAME_SIZE_ERROR;
            // a non-zero stream identifier is a connection PROTOCOL_ERROR.
            if (header.length != 8) {
                session.fatal_error = error.HTTP2FrameSizeError;
                return;
            }
            if (header.streamIdentifier != 0) {
                session.fatal_error = error.HTTP2ProtocolError;
                return;
            }
            if (header.flags & @intFromEnum(wire.PingFrameFlags.ACK) == 0) {
                if (session.write_buffer.size() >= write_buffer_control_limit) {
                    session.fatal_error = error.HTTP2EnhanceYourCalm;
                    return;
                }
                session.writeFrame(.HTTP_FRAME_PING, @intFromEnum(wire.PingFrameFlags.ACK), 0, payload[0..8]);
            }
        },
        .HTTP_FRAME_PRIORITY => {
            // RFC 9113 §6.3: deprecated, but framing rules remain.
            if (header.streamIdentifier == 0) {
                session.fatal_error = error.HTTP2ProtocolError;
                return;
            }
            if (header.length != wire.StreamPriority.byteSize) {
                session.fatal_error = error.HTTP2FrameSizeError;
                return;
            }
        },
        .HTTP_FRAME_HEADERS => {
            var fragment = payload;
            const stream_id: u31 = @intCast(header.streamIdentifier);
            const maybe_stream = session.streams.get(stream_id);
            if (maybe_stream == null) {
                // RFC 9113 §5.1/§5.1.1: HEADERS on a stream we never
                // opened (idle: id >= next_stream_id, or even: server-
                // initiated while push is disabled) is a connection
                // PROTOCOL_ERROR. Only odd ids we already used can be a
                // legitimate "RST crossed an in-flight HEADERS" orphan.
                if (stream_id == 0 or stream_id & 1 == 0 or stream_id >= session.next_stream_id) {
                    session.fatal_error = error.HTTP2ProtocolError;
                    return;
                }
                // Stream we no longer track (RST_STREAM crossed an
                // in-flight HEADERS). The block must still be HPACK-
                // decoded so the connection-level dynamic table stays in
                // sync with the server's encoder, and CONTINUATION must
                // be tracked so a follow-up frame doesn't fatal the whole
                // connection.
                if (header.flags & @intFromEnum(wire.HeadersFrameFlags.PADDED) != 0) {
                    fragment = stripPadding(fragment) orelse {
                        session.fatal_error = error.HTTP2ProtocolError;
                        return;
                    };
                }
                if (header.flags & @intFromEnum(wire.HeadersFrameFlags.PRIORITY) != 0) {
                    if (fragment.len < wire.StreamPriority.byteSize) {
                        session.fatal_error = error.HTTP2ProtocolError;
                        return;
                    }
                    fragment = fragment[wire.StreamPriority.byteSize..];
                }
                if (fragment.len > local_max_header_list_size) {
                    session.fatal_error = error.HTTP2HeaderListTooLarge;
                    return;
                }
                session.orphan_header_block.clearRetainingCapacity();
                bun.handleOom(session.orphan_header_block.appendSlice(bun.default_allocator, fragment));
                if (header.flags & @intFromEnum(wire.HeadersFrameFlags.END_HEADERS) != 0) {
                    decodeDiscardOrphan(session);
                } else {
                    session.expecting_continuation = stream_id;
                }
                return;
            }
            const stream = maybe_stream.?;
            session.stream_progressed = true;
            if (header.flags & @intFromEnum(wire.HeadersFrameFlags.PADDED) != 0) {
                fragment = stripPadding(fragment) orelse {
                    session.fatal_error = error.HTTP2ProtocolError;
                    return;
                };
            }
            if (header.flags & @intFromEnum(wire.HeadersFrameFlags.PRIORITY) != 0) {
                if (fragment.len < wire.StreamPriority.byteSize) {
                    session.fatal_error = error.HTTP2ProtocolError;
                    return;
                }
                fragment = fragment[wire.StreamPriority.byteSize..];
            }
            if (fragment.len > local_max_header_list_size) {
                session.fatal_error = error.HTTP2HeaderListTooLarge;
                return;
            }
            stream.header_block.clearRetainingCapacity();
            bun.handleOom(stream.header_block.appendSlice(bun.default_allocator, fragment));
            stream.headers_end_stream = header.flags & @intFromEnum(wire.HeadersFrameFlags.END_STREAM) != 0;
            if (header.flags & @intFromEnum(wire.HeadersFrameFlags.END_HEADERS) != 0) {
                if (stream.headers_end_stream) stream.recvEndStream();
                decodeHeaderBlock(session, stream);
            } else {
                session.expecting_continuation = stream.id;
            }
        },
        .HTTP_FRAME_CONTINUATION => {
            if (session.expecting_continuation == 0 or header.streamIdentifier != session.expecting_continuation) {
                session.fatal_error = error.HTTP2ProtocolError;
                return;
            }
            if (session.streams.get(session.expecting_continuation)) |stream| {
                if (stream.header_block.items.len + payload.len > local_max_header_list_size) {
                    session.fatal_error = error.HTTP2HeaderListTooLarge;
                    return;
                }
                bun.handleOom(stream.header_block.appendSlice(bun.default_allocator, payload));
                if (header.flags & @intFromEnum(wire.HeadersFrameFlags.END_HEADERS) != 0) {
                    session.expecting_continuation = 0;
                    if (stream.headers_end_stream) stream.recvEndStream();
                    decodeHeaderBlock(session, stream);
                }
            } else {
                if (session.orphan_header_block.items.len + payload.len > local_max_header_list_size) {
                    session.fatal_error = error.HTTP2HeaderListTooLarge;
                    return;
                }
                bun.handleOom(session.orphan_header_block.appendSlice(bun.default_allocator, payload));
                if (header.flags & @intFromEnum(wire.HeadersFrameFlags.END_HEADERS) != 0) {
                    session.expecting_continuation = 0;
                    decodeDiscardOrphan(session);
                }
            }
        },
        .HTTP_FRAME_DATA => {
            session.conn_unacked_bytes +|= header.length;
            const stream_id: u31 = @intCast(header.streamIdentifier);
            const stream = session.streams.get(stream_id) orelse {
                // §6.1/§5.1: DATA on stream 0, an idle stream, or a
                // server-initiated stream is a connection PROTOCOL_ERROR.
                // DATA on a stream we already closed/reset is ignored.
                if (stream_id == 0 or stream_id & 1 == 0 or stream_id >= session.next_stream_id) {
                    session.fatal_error = error.HTTP2ProtocolError;
                }
                return;
            };
            session.stream_progressed = true;
            // §8.1.1: DATA before the *final* response HEADERS is malformed —
            // a 1xx alone (status_code still 0) doesn't satisfy this.
            if (stream.status_code == 0) {
                stream.rst(.PROTOCOL_ERROR);
                stream.fatal_error = error.HTTP2ProtocolError;
                return;
            }
            // §5.1: DATA on a half-closed(remote) or reset stream is
            // STREAM_CLOSED. Without this, frames in the same TCP read as
            // END_STREAM would be appended to body_buffer before the
            // deliver loop swaps the stream out.
            if (stream.remoteClosed()) {
                stream.fatal_error = stream.fatal_error orelse error.HTTP2ProtocolError;
                return;
            }
            stream.unacked_bytes +|= header.length;
            var fragment = payload;
            if (header.flags & @intFromEnum(wire.DataFrameFlags.PADDED) != 0) {
                fragment = stripPadding(fragment) orelse {
                    session.fatal_error = error.HTTP2ProtocolError;
                    return;
                };
            }
            if (header.flags & @intFromEnum(wire.DataFrameFlags.END_STREAM) != 0) {
                stream.recvEndStream();
            }
            stream.data_bytes_received += fragment.len;
            if (fragment.len > 0) {
                bun.handleOom(stream.body_buffer.appendSlice(bun.default_allocator, fragment));
            }
        },
        .HTTP_FRAME_RST_STREAM => {
            if (header.length != 4) {
                session.fatal_error = error.HTTP2FrameSizeError;
                return;
            }
            const stream_id: u31 = @intCast(header.streamIdentifier);
            // RFC 9113 §6.4: stream 0, or an idle stream (one we never
            // opened — even ids included since push is disabled), is a
            // connection PROTOCOL_ERROR.
            if (stream_id == 0 or stream_id & 1 == 0 or stream_id >= session.next_stream_id) {
                session.fatal_error = error.HTTP2ProtocolError;
                return;
            }
            const stream = session.streams.get(stream_id) orelse return;
            const had_response = stream.remoteClosed();
            stream.rst_done = true;
            stream.state = .closed;
            const code: u32 = wire.u32FromBytes(payload[0..4]);
            // RFC 9113 §8.1: RST_STREAM(NO_ERROR) is the server's "stop
            // uploading, I've already sent the full response" signal —
            // valid only if END_STREAM had already arrived. Otherwise the
            // body is truncated and must surface as an error.
            stream.fatal_error = switch (code) {
                @intFromEnum(wire.ErrorCode.NO_ERROR) => if (had_response) null else error.HTTP2StreamReset,
                @intFromEnum(wire.ErrorCode.REFUSED_STREAM) => error.HTTP2RefusedStream,
                else => error.HTTP2StreamReset,
            };
        },
        .HTTP_FRAME_GOAWAY => {
            if (header.streamIdentifier != 0) {
                session.fatal_error = error.HTTP2ProtocolError;
                return;
            }
            if (header.length < 8) {
                session.fatal_error = error.HTTP2FrameSizeError;
                return;
            }
            session.goaway_received = true;
            session.goaway_last_stream_id = wire.UInt31WithReserved.fromBytes(payload[0..4]).uint31;
            const code: u32 = wire.u32FromBytes(payload[4..8]);
            const graceful = code == @intFromEnum(wire.ErrorCode.NO_ERROR);
            var it = session.streams.iterator();
            while (it.next()) |e| {
                const s = e.value_ptr.*;
                if (s.id > session.goaway_last_stream_id) {
                    s.fatal_error = if (graceful) error.HTTP2RefusedStream else error.HTTP2GoAway;
                } else if (!graceful and !s.remoteClosed()) {
                    // RFC 9113 §6.8: streams ≤ last_stream_id "might
                    // still complete successfully" — don't discard a
                    // response that already finished in this same read.
                    s.fatal_error = error.HTTP2GoAway;
                }
            }
        },
        .HTTP_FRAME_PUSH_PROMISE => session.fatal_error = error.HTTP2ProtocolError,
        else => {},
    }
}

/// Feed an orphaned (untracked-stream) header block through the HPACK
/// decoder purely to keep the dynamic table in sync, then discard.
pub fn decodeDiscardOrphan(session: *ClientSession) void {
    defer session.orphan_header_block.clearRetainingCapacity();
    var offset: usize = 0;
    while (offset < session.orphan_header_block.items.len) {
        const result = session.hpack.decode(session.orphan_header_block.items[offset..]) catch {
            session.fatal_error = error.HTTP2CompressionError;
            return;
        };
        offset += result.next;
    }
}

/// HPACK-decode the buffered header block at parse time. Runs for every
/// END_HEADERS so the dynamic table stays in sync regardless of how many
/// HEADERS frames arrive in one read. 1xx and trailers are decoded then
/// dropped; the final response is stored on the stream for delivery.
pub fn decodeHeaderBlock(session: *ClientSession, stream: *Stream) void {
    defer stream.header_block.clearRetainingCapacity();

    var status: u32 = 0;
    var bounds: std.ArrayListUnmanaged([3]u32) = .{};
    defer bounds.deinit(bun.default_allocator);
    const start_len = stream.decoded_bytes.items.len;
    var seen_regular = false;
    var seen_status = false;

    var offset: usize = 0;
    while (offset < stream.header_block.items.len) {
        const result = session.hpack.decode(stream.header_block.items[offset..]) catch {
            // The decoder has already committed earlier fields from this
            // block to the connection-level dynamic table; the table is
            // now out of sync with the server's encoder. RFC 9113 §4.3:
            // a decoding error MUST be treated as a connection error of
            // type COMPRESSION_ERROR.
            session.fatal_error = error.HTTP2CompressionError;
            return;
        };
        offset += result.next;
        if (result.name.len > 0 and result.name[0] == ':') {
            // §8.3.2: only `:status` is defined for responses, MUST appear
            // before any regular field, and MUST NOT repeat. §8.1: not
            // allowed in trailers.
            if (stream.status_code != 0 or seen_regular or seen_status or
                !strings.eqlComptime(result.name, ":status"))
            {
                stream.rst(.PROTOCOL_ERROR);
                stream.fatal_error = error.HTTP2ProtocolError;
                return;
            }
            seen_status = true;
            status = std.fmt.parseInt(u32, result.value, 10) catch 0;
            continue;
        }
        seen_regular = true;
        if (stream.status_code != 0) continue;
        if (isMalformedResponseField(result.name)) {
            stream.rst(.PROTOCOL_ERROR);
            stream.fatal_error = error.HTTP2ProtocolError;
            return;
        }
        // Cap decoded size independently of the wire size: HPACK indexed
        // refs can amplify a small block into huge name/value pairs.
        if (stream.decoded_bytes.items.len + result.name.len + result.value.len > local_max_header_list_size) {
            session.fatal_error = error.HTTP2HeaderListTooLarge;
            return;
        }
        const name_start: u32 = @intCast(stream.decoded_bytes.items.len);
        bun.handleOom(stream.decoded_bytes.appendSlice(bun.default_allocator, result.name));
        const value_start: u32 = @intCast(stream.decoded_bytes.items.len);
        bun.handleOom(stream.decoded_bytes.appendSlice(bun.default_allocator, result.value));
        bun.handleOom(bounds.append(bun.default_allocator, .{ name_start, value_start, @intCast(stream.decoded_bytes.items.len) }));
    }

    // Trailers: status_code already set by an earlier HEADERS. RFC 9113
    // §8.1 — the trailers HEADERS MUST carry END_STREAM; otherwise the
    // server could interleave DATA → HEADERS → DATA and the second DATA
    // would be appended to the body.
    if (stream.status_code != 0) {
        if (!stream.headers_end_stream) stream.fatal_error = error.HTTP2ProtocolError;
        return;
    }

    if (status == 0) {
        stream.decoded_bytes.items.len = start_len;
        stream.fatal_error = error.HTTP2ProtocolError;
        return;
    }
    if (status >= 100 and status < 200) {
        stream.decoded_bytes.items.len = start_len;
        stream.awaiting_continue = false;
        // RFC 9113 §8.1: a 1xx HEADERS that ends the stream is malformed.
        if (stream.remoteClosed()) stream.fatal_error = error.HTTP2ProtocolError;
        return;
    }

    stream.status_code = status;
    stream.headers_ready = true;
    if (stream.awaiting_continue) {
        // Final status without a preceding 100: server has decided without
        // seeing the body. Half-close our side with an empty DATA so the
        // response can finish normally; Content-Length was already stripped
        // on this path so 0 bytes is not a §8.1.1 mismatch.
        stream.awaiting_continue = false;
        session.writeFrame(.HTTP_FRAME_DATA, @intFromEnum(wire.DataFrameFlags.END_STREAM), stream.id, &.{});
        stream.sentEndStream();
    }
    const bytes = stream.decoded_bytes.items;
    bun.handleOom(stream.decoded_headers.ensureTotalCapacityPrecise(bun.default_allocator, bounds.items.len));
    for (bounds.items) |b| {
        stream.decoded_headers.appendAssumeCapacity(.{ .name = bytes[b[0]..b[1]], .value = bytes[b[1]..b[2]] });
    }
}

pub fn stripPadding(payload: []const u8) ?[]const u8 {
    if (payload.len < 1) return null;
    const pad: usize = payload[0];
    if (pad >= payload.len) return null;
    return payload[1 .. payload.len - pad];
}

/// RFC 9113 §8.2.1/§8.2.2 response-side validation: lowercase names, no
/// hop-by-hop fields. Names from lshpack are already lowercase for table
/// hits but a literal can carry anything.
pub fn isMalformedResponseField(name: []const u8) bool {
    for (name) |c| if (c >= 'A' and c <= 'Z') return true;
    return forbidden_response_fields.has(name);
}

const forbidden_response_fields = bun.ComptimeStringMap(void, .{
    .{ "connection", {} },
    .{ "keep-alive", {} },
    .{ "proxy-connection", {} },
    .{ "transfer-encoding", {} },
    .{ "upgrade", {} },
});

pub fn errorCodeFor(err: anyerror) wire.ErrorCode {
    return switch (err) {
        error.HTTP2ProtocolError => .PROTOCOL_ERROR,
        error.HTTP2FrameSizeError => .FRAME_SIZE_ERROR,
        error.HTTP2FlowControlError => .FLOW_CONTROL_ERROR,
        error.HTTP2CompressionError => .COMPRESSION_ERROR,
        error.HTTP2HeaderListTooLarge, error.HTTP2EnhanceYourCalm => .ENHANCE_YOUR_CALM,
        else => .INTERNAL_ERROR,
    };
}

const log = bun.Output.scoped(.h2_client, .hidden);

const ClientSession = @import("./ClientSession.zig");
const Stream = @import("./Stream.zig");
const std = @import("std");
const wire = @import("../H2FrameParser.zig");

const H2 = @import("../H2Client.zig");
const local_max_header_list_size = H2.local_max_header_list_size;
const write_buffer_control_limit = H2.write_buffer_control_limit;

const bun = @import("bun");
const strings = bun.strings;
