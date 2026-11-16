//! The five prefix codes that a pixel is read with, and which five are for which tile of the image.

use core::hint::select_unpredictable;

use super::Rgba;
use super::bit_reader::BitReader;
use super::huffman::{Code, CodeLengths, Entry};
use super::pixels;
use crate::array::At;
use crate::error::{Error, Result};
use crate::lossless::{
    DISTANCE_CODES, IMAGE_SIZE_BITS, LENGTH_CODES, LITERAL_CODES, MIN_TILE_BITS, TILE_BITS_BITS,
    subsampled,
};
use crate::slice::{InBounds, known};
use crate::vec;

/// Up to how many bits all of a pixel is looked up at once.
const PACKED_BITS: u32 = 6;

pub(super) struct Group {
    /// Also has the lengths of copies and the keys of the color cache.
    pub(super) green: Code,
    pub(super) red: Code,
    pub(super) blue: Code,
    pub(super) alpha: Code,
    pub(super) distance: Code,
    /// Where the tables for the codes longer than `ROOT_BITS` start in `Groups::second_tables`.
    second_tables: usize,
    pub(super) shortcut: Shortcut,
    /// With the channels that have one symbol, and zeros for the others.
    pub(super) constant: Rgba,
    packed: [Packed; 1 << PACKED_BITS],
}

#[derive(PartialEq, Eq)]
pub(super) enum Shortcut {
    None,
    ConstantAlpha,
    /// All but green are constant.
    GreenOnly,
    /// See `Group::packed()`.
    Packed,
    /// Every pixel is `Group::constant`, at no cost in bits.
    Constant,
}

#[derive(Clone, Copy)]
pub(super) struct Packed {
    pub(super) pixel: Rgba,
    /// Green's symbol if that is not a literal, and then there is no `pixel`. Otherwise 0.
    pub(super) symbol: u16,
    pub(super) len: u8,
}

impl Group {
    const EMPTY: Self = Self {
        green: Code::EMPTY,
        red: Code::EMPTY,
        blue: Code::EMPTY,
        alpha: Code::EMPTY,
        distance: Code::EMPTY,
        second_tables: 0,
        shortcut: Shortcut::None,
        constant: [0; 4],
        packed: [Packed {
            pixel: [0; 4],
            symbol: 0,
            len: 0,
        }; 1 << PACKED_BITS],
    };

    fn codes_mut(&mut self) -> [&mut Code; 5] {
        [
            &mut self.green,
            &mut self.red,
            &mut self.blue,
            &mut self.alpha,
            &mut self.distance,
        ]
    }

    fn find_shortcut(&mut self) {
        let channels = [&self.red, &self.green, &self.blue, &self.alpha];
        let [red, green, blue, alpha] = channels.map(|code| code.max_len);
        self.constant = channels.map(|code| match code.max_len {
            0 => code.short(0).value() as u8,
            _ => 0,
        });
        let total = red + green + blue + alpha;
        self.shortcut = if total == 0 && self.green.short(0).value() < LITERAL_CODES {
            Shortcut::Constant
        } else if total == green {
            Shortcut::GreenOnly
        } else if total <= PACKED_BITS {
            Shortcut::Packed
        } else if alpha == 0 {
            Shortcut::ConstantAlpha
        } else {
            Shortcut::None
        };
        if self.shortcut == Shortcut::Packed {
            for (bits, packed) in self.packed.iter_mut().enumerate() {
                let green = self.green.short(bits);
                let mut len = green.len();
                if green.value() >= LITERAL_CODES {
                    packed.symbol = green.value() as u16;
                } else {
                    let [red, blue, alpha] = [&self.red, &self.blue, &self.alpha].map(|code| {
                        let entry = code.short(bits >> len);
                        len += entry.len();
                        entry.value() as u8
                    });
                    packed.pixel = [red, green.value() as u8, blue, alpha];
                }
                packed.len = len as u8;
            }
        }
    }

    #[inline(always)]
    pub(super) fn packed(&self, bits: usize) -> Packed {
        *self.packed.at(bits % self.packed.len())
    }
}

pub(super) struct Groups {
    groups: Vec<Group>,
    second_tables: Vec<Entry>,
    /// For each tile the index of its group, then up to where in a row of the image that goes on. Both have the lower
    /// byte first.
    tiles: Vec<[u8; 4]>,
    tiles_per_row: usize,
    tile_bits: u32,
}

