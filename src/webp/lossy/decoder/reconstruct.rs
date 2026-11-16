//! Prediction plus residuals: the samples of a macroblock before the loop filter. RFC 6386 section 12.

use super::modes::LumaMode;
use super::residuals::{BlockRow, Residuals};
use crate::array::At;
use crate::error::{Error, Result};
use crate::lossy::MacroblockMode;
use crate::vec;

/// What counts as being above the picture, and to its left.
const ABOVE: u8 = 127;
const LEFT: u8 = 129;

/// The rows of chroma have U on the left and V on the right.
pub(super) struct Samples {
    pub(super) y: [[u8; 16]; 16],
    pub(super) uv: [[u8; 16]; 8],
}

/// The last row of a macroblock.
#[derive(Clone, Copy)]
struct LastRow {
    y: [u8; 16],
    uv: [u8; 16],
}

/// What the next macroblock is predicted from.
pub(super) struct Neighbors {
    above: Vec<LastRow>,
    left: Samples,
    above_left: LastRow,
    has_above: bool,
}

impl Neighbors {
    pub(super) fn new(columns: usize) -> Result<Self> {
        let above = LastRow {
            y: [ABOVE; 16],
            uv: [ABOVE; 16],
        };
        Ok(Self {
            above: vec::filled(above, columns)?,
            left: Samples {
                y: [[LEFT; 16]; 16],
                uv: [[LEFT; 16]; 8],
            },
            above_left: above,
            has_above: false,
        })
    }

    pub(super) fn start_row(&mut self, y: usize) {
        self.has_above = y > 0;
        self.left.y = [[LEFT; 16]; 16];
        self.left.uv = [[LEFT; 16]; 8];
        let corner = [if self.has_above { LEFT } else { ABOVE }; 16];
        self.above_left = LastRow {
            y: corner,
            uv: corner,
        };
    }

    pub(super) fn reconstruct(
        &mut self,
        x: usize,
        luma_mode: &LumaMode,
        chroma_mode: MacroblockMode,
        residuals: &Residuals,
    ) -> Result<&Samples> {
        let (above, further) = self
            .above
            .get_mut(x..)
            .and_then(<[LastRow]>::split_first_mut)
            .ok_or(Error::Internal)?;
        let [luma_residuals @ .., _, _] = &residuals.rows;
        let [_, _, _, _, chroma_residuals @ ..] = &residuals.rows;
        let in_picture = InPicture {
            above: self.has_above,
            left: x > 0,
        };
        // The new samples take the place of those on the left.
        let Samples { y, uv } = &mut self.left;

        match luma_mode {
            LumaMode::Whole(mode) => {
                predict(*mode, y, &above.y, &self.above_left.y, in_picture);
                add_residuals(y, luma_residuals, residuals.non_zero);
            }
            LumaMode::Subblocks(modes) => {
                let [a, b, c, d, ..] = further.first().map_or([above.y[15]; 16], |next| next.y);
                let mut left = [self.above_left.y[15]; 20];
                for (left, row) in left[1..].iter_mut().zip(&*y) {
                    *left = row[15];
                }
                bun_highway::webp::reconstruct_subblocks(
                    &above.y,
                    &[a, b, c, d],
                    &left,
                    &modes.map(|row| row.map(|mode| mode as u8)),
                    luma_residuals,
                    y,
                );
            }
        }

        predict(chroma_mode, uv, &above.uv, &self.above_left.uv, in_picture);
        add_residuals(uv, chroma_residuals, residuals.non_zero >> 16);

        self.above_left = *above;
        *above = LastRow {
            y: y[15],
            uv: uv[7],
        };
        Ok(&self.left)
    }
}

/// Whether the neighbors are there or made up.
#[derive(Clone, Copy)]
struct InPicture {
    above: bool,
    left: bool,
}

impl InPicture {
    #[inline(always)]
    fn average<const N: usize>(self, above: &[u8; N], left: impl Iterator<Item = u8>) -> u8 {
        let above = || above.iter().copied().map(usize::from).sum::<usize>();
        let left = || left.map(usize::from).sum::<usize>();
        let twice = match (self.above, self.left) {
            (true, true) => above() + left(),
            (true, false) => 2 * above(),
            (false, true) => 2 * left(),
            (false, false) => return 128,
        };
        ((twice + N) / (2 * N)) as u8
    }
}

/// For squares of `N` samples by `N` side by side, in the place of those on their left.
#[inline(always)]
fn predict<const N: usize>(
    mode: MacroblockMode,
    rows: &mut [[u8; 16]; N],
    above: &[u8; 16],
    above_left: &[u8; 16],
    in_picture: InPicture,
) {
    // In two steps, of which the compiler makes a single shuffle.
    let spread_last = |row: &[u8; 16]| -> [u8; 16] {
        let odd: [u8; 16] = core::array::from_fn(|x| *row.at(x | 1));
        core::array::from_fn(|x| *odd.at(x | (N - 2)))
    };
    match mode {
        MacroblockMode::Dc => {
            let mut averages = [0; 16];
            let squares = averages.as_chunks_mut::<N>().0.iter_mut();
            for (index, (square, above)) in squares.zip(above.as_chunks::<N>().0).enumerate() {
                let left = rows.iter().map(|row| *row.at(index * N + N - 1));
                *square.at_mut(N - 1) = in_picture.average(above, left);
            }
            rows.fill(spread_last(&averages));
        }
        MacroblockMode::Vertical => rows.fill(*above),
        MacroblockMode::Horizontal => {
            for row in rows {
                *row = spread_last(row);
            }
        }
        MacroblockMode::TrueMotion => {
            let (above, corner) = (*above, spread_last(above_left));
            for row in rows {
                let left = spread_last(row);
                *row = core::array::from_fn(|x| {
                    let (left, corner) = (*left.at(x), *corner.at(x));
                    // One of the two is zero.
                    let (up, down) = (left.saturating_sub(corner), corner.saturating_sub(left));
                    above.at(x).saturating_add(up).saturating_sub(down)
                });
            }
        }
    }
}

#[inline(always)]
fn add_residuals(samples: &mut [[u8; 16]], residuals: &[BlockRow], mut non_zero: u32) {
    for (rows, residuals) in samples.as_chunks_mut::<4>().0.iter_mut().zip(residuals) {
        if non_zero & 15 != 0 {
            for (sample, residual) in rows.as_flattened_mut().iter_mut().zip(residuals) {
                *sample = (i16::from(*sample) + residual).clamp(0, 255) as u8;
            }
        }
        non_zero >>= 4;
    }
}
