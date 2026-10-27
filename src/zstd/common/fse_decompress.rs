//! `fse_decompress.c`. zstd only decodes the weights of a Huffman table this way: sequences have their own decoder.

use super::bitstream::BitDStream;
use super::entropy::read_ncount;
use super::{FSE_MAX_SYMBOL_VALUE, FSE_MAX_TABLELOG, fse_table_step};
use crate::error::{ErrorCode, Result};
use crate::util::{SliceExt, write_le64};

/// The largest table log of the weights of a Huffman table.
const MAX_LOG: u32 = 6;

/// `FSE_decode_t`
#[derive(Clone, Copy)]
struct FseDecode {
    new_state: u8,
    symbol: u8,
    nb_bits: u8,
    /// As many bits set as `nb_bits`.
    mask: u8,
}

impl FseDecode {
    const EMPTY: Self = Self {
        new_state: 0,
        symbol: 0,
        nb_bits: 0,
        mask: 0,
    };
}

/// `FSE_DTable`
struct FseDTable {
    table_log: u32,
    table: [FseDecode; 1 << MAX_LOG],
}

/// Where a state leads: to `state` and what the next `nb_bits` are.
pub(crate) struct NextState {
    pub(crate) state: u16,
    pub(crate) nb_bits: u8,
}

impl NextState {
    /// That of the `n`th state of a symbol that has `count` of them, in a table of `size`, for `2 * size + count + n`.
    pub(crate) const fn at(index: u32) -> Self {
        let mut next = Self {
            state: 0,
            nb_bits: 0,
        };
        if index >= 4 {
            let table_log = index.ilog2() - 1;
            let next_state = index - (2 << table_log);
            if next_state != 0 {
                let nb_bits = table_log - next_state.ilog2();
                next.state = ((next_state << nb_bits) - (1 << table_log)) as u16;
                next.nb_bits = nb_bits as u8;
            }
        }
        next
    }
}

/// [`NextState::at`] as an [`FseDecode`] of symbol 0.
static NEXT_STATES: [FseDecode; 4 << MAX_LOG] = {
    let mut all = [FseDecode::EMPTY; 4 << MAX_LOG];
    let mut left: &mut [FseDecode] = &mut all;
    let mut index = 0;
    while let [decode, others @ ..] = left {
        let NextState { state, nb_bits } = NextState::at(index);
        *decode = FseDecode {
            new_state: state as u8,
            symbol: 0,
            nb_bits,
            mask: ((1u32 << nb_bits) - 1) as u8,
        };
        index += 1;
        left = others;
    }
    all
};

/// The largest table that [`Spread`] is for.
pub(crate) const MAX_SPREAD_SIZE: usize = 1 << 9;

/// Which symbol each state of a table decodes: what tables are built from.
#[derive(Clone)]
pub(crate) struct Spread {
    /// The symbols, each as many times as it has states.
    in_order: [u8; MAX_SPREAD_SIZE + 8],
    /// The symbol of each state.
    by_state: [u8; MAX_SPREAD_SIZE + 8],
    /// For each symbol, what to give [`NextState::at`] for its next state.
    symbol_next: [u16; FSE_MAX_SYMBOL_VALUE as usize + 1],
    /// The symbols of low probability.
    rare: [u8; FSE_MAX_SYMBOL_VALUE as usize + 1],
    /// Room for the counts that all that is made from.
    pub(crate) counts: [i16; FSE_MAX_SYMBOL_VALUE as usize + 1],
}

impl Spread {
    pub(crate) const fn new() -> Self {
        Self {
            in_order: [0; _],
            by_state: [0; _],
            symbol_next: [0; _],
            rare: [0; _],
            counts: [0; _],
        }
    }

    /// The first two passes of `FSE_buildDTable` and `ZSTD_buildFSETable`, with few branches to mispredict, for the
    /// first `nb_symbols` of `counts`. They add up to the size of the table, which is at most [`MAX_SPREAD_SIZE`].
    pub(crate) fn states(&mut self, nb_symbols: usize, table_log: u32) -> Result<States<'_>> {
        let table_size = 1usize << table_log;
        let table_mask = table_size - 1;
        let step = fse_table_step(table_size);
        // What `step` times this is 1 more than a multiple of the size of the table.
        let mut stride = step;
        for _ in 0..2 {
            stride = stride.wrapping_mul(2usize.wrapping_sub(step.wrapping_mul(stride)));
        }
        let mut nb_rare = 0usize;
        let mut nb_in_order = 0usize;
        let mut eight_times = 0u64;
        for ((symbol, &count), next) in self
            .counts
            .sub(..nb_symbols)?
            .iter()
            .enumerate()
            .zip(&mut self.symbol_next)
        {
            let is_rare = count < 0;
            if let Some(rare) = self.rare.get_mut(nb_rare) {
                *rare = symbol as u8;
            }
            nb_rare += usize::from(is_rare);
            *next = (2 * table_size) as u16 + if is_rare { 1 } else { count as u16 };
            let count = if is_rare { 0 } else { count as usize };
            write_le64(&mut self.in_order, nb_in_order, eight_times)?;
            if count > 8 {
                for done in (8..count).step_by(8) {
                    write_le64(&mut self.in_order, nb_in_order + done, eight_times)?;
                }
            }
            nb_in_order += count;
            eight_times += 0x0101_0101_0101_0101;
        }

