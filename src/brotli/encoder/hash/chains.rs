//! Link the positions with the same hash (qualities 5 to 9, with a window of up to 16 bits).

use core::hint::{Locality, prefetch_read};

use super::{Filter, Hasher, Match, RecentDistances, Search, score_of_recent};
use crate::encoder::input_block::InputBlock;
use crate::encoder::matching::hash_of_four;
use crate::encoder::words::QuickWordSearch;
use crate::memory::{self, Result};

const KEY_BITS: u32 = 15;

#[inline(always)]
fn key(eight: u64) -> usize {
    hash_of_four(eight as u32, KEY_BITS)
}

/// What tables have for a position, so that zero is out of reach.
#[inline(always)]
fn entry(position: usize) -> usize {
    position + (1 << 16)
}

/// A value for each of the last `1 << 16` positions, or for all of them if there are fewer.
#[derive(Default)]
struct ByPosition<T>(Vec<T>);

impl<T: Copy + Default> ByPosition<T> {
    fn try_reserve(&mut self, block: &InputBlock<'_>) -> Result<()> {
        let size = block.end().min(1 << 16).next_power_of_two();
        memory::try_reserve_total(&mut self.0, size)?;
        self.0.resize(size, T::default());
        Ok(())
    }

    #[inline(always)]
    fn index(&self, position: usize) -> usize {
        position & (self.0.len() - 1)
    }
}

struct Common {
    /// The low bits of the key.
    tiny_hashes: ByPosition<u8>,
    max_hops: usize,
    recent_count: usize,
    words: QuickWordSearch,
}

impl Common {
    fn new(max_hops: usize, recent_count: usize) -> Self {
        Self {
            tiny_hashes: ByPosition::default(),
            max_hops,
            recent_count,
            words: QuickWordSearch::default(),
        }
    }

    fn clear(&mut self) {
        self.tiny_hashes.0.fill(0);
    }

    #[inline(always)]
    fn insert(&mut self, key: usize, position: usize) {
        let at = self.tiny_hashes.index(position);
        self.tiny_hashes.0[at] = key as u8;
    }

    #[inline(always)]
    fn try_recent(&self, search: &Search<'_>, recent: &RecentDistances, key: usize) -> Match {
        let mut promising = search.promising(recent, self.recent_count);
        let mut best = Match::NONE;
        while promising != 0 {
            let i = promising.trailing_zeros() as usize;
            promising &= promising - 1;
            let distance = recent[i % recent.len()] as usize;
            let at = (self.tiny_hashes).index(search.position.wrapping_sub(distance));
            if !search.reaches(distance) || (i > 0 && self.tiny_hashes.0[at] != key as u8) {
                continue;
            }
            let earlier = search.window.index(search.position - distance);
            let length = search.match_length_at(earlier);
            let score = score_of_recent(length, i);
            if length >= 2 && best.score < score {
                best = Match::new(length, distance, score);
            }
        }
        best
    }
}

pub(in crate::encoder) struct Chains {
    common: Common,
    last_entries: Box<[u32; 1 << KEY_BITS]>,
    earlier_entries: ByPosition<u32>,
}

impl Chains {
    pub(in crate::encoder) fn new(max_hops: usize, recent_count: usize) -> Result<Self> {
        Ok(Self {
            common: Common::new(max_hops, recent_count),
            last_entries: memory::zeroed_array()?,
            earlier_entries: ByPosition::default(),
        })
    }

    #[inline(always)]
    fn insert(&mut self, key: usize, position: usize) {
        self.common.insert(key, position);
        let at = self.earlier_entries.index(position);
        self.earlier_entries.0[at] =
            core::mem::replace(&mut self.last_entries[key], entry(position) as u32);
    }
}

impl Hasher for Chains {
    const LOOKAHEAD: usize = 4;

    fn recent_count(&self) -> usize {
        self.common.recent_count
    }

    fn clear(&mut self) {
        self.common.clear();
        self.last_entries.fill(0);
    }

    fn try_reserve(&mut self, block: &InputBlock<'_>) -> Result<()> {
        self.common.tiny_hashes.try_reserve(block)?;
        self.earlier_entries.try_reserve(block)
    }

    #[inline(always)]
    fn store(&mut self, eight: u64, position: usize) {
        self.insert(key(eight), position);
    }

    #[inline(always)]
    fn prefetch(&self, eight: u64) {
        prefetch_read(&raw const self.last_entries[key(eight)], Locality::L1);
    }

