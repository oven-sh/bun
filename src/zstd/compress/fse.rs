//! `fse_compress.c` and the encoding half of `fse.h`: Finite State Entropy coding.

use crate::common::bitstream::BitCStream;
use crate::common::{FSE_MAX_TABLELOG, FSE_MIN_TABLELOG, MAX_SEQ, ML_FSE_LOG, fse_table_step};
use crate::error::{Error, Result};
use crate::util::{BUG, SliceExt, highbit32, write_le16};

pub(crate) const FSE_NCOUNTBOUND: usize = 512;
const FSE_DEFAULT_TABLELOG: u32 = 11;

/// `FSE_BLOCKBOUND`
const fn block_bound(size: usize) -> usize {
    size + (size >> 7) + 4 + size_of::<usize>()
}

/// `FSE_repeat`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum FseRepeat {
    /// The table cannot be used again.
    None,
    /// It can, if it has a code for every symbol to encode.
    Check,
    /// It can.
    Valid,
}

/// `FSE_symbolCompressionTransform`
#[derive(Clone, Copy, Default)]
pub(crate) struct FseSymbolTransform {
    pub(crate) delta_find_state: i32,
    pub(crate) delta_nb_bits: u32,
}

/// `FSE_CTable`, with room for the largest table zstd makes, which is one for match lengths.
#[derive(Clone)]
pub(crate) struct FseCTable {
    pub(crate) table_log: u32,
    pub(crate) max_symbol_value: u32,
    pub(crate) state_table: [u16; 1 << ML_FSE_LOG],
    /// More than `MAX_SEQ + 1`, so that a masked symbol is known to be in bounds.
    pub(crate) symbol_tt: [FseSymbolTransform; SYMBOL_TT_SIZE],
}

const SYMBOL_TT_SIZE: usize = (MAX_SEQ as usize + 1).next_power_of_two();

/// A table for a distribution that is known in advance, of a table log of at most 6.
pub(crate) struct PredefinedCTable {
    table_log: u32,
    max_symbol_value: u32,
    state_table: [u16; 64],
    symbol_tt: [FseSymbolTransform; SYMBOL_TT_SIZE],
}

impl PredefinedCTable {
    pub(crate) const fn new<const STATES: usize, const SYMBOLS: usize>(
        table_log: u32,
        states: [u16; STATES],
        transforms: [FseSymbolTransform; SYMBOLS],
    ) -> Self {
        let mut table = Self {
            table_log,
            max_symbol_value: SYMBOLS as u32 - 1,
            state_table: [0; 64],
            symbol_tt: FseCTable::new().symbol_tt,
        };
        table
            .state_table
            .split_at_mut(STATES)
            .0
            .copy_from_slice(&states);
        table
            .symbol_tt
            .split_at_mut(SYMBOLS)
            .0
            .copy_from_slice(&transforms);
        table
    }
}

impl FseCTable {
    pub(crate) const fn new() -> Self {
        Self {
            table_log: 0,
            max_symbol_value: 0,
            state_table: [0; 1 << ML_FSE_LOG],
            symbol_tt: [FseSymbolTransform {
                delta_find_state: 0,
                delta_nb_bits: 0,
            }; SYMBOL_TT_SIZE],
        }
    }

