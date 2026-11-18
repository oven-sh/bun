//! Hash tables that find earlier occurrences of the input.

mod binary_tree;
mod buckets;
mod chains;
mod quick;
mod rolling;
mod slots;
mod small;

pub(super) use binary_tree::{BinaryTree, Candidate, Candidates};
pub(super) use buckets::{Buckets, TaggedBuckets};
pub(super) use chains::{Chains, ForgetfulChains};
pub(super) use quick::Quick;
pub(super) use rolling::WithRolling;
pub(super) use slots::{Dense, Linked, Paged};
pub(super) use small::{MAX_SMALL_INPUT_SIZE, Small};

use core::hint::{Locality, prefetch_read};

use bun_highway::brotli::short_codes;
use bun_highway::common_prefix_length;

use super::input_block::InputBlock;
use super::log2::log2_floor;
use super::matching::{bytes_at, load32, load64};
use super::ring_buffer::{SLACK, Window};
use super::words::QuickWordSearch;
use crate::memory::Result;

// https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/hash.h#L94
const SCORE_BASE: usize = 1920;
const SCORE_PER_BYTE: usize = 135;
pub(super) const MIN_SCORE: usize = SCORE_BASE + 100;

#[inline(always)]
pub(super) fn score(length: usize, distance: usize) -> usize {
    SCORE_BASE + SCORE_PER_BYTE * length - 30 * log2_floor(distance) as usize
}

/// With the distance that short code `index` stands for.
#[inline(always)]
pub(super) fn score_of_recent(length: usize, index: usize) -> usize {
    let penalty = if index == 0 {
        0
    } else {
        39 + ((0x1CA10 >> (index & 0xE)) & 0xE)
    };
    SCORE_BASE + SCORE_PER_BYTE * length + 15 - penalty
}

#[derive(Clone, Copy)]
pub(super) struct Match {
    pub(super) length: usize,
    /// How much longer the word of the static dictionary is.
    pub(super) omitted: usize,
    pub(super) distance: usize,
    pub(super) score: usize,
}

impl Match {
    const NONE: Self = Self {
        length: 0,
        omitted: 0,
        distance: 0,
        score: MIN_SCORE,
    };

    #[inline(always)]
    pub(super) fn new(length: usize, distance: usize, score: usize) -> Self {
        Self {
            length,
            omitted: 0,
            distance,
            score,
        }
    }
}

/// Stores that miss the cache wait for each other, and prefetches do not.
#[inline(always)]
fn prefetch_for_store<T>(slot: &T) {
    prefetch_read(slot, Locality::L1);
}

/// What the short distance codes stand for.
pub(super) type RecentDistances = [i32; 16];

pub(super) struct Search<'a> {
    pub(super) window: Window<'a>,
    pub(super) position: usize,
    /// The input from `position` to the end of the block, and [`SLACK`] bytes.
    pub(super) padded: &'a [u8],
    /// How far back the window reaches.
    pub(super) max_backward: usize,
    pub(super) block: &'a InputBlock<'a>,
    /// A match that scores no higher is of no use. Only if [`InputBlock::is_contiguous`].
    pub(super) to_beat: usize,
}

/// Whether the distance is in `1..=max_backward`.
#[inline(always)]
fn is_within(max_backward: usize, position: usize, earlier: usize) -> bool {
    max_backward.wrapping_sub(position).wrapping_add(earlier) < max_backward
}

/// From there on, comparing more bytes at a time makes up for a call.
const LONG_MATCH: usize = 64;

/// Of what has [`LONG_MATCH`] bytes in common. Its callers have no registers to spare.
#[cold]
#[inline(never)]
extern "rust-cold" fn long_match_length(a: &[u8], b: &[u8]) -> usize {
    LONG_MATCH + common_prefix_length(&a[LONG_MATCH..], &b[LONG_MATCH..])
}

