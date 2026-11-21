//! Whose turn it is to write if streams are not sent in order: the one that has the least left goes first, unless the
//! share of another one is overdue.

use super::send::{BULK_LEN, LITTLE, MIN_UNSENT, WRITE_CHUNK, first_serial};
use super::stream::{Flags, Stream};
use super::{State, Table};
use crate::StreamId;
use crate::time::{Duration, Instant};

const SHARE: u64 = 64 * 1024;
/// For how many bytes a share that is due makes way for streams with up to [`BULK_LEN`] left.
const GRACE: u64 = 4 * SHARE;
/// A rank is made of when the share is due and of what is left, in these units.
const DUE_UNIT: u64 = 1024;
const LEFT_UNIT: u64 = 4096;
const LEFT_BITS: u32 = 8;
const MAX_LEFT: u64 = (1 << LEFT_BITS) - 1;
const MAX_SHORT: u64 = BULK_LEN / LEFT_UNIT;
/// A stream that has waited for a whole period may write a few bytes, so that the peer does not give up on it.
const PERIOD: Duration = Duration::from_secs(1);
const CRUMB: u64 = 1024;
const SENT_PER_CRUMB: u64 = 4 * CRUMB;

#[inline]
fn due(rank: u64) -> u64 {
    rank >> LEFT_BITS
}

#[inline]
fn left(rank: u64) -> u64 {
    rank & MAX_LEFT
}

/// What a stream whose turn it is may write while others wait.
#[derive(Default)]
pub(super) struct Allowance {
    /// An offset.
    end: u64,
    /// There is no end if it has less left.
    free_below: u64,
    /// That comes on top of its turn.
    is_crumb: bool,
}

#[derive(Default)]
pub(super) struct Crumbs {
    period: u64,
    period_end: Instant,
    /// False if no stream has waited for too long.
    may_be_needed: bool,
    /// What `sent` has to reach.
    next_after: u64,
}

impl Stream {
    /// The further it has come, the closer it is to its end, unless it is endless.
    fn guess_left(&self) -> u64 {
        let progress = (self.send.end() - self.busy_from) / (2 * LEFT_UNIT);
        match progress < MAX_LEFT - BULK_LEN / LEFT_UNIT {
            true => MAX_LEFT - progress,
            false => MAX_LEFT,
        }
    }

    #[inline]
    fn left(&self, len: u64) -> u64 {
        match self.flags.contains(Flags::KEEPS_COMING) {
            true => self.guess_left(),
            false => len.div_ceil(LEFT_UNIT).min(MAX_LEFT),
        }
    }
}

impl State {
    #[inline]
    pub(crate) fn on_offered(&self, id: StreamId, stream: &mut Stream, len: u64) {
        if len > stream.unwritten && !self.sends_in_order {
            let has_waited = stream.write_round == self.write_round || self.has_crumb(id, stream);
            if stream.unwritten + stream.send.unsent_len() == 0 && !has_waited {
                stream.busy_from = stream.send.end();
            }
            let may_be_last = stream.flags.contains(Flags::HAS_LONG_PIECES) && len <= MIN_UNSENT;
            let keeps_coming = stream.send.end() >= stream.busy_from + BULK_LEN && !may_be_last;
            stream.flags.set(Flags::KEEPS_COMING, keeps_coming);
            stream.flags.set(Flags::HAS_LONG_PIECES, len > MIN_UNSENT);
        }
    }

    /// What the peer has not read takes up room that other streams could use. If there is much of it, long streams go by
    /// how full their own windows are.
    #[inline]
    fn left(&self, stream: &Stream, len: u64) -> u64 {
        match stream.left(len) {
            left if left > MAX_SHORT && self.is_peer_behind => {
                let used = stream.send_window.saturating_sub(stream.send_credit());
                MAX_SHORT + 1 + used / (stream.send_window / (MAX_LEFT - MAX_SHORT - 1) + 1)
            }
            left => left,
        }
    }

    /// What shares are due by.
    #[inline]
    fn written(&self) -> u64 {
        (self.sent + self.unsent) / DUE_UNIT
    }

    /// Whether it goes before a stream that has `rival` left.
    #[inline]
    fn is_overdue(&self, rank: u64, rival: u64) -> bool {
        let makes_way = rival < left(rank) && rival <= MAX_SHORT;
        due(rank) + u64::from(makes_way) * (GRACE / DUE_UNIT) <= self.written()
    }

