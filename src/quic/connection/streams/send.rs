use core::ops::Range;
use std::collections::VecDeque;

use super::stream::UNKNOWN_SIZE;
use super::{Asked, Flags, Invitation, MIN_DATA_FRAME_LEN, State, Stream, Streams, Table};
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
/// The rank of what goes out of turn, so that it does not starve (RFC 9218 §10). Short streams get a byte for so many, and
/// the next less urgent stream gets [`LITTLE`] after so many.
const PASSING: u64 = 1;
const SENT_PER_PASSING: u64 = 8;
const MAX_PATIENCE: u64 = u16::MAX as u64;
/// A peer that reads one stream after the other only raises its limit for what the oldest one sends (RFC 9308 §4.4). The
/// others get a sixteenth of its window, which doubles up to so many times, and so many while the oldest one is blocked.
const MAX_TRUST: u8 = 2;
const MAX_SHARE_AHEAD: u64 = 7;
/// A type and three integers.
const MAX_OWED_FRAME_LEN: usize = 25;
const MAX_REPEATED_LEN: u64 = 256;
/// In bytes. What counts as progress.
const MIN_DELIVERY: u64 = 4096;
const MIN_SERIES_LEN: u64 = 24;
const MAX_WRITERS_COUNTED: usize = 16;

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

#[inline]
fn urgency(rank: u64) -> u64 {
    rank / (2 * SERIAL)
}

/// Less is older, or more urgent. Streams that take turns have none.
#[inline]
fn age((rank, id): (u64, StreamId)) -> Option<(u64, StreamId)> {
    (rank & 1 == 0).then_some((rank & !SERIAL, id))
}

/// What [`State::waited`] has to be for a stream that has so many bytes to send.
#[inline]
fn wait_for(len: u64) -> u16 {
    match len {
        ..=MIN_UNSENT => (SENT_PER_PASSING * len.min(LITTLE)) as u16,
        _ => u16::MAX,
    }
}

/// Whether it is going to need credit before long.
fn is_under_way(stream: &Stream) -> bool {
    let beyond_limit = stream.send.end().saturating_sub(stream.send_limit);
    !stream.flags.contains(Flags::WRITE_DONE)
        && match stream.is_blocked() {
            true => stream.send.len() > beyond_limit,
            false => stream.to_send() > LITTLE || stream.flags.contains(Flags::AWAITS_DATA),
        }
}

impl Stream {
    /// How many bytes the application is left with once so many are `taken`.
    #[inline]
    pub(crate) fn set_unwritten(&mut self, len: u64, taken: u64) {
        self.unwritten = len;
        let (has_much, end) = (len >= WRITE_CHUNK, self.send.end() + taken + len);
        self.flags.set(Flags::HAS_MUCH_TO_WRITE, has_much);
        (self.flags).set(Flags::WILL_BE_LONG, has_much && end > LONG_LEN);
    }

    /// As far as is known.
    #[inline]
    fn to_send(&self) -> u64 {
        self.send.unsent_len() + self.unwritten
    }
}

impl State {
    /// How many bytes the application may write if it has `len`, and whether they are ahead of an older stream.
    #[inline]
    pub(crate) fn capacity(&self, id: StreamId, stream: &Stream, len: u64) -> (u64, bool) {
        let mut room =
            (self.max_retained.saturating_sub(self.retained)).min(self.credit_for(stream));
        if !self.sends_in_order {
            return (self.wanted_from(id, stream, len).min(room), false);
        }
        let unsent = stream.send.unsent_len();
        let (wanted, is_ahead) = match self.invitation(id, stream) {
            Some(Invitation::Passing) => {
                let passes = self.may_pass(unsent + len) || self.has_waited_long(stream);
                (u64::from(passes) * LITTLE.saturating_sub(unsent), true)
            }
            Some(invitation) => {
                room = room.min(self.send_credit().saturating_sub(self.spare_credit.into()));
                let wanted = u64::from(self.imminent).saturating_sub(self.stock());
                (wanted, invitation == Invitation::Ahead)
            }
            None => {
                let entry = (self.rank(stream), id);
                let follows = |age| {
                    self.writable.front().is_some_and(|it| *it < entry)
                        || self.leader.is_some_and(|it| it < age)
                };
                let shared = self.unsent_target.saturating_sub(self.unsent);
                let wanted = shared.max(MIN_UNSENT.saturating_sub(unsent));
                (wanted, age(entry).is_some_and(follows))
            }
        };
        if is_ahead {
            room = room.min(self.credit_ahead + self.reserve_for(stream, len >= WRITE_CHUNK));
        }
        (wanted.min(room), is_ahead)
    }

