//! RFC 9000 §2 to §4.

pub(super) mod assembler;
mod receive;
mod send;
pub(super) mod send_buffer;
mod shares;
mod stream;

use std::collections::VecDeque;

use hashbrown::hash_map::Entry;

pub(crate) use receive::Ready;
use send::Line;
pub(super) use send::WRITE_CHUNK;
use shares::{Allowance, Crumbs};
pub(crate) use stream::{Flags, Role, Stream};

use super::sent::Control;
use crate::config::Config;
use crate::error::{Error, Result, http3_code, transport_code};
use crate::event::{Context, Event, StreamEvent};
use crate::frame::MAX_STREAM_COUNT;
use crate::hash::{IdMap, Seeded};
use crate::http3::{Message, StreamType};
use crate::range_set::RangeSet;
use crate::stream_id::{Direction, Side, StreamId};
use crate::transport_parameters::TransportParameters;

/// A type, a length and a byte.
const MIN_DATA_FRAME_LEN: u64 = 3;
/// Among how many streams with higher IDs one that arrives late looks for its place.
const MAX_OVERTAKING: usize = 64;

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
    /// How many of them the application is not done with.
    unreleased: usize,
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
    /// How many the application is done with.
    remote_released: u64,
    remote_removed: u64,
    /// What the peer has been told.
    remote_limit: u64,
    remote_window: u64,
    /// The initial limits on data.
    local_send: u64,
    local_receive: u64,
    remote_send: u64,
    remote_receive: u64,
}

/// How much has been acknowledged of what was written to a stream, of which the peer has yet to finish its side.
#[derive(Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Asked {
    #[default]
    Nothing,
    InPart,
    /// All of it, which is more of what is [`State::unanswered`].
    Again,
    Anew,
}

/// What the streams share.
#[derive(Default)]
pub(crate) struct State {
    sends_in_order: bool,
    limits_unread_data: bool,
    closes_when_sent: bool,
    /// What it takes to write a byte.
    min_credit: u64,
    pub(crate) events: VecDeque<Event>,
    /// The streams for which there is [`StreamEvent::Closed`] in `events`.
    pub(super) removed: VecDeque<(StreamId, Context)>,
    /// The frames about the connection that have to be sent.
    pub(super) owed: Control,
    /// The application has read or written, or the peer has acknowledged enough of it.
    pub(super) made_progress: bool,
    /// The same for the peer only.
    pub(super) has_delivered: bool,
    /// In bytes. Not enough yet.
    delivered: u16,
    pub(super) asked: Asked,
    /// The stream that asked last, and whether it is finished, until something arrives.
    pub(super) unanswered: Option<(StreamId, bool)>,
    /// Something has arrived without what precedes it.
    pub(super) misses_data: bool,
    /// See [`Self::add_load`].
    pub(super) load: u32,

    received: u64,
    consumed: u64,
    receive_limit: u64,
    receive_window: u64,

    sent: u64,
    unsent: u64,
    /// How many bytes are kept until they are acknowledged.
    retained: u64,
    /// How many have been let go of.
    released: u64,
    pub(super) max_retained: u64,
    send_limit: u64,
    /// The sum over all streams, where those that are reset count in full.
    reached: u64,
    /// The most that the peer has allowed beyond that.
    send_window: u64,
    /// With reading what it has got, as of the last MAX_DATA.
    is_peer_behind: bool,
    /// How much of what was written ahead of an older stream may be unread.
    ahead: u64,
    credit_ahead: u64,
    /// More of it.
    reserve: u64,
    /// False if no stream in `writable` can pass those that have none.
    has_passing: bool,
    /// How many times the peer has shown that it reads that.
    trust: u32,
    blocked_at: Option<u64>,
    pub(super) has_reported_blocked: bool,
    /// How many bytes that have not been sent are worth having.
    pub(super) unsent_target: u64,
    write_round: u64,
    is_write_round_over: bool,
    has_written_in_round: bool,

    sendable: Line,
    turns: u64,
    /// How many bytes have passed the serial streams since one of them had its turn.
    passed: u64,
    lost: VecDeque<StreamId>,
    /// They wait for MAX_DATA.
    stalled: Vec<StreamId>,
    owing: VecDeque<StreamId>,
    readable: VecDeque<StreamId>,
    writable: Line,
    /// The last one that was told to write, and whether that is ahead of an older one.
    invited: Option<(StreamId, bool)>,
    allowance: Allowance,
    crumbs: Crumbs,
    /// What it leaves to those that it has overtaken.
    spare_credit: u64,
    /// The last of them that was the oldest.
    leader: Option<(u64, StreamId)>,
    closing: VecDeque<StreamId>,
}

