use core::ops::Range;
use std::collections::VecDeque;

use super::stream::UNKNOWN_SIZE;
use super::{Flags, State, Stream, Streams, Table};
use crate::coding::{MAX_VARINT, Write, varint_len};
use crate::connection::sent::{Control, Frames, SentFrame};
use crate::event::{Event, StreamEvent};
use crate::frame::{kind, stream_flag};
use crate::stream_id::StreamId;
use crate::time::Instant;

/// What a stream can take however much the others have, unless it has more than that and has to wait for its share.
pub(super) const MIN_UNSENT: u64 = 8 * 1024;
/// By how much what is unsent has to be below the target for the application to be asked for more.
pub(in crate::connection) const WRITE_CHUNK: u64 = 32 * 1024;
const TURN_LEN: u64 = 16 * 1024;
/// By how many turns a stream gives way that sends this much in one go, and has more than a little to send.
const BULK_HANDICAP: u64 = 8;
pub(super) const BULK_LEN: u64 = 128 * 1024;
pub(super) const LITTLE: u64 = 2 * 1024;
/// After how much a response that is not incremental shares the path all the same (RFC 9218 §10).
const LONG_LEN: u64 = 1024 * 1024;
/// A rank is made of the urgency, this bit, the turn, and whether the stream takes turns. Those that have the bit go one
/// after the other, and the first of them alternates with those that have not.
const SERIAL: u64 = 1 << 59;
const TURN_BITS: u64 = SERIAL - 2;
/// A peer that reads one stream after the other only raises its limit for what the oldest one sends (RFC 9308 §4.4). The
/// others get a sixteenth of its window, which doubles up to so many times, and so many while the oldest one is blocked.
const MAX_TRUST: u32 = 2;
const MAX_SHARE_AHEAD: u64 = 7;
/// A type and three integers.
const MAX_OWED_FRAME_LEN: usize = 25;

/// Streams by rank.
pub(super) type Line = VecDeque<(u64, StreamId)>;

#[inline]
fn line_up(line: &mut Line, entry: (u64, StreamId)) {
    match line.back() {
        Some(last) if *last > entry => line.insert(line.partition_point(|it| *it < entry), entry),
        _ => line.push_back(entry),
    }
}

/// Of those that are as urgent as the first stream, unless it is sent in order and younger.
pub(super) fn first_serial(line: &Line) -> Option<usize> {
    let first = line.front().map(|&(rank, id)| (rank | SERIAL, id))?;
    let at = line.partition_point(|it| it.0 / SERIAL < first.0 / SERIAL);
    let takes_turns = |rank| rank & 1 == 1 && rank / SERIAL == first.0 / SERIAL;
    (line.get(at).filter(|it| **it <= first || takes_turns(it.0))).map(|_| at)
}

/// Less is older, or more urgent. Streams that take turns have none.
#[inline]
fn age((rank, id): (u64, StreamId)) -> Option<(u64, StreamId)> {
    (rank & 1 == 0).then_some((rank & !SERIAL, id))
}

/// Whether it is going to need credit before long.
fn is_under_way(stream: &Stream) -> bool {
    let beyond_limit = stream.send.end().saturating_sub(stream.send_limit);
    !stream.flags.contains(Flags::WRITE_DONE)
        && match stream.is_blocked() {
            true => stream.send.len() > beyond_limit,
            false => stream.send.unsent_len() > LITTLE || stream.flags.contains(Flags::AWAITS_DATA),
        }
}

impl Stream {
    /// How many bytes the application is left with.
    #[inline]
    pub(crate) fn set_unwritten(&mut self, len: u64) {
        self.unwritten = len;
        let (has_much, end) = (len >= WRITE_CHUNK, self.send.end() + len);
        self.flags.set(Flags::HAS_MUCH_TO_WRITE, has_much);
        (self.flags).set(Flags::WILL_BE_LONG, has_much && end > LONG_LEN);
    }
}