        if nb_rare == 0 {
            // One symbol after the other goes `step` states further, so the symbol of the next state is `stride` symbols
            // further.
            return Ok(States {
                symbols: &self.in_order,
                index: 0,
                stride: stride & table_mask,
                mask: table_mask,
                symbol_next: &mut self.symbol_next,
            });
        }

        // The states from here on are those of the rare symbols. Others that would go there go to the next place.
        let first_rare = table_size - nb_rare.min(table_size);
        let by_state = self.by_state.sub_mut(..table_size)?;
        let mut position = 0usize;
        let mut from = 0usize;
        for _ in 0..table_size / 2 {
            for position in [position, (position + step) & table_mask] {
                let symbol = self.in_order.get(from % MAX_SPREAD_SIZE).copied();
                by_state.put(position, symbol.unwrap_or(0))?;
                from += usize::from(position < first_rare);
            }
            position = (position + 2 * step) & table_mask;
        }
        for (symbol, &rare) in by_state.iter_mut().rev().zip(self.rare.sub(..nb_rare)?) {
            *symbol = rare;
        }
        Ok(States {
            symbols: &self.by_state,
            index: 0,
            stride: 1,
            mask: table_mask,
            symbol_next: &mut self.symbol_next,
        })
    }
}

/// The states of a table, from the first on.
pub(crate) struct States<'a> {
    symbols: &'a [u8; MAX_SPREAD_SIZE + 8],
    /// Where in `symbols` the symbol of the next state is.
    index: usize,
    /// How much further the one after it is, around `mask`.
    stride: usize,
    mask: usize,
    symbol_next: &'a mut [u16; FSE_MAX_SYMBOL_VALUE as usize + 1],
}

/// A state of a table.
pub(crate) struct State {
    pub(crate) symbol: u8,
    /// What to give [`NextState::at`].
    pub(crate) next: u16,
}

impl States<'_> {
    #[inline(always)]
    pub(crate) fn next(&mut self) -> State {
        let symbol = (self.symbols.get(self.index % MAX_SPREAD_SIZE)).map_or(0, |&symbol| symbol);
        self.index = (self.index + self.stride) & self.mask;
        let mut next = 0;
        if let Some(symbol_next) = self.symbol_next.get_mut(usize::from(symbol)) {
            next = *symbol_next;
            *symbol_next = next.wrapping_add(1);
        }
        State { symbol, next }
    }
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

/// `FSE_buildDTable_internal`, from `spread.counts`.
fn build_dtable(
    dt: &mut FseDTable,
    spread: &mut Spread,
    max_symbol_value: u32,
    table_log: u32,
    wksp_size: usize,
) -> Result<()> {
    if build_dtable_wksp_size(table_log, max_symbol_value) > wksp_size {
        return Err(ErrorCode::MaxSymbolValueTooLarge);
    }
    if max_symbol_value > FSE_MAX_SYMBOL_VALUE {
        return Err(ErrorCode::MaxSymbolValueTooLarge);
    }
    if table_log > FSE_MAX_TABLELOG {
        return Err(ErrorCode::TableLogTooLarge);
    }
    dt.table_log = table_log;
    let mut states = spread.states(max_symbol_value as usize + 1, table_log)?;
    for decode in dt.table.sub_mut(..1 << table_log)? {
        let State { symbol, next } = states.next();
        let next_state = NEXT_STATES.get(usize::from(next) % NEXT_STATES.len());
        *decode = FseDecode {
            symbol,
            ..*next_state.unwrap_or(&FseDecode::EMPTY)
        };
    }
    Ok(())
}

/// A stream that two states take turns to read.
struct Decoder<'a> {
    table: &'a [FseDecode; 1 << MAX_LOG],
    /// The state that decodes the next symbol, then the other one.
    states: [u32; 2],
    /// Zeroes, then the stream.
    src: &'a [u8; PADDING + MAX_SRC_SIZE],
    /// How many bits are left to read of `src`.
    position: u32,
}

/// No less than is read without a look at what is left, and 8 bytes.
const PADDING: usize = 16;
/// `Decoder::position` at the start of the stream.
const START: u32 = 8 * PADDING as u32;
/// What the size of a stream of weights is below.
const MAX_SRC_SIZE: usize = 128;

