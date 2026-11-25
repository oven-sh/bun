//! Block smoothing: estimates what a progressive file lacks from the neighboring DC values (`decompress_smooth_data()`).

use crate::block::{Block, Zigzag};
use crate::header::Scan;
use crate::{MAX_COMPONENTS, wrapped_mut};
use core::hint::select_unpredictable;

/// How many coefficients smoothing looks at, in zigzag order.
const SMOOTHED: usize = 10;
/// For each: how many low bits are missing, or `UNKNOWN`.
type Missing = [i8; SMOOTHED];
const UNKNOWN: i8 = -1;

/// What is missing after the last scan of a component, and before it.
#[derive(Clone, Copy)]
pub(crate) struct Accuracy {
    now: Missing,
    before: Missing,
}

pub(crate) struct Progress {
    components: [Accuracy; MAX_COMPONENTS],
    scans: usize,
}

impl Progress {
    pub(crate) const NONE: Self = Self {
        components: [Accuracy {
            now: [UNKNOWN; SMOOTHED],
            before: [UNKNOWN; SMOOTHED],
        }; MAX_COMPONENTS],
        scans: 0,
    };

    pub(crate) fn add(&mut self, scan: &Scan) {
        self.scans += 1;
        for component in scan.components() {
            let accuracy = wrapped_mut(&mut self.components, component.index.into());
            accuracy.before = if self.scans > 1 {
                accuracy.now
            } else {
                // As in libjpeg, for a component that no later scan has.
                [0; SMOOTHED]
            };
            let band = accuracy.now.iter_mut().take(usize::from(scan.se) + 1);
            band.skip(scan.ss.into())
                .for_each(|missing| *missing = scan.al as i8);
        }
    }

    /// None if smoothing is not possible or has nothing to estimate (`smoothing_ok()`).
    pub(crate) fn accuracy(mut self, quant: &[Block]) -> Option<[Accuracy; MAX_COMPONENTS]> {
        let mut is_useful = false;
        for (accuracy, quant) in self.components.iter_mut().zip(quant) {
            if accuracy.now[0] == UNKNOWN || (0..SMOOTHED).any(|k| quant.at(k) == 0) {
                return None;
            }
            is_useful |= accuracy.now[1..] != [0; SMOOTHED - 1];
            if self.scans == 1 {
                accuracy.before = [UNKNOWN; SMOOTHED];
            }
        }
        is_useful.then_some(self.components)
    }
}

/// For the 5 by 5 blocks around one, column by column, padded with zeros to whole vectors.
type Weights = [i16; 32];

const fn padded(columns: [[i16; 5]; 5]) -> Weights {
    let mut weights = [0; 32];
    weights
        .split_at_mut(25)
        .0
        .copy_from_slice(columns.as_flattened());
    weights
}

/// For coefficients 1 to 5.
#[rustfmt::skip]
static WITH_SOME_AC: [Weights; 5] = [
    padded([[0, 0, -7, 0, 0], [0, 0, 50, 0, 0], [0; 5], [0, 0, -50, 0, 0], [0, 0, 7, 0, 0]]),
    padded([[0; 5], [0; 5], [-7, 50, 0, -50, 7], [0; 5], [0; 5]]),
    padded([[0; 5], [0; 5], [-1, 13, -24, 13, -1], [0; 5], [0; 5]]),
    padded([[0, -1, 0, 1, 0], [-1, 10, 0, -10, 1], [0; 5], [1, -10, 0, 10, -1], [0, 1, 0, -1, 0]]),
    padded([[0, 0, -1, 0, 0], [0, 0, 13, 0, 0], [0, 0, -24, 0, 0], [0, 0, 13, 0, 0], [0, 0, -1, 0, 0]]),
];

