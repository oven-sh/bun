//! What `bun_deflate::format` does not have.

use bun_deflate::format::{
    FIRST_LENGTH_SYMBOL, LITLEN_SYMBOLS, OFFSET_SYMBOLS, RESERVED_SYMBOLS, repeat_slot,
};
use bun_deflate::gzip::MAGIC_AND_METHOD;

pub(crate) const MIN_WINDOW_BITS: u8 = 8;
pub(crate) const MAX_WINDOW_BITS: u8 = 15;

pub const GZIP_ID: [u8; 2] = [MAGIC_AND_METHOD[0], MAGIC_AND_METHOD[1]];
/// The only compression method of both containers.
pub(crate) const DEFLATE_METHOD: u8 = MAGIC_AND_METHOD[2];
pub(crate) const ZLIB_PRESET_DICTIONARY: u8 = 0x20;
pub(crate) const ZLIB_HEADER_DIVISOR: u16 = 31;

pub(crate) const MAX_STORED_LEN: usize = u16::MAX as usize;

pub(crate) const LITERAL_LENGTH_SYMBOLS: usize = LITLEN_SYMBOLS - RESERVED_SYMBOLS;
pub(crate) const LENGTH_SYMBOLS: usize = LITERAL_LENGTH_SYMBOLS - FIRST_LENGTH_SYMBOL;
pub(crate) const DISTANCE_SYMBOLS: usize = OFFSET_SYMBOLS - RESERVED_SYMBOLS;

/// A code length symbol that stands for a run of lengths.
pub(crate) struct Repeat {
    pub(crate) symbol: u8,
    pub(crate) min: u32,
    pub(crate) extra_bits: u32,
}

impl Repeat {
    const fn new(symbol: u8) -> Self {
        let slot = repeat_slot(symbol as usize);
        Self {
            symbol,
            min: slot.base,
            extra_bits: slot.extra_bits,
        }
    }

    pub(crate) const fn max(&self) -> u32 {
        self.min + (1 << self.extra_bits) - 1
    }
}

pub(crate) const REPEAT_PREVIOUS: Repeat = Repeat::new(16);
pub(crate) const REPEAT_FEW_ZEROS: Repeat = Repeat::new(17);
pub(crate) const REPEAT_MANY_ZEROS: Repeat = Repeat::new(18);

/// Huffman codes are packed starting with their most significant bit, unlike everything else.
#[inline(always)]
pub(crate) const fn reversed(code: u16, bits: u32) -> u16 {
    code.reverse_bits().wrapping_shr(u16::BITS - bits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeats_are_those_of_rfc_1951() {
        let runs = [16, 17, 18].map(Repeat::new).map(|it| it.min..=it.max());
        assert_eq!(runs, [3..=6, 3..=10, 11..=138]);
    }
}
