//! A literal or a match, as it is kept until the block is written.

use bun_deflate::format::{MAX_MATCH_LEN, MIN_MATCH_LEN, length_slot_of, offset_slot_of};

/// The lowest 9 bits are a literal, or 256 plus the length less 3.
#[derive(Clone, Copy)]
pub(super) struct Symbol(u32);

impl Symbol {
    const DISTANCE_SYMBOL_SHIFT: u32 = 9;
    const DISTANCE_SHIFT: u32 = Self::DISTANCE_SYMBOL_SHIFT + 5;
    const NO_DISTANCE: u32 = 31;

    #[inline(always)]
    pub(super) fn for_literal(byte: u8) -> Self {
        Self(Self::NO_DISTANCE << Self::DISTANCE_SYMBOL_SHIFT | u32::from(byte))
    }

    #[inline(always)]
    pub(super) fn for_match(distance: u32, len: u32) -> Self {
        debug_assert!((MIN_MATCH_LEN..=MAX_MATCH_LEN).contains(&(len as usize)));
        let symbol = offset_slot_of(distance as usize) as u32;
        Self(
            (distance - 1) << Self::DISTANCE_SHIFT
                | symbol << Self::DISTANCE_SYMBOL_SHIFT
                | (256 + len - MIN_MATCH_LEN as u32),
        )
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
        (self.0 as usize >> Self::DISTANCE_SYMBOL_SHIFT) % 32
    }

    #[inline(always)]
    pub(super) fn distance_less_one(self) -> u32 {
        self.0 >> Self::DISTANCE_SHIFT
    }

    /// Of a match. Counts from `FIRST_LENGTH_SYMBOL`, and is below 32.
    #[inline(always)]
    pub(super) fn length_symbol(self) -> usize {
        length_slot_of(usize::from(self.0 as u8) + MIN_MATCH_LEN) % 32
    }
}
