//! Inbound frames of the fetch() HTTP/2 client: the checks that depend on this connection's streams. `bun_http_types::h2` makes the rest.

use bun_http_types::h2::fields;
use bun_http_types::h2::frame::{
    self, ErrorCode, FRAME_HEADER_SIZE, Frame, FrameHeader, FrameType, NextFrame, flags,
};
use bun_http_types::h2::header_block::HeaderBlockError;
use bun_http_types::h2::settings::{DEFAULT_MAX_FRAME_SIZE, SettingId};
use bun_http_types::h2::stream::State as StreamState;

use super::client_session::{ClientSession, stream_mut};
use super::stream::Stream;
use super::{LOCAL_MAX_CONTINUATIONS, LOCAL_MAX_HEADER_LIST_SIZE, WRITE_BUFFER_CONTROL_LIMIT};
use bun_picohttp as picohttp;

bun_core::declare_scope!(h2_client, hidden);

/// Dispatch every complete frame in `buf` and return the number of bytes
/// consumed. The caller spills the unconsumed tail (a partial frame) into
/// `read_buffer`. Operating on a borrowed slice lets `onData` parse
/// straight from the socket chunk in the common case where no partial
/// frame is carried over, saving one memcpy of every body byte.
pub(crate) fn parse_frames(session: &mut ClientSession, buf: &[u8]) -> usize {
    let mut consumed: usize = 0;
    while session.fatal_error.is_none() {
        // We never advertise a SETTINGS_MAX_FRAME_SIZE above the default, which also caps `read_buffer`.
        match frame::next_frame(&buf[consumed..], DEFAULT_MAX_FRAME_SIZE) {
            Ok(NextFrame::Complete { header, payload }) => {
                dispatch_frame(session, &header, payload);
                consumed += FRAME_HEADER_SIZE + payload.len();
            }
            Ok(NextFrame::NeedHeader | NextFrame::Partial { .. }) => break,
            Err(err) => session.fatal_error = Some(error_for(err.code)),
        }
    }
    consumed
}

/// RFC 9113 §5.1.1: an id we never used. Push is disabled, so that includes every even id.
fn is_idle_stream(session: &ClientSession, stream_id: u32) -> bool {
    stream_id & 1 == 0 || stream_id >= session.next_stream_id
}

