//! What the text of a unit is made of. It is read where it is.

use crate::code::{Code, code_of};
use crate::words::{Words, take_bytes, take_number};
use core::hint::select_unpredictable;

/// An entry below `FIRST_OPERATION` is a piece of text: the offset, whether it ends the string, the length less one.
pub mod entry {
    pub const OFFSET_SHIFT: u32 = 4;
    pub const ENDS: u16 = 1 << 3;
    pub const MAX_LENGTH: usize = 8;
    pub const FIRST_OPERATION: u16 = 0xff00;
}

/// The cell of a model has the fields in this order.
pub struct Model<'a> {
    /// A bit for each class of leaves that the unit does not have.
    pub(crate) lacks: u64,
    /// If not 0, it has been left out before each trail surrogate.
    pub(crate) lead: u16,
    pub map: Map<'a>,
    /// For the entry that begins a string, and for the others.
    pub(crate) codes: [Code; 2],
    /// The entries, then the text. It extends beyond the cell.
    pub(crate) words: Words<'a>,
}

/// Maps a character of the unit that a unit refers to, to the one that usually takes its place.
#[derive(Clone, Copy, Default)]
pub struct Map<'a> {
    pub multiplier: u16,
    pub pairs: &'a [[[u8; 2]; 2]],
}

impl Map<'_> {
    /// The index of the only pair that can begin with `unit`.
    #[inline]
    pub fn index_of(multiplier: u16, pairs: usize, unit: u16) -> usize {
        (usize::from(unit.wrapping_mul(multiplier)) * pairs) >> 16
    }

    #[inline(never)]
    pub fn apply(&self, text: &mut [u16]) {
        for unit in text {
            let index = Self::index_of(self.multiplier, self.pairs.len(), *unit);
            let Some(&[from, to]) = self.pairs.get(index) else {
                return;
            };
            let (from, to) = (u16::from_le_bytes(from), u16::from_le_bytes(to));
            *unit = select_unpredictable(from == *unit, to, *unit);
        }
    }
}

impl<'a> Model<'a> {
    pub fn new(mut cell: &'a [u8]) -> Self {
        let lacks = take_bytes(&mut cell, 8).first_chunk().copied();
        let [lead, multiplier, pairs] = [0; 3].map(|_| take_number(&mut cell));
        let pairs = take_bytes(&mut cell, 4 * pairs).as_chunks().0.as_chunks().0;
        let first_values = [0, take_number(&mut cell)];
        let codes = first_values.map(|first_value| {
            let lengths = take_number(&mut cell);
            code_of(take_bytes(&mut cell, lengths), first_value)
        });
        Self {
            lacks: u64::from_le_bytes(lacks.unwrap_or_default()),
            lead: lead as u16,
            map: Map {
                multiplier: multiplier as u16,
                pairs,
            },
            codes,
            words: Words::of(cell),
        }
    }
}
