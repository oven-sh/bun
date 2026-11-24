//! From the samples of each component to pixels (jdsample.c, jdcolor.c).

use crate::block::{Block, Zigzag};
use crate::header::{ColorSpace, Component, Frame};
use crate::{Error, MAX_COMPONENTS, Result, fill_up, filled};
use bun_highway::{JPEG_PIXEL_GROUP, JPEG_ROW_SLACK, JpegChroma};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Upsampling {
    Repeat {
        h: usize,
        v: usize,
    },
    /// libjpeg's "fancy upsampling": a sample becomes 2 by 1, 1 by 2 or 2 by 2, blended with its nearest neighbors.
    BlendH2V1,
    BlendH1V2,
    BlendH2V2,
}

/// Room for a copy of the first sample of a row.
const LEFT_MARGIN: usize = 16;

/// The rows of a component that wait for color conversion.
pub(crate) struct Plane {
    /// How many samples wide and high a block is.
    block_size: usize,
    width: usize,
    height: usize,
    upsampling: Upsampling,
    stride: usize,
    /// Rows in a strip, which is a row of MCUs.
    strip_height: usize,
    /// The row above `top`, then `top` and those below.
    samples: Vec<u8>,
    top: usize,
    upsampled: Vec<u8>,
}

impl Plane {
    /// For several strips at once.
    pub(crate) fn make_room(&mut self, strips: usize) -> Result<()> {
        let len = (1 + strips * self.strip_height) * self.stride;
        fill_up(&mut self.samples, len, 0)
    }

    /// Where row `y` starts in `samples`.
    fn offset(&self, y: usize) -> usize {
        (y + 1 - self.top) * self.stride + LEFT_MARGIN
    }

    /// From the start of row `y` to the end of the last row.
    pub(crate) fn rows_from_mut(&mut self, y: usize) -> &mut [u8] {
        let start = self.offset(y);
        self.samples.get_mut(start..).unwrap_or_default()
    }

    /// Transforms `blocks`, the first of which is at `x` and `y`, counted in blocks.
    pub(crate) fn put(
        &mut self,
        blocks: &[Block],
        quant: &Block,
        x: usize,
        y: usize,
    ) -> Result<()> {
        let (size, stride) = (self.block_size, self.stride);
        let out = self.rows_from_mut(y * size).get_mut(x * size..);
        let out = out.unwrap_or_default();
        if size > 1 {
            bun_highway::jpeg_inverse_transform(blocks, quant, size, out, stride)?;
            return Ok(());
        }
        let out = out.get_mut(..blocks.len()).ok_or(Error::Internal)?;
        for (sample, block) in out.iter_mut().zip(blocks) {
            let mean = (i32::from(block.dc()) * i32::from(quant.dc()) + 4) >> 3;
            *sample = (mean + 128).clamp(0, 255) as u8;
        }
        Ok(())
    }

    /// From `before` samples left of row `y` to the end of the last row.
    fn row(&self, y: usize, before: usize) -> &[u8] {
        let row = self.samples.get(self.offset(y) - before..);
        row.unwrap_or_default()
    }

    /// For 2x vertical upsampling: the two rows around row `y` of the image, the nearer first.
    fn nearest_rows(&self, y: usize, before: usize) -> [&[u8]; 2] {
        let far = match y % 2 {
            0 => (y / 2).saturating_sub(1),
            _ => (y / 2 + 1).min(self.height - 1),
        };
        [self.row(y / 2, before), self.row(far, before)]
    }

    /// Repeats the first and last sample of each row, for blending.
    fn fill_margins(&mut self) {
        if !matches!(
            self.upsampling,
            Upsampling::BlendH2V1 | Upsampling::BlendH2V2
        ) {
            return;
        }
        for row in self.samples.chunks_exact_mut(self.stride) {
            let row = row.get_mut(LEFT_MARGIN - 1..LEFT_MARGIN + self.width + 1);
            if let Some([before, first, .., last, after]) = row {
                (*before, *after) = (*first, *last);
            }
        }
    }

    fn advance(&mut self, keep_last_row: bool) {
        if keep_last_row {
            let start = self.strip_height * self.stride;
            self.samples.copy_within(start..start + self.stride, 0);
        }
        self.top += self.strip_height;
    }

    /// One sample for each pixel of row `y` of the image.
    #[inline(always)]
    fn full_row(&mut self, y: usize) -> &[u8] {
        match self.upsampling {
            Upsampling::Repeat { h: 1, v: 1 } => self.row(y, 0),
            Upsampling::Repeat { h: 1, v } => self.row(y / v, 0),
            _ => self.upsample(y),
        }
    }

