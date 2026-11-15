//! RFC 7932 sections 3.4 and 3.5: how a stream describes a prefix code.

use core::hint::select_unpredictable;

use super::Stop;
use super::bit_reader::{BitReader, Bits};
use super::huffman::{SymbolLists, fill_root};
use crate::DecodeError;
use crate::format::{
    Alphabet, CODE_LENGTH_CODE_LENGTH_CODES, CODE_LENGTH_CODE_ORDER, INITIAL_REPEATED_CODE_LENGTH,
    MAX_CODE_LENGTH, MAX_CODE_LENGTH_CODE_LENGTH, REPEAT_PREVIOUS_CODE_LENGTH, repeat_extra_bits,
};

const FIRST_REPEAT: u32 = REPEAT_PREVIOUS_CODE_LENGTH as u32;

enum Phase {
    Start,
    CodeLengthCode(CodeLengthCode),
    SymbolLengths(CodeLengthTable, SymbolLengths),
}

pub(super) struct PrefixCodeReader {
    phase: Phase,
    symbols: SymbolLists,
}

impl PrefixCodeReader {
    pub(super) fn new() -> Self {
        Self {
            phase: Phase::Start,
            symbols: SymbolLists::new(),
        }
    }

    /// Returns a complete code.
    pub(super) fn read(
        &mut self,
        alphabet: Alphabet,
        reader: &mut BitReader<'_>,
    ) -> Result<&SymbolLists, Stop> {
        loop {
            match &mut self.phase {
                Phase::Start => {
                    let skipped = reader.step(|bits| match bits.read(2)? {
                        1 => read_simple_code(alphabet, bits, &mut self.symbols).map(|()| None),
                        skipped => Ok(Some(skipped)),
                    })?;
                    let Some(skipped) = skipped else {
                        return Ok(&self.symbols);
                    };
                    self.phase = Phase::CodeLengthCode(CodeLengthCode::new(skipped));
                }
                Phase::CodeLengthCode(code) => {
                    code.read(reader)?;
                    let table = CodeLengthTable::new(code)?;
                    self.symbols.clear();
                    self.phase = Phase::SymbolLengths(table, SymbolLengths::new());
                }
                Phase::SymbolLengths(table, lengths) => {
                    lengths.read(alphabet.size, table, reader, &mut self.symbols)?;
                    self.phase = Phase::Start;
                    return Ok(&self.symbols);
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
    let mut symbols = [0; 4];
    let (symbols, _) = symbols.split_at_mut(count);
    for symbol in symbols.iter_mut() {
        *symbol = bits.read(alphabet.symbol_bits)?;
        if *symbol >= alphabet.size {
            return Err(DecodeError::SimpleHuffmanAlphabet.into());
        }
    }
    let mut rest = &*symbols;
    while let [first, others @ ..] = rest {
        if others.contains(first) {
            return Err(DecodeError::SimpleHuffmanSame.into());
        }
        rest = others;
    }
    let lengths = match count {
        1 | 2 => [1; 4],
        3 => [1, 2, 2, 2],
        _ if bits.read_flag()? => [1, 2, 3, 3],
        _ => [2; 4],
    };
    let mut sorted = [(u32::MAX, 0); 4];
    for ((slot, &symbol), length) in sorted.iter_mut().zip(&*symbols).zip(lengths) {
        *slot = (symbol, length);
    }
    sorted.sort_unstable();
    code.clear();
    for (symbol, length) in sorted.into_iter().take(count) {
        code.push(length, symbol);
    }
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
            if local.bits.count() < 4 {
                local.refill();
            }
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
}

/// From the low bits: the length with the extra bits (6 bits), the symbol (5 bits), and the length of the code.
struct CodeLengthTable([u16; 1 << MAX_CODE_LENGTH_CODE_LENGTH]);

impl CodeLengthTable {
    fn new(code: &CodeLengthCode) -> Result<Self, Stop> {
        let entry_for = |symbol: u32, length: u32| {
            let extra_bits = if symbol < FIRST_REPEAT {
                0
            } else {
                repeat_extra_bits(symbol)
            };
            ((length << 11) | (symbol << 6) | (length + extra_bits)) as u16
        };
        let mut table = [0; _];
        if code.space == 0 {
            let of_length = |length: usize| {
                let mut symbols = code.symbols_by_length.get(length).copied().unwrap_or(0);
                core::iter::from_fn(move || {
                    let symbol = symbols.trailing_zeros();
                    symbols &= symbols.checked_sub(1)?;
                    Some(symbol)
                })
            };
            fill_root(&mut table, of_length, entry_for);
        } else {
            let [_, used @ ..] = code.symbols_by_length;
            let used = used.into_iter().fold(0, |all, some| all | some);
            if !used.is_power_of_two() {
                return Err(DecodeError::ClSpace.into());
            }
            table.fill(entry_for(used.trailing_zeros(), 0));
        }
        Ok(Self(table))
    }
}

#[derive(Clone, Copy)]
struct SymbolLengths {
    symbol: u32,
    space: i32,
    previous_length: u32,
    repeat: u32,
    repeated_length: u32,
}

impl SymbolLengths {
    fn new() -> Self {
        Self {
            symbol: 0,
            space: 1 << MAX_CODE_LENGTH,
            previous_length: u32::from(INITIAL_REPEATED_CODE_LENGTH),
            repeat: 0,
            repeated_length: 0,
        }
    }

    fn read(
        &mut self,
        alphabet_size: u32,
        table: &CodeLengthTable,
        reader: &mut BitReader<'_>,
        symbols: &mut SymbolLists,
    ) -> Result<(), Stop> {
        let (mut state, mut local) = (*self, *reader);
        let result = state.read_all(alphabet_size, table, &mut local, symbols);
        (*self, *reader) = (state, local);
        result
    }

    #[inline(always)]
    fn read_all(
        &mut self,
        alphabet_size: u32,
        table: &CodeLengthTable,
        reader: &mut BitReader<'_>,
        symbols: &mut SymbolLists,
    ) -> Result<(), Stop> {
        /// How much of the space of all codes one takes up.
        static SHARES: [u16; 16] = [
            0, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1,
        ];
        #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
        let share = |length: u32| i32::from(SHARES[length as usize % 16]);
        while self.symbol < alphabet_size && self.space != 0 {
            if reader.bits.count() < 8 {
                reader.refill();
            }
            let peek = reader.bits.peek() as u32;
            #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
            let entry = u32::from(table.0[peek as usize % 32]);
            reader.bits.skip(entry % 64)?;
            let code = (entry >> 6) % 32;
            if code < FIRST_REPEAT {
                symbols.push(code, self.symbol);
                self.symbol += 1;
                self.space -= share(code);
                self.repeat = 0;
                self.previous_length = select_unpredictable(code != 0, code, self.previous_length);
                continue;
            }
            let extra_bits = repeat_extra_bits(code);
            let extra = (peek >> (entry >> 11)) & ((1 << extra_bits) - 1);
            let length = select_unpredictable(code == FIRST_REPEAT, self.previous_length, 0);
            let before = select_unpredictable(self.repeated_length == length, self.repeat, 0);
            self.repeated_length = length;
            self.repeat = (before.saturating_sub(2) << extra_bits) + extra + 3;
            let count = self.repeat - before;
            if self.symbol + count > alphabet_size {
                return Err(DecodeError::HuffmanSpace.into());
            }
            if length != 0 {
                symbols.push_run(length, self.symbol, count);
                self.space -= count as i32 * share(length);
            }
            self.symbol += count;
        }
        if self.space != 0 {
            return Err(DecodeError::HuffmanSpace.into());
        }
        Ok(())
    }
}
