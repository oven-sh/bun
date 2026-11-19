//! The literals and matches of the block in the making.

use bun_core::vec::{BorrowedCursor, append_with};
use bun_deflate::format::{
    DYNAMIC, END_OF_BLOCK, FIRST_LENGTH_SYMBOL, MAX_CODEWORD_LEN, STATIC, length_slot, offset_slot,
    static_litlen_codeword, static_offset_codeword,
};

use super::encoding::{Encoding, FIXED, LITERAL_LENGTH_ROOM};
use super::header::DynamicHeader;
use super::huffman::{Code, cost};
use super::pending::{Bits, Pending};
use super::symbol::Symbol;
use crate::array::At;
use crate::error::Result;
use crate::format::{DISTANCE_SYMBOLS, LITERAL_LENGTH_SYMBOLS, MAX_STORED_LEN};
use crate::vec;

macro_rules! table {
    (|$symbol:ident| $value:expr, $range:expr) => {{
        let mut table = [0; _];
        let mut $symbol = $range.start;
        while $symbol < $range.end {
            table[$symbol] = $value as u8;
            $symbol += 1;
        }
        table
    }};
}

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static FIXED_LITERAL_LENGTH_BITS: [u8; LITERAL_LENGTH_ROOM] = table!(
    |symbol| static_litlen_codeword(symbol).len,
    0..LITERAL_LENGTH_SYMBOLS
);
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static LENGTH_EXTRA_BITS: [u8; LITERAL_LENGTH_ROOM] = table!(
    |symbol| length_slot(symbol - FIRST_LENGTH_SYMBOL).extra_bits,
    FIRST_LENGTH_SYMBOL..LITERAL_LENGTH_SYMBOLS
);
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static DISTANCE_EXTRA_BITS: [u8; 32] =
    table!(|symbol| offset_slot(symbol).extra_bits, 0..DISTANCE_SYMBOLS);

/// Adds to a block.
pub(super) struct Tally<'a> {
    symbols: BorrowedCursor<'a, Symbol>,
    literal_length_frequencies: &'a mut [u16; LITERAL_LENGTH_ROOM],
    distance_frequencies: &'a mut [u16; 32],
}

impl Tally<'_> {
    #[inline(always)]
    pub(super) fn is_full(&self) -> bool {
        self.symbols.capacity() == 0
    }

    #[inline(always)]
    fn push(&mut self, symbol: Symbol) {
        debug_assert!(!self.is_full());
        if !self.is_full() {
            self.symbols.append(&[symbol]);
        }
    }

    #[inline(always)]
    pub(super) fn push_literal(&mut self, byte: u8) {
        self.push(Symbol::for_literal(byte));
        *self.literal_length_frequencies.at_mut(byte.into()) += 1;
    }

    #[inline(always)]
    pub(super) fn push_match(&mut self, distance: u32, len: u32) {
        let symbol = Symbol::for_match(distance, len);
        self.push(symbol);
        *self
            .literal_length_frequencies
            .at_mut(FIRST_LENGTH_SYMBOL + symbol.length_symbol()) += 1;
        *self.distance_frequencies.at_mut(symbol.distance_symbol()) += 1;
    }
}

pub(super) struct Block {
    /// Full at its capacity.
    symbols: Vec<Symbol>,
    literal_length_frequencies: [u16; LITERAL_LENGTH_ROOM],
    distance_frequencies: [u16; 32],
}

impl Block {
    pub(super) fn new(max_symbols: usize) -> Result<Self> {
        Ok(Self {
            symbols: vec::with_room(max_symbols)?,
            literal_length_frequencies: [0; _],
            distance_frequencies: [0; _],
        })
    }

    pub(super) fn clear(&mut self) {
        self.symbols.clear();
        self.literal_length_frequencies = [0; _];
        self.distance_frequencies = [0; _];
    }

    pub(super) fn is_empty(&self) -> bool {
        self.symbols.is_empty()
    }

