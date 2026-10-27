//! From RGBA rows to the samples of one row of MCUs: color conversion, downsampling and padding at the edges (jccolor.c,
//! jcsample.c, jcprepct.c).

use crate::error::{Error, Result, try_vec};
use crate::tables::color::{ONE_HALF, SCALEBITS, fix};

/// Rows of pixels in a row of MCUs.
pub(crate) const MCU_SIZE: usize = 16;

/// The samples of one row of MCUs. Every row is a whole number of MCUs wide.
pub(crate) struct McuRowSamples {
    /// 16 rows.
    pub(crate) y: Vec<u8>,
    /// 8 rows.
    pub(crate) cb: Vec<u8>,
    /// 8 rows.
    pub(crate) cr: Vec<u8>,
    /// Two rows before downsampling.
    cb_full: Vec<u8>,
    cr_full: Vec<u8>,
    /// The length of a row of `y`, twice that of a row of `cb`.
    stride: usize,
}

impl McuRowSamples {
    pub(crate) fn new(mcus_per_row: usize) -> Result<Self> {
        let stride = mcus_per_row * MCU_SIZE;
        Ok(McuRowSamples {
            y: try_vec(0, stride * MCU_SIZE)?,
            cb: try_vec(0, stride / 2 * (MCU_SIZE / 2))?,
            cr: try_vec(0, stride / 2 * (MCU_SIZE / 2))?,
            cb_full: try_vec(0, stride * 2)?,
            cr_full: try_vec(0, stride * 2)?,
            stride,
        })
    }

    /// `rows` are the rows of the image from the top of this row of MCUs on, `width * 4` bytes each, and not empty.
    pub(crate) fn fill(&mut self, rows: &[u8], width: usize) -> Result<()> {
        let stride = self.stride;
        let mut input = rows.chunks_exact(width * 4);
        // What is below the image repeats the last row of samples, which for chroma is not the last row of pixels.
        let mut last_y: Option<&[u8]> = None;
        let mut last_c: Option<(&[u8], &[u8])> = None;
        for ((y, cb), cr) in self
            .y
            .chunks_exact_mut(stride * 2)
            .zip(self.cb.chunks_exact_mut(stride / 2))
            .zip(self.cr.chunks_exact_mut(stride / 2))
        {
            let (y0, y1) = y.split_at_mut(stride);
            if let Some(row0) = input.next() {
                // An odd height repeats the last row of pixels.
                let row1 = input.next().unwrap_or(row0);
                let (cb0, cb1) = self.cb_full.split_at_mut(stride);
                let (cr0, cr1) = self.cr_full.split_at_mut(stride);
                convert(row0, y0, cb0, cr0);
                convert(row1, y1, cb1, cr1);
                for row in [
                    &mut *y0, &mut *y1, &mut *cb0, &mut *cb1, &mut *cr0, &mut *cr1,
                ] {
                    expand_right_edge(row, width);
                }
                h2v2_downsample(cb0, cb1, cb);
                h2v2_downsample(cr0, cr1, cr);
            } else {
                let (above_y, (above_cb, above_cr)) =
                    last_y.zip(last_c).ok_or(Error::InvalidArgument)?;
                y0.copy_from_slice(above_y);
                y1.copy_from_slice(above_y);
                cb.copy_from_slice(above_cb);
                cr.copy_from_slice(above_cr);
            }
            last_y = Some(y1);
            last_c = Some((cb, cr));
        }
        Ok(())
    }
}

/// Half minus epsilon, so that the largest result rounds to 255 and not to 256.
const CBCR_OFFSET: i32 = (128 << SCALEBITS) + ONE_HALF - 1;

#[inline(never)]
fn convert(rgba: &[u8], y: &mut [u8], cb: &mut [u8], cr: &mut [u8]) {
    let (pixels, _) = rgba.as_chunks::<4>();
    for (((pixel, y), cb), cr) in pixels.iter().zip(y).zip(cb).zip(cr) {
        // Taking a pixel apart by shifts is what the compiler makes vector code of. It gathers bytes one by one.
        let pixel = u32::from_le_bytes(*pixel);
        let [r, g, b] = [pixel, pixel >> 8, pixel >> 16].map(|v| (v & 255) as i32);
        *y = ((fix(0.29900) * r + fix(0.58700) * g + fix(0.11400) * b + ONE_HALF) >> SCALEBITS)
            as u8;
        *cb = ((-fix(0.16874) * r - fix(0.33126) * g + fix(0.50000) * b + CBCR_OFFSET) >> SCALEBITS)
            as u8;
        *cr = ((fix(0.50000) * r - fix(0.41869) * g - fix(0.08131) * b + CBCR_OFFSET) >> SCALEBITS)
            as u8;
    }
}

fn expand_right_edge(row: &mut [u8], width: usize) {
    let (image, padding) = row.split_at_mut(width.min(row.len()));
    if let Some(&last) = image.last() {
        padding.fill(last);
    }
}

#[inline(never)]
fn h2v2_downsample(row0: &[u8], row1: &[u8], out: &mut [u8]) {
    // Rounding alternates between down and up, so as not to brighten or darken the image.
    let (quads0, _) = row0.as_chunks::<4>();
    let (quads1, _) = row1.as_chunks::<4>();
    let (out, _) = out.as_chunks_mut::<2>();
    for ((a, b), out) in quads0.iter().zip(quads1).zip(out) {
        let [a0, a1, a2, a3] = a.map(u16::from);
        let [b0, b1, b2, b3] = b.map(u16::from);
        *out = [
            ((a0 + a1 + b0 + b1 + 1) >> 2) as u8,
            ((a2 + a3 + b2 + b3 + 2) >> 2) as u8,
        ];
    }
}
