//! The alpha channel, a row at a time.

use bun_highway::webp::ROW_STEP;

use super::{Filter, LOSSLESS_COMPRESSION, NO_COMPRESSION, gradient};
use crate::error::{Error, Result};
use crate::lossless::decoder::{Green, IndexedGreen, MAX_BUNDLE_LEN, decode_green};
use crate::vec;

pub(crate) struct Rows<'a> {
    source: Source<'a>,
    filter: Filter,
    y: usize,
    width: usize,
    /// With the padding that `yuv_to_rgba()` reads. Above the first are zeros.
    row: Vec<u8>,
    first_above: u8,
}

enum Source<'a> {
    Raw(&'a [u8]),
    /// With room for a row.
    Indexed(IndexedGreen, Vec<u8>),
    /// In the green of the pixels that the picture is about to be written over.
    InPlace,
}

impl<'a> Rows<'a> {
    /// Also returns where the picture goes: room for `width * height` pixels, which may be there already.
    pub(crate) fn new(
        chunk: &'a [u8],
        width: usize,
        height: usize,
    ) -> Result<(Self, Vec<[u8; 4]>)> {
        let &[header, ref data @ ..] = chunk else {
            return Err(Error::InvalidAlpha);
        };
        // Above the filter: whether the number of levels was reduced, which is up to the viewer to care about, and zeros.
        if header >> 4 > 1 || data.is_empty() {
            return Err(Error::InvalidAlpha);
        }
        let filter = match ((header >> 2) & 3, width) {
            (0, _) => Filter::None,
            // The filters differ from the second column on.
            (1, _) | (_, 1) => Filter::Horizontal,
            (2, _) => Filter::Vertical,
            _ => Filter::Gradient,
        };
        let padded = width.next_multiple_of(ROW_STEP);
        let (source, pixels) = match header & 3 {
            NO_COMPRESSION if data.len() >= width * height => (Source::Raw(data), None),
            LOSSLESS_COMPRESSION => match decode_green(data, width, height)? {
                Green::Indexed(green) => {
                    let row = vec::with_room(padded + MAX_BUNDLE_LEN)?;
                    (Source::Indexed(green, row), None)
                }
                Green::Pixels(pixels) => (Source::InPlace, Some(pixels)),
            },
            _ => return Err(Error::InvalidAlpha),
        };
        let rows = Self {
            source,
            filter,
            y: 0,
            width,
            row: vec::filled(0, padded)?,
            first_above: 0,
        };
        Ok((
            rows,
            pixels.map_or_else(|| vec::with_room(width * height), Ok)?,
        ))
    }

    /// The alpha of the next row of the picture, or of up to `ROW_STEP` if they have one pixel. `pixels` are those that
    /// are there already, from the start of that row.
    // With early exits: behind `InBounds` the loops over `pixels` are not vectorized.
    pub(crate) fn next(&mut self, count: usize, pixels: &[[u8; 4]]) -> Option<&[u8]> {
        let (len, left) = (count * self.width, self.first_above);
        let row = self.row.get_mut(..len)?;
        let filter = match (self.filter, self.y) {
            (Filter::Vertical, 0) => Filter::Horizontal,
            (filter, _) => filter,
        };
        match &mut self.source {
            Source::Raw(unread) => {
                let (raw, rest) = unread.split_at_checked(len)?;
                unfilter(filter, raw.iter().copied(), row, left);
                *unread = rest;
            }
            Source::Indexed(green, filtered) => {
                filtered.clear();
                green.append_rows(self.y..self.y + count, filtered);
                unfilter(filter, filtered.iter().copied(), row, left);
            }
            Source::InPlace => {
                let pixels = pixels.get(..len)?.iter();
                unfilter(filter, pixels.map(|&[_, green, ..]| green), row, left);
            }
        }
        self.first_above = *row.get(len - self.width)?;
        self.y += count;
        Some(&self.row)
    }
}

/// In the place of the row above.
#[inline(always)]
fn unfilter(filter: Filter, filtered: impl Iterator<Item = u8>, row: &mut [u8], mut left: u8) {
    let mut above_left = left;
    let row = row.iter_mut().zip(filtered);
    match filter {
        Filter::None => row.for_each(|(alpha, it)| *alpha = it),
        Filter::Vertical => row.for_each(|(alpha, it)| *alpha = it.wrapping_add(*alpha)),
        Filter::Horizontal => {
            for (alpha, it) in row {
                left = it.wrapping_add(left);
                *alpha = left;
            }
        }
        Filter::Gradient => {
            for (alpha, it) in row {
                left = it.wrapping_add(gradient(left, *alpha, above_left));
                above_left = core::mem::replace(alpha, left);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_row_is_all_there() -> Result<()> {
        let mut rows = Rows {
            source: Source::InPlace,
            filter: Filter::None,
            y: 0,
            width: 1,
            row: vec::filled(0, 2)?,
            first_above: 0,
        };
        assert_eq!(rows.next(1, &[[7; 4]]), Some([7, 0].as_slice()));
        assert_eq!(rows.next(2, &[[7; 4]]), None);
        assert_eq!(rows.next(3, &[[7; 4]; 3]), None);
        rows.source = Source::Raw(&[7]);
        assert_eq!(rows.next(2, &[]), None);
        rows.width = 0;
        assert_eq!(rows.next(1, &[]), None);
        Ok(())
    }
}
