//! The bits that are written for each symbol.

use bun_deflate::format::{
    Codeword, END_OF_BLOCK, FIRST_LENGTH_SYMBOL, MIN_MATCH_LEN, length_slot, length_slot_of,
    offset_slot, static_litlen_codeword, static_offset_codeword,
};
use bun_highway::with_bmi2;

use super::huffman::Code;
use super::pending::{Bits, Pending};
use super::symbol::Symbol;
use crate::array::At;
use crate::format::{DISTANCE_SYMBOLS, LENGTH_SYMBOLS};

/// For the alphabet of literals and lengths. A whole number of vectors.
pub(super) const LITERAL_LENGTH_ROOM: usize = 320;

/// Up to 24 bits, and above them how many they are.
#[derive(Clone, Copy)]
struct PackedBits(u32);

impl PackedBits {
    const fn with_extra(code: Codeword, extra: u32, extra_bits: u32) -> Self {
        Self((code.len + extra_bits) << 24 | extra << code.len | code.bits)
    }

    #[inline(always)]
    fn unpack(self) -> Bits {
        Bits(u64::from(self.0 % (1 << 24)), self.0 >> 24)
    }
}

#[derive(Clone, Copy)]
struct DistanceCode {
    /// Plus the distance less one, shifted by `code_bits`, it is the code and the extra bits.
    offset: u32,
    code_bits: u16,
    all_bits: u16,
}

impl DistanceCode {
    const NONE: Self = Self {
        offset: 0,
        code_bits: 0,
        all_bits: 0,
    };

    const fn new(symbol: usize, code: Codeword) -> Self {
        let range = offset_slot(symbol);
        Self {
            offset: code.bits.wrapping_sub((range.base - 1) << code.len),
            code_bits: code.len as u16,
            all_bits: (code.len + range.extra_bits) as u16,
        }
    }
}

pub(super) struct Encoding {
    /// By `Symbol::literal_or_length()`, with the extra bits.
    literal_lengths: [PackedBits; 512],
    distances: [DistanceCode; 32],
    end_of_block: PackedBits,
}

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
pub(super) static FIXED: Encoding = {
    const fn fixed(symbol: usize) -> PackedBits {
        PackedBits::with_extra(static_litlen_codeword(symbol), 0, 0)
    }
    let mut encoding = Encoding {
        literal_lengths: [PackedBits(0); _],
        distances: [DistanceCode::NONE; _],
        end_of_block: fixed(END_OF_BLOCK),
    };
    let mut index = 0;
    while index < 256 {
        let symbol = length_slot_of(index + MIN_MATCH_LEN);
        let range = length_slot(symbol);
        encoding.literal_lengths[index] = fixed(index);
        encoding.literal_lengths[256 + index] = PackedBits::with_extra(
            static_litlen_codeword(FIRST_LENGTH_SYMBOL + symbol),
            (index + MIN_MATCH_LEN) as u32 - range.base,
            range.extra_bits,
        );
        if index < DISTANCE_SYMBOLS {
            encoding.distances[index] = DistanceCode::new(index, static_offset_codeword(index));
        }
        index += 1;
    }
    encoding
};

impl Encoding {
    pub(super) fn new(literal_lengths: &Code<LITERAL_LENGTH_ROOM>, distances: &Code<32>) -> Self {
        let codes = literal_lengths.codes();
        let plain = |symbol: usize| PackedBits::with_extra(*codes.at(symbol), 0, 0);
        let mut encoding = Self {
            literal_lengths: [PackedBits(0); _],
            distances: [DistanceCode::NONE; _],
            end_of_block: plain(END_OF_BLOCK),
        };
        let (literals, lengths) = encoding.literal_lengths.split_at_mut(256);
        for (literal, bits) in literals.iter_mut().enumerate() {
            *bits = plain(literal);
        }
        for symbol in 0..LENGTH_SYMBOLS {
            let (code, range) = (*codes.at(FIRST_LENGTH_SYMBOL + symbol), length_slot(symbol));
            if code.len == 0 {
                continue;
            }
            let of_symbol = lengths.iter_mut().skip(range.base as usize - MIN_MATCH_LEN);
            for (extra, slot) in (0..1 << range.extra_bits).zip(of_symbol) {
                *slot = PackedBits::with_extra(code, extra, range.extra_bits);
            }
        }
        let codes = distances.codes().into_iter().take(distances.used);
        for ((symbol, code), slot) in codes.enumerate().zip(&mut encoding.distances) {
            *slot = DistanceCode::new(symbol, code);
        }
        encoding
    }

    #[inline(always)]
    pub(super) fn of_literal(&self, byte: u8) -> Bits {
        self.literal_lengths.at(byte.into()).unpack()
    }

    #[inline(always)]
    pub(super) fn of(&self, symbol: Symbol) -> Bits {
        let Bits(first, count) = self.literal_lengths.at(symbol.literal_or_length()).unpack();
        let code = *self.distances.at(symbol.distance_symbol());
        let shifted = symbol
            .distance_less_one()
            .wrapping_shl(code.code_bits.into());
        let second = u64::from(code.offset.wrapping_add(shifted));
        Bits(
            first | second.wrapping_shl(count),
            count + u32::from(code.all_bits),
        )
    }

    pub(super) fn end_of_block(&self) -> Bits {
        self.end_of_block.unpack()
    }

    /// And the end of the block. `matches` of the symbols are that.
    pub(super) fn write(
        &self,
        pending: &mut Pending,
        max_len: usize,
        symbols: &[Symbol],
        matches: usize,
    ) {
        put_symbols(self, pending, max_len, symbols, matches);
        pending.put(self.end_of_block());
    }
}

with_bmi2! {
    fn put_symbols(
        encoding: &Encoding,
        pending: &mut Pending,
        max_len: usize,
        symbols: &[Symbol],
        matches: usize,
    ) -> () {
        // A branch only pays if it mostly goes the same way.
        if matches * 8 < symbols.len() {
            pending.put_all(max_len, symbols, |symbol| match symbol.literal() {
                Some(literal) => encoding.of_literal(literal),
                None => encoding.of(symbol),
            });
        } else {
            pending.put_all(max_len, symbols, |symbol| encoding.of(symbol));
        }
    }
}