    #[inline(always)]
    pub(super) fn is_full(&self) -> bool {
        self.symbols.len() == self.symbols.capacity()
    }

    #[inline(always)]
    pub(super) fn tally<R>(&mut self, add: impl FnOnce(Tally<'_>) -> R) -> R {
        append_with(&mut self.symbols, usize::MAX, |symbols| {
            add(Tally {
                symbols,
                literal_length_frequencies: &mut self.literal_length_frequencies,
                distance_frequencies: &mut self.distance_frequencies,
            })
        })
    }

    /// As many as there is room for, and returns how many.
    pub(super) fn push_literals(&mut self, bytes: &[u8]) -> usize {
        let room = self.symbols.capacity() - self.symbols.len();
        let bytes = bytes.get(..room).unwrap_or(bytes);
        self.symbols
            .extend(bytes.iter().copied().map(Symbol::for_literal));
        if bytes.len() < 64 {
            for &byte in bytes {
                *self.literal_length_frequencies.at_mut(byte.into()) += 1;
            }
            return bytes.len();
        }
        // Or each of a run of equal bytes would wait for the one before it.
        let mut counts = [[0u16; 256]; 4];
        let (groups, rest) = bytes.as_chunks::<4>();
        for group in groups {
            for (counts, &byte) in counts.iter_mut().zip(group) {
                *counts.at_mut(byte.into()) += 1;
            }
        }
        for &byte in rest {
            *counts[0].at_mut(byte.into()) += 1;
        }
        for counts in &counts {
            for (total, count) in self.literal_length_frequencies.iter_mut().zip(counts) {
                *total += count;
            }
        }
        bytes.len()
    }

    /// In whichever way is shortest, and clears it. `source` is what the symbols stand for, if it is still there.
    pub(super) fn write(
        &mut self,
        pending: &mut Pending,
        source: Option<&[u8]>,
        only_fixed: bool,
        is_last: bool,
    ) {
        // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/trees.c#L628
        if self.is_empty() {
            pending.put(Bits::block_header(STATIC, is_last));
            pending.put(FIXED.end_of_block());
            return;
        }
        self.literal_length_frequencies[END_OF_BLOCK] = 1;
        let literal_lengths =
            Code::new::<512>(&self.literal_length_frequencies, MAX_CODEWORD_LEN as u8);
        let distances = Code::new::<32>(&self.distance_frequencies, MAX_CODEWORD_LEN as u8);
        let header = DynamicHeader::new(&literal_lengths, &distances);

        let frequencies = (&self.literal_length_frequencies, &self.distance_frequencies);
        let matches = cost(frequencies.1, &[1; _]);
        let extra_bits =
            cost(frequencies.0, &LENGTH_EXTRA_BITS) + cost(frequencies.1, &DISTANCE_EXTRA_BITS);
        let fixed_bits = cost(frequencies.0, &FIXED_LITERAL_LENGTH_BITS)
            + matches * static_offset_codeword(0).len;
        let dynamic_bits = header.bits()
            + cost(frequencies.0, &literal_lengths.lengths)
            + cost(frequencies.1, &distances.lengths);
        let [dynamic_len, fixed_len] =
            [dynamic_bits, fixed_bits].map(|bits| (3 + bits + extra_bits).div_ceil(8) as usize);

        let is_fixed = only_fixed || fixed_len <= dynamic_len;
        let len = if is_fixed { fixed_len } else { dynamic_len };
        if let Some(source) = source.filter(|it| it.len() + 4 <= len && it.len() <= MAX_STORED_LEN)
        {
            pending.write_stored_block(source, is_last);
        } else if is_fixed {
            pending.put(Bits::block_header(STATIC, is_last));
            FIXED.write(pending, len, &self.symbols, matches as usize);
        } else {
            pending.write(len, |writer| {
                writer.put(Bits::block_header(DYNAMIC, is_last));
                header.write(writer);
            });
            let encoding = Encoding::new(&literal_lengths, &distances);
            encoding.write(pending, len, &self.symbols, matches as usize);
        }
        self.clear();
    }
}
