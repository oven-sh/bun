//! RFC 9114 §4.1.

use super::control::PUSH_IS_NOT_ENABLED;
use super::fields::{self, Expected, Fields, Pool, Section, Summary};
use super::frame::{Cursor, Header, kind};
use super::{Http3, Priority};
use crate::config::{Config, Http3Config};
use crate::connection::streams::Ready;
use crate::error::{Error, http3_code};
use crate::stream_id::{Side, StreamId};

const MAX_INTERIM_RESPONSES: u8 = 32;

#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum Part {
    #[default]
    Head,
    Body,
    AfterTrailers,
}

/// A request and its response.
#[derive(Default)]
pub(crate) struct Message {
    cursor: Cursor,
    part: Part,
    /// A field section that is not complete, or that cannot be decoded yet.
    section: Vec<u8>,
    is_blocked: bool,
    /// For the application.
    fields: Option<Fields>,
    /// Whether they come after the data that the application has not got yet.
    fields_follow_data: bool,
    interim_responses: u8,
    /// How much of the body is yet to be announced by DATA frames, if that is known.
    expected_len: Option<u64>,
    /// From the `priority` field of a request.
    pub(crate) priority: Option<Priority>,
    is_tunnel: bool,
    pub(crate) has_sent_headers: bool,
    pub(crate) is_head_request: bool,
    pub(crate) is_connect_request: bool,
}

pub(crate) enum Fault {
    Stream(u64),
    Connection(Error),
}

/// RFC 9114 §4.1.2.
pub(super) const MALFORMED: Fault = Fault::Stream(http3_code::MESSAGE_ERROR);

impl From<Error> for Fault {
    fn from(error: Error) -> Self {
        Self::Connection(error)
    }
}

impl From<bun_qpack::Error> for Fault {
    fn from(error: bun_qpack::Error) -> Self {
        Self::Connection(error.into())
    }
}

pub(crate) struct Reader<'a> {
    id: StreamId,
    side: Side,
    pub(crate) http3: &'a mut Http3,
    config: &'a Http3Config,
    pool: &'a mut Pool,
    has_priorities: bool,
}

impl<'a> Reader<'a> {
    #[inline]
    pub(crate) fn new(
        id: StreamId,
        side: Side,
        http3: Option<&'a mut Http3>,
        config: &'a Config,
        pool: &'a mut Pool,
    ) -> Option<Self> {
        (http3.zip(config.http3.as_ref())).map(|(http3, http3_config)| Self {
            id,
            side,
            http3,
            config: http3_config,
            pool,
            has_priorities: config.has_priorities,
        })
    }
}

impl Message {
    /// Whether it does not take more bytes at the moment.
    #[inline]
    fn is_paused(&self) -> bool {
        self.is_blocked || self.fields.is_some() && self.cursor.current() == Some(kind::HEADERS)
    }

    pub(crate) fn awaits_head(&self) -> bool {
        self.part == Part::Head
    }

    /// Whether more is to come from the bytes that have been read.
    #[inline]
    pub(crate) fn has_pending_fields(&self) -> bool {
        self.is_blocked || self.fields.is_some()
    }

    #[inline]
    pub(crate) fn take_fields(&mut self, has_data: bool) -> Option<Fields> {
        self.fields
            .take_if(|_| !(has_data && self.fields_follow_data))
    }

    /// Returns how many bytes it took.
    #[inline]
    pub(crate) fn read(
        &mut self,
        input: &[u8],
        mut ready: Ready,
        reader: &mut Reader,
    ) -> Result<usize, Fault> {
        let mut rest = input;
        while !rest.is_empty() && !self.is_paused() {
            let Some(kind) = self.cursor.current() else {
                if let Some(header) = self.cursor.read_header(&mut rest) {
                    self.begin_frame(header, reader)?;
                }
                continue;
            };
            let (payload, is_end) = self.cursor.read_payload(&mut rest);
            match kind {
                kind::DATA => ready.push(payload),
                kind::HEADERS if is_end && self.section.is_empty() => {
                    if !self.decode(payload, !ready.is_empty(), reader)? {
                        self.collect(payload, reader.http3)?;
                    }
                }
                kind::HEADERS => {
                    self.collect(payload, reader.http3)?;
                    if is_end {
                        self.decode_collected(!ready.is_empty(), reader)?;
                    }
                }
                _ => {}
            }
        }
        Ok(input.len() - rest.len())
    }

