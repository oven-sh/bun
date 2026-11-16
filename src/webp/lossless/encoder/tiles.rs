//! Parameters that are the same within squares of an image.

use crate::error::Result;
use crate::lossless::{Argb, MIN_TILE_BITS, TILE_BITS_BITS, subsampled};
use crate::slice::InBounds;
use crate::vec;

const MAX_TILE_BITS: u32 = MIN_TILE_BITS + (1 << TILE_BITS_BITS) - 1;

pub(super) const fn count(width: usize, height: usize, bits: u32) -> usize {
    subsampled(width, bits) * subsampled(height, bits)
}

/// Larger tiles than those of `bits` if there would be too many.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L254
pub(super) const fn fitted(mut bits: u32, width: usize, height: usize, max_count: usize) -> u32 {
    while count(width, height, bits) > max_count {
        bits += 1;
    }
    bits
}

/// A pixel for each tile.
pub(super) struct Tiles {
    pub(super) bits: u32,
    pub(super) per_row: usize,
    pub(super) pixels: Vec<Argb>,
}

impl Tiles {
    /// With room for the pixels.
    pub(super) fn new(width: usize, height: usize, bits: u32) -> Result<Self> {
        Ok(Self {
            bits,
            per_row: subsampled(width, bits),
            pixels: vec::with_room(count(width, height, bits))?,
        })
    }

    /// The tiles that row `y` of the image goes through.
    pub(super) fn row(&self, y: usize) -> &[Argb] {
        let start = (y >> self.bits) * self.per_row;
        self.pixels.part(start..start + self.per_row)
    }

    /// The pixel above the next one that is added.
    pub(super) fn above_next(&self) -> Option<Argb> {
        let index = self.pixels.len().checked_sub(self.per_row)?;
        self.pixels.get(index).copied()
    }

    /// Makes the tiles as large as they can be without changing what they say.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/predictor_enc.c#L526
    pub(super) fn merge(&mut self) {
        let rows = || self.pixels.chunks(self.per_row.max(1));
        let is_uniform = |more_bits: &u32| {
            let side = 1 << more_bits;
            let firsts = rows()
                .step_by(side)
                .flat_map(|row| core::iter::repeat_n(row, side));
            let all_same = |pixels: &[Argb]| pixels.array_windows().all(|[a, b]| a == b);
            rows().eq(firsts.take(rows().len())) && rows().all(|row| row.chunks(side).all(all_same))
        };
        let more_bits = (1..=MAX_TILE_BITS - self.bits)
            .take_while(is_uniform)
            .count() as u32;
        let (per_row, mask) = (self.per_row, (1 << more_bits) - 1);
        let (mut x, mut y) = (0, 0);
        self.pixels.retain(|_| {
            let is_first = (x | y) & mask == 0;
            (x, y) = if x + 1 < per_row {
                (x + 1, y)
            } else {
                (0, y + 1)
            };
            is_first
        });
        self.bits += more_bits;
        self.per_row = subsampled(per_row, more_bits);
    }
}