    /// It holds until the stream gets in line again.
    #[inline]
    fn invitation(&self, id: StreamId, stream: &Stream) -> Option<Invitation> {
        let holds = |it: &(StreamId, _)| it.0 == id && !stream.flags.contains(Flags::WANTS_WRITE);
        self.invited.filter(holds).map(|it| it.1)
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
        age(entry).is_none() || self.reserve_for(stream, has_much) >= self.min_credit()
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

    pub(crate) fn on_written_ahead(&mut self, id: StreamId, stream: &mut Stream, len: u64) {
        if self.invitation(id, stream) == Some(Invitation::Passing)
            && let Some(at) = self.sendable.iter().position(|it| it.1 == id)
        {
            self.move_up(at, stream);
        }
        self.ahead += len;
        self.reserve -= len.saturating_sub(self.credit_ahead);
        self.credit_ahead = self.credit_ahead.saturating_sub(len);
    }

    /// A stream that has too much to pass keeps its turn.
    pub(crate) fn on_turned_down(&self, id: StreamId, stream: &mut Stream) {
        if self.invitation(id, stream) == Some(Invitation::Passing) {
            stream.write_round = 0;
        }
    }

    /// What it takes to write a byte.
    #[inline]
    pub(super) fn min_credit(&self) -> u64 {
        match self.has_frame_headers {
            true => MIN_DATA_FRAME_LEN,
            false => 1,
        }
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

    /// See [`Controller::pace`](crate::congestion::Controller::pace).
    #[inline]
    pub(crate) fn set_pace(&mut self, room: u64, pace: (u64, u64), datagram_len: u64) {
        let (allowance, steady) = (pace.0, pace.1.min(self.send_window / 32));
        let margin = (2 * steady).max(datagram_len / 2);
        // The last packet may fill the window over the brim.
        let room = room.next_multiple_of(datagram_len) + margin.min(2 * WRITE_CHUNK);
        let imminent = allowance.saturating_add(margin).min(room);
        self.imminent = imminent.try_into().unwrap_or(u32::MAX);
        self.write_chunk = steady.clamp(datagram_len / 2, WRITE_CHUNK) as u16;
    }

    /// What is unsent and can be sent.
    #[inline]
    fn stock(&self) -> u64 {
        self.unsent - self.stuck
    }

    #[inline]
    fn unstick(&mut self, stream: &mut Stream) {
        if stream.take(Flags::IS_STUCK) {
            self.stuck -= stream.send.unsent_len();
        }
    }

    #[inline]
    pub(super) fn has_little_unsent(&self) -> bool {
        match self.sends_in_order {
            true => self.stock() + u64::from(self.write_chunk) <= u64::from(self.imminent),
            false => self.unsent + WRITE_CHUNK <= self.unsent_target,
        }
    }

    #[inline]
    fn invites_writes(&self) -> bool {
        (self.has_little_unsent() || self.may_starve_any())
            && self.retained + WRITE_CHUNK <= self.max_retained
            && self.send_credit() >= self.min_credit()
    }

    #[inline]
    pub(crate) fn awaits_writes(&self) -> bool {
        !self.writable.is_empty() && !self.is_write_round_over && self.invites_writes()
    }

    #[inline]
    pub(crate) fn start_write_round(&mut self, now: Instant) {
        self.renew_crumbs(now);
        self.write_round = self.write_round.wrapping_add(1).max(1);
        (self.is_write_round_over, self.has_written_in_round) = (false, false);
        self.has_looked_behind = false;
    }

    /// For while what has been written is held back.
    pub(crate) fn ask_for_more(&mut self, now: Instant) {
        if self.has_written_in_round {
            self.start_write_round(now);
        }
    }

    /// Whatever the limits are.
    #[inline]
    pub(crate) fn write(&mut self, id: StreamId, stream: &mut Stream, parts: &[&[u8]]) {
        self.unstick(stream);
        for part in parts {
            stream.send.write(part);
            self.unsent += part.len() as u64;
            self.retained += part.len() as u64;
            stream.share = stream.share.saturating_sub(part.len() as u64);
            self.has_written_in_round |= !part.is_empty();
        }
        self.mark_sendable(id, stream);
    }

    pub(crate) fn finish(&mut self, id: StreamId, stream: &mut Stream) {
        if stream.mark(Flags::WRITE_DONE) {
            if !self.sends_in_order {
                stream.first_turn = self.turns + stream.send.unsent_len() / (TURN_LEN / 2);
            }
            self.awaited -= u32::from(stream.take(Flags::AWAITS_DATA));
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
        self.awaited -= u32::from(stream.take(Flags::AWAITS_DATA));
        stream.flags.insert(Flags::WRITE_DONE);
        self.close_if_done(id, stream);
    }

    fn discard(&mut self, stream: &mut Stream) {
        self.unstick(stream);
        self.unsent -= stream.send.unsent_len();
        self.release(stream.send.len());
        self.reached += stream.send.sent() - stream.send.reached();
        stream.send.discard();
        stream.unwritten = 0;
    }

    #[inline]
    fn release(&mut self, len: u64) {
        self.retained -= len;
        self.released += len;
    }

    #[inline]
    fn count_delivery(&mut self, len: u64) {
        let delivered = u64::from(self.delivered) + len;
        self.delivered = (delivered % MIN_DELIVERY) as u16;
        if delivered >= MIN_DELIVERY {
            (self.made_progress, self.has_delivered) = (true, true);
        }
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
            self.reset_unless_delivered(id, stream, answer);
        }
    }

    pub(crate) fn reset_unless_delivered(&mut self, id: StreamId, stream: &mut Stream, code: u64) {
        if stream.flags.contains(Flags::FIN_SENT) && stream.send.first_lost().is_none() {
            stream.flags.insert(Flags::DEFERS_RESET);
            stream.deferred_reset_code = code;
        } else {
            self.reset(id, stream, code);
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
        self.awaited -= u32::from(stream.take(Flags::AWAITS_DATA));
        if is_awaited && !stream.flags.contains(Flags::WRITE_DONE) {
            stream.flags.insert(Flags::AWAITS_DATA);
            self.awaited += 1;
        }
        self.is_write_round_over = false;
    }

    #[inline]
    pub(crate) fn awaits_data(&self) -> bool {
        self.awaited > 0
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
                true => {
                    stream.due = self.sent + MAX_PATIENCE;
                    self.rank(stream)
                }
                false => self.start_waiting(stream),
            };
            line_up(&mut self.writable, (rank, id));
            self.is_write_round_over = false;
            self.has_passing |= self.can_pass((rank, id), stream);
            self.lower_least_wait(stream);
        }
    }

    /// For a stream that has more to send than flow control allows (RFC 9000 §4.1).
    pub(crate) fn report_blocked(&mut self, id: StreamId, stream: &mut Stream) {
        let needed = self.min_credit();
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
        let to_send = match self.sends_in_order {
            true => stream.to_send(),
            false => stream.send.unsent_len(),
        };
        let is_past = |len| stream.send.sent() >= len && to_send > LITTLE;
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
        match self.is_turn_of_serial()
            || !self.sends_in_order && self.sendable.front().is_some_and(gives_way)
        {
            true => first_serial(&self.sendable).unwrap_or(0),
            false => 0,
        }
    }

    #[inline]
    fn is_turn_of_serial(&self) -> bool {
        u64::from(self.passed) >= TURN_LEN
    }

    /// A turn goes on if the application has yet to be asked for the rest of it.
    #[inline]
    fn count_turns(&mut self, is_serial: bool, len: u64) {
        let passed = u64::from(self.passed);
        self.passed = match (is_serial, self.is_turn_of_serial()) {
            (false, false) => (passed + len).min(TURN_LEN),
            (true, _) if !self.sends_in_order => passed,
            (false, true) => passed,
            (true, false) => passed.saturating_sub(len),
            (true, true) if passed + len < 2 * TURN_LEN => passed + len,
            (true, true) => 0,
        } as u16;
    }

    #[inline]
    fn count_waited(&mut self, rank: u64, stream: &Stream, len: u64) {
        let has_more = stream.flags.contains(Flags::IN_WRITABLE);
        if has_more {
            self.lower_least_wait(stream);
        }
        if rank > PASSING {
            self.since_passing = self.since_passing.saturating_add(len as u16);
            let others = self.sendable.len() + self.writable.len() - 1 - usize::from(has_more);
            self.waited = match others {
                0 => 0,
                _ => (u64::from(self.waited) + len).min(SENT_PER_PASSING * LITTLE) as u16,
            };
        }
    }

    /// Whether a stream that has so many bytes to send may send some of them out of turn.
    #[inline]
    fn may_pass(&self, len: u64) -> bool {
        wait_for(len) <= self.waited
    }

    #[inline]
    fn lower_least_wait(&mut self, stream: &Stream) {
        self.least_wait = (self.least_wait).min((wait_for(stream.to_send()) >> 8) as u8);
    }

    #[inline]
    fn has_waited_long(&self, stream: &Stream) -> bool {
        stream.due <= self.sent && u64::from(self.since_passing) == MAX_PATIENCE
    }

    /// Where it is in `writable`. Those that have written are moved up.
    fn next_to_pass(&mut self, table: &mut Table) -> Option<usize> {
        let first = *self.writable.front()?;
        let is_long = table.get(first.1).is_some_and(|it| it.to_send() > LITTLE);
        let last_as_urgent = (first.0 | (2 * SERIAL - 1), StreamId(u64::MAX));
        let last = if is_long { first } else { last_as_urgent };
        for at in self.sendable.partition_point(|it| *it <= last)..self.sendable.len() {
            if let Some(&(rank, id)) = self.sendable.get(at)
                && let Some(stream) = table.get_mut(id)
                && (stream.to_send() <= LITTLE && self.may_pass(stream.to_send())
                    || rank > last_as_urgent.0 && self.has_waited_long(stream))
            {
                self.move_up(at, stream);
            }
        }
        let next_class = self.writable.partition_point(|it| *it <= last_as_urgent);
        let can_pass = |&at: &usize| {
            let stream = self.writable.get(at).and_then(|it| table.get(it.1));
            stream.is_some_and(|it| {
                let reserve = self.reserve_for(it, it.flags.contains(Flags::HAS_MUCH_TO_WRITE));
                (is_long && self.may_pass(it.to_send())
                    || at == next_class && self.has_waited_long(it))
                    && it.write_round != self.write_round
                    && it.send.unsent_len() + self.min_credit() <= LITTLE
                    && self.credit_ahead + reserve >= self.min_credit()
            })
        };
        let looks_at_all = is_long
            && u16::from(self.least_wait) <= self.waited >> 8
            && self.credit_ahead + self.reserve >= self.min_credit();
        let at = match looks_at_all {
            true => (1..self.writable.len()).find(can_pass),
            false => Some(next_class).filter(can_pass),
        };
        if at.is_none() && looks_at_all {
            let waits = (self.writable.iter().filter_map(|it| table.get(it.1)))
                .filter(|it| it.send.unsent_len() + self.min_credit() <= LITTLE)
                .map(|it| wait_for(it.to_send()).div_ceil(256).min(255) as u8);
            self.least_wait = waits.min().unwrap_or(u8::MAX);
        }
        self.has_looked_behind = at.is_none();
        at
    }

    fn move_up(&mut self, at: usize, stream: &mut Stream) {
        let len = stream.send.unsent_len().min(LITTLE);
        match self.may_pass(stream.to_send()) {
            true => self.waited -= (SENT_PER_PASSING * len) as u16,
            false => self.since_passing = 0,
        }
        stream.turn_end = stream.send.sent() + len;
        if let Some((_, id)) = self.sendable.remove(at) {
            line_up(&mut self.sendable, (PASSING, id));
        }
    }

    /// Where it is in `writable`.
    #[inline]
    fn next_to_write(&mut self, table: &mut Table) -> (Option<usize>, Invitation) {
        if !self.sends_in_order {
            return (self.next_writer(table), Invitation::InTurn);
        }
        let leader = (self.leader).filter(|it| table.get(it.1).is_some_and(is_under_way));
        self.update_credit_ahead(leader.and_then(|it| table.get(it.1)));
        if self.waited > 0
            && !self.has_looked_behind
            && let Some(at) = self.next_to_pass(table)
        {
            return (Some(at), Invitation::Passing);
        }
        let line = &self.writable;
        let is_due = |it: &(u64, StreamId), max_unsent| {
            table.get(it.1).is_some_and(|it| {
                it.write_round != self.write_round && it.send.unsent_len() <= max_unsent
            })
        };
        let serial = first_serial(line);
        let alternates = self.is_turn_of_serial()
            || (self.sendable.front()).is_some_and(|it| it.0 & SERIAL == 0);
        let max_unsent = u64::from(alternates) * WRITE_CHUNK;
        let is_near = |it: &(u64, StreamId)| {
            let own = table.get(it.1).map_or(0, |it| it.send.unsent_len());
            u64::from(self.passed) + self.stock().saturating_sub(own) >= TURN_LEN
        };
        let mut at = serial
            .filter(|&at| (line.get(at)).is_some_and(|it| is_due(it, max_unsent) && is_near(it)))
            .or_else(|| line.iter().position(|it| is_due(it, u64::MAX)));
        self.spare_credit = match self.send_credit() {
            credit @ LITTLE.. if at == serial && at > Some(0) => {
                (credit / 2).try_into().unwrap_or(u32::MAX)
            }
            _ => 0,
        };
        let age_at = |at: Option<usize>| age(*at.and_then(|at| line.get(at))?);
        let oldest = [leader, age_at(Some(0)), age_at(serial)];
        let oldest = oldest.into_iter().flatten().min();
        let is_ahead = |at| age_at(at).is_some_and(|it| oldest < Some(it));
        if is_ahead(at) && self.credit_ahead < self.min_credit() {
            let can_pass = |it: &(u64, StreamId)| {
                (table.get(it.1)).is_some_and(|stream| self.can_pass(*it, stream))
            };
            let passing = (line.iter().take_while(|_| self.has_passing)).position(can_pass);
            (self.has_passing, self.spare_credit) = (passing.is_some(), 0);
            let urgency = |at| line.get(at).map(|it| urgency(it.0));
            at = ([passing, serial].into_iter().flatten())
                .filter(|&at| Some(at) == passing || age_at(Some(at)) == oldest)
                .filter(|&at| line.get(at).is_some_and(|it| is_due(it, u64::MAX)))
                .min_by_key(|&at| urgency(at));
        }
        let is_ahead = is_ahead(at);
        self.leader = age_at(at).filter(|_| !is_ahead).or(leader);
        match is_ahead {
            true => (at, Invitation::Ahead),
            false => (at, Invitation::InTurn),
        }
    }

    #[inline]
    fn mark_sendable(&mut self, id: StreamId, stream: &mut Stream) {
        if stream.mark(Flags::IN_SENDABLE) {
            self.unstick(stream);
            self.turns += 1;
            stream.turn_end = stream.send.sent() + TURN_LEN;
            if self.sends_in_order {
                stream.due = self.sent + MAX_PATIENCE;
            }
            let turn = TURN_BITS * u64::from(self.has_crumb(id, stream));
            let rank = self.rank(stream) & !turn;
            line_up(&mut self.sendable, (rank, id));
        }
    }

    pub(crate) fn has_lost_data(&self) -> bool {
        !self.lost.is_empty()
    }

    /// Whether there is something that other streams may depend on.
    pub(crate) fn has_urgent_frames(&self) -> bool {
        self.has_lost_data() || self.sendable.front().is_some_and(|it| it.0 == 0)
    }

    #[inline]
    pub(crate) fn sendable_streams(&self) -> usize {
        self.sendable.len()
    }

    pub(crate) fn owes_frames(&self) -> bool {
        !self.owing.is_empty()
    }

    #[inline]
    pub(crate) fn has_frames(&self) -> bool {
        !(self.sendable.is_empty() && self.lost.is_empty() && self.owing.is_empty())
    }
}

impl Streams {
    /// At least, and with what the application has yet to be asked for.
    pub(crate) fn to_send(&self) -> u64 {
        let count = MAX_WRITERS_COUNTED * usize::from(self.state.sends_in_order);
        let next = (self.state.writable.iter().take(count)).filter_map(|it| self.table.get(it.1));
        let unwritten = next.map(|it| it.unwritten.min(it.send_credit())).sum();
        self.state.unsent + self.state.send_credit().min(unwritten)
    }