    /// With their places in `writable`.
    #[inline]
    fn overdue(&self, rival: u64) -> impl Iterator<Item = (usize, &(u64, StreamId))> {
        (self.writable.iter().enumerate())
            .take_while(|it| due(it.1.0) <= self.written())
            .filter(move |it| self.is_overdue(it.1.0, rival))
    }

    #[inline]
    pub(super) fn renew_crumbs(&mut self, now: Instant) {
        self.allowance.is_crumb = false;
        if now >= self.crumbs.period_end {
            self.crumbs.period += 1;
            (self.crumbs.period_end, self.crumbs.may_be_needed) = (now + PERIOD, true);
        }
    }

    #[inline]
    fn is_crumb_due(&self) -> bool {
        self.crumbs.may_be_needed && self.crumbs.next_after <= self.sent
    }

    #[inline]
    fn is_invited(&self, id: StreamId) -> bool {
        self.invited.is_some_and(|it| it.0 == id)
    }

    #[inline]
    pub(super) fn has_crumb(&self, id: StreamId, stream: &Stream) -> bool {
        self.allowance.is_crumb && self.is_invited(id) && stream.send.end() <= self.allowance.end
    }

    /// For example by streams that are too short to ever wait.
    #[inline]
    pub(super) fn may_starve_any(&self) -> bool {
        !self.sends_in_order && (self.is_crumb_due() || self.overdue(0).next().is_some())
    }

    #[inline]
    fn has_to_wait(&self, id: StreamId, own: u64) -> bool {
        (self.writable.iter())
            .any(|&(rank, it)| it != id && (left(rank) <= own || self.is_overdue(rank, own)))
    }

    /// How many bytes are welcome if the application has `len`.
    #[inline]
    pub(super) fn wanted_from(&self, id: StreamId, stream: &Stream, len: u64) -> u64 {
        let (own, unsent) = (self.left(stream, len), stream.send.unsent_len());
        let allowed = self.allowance.end.saturating_sub(stream.send.end());
        let max = match self.is_invited(id) {
            _ if self.writable.is_empty() => u64::MAX,
            true if own < self.allowance.free_below => u64::MAX,
            true if allowed >= self.min_credit => allowed,
            _ if !self.has_to_wait(id, own) => u64::MAX,
            _ if stream.unwritten > 0 && stream.flags.contains(Flags::IN_WRITABLE) => 0,
            _ if len > MIN_UNSENT => LITTLE.saturating_sub(unsent),
            _ => MIN_UNSENT.saturating_sub(unsent),
        };
        // So that there is room when a short stream comes along.
        let extra = u64::from(own <= SHARE / LEFT_UNIT) * SHARE;
        let shared = (self.unsent_target + extra).saturating_sub(self.unsent);
        shared.max(MIN_UNSENT.saturating_sub(unsent)).min(max)
    }

    /// A share is due when all streams could have had one, and streams that are about as long get half of the path.
    pub(super) fn start_waiting(&self, stream: &mut Stream) -> u64 {
        stream.waits_since = self.crumbs.period;
        let own = self.left(stream, stream.unwritten);
        if stream.share < MIN_UNSENT {
            let len = own * LEFT_UNIT;
            let (mut round, mut alike) = (len.min(SHARE), 1);
            for &(rank, _) in &self.writable {
                round += (left(rank) * LEFT_UNIT).min(SHARE);
                alike += u64::from(2 * left(rank) >= own);
            }
            // With room for the headers of frames.
            stream.share = LEFT_UNIT + if len <= BULK_LEN { len } else { SHARE };
            let delay = round.saturating_sub(GRACE).max(2 * alike * SHARE);
            stream.due = self.written() + stream.share / DUE_UNIT * delay / SHARE;
        }
        stream.due << LEFT_BITS | own
    }

    /// Where it is in `writable`.
    pub(super) fn next_writer(&mut self, table: &Table) -> Option<usize> {
        let crumb = self.next_crumb(table);
        let at = crumb.or_else(|| self.next_share(table));
        let entry = at.and_then(|at| self.writable.get(at));
        let (rank, stream) = entry.and_then(|it| Some(it.0).zip(table.get(it.1)))?;
        let is_due = due(rank) <= self.written() && left(rank) > 0
            || self.is_peer_behind && left(rank) > MAX_SHORT;
        let (len, free_below) = match (crumb, is_due) {
            (Some(_), _) => (CRUMB, 0),
            (None, true) => (stream.share, 0),
            (None, false) => (stream.share, left(rank).max(SHARE / LEFT_UNIT) + 1),
        };
        self.invited = None;
        self.allowance = Allowance {
            end: stream.send.end() + len,
            free_below,
            is_crumb: crumb.is_some(),
        };
        at
    }

