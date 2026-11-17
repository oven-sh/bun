//! RFC 7932 sections 3.4 and 3.5: how a stream describes a prefix code.

use core::hint::select_unpredictable;

use bun_highway::with_bmi2;

use super::Stop;
use super::bit_reader::{BitReader, Bits, REFILLED};
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
    /// Not for streams without codes.
    symbols: Option<SymbolLists>,
}

impl PrefixCodeReader {
    pub(super) fn new() -> Self {
        Self {
            phase: Phase::Start,
            symbols: None,
        }
    }

    /// Returns a complete code.
    pub(super) fn read(
        &mut self,
        alphabet: Alphabet,
        reader: &mut BitReader<'_>,
    ) -> Result<&SymbolLists, Stop> {
        let symbols = match &mut self.symbols {
            Some(symbols) => symbols,
            none => none.insert(SymbolLists::new()?),
        };
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
                    let table = CodeLengthTable::new(code)?;
                    symbols.clear_for_runs(alphabet.size);
                    self.phase = Phase::SymbolLengths(table, SymbolLengths::new());
                }
                Phase::SymbolLengths(table, lengths) => {
                    read_symbol_lengths(lengths, alphabet.size, table, reader, symbols)?;
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
        code.push_run(length, symbol, 1);
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
}

/// The length of the code with and without the extra bits, the symbol unless it is a repeat, and a mask for the extra bits.
struct CodeLengthTable([[u8; 4]; 1 << MAX_CODE_LENGTH_CODE_LENGTH]);

impl CodeLengthTable {
    fn new(code: &CodeLengthCode) -> Result<Self, Stop> {
        let entry_for = |symbol: u32, length: u32| {
            let (symbol, extra_bits) = if symbol < FIRST_REPEAT {
                (symbol, 0)
            } else {
                (0, repeat_extra_bits(symbol))
            };
            let mask = (1 << extra_bits) - 1;
            ((mask << 24) | (symbol << 16) | (length << 8) | (length + extra_bits)).to_le_bytes()
        };
        let mut table = [[0; 4]; _];
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
    previous_mask: u32,
    /// Two less than what the last repeats of the same kind add up to.
    run: u32,
}

with_bmi2! {
    fn read_symbol_lengths(
        lengths: &mut SymbolLengths,
        alphabet_size: u32,
        table: &CodeLengthTable,
        reader: &mut BitReader<'_>,
        symbols: &mut SymbolLists,
    ) -> Result<(), Stop> {
        let (mut state, mut local) = (*lengths, *reader);
        let result = state.read_all(alphabet_size, table, &mut local, symbols);
        (*lengths, *reader) = (state, local);
        result
    }
}

impl SymbolLengths {
    fn new() -> Self {
        Self {
            symbol: 0,
            space: 1 << MAX_CODE_LENGTH,
            previous_length: u32::from(INITIAL_REPEATED_CODE_LENGTH),
            previous_mask: 0,
            run: 0,
        }
    }

    #[inline(always)]
    fn read_all(
        &mut self,
        alphabet_size: u32,
        table: &CodeLengthTable,
        reader: &mut BitReader<'_>,
        symbols: &mut SymbolLists,
    ) -> Result<(), Stop> {
        const MASK_FOR_PREVIOUS: u32 = (1 << repeat_extra_bits(FIRST_REPEAT)) - 1;
        /// How much of the space of all codes one takes up.
        static SHARES: [u16; 16] = [
            0, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1,
        ];
        #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
        let share = |length: u32| i32::from(SHARES[length as usize % 16]);
        loop {
            reader.refill();
            for _ in 0..REFILLED / 8 {
                let peek = reader.bits.peek() as u32;
                #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
                let entry = &table.0[peek as usize % 32];
                reader.bits.skip(u32::from(entry[0]))?;
                let (length, mask) = (u32::from(entry[2]), u32::from(entry[3]));
                let extra = (peek >> (entry[1] % 32)) & mask;
                // With a mask of zero, this counts one symbol.
                let goes_on = core::mem::replace(&mut self.previous_mask, mask) == mask;
                let before = select_unpredictable(goes_on, self.run, 0);
                let more = before * mask + extra + 1;
                self.run = before + more;
                let count = more + select_unpredictable(goes_on, 0, mask & 2);

                let previous = self.previous_length;
                let length = select_unpredictable(mask == MASK_FOR_PREVIOUS, previous, length);
                self.previous_length = select_unpredictable(length != 0, length, previous);
                symbols.push_run(length, self.symbol, count);
                self.space -= count as i32 * share(length);
                self.symbol += count;
                if self.symbol >= alphabet_size || self.space == 0 {
                    return if self.symbol <= alphabet_size && self.space == 0 {
                        Ok(())
                    } else {
                        Err(DecodeError::HuffmanSpace.into())
                    };
                }
            }
        }
    }
}
