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
use super::client_session::{ClientSession, session_mut, stream_mut, stream_ref};
use super::encode;
use super::stream::Stream;
use crate::h3_client as H3;
use bun_picohttp as picohttp;

use crate::h3_client::h3_client;

/// Upgrade an lsquic-supplied `*mut quic::Socket` callback argument to `&mut`.
///
/// INVARIANT: every `extern "C"` callback in this module receives a non-null
/// `quic::Socket` pointer that lsquic guarantees live for the callback's
/// duration; all callbacks run on the HTTP thread, so the `&mut` is the sole
/// live borrow. Routes through the shared
/// [`client_session::quic_socket_mut`] accessor.
#[inline(always)]
fn qsocket_arg<'a>(qs: *mut quic::Socket) -> &'a mut quic::Socket {
    super::client_session::quic_socket_mut(qs)
}

/// Upgrade an lsquic-supplied `*mut quic::Stream` callback argument to `&mut`.
/// Same INVARIANT as [`qsocket_arg`] (lsquic-owned, live for the callback,
/// HTTP-thread-only). Routes through the shared
/// [`client_session::quic_stream_mut`] accessor.
#[inline(always)]
fn qstream_arg<'a>(s: *mut quic::Stream) -> &'a mut quic::Stream {
    super::client_session::quic_stream_mut(s)
}

/// Recover the `ClientSession` from a `quic::Socket`'s ext slot.
///
/// INVARIANT: the slot is set by `ClientContext::connect` and lives until
/// `on_conn_close` clears it; the `ClientSession` is heap-owned and outlives
/// the callback. lsquic invokes these callbacks on the HTTP thread, so the
/// returned `&mut` is the sole live borrow. The session is a distinct
/// allocation from the `quic::Socket`, so the returned borrow does not alias
/// the `&mut quic::Socket` the caller still holds.
#[inline]
fn session_of<'a>(qs: &mut quic::Socket) -> Option<&'a mut ClientSession> {
    // Route through `client_session::session_mut` (one centralised unsafe);
    // the ext slot is `Option<NonNull<ClientSession>>` — exactly the
    // backref-upgrade that accessor encapsulates.
    (*qs.ext::<ClientSession>()).map(|p| session_mut(p.as_ptr()))
}

/// Recover the h3 `Stream` from a `quic::Stream`'s ext slot.
///
/// INVARIANT: the slot is set in `on_stream_open` (and cleared in `detach`);
/// the `Stream` is heap-owned by its `ClientSession` (`pending` list) and lives
/// until `detach()`. HTTP-thread only, and a distinct allocation from the
/// `quic::Stream`, so the returned `&mut` neither aliases the caller's
/// `&mut quic::Stream` nor any other live borrow.
#[inline]
fn stream_of<'a>(s: &mut quic::Stream) -> Option<&'a mut Stream> {
    // Route through `client_session::stream_mut` (one centralised unsafe);
    // the ext slot is `Option<NonNull<Stream>>` — same backref invariant.
    (*s.ext::<Stream>()).map(|p| stream_mut(p.as_ptr()))
}

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
    let qs = qsocket_arg(qs);
    let Some(session) = session_of(qs) else {
        return;
    };
    bun_core::scoped_log!(
        h3_client,
        "hsk_done ok={} pending={}",
        ok,
        session.pending.len()
    );
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
    let qs = qsocket_arg(qs);
    let Some(session) = session_of(qs) else {
        return;
    };
    bun_core::scoped_log!(
        h3_client,
        "goaway {}:{}",
        BStr::new(&session.hostname),
        session.port,
    );
    session.closed = true;
}

extern "C" fn on_conn_close(qs: *mut quic::Socket) {
    let qs = qsocket_arg(qs);
    let Some(session) = session_of(qs) else {
        return;
    };
    session.closed = true;
    session.qsocket = None;
    let mut buf = [0u8; 256];
    let st = qs.status(&mut buf);
    bun_core::scoped_log!(
        h3_client,
        "conn_close status={} '{}'",
        st,
        BStr::new(bun_core::slice_to_nul(&buf)),
    );
    if let Some(ctx) = ClientContext::get() {
        ClientContext::as_mut(ctx).unregister(session);
    }
    while !session.pending.is_empty() {
        // lsquic fires on_stream_close for every bound stream before
        // on_conn_closed, so anything still here never got a qstream.
        let stream = session.pending[0];
        // pending holds live Stream pointers owned by the session.
        debug_assert!(stream_ref(stream).qstream.is_none());
        session.retry_or_fail(
            stream,
            if session.handshake_done {
                err!(ConnectionClosed)
            } else {
                err!(HTTP3HandshakeFailed)
            },
        );
    }
    let _ = H3::live_sessions.fetch_sub(1, Ordering::Relaxed);
    unsafe { ClientSession::deref(session) };
}

