//! RFC 9000 §2 to §4.

pub(super) mod assembler;
mod receive;
mod send;
pub(super) mod send_buffer;
mod stream;

use core::cmp::Reverse;
use std::collections::{BinaryHeap, VecDeque};

pub(crate) use receive::Ready;
pub(super) use send::WRITE_CHUNK;
pub(crate) use stream::{Flags, Role, Stream};

use super::sent::Control;
use crate::config::Config;
use crate::error::{Error, Result, http3_code, transport_code};
use crate::event::{Event, StreamEvent};
use crate::frame::MAX_STREAM_COUNT;
use crate::hash::{IdMap, Seeded};
use crate::http3::{Message, StreamType};
use crate::range_set::RangeSet;
use crate::stream_id::{Direction, Side, StreamId};
use crate::transport_parameters::TransportParameters;

pub(crate) struct Streams {
    pub(crate) table: Table,
    pub(crate) state: State,
    pub(super) has_new_priorities: bool,
}

/// Which streams there are.
pub(crate) struct Table {
    side: Side,
    is_http3: bool,
    /// The streams that the peer opens are turned down.
    pub(crate) is_going_away: bool,
    map: IdMap<StreamId, Box<Stream>>,
    /// How many of them are those of HTTP/3 itself.
    internal: usize,
    bidirectional: Counts,
    unidirectional: Counts,
}

/// For the streams of one direction.
#[derive(Default)]
struct Counts {
    local_opened: u64,
    local_limit: u64,
    /// Follows the highest index that the peer has used.
    remote_next: u64,
    /// What the peer has not used yet below `remote_next`.
    remote_skipped: RangeSet,
    remote_closed: u64,
    remote_limit: u64,
    remote_window: u64,
    /// The initial limits on data.
    local_send: u64,
    local_receive: u64,
    remote_send: u64,
    remote_receive: u64,
}

/// What the streams share.
#[derive(Default)]
pub(crate) struct State {
    has_priorities: bool,
    /// What it takes to write a byte.
    min_credit: u64,
    pub(crate) events: VecDeque<Event>,
    /// The frames about the connection that have to be sent.
    pub(super) owed: Control,
    /// The application has read or written.
    pub(super) made_progress: bool,

    received: u64,
    consumed: u64,
    receive_limit: u64,
    receive_window: u64,

    sent: u64,
    unsent: u64,
    send_limit: u64,
    blocked_at: Option<u64>,
    pub(super) has_reported_blocked: bool,
    /// How many bytes that have not been sent are worth having.
    pub(super) unsent_target: u64,
    write_round: u64,
    is_write_round_over: bool,

    sendable: BinaryHeap<Reverse<(u64, StreamId)>>,
    turns: u64,
    lost: VecDeque<StreamId>,
    /// They wait for MAX_DATA.
    stalled: Vec<StreamId>,
    owing: VecDeque<StreamId>,
    readable: VecDeque<StreamId>,
    writable: VecDeque<StreamId>,
    closing: VecDeque<StreamId>,
}

/// The half of a stream of ours that a frame is about.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Half {
    Send,
    Receive,
}

impl Streams {
    pub(super) fn new(side: Side, local: &TransportParameters, config: &Config, seed: u64) -> Self {
        let is_http3 = config.http3.is_some();
        let counts = |streams, local_receive, remote_receive| Counts {
            remote_limit: streams,
            remote_window: streams,
            local_receive,
            remote_receive,
            ..Counts::default()
        };
        Self {
            table: Table {
                side,
                is_http3,
                is_going_away: false,
                map: IdMap::with_hasher(Seeded(seed)),
                internal: 0,
                bidirectional: counts(
                    local.initial_max_streams_bidi,
                    local.initial_max_stream_data_bidi_local,
                    local.initial_max_stream_data_bidi_remote,
                ),
                unidirectional: counts(
                    local.initial_max_streams_uni,
                    0,
                    local.initial_max_stream_data_uni,
                ),
            },
            state: State {
                has_priorities: config.has_priorities,
                min_credit: if is_http3 { 3 } else { 1 },
                write_round: 1,
                receive_limit: local.initial_max_data,
                receive_window: local.initial_max_data,
                ..State::default()
            },
            has_new_priorities: false,
        }
    }

