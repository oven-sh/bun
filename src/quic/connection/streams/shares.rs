//! Whose turn it is to write if streams are not sent in order: the one that has the least left goes first, unless the
//! share of another one is overdue.

use super::send::{BULK_LEN, MIN_UNSENT, WRITE_CHUNK, first_serial};
use super::stream::{Flags, Stream};
use super::{State, Table};
use crate::StreamId;

const SHARE: u64 = 64 * 1024;
/// For how many bytes a share that is due makes way for streams with up to [`BULK_LEN`] left.
const GRACE: u64 = 4 * SHARE;
/// A rank is made of when the share is due and of what is left, in these units.
const DUE_UNIT: u64 = 1024;
const LEFT_UNIT: u64 = 4096;
const LEFT_BITS: u32 = 8;
const MAX_LEFT: u64 = (1 << LEFT_BITS) - 1;

#[inline]
fn left(rank: u64) -> u64 {
    rank & MAX_LEFT
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
    /// For when the application offers `len` bytes.
    #[inline]
    pub(crate) fn expect(&self, stream: &mut Stream, len: u64) {
        if len > stream.unwritten && !self.sends_in_order {
            let has_waited = stream.write_round == self.write_round;
            if stream.unwritten + stream.send.unsent_len() == 0 && !has_waited {
                stream.busy_from = stream.send.end();
            }
            let may_be_last = stream.take(Flags::HAS_LONG_PIECES) && len <= MIN_UNSENT;
            let keeps_coming = stream.send.end() >= stream.busy_from + BULK_LEN && !may_be_last;
            stream.flags.set(Flags::KEEPS_COMING, keeps_coming);
            stream.flags.set(Flags::HAS_LONG_PIECES, len > MIN_UNSENT);
        }
    }

    /// What tells the time.
    #[inline]
    fn written(&self) -> u64 {
        (self.sent + self.unsent) / DUE_UNIT
    }

    /// Whether it goes before a stream that has `rival` left.
    #[inline]
    fn is_overdue(&self, rank: u64, rival: u64) -> bool {
        let makes_way = rival < left(rank) && rival <= BULK_LEN / LEFT_UNIT;
        (rank >> LEFT_BITS) + u64::from(makes_way) * (GRACE / DUE_UNIT) <= self.written()
    }

    /// By streams that are too short to ever wait.
    #[inline]
    pub(super) fn is_any_starved(&self) -> bool {
        !self.sends_in_order && (self.writable.front()).is_some_and(|it| self.is_overdue(it.0, 0))
    }

    pub(super) fn has_to_wait(&self, id: StreamId, stream: &Stream, len: u64) -> bool {
        let own = stream.left(len);
        (self.writable.iter())
            .any(|&(rank, it)| it != id && (left(rank) <= own || self.is_overdue(rank, own)))
    }

    /// How many bytes can be unsent on top of the target, so that there is room when a short stream comes along.
    #[inline]
    pub(super) fn extra_unsent(&self, stream: &Stream, len: u64) -> u64 {
        u64::from(!self.sends_in_order && stream.left(len) <= SHARE / LEFT_UNIT) * SHARE
    }

    /// For a stream whose turn it is.
    #[inline]
    pub(super) fn max_write(&self, stream: &Stream) -> u64 {
        match self.sends_in_order || self.writable.is_empty() || stream.due > self.written() {
            true => u64::MAX,
            false => stream.share.max(MIN_UNSENT),
        }
    }

    /// A share is due when all streams could have had one, and streams that are about as long get half of the path.
    pub(super) fn rank_share(&self, stream: &mut Stream) -> u64 {
        let own = stream.left(stream.unwritten);
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
    pub(super) fn next_share(&self, table: &Table) -> Option<usize> {
        let line = &self.writable;
        let is_ready = |&(_, id): &(u64, StreamId)| {
            (table.get(id)).is_some_and(|it| it.write_round != self.write_round)
        };
        if !self.has_little_unsent() {
            let has_run_dry = |id| table.get(id).is_some_and(|it| it.send.unsent_len() == 0);
            let mut starved = line.iter().take_while(|it| self.is_overdue(it.0, 0));
            return starved.position(|it| is_ready(it) && has_run_dry(it.1));
        }
        let (at, shortest) = line.iter().enumerate().min_by_key(|it| left(it.1.0))?;
        let least = left(shortest.0);
        let mut overdue = line.iter().take_while(|it| self.is_overdue(it.0, least));
        if let at @ Some(_) = overdue.position(is_ready) {
            return at;
        }
        if !is_ready(shortest) {
            return line.iter().position(is_ready);
        }
        let len = least * LEFT_UNIT;
        let makes_way = len >= WRITE_CHUNK
            && self.unsent > 2 * WRITE_CHUNK
            && (first_serial(&self.sendable).and_then(|at| table.get(self.sendable.get(at)?.1)))
                .is_some_and(|ending| ending.send.unsent_len() < len);
        (!makes_way).then_some(at)
    }
}