    fn upsample(&mut self, y: usize) -> &[u8] {
        fn repeat<const N: usize>(out: &mut [u8], row: &[u8]) {
            for (out, &sample) in out.as_chunks_mut::<N>().0.iter_mut().zip(row) {
                *out = [sample; N];
            }
        }
        /// `sums` yields each sample, weighted vertically, between its left and right neighbors.
        fn blend_across<const SHIFT: u32>(
            out: &mut [u8],
            [left_bias, right_bias]: [u16; 2],
            sums: impl Iterator<Item = [u16; 3]>,
        ) {
            for (out, [left, this, right]) in out.as_chunks_mut().0.iter_mut().zip(sums) {
                *out = [
                    ((3 * this + left + left_bias) >> SHIFT) as u8,
                    ((3 * this + right + right_bias) >> SHIFT) as u8,
                ];
            }
        }
        /// Unlike `array_windows()`, this is vectorized.
        fn neighbors(row: &[u8]) -> impl Iterator<Item = [u16; 3]> {
            let from = |x| row.iter().skip(x).map(|&sample| u16::from(sample));
            let all = from(0).zip(from(1)).zip(from(2));
            all.map(|((left, this), right)| [left, this, right])
        }

        let mut out = core::mem::take(&mut self.upsampled);
        match self.upsampling {
            // `out` still has it from the row above.
            Upsampling::Repeat { v, .. } if !y.is_multiple_of(v) => {}
            Upsampling::Repeat { h, v } => {
                let row = self.row(y / v, 0).get(..self.width).unwrap_or_default();
                match h {
                    2 => repeat::<2>(&mut out, row),
                    3 => repeat::<3>(&mut out, row),
                    _ => repeat::<4>(&mut out, row),
                }
            }
            Upsampling::BlendH2V1 => blend_across::<2>(&mut out, [1, 2], neighbors(self.row(y, 1))),
            Upsampling::BlendH1V2 => {
                let [near, far] = self.nearest_rows(y, 0);
                let bias = 1 + (y % 2) as u16;
                for ((out, &near), &far) in out.iter_mut().zip(near).zip(far) {
                    *out = ((3 * u16::from(near) + u16::from(far) + bias) >> 2) as u8;
                }
            }
            Upsampling::BlendH2V2 => {
                let [near, far] = self.nearest_rows(y, 1).map(neighbors);
                let sums = near
                    .zip(far)
                    .map(|([a, b, c], [d, e, f])| [3 * a + d, 3 * b + e, 3 * c + f]);
                blend_across::<4>(&mut out, [8, 7], sums);
            }
        }
        self.upsampled = out;
        &self.upsampled
    }
}

pub(crate) struct Output {
    pub(crate) width: usize,
    pub(crate) height: usize,
    color_space: ColorSpace,
    pub(crate) planes: Vec<Plane>,
    strip_height: usize,
    /// Whether the last row of pixels of a strip needs samples of the next strip.
    looks_ahead: bool,
    strips_done: usize,
    pixels: Vec<[u8; 4]>,
}

impl Output {
    /// The planes have room for one strip. A lossless frame ignores `eighths`.
    pub(crate) fn new(frame: &Frame, color_space: ColorSpace, eighths: u8) -> Result<Self> {
        let scale = frame.block_size().min(eighths.into());
        let (mcu_width, mcu_height) = (frame.max_h() * scale, frame.max_v() * scale);
        let mcus_wide = frame.size_in_mcus().wide;
        let image = frame.size_in_units(mcu_width, mcu_height);
        let (width, height) = (image.wide, image.high);
        let padded_width = width.next_multiple_of(JPEG_PIXEL_GROUP);

        let mut planes = Vec::new();
        planes.try_reserve_exact(MAX_COMPONENTS)?;
        for &Component { h, v, .. } in frame.components() {
            // A subsampled component gets a larger IDCT instead of upsampling where it can (jdmaster.c).
            let mut size = scale;
            let fits =
                |size| mcu_width.is_multiple_of(h * size) && mcu_height.is_multiple_of(v * size);
            while size < frame.block_size() && fits(2 * size) {
                size *= 2;
            }
            if !fits(size) {
                return Err(Error::Unsupported);
            }
            let plane = frame.size_in_units(h * size, v * size);
            let upsampling = match (mcu_width / (h * size), mcu_height / (v * size)) {
                (2, 1) if scale > 1 && plane.wide > 2 => Upsampling::BlendH2V1,
                (1, 2) if scale > 1 => Upsampling::BlendH1V2,
                (2, 2) if scale > 1 && plane.wide > 2 => Upsampling::BlendH2V2,
                (h, v) => Upsampling::Repeat { h, v },
            };
            let stride = LEFT_MARGIN
                + (mcus_wide * h * size).next_multiple_of(JPEG_PIXEL_GROUP)
                + JPEG_ROW_SLACK;
            let upsampled_len = match upsampling {
                Upsampling::Repeat { h: 1, .. } => 0,
                // Rounded up to whole triples.
                _ => padded_width + 2,
            };
            planes.push(Plane {
                block_size: size,
                width: plane.wide,
                height: plane.high,
                upsampling,
                stride,
                strip_height: v * size,
                samples: filled((1 + v * size) * stride, 0)?,
                top: 0,
                upsampled: filled(upsampled_len, 0)?,
            });
        }

        let mut pixels = Vec::new();
        pixels.try_reserve_exact(width * height + JPEG_PIXEL_GROUP)?;
        Ok(Self {
            width,
            height,
            color_space,
            looks_ahead: planes.iter().any(|plane| {
                matches!(
                    plane.upsampling,
                    Upsampling::BlendH1V2 | Upsampling::BlendH2V2
                )
            }),
            planes,
            strip_height: mcu_height,
            strips_done: 0,
            pixels,
        })
    }