    #[inline(always)]
    fn find(&mut self, search: &Search<'_>, recent: &RecentDistances, _: usize) -> Match {
        let key = key(search.first_eight());
        let mut best = self.common.try_recent(search, recent, key);
        let mut filter = Filter::new(search, best.length.max(3));
        let mut candidate = self.last_entries[key] as usize;
        // Counting down does not have to load the limit.
        for _ in (0..self.common.max_hops).rev() {
            let distance = entry(search.position) - candidate;
            if distance > search.max_backward {
                break;
            }
            candidate = self.earlier_entries.0[self.earlier_entries.index(candidate)] as usize;
            filter.try_position(search, search.position - distance, distance, &mut best);
        }
        self.insert(key, search.position);
        search.try_words(&mut self.common.words, 2, &mut best);
        best
    }
}

const BANKS: usize = 512;
const BANK_BITS: u32 = 9;
const BANK_SIZE: usize = 1 << BANK_BITS;
/// Banks fill up at the same pace, so without a gap they compete for the same cache sets.
const BANK_STRIDE: u32 = BANK_SIZE as u32 + 16;

/// New links replace the oldest ones of their bank (quality 9).
pub(in crate::encoder) struct ForgetfulChains {
    common: Common,
    /// The halves of the last entry, and the index of its link in the bank.
    heads: Box<[[u16; 3]; 1 << KEY_BITS]>,
    next_free: Box<[u16; BANKS]>,
    bank_starts: Box<[u32; BANKS]>,
    /// The index of the link of the position before, and above it the distance to that position.
    links: Vec<u32>,
}

impl ForgetfulChains {
    /// With `padded_input`, which is all there is, the banks are no larger than it needs.
    pub(in crate::encoder) fn new(
        padded_input: Option<&[u8]>,
        max_hops: usize,
        recent_count: usize,
    ) -> Result<Self> {
        // The sizes come first, and then turn into starts.
        let size = if padded_input.is_some() {
            0
        } else {
            BANK_STRIDE
        };
        let mut bank_starts = memory::filled_array(size)?;
        for &eight in padded_input.unwrap_or_default().array_windows() {
            bank_starts[key(u64::from_le_bytes(eight)) % BANKS] += 1;
        }
        let mut total = 0;
        for start in &mut *bank_starts {
            total += core::mem::replace(start, total).min(BANK_STRIDE);
        }
        Ok(Self {
            common: Common::new(max_hops, recent_count),
            heads: memory::zeroed_array()?,
            next_free: memory::zeroed_array()?,
            bank_starts,
            links: memory::zeroed(total as usize)?,
        })
    }

    #[inline(always)]
    fn insert(&mut self, key: usize, position: usize) {
        let next_free = &mut self.next_free[key % BANKS];
        let index = *next_free % BANK_SIZE as u16;
        *next_free = index + 1;
        self.common.insert(key, position);
        let entry = entry(position) as u32;
        let new = [entry as u16, (entry >> 16) as u16, index];
        let [low, high, head] = core::mem::replace(&mut self.heads[key], new);
        let distance = entry - (u32::from(low) | (u32::from(high) << 16));
        let at = self.bank_starts[key % BANKS] as usize + usize::from(index);
        self.links[at] = (distance.min(u32::MAX >> BANK_BITS) << BANK_BITS) | u32::from(head);
    }
}

impl Hasher for ForgetfulChains {
    const LOOKAHEAD: usize = 4;

    fn recent_count(&self) -> usize {
        self.common.recent_count
    }

    fn clear(&mut self) {
        self.common.clear();
        self.heads.fill([0; 3]);
        self.next_free.fill(0);
    }

    fn try_reserve(&mut self, block: &InputBlock<'_>) -> Result<()> {
        self.common.tiny_hashes.try_reserve(block)
    }

    #[inline(always)]
    fn store(&mut self, eight: u64, position: usize) {
        self.insert(key(eight), position);
    }

    #[inline(always)]
    fn prefetch(&self, eight: u64) {
        prefetch_read(&raw const self.heads[key(eight)], Locality::L1);
    }

    #[inline(always)]
    fn find(&mut self, search: &Search<'_>, recent: &RecentDistances, _: usize) -> Match {
        let key = key(search.first_eight());
        let mut best = self.common.try_recent(search, recent, key);
        let bank = &self.links[self.bank_starts[key % BANKS] as usize..];
        let [low, high, mut index] = self.heads[key].map(usize::from);
        let mut distance = entry(search.position) - (low | (high << 16));
        let length = search.raise(best.length.max(3), distance, &self.common.words, &mut best);
        let mut filter = Filter::new(search, length);
        for _ in (0..self.common.max_hops).rev() {
            if distance > search.max_backward {
                break;
            }
            let link = bank[index] as usize;
            filter.try_position(search, search.position - distance, distance, &mut best);
            (distance, index) = (distance + (link >> BANK_BITS), link % BANK_SIZE);
        }
        self.insert(key, search.position);
        search.try_words(&mut self.common.words, 2, &mut best);
        best
    }
}
