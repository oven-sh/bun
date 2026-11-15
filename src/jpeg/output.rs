//! From the samples of each component to pixels (jdsample.c, jdcolor.c).

use crate::block::Block;
use crate::header::{ColorSpace, Frame, MAX_COMPONENTS, Process};
use crate::{Error, Result, filled};
use bun_highway::{JPEG_PIXEL_GROUP, JPEG_ROW_SLACK, JpegChroma};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Upsampling {
    Repeat {
        h: usize,
        v: usize,
    },
    /// A sample becomes 2 by 1, 1 by 2 or 2 by 2, each blended with the neighbours on its side.
    BlendH2V1,
    BlendH1V2,
    BlendH2V2,
}

/// Room for a copy of the first sample of a row.
const LEFT_MARGIN: usize = 16;

/// Some rows of one component.
pub(crate) struct Plane {
    /// How many samples wide and high a block is.
    block_size: usize,
    width: usize,
    height: usize,
    upsampling: Upsampling,
    stride: usize,
    /// How many rows a row of MCUs has.
    strip_height: usize,
    /// The row above `top`, then `top` and those below.
    samples: Vec<u8>,
    top: usize,
    upsampled: Vec<u8>,
}

impl Plane {
    /// From the margin of row `y` to the end of the last row.
    fn rows_from(&self, y: usize) -> &[u8] {
        let start = (y + 1 - self.top) * self.stride;
        self.samples.get(start..).unwrap_or_default()
    }

    /// From the start of row `y` to the end of the last row.
    pub(crate) fn rows_from_mut(&mut self, y: usize) -> &mut [u8] {
        let start = (y + 1 - self.top) * self.stride + LEFT_MARGIN;
        self.samples.get_mut(start..).unwrap_or_default()
    }

    /// Transforms `blocks`, the first of which is at `x` and `y`, counted in blocks.
    pub(crate) fn put(&mut self, blocks: &[Block], quant: &Block, x: usize, y: usize) {
        let (size, stride) = (self.block_size, self.stride);
        let out = self.rows_from_mut(y * size).get_mut(x * size..);
        let out = out.unwrap_or_default();
        if size > 1 {
            return bun_highway::jpeg_inverse_transform(blocks, quant, size, out, stride);
        }
        for (sample, block) in out.iter_mut().zip(blocks) {
            let mean = (i32::from(block.0[0]) * i32::from(quant.0[0]) + 4) >> 3;
            *sample = (mean + 128).clamp(0, 255) as u8;
        }
    }

    /// The row starts `before` samples early, and goes on past its end.
    fn row(&self, y: usize, before: usize) -> &[u8] {
        let row = self.rows_from(y).get(LEFT_MARGIN - before..);
        row.unwrap_or_default()
    }

    /// The two rows that row `y` of the image is between, if it has twice as many: the nearer first.
    fn nearest_rows(&self, y: usize, before: usize) -> [&[u8]; 2] {
        let far = match y % 2 {
            0 => (y / 2).saturating_sub(1),
            _ => (y / 2 + 1).min(self.height - 1),
        };
        [self.row(y / 2, before), self.row(far, before)]
    }