impl<'a> Search<'a> {
    #[inline(always)]
    fn data(&self) -> &'a [u8] {
        &self.padded[..self.padded.len() - SLACK]
    }

    #[inline(always)]
    fn first_eight(&self) -> u64 {
        load64(self.padded, 0)
    }

    #[inline(always)]
    fn reaches(&self, distance: usize) -> bool {
        distance.wrapping_sub(1) < self.max_backward
    }

    /// [`Self::reaches`] for a position, in fewer steps for each of many.
    #[inline(always)]
    fn reaches_back_to(&self, earlier: usize) -> bool {
        is_within(self.max_backward, self.position, earlier)
    }

    #[inline(always)]
    fn is_in_ring(&self, offset: usize) -> bool {
        offset <= self.window.before_end(self.position)
    }

    /// The bits that differ in the first eight bytes.
    #[inline(always)]
    fn difference_at(&self, masked: usize) -> u64 {
        load64(self.window.bytes, masked) ^ self.first_eight()
    }

    #[inline(always)]
    fn match_length_at(&self, masked: usize) -> usize {
        self.match_length_with::<true>(masked, self.difference_at(masked))
    }

    #[inline(always)]
    fn match_length_with<const MAY_CALL: bool>(&self, masked: usize, mut difference: u64) -> usize {
        let mut matched = 0;
        if difference == 0 {
            let other = &self.window.bytes[masked..];
            let length = other.len().min(self.padded.len());
            let (a, b) = (&other[..length], &self.padded[..length]);
            while difference == 0 && matched + 16 <= length {
                if MAY_CALL && matched == LONG_MATCH {
                    return long_match_length(a, b).min(self.padded.len() - SLACK);
                }
                matched += 8;
                difference = load64(a, matched) ^ load64(b, matched);
            }
        }
        (matched + (difference.trailing_zeros() / 8) as usize).min(self.padded.len() - SLACK)
    }

    /// A bit for each of the first `count`, from four on, that may match for two bytes.
    #[inline(always)]
    fn promising(&self, recent: &RecentDistances, count: usize) -> u32 {
        let (window, pair) = (self.window, bytes_at(self.padded, 0));
        let last = recent.first_chunk().unwrap_or(&[0; 4]);
        if count > last.len() {
            let place = window.place(self.position, 0, pair);
            return short_codes(place, last) & ((1 << count) - 1);
        }
        let may_match = |distance: i32| {
            let earlier = window.index(self.position.wrapping_sub(distance as usize));
            bytes_at(window.bytes, earlier.min(window.bytes.len() - 2)) == pair
        };
        (0..last.len()).fold(0, |bits, i| bits | (u32::from(may_match(last[i])) << i))
    }

    /// Returns the length that further matches have to exceed.
    #[inline(always)]
    fn try_recent(&self, recent: &RecentDistances, count: usize, best: &mut Match) -> usize {
        let mut promising = self.promising(recent, count);
        let ring = self.window.without_tail();
        let mut next_byte = self.padded[0];
        while promising != 0 {
            let i = promising.trailing_zeros() as usize;
            promising &= promising - 1;
            let distance = recent[i % recent.len()] as usize;
            let earlier = self.window.index(self.position.wrapping_sub(distance));
            if !self.reaches(distance) || ring.get(earlier + best.length) != Some(&next_byte) {
                continue;
            }
            let length = self.match_length_at(earlier);
            if length >= 3 || (length == 2 && i < 2) {
                let score = score_of_recent(length, i);
                if best.score < score {
                    *best = Match::new(length, distance, score);
                    if !self.is_in_ring(length) {
                        break;
                    }
                    next_byte = self.padded[length];
                }
            }
        }
        best.length.max(3)
    }

    /// Raises `best` to `to_beat`, and `length` to what positions from `nearest` back have to exceed then.
    #[inline(always)]
    fn raise(
        &self,
        length: usize,
        nearest: usize,
        words: &QuickWordSearch,
        best: &mut Match,
    ) -> usize {
        if best.score >= self.to_beat || !self.reaches(nearest) {
            return length;
        }
        let max_length = self.padded.len() - SLACK;
        let matches = || {
            let difference = self.difference_at(self.window.index(self.position - nearest));
            let short = ((difference.trailing_zeros() / 8) as usize).min(max_length);
            short >= 4 && score(short, nearest) > MIN_SCORE
        };
        // Words are counted where nothing matches.
        if best.score == MIN_SCORE && words.is_active() && !matches() {
            return length;
        }
        let too_short = (self.to_beat - score(0, nearest)) as u32 / SCORE_PER_BYTE as u32;
        best.score = self.to_beat;
        length.max(max_length.min(too_short as usize))
    }

    #[inline(always)]
    fn try_words(&self, words: &mut QuickWordSearch, candidates: usize, best: &mut Match) {
        if best.score == MIN_SCORE && words.is_active() {
            let first = self.block.max_copy_distance(self.position) + 1;
            let max = self.block.params.distance.max_distance;
            if let Some(word) = words.find(self.padded, candidates, first, max) {
                *best = word;
            }
        }
    }
}

