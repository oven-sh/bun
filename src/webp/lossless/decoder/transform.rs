//! What was done to the pixels to make them compress better, and how it is undone.

use bun_highway::webp::{undo_cross_color, undo_prediction};

use super::Rgba;
use super::bit_reader::BitReader;
use super::pixels;
use crate::array::At;
use crate::error::Result;
use crate::lossless::{
    BLACK, MAX_PALETTE_LEN, MIN_TILE_BITS, TILE_BITS_BITS, TransformType, bundle_bits, subsampled,
};
use crate::slice::{self, InBounds, known};
use crate::vec;

pub(crate) const MAX_BUNDLE_LEN: usize = 8;
/// How many pixels at least go through one transform after the other.
const BAND_LEN: usize = 1024;

pub(super) enum Transform {
    Predictor(Tiles),
    CrossColor(Tiles),
    SubtractGreen,
    ColorIndexing(Palette),
}

/// A pixel of parameters for each tile of the image.
pub(super) struct Tiles {
    bits: u32,
    per_row: usize,
    pixels: Vec<Rgba>,
}

pub(super) struct Palette {
    /// An index behind the last one that was stored is transparent black.
    colors: Box<[Rgba; MAX_PALETTE_LEN]>,
    /// `1 << bundle_bits` indices share the green of one pixel.
    pub(super) bundle_bits: u32,
}

impl Transform {
    pub(super) fn read(
        reader: &mut BitReader,
        transform_type: TransformType,
        width: usize,
        height: usize,
    ) -> Result<Self> {
        Ok(match transform_type {
            TransformType::Predictor => Self::Predictor(Tiles::read(reader, width, height)?),
            TransformType::CrossColor => Self::CrossColor(Tiles::read(reader, width, height)?),
            TransformType::SubtractGreen => Self::SubtractGreen,
            TransformType::ColorIndexing => Self::ColorIndexing(Palette::read(reader)?),
        })
    }

    /// `rows` start with row `y`. Not for a palette that bundles. The predictor needs the row above, and is left to
    /// `undo()`.
    fn undo_in_rows(&self, rows: &mut [Rgba], width: usize, y: usize) {
        match self {
            Self::Predictor(_) => {}
            Self::CrossColor(tiles) => {
                for (row, along) in rows.chunks_exact_mut(width).zip(tiles.along_rows(y)) {
                    undo_cross_color(row, along, tiles.bits);
                }
            }
            Self::SubtractGreen => {
                let (steps, rest) = rows.as_chunks_mut::<16>();
                steps.iter_mut().for_each(add_green);
                rest.as_chunks_mut::<1>().0.iter_mut().for_each(add_green);
            }
            Self::ColorIndexing(palette) => {
                for pixel in rows {
                    let [_, index, ..] = *pixel;
                    *pixel = *palette.colors.at(index.into());
                }
            }
        }
    }
}

/// Undoes `transforms`, the last one first, none of which changes the width.
pub(super) fn undo(transforms: &[Transform], pixels: &mut [Rgba], width: usize) {
    let width = width.max(1);
    let undo_in_rows = |transforms: &[Transform], rows: &mut [Rgba], y| {
        for transform in transforms.iter().rev() {
            transform.undo_in_rows(rows, width, y);
        }
    };
    let band_height = BAND_LEN.div_ceil(width);
    let bands = pixels.chunks_mut(band_height * width);
    let bands = bands.zip((0..).step_by(band_height));
    let mut around = transforms.split_inclusive(|it| matches!(it, Transform::Predictor(_)));
    let Some(earlier @ [.., Transform::Predictor(modes)]) = around.next() else {
        return bands.for_each(|(band, y)| undo_in_rows(transforms, band, y));
    };
    let later = around.next().unwrap_or_default();
    // A band stays as the predictor left it until the one below has been predicted from it.
    let (mut band_above, mut y_above): (&mut [Rgba], _) = (&mut [], 0);
    for (band, y) in bands {
        undo_in_rows(later, band, y);
        let mut above = band_above.rchunks_exact(width).next();
        for (row, along) in band.chunks_exact_mut(width).zip(modes.along_rows(y)) {
            match above {
                Some(above) => undo_prediction(row, above, along, modes.bits),
                None => add_up(row, BLACK.to_le_bytes()),
            }
            above = Some(row);
        }
        undo_in_rows(earlier, band_above, y_above);
        (band_above, y_above) = (band, y);
    }
    undo_in_rows(earlier, band_above, y_above);
}