    #[inline]
    fn begin_frame(&mut self, Header { kind, len }: Header, reader: &Reader) -> Result<(), Fault> {
        let is_expected = match kind {
            kind::DATA => self.part == Part::Body,
            kind::HEADERS => self.part != Part::AfterTrailers && !self.is_tunnel,
            kind::PUSH_PROMISE if reader.side.is_client() => return Err(PUSH_IS_NOT_ENABLED.into()),
            kind::PUSH_PROMISE
            | kind::CANCEL_PUSH
            | kind::SETTINGS
            | kind::GOAWAY
            | kind::MAX_PUSH_ID => false,
            kind::PRIORITY_UPDATE_REQUEST | kind::PRIORITY_UPDATE_PUSH => !reader.has_priorities,
            _ => !kind::is_from_http2(kind),
        };
        if !is_expected {
            let reason = "unexpected frame on a request stream";
            return Err(Error::http3(http3_code::FRAME_UNEXPECTED, reason).into());
        }
        if kind == kind::DATA
            && let Some(expected) = &mut self.expected_len
        {
            *expected = expected.checked_sub(len).ok_or(MALFORMED)?;
        }
        if kind == kind::HEADERS && len > reader.config.tolerated_fields.size as u64 {
            return Err(MALFORMED);
        }
        if len == 0 {
            if kind == kind::HEADERS {
                return Err(bun_qpack::Error::DecompressionFailed.into());
            }
            self.cursor = Cursor::default();
        }
        Ok(())
    }

    fn collect(&mut self, payload: &[u8], http3: &mut Http3) -> Result<(), Error> {
        self.section.extend_from_slice(payload);
        http3.collected += payload.len();
        if http3.collected > http3.max_collected {
            let reason = "too many unfinished field sections";
            return Err(Error::http3(http3_code::EXCESSIVE_LOAD, reason));
        }
        Ok(())
    }

    /// Also for when the dynamic table has what was missing.
    pub(crate) fn decode_collected(
        &mut self,
        follows_data: bool,
        reader: &mut Reader,
    ) -> Result<(), Fault> {
        let section = core::mem::take(&mut self.section);
        let result = self.decode(&section, follows_data, reader);
        match result {
            Ok(false) => self.section = section,
            _ => reader.http3.collected -= section.len(),
        }
        result.map(drop)
    }

    /// Returns false if it has to wait for the dynamic table.
    #[inline]
    fn decode(
        &mut self,
        section: &[u8],
        follows_data: bool,
        reader: &mut Reader,
    ) -> Result<bool, Fault> {
        let expected = match (self.part, reader.side) {
            (Part::Head, Side::Server) => Expected::Request,
            (Part::Head, Side::Client) => Expected::Response,
            _ => Expected::Trailers,
        };
        let mut fields = reader.pool.take();
        let decoder = &mut reader.http3.decoder;
        let (id, config) = (reader.id.0, reader.config);
        let summary = fields::decode(decoder, id, section, expected, config, &mut fields)?;
        self.is_blocked = summary.is_none();
        let Some(summary) = summary else {
            return Ok(false);
        };
        fields.section = self.enter(expected, &summary)?;
        self.fields = Some(fields);
        self.fields_follow_data = follows_data;
        Ok(true)
    }

    #[inline]
    fn enter(&mut self, expected: Expected, summary: &Summary) -> Result<Section, Fault> {
        match expected {
            Expected::Trailers => {
                if self.expected_len.is_some_and(|len| len > 0) {
                    return Err(MALFORMED);
                }
                self.part = Part::AfterTrailers;
                return Ok(Section::Trailers);
            }
            Expected::Response if summary.status < 200 => {
                self.interim_responses += 1;
                if self.interim_responses > MAX_INTERIM_RESPONSES {
                    return Err(Fault::Stream(http3_code::EXCESSIVE_LOAD));
                }
                return Ok(Section::Interim);
            }
            // RFC 9114 §4.1.2.
            Expected::Response => {
                self.expected_len = match summary.status {
                    ..300 if self.is_connect_request => None,
                    204 | 304 => Some(0),
                    _ if self.is_head_request => Some(0),
                    _ => summary.content_length,
                };
                self.is_tunnel = self.is_connect_request && summary.status < 300;
            }
            Expected::Request => {
                self.expected_len = summary.content_length.filter(|_| !summary.is_connect);
                self.priority = summary.priority;
                self.is_tunnel = summary.is_connect;
            }
        }
        self.part = Part::Body;
        Ok(Section::Head)
    }

    /// For when all bytes of the stream have been read.
    #[inline]
    pub(crate) fn check_end(&self, reader: &Reader) -> Result<(), Fault> {
        if !self.cursor.is_between_frames() {
            return Err(Error::http3(http3_code::FRAME_ERROR, "last frame is truncated").into());
        }
        if self.is_blocked {
            return Ok(());
        }
        match self.part {
            Part::Head => Err(Fault::Stream(match reader.side {
                Side::Client => http3_code::REQUEST_CANCELLED,
                Side::Server => http3_code::REQUEST_INCOMPLETE,
            })),
            Part::Body if self.expected_len.is_none_or(|len| len == 0) => Ok(()),
            Part::Body => Err(MALFORMED),
            Part::AfterTrailers => Ok(()),
        }
    }

    /// For when the rest of the stream is not going to be read (RFC 9204 §2.2.2.2).
    pub(crate) fn abandon(&mut self, id: StreamId, is_read_to_end: bool, http3: &mut Http3) {
        http3.collected -= core::mem::take(&mut self.section).len();
        if self.is_blocked || !is_read_to_end {
            http3.decoder.cancel_stream(id.0);
        }
        (self.fields, self.is_blocked) = (None, false);
    }
}
