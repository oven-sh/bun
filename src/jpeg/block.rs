//! Blocks of coefficients, in the order that the kernels want them in.

use crate::{wrapped, wrapped_mut};
use core::hint::{Locality, prefetch_read, select_unpredictable};

pub(crate) use bun_highway::JpegBlock as Block;

pub(crate) const ZERO: Block = Block([0; 64]);

/// Prefetches the block 16 steps ahead. The hardware falls behind on passes that skip blocks or touch little of each.
#[inline(always)]
pub(crate) fn prefetch_after(block: &Block, step: usize) {
    let ahead = core::ptr::from_ref(block).wrapping_add(16 * step);
    prefetch_read(ahead, Locality::L1);
    prefetch_read(ahead.wrapping_byte_add(64), Locality::L1);
}

/// For each coefficient in zigzag order, `8 * row + column`.
#[rustfmt::skip]
pub(crate) const NATURAL_ORDER: [u8; 64] = [
     0,  1,  8, 16,  9,  2,  3, 10, 17, 24, 32, 25, 18, 11,  4,  5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13,  6,  7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/// Where in a [`Block`] coefficient `index - 1` is. As in libjpeg, runs past the end, of up to a `u8`, land on coefficient 63.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static POSITIONS: [u8; 512] = {
    const ROWS: [u8; 8] = [0, 32, 16, 33, 1, 48, 17, 49];
    const COLUMNS: [u8; 8] = [0, 8, 2, 10, 4, 12, 6, 14];
    let mut positions = [63; 512];
    let mut k = 0;
    while k < 64 {
        let natural = NATURAL_ORDER[k] as usize;
        positions[k + 1] = ROWS[natural / 8] + COLUMNS[natural % 8];
        k += 1;
    }
    positions
};

/// A bit for each coefficient from `first` to `last`.
#[inline(always)]
pub(crate) fn band(first: u32, last: u32) -> u64 {
    u64::MAX << first & u64::MAX >> (63 - last)
}

/// Clears the lowest `count` set bits. `count` is unpredictable, but mostly small.
#[inline(always)]
pub(crate) fn without_lowest(bits: u64, count: usize) -> u64 {
    let next = |bits: u64| bits & bits.wrapping_sub(1);
    let (one, two) = (next(bits), next(next(bits)));
    let mut left = select_unpredictable(
        count & 1 == 0,
        select_unpredictable(count & 2 == 0, bits, two),
        select_unpredictable(count & 2 == 0, one, next(two)),
    );
    for _ in 0..count / 4 {
        left = next(next(next(next(left))));
    }
    left
}

pub(crate) trait Zigzag {
    fn dc(&self) -> i16;
    fn dc_mut(&mut self) -> &mut i16;
    fn at(&self, k: usize) -> i16;
    fn at_mut(&mut self, k: usize) -> &mut i16;
    /// `at_mut(k - 1)`, without the subtraction.
    fn before_mut(&mut self, k: usize) -> &mut i16;
}

impl Zigzag for Block {
    #[inline(always)]
    fn dc(&self) -> i16 {
        self.0[0]
    }

    #[inline(always)]
    fn dc_mut(&mut self) -> &mut i16 {
        &mut self.0[0]
    }

    #[inline(always)]
    fn at(&self, k: usize) -> i16 {
        *wrapped(&self.0, (*wrapped(&POSITIONS, k + 1)).into())
    }

    #[inline(always)]
    fn at_mut(&mut self, k: usize) -> &mut i16 {
        self.before_mut(k + 1)
    }

    #[inline(always)]
    fn before_mut(&mut self, k: usize) -> &mut i16 {
        wrapped_mut(&mut self.0, (*wrapped(&POSITIONS, k)).into())
    }
}
