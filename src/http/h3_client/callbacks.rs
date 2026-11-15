//! lsquic → Rust callbacks for the HTTP/3 client. Registered on the
//! `quic::Context` from `ClientContext::get_or_create`; lsquic invokes these
//! from inside `process_conns` on the HTTP thread. Each one resolves the
//! `ClientSession` / `Stream` from the ext slot and forwards into the
//! corresponding session/stream method so the protocol logic stays in
//! `client_session.rs` / `encode.rs`.

use core::ffi::{c_int, c_uint};

use bstr::BStr;
use bun_uws::quic;

use super::client_context::ClientContext;
use super::client_session::ClientSession;
use super::encode;
use super::stream::StreamSlot;
use crate::HTTPThread;
use crate::h2_client::dispatch::{
    is_malformed_response_field, is_malformed_response_value, trim_response_value,
};
use bun_picohttp as picohttp;

use crate::h3_client::h3_client;

/// Runs `body` on the session of `qs`, if it has one.
fn with_session(qs: &quic::Socket, body: impl FnOnce(&mut ClientSession)) {
    if let Some(index) = ClientSession::registry_index_of(qs) {
        HTTPThread::enter(|thread| ClientContext::enter(thread, index, |session, _| body(session)));
    }
}

/// Runs `body` on the session of `s` and the index of its stream, if it has one.
fn with_stream(
    s: &mut quic::Stream,
    body: impl FnOnce(&mut quic::Stream, &mut ClientSession, usize, &mut HTTPThread),
) {
    if let Some(slot) = StreamSlot::load_from(s) {
        HTTPThread::enter(|thread| {
            ClientContext::enter(thread, slot.session_index, |session, thread| {
                body(s, session, slot.index, thread);
            });
        });
    }
}

pub(crate) fn register(qctx: &mut quic::Context) {
    qctx.on_hsk_done(on_hsk_done);
    qctx.on_goaway(on_goaway);
    qctx.on_close(on_conn_close);
    qctx.on_stream_open(on_stream_open);
    qctx.on_stream_headers(on_stream_headers);
    qctx.on_stream_data(on_stream_data);
    qctx.on_stream_writable(on_stream_writable);
    qctx.on_stream_close(on_stream_close);
}

extern "C" fn on_hsk_done(qs: &mut quic::Socket, ok: c_int) {
    with_session(qs, |session| {
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
            session.make_stream();
        }
    });
}

/// Peer sent GOAWAY: this connection won't accept new streams (RFC 9114
/// §5.2). Mark the session unusable now so the next `connect()` opens a fresh
/// one instead of waiting for `on_conn_close`, which only fires after lsquic's
/// draining period. Stay in the registry so abort/body-chunk lookups still
/// reach in-flight streams; `on_conn_close` does the actual unregister.
extern "C" fn on_goaway(qs: &mut quic::Socket) {
    with_session(qs, |session| {
        bun_core::scoped_log!(
            h3_client,
            "goaway {}:{}",
            BStr::new(&session.hostname),
            session.port,
        );
        session.closed = true;
    });
}

extern "C" fn on_conn_close(qs: &mut quic::Socket) {
    let Some(index) = ClientSession::registry_index_of(qs) else {
        return;
    };
    let mut buf = [0u8; 256];
    let st = qs.status(&mut buf);
    bun_core::scoped_log!(
        h3_client,
        "conn_close status={} '{}'",
        st,
        BStr::new(bun_core::slice_to_nul(&buf)),
    );
    HTTPThread::enter(|thread| {
        // This is lsquic's last callback for the socket.
        let mut session = ClientContext::unregister(thread, index).expect("registered");
        session.unbind_socket();
        let err = if session.handshake_done {
            crate::Error::ConnectionClosed
        } else {
            crate::Error::HTTP3HandshakeFailed
        };
        // lsquic fires on_stream_close for every bound stream before
        // on_conn_closed, so `streams` is empty.
        while let Some(stream) = session.pending.pop_front() {
            session.retry_or_fail(thread, stream, err);
        }
        thread.run_reconnects();
    });
}

extern "C" fn on_stream_open(s: &mut quic::Stream, is_client: c_int) {
    if is_client == 0 {
        return;
    }
    let Some(qs) = s.socket() else { return };
    let Some(index) = ClientSession::registry_index_of(qs) else {
        s.close();
        return;
    };
    HTTPThread::enter(|thread| {
        ClientContext::enter(thread, index, |session, _| session.bind_stream(s));
    });
}

extern "C" fn on_stream_headers(s: &mut quic::Stream) {
    with_stream(s, handle_stream_headers);
}

fn handle_stream_headers(
    s: &mut quic::Stream,
    session: &mut ClientSession,
    index: usize,
    thread: &mut HTTPThread,
) {
    let stream = &mut session.streams[index];
    if s.headers_too_large() {
        session.fail(thread, index, crate::Error::ResponseHeadersTooLarge);
        return;
    }
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
        if stream.status_code == 0
            && (is_malformed_response_field(name) || is_malformed_response_value(value))
        {
            session.fail(thread, index, crate::Error::HTTP3ProtocolError);
            return;
        }
        stream
            .decoded_headers
            .push(picohttp::Header::new(name, trim_response_value(value)));
        i += 1;
    }
    if status == 0 {
        // A second HEADERS block after the final response is trailers
        // (RFC 9114 §4.1) and carries no :status; ignore it rather than
        // treating the stream as malformed.
        if stream.status_code != 0 {
            return;
        }
        session.fail(thread, index, crate::Error::HTTP3ProtocolError);
        return;
    }
    if status >= 100 && status < 200 {
        return;
    }
    stream.status_code = status;
    session.deliver(thread, index, false);
}

/// # Safety
/// `data` points to `len` valid bytes (or is `(null,0)`).
unsafe extern "C" fn on_stream_data(
    s: &mut quic::Stream,
    data: *const u8,
    len: c_uint,
    fin: c_int,
) {
    // SAFETY: fn contract.
    let slice = unsafe { bun_core::ffi::slice(data, len as usize) };
    with_stream(s, |s, session, index, thread| {
        session.streams[index].body_buffer.extend_from_slice(slice);
        session.deliver(thread, index, fin != 0);

        if StreamSlot::load_from(s).is_none() {
            return;
        }
        let stream = &mut session.streams[index];
        if fin != 0 || stream.read_paused {
            return;
        }
        let Some(client) = &stream.client else { return };
        if client.signals.is_receive_paused() {
            stream.read_paused = true;
            s.want_read(false);
        }
    });
}

extern "C" fn on_stream_writable(s: &mut quic::Stream) {
    with_stream(s, |s, session, index, thread| {
        let stream = &mut session.streams[index];
        if !stream.headers_sent {
            stream.headers_sent = true;
            if let Err(e) = encode::write_request(thread, &session.hostname, stream, s) {
                session.fail(thread, index, e);
            }
            return;
        }
        encode::drain_send_body(stream, s);
    });
}

/// RFC 9114 §8.1: the server did no application processing.
/// `US_QUIC_H3_REQUEST_REJECTED` in quic.h.
const H3_REQUEST_REJECTED: u64 = 0x10B;

extern "C" fn on_stream_close(s: &mut quic::Stream) {
    with_stream(s, |s, session, index, thread| {
        let stream = &mut session.streams[index];
        stream.unbind(false);
        stream.peer_rejected = s.reset_code() == H3_REQUEST_REJECTED || s.refused_by_goaway();
        bun_core::scoped_log!(
            h3_client,
            "stream_close status={} delivered={}",
            stream.status_code,
            stream.headers_delivered,
        );
        session.deliver(thread, index, true);
    });
}
