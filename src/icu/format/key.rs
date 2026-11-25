//! Compares keys eight bytes at a time. So many can be read at any place of a pool of keys.

use core::cmp::Ordering;

#[derive(Clone, Copy)]
pub struct Key<'a> {
    words: &'a [[u8; 8]],
    /// The other bytes and a NUL as a big-endian number.
    rest: u64,
    beyond_nul: u32,
}

impl<'a> Key<'a> {
    #[inline(always)]
    pub fn new(key: &'a [u8]) -> Self {
        let (words, rest) = key.as_chunks();
        let beyond_nul = 8 * (7 - rest.len() as u32);
        let rest = match (key.last_chunk(), key.first_chunk(), key.last_chunk()) {
            (Some(&last), ..) => u64::from_be_bytes(last) << 8 << beyond_nul >> beyond_nul,
            (_, Some(&first), Some(&last)) => {
                let [first, last] = [first, last].map(|it| u64::from(u32::from_be_bytes(it)));
                first << 32 >> beyond_nul | last << 8
            }
            _ => (key.iter()).fold(0, |head, &byte| head << 8 | u64::from(byte)) << 8,
        };
        Self {
            words,
            rest,
            beyond_nul,
        }
    }

    /// Depends on the first word, the last one, the number of words and the rest.
    #[inline(always)]
    pub fn hash(self) -> u32 {
        let mix = |word: u64| word.wrapping_mul(0x9e37_79b9_7f4a_7c15);
        let words = match (self.words.first(), self.words.last()) {
            (Some(&first), Some(&last)) => {
                let [first, last] = [first, last].map(u64::from_le_bytes);
                mix(mix(first).rotate_left(29) ^ last ^ self.words.len() as u64).rotate_left(29)
            }
            _ => 0,
        };
        (mix(words ^ self.rest) >> 32) as u32
    }

    /// Compares with the key at `offset`.
    #[inline(always)]
    pub fn compare(self, pool: &[u8], offset: u16) -> Option<Ordering> {
        let mut at = usize::from(offset);
        let word_at = |at| Some(u64::from_be_bytes(*pool.get(at..at + 8)?.first_chunk()?));
        for &word in self.words {
            let (word, found) = (u64::from_be_bytes(word), word_at(at)?);
            if word != found {
                return Some(less_or_greater(word < found));
            }
            at += 8;
        }
        let found = word_at(at)? >> self.beyond_nul;
        if self.rest != found {
            return Some(less_or_greater(self.rest < found));
        }
        Some(Ordering::Equal)
    }
}

/// Perf: `cmp` would test for equality again.
#[inline(always)]
fn less_or_greater(is_less: bool) -> Ordering {
    if is_less {
        Ordering::Less
    } else {
        Ordering::Greater
    }
}
