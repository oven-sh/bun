//! Inbound frame parsing and dispatch for the fetch() HTTP/2 client.
//! Free functions over `&ClientSession` so the session struct stays focused on
//! lifecycle and delivery; everything that interprets bytes off the wire lives
//! here.

use super::client_session::ClientSession;
use super::stream::{State as StreamState, Stream};
use super::{LOCAL_MAX_CONTINUATIONS, LOCAL_MAX_HEADER_LIST_SIZE, WRITE_BUFFER_CONTROL_LIMIT};
use crate::h2_frame_parser as wire;
use bun_picohttp as picohttp;

bun_core::declare_scope!(h2_client, hidden);

/// Dispatch every complete frame in `buf` and return the number of bytes
/// consumed. The caller spills the unconsumed tail (a partial frame) into
/// `read_buffer`. Operating on a borrowed slice lets `onData` parse
/// straight from the socket chunk in the common case where no partial
/// frame is carried over, saving one memcpy of every body byte.
pub(crate) fn parse_frames(session: &ClientSession, buf: &[u8]) -> usize {
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
            session
                .fatal_error
                .set(Some(crate::Error::HTTP2FrameSizeError));
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
        if session.fatal_error.get().is_some() {
            break;
        }
    }
    consumed
}

// Frame types are non-exhaustive on the wire (any u8 is valid). A
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

