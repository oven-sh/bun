//! A row of macroblocks on its way through the loop filter to RGBA.

use bun_highway::webp::{self as kernels, FilterStrength, ROW_STEP};

use super::header::FilterType;
use super::reconstruct::Samples;
use crate::alpha;
use crate::array::At;
use crate::error::{Error, Result};
use crate::vec;

/// In front of each row. Chroma has its first sample repeated there.
const MARGIN: usize = 16;

/// One channel of the row of macroblocks, below the last rows of the one above.
struct Plane<'a> {
    samples: &'a mut [u8],
    stride: usize,
    kept_rows: usize,
}

impl Plane<'_> {
    fn stride(width: usize) -> usize {
        let stride = MARGIN + width + MARGIN;
        // Rows that are a multiple of 1024 apart compete for the same places in the cache.
        stride + if stride.is_multiple_of(1024) { 64 } else { 0 }
    }

    fn start(&self) -> usize {
        self.kept_rows * self.stride + MARGIN
    }

    #[inline(always)]
    fn store<const N: usize>(
        &mut self,
        x: usize,
        rows: impl Iterator<Item = [u8; N]>,
    ) -> Option<()> {
        let mut rest = self.samples.get_mut(self.kept_rows * self.stride..)?;
        for row in rows {
            let to = rest.split_off_mut(..self.stride)?;
            *to.get_mut(MARGIN + x * N..)?.first_chunk_mut()? = row;
        }
        Some(())
    }

    fn for_filter(&mut self) -> kernels::Plane<'_> {
        kernels::Plane {
            start: self.start(),
            stride: self.stride,
            samples: self.samples,
        }
    }

    /// From `before` samples in front of it. The first kept row has index 0.
    fn row(&self, index: usize, before: usize) -> Result<&[u8]> {
        let start = index * self.stride + MARGIN - before;
        self.samples.get(start..).ok_or(Error::Internal)
    }

    fn first_of_row(&self, index: usize) -> u8 {
        let sample = self.samples.get(index * self.stride + MARGIN);
        sample.copied().unwrap_or_default()
    }

    /// Repeats the first and the last sample of each row, of which `width` are in the picture.
    fn extend_rows(&mut self, width: usize) {
        for row in self.samples.chunks_exact_mut(self.stride.max(1)) {
            if let Some([before, row @ .., behind]) = row.get_mut(MARGIN - 1..=MARGIN + width) {
                *before = row.first().copied().unwrap_or_default();
                *behind = row.last().copied().unwrap_or_default();
            }
        }
    }

    fn keep_last_rows(&mut self) {
        let new_len = self.samples.len().saturating_sub(self.start());
        if let Some((kept, new)) = self
            .samples
            .split_at_mut_checked(self.kept_rows * self.stride)
            && let Some(last) = new.get(new_len.saturating_sub(kept.len())..new_len)
            && last.len() == kept.len()
        {
            kept.copy_from_slice(last);
        }
    }
}

/// The chroma of the two rows of pixels between two rows of a `Plane`.
struct Upsampled<'a> {
    rows: [&'a mut [u8]; 2],
    pairs: usize,
}

impl Upsampled<'_> {
    fn fill(&mut self, plane: &Plane, [upper, lower]: [usize; 2]) -> Result<()> {
        let from = [plane.row(upper, 1)?, plane.row(lower, 1)?];
        let to = self.rows.each_mut().map(|row| &mut **row);
        kernels::upsample(from, to, self.pairs);
        Ok(())
    }

    /// The first sample is outside of the picture.
    fn row(&self, is_lower: bool) -> &[u8] {
        let row = self.rows.at(usize::from(is_lower));
        row.get(1..).unwrap_or_default()
    }
}

pub(super) struct Planes<'a> {
    y: Plane<'a>,
    u: Plane<'a>,
    v: Plane<'a>,
    upsampled_u: Upsampled<'a>,
    upsampled_v: Upsampled<'a>,
    filter_type: FilterType,
    width: usize,
    height: usize,
    alpha: Option<alpha::decoder::Rows<'a>>,
    opaque: &'a [u8],
    pixels: Vec<[u8; 4]>,
    rows_done: usize,
}

