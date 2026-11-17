//! The bits that are written for each symbol.

use super::huffman::Code;
use super::pending::{Bits, Pending};
use super::symbol::{LENGTH_SYMBOL, Symbol};
use crate::array::At;
use crate::format::{
    DISTANCE_SYMBOLS, END_OF_BLOCK, FIRST_LENGTH_SYMBOL, FIXED_DISTANCE_BITS, LENGTH_SYMBOLS,
    MIN_MATCH, distance_range, fixed_literal_length_bits, fixed_literal_length_code, length_range,
    reversed,
};

/// For the alphabet of literals and lengths. A whole number of vectors.
pub(super) const LITERAL_LENGTH_ROOM: usize = 320;

/// Up to 24 bits, and above them how many they are.
#[derive(Clone, Copy)]
struct PackedBits(u32);

impl PackedBits {
    const fn new(bits: u32, count: u32) -> Self {
        Self(count << 24 | bits)
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

    const fn new(symbol: u32, code: u16, bits: u32) -> Self {
        let range = distance_range(symbol);
        Self {
            offset: (code as u32).wrapping_sub((range.base - 1) << bits),
            code_bits: bits as u16,
            all_bits: (bits + range.extra_bits) as u16,
        }
    }
}

const fn length_bits(symbol: u32, extra: u32, code: u16, bits: u32) -> PackedBits {
    PackedBits::new(
        code as u32 | extra << bits,
        bits + length_range(symbol).extra_bits,
    )
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
        PackedBits::new(
            fixed_literal_length_code(symbol) as u32,
            fixed_literal_length_bits(symbol),
        )
    }
    let mut encoding = Encoding {
        literal_lengths: [PackedBits(0); _],
        distances: [DistanceCode::NONE; _],
        end_of_block: fixed(END_OF_BLOCK),
    };
    let mut index = 0;
    while index < 256 {
        let symbol = LENGTH_SYMBOL[index] as u32;
        encoding.literal_lengths[index] = fixed(index);
        encoding.literal_lengths[256 + index] = length_bits(
            symbol,
            (index + MIN_MATCH) as u32 - length_range(symbol).base,
            fixed_literal_length_code(FIRST_LENGTH_SYMBOL + symbol as usize),
            fixed_literal_length_bits(FIRST_LENGTH_SYMBOL + symbol as usize),
        );
        if index < DISTANCE_SYMBOLS {
            let code = reversed(index as u16, FIXED_DISTANCE_BITS);
            encoding.distances[index] = DistanceCode::new(index as u32, code, FIXED_DISTANCE_BITS);
        }
        index += 1;
    }
    encoding
};

impl Encoding {
    pub(super) fn new(literal_lengths: &Code<LITERAL_LENGTH_ROOM>, distances: &Code<32>) -> Self {
        let codes = literal_lengths.codes();
        let bits_of = |symbol: usize| {
            let bits = *literal_lengths.lengths.at(symbol);
            (*codes.at(symbol), u32::from(bits))
        };
        let plain = |symbol: usize| {
            let (code, bits) = bits_of(symbol);
            PackedBits::new(code.into(), bits)
        };
        let mut encoding = Self {
            literal_lengths: [PackedBits(0); _],
            distances: [DistanceCode::NONE; _],
            end_of_block: plain(END_OF_BLOCK),
        };
        let (literals, lengths) = encoding.literal_lengths.split_at_mut(256);
        for (literal, bits) in literals.iter_mut().enumerate() {
            *bits = plain(literal);
        }
        for symbol in 0..LENGTH_SYMBOLS as u32 {
            let (code, bits) = bits_of(FIRST_LENGTH_SYMBOL + symbol as usize);
            if bits == 0 {
                continue;
            }
            let range = length_range(symbol);
            let of_symbol = lengths.iter_mut().skip(range.base as usize - MIN_MATCH);
            for (extra, slot) in (0..1 << range.extra_bits).zip(of_symbol) {
                *slot = length_bits(symbol, extra, code, bits);
            }
        }
        let codes = distances.codes().into_iter().zip(distances.used_lengths());
        for ((symbol, (code, &bits)), slot) in (0..).zip(codes).zip(&mut encoding.distances) {
            *slot = DistanceCode::new(symbol, code, bits.into());
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
    #[inline(never)]
    pub(super) fn write(
        &self,
        pending: &mut Pending,
        max_len: usize,
        symbols: &[Symbol],
        matches: usize,
    ) {
        // A branch only pays if it mostly goes the same way.
        if matches * 8 < symbols.len() {
            pending.put_all(max_len, symbols, |symbol| match symbol.literal() {
                Some(literal) => self.of_literal(literal),
                None => self.of(symbol),
            });
        } else {
            pending.put_all(max_len, symbols, |symbol| self.of(symbol));
        }
        pending.put(self.end_of_block());
    }
}
