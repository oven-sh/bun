//! The five scanline filters, whose loops are in simd.rs. Above the image (or pass) are zeros.
//!
//! A line is a row behind the byte that says which filter it has, its filter type.

use crate::error::{Error, Result};
use crate::header::Header;
use crate::simd;
pub(crate) use crate::simd::{SLACK, set_alpha};

const NONE: u8 = 0;
const AVERAGE: u8 = 3;
const PAETH: u8 = 4;

/// What is above the first row.
pub(crate) fn zeros(len: usize) -> Result<Vec<u8>> {
    let mut zeros = Vec::new();
    zeros.try_reserve_exact(len)?;
    zeros.resize(len, 0);
    Ok(zeros)
}

/// Turns the filtered `row` back into pixels of `bytes_per_pixel`. `above` is the row before it, turned back already.
pub(crate) fn unfilter(
    filter_type: u8,
    bytes_per_pixel: usize,
    row: &mut [u8],
    above: &[u8],
) -> Result<()> {
    if filter_type > PAETH {
        return Err(Error::InvalidFilterType);
    }
    // 3 and 8 are not among them: see `push_as_rgba()`.
    if !matches!(bytes_per_pixel, 1 | 2 | 4 | 6) || row.len() != above.len() {
        return Err(Error::Internal);
    }
    if filter_type != NONE {
        simd::unfilter(filter_type, bytes_per_pixel, row, above);
    }
    Ok(())
}

/// The filter types of rows of 4-byte pixels that wait for more, as Average and Paeth are turned back faster for several.
#[derive(Default)]
pub(crate) struct WaitingRows {
    types: [u8; simd::ROWS],
    len: usize,
}

impl WaitingRows {
    /// Whether rows of such an image ever wait.
    pub(crate) fn pay(header: Header) -> bool {
        !header.interlaced && header.width as usize * 4 >= simd::LONG
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// For the last row of `image`.
    #[inline(always)]
    pub(crate) fn push(
        &mut self,
        filter_type: u8,
        image: &mut [u8],
        stride: usize,
        more_to_come: bool,
    ) -> Result<()> {
        let start = image.len().saturating_sub(stride);
        if start == 0 || stride < simd::LONG || (self.len == 0 && filter_type < AVERAGE) {
            let (done, row) = image.split_at_mut_checked(start).unwrap_or_default();
            return match start.checked_sub(stride).and_then(|at| done.get(at..)) {
                Some(above) => unfilter(filter_type, 4, row, above),
                None => unfilter(filter_type, 4, row, &zeros(stride)?),
            };
        }
        self.wait(filter_type, image, stride, more_to_come)
    }

    #[inline(never)]
    fn wait(
        &mut self,
        filter_type: u8,
        image: &mut [u8],
        stride: usize,
        more_to_come: bool,
    ) -> Result<()> {
        if filter_type > PAETH {
            return Err(Error::InvalidFilterType);
        }
        *self.types.get_mut(self.len).ok_or(Error::Internal)? = filter_type;
        self.len += 1;
        if self.len < simd::ROWS && more_to_come {
            return Ok(());
        }
        let Self { mut types, len } = core::mem::take(self);
        // The last ones go with rows that are done, as if those had no filter.
        let done = if image.len() >= (1 + simd::ROWS) * stride {
            simd::ROWS - len
        } else {
            0
        };
        types.rotate_right(done);
        let start = image.len() - (1 + done + len) * stride;
        let all = image.get_mut(start..).ok_or(Error::Internal)?;
        simd::unfilter_rows(types.get(..done + len).unwrap_or_default(), all, stride);
        Ok(())
    }
}

/// For samples of 8 or 16 bits, which lose their low byte. An alpha that `row` lacks is zero. `row` has `SLACK` bytes more.
#[inline]
pub(crate) fn push_as_rgba(
    row: &[u8],
    width: usize,
    header: Header,
    rgba: &mut Vec<u8>,
) -> Result<()> {
    let bytes_per_pixel = header.bytes_per_pixel();
    if row.len() != width * bytes_per_pixel + SLACK {
        return Err(Error::Internal);
    }
    rgba.try_reserve(width * 4 + SLACK)?;
    match header.bit_depth {
        8 => simd::push_as_rgba::<1>(row, width, bytes_per_pixel, rgba),
        _ => simd::push_as_rgba::<2>(row, width, bytes_per_pixel / 2, rgba),
    }
    Ok(())
}

/// A line for each filter type, to pick one from.
pub(crate) struct CandidateLines {
    lines: [Vec<u8>; 5],
}

impl CandidateLines {
    /// Unless `adaptive`, there is only `unfiltered`.
    pub(crate) fn new(row_bytes: usize, adaptive: bool) -> Result<Self> {
        let mut lines: [Vec<u8>; 5] = Default::default();
        let used = if adaptive { lines.len() } else { 1 };
        for (filter_type, line) in (NONE..).zip(&mut lines).take(used) {
            line.try_reserve_exact(row_bytes.saturating_add(1))?;
            line.push(filter_type);
            line.resize(row_bytes.saturating_add(1), 0);
        }
        Ok(Self { lines })
    }

    /// `row` behind filter type 0.
    pub(crate) fn unfiltered(&mut self, row: &[u8]) -> &[u8] {
        let [none, ..] = &mut self.lines;
        none.truncate(1);
        none.extend_from_slice(row);
        none
    }

    /// `row`, of 4-byte pixels, behind the filter type that brings its bytes nearest to zero, filtered.
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L1666
    pub(crate) fn best(&mut self, row: &[u8], above: &[u8]) -> &[u8] {
        self.unfiltered(row);
        let [_, filtered @ ..] = &mut self.lines;
        let filtered = filtered
            .each_mut()
            .map(|line| line.get_mut(1..).unwrap_or_default());
        let sums = simd::filter_rgba(row.as_chunks().0, above.as_chunks().0, filtered);
        // The first of equals.
        let best = self.lines.iter().zip(sums).min_by_key(|&(_, sum)| sum);
        best.map(|(line, _)| line.as_slice()).unwrap_or_default()
    }
}
