//! Finite State Entropy: table descriptions, and the decoding tables that follow from them.

use core::hint::select_unpredictable;

use crate::array::At;
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
    let allowed = counts.len().min(256);
    let counts = counts.get_mut(..allowed).ok_or(Error::Internal)?;
    read_counts::<{ 1024 + 8 }>(src, DESCRIBED_TABLE_LOG_MAX, counts)
}

/// The same for the tables that the decoder builds, and `counts` that are all 0.
#[inline(always)]
pub(crate) fn read_few_counts(
    src: &[u8],
    table_log_max: u32,
    counts: &mut [i16],
) -> Result<TableDescription> {
    read_counts::<{ 128 + 8 }>(src, table_log_max, counts)
}

/// No description for as many is longer than `PADDED - 16`.
#[inline(always)]
fn read_counts<const PADDED: usize>(
    src: &[u8],
    table_log_max: u32,
    counts: &mut [i16],
) -> Result<TableDescription> {
    const FLAGS_IN_LOAD: u32 = 28;
    debug_assert!(4 + counts.len() * (table_log_max as usize + 3) <= 8 * (PADDED - 16));

    let mut padded;
    let bytes: &[u8; PADDED] = match src.first_chunk() {
        Some(bytes) => bytes,
        None => {
            padded = [0; _];
            (padded.get_mut(..src.len()).ok_or(Error::Internal)?).copy_from_slice(src);
            &padded
        }
    };
    let bits_from =
        |position: usize| load_from(bytes, position / 8 % (PADDED - 8)) >> (position % 8);
    let first = bits_from(0);
    let table_log = (first & 15) as u32 + FSE_TABLE_LOG_MIN;
    if table_log > table_log_max {
        return Err(Error::CorruptionDetected);
    }
    let (mut position, mut symbol, mut bits) = (4usize, 0usize, (first >> 4) as u32);
    let mut remaining = (1u32 << table_log) + 1;
    while remaining > 1 {
        // For the next count, which does not have to wait for it.
        let loaded = bits_from(position);
        let long_mask = u32::MAX >> remaining.leading_zeros();
        let (short, long_complement) = (bits & long_mask >> 1, !bits & long_mask);
        let width = remaining.bit_width() - u32::from(short < long_mask ^ remaining);
        let is_high = long_complement < remaining - (long_mask >> 1);
        let before = remaining;
        remaining = select_unpredictable(short == 0, before - 1, before.plus(1).minus(short));
        remaining = select_unpredictable(is_high, long_complement.plus(1), remaining);
        let count = select_unpredictable(is_high, before.minus(remaining), short.wrapping_sub(1));
        *counts.get_mut(symbol).ok_or(Error::CorruptionDetected)? = count as i16;
        let rest = (loaded >> width) as u32;
        let (zeros, flag_width);
        (zeros, flag_width, bits) =
            select_unpredictable(remaining == before, (rest & 3, 2, rest >> 2), (0, 0, rest));
        symbol = symbol.plus(1 + zeros as usize);
        position = position.plus((width + flag_width) as usize);
        if zeros != 3 {
            continue;
        }
        while symbol < counts.len() {
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
        bits = bits_from(position) as u32;
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

/// How many symbols are written at once.
pub(crate) const FILL: usize = 64;
/// No table that is decoded has rows for more symbols.
const USED_MAX: usize = 64;

/// The symbols of the rows of a decoding table. `PADDED` is [`FILL`] more than there can be.
pub(crate) struct Spread<const PADDED: usize> {
    /// Row `i` has that at `i * stride`, modulo the size of the table.
    pub(crate) symbols: [u8; PADDED],
    pub(crate) stride: usize,
}

/// Each of `values`, less how many of the first `count` of `others` are below it.
#[inline(always)]
fn less_those_below(
    values: &[i16; USED_MAX],
    others: &[i16; USED_MAX],
    count: usize,
) -> [i16; USED_MAX] {
    let mut results = *values;
    for other in others.iter().take(count) {
        for (result, value) in results.iter_mut().zip(values) {
            *result = result.wrapping_sub((other < value).into());
        }
    }
    results
}

impl<const PADDED: usize> Spread<PADDED> {
    const MAX: usize = PADDED - FILL;
    pub(crate) const EMPTY: Self = Self {
        symbols: [0; _],
        stride: 0,
    };

    /// `counts` add up to `1 << table_log`, and the last is not 0.
    #[inline(always)]
    pub(crate) fn fill(&mut self, counts: &[i16], table_log: u32) {
        let size = 1 << table_log;
        // Row `i * step` is the `i`th to get a symbol, so row `i` is the `i / step`th, modulo the size.
        let step = fse_table_step(size);
        let inverse = step.wrapping_mul(2usize.wrapping_sub(step * step));
        self.stride = inverse.wrapping_mul(2usize.wrapping_sub(step.wrapping_mul(inverse)));
        let mut start = 0usize;
        for (symbol, &count) in counts.iter().enumerate() {
            if count < 0 {
                return self.fill_with_rare(counts, size);
            }
            let end = start.plus(count as usize);
            self.set(start, end, symbol as u8);
            start = end;
        }
    }

    /// And some more.
    #[inline(always)]
    fn set(&mut self, mut start: usize, end: usize, symbol: u8) {
        loop {
            let (_, rest) = self.symbols.split_at_mut(start % Self::MAX);
            if let Some(symbols) = rest.first_chunk_mut() {
                *symbols = [symbol; FILL];
            }
            start = start.plus(FILL);
            if start >= end {
                break;
            }
        }
    }

    /// They get the last rows, which the others skip.
    #[inline(always)]
    fn fill_with_rare(&mut self, counts: &[i16], size: usize) {
        let ([mut common, mut rare], mut starts) = ([[0; USED_MAX]; 2], [0; USED_MAX]);
        let (mut common_len, mut rare_len, mut rows) = (0usize, 0usize, 0i16);
        for (symbol, &count) in counts.iter().enumerate() {
            *common.at_mut(common_len % USED_MAX) = symbol as u8;
            *rare.at_mut(rare_len % USED_MAX) = symbol as u8;
            common_len = common_len.plus((count > 0).into());
            rare_len = rare_len.plus((count < 0).into());
            rows = rows.wrapping_add(count.max(0));
            *starts.at_mut(common_len % USED_MAX) = rows;
        }
        let place = |row: usize| (row as i16).wrapping_mul(self.stride as i16) & (size - 1) as i16;
        let skipped = core::array::from_fn(|index| place(!index));
        let common_rows_before = less_those_below(&skipped, &skipped, rare_len);
        let lowered = less_those_below(&starts, &common_rows_before, rare_len);
        let (mut start, ends) = (0, starts.iter().zip(&lowered).skip(1));
        for (&symbol, (&end, &lowered)) in common.iter().zip(ends).take(common_len) {
            let end = i32::from(end).times(2).minus(lowered.into()) as usize;
            self.set(start, end, symbol);
            start = end;
        }
        for (&place, &symbol) in skipped.iter().zip(&rare).take(rare_len) {
            *self.symbols.at_mut(place as usize % Self::MAX) = symbol;
        }
    }
}