#[derive(Clone, Copy)]
pub(crate) enum Load {
    Light = 1,
    Heavy = 10,
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
                unreleased: 0,
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
                sends_in_order: config.sends_in_order,
                limits_unread_data: config.limits_unread_data,
                closes_when_sent: config.closes_when_sent,
                min_credit: if is_http3 { MIN_DATA_FRAME_LEN } else { 1 },
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

    /// Returns the value for MAX_STREAMS.
    pub(super) fn raise_remote_limit(&mut self, direction: Direction) -> u64 {
        let is_over = direction == Direction::Bidirectional && self.table.is_going_away;
        let counts = self.table.counts_mut(direction);
        if !is_over {
            counts.remote_limit = counts.next_remote_limit();
        }
        counts.remote_limit
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
        let flags = match table.map.entry(id) {
            Entry::Occupied(entry) if entry.get().is_finished() => entry.remove().flags,
            _ => return,
        };
        if flags.intersects(Flags::IN_WRITABLE | Flags::IN_STALLED) {
            state.writable.retain(|it| it.1 != id);
            state.stalled.retain(|&it| it != id);
        }
        if id.initiator() != table.side {
            let counts = table.counts_mut(id.direction());
            counts.remote_released += u64::from(!flags.contains(Flags::IN_CLOSING));
            counts.remote_removed += 1;
            state.owed |= table.owed_max_streams(id.direction());
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
        let closed = |&(id, context)| Event::Stream(id, context, StreamEvent::Closed);
        self.state.events.extend(open.iter().map(closed));
        self.state.removed.extend(open);
        self.state.writable.clear();
        self.table.unreleased = 0;
        !is_empty
    }

    /// So that what has arrived is delivered before the end.
    pub(super) fn unpause_all(&mut self) {
        for (id, stream) in self.table.iter_mut() {
            if stream.take(Flags::PAUSED) {
                self.state.mark_readable(id, stream);
            }
        }
    }

    #[inline]
    pub(super) fn set_context(&mut self, id: StreamId, context: Context) {
        let slot = match self.table.get_mut(id) {
            Some(stream) => Some(&mut stream.context),
            None => (self.state.removed.iter_mut().find(|it| it.0 == id)).map(|it| &mut it.1),
        };
        if let Some(slot) = slot {
            *slot = context;
        }
    }

    /// For an event from [`State::events`].
    #[inline]
    pub(super) fn deliver(&mut self, id: StreamId, event: &StreamEvent) -> Option<Context> {
        if matches!(event, StreamEvent::Closed) {
            return self.state.removed.pop_front().map(|it| it.1);
        }
        self.table.get_mut(id).map(|stream| {
            stream.flags.insert(Flags::ANNOUNCED);
            stream.context
        })
    }

    pub(super) fn poll_closed(&mut self) -> Option<Event> {
        while let Some(id) = self.state.closing.pop_front()
            && let Some(stream) = self.table.get_mut(id)
        {
            stream.flags.insert(Flags::RELEASED);
            if core::mem::take(&mut stream.held) > 0 {
                self.state.credit(id, stream);
            }
            let (context, is_known) = (stream.context, stream.flags.contains(Flags::ANNOUNCED));
            self.table.unreleased -= 1;
            if id.initiator() != self.table.side {
                self.table.counts_mut(id.direction()).remote_released += 1;
                self.state.owed |= self.table.owed_max_streams(id.direction());
            }
            self.remove_if_finished(id);
            if is_known {
                return Some(Event::Stream(id, context, StreamEvent::Closed));
            }
        }
        None
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
    fn owed_max_streams(&self, direction: Direction) -> Control {
        let counts = self.counts(direction);
        let gain = counts.next_remote_limit() - counts.remote_limit;
        let has_more = counts.remote_next < counts.remote_limit;
        match direction {
            _ if gain == 0 || has_more && gain < counts.remote_window / 8 => Control::empty(),
            Direction::Bidirectional if self.is_going_away => Control::empty(),
            Direction::Bidirectional => Control::MAX_STREAMS_BIDI,
            Direction::Unidirectional => Control::MAX_STREAMS_UNI,
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

    pub(super) fn sorted(
        &mut self,
        is_wanted: impl Fn(StreamId, &Stream) -> bool,
    ) -> Vec<(StreamId, &mut Stream)> {
        let mut streams: Vec<_> = self.iter_mut().filter(|it| is_wanted(it.0, it.1)).collect();
        streams.sort_unstable_by_key(|it| it.0);
        streams
    }

    #[inline]
    pub(super) fn has_application_streams(&self) -> bool {
        self.unreleased > 0
    }

    pub(super) fn len(&self) -> usize {
        self.map.len()
    }

    pub(super) fn has_unfinished_reads(&self) -> bool {
        (self.map.values()).any(|it| {
            !it.flags.intersects(Flags::READ_DONE | Flags::RELEASED) && !it.is_read_to_end()
        })
    }

    /// Whether the peer has yet to learn that a request is not going to be answered.
    pub(super) fn has_unsettled_requests(&self) -> bool {
        !self.bidirectional.remote_skipped.is_empty()
            || (self.map.values()).any(|it| it.has_unacked_reset())
    }

    pub(super) fn has_unacked_data(&self) -> bool {
        self.map.values().any(|stream| stream.has_unacked_data())
    }

    pub(super) fn has_had_no_request(&self) -> bool {
        self.is_http3 && self.bidirectional.local_opened + self.bidirectional.remote_next == 0
    }

    pub(super) fn has_undelivered_application_data(&self) -> bool {
        (self.map.values()).any(|stream| !stream.is_internal() && stream.has_unacked_data())
    }

    pub(super) fn has_unsent_application_data(&self) -> bool {
        let mut streams =
            (self.map.values()).filter(|it| !it.is_internal() && it.has_unacked_data());
        streams
            .any(|it| it.send.unsent_len() > 0 || it.send.first_lost().is_some() || it.owes_fin())
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
        state: &State,
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
        Some((id, self.insert(id, stream, state)))
    }

    fn open_remote(&mut self, id: StreamId, state: &mut State) -> Result {
        let (role, mut flags) = match id.direction() {
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
        state.owed |= self.owed_max_streams(id.direction());
        let is_unwanted = self.is_going_away;
        flags.set(Flags::RELEASED, is_unwanted);
        let counts = self.counts(id.direction());
        let stream = Stream::new(role, flags, counts.remote_send, counts.remote_receive);
        let next = (counts.remote_skipped)
            .gaps(id.index() + 1..counts.remote_next)
            .flatten()
            .take(MAX_OVERTAKING)
            .find_map(|index| self.get(StreamId::new(!self.side, id.direction(), index)));
        let first_turn = next.map_or(state.turns, |it| it.first_turn);
        let stream = self.insert(id, stream, state);
        stream.first_turn = first_turn;
        match stream.role {
            Role::Message(_) | Role::Raw if is_unwanted => state.turn_away(id, stream),
            _ => state.notify(id, stream, StreamEvent::Opened),
        }
        Ok(())
    }

    fn insert(&mut self, id: StreamId, mut stream: Stream, state: &State) -> &mut Stream {
        stream.first_turn = state.turns;
        if stream.is_internal() {
            stream.flags.insert(Flags::RELEASED);
        }
        self.unreleased += usize::from(!stream.flags.contains(Flags::RELEASED));
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

    /// It does not wait for acknowledgments, unless too many are outstanding.
    #[inline]
    fn next_remote_limit(&self) -> u64 {
        let closed = (self.remote_released).min(self.remote_removed + self.remote_window);
        (closed + self.remote_window).min(MAX_STREAM_COUNT)
    }
}

impl State {
    /// For what takes the peer less than it takes us, and does not get the application ahead (RFC 9000 §21.9).
    pub(crate) fn add_load(&mut self, load: Load) {
        self.load = self.load.saturating_add(load as u32);
    }

    /// The context is looked up when the event is delivered.
    #[inline]
    pub(super) fn notify(&mut self, id: StreamId, stream: &Stream, event: StreamEvent) {
        if !(stream.flags).intersects(Flags::RELEASED | Flags::TURNED_AWAY) {
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
            && !(self.closes_when_sent && stream.owes_fin())
            && !stream.flags.contains(Flags::RELEASED)
            && stream.mark(Flags::IN_CLOSING)
        {
            self.closing.push_back(id);
        }
    }

    /// Gives up on both halves of a stream that is being read.
    pub(crate) fn abort(&mut self, id: StreamId, stream: &mut Stream, code: u64) {
        self.notify(id, stream, StreamEvent::Reset(code));
        self.reset(id, stream, code);
        self.stop(id, stream, code);
    }

    /// For a stream of the peer that comes too late. Nothing waits for the answer to be acknowledged.
    pub(super) fn turn_away(&mut self, id: StreamId, stream: &mut Stream) {
        stream.flags.insert(Flags::TURNED_AWAY);
        if let Role::Message(_) = stream.role {
            self.reset(id, stream, http3_code::REQUEST_REJECTED);
            self.stop(id, stream, http3_code::REQUEST_REJECTED);
        } else {
            self.finish(id, stream);
            self.stop(id, stream, 0);
        }
    }
}