    /// `FSE_buildCTable_wksp`: `normalized_counter` adds up to `1 << table_log`, a count of -1 standing for 1.
    /// [`Error::TableLogTooLarge`] if the table has no room for it.
    pub(crate) fn build(
        &mut self,
        normalized_counter: &[i16],
        max_symbol_value: u32,
        table_log: u32,
    ) -> Result<()> {
        if table_log > ML_FSE_LOG || max_symbol_value > MAX_SEQ {
            return Err(Error::TableLogTooLarge);
        }
        let table_size = 1usize << table_log;
        let table_mask = table_size - 1;
        let step = fse_table_step(table_size);
        let counts = normalized_counter.sub(..=max_symbol_value as usize)?;

        const STATE_TABLE_SIZE: usize = 1 << ML_FSE_LOG;
        const CUMUL_SIZE: usize = (MAX_SEQ as usize + 1).next_power_of_two();
        let mut cumul = [0u16; CUMUL_SIZE];
        let mut table_symbol = [0u8; STATE_TABLE_SIZE];
        let mut high_threshold = table_size - 1;

        self.table_log = table_log;
        self.max_symbol_value = max_symbol_value;

        // Where the states of each symbol start. The symbols of low probability get the highest positions.
        let mut total = 0u16;
        for (symbol, (&count, start)) in counts.iter().zip(&mut cumul).enumerate() {
            *start = total;
            if count == -1 {
                total = total.wrapping_add(1);
                table_symbol.put(high_threshold, symbol as u8)?;
                high_threshold = high_threshold.wrapping_sub(1);
            } else {
                total = total.wrapping_add(count as u16);
            }
        }

        // Spread the symbols.
        if high_threshold == table_size - 1 {
            // No symbol of low probability: lay the symbols down in order, and then every position is used.
            let mut spread = [0u8; (1 << ML_FSE_LOG) + 8];
            let mut pos = 0usize;
            let mut sv = 0u64;
            for &count in counts {
                let n = usize::try_from(count).map_err(|_| BUG)?;
                *spread.array_at_mut(pos)? = sv.to_le_bytes();
                for i in (8..n).step_by(8) {
                    *spread.array_at_mut(pos + i)? = sv.to_le_bytes();
                }
                pos += n;
                sv = sv.wrapping_add(0x0101_0101_0101_0101);
            }

            let mut position = 0usize;
            let (pairs, _) = spread.sub(..table_size)?.as_chunks::<2>();
            for &[first, second] in pairs {
                table_symbol.put(position, first)?;
                table_symbol.put((position + step) & table_mask, second)?;
                position = (position + 2 * step) & table_mask;
            }
        } else {
            let mut position = 0usize;
            for (symbol, &freq) in counts.iter().enumerate() {
                for _ in 0..freq {
                    table_symbol.put(position, symbol as u8)?;
                    position = (position + step) & table_mask;
                    while position > high_threshold {
                        position = (position + step) & table_mask;
                    }
                }
            }
        }

        // The states, sorted by symbol.
        for (u, &symbol) in table_symbol.sub(..table_size)?.iter().enumerate() {
            let Some(next) = cumul.get_mut(usize::from(symbol) & (CUMUL_SIZE - 1)) else {
                continue;
            };
            let state = usize::from(*next) & (STATE_TABLE_SIZE - 1);
            *next = next.wrapping_add(1);
            if let Some(state) = self.state_table.get_mut(state) {
                *state = (table_size + u) as u16;
            }
        }

        let mut total = 0u32;
        for (&count, transform) in counts.iter().zip(&mut self.symbol_tt) {
            match count {
                // For `get_max_nb_bits` and `bit_cost`.
                0 => transform.delta_nb_bits = ((table_log + 1) << 16) - (1 << table_log),
                -1 | 1 => {
                    transform.delta_nb_bits = (table_log << 16).wrapping_sub(1 << table_log);
                    transform.delta_find_state = total.wrapping_sub(1) as i32;
                    total += 1;
                }
                _ => {
                    let count = count as u32;
                    let max_bits_out = table_log.wrapping_sub(highbit32(count.wrapping_sub(1)));
                    let min_state_plus = count.wrapping_shl(max_bits_out);
                    transform.delta_nb_bits = (max_bits_out << 16).wrapping_sub(min_state_plus);
                    transform.delta_find_state = total.wrapping_sub(count) as i32;
                    total = total.wrapping_add(count);
                }
            }
        }
        Ok(())
    }

    /// What [`Self::build`] does for the distribution that `table` was made for.
    pub(crate) fn set_predefined(&mut self, table: &PredefinedCTable) {
        self.table_log = table.table_log;
        self.max_symbol_value = table.max_symbol_value;
        if let Some(states) = self.state_table.first_chunk_mut() {
            *states = table.state_table;
        }
        self.symbol_tt = table.symbol_tt;
    }

