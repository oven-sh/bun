//! Finds words of the static dictionary in the input.

use bun_highway::brotli::differences_in_case;

use super::matching::{array_at, bytes_at, load32, load64};
use super::word_tables::{Alike, Case, has_words};
use crate::transform::Kind::{Identity, OmitLast, UppercaseAll, UppercaseFirst};
use crate::transform::Transform;

/// The transform that omits the last `n` bytes.
pub(super) const OMIT_LAST: [u8; 10] = {
    let (mut transforms, mut n) = ([0; _], 0);
    while n < transforms.len() {
        transforms[n] = Transform::index_of(b"", OmitLast(n as u8), b"").unwrap();
        n += 1;
    }
    transforms
};

const PREFIXES: [&[u8]; 8] = [b"", b" ", b".", b"e ", b"s ", b", ", b" the ", b".com/"];
#[rustfmt::skip]
const SUFFIXES: [&[u8]; 45] = [
    b"", b" ", b" a ", b" as ", b" at ", b" and ", b" by ", b" in ", b" is ", b" for ", b" from ", b" of ", b" of the ", b" on ",
    b" not ", b" the ", b" that ", b" to ", b" with ", b"\"", b"\">", b".", b". ", b". The ", b". This ", b",", b", ", b"\n",
    b"\n\t", b"]", b"'", b":", b"(", b"=\"", b"='", b"al ", b"ed ", b"er ", b"est ", b"ful ", b"ive ", b"ize ", b"less ", b"ly ",
    b"ous ",
];

struct Affixes {
    /// By prefix, [`Case`] and suffix.
    transforms: [[[u8; 64]; 4]; PREFIXES.len()],
    /// A bit for each suffix that has one.
    allowed: [[u64; 4]; PREFIXES.len()],
    /// For each of the first bytes without its top bit, a bit for each suffix that it does not rule out.
    possible: [[u64; 128]; 4],
    /// In the high bits.
    suffixes: [(u64, u32); 64],
}

static AFFIXES: Affixes = {
    let mut all = Affixes {
        transforms: [[[0; _]; _]; _],
        allowed: [[0; _]; _],
        possible: [[0; _]; _],
        suffixes: [(0, 0); _],
    };
    let mut suffix = 0;
    while suffix < SUFFIXES.len() {
        let (text, mut i) = (SUFFIXES[suffix], 0);
        while i < 3 * PREFIXES.len() {
            let kind = [Identity, UppercaseFirst, UppercaseAll][i % 3];
            if let Some(transform) = Transform::index_of(PREFIXES[i / 3], kind, text) {
                all.transforms[i / 3][i % 3][suffix] = transform;
                all.allowed[i / 3][i % 3] |= 1 << suffix;
            }
            i += 1;
        }
        i = 0;
        while i < 4 * 128 {
            let is_possible = i / 128 >= text.len() || text[i / 128] as usize == i % 128;
            all.possible[i / 128][i % 128] |= (is_possible as u64) << suffix;
            i += 1;
        }
        let mut padded = [0; 8];
        padded.split_at_mut(8 - text.len()).1.copy_from_slice(text);
        all.suffixes[suffix] = (u64::from_le_bytes(padded), text.len() as u32);
        suffix += 1;
    }
    all
};

pub(super) const BATCH: usize = 64;

/// What may be words in a batch of positions.
#[derive(Clone, Copy)]
pub(super) struct Words {
    alike: [Alike; 2 * BATCH],
    /// A bit for each prefix that is there in front of one.
    pub(super) prefixes: [u8; BATCH],
}

impl Words {
    pub(super) const NONE: Self = Self {
        alike: [Alike::NONE; _],
        prefixes: [0; _],
    };
}

