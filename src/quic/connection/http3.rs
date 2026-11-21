//! What HTTP/3 does with the streams of a connection.

use super::Connection;
use super::application::CRITICAL_STREAM_CLOSED;
use super::streams::{Flags, Load, Role, Stream, Streams};
use super::timers::Timer;
use crate::config::Http3Config;
use crate::endpoint::Shared;
use crate::error::{Error, Result, http3_code};
use crate::event::{Event, StreamEvent};
use crate::http3::{
    ControlFrame, Header, Http3, Priority, StreamType, go_away_frame, preambles,
    priority_update_frame,
};
use crate::stream_id::{Direction, Side, StreamId};
use crate::time::{Duration, Instant};

const MAX_UNACKED_INSTRUCTIONS_LEN: u64 = 64 * 1024;
const MAX_INSTRUCTION_DELAY: Duration = Duration::from_millis(5);
const MAX_ORIGIN_FRAMES: u8 = 16;
const MAX_EARLY_PRIORITIES: usize = 128;

impl Streams {
    pub(super) fn start_http3(&mut self, config: &Http3Config, side: Side) -> Option<Box<Http3>> {
        let ids = preambles(config, side).map(|(kind, preamble)| {
            let (id, stream) =
                (self.table).open(Direction::Unidirectional, Some(kind), &self.state)?;
            self.state.write(id, stream, &[&preamble]);
            Some(id)
        });
        match ids {
            [Some(a), Some(b), Some(c)] => Some(Box::new(Http3::new(config, [a, b, c]))),
            _ => None,
        }
    }

    /// Returns how much of the stream is waiting to be acknowledged.
    fn write_internal(&mut self, id: StreamId, data: &[u8]) -> u64 {
        self.get_mut(id).map_or(0, |(stream, state)| {
            state.write(id, stream, &[data]);
            stream.send.len()
        })
    }
}

