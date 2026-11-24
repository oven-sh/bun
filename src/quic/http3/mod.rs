//! HTTP/3 (RFC 9114).

mod control;
mod fields;
mod frame;
mod message;
mod priority;

pub use bun_qpack::Indexing;
pub(crate) use control::{
    ControlFrame, ControlReader, go_away_frame, priority_update_frame, write_settings,
};
pub(crate) use fields::Pool;
pub use fields::{Fields, Header, Section};
pub(crate) use frame::data_frame_header;
pub(crate) use message::{Fault, Message, Reader};
pub use priority::Priority;

use crate::coding::PartialVarint;
use crate::config::Http3Config;
use crate::error::{Error, Result, http3_code};
use crate::stream_id::{Side, StreamId};

/// How many field sections can be held, of the largest size and of that which is announced, and how many bytes in any
/// case.
const COLLECTED_SECTIONS: usize = 4;
const MIN_COLLECTED_KEPT_SECTIONS: usize = 100;
const MAX_COLLECTED_KEPT_LEN: usize = 16 * 1024 * 1024;
const MIN_MAX_COLLECTED: usize = 1024 * 1024;

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
    pub(crate) peak_streams: u64,
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
    pub(crate) fn new(
        config: &Http3Config,
        max_requests: usize,
        [control, decoder, encoder]: [StreamId; 3],
    ) -> Self {
        let kept_sections = max_requests.max(MIN_COLLECTED_KEPT_SECTIONS);
        let kept_len = (config.kept_fields.size).saturating_mul(kept_sections);
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
            peak_streams: 0,
            collected: 0,
            max_collected: (config.tolerated_fields.size)
                .saturating_mul(COLLECTED_SECTIONS)
                .max(kept_len.min(MAX_COLLECTED_KEPT_LEN))
                .max(MIN_MAX_COLLECTED),
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
        out.clear();
        out.extend_from_slice(&[0; frame::MAX_HEADER_LEN]);
        let mut section = self.encoder.section(id.0, out, credit);
        for it in headers {
            section.field(it.name, it.static_index, it.value, it.indexing);
        }
        let start = section.finish();
        let (frame_header, len) = frame::header(frame::kind::HEADERS, (out.len() - start) as u64);
        let start = start - len;
        let room = out.iter_mut().skip(start);
        (room.zip(frame_header).take(len)).for_each(|(to, from)| *to = from);
        out.get(start..).unwrap_or_default()
    }
}

/// What the control, decoder and encoder streams start with.
pub(crate) fn preambles(config: &Http3Config, side: Side) -> [(StreamType, Vec<u8>); 3] {
    let mut control = vec![stream_type::CONTROL as u8];
    control::write_settings(config, &mut control);
    if side.is_server() && !config.origins.is_empty() {
        frame::write(frame::kind::ORIGIN, &config.origins, &mut control);
    }
    [
        (StreamType::Control, control),
        (StreamType::Decoder, vec![stream_type::DECODER as u8]),
        (StreamType::Encoder, vec![stream_type::ENCODER as u8]),
    ]
}
