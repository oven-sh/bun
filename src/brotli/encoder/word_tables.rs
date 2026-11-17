//! Hash tables over the static dictionary, built at compile time.
#![allow(clippy::large_unopt_stack_frames, clippy::large_const_arrays)] // None of them exist at run time.

use core::ops::Range;

use super::matching::{bytes_at, hash_of_four};
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

    #[inline(always)]
    pub(super) fn spelling(self) -> &'static [u8] {
        &self.padded_spelling()[..self.length()]
    }

    /// With the transform that has this index.
    #[inline(always)]
    pub(super) fn address(self, transform: u8) -> usize {
        self.index() + (usize::from(transform) << size_bits(self.length()))
    }
}

/// Whether there are [`likely_words`] for `first_four`.
#[inline(always)]
pub(super) fn has_likely_words(first_four: [u8; 4]) -> bool {
    let hash = hash_of_four(u32::from_le_bytes(first_four), START_BITS);
    (LIKELY.starts[hash / 64] >> (hash % 64)) & 1 != 0
}

/// A word of at least eight bytes and a shorter one, which may start with `first_four`. Only if it [`has_likely_words`].
#[inline(always)]
pub(super) fn likely_words(first_four: [u8; 4]) -> [PackedWord; 2] {
    let hash = hash_of_four(u32::from_le_bytes(first_four), START_BITS);
    let before = LIKELY.starts[hash / 64] & ((1 << (hash % 64)) - 1);
    LIKELY.words[usize::from(LIKELY.ranks[hash / 64]) + before.count_ones() as usize]
}

/// Words compete for the slots of a hash with this many bits.
const LIKELY_BITS: u32 = 14;
/// So many that few hashes have a word.
const START_BITS: u32 = 17;
const START_COUNT: usize = 4997;

struct Likely {
    /// A bit for each hash that has words.
    starts: [u64; 1 << (START_BITS - 6)],
    /// How many bits are set before each of `starts`.
    ranks: [u16; 1 << (START_BITS - 6)],
    words: [[PackedWord; 2]; START_COUNT],
}