    /// `FSE_buildCTable_rle`: a table that encodes `symbol_value`, and nothing else, in 0 bits.
    pub(crate) fn build_rle(&mut self, symbol_value: u8) -> Result<()> {
        self.table_log = 0;
        self.max_symbol_value = u32::from(symbol_value);
        self.state_table.sub_mut(..2)?.fill(0);
        self.symbol_tt
            .put(usize::from(symbol_value), FseSymbolTransform::default())
    }

    /// `FSE_initCState2`: the state that it costs the fewest bits to start from, given that the first symbol is `symbol`,
    /// which the table has a code for.
    #[inline]
    pub(crate) fn first_state(&self, symbol: u8) -> u32 {
        FseCState::new2(self, u32::from(symbol)).value as u32
    }

    /// `FSE_getMaxNbBits`: the most bits it takes to encode `symbol_value`, rounded up. One more than the table log
    /// if the table has no code for it.
    #[inline(always)]
    pub(crate) fn get_max_nb_bits(&self, symbol_value: u32) -> u32 {
        let transform = self.symbol_tt.at(symbol_value as usize).unwrap_or_default();
        transform.delta_nb_bits.wrapping_add((1 << 16) - 1) >> 16
    }

    /// `FSE_bitCost`: about how many bits it takes to encode `symbol_value`, in units of `1 / (1 << accuracy_log)`.
    /// The table has a code for it.
    #[inline(always)]
    pub(crate) fn bit_cost(&self, symbol_value: u32, accuracy_log: u32) -> u32 {
        let transform = self.symbol_tt.at(symbol_value as usize).unwrap_or_default();
        let min_nb_bits = transform.delta_nb_bits >> 16;
        let threshold = (min_nb_bits + 1) << 16;
        let table_size = 1u32 << self.table_log;
        let delta_from_threshold =
            threshold.wrapping_sub(transform.delta_nb_bits.wrapping_add(table_size));
        // A linear interpolation, which is very approximate.
        let normalized_delta_from_threshold =
            (delta_from_threshold << accuracy_log) >> self.table_log;
        let bit_multiplier = 1u32 << accuracy_log;
        ((min_nb_bits + 1) * bit_multiplier).wrapping_sub(normalized_delta_from_threshold)
    }
}

/// `FSE_CState_t`
pub(crate) struct FseCState<'a> {
    value: usize,
    table: &'a FseCTable,
}

impl<'a> FseCState<'a> {
    /// `FSE_initCState`
    #[inline]
    pub(crate) fn new(table: &'a FseCTable) -> Self {
        Self {
            value: 1 << (table.table_log & 15),
            table,
        }
    }

    /// `FSE_initCState2`: the first symbol costs the fewest bits this way. The table has a code for `symbol`.
    #[inline]
    pub(crate) fn new2(table: &'a FseCTable, symbol: u32) -> Self {
        let mut state = Self::new(table);
        let transform = table.symbol_tt.at(symbol as usize).unwrap_or_default();
        let nb_bits_out = transform.delta_nb_bits.wrapping_add(1 << 15) >> 16;
        state.value = (nb_bits_out << 16).wrapping_sub(transform.delta_nb_bits) as usize;
        state.step(nb_bits_out, transform.delta_find_state);
        state
    }

    #[inline(always)]
    fn step(&mut self, nb_bits_out: u32, delta_find_state: i32) {
        let state_table = &self.table.state_table;
        let index = (self.value >> (nb_bits_out & (usize::BITS - 1)))
            .wrapping_add_signed(delta_find_state as isize);
        let next = state_table.get(index & (state_table.len() - 1));
        self.value = usize::from(next.copied().unwrap_or(0));
    }

