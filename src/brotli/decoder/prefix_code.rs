//! RFC 7932 sections 3.4 and 3.5: how a stream describes a prefix code.

use bun_highway::brotli_decoder::{CodeLength, SymbolLists};

use super::Stop;
use super::bit_reader::{BitReader, Bits};
use crate::DecodeError;
use crate::format::{
    Alphabet, CODE_LENGTH_CODE_LENGTH_CODES, CODE_LENGTH_CODE_ORDER, CODE_LENGTH_CODES,
    INITIAL_REPEATED_CODE_LENGTH, MAX_CODE_LENGTH_CODE_LENGTH, reverse_byte,
};

enum Phase {
    Start,
    CodeLengthCode(CodeLengthCode),
    SymbolLengths,
}

pub(super) struct PrefixCodeReader {
    phase: Phase,
    symbols: Box<SymbolLists>,
}

impl PrefixCodeReader {
    pub(super) fn new() -> Result<Self, Stop> {
        Ok(Self {
            phase: Phase::Start,
            symbols: SymbolLists::new().ok_or(DecodeError::AllocTreeGroups)?,
        })
    }

    /// Returns a complete code.
    pub(super) fn read(
        &mut self,
        alphabet: Alphabet,
        reader: &mut BitReader<'_>,
    ) -> Result<&SymbolLists, Stop> {
        let symbols = &mut *self.symbols;
        loop {
            match &mut self.phase {
                Phase::Start => {
                    let skipped = reader.step(|bits| match bits.read(2)? {
                        1 => read_simple_code(alphabet, bits, symbols).map(|()| None),
                        skipped => Ok(Some(skipped)),
                    })?;
                    let Some(skipped) = skipped else {
                        return Ok(symbols);
                    };
                    self.phase = Phase::CodeLengthCode(CodeLengthCode::new(skipped));
                }
                Phase::CodeLengthCode(code) => {
                    code.read(reader)?;
                    code.fill(&mut symbols.code_lengths)?;
                    symbols.clear(alphabet.size, INITIAL_REPEATED_CODE_LENGTH);
                    self.phase = Phase::SymbolLengths;
                }
                Phase::SymbolLengths => {
                    read_symbol_lengths(reader, symbols)?;
                    self.phase = Phase::Start;
                    return Ok(symbols);
                }
            }
        }
    }
}

fn read_simple_code(
    alphabet: Alphabet,
    bits: &mut Bits,
    code: &mut SymbolLists,
) -> Result<(), Stop> {
    let count = bits.read(2)? as usize + 1;
    let mut symbols = [1, 2, 3, 4].map(|n| u32::MAX / 8 - 4 + n);
    for symbol in symbols.iter_mut().take(count) {
        *symbol = bits.read(alphabet.symbol_bits)?;
        if *symbol >= alphabet.size {
            return Err(DecodeError::SimpleHuffmanAlphabet.into());
        }
    }
    let [a, b, c, d] = symbols;
    if (a == b) | (a == c) | (a == d) | (b == c) | (b == d) | (c == d) {
        return Err(DecodeError::SimpleHuffmanSame.into());
    }
    let [a, b, c, d]: [u32; 4] = match count {
        1 => [4 * a + 1, 0, 0, 0],
        2 => [4 * a + 1, 4 * b + 1, 0, 0],
        3 => [4 * a + 1, 4 * b + 2, 4 * c + 2, 0],
        _ if bits.read_flag()? => [4 * a + 1, 4 * b + 2, 4 * c + 3, 4 * d + 3],
        _ => symbols.map(|symbol| 4 * symbol + 2),
    };
    let ([a, b], [c, d]) = ([a.min(b), a.max(b)], [c.min(d), c.max(d)]);
    let ([a, c], [b, d]) = ([a.min(c), a.max(c)], [b.min(d), b.max(d)]);
    let sorted = [a, b.min(c), b.max(c), d];
    code.set(sorted.map(|it| it as u8 % 4), sorted.map(|it| it / 4));
    Ok(())
}

struct CodeLengthCode {
    /// A bit for each symbol.
    symbols_by_length: [u32; 8],
    next: usize,
    space: i32,
}

impl CodeLengthCode {
    fn new(skipped: u32) -> Self {
        Self {
            symbols_by_length: [0; _],
            next: skipped as usize,
            space: 1 << MAX_CODE_LENGTH_CODE_LENGTH,
        }
    }

