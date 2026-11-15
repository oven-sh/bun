//! Blocks of coefficients, in the order that the kernels want them in.

use crate::{wrapped, wrapped_mut};

pub(crate) use bun_highway::JpegBlock as Block;

pub(crate) const ZERO: Block = Block([0; 64]);

/// For each coefficient in zigzag order, `8 * row + column`.
#[rustfmt::skip]
pub(crate) const NATURAL_ORDER: [u8; 64] = [
     0,  1,  8, 16,  9,  2,  3, 10, 17, 24, 32, 25, 18, 11,  4,  5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13,  6,  7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/// By the zigzag index plus one. Past the last coefficient, where damaged data runs to, it goes on with the last.
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

pub(crate) trait Zigzag {
    fn at(&self, k: usize) -> i16;
    fn at_mut(&mut self, k: usize) -> &mut i16;
    /// At `k - 1`.
    fn before_mut(&mut self, k: usize) -> &mut i16;
}

impl Zigzag for Block {
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
