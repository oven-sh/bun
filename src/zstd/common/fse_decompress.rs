//! `fse_decompress.c`. zstd only decodes the weights of a Huffman table this way: sequences have their own decoder.

use super::bitstream::{BitDStream, DStreamStatus};
use super::entropy::read_ncount;
use super::{FSE_MAX_SYMBOL_VALUE, FSE_MAX_TABLELOG, fse_table_step};
use crate::error::{ErrorCode, Result};
use crate::util::{SliceExt, highbit32};

/// The largest table log of the weights of a Huffman table.
const MAX_LOG: u32 = 6;

/// `FSE_decode_t`
#[derive(Clone, Copy, Default)]
struct FseDecode {
    new_state: u16,
    symbol: u8,
    nb_bits: u8,
}

/// `FSE_DTable`
struct FseDTable {
    table_log: u32,
    /// Every state reads at least one bit.
    fast_mode: bool,
    table: [FseDecode; 1 << MAX_LOG],
}

// The C code carves its tables out of a workspace of `HUF_READ_STATS_WORKSPACE_SIZE` bytes, and refuses the headers
// whose tables do not fit.
const fn dtable_size_u32(table_log: u32) -> usize {
    1 + (1 << table_log)
}
const fn build_dtable_wksp_size(table_log: u32, max_symbol_value: u32) -> usize {
    size_of::<i16>() * (max_symbol_value as usize + 1) + (1 << table_log) + 8
}
const fn decompress_wksp_size(table_log: u32, max_symbol_value: u32) -> usize {
    (dtable_size_u32(table_log)
        + 1
        + build_dtable_wksp_size(table_log, max_symbol_value).div_ceil(size_of::<u32>())
        + NCOUNT_SIZE / size_of::<u32>()
        + 1)
        * size_of::<u32>()
}
const WKSP_SIZE: usize = decompress_wksp_size(MAX_LOG, super::HUF_TABLELOG_MAX - 1);
const NCOUNT_SIZE: usize = size_of::<i16>() * (FSE_MAX_SYMBOL_VALUE as usize + 1);

/// `FSE_buildDTable_internal`
fn build_dtable(
    dt: &mut FseDTable,
    normalized_counter: &[i16],
    max_symbol_value: u32,
    table_log: u32,
    wksp_size: usize,
) -> Result<()> {
    let mut symbol_next = [0u16; FSE_MAX_SYMBOL_VALUE as usize + 1];
    let max_sv1 = max_symbol_value as usize + 1;
    let table_size = 1usize << table_log;
    let mut high_threshold = table_size - 1;

    if build_dtable_wksp_size(table_log, max_symbol_value) > wksp_size {
        return Err(ErrorCode::MaxSymbolValueTooLarge);
    }
    if max_symbol_value > FSE_MAX_SYMBOL_VALUE {
        return Err(ErrorCode::MaxSymbolValueTooLarge);
    }
    if table_log > FSE_MAX_TABLELOG {
        return Err(ErrorCode::TableLogTooLarge);
    }
    let counts = normalized_counter.sub(..max_sv1)?;

    dt.table_log = table_log;
    dt.fast_mode = true;
    let large_limit = 1i16 << (table_log - 1);
    for (s, (&count, next)) in counts.iter().zip(&mut symbol_next).enumerate() {
        if count == -1 {
            dt.table.at_mut(high_threshold)?.symbol = s as u8;
            high_threshold = high_threshold.wrapping_sub(1);
            *next = 1;
        } else {
            if count >= large_limit {
                dt.fast_mode = false;
            }
            *next = count as u16;
        }
    }

    let table_mask = table_size - 1;
    let step = fse_table_step(table_size);
    let mut position = 0usize;
    for (s, &count) in counts.iter().enumerate() {
        for _ in 0..count {
            dt.table.at_mut(position)?.symbol = s as u8;
            position = (position + step) & table_mask;
            while position > high_threshold {
                position = (position + step) & table_mask;
            }
        }
    }
    if position != 0 {
        return Err(ErrorCode::Generic);
    }

    for entry in dt.table.sub_mut(..table_size)? {
        let next = symbol_next.at_mut(usize::from(entry.symbol))?;
        let next_state = u32::from(*next);
        *next = next.wrapping_add(1);
        entry.nb_bits = (table_log - highbit32(next_state)) as u8;
        entry.new_state = ((next_state << entry.nb_bits) as usize).wrapping_sub(table_size) as u16;
    }
    Ok(())
}