/// At the positions that have a bit in `wanted`.
#[inline(always)]
pub(super) fn find_prefixes(bytes: &[u8; 2 * BATCH + 8], mut wanted: u64, words: &mut Words) {
    let (mut places, mut count) = ([0; 2 * BATCH], 0);
    let mut look_at = |at: usize| {
        places[count % (2 * BATCH)] = at as u8;
        count += usize::from(has_words(load32(bytes, at)));
    };
    while wanted != 0 {
        look_at(wanted.trailing_zeros() as usize);
        wanted &= wanted - 1;
    }
    look_at(BATCH);
    look_at(BATCH + 1);
    let mut starts = [false; 2 * BATCH];
    for &at in &places[..count] {
        let at = usize::from(at) % (2 * BATCH);
        let alike = Alike::to(load64(bytes, at));
        (words.alike[at], starts[at]) = (alike, !alike.is_empty());
    }
    let prefixes = &mut words.prefixes;
    prefixes.fill(0);
    macro_rules! look_for {
        ($($number:literal)+) => {$(
            for (at, prefixes) in prefixes.iter_mut().enumerate() {
                let mut is_there = starts[at + PREFIXES[$number].len()];
                for (i, &byte) in PREFIXES[$number].iter().enumerate() {
                    is_there &= bytes[at + i] == byte;
                }
                *prefixes |= u8::from(is_there) << $number;
            }
        )+};
    }
    look_for!(0 1 2 3 4 5 6 7);
}

/// What it takes to look at the longest prefix, word and suffix.
pub(super) const READ: usize = 48;

/// Calls `found` with the address, the length in the input, the length of the word, and whether it is there after all.
#[inline(always)]
pub(super) fn find_words(
    bytes: &[u8; READ],
    words: &Words,
    at: usize,
    mut found: impl FnMut(usize, usize, usize, bool),
) {
    static CHANGES: [[u8; 32]; 4] = {
        let mut changes = [[0; _]; _];
        changes[Case::UppercaseFirst as usize][0] = 32;
        changes[Case::UppercaseAll as usize] = [32; _];
        changes
    };
    static LENGTHS: [u8; 8] = [0, 1, 1, 2, 2, 2, 5, 5];
    const ING: u8 = Transform::index_of(b"", OmitLast(1), b"ing ").unwrap();
    let mut prefixes = words.prefixes[at % BATCH];
    while prefixes != 0 {
        let prefix = prefixes.trailing_zeros() as usize % PREFIXES.len();
        prefixes &= prefixes - 1;
        let skipped = usize::from(LENGTHS[prefix] % 8);
        let bytes: &[u8; 40] = array_at(bytes, skipped);
        for (word, case) in words.alike[at % BATCH + skipped] {
            let (spelling, length) = (word.padded_spelling(), word.length());
            let matched =
                differences_in_case(array_at(spelling, 0), &CHANGES[case], array_at(bytes, 0))
                    .trailing_zeros() as usize;
            if matched >= length {
                let after = load64(bytes, length);
                let mut suffixes = AFFIXES.allowed[prefix][case];
                for (i, possible) in AFFIXES.possible.iter().enumerate() {
                    suffixes &= possible[(after >> (8 * i)) as usize % 128];
                }
                while suffixes != 0 {
                    let suffix = suffixes.trailing_zeros() as usize;
                    suffixes &= suffixes - 1;
                    let (text, added) = AFFIXES.suffixes[suffix];
                    let total = skipped + length + added as usize;
                    found(
                        word.address(AFFIXES.transforms[prefix][case][suffix]),
                        total,
                        length,
                        after.unbounded_shl(64 - 8 * added) == text,
                    );
                }
            } else {
                let (omitted, is_plain) = (length - matched, prefix + case == 0);
                found(
                    word.address(OMIT_LAST[omitted.min(9)]),
                    matched,
                    length,
                    is_plain & (omitted <= 9),
                );
                if (omitted == 1) & (bytes_at(bytes, matched) == *b"ing ") {
                    found(word.address(ING), matched + 4, length, is_plain);
                }
            }
        }
    }
}