    fn next_crumb(&mut self, table: &Table) -> Option<usize> {
        if !self.is_crumb_due() {
            return None;
        }
        let waits_since = |&(_, id): &(u64, StreamId)| {
            let stream = table.get(id).filter(|it| it.send.unsent_len() == 0);
            stream.map_or(u64::MAX, |it| it.waits_since)
        };
        let at = (self.writable.iter().map(waits_since).zip(0..).min())
            .filter(|it| it.0 < self.crumbs.period - 1)
            .map(|it| it.1);
        let earliest = self.sent.saturating_sub(WRITE_CHUNK);
        self.crumbs.may_be_needed = at.is_some();
        self.crumbs.next_after = self.crumbs.next_after.max(earliest) + SENT_PER_CRUMB;
        at
    }

    fn next_share(&self, table: &Table) -> Option<usize> {
        let line = &self.writable;
        let is_ready = |&(_, id): &(u64, StreamId)| {
            (table.get(id)).is_some_and(|it| it.write_round != self.write_round)
        };
        if !self.has_little_unsent() {
            let has_run_dry = |id| table.get(id).is_some_and(|it| it.send.unsent_len() == 0);
            let mut starved = self.overdue(0);
            return (starved.find(|it| is_ready(it.1) && has_run_dry(it.1.1))).map(|it| it.0);
        }
        let shortest = line.iter().enumerate().min_by_key(|it| left(it.1.0));
        let overdue = shortest.and_then(|it| self.overdue(left(it.1.0)).find(|it| is_ready(it.1)));
        if let Some((at, _)) = overdue {
            return Some(at);
        }
        let Some((at, &(rank, _))) = shortest.filter(|it| is_ready(it.1)) else {
            return line.iter().position(is_ready);
        };
        let len = left(rank) * LEFT_UNIT;
        let makes_way = len >= WRITE_CHUNK
            && self.unsent > 2 * WRITE_CHUNK
            && (first_serial(&self.sendable).and_then(|at| self.sendable.get(at)))
                .and_then(|it| table.get(it.1))
                .is_some_and(|ending| ending.send.unsent_len() < len);
        (!makes_way).then_some(at)
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Role, Streams};
    use super::*;
    use crate::connection::sent::Frames;
    use crate::{Config, Direction, Side};

    const K: u64 = 1024;

    fn stream(sent: u64, unsent: u64, unwritten: u64) -> Stream {
        let mut stream = Stream::new(Role::Raw, Flags::empty(), u64::MAX, 0);
        stream.send.write(&vec![0; (sent + unsent) as usize]);
        stream.send.send(0..sent, &mut Vec::new());
        stream.set_unwritten(unwritten);
        stream
    }

    fn streams() -> Streams {
        let config = Config::client();
        let mut streams = Streams::new(Side::Server, &config.parameters, &config, 0);
        streams.set_peer_parameters(&config.parameters);
        (streams.state.unsent_target, streams.state.max_retained) = (200 * K, 900 * K);
        streams
    }

    fn open(streams: &mut Streams, written: u64, unwritten: u64) {
        let Streams { table, state, .. } = streams;
        let opened = table.open(Direction::Bidirectional, None, state);
        crate::with(opened, |(id, stream)| {
            stream.send_limit = u64::MAX;
            state.write(id, stream, &[&vec![0; written as usize]]);
            stream.set_unwritten(unwritten);
            match unwritten {
                0 => state.finish(id, stream),
                _ => state.want_write(id, stream),
            }
        });
    }

    #[test]
    fn what_keeps_coming_is_taken_to_be_closer_to_its_end() {
        for (busy_from, sent, unsent, unwritten, left) in [
            (0, 128 * K, 0, 0, 5),
            (0, 128 * K, 0, 1, 239),
            (0, 128 * K - 1, 1, 0, 239),
            (0, 128 * K - 2, 1, 0, 5),
            (64 * K, 192 * K, 1, 0, 239),
            (0, 1784 * K - 2, 1, 0, 33),
            (0, 1784 * K - 1, 1, 0, 255),
        ] {
            let (state, mut stream) = (streams().state, stream(sent, unsent, unwritten));
            stream.busy_from = busy_from;
            state.on_offered(StreamId(1), &mut stream, 20 * K);
            assert_eq!(stream.left(20 * K), left);
        }
    }

