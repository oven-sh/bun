//! Inbound frame parsing and dispatch for the fetch() HTTP/2 client.
//! Free functions over `&mut ClientSession` so the session struct stays focused on
//! lifecycle and delivery; everything that interprets bytes off the wire lives
//! here.

use crate::h2_client::client_session::ClientSession;
use crate::h2_client::stream::Stream;
use crate::h2_client::{LOCAL_MAX_HEADER_LIST_SIZE, WRITE_BUFFER_CONTROL_LIMIT};
use crate::h2_frame_parser as wire;
use bun_core::err;

bun_output::declare_scope!(h2_client, hidden);

/// Dispatch every complete frame in `buf` and return the number of bytes
/// consumed. The caller spills the unconsumed tail (a partial frame) into
/// `read_buffer`. Operating on a borrowed slice lets `onData` parse
/// straight from the socket chunk in the common case where no partial
/// frame is carried over, saving one memcpy of every body byte.
pub fn parse_frames(session: &mut ClientSession, buf: &[u8]) -> usize {
    let mut consumed: usize = 0;
    loop {
        let remaining = &buf[consumed..];
        if remaining.len() < wire::FrameHeader::BYTE_SIZE {
            break;
        }
        let mut header = wire::FrameHeader { flags: 0, ..Default::default() };
        wire::FrameHeader::from(&mut header, &remaining[0..wire::FrameHeader::BYTE_SIZE], 0, true);
        header.stream_identifier = wire::UInt31WithReserved::from(header.stream_identifier).uint31;
        // RFC 9113 §4.2: a frame larger than the local SETTINGS_MAX_FRAME_SIZE
        // (we never advertise above the 16384 default) is a connection
        // FRAME_SIZE_ERROR. Bounding here also caps `read_buffer` growth.
        if header.length > wire::DEFAULT_MAX_FRAME_SIZE {
            session.fatal_error = Some(err!("HTTP2FrameSizeError"));
            break;
        }
        let frame_len = wire::FrameHeader::BYTE_SIZE + header.length as usize;
        if remaining.len() < frame_len {
            break;
        }
        dispatch_frame(session, header, &remaining[wire::FrameHeader::BYTE_SIZE..frame_len]);
        consumed += frame_len;
        if session.fatal_error.is_some() {
            break;
        }
    }
    consumed
}

