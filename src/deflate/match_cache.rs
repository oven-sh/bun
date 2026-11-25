//! The matches that start at each byte of a block.

use crate::Result;
use crate::format::{MIN_MATCH_LEN, OFFSET_SYMBOLS, offset_slot_of};
use core::cell::Cell;

/// How many lengths a [`Summary`] has the offset slots of.
pub(crate) const SHORT_LENS: usize = 8;
pub(crate) const MIN_LONG_LEN: usize = MIN_MATCH_LEN + SHORT_LENS;
const SLOT_BITS: u32 = OFFSET_SYMBOLS.ilog2();
/// For a length that no match has.
pub(crate) const NO_SLOT: usize = OFFSET_SYMBOLS - 1;
const SLOTS_BITS: u32 = SHORT_LENS as u32 * SLOT_BITS;
const ALL_SLOTS: u64 = (1 << SLOTS_BITS) - 1;
const HAS_LONG: u64 = 1 << 62;
const HAS_ANY: u64 = 1 << 63;
/// How far a [`Summary`] can count.
pub(crate) const MAX_MATCHES: usize = (HAS_LONG >> SLOTS_BITS) as usize - 1;

#[derive(Clone, Copy)]
pub(crate) struct Match {
    pub(crate) len: u16,
    pub(crate) offset: u16,
}

/// From the lowest bit on: for each short length the offset slot of the shortest match that has it, where the matches end in the cache, flags.
#[derive(Clone, Copy)]
pub(crate) struct Summary(u64);

impl Summary {
    /// The slots of two lengths from `MIN_MATCH_LEN + 2 * pair` on.
    #[inline(always)]
    pub(crate) fn slots(self, pair: usize) -> usize {
        (self.0 >> (2 * SLOT_BITS * pair as u32)) as usize
    }

    #[inline(always)]
    pub(crate) fn has_long(self) -> bool {
        self.0 & HAS_LONG != 0
    }

    #[inline(always)]
    pub(crate) fn neither_has_matches(self, other: Self) -> bool {
        self.0 | other.0 < HAS_ANY
    }

    #[inline(always)]
    fn matches_end(self) -> usize {
        ((self.0 % HAS_LONG) >> SLOTS_BITS) as usize
    }
}

#[derive(Default)]
pub(crate) struct MatchCache {
    /// Only the first `byte_count` are valid.
    summaries: Vec<Summary>,
    byte_count: usize,
    matches: Vec<Match>,
}

impl MatchCache {
    pub(crate) fn reset(&mut self, most_bytes: usize, most_matches: usize) -> Result<()> {
        self.byte_count = 0;
        self.matches.clear();
        let more_bytes = most_bytes.saturating_sub(self.summaries.len());
        self.summaries.try_reserve_exact(more_bytes)?;
        Ok(self.matches.try_reserve_exact(most_matches)?)
    }

    /// Counts both bytes and matches.
    pub(crate) fn len(&self) -> usize {
        self.byte_count + self.matches.len()
    }

    pub(crate) fn summaries(&self) -> &[Summary] {
        &self.summaries
    }

    /// The shortest first.
    #[inline(always)]
    pub(crate) fn matches_at(&self, byte: usize) -> &[Match] {
        let end = |byte| {
            self.summaries
                .get(byte)
                .map_or(0, |summary: &Summary| summary.matches_end())
        };
        let range = end(byte.wrapping_sub(1))..end(byte);
        self.matches.get(range).unwrap_or_default()
    }

    /// The offset of the shortest match at `byte` that has at least `len` bytes.
    #[inline(always)]
    pub(crate) fn offset_for(&self, byte: usize, len: u16) -> u16 {
        let long_enough = self.matches_at(byte).iter().rev();
        let long_enough = long_enough.take_while(|cached| cached.len >= len);
        long_enough.last().map_or(0, |cached| cached.offset)
    }

    /// 0 if there is no match.
    #[inline(always)]
    pub(crate) fn longest_len(&self, byte: usize) -> usize {
        match self.summaries.get(byte) {
            Some(summary) if summary.0 >= HAS_ANY => {
                let longest = self.matches.get(summary.matches_end().wrapping_sub(1));
                longest.map_or(0, |cached| cached.len.into())
            }
            _ => 0,
        }
    }

    /// Adds up to `most` bytes and returns how many. `find` adds the matches of one, and returns whether to stop.
    #[inline(always)]
    pub(crate) fn add_bytes(
        &mut self,
        most: usize,
        mut find: impl FnMut(usize, &mut Adder<'_>) -> bool,
    ) -> usize {
        let end = self.summaries.capacity().min(self.byte_count + most);
        if self.summaries.len() < end {
            self.summaries.resize(end, Summary(0));
        }
        let mut count = 0;
        let mut summary = (self.matches.len() as u64) << SLOTS_BITS;
        let summaries = self.summaries.get_mut(self.byte_count..end);
        for to in summaries.unwrap_or_default() {
            let mut adder = Adder {
                matches: &mut self.matches,
                summary: (summary % HAS_LONG) | ALL_SLOTS,
                unmatched: ALL_SLOTS,
            };
            let is_last = find(count, &mut adder);
            summary = adder.summary;
            *to = Summary(summary);
            count += 1;
            if is_last {
                break;
            }
        }
        self.byte_count += count;
        count
    }

    pub(crate) fn remove_bytes(&mut self, count: usize) {
        let last = self.summaries.get(count.wrapping_sub(1));
        let matches = last.map_or(0, |summary| summary.matches_end().min(self.matches.len()));
        self.matches.drain(..matches);
        let summaries = Cell::from_mut(self.summaries.as_mut_slice()).as_slice_of_cells();
        let kept = summaries.get(count..self.byte_count).unwrap_or_default();
        for (to, from) in summaries.iter().zip(kept) {
            to.set(Summary(from.get().0 - ((matches as u64) << SLOTS_BITS)));
        }
        self.byte_count = kept.len();
    }
}

pub(crate) struct Adder<'a> {
    matches: &'a mut Vec<Match>,
    summary: u64,
    /// The bits of `summary` that are for the slots of lengths that no match has so far.
    unmatched: u64,
}

impl Adder<'_> {
    /// `len` is more than that of the match before.
    #[inline(always)]
    pub(crate) fn add(&mut self, len: usize, offset: usize) {
        const ONES: u64 = ALL_SLOTS / NO_SLOT as u64;
        let matched_lens = len.min(MIN_LONG_LEN - 1) + 1 - MIN_MATCH_LEN;
        let unmatched = (u64::MAX << (SLOT_BITS * matched_lens as u32)) & ALL_SLOTS;
        let unset = ONES * (NO_SLOT - offset_slot_of(offset)) as u64;
        let has_long = if len >= MIN_LONG_LEN { HAS_LONG } else { 0 };
        self.summary ^= unset & (self.unmatched ^ unmatched);
        self.summary = (self.summary + (1 << SLOTS_BITS)) | has_long | HAS_ANY;
        self.unmatched = unmatched;
        _ = self.matches.push_within_capacity(Match {
            len: len as u16,
            offset: offset as u16,
        });
    }
}
