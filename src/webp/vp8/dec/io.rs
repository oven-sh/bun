//! `io_dec.c`: from rows of Y, U, V and alpha samples to rows of RGBA.

use super::upsampling::Upsampler;
use crate::Output;
use crate::Result;
use crate::util::{Checked, SliceExt, try_vec};

/// Consecutive rows of the image that are final.
pub(super) struct Rows<'a> {
    pub(super) y: &'a [u8],
    pub(super) u: &'a [u8],
    pub(super) v: &'a [u8],
    pub(super) y_stride: usize,
    pub(super) uv_stride: usize,
    /// The alpha rows, if the image has any, without padding. They start one row higher, which is undefined at the top.
    pub(super) alpha: Option<&'a [u8]>,
    /// The position of the first row in the image, which is even.
    pub(super) first_row: usize,
    pub(super) num_rows: usize,
}

pub(super) struct Emitter {
    width: usize,
    height: usize,
    /// The last row given to `put`: it takes the chroma row below to upsample its own.
    tmp_y: Vec<u8>,
    tmp_u: Vec<u8>,
    tmp_v: Vec<u8>,
    upsampler: Upsampler,
    /// The alpha row of an image without alpha.
    opaque: Vec<u8>,
}

impl Emitter {
    /// `CustomSetup`
    pub(super) fn new(width: usize, height: usize) -> Result<Self> {
        let uv_width = width.div_ceil(2);
        Ok(Self {
            width,
            height,
            tmp_y: try_vec(0, width)?,
            tmp_u: try_vec(0, uv_width)?,
            tmp_v: try_vec(0, uv_width)?,
            upsampler: Upsampler::new(width)?,
            opaque: try_vec(0xff, width)?,
        })
    }

    /// `CustomPut`, that is `EmitFancyRGB` and `EmitAlphaRGB`.
    pub(super) fn put(&mut self, rows: &Rows<'_>, output: &mut Output<'_>) -> Checked {
        let Self {
            width,
            height,
            tmp_y,
            tmp_u,
            tmp_v,
            upsampler,
            opaque,
        } = self;
        let (width, height) = (*width, *height);
        let uv_width = width.div_ceil(2);
        let (first_row, num_rows) = (rows.first_row, rows.num_rows);
        let (alpha, alpha_stride) = match rows.alpha {
            Some(alpha) => (alpha, width),
            None => (opaque.as_slice(), 0),
        };
        let y_row = |j: usize| rows.y.sub(j * rows.y_stride..)?.sub(..width);
        let uv_row = |j: usize| -> Checked<[&[u8]; 2]> {
            let start = j * rows.uv_stride;
            Ok([
                rows.u.sub(start..)?.sub(..uv_width)?,
                rows.v.sub(start..)?.sub(..uv_width)?,
            ])
        };

        // `WebPUpsampleLinePairFunc`: writes row `y` of the image, and the next one if there is a `bottom_y`.
        let mut emit_pair = |top_y: &[u8],
                             bottom_y: Option<&[u8]>,
                             top_uv: [&[u8]; 2],
                             cur_uv: [&[u8]; 2],
                             y: usize|
         -> Checked {
            upsampler.upsample(top_uv, cur_uv)?;
            for (lower, luma) in [(false, Some(top_y)), (true, bottom_y)] {
                let Some(luma) = luma else { continue };
                let y = y + usize::from(lower);
                let alpha_start = (y + 1 - first_row) * alpha_stride;
                let alpha = alpha.sub(alpha_start..)?.sub(..width)?;
                upsampler.convert(lower, luma, alpha, output.row_mut(y, width)?)?;
            }
            Ok(())
        };

        let y_end = first_row + num_rows;
        let cur_uv = uv_row(0)?;
        if first_row == 0 {
            // The chroma samples are mirrored at the top of the image.
            emit_pair(y_row(0)?, None, cur_uv, cur_uv, 0)?;
        } else {
            emit_pair(
                tmp_y,
                Some(y_row(0)?),
                [tmp_u, tmp_v],
                cur_uv,
                first_row - 1,
            )?;
        }
        // `j` is relative to the first row.
        let mut j = 0;
        while j + 2 < num_rows {
            let (top_y, bottom_y) = (y_row(j + 1)?, y_row(j + 2)?);
            let (top_uv, cur_uv) = (uv_row(j / 2)?, uv_row(j / 2 + 1)?);
            emit_pair(top_y, Some(bottom_y), top_uv, cur_uv, first_row + j + 1)?;
            j += 2;
        }
        let cur_uv = uv_row(j / 2)?;
        if y_end < height {
            tmp_y.write_at(0, y_row(j + 1)?)?;
            tmp_u.write_at(0, cur_uv[0])?;
            tmp_v.write_at(0, cur_uv[1])?;
        } else if y_end.is_multiple_of(2) {
            // The chroma samples are mirrored at the bottom of the image.
            emit_pair(y_row(j + 1)?, None, cur_uv, cur_uv, y_end - 1)?;
        }
        Ok(())
    }
}
