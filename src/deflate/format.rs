//! What RFC 1951 defines.

use crate::wrapped;

pub const STORED: u32 = 0;
pub const STATIC: u32 = 1;
pub const DYNAMIC: u32 = 2;

pub const MIN_MATCH_LEN: usize = 3;
pub const MAX_MATCH_LEN: usize = 258;

pub const PRECODE_SYMBOLS: usize = 19;
pub const LITLEN_SYMBOLS: usize = 288;
pub const OFFSET_SYMBOLS: usize = 32;
/// How many symbols at the end of either code have static codewords but no meaning.
pub const RESERVED_SYMBOLS: usize = 2;

pub const END_OF_BLOCK: usize = 256;
pub const FIRST_LENGTH_SYMBOL: usize = 257;

pub const MAX_PRECODE_LEN: u32 = 7;
pub const MAX_CODEWORD_LEN: u32 = 15;

/// The order in which a header lists the lengths of the precode's codewords.
pub const PRECODE_ORDER: [u8; PRECODE_SYMBOLS] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/// The numbers from `base` on that `extra_bits` more bits tell apart.
#[derive(Clone, Copy)]
pub struct Slot {
    pub base: u32,
    pub extra_bits: u32,
}

/// For symbol `FIRST_LENGTH_SYMBOL + index`.
pub const fn length_slot(index: usize) -> Slot {
    match index as u32 {
        index @ ..28 => geometric_slot(index, 2, MIN_MATCH_LEN as u32),
        _ => Slot {
            base: MAX_MATCH_LEN as u32,
            extra_bits: 0,
        },
    }
}

pub const fn offset_slot(symbol: usize) -> Slot {
    geometric_slot(symbol as u32, 1, 1)
}

/// Every `1 << group_bits` slots, from the third group on, slots are twice as wide.
const fn geometric_slot(index: u32, group_bits: u32, first: u32) -> Slot {
    let group_len = 1 << group_bits;
    let extra_bits = (index / group_len).saturating_sub(1);
    let base = match index / group_len {
        0 => index,
        _ => (group_len + index % group_len) << extra_bits,
    };
    Slot {
        base: first + base,
        extra_bits,
    }
}

/// How often precode symbol 16 repeats the previous length, and 17 or 18 repeat zero. The others stand for themselves.
pub const fn repeat_slot(symbol: usize) -> Slot {
    let (base, extra_bits) = match symbol {
        16 => (3, 2),
        17 => (3, 3),
        18 => (11, 7),
        _ => (1, 0),
    };
    Slot { base, extra_bits }
}

/// A codeword with its first bit lowest, as it is in the stream.
#[derive(Clone, Copy, Default)]
pub struct Codeword {
    pub bits: u32,
    pub len: u32,
}

pub const fn static_litlen_codeword(symbol: usize) -> Codeword {
    let (first_symbol, first_code, len) = match symbol {
        ..144 => (0, 0b0011_0000, 8),
        144..256 => (144, 0b1_1001_0000, 9),
        256..280 => (256, 0, 7),
        _ => (280, 0b1100_0000, 8),
    };
    let code = first_code + (symbol - first_symbol) as u32;
    Codeword {
        bits: code.reverse_bits() >> (32 - len),
        len,
    }
}

pub const fn static_offset_codeword(symbol: usize) -> Codeword {
    Codeword {
        bits: (symbol as u32).reverse_bits() >> (32 - 5),
        len: 5,
    }
}

/// For each length less [`MIN_MATCH_LEN`].
static LENGTH_SLOTS: [u8; 256] = table!(|len| match len {
    255 => 28,
    _ => geometric_index(len as u32, 2),
});
/// For each offset less 1.
static NEAR_OFFSET_SLOTS: [u8; 256] = table!(|offset| geometric_index(offset as u32, 1));

/// The inverse of [`geometric_slot`].
const fn geometric_index(distance: u32, group_bits: u32) -> u8 {
    let extra_bits = (distance | 1).ilog2().saturating_sub(group_bits);
    ((extra_bits << group_bits) + (distance >> extra_bits)) as u8
}

#[inline(always)]
pub const fn length_slot_of(len: usize) -> usize {
    *wrapped(&LENGTH_SLOTS, len - MIN_MATCH_LEN) as usize
}

#[inline(always)]
pub fn offset_slot_of(offset: usize) -> usize {
    // Fourteen slots on, slots are 128 times as wide.
    let shift = (256u32.wrapping_sub(offset as u32) >> 29) as usize;
    let near = offset.wrapping_sub(1) >> shift;
    usize::from(*wrapped(&NEAR_OFFSET_SLOTS, near)) + 2 * shift
}
