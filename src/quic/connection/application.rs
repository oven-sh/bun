//! What the application does with streams, and what it is told.

use super::streams::{Flags, Half, Load, Role, State, Stream};
use super::{Connection, Ending};
use crate::endpoint::Shared;
use crate::error::{Error, Result, http3_code};
use crate::event::{Context, Event, StreamEvent};
use crate::http3::{Fault, Reader, Section, StreamType, data_frame_header};
use crate::stream_id::{Direction, StreamId};
use crate::time::Instant;

pub(super) const CRITICAL_STREAM_CLOSED: Error = Error::http3(
    http3_code::CLOSED_CRITICAL_STREAM,
    "control or QPACK stream was closed",
);

/// What there is to know about a stream.
pub struct StreamInfo {
    pub has_unacked_data: bool,
    pub has_early_data: bool,
    pub has_received: bool,
    /// As far as is known, the peer has not sent a byte.
    pub is_empty: bool,
    /// The peer cannot send much more.
    pub is_short_of_credit: bool,
}

impl Connection {
    /// The streams of HTTP/3 itself are out of reach.
    #[inline]
    pub(super) fn stream(&mut self, id: StreamId) -> Option<(&mut Stream, &mut State)> {
        let is_open = self.is_receiving();
        (self.streams.get_mut(id)).filter(|it| is_open && !it.0.flags.contains(Flags::RELEASED))
    }

    fn may_open(&self, direction: Direction) -> bool {
        let is_refused = direction == Direction::Bidirectional && self.peer_go_away().is_some();
        self.can_open_streams && self.ending == Ending::No && !is_refused
    }

    pub fn available_streams(&self, direction: Direction) -> u64 {
        match self.may_open(direction) {
            true => self.streams.table.available(direction),
            false => 0,
        }
    }

    pub fn open(&mut self, direction: Direction, context: Context) -> Option<StreamId> {
        if !self.may_open(direction) {
            return None;
        }
        let (id, stream) = (self.streams.table).open(direction, None, &self.streams.state)?;
        stream.context = context;
        Some(id)
    }

    pub fn set_stream_context(&mut self, id: StreamId, context: Context) {
        self.streams.set_context(id, context);
    }

    pub fn stream_info(&self, id: StreamId) -> Option<StreamInfo> {
        self.streams.table.get(id).map(|stream| StreamInfo {
            has_unacked_data: stream.has_unacked_data() || stream.has_unacked_reset(),
            has_early_data: stream.flags.contains(Flags::HAS_EARLY_DATA),
            has_received: stream.has_received(),
            is_empty: stream.is_empty(),
            is_short_of_credit: self.streams.state.is_peer_short_of_credit(stream),
        })
    }