    #[inline(always)]
    #[allow(clippy::indexing_slicing)] // Reduced to the size of the tables.
    fn read(&mut self, reader: &mut BitReader<'_>) -> Result<(), Stop> {
        /// How many bits there are for a length, the length, and how much of the space of all codes it takes up.
        static LENGTHS: [[u8; 4]; 16] = {
            let mut all = [[0; 4]; 16];
            let mut length = 0;
            while length <= MAX_CODE_LENGTH_CODE_LENGTH {
                let (bits, mut peeked) = CODE_LENGTH_CODE_LENGTH_CODES[length];
                while peeked < 16 {
                    all[peeked as usize] = [bits, length as u8, (32 >> length) % 32, 0];
                    peeked += 1 << bits;
                }
                length += 1;
            }
            all
        };
        let (mut local, mut next, mut space) = (*reader, self.next, self.space);
        let mut result = Ok(());
        while space > 0
            && let Some(&symbol) = CODE_LENGTH_CODE_ORDER.get(next)
        {
            local.refill_for(4);
            let [bits, length, share, _] = LENGTHS[local.bits.peek() as usize % 16];
            result = local.bits.skip(u32::from(bits));
            if result.is_err() {
                break;
            }
            next += 1;
            space -= i32::from(share);
            self.symbols_by_length[usize::from(length) % 8] |= 1 << symbol;
        }
        (*reader, self.next, self.space) = (local, next, space);
        result
    }

    #[inline(always)]
    #[allow(clippy::indexing_slicing)] // Reduced to the size of the tables.
    fn fill(&self, table: &mut [CodeLength; 32]) -> Result<(), Stop> {
        const SYMBOLS: usize = CODE_LENGTH_CODES;
        /// For each length, and in it each symbol: the entry, and how many of them there are.
        static ENTRIES: ([CodeLength; 256], [u8; 128]) = {
            let (mut all, mut i) = (([CodeLength::new(0, 0); _], [0; _]), 0);
            while i < (MAX_CODE_LENGTH_CODE_LENGTH + 1) * SYMBOLS {
                let (length, symbol) = ((i / SYMBOLS) as u8, (i % SYMBOLS) as u8);
                all.0[i] = CodeLength::new(symbol, length);
                all.1[i] = 32 >> length;
                i += 1;
            }
            all
        };
        let [_, a, b, c, d, e, ..] = self.symbols_by_length.map(u64::from);
        if self.space != 0 {
            let used = a | b | c | d | e;
            if !used.is_power_of_two() {
                return Err(DecodeError::ClSpace.into());
            }
            table.fill(ENTRIES.0[used.trailing_zeros() as usize]);
            return Ok(());
        }
        // With the first bit highest, the entries for a code are next to each other.
        let (mut in_order, mut at) = ([0; 32 + 16], 0);
        let short = a | (b << SYMBOLS) | (c << (2 * SYMBOLS));
        for (first, mut codes) in [(SYMBOLS, short), (4 * SYMBOLS, d | (e << SYMBOLS))] {
            while codes != 0 {
                let index = first + codes.trailing_zeros() as usize;
                in_order[at % 32..][..16].fill(index as u8);
                at += usize::from(ENTRIES.1[index % 128]);
                codes &= codes - 1;
            }
        }
        for bits in 0..8 {
            let at = usize::from(reverse_byte(bits as u8) / 8);
            for (high_bits, next) in [(0, 0), (8, 2), (16, 1), (24, 3)] {
                table[bits + high_bits] = ENTRIES.0[usize::from(in_order[at + next])];
            }
        }
        Ok(())
    }
}

#[inline(always)]
fn read_symbol_lengths(reader: &mut BitReader<'_>, symbols: &mut SymbolLists) -> Result<(), Stop> {
    let mut input = reader.lend();
    let mut is_complete = symbols.read_lengths(&mut input);
    reader.go_on_from(input);
    while is_complete.is_none() {
        reader.refill_for(8);
        let bits = reader.bits.peek();
        reader.bits.skip(symbols.bits_for_length(bits))?;
        is_complete = symbols.push_length(bits);
    }
    match is_complete {
        Some(true) => Ok(()),
        _ => Err(DecodeError::HuffmanSpace.into()),
    }
}
