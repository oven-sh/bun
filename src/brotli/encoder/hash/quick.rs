use super::slots::Slots;
use super::{Hasher, MIN_SCORE, Match, RecentDistances, Search, score, score_of_recent};
use crate::encoder::matching::{HASH_MULTIPLIER_64, load32};
use crate::encoder::ring_buffer::Window;
use crate::encoder::words::QuickWordSearch;

/// Keeps `SWEEP` positions for a hash of `HASHED` bytes (qualities 2 to 4).
pub(in crate::encoder) struct Quick<S, const SWEEP: usize, const HASHED: u32, const USE_WORDS: bool>
{
    slots: S,
    words: QuickWordSearch,
}

impl<S: Slots, const SWEEP: usize, const HASHED: u32, const USE_WORDS: bool>
    Quick<S, SWEEP, HASHED, USE_WORDS>
{
    pub(in crate::encoder) fn new(slots: S) -> Self {
        Self {
            slots,
            words: QuickWordSearch::default(),
        }
    }

    #[inline(always)]
    fn key(eight: u64) -> usize {
        let hash = (eight << (64 - 8 * HASHED)).wrapping_mul(HASH_MULTIPLIER_64);
        (hash >> (64 - S::SIZE.ilog2())) as usize
    }

    #[inline(always)]
    fn slot_for(key: usize, position: usize) -> usize {
        key + (position & ((SWEEP - 1) << 3))
    }
}

impl<S: Slots, const SWEEP: usize, const HASHED: u32, const USE_WORDS: bool> Hasher
    for Quick<S, SWEEP, HASHED, USE_WORDS>
{
    const LOOKAHEAD: usize = 8;

    fn recent_count(&self) -> usize {
        1
    }

    fn clear(&mut self) {
        self.slots.clear();
    }

    #[inline(always)]
    fn store(&mut self, eight: u64, position: usize) {
        self.slots
            .set(Self::slot_for(Self::key(eight), position), position);
    }

    #[inline(always)]
    fn rules_out(
        &self,
        window: Window<'_>,
        eight: u64,
        position: usize,
        last_distance: i32,
    ) -> bool {
        let differs = |earlier, mask| {
            let at = window.index(earlier);
            let four = window.bytes.get(at..at + 4);
            four.is_none_or(|four| (load32(four, 0) ^ eight as u32) & mask != 0)
        };
        let compared = match (USE_WORDS && self.words.is_active(), SWEEP) {
            (false, _) => u32::MAX,
            (true, 1) => 0xFF,
            (true, _) => return false,
        };
        let key = Self::key(eight);
        differs(position.wrapping_sub(last_distance as usize), u32::MAX)
            && (0..SWEEP).all(|i| differs(self.slots.get(key + 8 * i) as usize, compared))
    }

    #[inline(always)]
    fn find(&mut self, search: &Search<'_>, recent: &RecentDistances, longer_than: usize) -> Match {
        let bytes = search.window.bytes;
        let key = Self::key(search.first_eight());
        let candidates: [u32; SWEEP] = core::array::from_fn(|i| self.slots.get(key + 8 * i));
        self.slots
            .set(Self::slot_for(key, search.position), search.position);
        let mut best = Match::new(longer_than, 0, MIN_SCORE);
        let mut next_byte = search.padded[longer_than];

        let distance = recent[0] as usize;
        let earlier = search.window.index(search.position.wrapping_sub(distance));
        if search.reaches(distance)
            && (longer_than == 0 || bytes.get(earlier + longer_than) == Some(&next_byte))
        {
            let difference = search.difference_at(earlier);
            if difference as u32 == 0 {
                let length = search.match_length_with(earlier, difference);
                best = Match::new(length, distance, score_of_recent(length, 0));
                if SWEEP == 1 {
                    return best;
                }
                next_byte = search.padded[length];
            }
        }

        for &candidate in &candidates {
            let distance = search.position.wrapping_sub(candidate as usize);
            let earlier = search.window.index(candidate as usize);
            if !search.reaches(distance)
                || (best.length != 0 && bytes.get(earlier + best.length) != Some(&next_byte))
            {
                if SWEEP == 1 {
                    return best;
                }
                continue;
            }
            let difference = search.difference_at(earlier);
            if difference as u32 == 0 {
                let length = search.match_length_with(earlier, difference);
                let score = score(length, distance);
                if best.score < score {
                    best = Match::new(length, distance, score);
                    next_byte = search.padded[length];
                }
            } else if SWEEP == 1
                && (!self.words.is_active() || difference as u8 != 0 && longer_than == 0)
            {
                return best;
            }
        }
        if USE_WORDS {
            search.try_words(&mut self.words, 1, &mut best);
        }
        best
    }
}
