//! RFC 9000 §19, RFC 9221 §4 and draft-iyengar-quic-delayed-ack-02.

use core::ops::Range;

use crate::cid::{ConnectionId, ResetToken};
use crate::coding::{MAX_VARINT, Read};
use crate::error::{Error, Layer, Result, transport_code};
use crate::stream_id::{Direction, StreamId};

pub(crate) mod kind {
    pub(crate) const PADDING: u64 = 0x00;
    pub(crate) const PING: u64 = 0x01;
    pub(crate) const ACK: u64 = 0x02;
    pub(crate) const ACK_ECN: u64 = 0x03;
    pub(crate) const RESET_STREAM: u64 = 0x04;
    pub(crate) const STOP_SENDING: u64 = 0x05;
    pub(crate) const CRYPTO: u64 = 0x06;
    pub(crate) const NEW_TOKEN: u64 = 0x07;
    pub(crate) const STREAM: u64 = 0x08;
    pub(crate) const STREAM_LAST: u64 = 0x0f;
    pub(crate) const MAX_DATA: u64 = 0x10;
    pub(crate) const MAX_STREAM_DATA: u64 = 0x11;
    pub(crate) const MAX_STREAMS_BIDI: u64 = 0x12;
    pub(crate) const MAX_STREAMS_UNI: u64 = 0x13;
    pub(crate) const DATA_BLOCKED: u64 = 0x14;
    pub(crate) const STREAM_DATA_BLOCKED: u64 = 0x15;
    pub(crate) const STREAMS_BLOCKED_BIDI: u64 = 0x16;
    pub(crate) const STREAMS_BLOCKED_UNI: u64 = 0x17;
    pub(crate) const NEW_CONNECTION_ID: u64 = 0x18;
    pub(crate) const RETIRE_CONNECTION_ID: u64 = 0x19;
    pub(crate) const PATH_CHALLENGE: u64 = 0x1a;
    pub(crate) const PATH_RESPONSE: u64 = 0x1b;
    pub(crate) const TRANSPORT_CLOSE: u64 = 0x1c;
    pub(crate) const APPLICATION_CLOSE: u64 = 0x1d;
    pub(crate) const HANDSHAKE_DONE: u64 = 0x1e;
    pub(crate) const DATAGRAM: u64 = 0x30;
    pub(crate) const DATAGRAM_WITH_LENGTH: u64 = 0x31;
    pub(crate) const ACK_FREQUENCY: u64 = 0xaf;
}

pub(crate) mod stream_flag {
    pub(crate) const FIN: u8 = 0b001;
    pub(crate) const LENGTH: u8 = 0b010;
    pub(crate) const OFFSET: u8 = 0b100;
}

/// RFC 9000 §4.6.
pub(crate) const MAX_STREAM_COUNT: u64 = 1 << 60;

#[derive(Debug)]
pub(crate) enum Frame<'a> {
    Padding,
    Ping,
    Ack(Ack<'a>),
    ResetStream {
        id: StreamId,
        code: u64,
        final_size: u64,
    },
    StopSending {
        id: StreamId,
        code: u64,
    },
    Crypto {
        offset: u64,
        data: &'a [u8],
    },
    NewToken(&'a [u8]),
    Stream {
        id: StreamId,
        offset: u64,
        data: &'a [u8],
        fin: bool,
    },
    MaxData(u64),
    MaxStreamData {
        id: StreamId,
        limit: u64,
    },
    MaxStreams(Direction, u64),
    DataBlocked(u64),
    StreamDataBlocked {
        id: StreamId,
        limit: u64,
    },
    StreamsBlocked,
    NewConnectionId {
        sequence: u64,
        retire_prior_to: u64,
        id: ConnectionId,
        reset_token: ResetToken,
    },
    RetireConnectionId(u64),
    PathChallenge([u8; 8]),
    PathResponse([u8; 8]),
    Close {
        layer: Layer,
        code: u64,
        reason: &'a [u8],
    },
    HandshakeDone,
    Datagram {
        data: &'a [u8],
        frame_len: usize,
    },
    AckFrequency {
        sequence: u64,
        packet_tolerance: u64,
        max_ack_delay_micros: u64,
        ignore_order: bool,
    },
}

#[derive(Debug, Clone)]
pub(crate) struct Ack<'a> {
    pub(crate) largest: u64,
    /// To be scaled by the `ack_delay_exponent` of the peer.
    pub(crate) delay: u64,
    first_range: u64,
    more_ranges: &'a [u8],
}

