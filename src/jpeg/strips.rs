//! From pixels to quantized blocks, one row of MCUs at a time (jccolor.c, jcsample.c, jcdctmgr.c).

use crate::block::{self, Block, Zigzag};
use crate::header::Grid;
use crate::{Result, filled, wrapped};
use bun_highway::JPEG_PIXEL_GROUP;

const MCU_SIZE: usize = 16;

/// Makes the kernel divide by 8 times each step, exactly for all outputs of the transform.
fn divisors(quant: &[u8; 64]) -> [Block; 2] {
    let [mut reciprocals, mut scales] = [block::ZERO; 2];
    for (k, &step) in quant.iter().enumerate() {
        let divisor = 8 * u32::from(step);
        let reciprocal = (1u32 << (15 + divisor.ilog2())).div_ceil(divisor);
        *reciprocals.at_mut(k) = reciprocal.min(0x7FFF) as i16;
        *scales.at_mut(k) = 1 << (14 - divisor.ilog2());
    }
    [reciprocals, scales]
}

pub(crate) struct Strips<'a> {
    pixels: &'a [[u8; 4]],
    width: usize,
    height: usize,
    chroma_stride: usize,
    /// The Y, Cb and Cr of one row of MCUs.
    planes: [Vec<u8>; 3],
    divisors: [[Block; 2]; 2],
}

impl<'a> Strips<'a> {
    /// `quant` is for luma, then chroma, in zigzag order.
    pub(crate) fn new(
        pixels: &'a [[u8; 4]],
        width: usize,
        height: usize,
        quant: &[[u8; 64]; 2],
    ) -> Result<Self> {
        let chroma_stride = width.next_multiple_of(JPEG_PIXEL_GROUP) / 2;
        Ok(Self {
            pixels,
            width,
            height,
            chroma_stride,
            planes: [
                filled(MCU_SIZE * 2 * chroma_stride, 0)?,
                filled(MCU_SIZE / 2 * chroma_stride, 0)?,
                filled(MCU_SIZE / 2 * chroma_stride, 0)?,
            ],
            divisors: quant.each_ref().map(divisors),
        })
    }

    pub(crate) fn size_in_mcus(&self) -> Grid {
        Grid {
            wide: self.width.div_ceil(MCU_SIZE),
            high: self.height.div_ceil(MCU_SIZE),
        }
    }

    /// Without the blocks that only pad MCUs.
    pub(crate) fn size_in_luma_blocks(&self) -> Grid {
        Grid {
            wide: self.width.div_ceil(8),
            high: self.height.div_ceil(8),
        }
    }

    /// Pads to whole MCUs by repeating the last pixel of each row and the last row of samples.
    pub(crate) fn convert(&mut self, mcu_row: usize) -> Result<()> {
        let (width, stride) = (self.width, self.chroma_stride);
        let top = mcu_row * MCU_SIZE;
        let rows = MCU_SIZE.min(self.height - top);
        let pixels = self.pixels.get(top * width..).unwrap_or_default();
        let mut convert_rows = |pixels, pixel_stride, count, pairs, x: usize, first_pair: usize| {
            let at = first_pair * stride;
            let [y, cb, cr] = &mut self.planes;
            let planes = [(y, 4 * at + x), (cb, at + x / 2), (cr, at + x / 2)]
                .map(|(plane, at)| plane.get_mut(at..).unwrap_or_default());
            bun_highway::jpeg_rgba_to_ycc420(pixels, pixel_stride, count, pairs, planes, stride)
        };

        let whole = width - width % JPEG_PIXEL_GROUP;
        convert_rows(pixels, width, whole, rows / 2, 0, 0)?;
        let last_row = pixels.get((rows - 1) * width..).unwrap_or_default();
        if rows % 2 == 1 {
            convert_rows(last_row, 0, whole, 1, 0, rows / 2)?;
        }
        let mut edge = [[[0; 4]; JPEG_PIXEL_GROUP]; MCU_SIZE];
        if whole != width {
            let pixel_rows = pixels.chunks(width).chain([last_row]);
            for (to, row) in edge.iter_mut().zip(pixel_rows) {
                let rest = row.get(whole..width).unwrap_or_default();
                let (start, end) = to.split_at_mut(rest.len());
                start.copy_from_slice(rest);
                end.fill(rest.last().copied().unwrap_or_default());
            }
            let (edge, len) = (edge.as_flattened(), JPEG_PIXEL_GROUP);
            convert_rows(edge, len, len, rows.div_ceil(2), whole, 0)?;
        }

        for (plane, scale) in self.planes.iter_mut().zip([2, 1, 1]) {
            let (stride, filled) = (scale * stride, scale * rows.div_ceil(2));
            for row in filled..8 * scale {
                plane.copy_within((filled - 1) * stride..filled * stride, row * stride);
            }
        }
        Ok(())
    }

    /// Fills `blocks` with those of `component` from `x` on, in row `y` of the strip.
    pub(crate) fn transform<const MASKS: usize>(
        &self,
        component: usize,
        (x, y): (usize, usize),
        blocks: &mut [Block],
        masks: &mut [[u64; MASKS]],
    ) -> Result<()> {
        let is_luma = component == 0;
        let stride = self.chroma_stride * if is_luma { 2 } else { 1 };
        let plane = self.planes.get(component);
        let samples = plane.and_then(|plane| plane.get(8 * (y * stride + x)..));
        let divisors = wrapped(&self.divisors, usize::from(!is_luma));
        let samples = samples.unwrap_or_default();
        bun_highway::jpeg_forward_transform(samples, stride, divisors, blocks, masks)?;
        Ok(())
    }
}