    /// Makes the first and last sample of each row their own neighbours.
    fn fill_margins(&mut self) {
        if !matches!(
            self.upsampling,
            Upsampling::BlendH2V1 | Upsampling::BlendH2V2
        ) {
            return;
        }
        for row in self.samples.chunks_exact_mut(self.stride).skip(1) {
            row.copy_within(LEFT_MARGIN..=LEFT_MARGIN, LEFT_MARGIN - 1);
            let last = LEFT_MARGIN + self.width - 1;
            row.copy_within(last..=last, last + 1);
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
        /// `sums` has those of the rows, weighed, from the margin on.
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
        fn neighbors(row: &[u8]) -> impl Iterator<Item = [u16; 3]> {
            let from = |x| row.iter().skip(x).map(|&sample| u16::from(sample));
            let all = from(0).zip(from(1)).zip(from(2));
            all.map(|((left, this), right)| [left, this, right])
        }

        let mut out = core::mem::take(&mut self.upsampled);
        match self.upsampling {
            // It is still there from the row above.
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
    /// Whether the last row of pixels of a row of MCUs has to wait for the next.
    looks_ahead: bool,
    strips: usize,
    rows: usize,
    pixels: Vec<[u8; 4]>,
}

impl Output {
    /// The planes have room for `strips` rows of MCUs. Only [`Process::Lossless`] ignores `eighths`.
    pub(crate) fn new(
        frame: &Frame,
        color_space: ColorSpace,
        eighths: u8,
        strips: usize,
    ) -> Result<Self> {
        let (scale, unit) = match frame.process {
            Process::Lossless => (1, 1),
            _ => (usize::from(eighths), 8),
        };
        let (max_h, max_v) = (frame.max_h(), frame.max_v());
        let mcus_wide = frame.size_in_mcus().wide;
        let (image_width, image_height) = (usize::from(frame.width), usize::from(frame.height));
        let width = (image_width * scale).div_ceil(unit);
        let height = (image_height * scale).div_ceil(unit);
        let padded_width = width.next_multiple_of(JPEG_PIXEL_GROUP);

        let mut planes = Vec::new();
        planes.try_reserve_exact(MAX_COMPONENTS)?;
        for component in frame.components() {
            let (h, v) = (usize::from(component.h), usize::from(component.v));
            // Larger blocks are better than upsampling.
            let mut size = scale;
            while size < unit
                && (max_h * scale).is_multiple_of(h * size * 2)
                && (max_v * scale).is_multiple_of(v * size * 2)
            {
                size *= 2;
            }
            if !(max_h * scale).is_multiple_of(h * size)
                || !(max_v * scale).is_multiple_of(v * size)
            {
                return Err(Error::Unsupported);
            }
            let plane_width = (image_width * h * size).div_ceil(max_h * unit);
            let upsampling = match (max_h * scale / (h * size), max_v * scale / (v * size)) {
                (2, 1) if scale > 1 && plane_width > 2 => Upsampling::BlendH2V1,
                (1, 2) if scale > 1 => Upsampling::BlendH1V2,
                (2, 2) if scale > 1 && plane_width > 2 => Upsampling::BlendH2V2,
                (h, v) => Upsampling::Repeat { h, v },
            };
            let stride = LEFT_MARGIN
                + (mcus_wide * h * size).next_multiple_of(JPEG_PIXEL_GROUP)
                + JPEG_ROW_SLACK;
            let upsampled_len = match upsampling {
                Upsampling::Repeat { h: 1, .. } => 0,
                _ => padded_width + 2,
            };
            planes.push(Plane {
                block_size: size,
                width: plane_width,
                height: (image_height * v * size).div_ceil(max_v * unit),
                upsampling,
                stride,
                strip_height: v * size,
                samples: filled((1 + strips * v * size) * stride, 0)?,
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
            strip_height: max_v * scale,
            strips: 0,
            rows: 0,
            pixels,
        })
    }

    /// The planes have the samples of one more row of MCUs, and make room for the next.
    pub(crate) fn finish_strip(&mut self) -> Result<()> {
        self.convert_strips(1)?;
        for plane in &mut self.planes {
            plane.advance(self.looks_ahead);
        }
        Ok(())
    }

    /// The planes have the samples of `count` more rows of MCUs.
    pub(crate) fn convert_strips(&mut self, count: usize) -> Result<()> {
        self.strips += count;
        let end = match self.strips * self.strip_height {
            end if end < self.height => end - usize::from(self.looks_ahead),
            _ => self.height,
        };
        self.planes.iter_mut().for_each(Plane::fill_margins);
        for y in self.rows..end {
            self.convert_row(y)?;
        }
        self.rows = end;
        Ok(())
    }

    fn convert_row(&mut self, y: usize) -> Result<()> {
        /// Adobe's files have 255 for no ink. Skia and pdf.js multiply like this too.
        fn inked(color: u8, black: u8) -> u8 {
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
                pixels.extend(
                    cmyk.map(|(((&c, &m), &y), &k)| [inked(c, k), inked(m, k), inked(y, k), 255]),
                );
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
                bun_highway::jpeg_ycc_to_rgba(luma.full_row(y), chroma, width, pixels);
                if let [k] = k {
                    let row = pixels.get_mut(y * width..).unwrap_or_default();
                    for (pixel, &k) in row.iter_mut().zip(k.full_row(y)) {
                        let [r, g, b, _] = *pixel;
                        *pixel = [inked(!r, k), inked(!g, k), inked(!b, k), 255];
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
