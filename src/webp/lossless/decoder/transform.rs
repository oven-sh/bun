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

    /// For all but the predictor, which needs the row above, and a palette that bundles.
    fn undo_in_row(&self, row: &mut [Rgba], y: usize) -> Result<()> {
        match self {
            Self::CrossColor(tiles) => undo_cross_color(row, tiles.row(y)?, tiles.bits),
            Self::SubtractGreen => add_green(row),
            Self::ColorIndexing(palette) => {
                let colors = palette.colors()?;
                for pixel in row {
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
    let undo_in_row = |transforms: &[Transform], row: &mut [Rgba], y| {
        let mut transforms = transforms.iter().rev();
        transforms.try_for_each(|transform| transform.undo_in_row(row, y))
    };
    let mut rows = pixels.chunks_exact_mut(width.max(1)).enumerate();
    let mut around = transforms.split_inclusive(|it| matches!(it, Transform::Predictor(_)));
    let Some([earlier @ .., Transform::Predictor(modes)]) = around.next() else {
        return rows.try_for_each(|(y, row)| undo_in_row(transforms, row, y));
    };
    let later = around.next().unwrap_or_default();
    // A row stays as the predictor left it until the row below has been predicted from it.
    let (mut above_y, mut above) = rows.next().ok_or(Error::Internal)?;
    undo_in_row(later, above, above_y)?;
    add_up(above, BLACK.to_le_bytes());
    for (y, row) in rows {
        undo_in_row(later, row, y)?;
        undo_prediction(row, above, modes.row(y)?, modes.bits);
        undo_in_row(earlier, above, above_y)?;
        (above_y, above) = (y, row);
    }
    undo_in_row(earlier, above, above_y)
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
    pub(super) fn fill_row(&self, bundles: impl Iterator<Item = u8>, row: &mut [T]) -> Result<()> {
        match self.bundle_bits {
            0 => self.fill_row_by::<1>(bundles, row),
            1 => self.fill_row_by::<2>(bundles, row),
            2 => self.fill_row_by::<4>(bundles, row),
            _ => self.fill_row_by::<8>(bundles, row),
        }
    }

    fn fill_row_by<const N: usize>(
        &self,
        mut bundles: impl Iterator<Item = u8>,
        row: &mut [T],
    ) -> Result<()> {
        let table = self.table.as_chunks::<N>().0.first_chunk::<256>();
        let table = table.ok_or(Error::Internal)?;
        let (whole, rest) = row.as_chunks_mut::<N>();
        for (colors, bundle) in whole.iter_mut().zip(&mut bundles) {
            *colors = *table.at(bundle.into());
        }
        if let Some(bundle) = bundles.next() {
            let colors = table.at(bundle.into());
            rest.iter_mut()
                .zip(colors)
                .for_each(|(to, from)| *to = *from);
        }
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
