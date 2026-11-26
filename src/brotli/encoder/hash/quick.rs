use super::slots::Slots;
use super::{
    Hasher, MIN_SCORE, Match, RecentDistances, Search, jump, score, score_of_recent, store_each,
};
use crate::encoder::input_block::InputBlock;
use crate::encoder::matching::{HASH_MULTIPLIER_64, load32, load64};
use crate::encoder::ring_buffer::{SLACK, Window};
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

    /// Whether it is quick to tell that [`Hasher::find`] finds nothing.
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

    #[inline(never)]
    fn skip<'a>(
        &mut self,
        block: &InputBlock<'_>,
        mut position: usize,
        mut padded: &'a [u8],
        last_distance: i32,
    ) -> (usize, &'a [u8]) {
        while padded.len() > Self::LOOKAHEAD + SLACK
            && self.rules_out(block.window, load64(padded, 0), position, last_distance)
        {
            self.store(load64(padded, 0), position);
            (position, padded) = jump(self, block, position + 1, &padded[1..], 4);
        }
        (position, padded)
    }

    #[inline(always)]
    fn store_all(&mut self, bytes: &[u8], position: usize) {
        store_each(self, bytes, position);
    }

    #[inline(always)]
    fn find(&mut self, search: &Search<'_>, recent: &RecentDistances, longer_than: usize) -> Match {
        let key = Self::key(search.first_eight());
        let candidates: [u32; SWEEP] = core::array::from_fn(|i| self.slots.get(key + 8 * i));
        self.slots
            .set(Self::slot_for(key, search.position), search.position);
        let mut best = Match::new(longer_than, 0, MIN_SCORE);

        let distance = recent[0] as usize;
        let earlier = search.window.index(search.position.wrapping_sub(distance));
        if let Some(difference) = promising_difference(search, earlier, longer_than)
            && search.reaches(distance)
        {
            let length = search.match_length_with::<true>(earlier, difference);
            best = Match::new(length, distance, score_of_recent(length, 0));
            if SWEEP == 1 {
                return best;
            }
        }

        // One after the other, since a loop would not be unrolled.
        const { assert!(matches!(SWEEP, 1 | 2 | 4)) };
        try_candidate(search, candidates[0], &mut best);
        if SWEEP > 1 {
            try_candidate(search, candidates[1 % SWEEP], &mut best);
        }
        if SWEEP > 2 {
            try_candidate(search, candidates[2 % SWEEP], &mut best);
            try_candidate(search, candidates[3 % SWEEP], &mut best);
        }
        if USE_WORDS && best.score == MIN_SCORE && self.words.is_active() {
            let candidate = candidates[0] as usize;
            let at = search.window.index(candidate) + longer_than;
            if SWEEP > 1
                || (search.window.bytes.get(at) == Some(&search.padded[longer_than])
                    && search.reaches(search.position.wrapping_sub(candidate)))
            {
                search.try_words(&mut self.words, 1, &mut best);
            }
        }
        best
    }
}

/// The bits that differ in the first eight bytes, unless that rules out a match, or the byte after `length` does.
#[inline(always)]
fn promising_difference(search: &Search<'_>, earlier: usize, length: usize) -> Option<u64> {
    let bytes = search.window.bytes;
    // The same test in both arms, so that the compiler can tell after which of them there is still no match.
    if length == 0 {
        let eight = bytes.get(earlier..earlier + 8)?;
        (load32(eight, 0) == search.first_eight() as u32)
            .then(|| load64(eight, 0) ^ search.first_eight())
    } else if *bytes.get(earlier + length)? == search.padded[length] {
        let difference = load64(bytes.get(earlier..earlier + 8)?, 0) ^ search.first_eight();
        (difference as u32 == 0).then_some(difference)
    } else {
        None
    }
}

#[inline(always)]
fn try_candidate(search: &Search<'_>, candidate: u32, best: &mut Match) {
    let earlier = search.window.index(candidate as usize);
    if let Some(difference) = promising_difference(search, earlier, best.length) {
        let distance = search.position.wrapping_sub(candidate as usize);
        if search.reaches(distance) {
            let length = search.match_length_with::<true>(earlier, difference);
            let score = score(length, distance);
            if best.score < score {
                *best = Match::new(length, distance, score);
            }
        }
    }
}
