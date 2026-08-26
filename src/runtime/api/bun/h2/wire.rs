//! HTTP/2 wire-format definitions (RFC 9113 + extensions). Pure: no JSC, no allocation.
//!
//! This is part of the from-scratch rewrite of `node:http2` (replacing the ported
//! `h2_frame_parser.rs`). Spec section numbers reference RFC 9113 unless noted.

#![allow(dead_code)]

/// RFC 9113 §3.4: the 24-octet client connection preface.
pub const CONNECTION_PREFACE: &[u8] = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";

/// §4.1: fixed 9-octet frame header.
pub const FRAME_HEADER_SIZE: usize = 9;

/// §4.2 SETTINGS_MAX_FRAME_SIZE bounds and default.
pub const MAX_FRAME_SIZE_DEFAULT: u32 = 16_384; // 2^14
pub const MAX_FRAME_SIZE_LOWER: u32 = 16_384; // 2^14
pub const MAX_FRAME_SIZE_UPPER: u32 = 16_777_215; // 2^24 - 1

/// §6.9.1 flow-control window bounds.
pub const DEFAULT_WINDOW_SIZE: u32 = 65_535; // 2^16 - 1
pub const MAX_WINDOW_SIZE: u32 = 2_147_483_647; // 2^31 - 1

/// Highest valid stream identifier (§5.1.1): 2^31 - 1.
pub const MAX_STREAM_ID: u32 = 2_147_483_647;

/// RFC 9113 §6 frame type registry (+ RFC 7838 ALTSVC, RFC 8336 ORIGIN).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum FrameType {
    Data = 0x00,
    Headers = 0x01,
    Priority = 0x02,
    RstStream = 0x03,
    Settings = 0x04,
    PushPromise = 0x05,
    Ping = 0x06,
    GoAway = 0x07,
    WindowUpdate = 0x08,
    Continuation = 0x09,
    AltSvc = 0x0a, // RFC 7838 §4
    Origin = 0x0c, // RFC 8336 §2
}

impl FrameType {
    pub fn from_u8(v: u8) -> Option<FrameType> {
        Some(match v {
            0x00 => FrameType::Data,
            0x01 => FrameType::Headers,
            0x02 => FrameType::Priority,
            0x03 => FrameType::RstStream,
            0x04 => FrameType::Settings,
            0x05 => FrameType::PushPromise,
            0x06 => FrameType::Ping,
            0x07 => FrameType::GoAway,
            0x08 => FrameType::WindowUpdate,
            0x09 => FrameType::Continuation,
            0x0a => FrameType::AltSvc,
            0x0c => FrameType::Origin,
            _ => return None, // §4.1: unknown types are ignored.
        })
    }
}

/// §6 frame flag bits. Bits are reused across frame types, so they are named generically.
pub mod flags {
    pub const ACK: u8 = 0x01; // SETTINGS, PING
    pub const END_STREAM: u8 = 0x01; // DATA, HEADERS
    pub const END_HEADERS: u8 = 0x04; // HEADERS, PUSH_PROMISE, CONTINUATION
    pub const PADDED: u8 = 0x08; // DATA, HEADERS, PUSH_PROMISE
    pub const PRIORITY: u8 = 0x20; // HEADERS

    #[inline]
    pub fn has(flags: u8, mask: u8) -> bool {
        flags & mask != 0
    }
}

/// RFC 9113 §7 error codes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum ErrorCode {
    NoError = 0x0,
    ProtocolError = 0x1,
    InternalError = 0x2,
    FlowControlError = 0x3,
    SettingsTimeout = 0x4,
    StreamClosed = 0x5,
    FrameSizeError = 0x6,
    RefusedStream = 0x7,
    Cancel = 0x8,
    CompressionError = 0x9,
    ConnectError = 0xa,
    EnhanceYourCalm = 0xb,
    InadequateSecurity = 0xc,
    Http11Required = 0xd,
}

impl ErrorCode {
    #[inline]
    pub fn as_u32(self) -> u32 {
        self as u32
    }
}

/// nghttp2 library error codes (negative). The embedder surfaces locally-detected connection
/// errors to JS with one of these so node's `NghttpError` shape (code `ERR_HTTP2_ERROR`, message
/// `nghttp2_strerror(code)`) can be reproduced exactly.
/// https://github.com/nghttp2/nghttp2/blob/master/lib/includes/nghttp2/nghttp2.h (nghttp2_error)
pub mod lib_error {
    /// NGHTTP2_ERR_PROTO — "Protocol error"
    pub const PROTO: i32 = -505;
    /// NGHTTP2_ERR_STREAM_CLOSED — "Stream was already closed or invalid"
    pub const STREAM_CLOSED: i32 = -510;
    /// NGHTTP2_ERR_BAD_CLIENT_MAGIC — "Received bad client magic byte string"
    pub const BAD_CLIENT_MAGIC: i32 = -903;
    /// NGHTTP2_ERR_FLOODED — "Flooding was detected in this HTTP/2 session, and it must be closed"
    pub const FLOODED: i32 = -904;
}

