//! Prediction plus residuals: the samples of a macroblock before the loop filter. RFC 6386 section 12.

use super::modes::LumaMode;
use super::residuals::{BlockRow, Residuals};
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
    /// Y, U and V.
    corner: [u8; 3],
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
            corner: [ABOVE; 3],
            has_above: false,
        })
    }

    pub(super) fn start_row(&mut self, y: usize) {
        self.has_above = y > 0;
        self.left.y = [[LEFT; 16]; 16];
        self.left.uv = [[LEFT; 16]; 8];
        self.corner = [if self.has_above { LEFT } else { ABOVE }; 3];
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
        let [corner_y, corner_u, corner_v] = self.corner;
        let in_picture = InPicture {
            above: self.has_above,
            left: x > 0,
        };
        // The new samples take the place of those on the left.
        let Samples { y, uv } = &mut self.left;

        let left_y = y.each_ref().map(|row| row[15]);
        match luma_mode {
            LumaMode::Whole(mode) => {
                let average = || [in_picture.average(&above.y, &left_y); 16];
                let left = left_y.map(|left| move || [left; 16]);
                predict(*mode, y, &above.y, left, [corner_y; 16], average);
                add_residuals(y, luma_residuals, residuals.non_zero);
            }
            LumaMode::Subblocks(modes) => {
                let [a, b, c, d, ..] = further.first().map_or([above.y[15]; 16], |next| next.y);
                let mut left = [corner_y; 20];
                left[1..17].copy_from_slice(&left_y);
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

        let left_uv = uv.each_ref().map(|row| (row[7], row[15]));
        let average = || {
            let u = in_picture.average(&above.uv[..8], &left_uv.map(|(u, _)| u));
            let v = in_picture.average(&above.uv[8..], &left_uv.map(|(_, v)| v));
            halves(u, v)
        };
        let left = left_uv.map(|(u, v)| move || halves(u, v));
        let corner = halves(corner_u, corner_v);
        predict(chroma_mode, uv, &above.uv, left, corner, average);
        add_residuals(uv, chroma_residuals, residuals.non_zero >> 16);

        self.corner = [above.y[15], above.uv[7], above.uv[15]];
        *above = LastRow {
            y: y[15],
            uv: uv[7],
        };
        Ok(&self.left)
    }
}

#[inline(always)]
fn halves(left: u8, right: u8) -> [u8; 16] {
    core::array::from_fn(|x| if x < 8 { left } else { right })
}

/// Whether the neighbors are there or made up.
#[derive(Clone, Copy)]
struct InPicture {
    above: bool,
    left: bool,
}

impl InPicture {
    #[inline(always)]
    fn average<const N: usize>(self, above: &[u8], left: &[u8; N]) -> u8 {
        let sum = |edge: &[u8]| edge.iter().map(|&it| usize::from(it)).sum::<usize>();
        let twice = match (self.above, self.left) {
            (true, true) => sum(above) + sum(left),
            (true, false) => 2 * sum(above),
            (false, true) => 2 * sum(left),
            (false, false) => return 128,
        };
        ((twice + N) / (2 * N)) as u8
    }
}

/// `left`, `corner` and `average` have for each column the value that counts there.
#[inline(always)]
fn predict<const N: usize>(
    mode: MacroblockMode,
    rows: &mut [[u8; 16]; N],
    above: &[u8; 16],
    left: [impl Fn() -> [u8; 16]; N],
    corner: [u8; 16],
    average: impl Fn() -> [u8; 16],
) {
    match mode {
        MacroblockMode::Dc => rows.fill(average()),
        MacroblockMode::Vertical => rows.fill(*above),
        MacroblockMode::Horizontal => {
            for (row, left) in rows.iter_mut().zip(left) {
                *row = left();
            }
        }
        MacroblockMode::TrueMotion => {
            for (row, left) in rows.iter_mut().zip(left) {
                let around = above.iter().zip(left()).zip(corner);
                for (sample, ((above, left), corner)) in row.iter_mut().zip(around) {
                    // One of the two is zero.
                    let (up, down) = (left.saturating_sub(corner), corner.saturating_sub(left));
                    *sample = above.saturating_add(up).saturating_sub(down);
                }
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
