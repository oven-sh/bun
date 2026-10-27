//! `alpha_dec.c`: the alpha plane of a lossy image.

use super::filters::{Filter, unfilter};
use super::{ALPHA_LOSSLESS_COMPRESSION, ALPHA_NO_COMPRESSION};
use crate::util::{Bug, SliceExt, try_vec};
use crate::vp8l::dec::AlphaDecoder;
use crate::{Error, Result};

const ALPHA_PREPROCESSED_LEVELS: u8 = 1;

#[expect(clippy::large_enum_variant, reason = "there is one per image")]
enum Source<'a> {
    /// The rows that are left.
    Raw(&'a [u8]),
    Lossless(AlphaDecoder<'a>),
}

/// `ALPHDecoder`: decodes an `ALPH` payload from the top down, a few rows at a time.
pub(crate) struct Decoder<'a> {
    width: usize,
    height: usize,
    filter: Filter,
    source: Source<'a>,
    /// How many rows `next_rows` has returned.
    rows_done: usize,
    /// What the last call of `next_rows` returned, in a buffer for the largest call.
    rows: Vec<u8>,
    /// Where the last row is in `rows`.
    last_row_at: usize,
}

impl<'a> Decoder<'a> {
    /// `ALPHInit`. No call of `next_rows` will ask for more than `max_rows` rows.
    pub(crate) fn new(
        data: &'a [u8],
        width: usize,
        height: usize,
        max_rows: usize,
    ) -> Result<Self> {
        if width == 0 || height == 0 {
            return Err(Error::Bug);
        }
        let Some((&header, alpha_data @ [_, ..])) = data.split_first() else {
            return Err(Error::BitstreamError);
        };
        let method = header & 0x03;
        let filter = match (header >> 2) & 0x03 {
            0 => Filter::None,
            1 => Filter::Horizontal,
            2 => Filter::Vertical,
            _ => Filter::Gradient,
        };
        let pre_processing = (header >> 4) & 0x03;
        let reserved = (header >> 6) & 0x03;
        if pre_processing > ALPHA_PREPROCESSED_LEVELS || reserved != 0 {
            return Err(Error::BitstreamError);
        }
        let source = match method {
            ALPHA_NO_COMPRESSION => Source::Raw(
                alpha_data
                    .get(..width * height)
                    .ok_or(Error::BitstreamError)?,
            ),
            ALPHA_LOSSLESS_COMPRESSION => {
                Source::Lossless(AlphaDecoder::new(alpha_data, width, height)?)
            }
            _ => return Err(Error::BitstreamError),
        };
        Ok(Self {
            width,
            height,
            filter,
            source,
            rows_done: 0,
            rows: try_vec(0, (max_rows + 1) * width)?,
            last_row_at: 0,
        })
    }

    /// `VP8DecompressAlphaRows`: the next `num_rows` rows, after the row above them, which is undefined at the top.
    pub(crate) fn next_rows(&mut self, num_rows: usize) -> Result<&[u8]> {
        let width = self.width;
        let last_row = self.rows_done + num_rows;
        if num_rows == 0 || last_row > self.height {
            return Err(Error::Bug);
        }
        self.rows.move_within(self.last_row_at, 0, width)?;
        self.last_row_at = num_rows * width;
        let rows = self.rows.sub_mut(..self.last_row_at + width)?;
        let (above, new_rows) = rows.split_at_mid(width)?;
        match &mut self.source {
            Source::Raw(data) => {
                let (raw, rest) = data.split_at_checked(new_rows.len()).ok_or(Bug)?;
                new_rows.write_at(0, raw)?;
                *data = rest;
            }
            Source::Lossless(dec) => dec.decode_rows(last_row, new_rows)?,
        }
        let above = (self.rows_done > 0).then_some(&*above);
        unfilter(self.filter, above, new_rows, width)?;
        self.rows_done = last_row;
        Ok(rows)
    }
}