impl<'a> Ack<'a> {
    fn read(input: &mut &'a [u8]) -> Option<Self> {
        let (largest, delay) = (input.varint()?, input.varint()?);
        let (count, first_range) = (input.varint()?, input.varint()?);
        let start = *input;
        let mut smallest = largest.checked_sub(first_range)?;
        for _ in 0..count {
            smallest = next_range(smallest, input)?.start;
        }
        Some(Self {
            largest,
            delay,
            first_range,
            more_ranges: start.get(..start.len() - input.len()).unwrap_or_default(),
        })
    }

    #[inline]
    pub(crate) fn first_range(&self) -> Range<u64> {
        self.largest - self.first_range..self.largest + 1
    }

    /// In descending order.
    pub(crate) fn ranges(&self) -> impl Iterator<Item = Range<u64>> + use<'a> {
        let mut more = self.more_ranges;
        core::iter::successors(Some(self.first_range()), move |last| {
            next_range(last.start, &mut more)
        })
    }
}

fn next_range(above: u64, input: &mut &[u8]) -> Option<Range<u64>> {
    let (gap, len) = (input.varint()?, input.varint()?);
    let largest = above.checked_sub(gap + 2)?;
    Some(largest.checked_sub(len)?..largest + 1)
}

impl<'a> Frame<'a> {
    #[inline]
    pub(crate) fn read(input: &mut &'a [u8]) -> Result<Self> {
        Self::try_read(input).ok_or(Error::transport(
            transport_code::FRAME_ENCODING_ERROR,
            "malformed frame",
        ))
    }

