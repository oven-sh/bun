//! What the application does with streams, and what it is told.

use super::streams::{Flags, Half, Role, State, Stream};
use super::{Connection, Ending};
use crate::endpoint::Shared;
use crate::error::{Error, Result, http3_code};
use crate::event::{Context, Event, StreamEvent};
use crate::http3::{Fault, Reader, Section, StreamType, data_frame_header};
use crate::stream_id::{Direction, StreamId};

pub(super) const CRITICAL_STREAM_CLOSED: Error = Error::http3(
    http3_code::CLOSED_CRITICAL_STREAM,
    "control or QPACK stream was closed",
);

/// What there is to know about a stream.
pub struct StreamInfo {
    pub has_unacked_data: bool,
    pub has_early_data: bool,
    pub is_stopped_by_peer: bool,
}

impl Connection {
    /// The streams of HTTP/3 itself are out of reach.
    #[inline]
    pub(super) fn stream(&mut self, id: StreamId) -> Option<(&mut Stream, &mut State)> {
        let is_open = self.is_receiving();
        (self.streams.get_mut(id)).filter(|it| is_open && !it.0.flags.contains(Flags::RELEASED))
    }

    pub fn available_streams(&self, direction: Direction) -> u64 {
        let is_refused = direction == Direction::Bidirectional
            && (self.http3.as_ref()).is_some_and(|it| it.peer_go_away.is_some());
        match self.can_open_streams && self.ending == Ending::No && !is_refused {
            true => self.streams.table.available(direction),
            false => 0,
        }
    }

    pub fn open(&mut self, direction: Direction, context: Context) -> Option<StreamId> {
        if self.available_streams(direction) == 0 {
            return None;
        }
        let (id, stream) = self.streams.table.open(direction, None)?;
        stream.context = context;
        Some(id)
    }

    pub fn set_stream_context(&mut self, id: StreamId, context: Context) {
        if let Some(stream) = self.streams.table.get_mut(id) {
            stream.context = context;
        }
    }

    pub fn stream_info(&self, id: StreamId) -> Option<StreamInfo> {
        self.streams.table.get(id).map(|stream| StreamInfo {
            has_unacked_data: stream.has_unacked_data()
                || stream.flags & (Flags::RESET | Flags::SEND_DONE) == Flags::RESET,
            has_early_data: stream.flags.contains(Flags::HAS_EARLY_DATA),
            is_stopped_by_peer: stream.flags.contains(Flags::STOPPED_BY_PEER),
        })
    }

    /// Returns how many bytes it took, or `None` if the stream cannot be written to.
    #[inline]
    pub fn write(&mut self, id: StreamId, data: &[u8]) -> Option<usize> {
        let (stream, state) = self.stream(id)?;
        if stream.flags.contains(Flags::WRITE_DONE) {
            return None;
        }
        let capacity = state.capacity(stream);
        let overhead = match &stream.role {
            Role::Message(message) if !message.has_sent_headers => return None,
            Role::Message(_) => data_frame_header(capacity.min(data.len() as u64)).1,
            _ => 0,
        };
        let len = (capacity.saturating_sub(overhead as u64)).min(data.len() as u64);
        let taken = data.get(..len as usize).unwrap_or_default();
        if !taken.is_empty() {
            let (header, header_len) = data_frame_header(len);
            let header = header.get(..header_len.min(overhead)).unwrap_or_default();
            state.write(id, stream, &[header, taken]);
            state.made_progress = true;
        }
        if taken.len() < data.len() {
            state.report_blocked(id, stream);
            state.want_write(id, stream);
        }
        Some(taken.len())
    }

    pub fn want_write(&mut self, id: StreamId, is_wanted: bool) {
        match self.stream(id) {
            Some((stream, state)) if is_wanted => state.want_write(id, stream),
            Some((stream, _)) => stream.flags.remove(Flags::WANTS_WRITE),
            None => {}
        }
    }

    /// Ends the stream after what has been written.
    #[inline]
    pub fn finish(&mut self, id: StreamId) {
        if let Some((stream, state)) = self.stream(id) {
            match &stream.role {
                Role::Message(message) if !message.has_sent_headers => {
                    state.reset(id, stream, http3_code::REQUEST_CANCELLED);
                }
                _ => state.finish(id, stream),
            }
        }
    }

    /// Gives up on writing.
    pub fn reset(&mut self, id: StreamId, code: u64) {
        if let Some((stream, state)) = self.stream(id) {
            state.reset(id, stream, code);
        }
    }