    /// If there were parameters for early data, these are not less.
    pub(super) fn set_peer_parameters(&mut self, peer: &TransportParameters) {
        let Self { table, state, .. } = self;
        table.bidirectional.local_send = peer.initial_max_stream_data_bidi_remote;
        table.bidirectional.remote_send = peer.initial_max_stream_data_bidi_local;
        table.unidirectional.local_send = peer.initial_max_stream_data_uni;
        table.bidirectional.local_limit = peer.initial_max_streams_bidi;
        table.unidirectional.local_limit = peer.initial_max_streams_uni;
        for (&id, stream) in &mut table.map {
            let limit = match id.direction() {
                Direction::Bidirectional => table.bidirectional.local_send,
                Direction::Unidirectional => table.unidirectional.local_send,
            };
            state.raise_send_limit(id, stream, limit);
        }
        self.on_max_data(peer.initial_max_data);
    }

    pub(super) fn on_max_streams(&mut self, direction: Direction, limit: u64) {
        let counts = self.table.counts_mut(direction);
        if limit > counts.local_limit {
            if counts.local_opened == counts.local_limit {
                (self.state.events).push_back(Event::StreamsAvailable(direction));
            }
            counts.local_limit = limit;
        }
    }

    /// The value for MAX_STREAMS.
    pub(super) fn remote_limit(&self, direction: Direction) -> u64 {
        self.table.counts(direction).remote_limit
    }

    /// Looks up the stream that a frame names, and opens it if need be. `None` if it is closed.
    #[inline]
    pub(super) fn accept(
        &mut self,
        id: StreamId,
        half: Half,
    ) -> Result<Option<(&mut Stream, &mut State)>> {
        let Self { table, state, .. } = self;
        let is_local = id.initiator() == table.side;
        if id.direction() == Direction::Unidirectional && is_local != (half == Half::Send) {
            return Err(Error::transport(
                transport_code::STREAM_STATE_ERROR,
                "frame for the other direction of a unidirectional stream",
            ));
        }
        if is_local {
            if id.index() >= table.counts(id.direction()).local_opened {
                return Err(Error::transport(
                    transport_code::STREAM_STATE_ERROR,
                    "frame for a stream that has not been opened",
                ));
            }
        } else if table.counts_mut(id.direction()).use_remote(id.index())? {
            table.open_remote(id, state)?;
        }
        Ok(table.get_mut(id).map(|stream| (stream, state)))
    }

    #[inline]
    pub(crate) fn get_mut(&mut self, id: StreamId) -> Option<(&mut Stream, &mut State)> {
        let Self { table, state, .. } = self;
        table.get_mut(id).map(|stream| (stream, state))
    }

    #[inline]
    pub(super) fn remove_if_finished(&mut self, id: StreamId) {
        let Self { table, state, .. } = self;
        let hashbrown::hash_map::Entry::Occupied(entry) = table.map.entry(id) else {
            return;
        };
        if !entry.get().is_finished() {
            return;
        }
        let stream = entry.remove();
        table.internal -= usize::from(stream.is_internal());
        if id.initiator() != table.side && table.counts_mut(id.direction()).close_remote() {
            state.owed |= match id.direction() {
                Direction::Bidirectional => Control::MAX_STREAMS_BIDI,
                Direction::Unidirectional => Control::MAX_STREAMS_UNI,
            };
        }
    }

    /// Removes all streams. The application is told in the order of their IDs. Returns whether there were any.
    pub(super) fn close_all(&mut self) -> bool {
        let is_empty = self.table.map.is_empty();
        let mut open: Vec<_> = (self.table.map.drain())
            .filter(|(_, it)| it.flags & (Flags::ANNOUNCED | Flags::RELEASED) == Flags::ANNOUNCED)
            .map(|(id, stream)| (id, stream.context))
            .collect();
        open.sort_unstable_by_key(|it| it.0);
        let closed = |(id, context)| Event::Stream(id, context, StreamEvent::Closed);
        self.state.events.extend(open.into_iter().map(closed));
        self.state.writable.clear();
        self.table.internal = 0;
        !is_empty
    }