fn dispatch_frame(
    session: &ClientSession,
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
    let fatal = |err: crate::Error| session.fatal_error.set(Some(err));

    if session.expecting_continuation.get() != 0 && frame_type != FT_CONTINUATION {
        fatal(crate::Error::HTTP2ProtocolError);
        return;
    }
    // RFC 9113 §3.4: the server connection preface is a SETTINGS frame and
    // MUST be the first frame. Without this, GOAWAY-before-SETTINGS leaves
    // coalesced waiters in `pending_attach` forever (drainPending is gated
    // on settings_received and maybeRelease won't run while it's non-empty).
    if !session.settings_received.get() && frame_type != FT_SETTINGS {
        fatal(crate::Error::HTTP2ProtocolError);
        return;
    }

    match frame_type {
        FT_SETTINGS => {
            // RFC 9113 §6.5: stream id != 0 is PROTOCOL_ERROR; ACK with a
            // payload, or a non-ACK whose length isn't a multiple of 6, is
            // FRAME_SIZE_ERROR.
            if stream_id != 0 {
                fatal(crate::Error::HTTP2ProtocolError);
                return;
            }
            if flags & wire::SettingsFlags::ACK as u8 != 0 {
                if length != 0 {
                    fatal(crate::Error::HTTP2FrameSizeError);
                }
                return;
            }
            if !(length as usize).is_multiple_of(wire::SettingsPayloadUnit::BYTE_SIZE) {
                fatal(crate::Error::HTTP2FrameSizeError);
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
                // Brace-expr copies of packed fields (unaligned-safe).
                let utype = { unit.type_ };
                let uvalue = { unit.value };
                match utype {
                    ST_MAX_FRAME_SIZE => {
                        // RFC 9113 §6.5.2: values outside [16384, 2^24-1]
                        // are a connection PROTOCOL_ERROR. Without the
                        // lower bound, a 0 here makes writeHeaderBlock /
                        // writeDataWindowed spin forever emitting empty
                        // frames.
                        if uvalue < wire::DEFAULT_MAX_FRAME_SIZE || uvalue > wire::MAX_FRAME_SIZE {
                            fatal(crate::Error::HTTP2ProtocolError);
                            return;
                        }
                        session.remote_max_frame_size.set(uvalue); // @truncate(u24)
                    }
                    ST_MAX_CONCURRENT_STREAMS => {
                        session.remote_max_concurrent_streams.set(uvalue);
                    }
                    ST_HEADER_TABLE_SIZE => {
                        // RFC 9113 §4.3.1 / RFC 7541 §4.2: encoder MUST
                        // acknowledge a reduced limit with a Dynamic Table
                        // Size Update at the start of the next header
                        // block. Track the minimum seen so a reduce-then-
                        // raise between two blocks still signals the dip.
                        session.pending_hpack_enc_capacity.set(Some(
                            session
                                .pending_hpack_enc_capacity
                                .get()
                                .unwrap_or(uvalue)
                                .min(uvalue),
                        ));
                    }
                    ST_INITIAL_WINDOW_SIZE => {
                        // RFC 9113 §6.5.2 / §6.9.2: values above 2^31-1, or
                        // a delta that pushes any open stream's window past
                        // that, are a connection FLOW_CONTROL_ERROR.
                        if uvalue > wire::MAX_WINDOW_SIZE {
                            fatal(crate::Error::HTTP2FlowControlError);
                            return;
                        }
                        let delta =
                            i64::from(uvalue) - i64::from(session.remote_initial_window_size.get());
                        session.remote_initial_window_size.set(uvalue);
                        for s in session.streams.borrow().values() {
                            let next = i64::from(s.send_window.get()) + delta;
                            if next > i64::from(wire::MAX_WINDOW_SIZE) {
                                fatal(crate::Error::HTTP2FlowControlError);
                                return;
                            }
                            s.send_window.set(i32::try_from(next).expect("int cast"));
                        }
                    }
                    _ => {}
                }
                i += wire::SettingsPayloadUnit::BYTE_SIZE;
            }
            if session.write_buffer_size() >= WRITE_BUFFER_CONTROL_LIMIT {
                fatal(crate::Error::HTTP2EnhanceYourCalm);
                return;
            }
            session.write_frame(
                wire::FrameType::HTTP_FRAME_SETTINGS,
                wire::SettingsFlags::ACK as u8,
                0,
                &[],
            );
            session.settings_received.set(true);
        }
        FT_WINDOW_UPDATE => {
            if length != 4 {
                fatal(crate::Error::HTTP2FrameSizeError);
                return;
            }
            let inc = i32::try_from(wire::UInt31WithReserved::from_bytes(&payload[0..4]).uint31())
                .expect("int cast");
            if stream_id == 0 {
                // RFC 9113 §6.9: zero increment on stream 0 is a
                // connection PROTOCOL_ERROR; §6.9.1: overflow past
                // 2^31-1 is a connection FLOW_CONTROL_ERROR.
                if inc == 0 {
                    fatal(crate::Error::HTTP2ProtocolError);
                    return;
                }
                let next = i64::from(session.conn_send_window.get()) + i64::from(inc);
                if next > i64::from(wire::MAX_WINDOW_SIZE) {
                    fatal(crate::Error::HTTP2FlowControlError);
                    return;
                }
                session
                    .conn_send_window
                    .set(i32::try_from(next).expect("int cast"));
                session.stream_progressed.set(true);
            } else if let Some(stream) = session.stream(stream_id & 0x7fff_ffff) {
                // §6.9/§6.9.1: zero increment / overflow on a stream are
                // stream-level errors; RST_STREAM and fail just that one.
                if inc == 0 {
                    session.rst_stream(&stream, wire::ErrorCode::PROTOCOL_ERROR);
                    stream.set_fatal_error(crate::Error::HTTP2ProtocolError);
                    return;
                }
                let next = i64::from(stream.send_window.get()) + i64::from(inc);
                if next > i64::from(wire::MAX_WINDOW_SIZE) {
                    session.rst_stream(&stream, wire::ErrorCode::FLOW_CONTROL_ERROR);
                    stream.set_fatal_error(crate::Error::HTTP2FlowControlError);
                    return;
                }
                stream
                    .send_window
                    .set(i32::try_from(next).expect("int cast"));
                session.stream_progressed.set(true);
            } else {
                // §5.1: WINDOW_UPDATE on an idle/server-initiated stream
                // is a connection PROTOCOL_ERROR. Silent ignore is correct
                // for closed streams (odd ids we already used).
                if stream_id & 1 == 0 || stream_id >= session.next_stream_id.get() {
                    fatal(crate::Error::HTTP2ProtocolError);
                    return;
                }
            }
        }
        FT_PING => {
            // RFC 9113 §6.7: length != 8 is a connection FRAME_SIZE_ERROR;
            // a non-zero stream identifier is a connection PROTOCOL_ERROR.
            if length != 8 {
                fatal(crate::Error::HTTP2FrameSizeError);
                return;
            }
            if stream_id != 0 {
                fatal(crate::Error::HTTP2ProtocolError);
                return;
            }
            if flags & wire::PingFrameFlags::ACK as u8 == 0 {
                if session.write_buffer_size() >= WRITE_BUFFER_CONTROL_LIMIT {
                    fatal(crate::Error::HTTP2EnhanceYourCalm);
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
                fatal(crate::Error::HTTP2ProtocolError);
                return;
            }
            if length as usize != wire::StreamPriority::BYTE_SIZE {
                fatal(crate::Error::HTTP2FrameSizeError);
                return;
            }
        }
        FT_HEADERS => {
            session.continuation_count.set(0);
            let mut fragment = payload;
            let Some(stream) = session.stream(stream_id) else {
                // RFC 9113 §5.1/§5.1.1: HEADERS on a stream we never
                // opened (idle: id >= next_stream_id, or even: server-
                // initiated while push is disabled) is a connection
                // PROTOCOL_ERROR. Only odd ids we already used can be a
                // legitimate "RST crossed an in-flight HEADERS" orphan.
                if stream_id == 0 || stream_id & 1 == 0 || stream_id >= session.next_stream_id.get()
                {
                    fatal(crate::Error::HTTP2ProtocolError);
                    return;
                }
                // Stream we no longer track (RST_STREAM crossed an
                // in-flight HEADERS). The block must still be HPACK-
                // decoded so the connection-level dynamic table stays in
                // sync with the server's encoder, and CONTINUATION must
                // be tracked so a follow-up frame doesn't fatal the whole
                // connection.
                if flags & wire::HeadersFrameFlags::PADDED as u8 != 0 {
                    fragment = match strip_padding(fragment) {
                        Some(f) => f,
                        None => {
                            fatal(crate::Error::HTTP2ProtocolError);
                            return;
                        }
                    };
                }
                if flags & wire::HeadersFrameFlags::PRIORITY as u8 != 0 {
                    if fragment.len() < wire::StreamPriority::BYTE_SIZE {
                        fatal(crate::Error::HTTP2ProtocolError);
                        return;
                    }
                    fragment = &fragment[wire::StreamPriority::BYTE_SIZE..];
                }
                if fragment.len() > LOCAL_MAX_HEADER_LIST_SIZE as usize {
                    fatal(crate::Error::HTTP2HeaderListTooLarge);
                    return;
                }
                {
                    let mut orphan = session.orphan_header_block.borrow_mut();
                    orphan.clear();
                    orphan.extend_from_slice(fragment);
                }
                if flags & wire::HeadersFrameFlags::END_HEADERS as u8 != 0 {
                    decode_discard_orphan(session);
                } else {
                    session.expecting_continuation.set(stream_id);
                }
                return;
            };
            session.stream_progressed.set(true);
            if flags & wire::HeadersFrameFlags::PADDED as u8 != 0 {
                fragment = match strip_padding(fragment) {
                    Some(f) => f,
                    None => {
                        fatal(crate::Error::HTTP2ProtocolError);
                        return;
                    }
                };
            }
            if flags & wire::HeadersFrameFlags::PRIORITY as u8 != 0 {
                if fragment.len() < wire::StreamPriority::BYTE_SIZE {
                    fatal(crate::Error::HTTP2ProtocolError);
                    return;
                }
                fragment = &fragment[wire::StreamPriority::BYTE_SIZE..];
            }
            if fragment.len() > LOCAL_MAX_HEADER_LIST_SIZE as usize {
                fatal(crate::Error::HTTP2HeaderListTooLarge);
                return;
            }
            {
                let mut header_block = stream.header_block.borrow_mut();
                header_block.clear();
                header_block.extend_from_slice(fragment);
            }
            stream
                .headers_end_stream
                .set(flags & wire::HeadersFrameFlags::END_STREAM as u8 != 0);
            if flags & wire::HeadersFrameFlags::END_HEADERS as u8 != 0 {
                if stream.headers_end_stream.get() {
                    stream.recv_end_stream();
                }
                decode_header_block(session, &stream);
            } else {
                session.expecting_continuation.set(stream.id);
            }
        }
        FT_CONTINUATION => {
            let expecting = session.expecting_continuation.get();
            if expecting == 0 || stream_id != expecting {
                fatal(crate::Error::HTTP2ProtocolError);
                return;
            }
            session
                .continuation_count
                .set(session.continuation_count.get() + 1);
            if session.continuation_count.get() > LOCAL_MAX_CONTINUATIONS {
                fatal(crate::Error::HTTP2EnhanceYourCalm);
                return;
            }
            if let Some(stream) = session.stream(expecting) {
                if stream.header_block.borrow().len() + payload.len()
                    > LOCAL_MAX_HEADER_LIST_SIZE as usize
                {
                    fatal(crate::Error::HTTP2HeaderListTooLarge);
                    return;
                }
                stream.header_block.borrow_mut().extend_from_slice(payload);
                if flags & wire::HeadersFrameFlags::END_HEADERS as u8 != 0 {
                    session.expecting_continuation.set(0);
                    if stream.headers_end_stream.get() {
                        stream.recv_end_stream();
                    }
                    decode_header_block(session, &stream);
                }
            } else {
                if session.orphan_header_block.borrow().len() + payload.len()
                    > LOCAL_MAX_HEADER_LIST_SIZE as usize
                {
                    fatal(crate::Error::HTTP2HeaderListTooLarge);
                    return;
                }
                session
                    .orphan_header_block
                    .borrow_mut()
                    .extend_from_slice(payload);
                if flags & wire::HeadersFrameFlags::END_HEADERS as u8 != 0 {
                    session.expecting_continuation.set(0);
                    decode_discard_orphan(session);
                }
            }
        }
        FT_DATA => {
            session
                .conn_unacked_bytes
                .set(session.conn_unacked_bytes.get().saturating_add(length));
            let Some(stream) = session.stream(stream_id) else {
                // §6.1/§5.1: DATA on stream 0, an idle stream, or a
                // server-initiated stream is a connection PROTOCOL_ERROR.
                // DATA on a stream we already closed/reset is ignored.
                if stream_id == 0 || stream_id & 1 == 0 || stream_id >= session.next_stream_id.get()
                {
                    fatal(crate::Error::HTTP2ProtocolError);
                }
                return;
            };
            session.stream_progressed.set(true);
            // §8.1.1: DATA before the *final* response HEADERS is malformed —
            // a 1xx alone (status_code still 0) doesn't satisfy this.
            if stream.status_code.get() == 0 {
                session.rst_stream(&stream, wire::ErrorCode::PROTOCOL_ERROR);
                stream.set_fatal_error(crate::Error::HTTP2ProtocolError);
                return;
            }
            // §5.1: DATA on a half-closed(remote) or reset stream is
            // STREAM_CLOSED. Without this, frames in the same TCP read as
            // END_STREAM would be appended to body_buffer before the
            // deliver loop swaps the stream out.
            if stream.remote_closed() {
                if stream.fatal_error.get().is_none() {
                    stream.set_fatal_error(crate::Error::HTTP2ProtocolError);
                }
                return;
            }
            stream
                .unacked_bytes
                .set(stream.unacked_bytes.get().saturating_add(length));
            let mut fragment = payload;
            if flags & wire::DataFrameFlags::PADDED as u8 != 0 {
                fragment = match strip_padding(fragment) {
                    Some(f) => f,
                    None => {
                        fatal(crate::Error::HTTP2ProtocolError);
                        return;
                    }
                };
            }
            if flags & wire::DataFrameFlags::END_STREAM as u8 != 0 {
                stream.recv_end_stream();
            }
            stream
                .data_bytes_received
                .set(stream.data_bytes_received.get() + fragment.len() as u64);
            if !fragment.is_empty() {
                stream.body_buffer.borrow_mut().extend_from_slice(fragment);
            }
        }
        FT_RST_STREAM => {
            if length != 4 {
                fatal(crate::Error::HTTP2FrameSizeError);
                return;
            }
            // RFC 9113 §6.4: stream 0, or an idle stream (one we never
            // opened — even ids included since push is disabled), is a
            // connection PROTOCOL_ERROR.
            if stream_id == 0 || stream_id & 1 == 0 || stream_id >= session.next_stream_id.get() {
                fatal(crate::Error::HTTP2ProtocolError);
                return;
            }
            let Some(stream) = session.stream(stream_id) else {
                return;
            };
            if stream.rst_done.get() {
                // First RST_STREAM wins; a later STREAM_CLOSED for in-flight DATA is ignored.
                return;
            }
            let had_response = stream.remote_closed();
            stream.rst_done.set(true);
            stream.state.set(StreamState::Closed);
            let code: u32 = wire::u32_from_bytes(&payload[0..4]);
            // RFC 9113 §8.1: RST_STREAM(NO_ERROR) is the server's "stop
            // uploading, I've already sent the full response" signal —
            // valid only if END_STREAM had already arrived. Otherwise the
            // body is truncated and must surface as an error.
            stream.fatal_error.set(match code {
                x if x == wire::ErrorCode::NO_ERROR.0 => {
                    if had_response {
                        None
                    } else {
                        Some(crate::Error::HTTP2StreamReset)
                    }
                }
                x if x == wire::ErrorCode::REFUSED_STREAM.0 => {
                    Some(crate::Error::HTTP2RefusedStream)
                }
                _ => Some(crate::Error::HTTP2StreamReset),
            });
        }
        FT_GOAWAY => {
            if stream_id != 0 {
                fatal(crate::Error::HTTP2ProtocolError);
                return;
            }
            if length < 8 {
                fatal(crate::Error::HTTP2FrameSizeError);
                return;
            }
            session.goaway_received.set(true);
            session
                .goaway_last_stream_id
                .set(wire::UInt31WithReserved::from_bytes(&payload[0..4]).uint31());
            let code: u32 = wire::u32_from_bytes(&payload[4..8]);
            let graceful = code == wire::ErrorCode::NO_ERROR.0;
            let last_id = session.goaway_last_stream_id.get();
            for s in session.streams.borrow().values() {
                if s.id > last_id {
                    s.set_fatal_error(if graceful {
                        crate::Error::HTTP2RefusedStream
                    } else {
                        crate::Error::HTTP2GoAway
                    });
                } else if !graceful && !s.remote_closed() {
                    // RFC 9113 §6.8: streams ≤ last_stream_id "might
                    // still complete successfully" — don't discard a
                    // response that already finished in this same read.
                    s.set_fatal_error(crate::Error::HTTP2GoAway);
                }
            }
        }
        FT_PUSH_PROMISE => {
            fatal(crate::Error::HTTP2ProtocolError);
        }
        _ => {}
    }
}

/// Feed an orphaned (untracked-stream) header block through the HPACK
/// decoder purely to keep the dynamic table in sync, then discard.
pub(crate) fn decode_discard_orphan(session: &ClientSession) {
    let mut orphan = session.orphan_header_block.borrow_mut();
    let mut hpack = session.hpack.borrow_mut();
    let mut offset: usize = 0;
    while offset < orphan.len() {
        let result = match hpack.decode(&orphan[offset..]) {
            Ok(r) => r,
            Err(_) => {
                session
                    .fatal_error
                    .set(Some(crate::Error::HTTP2CompressionError));
                orphan.clear();
                return;
            }
        };
        offset += result.next;
    }
    orphan.clear();
}

/// HPACK-decode the buffered header block at parse time. Runs for every
/// END_HEADERS so the dynamic table stays in sync regardless of how many
/// HEADERS frames arrive in one read. 1xx and trailers are decoded then
/// dropped; the final response is stored on the stream for delivery.
pub(crate) fn decode_header_block(session: &ClientSession, stream: &Stream) {
    // `stream.header_block.clear()` is inlined before each return below.
    let mut status: u32 = 0;
    let mut bounds: Vec<[u32; 3]> = Vec::new();
    let mut decoded_bytes = stream.decoded_bytes.borrow_mut();
    let mut header_block = stream.header_block.borrow_mut();
    let mut hpack = session.hpack.borrow_mut();
    let start_len = decoded_bytes.len();
    let mut seen_regular = false;
    let mut seen_status = false;
    // Stream-level malformations seen mid-decode. The loop MUST consume the
    // whole block regardless — the dynamic table is connection-scoped, so
    // bailing early would desync it for every sibling stream. The error is
    // applied once decoding completes.
    let mut malformed = false;

    let mut offset: usize = 0;
    while offset < header_block.len() {
        let result = match hpack.decode(&header_block[offset..]) {
            Ok(r) => r,
            Err(_) => {
                // The decoder has already committed earlier fields from this
                // block to the connection-level dynamic table; the table is
                // now out of sync with the server's encoder. RFC 9113 §4.3:
                // a decoding error MUST be treated as a connection error of
                // type COMPRESSION_ERROR.
                session
                    .fatal_error
                    .set(Some(crate::Error::HTTP2CompressionError));
                header_block.clear();
                return;
            }
        };
        offset += result.next;
        if !result.name.is_empty() && result.name[0] == b':' {
            // §8.3.2: only `:status` is defined for responses, MUST appear
            // before any regular field, and MUST NOT repeat. §8.1: not
            // allowed in trailers.
            if stream.status_code.get() != 0
                || seen_regular
                || seen_status
                || result.name != b":status"
            {
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
        if stream.status_code.get() != 0 || malformed {
            continue;
        }
        if is_malformed_response_field(result.name) || is_malformed_response_value(result.value) {
            malformed = true;
            continue;
        }
        // Cap decoded size independently of the wire size: HPACK indexed
        // refs can amplify a small block into huge name/value pairs.
        if decoded_bytes.len() + result.name.len() + result.value.len()
            > LOCAL_MAX_HEADER_LIST_SIZE as usize
        {
            session
                .fatal_error
                .set(Some(crate::Error::HTTP2HeaderListTooLarge));
            header_block.clear();
            return;
        }
        let name_start: u32 = u32::try_from(decoded_bytes.len()).expect("int cast");
        decoded_bytes.extend_from_slice(result.name);
        let value_start: u32 = u32::try_from(decoded_bytes.len()).expect("int cast");
        decoded_bytes.extend_from_slice(result.value);
        bounds.push([
            name_start,
            value_start,
            u32::try_from(decoded_bytes.len()).expect("int cast"),
        ]);
    }
    drop(hpack);

    header_block.clear();
    drop(header_block);

    if malformed {
        decoded_bytes.truncate(start_len);
        session.rst_stream(stream, wire::ErrorCode::PROTOCOL_ERROR);
        stream.set_fatal_error(crate::Error::HTTP2ProtocolError);
        return;
    }

    // Trailers: status_code already set by an earlier HEADERS. RFC 9113
    // §8.1 — the trailers HEADERS MUST carry END_STREAM; otherwise the
    // server could interleave DATA → HEADERS → DATA and the second DATA
    // would be appended to the body.
    if stream.status_code.get() != 0 {
        if !stream.headers_end_stream.get() {
            stream.set_fatal_error(crate::Error::HTTP2ProtocolError);
        }
        return;
    }

    if status == 0 {
        decoded_bytes.truncate(start_len);
        stream.set_fatal_error(crate::Error::HTTP2ProtocolError);
        return;
    }
    if status >= 100 && status < 200 {
        decoded_bytes.truncate(start_len);
        // Only `100 Continue` is the go-ahead for a withheld body; 102/103
        // are informational and do not satisfy `Expect: 100-continue`.
        if status == 100 {
            stream.awaiting_continue.set(false);
        }
        // RFC 9113 §8.1: a 1xx HEADERS that ends the stream is malformed.
        if stream.remote_closed() {
            stream.set_fatal_error(crate::Error::HTTP2ProtocolError);
        }
        return;
    }

    stream.status_code.set(status);
    stream.headers_ready.set(true);
    if stream.awaiting_continue.get() {
        // Final status without a preceding 100: server has decided without
        // seeing the body. Half-close our side with an empty DATA so the
        // response can finish normally; Content-Length was already stripped
        // on this path so 0 bytes is not a §8.1.1 mismatch.
        stream.awaiting_continue.set(false);
        session.write_frame(
            wire::FrameType::HTTP_FRAME_DATA,
            wire::DataFrameFlags::END_STREAM as u8,
            stream.id,
            &[],
        );
        stream.sent_end_stream();
    }
    // `decoded_headers` point into `decoded_bytes`, which is complete now and
    // not touched again before delivery.
    drop(decoded_bytes);
    let decoded_bytes = stream.decoded_bytes.borrow();
    let mut decoded_headers = stream.decoded_headers.borrow_mut();
    let additional = bounds.len().saturating_sub(decoded_headers.capacity());
    decoded_headers.reserve_exact(additional);
    for b in &bounds {
        let name = &decoded_bytes[b[0] as usize..b[1] as usize];
        let value = &decoded_bytes[b[1] as usize..b[2] as usize];
        decoded_headers.push(picohttp::Header::new(name, value));
    }
}

fn strip_padding(payload: &[u8]) -> Option<&[u8]> {
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

/// RFC 9113 §8.2.1: a field value MUST NOT contain NUL (0x00), LF (0x0a), or
/// CR (0x0d). HPACK is length-prefixed so these would otherwise pass through
/// verbatim, breaking the no-CR/LF invariant the HTTP/1.1 parser provides and
/// enabling header injection when values are forwarded downstream.
pub(crate) fn is_malformed_response_value(value: &[u8]) -> bool {
    bun_core::strings::contains_any(value, b"\0\r\n")
}

pub(crate) fn error_code_for(err: crate::Error) -> wire::ErrorCode {
    match err {
        crate::Error::HTTP2ProtocolError => wire::ErrorCode::PROTOCOL_ERROR,
        crate::Error::HTTP2FrameSizeError => wire::ErrorCode::FRAME_SIZE_ERROR,
        crate::Error::HTTP2FlowControlError => wire::ErrorCode::FLOW_CONTROL_ERROR,
        crate::Error::HTTP2CompressionError => wire::ErrorCode::COMPRESSION_ERROR,
        crate::Error::HTTP2HeaderListTooLarge | crate::Error::HTTP2EnhanceYourCalm => {
            wire::ErrorCode::ENHANCE_YOUR_CALM
        }
        _ => wire::ErrorCode::INTERNAL_ERROR,
    }
}