impl State {
    /// How many bytes the application may write if it has `len`, and whether they are ahead of an older stream.
    #[inline]
    pub(crate) fn capacity(&self, id: StreamId, stream: &Stream, len: usize) -> (u64, bool) {
        let mut room =
            (self.max_retained.saturating_sub(self.retained)).min(self.credit_for(stream));
        if !self.sends_in_order {
            return (self.wanted_from(id, stream, len as u64).min(room), false);
        }
        let (has_to_wait, is_ahead) = match self.invited {
            Some((invited, is_ahead)) if invited == id => {
                room = room.min(self.send_credit().saturating_sub(self.spare_credit));
                (false, is_ahead)
            }
            _ if self.writable.is_empty() && self.leader.is_none() => (false, false),
            _ => {
                let entry = (self.rank(stream), id);
                let has_to_wait = self.writable.front().is_some_and(|it| *it < entry);
                let follows = |age| has_to_wait || self.leader.is_some_and(|it| it < age);
                (has_to_wait, age(entry).is_some_and(follows))
            }
        };
        if is_ahead {
            room =
                room.min(self.credit_ahead + self.reserve_for(stream, len as u64 >= WRITE_CHUNK));
        }
        let shared = match has_to_wait {
            true => 0,
            false => self.unsent_target.saturating_sub(self.unsent),
        };
        let wanted = shared.max(MIN_UNSENT.saturating_sub(stream.send.unsent_len()));
        (wanted.min(room), is_ahead)
    }

    /// So that streams that the peer does not read cannot hold up short ones.
    fn reserve_for(&self, stream: &Stream, has_much: bool) -> u64 {
        let part = self.send_window / 32;
        match has_much {
            true => (self.reserve.saturating_sub(part))
                .min((part / 2).saturating_sub(stream.send.end())),
            false => self.reserve,
        }
    }

    /// Whether it can do without `credit_ahead`.
    fn can_pass(&self, entry: (u64, StreamId), stream: &Stream) -> bool {
        let has_much = stream.flags.contains(Flags::HAS_MUCH_TO_WRITE);
        age(entry).is_none() || self.reserve_for(stream, has_much) >= self.min_credit
    }

    fn max_ahead(&self) -> u64 {
        (self.send_window / 16) << self.trust
    }

    /// At most, and apart from what the leader has on its way.
    fn unread(&self, on_its_way: u64) -> u64 {
        (self.send_window).saturating_sub(self.send_credit() + on_its_way)
    }

    fn update_credit_ahead(&mut self, leader: Option<&Stream>) {
        self.credit_ahead = match leader.filter(|it| it.is_blocked()) {
            Some(leader) => {
                self.reserve = self.reserve.min(self.send_window / 32);
                (self.send_window / 16 * MAX_SHARE_AHEAD)
                    .saturating_sub(self.unread(leader.send.len()))
            }
            None => self.max_ahead().saturating_sub(self.ahead),
        };
    }

    pub(crate) fn on_written_ahead(&mut self, len: u64) {
        self.ahead += len;
        self.reserve -= len.saturating_sub(self.credit_ahead);
        self.credit_ahead = self.credit_ahead.saturating_sub(len);
    }

    /// How many bytes flow control would let through.
    #[inline]
    pub(crate) fn credit_for(&self, stream: &Stream) -> u64 {
        stream.send_credit().min(self.send_credit())
    }

    #[inline]
    fn send_credit(&self) -> u64 {
        self.send_limit.saturating_sub(self.sent + self.unsent)
    }

    #[inline]
    pub(crate) fn unsent(&self) -> u64 {
        self.unsent
    }

    #[inline]
    pub(super) fn has_little_unsent(&self) -> bool {
        self.unsent + WRITE_CHUNK <= self.unsent_target
    }

    #[inline]
    fn invites_writes(&self) -> bool {
        (self.has_little_unsent() || self.may_starve_any())
            && self.retained + WRITE_CHUNK <= self.max_retained
            && self.send_credit() >= self.min_credit
    }

    #[inline]
    pub(crate) fn awaits_writes(&self) -> bool {
        !self.writable.is_empty() && !self.is_write_round_over && self.invites_writes()
    }

    #[inline]
    pub(crate) fn start_write_round(&mut self, now: Instant) {
        self.renew_crumbs(now);
        self.write_round += 1;
        self.is_write_round_over = false;
    }

    /// Whatever the limits are.
    #[inline]
    pub(crate) fn write(&mut self, id: StreamId, stream: &mut Stream, parts: &[&[u8]]) {
        for part in parts {
            stream.send.write(part);
            self.unsent += part.len() as u64;
            self.retained += part.len() as u64;
            stream.share = stream.share.saturating_sub(part.len() as u64);
        }
        self.mark_sendable(id, stream);
    }

