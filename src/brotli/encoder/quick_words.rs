//! A hash table over the static dictionary for qualities below 10. The executable has the quarter of it that the rest follows from.
#![allow(clippy::large_unopt_stack_frames)]

use bun_highway::brotli_quick::{WORD_COUNT, WORD_ROW_BITS, Words};

use super::matching::hash_of_four;
use super::words::OMIT_LAST;
use crate::dictionary::{MAX_WORD_LENGTH, MIN_WORD_LENGTH, padded_word, size_bits};
use crate::transform::Kind::{Identity, UppercaseFirst};
use crate::transform::Transform;

const BUCKET_SIZE: u8 = 8;

static TRANSFORMS: [[[u8; 4]; 256]; 2] = {
    let (mut transforms, mut i) = ([[[0; _]; _]; _], 0);
    while i < 4 * 256 {
        let kind = [Identity, UppercaseFirst][i / 512];
        let prefix = b" ".split_at(i % 2).0;
        let four = &mut transforms[i / 512][i / 2 % 256];
        four[i % 2 * 2] = Transform::index_of(prefix, kind, b"").unwrap();
        four[i % 2 * 2 + 1] = match Transform::index_of(prefix, kind, &[(i / 2) as u8]) {
            Some(transform) => transform,
            None => four[i % 2 * 2],
        };
        i += 1;
    }
    transforms
};

/// Ones past the end of the word.
const fn first_eight(length: usize, index: usize) -> u64 {
    match padded_word(length, index) {
        Some(&[a, b, c, d, e, f, g, h, ..]) => {
            u64::from_le_bytes([a, b, c, d, e, f, g, h]) | past_end(length)
        }
        None => 0,
    }
}

const fn past_end(length: usize) -> u64 {
    u64::MAX.unbounded_shl(8 * length as u32)
}

const fn has_zero_byte(eight: u64) -> bool {
    eight.wrapping_sub(0x0101_0101_0101_0101) & !eight & 0x8080_8080_8080_8080 != 0
}

struct Buckets {
    sizes: [u8; 8 << WORD_ROW_BITS],
    packed: [u16; WORD_COUNT],
}

#[allow(long_running_const_eval)]
static BUCKETS: Buckets = {
    // Counts the words, ASCII first, and then fills the buckets from their ends. The shortest get a place.
    let mut first_four = [0; 8 << WORD_ROW_BITS];
    let (mut room, mut starts) = ([0; 8 << WORD_ROW_BITS], [0; 8 << WORD_ROW_BITS]);
    let (mut sizes, mut packed) = (room, [0; _]);
    let mut pass = 0;
    while pass < 3 {
        let (mut length, mut index) = (MIN_WORD_LENGTH, 0);
        while length <= MAX_WORD_LENGTH {
            let eight = first_eight(length, index);
            let four = eight as u32 | 32;
            let mut slot = 8 * hash_of_four(four, WORD_ROW_BITS);
            let end = slot + 8;
            while slot < end && first_four[slot] != four && first_four[slot] != 0 {
                slot += 1;
            }
            if slot == end || has_zero_byte(eight) {
            } else if pass == 2 && room[slot] != 0 {
                room[slot] -= 1;
                packed[starts[slot] + room[slot] as usize] = (index * 32 + length) as u16;
            } else if pass == eight / 128 % 2 {
                first_four[slot] = four;
                room[slot] += (room[slot] < BUCKET_SIZE) as u8;
            }
            index += 1;
            if index == 1 << size_bits(length) {
                (length, index) = (length + 1, 0);
            }
        }
        if pass == 1 {
            let mut i = 1;
            while i < room.len() {
                starts[i] = starts[i - 1] + room[i - 1] as usize;
                i += 1;
            }
            sizes = room;
        }
        pass += 1;
    }
    Buckets { sizes, packed }
};

pub(super) fn fill(words: &mut Words) {
    let slots = (words.first_four.as_flattened_mut().iter_mut())
        .zip(words.buckets.as_flattened_mut())
        .zip(&BUCKETS.sizes);
    let mut at = 0;
    for ((first_four, bucket), &size) in slots {
        *bucket = at as u32 | (u32::from(size) << 14);
        for place in 0..size {
            let packed = usize::from(BUCKETS.packed[at]);
            let eight = first_eight(packed % 32, packed / 32);
            *first_four = eight as u32 | 32;
            *bucket += u32::from(packed % 32 > 8) << 19;
            *bucket |= (eight as u32 / 32 % 2) << (24 + place);
            words.next_four[at] = ((eight & !past_end(packed % 32)) >> 32) as u32;
            at += 1;
        }
    }
    words.packed[..WORD_COUNT].copy_from_slice(&BUCKETS.packed);
    words.transforms = TRANSFORMS;
    words.omit_last[..OMIT_LAST.len()].copy_from_slice(&OMIT_LAST);
}
