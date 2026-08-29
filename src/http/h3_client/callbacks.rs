//! lsquic → Rust callbacks for the HTTP/3 client. Registered on the
//! `quic::Context` from `ClientContext::get_or_create`; lsquic invokes these
//! from inside `process_conns` on the HTTP thread. Each one resolves the
//! `ClientSession` / `Stream` from the ext slot and forwards into the
//! corresponding session/stream method so the protocol logic stays in
//! `client_session.rs` / `encode.rs`.

use core::ptr::NonNull;
use std::rc::Rc;

use bstr::BStr;

use bun_ptr::BackRef;
use bun_uws::quic;

use super::client_session::ClientSession;
use super::encode;
use super::stream::Stream;
use crate::h2_client::dispatch::{is_malformed_response_field, is_malformed_response_value};
use bun_picohttp as picohttp;

use crate::h3_client::h3_client;

/// Recover the `ClientSession` from a `quic::Socket`'s ext slot. The slot is
/// set by `ClientContext::connect` and cleared in `on_conn_close`; until then
/// the connection's own reference keeps the session alive.
#[inline]
fn session_of(qs: &mut quic::Socket) -> Option<BackRef<ClientSession>> {
    (*qs.ext::<ClientSession>()).map(BackRef::from)
}

/// Recover the h3 `Stream` from a `quic::Stream`'s ext slot, as a hold of its
/// own (delivery may unlink it from the session). The slot is set in
/// `on_stream_open` and cleared in `detach` / `on_stream_close`; until then
/// the stream is held by its session's `pending` list.
#[inline]
fn stream_of(s: &mut quic::Stream) -> Option<Rc<Stream>> {
    let stream = (*s.ext::<Stream>()).map(BackRef::from)?;
    stream.session.stream_rc(stream.get())
}

pub(crate) struct Handler;

impl quic::context::ClientHandler for Handler {
    fn on_hsk_done(qs: &mut quic::Socket, ok: bool) {
        let Some(session) = session_of(qs) else {
            return;
        };
        bun_core::scoped_log!(
            h3_client,
            "hsk_done ok={} pending={}",
            ok as u8,
            session.pending.borrow().len()
        );
        if !ok {
            session.closed.set(true);
            return;
        }
        session.handshake_done.set(true);
        let pending = session.pending.borrow().len();
        for _ in 0..pending {
            qs.make_stream();
        }
    }

    /// Peer sent GOAWAY: this connection won't accept new streams (RFC 9114
    /// §5.2). Mark the session unusable now so the next `connect()` opens a fresh
    /// one instead of waiting for `on_conn_close`, which only fires after lsquic's
    /// draining period. Stay in the registry so abort/body-chunk lookups still
    /// reach in-flight streams; `on_conn_close` does the actual unregister/deref.
    fn on_goaway(qs: &mut quic::Socket) {
        let Some(session) = session_of(qs) else {
            return;
        };
        bun_core::scoped_log!(
            h3_client,
            "goaway {}:{}",
            BStr::new(&session.hostname),
            session.port,
        );
        session.closed.set(true);
    }

    fn on_conn_close(qs: &mut quic::Socket) {
        let Some(session) = session_of(qs) else {
            return;
        };
        *qs.ext::<ClientSession>() = None;
        let thread = session.thread;
        let session = session.this_ptr();
        ClientSession::enter(session, |session| {
            session.closed.set(true);
            session.qsocket.set(None);
            let mut buf = [0u8; 256];
            let st = qs.status(&mut buf);
            bun_core::scoped_log!(
                h3_client,
                "conn_close status={} '{}'",
                st,
                BStr::new(bun_core::slice_to_nul(&buf)),
            );
            // lsquic fires on_stream_close for every bound stream before
            // on_conn_closed, so anything still pending never got a qstream.
            debug_assert!(
                session
                    .pending
                    .borrow()
                    .iter()
                    .all(|s| s.qstream.get().is_none())
            );
            session.close_with(
                |session| {
                    if session.handshake_done.get() {
                        crate::Error::ConnectionClosed
                    } else {
                        crate::Error::HTTP3HandshakeFailed
                    }
                },
                true,
            );
        });
        // `on_conn_close` is lsquic's terminal callback for this socket, so no
        // later callback reaches the session.
        thread.flush_completions();
    }