/// RFC 9113 §6.5.2 SETTINGS parameter registry (+ RFC 8441, RFC 9218).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u16)]
pub enum SettingId {
    HeaderTableSize = 0x1,
    EnablePush = 0x2,
    MaxConcurrentStreams = 0x3,
    InitialWindowSize = 0x4,
    MaxFrameSize = 0x5,
    MaxHeaderListSize = 0x6,
    EnableConnectProtocol = 0x8, // RFC 8441
    NoRfc7540Priorities = 0x9,   // RFC 9218
}

impl SettingId {
    pub fn from_u16(v: u16) -> Option<SettingId> {
        Some(match v {
            0x1 => SettingId::HeaderTableSize,
            0x2 => SettingId::EnablePush,
            0x3 => SettingId::MaxConcurrentStreams,
            0x4 => SettingId::InitialWindowSize,
            0x5 => SettingId::MaxFrameSize,
            0x6 => SettingId::MaxHeaderListSize,
            0x8 => SettingId::EnableConnectProtocol,
            0x9 => SettingId::NoRfc7540Priorities,
            _ => return None, // §6.5.2: unknown settings are ignored.
        })
    }
}

/// RFC 9113 §4.1 frame header (9 octets, big-endian on the wire).
#[derive(Clone, Copy, Debug)]
pub struct FrameHeader {
    /// 24-bit payload length.
    pub length: u32,
    pub frame_type: u8,
    pub flags: u8,
    /// Stream identifier with the reserved high bit already cleared.
    pub stream_id: u32,
}

impl FrameHeader {
    /// Parse a 9-byte header from `buf` (must be >= 9 bytes), big-endian → host, reserved bit cleared.
    pub fn parse(buf: &[u8]) -> FrameHeader {
        debug_assert!(buf.len() >= FRAME_HEADER_SIZE);
        let length = (buf[0] as u32) << 16 | (buf[1] as u32) << 8 | (buf[2] as u32);
        let frame_type = buf[3];
        let flags = buf[4];
        let stream_id = u32::from_be_bytes([buf[5], buf[6], buf[7], buf[8]]) & 0x7fff_ffff;
        FrameHeader {
            length,
            frame_type,
            flags,
            stream_id,
        }
    }

    /// Serialize this header into a 9-byte big-endian buffer.
    pub fn write(&self, out: &mut [u8; FRAME_HEADER_SIZE]) {
        out[0] = (self.length >> 16) as u8;
        out[1] = (self.length >> 8) as u8;
        out[2] = self.length as u8;
        out[3] = self.frame_type;
        out[4] = self.flags;
        out[5..9].copy_from_slice(&(self.stream_id & 0x7fff_ffff).to_be_bytes());
    }

    #[inline]
    pub fn typ(&self) -> Option<FrameType> {
        FrameType::from_u8(self.frame_type)
    }
}

/// Outcome of validating an inbound frame header against §4.2/§6 structural rules
/// (independent of stream state, which the state machine checks separately).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HeaderValidation {
    Ok,
    /// Send GOAWAY with this code and close the connection.
    ConnectionError(ErrorCode),
    /// Send RST_STREAM with this code on the given stream.
    StreamError {
        id: u32,
        code: ErrorCode,
    },
}

/// Whether a frame type's stream identifier must be zero, non-zero, or may be either (§4.1/§6).
fn stream_scope(t: FrameType) -> StreamScope {
    match t {
        FrameType::Settings | FrameType::Ping | FrameType::GoAway => StreamScope::Connection,
        FrameType::Data
        | FrameType::Headers
        | FrameType::Priority
        | FrameType::RstStream
        | FrameType::PushPromise
        | FrameType::Continuation => StreamScope::Stream,
        // WINDOW_UPDATE is valid on stream 0 and on a stream (§6.9); ALTSVC on either (RFC 7838 §4).
        // ORIGIN on a non-zero stream is ignored, not erred (RFC 8336 §2) - handle_origin drops it.
        FrameType::WindowUpdate | FrameType::AltSvc | FrameType::Origin => StreamScope::Either,
    }
}