    /// Converts the strip in the planes, and makes room for the next.
    pub(crate) fn finish_strip(&mut self) -> Result<()> {
        self.convert_strips(1)?;
        for plane in &mut self.planes {
            plane.advance(self.looks_ahead);
        }
        Ok(())
    }

    /// Converts the `count` strips in the planes.
    pub(crate) fn convert_strips(&mut self, count: usize) -> Result<()> {
        self.strips_done += count;
        let end = match self.strips_done * self.strip_height {
            end if end < self.height => end - usize::from(self.looks_ahead),
            _ => self.height,
        };
        self.planes.iter_mut().for_each(Plane::fill_margins);
        let start = self.pixels.len() / self.width;
        (start..end).try_for_each(|y| self.convert_row(y))
    }

    fn convert_row(&mut self, y: usize) -> Result<()> {
        /// Rounded. Adobe's CMYK is inverted, so this gives R, G or B, as in Skia and pdf.js.
        fn mul_div_255(color: u8, black: u8) -> u8 {
            let product = u16::from(color) * u16::from(black) + 128;
            ((product + (product >> 8)) >> 8) as u8
        }

        let (width, pixels) = (self.width, &mut self.pixels);
        match (self.color_space, self.planes.as_mut_slice()) {
            (ColorSpace::Gray, [gray]) => {
                let gray = gray.full_row(y).get(..width).unwrap_or_default();
                pixels.extend(gray.iter().map(|&gray| [gray, gray, gray, 255]));
            }
            (ColorSpace::Rgb, [r, g, b]) => {
                let (r, g, b) = (r.full_row(y), g.full_row(y), b.full_row(y));
                let rgb = r.get(..width).unwrap_or_default().iter().zip(g).zip(b);
                pixels.extend(rgb.map(|((&r, &g), &b)| [r, g, b, 255]));
            }
            (ColorSpace::Cmyk, [c, m, yellow, k]) => {
                let (c, m) = (c.full_row(y), m.full_row(y));
                let (yellow, k) = (yellow.full_row(y), k.full_row(y));
                let c = c.get(..width).unwrap_or_default();
                let cmyk = c.iter().zip(m).zip(yellow).zip(k);
                pixels.extend(cmyk.map(|(((&c, &m), &y), &k)| {
                    [mul_div_255(c, k), mul_div_255(m, k), mul_div_255(y, k), 255]
                }));
            }
            (ColorSpace::Ycc | ColorSpace::Ycck, [luma, cb, cr, k @ ..]) => {
                let chroma = match (cb.upsampling, cr.upsampling) {
                    (Upsampling::BlendH2V1, Upsampling::BlendH2V1) => JpegChroma::HalfWidth {
                        cb: cb.row(y, 1),
                        cr: cr.row(y, 1),
                    },
                    (Upsampling::BlendH2V2, Upsampling::BlendH2V2) => JpegChroma::HalfSize {
                        cb: cb.nearest_rows(y, 1),
                        cr: cr.nearest_rows(y, 1),
                    },
                    _ => JpegChroma::Full {
                        cb: cb.full_row(y),
                        cr: cr.full_row(y),
                    },
                };
                bun_highway::jpeg_ycc_to_rgba(luma.full_row(y), chroma, width, pixels)?;
                if let [k] = k {
                    let row = pixels.get_mut(y * width..).unwrap_or_default();
                    for (pixel, &k) in row.iter_mut().zip(k.full_row(y)) {
                        let [r, g, b, _] = *pixel;
                        *pixel = [
                            mul_div_255(!r, k),
                            mul_div_255(!g, k),
                            mul_div_255(!b, k),
                            255,
                        ];
                    }
                }
            }
            _ => return Err(Error::Internal),
        }
        Ok(())
    }

    pub(crate) fn into_rgba(self) -> Result<Vec<u8>> {
        if self.pixels.len() != self.width * self.height {
            return Err(Error::Internal);
        }
        Ok(self.pixels.into_flattened())
    }
}