fn dispatch_frame(session: &mut ClientSession, header: &FrameHeader, payload: &[u8]) {
    bun_core::scoped_log!(
        h2_client,
        "frame type={} len={} flags={} stream={}",
        header.frame_type,
        header.length,
        header.flags,
        header.stream_id
    );
    let stream_id = header.stream_id;

    if !session.header_block.admits(header) {
        session.fatal_error = Some(crate::Error::HTTP2ProtocolError);
        return;
    }
    // RFC 9113 §3.4: the server connection preface is a SETTINGS frame and
    // MUST be the first frame. Without this, GOAWAY-before-SETTINGS leaves
    // coalesced waiters in `pending_attach` forever (drainPending is gated
    // on settings_received and maybeRelease won't run while it's non-empty).
    if !session.settings_received && header.frame_type != FrameType::Settings as u8 {
        session.fatal_error = Some(crate::Error::HTTP2ProtocolError);
        return;
    }

    let frame = match Frame::parse(header, payload, usize::MAX) {
        Ok(frame) => frame,
        Err(err) if err.stream_id == 0 => {
            session.fatal_error = Some(error_for(err.code));
            return;
        }
        Err(err) => {
            match session.streams.get(&err.stream_id).copied() {
                Some(stream_ptr) => {
                    let stream = stream_mut(stream_ptr);
                    session.rst_stream(stream, err.code);
                    stream.fatal_error = Some(error_for(err.code));
                }
                None if is_idle_stream(session, err.stream_id) => {
                    session.fatal_error = Some(crate::Error::HTTP2ProtocolError);
                }
                None => {}
            }
            return;
        }
    };

    match frame {
        Frame::Settings(entries) => {
            for (id, value) in entries {
                match SettingId::from_u16(id) {
                    Some(SettingId::MaxFrameSize) => session.remote_max_frame_size = value,
                    Some(SettingId::MaxConcurrentStreams) => {
                        session.remote_max_concurrent_streams = value;
                    }
                    Some(SettingId::HeaderTableSize) => {
                        session.hpack.set_peer_header_table_size(value);
                    }
                    Some(SettingId::InitialWindowSize) => {
                        // RFC 9113 §6.9.2: the change applies to every open stream's window.
                        let delta =
                            i64::from(value) - i64::from(session.remote_initial_window_size);
                        session.remote_initial_window_size = value;
                        for &s_ptr in session.streams.values() {
                            if stream_mut(s_ptr).send_window.shift(delta).is_err() {
                                session.fatal_error = Some(crate::Error::HTTP2FlowControlError);
                                return;
                            }
                        }
                    }
                    _ => {}
                }
            }
            if session.write_buffer.size() >= WRITE_BUFFER_CONTROL_LIMIT {
                session.fatal_error = Some(crate::Error::HTTP2EnhanceYourCalm);
                return;
            }
            session.write_frame(FrameType::Settings, flags::ACK, 0, &[]);
            session.settings_received = true;
        }
        Frame::SettingsAck => {}
        Frame::WindowUpdate { increment } => {
            if stream_id == 0 {
                if session.conn_send_window.increase(increment).is_err() {
                    session.fatal_error = Some(crate::Error::HTTP2FlowControlError);
                    return;
                }
                session.stream_progressed = true;
            } else if let Some(&stream_ptr) = session.streams.get(&stream_id) {
                let stream = stream_mut(stream_ptr);
                // §6.9.1: overflow on a stream is a stream error; RST_STREAM and fail just that one.
                if let Err(code) = stream.send_window.increase(increment) {
                    session.rst_stream(stream, code);
                    stream.fatal_error = Some(crate::Error::HTTP2FlowControlError);
                    return;
                }
                session.stream_progressed = true;
            } else if is_idle_stream(session, stream_id) {
                session.fatal_error = Some(crate::Error::HTTP2ProtocolError);
            }
        }
        Frame::Ping {
            ack: false,
            payload,
        } => {
            if session.write_buffer.size() >= WRITE_BUFFER_CONTROL_LIMIT {
                session.fatal_error = Some(crate::Error::HTTP2EnhanceYourCalm);
                return;
            }
            session.write_frame(FrameType::Ping, flags::ACK, 0, &payload);
        }
        Frame::Ping { ack: true, .. } => session.awaiting_ping_ack = false,
        Frame::Headers {
            fragment,
            end_stream,
            end_headers,
        } => {
            match session.streams.get(&stream_id).copied() {
                Some(stream_ptr) => {
                    session.stream_progressed = true;
                    session.liveness_ping_spent = false;
                    stream_mut(stream_ptr).headers_end_stream = end_stream;
                }
                None if is_idle_stream(session, stream_id) => {
                    session.fatal_error = Some(crate::Error::HTTP2ProtocolError);
                    return;
                }
                // Our RST_STREAM crossed this HEADERS.
                None => reset_stream_frame_received(session),
            }
            if session.header_block.begin(stream_id, fragment, end_headers) {
                on_header_block(session, stream_id);
            }
        }
        Frame::Continuation {
            fragment,
            end_headers,
        } => match session.header_block.push(
            fragment,
            end_headers,
            LOCAL_MAX_CONTINUATIONS,
            LOCAL_MAX_HEADER_LIST_SIZE as usize,
        ) {
            Ok(true) => on_header_block(session, stream_id),
            Ok(false) => {}
            Err(HeaderBlockError::TooManyContinuations) => {
                session.fatal_error = Some(crate::Error::HTTP2EnhanceYourCalm);
            }
            Err(HeaderBlockError::TooLarge) => {
                session.fatal_error = Some(crate::Error::HTTP2HeaderListTooLarge);
            }
        },
        Frame::Data { data, end_stream } => {
            // Padding counts against both windows (§6.9.1).
            session.conn_recv_window.on_data(payload.len());
            if session.conn_recv_window.is_overflowed(0) {
                session.fatal_error = Some(crate::Error::HTTP2FlowControlError);
                return;
            }
            let Some(stream_ptr) = session.streams.get(&stream_id).copied() else {
                // DATA on a stream we already closed or reset is ignored.
                if is_idle_stream(session, stream_id) {
                    session.fatal_error = Some(crate::Error::HTTP2ProtocolError);
                }
                reset_stream_frame_received(session);
                return;
            };
            let stream = stream_mut(stream_ptr);
            session.stream_progressed = true;
            session.liveness_ping_spent = false;
            // §8.1.1: DATA before the *final* response HEADERS is malformed —
            // a 1xx alone (status_code still 0) doesn't satisfy this.
            if stream.status_code == 0 {
                session.rst_stream(stream, ErrorCode::PROTOCOL_ERROR);
                stream.fatal_error = Some(crate::Error::HTTP2ProtocolError);
                return;
            }
            // §5.1: DATA on a half-closed(remote) or reset stream is
            // STREAM_CLOSED. Without this, frames in the same TCP read as
            // END_STREAM would be appended to body_buffer before the
            // deliver loop swaps the stream out.
            if stream.remote_closed() {
                stream
                    .fatal_error
                    .get_or_insert(crate::Error::HTTP2ProtocolError);
                return;
            }
            stream.recv_window.on_data(payload.len());
            // The window is what bounds the bytes held for a paused consumer.
            if stream.recv_window.is_overflowed(0) {
                session.rst_stream(stream, ErrorCode::FLOW_CONTROL_ERROR);
                stream.fatal_error = Some(crate::Error::HTTP2FlowControlError);
                return;
            }
            if end_stream {
                stream.recv_end_stream();
            }
            stream.data_bytes_received += data.len() as u64;
            stream.body_buffer.extend_from_slice(data);
        }
        Frame::RstStream { code } => {
            if is_idle_stream(session, stream_id) {
                session.fatal_error = Some(crate::Error::HTTP2ProtocolError);
                return;
            }
            let Some(stream_ptr) = session.streams.get(&stream_id).copied() else {
                return;
            };
            let stream = stream_mut(stream_ptr);
            if stream.rst_done {
                // First RST_STREAM wins; a later STREAM_CLOSED for in-flight DATA is ignored.
                return;
            }
            let had_response = stream.remote_closed();
            stream.rst_done = true;
            stream.state = StreamState::Closed;
            // RFC 9113 §8.1: RST_STREAM(NO_ERROR) is the server's "stop
            // uploading, I've already sent the full response" signal —
            // valid only if END_STREAM had already arrived. Otherwise the
            // body is truncated and must surface as an error.
            stream.fatal_error = match code {
                ErrorCode::NO_ERROR if had_response => None,
                ErrorCode::REFUSED_STREAM => Some(crate::Error::HTTP2RefusedStream),
                _ => Some(crate::Error::HTTP2StreamReset),
            };
            stream.http1_required = code == ErrorCode::HTTP_1_1_REQUIRED;
        }
        Frame::GoAway {
            last_stream_id,
            code,
            ..
        } => {
            session.goaway_received = true;
            let graceful = code == ErrorCode::NO_ERROR;
            let http1_required = code == ErrorCode::HTTP_1_1_REQUIRED;
            for &s_ptr in session.streams.values() {
                let s = stream_mut(s_ptr);
                if s.id > last_stream_id {
                    s.http1_required |= http1_required;
                    s.fatal_error = Some(if graceful {
                        crate::Error::HTTP2RefusedStream
                    } else {
                        crate::Error::HTTP2GoAway
                    });
                } else if !graceful && !s.remote_closed() {
                    // RFC 9113 §6.8: streams ≤ last_stream_id "might
                    // still complete successfully" — don't discard a
                    // response that already finished in this same read.
                    s.fatal_error = Some(crate::Error::HTTP2GoAway);
                    // The server may have processed this stream, so only an idempotent request is sent again.
                    s.http1_required |=
                        http1_required && s.client_ref().is_some_and(|c| c.method.is_idempotent());
                }
            }
        }
        // We send SETTINGS_ENABLE_PUSH = 0.
        Frame::PushPromise { .. } => {
            session.fatal_error = Some(crate::Error::HTTP2ProtocolError);
        }
        Frame::Priority | Frame::AltSvc | Frame::Origin | Frame::Unknown => {}
    }
}

