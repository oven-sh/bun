//! HTTP/3 (RFC 9114).

mod control;
mod fields;
mod frame;
mod message;
mod priority;

pub(crate) use control::{ControlFrame, ControlReader, write_settings};
pub(crate) use fields::Pool;
pub use fields::{Fields, Header, Section};
pub(crate) use message::{Fault, Message, Reader};
pub use priority::Priority;

use crate::coding::{PartialVarint, Write, varint_len};
use crate::config::Http3Config;
use crate::error::{Error, Result, http3_code};
use crate::stream_id::{Side, StreamId};

/// RFC 9114 §6.2.
#[derive(Clone, Copy)]
pub(crate) enum StreamType {
    Unknown(PartialVarint),
    Control,
    Encoder,
    Decoder,
    Ignored,
}

impl Default for StreamType {
    fn default() -> Self {
        Self::Unknown(PartialVarint::default())
    }
}

mod stream_type {
    pub(super) const CONTROL: u64 = 0x00;
    pub(super) const PUSH: u64 = 0x01;
    pub(super) const ENCODER: u64 = 0x02;
    pub(super) const DECODER: u64 = 0x03;
}

pub(crate) struct Http3 {
    pub(crate) decoder: bun_qpack::Decoder,
    pub(crate) encoder: bun_qpack::Encoder,
    pub(crate) uses_dynamic_table: bool,
    pub(crate) control_reader: ControlReader,
    pub(crate) control_stream: StreamId,
    pub(crate) decoder_stream: StreamId,
    pub(crate) encoder_stream: StreamId,
    /// A bit for each type of which the peer has opened a stream.
    peer_streams: u8,
    /// How many bytes of field sections are being held.
    collected: usize,
    max_collected: usize,
    pub(crate) peer_accepts_datagrams: Option<bool>,
    pub(crate) peer_go_away: Option<StreamId>,
    /// For requests that are yet to come.
    pub(crate) early_priorities: Vec<(StreamId, Priority)>,
}

impl From<bun_qpack::Error> for Error {
    fn from(error: bun_qpack::Error) -> Self {
        Self::http3(error as u64, "QPACK error")
    }
}

impl Http3 {
    pub(crate) fn new(config: &Http3Config, [control, decoder, encoder]: [StreamId; 3]) -> Self {
        Self {
            decoder: bun_qpack::Decoder::new(
                control::MAX_TABLE_CAPACITY,
                control::MAX_BLOCKED_STREAMS,
            ),
            encoder: bun_qpack::Encoder::new(),
            uses_dynamic_table: false,
            control_reader: ControlReader::default(),
            control_stream: control,
            decoder_stream: decoder,
            encoder_stream: encoder,
            peer_streams: 0,
            collected: 0,
            max_collected: (config.tolerated_fields.size.saturating_mul(4)).max(1024 * 1024),
            peer_accepts_datagrams: None,
            peer_go_away: None,
            early_priorities: Vec::new(),
        }
    }

    pub(crate) fn classify(&mut self, kind: u64, side: Side) -> Result<StreamType> {
        let known = match kind {
            stream_type::CONTROL => StreamType::Control,
            stream_type::ENCODER => StreamType::Encoder,
            stream_type::DECODER => StreamType::Decoder,
            stream_type::PUSH if side.is_client() => return Err(control::PUSH_IS_NOT_ENABLED),
            stream_type::PUSH => {
                let reason = "client opened a push stream";
                return Err(Error::http3(http3_code::STREAM_CREATION_ERROR, reason));
            }
            _ => return Ok(StreamType::Ignored),
        };
        if self.peer_streams >> kind & 1 != 0 {
            let reason = "second control or QPACK stream";
            return Err(Error::http3(http3_code::STREAM_CREATION_ERROR, reason));
        }
        self.peer_streams |= 1 << kind;
        Ok(known)
    }

    /// Returns the frame, which is somewhere in `out`. `credit` is for the encoder stream.
    pub(crate) fn encode_headers<'a, 'b>(
        &mut self,
        id: StreamId,
        headers: impl Iterator<Item = Header<'b>>,
        credit: usize,
        out: &'a mut Vec<u8>,
    ) -> &'a [u8] {
        const MAX_FRAME_HEADER_LEN: usize = 9;
        out.clear();
        out.extend_from_slice(&[0; MAX_FRAME_HEADER_LEN]);
        let mut section = self.encoder.section(id.0, out, credit);
        for header in headers {
            match header.static_index {
                Some(index) => section.field_with_static_name(index, header.value, header.indexing),
                None => section.field(header.name, header.value, header.indexing),
            }
        }
        let start = section.finish();
        let (frame_header, len) = frame_header(frame::kind::HEADERS, (out.len() - start) as u64);
        let start = start - len;
        let room = out.iter_mut().skip(start);
        (room.zip(frame_header).take(len)).for_each(|(to, from)| *to = from);
        out.get(start..).unwrap_or_default()
    }
}

/// For a type of one byte.
#[inline]
fn frame_header(kind: u64, len: u64) -> ([u8; 9], usize) {
    let len_len = varint_len(len);
    let tagged = len | u64::from(len_len.trailing_zeros()) << (8 * len_len - 2);
    let [a, b, c, d, e, f, g, h] = (tagged << (64 - 8 * len_len)).to_be_bytes();
    ([kind as u8, a, b, c, d, e, f, g, h], 1 + len_len)
}

#[inline]
pub(crate) fn data_frame_header(len: u64) -> ([u8; 9], usize) {
    frame_header(frame::kind::DATA, len)
}

/// What the control, decoder and encoder streams start with.
pub(crate) fn preambles(config: &Http3Config, side: Side) -> [(StreamType, Vec<u8>); 3] {
    let mut control = vec![stream_type::CONTROL as u8];
    control::write_settings(config, &mut control);
    if side.is_server() && !config.origins.is_empty() {
        control::write_frame(frame::kind::ORIGIN, &config.origins, &mut control);
    }
    [
        (StreamType::Control, control),
        (StreamType::Decoder, vec![stream_type::DECODER as u8]),
        (StreamType::Encoder, vec![stream_type::ENCODER as u8]),
    ]
}

pub(crate) fn go_away_frame(id: StreamId) -> Vec<u8> {
    let (mut payload, mut out) = (Vec::new(), Vec::new());
    payload.varint(id.0);
    control::write_frame(frame::kind::GOAWAY, &payload, &mut out);
    out
}

pub(crate) fn priority_update_frame(id: StreamId, priority: Priority) -> Vec<u8> {
    let (mut payload, mut out) = (Vec::new(), Vec::new());
    payload.varint(id.0);
    let (value, len) = priority.encode();
    payload.extend(value.iter().take(len));
    control::write_frame(frame::kind::PRIORITY_UPDATE_REQUEST, &payload, &mut out);
    out
}