enum StreamScope {
    Connection,
    Stream,
    Either,
}

/// §4.2 + §6 structural validation of a frame header given the negotiated max frame size:
/// length bounds, the stream-id 0-vs-nonzero rule, and the fixed-length frame rules.
/// Does NOT check stream state.
pub fn validate_header(hdr: &FrameHeader, local_max_frame_size: u32) -> HeaderValidation {
    let Some(t) = hdr.typ() else {
        // Unknown frame type: caller discards it (§4.1); not an error here.
        return HeaderValidation::Ok;
    };

    // §4.2: a frame larger than SETTINGS_MAX_FRAME_SIZE is an error.
    if hdr.length > local_max_frame_size {
        return frame_size_error(hdr, t);
    }

    match stream_scope(t) {
        StreamScope::Connection if hdr.stream_id != 0 => {
            return HeaderValidation::ConnectionError(ErrorCode::ProtocolError);
        }
        StreamScope::Stream if hdr.stream_id == 0 => {
            return HeaderValidation::ConnectionError(ErrorCode::ProtocolError);
        }
        _ => {}
    }

    // §6: fixed-length frames.
    let fixed: Option<u32> = match t {
        FrameType::Priority => Some(5),
        FrameType::RstStream => Some(4),
        FrameType::Ping => Some(8),
        FrameType::WindowUpdate => Some(4),
        _ => None,
    };
    if let Some(len) = fixed {
        if hdr.length != len {
            return frame_size_error(hdr, t);
        }
    }
    // §6.5: SETTINGS length must be a multiple of 6.
    if t == FrameType::Settings && !hdr.length.is_multiple_of(6) {
        return frame_size_error(hdr, t);
    }

    HeaderValidation::Ok
}

fn frame_size_error(hdr: &FrameHeader, t: FrameType) -> HeaderValidation {
    // §4.2 + per-frame rules: a frame-size error is a CONNECTION error except for DATA, which is
    // a stream error on a non-zero stream. §6.3 would allow a stream error for PRIORITY too, but
    // nghttp2 (and therefore node) treats a bad-length PRIORITY as a connection error — verified
    // against node v26.3.0 — so we match that. RST_STREAM (§6.4) and WINDOW_UPDATE (§6.9) bad
    // lengths are connection errors.
    let stream_level = hdr.stream_id != 0 && matches!(t, FrameType::Data);
    if stream_level {
        HeaderValidation::StreamError {
            id: hdr.stream_id,
            code: ErrorCode::FrameSizeError,
        }
    } else {
        HeaderValidation::ConnectionError(ErrorCode::FrameSizeError)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_header_roundtrip() {
        let hdr = FrameHeader {
            length: 0x010203,
            frame_type: 0x04,
            flags: 0x01,
            stream_id: 0x7abcdef0 & 0x7fffffff,
        };
        let mut buf = [0u8; FRAME_HEADER_SIZE];
        hdr.write(&mut buf);
        let back = FrameHeader::parse(&buf);
        assert_eq!(back.length, hdr.length);
        assert_eq!(back.frame_type, hdr.frame_type);
        assert_eq!(back.flags, hdr.flags);
        assert_eq!(back.stream_id, hdr.stream_id);
    }

    #[test]
    fn settings_on_nonzero_stream_is_connection_error() {
        let hdr = FrameHeader {
            length: 0,
            frame_type: FrameType::Settings as u8,
            flags: 0,
            stream_id: 1,
        };
        assert_eq!(
            validate_header(&hdr, MAX_FRAME_SIZE_DEFAULT),
            HeaderValidation::ConnectionError(ErrorCode::ProtocolError)
        );
    }

    #[test]
    fn ping_wrong_length_is_frame_size_error() {
        let hdr = FrameHeader {
            length: 6,
            frame_type: FrameType::Ping as u8,
            flags: 0,
            stream_id: 0,
        };
        assert_eq!(
            validate_header(&hdr, MAX_FRAME_SIZE_DEFAULT),
            HeaderValidation::ConnectionError(ErrorCode::FrameSizeError)
        );
    }

    #[test]
    fn data_on_stream_zero_is_protocol_error() {
        let hdr = FrameHeader {
            length: 3,
            frame_type: FrameType::Data as u8,
            flags: 0,
            stream_id: 0,
        };
        assert_eq!(
            validate_header(&hdr, MAX_FRAME_SIZE_DEFAULT),
            HeaderValidation::ConnectionError(ErrorCode::ProtocolError)
        );
    }
}
