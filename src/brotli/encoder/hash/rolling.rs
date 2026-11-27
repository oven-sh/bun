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
    rolling: Rolling<STEP>,
}

impl<H, const STEP: usize> WithRolling<H, STEP> {
    pub(in crate::encoder) fn new(inner: H) -> Result<Self> {
        let rolling = Rolling {
            slots: memory::zeroed_array()?,
            hash: 0,
            next_position: 0,
        };
        Ok(Self { inner, rolling })
    }
}

struct Rolling<const STEP: usize> {
    /// The complement of the position, so that zero is none.
    slots: Box<[u32; SLOTS]>,
    hash: u32,
    next_position: usize,
}

impl<const STEP: usize> Rolling<STEP> {
    #[inline(always)]
    fn rolled(hash: u32, oldest: u8, newest: u8) -> u32 {
        let factor_of_oldest = const { FACTOR.wrapping_pow((CHUNK / STEP) as u32) };
        let removed = factor_of_oldest.wrapping_mul(u32::from(oldest) + 1);
        add_byte(hash, newest).wrapping_sub(removed)
    }

    fn begin_block(&mut self, window: Window<'_>, position: usize, length: usize) {
        let start = position.next_multiple_of(STEP);
        let available = length.saturating_sub(start - position);
        if available.min(window.before_end(start)) >= CHUNK {
            let chunk = window.from(start)[..CHUNK].iter().step_by(STEP);
            self.hash = chunk.fold(0, |hash, &byte| add_byte(hash, byte));
        }
        self.next_position = start;
    }

    #[inline(never)]
    fn store_up_to(&mut self, end: usize, window: Window<'_>) {
        let (start, mut hash) = (self.next_position, self.hash);
        let [oldest, newest] = [start, start + CHUNK].map(|at| &window.from(at)[..end - start]);
        for i in (0..end - start).step_by(STEP) {
            if let Some(slot) = self.slots.get_mut((hash & HASH_MASK) as usize) {
                *slot = !((start + i) as u32);
            }
            hash = Self::rolled(hash, oldest[i], newest[i]);
        }
        self.hash = hash;
    }

    #[inline(always)]
    fn improve(&mut self, search: &Search<'_>, best: &mut Match) {
        let (position, window) = (search.position, search.window);
        if !position.is_multiple_of(STEP) || search.data().len() < CHUNK {
            return;
        }
        debug_assert!(self.next_position <= position);
        if self.next_position < position {
            self.store_up_to(position, window);
        }
        if let Some(slot) = self.slots.get_mut((self.hash & HASH_MASK) as usize) {
            let found = !core::mem::replace(slot, !(position as u32));
            let distance = (position as u32).wrapping_sub(found) as usize;
            if search.reaches(distance) {
                let length = search.match_length_at(window.index(found as usize));
                if length >= 4 && length > best.length {
                    let score = score(length, distance);
                    if score > best.score {
                        *best = Match::new(length, distance, score);
                    }
                }
            }
        }
        self.hash = Self::rolled(self.hash, search.padded[0], window.byte(position + CHUNK));
        self.next_position = position + STEP;
    }
}

#[inline(always)]
fn add_byte(hash: u32, byte: u8) -> u32 {
    hash.wrapping_mul(FACTOR).wrapping_add(u32::from(byte) + 1)
}

/// Skips nothing, whatever `H` can tell.
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
    fn store_unmatched(&mut self, eight: u64, position: usize) {
        self.inner.store_unmatched(eight, position);
    }

    #[inline(always)]
    fn store_all(&mut self, bytes: &[u8], position: usize) {
        self.inner.store_all(bytes, position);
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
        self.rolling.begin_block(window, position, length);
    }

    #[inline(always)]
    fn find(&mut self, search: &Search<'_>, recent: &RecentDistances, longer_than: usize) -> Match {
        let search = &Search {
            to_beat: 0,
            ..*search
        };
        let mut best = self.inner.find(search, recent, longer_than);
        self.rolling.improve(search, &mut best);
        best
    }
}
