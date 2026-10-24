//! HTTP/2 frames (RFC 9113 §4 and §6): the header, the registries, and the checks a frame's own bytes decide.

use core::ops::Range;

use super::settings::Entries;

pub const CONNECTION_PREFACE: &[u8] = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";
pub const FRAME_HEADER_SIZE: usize = 9;
pub const MAX_STREAM_ID: u32 = 0x7fff_ffff;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum FrameType {
    Data = 0x0,
    Headers = 0x1,
    Priority = 0x2,
    RstStream = 0x3,
    Settings = 0x4,
    PushPromise = 0x5,
    Ping = 0x6,
    GoAway = 0x7,
    WindowUpdate = 0x8,
    Continuation = 0x9,
    /// RFC 7838 §4
    AltSvc = 0xa,
    /// RFC 8336 §2
    Origin = 0xc,
}

impl FrameType {
    /// `None` for a type outside the registry, which §4.1 says to ignore.
    pub fn from_u8(value: u8) -> Option<FrameType> {
        Some(match value {
            0x0 => FrameType::Data,
            0x1 => FrameType::Headers,
            0x2 => FrameType::Priority,
            0x3 => FrameType::RstStream,
            0x4 => FrameType::Settings,
            0x5 => FrameType::PushPromise,
            0x6 => FrameType::Ping,
            0x7 => FrameType::GoAway,
            0x8 => FrameType::WindowUpdate,
            0x9 => FrameType::Continuation,
            0xa => FrameType::AltSvc,
            0xc => FrameType::Origin,
            _ => return None,
        })
    }
}

/// Frame types reuse the same bits, so the names are per meaning.
pub mod flags {
    pub const ACK: u8 = 0x01;
    pub const END_STREAM: u8 = 0x01;
    pub const END_HEADERS: u8 = 0x04;
    pub const PADDED: u8 = 0x08;
    pub(super) const PRIORITY: u8 = 0x20;
}

/// RFC 9113 §7. A newtype, so a code outside the registry survives the trip from the wire.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ErrorCode(pub u32);

impl ErrorCode {
    pub const NO_ERROR: Self = Self(0x0);
    pub const PROTOCOL_ERROR: Self = Self(0x1);
    pub const INTERNAL_ERROR: Self = Self(0x2);
    pub const FLOW_CONTROL_ERROR: Self = Self(0x3);
    pub const STREAM_CLOSED: Self = Self(0x5);
    pub const FRAME_SIZE_ERROR: Self = Self(0x6);
    pub const REFUSED_STREAM: Self = Self(0x7);
    pub const CANCEL: Self = Self(0x8);
    pub const COMPRESSION_ERROR: Self = Self(0x9);
    pub const ENHANCE_YOUR_CALM: Self = Self(0xb);
    pub const HTTP_1_1_REQUIRED: Self = Self(0xd);
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FrameHeader {
    /// 24 bits on the wire.
    pub length: u32,
    pub frame_type: u8,
    pub flags: u8,
    /// Without the reserved bit.
    pub stream_id: u32,
}

impl FrameHeader {
    pub fn new(frame_type: FrameType, flags: u8, stream_id: u32, length: usize) -> Self {
        debug_assert!(length <= 0xff_ffff);
        FrameHeader {
            length: length.min(0xff_ffff) as u32,
            frame_type: frame_type as u8,
            flags,
            stream_id,
        }
    }

    pub fn parse(raw: &[u8; FRAME_HEADER_SIZE]) -> Self {
        FrameHeader {
            length: u32::from_be_bytes([0, raw[0], raw[1], raw[2]]),
            frame_type: raw[3],
            flags: raw[4],
            stream_id: read_u31([raw[5], raw[6], raw[7], raw[8]]),
        }
    }