/// Rejects most of the positions that do not match for longer than the best one so far.
struct Filter<'a> {
    /// The ring, less as many bytes as come before `last_four`.
    shifted: &'a [u8],
    last_four: u32,
}

impl<'a> Filter<'a> {
    /// Shorter matches do not take long to compare.
    const LONG: usize = 16;

    /// `length` is at least 3.
    #[inline(always)]
    fn new(search: &Search<'a>, length: usize) -> Self {
        let ring = search.window.without_tail();
        Self {
            shifted: if search.is_in_ring(length) {
                &ring[length - 3..]
            } else {
                &[]
            },
            last_four: load32(search.padded, length - 3),
        }
    }

    /// Leaves out the last ones of the ascending `positions`, up to one that passes or is out of reach.
    #[inline(always)]
    fn skip<'b>(&self, search: &Search<'a>, positions: &'b [u32]) -> &'b [u32] {
        match (search.position - search.max_backward) as u32 {
            0 => self.skip_while(search.window, positions, |_| true),
            oldest => self.skip_while(search.window, positions, |position| position >= oldest),
        }
    }

    #[inline(always)]
    fn skip_while<'b>(
        &self,
        window: Window<'_>,
        mut positions: &'b [u32],
        is_in_reach: impl Fn(u32) -> bool,
    ) -> &'b [u32] {
        let Some(last) = self.shifted.len().checked_sub(4) else {
            return &[];
        };
        while let &[ref rest @ .., position] = positions
            && is_in_reach(position)
        {
            let masked = window.index(position as usize);
            if masked <= last && load32(self.shifted, masked) == self.last_four {
                break;
            }
            positions = rest;
        }
        positions
    }

    /// [`Self::try_position`] for one that passes.
    #[inline(always)]
    fn try_passed(&mut self, search: &Search<'a>, position: usize, best: &mut Match) {
        let distance = search.position - position;
        let masked = search.window.index(position);
        // A call would slow the loops over the bucket down.
        let length = search.match_length_with::<false>(masked, search.difference_at(masked));
        let score = score(length, distance);
        if best.score < score {
            *best = Match::new(length, distance, score);
            *self = Self::new(search, length);
        } else if search.block.is_contiguous()
            && (length >= Self::LONG
                || length + self.shifted.len() > search.window.without_tail().len() + 3)
        {
            self.follow(search, length, best);
            if length == search.data().len() {
                self.reject_all();
            }
        }
    }

    /// Once none of the positions that are left can score higher. In runs, they would all be compared up to the end.
    #[inline(always)]
    fn reject_all(&mut self) {
        self.shifted = &[];
    }

    /// For a match that is no better: what is farther away has to be longer. In runs, all positions can pass a raised filter.
    #[inline(always)]
    fn follow(&mut self, search: &Search<'a>, length: usize, best: &mut Match) {
        let longest = length.max(best.length);
        if best.score <= search.to_beat {
            // Keeps the next call from going lower, and is of no other use.
            best.length = longest;
        }
        *self = Self::new(search, longest);
    }

    /// Becomes the filter for the new `best`, if the match is better.
    #[inline(always)]
    fn try_position(
        &mut self,
        search: &Search<'a>,
        position: usize,
        distance: usize,
        best: &mut Match,
    ) {
        let masked = search.window.index(position);
        match self.shifted.get(masked..masked + 4) {
            Some(four) if load32(four, 0) == self.last_four => {}
            _ => return,
        }
        let length = search.match_length_at(masked);
        if length >= 4 {
            let score = score(length, distance);
            if best.score < score {
                *best = Match::new(length, distance, score);
                *self = Self::new(search, length);
            } else if length >= Self::LONG && search.block.is_contiguous() {
                core::hint::cold_path();
                self.follow(search, length, best);
            }
        }
    }
}

