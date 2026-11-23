//! Lookup tables of a frozen `UnicodeSet`, which passes its ranges to each call as `list`. ICU4C: bmpset.cpp

use crate::common::slice_ext::SliceExt;
use crate::common::uniset::find_code_point;

pub(crate) struct BMPSet {
    latin1_contains: [bool; 0x100],
    /// One bit per code point below U+0800.
    table_7ff: [u64; 0x20],
    /// One bit per block of 64 code points, set if the block contains a range boundary.
    mixed_blocks: [u64; 0x10],
    /// One bit per block, set if the set contains the whole block. The extra word holds the limit U+10000.
    full_blocks: [u64; 0x11],
    /// Indexes of the first list elements above U+0800, U+1000, ..., U+10000, and the length of the list.
    list_4k_starts: [u32; 0x12],
}

fn has_bit(word: u64, bit: u32) -> bool {
    word >> (bit & 0x3f) & 1 != 0
}

/// Flips the bits of `words` from bit index `start` to the end of the word that contains `start`.
fn flip_from(words: &mut [u64], start: u32) {
    let word = words.at(start as usize / 64) ^ u64::MAX << (start % 64);
    words.set(start as usize / 64, word);
}

/// Extends each earlier `flip_from` to the end of `words`.
fn propagate_flips(words: &mut [u64]) {
    let mut carry = 0;
    for word in words {
        *word ^= carry;
        carry = if has_bit(*word, 63) { u64::MAX } else { 0 };
    }
}

impl BMPSet {
    pub(crate) fn new(list: &[u32]) -> Self {
        let mut set = Self {
            latin1_contains: [false; 0x100],
            table_7ff: [0; 0x20],
            mixed_blocks: [0; 0x10],
            full_blocks: [0; 0x11],
            list_4k_starts: [list.len() as u32; 0x12],
        };
        let mut start = 0;
        for (lead, slot) in (0..=0x10).zip(&mut set.list_4k_starts) {
            start += find_code_point(list.slice(start..), 0x800.max(lead << 12));
            *slot = start as u32;
        }

        let ranges = list.as_chunks::<2>().0;
        for &[start, limit] in ranges.iter().take_while(|[start, _]| *start < 0x100) {
            set.latin1_contains
                .slice_mut(start as usize..limit.min(0x100) as usize)
                .fill(true);
        }
        for &boundary in list.iter().take_while(|&&boundary| boundary < 0x800) {
            flip_from(&mut set.table_7ff, boundary);
        }
        propagate_flips(&mut set.table_7ff);

        let ranges = ranges.slice(set.list_4k_starts[0] as usize / 2..);
        for &[start, limit] in ranges.iter().take_while(|[start, _]| *start < 0x1_0000) {
            let limit = limit.min(0x1_0000);
            set.mark_mixed(start);
            set.mark_mixed(limit);
            if limit - start >= 64 {
                flip_from(&mut set.full_blocks, start.div_ceil(64));
                flip_from(&mut set.full_blocks, limit / 64);
            }
        }
        propagate_flips(&mut set.full_blocks);
        set
    }

    /// Marks the block of `boundary` as mixed unless `boundary` is the start of the block.
    fn mark_mixed(&mut self, boundary: u32) {
        if boundary & 0x3f != 0 {
            let lead = boundary as usize >> 12 & 0xf;
            let word = self.mixed_blocks.at(lead) | 1 << (boundary >> 6 & 0x3f);
            self.mixed_blocks.set(lead, word);
        }
    }

    /// Searches the part of `list` for the 4k block of `c`, which is at least U+0800.
    fn contains_slow(&self, list: &[u32], c: u32) -> bool {
        let lead = (c >> 12).min(0x10) as usize;
        let (start, limit) = (
            self.list_4k_starts.at(lead) as usize,
            self.list_4k_starts.at(lead + 1) as usize,
        );
        (start + find_code_point(list.slice(start..limit), c)) & 1 != 0
    }

    #[inline(always)]
    pub(crate) fn contains(&self, list: &[u32], c: u32) -> bool {
        match c {
            0..=0xff => self.latin1_contains.at(c as usize),
            0x100..=0x7ff => has_bit(self.table_7ff.at(c as usize >> 6), c),
            0x800..=0xffff if !has_bit(self.mixed_blocks.at(c as usize >> 12), c >> 6) => {
                has_bit(self.full_blocks.at(c as usize >> 12), c >> 6)
            }
            _ => self.contains_slow(list, c),
        }
    }
}