    /// Returns how many bytes it took, or `None` if the stream cannot be written to.
    #[inline]
    pub fn write(&mut self, id: StreamId, data: &[u8]) -> Option<usize> {
        let (stream, state) = self.stream(id)?;
        if stream.flags.contains(Flags::WRITE_DONE) {
            return None;
        }
        state.on_offered(id, stream, data.len() as u64);
        let (capacity, is_ahead) = state.capacity(id, stream, data.len());
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
            if is_ahead {
                state.on_written_ahead((header.len() + taken.len()) as u64);
            }
            state.made_progress = true;
        }
        stream.set_unwritten((data.len() - taken.len()) as u64);
        if taken.len() < data.len() {
            state.want_write(id, stream);
        }
        Some(taken.len())
    }

    pub fn want_write(&mut self, id: StreamId) {
        if let Some((stream, state)) = self.stream(id) {
            state.want_write(id, stream);
        }
    }

    /// The stream keeps its place while the application goes for more to write.
    pub fn await_data(&mut self, id: StreamId, is_awaited: bool) {
        if let Some((stream, state)) = self.stream(id) {
            state.await_data(stream, is_awaited);
        }
    }

    /// Ends the stream after what has been written.
    #[inline]
    pub fn finish(&mut self, id: StreamId) {
        if let Some((stream, state)) = self.stream(id) {
            match &stream.role {
                Role::Message(message) if !message.has_sent_headers => {
                    state.reset(id, stream, http3_code::REQUEST_CANCELLED);
                    if self.side.is_client() {
                        self.stop(id, http3_code::REQUEST_CANCELLED);
                    }
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

    /// Like the streams that the peer opens after [`Self::close`].
    pub fn turn_away(&mut self, id: StreamId) {
        if let Some((stream, state)) = self.streams.get_mut(id) {
            state.turn_away(id, stream);
        }
    }

    /// Gives up on reading.
    pub fn stop(&mut self, id: StreamId, code: u64) {
        if let Some((stream, state)) = self.streams.get_mut(id)
            && !stream.flags.contains(Flags::RELEASED)
        {
            stream.abandon_message(id, self.http3.as_deref_mut());
            state.stop(id, stream, code);
        }
    }

    /// Gives up on writing. The peer need not be told if everything arrives without being sent again.
    pub fn reset_unless_delivered(&mut self, id: StreamId, code: u64) {
        if let Some((stream, state)) = self.stream(id) {
            state.reset_unless_delivered(id, stream, code);
        }
    }

    /// Gives up on writing, unless the end has been written.
    pub fn reset_unfinished(&mut self, id: StreamId, code: u64) {
        if let Some((stream, state)) = self.stream(id)
            && !stream.flags.contains(Flags::WRITE_DONE)
        {
            state.reset(id, stream, code);
        }
    }

    /// See [`Config::awaits_consumption`](crate::Config::awaits_consumption).
    pub fn consume(&mut self, id: StreamId, len: usize) {
        if let Some((stream, state)) = self.stream(id) {
            stream.held = stream.held.saturating_sub(len as u64);
            state.credit(id, stream);
        }
    }

    /// Those that had none at the last call either.
    pub fn stop_streams_without_context(&mut self, code: u64) {
        let mut streams =
            (self.streams.table).sorted(|_, it| it.context.is_null() && !it.is_internal());
        streams.retain_mut(|it| !it.1.mark(Flags::LACKS_CONTEXT));
        for id in Vec::from_iter(streams.into_iter().map(|it| it.0)) {
            self.stop(id, code);
        }
    }

    pub fn set_paused(&mut self, id: StreamId, is_paused: bool) {
        if let Some((stream, state)) = self.stream(id) {
            stream.flags.set(Flags::PAUSED, is_paused);
            state.credit(id, stream);
            state.mark_readable(id, stream);
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
        let http3 = self.http3.as_deref_mut();
        let reader = Reader::new(id, self.side, http3, &self.config, &mut shared.pool);
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
        let http3 = self.http3.as_deref_mut();
        let reader = Reader::new(id, self.side, http3, &self.config, &mut shared.pool);
        (self.streams.get_mut(id)).map_or(Ok(()), |(stream, state)| {
            read(id, stream, state, &[], reader, is_unblocked)
        })
    }

    /// No more requests are allowed after GOAWAY, which limits how many are left to cancel.
    fn counts_cancelled_requests(&self) -> bool {
        self.side.is_server() && !self.streams.table.is_going_away
    }

    pub(super) fn on_reset_stream(&mut self, id: StreamId, code: u64, final_size: u64) -> Result {
        let counts = self.counts_cancelled_requests();
        let Some((stream, state)) = self.streams.accept(id, Half::Receive)? else {
            return Ok(());
        };
        let is_complete = stream.is_read_to_end() && stream.read_offset() == final_size;
        // RFC 9000 §3.5: the peer has to reset a stream that is stopped.
        if counts && is_unanswered(stream) && !stream.flags.contains(Flags::STOPPED) {
            state.add_load(Load::Heavy);
        }
        match &stream.role {
            Role::Message(_) if is_complete && self.side.is_client() => return Ok(()),
            Role::Typed(StreamType::Unknown(_) | StreamType::Ignored) => {}
            Role::Typed(_) => return Err(CRITICAL_STREAM_CLOSED),
            _ => stream.abandon_message(id, self.http3.as_deref_mut()),
        }
        state.on_reset_stream(id, stream, code, final_size)?;
        self.streams.remove_if_finished(id);
        Ok(())
    }

    pub(super) fn on_stop_sending(&mut self, id: StreamId, code: u64) -> Result {
        let counts = self.counts_cancelled_requests();
        match self.streams.accept(id, Half::Send)? {
            Some((stream, _)) if stream.is_internal() => return Err(CRITICAL_STREAM_CLOSED),
            Some((stream, state)) => {
                if counts && is_unanswered(stream) {
                    state.add_load(Load::Heavy);
                }
                let answer = match (&stream.role, code) {
                    // RFC 9114 §4.1.1.
                    (Role::Message(_), http3_code::REQUEST_REJECTED) => {
                        http3_code::REQUEST_CANCELLED
                    }
                    _ => code,
                };
                state.on_stop_sending(id, stream, code, answer);
            }
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
    pub(crate) fn poll_event(&mut self, now: Instant, shared: &mut Shared) -> Option<Event> {
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
                        self.streams.state.forget_readable();
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
                if self.keep_alive != self.config.keep_alive
                    && !self.streams.table.has_application_streams()
                {
                    self.disallow_silence(now);
                }
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
            Event::Stream(id, context, event) => {
                *context = (self.streams.deliver(*id, event)).unwrap_or(core::ptr::null_mut());
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
        let (context, has_data, has_kept) = (stream.context, stream.has_ready(), stream.has_kept());
        let (mut has_more, mut is_cut_off) = (false, false);
        if let Role::Message(message) = &mut stream.role {
            if let Some(fields) = message.take_fields(has_data) {
                state.made_progress = true;
                if message.has_many_interim_responses() {
                    state.add_load(Load::Light);
                }
                if !has_kept {
                    message.interim_responses_in_a_row = 0;
                }
                if fields.section == Section::Head && self.config.has_priorities {
                    self.apply_request_priority(id);
                }
                if has_kept {
                    self.resume_reading(id, false, shared)?;
                }
                let event = StreamEvent::Headers(fields);
                return Ok(Some(Event::Stream(id, context, event)));
            }
            (has_more, is_cut_off) = (message.has_pending_fields(), message.is_cut_off);
        }
        let is_last = (stream.is_read_to_end() || is_cut_off) && !has_more;
        if !(has_data && has_more) {
            state.pop_readable(Some(stream));
        }
        if !has_data && !is_last {
            return Ok(None);
        }
        state.made_progress = true;
        let data = stream.take_ready();
        if self.config.awaits_consumption {
            stream.held += data.len() as u64;
        }
        match is_last {
            true if is_cut_off => {
                stream.abandon_message(id, self.http3.as_deref_mut());
                state.stop(id, stream, http3_code::REQUEST_CANCELLED);
            }
            true => state.finish_reading(id, stream),
            false => state.credit(id, stream),
        }
        let event = StreamEvent::Data { data, is_last };
        Ok(Some(Event::Stream(id, context, event)))
    }
}

fn is_unanswered(stream: &Stream) -> bool {
    matches!(stream.role, Role::Message(_))
        && !stream.flags.contains(Flags::WRITE_DONE)
        && (stream.flags.contains(Flags::STOPPED) || !stream.flags.contains(Flags::RESET_BY_PEER))
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
    let result = try_read(stream, data, &mut reader, is_unblocked);
    if let (Err(Fault::Stream(_)), Role::Message(message), Some(reader)) =
        (&result, &mut stream.role, reader)
    {
        message.abandon(id, false, reader.http3);
    }
    match result {
        Ok(()) => {
            state.credit(id, stream);
            state.mark_readable(id, stream);
        }
        Err(Fault::Connection(error)) => return Err(error),
        Err(Fault::Stream(code)) => {
            state.add_load(Load::Heavy);
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
    let rest = feed(stream, data, reader)?;
    let mut takes_more = rest.is_empty();
    if !takes_more {
        stream.keep(stream.read_offset(), rest);
    }
    while takes_more && let Some((known, chunk)) = stream.take_kept() {
        let offset = stream.read_offset() - known as u64;
        takes_more = feed(stream, chunk.get(known..).unwrap_or_default(), reader)?.is_empty();
        if !takes_more {
            stream.put_back(offset, chunk);
        }
    }
    match (&stream.role, reader) {
        (Role::Message(message), Some(reader)) if stream.is_read_to_end() => {
            message.check_end(reader)
        }
        _ => Ok(()),
    }
}

/// Returns what has to be kept for later.
#[inline]
fn feed<'a>(
    stream: &mut Stream,
    data: &'a [u8],
    reader: &mut Option<Reader>,
) -> Result<&'a [u8], Fault> {
    let len = match (stream.reader(), reader) {
        ((Role::Message(message), ready), Some(reader)) => message.read(data, ready, reader)?,
        ((_, mut ready), _) => {
            ready.push(data);
            data.len()
        }
    };
    stream.advance(len);
    Ok(data.get(len..).unwrap_or_default())
}