    pub(crate) fn finish(&mut self, id: StreamId, stream: &mut Stream) {
        if stream.mark(Flags::WRITE_DONE) {
            if !self.sends_in_order {
                stream.first_turn = self.turns + stream.send.unsent_len() / (TURN_LEN / 2);
            }
            stream.flags.insert(Flags::FIN);
            self.mark_sendable(id, stream);
            self.close_if_done(id, stream);
        }
    }

    /// Unless the peer has got everything.
    pub(crate) fn reset(&mut self, id: StreamId, stream: &mut Stream, code: u64) {
        if !stream.flags.intersects(Flags::RESET | Flags::SEND_DONE) {
            self.discard(stream);
            stream.reset_code = code.min(MAX_VARINT);
            stream.flags.insert(Flags::RESET);
            self.owe(id, stream, Flags::OWES_RESET_STREAM);
        }
        stream.flags.insert(Flags::WRITE_DONE);
        self.close_if_done(id, stream);
    }

    fn discard(&mut self, stream: &mut Stream) {
        self.unsent -= stream.send.unsent_len();
        self.release(stream.send.len());
        self.reached += stream.send.sent() - stream.send.reached();
        stream.send.discard();
    }

    #[inline]
    fn release(&mut self, len: u64) {
        self.retained -= len;
        self.released += len;
    }

    /// How many bytes have been let go of, and how many of those that have been sent have not.
    pub(crate) fn delivery(&self) -> (u64, u64) {
        (self.released, self.retained - self.unsent)
    }

    /// `answer` is the code to reset the stream with (RFC 9000 §3.5).
    pub(crate) fn on_stop_sending(
        &mut self,
        id: StreamId,
        stream: &mut Stream,
        code: u64,
        answer: u64,
    ) {
        if stream.mark(Flags::STOPPED_BY_PEER) {
            self.notify(id, stream, StreamEvent::Stopped(code));
            match stream.flags.contains(Flags::FIN_SENT) && stream.send.first_lost().is_none() {
                true => stream.deferred_reset_code = answer,
                false => self.reset(id, stream, answer),
            }
        }
    }

    pub(crate) fn raise_send_limit(&mut self, id: StreamId, stream: &mut Stream, limit: u64) {
        if limit > stream.send_limit {
            let room = limit.saturating_sub(stream.send.reached());
            stream.send_window = stream.send_window.max(room);
            stream.send_limit = limit;
            stream.flags.remove(Flags::OWES_STREAM_DATA_BLOCKED);
            if stream.send.unsent_len() > 0 {
                self.mark_sendable(id, stream);
            }
            if stream.flags.contains(Flags::WANTS_WRITE) {
                self.want_write(id, stream);
            }
        }
    }

    pub(crate) fn await_data(&mut self, stream: &mut Stream, is_awaited: bool) {
        stream.flags.set(Flags::AWAITS_DATA, is_awaited);
        self.is_write_round_over = false;
    }

    pub(crate) fn want_write(&mut self, id: StreamId, stream: &mut Stream) {
        if stream.flags.contains(Flags::WRITE_DONE) {
            return;
        }
        stream.flags.insert(Flags::WANTS_WRITE);
        self.report_blocked(id, stream);
        if stream.mark(Flags::IN_WRITABLE) {
            self.turns += 1;
            let rank = match self.sends_in_order {
                true => self.rank(stream),
                false => self.start_waiting(stream),
            };
            line_up(&mut self.writable, (rank, id));
            self.is_write_round_over = false;
            self.has_passing |= self.can_pass((rank, id), stream);
        }
    }

    /// For a stream that has more to send than flow control allows (RFC 9000 §4.1).
    pub(crate) fn report_blocked(&mut self, id: StreamId, stream: &mut Stream) {
        let needed = self.min_credit;
        if stream.send_credit() < needed && stream.blocked_at != Some(stream.send_limit) {
            stream.blocked_at = Some(stream.send_limit);
            self.owe(id, stream, Flags::OWES_STREAM_DATA_BLOCKED);
        }
        if self.send_credit() < needed && self.blocked_at != Some(self.send_limit) {
            self.blocked_at = Some(self.send_limit);
            self.owed |= Control::DATA_BLOCKED;
        }
    }