    /// `FSE_encodeSymbol`: the table has a code for `symbol`.
    #[inline(always)]
    pub(crate) fn encode_symbol(&mut self, bit_c: &mut BitCStream<'_>, symbol: u32) {
        let symbol_tt = &self.table.symbol_tt;
        let transform = symbol_tt
            .at(symbol as usize & (SYMBOL_TT_SIZE - 1))
            .unwrap_or_default();
        let nb_bits_out = ((self.value + transform.delta_nb_bits as usize) >> 16) as u32;
        bit_c.add_bits(self.value as u64, nb_bits_out);
        self.step(nb_bits_out, transform.delta_find_state);
    }

    /// `FSE_flushCState`
    #[inline(always)]
    pub(crate) fn flush(&self, bit_c: &mut BitCStream<'_>) {
        bit_c.add_bits(self.value as u64, self.table.table_log);
        bit_c.flush_bits();
    }
}

/// `FSE_NCountWriteBound`
pub(crate) fn ncount_write_bound(max_symbol_value: u32, table_log: u32) -> usize {
    let max_header_size =
        ((max_symbol_value as usize + 1) * table_log as usize + 4 + 2) / 8 + 1 + 2;
    if max_symbol_value != 0 {
        max_header_size
    } else {
        FSE_NCOUNTBOUND
    }
}

/// `FSE_writeNCount_generic`: `table_log` is from 5 to 12.
fn write_ncount_generic(
    header: &mut [u8],
    normalized_counter: &[i16],
    max_symbol_value: u32,
    table_log: u32,
    write_is_safe: bool,
) -> Result<usize> {
    let counts = normalized_counter.sub(..=max_symbol_value as usize)?;
    let alphabet_size = counts.len();
    let mut out = 0usize;
    let table_size = 1i32 << table_log;
    let mut bit_stream = table_log - FSE_MIN_TABLELOG;
    let mut bit_count = 4i32;
    let mut symbol = 0usize;
    let mut previous_is_0 = false;

    // The lowest 16 bits of the stream leave it.
    let mut write16 = |bit_stream: &mut u32, out: &mut usize| -> Result<()> {
        if !write_is_safe && *out + 2 > header.len() {
            return Err(Error::DstSizeTooSmall);
        }
        write_le16(header, *out, *bit_stream as u16)?;
        *out += 2;
        *bit_stream >>= 16;
        Ok(())
    };
    let shifted = |value: u32, bit_count: i32| value.wrapping_shl(bit_count as u32);

    let mut remaining = table_size + 1;
    let mut threshold = table_size;
    let mut nb_bits = table_log as i32 + 1;

    while symbol < alphabet_size && remaining > 1 {
        if previous_is_0 {
            // After a count of 0 comes how many more follow it.
            let mut start = symbol;
            while symbol < alphabet_size && counts.at(symbol)? == 0 {
                symbol += 1;
            }
            if symbol == alphabet_size {
                // The counts do not add up.
                break;
            }
            while symbol >= start + 24 {
                start += 24;
                bit_stream = bit_stream.wrapping_add(shifted(0xFFFF, bit_count));
                write16(&mut bit_stream, &mut out)?;
            }
            while symbol >= start + 3 {
                start += 3;
                bit_stream = bit_stream.wrapping_add(shifted(3, bit_count));
                bit_count += 2;
            }
            bit_stream = bit_stream.wrapping_add(shifted((symbol - start) as u32, bit_count));
            bit_count += 2;
            if bit_count > 16 {
                write16(&mut bit_stream, &mut out)?;
                bit_count -= 16;
            }
        }
        {
            let mut count = i32::from(counts.at(symbol)?);
            symbol += 1;
            let max = (2 * threshold - 1) - remaining;
            remaining -= count.abs();
            // The stored value is the count plus one, since a count can be -1.
            count += 1;
            if count >= threshold {
                count += max;
            }
            bit_stream = bit_stream.wrapping_add(shifted(count as u32, bit_count));
            bit_count += nb_bits;
            bit_count -= i32::from(count < max);
            previous_is_0 = count == 1;
            if remaining < 1 {
                return Err(Error::Generic);
            }
            while remaining < threshold {
                nb_bits -= 1;
                threshold >>= 1;
            }
        }
        if bit_count > 16 {
            write16(&mut bit_stream, &mut out)?;
            bit_count -= 16;
        }
    }

    if remaining != 1 {
        return Err(Error::Generic);
    }

    let last = out;
    write16(&mut bit_stream, &mut out)?;
    Ok(last + ((bit_count + 7) / 8) as usize)
}

