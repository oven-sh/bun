//! lsquic → Zig callbacks for the HTTP/3 client. Registered on the
//! `quic.Context` from `ClientContext.getOrCreate`; lsquic invokes these from
//! inside `process_conns` on the HTTP thread. Each one resolves the
//! `ClientSession` / `Stream` from the ext slot and forwards into the
//! corresponding session/stream method so the protocol logic stays in
//! `ClientSession.zig` / `encode.zig`.

pub fn register(qctx: *quic.Context) void {
    qctx.onHskDone(onHskDone);
    qctx.onGoaway(onGoaway);
    qctx.onClose(onConnClose);
    qctx.onStreamOpen(onStreamOpen);
    qctx.onStreamHeaders(onStreamHeaders);
    qctx.onStreamData(onStreamData);
    qctx.onStreamWritable(onStreamWritable);
    qctx.onStreamClose(onStreamClose);
}

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
    var buf: [256]u8 = [_]u8{0} ** 256;
    const st = qs.status(&buf);
    log("conn_close status={d} '{s}'", .{ st, std.mem.sliceTo(&buf, 0) });
    if (ClientContext.get()) |ctx| ctx.unregister(session);
    while (session.pending.items.len > 0) {
        // lsquic fires on_stream_close for every bound stream before
        // on_conn_closed, so anything still here never got a qstream.
        const stream = session.pending.items[0];
        bun.debugAssert(stream.qstream == null);
        session.retryOrFail(stream, if (session.handshake_done)
            error.ConnectionClosed
        else
            error.HTTP3HandshakeFailed);
    }
    _ = H3.live_sessions.fetchSub(1, .monotonic);
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
    encode.writeRequest(session, stream, s) catch |err| {
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
    encode.drainSendBody(stream, s);
}

fn onStreamClose(s: *quic.Stream) callconv(.c) void {
    const stream = s.ext(Stream).* orelse return;
    s.ext(Stream).* = null;
    stream.qstream = null;
    log("stream_close status={d} delivered={}", .{ stream.status_code, stream.headers_delivered });
    stream.session.deliver(stream, true);
}

const log = bun.Output.scoped(.h3_client, .hidden);

const ClientContext = @import("./ClientContext.zig");
const ClientSession = @import("./ClientSession.zig");
const H3 = @import("../H3Client.zig");
const Stream = @import("./Stream.zig");
const encode = @import("./encode.zig");
const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;
const quic = bun.uws.quic;