/// For coefficients 1 to 9.
#[rustfmt::skip]
static WITHOUT_AC: [Weights; 9] = [
    padded([[-1, -3, -3, -3, -1], [-1, 13, 38, 13, -1], [0; 5], [1, -13, -38, -13, 1], [1, 3, 3, 3, 1]]),
    padded([[-1, -1, 0, 1, 1], [-3, 13, 0, -13, 3], [-3, 38, 0, -38, 3], [-3, 13, 0, -13, 3], [-1, -1, 0, 1, 1]]),
    padded([[0; 5], [0, 2, -5, 2, 0], [1, 7, -14, 7, 1], [0, 2, -5, 2, 0], [0; 5]]),
    padded([[-1, 0, 0, 0, 1], [0, 9, 0, -9, 0], [0; 5], [0, -9, 0, 9, 0], [1, 0, 0, 0, -1]]),
    padded([[0, 0, 1, 0, 0], [0, 2, 7, 2, 0], [0, -5, -14, -5, 0], [0, 2, 7, 2, 0], [0, 0, 1, 0, 0]]),
    padded([[0; 5], [0, 1, 2, 1, 0], [0; 5], [0, -1, -2, -1, 0], [0; 5]]),
    padded([[0; 5], [0, 1, 0, -1, 0], [0, -3, 0, 3, 0], [0, 1, 0, -1, 0], [0; 5]]),
    padded([[0; 5], [0, 1, -3, 1, 0], [0; 5], [0, -1, 3, -1, 0], [0; 5]]),
    padded([[0; 5], [0, 1, 0, -1, 0], [0, 2, 0, -2, 0], [0, 1, 0, -1, 0], [0; 5]]),
];

#[rustfmt::skip]
static DC_WITHOUT_AC: Weights =
    padded([[-2, -6, -8, -6, -2], [-6, 6, 42, 6, -6], [-8, 42, 152, 42, -8], [-6, 6, 42, 6, -6], [-2, -6, -8, -6, -2]]);

pub(crate) const BATCH_LEN: usize = 32;

#[inline(always)]
fn estimate(dc: &[i16; 32], weights: &Weights, quant: &Block, k: usize, missing: i8) -> i16 {
    let pairs = dc.iter().zip(weights);
    let sum: i32 = pairs.map(|(&a, &b)| i32::from(a) * i32::from(b)).sum();
    let step = |k| i64::from(quant.at(k).cast_unsigned());
    let mut magnitude = ((step(k) << 7) + step(0) * i64::from(sum.abs())) / (step(k) << 8);
    if missing > 0 {
        magnitude = magnitude.min((1 << missing) - 1);
    }
    select_unpredictable(sum < 0, -magnitude, magnitude) as i16
}

impl Accuracy {
    /// Smooths a batch of `rows[2]` from `first` on. `is_late`: the last scan ran out of data before this row.
    pub(crate) fn smooth<'a>(
        &self,
        is_late: bool,
        quant: &Block,
        rows: &[&[Block]; 5],
        first: usize,
        room: &'a mut [Block; BATCH_LEN],
    ) -> &'a [Block] {
        let blocks = rows[2].get(first..).unwrap_or_default();
        let (out, _) = room.split_at_mut(blocks.len().min(BATCH_LEN));
        let missing = if is_late { &self.before } else { &self.now };
        let has_no_ac = missing[1..] == [UNKNOWN; SMOOTHED - 1];
        let weights: &[Weights] = if has_no_ac {
            &WITHOUT_AC
        } else {
            &WITH_SOME_AC
        };
        // The last block starts a window of 32, which is 7 columns.
        let mut columns = [[0; 5]; BATCH_LEN + 6];
        for (x, column) in (first..).zip(columns.iter_mut().take(out.len() + 4)) {
            *column = rows.map(|row| {
                let block = row.get(x.saturating_sub(2)).or_else(|| row.last());
                block.map_or(0, Block::dc)
            });
        }
        let around = columns.as_flattened().array_windows().step_by(5);
        for ((out, block), dc) in out.iter_mut().zip(blocks).zip(around) {
            *out = *block;
            for (k, (weights, &missing)) in (1..SMOOTHED).zip(weights.iter().zip(&missing[1..])) {
                if missing != 0 && out.at(k) == 0 {
                    *out.at_mut(k) = estimate(dc, weights, quant, k, missing);
                }
            }
            if has_no_ac {
                *out.dc_mut() = estimate(dc, &DC_WITHOUT_AC, quant, 0, 0);
            }
        }
        out
    }
}