    pub fn to_bytes(self) -> [u8; FRAME_HEADER_SIZE] {
        let [_, l0, l1, l2] = self.length.to_be_bytes();
        let [s0, s1, s2, s3] = (self.stream_id & MAX_STREAM_ID).to_be_bytes();
        [l0, l1, l2, self.frame_type, self.flags, s0, s1, s2, s3]
    }

    #[inline]
    pub fn has(&self, flag: u8) -> bool {
        self.flags & flag != 0
    }
}

#[inline]
fn read_u32(payload: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([
        payload[at],
        payload[at + 1],
        payload[at + 2],
        payload[at + 3],
    ])
}

#[inline]
fn read_u31(raw: [u8; 4]) -> u32 {
    u32::from_be_bytes(raw) & MAX_STREAM_ID
}

/// A frame its receiver has to answer with GOAWAY or RST_STREAM.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FrameError {
    pub code: ErrorCode,
    /// The stream to reset, or 0 for a connection error.
    pub stream_id: u32,
    pub reason: &'static str,
}

impl FrameError {
    pub const fn connection(code: ErrorCode, reason: &'static str) -> Self {
        FrameError {
            code,
            stream_id: 0,
            reason,
        }
    }
}

pub enum NextFrame<'a> {
    /// The frame header is incomplete.
    NeedHeader,
    /// `payload` is the part of the payload that has arrived.
    Partial {
        header: FrameHeader,
        payload: &'a [u8],
    },
    Complete {
        header: FrameHeader,
        payload: &'a [u8],
    },
}

/// Splits the first frame off `input`. A length over `max_frame_size` is refused before its payload arrives (§4.2).
pub fn next_frame(input: &[u8], max_frame_size: u32) -> Result<NextFrame<'_>, FrameError> {
    let Some((raw, rest)) = input.split_first_chunk::<FRAME_HEADER_SIZE>() else {
        return Ok(NextFrame::NeedHeader);
    };
    let header = FrameHeader::parse(raw);
    if header.length > max_frame_size {
        return Err(FrameError::connection(
            ErrorCode::FRAME_SIZE_ERROR,
            "frame exceeds SETTINGS_MAX_FRAME_SIZE",
        ));
    }
    Ok(match rest.get(..header.length as usize) {
        Some(payload) => NextFrame::Complete { header, payload },
        None => NextFrame::Partial {
            header,
            payload: rest,
        },
    })
}

/// What a connection keeps of its read buffer after the first `parsed` bytes. A mostly spent buffer is dropped for a copy of the rest. A mostly unparsed one is kept, so a frame that comes in many reads isn't copied at each.
pub fn unparsed_rest(mut buffer: Vec<u8>, parsed: usize) -> Vec<u8> {
    if (buffer.len() - parsed) * 2 < buffer.capacity() {
        return buffer[parsed..].to_vec();
    }
    buffer.drain(..parsed);
    buffer
}

/// The payload range between the Pad Length octet and the padding (§6.1). `pad_length` is the payload's first octet.
pub fn unpadded_range(
    header: &FrameHeader,
    pad_length: Option<u8>,
) -> Result<Range<usize>, FrameError> {
    let length = header.length as usize;
    if !header.has(flags::PADDED) {
        return Ok(0..length);
    }
    match pad_length {
        Some(pad) if (pad as usize) < length => Ok(1..length - pad as usize),
        _ => Err(FrameError::connection(
            ErrorCode::PROTOCOL_ERROR,
            "padding exceeds the frame payload",
        )),
    }
}

fn unpadded<'a>(header: &FrameHeader, payload: &'a [u8]) -> Result<&'a [u8], FrameError> {
    Ok(&payload[unpadded_range(header, payload.first().copied())?])
}