/// `FSE_writeNCount`: writes the header that [`crate::common::entropy::read_ncount`] reads, and returns its size.
pub(crate) fn write_ncount(
    buffer: &mut [u8],
    normalized_counter: &[i16],
    max_symbol_value: u32,
    table_log: u32,
) -> Result<usize> {
    if table_log > FSE_MAX_TABLELOG {
        return Err(Error::TableLogTooLarge);
    }
    if table_log < FSE_MIN_TABLELOG {
        return Err(Error::Generic);
    }
    let write_is_safe = buffer.len() >= ncount_write_bound(max_symbol_value, table_log);
    write_ncount_generic(
        buffer,
        normalized_counter,
        max_symbol_value,
        table_log,
        write_is_safe,
    )
}

/// `FSE_minTableLog`: the smallest table log that can represent the distribution. `src_size` is more than 1.
fn min_table_log(src_size: usize, max_symbol_value: u32) -> u32 {
    let min_bits_src = highbit32(src_size as u32) + 1;
    let min_bits_symbols = highbit32(max_symbol_value) + 2;
    min_bits_src.min(min_bits_symbols)
}

/// `FSE_optimalTableLog_internal`: `src_size` is more than 1.
pub(crate) fn optimal_table_log_internal(
    max_table_log: u32,
    src_size: usize,
    max_symbol_value: u32,
    minus: u32,
) -> u32 {
    let max_bits_src = highbit32(src_size.wrapping_sub(1) as u32).wrapping_sub(minus);
    let mut table_log = max_table_log;
    let min_bits = min_table_log(src_size, max_symbol_value);
    if table_log == 0 {
        table_log = FSE_DEFAULT_TABLELOG;
    }
    // More accuracy than the input has symbols for is of no use.
    if max_bits_src < table_log {
        table_log = max_bits_src;
    }
    if min_bits > table_log {
        table_log = min_bits;
    }
    table_log.clamp(FSE_MIN_TABLELOG, FSE_MAX_TABLELOG)
}

/// `FSE_optimalTableLog`
pub(crate) fn optimal_table_log(max_table_log: u32, src_size: usize, max_symbol_value: u32) -> u32 {
    optimal_table_log_internal(max_table_log, src_size, max_symbol_value, 2)
}