impl Connection {
    /// Returns false if the stream cannot be written to.
    #[inline]
    pub(crate) fn send_headers<'a>(
        &mut self,
        id: StreamId,
        headers: impl Iterator<Item = Header<'a>>,
        scratch: &mut Vec<u8>,
    ) -> bool {
        let is_open = self.is_receiving();
        let Some(http3) = self.http3.as_mut().filter(|_| is_open) else {
            return false;
        };
        let credit = match http3.uses_dynamic_table {
            true => (self.streams.get_mut(http3.encoder_stream))
                .map_or(0, |(stream, state)| state.credit_for(stream)),
            false => 0,
        };
        let Some((stream, state)) = self.streams.get_mut(id) else {
            return false;
        };
        let is_writable = !stream.flags.contains(Flags::WRITE_DONE);
        let (Role::Message(message), true) = (&mut stream.role, is_writable) else {
            return false;
        };
        let is_request = self.side.is_client() && !message.has_sent_headers;
        let headers = headers.inspect(|header| {
            if is_request && header.name == b":method" {
                message.is_head_request = header.value == b"HEAD";
                message.is_connect_request = header.value == b"CONNECT";
            }
        });
        let frame = http3.encode_headers(id, headers, credit as usize, scratch);
        message.has_sent_headers = true;
        stream.write_round = 0;
        state.write(id, stream, &[frame]);
        state.made_progress = true;
        let instructions = http3.encoder.instructions();
        if !instructions.is_empty() {
            (self.streams).write_internal(http3.encoder_stream, instructions);
            instructions.clear();
        }
        true
    }

    /// They are not worth a packet of their own, for a while.
    #[inline]
    pub(super) fn bundle_qpack_instructions(&mut self, now: Instant) -> Result {
        if (self.http3.as_mut()).is_none_or(|it| it.decoder.instructions().is_empty()) {
            return Ok(());
        }
        if self.has_frames() {
            return self.send_qpack_instructions();
        }
        let deadline = self.timers.get(Timer::Qpack);
        (self.timers).set(Timer::Qpack, deadline.min(now + MAX_INSTRUCTION_DELAY));
        Ok(())
    }

    pub(super) fn send_qpack_instructions(&mut self) -> Result {
        self.timers.stop(Timer::Qpack);
        let unacked = self.http3.as_mut().map(|http3| {
            let instructions = http3.decoder.instructions();
            let unacked = (self.streams).write_internal(http3.decoder_stream, instructions);
            instructions.clear();
            unacked
        });
        if unacked > Some(MAX_UNACKED_INSTRUCTIONS_LEN) {
            let reason = "peer does not read the decoder stream";
            return Err(Error::http3(http3_code::EXCESSIVE_LOAD, reason));
        }
        Ok(())
    }

    /// RFC 9114 §5.2. A server closes the connection after the last response.
    pub fn go_away(&mut self) {
        if let Some(http3) = &self.http3
            && !self.is_closing()
            && !core::mem::replace(&mut self.streams.table.is_going_away, true)
        {
            let id = match self.side {
                Side::Client => StreamId(0),
                Side::Server => self.streams.table.next_remote(Direction::Bidirectional),
            };
            (self.streams).write_internal(http3.control_stream, &go_away_frame(id));
            if self.side.is_server() {
                self.reject(|_, stream| {
                    matches!(&stream.role, Role::Message(it) if it.awaits_head())
                        && !stream.flags.contains(Flags::READ_DONE)
                });
            }
        }
    }

    /// For requests that are not going to be processed (RFC 9114 §4.1.1).
    fn reject(&mut self, is_rejected: impl Fn(StreamId, &Stream) -> bool) {
        let code = match self.side {
            Side::Client => http3_code::REQUEST_CANCELLED,
            Side::Server => http3_code::REQUEST_REJECTED,
        };
        let Streams { table, state, .. } = &mut self.streams;
        for (id, stream) in table.sorted(is_rejected) {
            stream.abandon_message(id, self.http3.as_deref_mut());
            state.notify(id, stream, StreamEvent::Reset(http3_code::REQUEST_REJECTED));
            state.reset(id, stream, code);
            state.stop(id, stream, code);
        }
    }

    pub fn peer_go_away(&self) -> Option<StreamId> {
        self.http3.as_ref()?.peer_go_away
    }

    /// `None` until its settings have arrived.
    pub fn peer_accepts_http3_datagrams(&self) -> Option<bool> {
        self.http3.as_ref()?.peer_accepts_datagrams
    }

    pub fn priority(&self, id: StreamId) -> Option<Priority> {
        self.streams.table.get(id).map(|stream| stream.priority)
    }

    pub fn set_priority(&mut self, id: StreamId, priority: Priority) {
        let Some((stream, _)) = self.stream(id).filter(|it| it.0.priority != priority) else {
            return;
        };
        stream.priority = priority;
        stream.flags.insert(Flags::HAS_PRIORITY_UPDATE);
        let is_request = matches!(stream.role, Role::Message(_));
        self.streams.has_new_priorities = true;
        if let Some(http3) = &self.http3
            && is_request
            && self.side.is_client()
        {
            let frame = priority_update_frame(id, priority);
            self.streams.write_internal(http3.control_stream, &frame);
        }
    }

    /// RFC 9218 §7.
    pub(super) fn apply_request_priority(&mut self, id: StreamId) {
        if let (Some(stream), Some(http3)) = (self.streams.table.get_mut(id), &mut self.http3)
            && !stream.flags.contains(Flags::HAS_PRIORITY_UPDATE)
            && let Role::Message(message) = &stream.role
        {
            let early = http3
                .early_priorities
                .extract_if(.., |it| it.0 == id)
                .last();
            if let Some(priority) = early.map(|it| it.1).or(message.priority) {
                stream.priority = priority;
                self.streams.has_new_priorities |=
                    (stream.flags).intersects(Flags::IN_WRITABLE | Flags::IN_SENDABLE);
            }
        }
    }

    fn on_priority_update(&mut self, id: StreamId, priority: Priority) -> Result {
        let table = &mut self.streams.table;
        let is_unused = Some(id).filter(|&id| is_request(id));
        match (
            is_unused.and_then(|id| table.is_unused(id)),
            &mut self.http3,
        ) {
            (None, _) => {
                let reason = "PRIORITY_UPDATE frame for an invalid stream";
                return Err(Error::http3(http3_code::ID_ERROR, reason));
            }
            (Some(true), Some(http3)) => {
                http3.early_priorities.retain(|it| it.0 != id);
                if http3.early_priorities.len() == MAX_EARLY_PRIORITIES {
                    http3.early_priorities.remove(0);
                }
                http3.early_priorities.push((id, priority));
            }
            _ => {
                if let Some(stream) = table.get_mut(id) {
                    stream.priority = priority;
                    stream.flags.insert(Flags::HAS_PRIORITY_UPDATE);
                    self.streams.has_new_priorities = true;
                }
            }
        }
        Ok(())
    }

    fn on_go_away(&mut self, first: StreamId) -> Result {
        let Some(http3) = self.http3.as_mut().filter(|_| self.side.is_client()) else {
            return Ok(());
        };
        if !is_request(first) || http3.peer_go_away.is_some_and(|it| it < first) {
            return Err(Error::http3(
                http3_code::ID_ERROR,
                "invalid ID in GOAWAY frame",
            ));
        }
        match http3.peer_go_away.replace(first) {
            Some(previous) if previous == first => return Ok(()),
            Some(_) => self.streams.state.add_load(Load::Heavy),
            None => self.emit(Event::GoAway),
        }
        // Some servers name the last request that they process.
        self.reject(|id, stream| id > first && is_request(id) && !stream.has_received());
        Ok(())
    }

    fn read_control_stream(&mut self, mut data: &[u8]) -> Result {
        let (side, has_priorities) = (self.side, self.config.has_priorities);
        while let (Some(http3), Some(config)) = (&mut self.http3, &self.config.http3)
            && let Some(frame) = (http3.control_reader).read(&mut data, side, has_priorities)?
        {
            match frame {
                ControlFrame::GoAway(id) => self.on_go_away(id)?,
                ControlFrame::PriorityUpdate(id, it) => self.on_priority_update(id, it)?,
                ControlFrame::Origin(payload) => {
                    self.origin_frames_received = self.origin_frames_received.saturating_add(1);
                    if self.origin_frames_received <= MAX_ORIGIN_FRAMES {
                        self.emit(Event::Origin(payload));
                    }
                }
                ControlFrame::Settings(settings) => {
                    http3.peer_accepts_datagrams = Some(settings.datagrams);
                    if config.encodes_with_dynamic_table {
                        let capacity = settings.max_table_capacity;
                        (http3.encoder).use_dynamic_table(capacity, settings.max_blocked_streams);
                        http3.uses_dynamic_table = capacity > 0;
                    }
                }
            }
        }
        Ok(())
    }

    /// `data` is what comes next on a unidirectional stream.
    pub(super) fn read_typed(
        &mut self,
        id: StreamId,
        mut kind: StreamType,
        data: &[u8],
        shared: &mut Shared,
    ) -> Result {
        let mut len = data.len();
        kind = self.feed_typed(kind, data, shared)?;
        while let Some((stream, state)) = self.streams.get_mut(id) {
            stream.advance(len);
            if let Some((known, chunk)) = stream.take_kept() {
                let data = chunk.get(known..).unwrap_or_default();
                (len, kind) = (data.len(), self.feed_typed(kind, data, shared)?);
                continue;
            }
            stream.role = Role::Typed(kind);
            match kind {
                StreamType::Ignored => {
                    state.add_load(Load::Heavy);
                    state.stop(id, stream, http3_code::STREAM_CREATION_ERROR);
                }
                _ if !stream.is_read_to_end() => state.credit(id, stream),
                StreamType::Unknown(_) => state.finish_reading(id, stream),
                _ => return Err(CRITICAL_STREAM_CLOSED),
            }
            break;
        }
        self.streams.remove_if_finished(id);
        Ok(())
    }

    fn feed_typed(
        &mut self,
        mut kind: StreamType,
        mut data: &[u8],
        shared: &mut Shared,
    ) -> Result<StreamType> {
        if let (StreamType::Unknown(partial), Some(http3)) = (&mut kind, &mut self.http3)
            && let Some(number) = partial.read(&mut data)
        {
            kind = http3.classify(number, self.side)?;
        }
        match (kind, &mut self.http3) {
            (StreamType::Decoder, Some(http3)) => http3.encoder.read_decoder_stream(data)?,
            (StreamType::Encoder, Some(http3)) => {
                (http3.decoder).read_encoder_stream(data, &mut shared.scratch)?;
                while let Some(id) =
                    (self.http3.as_mut()).and_then(|it| it.decoder.next_unblocked())
                {
                    self.resume_reading(StreamId(id), true, shared)?;
                }
            }
            (StreamType::Control, _) => self.read_control_stream(data)?,
            _ => {}
        }
        Ok(kind)
    }
}

fn is_request(id: StreamId) -> bool {
    id.initiator().is_client() && id.direction() == Direction::Bidirectional
}