    /// Whether those that have something to send go on, and have many times as much on its way.
    pub(crate) fn only_continues_series(&self) -> bool {
        let mut streams = (self.state.sendable.iter()).filter_map(|it| self.table.get(it.1));
        streams.all(|it| {
            it.send.len() > MIN_SERIES_LEN * it.send.unsent_len()
                && !it.flags.contains(Flags::WRITE_DONE)
        })
    }

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
                    .filter(|it| (it ^ *rank) & !TURN_BITS != 0 && *rank != PASSING)
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
            let (at, invitation) = state.next_to_write(table);
            let id = at.and_then(|at| state.writable.remove(at)).map(|it| it.1);
            let Some((id, stream)) = id.and_then(|id| table.get_mut(id).map(|it| (id, it))) else {
                state.is_write_round_over = true;
                return None;
            };
            stream.flags.remove(Flags::IN_WRITABLE);
            if stream.flags.contains(Flags::WRITE_DONE) {
                continue;
            }
            if stream.send_credit() < state.min_credit() {
                state.report_blocked(id, stream);
                continue;
            }
            stream.flags.remove(Flags::WANTS_WRITE);
            state.invited = Some((id, invitation));
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
            state.count_turns(is_serial, now_sent - start);
            if state.sends_in_order {
                state.count_waited(rank, stream, now_sent - start);
            }
            if now_sent < range.end && now_sent < stream.turn_end {
                return;
            }
            if is_serial && !state.sends_in_order {
                state.passed = 0;
            }
            state.sendable.remove(at);
            stream.flags.remove(Flags::IN_SENDABLE);
            if now_sent < range.end {
                state.mark_sendable(id, stream);
                return;
            }
            if now_sent < written {
                stream.flags.insert(Flags::IS_STUCK);
                state.stuck += written - now_sent;
                state.report_blocked(id, stream);
                if now_sent < stream.send_limit && stream.mark(Flags::IN_STALLED) {
                    state.stalled.push(id);
                }
            } else if state.closes_when_sent {
                state.close_if_done(id, stream);
            }
        }
    }

    #[inline]
    pub(crate) fn on_data_acked(&mut self, id: StreamId, range: Range<u64>, fin: bool) {
        let stream = self.table.get_mut(id);
        let Some(stream) = stream.filter(|it| !it.flags.contains(Flags::RESET)) else {
            return;
        };
        if !stream.is_internal() {
            (self.state).count_delivery(stream.send.unacked_len(range.clone()));
        }
        let reached = stream.send.reached();
        self.state.release(stream.send.on_acked(range));
        self.state.reached += stream.send.reached() - reached;
        if fin {
            stream.flags.insert(Flags::FIN_ACKED);
        }
        let is_finished = stream.flags.contains(Flags::FIN_ACKED);
        if !stream.flags.contains(Flags::READ_DONE) {
            let last = Some((id, is_finished));
            self.state.asked = self.state.asked.max(if !stream.send.is_acked() {
                Asked::InPart
            } else if core::mem::replace(&mut self.state.unanswered, last) == last {
                Asked::Again
            } else {
                Asked::Anew
            });
        }
        if is_finished && stream.send.is_acked() {
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
        if stream.flags.contains(Flags::DEFERS_RESET) {
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

    /// Only if frames are owed, and there is room for them. Returns whether there is something to send.
    #[cold]
    pub(crate) fn repeat_unacked_data(&mut self, id: StreamId) -> bool {
        match self.table.get(id) {
            Some(it)
                if (1..=MAX_REPEATED_LEN).contains(&it.send.len())
                    && !it.is_blocked()
                    && !self.state.owing.is_empty() =>
            {
                self.on_data_lost(id, 0..it.send.sent(), false);
                true
            }
            _ => false,
        }
    }

    /// For the last packet of the connection. Another frame can follow.
    #[cold]
    pub(crate) fn write_unacked_data(
        &mut self,
        id: StreamId,
        out: &mut Vec<u8>,
        end: usize,
        sent: &mut Frames,
    ) {
        if let Some((stream, state)) = self.get_mut(id)
            && let (len, last) = (stream.send.len(), stream.send.end())
            && (1..=MAX_REPEATED_LEN).contains(&len)
            && last <= stream.send_limit
            && state.sent + stream.send.unsent_len() <= state.send_limit
            && out.len() + 2 * MAX_REPEATED_LEN as usize <= end
        {
            write_stream_frame(id, stream, last - len..last, out, end, sent);
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

#[cfg(test)]
mod tests {
    use super::super::Role;
    use super::*;
    use crate::{Config, Direction, Side};

    const ID: StreamId = StreamId(2);

    fn in_order() -> State {
        State {
            sends_in_order: true,
            send_limit: MAX_VARINT,
            send_window: MAX_VARINT,
            max_retained: MAX_VARINT,
            credit_ahead: MAX_VARINT,
            ..State::default()
        }
    }

    fn stream(sent: u64, unsent: u64, unwritten: u64) -> Stream {
        let mut stream = Stream::new(Role::Raw, Flags::empty(), MAX_VARINT, 0);
        stream.send.write(&vec![0; (sent + unsent) as usize]);
        stream.send.send(0..sent, &mut Vec::new());
        stream.set_unwritten(unwritten, 0);
        stream
    }

    #[test]
    fn what_the_application_is_left_with_counts() {
        for (unsent, unwritten, has_more) in [(1, LITTLE - 1, false), (1, LITTLE, true)] {
            let stream = stream(LONG_LEN, unsent, unwritten);
            assert_eq!(is_under_way(&stream), has_more);
            assert_eq!(in_order().rank(&stream) & SERIAL != 0, has_more);
        }
        for (taken, is_long) in [(1, false), (2, true)] {
            let mut stream = stream(0, 1, 0);
            stream.set_unwritten(LONG_LEN - 2, taken);
            assert_eq!(stream.flags.contains(Flags::WILL_BE_LONG), is_long);
        }
    }

    #[test]
    fn the_stock_goes_by_the_pace() {
        for (room, allowance, steady, window, imminent, chunk) in [
            (0, 0, 10, 1 << 30, 500, 500),
            (1, 9000, 10, 1 << 30, 1500, 500),
            (9000, 1, 10, 1 << 30, 501, 500),
            (9000, 1, 600, 1 << 30, 1201, 600),
            (9000, 1, 600, 32 * 550, 1101, 550),
            (0, 0, 50_000, 1 << 30, 65_536, 32_768),
            (900_000, 1, 50_000, 1 << 30, 100_001, 32_768),
            (1 << 40, u64::MAX, 10, 1 << 30, u32::MAX, 500),
        ] {
            let mut state = in_order();
            state.send_window = window;
            state.set_pace(room, (allowance, steady), 1000);
            assert_eq!((state.imminent, state.write_chunk), (imminent, chunk));
        }
    }

    #[test]
    fn turns_are_counted_in_bytes() {
        const TURN: u16 = TURN_LEN as u16;
        for (sends_in_order, is_serial, before, after) in [
            (true, false, 5, 15),
            (true, false, TURN - 5, TURN),
            (true, false, TURN + 5, TURN + 5),
            (true, true, 5, 0),
            (true, true, 15, 5),
            (true, true, TURN, TURN + 10),
            (true, true, 2 * TURN - 11, 2 * TURN - 1),
            (true, true, 2 * TURN - 10, 0),
            (false, false, TURN - 5, TURN),
            (false, true, 15, 15),
            (false, true, TURN, TURN),
        ] {
            let mut state = in_order();
            (state.sends_in_order, state.passed) = (sends_in_order, before);
            state.count_turns(is_serial, 10);
            assert_eq!(state.passed, after);
        }
    }

    #[test]
    fn waiting_counts_while_others_are_in_line() {
        for (rank, sendable, writable, has_more, waited, since_passing) in [
            (2, 1, 0, false, 0, 15),
            (2, 1, 1, true, 0, 15),
            (2, 1, 1, false, 15, 15),
            (2, 2, 0, false, 15, 15),
            (2, 1, 2, true, 15, 15),
            (PASSING, 1, 0, false, 5, 5),
            (0, 2, 0, false, 5, 5),
        ] {
            let (mut state, mut stream) = (in_order(), stream(0, 0, 64));
            (state.waited, state.since_passing, state.least_wait) = (5, 5, 9);
            state.sendable.resize(sendable, (rank, ID));
            state.writable.resize(writable, (rank, ID));
            stream.flags.set(Flags::IN_WRITABLE, has_more);
            state.count_waited(rank, &stream, 10);
            assert_eq!((state.waited, state.since_passing), (waited, since_passing));
            assert_eq!(state.least_wait, if has_more { 2 } else { 9 });
        }
    }

    #[test]
    fn what_has_been_written_counts_for_a_pass() {
        for (unsent, len, waited, capacity) in [
            (100, 200, 2400, LITTLE - 100),
            (100, 200, 2399, 0),
            (100, MIN_UNSENT - 100, 16_384, LITTLE - 100),
            (100, MIN_UNSENT - 99, 16_384, 0),
        ] {
            let mut state = in_order();
            (state.invited, state.waited) = (Some((ID, Invitation::Passing)), waited);
            let stream = stream(0, unsent, 0);
            assert_eq!(state.capacity(ID, &stream, len), (capacity, true));
        }
    }

    #[test]
    fn what_is_stuck_is_stock_again_if_it_may_move() {
        type Action = fn(&mut State, &mut Stream);
        let actions: [(Action, _); 4] = [
            (|state, it| state.write(ID, it, &[b"a"]), 11),
            (|state, it| state.finish(ID, it), 10),
            (|state, it| state.reset(ID, it, 0), 0),
            (|state, it| state.raise_send_limit(ID, it, u64::MAX), 10),
        ];
        for (action, stock) in actions {
            let (mut state, mut stream) = (in_order(), stream(0, 10, 0));
            (state.unsent, state.retained, state.stuck) = (10, 10, 10);
            stream.flags.insert(Flags::IS_STUCK);
            action(&mut state, &mut stream);
            assert_eq!((state.stock(), state.stuck), (stock, 0));
        }
    }

    /// Of streams with an urgency, and so many bytes that are written and that are not.
    fn lined_up(streams: &[(u8, usize, u64)]) -> Streams {
        let mut config = Config::client();
        config.sends_in_order = true;
        let mut all = Streams::new(Side::Server, &config.parameters, &config, 0);
        all.set_peer_parameters(&config.parameters);
        let Streams { table, state, .. } = &mut all;
        for &(urgency, written, unwritten) in streams {
            let opened = table.open(Direction::Bidirectional, None, state);
            crate::with(opened, |(id, stream)| {
                (stream.send_limit, stream.priority.urgency) = (MAX_VARINT, urgency);
                stream.set_unwritten(unwritten, written as u64);
                if written > 0 {
                    state.write(id, stream, &[&vec![0; written]]);
                }
                if unwritten > 0 {
                    state.want_write(id, stream);
                }
            });
        }
        state.credit_ahead = MAX_VARINT;
        all
    }

    fn passing(state: &State) -> Vec<u64> {
        let passing = state.sendable.iter().filter(|it| it.0 == PASSING);
        passing.map(|it| it.1.0).collect()
    }

    #[test]
    fn what_has_been_written_is_moved_up() {
        for (first, other, waited, sent, is_moved, left) in [
            (9000, (3, 100, 0), 800, 0, true, (0, u16::MAX)),
            (9000, (3, 100, 0), 799, 0, false, (799, u16::MAX)),
            (LITTLE, (3, 100, 0), 800, 0, false, (800, u16::MAX)),
            (LITTLE, (4, 100, 0), 801, 0, true, (1, u16::MAX)),
            (
                9000,
                (4, 9000, 0),
                9,
                MAX_PATIENCE - 1,
                false,
                (9, u16::MAX),
            ),
            (9000, (4, 9000, 0), 9, MAX_PATIENCE + 7, true, (9, 0)),
            (
                9000,
                (3, 9000, 0),
                9,
                MAX_PATIENCE + 7,
                false,
                (9, u16::MAX),
            ),
        ] {
            let mut streams = lined_up(&[(3, 0, first)]);
            let Streams { table, state, .. } = &mut streams;
            state.sent = 7;
            let opened = table.open(Direction::Bidirectional, None, state);
            crate::with(opened, |(id, stream)| {
                stream.priority.urgency = other.0;
                state.write(id, stream, &[&vec![0; other.1 + other.2]]);
            });
            (state.waited, state.since_passing, state.sent) = (waited, u16::MAX, sent);
            assert_eq!(state.next_to_pass(table), None);
            assert_eq!(passing(state), [5].repeat(usize::from(is_moved)));
            assert_eq!((state.waited, state.since_passing), left);
            let turn_end = table.get(StreamId(5)).map(|it| it.turn_end);
            let turn = (other.1 as u64).min(LITTLE);
            assert_eq!(turn_end, Some(if is_moved { turn } else { TURN_LEN }));
        }
    }

    #[test]
    fn only_streams_that_can_write_are_asked_to_pass() {
        type Change = fn(&mut State, &mut Stream);
        let changes: [(Change, _); 5] = [
            (|_, _| {}, 1),
            (|state, it| it.write_round = state.write_round, 2),
            (|_, it| it.send.write(&[0; LITTLE as usize]), 2),
            (|_, it| it.send.write(&[0; LITTLE as usize - 1]), 1),
            (
                |state, it| {
                    (state.credit_ahead, state.reserve) = (0, 1);
                    it.flags.insert(Flags::HAS_MUCH_TO_WRITE);
                },
                2,
            ),
        ];
        for (change, at) in changes {
            let mut streams = lined_up(&[(3, 0, 90_000), (3, 0, 100), (3, 0, 100)]);
            let Streams { table, state, .. } = &mut streams;
            crate::with(table.get_mut(StreamId(5)), |it| change(state, it));
            state.waited = (SENT_PER_PASSING * LITTLE) as u16;
            assert_eq!(state.next_to_pass(table), Some(at));
        }
    }

    #[test]
    fn what_passes_keeps_its_place_if_priorities_change() {
        let mut streams = lined_up(&[(3, 9, 90_000), (3, 9, 0)]);
        streams.state.waited = 72;
        streams.state.next_to_pass(&mut streams.table);
        streams.apply_priorities();
        assert_eq!(passing(&streams.state), [5]);
    }

    #[test]
    fn new_streams_are_due_in_every_round() {
        let mut state = in_order();
        state.write_round = u32::MAX;
        state.start_write_round(Instant::default());
        assert_ne!(state.write_round, stream(0, 0, 0).write_round);
    }

    #[test]
    fn nothing_follows_on_a_stream_that_is_reset() {
        let mut streams = lined_up(&[(3, 10, 100)]);
        streams.state.send_limit = 1000;
        let Streams { table, state, .. } = &mut streams;
        crate::with(table.get_mut(StreamId(1)), |it| {
            state.reset(StreamId(1), it, 0)
        });
        assert_eq!(streams.to_send(), 0);
    }

    #[test]
    fn waiting_only_counts_up_to_a_limit() {
        let mut state = in_order();
        state.sendable.resize(2, (2, ID));
        state.count_waited(2, &stream(0, 0, 0), SENT_PER_PASSING * LITTLE + 1);
        assert_eq!(u64::from(state.waited), SENT_PER_PASSING * LITTLE);
    }

    #[test]
    fn what_is_beyond_the_limit_is_no_stock_until_it_is_raised() {
        let mut streams = lined_up(&[(3, 100, 0)]);
        crate::with(streams.table.get_mut(StreamId(1)), |it| it.send_limit = 40);
        streams.write_stream_frames(&mut Vec::new(), 1200, &mut Frames::default());
        let Streams { table, state, .. } = &mut streams;
        assert_eq!((state.stock(), state.stuck), (0, 60));
        crate::with(table.get_mut(StreamId(1)), |it| {
            state.raise_send_limit(StreamId(1), it, 100);
        });
        assert_eq!((state.stock(), state.stuck), (60, 0));
    }

    #[test]
    fn what_is_unwritten_follows_as_far_as_the_limits_allow() {
        for (count, stream_limit, limit, expected) in [
            (1, 1000, 1000, 110),
            (1, 40, 1000, 40),
            (2, 40, 1000, 80),
            (2, 1000, 70, 70),
            (16, 1000, 9000, 160 + 1600),
            (17, 1000, 9000, 170 + 1600),
        ] {
            let mut streams = lined_up(&vec![(3, 10, 100); count]);
            streams.state.send_limit = limit;
            (streams.table.iter_mut()).for_each(|it| it.1.send_limit = stream_limit);
            assert_eq!(streams.to_send(), expected);
            streams.state.sends_in_order = false;
            assert_eq!(streams.to_send(), streams.state.unsent);
        }
    }

    #[test]
    fn a_stream_that_is_removed_leaves_the_lines() {
        let mut streams = lined_up(&[(3, 9, 90_000), (4, 9, 90_000)]);
        let Streams { table, state, .. } = &mut streams;
        crate::with(table.get_mut(StreamId(5)), |it| {
            state.reset(StreamId(5), it, 0);
            it.flags.insert(Flags::RELEASED | Flags::READ_DONE);
            it.final_size = 0;
        });
        streams.on_reset_acked(StreamId(5));
        let state = &streams.state;
        assert_eq!((state.sendable.len(), state.writable.len()), (1, 1));
    }

    #[test]
    fn a_long_stream_is_asked_for_the_rest_of_its_turn() {
        const TURN: u16 = TURN_LEN as u16;
        for (passed, own, other, at) in [
            (TURN, 9, 0, 1),
            (TURN - 1, 0, 0, 0),
            (TURN - 9, 9, 9, 1),
            (TURN - 10, 9, 9, 0),
        ] {
            let mut streams = lined_up(&[(3, own, 2 * LONG_LEN), (3, other, 9000)]);
            streams.state.passed = passed;
            let (next, _) = streams.state.next_to_write(&mut streams.table);
            assert_eq!(next, Some(at));
        }
    }

    #[test]
    fn a_turn_does_not_end_with_what_has_been_written() {
        let mut streams = lined_up(&[(3, 9, 2 * LONG_LEN)]);
        streams.state.passed = TURN_LEN as u16;
        streams.write_stream_frames(&mut Vec::new(), 1200, &mut Frames::default());
        assert_eq!(u64::from(streams.state.passed), TURN_LEN + 9);
    }
}