/// END_HEADERS arrived. A block for a stream we no longer track is still decoded, to keep the HPACK table in sync (RFC 9113 §4.3).
fn on_header_block(session: &mut ClientSession, stream_id: u32) {
    let block = session.header_block.take();
    match session.streams.get(&stream_id).copied() {
        Some(stream_ptr) => {
            let stream = stream_mut(stream_ptr);
            if stream.headers_end_stream {
                stream.recv_end_stream();
            }
            decode_header_block(session, stream, &block);
        }
        None => decode_and_discard(session, &block),
    }
    session.header_block.recycle(block);
}

fn decode_and_discard(session: &mut ClientSession, block: &[u8]) {
    let mut offset: usize = 0;
    while offset < block.len() {
        match session.hpack.decode(&block[offset..]) {
            Ok(field) => offset += field.next,
            Err(_) => {
                session.fatal_error = Some(crate::Error::HTTP2CompressionError);
                return;
            }
        }
    }
}

/// HPACK-decode a header block at parse time. Runs for every
/// END_HEADERS so the dynamic table stays in sync regardless of how many
/// HEADERS frames arrive in one read. 1xx and trailers are decoded then
/// dropped; the final response is stored on the stream for delivery.
fn decode_header_block(session: &mut ClientSession, stream: &mut Stream, block: &[u8]) {
    let mut status: u32 = 0;
    let mut bounds: Vec<[u32; 3]> = Vec::new();
    let start_len = stream.decoded_bytes.len();
    // The size cap counts a value before the trim, so whitespace is not free.
    let mut untrimmed_len = start_len;
    let mut seen_regular = false;
    let mut seen_status = false;
    // Stream-level malformations seen mid-decode. The loop MUST consume the
    // whole block regardless — the dynamic table is connection-scoped, so
    // bailing early would desync it for every sibling stream. The error is
    // applied once decoding completes.
    let mut malformed = false;

    let mut offset: usize = 0;
    while offset < block.len() {
        let result = match session.hpack.decode(&block[offset..]) {
            Ok(r) => r,
            Err(_) => {
                // The decoder has already committed earlier fields from this
                // block to the connection-level dynamic table; the table is
                // now out of sync with the server's encoder. RFC 9113 §4.3:
                // a decoding error MUST be treated as a connection error of
                // type COMPRESSION_ERROR.
                session.fatal_error = Some(crate::Error::HTTP2CompressionError);
                return;
            }
        };
        offset += result.next;
        if !result.name.is_empty() && result.name[0] == b':' {
            // §8.3.2: only `:status` is defined for responses, MUST appear
            // before any regular field, and MUST NOT repeat. §8.1: not
            // allowed in trailers.
            if stream.status_code != 0 || seen_regular || seen_status || result.name != b":status" {
                malformed = true;
                continue;
            }
            seen_status = true;
            match bun_http_types::parse_status_pseudo_header(result.value) {
                Some(code) => status = u32::from(code),
                None => malformed = true,
            }
            continue;
        }
        seen_regular = true;
        if stream.status_code != 0 || malformed {
            continue;
        }
        if is_malformed_response_field(result.name, result.value) {
            malformed = true;
            continue;
        }
        // Cap decoded size independently of the wire size: HPACK indexed
        // refs can amplify a small block into huge name/value pairs.
        untrimmed_len += result.name.len() + result.value.len();
        if untrimmed_len > LOCAL_MAX_HEADER_LIST_SIZE as usize {
            session.fatal_error = Some(crate::Error::HTTP2HeaderListTooLarge);
            return;
        }
        let name_start: u32 = u32::try_from(stream.decoded_bytes.len()).expect("int cast");
        stream.decoded_bytes.extend_from_slice(result.name);
        let value_start: u32 = u32::try_from(stream.decoded_bytes.len()).expect("int cast");
        stream
            .decoded_bytes
            .extend_from_slice(trim_response_value(result.value));
        bounds.push([
            name_start,
            value_start,
            u32::try_from(stream.decoded_bytes.len()).expect("int cast"),
        ]);
    }

    if malformed {
        stream.decoded_bytes.truncate(start_len);
        session.rst_stream(stream, ErrorCode::PROTOCOL_ERROR);
        stream.fatal_error = Some(crate::Error::HTTP2ProtocolError);
        return;
    }

    // Trailers: status_code already set by an earlier HEADERS. RFC 9113
    // §8.1 — the trailers HEADERS MUST carry END_STREAM; otherwise the
    // server could interleave DATA → HEADERS → DATA and the second DATA
    // would be appended to the body.
    if stream.status_code != 0 {
        if !stream.headers_end_stream {
            stream.fatal_error = Some(crate::Error::HTTP2ProtocolError);
        }
        return;
    }

    if status == 0 {
        stream.decoded_bytes.truncate(start_len);
        stream.fatal_error = Some(crate::Error::HTTP2ProtocolError);
        return;
    }
    if status >= 100 && status < 200 {
        stream.decoded_bytes.truncate(start_len);
        // Only `100 Continue` is the go-ahead for a withheld body; 102/103
        // are informational and do not satisfy `Expect: 100-continue`.
        if status == 100 {
            stream.awaiting_continue = false;
        }
        // RFC 9113 §8.1: a 1xx HEADERS that ends the stream is malformed.
        if stream.remote_closed() {
            stream.fatal_error = Some(crate::Error::HTTP2ProtocolError);
        }
        return;
    }

    stream.status_code = status;
    stream.headers_ready = true;
    if stream.awaiting_continue {
        // Final status without a preceding 100: server has decided without
        // seeing the body. Half-close our side with an empty DATA so the
        // response can finish normally; Content-Length was already stripped
        // on this path so 0 bytes is not a §8.1.1 mismatch.
        stream.awaiting_continue = false;
        session.write_frame(FrameType::Data, flags::END_STREAM, stream.id, &[]);
        stream.sent_end_stream();
    }
    let bytes = stream.decoded_bytes.as_ptr();
    stream.decoded_headers.reserve_exact(
        bounds
            .len()
            .saturating_sub(stream.decoded_headers.capacity()),
    );
    for b in &bounds {
        // Self-referential — decoded_headers stores raw-ptr slices
        // borrowing stream.decoded_bytes. picohttp::Header stores raw ptrs so
        // this is sound as long as decoded_bytes is not reallocated before
        // delivery (it isn't — only ever appended to once per END_HEADERS).
        // SAFETY: bounds are within decoded_bytes; bytes ptr valid until next reallocation.
        let name =
            unsafe { bun_core::ffi::slice(bytes.add(b[0] as usize), (b[1] - b[0]) as usize) };
        // SAFETY: b[1] <= b[2] <= decoded_bytes.len(); bytes is decoded_bytes.as_ptr() with no realloc since.
        let value =
            unsafe { bun_core::ffi::slice(bytes.add(b[1] as usize), (b[2] - b[1]) as usize) };
        stream
            .decoded_headers
            .push(picohttp::Header::new(name, value));
    }
}

