//! What the QUIC connections of the HTTP/3 client report. Each handler forwards to the session or the stream, so
//! that the protocol logic stays in `client_session.rs` and `encode.rs`.

use bstr::BStr;
use bun_quic::http3::{Fields, Section};
use bun_quic::{Context, Direction, Event, StreamEvent, http3_code};
use bun_uws::quic;

use super::client_context::ClientContext;
use super::client_session::{ClientSession, Progress, session_mut, stream_mut};
use super::encode;
use super::stream::Stream;
use crate::Headers;

use crate::h3_client::h3_client;

/// The context of a connection is its `ClientSession`, which the registry keeps alive until `Event::Closed`. That
/// of a stream is its `Stream`, or null after `ClientSession::detach`.
pub(super) fn on_event(connection: quic::Connection, session: Context, event: Event) {
    match event {
        Event::Stream(id, stream, event) => {
            on_stream_event(connection, connection.stream(id), stream.cast(), event);
        }
        Event::Ready => {
            let session = session_mut(session.cast());
            bun_core::scoped_log!(h3_client, "ready pending={}", session.pending.len());
            session.handshake_done = true;
            session.open_streams();
        }
        Event::StreamsAvailable(Direction::Bidirectional) => {
            session_mut(session.cast()).open_streams();
        }
        Event::GoAway => on_goaway(session_mut(session.cast())),
        Event::Closed(closed) => {
            bun_core::scoped_log!(h3_client, "closed {:?}", closed.close_reason());
            on_close(session_mut(session.cast()));
        }
        _ => {}
    }
}

/// The session stays in the registry, where aborts and body chunks look for the requests in flight.
fn on_goaway(session: &mut ClientSession) {
    bun_core::scoped_log!(
        h3_client,
        "goaway {}:{}",
        BStr::new(&session.hostname),
        session.port,
    );
    session.closed = true;
    while let Some(stream) = session.first_unopened() {
        session.retry_or_fail(stream, crate::Error::ConnectionClosed);
    }
    session.close_if_idle();
}

fn on_close(session: &mut ClientSession) {
    session.closed = true;
    session.connection = None;
    let _registry_ref =
        ClientContext::get().and_then(|ctx| ClientContext::as_mut(ctx).unregister(session));
    // The streams that were opened are closed before their connection.
    while let Some(stream) = session.first_unopened() {
        session.retry_or_fail(
            stream,
            if session.handshake_done {
                crate::Error::ConnectionClosed
            } else {
                crate::Error::HTTP3HandshakeFailed
            },
        );
    }
}

fn on_stream_event(
    connection: quic::Connection,
    qstream: quic::Stream,
    stream_ptr: *mut Stream,
    event: StreamEvent,
) {
    if stream_ptr.is_null() {
        return;
    }
    let stream = stream_mut(stream_ptr);
    match event {
        StreamEvent::Headers(_) | StreamEvent::Data { .. } if !stream.headers_sent => {
            (stream.session_mut()).fail(stream, crate::Error::HTTP3ProtocolError);
        }
        StreamEvent::Headers(fields) => {
            on_headers(stream, &fields);
            connection.recycle(fields);
        }
        StreamEvent::Data { data, is_last } => {
            stream.body_buffer = data;
            stream.idle_seconds = 0;
            let progress = if is_last {
                Progress::Complete
            } else {
                Progress::Partial
            };
            stream.session_mut().deliver(stream, progress);
        }
        StreamEvent::Writable if stream.headers_sent => encode::drain_send_body(stream, qstream),
        StreamEvent::Writable => {
            stream.headers_sent = true;
            if let Err(e) = encode::write_request(stream, qstream) {
                stream.session_mut().fail(stream_ptr, e);
            }
        }
        StreamEvent::Reset(http3_code::MESSAGE_ERROR) if stream.status_code == 0 => {
            (stream.session_mut()).fail(stream, crate::Error::HTTP3ProtocolError);
        }
        StreamEvent::Stopped(_) if qstream.has_received() => {}
        StreamEvent::Reset(http3_code::REQUEST_REJECTED)
        | StreamEvent::Stopped(http3_code::REQUEST_REJECTED) => {
            stream.peer_rejected = true;
            stream.session_mut().deliver(stream, Progress::Aborted);
        }
        StreamEvent::Reset(_) | StreamEvent::Closed => {
            stream.session_mut().deliver(stream, Progress::Aborted);
        }
        StreamEvent::Opened | StreamEvent::Stopped(_) => {}
    }
}

fn on_headers(stream: &mut Stream, fields: &Fields) {
    let session = stream.session_mut();
    if fields.is_incomplete {
        return session.fail(stream, crate::Error::ResponseHeadersTooLarge);
    }
    if fields.section != Section::Head {
        return;
    }
    let mut headers = Headers::default();
    (headers.buf).reserve(fields.iter().map(|it| it.0.len() + it.1.len()).sum());
    bun_core::handle_oom(headers.entries.ensure_total_capacity(fields.len()));
    for (name, value) in fields.iter() {
        match name {
            b":status" => stream.status_code = bun_core::fmt::parse_int(value, 10).unwrap_or(0),
            _ => headers.append(name, value),
        }
    }
    stream.decoded_headers = headers;
    stream.idle_seconds = 0;
    session.deliver(stream, Progress::Partial);
}
