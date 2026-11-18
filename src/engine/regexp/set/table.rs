use bun_engine_text::AllocError;
use bun_engine_unicode::MAX_CODE_POINT;

use super::{CharRange, Latin1Set};

/// Membership in two loads: `c` below `limit()` is a member if bit `c % 64` of `words()[index()[c / 64]]` is set.
pub struct LookupTable {
    index: Vec<u16>,
    words: Vec<u64>,
    contains_beyond_limit: bool,
}

const SLOTS: usize = 512;

impl LookupTable {
    /// Answers for the characters up to `max`.
    pub(super) fn new(
        latin1: &Latin1Set,
        above: &[CharRange],
        max: u32,
    ) -> Result<LookupTable, AllocError> {
        let above = &above[..above.partition_point(|range| range.first <= max)];
        let contains_beyond_limit = above.last().is_some_and(|range| range.last >= max);
        let settled_from = above.last().map_or(0, |range| match contains_beyond_limit {
            true => range.first,
            false => range.last + 1,
        });
        let length = settled_from.max(0x10000).div_ceil(64) as usize;

        let mut bits = Vec::new();
        bits.try_reserve_exact(length).map_err(|_| AllocError)?;
        bits.extend_from_slice(latin1.words());
        bits.resize(length, 0);
        for range in above {
            let last = range.last.min(length as u32 * 64 - 1);
            let (first_word, last_word) = (range.first as usize / 64, last as usize / 64);
            let (from_first, to_last) =
                (u64::MAX << (range.first % 64), u64::MAX >> (63 - last % 64));
            if first_word == last_word {
                bits[first_word] |= from_first & to_last;
            } else if first_word < last_word {
                bits[first_word] |= from_first;
                bits[first_word + 1..last_word].fill(u64::MAX);
                bits[last_word] |= to_last;
            }
        }

        let (mut index, mut words) = (Vec::new(), Vec::new());
        index.try_reserve_exact(length).map_err(|_| AllocError)?;
        words
            .try_reserve_exact((above.len() * 2 + 6).min(length + 2))
            .map_err(|_| AllocError)?;
        words.extend([0, u64::MAX]);
        // Remembers the last word with each hash: a word that was displaced is stored once more.
        let mut recent = [0u16; SLOTS];
        for word in bits {
            index.push(match word {
                0 => 0,
                u64::MAX => 1,
                _ => {
                    let hash = word.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> (64 - SLOTS.ilog2());
                    let slot = &mut recent[hash as usize];
                    if words[usize::from(*slot)] != word {
                        *slot = words.len() as u16;
                        words.push(word);
                    }
                    *slot
                }
            });
        }
        words.shrink_to_fit();
        Ok(LookupTable {
            index,
            words,
            contains_beyond_limit,
        })
    }

    /// Above every code unit.
    #[inline]
    pub fn limit(&self) -> u32 {
        self.index.len() as u32 * 64
    }

    #[inline]
    pub fn index(&self) -> &[u16] {
        &self.index
    }

    #[inline]
    pub fn words(&self) -> &[u64] {
        &self.words
    }

    /// The answer for all characters from `limit()` on.
    #[inline]
    pub fn contains_beyond_limit(&self) -> bool {
        self.contains_beyond_limit
    }

    #[inline]
    pub fn contains(&self, c: u32) -> bool {
        debug_assert!(c <= MAX_CODE_POINT);
        match self.index.get((c >> 6) as usize) {
            Some(&word) => self.words[usize::from(word)] >> (c & 63) & 1 != 0,
            None => self.contains_beyond_limit,
        }
    }
}
