//! The literals and matches of the block in the making, and how they are written.

use super::huffman::Code;
use super::pending::{BitWriter, Pending};
use crate::array::At;
use crate::error::Result;
use crate::format::{
    CODE_LENGTH_ORDER, DISTANCE_SYMBOLS, DYNAMIC_BLOCK, END_OF_BLOCK, FIRST_LENGTH_SYMBOL,
    FIXED_BLOCK, FIXED_DISTANCE_BITS, LENGTH_SYMBOLS, LITERAL_LENGTH_SYMBOLS, MAX_CODE_BITS,
    MAX_CODE_LENGTH_BITS, MAX_MATCH, MAX_STORED_LEN, MIN_MATCH, REPEAT_FEW_ZEROS,
    REPEAT_MANY_ZEROS, REPEAT_PREVIOUS, Repeat, distance_range, fixed_literal_length_bits,
    fixed_literal_length_code, length_range, reversed,
};
use crate::vec;

const MATCH_LENGTHS: usize = MAX_MATCH - MIN_MATCH + 1;

/// By the length less 3. Counts from `FIRST_LENGTH_SYMBOL`.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static LENGTH_SYMBOL: [u8; MATCH_LENGTHS] = {
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
    fn literal_or_length(self) -> usize {
        self.0 as usize % 512
    }

    #[inline(always)]
    fn distance_symbol(self) -> usize {
        (self.0 as usize >> 9) % 32
    }
}

/// Up to 24 bits, and above them how many they are.
#[derive(Clone, Copy)]
struct Bits(u32);

impl Bits {
    const fn new(bits: u32, count: u32) -> Self {
        Self(count << 24 | bits)
    }

    #[inline(always)]
    fn bits(self) -> u64 {
        u64::from(self.0 % (1 << 24))
    }

