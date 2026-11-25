//! Finite State Entropy: table descriptions, and the decoding tables that follow from them.

use crate::array::in_range;
use crate::bits::load_from;
use crate::bounded::Bounded;
use crate::error::{Error, Result};
use crate::format::{FSE_TABLE_LOG_MIN, fse_table_step};

const DESCRIBED_TABLE_LOG_MAX: u32 = 15;

/// What a table description says besides the counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TableDescription {
    /// In bytes.
    pub len: usize,
    pub max_symbol: usize,
    pub table_log: u32,
}

/// Reads the description at the start of `src` into `counts`, which has room for all symbols that are allowed.
pub fn read_normalized_counts(src: &[u8], counts: &mut [i16]) -> Result<TableDescription> {
    counts.fill(0);
    read_counts(src, counts)
}

/// The same for `counts` that are all 0.
#[inline(always)]
pub(crate) fn read_counts(src: &[u8], counts: &mut [i16]) -> Result<TableDescription> {
    const FLAGS_IN_LOAD: u32 = 28;

    let bits_from = |position: usize| load_from(src, position / 8) >> (position % 8);
    let table_log = (bits_from(0) & 15) as u32 + FSE_TABLE_LOG_MIN;
    if table_log > DESCRIBED_TABLE_LOG_MAX {
        return Err(Error::CorruptionDetected);
    }
    let (mut position, mut symbol) = (4usize, 0usize);
    let mut remaining = (1u32 << table_log) + 1;
    // From where the count before started, so that no count waits for a load.
    let (mut loaded, mut loaded_at) = (load_from(src, 0), 0);
    while remaining > 1 {
        let short_width = remaining.ilog2();
        let threshold = 1u32 << short_width;
        let long_mask = threshold.times(2).minus(1);
        let short_values = long_mask.minus(remaining);
        let bits = loaded.wrapping_shr(position.minus(loaded_at) as u32) as u32;
        (loaded, loaded_at) = (load_from(src, position / 8), position & !7);
        let (short, long) = (bits & (threshold - 1), bits & long_mask);
        let is_short = short < short_values;
        let value = if is_short || long < threshold {
            short
        } else {
            long.minus(short_values)
        };
        position = position.plus(short_width as usize + usize::from(!is_short));
        let count = (value as i32).minus(1);
        *counts.get_mut(symbol).ok_or(Error::CorruptionDetected)? = count as i16;
        symbol += 1;
        remaining = remaining.minus(count.unsigned_abs());
        if count != 0 {
            continue;
        }
        loop {
            let flags = bits_from(position);
            let threes = (!flags | 1 << (2 * FLAGS_IN_LOAD)).trailing_zeros() / 2;
            symbol += 3 * threes as usize;
            position += 2 * threes as usize;
            if threes < FLAGS_IN_LOAD {
                symbol += (flags >> (2 * threes) & 3) as usize;
                position += 2;
                break;
            }
        }
        (loaded, loaded_at) = (load_from(src, position / 8), position & !7);
    }
    let len = position.div_ceil(8);
    if len > src.len() {
        return Err(Error::CorruptionDetected);
    }
    Ok(TableDescription {
        len,
        max_symbol: symbol - 1,
        table_log,
    })
}

/// A row of a decoding table.
pub(crate) struct State {
    pub(crate) symbol: u8,
    /// How many bits to add to `baseline` for the next state.
    pub(crate) bits: u32,
    pub(crate) baseline: u16,
}

/// The rows of a decoding table, from the first. `PADDED` is 8 more than there can be.
pub(crate) struct Spread<const PADDED: usize, const SYMBOLS_MAX: usize> {
    symbols: [u8; PADDED],
    /// Where in `symbols` that of the next row is, modulo the size of the table.
    index: usize,
    stride: usize,
    table_log: u32,
    /// By symbol: its count, plus how many of its rows are behind.
    ranks: [u16; SYMBOLS_MAX],
}

impl<const PADDED: usize, const SYMBOLS_MAX: usize> Spread<PADDED, SYMBOLS_MAX> {
    const MAX: usize = PADDED - 8;
    pub(crate) const EMPTY: Self = Self {
        symbols: [0; _],
        index: 0,
        stride: 0,
        table_log: 0,
        ranks: [0; _],
    };

    /// To be called on [`Self::EMPTY`]. `counts` add up to `1 << table_log`, which is at most [`Self::MAX`].
    #[inline(always)]
    #[expect(clippy::indexing_slicing, reason = "below the lengths")]
    pub(crate) const fn fill(&mut self, counts: &[i16], table_log: u32) {
        let size = 1 << table_log;
        let step = fse_table_step(size);
        let Self { symbols, ranks, .. } = self;
        let (mut symbol, mut end, mut rare) = (0, 0usize, 0usize);
        while symbol < counts.len() {
            let count = counts[symbol];
            ranks[in_range::<SYMBOLS_MAX>(symbol)] = count.unsigned_abs();
            rare = rare.plus((count < 0) as usize);
            let mut start = end;
            end = end.plus(if count < 0 { 0 } else { count as usize });
            loop {
                if let Some(eight) = symbols.split_at_mut(start % Self::MAX).1.first_chunk_mut() {
                    *eight = [symbol as u8; 8];
                }
                start = start.plus(8);
                if start >= end {
                    break;
                }
            }
            symbol += 1;
        }
        self.table_log = table_log;
        self.stride = if rare == 0 {
            // Row `i * step` has symbol `i`, so row `i` has symbol `i / step`, modulo the size.
            let inverse = step.wrapping_mul(2usize.wrapping_sub(step * step));
            inverse.wrapping_mul(2usize.wrapping_sub(step.wrapping_mul(inverse)))
        } else {
            let sorted = *symbols;
            let (mut row, mut index) = (0usize, 0usize);
            loop {
                symbols[row % Self::MAX] = sorted[index % Self::MAX];
                index = index.plus((row < end) as usize);
                row = row.plus(step) & (size - 1);
                if row == 0 {
                    break;
                }
            }
            let (mut symbol, mut row) = (0, size);
            while symbol < counts.len() {
                if counts[symbol] < 0 {
                    row -= 1;
                    symbols[row % Self::MAX] = symbol as u8;
                }
                symbol += 1;
            }
            1
        };
    }

    #[inline(always)]
    #[expect(clippy::indexing_slicing, reason = "below the lengths")]
    pub(crate) const fn next_state(&mut self) -> State {
        let size = 1 << self.table_log;
        let symbol = self.symbols[(self.index & (size - 1)) % Self::MAX];
        self.index = self.index.wrapping_add(self.stride);
        let next_rank = &mut self.ranks[in_range::<SYMBOLS_MAX>(symbol as usize)];
        let rank = *next_rank as u32;
        *next_rank = (rank as u16).plus(1);
        let bits = rank.leading_zeros().plus(self.table_log).wrapping_sub(31);
        State {
            symbol,
            bits,
            baseline: rank.wrapping_shl(bits).wrapping_sub(size as u32) as u16,
        }
    }
}