    pub(super) fn poll_closed(&mut self) -> Option<Event> {
        loop {
            let id = self.state.closing.pop_front()?;
            if let Some(stream) = self.table.get_mut(id) {
                stream.flags.insert(Flags::RELEASED);
                let (context, is_known) = (stream.context, stream.flags.contains(Flags::ANNOUNCED));
                self.remove_if_finished(id);
                if is_known {
                    return Some(Event::Stream(id, context, StreamEvent::Closed));
                }
            }
        }
    }

    pub(super) fn has_events(&self) -> bool {
        let state = &self.state;
        !state.events.is_empty()
            || !state.readable.is_empty()
            || !state.closing.is_empty()
            || state.awaits_writes()
    }
}

impl Table {
    #[inline]
    fn counts(&self, direction: Direction) -> &Counts {
        match direction {
            Direction::Bidirectional => &self.bidirectional,
            Direction::Unidirectional => &self.unidirectional,
        }
    }

    #[inline]
    fn counts_mut(&mut self, direction: Direction) -> &mut Counts {
        match direction {
            Direction::Bidirectional => &mut self.bidirectional,
            Direction::Unidirectional => &mut self.unidirectional,
        }
    }

    #[inline]
    pub(crate) fn get(&self, id: StreamId) -> Option<&Stream> {
        self.map.get(&id).map(|stream| &**stream)
    }

    #[inline]
    pub(crate) fn get_mut(&mut self, id: StreamId) -> Option<&mut Stream> {
        self.map.get_mut(&id).map(|stream| &mut **stream)
    }

    pub(crate) fn iter_mut(&mut self) -> impl Iterator<Item = (StreamId, &mut Stream)> {
        self.map.iter_mut().map(|(&id, stream)| (id, &mut **stream))
    }

    /// Whether there are streams other than those of HTTP/3 itself.
    #[inline]
    pub(super) fn has_application_streams(&self) -> bool {
        self.map.len() > self.internal
    }

    pub(super) fn has_unacked_data(&self) -> bool {
        self.map.values().any(|stream| stream.has_unacked_data())
    }

    /// How many streams can be opened.
    pub(crate) fn available(&self, direction: Direction) -> u64 {
        let counts = self.counts(direction);
        counts.local_limit.saturating_sub(counts.local_opened)
    }

    /// The first ID that the peer has not got to.
    pub(crate) fn next_remote(&self, direction: Direction) -> StreamId {
        StreamId::new(!self.side, direction, self.counts(direction).remote_next)
    }

    /// Whether the peer can still open a stream, which is within the limit if this succeeds.
    pub(crate) fn is_unused(&self, id: StreamId) -> Option<bool> {
        let (counts, index) = (self.counts(id.direction()), id.index());
        (index < counts.remote_limit)
            .then(|| index >= counts.remote_next || counts.remote_skipped.contains(index))
    }

    fn application_role(&self, direction: Direction) -> Role {
        match direction {
            Direction::Bidirectional if self.is_http3 => Role::Message(Message::default()),
            _ => Role::Raw,
        }
    }

    /// `kind` is for the streams of HTTP/3 itself.
    pub(crate) fn open(
        &mut self,
        direction: Direction,
        kind: Option<StreamType>,
    ) -> Option<(StreamId, &mut Stream)> {
        let role = kind.map_or_else(|| self.application_role(direction), Role::Typed);
        let side = self.side;
        let counts = self.counts_mut(direction);
        if counts.local_opened >= counts.local_limit {
            return None;
        }
        let id = StreamId::new(side, direction, counts.local_opened);
        counts.local_opened += 1;
        let (send, receive) = (counts.local_send, counts.local_receive);
        let mut stream = Stream::new(role, Flags::ANNOUNCED, send, receive);
        if direction == Direction::Unidirectional {
            stream.flags.insert(Flags::READ_DONE);
            stream.final_size = 0;
        }
        Some((id, self.insert(id, stream)))
    }