    /// The value for DATA_BLOCKED, if it still holds.
    pub(crate) fn blocked_at(&mut self) -> Option<u64> {
        let is_awaited = !self.writable.is_empty() || !self.stalled.is_empty();
        (self.blocked_at).take_if(|&mut limit| limit != self.send_limit || !is_awaited);
        self.blocked_at
    }

    /// Less goes first.
    #[inline]
    fn rank(&self, stream: &Stream) -> u64 {
        if stream.is_internal() {
            return 0;
        }
        let is_past = |len| stream.send.sent() >= len && stream.send.unsent_len() > LITTLE;
        let takes_turns = !self.sends_in_order || stream.priority.is_incremental;
        let is_ending = !stream.priority.is_incremental
            && stream.flags.contains(Flags::FIN)
            && stream.send.sent() > 0;
        let is_serial = match takes_turns {
            true => is_ending && is_past(0),
            false => is_past(LONG_LEN) || stream.flags.contains(Flags::WILL_BE_LONG),
        };
        let turn = match (takes_turns, is_ending) {
            (true, false) => {
                let to_come = u64::from(!self.sends_in_order) * stream.unwritten;
                let bulk_from = BULK_LEN.saturating_sub(to_come).max(MIN_UNSENT / 2);
                self.turns + u64::from(is_past(stream.busy_from + bulk_from)) * BULK_HANDICAP
            }
            (true, true) if !is_serial => 0,
            _ => stream.first_turn,
        };
        let class = 2 * (u64::from(stream.priority.urgency) + 1) + u64::from(is_serial);
        (class * SERIAL) | turn << 1 & TURN_BITS | u64::from(takes_turns)
    }

    /// Where it is in `sendable`.
    #[inline]
    fn next_to_send(&self) -> usize {
        let gives_way = |it: &(u64, StreamId)| (it.0 & TURN_BITS) >> 1 > self.turns;
        match self.passed >= TURN_LEN
            || !self.sends_in_order && self.sendable.front().is_some_and(gives_way)
        {
            true => first_serial(&self.sendable).unwrap_or(0),
            false => 0,
        }
    }

    /// Where it is in `writable`, and whether it is ahead of an older stream.
    #[inline]
    fn next_to_write(&mut self, table: &Table) -> (Option<usize>, bool) {
        if !self.sends_in_order {
            return (self.next_writer(table), false);
        }
        let leader = (self.leader).filter(|it| table.get(it.1).is_some_and(is_under_way));
        self.update_credit_ahead(leader.and_then(|it| table.get(it.1)));
        let line = &self.writable;
        let is_due = |it: &(u64, StreamId), max_unsent| {
            table.get(it.1).is_some_and(|it| {
                it.write_round != self.write_round && it.send.unsent_len() <= max_unsent
            })
        };
        let serial = first_serial(line);
        let alternates = (self.sendable.front()).is_some_and(|it| it.0 & SERIAL == 0);
        let max_unsent = u64::from(alternates) * WRITE_CHUNK;
        let mut at = serial
            .filter(|&at| line.get(at).is_some_and(|it| is_due(it, max_unsent)))
            .or_else(|| line.iter().position(|it| is_due(it, u64::MAX)));
        self.spare_credit = match self.send_credit() {
            credit @ LITTLE.. if at == serial && at > Some(0) => credit / 2,
            _ => 0,
        };
        let age_at = |at: Option<usize>| age(*at.and_then(|at| line.get(at))?);
        let oldest = [leader, age_at(Some(0)), age_at(serial)];
        let oldest = oldest.into_iter().flatten().min();
        let is_ahead = |at| age_at(at).is_some_and(|it| oldest < Some(it));
        if is_ahead(at) && self.credit_ahead < self.min_credit {
            let can_pass = |it: &(u64, StreamId)| {
                (table.get(it.1)).is_some_and(|stream| self.can_pass(*it, stream))
            };
            let passing = (line.iter().take_while(|_| self.has_passing)).position(can_pass);
            (self.has_passing, self.spare_credit) = (passing.is_some(), 0);
            let urgency = |at| line.get(at).map(|it| it.0 / (2 * SERIAL));
            at = ([passing, serial].into_iter().flatten())
                .filter(|&at| Some(at) == passing || age_at(Some(at)) == oldest)
                .filter(|&at| line.get(at).is_some_and(|it| is_due(it, u64::MAX)))
                .min_by_key(|&at| urgency(at));
        }
        let is_ahead = is_ahead(at);
        self.leader = age_at(at).filter(|_| !is_ahead).or(leader);
        (at, is_ahead)
    }

