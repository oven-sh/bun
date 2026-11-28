//! RFC 9114 §6.2.1 and §7.2.

use super::Priority;
use super::frame::{self, Cursor, Header, kind};
use crate::coding::{Read, Write};
use crate::config::Http3Config;
use crate::error::{Error, Result, http3_code};
use crate::stream_id::{Side, StreamId};

const MAX_SETTINGS_LEN: u64 = 8 * 1024;
const MAX_ORIGIN_LEN: u64 = 64 * 1024;
const MAX_PRIORITY_UPDATE_LEN: u64 = 256;

pub(super) const MAX_TABLE_CAPACITY: u32 = 4096;
pub(super) const MAX_BLOCKED_STREAMS: u32 = 100;

mod setting {
    pub(super) const QPACK_MAX_TABLE_CAPACITY: u64 = 0x01;
    pub(super) const MAX_FIELD_SECTION_SIZE: u64 = 0x06;
    pub(super) const QPACK_BLOCKED_STREAMS: u64 = 0x07;
    pub(super) const ENABLE_CONNECT_PROTOCOL: u64 = 0x08;
    /// RFC 9114 §7.2.4.1.
    pub(super) const RESERVED: u64 = 0x21;
    pub(super) const H3_DATAGRAM: u64 = 0x33;
}

#[derive(Default)]
pub(crate) struct Settings {
    pub(crate) max_table_capacity: u64,
    pub(crate) max_blocked_streams: u64,
    pub(crate) datagrams: bool,
}

pub(crate) enum ControlFrame {
    Settings(Settings),
    GoAway(StreamId),
    Origin(Vec<u8>),
    PriorityUpdate(StreamId, Priority),
}

#[derive(Default)]
pub(crate) struct ControlReader {
    cursor: Cursor,
    payload: Vec<u8>,
    is_skipping: bool,
    has_settings: bool,
    max_push_id: u64,
    go_away: Option<u64>,
}

const MALFORMED: Error = Error::http3(http3_code::FRAME_ERROR, "malformed control frame");

impl ControlReader {
    /// Takes all of `input` if it returns `None`.
    pub(crate) fn read(
        &mut self,
        input: &mut &[u8],
        side: Side,
        has_priorities: bool,
    ) -> Result<Option<ControlFrame>> {
        loop {
            if self.cursor.current().is_none() {
                let Some(header) = self.cursor.read_header(input) else {
                    return Ok(None);
                };
                self.is_skipping = !self.begin_frame(header, side, has_priorities)?;
            }
            let kind = self.cursor.current().unwrap_or(0);
            let (payload, is_end) = self.cursor.read_payload(input);
            if !self.is_skipping {
                self.payload.extend_from_slice(payload);
            }
            if !is_end {
                return Ok(None);
            }
            if !self.is_skipping {
                let payload = core::mem::take(&mut self.payload);
                if let Some(frame) = self.end_frame(kind, payload)? {
                    return Ok(Some(frame));
                }
            }
        }
    }

    /// Returns whether the frame is of interest.
    fn begin_frame(
        &mut self,
        Header { kind, len }: Header,
        side: Side,
        has_priorities: bool,
    ) -> Result<bool> {
        let unexpected = Error::http3(
            http3_code::FRAME_UNEXPECTED,
            "unexpected frame on the control stream",
        );
        if !core::mem::replace(&mut self.has_settings, true) {
            return match kind {
                kind::SETTINGS if len <= MAX_SETTINGS_LEN => Ok(true),
                kind::SETTINGS => Err(Error::http3(
                    http3_code::EXCESSIVE_LOAD,
                    "too many settings",
                )),
                _ => Err(Error::http3(
                    http3_code::MISSING_SETTINGS,
                    "first control frame is not SETTINGS",
                )),
            };
        }
        match kind {
            kind::DATA | kind::HEADERS | kind::PUSH_PROMISE | kind::SETTINGS => Err(unexpected),
            kind::MAX_PUSH_ID if side.is_client() => Err(unexpected),
            kind::GOAWAY | kind::CANCEL_PUSH | kind::MAX_PUSH_ID if len > 8 => Err(MALFORMED),
            kind::GOAWAY | kind::CANCEL_PUSH | kind::MAX_PUSH_ID => Ok(true),
            kind::ORIGIN => Ok(side.is_client() && len <= MAX_ORIGIN_LEN),
            kind::PRIORITY_UPDATE_REQUEST | kind::PRIORITY_UPDATE_PUSH if has_priorities => {
                match (side, kind) {
                    (Side::Client, _) => Err(unexpected),
                    (_, kind::PRIORITY_UPDATE_PUSH) => Err(PUSH_IS_NOT_ENABLED),
                    _ => Ok(len <= MAX_PRIORITY_UPDATE_LEN),
                }
            }
            _ if kind::is_from_http2(kind) => Err(unexpected),
            _ => Ok(false),
        }
    }