impl Decoder<'_> {
    /// The next 57 bits or more, from the highest on.
    #[inline(always)]
    fn bits(&self) -> u64 {
        let end = (self.position as usize).div_ceil(8);
        let container = (self.src.get(end.wrapping_sub(8)..end))
            .and_then(|bytes| bytes.try_into().ok())
            .map_or(0, u64::from_le_bytes);
        container.rotate_left(self.position.wrapping_neg() & 7)
    }

    /// `FSE_initDState`
    fn read_state(&mut self, table_log: u32) -> u32 {
        let bits = self.bits().rotate_left(table_log);
        self.position -= table_log;
        bits as u32 & ((1 << table_log) - 1)
    }

    /// Decodes as many symbols as `out` takes, which are few enough to take no more than 57 bits. `positions` gets
    /// `position` after each.
    #[inline(always)]
    fn decode<const N: usize>(&mut self, out: &mut [u8; N], positions: &mut [u32; N]) {
        // The bits that are read go to the other end.
        let mut bits = self.bits();
        let [mut state, mut other_state] = self.states;
        for (symbol, position) in out.iter_mut().zip(positions) {
            let decode =
                (self.table.get(state as usize % (1 << MAX_LOG))).unwrap_or(&FseDecode::EMPTY);
            *symbol = decode.symbol;
            bits = bits.rotate_left(u32::from(decode.nb_bits));
            self.position = self.position.wrapping_sub(u32::from(decode.nb_bits));
            *position = self.position;
            state = other_state;
            other_state = u32::from(decode.new_state) + (bits as u32 & u32::from(decode.mask));
        }
        self.states = [state, other_state];
    }

    fn decode_one(&mut self) -> u8 {
        let mut symbol = [0];
        self.decode(&mut symbol, &mut [0]);
        let [symbol] = symbol;
        symbol
    }

    /// Whether more was read than the stream has.
    fn is_past_start(&self) -> bool {
        self.position < START
    }
}

/// `FSE_decompress_usingDTable_generic`
fn decompress_using_dtable(dst: &mut [u8], src: &[u8], dt: &FseDTable) -> Result<usize> {
    /// 8 symbols take at most 48 bits.
    const GROUP: usize = 8;

    let end_mark =
        BitDStream::new(src)?.bits_consumed - 8 * 8usize.saturating_sub(src.len()) as u32;
    let mut padded = [0; PADDING + MAX_SRC_SIZE];
    padded.write_at(PADDING, src)?;
    let mut decoder = Decoder {
        table: &dt.table,
        states: [0; 2],
        src: &padded,
        position: 8 * (PADDING + src.len()) as u32 - end_mark,
    };
    decoder.states = [
        decoder.read_state(dt.table_log),
        decoder.read_state(dt.table_log),
    ];
    if decoder.is_past_start() {
        return Err(ErrorCode::CorruptionDetected);
    }

    // All but the last symbol leave room for one more.
    let omax = dst.len();
    let mut op = 0usize;
    while let Some(group) = dst.get_mut(op..op + GROUP)
        && let Some(group) = group.as_mut_array::<GROUP>()
        && op + GROUP < omax
    {
        let mut positions = [0; GROUP];
        decoder.decode(group, &mut positions);
        op += GROUP;
        // The symbol after the one that takes more bits than there are is the last.
        if let Some(extra) = (positions.iter().rev()).position(|&position| position >= START) {
            if extra == 0 {
                continue;
            }
            if extra == 1 {
                dst.put(op, decoder.decode_one())?;
            }
            return Ok(op + 2 - extra);
        }
        return Ok(op + 2 - GROUP);
    }
    loop {
        if op + 2 > omax {
            return Err(ErrorCode::DstSizeTooSmall);
        }
        dst.put(op, decoder.decode_one())?;
        op += 1;
        if decoder.is_past_start() {
            dst.put(op, decoder.decode_one())?;
            return Ok(op + 1);
        }
    }
}

/// `FSE_decompress_wksp_bmi2`, as `HUF_readStats` calls it. Returns how many weights there are.
pub(crate) fn fse_decompress_weights(
    dst: &mut [u8],
    src: &[u8],
    spread: &mut Spread,
) -> Result<usize> {
    let header = read_ncount(&mut spread.counts, FSE_MAX_SYMBOL_VALUE, src)?;
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
        table: [FseDecode::EMPTY; 1 << MAX_LOG],
    };
    build_dtable(
        &mut dtable,
        spread,
        header.max_symbol_value,
        header.table_log,
        wksp_size,
    )?;
    decompress_using_dtable(dst, body, &dtable)
}
