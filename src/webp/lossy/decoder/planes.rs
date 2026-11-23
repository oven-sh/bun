//! A row of macroblocks on its way through the loop filter to RGBA.

use bun_highway::webp::{self as kernels, FilterStrength, ROW_STEP};

use super::header::FilterType;
use super::reconstruct::Samples;
use crate::alpha;
use crate::array::At;
use crate::error::Result;
use crate::slice::{InBounds, known};
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
    fn row(&self, index: usize, before: usize) -> &[u8] {
        let start = index * self.stride + MARGIN - before;
        known(self.samples.get(start..)).unwrap_or(self.samples)
    }

    fn first_of_row(&self, index: usize) -> u8 {
        self.samples.value(index * self.stride + MARGIN)
    }

    /// Repeats the first and the last sample of each row, of which `width` are in the picture.
    #[inline(always)]
    fn extend_rows(&mut self, width: usize) {
        for row in self.samples.chunks_exact_mut(self.stride.max(1)) {
            let (first, last) = (row.value(MARGIN), row.value(MARGIN + width - 1));
            row.set(MARGIN - 1, first);
            row.set(MARGIN + width, last);
        }
    }

    fn keep_last_rows(&mut self) {
        let last = self.samples.len().saturating_sub(self.start());
        self.samples.copy_within(last.., 0);
    }
}

/// The chroma of the two rows of pixels between two rows of a `Plane`.
struct Upsampled<'a> {
    rows: [&'a mut [u8]; 2],
    pairs: usize,
}

impl Upsampled<'_> {
    #[inline(always)]
    fn fill(&mut self, plane: &Plane, rows: [usize; 2]) {
        let to = self.rows.each_mut().map(|row| &mut **row);
        kernels::upsample(rows.map(|row| plane.row(row, 1)), to, self.pairs);
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
        let row_len = 2 * pairs.next_multiple_of(ROW_STEP) + MARGIN;
        let lens = [
            y_len, uv_len, uv_len, row_len, row_len, row_len, row_len, padded,
        ];
        *memory = vec::filled(0, lens.iter().sum())?;
        let mut rest = memory.as_mut_slice();
        let [y, u, v, upper_u, lower_u, upper_v, lower_v, opaque] =
            lens.map(|len| rest.split_off_mut(..len).unwrap_or_default());
        opaque.fill(255);
        let plane = |samples, stride, kept_rows| Plane {
            samples,
            stride,
            kept_rows,
        };
        let upsampled = |rows| Upsampled { rows, pairs };
        Ok(Self {
            y: plane(y, y_stride, 2 * kept_chroma_rows),
            u: plane(u, uv_stride, kept_chroma_rows),
            v: plane(v, uv_stride, kept_chroma_rows),
            upsampled_u: upsampled([upper_u, lower_u]),
            upsampled_v: upsampled([upper_v, lower_v]),
            filter_type,
            width,
            height,
            alpha,
            opaque,
            pixels,
            rows_done: 0,
        })
    }

    #[inline(always)]
    pub(super) fn store(&mut self, x: usize, samples: &Samples) {
        let halves = samples.uv.as_flattened().as_chunks::<8>().0.as_chunks().0;
        let y = self.y.store(x, samples.y.iter().copied());
        let u = self.u.store(x, halves.iter().map(|&[u, _]| u));
        let v = self.v.store(x, halves.iter().map(|&[_, v]| v));
        known(y.and(u).and(v));
    }

    /// All macroblocks of row `y` are stored.
    pub(super) fn finish_row(&mut self, y: usize, strengths: &[FilterStrength]) {
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
            1 => self.convert_column(y, end),
            _ => self.convert_rows(y, end),
        }
        self.rows_done = end;

        self.y.keep_last_rows();
        self.u.keep_last_rows();
        self.v.keep_last_rows();
    }

    fn convert_rows(&mut self, y: usize, end: usize) {
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
                self.upsampled_u.fill(&self.u, chroma_rows);
                self.upsampled_v.fill(&self.v, chroma_rows);
            }
            let pixels = self.pixels.get(start..).unwrap_or_default();
            let alpha = self.alpha.as_mut().and_then(|it| known(it.next(1, pixels)));
            let yuva = [
                self.y.row(row + self.y.kept_rows - 16 * y, 0),
                self.upsampled_u.row(is_lower),
                self.upsampled_v.row(is_lower),
                alpha.unwrap_or(self.opaque),
            ];
            kernels::yuv_to_rgba(yuva, &mut self.pixels, start, self.width);
        }
    }

    /// The same for rows of one pixel, which are converted as if they were a single row.
    fn convert_column(&mut self, y: usize, end: usize) {
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
        let pixels = self.pixels.get(start..).unwrap_or_default();
        let alpha = self
            .alpha
            .as_mut()
            .and_then(|it| known(it.next(count, pixels)));
        let yuva = [&luma, &u, &v, alpha.unwrap_or(self.opaque)];
        kernels::yuv_to_rgba(yuva, &mut self.pixels, start, count);
    }

    pub(super) fn into_pixels(self) -> Vec<[u8; 4]> {
        self.pixels
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;
    use crate::slice::checked;

    #[test]
    fn there_is_nothing_outside_of_a_plane() {
        let mut plane = Plane {
            samples: &mut [0; 3 * MARGIN],
            stride: 3 * MARGIN,
            kept_rows: 0,
        };
        assert_eq!(checked(|| Ok(plane.row(0, 0).len())), Ok(2 * MARGIN));
        assert_eq!(checked(|| Ok(plane.row(1, 0).len())), Err(Error::Internal));
        let mut store = |kept_rows, x| {
            plane.kept_rows = kept_rows;
            plane.store(x, [[0; MARGIN]].into_iter())
        };
        assert_eq!(store(0, 1), Some(()));
        for outside in [1, 2] {
            assert_eq!([store(outside, 1), store(0, 1 + outside)], [None; 2]);
        }
    }
}