    #[inline]
    fn mark_sendable(&mut self, id: StreamId, stream: &mut Stream) {
        if stream.mark(Flags::IN_SENDABLE) {
            self.turns += 1;
            stream.turn_end = stream.send.sent() + TURN_LEN;
            let turn = TURN_BITS * u64::from(self.has_crumb(id, stream));
            let rank = self.rank(stream) & !turn;
            line_up(&mut self.sendable, (rank, id));
        }
    }

    /// Whether there is something that other streams may depend on.
    pub(crate) fn has_urgent_frames(&self) -> bool {
        !self.lost.is_empty() || self.sendable.front().is_some_and(|it| it.0 == 0)
    }

    #[inline]
    pub(crate) fn has_frames(&self) -> bool {
        !(self.sendable.is_empty() && self.lost.is_empty() && self.owing.is_empty())
    }
}

impl Streams {
    pub(crate) fn on_max_data(&mut self, limit: u64) {
        let Self { table, state, .. } = self;
        if limit > state.send_limit {
            state.send_limit = limit;
            state.send_window = state.send_window.max(limit - state.reached);
            state.is_peer_behind = limit - state.reached < state.send_window / 4 * 3;
            let leader = state.leader.and_then(|it| table.get(it.1));
            let unread = state.unread(leader.map_or(0, |it| it.send.end() - it.send.reached()));
            let part = state.send_window / 32;
            state.reserve = (part * (2 * MAX_SHARE_AHEAD + 1))
                .saturating_sub(unread)
                .min(2 * part);
            state.has_passing = true;
            let read = state.ahead.saturating_sub(unread);
            state.ahead -= read;
            if read > state.max_ahead() / 2 {
                state.trust = MAX_TRUST.min(state.trust + 1);
            }
            state.update_credit_ahead(leader);
            for id in core::mem::take(&mut state.stalled) {
                crate::with(table.get_mut(id), |stream| {
                    stream.flags.remove(Flags::IN_STALLED);
                    state.mark_sendable(id, stream);
                });
            }
        }
    }

    #[cold]
    fn apply_priorities(&mut self) {
        let Self { table, state, .. } = self;
        let mut lines = [&mut state.sendable, &mut state.writable].map(core::mem::take);
        for line in lines.iter_mut().take(1 + usize::from(state.sends_in_order)) {
            for (rank, id) in &mut *line {
                let new = table.get(*id).map(|it| state.rank(it));
                *rank = new
                    .filter(|it| (it ^ *rank) & !TURN_BITS != 0)
                    .unwrap_or(*rank);
            }
            line.make_contiguous().sort_unstable();
        }
        [state.sendable, state.writable] = lines;
        (state.leader, state.has_passing) = (None, true);
    }

    /// A stream has at most one turn until [`State::start_write_round`].
    #[inline]
    pub(crate) fn poll_writable(&mut self) -> Option<Event> {
        if core::mem::take(&mut self.has_new_priorities) {
            self.apply_priorities();
        }
        let Self { table, state, .. } = self;
        while state.awaits_writes() {
            let (at, is_ahead) = state.next_to_write(table);
            let id = at.and_then(|at| state.writable.remove(at)).map(|it| it.1);
            let Some((id, stream)) = id.and_then(|id| table.get_mut(id).map(|it| (id, it))) else {
                state.is_write_round_over = true;
                return None;
            };
            stream.flags.remove(Flags::IN_WRITABLE);
            if stream.flags.contains(Flags::WRITE_DONE) {
                continue;
            }
            if stream.send_credit() < state.min_credit {
                state.report_blocked(id, stream);
                continue;
            }
            stream.flags.remove(Flags::WANTS_WRITE);
            state.invited = Some((id, is_ahead));
            if !state.has_crumb(id, stream) {
                stream.write_round = state.write_round;
            }
            return Some(Event::Stream(id, stream.context, StreamEvent::Writable));
        }
        None
    }