    /// Gives up on reading.
    pub fn stop(&mut self, id: StreamId, code: u64) {
        self.abandon_message(id);
        if let Some((stream, state)) = self.stream(id) {
            state.stop(id, stream, code);
        }
    }

    pub fn set_paused(&mut self, id: StreamId, is_paused: bool) {
        if let Some((stream, state)) = self.stream(id) {
            stream.flags.set(Flags::PAUSED, is_paused);
            state.mark_readable(id, stream);
        }
    }

    pub(super) fn abandon_message(&mut self, id: StreamId) {
        if let (Some(stream), Some(http3)) = (self.streams.table.get_mut(id), &mut self.http3)
            && !stream.flags.contains(Flags::READ_DONE)
            && let Role::Message(message) = &mut stream.role
        {
            message.abandon(id, http3);
        }
    }

    #[inline]
    pub(super) fn on_stream(
        &mut self,
        id: StreamId,
        offset: u64,
        data: &[u8],
        fin: bool,
        is_early: bool,
        shared: &mut Shared,
    ) -> Result {
        let Some((stream, state)) = self.streams.accept(id, Half::Receive)? else {
            return Ok(());
        };
        if is_early {
            stream.flags.insert(Flags::HAS_EARLY_DATA);
        }
        let Some(data) = state.on_stream(id, stream, offset, data, fin)? else {
            if fin {
                self.streams.remove_if_finished(id);
            }
            return Ok(());
        };
        if let Role::Typed(kind) = stream.role {
            return self.read_typed(id, kind, data, shared);
        }
        let reader = (self.http3.as_mut().zip(self.config.http3.as_ref())).map(|it| Reader {
            id,
            side: self.side,
            http3: it.0,
            config: it.1,
            pool: &mut shared.pool,
            has_priorities: self.config.has_priorities,
        });
        read(id, stream, state, data, reader, false)
    }

    /// Goes on with what could not be read before.
    #[inline]
    pub(super) fn resume_reading(
        &mut self,
        id: StreamId,
        is_unblocked: bool,
        shared: &mut Shared,
    ) -> Result {
        let Some((stream, state)) = self.streams.get_mut(id) else {
            return Ok(());
        };
        let reader = (self.http3.as_mut().zip(self.config.http3.as_ref())).map(|it| Reader {
            id,
            side: self.side,
            http3: it.0,
            config: it.1,
            pool: &mut shared.pool,
            has_priorities: self.config.has_priorities,
        });
        read(id, stream, state, &[], reader, is_unblocked)
    }

    pub(super) fn on_reset_stream(&mut self, id: StreamId, code: u64, final_size: u64) -> Result {
        let Some((stream, state)) = self.streams.accept(id, Half::Receive)? else {
            return Ok(());
        };
        match (&mut stream.role, &mut self.http3) {
            (Role::Typed(StreamType::Unknown(_) | StreamType::Ignored), _) => {}
            (Role::Typed(_), _) => return Err(CRITICAL_STREAM_CLOSED),
            (Role::Message(message), Some(http3)) if !stream.flags.contains(Flags::READ_DONE) => {
                message.abandon(id, http3);
            }
            _ => {}
        }
        state.on_reset_stream(id, stream, code, final_size)?;
        self.streams.remove_if_finished(id);
        Ok(())
    }

    pub(super) fn on_stop_sending(&mut self, id: StreamId, code: u64) -> Result {
        match self.streams.accept(id, Half::Send)? {
            Some((stream, _)) if stream.is_internal() => return Err(CRITICAL_STREAM_CLOSED),
            Some((stream, state)) => state.on_stop_sending(id, stream, code),
            None => {}
        }
        Ok(())
    }

    #[inline]
    pub(crate) fn has_events(&self) -> bool {
        self.streams.has_events() || self.ending == Ending::Over
    }

    #[inline]
    pub(crate) fn is_over(&self) -> bool {
        self.ending == Ending::Over
    }

    /// If it returns `None` and the connection is over, that is for good.
    #[inline]
    pub(crate) fn poll_event(
        &mut self,
        now: crate::time::Instant,
        shared: &mut Shared,
    ) -> Option<Event> {
        loop {
            if let Some(event) = self.streams.state.events.pop_front() {
                return Some(self.deliver(event));
            }
            self.release_tls();
            if let Some(id) = self.streams.state.first_readable() {
                match self.poll_readable(id, shared) {
                    Ok(Some(event)) => return Some(event),
                    Ok(None) => {}
                    Err(error) => {
                        self.streams.state.forget_events();
                        self.fail(now, error);
                    }
                }
                continue;
            }
            if self.is_receiving()
                && let Some(event) = self.streams.poll_writable()
            {
                return Some(event);
            }
            if let Some(event) = self.streams.poll_closed() {
                return Some(event);
            }
            if self.ending != Ending::Over || !self.streams.close_all() {
                return None;
            }
        }
    }