/// `FSE_DState_t`
struct FseDState {
    state: usize,
}

impl FseDState {
    /// `FSE_initDState`
    #[inline]
    fn new(bit_d: &mut BitDStream<'_>, dt: &FseDTable) -> Self {
        let state = bit_d.read_bits(dt.table_log) as usize;
        bit_d.reload();
        Self { state }
    }

    /// `FSE_decodeSymbol` and `FSE_decodeSymbolFast`
    #[inline(always)]
    fn decode_symbol<const FAST: bool>(
        &mut self,
        bit_d: &mut BitDStream<'_>,
        dt: &FseDTable,
    ) -> Result<u8> {
        let info = dt.table.at(self.state)?;
        let nb_bits = u32::from(info.nb_bits);
        let low_bits = if FAST {
            bit_d.read_bits_fast(nb_bits)
        } else {
            bit_d.read_bits(nb_bits)
        };
        self.state = usize::from(info.new_state) + low_bits as usize;
        Ok(info.symbol)
    }
}

/// `FSE_decompress_usingDTable_generic`
fn decompress_using_dtable<const FAST: bool>(
    dst: &mut [u8],
    src: &[u8],
    dt: &FseDTable,
) -> Result<usize> {
    let omax = dst.len();
    let mut op = 0usize;

    let mut bit_d = BitDStream::new(src)?;
    let mut state1 = FseDState::new(&mut bit_d, dt);
    let mut state2 = FseDState::new(&mut bit_d, dt);
    if bit_d.reload() == DStreamStatus::Overflow {
        return Err(ErrorCode::CorruptionDetected);
    }

    while (bit_d.reload() == DStreamStatus::Unfinished) & (op + 3 < omax) {
        *dst.array_at_mut(op)? = [
            state1.decode_symbol::<FAST>(&mut bit_d, dt)?,
            state2.decode_symbol::<FAST>(&mut bit_d, dt)?,
            state1.decode_symbol::<FAST>(&mut bit_d, dt)?,
            state2.decode_symbol::<FAST>(&mut bit_d, dt)?,
        ];
        op += 4;
    }

    loop {
        if op + 2 > omax {
            return Err(ErrorCode::DstSizeTooSmall);
        }
        dst.put(op, state1.decode_symbol::<FAST>(&mut bit_d, dt)?)?;
        op += 1;
        if bit_d.reload() == DStreamStatus::Overflow {
            dst.put(op, state2.decode_symbol::<FAST>(&mut bit_d, dt)?)?;
            op += 1;
            break;
        }

        if op + 2 > omax {
            return Err(ErrorCode::DstSizeTooSmall);
        }
        dst.put(op, state2.decode_symbol::<FAST>(&mut bit_d, dt)?)?;
        op += 1;
        if bit_d.reload() == DStreamStatus::Overflow {
            dst.put(op, state1.decode_symbol::<FAST>(&mut bit_d, dt)?)?;
            op += 1;
            break;
        }
    }
    Ok(op)
}

/// `FSE_decompress_wksp_bmi2`, as `HUF_readStats` calls it. Returns how many weights there are.
pub(crate) fn fse_decompress_weights(dst: &mut [u8], src: &[u8]) -> Result<usize> {
    let mut ncount = [0i16; FSE_MAX_SYMBOL_VALUE as usize + 1];
    let header = read_ncount(&mut ncount, FSE_MAX_SYMBOL_VALUE, src)?;
    if header.table_log > MAX_LOG {
        return Err(ErrorCode::TableLogTooLarge);
    }
    let body = src.sub(header.size..)?;

    if decompress_wksp_size(header.table_log, header.max_symbol_value) > WKSP_SIZE {
        return Err(ErrorCode::TableLogTooLarge);
    }
    let wksp_size = WKSP_SIZE - NCOUNT_SIZE - dtable_size_u32(header.table_log) * size_of::<u32>();

    let mut dtable = FseDTable {
        table_log: 0,
        fast_mode: false,
        table: [FseDecode::default(); 1 << MAX_LOG],
    };
    build_dtable(
        &mut dtable,
        &ncount,
        header.max_symbol_value,
        header.table_log,
        wksp_size,
    )?;

    if dtable.fast_mode {
        decompress_using_dtable::<true>(dst, body, &dtable)
    } else {
        decompress_using_dtable::<false>(dst, body, &dtable)
    }
}