impl Tiles {
    fn read(reader: &mut BitReader, width: usize, height: usize) -> Result<Self> {
        let bits = MIN_TILE_BITS + reader.read(TILE_BITS_BITS);
        let per_row = subsampled(width, bits);
        Ok(Self {
            bits,
            per_row,
            pixels: pixels::read_subimage(reader, per_row, subsampled(height, bits))?,
        })
    }

    /// For each row of the image from `first` on, the tiles that it goes through.
    fn along_rows(&self, first: usize) -> impl Iterator<Item = &[Rgba]> {
        (first..).map_while(|y| {
            let start = (y >> self.bits) * self.per_row;
            known(self.pixels.get(start..start + self.per_row))
        })
    }
}

impl Palette {
    fn read(reader: &mut BitReader) -> Result<Self> {
        let len = reader.read(8) as usize + 1;
        let mut stored = pixels::read_subimage(reader, len, 1)?;
        // Each is stored as the difference from the one before.
        add_up(&mut stored, [0; 4]);
        let mut colors: Box<[_; _]> = vec::array([0; 4])?;
        slice::copy(&stored, &mut *colors);
        Ok(Self {
            colors,
            bundle_bits: bundle_bits(len),
        })
    }

    /// For looking up what `keep` keeps of each color.
    pub(super) fn lookup<T: Copy + Default>(
        &self,
        width: usize,
        keep: impl Fn(Rgba) -> T,
    ) -> Result<Lookup<T>> {
        let bundle_bits = if width == 1 { 0 } else { self.bundle_bits };
        let per_byte = 1 << bundle_bits;
        let index_bits = 8 >> self.bundle_bits;
        let first = |byte: usize| keep(*self.colors.at(byte & ((1 << index_bits) - 1)));
        let mut table = vec::filled(first(0), 256 * per_byte + MAX_BUNDLE_LEN)?;
        for byte in 1..256 {
            table.set(byte * per_byte, first(byte));
            if per_byte > 1 {
                // The other indices are those of a lower byte. What is too much is overwritten.
                let others: [_; MAX_BUNDLE_LEN] = table.chunk((byte >> index_bits) * per_byte);
                table.set_chunk(byte * per_byte + 1, others);
            }
        }
        Ok(Lookup { table, bundle_bits })
    }
}

/// For each byte, the colors that the indices in it stand for.
pub(super) struct Lookup<T> {
    table: Vec<T>,
    pub(super) bundle_bits: u32,
}

impl<T: Copy> Lookup<T> {
    /// All colors of the bundles, the unused ones of the last in a row too. `to` has room for them.
    pub(super) fn append<B>(&self, coded: &[B], bundle: impl Fn(&B) -> u8, to: &mut Vec<T>) {
        match self.bundle_bits {
            0 => self.append_by::<B, 1>(coded, bundle, to),
            1 => self.append_by::<B, 2>(coded, bundle, to),
            2 => self.append_by::<B, 4>(coded, bundle, to),
            _ => self.append_by::<B, MAX_BUNDLE_LEN>(coded, bundle, to),
        }
    }

    fn append_by<B, const N: usize>(
        &self,
        coded: &[B],
        bundle: impl Fn(&B) -> u8,
        to: &mut Vec<T>,
    ) {
        let table = self.table.as_chunks::<N>().0.first_chunk::<256>();
        if let Some(table) = known(table) {
            to.extend(coded.iter().flat_map(|it| *table.at(bundle(it).into())));
        }
    }
}

/// Written so that an `N` of 16 becomes additions of vectors of bytes.
#[inline(always)]
fn add_green<const N: usize>(pixels: &mut [Rgba; N]) {
    let greens = pixels.map(|[_, green, ..]| [green, 0, green, 0]);
    let bytes = pixels.as_flattened_mut().iter_mut();
    for (byte, green) in bytes.zip(greens.as_flattened()) {
        *byte = byte.wrapping_add(*green);
    }
}

/// Adds to each pixel the one before it, channel by channel.
fn add_up(pixels: &mut [Rgba], mut before: Rgba) {
    for pixel in pixels {
        for (channel, before) in pixel.iter_mut().zip(&mut before) {
            *channel = channel.wrapping_add(*before);
            *before = *channel;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;

    #[test]
    fn nothing_is_looked_up_without_a_table() {
        let lookup = Lookup::<u8> {
            table: Vec::new(),
            bundle_bits: 0,
        };
        let found = slice::checked(|| {
            lookup.append(&[0], |&bundle| bundle, &mut Vec::new());
            Ok(())
        });
        assert_eq!(found, Err(Error::Internal));
    }
}