/// HEADERS or DATA the peer sent before it saw the RST_STREAM of their stream. They are in
/// front of the ACK of a liveness PING, and a server's PING limit counts them as a response.
fn reset_stream_frame_received(session: &mut ClientSession) {
    session.stream_progressed |= session.awaiting_ping_ack;
    session.liveness_ping_spent = false;
}

/// RFC 9113 §8.2 and RFC 9114 §4.2, for a response: no field of an HTTP/1.1 connection, `te` included.
pub(crate) fn is_malformed_response_field(name: &[u8], value: &[u8]) -> bool {
    fields::is_malformed_name(name)
        || fields::is_connection_specific(name)
        || name == b"te"
        || fields::is_malformed_value(value)
}

/// RFC 9110 §5.5: a parser strips leading and trailing SP / HTAB. HPACK and QPACK do not.
pub(crate) fn trim_response_value(value: &[u8]) -> &[u8] {
    bun_core::strings::trim(value, b" \t")
}

fn error_for(code: ErrorCode) -> crate::Error {
    match code {
        ErrorCode::FRAME_SIZE_ERROR => crate::Error::HTTP2FrameSizeError,
        ErrorCode::FLOW_CONTROL_ERROR => crate::Error::HTTP2FlowControlError,
        ErrorCode::ENHANCE_YOUR_CALM => crate::Error::HTTP2EnhanceYourCalm,
        _ => crate::Error::HTTP2ProtocolError,
    }
}

pub(crate) fn error_code_for(err: crate::Error) -> ErrorCode {
    match err {
        crate::Error::HTTP2ProtocolError => ErrorCode::PROTOCOL_ERROR,
        crate::Error::HTTP2FrameSizeError => ErrorCode::FRAME_SIZE_ERROR,
        crate::Error::HTTP2FlowControlError => ErrorCode::FLOW_CONTROL_ERROR,
        crate::Error::HTTP2CompressionError => ErrorCode::COMPRESSION_ERROR,
        crate::Error::HTTP2HeaderListTooLarge | crate::Error::HTTP2EnhanceYourCalm => {
            ErrorCode::ENHANCE_YOUR_CALM
        }
        _ => ErrorCode::INTERNAL_ERROR,
    }
}