/// `FSE_normalizeM2`: the second normalization method, for when the first one would take too much from the most
/// frequent symbol. `norm` and `count` are of the same length.
fn normalize_m2(
    norm: &mut [i16],
    table_log: u32,
    count: &[u32],
    mut total: usize,
    low_prob_count: i16,
) -> Result<()> {
    const NOT_YET_ASSIGNED: i16 = -2;
    let table_size = 1u32 << table_log;
    let mut distributed = 0u32;

    // The symbols of low probability first.
    let low_threshold = (total >> table_log) as u32;
    let mut low_one = (total.wrapping_mul(3) >> (table_log + 1)) as u32;

    for (norm, &count) in norm.iter_mut().zip(count) {
        if count == 0 {
            *norm = 0;
        } else if count <= low_threshold {
            *norm = low_prob_count;
            distributed += 1;
            total = total.wrapping_sub(count as usize);
        } else if count <= low_one {
            *norm = 1;
            distributed += 1;
            total = total.wrapping_sub(count as usize);
        } else {
            *norm = NOT_YET_ASSIGNED;
        }
    }
    let mut to_distribute = table_size.wrapping_sub(distributed);

    if to_distribute == 0 {
        return Ok(());
    }

    if total / to_distribute as usize > low_one as usize {
        // The rest would get too much each: more symbols get 1.
        low_one = total
            .wrapping_mul(3)
            .checked_div(to_distribute.wrapping_mul(2) as usize)
            .ok_or(BUG)? as u32;
        for (norm, &count) in norm.iter_mut().zip(count) {
            if *norm == NOT_YET_ASSIGNED && count <= low_one {
                *norm = 1;
                distributed += 1;
                total = total.wrapping_sub(count as usize);
            }
        }
        to_distribute = table_size.wrapping_sub(distributed);
    }

    if distributed as usize == count.len() {
        // All the values are small. The first symbol of the largest count gets what is left.
        let mut max_v = 0usize;
        let mut max_c = 0u32;
        for (s, &count) in count.iter().enumerate() {
            if count > max_c {
                max_v = s;
                max_c = count;
            }
        }
        let norm = norm.at_mut(max_v)?;
        *norm = norm.wrapping_add(to_distribute as i16);
        return Ok(());
    }

    if total == 0 {
        // All the symbols were of low enough probability to get 1 or less: what is left goes round.
        if !norm.iter().any(|&norm| norm > 0) {
            return Err(BUG);
        }
        while to_distribute > 0 {
            for norm in norm.iter_mut().filter(|norm| **norm > 0) {
                if to_distribute == 0 {
                    break;
                }
                to_distribute -= 1;
                *norm = norm.wrapping_add(1);
            }
        }
        return Ok(());
    }

    let v_step_log = 62 - table_log;
    let mid = (1u64 << (v_step_log - 1)) - 1;
    // A scale on what remains.
    let r_step = ((1u64 << v_step_log) * u64::from(to_distribute) + mid)
        .checked_div(u64::from(total as u32))
        .ok_or(BUG)?;
    let mut tmp_total = mid;
    for (norm, &count) in norm.iter_mut().zip(count) {
        if *norm == NOT_YET_ASSIGNED {
            let end = tmp_total.wrapping_add(u64::from(count).wrapping_mul(r_step));
            let s_start = (tmp_total >> v_step_log) as u32;
            let s_end = (end >> v_step_log) as u32;
            let weight = s_end.wrapping_sub(s_start);
            if weight < 1 {
                return Err(Error::Generic);
            }
            *norm = weight as i16;
            tmp_total = end;
        }
    }
    Ok(())
}

/// `FSE_normalizeCount`: scales `count`, which adds up to `total`, to add up to `1 << table_log`. Returns the table
/// log, or 0 if there is only one symbol, which is a case for run-length encoding.
pub(crate) fn normalize_count(
    normalized_counter: &mut [i16],
    mut table_log: u32,
    count: &[u32],
    total: usize,
    max_symbol_value: u32,
    use_low_prob_count: bool,
) -> Result<usize> {
    if table_log == 0 {
        table_log = FSE_DEFAULT_TABLELOG;
    }
    if table_log < FSE_MIN_TABLELOG {
        return Err(Error::Generic);
    }
    if table_log > FSE_MAX_TABLELOG {
        return Err(Error::TableLogTooLarge);
    }
    if table_log < min_table_log(total, max_symbol_value) {
        return Err(Error::Generic);
    }

    const RTB_TABLE: [u32; 8] = [0, 473195, 504333, 520860, 550000, 700000, 750000, 830000];
    let low_prob_count: i16 = if use_low_prob_count { -1 } else { 1 };
    let scale = 62 - table_log;
    let step = (1u64 << 62)
        .checked_div(u64::from(total as u32))
        .ok_or(BUG)?;
    let v_step = 1u64 << (scale - 20);
    let mut still_to_distribute = 1i32 << table_log;
    let mut largest = 0usize;
    let mut largest_p = 0i16;
    let low_threshold = (total >> table_log) as u32;

    let count = count.sub(..=max_symbol_value as usize)?;
    let norm = normalized_counter.sub_mut(..=max_symbol_value as usize)?;

    for (s, (norm, &count)) in norm.iter_mut().zip(count).enumerate() {
        if count as usize == total {
            return Ok(0);
        }
        if count == 0 {
            *norm = 0;
        } else if count <= low_threshold {
            *norm = low_prob_count;
            still_to_distribute -= 1;
        } else {
            let scaled = u64::from(count).wrapping_mul(step);
            let mut proba = (scaled >> scale) as i16;
            if proba < 8 {
                let rest_to_beat = v_step * u64::from(RTB_TABLE.at(proba as usize)?);
                proba += i16::from(scaled.wrapping_sub((proba as u64) << scale) > rest_to_beat);
            }
            if proba > largest_p {
                largest_p = proba;
                largest = s;
            }
            *norm = proba;
            still_to_distribute -= i32::from(proba);
        }
    }
    let largest = norm.at_mut(largest)?;
    if -still_to_distribute >= i32::from(*largest >> 1) {
        // The correction is too large for one symbol to take.
        normalize_m2(norm, table_log, count, total, low_prob_count)?;
    } else {
        *largest = largest.wrapping_add(still_to_distribute as i16);
    }
    Ok(table_log as usize)
}

