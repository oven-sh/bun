//! The fixed codes, and what symbols take besides their codewords.

use bun_highway::deflate::{Codes, Frequencies};

use crate::format::{
    Codeword, END_OF_BLOCK, FIRST_LENGTH_SYMBOL, LITLEN_SYMBOLS, MIN_MATCH_LEN, length_slot,
    length_slot_of, offset_slot, static_litlen_codeword, static_offset_codeword,
};

fn sum(frequencies: &[u16]) -> u32 {
    frequencies.iter().copied().map(u32::from).sum()
}

/// Of lengths and distances.
pub(super) fn extra_bits(frequencies: &Frequencies) -> u32 {
    let of_groups = |frequencies: &[u16], len| -> u32 {
        let groups = (1..).zip(frequencies.chunks_exact(len));
        groups.map(|(bits, group)| bits * sum(group)).sum()
    };
    of_groups(
        &frequencies[FIRST_LENGTH_SYMBOL + 8..FIRST_LENGTH_SYMBOL + 28],
        4,
    ) + of_groups(&frequencies[LITLEN_SYMBOLS + 4..], 2)
}

/// Of the codewords.
pub(super) fn fixed_bits(frequencies: &Frequencies) -> u32 {
    8 * sum(&frequencies[..144])
        + 9 * sum(&frequencies[144..256])
        + 7 * sum(&frequencies[256..280])
        + 8 * sum(&frequencies[280..LITLEN_SYMBOLS])
        + 5 * sum(&frequencies[LITLEN_SYMBOLS..])
}

const fn packed(code: Codeword, extra: u32, extra_bits: u32) -> u32 {
    let len = code.len + extra_bits;
    (code.bits | extra << code.len).wrapping_shl(32 - len) | len
}

const fn packed_length(len: usize) -> u32 {
    let code = static_litlen_codeword(FIRST_LENGTH_SYMBOL + length_slot_of(len));
    let slot = length_slot(length_slot_of(len));
    packed(code, len as u32 - slot.base, slot.extra_bits)
}

const fn packed_offset(symbol: usize) -> u32 {
    let extra_bits = offset_slot(symbol).extra_bits;
    packed(static_offset_codeword(symbol), 0, extra_bits)
}

pub(super) static FIXED: Codes = Codes {
    first: table!(|index| match index {
        ..256 => packed(static_litlen_codeword(index), 0, 0),
        _ => packed_length(index - 256 + MIN_MATCH_LEN),
    }),
    second: table!(|index| match index {
        ..256 => packed(static_litlen_codeword(index), 0, 0),
        256..286 => packed_offset((index - 256) ^ (index < 258) as usize),
        _ => 0,
    }),
    end_of_block: packed(static_litlen_codeword(END_OF_BLOCK), 0, 0),
};
