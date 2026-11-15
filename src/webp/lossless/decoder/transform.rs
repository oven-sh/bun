//! What was done to the pixels to make them compress better, and how it is undone.

use bun_highway::webp::{undo_cross_color, undo_prediction};

use super::Rgba;
use super::bit_reader::BitReader;
use super::pixels;
use crate::array::At;
use crate::error::{Error, Result};
use crate::lossless::{
    BLACK, MAX_PALETTE_LEN, MIN_TILE_BITS, TILE_BITS_BITS, TransformType, bundle_bits, subsampled,
};
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
    /// `MAX_PALETTE_LEN` of them. An index behind the last one that was stored is transparent black.
    colors: Vec<Rgba>,
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

    /// For all but the predictor, which needs the row above, and a palette that bundles. `rows` start with row `y`.
    fn undo_in_rows(&self, rows: &mut [Rgba], width: usize, y: usize) -> Result<()> {
        match self {
            Self::CrossColor(tiles) => {
                for (row, y) in rows.chunks_exact_mut(width).zip(y..) {
                    undo_cross_color(row, tiles.row(y)?, tiles.bits);
                }
            }
            Self::SubtractGreen => add_green(rows),
            Self::ColorIndexing(palette) => {
                let colors = palette.colors()?;
                for pixel in rows {
                    let [_, index, ..] = *pixel;
                    *pixel = *colors.at(index.into());
                }
            }
            Self::Predictor(_) => return Err(Error::Internal),
        }
        Ok(())
    }
}

/// Undoes `transforms`, the last one first, none of which changes the width.
pub(super) fn undo(transforms: &[Transform], pixels: &mut [Rgba], width: usize) -> Result<()> {
    let width = width.max(1);
    let undo_in_rows = |transforms: &[Transform], rows: &mut [Rgba], y| {
        let mut transforms = transforms.iter().rev();
        transforms.try_for_each(|transform| transform.undo_in_rows(rows, width, y))
    };
    let band_height = BAND_LEN.div_ceil(width);
    let bands = pixels.chunks_mut(band_height * width);
    let mut bands = bands.zip((0..).step_by(band_height));
    let mut around = transforms.split_inclusive(|it| matches!(it, Transform::Predictor(_)));
    let Some([earlier @ .., Transform::Predictor(modes)]) = around.next() else {
        return bands.try_for_each(|(band, y)| undo_in_rows(transforms, band, y));
    };
    let later = around.next().unwrap_or_default();
    // A band stays as the predictor left it until the one below has been predicted from it.
    let (mut band_above, mut y_above): (&mut [Rgba], _) = (&mut [], 0);
    for (band, y) in bands {
        undo_in_rows(later, band, y)?;
        let mut above = band_above.rchunks_exact(width).next();
        for (row, y) in band.chunks_exact_mut(width).zip(y..) {
            match above {
                Some(above) => undo_prediction(row, above, modes.row(y)?, modes.bits),
                None => add_up(row, BLACK.to_le_bytes()),
            }
            above = Some(row);
        }
        undo_in_rows(earlier, band_above, y_above)?;
        (band_above, y_above) = (band, y);
    }
    undo_in_rows(earlier, band_above, y_above)
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

    /// The tiles that row `y` of the image goes through.
    fn row(&self, y: usize) -> Result<&[Rgba]> {
        let start = (y >> self.bits) * self.per_row;
        let row = self.pixels.get(start..start + self.per_row);
        row.ok_or(Error::Internal)
    }
}

impl Palette {
    fn read(reader: &mut BitReader) -> Result<Self> {
        let len = reader.read(8) as usize + 1;
        let mut colors = pixels::read_subimage(reader, len, 1)?;
        // Each is stored as the difference from the one before.
        add_up(&mut colors, [0; 4]);
        colors.try_reserve_exact(MAX_PALETTE_LEN - len)?;
        colors.resize(MAX_PALETTE_LEN, [0; 4]);
        Ok(Self {
            colors,
            bundle_bits: bundle_bits(len),
        })
    }

    fn colors(&self) -> Result<&[Rgba; MAX_PALETTE_LEN]> {
        self.colors.first_chunk().ok_or(Error::Internal)
    }

    /// For looking up what `keep` keeps of each color.
    pub(super) fn lookup<T: Copy + Default>(&self, keep: impl Fn(Rgba) -> T) -> Result<Lookup<T>> {
        let colors = self.colors()?;
        let per_byte = 1 << self.bundle_bits;
        let index_bits = 8 >> self.bundle_bits;
        let mut table = vec::with_room(256 * per_byte)?;
        for byte in 0..256usize {
            let index = |i| (byte >> (i * index_bits)) & ((1 << index_bits) - 1);
            table.extend((0..per_byte).map(|i| keep(*colors.at(index(i)))));
        }
        Ok(Lookup {
            table,
            bundle_bits: self.bundle_bits,
        })
    }
}

/// For each byte, the colors that the indices in it stand for.
pub(super) struct Lookup<T> {
    table: Vec<T>,
    bundle_bits: u32,
}

impl<T: Copy> Lookup<T> {
    /// All colors of the bundles, the unused ones of the last in a row too. `to` has room for them.
    pub(super) fn append<B>(
        &self,
        coded: &[B],
        bundle: impl Fn(&B) -> u8,
        to: &mut Vec<T>,
    ) -> Result<()> {
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
    ) -> Result<()> {
        let table = self.table.as_chunks::<N>().0.first_chunk::<256>();
        let table = table.ok_or(Error::Internal)?;
        to.extend(coded.iter().flat_map(|it| *table.at(bundle(it).into())));
        Ok(())
    }
}

fn add_green(row: &mut [Rgba]) {
    for pixel in row {
        let rgba = u32::from_le_bytes(*pixel);
        let green = (rgba >> 8) & 0xff;
        let red_blue = (rgba & 0x00ff_00ff) + (green << 16 | green);
        *pixel = (rgba & 0xff00_ff00 | red_blue & 0x00ff_00ff).to_le_bytes();
    }
}

/// Adds to each pixel the one before it, channel by channel.
fn add_up(pixels: &mut [Rgba], mut before: Rgba) {
    for pixel in pixels {
        before = core::array::from_fn(|i| pixel.at(i).wrapping_add(*before.at(i)));
        *pixel = before;
    }
}