    fn on_stream_open(s: &mut quic::Stream, is_client: bool) {
        *s.ext::<Stream>() = None;
        if !is_client {
            return;
        }
        let Some(qs) = s.socket() else { return };
        let Some(session) = session_of(quic::Socket::opaque_mut(qs.as_ptr())) else {
            s.close();
            return;
        };
        // Bind the next pending request to this stream.
        let stream = session
            .pending
            .borrow()
            .iter()
            .find(|st| st.qstream.get().is_none())
            .cloned();
        let Some(stream) = stream else {
            s.close();
            return;
        };
        stream.qstream.set(Some(NonNull::from(&mut *s)));
        *s.ext::<Stream>() = Some(NonNull::from(&*stream));
        bun_core::scoped_log!(h3_client, "stream_open");
        // Headers and body go out from `on_stream_writable`, not here.
        // `on_stream_open` can fire from inside `on_hsk_done`, which lsquic
        // invokes from `ci_tick`'s crypto-read phase with `SC_BUFFER_STREAM` set
        // while the client's TLS Finished is still only on the HSK crypto
        // stream's frab list. Any `lsquic_stream_write` here fills the send
        // controller so `write_is_possible()` goes false before
        // `process_streams_write_events` ever dispatches the crypto stream, and
        // the Finished is never packetized (the server stays a mini-conn and
        // drops every 1-RTT packet). `on_write` is dispatched via lsquic's
        // priority iterator, which serves the crypto stream first. This mirrors
        // lsquic's reference `bin/http_client.c`, whose `on_new_stream` only
        // calls `lsquic_stream_wantwrite(stream, 1)`.
        s.want_write(true);
    }

    fn on_stream_headers(s: &mut quic::Stream) {
        let Some(stream) = stream_of(s) else { return };
        let thread = stream.session.thread;
        let session = stream.session.this_ptr();
        ClientSession::enter(session, |session| {
            let n = s.header_count();

            let mut status: u16 = 0;
            {
                let mut decoded_headers = stream.decoded_headers.borrow_mut();
                decoded_headers.clear();
                decoded_headers.reserve(n as usize);
                let mut i = 0;
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
                    if stream.status_code.get() == 0
                        && (is_malformed_response_field(name) || is_malformed_response_value(value))
                    {
                        drop(decoded_headers);
                        session.fail(&stream, crate::Error::HTTP3ProtocolError);
                        return;
                    }
                    decoded_headers.push(picohttp::Header::new(name, value));
                    i += 1;
                }
            }
            if status == 0 {
                // A second HEADERS block after the final response is trailers
                // (RFC 9114 §4.1) and carries no :status; ignore it rather than
                // treating the stream as malformed.
                if stream.status_code.get() != 0 {
                    return;
                }
                session.fail(&stream, crate::Error::HTTP3ProtocolError);
                return;
            }
            if status >= 100 && status < 200 {
                return;
            }
            stream.status_code.set(status);
            session.deliver(&stream, false);
        });
        thread.flush_completions();
    }

    fn on_stream_data(s: &mut quic::Stream, data: &[u8], fin: bool) {
        let Some(stream) = stream_of(s) else { return };
        stream.body_buffer.borrow_mut().extend_from_slice(data);
        let thread = stream.session.thread;
        let session = stream.session.this_ptr();
        ClientSession::enter(session, |session| session.deliver(&stream, fin));
        thread.flush_completions();

        let Some(stream) = stream_of(s) else { return };
        if fin || stream.read_paused.get() {
            return;
        }
        let Some(req) = stream.client.get() else {
            return;
        };
        if req.signals().is_receive_paused() {
            stream.read_paused.set(true);
            s.want_read(false);
        }
    }

    fn on_stream_writable(s: &mut quic::Stream) {
        let Some(stream) = stream_of(s) else {
            return;
        };
        if !stream.headers_sent.get() {
            stream.headers_sent.set(true);
            let thread = stream.session.thread;
            let session = stream.session.this_ptr();
            ClientSession::enter(session, |session| {
                if let Err(e) = encode::write_request(session, &stream, s) {
                    session.fail(&stream, e);
                }
            });
            thread.flush_completions();
            return;
        }
        encode::drain_send_body(&stream, s);
    }

    fn on_stream_close(s: &mut quic::Stream) {
        let Some(stream) = stream_of(s) else { return };
        *s.ext::<Stream>() = None;
        stream.qstream.set(None);
        bun_core::scoped_log!(
            h3_client,
            "stream_close status={} delivered={}",
            stream.status_code.get(),
            stream.headers_delivered.get(),
        );
        let thread = stream.session.thread;
        let session = stream.session.this_ptr();
        ClientSession::enter(session, |session| session.deliver(&stream, true));
        thread.flush_completions();
    }
}