    #[inline(always)]
    fn count(self) -> u32 {
        self.0 >> 24
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

const fn length_bits(symbol: u32, extra: u32, code: u16, bits: u32) -> Bits {
    Bits::new(
        code as u32 | extra << bits,
        bits + length_range(symbol).extra_bits,
    )
}

pub(super) struct Encoding {
    /// By `Symbol::literal_or_length()`, with the extra bits.
    literal_lengths: [Bits; 512],
    distances: [DistanceCode; 32],
    end_of_block: Bits,
}

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
pub(super) static FIXED: Encoding = {
    const fn fixed(symbol: usize) -> Bits {
        Bits::new(
            fixed_literal_length_code(symbol) as u32,
            fixed_literal_length_bits(symbol),
        )
    }
    let mut encoding = Encoding {
        literal_lengths: [Bits(0); _],
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
    fn new(literal_lengths: &Code<512>, distances: &Code<32>) -> Self {
        let codes = literal_lengths.codes();
        let bits_of = |symbol: usize| {
            let bits = *literal_lengths.lengths.at(symbol);
            (*codes.at(symbol), u32::from(bits))
        };
        let plain = |symbol: usize| {
            let (code, bits) = bits_of(symbol);
            Bits::new(code.into(), bits)
        };
        let mut encoding = Self {
            literal_lengths: [Bits(0); _],
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
    pub(super) fn put_literal(&self, writer: &mut BitWriter<'_>, byte: u8) {
        let bits = *self.literal_lengths.at(byte.into());
        writer.put(bits.bits(), bits.count());
    }

    #[inline(always)]
    pub(super) fn put(&self, writer: &mut BitWriter<'_>, symbol: Symbol) {
        let first = *self.literal_lengths.at(symbol.literal_or_length());
        let code = *self.distances.at(symbol.distance_symbol());
        let shifted = (symbol.0 >> 14).wrapping_shl(code.code_bits.into());
        let second = u64::from(code.offset.wrapping_add(shifted));
        writer.put(
            first.bits() | second.wrapping_shl(first.count()),
            first.count() + u32::from(code.all_bits),
        );
    }

    pub(super) fn put_end_of_block(&self, writer: &mut BitWriter<'_>) {
        writer.put(self.end_of_block.bits(), self.end_of_block.count());
    }

    #[inline(never)]
    fn put_all(&self, writer: &mut BitWriter<'_>, symbols: &[Symbol]) {
        for &symbol in symbols {
            self.put(writer, symbol);
        }
        self.put_end_of_block(writer);
    }
}

/// The lengths of the two codes, in symbols of a third.
struct CodeLengths {
    /// Each with the value of its extra bits.
    symbols: [[u8; 2]; 512],
    len: usize,
    frequencies: [u16; 32],
}

impl CodeLengths {
    fn push(&mut self, symbol: u8, extra: u8) {
        *self.symbols.at_mut(self.len) = [symbol, extra];
        self.len += 1;
        *self.frequencies.at_mut(symbol.into()) += 1;
    }

    fn push_repeat(&mut self, repeat: &Repeat, count: u32) {
        self.push(repeat.symbol, (count - repeat.min) as u8);
    }

    fn extend(&mut self, lengths: &[u8]) {
        for run in lengths.chunk_by(|a, b| a == b) {
            let (&[length, ..], mut left) = (run, run.len() as u32) else {
                continue;
            };
            if length == 0 {
                while left > REPEAT_FEW_ZEROS.max() {
                    let count = left.min(REPEAT_MANY_ZEROS.max());
                    self.push_repeat(&REPEAT_MANY_ZEROS, count);
                    left -= count;
                }
                if left >= REPEAT_FEW_ZEROS.min {
                    self.push_repeat(&REPEAT_FEW_ZEROS, core::mem::take(&mut left));
                }
            } else {
                self.push(length, 0);
                left -= 1;
                while left >= REPEAT_PREVIOUS.min {
                    let count = left.min(REPEAT_PREVIOUS.max());
                    self.push_repeat(&REPEAT_PREVIOUS, count);
                    left -= count;
                }
            }
            for _ in 0..left {
                self.push(length, 0);
            }
        }
    }
}

const fn code_length_extra_bits(symbol: u8) -> u32 {
    match symbol.checked_sub(REPEAT_PREVIOUS.symbol) {
        None => 0,
        Some(0) => REPEAT_PREVIOUS.extra_bits,
        Some(1) => REPEAT_FEW_ZEROS.extra_bits,
        Some(_) => REPEAT_MANY_ZEROS.extra_bits,
    }
}

pub(super) struct Block {
    /// Full at its capacity.
    symbols: Vec<Symbol>,
    literal_length_frequencies: [u16; 512],
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
    fn push(&mut self, symbol: Symbol) {
        let pushed = self.symbols.push_within_capacity(symbol);
        debug_assert!(pushed.is_ok());
    }

    #[inline(always)]
    pub(super) fn push_literal(&mut self, byte: u8) {
        self.push(Symbol::for_literal(byte));
        *self.literal_length_frequencies.at_mut(byte.into()) += 1;
    }

    /// As many as there is room for, and returns how many.
    pub(super) fn push_literals(&mut self, bytes: &[u8]) -> usize {
        let room = self.symbols.capacity() - self.symbols.len();
        let bytes = bytes.get(..room).unwrap_or(bytes);
        self.symbols
            .extend(bytes.iter().copied().map(Symbol::for_literal));
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

    #[inline(always)]
    pub(super) fn push_match(&mut self, distance: u32, len: u32) {
        let symbol = Symbol::for_match(distance, len);
        self.push(symbol);
        let length_symbol = *LENGTH_SYMBOL.at(symbol.literal_or_length() % MATCH_LENGTHS);
        *self
            .literal_length_frequencies
            .at_mut(FIRST_LENGTH_SYMBOL + usize::from(length_symbol)) += 1;
        *self.distance_frequencies.at_mut(symbol.distance_symbol()) += 1;
    }

    /// In whichever way is shortest, and clears it. `source` is what the symbols stand for, if it is still there.
    pub(super) fn write(
        &mut self,
        pending: &mut Pending,
        source: Option<&[u8]>,
        only_fixed: bool,
        is_last: bool,
    ) {
        if self.is_empty() {
            self.write_fixed(pending, 0, is_last);
            return;
        }
        self.literal_length_frequencies[END_OF_BLOCK] = 1;
        let literal_lengths = Code::new(&self.literal_length_frequencies, MAX_CODE_BITS as u8);
        let distances = Code::new(&self.distance_frequencies, MAX_CODE_BITS as u8);
        let mut code_lengths = CodeLengths {
            symbols: [[0; _]; _],
            len: 0,
            frequencies: [0; _],
        };
        code_lengths.extend(literal_lengths.used_lengths());
        code_lengths.extend(distances.used_lengths());
        let code_length_code = Code::new(&code_lengths.frequencies, MAX_CODE_LENGTH_BITS as u8);
        let ordered = CODE_LENGTH_ORDER.map(|symbol| *code_length_code.lengths.at(symbol.into()));
        let last_used = ordered.iter().enumerate().rfind(|&(_, &bits)| bits != 0);
        let ordered_len = last_used.map_or(0, |(rank, _)| rank + 1).max(4);

        let (mut dynamic_bits, mut fixed_bits) = (5 + 5 + 4 + 3 * ordered_len as u32, 0);
        let (mut extra_bits, mut matches) = (0, 0);
        let frequencies = self.literal_length_frequencies.iter();
        for (symbol, (&frequency, &bits)) in frequencies
            .zip(&literal_lengths.lengths)
            .take(LITERAL_LENGTH_SYMBOLS)
            .enumerate()
        {
            dynamic_bits += u32::from(frequency) * u32::from(bits);
            fixed_bits += u32::from(frequency) * fixed_literal_length_bits(symbol);
        }
        let frequencies = self.literal_length_frequencies.iter();
        for (symbol, &frequency) in
            (0..LENGTH_SYMBOLS as u32).zip(frequencies.skip(FIRST_LENGTH_SYMBOL))
        {
            extra_bits += u32::from(frequency) * length_range(symbol).extra_bits;
        }
        let frequencies = self.distance_frequencies.iter().zip(&distances.lengths);
        for (symbol, (&frequency, &bits)) in (0..DISTANCE_SYMBOLS as u32).zip(frequencies) {
            dynamic_bits += u32::from(frequency) * u32::from(bits);
            extra_bits += u32::from(frequency) * distance_range(symbol).extra_bits;
            matches += u32::from(frequency);
        }
        let frequencies = code_lengths.frequencies.iter();
        for (symbol, (&frequency, &bits)) in (0..).zip(frequencies.zip(&code_length_code.lengths)) {
            dynamic_bits +=
                u32::from(frequency) * (u32::from(bits) + code_length_extra_bits(symbol));
        }
        fixed_bits += matches * FIXED_DISTANCE_BITS;

        let [dynamic_len, fixed_len] =
            [dynamic_bits, fixed_bits].map(|bits| (3 + bits + extra_bits).div_ceil(8) as usize);
        let is_fixed = only_fixed || fixed_len <= dynamic_len;
        let len = if is_fixed { fixed_len } else { dynamic_len };
        if let Some(source) = source.filter(|it| it.len() + 4 <= len && it.len() <= MAX_STORED_LEN)
        {
            pending.write_stored_block(source, is_last);
        } else if is_fixed {
            self.write_fixed(pending, len, is_last);
        } else {
            pending.write_bits(len, |writer| {
                writer.put_block_type(DYNAMIC_BLOCK, is_last);
                writer.put((literal_lengths.used - FIRST_LENGTH_SYMBOL) as u64, 5);
                writer.put(distances.used as u64 - 1, 5);
                writer.put(ordered_len as u64 - 4, 4);
                for &bits in ordered.iter().take(ordered_len) {
                    writer.put(bits.into(), 3);
                }
                let codes = code_length_code.codes();
                for &[symbol, extra] in code_lengths.symbols.iter().take(code_lengths.len) {
                    let bits = u32::from(*code_length_code.lengths.at(symbol.into()));
                    writer.put(
                        u64::from(*codes.at(symbol.into())) | u64::from(extra) << bits,
                        bits + code_length_extra_bits(symbol),
                    );
                }
                Encoding::new(&literal_lengths, &distances).put_all(writer, &self.symbols);
                if is_last {
                    writer.pad_to_byte_boundary();
                }
            });
        }
        self.clear();
    }

    fn write_fixed(&self, pending: &mut Pending, len: usize, is_last: bool) {
        pending.write_bits(len + 2, |writer| {
            writer.put_block_type(FIXED_BLOCK, is_last);
            FIXED.put_all(writer, &self.symbols);
            if is_last {
                writer.pad_to_byte_boundary();
            }
        });
    }
}