    fn open_remote(&mut self, id: StreamId, state: &mut State) -> Result {
        let (role, flags) = match id.direction() {
            Direction::Bidirectional if self.is_http3 && self.side.is_client() => {
                return Err(Error::http3(
                    http3_code::STREAM_CREATION_ERROR,
                    "server opened a bidirectional stream",
                ));
            }
            Direction::Bidirectional => (self.application_role(id.direction()), Flags::empty()),
            Direction::Unidirectional => (
                match self.is_http3 {
                    true => Role::Typed(StreamType::default()),
                    false => Role::Raw,
                },
                Flags::WRITE_DONE | Flags::SEND_DONE,
            ),
        };
        let rejection = self.is_going_away.then_some(match self.is_http3 {
            true => http3_code::REQUEST_REJECTED,
            false => 0,
        });
        let counts = self.counts(id.direction());
        let stream = Stream::new(role, flags, counts.remote_send, counts.remote_receive);
        let stream = self.insert(id, stream);
        if stream.is_internal() {
            return Ok(());
        }
        match rejection {
            Some(code) => {
                stream.flags.insert(Flags::RELEASED);
                state.abort(id, stream, code);
            }
            None => state.notify(id, stream, StreamEvent::Opened),
        }
        Ok(())
    }

    fn insert(&mut self, id: StreamId, mut stream: Stream) -> &mut Stream {
        if stream.is_internal() {
            self.internal += 1;
            stream.flags.insert(Flags::RELEASED);
        }
        self.map.entry(id).insert(Box::new(stream)).into_mut()
    }
}

impl Counts {
    /// Returns whether this is the first time.
    #[inline]
    fn use_remote(&mut self, index: u64) -> Result<bool> {
        if index < self.remote_next {
            let is_first = self.remote_skipped.contains(index);
            if is_first {
                self.remote_skipped.remove(index..index + 1);
            }
            return Ok(is_first);
        }
        if index >= self.remote_limit {
            return Err(Error::transport(
                transport_code::STREAM_LIMIT_ERROR,
                "too many streams",
            ));
        }
        self.remote_skipped.insert(self.remote_next..index);
        self.remote_next = index + 1;
        Ok(true)
    }

    /// Returns whether the limit was raised.
    fn close_remote(&mut self) -> bool {
        self.remote_closed += 1;
        let limit = (self.remote_closed + self.remote_window).min(MAX_STREAM_COUNT);
        let is_due = limit - self.remote_limit >= (self.remote_window / 8).max(1);
        if is_due {
            self.remote_limit = limit;
        }
        is_due
    }
}

impl State {
    /// The context is looked up when the event is delivered.
    #[inline]
    pub(super) fn notify(&mut self, id: StreamId, stream: &Stream, event: StreamEvent) {
        if !stream.flags.contains(Flags::RELEASED) {
            (self.events).push_back(Event::Stream(id, stream.context, event));
        }
    }

    #[inline]
    fn owe(&mut self, id: StreamId, stream: &mut Stream, frame: Flags) {
        stream.flags.insert(frame);
        if stream.mark(Flags::IN_OWING) {
            self.owing.push_back(id);
        }
    }

    #[inline]
    fn close_if_done(&mut self, id: StreamId, stream: &mut Stream) {
        if stream.flags.contains(Flags::READ_DONE | Flags::WRITE_DONE)
            && !stream.flags.contains(Flags::RELEASED)
            && stream.mark(Flags::IN_CLOSING)
        {
            self.closing.push_back(id);
        }
    }

    /// Gives up on both halves of a stream.
    pub(crate) fn abort(&mut self, id: StreamId, stream: &mut Stream, code: u64) {
        if !stream.flags.contains(Flags::READ_DONE) {
            self.notify(id, stream, StreamEvent::Reset(code));
        }
        self.reset(id, stream, code);
        self.stop(id, stream, code);
    }
}
