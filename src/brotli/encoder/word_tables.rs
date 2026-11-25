//! Hash tables over the static dictionary, built at compile time.
#![allow(clippy::large_unopt_stack_frames, clippy::large_const_arrays)] // None of them exist at run time.

use bun_highway::brotli::tagged;

use super::matching::{HASH_MULTIPLIER_64, array_at, hash_of_four};
use super::words::OMIT_LAST;
use crate::dictionary::{
    MAX_WORD_LENGTH, MIN_WORD_LENGTH, PADDED_WORD_LENGTH, padded_word, size_bits,
};

#[inline(always)]
const fn word(length: usize, index: usize) -> &'static [u8; PADDED_WORD_LENGTH] {
    match padded_word(length, index) {
        Some(word) => word,
        None => &[0; PADDED_WORD_LENGTH],
    }
}

/// The length in the low 5 bits, and above it the index. Zero for no word.
#[derive(Clone, Copy)]
pub(super) struct PackedWord(u16);

impl PackedWord {
    const fn new(length: usize, index: usize) -> Self {
        Self((index * 32 + length) as u16)
    }

    #[inline(always)]
    pub(super) fn length(self) -> usize {
        usize::from(self.0 % 32)
    }

    #[inline(always)]
    fn index(self) -> usize {
        usize::from(self.0 / 32)
    }