/// One complete inbound frame that passed every check its own bytes decide.
pub enum Frame<'a> {
    Data {
        data: &'a [u8],
        end_stream: bool,
    },
    Headers {
        fragment: &'a [u8],
        end_stream: bool,
        end_headers: bool,
    },
    Priority,
    RstStream {
        code: ErrorCode,
    },
    Settings(Entries<'a>),
    SettingsAck,
    PushPromise {
        promised_id: u32,
        fragment: &'a [u8],
        end_headers: bool,
    },
    Ping {
        ack: bool,
        payload: [u8; 8],
    },
    GoAway {
        last_stream_id: u32,
        code: ErrorCode,
        debug: &'a [u8],
    },
    /// `increment` is never 0.
    WindowUpdate {
        increment: u32,
    },
    Continuation {
        fragment: &'a [u8],
        end_headers: bool,
    },
    /// An extension frame. Its payload is unchecked.
    AltSvc,
    /// An extension frame. Its payload is unchecked.
    Origin,
    Unknown,
}

impl<'a> Frame<'a> {
    /// `payload` is all `header.length` octets. `max_settings` caps the entries of one SETTINGS frame.
    pub fn parse(
        header: &FrameHeader,
        payload: &'a [u8],
        max_settings: usize,
    ) -> Result<Frame<'a>, FrameError> {
        use FrameType as T;
        debug_assert_eq!(payload.len(), header.length as usize);
        let Some(frame_type) = FrameType::from_u8(header.frame_type) else {
            return Ok(Frame::Unknown);
        };
        let on_connection = header.stream_id == 0;
        let misplaced = match frame_type {
            T::Settings | T::Ping | T::GoAway => !on_connection,
            T::Data
            | T::Headers
            | T::Priority
            | T::RstStream
            | T::PushPromise
            | T::Continuation => on_connection,
            T::WindowUpdate | T::AltSvc | T::Origin => false,
        };
        if misplaced {
            return Err(FrameError::connection(
                ErrorCode::PROTOCOL_ERROR,
                "frame on the wrong kind of stream",
            ));
        }
        let wrong_length = match frame_type {
            T::Priority => payload.len() != 5,
            T::RstStream | T::WindowUpdate => payload.len() != 4,
            T::Ping => payload.len() != 8,
            T::GoAway => payload.len() < 8,
            T::Settings if header.has(flags::ACK) => !payload.is_empty(),
            _ => false,
        };
        if wrong_length {
            return Err(FrameError::connection(
                ErrorCode::FRAME_SIZE_ERROR,
                "frame has the wrong length for its type",
            ));
        }
        let end_stream = header.has(flags::END_STREAM);
        let end_headers = header.has(flags::END_HEADERS);
        Ok(match frame_type {
            T::Data => Frame::Data {
                data: unpadded(header, payload)?,
                end_stream,
            },
            T::Headers => {
                let mut fragment = unpadded(header, payload)?;
                if header.has(flags::PRIORITY) {
                    let Some(after_priority) = fragment.get(5..) else {
                        return Err(FrameError::connection(
                            ErrorCode::FRAME_SIZE_ERROR,
                            "HEADERS priority fields are truncated",
                        ));
                    };
                    fragment = after_priority;
                }
                Frame::Headers {
                    fragment,
                    end_stream,
                    end_headers,
                }
            }
            T::Priority => Frame::Priority,
            T::RstStream => Frame::RstStream {
                code: ErrorCode(read_u32(payload, 0)),
            },
            T::Settings if header.has(flags::ACK) => Frame::SettingsAck,
            T::Settings => Frame::Settings(Entries::parse(payload, max_settings)?),
            T::PushPromise => {
                let Some((id, fragment)) = unpadded(header, payload)?.split_first_chunk::<4>()
                else {
                    return Err(FrameError::connection(
                        ErrorCode::FRAME_SIZE_ERROR,
                        "PUSH_PROMISE has no promised stream id",
                    ));
                };
                Frame::PushPromise {
                    promised_id: read_u31(*id),
                    fragment,
                    end_headers,
                }
            }
            T::Ping => {
                let mut opaque = [0u8; 8];
                opaque.copy_from_slice(payload);
                Frame::Ping {
                    ack: header.has(flags::ACK),
                    payload: opaque,
                }
            }
            T::GoAway => Frame::GoAway {
                last_stream_id: read_u32(payload, 0) & MAX_STREAM_ID,
                code: ErrorCode(read_u32(payload, 4)),
                debug: &payload[8..],
            },
            T::WindowUpdate => match read_u32(payload, 0) & MAX_STREAM_ID {
                0 => {
                    return Err(FrameError {
                        code: ErrorCode::PROTOCOL_ERROR,
                        stream_id: header.stream_id,
                        reason: "WINDOW_UPDATE with 0 increment",
                    });
                }
                increment => Frame::WindowUpdate { increment },
            },
            T::Continuation => Frame::Continuation {
                fragment: payload,
                end_headers,
            },
            T::AltSvc => Frame::AltSvc,
            T::Origin => Frame::Origin,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(
        frame_type: FrameType,
        flags: u8,
        stream_id: u32,
        payload: &[u8],
    ) -> Result<Frame<'_>, FrameError> {
        let header = FrameHeader::new(frame_type, flags, stream_id, payload.len());
        Frame::parse(&header, payload, 32)
    }

    fn code_of(result: Result<Frame<'_>, FrameError>) -> Option<(ErrorCode, u32)> {
        result.err().map(|e| (e.code, e.stream_id))
    }

    #[test]
    fn a_spent_read_buffer_is_dropped() {
        let rest = unparsed_rest(vec![7; 1000], 995);
        assert_eq!(rest, [7; 5]);
        assert!(rest.capacity() < 1000);
        assert_eq!(unparsed_rest(vec![7; 1000], 1000).capacity(), 0);
    }

    #[test]
    fn a_frame_in_many_reads_is_copied_a_few_times() {
        let mut buffer = Vec::new();
        let mut reallocations = 0;
        for _ in 0..1000 {
            let capacity = buffer.capacity();
            buffer.extend_from_slice(&[7; 100]);
            buffer = unparsed_rest(buffer, 0);
            reallocations += usize::from(buffer.capacity() != capacity);
        }
        assert_eq!(buffer.len(), 100_000);
        assert!(reallocations < 20, "{reallocations}");
    }

    #[test]
    fn header_round_trip_drops_the_reserved_bit() {
        let header = FrameHeader {
            length: 0x01_02_03,
            frame_type: 0x4,
            flags: 0x1,
            stream_id: 0x7abc_def0,
        };
        let mut raw = header.to_bytes();
        assert_eq!(FrameHeader::parse(&raw), header);
        raw[5] |= 0x80;
        assert_eq!(FrameHeader::parse(&raw), header);
    }

    #[test]
    fn next_frame_splits_and_refuses_oversized_frames() {
        let mut input = FrameHeader::new(FrameType::Data, 0, 1, 3)
            .to_bytes()
            .to_vec();
        assert!(matches!(
            next_frame(&input[..8], 16_384),
            Ok(NextFrame::NeedHeader)
        ));
        input.extend_from_slice(b"ab");
        assert!(matches!(
            next_frame(&input, 16_384),
            Ok(NextFrame::Partial { payload: b"ab", .. })
        ));
        input.extend_from_slice(b"cd");
        assert!(matches!(
            next_frame(&input, 16_384),
            Ok(NextFrame::Complete {
                payload: b"abc",
                ..
            })
        ));
        assert_eq!(
            next_frame(&input, 2).err().map(|e| e.code),
            Some(ErrorCode::FRAME_SIZE_ERROR)
        );
    }

    #[test]
    fn stream_id_rules() {
        let connection = |code| Some((code, 0));
        assert_eq!(
            code_of(parse(FrameType::Settings, 0, 1, &[])),
            connection(ErrorCode::PROTOCOL_ERROR)
        );
        assert_eq!(
            code_of(parse(FrameType::Data, 0, 0, b"abc")),
            connection(ErrorCode::PROTOCOL_ERROR)
        );
        assert!(parse(FrameType::WindowUpdate, 0, 0, &[0, 0, 0, 1]).is_ok());
        assert!(parse(FrameType::WindowUpdate, 0, 3, &[0, 0, 0, 1]).is_ok());
    }

    #[test]
    fn fixed_lengths() {
        let size_error = Some((ErrorCode::FRAME_SIZE_ERROR, 0));
        assert_eq!(code_of(parse(FrameType::Ping, 0, 0, &[0; 6])), size_error);
        assert_eq!(
            code_of(parse(FrameType::Priority, 0, 1, &[0; 4])),
            size_error
        );
        assert_eq!(
            code_of(parse(FrameType::RstStream, 0, 1, &[0; 5])),
            size_error
        );
        assert_eq!(code_of(parse(FrameType::GoAway, 0, 0, &[0; 7])), size_error);
        assert_eq!(
            code_of(parse(FrameType::Settings, 0, 0, &[0; 5])),
            size_error
        );
        assert_eq!(
            code_of(parse(FrameType::Settings, flags::ACK, 0, &[0; 6])),
            size_error
        );
    }

    #[test]
    fn padding() {
        let protocol_error = Some((ErrorCode::PROTOCOL_ERROR, 0));
        assert!(matches!(
            parse(FrameType::Data, flags::PADDED, 1, &[2, b'h', b'i', 0, 0]),
            Ok(Frame::Data { data: b"hi", .. })
        ));
        assert!(matches!(
            parse(FrameType::Data, flags::PADDED, 1, &[1, 0]),
            Ok(Frame::Data { data: b"", .. })
        ));
        assert_eq!(
            code_of(parse(FrameType::Data, flags::PADDED, 1, &[2, 0])),
            protocol_error
        );
        assert_eq!(
            code_of(parse(FrameType::Headers, flags::PADDED, 1, &[])),
            protocol_error
        );
    }

    #[test]
    fn headers_priority_fields_are_skipped() {
        assert!(matches!(
            parse(
                FrameType::Headers,
                flags::PRIORITY,
                1,
                &[0, 0, 0, 0, 16, 0x82]
            ),
            Ok(Frame::Headers {
                fragment: &[0x82],
                ..
            })
        ));
        assert_eq!(
            code_of(parse(FrameType::Headers, flags::PRIORITY, 1, &[0; 3])),
            Some((ErrorCode::FRAME_SIZE_ERROR, 0))
        );
    }

    #[test]
    fn window_update_of_zero_is_scoped_to_its_stream() {
        assert_eq!(
            code_of(parse(FrameType::WindowUpdate, 0, 0, &[0; 4])),
            Some((ErrorCode::PROTOCOL_ERROR, 0))
        );
        assert_eq!(
            code_of(parse(FrameType::WindowUpdate, 0, 5, &[0x80, 0, 0, 0])),
            Some((ErrorCode::PROTOCOL_ERROR, 5))
        );
    }

    #[test]
    fn push_promise_needs_a_promised_id() {
        assert!(matches!(
            parse(FrameType::PushPromise, 0, 1, &[0x80, 0, 0, 2, 0x82]),
            Ok(Frame::PushPromise {
                promised_id: 2,
                fragment: &[0x82],
                ..
            })
        ));
        assert_eq!(
            code_of(parse(FrameType::PushPromise, 0, 1, &[0; 3])),
            Some((ErrorCode::FRAME_SIZE_ERROR, 0))
        );
    }

    #[test]
    fn unknown_types_are_not_errors() {
        let header = FrameHeader {
            length: 0,
            frame_type: 0xfe,
            flags: 0xff,
            stream_id: 0,
        };
        assert!(matches!(Frame::parse(&header, &[], 32), Ok(Frame::Unknown)));
    }
}
