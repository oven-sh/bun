//! What it costs to add the residuals of a tile to those of the tiles before it, for choosing a tile's transform.

use super::entropy::{Cost, ONE_BIT, div_round, set_bits, x_log2};
use crate::array::At;
use crate::simd;

/// How often each value of a channel occurs in a tile.
pub(super) type Counts = [u16; 256];

/// The same for all tiles so far.
#[derive(Clone)]
pub(super) struct Totals {
    counts: [u32; 256],
    x_log2: [Cost; 256],
}

impl Totals {
    pub(super) const EMPTY: Self = Self {
        counts: [0; 256],
        x_log2: [0; 256],
    };

    pub(super) fn add(&mut self, tile: &Counts) {
        for_each_non_zero(tile, |value, count| {
            let total = self.counts.at_mut(value);
            *total += count;
            *self.x_log2.at_mut(value) = x_log2(*total);
        });
    }

    /// The entropy of `tile` by itself and with the totals, but for what all tiles of its size have in common.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/lossless_enc.c#L320
    #[inline]
    pub(super) fn entropy_with(&self, tile: &Counts) -> i64 {
        let mut saved = 0;
        for_each_non_zero(tile, |value, count| {
            let with_tile = x_log2(*self.counts.at(value) + count);
            saved += x_log2(count) + with_tile - *self.x_log2.at(value);
        });
        -(saved as i64)
    }
}

#[inline(always)]
fn for_each_non_zero(tile: &Counts, mut visit: impl FnMut(usize, u32)) {
    let blocks = tile.as_chunks::<64>().0.iter();
    for ((index, block), non_zero) in blocks.enumerate().zip(simd::non_zero(tile)) {
        for i in set_bits(non_zero) {
            visit(index * 64 + i, u32::from(*block.at(i)));
        }
    }
}

/// What values near zero count for.
pub(super) struct Bias {
    zero: Cost,
    /// In percent, for 1 and -1, 2 and -2 and so on up to 15: the hundreds and the rest.
    near_zero: [[u32; 16]; 2],
}

impl Bias {
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/predictor_enc.c#L46
    #[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
    pub(super) const fn new(zero: Cost, one: Cost) -> Self {
        let (mut near_zero, mut weight, mut i) = ([[0; _]; _], one * ONE_BIT, 0);
        while i < 15 {
            (near_zero[0][i], near_zero[1][i]) = ((weight / 100) as u32, (weight % 100) as u32);
            (weight, i) = (div_round(6 * weight, 10), i + 1);
        }
        Self {
            zero: zero * ONE_BIT,
            near_zero,
        }
    }

    #[inline(always)]
    pub(super) fn cost(&self, tile: &Counts) -> i64 {
        let [zeros, rest @ ..] = tile;
        let bits =
            self.zero * Cost::from(*zeros) + simd::weigh_ends::baseline(rest, &self.near_zero);
        -(div_round(bits, 10) as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_step_from_zero_counts_for_six_tenths_of_the_one_before() {
        let bias = Bias::new(3, 50);
        assert_eq!(bias.zero, 3 * ONE_BIT);
        let [hundreds, rest] = bias.near_zero;
        assert_eq!((hundreds[15], rest[15]), (0, 0));
        for (steps, (hundreds, rest)) in (0..15).zip(hundreds.into_iter().zip(rest)) {
            let expected = 50.0 * ONE_BIT as f64 * 0.6f64.powi(steps);
            assert!((f64::from(100 * hundreds + rest) - expected).abs() < 2.0);
        }
    }
}
