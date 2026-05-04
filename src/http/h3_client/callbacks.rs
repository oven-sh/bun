//! lsquic → Rust callbacks for the HTTP/3 client. Registered on the
//! `quic::Context` from `ClientContext::get_or_create`; lsquic invokes these
//! from inside `process_conns` on the HTTP thread. Each one resolves the
//! `ClientSession` / `Stream` from the ext slot and forwards into the
//! corresponding session/stream method so the protocol logic stays in
//! `client_session.rs` / `encode.rs`.

use core::ffi::{c_int, c_uint};
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bstr::BStr;
use bun_core::err;
use bun_uws::quic;

use super::client_context::ClientContext;
use super::client_session::ClientSession;
use super::encode;
use super::stream::Stream;
// TODO(port): `H3Client.zig` (src/http/H3Client.zig) snake_cases to the same
// module name as this directory; Phase B resolves the actual path.
use crate::H3Client as H3;

bun_output::declare_scope!(h3_client, hidden);

pub fn register(qctx: &mut quic::Context) {
    qctx.on_hsk_done(on_hsk_done);
    qctx.on_goaway(on_goaway);
    qctx.on_close(on_conn_close);
    qctx.on_stream_open(on_stream_open);
    qctx.on_stream_headers(on_stream_headers);
    qctx.on_stream_data(on_stream_data);
    qctx.on_stream_writable(on_stream_writable);
    qctx.on_stream_close(on_stream_close);
}

extern "C" fn on_hsk_done(qs: *mut quic::Socket, ok: c_int) {
    // SAFETY: lsquic passes a live socket for the duration of the callback.
    let qs = unsafe { &mut *qs };
    let Some(mut session) = *qs.ext::<ClientSession>() else { return };
    // SAFETY: ext slot was set by ClientSession on connect; live until on_conn_close clears it.
    let session = unsafe { session.as_mut() };
    bun_output::scoped_log!(h3_client, "hsk_done ok={} pending={}", ok, session.pending.len());
    if ok == 0 {
        session.closed = true;
        return;
    }
    session.handshake_done = true;
    for _ in 0..session.pending.len() {
        qs.make_stream();
    }
}

/// Peer sent GOAWAY: this connection won't accept new streams (RFC 9114
/// §5.2). Mark the session unusable now so the next `connect()` opens a fresh
/// one instead of waiting for `on_conn_close`, which only fires after lsquic's
/// draining period. Stay in the registry so abort/body-chunk lookups still
/// reach in-flight streams; `on_conn_close` does the actual unregister/deref.
extern "C" fn on_goaway(qs: *mut quic::Socket) {
    // SAFETY: lsquic passes a live socket for the duration of the callback.
    let qs = unsafe { &mut *qs };
    let Some(mut session) = *qs.ext::<ClientSession>() else { return };
    // SAFETY: ext slot is live until on_conn_close clears it.
    let session = unsafe { session.as_mut() };
    bun_output::scoped_log!(
        h3_client,
        "goaway {}:{}",
        BStr::new(&session.hostname),
        session.port
    );
    session.closed = true;
}

extern "C" fn on_conn_close(qs: *mut quic::Socket) {
    // SAFETY: lsquic passes a live socket for the duration of the callback.
    let qs = unsafe { &mut *qs };
    let Some(mut session) = *qs.ext::<ClientSession>() else { return };
    // SAFETY: ext slot is live; this callback is the one that tears it down.
    let session = unsafe { session.as_mut() };
    session.closed = true;
    session.qsocket = None;
    let mut buf = [0u8; 256];
    let st = qs.status(&mut buf);
    bun_output::scoped_log!(
        h3_client,
        "conn_close status={} '{}'",
        st,
        BStr::new(bun_str::slice_to_nul(&buf))
    );
    if let Some(ctx) = ClientContext::get() {
        ctx.unregister(session);
    }
    while !session.pending.is_empty() {
        // lsquic fires on_stream_close for every bound stream before
        // on_conn_closed, so anything still here never got a qstream.
        let stream = session.pending[0];
        // SAFETY: pending holds live Stream pointers owned by the session.
        debug_assert!(unsafe { (*stream.as_ptr()).qstream.is_none() });
        session.retry_or_fail(
            // SAFETY: same as above.
            unsafe { &mut *stream.as_ptr() },
            if session.handshake_done {
                err!("ConnectionClosed")
            } else {
                err!("HTTP3HandshakeFailed")
            },
        );
    }
    let _ = H3::LIVE_SESSIONS.fetch_sub(1, Ordering::Relaxed);
    session.deref();
}

