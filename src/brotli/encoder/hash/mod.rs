//! Hash tables that find earlier occurrences of the input.

mod binary_tree;
mod buckets;
mod chains;
mod quick;
mod rolling;
mod slots;
mod small;

pub(super) use binary_tree::{BinaryTree, Candidate};
pub(super) use buckets::{Buckets, TaggedBuckets};
pub(super) use chains::{Chains, ForgetfulChains};
pub(super) use quick::Quick;
pub(super) use rolling::WithRolling;
pub(super) use slots::{Dense, Paged};
pub(super) use small::Small;

use core::hint::{Locality, prefetch_read};

use super::input_block::InputBlock;
use super::log2::log2_floor;
use super::matching::{bytes_at, load32, load64, splat, zero_bytes};
use super::ring_buffer::{SLACK, Window};
use super::words::QuickWordSearch;
use crate::memory::Result;

// https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/hash.h#L94
const SCORE_BASE: usize = 1920;
pub(super) const MIN_SCORE: usize = SCORE_BASE + 100;

#[inline(always)]
pub(super) fn score(length: usize, distance: usize) -> usize {
    SCORE_BASE + 135 * length - 30 * log2_floor(distance) as usize
}

/// With the distance that short code `index` stands for.
#[inline(always)]
pub(super) fn score_of_recent(length: usize, index: usize) -> usize {
    let penalty = if index == 0 {
        0
    } else {
        39 + ((0x1CA10 >> (index & 0xE)) & 0xE)
    };
    SCORE_BASE + 135 * length + 15 - penalty
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

/// Reorders the bits of seven positions by their distance: the middle one, then -1, +1, -2, +2, -3 and +3.
#[inline(always)]
fn by_distance(by_position: u8) -> u32 {
    static REORDERED: [u8; 128] = {
        let mut reordered = [0; 128];
        let mut by_position = 0;
        while by_position < 128 {
            let mut i = 0;
            while i < 7 {
                let bit = (by_position as u8 >> [3, 4, 2, 5, 1, 6, 0][i]) & 1;
                reordered[by_position] |= bit << i;
                i += 1;
            }
            by_position += 1;
        }
        reordered
    };
    u32::from(REORDERED[usize::from(by_position) % 128])
}

/// Two bytes that a match has to have. A bit that is not set rules out a distance within the window.
pub(super) struct BytePair<'a> {
    window: Window<'a>,
    position: usize,
    offset: usize,
    bytes: [u8; 2],
}

impl<'a> BytePair<'a> {
    /// The bytes at `offset` in `data`, which is at `position`.
    #[inline(always)]
    pub(super) fn new(window: Window<'a>, position: usize, data: &[u8], offset: usize) -> Self {
        Self {
            window,
            position,
            offset,
            bytes: bytes_at(data, offset),
        }
    }

    #[inline(always)]
    fn index(&self, distance: i32) -> usize {
        let earlier = self.position.wrapping_sub(distance as usize);
        self.window.index(earlier) + self.offset
    }

    #[inline(always)]
    pub(super) fn may_be_at(&self, distance: i32) -> u32 {
        let at = self.index(distance).min(self.window.bytes.len() - 2);
        u32::from(bytes_at(self.window.bytes, at) == self.bytes)
    }

    /// See [`by_distance`].
    #[inline(always)]
    pub(super) fn may_be_around(&self, distance: i32) -> u32 {
        let start = self.index(distance + 3);
        let Some(bytes) = self.window.bytes.get(start..start + 9) else {
            return 0x7F;
        };
        let [first, second] = [0, 1].map(|i| load64(bytes, i) ^ splat(self.bytes[i]));
        by_distance(zero_bytes(first | second))
    }
}

pub(super) struct Search<'a> {
    pub(super) window: Window<'a>,
    pub(super) position: usize,
    /// The input from `position` to the end of the block, and [`SLACK`] bytes.
    pub(super) padded: &'a [u8],
    /// How far back the window reaches.
    pub(super) max_backward: usize,
    pub(super) block: &'a InputBlock<'a>,
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
        let offset = self.max_backward.wrapping_sub(self.position);
        offset.wrapping_add(earlier) < self.max_backward
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
        self.match_length_with(masked, self.difference_at(masked))
    }

    #[inline(always)]
    fn match_length_with(&self, masked: usize, mut difference: u64) -> usize {
        let mut matched = 0;
        if difference == 0 {
            let other = &self.window.bytes[masked..];
            let length = other.len().min(self.padded.len());
            let (a, b) = (&other[..length], &self.padded[..length]);
            while difference == 0 && matched + 16 <= length {
                matched += 8;
                difference = load64(a, matched) ^ load64(b, matched);
            }
        }
        (matched + (difference.trailing_zeros() / 8) as usize).min(self.padded.len() - SLACK)
    }

    /// A bit for each of the first `count` that may match for two bytes.
    #[inline(always)]
    fn promising(&self, recent: &RecentDistances, count: usize) -> u32 {
        let pair = BytePair::new(self.window, self.position, self.padded, 0);
        let mut promising = 0;
        for (i, &distance) in recent[..4].iter().enumerate() {
            promising |= pair.may_be_at(distance) << i;
        }
        if count > 4 {
            promising |= (pair.may_be_around(recent[0]) >> 1) << 4;
            if count > 10 {
                promising |= (pair.may_be_around(recent[1]) >> 1) << 10;
            }
        }
        promising
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

    #[inline(always)]
    fn try_words(&self, words: &mut QuickWordSearch, candidates: usize, best: &mut Match) {
        if best.score == MIN_SCORE && words.is_active() {
            let first = self.block.max_copy_distance(self.position) + 1;
            let max = self.block.params.distance.max_distance;
            words.improve(self.data(), candidates, first, max, best);
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
            }
        }
    }
}

pub(super) trait Hasher {
    /// How many bytes have to follow a position.
    const LOOKAHEAD: usize;

    /// How many of the [`RecentDistances`] it looks at.
    fn recent_count(&self) -> usize;

    /// When positions wrap. Tables for small inputs never get that far.
    fn clear(&mut self) {}

    /// `eight` are the bytes from `position` on.
    fn store(&mut self, eight: u64, position: usize);

    /// For a search that is likely to come.
    #[inline(always)]
    fn prefetch(&self, _eight: u64) {}

    /// Whether it is quick to tell that [`Hasher::find`] finds nothing.
    #[inline(always)]
    fn rules_out(
        &self,
        _window: Window<'_>,
        _eight: u64,
        _position: usize,
        _last_distance: i32,
    ) -> bool {
        false
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