    /// Says again what keeps us from sending.
    pub(crate) fn repeat_blocked(&mut self) {
        let Self { table, state, .. } = self;
        if state.blocked_at().is_some() {
            state.owed |= Control::DATA_BLOCKED;
        } else if let Some((id, stream)) = table.iter_mut().find(|it| it.1.is_blocked()) {
            state.owe(id, stream, Flags::OWES_STREAM_DATA_BLOCKED);
        }
    }

    /// Writes frames that end before `out` has the length `end`.
    #[inline]
    pub(crate) fn write_owed_frames(&mut self, out: &mut Vec<u8>, end: usize, sent: &mut Frames) {
        while let Some(&id) = self.state.owing.front() {
            if let Some(stream) = self.table.get_mut(id) {
                let is_blocked = stream.flags.contains(Flags::OWES_STREAM_DATA_BLOCKED);
                self.state.has_reported_blocked |= is_blocked;
                if !write_owed_frames(id, stream, out, end, sent) {
                    return;
                }
                stream.flags.remove(Flags::IN_OWING);
            }
            self.state.owing.pop_front();
        }
    }

    #[inline]
    pub(crate) fn write_stream_frames(&mut self, out: &mut Vec<u8>, end: usize, sent: &mut Frames) {
        if core::mem::take(&mut self.has_new_priorities) {
            self.apply_priorities();
        }
        let Self { table, state, .. } = self;
        while let Some(&id) = state.lost.front() {
            if let Some(stream) = table.get_mut(id) {
                while let Some(lost) = stream.send.first_lost() {
                    if !write_stream_frame(id, stream, lost, out, end, sent) {
                        return;
                    }
                }
                stream.flags.remove(Flags::IN_LOST);
            }
            state.lost.pop_front();
        }
        while let at = state.next_to_send()
            && let Some(&(rank, id)) = state.sendable.get(at)
        {
            let Some(stream) = table.get_mut(id) else {
                state.sendable.remove(at);
                continue;
            };
            let (start, written) = (stream.send.sent(), stream.send.end());
            let allowed = (stream.send_limit).min(start + (state.send_limit - state.sent));
            let range = start..written.min(allowed);
            let has_frame = !range.is_empty() || start == written && stream.owes_fin();
            if has_frame && !write_stream_frame(id, stream, range.clone(), out, end, sent) {
                return;
            }
            let now_sent = stream.send.sent();
            state.sent += now_sent - start;
            state.unsent -= now_sent - start;
            let is_serial = rank & SERIAL != 0;
            if !is_serial {
                state.passed += now_sent - start;
            }
            if now_sent < range.end && now_sent < stream.turn_end {
                return;
            }
            if is_serial {
                state.passed = 0;
            }
            state.sendable.remove(at);
            stream.flags.remove(Flags::IN_SENDABLE);
            if now_sent < range.end {
                state.mark_sendable(id, stream);
                return;
            }
            if now_sent < written {
                state.report_blocked(id, stream);
                if now_sent < stream.send_limit && stream.mark(Flags::IN_STALLED) {
                    state.stalled.push(id);
                }
            }
        }
    }

    #[inline]
    pub(crate) fn on_data_acked(&mut self, id: StreamId, range: Range<u64>, fin: bool) {
        let stream = self.table.get_mut(id);
        let Some(stream) = stream.filter(|it| !it.flags.contains(Flags::RESET)) else {
            return;
        };
        let reached = stream.send.reached();
        self.state.release(stream.send.on_acked(range));
        self.state.reached += stream.send.reached() - reached;
        if fin {
            stream.flags.insert(Flags::FIN_ACKED);
        }
        if stream.flags.contains(Flags::FIN_ACKED) && stream.send.is_acked() {
            stream.flags.insert(Flags::SEND_DONE);
            self.remove_if_finished(id);
        }
    }

    pub(crate) fn on_reset_acked(&mut self, id: StreamId) {
        if let Some(stream) = self.table.get_mut(id) {
            stream.flags.insert(Flags::SEND_DONE);
            self.remove_if_finished(id);
        }
    }