    #[inline]
    fn try_read(input: &mut &'a [u8]) -> Option<Self> {
        let len_before = input.len();
        let kind = input.varint()?;
        let stream_count = |input: &mut &[u8]| input.varint().filter(|&n| n <= MAX_STREAM_COUNT);
        let ends_in_range = |offset: u64, data: &[u8]| offset + data.len() as u64 <= MAX_VARINT;
        Some(match kind {
            kind::STREAM..=kind::STREAM_LAST => {
                let flags = kind as u8;
                let id = StreamId(input.varint()?);
                let offset = match flags & stream_flag::OFFSET {
                    0 => 0,
                    _ => input.varint()?,
                };
                let data = match flags & stream_flag::LENGTH {
                    0 => core::mem::take(input),
                    _ => input.prefixed_bytes()?,
                };
                ends_in_range(offset, data).then_some(Self::Stream {
                    id,
                    offset,
                    data,
                    fin: flags & stream_flag::FIN != 0,
                })?
            }
            kind::PADDING => {
                skip_padding(input);
                Self::Padding
            }
            kind::PING => Self::Ping,
            kind::ACK => Self::Ack(Ack::read(input)?),
            kind::ACK_ECN => {
                let ack = Ack::read(input)?;
                for _ in 0..3 {
                    input.varint()?;
                }
                Self::Ack(ack)
            }
            kind::RESET_STREAM => Self::ResetStream {
                id: StreamId(input.varint()?),
                code: input.varint()?,
                final_size: input.varint()?,
            },
            kind::STOP_SENDING => Self::StopSending {
                id: StreamId(input.varint()?),
                code: input.varint()?,
            },
            kind::CRYPTO => {
                let (offset, data) = (input.varint()?, input.prefixed_bytes()?);
                ends_in_range(offset, data).then_some(Self::Crypto { offset, data })?
            }
            kind::NEW_TOKEN => Self::NewToken(input.prefixed_bytes().filter(|t| !t.is_empty())?),
            kind::MAX_DATA => Self::MaxData(input.varint()?),
            kind::MAX_STREAM_DATA => Self::MaxStreamData {
                id: StreamId(input.varint()?),
                limit: input.varint()?,
            },
            kind::MAX_STREAMS_BIDI | kind::MAX_STREAMS_UNI => {
                Self::MaxStreams(Direction::from_bit(kind & 1), stream_count(input)?)
            }
            kind::DATA_BLOCKED => Self::DataBlocked(input.varint()?),
            kind::STREAM_DATA_BLOCKED => Self::StreamDataBlocked {
                id: StreamId(input.varint()?),
                limit: input.varint()?,
            },
            kind::STREAMS_BLOCKED_BIDI | kind::STREAMS_BLOCKED_UNI => {
                stream_count(input).map(|_| Self::StreamsBlocked)?
            }
            kind::NEW_CONNECTION_ID => {
                let (sequence, retire_prior_to) = (input.varint()?, input.varint()?);
                let id = ConnectionId::read(input).filter(|id| !id.is_empty())?;
                (retire_prior_to <= sequence).then_some(Self::NewConnectionId {
                    sequence,
                    retire_prior_to,
                    id,
                    reset_token: ResetToken(input.array()?),
                })?
            }
            kind::RETIRE_CONNECTION_ID => Self::RetireConnectionId(input.varint()?),
            kind::PATH_CHALLENGE => Self::PathChallenge(input.array()?),
            kind::PATH_RESPONSE => Self::PathResponse(input.array()?),
            kind::TRANSPORT_CLOSE => {
                let (code, _frame_kind) = (input.varint()?, input.varint()?);
                Self::Close {
                    layer: Layer::Transport,
                    code,
                    reason: input.prefixed_bytes()?,
                }
            }
            kind::APPLICATION_CLOSE => Self::Close {
                layer: Layer::Application,
                code: input.varint()?,
                reason: input.prefixed_bytes()?,
            },
            kind::HANDSHAKE_DONE => Self::HandshakeDone,
            kind::DATAGRAM | kind::DATAGRAM_WITH_LENGTH => Self::Datagram {
                data: match kind {
                    kind::DATAGRAM => core::mem::take(input),
                    _ => input.prefixed_bytes()?,
                },
                frame_len: len_before - input.len(),
            },
            kind::ACK_FREQUENCY => Self::AckFrequency {
                sequence: input.varint()?,
                packet_tolerance: input.varint()?,
                max_ack_delay_micros: input.varint()?,
                ignore_order: input.u8().filter(|&flag| flag <= 1)? == 1,
            },
            _ => return None,
        })
    }

    /// RFC 9002 §2.
    #[inline]
    pub(crate) fn is_ack_eliciting(&self) -> bool {
        !matches!(self, Self::Padding | Self::Ack(_) | Self::Close { .. })
    }

    /// RFC 9000 §9.1.
    #[inline]
    pub(crate) fn is_probing(&self) -> bool {
        matches!(
            self,
            Self::Padding
                | Self::PathChallenge(_)
                | Self::PathResponse(_)
                | Self::NewConnectionId { .. }
        )
    }

    /// RFC 9000 §12.4.
    pub(crate) fn is_allowed_in_handshake(&self) -> bool {
        matches!(
            self,
            Self::Padding
                | Self::Ping
                | Self::Ack(_)
                | Self::Crypto { .. }
                | Self::Close {
                    layer: Layer::Transport,
                    ..
                }
        )
    }

    /// RFC 9000 §12.5.
    pub(crate) fn is_allowed_in_early_data(&self) -> bool {
        !matches!(
            self,
            Self::Ack(_)
                | Self::Crypto { .. }
                | Self::HandshakeDone
                | Self::NewToken(_)
                | Self::PathResponse(_)
                | Self::RetireConnectionId(_)
        )
    }
}

fn skip_padding(input: &mut &[u8]) {
    while let Some((&word, rest)) = input.split_first_chunk()
        && u64::from_ne_bytes(word) == 0
    {
        *input = rest;
    }
    while let [0, rest @ ..] = *input {
        *input = rest;
    }
}
