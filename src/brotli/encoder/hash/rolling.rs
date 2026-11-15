use super::{Hasher, Match, RecentDistances, Search, score};
use crate::encoder::input_block::InputBlock;
use crate::encoder::ring_buffer::Window;
use crate::memory::{self, Result};

const CHUNK: usize = 32;
const SLOTS: usize = 1 << 24;
/// One hash in 64 has a slot.
const HASH_MASK: u32 = 64 * SLOTS as u32 - 1;
const FACTOR: u32 = 69069;

/// Adds long matches from far away, with a hash of every `STEP`th of 32 bytes (large windows).
pub(in crate::encoder) struct WithRolling<H, const STEP: usize> {
    inner: H,
    /// The complement of the position, so that zero is none.
    slots: Box<[u32; SLOTS]>,
    hash: u32,
    next_position: usize,
}

impl<H, const STEP: usize> WithRolling<H, STEP> {
    const FACTOR_OF_OLDEST: u32 = FACTOR.wrapping_pow((CHUNK / STEP) as u32);

    pub(in crate::encoder) fn new(inner: H) -> Result<Self> {
        Ok(Self {
            inner,
            slots: memory::zeroed_array()?,
            hash: 0,
            next_position: 0,
        })
    }
}

#[inline(always)]
fn add_byte(hash: u32, byte: u8) -> u32 {
    hash.wrapping_mul(FACTOR).wrapping_add(u32::from(byte) + 1)
}

impl<H: Hasher, const STEP: usize> Hasher for WithRolling<H, STEP> {
    const LOOKAHEAD: usize = H::LOOKAHEAD;

    fn recent_count(&self) -> usize {
        self.inner.recent_count()
    }

    fn clear(&mut self) {
        self.inner.clear();
    }

    #[inline(always)]
    fn store(&mut self, eight: u64, position: usize) {
        self.inner.store(eight, position);
    }

    #[inline(always)]
    fn prefetch(&self, eight: u64) {
        self.inner.prefetch(eight);
    }

    fn try_reserve(&mut self, block: &InputBlock<'_>) -> Result<()> {
        self.inner.try_reserve(block)
    }

    fn begin_block(&mut self, window: Window<'_>, position: usize, length: usize) {
        self.inner.begin_block(window, position, length);
        let start = position.next_multiple_of(STEP);
        let available = length.saturating_sub(start - position);
        if available.min(window.before_end(start)) >= CHUNK {
            let chunk = window.from(start)[..CHUNK].iter().step_by(STEP);
            self.hash = chunk.fold(0, |hash, &byte| add_byte(hash, byte));
        }
        self.next_position = start;
    }

    #[inline(always)]
    fn find(&mut self, search: &Search<'_>, recent: &RecentDistances, longer_than: usize) -> Match {
        let mut best = self.inner.find(search, recent, longer_than);
        if !search.position.is_multiple_of(STEP) || search.data().len() < CHUNK {
            return best;
        }
        for position in (self.next_position..=search.position).step_by(STEP) {
            let slot = self.slots.get_mut((self.hash & HASH_MASK) as usize);
            let oldest = u32::from(search.window.byte(position)) + 1;
            self.hash = add_byte(self.hash, search.window.byte(position + CHUNK))
                .wrapping_sub(Self::FACTOR_OF_OLDEST.wrapping_mul(oldest));
            let Some(slot) = slot else {
                continue;
            };
            let found = !core::mem::replace(slot, !(position as u32));
            let distance = (position as u32).wrapping_sub(found) as usize;
            if position == search.position && search.reaches(distance) {
                let length = search.match_length_at(search.window.index(found as usize));
                if length >= 4 && length > best.length {
                    let score = score(length, distance);
                    if score > best.score {
                        best = Match::new(length, distance, score);
                    }
                }
            }
        }
        self.next_position = search.position + STEP;
        best
    }
}
