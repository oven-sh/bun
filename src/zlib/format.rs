//! What RFC 1950, 1951 and 1952 lay down for both directions.

pub(crate) const MIN_MATCH: usize = 3;
pub(crate) const MAX_MATCH: usize = 258;
pub(crate) const MIN_WINDOW_BITS: u8 = 8;
pub(crate) const MAX_WINDOW_BITS: u8 = 15;

/// The only compression method of both containers.
pub const DEFLATE_METHOD: u8 = 8;
pub(crate) const ZLIB_PRESET_DICTIONARY: u8 = 0x20;
pub(crate) const ZLIB_HEADER_DIVISOR: u16 = 31;
pub const GZIP_ID: [u8; 2] = [0x1f, 0x8b];

pub mod gzip_flag {
    pub const HEADER_CRC: u8 = 2;
    pub const EXTRA: u8 = 4;
    pub const NAME: u8 = 8;
    pub const COMMENT: u8 = 16;
    pub const RESERVED: u8 = 0xe0;
}

pub(crate) const STORED_BLOCK: u32 = 0;
pub(crate) const FIXED_BLOCK: u32 = 1;
pub(crate) const DYNAMIC_BLOCK: u32 = 2;

pub(crate) const MAX_STORED_LEN: usize = u16::MAX as usize;

pub(crate) const MAX_CODE_BITS: usize = 15;
pub(crate) const END_OF_BLOCK: usize = 256;
pub(crate) const FIRST_LENGTH_SYMBOL: usize = END_OF_BLOCK + 1;
pub(crate) const LENGTH_SYMBOLS: usize = 29;
pub(crate) const LITERAL_LENGTH_SYMBOLS: usize = FIRST_LENGTH_SYMBOL + LENGTH_SYMBOLS;
pub(crate) const DISTANCE_SYMBOLS: usize = 30;
/// The fixed codes have two more of each, which stand for nothing.
pub(crate) const FIXED_LITERAL_LENGTH_SYMBOLS: usize = LITERAL_LENGTH_SYMBOLS + 2;
pub(crate) const FIXED_DISTANCE_BITS: u32 = 5;

pub(crate) const CODE_LENGTH_SYMBOLS: usize = 19;
pub(crate) const MAX_CODE_LENGTH_BITS: usize = 7;
pub(crate) const CODE_LENGTH_ORDER: [u8; CODE_LENGTH_SYMBOLS] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/// A code length symbol that stands for a run of lengths.
pub(crate) struct Repeat {
    pub(crate) symbol: u8,
    pub(crate) min: u32,
    pub(crate) extra_bits: u32,
}

impl Repeat {
    pub(crate) const fn max(&self) -> u32 {
        self.min + (1 << self.extra_bits) - 1
    }
}

pub(crate) const REPEAT_PREVIOUS: Repeat = Repeat {
    symbol: 16,
    min: 3,
    extra_bits: 2,
};
pub(crate) const REPEAT_FEW_ZEROS: Repeat = Repeat {
    symbol: 17,
    min: 3,
    extra_bits: 3,
};
pub(crate) const REPEAT_MANY_ZEROS: Repeat = Repeat {
    symbol: 18,
    min: 11,
    extra_bits: 7,
};

/// The values that a length or distance symbol stands for: `base` plus a number of so many bits.
#[derive(Clone, Copy)]
pub(crate) struct Range {
    pub(crate) base: u32,
    pub(crate) extra_bits: u32,
}

/// `index` counts from `FIRST_LENGTH_SYMBOL`.
pub(crate) const fn length_range(index: u32) -> Range {
    if index as usize == LENGTH_SYMBOLS - 1 {
        return Range {
            base: MAX_MATCH as u32,
            extra_bits: 0,
        };
    }
    range(index, 2, MIN_MATCH as u32)
}

pub(crate) const fn distance_range(symbol: u32) -> Range {
    range(symbol, 1, 1)
}

/// Each `1 << group_bits` symbols have one extra bit more than those before them, but for the first two groups.
const fn range(index: u32, group_bits: u32, min: u32) -> Range {
    let group = index >> group_bits;
    if group == 0 {
        return Range {
            base: min + index,
            extra_bits: 0,
        };
    }
    let extra_bits = group - 1;
    let in_group = index - (group << group_bits);
    Range {
        base: min + (((1 << group_bits) + in_group) << extra_bits),
        extra_bits,
    }
}

pub(crate) const fn fixed_literal_length_bits(symbol: usize) -> u32 {
    match symbol {
        0..144 | 280.. => 8,
        144..256 => 9,
        256..280 => 7,
    }
}

pub(crate) const fn fixed_literal_length_code(symbol: usize) -> u16 {
    let code = match symbol {
        0..144 => 0b0011_0000 + symbol,
        144..256 => 0b1_1001_0000 + symbol - 144,
        256..280 => symbol - 256,
        280.. => 0b1100_0000 + symbol - 280,
    };
    reversed(code as u16, fixed_literal_length_bits(symbol))
}

/// Huffman codes are packed starting with their most significant bit, unlike everything else.
#[inline(always)]
pub(crate) const fn reversed(code: u16, bits: u32) -> u16 {
    code.reverse_bits().wrapping_shr(u16::BITS - bits)
}
