use super::{Filter, Hasher, Match, RecentDistances, Search};
use crate::encoder::input_block::InputBlock;
use crate::encoder::matching::HASH_MULTIPLIER_32;
use crate::encoder::words::QuickWordSearch;
use crate::memory::{self, Result};

const NOT_STORED: u16 = u16::MAX;

/// Finds what either kind of buckets finds in a small input, with much less memory to clear first.
pub(in crate::encoder) struct Small {
    /// The last position with each hash, plus one.
    heads: Vec<u16>,
    /// The same, as it was before each position, or [`NOT_STORED`].
    links: Vec<u16>,
    key_shift: u32,
    max_hops: usize,
    recent_count: usize,
    pub(super) words: QuickWordSearch,
}

impl Small {
    pub(in crate::encoder) const MAX_INPUT_SIZE: usize = 1 << 16;

    pub(in crate::encoder) fn new(
        key_bits: u32,
        max_hops: usize,
        recent_count: usize,
    ) -> Result<Self> {
        const { assert!(Self::MAX_INPUT_SIZE - Self::LOOKAHEAD + 1 < NOT_STORED as usize) };
        Ok(Self {
            heads: memory::zeroed(1 << key_bits)?,
            links: Vec::new(),
            key_shift: 32 - key_bits,
            max_hops,
            recent_count,
            words: QuickWordSearch::default(),
        })
    }

    pub(super) fn stored_positions(&self) -> impl Iterator<Item = usize> {
        (0..self.links.len()).filter(|&position| self.links[position] != NOT_STORED)
    }

    /// Returns the previous head.
    #[inline(always)]
    fn insert(&mut self, eight: u64, position: usize) -> u16 {
        let key = (eight as u32).wrapping_mul(HASH_MULTIPLIER_32) >> self.key_shift;
        let link = core::mem::replace(&mut self.heads[key as usize], position as u16 + 1);
        self.links[position] = link;
        link
    }
}

impl Hasher for Small {
    const LOOKAHEAD: usize = 4;

    fn recent_count(&self) -> usize {
        self.recent_count
    }

    fn try_reserve(&mut self, block: &InputBlock<'_>) -> Result<()> {
        memory::try_reserve(&mut self.links, block.length)?;
        self.links.resize(block.end(), NOT_STORED);
        Ok(())
    }

    #[inline(always)]
    fn store(&mut self, eight: u64, position: usize) {
        self.insert(eight, position);
    }

    #[inline(always)]
    fn find(&mut self, search: &Search<'_>, recent: &RecentDistances, _: usize) -> Match {
        let mut link = self.insert(search.first_eight(), search.position);
        let mut best = Match::NONE;
        let length = search.try_recent(recent, self.recent_count, &mut best);
        let mut filter = Filter::new(search, length);
        for _ in 0..self.max_hops {
            let candidate = usize::from(link).wrapping_sub(1);
            let Some(&next) = self.links.get(candidate) else {
                break;
            };
            link = next;
            filter.try_position(search, candidate, search.position - candidate, &mut best);
        }
        search.try_words(&mut self.words, 2, &mut best);
        best
    }
}
