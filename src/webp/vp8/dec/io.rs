//! `io_dec.c`: from rows of Y, U, V and alpha samples to rows of RGBA.

use super::upsampling::{upsample_chroma_pair, yuv_to_rgba_row};
use crate::Output;
use crate::util::{Checked, OutOfMemory, SliceExt, try_vec};

/// Consecutive rows of the image that are final.
pub(super) struct Rows<'a> {
    pub(super) y: &'a [u8],
    pub(super) u: &'a [u8],
    pub(super) v: &'a [u8],
    pub(super) y_stride: usize,
    pub(super) uv_stride: usize,
    /// The position of the first row, which is even.
    pub(super) mb_y: usize,
    /// How many rows there are.
    pub(super) mb_h: usize,
}

/// The chroma samples of one row of the image.
struct ChromaRow {
    u: Vec<u8>,
    v: Vec<u8>,
}

impl ChromaRow {
    fn new(len: usize) -> Result<Self, OutOfMemory> {
        Ok(Self {
            u: try_vec(0, len)?,
            v: try_vec(0, len)?,
        })
    }
}

pub(super) struct Emitter {
    width: usize,
    height: usize,
    /// The last row given to `put`: it takes the chroma row below to upsample its own.
    tmp_y: Vec<u8>,
    tmp_uv: ChromaRow,
    /// Two rows at the resolution of luma.
    upsampled: [ChromaRow; 2],
    alpha_plane: Option<Vec<u8>>,
}

impl Emitter {
    /// `CustomSetup`
    pub(super) fn new(width: usize, height: usize) -> Result<Self, OutOfMemory> {
        let uv_width = width.div_ceil(2);
        Ok(Self {
            width,
            height,
            tmp_y: try_vec(0, width)?,
            tmp_uv: ChromaRow::new(uv_width)?,
            upsampled: [ChromaRow::new(2 * uv_width)?, ChromaRow::new(2 * uv_width)?],
            alpha_plane: None,
        })
    }

    pub(super) fn width(&self) -> usize {
        self.width
    }

    /// `plane` has `width * height` samples.
    pub(super) fn set_alpha(&mut self, plane: Vec<u8>) {
        self.alpha_plane = Some(plane);
    }

    /// `CustomPut`, that is `EmitFancyRGB` and `EmitAlphaRGB`.
    pub(super) fn put(&mut self, io: &Rows<'_>, output: &mut Output<'_>) -> Checked {
        let Self {
            width,
            height,
            tmp_y,
            tmp_uv,
            upsampled,
            alpha_plane,
        } = self;
        let (width, height) = (*width, *height);
        let uv_w = width.div_ceil(2);
        let y_row = |j: usize| io.y.sub(j * io.y_stride..)?.sub(..width);
        let u_row = |j: usize| io.u.sub(j * io.uv_stride..)?.sub(..uv_w);
        let v_row = |j: usize| io.v.sub(j * io.uv_stride..)?.sub(..uv_w);

        // Writes row `y` of the image, and the next one if there is a `bottom_y`.
        let mut upsample = |top_y: &[u8],
                            bottom_y: Option<&[u8]>,
                            top_uv: [&[u8]; 2],
                            cur_uv: [&[u8]; 2],
                            y: usize|
         -> Checked {
            let [top, bottom] = upsampled;
            upsample_chroma_pair(top_uv[0], cur_uv[0], &mut top.u, &mut bottom.u)?;
            upsample_chroma_pair(top_uv[1], cur_uv[1], &mut top.v, &mut bottom.v)?;
            let rows = [(Some(top_y), &*top), (bottom_y, &*bottom)];
            for (y, (luma, chroma)) in (y..).zip(rows) {
                let Some(luma) = luma else { continue };
                let dst = output.row_mut(y, width)?;
                yuv_to_rgba_row(luma, &chroma.u, &chroma.v, dst);
                if let Some(alpha_plane) = alpha_plane {
                    let alpha = alpha_plane.sub(y * width..)?.sub(..width)?;
                    for (dst, &alpha) in dst.as_chunks_mut::<4>().0.iter_mut().zip(alpha) {
                        dst[3] = alpha;
                    }
                }
            }
            Ok(())
        };

        let y_end = io.mb_y + io.mb_h;
        let cur_uv = [u_row(0)?, v_row(0)?];
        if io.mb_y == 0 {
            // The chroma samples are mirrored at the top of the image.
            upsample(y_row(0)?, None, cur_uv, cur_uv, 0)?;
        } else {
            let top_uv = [&*tmp_uv.u, &*tmp_uv.v];
            upsample(tmp_y, Some(y_row(0)?), top_uv, cur_uv, io.mb_y - 1)?;
        }
        // `j` is relative to the first row.
        let mut j = 0;
        while j + 2 < io.mb_h {
            let top_uv = [u_row(j / 2)?, v_row(j / 2)?];
            let cur_uv = [u_row(j / 2 + 1)?, v_row(j / 2 + 1)?];
            let (top_y, bottom_y) = (y_row(j + 1)?, y_row(j + 2)?);
            upsample(top_y, Some(bottom_y), top_uv, cur_uv, io.mb_y + j + 1)?;
            j += 2;
        }
        let cur_uv = [u_row(j / 2)?, v_row(j / 2)?];
        if y_end < height {
            tmp_y.write_at(0, y_row(j + 1)?)?;
            tmp_uv.u.write_at(0, cur_uv[0])?;
            tmp_uv.v.write_at(0, cur_uv[1])?;
        } else if y_end % 2 == 0 {
            // And at the bottom.
            upsample(y_row(j + 1)?, None, cur_uv, cur_uv, y_end - 1)?;
        }
        Ok(())
    }
}