impl Groups {
    /// One for all of the image.
    pub(super) fn read_one(reader: &mut BitReader, cache_bits: u32) -> Result<Self> {
        let tiles = vec::filled([0; 4], 1)?;
        let (groups, second_tables) = read_groups(reader, cache_bits, &[Some(0)])?;
        Ok(Self {
            groups,
            second_tables,
            tiles,
            tiles_per_row: 1,
            tile_bits: IMAGE_SIZE_BITS,
        })
    }

    /// Those of the entropy image, which comes first.
    pub(super) fn read_many(
        reader: &mut BitReader,
        cache_bits: u32,
        width: usize,
        height: usize,
    ) -> Result<Self> {
        let tile_bits = MIN_TILE_BITS + reader.read(TILE_BITS_BITS);
        let tiles_per_row = subsampled(width, tile_bits);
        let rows = subsampled(height, tile_bits);
        let mut tiles = pixels::read_subimage(reader, tiles_per_row, rows)?;
        let kept_index = index_used(&tiles)?;
        let (groups, second_tables) = read_groups(reader, cache_bits, &kept_index)?;
        for row in tiles.chunks_exact_mut(tiles_per_row.max(1)) {
            let (mut end, mut next_group) = (0, usize::MAX);
            for (column, tile) in row.iter_mut().enumerate().rev() {
                let group = usize::from(group_of(*tile));
                let own_end = width.min((column + 1) << tile_bits);
                end = select_unpredictable(group == next_group, end, own_end);
                next_group = group;
                let index = known(kept_index.value(group)).unwrap_or_default();
                *tile = (u32::from(index) | (end as u32) << 16).to_le_bytes();
            }
        }
        Ok(Self {
            groups,
            second_tables,
            tiles,
            tiles_per_row,
            tile_bits,
        })
    }

    /// The group of the pixel with its second tables, and for how many pixels from there on, unless the image ends.
    #[inline(always)]
    pub(super) fn at(&self, x: usize, y: usize, width: usize) -> Result<(&Group, &[Entry], usize)> {
        let (column, row) = (x >> self.tile_bits, y >> self.tile_bits);
        let tile = self.tiles.get(row * self.tiles_per_row + column);
        let tile = tile.map(|&it| u32::from_le_bytes(it) as usize);
        let found = tile.and_then(|it| self.groups.get(it & 0xffff).zip(Some(it >> 16)));
        let (group, run_end) = found.ok_or(Error::Internal)?;
        let end = match self.tiles_per_row {
            1 => (((row + 1) << self.tile_bits) - y) * width,
            _ => run_end,
        };
        let tables = self.second_tables.part(group.second_tables..);
        Ok((group, tables, end - x))
    }
}

#[inline(always)]
fn group_of([upper, lower, ..]: Rgba) -> u16 {
    u16::from_be_bytes([upper, lower])
}

/// For each group that is stored, its index among those that a tile refers to.
fn index_used(tiles: &[Rgba]) -> Result<Vec<Option<u16>>> {
    let highest = tiles.iter().map(|&it| group_of(it)).max();
    let mut kept_index = vec::filled(None, highest.map_or(0, |it| usize::from(it) + 1))?;
    for &tile in tiles {
        kept_index.set(group_of(tile).into(), Some(0));
    }
    for (index, kept) in (0..=u16::MAX).zip(kept_index.iter_mut().flatten()) {
        *kept = index;
    }
    Ok(kept_index)
}

fn read_groups(
    reader: &mut BitReader,
    cache_bits: u32,
    kept_index: &[Option<u16>],
) -> Result<(Vec<Group>, Vec<Entry>)> {
    let cache_len = if cache_bits > 0 { 1 << cache_bits } else { 0 };
    let alphabet_lens = [
        LITERAL_CODES + LENGTH_CODES + cache_len,
        LITERAL_CODES,
        LITERAL_CODES,
        LITERAL_CODES,
        DISTANCE_CODES,
    ];
    let mut lengths = CodeLengths::new(alphabet_lens[0])?;
    let mut groups = vec::with_room(kept_index.iter().flatten().count())?;
    let mut second_tables = Vec::new();
    for kept in kept_index {
        if kept.is_none() {
            for alphabet_len in alphabet_lens {
                lengths.read(reader, alphabet_len)?;
            }
            continue;
        }
        let group = groups.push_mut(Group::EMPTY);
        let first = second_tables.len();
        group.second_tables = first;
        for (code, alphabet_len) in group.codes_mut().into_iter().zip(alphabet_lens) {
            lengths.read(reader, alphabet_len)?;
            lengths.build(code, &mut second_tables, first)?;
        }
        group.find_shortcut();
    }
    Ok((groups, second_tables))
}