impl<'a> Planes<'a> {
    /// All but the pixels and their alpha is put into `memory`.
    pub(super) fn new(
        width: usize,
        height: usize,
        filter_type: FilterType,
        alpha: Option<&'a [u8]>,
        memory: &'a mut Vec<u8>,
    ) -> Result<Self> {
        let (alpha, pixels) = match alpha {
            Some(chunk) => {
                let (rows, pixels) = alpha::decoder::Rows::new(chunk, width, height)?;
                (Some(rows), pixels)
            }
            None => (None, vec::with_room(width * height)?),
        };
        let padded = width.next_multiple_of(ROW_STEP);
        // What the filter reads across an edge. The first of them is final, and shared by pixels above and below it.
        let kept_chroma_rows = if filter_type == FilterType::Normal {
            4
        } else {
            1
        };
        let (y_stride, uv_stride) = (Plane::stride(padded), Plane::stride(padded / 2));
        let y_len = (2 * kept_chroma_rows + 16) * y_stride + MARGIN;
        let uv_len = (kept_chroma_rows + 8) * uv_stride + MARGIN;
        let pairs = width / 2 + 1;
        let upsampled_len = 2 * pairs.next_multiple_of(ROW_STEP) + MARGIN;
        *memory = vec::filled(0, y_len + 2 * uv_len + 4 * upsampled_len + padded)?;
        let mut rest = memory.as_mut_slice();
        let mut take = |len| rest.split_off_mut(..len).ok_or(Error::Internal);
        let mut plane = |len, stride, kept_rows| {
            take(len).map(|samples| Plane {
                samples,
                stride,
                kept_rows,
            })
        };
        let y = plane(y_len, y_stride, 2 * kept_chroma_rows)?;
        let u = plane(uv_len, uv_stride, kept_chroma_rows)?;
        let v = plane(uv_len, uv_stride, kept_chroma_rows)?;
        let mut upsampled = || -> Result<_> {
            let rows = [take(upsampled_len)?, take(upsampled_len)?];
            Ok(Upsampled { rows, pairs })
        };
        let (upsampled_u, upsampled_v) = (upsampled()?, upsampled()?);
        rest.fill(255);
        Ok(Self {
            y,
            u,
            v,
            upsampled_u,
            upsampled_v,
            filter_type,
            width,
            height,
            alpha,
            opaque: rest,
            pixels,
            rows_done: 0,
        })
    }

    #[inline(always)]
    pub(super) fn store(&mut self, x: usize, samples: &Samples) -> Result<()> {
        let halves = samples.uv.as_flattened().as_chunks::<8>().0.as_chunks().0;
        let y = self.y.store(x, samples.y.iter().copied());
        let u = self.u.store(x, halves.iter().map(|&[u, _]| u));
        let v = self.v.store(x, halves.iter().map(|&[_, v]| v));
        y.and(u).and(v).ok_or(Error::Internal)
    }

    /// All macroblocks of row `y` are stored.
    pub(super) fn finish_row(&mut self, y: usize, strengths: &[FilterStrength]) -> Result<()> {
        match self.filter_type {
            FilterType::None => {}
            FilterType::Simple => kernels::filter_simply(self.y.for_filter(), strengths, y > 0),
            FilterType::Normal => {
                let planes = [&mut self.y, &mut self.u, &mut self.v].map(Plane::for_filter);
                kernels::filter_normally(planes, strengths, y > 0);
            }
        }
        let bottom = 16 * (y + 1);
        let end = match bottom < self.height {
            true => bottom + 1 - self.y.kept_rows,
            false => self.height,
        };
        match self.width {
            1 => self.convert_column(y, end)?,
            _ => self.convert_rows(y, end)?,
        }
        self.rows_done = end;

        self.y.keep_last_rows();
        self.u.keep_last_rows();
        self.v.keep_last_rows();
        Ok(())
    }

    fn convert_rows(&mut self, y: usize, end: usize) -> Result<()> {
        let chroma_width = self.width.div_ceil(2);
        self.u.extend_rows(chroma_width);
        self.v.extend_rows(chroma_width);
        let last_chroma_row = (self.height - 1) / 2;
        for row in self.rows_done..end {
            let start = row * self.width;
            let is_lower = row % 2 == 0;
            if !is_lower || row == 0 {
                let chroma_rows = [row / 2, last_chroma_row.min(row.div_ceil(2))];
                let chroma_rows = chroma_rows.map(|row| row + self.u.kept_rows - 8 * y);
                self.upsampled_u.fill(&self.u, chroma_rows)?;
                self.upsampled_v.fill(&self.v, chroma_rows)?;
            }
            let yuva = [
                self.y.row(row + self.y.kept_rows - 16 * y, 0)?,
                self.upsampled_u.row(is_lower),
                self.upsampled_v.row(is_lower),
                match &mut self.alpha {
                    Some(alpha) => alpha.next(1, self.pixels.get(start..).unwrap_or_default())?,
                    None => self.opaque,
                },
            ];
            kernels::yuv_to_rgba(yuva, &mut self.pixels, start, self.width);
        }
        Ok(())
    }

    /// The same for rows of one pixel, which are converted as if they were a single row.
    fn convert_column(&mut self, y: usize, end: usize) -> Result<()> {
        let (start, count) = (self.rows_done, end - self.rows_done);
        let [mut luma, mut u, mut v] = [[0; ROW_STEP]; 3];
        for (row, x) in (start..end).zip(0..) {
            let far = match row % 2 {
                0 => row.saturating_sub(1),
                _ => (row + 1).min(self.height - 1),
            };
            let chroma_rows = [row, far].map(|row| row / 2 + self.u.kept_rows - 8 * y);
            let upsampled = |plane: &Plane| {
                let [near, far] = chroma_rows.map(|row| u32::from(plane.first_of_row(row)));
                ((3 * near + far + 2) / 4) as u8
            };
            *luma.at_mut(x) = self.y.first_of_row(row + self.y.kept_rows - 16 * y);
            (*u.at_mut(x), *v.at_mut(x)) = (upsampled(&self.u), upsampled(&self.v));
        }
        let alpha = match &mut self.alpha {
            Some(alpha) => alpha.next(count, self.pixels.get(start..).unwrap_or_default())?,
            None => self.opaque,
        };
        kernels::yuv_to_rgba([&luma, &u, &v, alpha], &mut self.pixels, start, count);
        Ok(())
    }

    pub(super) fn into_pixels(self) -> Vec<[u8; 4]> {
        self.pixels
    }
}
