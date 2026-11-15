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
struct Plane {
    samples: Vec<u8>,
    stride: usize,
    kept_rows: usize,
}

impl Plane {
    fn new(width: usize, kept_rows: usize, new_rows: usize) -> Result<Self> {
        let stride = MARGIN + width + MARGIN;
        Ok(Self {
            samples: vec::filled(0, (kept_rows + new_rows) * stride + MARGIN)?,
            stride,
            kept_rows,
        })
    }

    fn start(&self) -> usize {
        self.kept_rows * self.stride + MARGIN
    }

    fn store<const N: usize>(
        &mut self,
        x: usize,
        rows: impl Iterator<Item = [u8; N]>,
    ) -> Option<()> {
        let mut at = self.start() + x * N;
        for row in rows {
            *self.samples.get_mut(at..)?.first_chunk_mut()? = row;
            at += self.stride;
        }
        Some(())
    }

    fn for_filter(&mut self) -> kernels::Plane<'_> {
        kernels::Plane {
            start: self.start(),
            stride: self.stride,
            samples: &mut self.samples,
        }
    }

    /// From `before` samples in front of it. The first kept row has index 0.
    fn row(&self, index: usize, before: usize) -> Result<&[u8]> {
        let start = index * self.stride + MARGIN - before;
        self.samples.get(start..).ok_or(Error::Internal)
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
struct Upsampled {
    rows: [Vec<u8>; 2],
    pairs: usize,
}

impl Upsampled {
    fn new(width: usize) -> Result<Self> {
        let pairs = width / 2 + 1;
        let row = || vec::filled(0, 2 * pairs.next_multiple_of(ROW_STEP) + 1);
        Ok(Self {
            rows: [row()?, row()?],
            pairs,
        })
    }

    fn fill(&mut self, plane: &Plane, [upper, lower]: [usize; 2]) -> Result<()> {
        let from = [plane.row(upper, 1)?, plane.row(lower, 1)?];
        let to = self.rows.each_mut().map(Vec::as_mut_slice);
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
    y: Plane,
    u: Plane,
    v: Plane,
    upsampled_u: Upsampled,
    upsampled_v: Upsampled,
    filter_type: FilterType,
    width: usize,
    height: usize,
    alpha: Option<alpha::decoder::Rows<'a>>,
    opaque: Vec<u8>,
    pixels: Vec<[u8; 4]>,
    rows_done: usize,
}

impl<'a> Planes<'a> {
    pub(super) fn new(
        width: usize,
        height: usize,
        filter_type: FilterType,
        alpha: Option<&'a [u8]>,
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
        Ok(Self {
            y: Plane::new(padded, 2 * kept_chroma_rows, 16)?,
            u: Plane::new(padded / 2, kept_chroma_rows, 8)?,
            v: Plane::new(padded / 2, kept_chroma_rows, 8)?,
            upsampled_u: Upsampled::new(width)?,
            upsampled_v: Upsampled::new(width)?,
            filter_type,
            width,
            height,
            alpha,
            opaque: vec::filled(255, padded)?,
            pixels,
            rows_done: 0,
        })
    }

    #[inline(always)]
    pub(super) fn store(&mut self, x: usize, samples: &Samples) -> Result<()> {
        let half = |index| {
            let halves = samples.uv.as_flattened().as_chunks::<8>().0;
            halves.iter().skip(index).step_by(2).copied()
        };
        let y = self.y.store(x, samples.y.iter().copied());
        let u = self.u.store(x, half(0));
        let v = self.v.store(x, half(1));
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
        let chroma_width = self.width.div_ceil(2);
        self.u.extend_rows(chroma_width);
        self.v.extend_rows(chroma_width);

        let bottom = 16 * (y + 1);
        let end = match bottom < self.height {
            true => bottom + 1 - self.y.kept_rows,
            false => self.height,
        };
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
                    Some(alpha) => alpha.next(self.pixels.get(start..).unwrap_or_default())?,
                    None => &self.opaque,
                },
            ];
            kernels::yuv_to_rgba(yuva, &mut self.pixels, start, self.width);
        }
        self.rows_done = end;

        self.y.keep_last_rows();
        self.u.keep_last_rows();
        self.v.keep_last_rows();
        Ok(())
    }

    pub(super) fn into_pixels(self) -> Vec<[u8; 4]> {
        self.pixels
    }
}
