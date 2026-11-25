//! How often each symbol occurs in each tile.

use super::super::entropy::{self, Cost, Estimate, Population, set_bits};
use super::super::histogram::{Alphabet, BLOCK_LEN, Histogram};
use crate::array::At;
use crate::error::Result;
use crate::slice::InBounds;
use crate::vec;

const COUNT_BITS: u32 = 20;

/// A symbol and how often it occurs.
#[derive(Clone, Copy)]
pub(super) struct Entry(u32);

impl Entry {
    pub(super) const fn symbol(self) -> usize {
        (self.0 >> COUNT_BITS) as usize
    }

    pub(super) const fn count(self) -> u32 {
        self.0 & ((1 << COUNT_BITS) - 1)
    }
}

/// About the symbols of one alphabet.
#[derive(Clone, Copy, Default)]
pub(super) struct Part {
    pub(super) population: Population,
    pub(super) cost: Cost,
    pub(super) least_cost: Cost,
}

impl Part {
    pub(super) fn new(estimate: &Estimate, alphabet: Alphabet) -> Self {
        Self {
            population: estimate.population,
            cost: estimate.cost(alphabet.len),
            least_cost: estimate.population.least_cost(),
        }
    }
}

pub(super) fn cost(parts: &[Part; 5]) -> i64 {
    parts.iter().map(|part| part.cost).sum::<Cost>() as i64
}

pub(super) struct Tile {
    pub(super) parts: [Part; 5],
    /// The red, blue and alpha of all literals, if they have the same.
    pub(super) shared_by_literals: Option<[u16; 3]>,
    /// Where its entries are. A tile that copies from other tiles cover has none.
    start: usize,
    end: usize,
}

impl Tile {
    pub(super) const fn is_used(&self) -> bool {
        self.start < self.end
    }
}

/// The histogram of each tile, without the zeros.
pub(in super::super) struct TileHistograms {
    pub(super) alphabets: [Alphabet; 5],
    pub(super) tiles: Vec<Tile>,
    entries: Vec<Entry>,
}

impl TileHistograms {
    pub(in super::super) fn new(tiles: usize, cache_bits: u32) -> Result<Self> {
        Ok(Self {
            alphabets: Alphabet::all(cache_bits),
            tiles: vec::with_room(tiles)?,
            entries: Vec::new(),
        })
    }

    pub(in super::super) fn len(&self) -> usize {
        self.tiles.len()
    }

    /// Leaves `histogram` empty.
    pub(in super::super) fn push(&mut self, histogram: &mut Histogram) -> Result<()> {
        let start = self.entries.len();
        let (mut parts, mut only_symbols) = ([Part::default(); 5], [None; 5]);
        let found = parts.iter_mut().zip(&mut only_symbols);
        for (alphabet, (part, only_symbol)) in self.alphabets.into_iter().zip(found) {
            let before = self.entries.len();
            self.entries.try_reserve(alphabet.len)?;
            let blocks = alphabet.blocks().zip(histogram.blocks(alphabet.blocks()));
            let blocks = blocks.map(|(index, block)| {
                let non_zero = entropy::non_zero(block);
                let symbol = |i| (index * BLOCK_LEN + i) as u32;
                let entry = |i| Entry(symbol(i) << COUNT_BITS | *block.at(i));
                self.entries.extend(set_bits(non_zero).map(entry));
                (non_zero, |i| *block.at(i))
            });
            *part = Part::new(&Estimate::new(alphabet.len, blocks), alphabet);
            if let Some([only]) = self.entries.get(before..) {
                *only_symbol = Some(only.symbol() as u16);
            }
        }
        let shared_by_literals = match only_symbols {
            [_, Some(red), Some(blue), Some(alpha), _] => Some([red, blue, alpha]),
            _ => None,
        };
        let end = self.entries.len();
        for entry in self.entries.iter().skip(start) {
            *histogram.counts.at_mut(entry.symbol()) = 0;
        }
        self.tiles.push(Tile {
            parts,
            shared_by_literals,
            start,
            end,
        });
        Ok(())
    }

    pub(super) fn entries(&self, tile: &Tile) -> &[Entry] {
        self.entries.part(tile.start..tile.end)
    }
}