/// `FSE_compress_usingCTable_generic`
#[inline(always)]
fn compress_using_ctable_generic<const FAST: bool>(
    dst: &mut [u8],
    src: &[u8],
    ct: &FseCTable,
) -> usize {
    let flush = |bit_c: &mut BitCStream<'_>| {
        if FAST {
            bit_c.flush_bits_fast();
        } else {
            bit_c.flush_bits();
        }
    };

    if src.len() <= 2 {
        return 0;
    }
    let Ok(mut bit_c) = BitCStream::new(dst) else {
        return 0;
    };
    let encode = |state: &mut FseCState<'_>, bit_c: &mut BitCStream<'_>, symbol: u8| {
        state.encode_symbol(bit_c, u32::from(symbol));
    };

    // From the last symbol to the first, two states taking turns.
    let mut state1;
    let mut state2;
    let mut rest;
    if src.len() & 1 != 0 {
        let [head @ .., c, b, a] = src else {
            return 0;
        };
        state1 = FseCState::new2(ct, u32::from(*a));
        state2 = FseCState::new2(ct, u32::from(*b));
        encode(&mut state1, &mut bit_c, *c);
        flush(&mut bit_c);
        rest = head;
    } else {
        let [head @ .., b, a] = src else {
            return 0;
        };
        state2 = FseCState::new2(ct, u32::from(*a));
        state1 = FseCState::new2(ct, u32::from(*b));
        rest = head;
    }

    if let ([head @ .., b, a], true) = (rest, rest.len() & 2 != 0) {
        encode(&mut state2, &mut bit_c, *a);
        encode(&mut state1, &mut bit_c, *b);
        flush(&mut bit_c);
        rest = head;
    }

    let (_, quads) = rest.as_rchunks::<4>();
    for &[d, c, b, a] in quads.iter().rev() {
        encode(&mut state2, &mut bit_c, a);
        encode(&mut state1, &mut bit_c, b);
        encode(&mut state2, &mut bit_c, c);
        encode(&mut state1, &mut bit_c, d);
        flush(&mut bit_c);
    }

    state2.flush(&mut bit_c);
    state1.flush(&mut bit_c);
    bit_c.close()
}

/// `FSE_compress_usingCTable`: the table has a code for every symbol in `src`. Returns the size of the output, or 0
/// if `src` has less than 3 symbols or `dst` is too small.
pub(crate) fn compress_using_ctable(dst: &mut [u8], src: &[u8], ct: &FseCTable) -> usize {
    if dst.len() >= block_bound(src.len()) {
        compress_using_ctable_generic::<true>(dst, src, ct)
    } else {
        compress_using_ctable_generic::<false>(dst, src, ct)
    }
}