    pub(crate) fn on_data_lost(&mut self, id: StreamId, range: Range<u64>, fin: bool) {
        let Some((stream, state)) = self.get_mut(id) else {
            return;
        };
        if stream.flags.intersects(Flags::RESET | Flags::SEND_DONE) {
            return;
        }
        if stream.flags.contains(Flags::STOPPED_BY_PEER) {
            return state.reset(id, stream, stream.deferred_reset_code);
        }
        stream.send.on_lost(range);
        if stream.send.first_lost().is_some() && stream.mark(Flags::IN_LOST) {
            state.lost.push_back(id);
        }
        if fin && !stream.flags.contains(Flags::FIN_ACKED) {
            stream.flags.remove(Flags::FIN_SENT);
            state.mark_sendable(id, stream);
        }
    }

    pub(crate) fn on_owed_frame_lost(&mut self, id: StreamId, frame: Flags) {
        if let Some((stream, state)) = self.get_mut(id) {
            state.owe(id, stream, frame);
        }
    }
}

/// Returns false if there is not enough room.
fn write_owed_frames(
    id: StreamId,
    stream: &mut Stream,
    out: &mut Vec<u8>,
    end: usize,
    sent: &mut Frames,
) -> bool {
    let is_receiving = stream.final_size == UNKNOWN_SIZE;
    if stream.flags.contains(Flags::OWES_MAX_STREAM_DATA) {
        stream.receive_limit = (stream.consumed + stream.receive_window).min(MAX_VARINT);
    }
    for (flag, kind, is_relevant, value) in [
        (
            Flags::OWES_MAX_STREAM_DATA,
            kind::MAX_STREAM_DATA,
            is_receiving && !stream.flags.contains(Flags::READ_DONE),
            stream.receive_limit,
        ),
        (
            Flags::OWES_STREAM_DATA_BLOCKED,
            kind::STREAM_DATA_BLOCKED,
            stream.is_blocked(),
            stream.send_limit,
        ),
        (
            Flags::OWES_RESET_STREAM,
            kind::RESET_STREAM,
            !stream.flags.contains(Flags::SEND_DONE),
            stream.reset_code,
        ),
        (
            Flags::OWES_STOP_SENDING,
            kind::STOP_SENDING,
            is_receiving,
            stream.stop_code,
        ),
    ] {
        if !stream.flags.contains(flag) {
            continue;
        }
        if is_relevant {
            if out.len() + MAX_OWED_FRAME_LEN > end {
                return false;
            }
            out.push(kind as u8);
            out.varint(id.0);
            out.varint(value);
            if kind == kind::RESET_STREAM {
                out.varint(stream.send.sent());
            }
            sent.push(SentFrame::Owed(id, flag));
        }
        stream.flags.remove(flag);
    }
    true
}

/// Writes as much of `range` as fits. Returns false if that is nothing.
#[inline]
fn write_stream_frame(
    id: StreamId,
    stream: &mut Stream,
    range: Range<u64>,
    out: &mut Vec<u8>,
    end: usize,
    sent: &mut Frames,
) -> bool {
    let (offset, available) = (range.start, range.end - range.start);
    let offset_len = if offset > 0 { varint_len(offset) } else { 0 };
    let Some(room) = end.checked_sub(out.len() + 1 + varint_len(id.0) + offset_len) else {
        return false;
    };
    let room = room as u64;
    let has_length = available < room;
    let len = match has_length {
        true => available.min(room.saturating_sub(varint_len(available) as u64)),
        false => room,
    };
    if len == 0 && available > 0 {
        return false;
    }
    let fin = stream.flags.contains(Flags::FIN) && offset + len == stream.send.end();
    let flag = |is_set, flag| if is_set { flag } else { 0 };
    out.push(
        kind::STREAM as u8
            | flag(offset > 0, stream_flag::OFFSET)
            | flag(has_length, stream_flag::LENGTH)
            | flag(fin, stream_flag::FIN),
    );
    out.varint(id.0);
    if offset > 0 {
        out.varint(offset);
    }
    if has_length {
        out.varint(len);
    }
    stream.send.send(offset..offset + len, out);
    if fin {
        stream.flags.insert(Flags::FIN_SENT);
    }
    sent.push(SentFrame::Stream {
        id,
        offset,
        len: len as u16,
        fin,
    });
    true
}