    fn end_frame(&mut self, kind: u64, payload: Vec<u8>) -> Result<Option<ControlFrame>> {
        let mut rest = payload.as_slice();
        match kind {
            kind::ORIGIN => return Ok(Some(ControlFrame::Origin(payload))),
            kind::SETTINGS => return read_settings(rest).map(ControlFrame::Settings).map(Some),
            _ => {}
        }
        let id = rest.varint().ok_or(MALFORMED)?;
        if kind == kind::PRIORITY_UPDATE_REQUEST {
            let mut priority = Priority::default();
            priority.update(rest);
            return Ok(Some(ControlFrame::PriorityUpdate(StreamId(id), priority)));
        }
        match kind {
            _ if !rest.is_empty() => Err(MALFORMED),
            kind::GOAWAY if self.go_away.replace(id).is_none_or(|last| id <= last) => {
                Ok(Some(ControlFrame::GoAway(StreamId(id))))
            }
            kind::GOAWAY => Err(Error::http3(http3_code::ID_ERROR, "GOAWAY was raised")),
            kind::MAX_PUSH_ID if id >= self.max_push_id => {
                self.max_push_id = id;
                Ok(None)
            }
            kind::MAX_PUSH_ID => Err(Error::http3(
                http3_code::ID_ERROR,
                "MAX_PUSH_ID was reduced",
            )),
            _ => Err(PUSH_IS_NOT_ENABLED),
        }
    }
}

pub(super) const PUSH_IS_NOT_ENABLED: Error =
    Error::http3(http3_code::ID_ERROR, "push is not enabled");

fn read_settings(mut payload: &[u8]) -> Result<Settings> {
    let invalid = Error::http3(http3_code::SETTINGS_ERROR, "invalid setting");
    let (mut settings, mut seen) = (Settings::default(), 0u64);
    while !payload.is_empty() {
        let (id, value) = payload.varint().zip(payload.varint()).ok_or(MALFORMED)?;
        match id {
            setting::QPACK_MAX_TABLE_CAPACITY => settings.max_table_capacity = value,
            setting::QPACK_BLOCKED_STREAMS => settings.max_blocked_streams = value,
            setting::H3_DATAGRAM | setting::ENABLE_CONNECT_PROTOCOL if value > 1 => {
                return Err(invalid);
            }
            setting::H3_DATAGRAM => settings.datagrams = value == 1,
            setting::MAX_FIELD_SECTION_SIZE | setting::ENABLE_CONNECT_PROTOCOL => {}
            0x00 | 0x02..=0x05 => return Err(invalid),
            _ => continue,
        }
        if seen >> id & 1 != 0 {
            return Err(invalid);
        }
        seen |= 1 << id;
    }
    Ok(settings)
}

pub(crate) fn write_settings(config: &Http3Config, out: &mut Vec<u8>) {
    let mut payload = Vec::new();
    for (is_sent, id, value) in [
        (
            config.advertises_max_field_section_size,
            setting::MAX_FIELD_SECTION_SIZE,
            config.kept_fields.size as u64,
        ),
        (
            true,
            setting::QPACK_MAX_TABLE_CAPACITY,
            MAX_TABLE_CAPACITY.into(),
        ),
        (
            true,
            setting::QPACK_BLOCKED_STREAMS,
            MAX_BLOCKED_STREAMS.into(),
        ),
        (config.connect_protocol, setting::ENABLE_CONNECT_PROTOCOL, 1),
        (config.datagrams, setting::H3_DATAGRAM, 1),
        (true, setting::RESERVED, 0),
    ] {
        if is_sent {
            payload.varint(id);
            payload.varint(value);
        }
    }
    frame::write(kind::SETTINGS, &payload, out);
}

pub(crate) fn go_away_frame(id: StreamId) -> Vec<u8> {
    let (mut payload, mut out) = (Vec::new(), Vec::new());
    payload.varint(id.0);
    frame::write(kind::GOAWAY, &payload, &mut out);
    out
}

pub(crate) fn priority_update_frame(id: StreamId, priority: Priority) -> Vec<u8> {
    let (mut payload, mut out) = (Vec::new(), Vec::new());
    payload.varint(id.0);
    let (value, len) = priority.encode();
    payload.extend(value.iter().take(len));
    frame::write(kind::PRIORITY_UPDATE_REQUEST, &payload, &mut out);
    out
}
