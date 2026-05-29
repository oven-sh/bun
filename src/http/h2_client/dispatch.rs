//! Inbound frame parsing and dispatch for the fetch() HTTP/2 client.
//! Free functions over `&mut ClientSession` so the session struct stays focused on
//! lifecycle and delivery; everything that interprets bytes off the wire lives
//! here.

use super::client_session::{ClientSession, stream_mut};
use super::stream::{State as StreamState, Stream};
use super::{LOCAL_MAX_HEADER_LIST_SIZE, WRITE_BUFFER_CONTROL_LIMIT};
use crate::h2_frame_parser as wire;
use bun_core::err;
use bun_picohttp as picohttp;

bun_core::declare_scope!(h2_client, hidden);

pub fn parse_frames(session: &mut ClientSession, buf: &[u8]) -> usize {
    let mut consumed: usize = 0;
    loop {
        let remaining = &buf[consumed..];
        if remaining.len() < wire::FrameHeader::BYTE_SIZE {
            break;
        }
        let mut header = wire::FrameHeader::decode(
            remaining[0..wire::FrameHeader::BYTE_SIZE]
                .try_into()
                .unwrap(),
        );
        let sid = wire::UInt31WithReserved::from(header.stream_identifier).uint31();
        header.stream_identifier = sid;
        let length = header.length;
        // RFC 9113 §4.2: a frame larger than the local SETTINGS_MAX_FRAME_SIZE
        // (we never advertise above the 16384 default) is a connection
        // FRAME_SIZE_ERROR. Bounding here also caps `read_buffer` growth.
        if length > wire::DEFAULT_MAX_FRAME_SIZE {
            session.fatal_error = Some(err!(HTTP2FrameSizeError));
            break;
        }
        let frame_len = wire::FrameHeader::BYTE_SIZE + length as usize;
        if remaining.len() < frame_len {
            break;
        }
        dispatch_frame(
            session,
            header.type_,
            header.flags,
            sid,
            length,
            &remaining[wire::FrameHeader::BYTE_SIZE..frame_len],
        );
        consumed += frame_len;
        if session.fatal_error.is_some() {
            break;
        }
    }
    consumed
}

// PORT NOTE: Zig's `wire.FrameType` is non-exhaustive (any u8 valid). A
// `#[repr(u8)]` Rust enum is UB for unknown discriminants, so dispatch on the
// raw u8.
const FT_DATA: u8 = wire::FrameType::HTTP_FRAME_DATA as u8;
const FT_HEADERS: u8 = wire::FrameType::HTTP_FRAME_HEADERS as u8;
const FT_PRIORITY: u8 = wire::FrameType::HTTP_FRAME_PRIORITY as u8;
const FT_RST_STREAM: u8 = wire::FrameType::HTTP_FRAME_RST_STREAM as u8;
const FT_SETTINGS: u8 = wire::FrameType::HTTP_FRAME_SETTINGS as u8;
const FT_PUSH_PROMISE: u8 = wire::FrameType::HTTP_FRAME_PUSH_PROMISE as u8;
const FT_PING: u8 = wire::FrameType::HTTP_FRAME_PING as u8;
const FT_GOAWAY: u8 = wire::FrameType::HTTP_FRAME_GOAWAY as u8;
const FT_WINDOW_UPDATE: u8 = wire::FrameType::HTTP_FRAME_WINDOW_UPDATE as u8;
const FT_CONTINUATION: u8 = wire::FrameType::HTTP_FRAME_CONTINUATION as u8;

const ST_HEADER_TABLE_SIZE: u16 = wire::SettingsType::SETTINGS_HEADER_TABLE_SIZE.0;
const ST_MAX_CONCURRENT_STREAMS: u16 = wire::SettingsType::SETTINGS_MAX_CONCURRENT_STREAMS.0;
const ST_INITIAL_WINDOW_SIZE: u16 = wire::SettingsType::SETTINGS_INITIAL_WINDOW_SIZE.0;
const ST_MAX_FRAME_SIZE: u16 = wire::SettingsType::SETTINGS_MAX_FRAME_SIZE.0;