    /// With what follows it.
    #[inline(always)]
    pub(super) fn padded_spelling(self) -> &'static [u8; PADDED_WORD_LENGTH] {
        word(self.length(), self.index())
    }

    /// With the transform that has this index.
    #[inline(always)]
    pub(super) fn address(self, transform: u8) -> usize {
        self.index() + (usize::from(transform) << size_bits(self.length()))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Case {
    Unchanged,
    UppercaseFirst,
    UppercaseAll,
}

const CASES: [Case; 3] = [Case::Unchanged, Case::UppercaseFirst, Case::UppercaseAll];
const CASE_BITS: u32 = 2;
const GROUP: usize = 16;

#[inline(always)]
const fn hash_of_start(first_eight: u64, length: usize) -> u64 {
    (first_eight << (64 - 8 * length)).wrapping_mul(HASH_MULTIPLIER_64)
}

/// For a word that is of use if `length` bytes match.
#[inline(always)]
const fn tag_of(first_eight: u64, length: usize) -> u16 {
    (hash_of_start(first_eight, length) >> (48 + CASE_BITS)) as u16
}

/// So many that few hashes have a word.
const START_BITS: u32 = 17;

/// Whether to ask for [`Alike`] words.
#[inline(always)]
pub(super) fn has_words(first_four: u32) -> bool {
    let hash = hash_of_four(first_four, START_BITS);
    (ALL.starts[hash / 64] >> (hash % 64)) & 1 != 0
}

/// Of the words that match for just five to seven bytes, those with the lowest address are among them.
#[derive(Clone, Copy)]
pub(super) struct Alike(u64);

impl Alike {
    pub(super) const NONE: Self = Self(0);

    #[inline(always)]
    pub(super) fn to(first_eight: u64) -> Self {
        let hash = hash_of_four(first_eight as u32, START_BITS);
        let before = ALL.starts[hash / 64] & ((1 << (hash % 64)) - 1);
        let rank = usize::from(ALL.ranks[hash / 64]) + before.count_ones() as usize;
        let [mut start, end] = array_at(&ALL.bounds, rank % RANKS).map(usize::from);
        let tag = |length| tag_of(first_eight, length);
        let tags = [tag(4), tag(5), tag(6), tag(7), tag(8)];
        let group = |at| u64::from(tagged(array_at(&ALL.tags, at % WORDS), &tags));
        let mut bits = group(start);
        if end - start > GROUP {
            while bits == 0 && end - start > 3 * GROUP {
                start += GROUP;
                bits = group(start);
            }
            bits |= group(start + GROUP) << GROUP | group(start + 2 * GROUP) << (2 * GROUP);
        }
        Self((bits & !u64::MAX.unbounded_shl((end - start) as u32)) << 16 | start as u64)
    }

    #[inline(always)]
    pub(super) fn is_empty(self) -> bool {
        self.0 >> 16 == 0
    }
}

impl Iterator for Alike {
    /// With the number of its [`Case`].
    type Item = (PackedWord, usize);

    #[inline(always)]
    fn next(&mut self) -> Option<Self::Item> {
        let bit = (self.0 >> 16).lowest_one()?;
        self.0 ^= 1 << 16 << bit;
        let index = (usize::from(self.0 as u16) + bit as usize) % WORDS;
        Some((
            ALL.words[index],
            usize::from(ALL.tags[index] % (1 << CASE_BITS)),
        ))
    }
}

const WORDS: usize = 1 << 15;
const RANKS: usize = 1 << 14;
const ALL_COUNT: usize = 31704;

struct All {
    /// As in [`Likely`].
    starts: [u64; 1 << (START_BITS - 6)],
    ranks: [u16; 1 << (START_BITS - 6)],
    bounds: [u16; RANKS + 1],
    words: [PackedWord; WORDS],
    /// With the [`Case`] below them.
    tags: [u16; WORDS + GROUP],
}

const WORD_COUNT: usize = 13504;

/// Of each word, from the shortest to the longest: the key and the bytes.
const fn spell(case: Case) -> [(u32, [u64; 3]); WORD_COUNT] {
    let mut spelled = [(0, [0; 3]); WORD_COUNT];
    let mut count = 0;
    let mut length = MIN_WORD_LENGTH;
    while length <= MAX_WORD_LENGTH {
        let (words, mut index) = (1 << size_bits(length), 0);
        while index < words {
            let word = word(length, index);
            let (key, bytes) = &mut spelled[count];
            let mut i = 0;
            while i < length {
                let byte = match (case, word[i]) {
                    (Case::UppercaseFirst, lower @ b'a'..=b'z') if i == 0 => lower ^ 32,
                    (Case::UppercaseAll, lower @ b'a'..=b'z') => lower ^ 32,
                    (_, byte) => byte,
                };
                bytes[i / 8] |= (byte as u64) << (i % 8 * 8);
                i += 1;
            }
            *key = hash_of_four(bytes[0] as u32, START_BITS) as u32;
            count += 1;
            index += 1;
        }
        length += 1;
    }
    spelled
}

static ALL: All = {
    const NONE: usize = ALL_COUNT;
    const UNCHANGED: [(u32, [u64; 3]); WORD_COUNT] = spell(CASES[0]);
    const UPPERCASE_FIRST: [(u32, [u64; 3]); WORD_COUNT] = spell(CASES[1]);
    const UPPERCASE_ALL: [(u32, [u64; 3]); WORD_COUNT] = spell(CASES[2]);
    let spellings = [&UNCHANGED, &UPPERCASE_FIRST, &UPPERCASE_ALL];
    let mut found = [(0, [0u64; 3]); ALL_COUNT];
    // For a hash of five to seven bytes, the longer word that is cut down to them at the lowest address.
    let mut lowest = [(usize::MAX, NONE); 1 << 19];
    let mut earlier = [NONE; ALL_COUNT];
    let mut latest = [NONE; 1 << START_BITS];
    let (mut count, mut shorter_words) = (0, 0);
    let mut length = MIN_WORD_LENGTH;
    while length <= MAX_WORD_LENGTH {
        let (first_of_length, words) = (count, 1 << size_bits(length));
        let mut step = 0;
        while step < 3 * words {
            let (case, index) = (CASES[step / words], step % words);
            let (key, spelled) = spellings[step / words][shorter_words + index];
            let key = key as usize;
            step += 1;
            let is_ascii = (spelled[0] | spelled[1] | spelled[2]) & 0x8080_8080_8080_8080 == 0;
            if matches!(case, Case::UppercaseAll) && !is_ascii {
                continue;
            }
            let mut other = latest[key];
            let mut is_new = true;
            while !matches!(case, Case::Unchanged) && other != NONE && other >= first_of_length {
                let [a, b, c] = found[other].1;
                is_new &= a != spelled[0] || b != spelled[1] || c != spelled[2];
                other = earlier[other];
            }
            if is_new {
                let mut kept = 5;
                while matches!(case, Case::Unchanged) && kept < 8 && kept < length {
                    if length - kept < OMIT_LAST.len() {
                        let transform = OMIT_LAST[length - kept] as usize;
                        let address = index + (transform << size_bits(length));
                        let best = &mut lowest[(hash_of_start(spelled[0], kept) >> 45) as usize];
                        if address < best.0 {
                            *best = (address, count);
                        }
                    }
                    kept += 1;
                }
                let word = PackedWord::new(length, index).0 as u32;
                found[count] = (word | (case as u32) << 16, spelled);
                earlier[count] = latest[key];
                latest[key] = count;
                count += 1;
            }
        }
        shorter_words += words;
        length += 1;
    }
    assert!(count == ALL_COUNT);

    let mut all = All {
        starts: [0; _],
        ranks: [0; _],
        bounds: [ALL_COUNT as u16; _],
        words: [PackedWord(0); _],
        tags: [0; _],
    };
    let mut orders = [0; ALL_COUNT];
    let (mut key, mut next, mut count) = (0, 0, 0);
    while key < 1 << START_BITS {
        if key % 64 == 0 {
            all.ranks[key / 64] = count as u16;
        }
        let mut other = latest[key];
        if other != NONE {
            all.starts[key / 64] |= 1 << (key % 64);
            all.bounds[count] = next as u16;
            count += 1;
        }
        while other != NONE {
            let (word, [first_eight, ..]) = found[other];
            let mut needed = MIN_WORD_LENGTH;
            while needed < 8
                && needed < word as usize % 32
                && lowest[(hash_of_start(first_eight, needed) >> 45) as usize].1 != other
            {
                needed += 1;
            }
            // What matches is close together.
            let (order, mut at) = (first_eight.swap_bytes(), next);
            while at > all.bounds[count - 1] as usize && orders[at - 1] > order {
                orders[at] = orders[at - 1];
                (all.words[at], all.tags[at]) = (all.words[at - 1], all.tags[at - 1]);
                at -= 1;
            }
            orders[at] = order;
            all.words[at] = PackedWord(word as u16);
            all.tags[at] = tag_of(first_eight, needed) << CASE_BITS | (word >> 16) as u16;
            next += 1;
            other = earlier[other];
        }
        key += 1;
    }
    all
};
