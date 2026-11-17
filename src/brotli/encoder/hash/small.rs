use super::{Filter, Hasher, Match, RecentDistances, Search};
use crate::encoder::input_block::InputBlock;
use crate::encoder::matching::hash_of_four;
use crate::encoder::ring_buffer::Window;
use crate::encoder::words::QuickWordSearch;
use crate::memory::{self, Result};

const NOT_STORED: u16 = u16::MAX;

/// Finds what as many `BUCKETS` find in a small input, with much less memory to clear first.
pub(in crate::encoder) struct Small<const BUCKETS: usize> {
    /// The last position with each hash, plus one.
    heads: Box<[u16; BUCKETS]>,
    /// The same, as it was before each position, or [`NOT_STORED`].
    links: Vec<u16>,
    pub(super) max_hops: usize,
    /// In all searches so far.
    pub(super) hops: usize,
    recent_count: usize,
    pub(super) words: QuickWordSearch,
}

pub(in crate::encoder) const MAX_SMALL_INPUT_SIZE: usize = 1 << 16;

impl<const BUCKETS: usize> Small<BUCKETS> {
    pub(in crate::encoder) fn new(max_hops: usize, recent_count: usize) -> Result<Self> {
        const { assert!(MAX_SMALL_INPUT_SIZE - Self::LOOKAHEAD + 1 < NOT_STORED as usize) };
        Ok(Self {
            heads: memory::zeroed_array()?,
            links: Vec::new(),
            max_hops,
            hops: 0,
            recent_count,
            words: QuickWordSearch::default(),
        })
    }

    /// None is at `end` or after it.
    pub(super) fn store_all_in(&self, larger: &mut impl Hasher, window: Window<'_>, end: usize) {
        for (position, &link) in self.links[..end].iter().enumerate() {
            if link != NOT_STORED {
                larger.store(u64::from_le_bytes(window.bytes_at(position)), position);
            }
        }
    }

    /// Returns the previous head.
    #[inline(always)]
    fn insert(&mut self, eight: u64, position: usize) -> u16 {
        let key = hash_of_four(eight as u32, BUCKETS.ilog2());
        let link = core::mem::replace(&mut self.heads[key % BUCKETS], position as u16 + 1);
        self.links[position] = link;
        link
    }
}

impl<const BUCKETS: usize> Hasher for Small<BUCKETS> {
    const LOOKAHEAD: usize = 4;

    fn recent_count(&self) -> usize {
        self.recent_count
    }

    fn try_reserve(&mut self, block: &InputBlock<'_>) -> Result<()> {
        memory::try_reserve(&mut self.links, block.length)?;
        memory::resize(&mut self.links, block.end(), NOT_STORED);
        Ok(())
    }

    #[inline(always)]
    fn store(&mut self, eight: u64, position: usize) {
        self.insert(eight, position);
    }

    #[inline(always)]
    fn find(&mut self, search: &Search<'_>, recent: &RecentDistances, _: usize) -> Match {
        let mut link = usize::from(self.insert(search.first_eight(), search.position));
        let mut best = Match::NONE;
        let length = search.try_recent(recent, self.recent_count, &mut best);
        if link != 0 {
            let nearest = search.position + 1 - link;
            let length = search.raise(length, nearest, &self.words, &mut best);
            let mut filter = Filter::new(search, length);
            let mut left = self.max_hops;
            while left != 0 {
                let candidate = link.wrapping_sub(1);
                let Some(&next) = self.links.get(candidate) else {
                    break;
                };
                link = usize::from(next);
                left -= 1;
                filter.try_position(search, candidate, search.position - candidate, &mut best);
            }
            self.hops += self.max_hops - left;
        }
        search.try_words(&mut self.words, 2, &mut best);
        best
    }
}
