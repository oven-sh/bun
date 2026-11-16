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
    /// Both with the padding that `yuv_to_rgba()` reads.
    row: Vec<u8>,
    above: Vec<u8>,
}

enum Source<'a> {
    Raw(&'a [u8]),
    Indexed(IndexedGreen),
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
        let filter = match (header >> 2) & 3 {
            0 => Filter::None,
            1 => Filter::Horizontal,
            2 => Filter::Vertical,
            _ => Filter::Gradient,
        };
        let (source, pixels) = match header & 3 {
            NO_COMPRESSION if data.len() >= width * height => (Source::Raw(data), None),
            LOSSLESS_COMPRESSION => match decode_green(data, width, height)? {
                Green::Indexed(green) => (Source::Indexed(green), None),
                Green::Pixels(pixels) => (Source::InPlace, Some(pixels)),
            },
            _ => return Err(Error::InvalidAlpha),
        };
        let padded = width + MAX_BUNDLE_LEN + ROW_STEP;
        let rows = Self {
            source,
            filter,
            y: 0,
            width,
            row: vec::filled(0, padded)?,
            above: vec::filled(0, padded)?,
        };
        Ok((
            rows,
            pixels.map_or_else(|| vec::with_room(width * height), Ok)?,
        ))
    }

    /// The alpha of the next row of the picture. `pixels` are those that are there already, from the start of that row.
    pub(crate) fn next(&mut self, pixels: &[[u8; 4]]) -> Result<&[u8]> {
        core::mem::swap(&mut self.row, &mut self.above);
        self.row.clear();
        match &mut self.source {
            Source::Raw(unread) => {
                let (raw, rest) = unread.split_at_checked(self.width).ok_or(Error::Internal)?;
                self.row.extend_from_slice(raw);
                *unread = rest;
            }
            Source::Indexed(green) => green.append_row(self.y, &mut self.row),
            Source::InPlace => {
                let pixels = pixels.get(..self.width).ok_or(Error::Internal)?;
                self.row.extend(pixels.iter().map(|&[_, green, ..]| green));
            }
        }
        self.row.extend([0; ROW_STEP]);
        let row = self.row.get_mut(..self.width).ok_or(Error::Internal)?;
        unfilter(self.filter, row, &self.above, self.y == 0);
        self.y += 1;
        Ok(&self.row)
    }
}

/// Above the first row are zeros.
fn unfilter(filter: Filter, row: &mut [u8], above: &[u8], is_first: bool) {
    let first_above = above.first().copied().unwrap_or(0);
    match filter {
        Filter::None => {}
        Filter::Vertical if !is_first => {
            for (alpha, &above) in row.iter_mut().zip(above) {
                *alpha = alpha.wrapping_add(above);
            }
        }
        Filter::Horizontal | Filter::Vertical => {
            let mut left = first_above;
            for alpha in row {
                left = alpha.wrapping_add(left);
                *alpha = left;
            }
        }
        Filter::Gradient => {
            let (mut left, mut above_left) = (first_above, first_above);
            for (alpha, &above) in row.iter_mut().zip(above) {
                left = alpha.wrapping_add(gradient(left, above, above_left));
                above_left = above;
                *alpha = left;
            }
        }
    }
}