pub(super) trait Hasher: Sized {
    /// How many bytes have to follow a position.
    const LOOKAHEAD: usize;

    /// How many of the [`RecentDistances`] it looks at.
    fn recent_count(&self) -> usize;

    /// When positions wrap. Tables for small inputs never get that far.
    fn clear(&mut self) {}

    /// `eight` are the bytes from `position` on.
    fn store(&mut self, eight: u64, position: usize);

    /// The same, where nothing matched for a while.
    #[inline(always)]
    fn store_unmatched(&mut self, eight: u64, position: usize) {
        self.store(eight, position);
    }

    #[inline(never)] // Inlined, the loop has to share its registers.
    fn store_all(&mut self, bytes: &[u8], position: usize) {
        store_each(self, bytes, position);
    }

    /// For a search that is likely to come.
    #[inline(always)]
    fn prefetch(&self, _eight: u64) {}

    /// Jumps up to the first search that may find something, if that is quick to tell.
    #[inline(always)]
    fn skip<'a>(
        &mut self,
        _block: &InputBlock<'_>,
        position: usize,
        padded: &'a [u8],
        _last_distance: i32,
    ) -> (usize, &'a [u8]) {
        (position, padded)
    }

    /// For the positions of `block` and the last ones before it.
    fn try_reserve(&mut self, _block: &InputBlock<'_>) -> Result<()> {
        Ok(())
    }

    /// Before a block of `length` bytes at `position`.
    fn begin_block(&mut self, window: Window<'_>, position: usize, length: usize) {
        if length >= Self::LOOKAHEAD - 1 && position >= 3 {
            for earlier in position - 3..position {
                self.store(u64::from_le_bytes(window.bytes_at(earlier)), earlier);
            }
        }
    }

    /// The best match, or one with [`MIN_SCORE`]. Stores the position. `longer_than` is for [`Quick`], which skips what cannot be.
    fn find(&mut self, search: &Search<'_>, recent: &RecentDistances, longer_than: usize) -> Match;
}

/// Each eight of `bytes`, which are at `position`.
#[inline(always)]
fn store_each(hasher: &mut impl Hasher, bytes: &[u8], position: usize) {
    for (i, eight) in bytes.array_windows().enumerate() {
        hasher.store(u64::from_le_bytes(*eight), position + i);
    }
}

/// For the search at `offset` in `padded`.
#[inline(always)]
pub(super) fn prefetch(hasher: &impl Hasher, padded: &[u8], offset: usize) {
    if let Some(eight) = padded.get(offset..).and_then(<[u8]>::first_chunk) {
        hasher.prefetch(u64::from_le_bytes(*eight));
    }
}

/// Where nothing matched for a while, there are four steps between searches.
#[inline(always)]
pub(super) fn jump<'a, H: Hasher>(
    hasher: &mut H,
    block: &InputBlock<'_>,
    mut position: usize,
    mut padded: &'a [u8],
    step: usize,
) -> (usize, &'a [u8]) {
    let end = (position + 4 * step).min(block.end() - (H::LOOKAHEAD - 1).max(step));
    while position < end {
        hasher.store_unmatched(load64(padded, 0), position);
        position += step;
        padded = &padded[step..];
    }
    (position, padded)
}