pub(crate) fn dispatch_frame(
    session: &mut ClientSession,
    frame_type: u8,
    flags: u8,
    stream_id: u32,
    length: u32,
    payload: &[u8],
) {
    bun_core::scoped_log!(
        h2_client,
        "frame type={} len={} flags={} stream={}",
        frame_type,
        length,
        flags,
        stream_id
    );

    if session.expecting_continuation != 0 && frame_type != FT_CONTINUATION {
        session.fatal_error = Some(err!(HTTP2ProtocolError));
        return;
    }
    if !session.settings_received && frame_type != FT_SETTINGS {
        session.fatal_error = Some(err!(HTTP2ProtocolError));
        return;
    }

    match frame_type {
        FT_SETTINGS => {
            // RFC 9113 §6.5: stream id != 0 is PROTOCOL_ERROR; ACK with a
            // payload, or a non-ACK whose length isn't a multiple of 6, is
            // FRAME_SIZE_ERROR.
            if stream_id != 0 {
                session.fatal_error = Some(err!(HTTP2ProtocolError));
                return;
            }
            if flags & wire::SettingsFlags::ACK as u8 != 0 {
                if length != 0 {
                    session.fatal_error = Some(err!(HTTP2FrameSizeError));
                }
                return;
            }
            if !(length as usize).is_multiple_of(wire::SettingsPayloadUnit::BYTE_SIZE) {
                session.fatal_error = Some(err!(HTTP2FrameSizeError));
                return;
            }
            let mut i: usize = 0;
            while i + wire::SettingsPayloadUnit::BYTE_SIZE <= payload.len() {
                let mut unit = wire::SettingsPayloadUnit::default();
                wire::SettingsPayloadUnit::from::<true>(
                    &mut unit,
                    &payload[i..i + wire::SettingsPayloadUnit::BYTE_SIZE],
                    0,
                );
                // PORT NOTE: brace-expr copies of packed fields (unaligned-safe).
                let utype = { unit.type_ };
                let uvalue = { unit.value };
                match utype {
                    ST_MAX_FRAME_SIZE => {
                        if uvalue < wire::DEFAULT_MAX_FRAME_SIZE || uvalue > wire::MAX_FRAME_SIZE {
                            session.fatal_error = Some(err!(HTTP2ProtocolError));
                            return;
                        }
                        session.remote_max_frame_size = uvalue; // @truncate(u24)
                    }
                    ST_MAX_CONCURRENT_STREAMS => {
                        session.remote_max_concurrent_streams = uvalue;
                    }
                    ST_HEADER_TABLE_SIZE => {
                        session.pending_hpack_enc_capacity = Some(
                            session
                                .pending_hpack_enc_capacity
                                .unwrap_or(uvalue)
                                .min(uvalue),
                        );
                    }
                    ST_INITIAL_WINDOW_SIZE => {
                        // RFC 9113 §6.5.2 / §6.9.2: values above 2^31-1, or
                        // a delta that pushes any open stream's window past
                        // that, are a connection FLOW_CONTROL_ERROR.
                        if uvalue > wire::MAX_WINDOW_SIZE {
                            session.fatal_error = Some(err!(HTTP2FlowControlError));
                            return;
                        }
                        let delta =
                            i64::from(uvalue) - i64::from(session.remote_initial_window_size);
                        session.remote_initial_window_size = uvalue;
                        for &s_ptr in session.streams.values() {
                            let s = stream_mut(s_ptr);
                            let next = i64::from(s.send_window) + delta;
                            if next > i64::from(wire::MAX_WINDOW_SIZE) {
                                session.fatal_error = Some(err!(HTTP2FlowControlError));
                                return;
                            }
                            s.send_window = i32::try_from(next).expect("int cast");
                        }
                    }
                    _ => {}
                }
                i += wire::SettingsPayloadUnit::BYTE_SIZE;
            }
            if session.write_buffer.size() >= WRITE_BUFFER_CONTROL_LIMIT {
                session.fatal_error = Some(err!(HTTP2EnhanceYourCalm));
                return;
            }
            session.write_frame(
                wire::FrameType::HTTP_FRAME_SETTINGS,
                wire::SettingsFlags::ACK as u8,
                0,
                &[],
            );
            session.settings_received = true;
        }
        FT_WINDOW_UPDATE => {
            if length != 4 {
                session.fatal_error = Some(err!(HTTP2FrameSizeError));
                return;
            }
            let inc = i32::try_from(wire::UInt31WithReserved::from_bytes(&payload[0..4]).uint31())
                .expect("int cast");
            if stream_id == 0 {
                // RFC 9113 §6.9: zero increment on stream 0 is a
                // connection PROTOCOL_ERROR; §6.9.1: overflow past
                // 2^31-1 is a connection FLOW_CONTROL_ERROR.
                if inc == 0 {
                    session.fatal_error = Some(err!(HTTP2ProtocolError));
                    return;
                }
                let next = i64::from(session.conn_send_window) + i64::from(inc);
                if next > i64::from(wire::MAX_WINDOW_SIZE) {
                    session.fatal_error = Some(err!(HTTP2FlowControlError));
                    return;
                }
                session.conn_send_window = i32::try_from(next).expect("int cast");
                session.stream_progressed = true;
            } else if let Some(&stream_ptr) = session.streams.get(&(stream_id & 0x7fff_ffff)) {
                let stream = stream_mut(stream_ptr);
                // §6.9/§6.9.1: zero increment / overflow on a stream are
                // stream-level errors; RST_STREAM and fail just that one.
                if inc == 0 {
                    session.rst_stream(stream, wire::ErrorCode::PROTOCOL_ERROR);
                    stream.fatal_error = Some(err!(HTTP2ProtocolError));
                    return;
                }
                let next = i64::from(stream.send_window) + i64::from(inc);
                if next > i64::from(wire::MAX_WINDOW_SIZE) {
                    session.rst_stream(stream, wire::ErrorCode::FLOW_CONTROL_ERROR);
                    stream.fatal_error = Some(err!(HTTP2FlowControlError));
                    return;
                }
                stream.send_window = i32::try_from(next).expect("int cast");
                session.stream_progressed = true;
            } else {
                // §5.1: WINDOW_UPDATE on an idle/server-initiated stream
                // is a connection PROTOCOL_ERROR. Silent ignore is correct
                // for closed streams (odd ids we already used).
                if stream_id & 1 == 0 || stream_id >= session.next_stream_id {
                    session.fatal_error = Some(err!(HTTP2ProtocolError));
                    return;
                }
            }
        }
        FT_PING => {
            // RFC 9113 §6.7: length != 8 is a connection FRAME_SIZE_ERROR;
            // a non-zero stream identifier is a connection PROTOCOL_ERROR.
            if length != 8 {
                session.fatal_error = Some(err!(HTTP2FrameSizeError));
                return;
            }
            if stream_id != 0 {
                session.fatal_error = Some(err!(HTTP2ProtocolError));
                return;
            }
            if flags & wire::PingFrameFlags::ACK as u8 == 0 {
                if session.write_buffer.size() >= WRITE_BUFFER_CONTROL_LIMIT {
                    session.fatal_error = Some(err!(HTTP2EnhanceYourCalm));
                    return;
                }
                session.write_frame(
                    wire::FrameType::HTTP_FRAME_PING,
                    wire::PingFrameFlags::ACK as u8,
                    0,
                    &payload[0..8],
                );
            }
        }
        FT_PRIORITY => {
            // RFC 9113 §6.3: deprecated, but framing rules remain.
            if stream_id == 0 {
                session.fatal_error = Some(err!(HTTP2ProtocolError));
                return;
            }
            if length as usize != wire::StreamPriority::BYTE_SIZE {
                session.fatal_error = Some(err!(HTTP2FrameSizeError));
                return;
            }
        }
        FT_HEADERS => {
            let mut fragment = payload;
            let maybe_stream = session.streams.get(&stream_id).copied();
            if maybe_stream.is_none() {
                if stream_id == 0 || stream_id & 1 == 0 || stream_id >= session.next_stream_id {
                    session.fatal_error = Some(err!(HTTP2ProtocolError));
                    return;
                }
                if flags & wire::HeadersFrameFlags::PADDED as u8 != 0 {
                    fragment = match strip_padding(fragment) {
                        Some(f) => f,
                        None => {
                            session.fatal_error = Some(err!(HTTP2ProtocolError));
                            return;
                        }
                    };
                }
                if flags & wire::HeadersFrameFlags::PRIORITY as u8 != 0 {
                    if fragment.len() < wire::StreamPriority::BYTE_SIZE {
                        session.fatal_error = Some(err!(HTTP2ProtocolError));
                        return;
                    }
                    fragment = &fragment[wire::StreamPriority::BYTE_SIZE..];
                }
                if fragment.len() > LOCAL_MAX_HEADER_LIST_SIZE as usize {
                    session.fatal_error = Some(err!(HTTP2HeaderListTooLarge));
                    return;
                }
                session.orphan_header_block.clear();
                session.orphan_header_block.extend_from_slice(fragment);
                if flags & wire::HeadersFrameFlags::END_HEADERS as u8 != 0 {
                    decode_discard_orphan(session);
                } else {
                    session.expecting_continuation = stream_id;
                }
                return;
            }
            // SAFETY: stream pointer from map is valid for session lifetime.
            let stream = stream_mut(maybe_stream.unwrap());
            session.stream_progressed = true;
            if flags & wire::HeadersFrameFlags::PADDED as u8 != 0 {
                fragment = match strip_padding(fragment) {
                    Some(f) => f,
                    None => {
                        session.fatal_error = Some(err!(HTTP2ProtocolError));
                        return;
                    }
                };
            }
            if flags & wire::HeadersFrameFlags::PRIORITY as u8 != 0 {
                if fragment.len() < wire::StreamPriority::BYTE_SIZE {
                    session.fatal_error = Some(err!(HTTP2ProtocolError));
                    return;
                }
                fragment = &fragment[wire::StreamPriority::BYTE_SIZE..];
            }
            if fragment.len() > LOCAL_MAX_HEADER_LIST_SIZE as usize {
                session.fatal_error = Some(err!(HTTP2HeaderListTooLarge));
                return;
            }
            stream.header_block.clear();
            stream.header_block.extend_from_slice(fragment);
            stream.headers_end_stream = flags & wire::HeadersFrameFlags::END_STREAM as u8 != 0;
            if flags & wire::HeadersFrameFlags::END_HEADERS as u8 != 0 {
                if stream.headers_end_stream {
                    stream.recv_end_stream();
                }
                decode_header_block(session, stream);
            } else {
                session.expecting_continuation = stream.id;
            }
        }
        FT_CONTINUATION => {
            if session.expecting_continuation == 0 || stream_id != session.expecting_continuation {
                session.fatal_error = Some(err!(HTTP2ProtocolError));
                return;
            }
            if let Some(&stream_ptr) = session.streams.get(&session.expecting_continuation) {
                // SAFETY: stream pointer valid for session lifetime.
                let stream = stream_mut(stream_ptr);
                if stream.header_block.len() + payload.len() > LOCAL_MAX_HEADER_LIST_SIZE as usize {
                    session.fatal_error = Some(err!(HTTP2HeaderListTooLarge));
                    return;
                }
                stream.header_block.extend_from_slice(payload);
                if flags & wire::HeadersFrameFlags::END_HEADERS as u8 != 0 {
                    session.expecting_continuation = 0;
                    if stream.headers_end_stream {
                        stream.recv_end_stream();
                    }
                    decode_header_block(session, stream);
                }
            } else {
                if session.orphan_header_block.len() + payload.len()
                    > LOCAL_MAX_HEADER_LIST_SIZE as usize
                {
                    session.fatal_error = Some(err!(HTTP2HeaderListTooLarge));
                    return;
                }
                session.orphan_header_block.extend_from_slice(payload);
                if flags & wire::HeadersFrameFlags::END_HEADERS as u8 != 0 {
                    session.expecting_continuation = 0;
                    decode_discard_orphan(session);
                }
            }
        }
        FT_DATA => {
            session.conn_unacked_bytes = session.conn_unacked_bytes.saturating_add(length);
            let stream_ptr = match session.streams.get(&stream_id).copied() {
                Some(p) => p,
                None => {
                    // §6.1/§5.1: DATA on stream 0, an idle stream, or a
                    // server-initiated stream is a connection PROTOCOL_ERROR.
                    // DATA on a stream we already closed/reset is ignored.
                    if stream_id == 0 || stream_id & 1 == 0 || stream_id >= session.next_stream_id {
                        session.fatal_error = Some(err!(HTTP2ProtocolError));
                    }
                    return;
                }
            };
            // SAFETY: stream pointer valid for session lifetime.
            let stream = stream_mut(stream_ptr);
            session.stream_progressed = true;
            // §8.1.1: DATA before the *final* response HEADERS is malformed —
            // a 1xx alone (status_code still 0) doesn't satisfy this.
            if stream.status_code == 0 {
                session.rst_stream(stream, wire::ErrorCode::PROTOCOL_ERROR);
                stream.fatal_error = Some(err!(HTTP2ProtocolError));
                return;
            }
            if stream.remote_closed() {
                stream
                    .fatal_error
                    .get_or_insert_with(|| err!(HTTP2ProtocolError));
                return;
            }
            stream.unacked_bytes = stream.unacked_bytes.saturating_add(length);
            let mut fragment = payload;
            if flags & wire::DataFrameFlags::PADDED as u8 != 0 {
                fragment = match strip_padding(fragment) {
                    Some(f) => f,
                    None => {
                        session.fatal_error = Some(err!(HTTP2ProtocolError));
                        return;
                    }
                };
            }
            if flags & wire::DataFrameFlags::END_STREAM as u8 != 0 {
                stream.recv_end_stream();
            }
            stream.data_bytes_received += fragment.len() as u64;
            if !fragment.is_empty() {
                stream.body_buffer.extend_from_slice(fragment);
            }
        }
        FT_RST_STREAM => {
            if length != 4 {
                session.fatal_error = Some(err!(HTTP2FrameSizeError));
                return;
            }
            // RFC 9113 §6.4: stream 0, or an idle stream (one we never
            // opened — even ids included since push is disabled), is a
            // connection PROTOCOL_ERROR.
            if stream_id == 0 || stream_id & 1 == 0 || stream_id >= session.next_stream_id {
                session.fatal_error = Some(err!(HTTP2ProtocolError));
                return;
            }
            let stream_ptr = match session.streams.get(&stream_id).copied() {
                Some(p) => p,
                None => return,
            };
            // SAFETY: stream pointer valid for session lifetime.
            let stream = stream_mut(stream_ptr);
            let had_response = stream.remote_closed();
            stream.rst_done = true;
            stream.state = StreamState::Closed;
            let code: u32 = wire::u32_from_bytes(&payload[0..4]);
            stream.fatal_error = match code {
                x if x == wire::ErrorCode::NO_ERROR.0 => {
                    if had_response {
                        None
                    } else {
                        Some(err!(HTTP2StreamReset))
                    }
                }
                x if x == wire::ErrorCode::REFUSED_STREAM.0 => Some(err!(HTTP2RefusedStream)),
                _ => Some(err!(HTTP2StreamReset)),
            };
        }
        FT_GOAWAY => {
            if stream_id != 0 {
                session.fatal_error = Some(err!(HTTP2ProtocolError));
                return;
            }
            if length < 8 {
                session.fatal_error = Some(err!(HTTP2FrameSizeError));
                return;
            }
            session.goaway_received = true;
            session.goaway_last_stream_id =
                wire::UInt31WithReserved::from_bytes(&payload[0..4]).uint31();
            let code: u32 = wire::u32_from_bytes(&payload[4..8]);
            let graceful = code == wire::ErrorCode::NO_ERROR.0;
            let last_id = session.goaway_last_stream_id;
            for &s_ptr in session.streams.values() {
                // SAFETY: stream pointer valid for session lifetime.
                let s = stream_mut(s_ptr);
                if s.id > last_id {
                    s.fatal_error = Some(if graceful {
                        err!(HTTP2RefusedStream)
                    } else {
                        err!(HTTP2GoAway)
                    });
                } else if !graceful && !s.remote_closed() {
                    // RFC 9113 §6.8: streams ≤ last_stream_id "might
                    // still complete successfully" — don't discard a
                    // response that already finished in this same read.
                    s.fatal_error = Some(err!(HTTP2GoAway));
                }
            }
        }
        FT_PUSH_PROMISE => {
            session.fatal_error = Some(err!(HTTP2ProtocolError));
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
        // Disjoint field borrows: `hpack` (mut) vs `orphan_header_block` (shared).
        let result = match session.hpack.decode(&session.orphan_header_block[offset..]) {
            Ok(r) => r,
            Err(_) => {
                session.fatal_error = Some(err!(HTTP2CompressionError));
                session.orphan_header_block.clear();
                return;
            }
        };
        offset += result.next;
    }
    session.orphan_header_block.clear();
}

pub fn decode_header_block(session: &mut ClientSession, stream: &mut Stream) {
    // PORT NOTE: reshaped for borrowck (was `defer stream.header_block.clearRetainingCapacity()`)
    // — `.clear()` is inlined before each return below.
    let mut status: u32 = 0;
    let mut bounds: Vec<[u32; 3]> = Vec::new();
    let start_len = stream.decoded_bytes.len();
    let mut seen_regular = false;
    let mut seen_status = false;
    let mut malformed = false;

    let mut offset: usize = 0;
    while offset < stream.header_block.len() {
        let result = match session.hpack.decode(&stream.header_block[offset..]) {
            Ok(r) => r,
            Err(_) => {
                session.fatal_error = Some(err!(HTTP2CompressionError));
                stream.header_block.clear();
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
            // RFC 9110 §15: status-code is a 3-digit integer. Header values
            // are octets, not guaranteed UTF-8.
            status = if result.value.len() == 3 {
                bun_core::parse_unsigned::<u32>(result.value, 10).unwrap_or(0)
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
        if is_malformed_response_field(result.name) || is_malformed_response_value(result.value) {
            malformed = true;
            continue;
        }
        // Cap decoded size independently of the wire size: HPACK indexed
        // refs can amplify a small block into huge name/value pairs.
        if stream.decoded_bytes.len() + result.name.len() + result.value.len()
            > LOCAL_MAX_HEADER_LIST_SIZE as usize
        {
            session.fatal_error = Some(err!(HTTP2HeaderListTooLarge));
            stream.header_block.clear();
            return;
        }
        let name_start: u32 = u32::try_from(stream.decoded_bytes.len()).expect("int cast");
        stream.decoded_bytes.extend_from_slice(result.name);
        let value_start: u32 = u32::try_from(stream.decoded_bytes.len()).expect("int cast");
        stream.decoded_bytes.extend_from_slice(result.value);
        bounds.push([
            name_start,
            value_start,
            u32::try_from(stream.decoded_bytes.len()).expect("int cast"),
        ]);
    }

    stream.header_block.clear();

    if malformed {
        stream.decoded_bytes.truncate(start_len);
        session.rst_stream(stream, wire::ErrorCode::PROTOCOL_ERROR);
        stream.fatal_error = Some(err!(HTTP2ProtocolError));
        return;
    }

    if stream.status_code != 0 {
        if !stream.headers_end_stream {
            stream.fatal_error = Some(err!(HTTP2ProtocolError));
        }
        return;
    }

    if status == 0 {
        stream.decoded_bytes.truncate(start_len);
        stream.fatal_error = Some(err!(HTTP2ProtocolError));
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
            stream.fatal_error = Some(err!(HTTP2ProtocolError));
        }
        return;
    }

    stream.status_code = status;
    stream.headers_ready = true;
    if stream.awaiting_continue {
        stream.awaiting_continue = false;
        session.write_frame(
            wire::FrameType::HTTP_FRAME_DATA,
            wire::DataFrameFlags::END_STREAM as u8,
            stream.id,
            &[],
        );
        stream.sent_end_stream();
    }
    let bytes = stream.decoded_bytes.as_ptr();
    stream.decoded_headers.reserve_exact(
        bounds
            .len()
            .saturating_sub(stream.decoded_headers.capacity()),
    );
    for b in &bounds {
        // PORT NOTE: self-referential — decoded_headers stores raw-ptr slices
        // borrowing stream.decoded_bytes. picohttp::Header stores raw ptrs so
        // this is sound as long as decoded_bytes is not reallocated before
        // delivery (it isn't — only ever appended to once per END_HEADERS).
        // SAFETY: bounds are within decoded_bytes; bytes ptr valid until next reallocation.
        let name =
            unsafe { bun_core::ffi::slice(bytes.add(b[0] as usize), (b[1] - b[0]) as usize) };
        // SAFETY: b[1] <= b[2] <= decoded_bytes.len(); bytes is decoded_bytes.as_ptr() with no realloc since.
        let value =
            unsafe { bun_core::ffi::slice(bytes.add(b[1] as usize), (b[2] - b[1]) as usize) };
        // PERF(port): was appendAssumeCapacity.
        stream
            .decoded_headers
            .push(picohttp::Header::new(name, value));
    }
}

pub(crate) fn strip_padding(payload: &[u8]) -> Option<&[u8]> {
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
pub(crate) fn is_malformed_response_field(name: &[u8]) -> bool {
    if name.is_empty() {
        return true;
    }
    for &c in name {
        match c {
            b'a'..=b'z'
            | b'0'..=b'9'
            | b'!'
            | b'#'
            | b'$'
            | b'%'
            | b'&'
            | b'\''
            | b'*'
            | b'+'
            | b'-'
            | b'.'
            | b'^'
            | b'_'
            | b'`'
            | b'|'
            | b'~' => {}
            _ => return true,
        }
    }
    // PORT NOTE: Zig used a comptime string set; small enough to open-code.
    matches!(
        name,
        b"connection"
            | b"keep-alive"
            | b"proxy-connection"
            | b"te"
            | b"transfer-encoding"
            | b"upgrade"
    )
}

pub fn is_malformed_response_value(value: &[u8]) -> bool {
    value.iter().any(|&c| c == 0 || c == b'\r' || c == b'\n')
}

pub fn error_code_for(err: bun_core::Error) -> wire::ErrorCode {
    match err {
        e if e == err!(HTTP2ProtocolError) => wire::ErrorCode::PROTOCOL_ERROR,
        e if e == err!(HTTP2FrameSizeError) => wire::ErrorCode::FRAME_SIZE_ERROR,
        e if e == err!(HTTP2FlowControlError) => wire::ErrorCode::FLOW_CONTROL_ERROR,
        e if e == err!(HTTP2CompressionError) => wire::ErrorCode::COMPRESSION_ERROR,
        e if e == err!(HTTP2HeaderListTooLarge) || e == err!(HTTP2EnhanceYourCalm) => {
            wire::ErrorCode::ENHANCE_YOUR_CALM
        }
        _ => wire::ErrorCode::INTERNAL_ERROR,
    }
}

// ported from: src/http/h2_client/dispatch.zig