pub fn dispatch_frame(session: &mut ClientSession, header: wire::FrameHeader, payload: &[u8]) {
    bun_output::scoped_log!(
        h2_client,
        "frame type={} len={} flags={} stream={}",
        header.r#type,
        header.length,
        header.flags,
        header.stream_identifier
    );

    if session.expecting_continuation != 0
        && header.r#type != wire::FrameType::HttpFrameContinuation as u8
    {
        session.fatal_error = Some(err!("HTTP2ProtocolError"));
        return;
    }
    // RFC 9113 §3.4: the server connection preface is a SETTINGS frame and
    // MUST be the first frame. Without this, GOAWAY-before-SETTINGS leaves
    // coalesced waiters in `pending_attach` forever (drainPending is gated
    // on settings_received and maybeRelease won't run while it's non-empty).
    if !session.settings_received && header.r#type != wire::FrameType::HttpFrameSettings as u8 {
        session.fatal_error = Some(err!("HTTP2ProtocolError"));
        return;
    }

    // TODO(port): wire::FrameType is non-exhaustive on the wire (unknown types are
    // ignored per RFC 9113 §4.1). from_u8 must return Option<FrameType>; transmute
    // of an unknown discriminant would be UB.
    match wire::FrameType::from_u8(header.r#type) {
        Some(wire::FrameType::HttpFrameSettings) => {
            // RFC 9113 §6.5: stream id != 0 is PROTOCOL_ERROR; ACK with a
            // payload, or a non-ACK whose length isn't a multiple of 6, is
            // FRAME_SIZE_ERROR.
            if header.stream_identifier != 0 {
                session.fatal_error = Some(err!("HTTP2ProtocolError"));
                return;
            }
            if header.flags & wire::SettingsFlags::Ack as u8 != 0 {
                if header.length != 0 {
                    session.fatal_error = Some(err!("HTTP2FrameSizeError"));
                }
                return;
            }
            if header.length as usize % wire::SettingsPayloadUnit::BYTE_SIZE != 0 {
                session.fatal_error = Some(err!("HTTP2FrameSizeError"));
                return;
            }
            let mut i: usize = 0;
            while i + wire::SettingsPayloadUnit::BYTE_SIZE <= payload.len() {
                let mut unit: wire::SettingsPayloadUnit =
                    // SAFETY: SettingsPayloadUnit is #[repr(C)] POD; fully overwritten by from() below.
                    unsafe { core::mem::zeroed() };
                wire::SettingsPayloadUnit::from(
                    &mut unit,
                    &payload[i..i + wire::SettingsPayloadUnit::BYTE_SIZE],
                    0,
                    true,
                );
                // TODO(port): wire::SettingsType is non-exhaustive on the wire; from_u16 returns Option.
                match wire::SettingsType::from_u16(unit.r#type) {
                    Some(wire::SettingsType::SettingsMaxFrameSize) => {
                        // RFC 9113 §6.5.2: values outside [16384, 2^24-1]
                        // are a connection PROTOCOL_ERROR. Without the
                        // lower bound, a 0 here makes writeHeaderBlock /
                        // writeDataWindowed spin forever emitting empty
                        // frames.
                        if unit.value < wire::DEFAULT_MAX_FRAME_SIZE
                            || unit.value > wire::MAX_FRAME_SIZE
                        {
                            session.fatal_error = Some(err!("HTTP2ProtocolError"));
                            return;
                        }
                        session.remote_max_frame_size = unit.value as u32; // @truncate
                    }
                    Some(wire::SettingsType::SettingsMaxConcurrentStreams) => {
                        session.remote_max_concurrent_streams = unit.value;
                    }
                    Some(wire::SettingsType::SettingsHeaderTableSize) => {
                        // RFC 9113 §4.3.1 / RFC 7541 §4.2: encoder MUST
                        // acknowledge a reduced limit with a Dynamic Table
                        // Size Update at the start of the next header
                        // block. Track the minimum seen so a reduce-then-
                        // raise between two blocks still signals the dip.
                        session.pending_hpack_enc_capacity = Some(
                            session
                                .pending_hpack_enc_capacity
                                .unwrap_or(unit.value)
                                .min(unit.value),
                        );
                    }
                    Some(wire::SettingsType::SettingsInitialWindowSize) => {
                        // RFC 9113 §6.5.2 / §6.9.2: values above 2^31-1, or
                        // a delta that pushes any open stream's window past
                        // that, are a connection FLOW_CONTROL_ERROR.
                        if unit.value > wire::MAX_WINDOW_SIZE {
                            session.fatal_error = Some(err!("HTTP2FlowControlError"));
                            return;
                        }
                        let delta =
                            i64::from(unit.value) - i64::from(session.remote_initial_window_size);
                        session.remote_initial_window_size = unit.value;
                        // TODO(port): streams map stores *mut Stream; iterating values()
                        // while also able to set session.fatal_error requires raw ptrs.
                        for &s_ptr in session.streams.values() {
                            // SAFETY: stream pointers in the map are valid for the
                            // session's lifetime; no aliasing within this loop.
                            let s = unsafe { &mut *s_ptr };
                            let next = i64::from(s.send_window) + delta;
                            if next > i64::from(wire::MAX_WINDOW_SIZE) {
                                session.fatal_error = Some(err!("HTTP2FlowControlError"));
                                return;
                            }
                            s.send_window = i32::try_from(next).unwrap();
                        }
                    }
                    _ => {}
                }
                i += wire::SettingsPayloadUnit::BYTE_SIZE;
            }
            if session.write_buffer.size() >= WRITE_BUFFER_CONTROL_LIMIT {
                session.fatal_error = Some(err!("HTTP2EnhanceYourCalm"));
                return;
            }
            session.write_frame(
                wire::FrameType::HttpFrameSettings,
                wire::SettingsFlags::Ack as u8,
                0,
                &[],
            );
            session.settings_received = true;
        }
        Some(wire::FrameType::HttpFrameWindowUpdate) => {
            if header.length != 4 {
                session.fatal_error = Some(err!("HTTP2FrameSizeError"));
                return;
            }
            let inc: i32 =
                i32::try_from(wire::UInt31WithReserved::from_bytes(&payload[0..4]).uint31).unwrap();
            if header.stream_identifier == 0 {
                // RFC 9113 §6.9: zero increment on stream 0 is a
                // connection PROTOCOL_ERROR; §6.9.1: overflow past
                // 2^31-1 is a connection FLOW_CONTROL_ERROR.
                if inc == 0 {
                    session.fatal_error = Some(err!("HTTP2ProtocolError"));
                    return;
                }
                let next = i64::from(session.conn_send_window) + i64::from(inc);
                if next > i64::from(wire::MAX_WINDOW_SIZE) {
                    session.fatal_error = Some(err!("HTTP2FlowControlError"));
                    return;
                }
                session.conn_send_window = i32::try_from(next).unwrap();
                session.stream_progressed = true;
            } else if let Some(stream_ptr) =
                session.streams.get((header.stream_identifier & 0x7fff_ffff) as u32)
            {
                // SAFETY: stream pointer valid for session lifetime; aliases neither
                // session.streams (read done) nor session fields touched below.
                let stream = unsafe { &mut *stream_ptr };
                // §6.9/§6.9.1: zero increment / overflow on a stream are
                // stream-level errors; RST_STREAM and fail just that one.
                if inc == 0 {
                    stream.rst(wire::ErrorCode::ProtocolError);
                    stream.fatal_error = Some(err!("HTTP2ProtocolError"));
                    return;
                }
                let next = i64::from(stream.send_window) + i64::from(inc);
                if next > i64::from(wire::MAX_WINDOW_SIZE) {
                    stream.rst(wire::ErrorCode::FlowControlError);
                    stream.fatal_error = Some(err!("HTTP2FlowControlError"));
                    return;
                }
                stream.send_window = i32::try_from(next).unwrap();
                session.stream_progressed = true;
            } else {
                // §5.1: WINDOW_UPDATE on an idle/server-initiated stream
                // is a connection PROTOCOL_ERROR. Silent ignore is correct
                // for closed streams (odd ids we already used).
                let sid: u32 = header.stream_identifier;
                if sid & 1 == 0 || sid >= session.next_stream_id {
                    session.fatal_error = Some(err!("HTTP2ProtocolError"));
                    return;
                }
            }
        }
        Some(wire::FrameType::HttpFramePing) => {
            // RFC 9113 §6.7: length != 8 is a connection FRAME_SIZE_ERROR;
            // a non-zero stream identifier is a connection PROTOCOL_ERROR.
            if header.length != 8 {
                session.fatal_error = Some(err!("HTTP2FrameSizeError"));
                return;
            }
            if header.stream_identifier != 0 {
                session.fatal_error = Some(err!("HTTP2ProtocolError"));
                return;
            }
            if header.flags & wire::PingFrameFlags::Ack as u8 == 0 {
                if session.write_buffer.size() >= WRITE_BUFFER_CONTROL_LIMIT {
                    session.fatal_error = Some(err!("HTTP2EnhanceYourCalm"));
                    return;
                }
                session.write_frame(
                    wire::FrameType::HttpFramePing,
                    wire::PingFrameFlags::Ack as u8,
                    0,
                    &payload[0..8],
                );
            }
        }
        Some(wire::FrameType::HttpFramePriority) => {
            // RFC 9113 §6.3: deprecated, but framing rules remain.
            if header.stream_identifier == 0 {
                session.fatal_error = Some(err!("HTTP2ProtocolError"));
                return;
            }
            if header.length as usize != wire::StreamPriority::BYTE_SIZE {
                session.fatal_error = Some(err!("HTTP2FrameSizeError"));
                return;
            }
        }
        Some(wire::FrameType::HttpFrameHeaders) => {
            let mut fragment = payload;
            let stream_id: u32 = header.stream_identifier;
            let maybe_stream = session.streams.get(stream_id);
            if maybe_stream.is_none() {
                // RFC 9113 §5.1/§5.1.1: HEADERS on a stream we never
                // opened (idle: id >= next_stream_id, or even: server-
                // initiated while push is disabled) is a connection
                // PROTOCOL_ERROR. Only odd ids we already used can be a
                // legitimate "RST crossed an in-flight HEADERS" orphan.
                if stream_id == 0 || stream_id & 1 == 0 || stream_id >= session.next_stream_id {
                    session.fatal_error = Some(err!("HTTP2ProtocolError"));
                    return;
                }
                // Stream we no longer track (RST_STREAM crossed an
                // in-flight HEADERS). The block must still be HPACK-
                // decoded so the connection-level dynamic table stays in
                // sync with the server's encoder, and CONTINUATION must
                // be tracked so a follow-up frame doesn't fatal the whole
                // connection.
                if header.flags & wire::HeadersFrameFlags::Padded as u8 != 0 {
                    fragment = match strip_padding(fragment) {
                        Some(f) => f,
                        None => {
                            session.fatal_error = Some(err!("HTTP2ProtocolError"));
                            return;
                        }
                    };
                }
                if header.flags & wire::HeadersFrameFlags::Priority as u8 != 0 {
                    if fragment.len() < wire::StreamPriority::BYTE_SIZE {
                        session.fatal_error = Some(err!("HTTP2ProtocolError"));
                        return;
                    }
                    fragment = &fragment[wire::StreamPriority::BYTE_SIZE..];
                }
                if fragment.len() > LOCAL_MAX_HEADER_LIST_SIZE {
                    session.fatal_error = Some(err!("HTTP2HeaderListTooLarge"));
                    return;
                }
                session.orphan_header_block.clear();
                session.orphan_header_block.extend_from_slice(fragment);
                if header.flags & wire::HeadersFrameFlags::EndHeaders as u8 != 0 {
                    decode_discard_orphan(session);
                } else {
                    session.expecting_continuation = stream_id;
                }
                return;
            }
            // SAFETY: stream pointer from map is valid for session lifetime.
            let stream = unsafe { &mut *maybe_stream.unwrap() };
            session.stream_progressed = true;
            if header.flags & wire::HeadersFrameFlags::Padded as u8 != 0 {
                fragment = match strip_padding(fragment) {
                    Some(f) => f,
                    None => {
                        session.fatal_error = Some(err!("HTTP2ProtocolError"));
                        return;
                    }
                };
            }
            if header.flags & wire::HeadersFrameFlags::Priority as u8 != 0 {
                if fragment.len() < wire::StreamPriority::BYTE_SIZE {
                    session.fatal_error = Some(err!("HTTP2ProtocolError"));
                    return;
                }
                fragment = &fragment[wire::StreamPriority::BYTE_SIZE..];
            }
            if fragment.len() > LOCAL_MAX_HEADER_LIST_SIZE {
                session.fatal_error = Some(err!("HTTP2HeaderListTooLarge"));
                return;
            }
            stream.header_block.clear();
            stream.header_block.extend_from_slice(fragment);
            stream.headers_end_stream =
                header.flags & wire::HeadersFrameFlags::EndStream as u8 != 0;
            if header.flags & wire::HeadersFrameFlags::EndHeaders as u8 != 0 {
                if stream.headers_end_stream {
                    stream.recv_end_stream();
                }
                decode_header_block(session, stream);
            } else {
                session.expecting_continuation = stream.id;
            }
        }
        Some(wire::FrameType::HttpFrameContinuation) => {
            if session.expecting_continuation == 0
                || header.stream_identifier != session.expecting_continuation
            {
                session.fatal_error = Some(err!("HTTP2ProtocolError"));
                return;
            }
            if let Some(stream_ptr) = session.streams.get(session.expecting_continuation) {
                // SAFETY: stream pointer valid for session lifetime.
                let stream = unsafe { &mut *stream_ptr };
                if stream.header_block.len() + payload.len() > LOCAL_MAX_HEADER_LIST_SIZE {
                    session.fatal_error = Some(err!("HTTP2HeaderListTooLarge"));
                    return;
                }
                stream.header_block.extend_from_slice(payload);
                if header.flags & wire::HeadersFrameFlags::EndHeaders as u8 != 0 {
                    session.expecting_continuation = 0;
                    if stream.headers_end_stream {
                        stream.recv_end_stream();
                    }
                    decode_header_block(session, stream);
                }
            } else {
                if session.orphan_header_block.len() + payload.len() > LOCAL_MAX_HEADER_LIST_SIZE {
                    session.fatal_error = Some(err!("HTTP2HeaderListTooLarge"));
                    return;
                }
                session.orphan_header_block.extend_from_slice(payload);
                if header.flags & wire::HeadersFrameFlags::EndHeaders as u8 != 0 {
                    session.expecting_continuation = 0;
                    decode_discard_orphan(session);
                }
            }
        }
        Some(wire::FrameType::HttpFrameData) => {
            session.conn_unacked_bytes = session.conn_unacked_bytes.saturating_add(header.length);
            let stream_id: u32 = header.stream_identifier;
            let stream_ptr = match session.streams.get(stream_id) {
                Some(p) => p,
                None => {
                    // §6.1/§5.1: DATA on stream 0, an idle stream, or a
                    // server-initiated stream is a connection PROTOCOL_ERROR.
                    // DATA on a stream we already closed/reset is ignored.
                    if stream_id == 0 || stream_id & 1 == 0 || stream_id >= session.next_stream_id {
                        session.fatal_error = Some(err!("HTTP2ProtocolError"));
                    }
                    return;
                }
            };
            // SAFETY: stream pointer valid for session lifetime.
            let stream = unsafe { &mut *stream_ptr };
            session.stream_progressed = true;
            // §8.1.1: DATA before the *final* response HEADERS is malformed —
            // a 1xx alone (status_code still 0) doesn't satisfy this.
            if stream.status_code == 0 {
                stream.rst(wire::ErrorCode::ProtocolError);
                stream.fatal_error = Some(err!("HTTP2ProtocolError"));
                return;
            }
            // §5.1: DATA on a half-closed(remote) or reset stream is
            // STREAM_CLOSED. Without this, frames in the same TCP read as
            // END_STREAM would be appended to body_buffer before the
            // deliver loop swaps the stream out.
            if stream.remote_closed() {
                stream.fatal_error.get_or_insert(err!("HTTP2ProtocolError"));
                return;
            }
            stream.unacked_bytes = stream.unacked_bytes.saturating_add(header.length);
            let mut fragment = payload;
            if header.flags & wire::DataFrameFlags::Padded as u8 != 0 {
                fragment = match strip_padding(fragment) {
                    Some(f) => f,
                    None => {
                        session.fatal_error = Some(err!("HTTP2ProtocolError"));
                        return;
                    }
                };
            }
            if header.flags & wire::DataFrameFlags::EndStream as u8 != 0 {
                stream.recv_end_stream();
            }
            stream.data_bytes_received += fragment.len();
            if !fragment.is_empty() {
                stream.body_buffer.extend_from_slice(fragment);
            }
        }
        Some(wire::FrameType::HttpFrameRstStream) => {
            if header.length != 4 {
                session.fatal_error = Some(err!("HTTP2FrameSizeError"));
                return;
            }
            let stream_id: u32 = header.stream_identifier;
            // RFC 9113 §6.4: stream 0, or an idle stream (one we never
            // opened — even ids included since push is disabled), is a
            // connection PROTOCOL_ERROR.
            if stream_id == 0 || stream_id & 1 == 0 || stream_id >= session.next_stream_id {
                session.fatal_error = Some(err!("HTTP2ProtocolError"));
                return;
            }
            let stream_ptr = match session.streams.get(stream_id) {
                Some(p) => p,
                None => return,
            };
            // SAFETY: stream pointer valid for session lifetime.
            let stream = unsafe { &mut *stream_ptr };
            let had_response = stream.remote_closed();
            stream.rst_done = true;
            stream.state = StreamState::Closed;
            // TODO(port): StreamState enum location — assumed crate::h2_client::stream::StreamState
            let code: u32 = wire::u32_from_bytes(&payload[0..4]);
            // RFC 9113 §8.1: RST_STREAM(NO_ERROR) is the server's "stop
            // uploading, I've already sent the full response" signal —
            // valid only if END_STREAM had already arrived. Otherwise the
            // body is truncated and must surface as an error.
            stream.fatal_error = match code {
                x if x == wire::ErrorCode::NoError as u32 => {
                    if had_response {
                        None
                    } else {
                        Some(err!("HTTP2StreamReset"))
                    }
                }
                x if x == wire::ErrorCode::RefusedStream as u32 => {
                    Some(err!("HTTP2RefusedStream"))
                }
                _ => Some(err!("HTTP2StreamReset")),
            };
        }
        Some(wire::FrameType::HttpFrameGoaway) => {
            if header.stream_identifier != 0 {
                session.fatal_error = Some(err!("HTTP2ProtocolError"));
                return;
            }
            if header.length < 8 {
                session.fatal_error = Some(err!("HTTP2FrameSizeError"));
                return;
            }
            session.goaway_received = true;
            session.goaway_last_stream_id =
                wire::UInt31WithReserved::from_bytes(&payload[0..4]).uint31;
            let code: u32 = wire::u32_from_bytes(&payload[4..8]);
            let graceful = code == wire::ErrorCode::NoError as u32;
            // TODO(port): borrowck — iterating session.streams while reading
            // session.goaway_last_stream_id. Captured into local above.
            let last_id = session.goaway_last_stream_id;
            for &s_ptr in session.streams.values() {
                // SAFETY: stream pointer valid for session lifetime.
                let s = unsafe { &mut *s_ptr };
                if s.id > last_id {
                    s.fatal_error = Some(if graceful {
                        err!("HTTP2RefusedStream")
                    } else {
                        err!("HTTP2GoAway")
                    });
                } else if !graceful && !s.remote_closed() {
                    // RFC 9113 §6.8: streams ≤ last_stream_id "might
                    // still complete successfully" — don't discard a
                    // response that already finished in this same read.
                    s.fatal_error = Some(err!("HTTP2GoAway"));
                }
            }
        }
        Some(wire::FrameType::HttpFramePushPromise) => {
            session.fatal_error = Some(err!("HTTP2ProtocolError"));
        }
        _ => {}
    }
}