static LIKELY: Likely = {
    let mut table = [[(PackedWord(0), 0); 2]; 1 << LIKELY_BITS];
    let mut kept = [[false; 2]; 1 << LIKELY_BITS];
    let mut count = 0;
    let mut length = MAX_WORD_LENGTH;
    while length >= MIN_WORD_LENGTH {
        let slot = (length < 8) as usize;
        let mut index = 1 << size_bits(length);
        while index > 0 {
            index -= 1;
            let [a, b, c, d, ..] = *word(length, index);
            let hash = hash_of_four(u32::from_le_bytes([a, b, c, d]), START_BITS);
            let key = hash >> (START_BITS - LIKELY_BITS);
            if !kept[key][slot] {
                table[key][slot] = (PackedWord::new(length, index), hash);
                kept[key][slot] = (KEEPS_ITS_SLOT[count / 64] >> (count % 64)) & 1 != 0;
            }
            count += 1;
        }
        length -= 1;
    }

    let mut likely = Likely {
        starts: [0; _],
        ranks: [0; _],
        words: [[PackedWord(0); 2]; _],
    };
    let (mut hash, mut count) = (0, 0);
    while hash < 1 << START_BITS {
        if hash % 64 == 0 {
            likely.ranks[hash / 64] = count as u16;
        }
        let mut slot = 0;
        while slot < 2 {
            let (word, start) = table[hash >> (START_BITS - LIKELY_BITS)][slot];
            if word.0 != 0 && start == hash {
                likely.words[count][slot] = word;
                likely.starts[hash / 64] |= 1 << (hash % 64);
            }
            slot += 1;
        }
        count += (likely.starts[hash / 64] >> (hash % 64)) as usize;
        hash += 1;
    }
    assert!(count == START_COUNT);
    likely
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Case {
    Unchanged,
    UppercaseFirst,
    UppercaseAll,
}

const CASES: [Case; 3] = [Case::Unchanged, Case::UppercaseFirst, Case::UppercaseAll];
const TAG_BITS: u32 = 6;

/// For a word that is of use if four bytes match, and for one that takes five.
#[inline(always)]
const fn tags_of(first_eight: u64) -> [u8; 2] {
    let hash = hash_of_four(first_eight as u32, ALL_BITS + 5) as u8;
    let fifth = (first_eight >> 32) as u8;
    [32 + hash % 32, hash.wrapping_add(fifth) % 32]
}

/// A bit for each of `tags` that is either.
#[inline(never)] // Inlined, it does not always become vector instructions.
fn tagged_with(tags: &[u8; 16], four: u8, five: u8) -> u32 {
    (0..16).fold(0, |bits, i| {
        let tag = tags[i] % (1 << TAG_BITS);
        bits | (u32::from((tag == four) | (tag == five)) << i)
    })
}

#[inline(always)]
fn alike_among(Range { start, end }: Range<usize>, [four, five]: [u8; 2]) -> u32 {
    tagged_with(&bytes_at(&ALL.tags, start), four, five) & ((1 << (end - start).min(16)) - 1)
}

/// From the longest to the shortest. Of the words that match for just four bytes, those with the lowest address are among them.
#[inline(always)]
pub(super) fn all_words(first_eight: u64) -> impl Iterator<Item = (PackedWord, Case)> {
    let key = hash_of_four(first_eight as u32, ALL_BITS);
    let (mut at, end) = (
        usize::from(ALL.starts[key]),
        usize::from(ALL.starts[key + 1]),
    );
    let tags = tags_of(first_eight);
    let mut alike = alike_among(at..end, tags);
    core::iter::from_fn(
        #[inline(always)]
        move || {
            while alike == 0 {
                at += 16;
                if at >= end {
                    return None;
                }
                alike = alike_among(at..end, tags);
            }
            let index = at + alike.trailing_zeros() as usize;
            alike &= alike - 1;
            let case = CASES[usize::from(ALL.tags[index] >> TAG_BITS)];
            Some((ALL.words[index], case))
        },
    )
}

const ALL_BITS: u32 = 15;
const ALL_COUNT: usize = 31704;

struct All {
    starts: [u16; (1 << ALL_BITS) + 1],
    words: [PackedWord; ALL_COUNT],
    /// With the [`Case`] above them.
    tags: [u8; ALL_COUNT + 16],
}

const WORD_COUNT: usize = 13504;

/// Of each word, from the shortest to the longest: the key and the bytes.
const fn spell(case: Case) -> [(u16, [u64; 3]); WORD_COUNT] {
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
            *key = hash_of_four(bytes[0] as u32, ALL_BITS) as u16;
            count += 1;
            index += 1;
        }
        length += 1;
    }
    spelled
}

static ALL: All = {
    const NONE: usize = ALL_COUNT;
    const UNCHANGED: [(u16, [u64; 3]); WORD_COUNT] = spell(CASES[0]);
    const UPPERCASE_FIRST: [(u16, [u64; 3]); WORD_COUNT] = spell(CASES[1]);
    const UPPERCASE_ALL: [(u16, [u64; 3]); WORD_COUNT] = spell(CASES[2]);
    let spellings = [&UNCHANGED, &UPPERCASE_FIRST, &UPPERCASE_ALL];
    let mut found = [((PackedWord(0), 0), [0u64; 3]); ALL_COUNT];
    // For a hash of four bytes, the longer word that is cut down to them at the lowest address.
    let mut lowest = [(usize::MAX, NONE); 1 << 17];
    let mut earlier = [NONE; ALL_COUNT];
    let mut latest = [NONE; 1 << ALL_BITS];
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
                let word = PackedWord::new(length, index);
                let [four, five] = tags_of(spelled[0]);
                let mut tag = if length == 4 { four } else { five };
                if matches!(case, Case::Unchanged) && length > 4 && length - 4 < OMIT_LAST.len() {
                    let address = index + ((OMIT_LAST[length - 4] as usize) << size_bits(length));
                    let (other_address, other) = &mut lowest[hash_of_four(spelled[0] as u32, 17)];
                    if *other != NONE && found[*other].1[0] as u32 != spelled[0] as u32 {
                        tag = four;
                    } else if address < *other_address {
                        if *other != NONE {
                            found[*other].0.1 = tags_of(found[*other].1[0])[1];
                        }
                        (*other_address, *other) = (address, count);
                        tag = four;
                    }
                }
                found[count] = ((word, tag + ((case as u8) << TAG_BITS)), spelled);
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
        starts: [0; (1 << ALL_BITS) + 1],
        words: [PackedWord(0); _],
        tags: [0; _],
    };
    let (mut key, mut next) = (0, 0);
    while key < 1 << ALL_BITS {
        let mut other = latest[key];
        while other != NONE {
            (all.words[next], all.tags[next]) = found[other].0;
            next += 1;
            other = earlier[other];
        }
        key += 1;
        all.starts[key] = next as u16;
    }
    all
};

