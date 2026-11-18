use core::ops::{BitAnd, BitOr, BitOrAssign, Not, Sub};

use super::CharRange;

/// A set of the characters up to U+00FF. Character `c` is bit `c % 64` of word `c / 64`.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct Latin1Set([u64; 4]);

/// In the second word.
const ASCII_UPPER_CASE: u64 = 0x07ff_fffe;

impl Latin1Set {
    pub const EMPTY: Latin1Set = Latin1Set([0; 4]);
    pub const ALL: Latin1Set = Latin1Set([u64::MAX; 4]);

    pub const fn of(characters: &[u8]) -> Latin1Set {
        let (mut set, mut index) = (Latin1Set::EMPTY, 0);
        while index < characters.len() {
            set.insert(characters[index]);
            index += 1;
        }
        set
    }

    #[inline]
    pub const fn words(&self) -> &[u64; 4] {
        &self.0
    }

    #[inline]
    pub const fn contains(&self, c: u8) -> bool {
        self.0[(c >> 6) as usize] >> (c & 63) & 1 != 0
    }

    #[inline]
    pub const fn insert(&mut self, c: u8) {
        self.0[(c >> 6) as usize] |= 1 << (c & 63);
    }

    /// Nothing if `first > last`.
    #[inline]
    pub const fn insert_range(&mut self, first: u8, last: u8) {
        let (first_word, last_word) = ((first >> 6) as usize, (last >> 6) as usize);
        let (from_first, to_last) = (u64::MAX << (first & 63), u64::MAX >> (63 - (last & 63)));
        if first_word == last_word {
            self.0[first_word] |= from_first & to_last;
        } else if first_word < last_word {
            self.0[first_word] |= from_first;
            self.0[last_word] |= to_last;
            let mut word = first_word + 1;
            while word < last_word {
                self.0[word] = u64::MAX;
                word += 1;
            }
        }
    }

    #[inline]
    pub const fn complement(self) -> Latin1Set {
        let [a, b, c, d] = self.0;
        Latin1Set([!a, !b, !c, !d])
    }

    /// With the other case of each letter that has both its cases in Latin-1.
    #[inline]
    pub const fn with_both_cases(self) -> Latin1Set {
        const fn pair(word: u64, upper: u64) -> u64 {
            word | (word & upper) << 32 | word >> 32 & upper
        }
        let [a, b, c, d] = self.0;
        Latin1Set([a, pair(b, ASCII_UPPER_CASE), c, pair(d, 0x7f7f_ffff)])
    }

    /// In lower case, if the set is both cases of one.
    #[inline]
    pub(crate) fn only_ascii_letter(&self) -> Option<u8> {
        let [a, b, c, d] = self.0;
        let upper = b & ASCII_UPPER_CASE;
        (a | c | d == 0 && upper.is_power_of_two() && b == upper | upper << 32)
            .then(|| 0x60 + upper.trailing_zeros() as u8)
    }

    #[inline]
    pub const fn is_empty(&self) -> bool {
        let [a, b, c, d] = self.0;
        a | b | c | d == 0
    }

    #[inline]
    pub const fn len(&self) -> u32 {
        let [a, b, c, d] = self.0;
        a.count_ones() + b.count_ones() + c.count_ones() + d.count_ones()
    }

    #[inline]
    pub fn intersects(&self, other: &Latin1Set) -> bool {
        !(*self & *other).is_empty()
    }

    #[inline]
    pub fn is_subset_of(&self, other: &Latin1Set) -> bool {
        (*self - *other).is_empty()
    }

    /// The first position at or after `from` whose bit differs from those of `skipped`, or 256.
    fn next_bit(&self, from: u32, skipped: u64) -> u32 {
        let mut mask = u64::MAX << (from & 63);
        for word in from >> 6..4 {
            let bits = (self.0[word as usize] ^ skipped) & mask;
            if bits != 0 {
                return word * 64 + bits.trailing_zeros();
            }
            mask = u64::MAX;
        }
        256
    }

    /// Ascending.
    #[inline]
    pub fn iter(self) -> impl Iterator<Item = u8> {
        let (mut word, mut left) = (0, self.0[0]);
        core::iter::from_fn(move || {
            while left == 0 {
                left = *self.0.get(word + 1)?;
                word += 1;
            }
            let bit = left.trailing_zeros();
            left &= left - 1;
            Some(word as u8 * 64 + bit as u8)
        })
    }

    /// Ascending, with a gap between any two.
    pub fn ranges(self) -> impl Iterator<Item = CharRange> {
        let mut next = 0;
        core::iter::from_fn(move || {
            let first = self.next_bit(next, 0);
            next = self.next_bit(first, u64::MAX);
            (first < 256).then(|| CharRange::new(first, next - 1))
        })
    }
}

impl BitOr for Latin1Set {
    type Output = Latin1Set;

    #[inline]
    fn bitor(self, other: Latin1Set) -> Latin1Set {
        Latin1Set(core::array::from_fn(|word| self.0[word] | other.0[word]))
    }
}

impl BitOrAssign for Latin1Set {
    #[inline]
    fn bitor_assign(&mut self, other: Latin1Set) {
        *self = *self | other;
    }
}

impl BitAnd for Latin1Set {
    type Output = Latin1Set;

    #[inline]
    fn bitand(self, other: Latin1Set) -> Latin1Set {
        Latin1Set(core::array::from_fn(|word| self.0[word] & other.0[word]))
    }
}

impl Sub for Latin1Set {
    type Output = Latin1Set;

    #[inline]
    fn sub(self, other: Latin1Set) -> Latin1Set {
        self & !other
    }
}

impl Not for Latin1Set {
    type Output = Latin1Set;

    #[inline]
    fn not(self) -> Latin1Set {
        self.complement()
    }
}