/// Feed an orphaned (untracked-stream) header block through the HPACK
/// decoder purely to keep the dynamic table in sync, then discard.
pub fn decode_discard_orphan(session: &mut ClientSession) {
    // PORT NOTE: reshaped for borrowck (was `defer .clearRetainingCapacity()`).
    let mut offset: usize = 0;
    while offset < session.orphan_header_block.len() {
        let result = match session.hpack.decode(&session.orphan_header_block[offset..]) {
            Ok(r) => r,
            Err(_) => {
                session.fatal_error = Some(err!("HTTP2CompressionError"));
                session.orphan_header_block.clear();
                return;
            }
        };
        offset += result.next;
    }
    session.orphan_header_block.clear();
}

/// HPACK-decode the buffered header block at parse time. Runs for every
/// END_HEADERS so the dynamic table stays in sync regardless of how many
/// HEADERS frames arrive in one read. 1xx and trailers are decoded then
/// dropped; the final response is stored on the stream for delivery.
pub fn decode_header_block(session: &mut ClientSession, stream: &mut Stream) {
    // PORT NOTE: reshaped for borrowck (was `defer stream.header_block.clearRetainingCapacity()`)
    // — `.clear()` is inlined before each return below.
    let mut status: u32 = 0;
    let mut bounds: Vec<[u32; 3]> = Vec::new();
    let start_len = stream.decoded_bytes.len();
    let mut seen_regular = false;
    let mut seen_status = false;
    // Stream-level malformations seen mid-decode. The loop MUST consume the
    // whole block regardless — the dynamic table is connection-scoped, so
    // bailing early would desync it for every sibling stream. The error is
    // applied once decoding completes.
    let mut malformed = false;

    let mut offset: usize = 0;
    while offset < stream.header_block.len() {
        let result = match session.hpack.decode(&stream.header_block[offset..]) {
            Ok(r) => r,
            Err(_) => {
                // The decoder has already committed earlier fields from this
                // block to the connection-level dynamic table; the table is
                // now out of sync with the server's encoder. RFC 9113 §4.3:
                // a decoding error MUST be treated as a connection error of
                // type COMPRESSION_ERROR.
                session.fatal_error = Some(err!("HTTP2CompressionError"));
                stream.header_block.clear();
                return;
            }
        };
        offset += result.next;
        if !result.name.is_empty() && result.name[0] == b':' {
            // §8.3.2: only `:status` is defined for responses, MUST appear
            // before any regular field, and MUST NOT repeat. §8.1: not
            // allowed in trailers.
            if stream.status_code != 0
                || seen_regular
                || seen_status
                || result.name != b":status"
            {
                malformed = true;
                continue;
            }
            seen_status = true;
            // RFC 9110 §15: status-code is a 3-digit integer. Parse bytes
            // directly — HTTP header values are octets, not guaranteed UTF-8.
            status = if result.value.len() == 3 {
                result
                    .value
                    .iter()
                    .try_fold(0u32, |a, &b| {
                        (b'0'..=b'9').contains(&b).then(|| a * 10 + (b - b'0') as u32)
                    })
                    .unwrap_or(0)
            } else {
                0
            };
            if status < 100 || status > 999 {
                malformed = true;
            }
            continue;
        }
        seen_regular = true;
        if stream.status_code != 0 || malformed {
            continue;
        }
        if is_malformed_response_field(result.name) {
            malformed = true;
            continue;
        }
        // Cap decoded size independently of the wire size: HPACK indexed
        // refs can amplify a small block into huge name/value pairs.
        if stream.decoded_bytes.len() + result.name.len() + result.value.len()
            > LOCAL_MAX_HEADER_LIST_SIZE
        {
            session.fatal_error = Some(err!("HTTP2HeaderListTooLarge"));
            stream.header_block.clear();
            return;
        }
        let name_start: u32 = u32::try_from(stream.decoded_bytes.len()).unwrap();
        stream.decoded_bytes.extend_from_slice(result.name);
        let value_start: u32 = u32::try_from(stream.decoded_bytes.len()).unwrap();
        stream.decoded_bytes.extend_from_slice(result.value);
        bounds.push([
            name_start,
            value_start,
            u32::try_from(stream.decoded_bytes.len()).unwrap(),
        ]);
    }

    stream.header_block.clear();

    if malformed {
        stream.decoded_bytes.truncate(start_len);
        stream.rst(wire::ErrorCode::ProtocolError);
        stream.fatal_error = Some(err!("HTTP2ProtocolError"));
        return;
    }

    // Trailers: status_code already set by an earlier HEADERS. RFC 9113
    // §8.1 — the trailers HEADERS MUST carry END_STREAM; otherwise the
    // server could interleave DATA → HEADERS → DATA and the second DATA
    // would be appended to the body.
    if stream.status_code != 0 {
        if !stream.headers_end_stream {
            stream.fatal_error = Some(err!("HTTP2ProtocolError"));
        }
        return;
    }

    if status == 0 {
        stream.decoded_bytes.truncate(start_len);
        stream.fatal_error = Some(err!("HTTP2ProtocolError"));
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
            stream.fatal_error = Some(err!("HTTP2ProtocolError"));
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
        session.write_frame(
            wire::FrameType::HttpFrameData,
            wire::DataFrameFlags::EndStream as u8,
            stream.id,
            &[],
        );
        stream.sent_end_stream();
    }
    let bytes = stream.decoded_bytes.as_slice();
    stream
        .decoded_headers
        .reserve_exact(bounds.len().saturating_sub(stream.decoded_headers.len()));
    for b in &bounds {
        // TODO(port): self-referential — decoded_headers stores slices that borrow
        // from stream.decoded_bytes. Phase B: store (u32, u32, u32) bounds instead,
        // or raw *const u8, to avoid the self-borrow.
        // PERF(port): was appendAssumeCapacity — profile in Phase B
        stream.decoded_headers.push(DecodedHeader {
            name: &bytes[b[0] as usize..b[1] as usize],
            value: &bytes[b[1] as usize..b[2] as usize],
        });
    }
}