/// A bit for each word, from the last to the first: whether the words before it leave it in [`LIKELY`].
#[rustfmt::skip]
const KEEPS_ITS_SLOT: [u64; WORD_COUNT / 64] = [
    // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/dictionary_hash.c#L29
    0xBF1F_3820_A408_0000, 0x8191_8444_5180_0424, 0x0101_0800_1C00_0000, 0x0000_0000_0001_0340,
    0x3184_0080_0201_4004, 0x0000_0000_0000_0000, 0x9824_0001_0000_0011, 0x0000_0880_0000_0000,
    0x0040_0000_0800_0080, 0x0000_0000_0000_0000, 0x8540_0001_0000_0008, 0x0000_0180_0000_2000,
    0x8210_2004_0404_0000, 0x0000_0000_0008_8000, 0x3594_00A0_0040_0040, 0x8200_8000_0000_0000,
    0x0000_0000_0800_0000, 0x0000_0000_0000_3000, 0x0100_0C00_8120_0120, 0x1000_0000_0000_0000,
    0x0000_0020_1000_0000, 0x0000_0100_0000_0000, 0x0000_0000_0200_0008, 0x8042_0200_0000_2000,
    0x4000_0000_0010_0000, 0x2018_C000_0880_0601, 0xA002_8080_0408_0000, 0x0002_0000_4000_A000,
    0x0000_0000_0000_0000, 0x0000_0040_0000_0120, 0x0200_4200_2000_0000, 0x0000_0200_0800_0400,
    0x8000_0800_0000_0821, 0xA000_2102_0080_04A2, 0x8100_A000_4000_0800, 0x0020_0000_2000_0004,
    0x8000_0000_0000_0002, 0x000A_4000_0000_0000, 0x0000_0040_2000_0000, 0x0000_1010_0010_0000,
    0x0008_0000_0000_0250, 0x0800_0000_0800_1000, 0x00D0_0800_0000_8040, 0x0020_0000_0000_0000,
    0x0800_2000_0000_0000, 0x0000_0100_0000_8000, 0x2400_0088_0108_1000, 0x0008_2001_0009_4000,
    0x0004_20E0_1083_4040, 0x6004_0083_00A0_0504, 0x60CD_B100_C0B8_0000, 0x0020_0002_0000_0000,
    0x4000_0000_0000_0000, 0x0000_0800_0080_0000, 0x0000_0100_0401_0000, 0x0000_0000_0000_0400,
    0x0800_0045_4000_0004, 0x0000_0000_4020_4202, 0x0000_0011_8000_0100, 0x0C00_0000_0000_0000,
    0x0040_8004_0000_1000, 0xE000_0000_0000_0000, 0x8040_1082_0000_0800, 0xC002_8000_0000_4002,
    0x0010_0000_0041_0040, 0x004C_0202_0420_0000, 0x4C2C_8334_4804_0000, 0x9410_0140_0000_0000,
    0x0002_0040_0A10_0004, 0x0000_0044_4080_0001, 0x0200_0800_9040_0000, 0x4003_0000_0000_0000,
    0x0000_8001_0000_0000, 0x1200_2800_0000_4220, 0x0000_2100_0000_0000, 0x4004_8000_2000_0020,
    0x0200_8000_0000_8C91, 0x0000_2650_0014_0000, 0x0400_0404_4020_0020, 0x9000_0004_8100_0000,
    0x0086_1884_1082_2011, 0x21C2_0832_0502_4000, 0x36A1_2008_0175_4401, 0x8040_0000_0022_8200,
    0x2000_0000_0002_0000, 0x0000_0E03_0000_0001, 0x0000_0004_1000_0000, 0x1801_6000_0000_0000,
    0x0040_0018_8001_0012, 0x0000_4000_8010_0004, 0x0000_0000_0800_4000, 0x0000_0000_0080_4200,
    0x0000_0000_0000_0000, 0x0000_0240_0010_0000, 0x0002_0808_0006_0000, 0x0202_8000_0000_0040,
    0x8000_0800_4000_400C, 0x0020_0000_0A00_0020, 0x4060_0088_0821_2080, 0x1004_4000_0000_0000,
    0x0200_1000_0000_0804, 0x0010_4000_8001_0000, 0x0800_0000_0000_0000, 0x0004_0010_0002_0000,
    0x0014_0000_0000_0008, 0x0000_0000_0100_0000, 0x0800_0000_0000_0000, 0x0008_0000_0000_0088,
    0x0000_0002_0000_0000, 0x0000_0200_0100_0040, 0x8000_0000_0000_0000, 0x0000_0004_0000_0000,
    0x0000_0000_0000_4100, 0x0000_0004_0000_0000, 0x0000_0000_0000_0000, 0x0002_0800_0000_8002,
    0x0400_0002_1000_8000, 0x4040_0401_0000_2000, 0x2000_1000_0100_0400, 0x2514_000A_4104_0444,
    0x0803_8020_0094_0112, 0x0000_0000_0000_4000, 0x0000_0080_0110_0004, 0x8001_0000_0000_1080,
    0x8200_4080_4080_0000, 0x8040_0100_0008_A400, 0x0008_0096_0200_1200, 0x8010_0000_5100_4000,
    0x0D90_0481_2024_0802, 0x0002_0001_0803_0000, 0x0122_0100_0500_4000, 0x0000_8080_8010_0220,
    0x220C_0812_0400_0200, 0x0000_21E0_4006_C020, 0x8080_0818_0040_4889, 0x0884_8080_2000_1000,
    0x0400_0040_0010_0000, 0x0040_8004_0010_0000, 0x8290_2040_0400_0100, 0x4052_4000_C000_8002,
    0x0054_0002_8080_2001, 0x1020_5048_182C_0020, 0x4801_4060_102C_0000, 0xA500_0010_0000_0083,
    0x0C40_4030_3102_8100, 0x4014_8008_5440_B040, 0xAA53_0F29_0168_88D5, 0xC100_4040_0129_0000,
    0x4000_0080_0008_4040, 0x0008_0010_0108_4008, 0x618D_541C_8001_0200, 0x0008_8100_0044_0000,
    0x0000_0040_0020_0810, 0x8008_00C0_0000_0018, 0x0100_4000_0000_0000, 0x4080_0128_0000_0000,
    0x0000_0000_2002_0400, 0x0000_0000_0000_0000, 0x0000_0020_0008_2080, 0x2100_0004_0200_1110,
    0x0081_0000_0000_0280, 0x0220_0024_0000_0002, 0x0020_0000_0000_0000, 0x0000_0000_0400_0000,
    0x0000_4020_0400_0000, 0x2000_0020_0000_0000, 0x0000_0000_0000_0080, 0x0000_0010_8000_0000,
    0x0088_0001_0000_0000, 0x1211_0003_80C0_1800, 0x0900_1804_0042_0002, 0x8200_4014_9000_A7D0,
    0x204A_0888_1002_0040, 0x010C_0820_4100_A800, 0x0040_0003_B440_0103, 0x1004_0041_2000_0008,
    0x1820_2440_2044_1004, 0x2000_0800_0080_0121, 0x0008_130A_0100_5140, 0x8008_0000_9005_0400,
    0x0000_0000_0004_0000, 0x0000_0800_0000_0100, 0x2100_0001_5000_0000, 0x2B01_0002_0442_2000,
    0x4000_1020_0400_0002, 0x7440_4002_0020_0300, 0xC040_1100_4034_4100, 0x1100_0402_080A_0860,
    0x0080_0400_0004_0040, 0xC000_0282_0000_0900, 0x4000_6000_4080_3000, 0x0620_0100_2010_0100,
    0x3000_000C_0020_0280, 0x0012_0080_0000_0820, 0x0020_0510_2918_1C00, 0x0010_0000_0000_0000,
    0x0000_0000_0000_0000, 0x0000_0100_0000_0000, 0x0040_0000_0000_1000, 0x0000_0000_0800_0000,
    0x0000_1000_0000_8010, 0x0000_0008_0000_0000, 0x0000_0000_0000_0000, 0x0000_0000_0021_0000,
    0x0000_0000_0000_0000, 0x0000_0000_0000_1000, 0x0000_0000_0000_0000, 0x0000_0000_0000_0000,
    0x0000_0000_0000_0000, 0x0000_0000_0000_0000, 0x0000_0000_0000_0000,
];