    #[inline]
    fn deliver(&mut self, mut event: Event) -> Event {
        match &mut event {
            Event::Stream(id, context, event) if context.is_null() => {
                if let Some(stream) = self.streams.table.get_mut(*id) {
                    *context = stream.context;
                    if matches!(event, StreamEvent::Opened) {
                        stream.flags.insert(Flags::ANNOUNCED);
                    }
                }
            }
            Event::Ready => self.can_open_streams = true,
            Event::Datagram { data, .. } => self.datagrams.on_delivered(data),
            _ => {}
        }
        event
    }

    #[inline]
    fn poll_readable(&mut self, id: StreamId, shared: &mut Shared) -> Result<Option<Event>> {
        let stream = self.streams.table.get_mut(id);
        let state = &mut self.streams.state;
        let stream = match stream {
            Some(it) if !it.flags.intersects(Flags::READ_DONE | Flags::PAUSED) => it,
            stream => {
                state.pop_readable(stream);
                return Ok(None);
            }
        };
        let (context, has_data) = (stream.context, stream.has_ready());
        let mut has_more = false;
        if let Role::Message(message) = &mut stream.role {
            if let Some(fields) = message.take_fields(has_data) {
                state.made_progress = true;
                let has_kept = stream.has_kept();
                if fields.section == Section::Head && self.config.has_priorities {
                    self.apply_request_priority(id);
                }
                if has_kept {
                    self.resume_reading(id, false, shared)?;
                }
                let event = StreamEvent::Headers(fields);
                return Ok(Some(Event::Stream(id, context, event)));
            }
            has_more = message.has_pending_fields();
        }
        let is_last = stream.is_read_to_end() && !has_more;
        if !(has_data && has_more) {
            state.pop_readable(Some(stream));
        }
        if !has_data && !is_last {
            return Ok(None);
        }
        state.made_progress = true;
        let data = stream.take_ready();
        match is_last {
            true => state.finish_reading(id, stream),
            false => state.credit(id, stream),
        }
        let event = StreamEvent::Data { data, is_last };
        Ok(Some(Event::Stream(id, context, event)))
    }
}

/// `data` is what comes next on the stream.
#[inline]
fn read(
    id: StreamId,
    stream: &mut Stream,
    state: &mut State,
    data: &[u8],
    mut reader: Option<Reader>,
    is_unblocked: bool,
) -> Result {
    match try_read(stream, data, &mut reader, is_unblocked) {
        Ok(()) => {
            state.credit(id, stream);
            state.mark_readable(id, stream);
        }
        Err(Fault::Connection(error)) => return Err(error),
        Err(Fault::Stream(code)) => {
            if let (Role::Message(message), Some(reader)) = (&mut stream.role, reader) {
                message.abandon(id, reader.http3);
            }
            state.abort(id, stream, code);
        }
    }
    Ok(())
}

#[inline]
fn try_read(
    stream: &mut Stream,
    data: &[u8],
    reader: &mut Option<Reader>,
    is_unblocked: bool,
) -> Result<(), Fault> {
    let has_data = stream.has_ready();
    if is_unblocked && let (Role::Message(message), Some(reader)) = (&mut stream.role, &mut *reader)
    {
        message.decode_collected(has_data, reader)?;
    }
    let mut takes_more = feed(stream, data, reader)?;
    while takes_more && let Some((known, chunk)) = stream.take_kept() {
        takes_more = feed(stream, chunk.get(known..).unwrap_or_default(), reader)?;
    }
    match (&stream.role, reader) {
        (Role::Message(message), Some(reader)) if stream.is_read_to_end() => {
            message.check_end(reader)
        }
        _ => Ok(()),
    }
}

/// Returns false if some of `data` had to be kept for later.
#[inline]
fn feed(stream: &mut Stream, data: &[u8], reader: &mut Option<Reader>) -> Result<bool, Fault> {
    let len = match (stream.reader(data.len()), reader) {
        ((Role::Message(message), ready), Some(reader)) => message.read(data, ready, reader)?,
        ((_, mut ready), _) => {
            ready.push(data);
            data.len()
        }
    };
    stream.advance(len);
    let rest = data.get(len..).unwrap_or_default();
    if !rest.is_empty() {
        stream.keep(stream.read_offset(), rest)?;
    }
    Ok(rest.is_empty())
}