pub fn strip_padding(payload: &[u8]) -> Option<&[u8]> {
    if payload.is_empty() {
        return None;
    }
    let pad: usize = payload[0] as usize;
    if pad >= payload.len() {
        return None;
    }
    Some(&payload[1..payload.len() - pad])
}

/// RFC 9113 §8.2.1/§8.2.2 response-side validation: lowercase names, no
/// hop-by-hop fields. Names from lshpack are already lowercase for table
/// hits but a literal can carry anything.
pub fn is_malformed_response_field(name: &[u8]) -> bool {
    for &c in name {
        if c >= b'A' && c <= b'Z' {
            return true;
        }
    }
    FORBIDDEN_RESPONSE_FIELDS.contains(name)
}

static FORBIDDEN_RESPONSE_FIELDS: phf::Set<&'static [u8]> = phf::phf_set! {
    b"connection",
    b"keep-alive",
    b"proxy-connection",
    b"te",
    b"transfer-encoding",
    b"upgrade",
};

pub fn error_code_for(err: bun_core::Error) -> wire::ErrorCode {
    match err {
        e if e == err!("HTTP2ProtocolError") => wire::ErrorCode::ProtocolError,
        e if e == err!("HTTP2FrameSizeError") => wire::ErrorCode::FrameSizeError,
        e if e == err!("HTTP2FlowControlError") => wire::ErrorCode::FlowControlError,
        e if e == err!("HTTP2CompressionError") => wire::ErrorCode::CompressionError,
        e if e == err!("HTTP2HeaderListTooLarge") || e == err!("HTTP2EnhanceYourCalm") => {
            wire::ErrorCode::EnhanceYourCalm
        }
        _ => wire::ErrorCode::InternalError,
    }
}

// TODO(port): DecodedHeader / StreamState are defined in sibling modules; placeholder import.
use crate::h2_client::stream::{DecodedHeader, StreamState};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/h2_client/dispatch.zig (583 lines)
//   confidence: medium-high
//   todos:      7
//   notes:      streams map assumed to hold *mut Stream (raw); decoded_headers self-borrow needs index-based redesign; FrameType/SettingsType need from_u8/from_u16 (non-exhaustive wire enums)
// ──────────────────────────────────────────────────────────────────────────