    #[test]
    fn shares_are_due_when_the_others_could_have_had_theirs() {
        for (own, count, other, share, after) in [
            (900, 0, 0, 68, 136),
            (900, 1, 452, 68, 272),
            (900, 1, 448, 68, 136),
            (900, 10, 100, 68, 476),
            (900, 20, 20, 68, 221),
            (132, 0, 0, 68, 136),
            (128, 0, 0, 132, 264),
            (40, 40, 16, 44, 291),
            (0, 3, 900, 4, 32),
        ] {
            let (mut state, mut stream) = (State::default(), stream(0, 0, own * K));
            (state.sent, state.unsent) = (7 * K, 2 * K);
            (state.writable).resize(count, (other * K / LEFT_UNIT, StreamId(5)));
            let rank = state.start_waiting(&mut stream);
            assert_eq!((stream.share, due(rank)), (share * K, 9 + after));
            for (rest, is_kept) in [(8 * K, true), (8 * K - 1, false)] {
                (stream.share, state.sent) = (rest, 8 * K);
                assert_eq!(due(state.start_waiting(&mut stream)) == due(rank), is_kept);
            }
        }
    }

    #[test]
    fn shares_that_are_due_only_make_way_for_short_streams() {
        for (left, written, rival, holds_up, may_starve) in [
            (255, 99, 132, false, false),
            (255, 100, 132, true, false),
            (255, 355, 128, false, false),
            (255, 356, 128, true, true),
            (1, 355, 0, false, false),
            (0, 99, 0, true, false),
            (0, 100, 0, true, true),
        ] {
            let state = State {
                sent: written * K,
                writable: [(100 << LEFT_BITS | left, StreamId(1))].into(),
                ..State::default()
            };
            assert_eq!(
                state.has_to_wait(StreamId(5), rival * K / LEFT_UNIT),
                holds_up
            );
            assert_eq!(state.may_starve_any(), may_starve);
        }
    }

    #[test]
    fn long_streams_go_by_their_windows_while_the_peer_is_behind() {
        for (is_peer_behind, unwritten, limit, left) in [
            (false, 900, 100, 225),
            (true, 900, 100, 143),
            (true, 900, 200, 88),
            (true, 900, 50, 254),
            (true, 128, 100, 32),
            (true, 132, 100, 143),
        ] {
            let mut state = State {
                is_peer_behind,
                ..State::default()
            };
            let mut stream = stream(0, 50 * K, unwritten * K);
            (stream.send_limit, stream.send_window) = (50 * K, 50 * K);
            state.raise_send_limit(StreamId(1), &mut stream, limit * K);
            assert_eq!(state.left(&stream, unwritten * K), left);
        }
    }

    #[test]
    fn allowance_holds_while_it_is_good_for_a_write() {
        for (end, wanted) in [(9, 9), (8, LITTLE)] {
            let mut state = State {
                min_credit: 9,
                invited: Some((StreamId(1), false)),
                writable: [(0, StreamId(5))].into(),
                ..State::default()
            };
            state.allowance.end = end;
            let stream = stream(0, 0, 0);
            assert_eq!(state.wanted_from(StreamId(1), &stream, 900 * K), wanted);
        }
    }

    #[test]
    fn room_is_left_unused_while_a_shorter_stream_ends() {
        for (waiting, ending, unsent, is_due, is_asked) in [
            (32 * K, 32 * K - 1, 64 * K + 1, false, false),
            (32 * K, 32 * K, 64 * K + 1, false, true),
            (32 * K, 32 * K - 1, 64 * K, false, true),
            (28 * K, 20 * K, 64 * K + 1, false, true),
            (32 * K, 32 * K - 1, 64 * K + 1, true, true),
        ] {
            let mut streams = streams();
            open(&mut streams, 16 * K + ending, 0);
            let end = 16 * K as usize + 2;
            streams.write_stream_frames(&mut Vec::new(), end, &mut Frames::default());
            open(&mut streams, unsent - ending, waiting);
            streams.state.sent += u64::from(is_due) * 72 * K;
            assert_eq!(streams.poll_writable().is_some(), is_asked);
        }
    }

    #[test]
    fn neglected_streams_are_looked_for_once_in_a_period() {
        let mut streams = streams();
        open(&mut streams, 200 * K, 900 * K);
        for (seconds, is_looked_for) in [(1, true), (1, false), (2, true)] {
            (streams.state).start_write_round(Instant::from_micros(seconds * 1_000_000));
            streams.state.sent += SENT_PER_CRUMB;
            assert_eq!(streams.state.awaits_writes(), is_looked_for);
            assert!(streams.poll_writable().is_none());
        }
    }
}