extern "C" fn on_stream_open(s: *mut quic::Stream, is_client: c_int) {
    let s = qstream_arg(s);
    *s.ext::<Stream>() = None;
    if is_client == 0 {
        return;
    }
    let Some(qs) = s.socket() else { return };
    // Parent connection outlives this stream callback; single-threaded event
    // loop, no other `&mut Socket` live across this reborrow — same invariant
    // `qsocket_arg` encapsulates.
    let qs = qsocket_arg(qs.as_ptr());
    let Some(session) = session_of(qs) else {
        s.close();
        return;
    };
    // Bind the next pending request to this stream.
    let stream: *mut Stream = 'find: {
        for &st in session.pending.iter() {
            // pending holds live Stream pointers owned by the session.
            if stream_ref(st).qstream.is_none() {
                break 'find st;
            }
        }
        s.close();
        return;
    };
    // `stream` is a live element of `session.pending` — `stream_mut`
    // centralises that upgrade invariant.
    stream_mut(stream).qstream = Some(NonNull::from(&mut *s));
    *s.ext::<Stream>() = NonNull::new(stream);
    bun_core::scoped_log!(h3_client, "stream_open");
    if let Err(e) = encode::write_request(session, stream_mut(stream), s) {
        session.fail(stream, e);
    }
}

extern "C" fn on_stream_headers(s: *mut quic::Stream) {
    let s = qstream_arg(s);
    let Some(stream) = stream_of(s) else { return };
    let session = stream.session_mut();
    let n = s.header_count();

    stream.decoded_headers.clear();
    stream.decoded_headers.reserve(n as usize);
    let mut status: u16 = 0;
    let mut i: c_uint = 0;
    while i < n {
        let Some(h) = s.header(i) else {
            i += 1;
            continue;
        };
        let name = h.name_bytes();
        let value = h.value_bytes();
        if name.first() == Some(&b':') {
            if name == b":status" {
                status = bun_core::fmt::parse_int::<u16>(value, 10).unwrap_or(0);
            }
            i += 1;
            continue;
        }
        // PERF(port): was appendAssumeCapacity — Vec::push amortizes.
        stream
            .decoded_headers
            .push(picohttp::Header::new(name, value));
        i += 1;
    }
    if status == 0 {
        // A second HEADERS block after the final response is trailers
        // (RFC 9114 §4.1) and carries no :status; ignore it rather than
        // treating the stream as malformed.
        if stream.status_code != 0 {
            return;
        }
        session.fail(stream, err!(HTTP3ProtocolError));
        return;
    }
    if status >= 100 && status < 200 {
        return;
    }
    stream.status_code = status;
    session.deliver(stream, false);
}

extern "C" fn on_stream_data(s: *mut quic::Stream, data: *const u8, len: c_uint, fin: c_int) {
    let s = qstream_arg(s);
    let Some(stream) = stream_of(s) else { return };
    // SAFETY: lsquic guarantees `data` points to `len` valid bytes (or `(null,0)`).
    let slice = unsafe { bun_core::ffi::slice(data, len as usize) };
    stream.body_buffer.extend_from_slice(slice);
    stream.session_mut().deliver(stream, fin != 0);
}

extern "C" fn on_stream_writable(s: *mut quic::Stream) {
    let s = qstream_arg(s);
    let Some(stream) = stream_of(s) else { return };
    encode::drain_send_body(stream, s);
}

extern "C" fn on_stream_close(s: *mut quic::Stream) {
    let s = qstream_arg(s);
    let Some(stream) = stream_of(s) else { return };
    *s.ext::<Stream>() = None;
    stream.qstream = None;
    bun_core::scoped_log!(
        h3_client,
        "stream_close status={} delivered={}",
        stream.status_code,
        stream.headers_delivered,
    );
    stream.session_mut().deliver(stream, true);
}

// ported from: src/http/h3_client/callbacks.zig
