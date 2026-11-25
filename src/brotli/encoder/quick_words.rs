//! A hash table over the static dictionary for qualities below 10, built at compile time.
#![allow(clippy::large_unopt_stack_frames)]

use bun_highway::brotli_quick::{WORD_ROW_BITS, Words};

use super::matching::hash_of_four;
use super::words::OMIT_LAST;
use crate::dictionary::{MAX_WORD_LENGTH, MIN_WORD_LENGTH, padded_word, size_bits};
use crate::transform::Kind::{Identity, UppercaseFirst};
use crate::transform::Transform;

const BUCKET_SIZE: u32 = 8;

const fn has_zero_byte(eight: u64) -> bool {
    eight.wrapping_sub(0x0101_0101_0101_0101) & !eight & 0x8080_8080_8080_8080 != 0
}

#[allow(long_running_const_eval)]
pub(super) static WORDS: Words = {
    let mut words = Words {
        first_four: [[0; _]; _],
        buckets: [[0; _]; _],
        next_four: [0; _],
        transforms: [[[0; _]; _]; _],
        packed: [0; _],
        omit_last: [0; _],
    };
    // Counts the words, ASCII first, and then fills the buckets from their ends. The shortest get a place.
    let mut room = [[0; 8]; 1 << WORD_ROW_BITS];
    let mut pass = 0;
    while pass < 3 {
        let (mut length, mut index) = (MIN_WORD_LENGTH, 0);
        while length <= MAX_WORD_LENGTH {
            let word = padded_word(length, index).unwrap();
            let eight = u64::from_le_bytes(*word.first_chunk().unwrap());
            let past_end = u64::MAX.unbounded_shl(8 * length as u32);
            let four = eight as u32 | 32;
            let row = hash_of_four(four, WORD_ROW_BITS);
            let mut slot = 0;
            while slot < 8
                && words.first_four[row][slot] != four
                && words.first_four[row][slot] != 0
            {
                slot += 1;
            }
            if slot == 8 || has_zero_byte(eight | past_end) {
            } else if pass == 2 && room[row][slot] != 0 {
                room[row][slot] -= 1;
                let bucket = &mut words.buckets[row][slot];
                let at = (*bucket % (1 << 14) + room[row][slot]) as usize;
                *bucket += ((length > 8) as u32) << 19;
                *bucket |= (word[0] as u32 / 32 % 2) << (24 + room[row][slot]);
                words.next_four[at] = ((eight & !past_end) >> 32) as u32;
                words.packed[at] = (index * 32 + length) as u16;
            } else if pass == word[0] / 128 {
                words.first_four[row][slot] = four;
                room[row][slot] += (room[row][slot] < BUCKET_SIZE) as u32;
            }
            index += 1;
            if index == 1 << size_bits(length) {
                (length, index) = (length + 1, 0);
            }
        }
        let (mut i, mut start) = (0, 0);
        while pass == 1 && i < 8 * room.len() {
            words.buckets[i / 8][i % 8] = start | (room[i / 8][i % 8] << 14);
            start += room[i / 8][i % 8];
            i += 1;
        }
        pass += 1;
    }
    let mut i = 0;
    while i < 4 * 256 {
        let kind = [Identity, UppercaseFirst][i / 512];
        let prefix = b" ".split_at(i % 2).0;
        let four = &mut words.transforms[i / 512][i / 2 % 256];
        four[i % 2 * 2] = Transform::index_of(prefix, kind, b"").unwrap();
        four[i % 2 * 2 + 1] = match Transform::index_of(prefix, kind, &[(i / 2) as u8]) {
            Some(transform) => transform,
            None => four[i % 2 * 2],
        };
        i += 1;
    }
    (words.omit_last.split_at_mut(OMIT_LAST.len()).0).copy_from_slice(&OMIT_LAST);
    words
};
