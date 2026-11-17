//! A literal or a match, as it is kept until the block is written.

use crate::array::At;
use crate::format::{
    DISTANCE_SYMBOLS, LENGTH_SYMBOLS, MAX_MATCH, MIN_MATCH, distance_range, length_range,
};

const MATCH_LENGTHS: usize = MAX_MATCH - MIN_MATCH + 1;

/// By the length less 3. Counts from `FIRST_LENGTH_SYMBOL`.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
pub(super) static LENGTH_SYMBOL: [u8; MATCH_LENGTHS] = {
    let mut symbols = [0; _];
    let mut symbol = 0;
    while symbol < LENGTH_SYMBOLS as u32 {
        let range = length_range(symbol);
        let mut extra = 0;
        while extra < 1 << range.extra_bits {
            symbols[(range.base + extra) as usize - MIN_MATCH] = symbol as u8;
            extra += 1;
        }
        symbol += 1;
    }
    symbols
};

const fn distance_symbol_index(distance_less_one: u32) -> usize {
    if distance_less_one < 256 {
        distance_less_one as usize
    } else {
        256 + (distance_less_one >> 7) as usize
    }
}

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static DISTANCE_SYMBOL: [u8; 512] = {
    let mut symbols = [0; _];
    let mut symbol = 0;
    while symbol < DISTANCE_SYMBOLS as u32 {
        let range = distance_range(symbol);
        let mut extra = 0;
        while extra < 1 << range.extra_bits {
            symbols[distance_symbol_index(range.base - 1 + extra)] = symbol as u8;
            extra += 1;
        }
        symbol += 1;
    }
    symbols
};

/// From the lowest bit: a literal or 256 plus the length less 3 (9 bits), the distance symbol (5), the distance less
/// one.
#[derive(Clone, Copy)]
pub(super) struct Symbol(u32);

impl Symbol {
    const NO_DISTANCE: u32 = 31;

    #[inline(always)]
    pub(super) fn for_literal(byte: u8) -> Self {
        Self(Self::NO_DISTANCE << 9 | u32::from(byte))
    }

    #[inline(always)]
    pub(super) fn for_match(distance: u32, len: u32) -> Self {
        debug_assert!((MIN_MATCH..=MAX_MATCH).contains(&(len as usize)));
        let distance = distance - 1;
        let symbol = *DISTANCE_SYMBOL.at(distance_symbol_index(distance));
        Self(distance << 14 | u32::from(symbol) << 9 | (256 + len - MIN_MATCH as u32))
    }

    #[inline(always)]
    pub(super) fn literal(self) -> Option<u8> {
        (self.0 & 256 == 0).then_some(self.0 as u8)
    }

    #[inline(always)]
    pub(super) fn literal_or_length(self) -> usize {
        self.0 as usize % 512
    }

    #[inline(always)]
    pub(super) fn distance_symbol(self) -> usize {
        (self.0 as usize >> 9) % 32
    }

    #[inline(always)]
    pub(super) fn distance_less_one(self) -> u32 {
        self.0 >> 14
    }

    /// Of a match. Counts from `FIRST_LENGTH_SYMBOL`, and is below 32.
    #[inline(always)]
    pub(super) fn length_symbol(self) -> usize {
        usize::from(LENGTH_SYMBOL.at(self.literal_or_length() % MATCH_LENGTHS) % 32)
    }
}