extern "C" fn on_stream_open(s: *mut quic::Stream, is_client: c_int) {
    // SAFETY: lsquic passes a live stream for the duration of the callback.
    let s = unsafe { &mut *s };
    *s.ext::<Stream>() = None;
    if is_client == 0 {
        return;
    }
    let Some(qs) = s.socket() else { return };
    let Some(mut session) = *qs.ext::<ClientSession>() else {
        s.close();
        return;
    };
    // SAFETY: ext slot is live until on_conn_close clears it.
    let session = unsafe { session.as_mut() };
    // Bind the next pending request to this stream.
    let stream: &mut Stream = 'find: {
        for st in session.pending.as_slice() {
            // SAFETY: pending holds live Stream pointers owned by the session.
            let st = unsafe { &mut *st.as_ptr() };
            if st.qstream.is_none() {
                break 'find st;
            }
        }
        s.close();
        return;
    };
    stream.qstream = Some(NonNull::from(&mut *s));
    *s.ext::<Stream>() = Some(NonNull::from(&mut *stream));
    bun_output::scoped_log!(h3_client, "stream_open");
    if let Err(e) = encode::write_request(session, stream, s) {
        session.fail(stream, e);
    }
}

extern "C" fn on_stream_headers(s: *mut quic::Stream) {
    // SAFETY: lsquic passes a live stream for the duration of the callback.
    let s = unsafe { &mut *s };
    let Some(mut stream) = *s.ext::<Stream>() else { return };
    // SAFETY: ext slot was set in on_stream_open; live until on_stream_close clears it.
    let stream = unsafe { stream.as_mut() };
    let n = s.header_count();

    stream.decoded_headers.clear();
    stream
        .decoded_headers
        .reserve((n as usize).saturating_sub(stream.decoded_headers.len()));
    let mut status: u16 = 0;
    let mut i: c_uint = 0;
    while i < n {
        let Some(h) = s.header(i) else {
            i += 1;
            continue;
        };
        // SAFETY: lsquic guarantees name/value point to name_len/value_len bytes
        // valid for the duration of this callback.
        let name = unsafe { core::slice::from_raw_parts(h.name, h.name_len as usize) };
        let value = unsafe { core::slice::from_raw_parts(h.value, h.value_len as usize) };
        if name.starts_with(b":") {
            if name == b":status" {
                // TODO(port): byte-slice parseInt helper (value is ASCII digits per RFC 9114).
                status = core::str::from_utf8(value)
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(0);
            }
            i += 1;
            continue;
        }
        // PERF(port): was appendAssumeCapacity — profile in Phase B
        stream.decoded_headers.push(super::stream::DecodedHeader {
            name,
            value,
        });
        i += 1;
    }
    if status == 0 {
        // A second HEADERS block after the final response is trailers
        // (RFC 9114 §4.1) and carries no :status; ignore it rather than
        // treating the stream as malformed.
        if stream.status_code != 0 {
            return;
        }
        stream.session.fail(stream, err!("HTTP3ProtocolError"));
        return;
    }
    if status >= 100 && status < 200 {
        return;
    }
    stream.status_code = status;
    stream.session.deliver(stream, false);
}

extern "C" fn on_stream_data(s: *mut quic::Stream, data: *const u8, len: c_uint, fin: c_int) {
    // SAFETY: lsquic passes a live stream for the duration of the callback.
    let s = unsafe { &mut *s };
    let Some(mut stream) = *s.ext::<Stream>() else { return };
    // SAFETY: ext slot was set in on_stream_open; live until on_stream_close clears it.
    let stream = unsafe { stream.as_mut() };
    if len > 0 {
        // SAFETY: lsquic guarantees `data` points to `len` valid bytes.
        let slice = unsafe { core::slice::from_raw_parts(data, len as usize) };
        stream.body_buffer.extend_from_slice(slice);
    }
    stream.session.deliver(stream, fin != 0);
}

extern "C" fn on_stream_writable(s: *mut quic::Stream) {
    // SAFETY: lsquic passes a live stream for the duration of the callback.
    let s = unsafe { &mut *s };
    let Some(mut stream) = *s.ext::<Stream>() else { return };
    // SAFETY: ext slot was set in on_stream_open; live until on_stream_close clears it.
    let stream = unsafe { stream.as_mut() };
    encode::drain_send_body(stream, s);
}

extern "C" fn on_stream_close(s: *mut quic::Stream) {
    // SAFETY: lsquic passes a live stream for the duration of the callback.
    let s = unsafe { &mut *s };
    let Some(mut stream) = *s.ext::<Stream>() else { return };
    // SAFETY: ext slot was set in on_stream_open; this callback clears it.
    let stream = unsafe { stream.as_mut() };
    *s.ext::<Stream>() = None;
    stream.qstream = None;
    bun_output::scoped_log!(
        h3_client,
        "stream_close status={} delivered={}",
        stream.status_code,
        stream.headers_delivered
    );
    stream.session.deliver(stream, true);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/h3_client/callbacks.zig (151 lines)
//   confidence: medium
//   todos:      2
//   notes:      ext<T>() modeled as &mut Option<NonNull<T>>; pending items as NonNull<Stream>; stream.session.fail/deliver will need borrowck reshaping in Phase B; H3Client.zig vs h3_client/ dir name collision needs resolving.
// ──────────────────────────────────────────────────────────────────────────
