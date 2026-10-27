//! The FSE tables that sequences are decoded with: `ZSTD_seqSymbol` and `ZSTD_buildFSETable`.

use crate::common::fse_decompress::{MAX_SPREAD_SIZE, NextState, Spread};
use crate::common::{
    LL_BITS, LL_DEFAULT_NORM_LOG, MAX_LL, MAX_ML, MAX_OFF, ML_BITS, ML_DEFAULT_NORM_LOG,
    OF_DEFAULT_NORM_LOG,
};
use crate::error::Result;
use crate::util::SliceExt;

#[rustfmt::skip]
const LL_BASE: [u32; MAX_LL as usize + 1] = [
         0,      1,      2,       3,     4,     5,     6,      7,
         8,      9,     10,      11,    12,    13,    14,     15,
        16,     18,     20,      22,    24,    28,    32,     40,
        48,     64,   0x80,   0x100, 0x200, 0x400, 0x800, 0x1000,
    0x2000, 0x4000, 0x8000, 0x10000,
];

/// What a match length code starts at, above `MINMATCH`.
#[rustfmt::skip]
const ML_BASE: [u32; MAX_ML as usize + 1] = [
         0,      1,      2,      3,       4,     5,     6,     7,
         8,      9,     10,     11,      12,    13,    14,    15,
        16,     17,     18,     19,      20,    21,    22,    23,
        24,     25,     26,     27,      28,    29,    30,    31,
        32,     34,     36,     38,      40,    44,    48,    56,
        64,     80,     96,   0x80,   0x100, 0x200, 0x400, 0x800,
    0x1000, 0x2000, 0x4000, 0x8000, 0x10000,
];

/// `ZSTD_seqSymbol`
#[derive(Clone, Copy)]
pub(crate) struct SeqSymbol {
    pub(crate) next_state: u16,
    pub(crate) nb_additional_bits: u8,
    pub(crate) nb_bits: u8,
    pub(crate) base_value: u32,
}

/// How a table keeps a [`SeqSymbol`].
pub(crate) trait Cell: Copy + 'static {
    const EMPTY: Self;
    const EMPTY_REF: &'static Self;
    /// [`NextState::at`] as `to_bits` of a cell where nothing else is set.
    const NEXT_STATES: &'static [u64; 4 * MAX_TABLE_SIZE];
    /// The fields one after the other, from the lowest bits on.
    fn from_bits(bits: u64) -> Self;
    fn has_additional_bits(self) -> bool;
    fn unpack(self) -> SeqSymbol;
}

const MAX_TABLE_SIZE: usize = MAX_SPREAD_SIZE;

/// A state of the table of literal lengths or of match lengths.
#[derive(Clone, Copy)]
pub(crate) struct LengthCell {
    /// All of the base value but its bit 16, which is set if and only if there are 16 additional bits.
    pub(crate) base_value: u16,
    pub(crate) next_state: u16,
    /// As many bits set as `nb_bits`.
    pub(crate) state_mask: u16,
    pub(crate) nb_additional_bits: u8,
    pub(crate) nb_bits: u8,
}

const fn l(next_state: u16, nb_additional_bits: u8, nb_bits: u8, base_value: u32) -> LengthCell {
    LengthCell {
        base_value: base_value as u16,
        next_state,
        state_mask: (1u16 << nb_bits) - 1,
        nb_additional_bits,
        nb_bits,
    }
}

impl LengthCell {
    const fn to_bits(self) -> u64 {
        self.base_value as u64
            | (self.next_state as u64) << 16
            | (self.state_mask as u64) << 32
            | (self.nb_additional_bits as u64) << 48
            | (self.nb_bits as u64) << 56
    }

    #[inline(always)]
    pub(crate) fn base_value(self) -> u32 {
        u32::from(self.base_value) + (u32::from(self.nb_additional_bits >> 4) << 16)
    }
}

impl Cell for LengthCell {
    const EMPTY: Self = l(0, 0, 0, 0);
    const EMPTY_REF: &'static Self = &Self::EMPTY;

    const NEXT_STATES: &'static [u64; 4 * MAX_TABLE_SIZE] = &{
        let mut all = [0; 4 * MAX_TABLE_SIZE];
        let mut left: &mut [u64] = &mut all;
        let mut index = 0;
        while let [bits, others @ ..] = left {
            let NextState { state, nb_bits } = NextState::at(index);
            *bits = l(state, 0, nb_bits, 0).to_bits();
            index += 1;
            left = others;
        }
        all
    };

    #[inline(always)]
    fn from_bits(bits: u64) -> Self {
        Self {
            base_value: bits as u16,
            next_state: (bits >> 16) as u16,
            state_mask: (bits >> 32) as u16,
            nb_additional_bits: (bits >> 48) as u8,
            nb_bits: (bits >> 56) as u8,
        }
    }

    #[inline(always)]
    fn has_additional_bits(self) -> bool {
        self.nb_additional_bits != 0
    }

    #[inline(always)]
    fn unpack(self) -> SeqSymbol {
        SeqSymbol {
            next_state: self.next_state,
            nb_additional_bits: self.nb_additional_bits,
            nb_bits: self.nb_bits,
            base_value: self.base_value(),
        }
    }
}

/// A state of the table of offsets.
#[derive(Clone, Copy)]
pub(crate) struct OffsetCell {
    /// 1 with `nb_additional_bits` zeros after it. With the additional bits in their place, 1 to 3 stand for one of the
    /// last offsets, and what is above for an offset 3 less than it.
    pub(crate) first_value: u32,
    pub(crate) next_state: u8,
    /// As many bits set as `nb_bits`.
    pub(crate) state_mask: u8,
    pub(crate) nb_additional_bits: u8,
    pub(crate) nb_bits: u8,
}

const fn o(next_state: u8, nb_additional_bits: u8, nb_bits: u8) -> OffsetCell {
    OffsetCell {
        first_value: 1 << nb_additional_bits,
        next_state,
        state_mask: ((1u16 << nb_bits) - 1) as u8,
        nb_additional_bits,
        nb_bits,
    }
}

impl OffsetCell {
    const fn to_bits(self) -> u64 {
        self.first_value as u64
            | (self.next_state as u64) << 32
            | (self.state_mask as u64) << 40
            | (self.nb_additional_bits as u64) << 48
            | (self.nb_bits as u64) << 56
    }
}

impl Cell for OffsetCell {
    const EMPTY: Self = o(0, 0, 0);
    const EMPTY_REF: &'static Self = &Self::EMPTY;

    const NEXT_STATES: &'static [u64; 4 * MAX_TABLE_SIZE] = &{
        let mut all = [0; 4 * MAX_TABLE_SIZE];
        let mut left: &mut [u64] = &mut all;
        let mut index = 0;
        while let [bits, others @ ..] = left {
            let NextState { state, nb_bits } = NextState::at(index);
            *bits = o(state as u8, 0, nb_bits).to_bits() - o(0, 0, 0).to_bits();
            index += 1;
            left = others;
        }
        all
    };

    #[inline(always)]
    fn from_bits(bits: u64) -> Self {
        Self {
            first_value: bits as u32,
            next_state: (bits >> 32) as u8,
            state_mask: (bits >> 40) as u8,
            nb_additional_bits: (bits >> 48) as u8,
            nb_bits: (bits >> 56) as u8,
        }
    }

    #[inline(always)]
    fn has_additional_bits(self) -> bool {
        self.nb_additional_bits != 0
    }

    #[inline(always)]
    fn unpack(self) -> SeqSymbol {
        SeqSymbol {
            next_state: u16::from(self.next_state),
            nb_additional_bits: self.nb_additional_bits,
            nb_bits: self.nb_bits,
            base_value: if self.nb_additional_bits < 2 {
                u32::from(self.nb_additional_bits)
            } else {
                self.first_value - 3
            },
        }
    }
}

/// What each code of a kind stands for: `to_bits` of a cell that leads to no state. There are fewer codes than that.
pub(crate) type Codes = [u64; 64];

const fn length_codes(mut base_values: &[u32], mut nb_additional_bits: &[u8]) -> Codes {
    let mut codes = [0; 64];
    let mut left: &mut [u64] = &mut codes;
    while let (
        [code, other_codes @ ..],
        [base_value, other_values @ ..],
        [nb_bits, other_nb_bits @ ..],
    ) = (left, base_values, nb_additional_bits)
    {
        *code = l(0, *nb_bits, 0, *base_value).to_bits();
        (left, base_values, nb_additional_bits) = (other_codes, other_values, other_nb_bits);
    }
    codes
}

const fn offset_codes() -> Codes {
    let mut codes = [0; 64];
    let (mut left, _) = codes.split_at_mut(MAX_OFF as usize + 1);
    let mut nb_additional_bits = 0;
    while let [code, others @ ..] = left {
        *code = o(0, nb_additional_bits, 0).to_bits();
        nb_additional_bits += 1;
        left = others;
    }
    codes
}

pub(crate) static LL_CODES: Codes = length_codes(&LL_BASE, &LL_BITS);
pub(crate) static OF_CODES: Codes = offset_codes();
pub(crate) static ML_CODES: Codes = length_codes(&ML_BASE, &ML_BITS);

/// A table of at most `N` states, which is a power of 2.
#[derive(Clone)]
pub(crate) struct SeqTable<C, const N: usize> {
    pub(crate) table_log: u32,
    /// How many of 512 symbols are expected to come with additional bits.
    pub(crate) with_more_bits: u32,
    pub(crate) table: [C; N],
}

pub(crate) type LengthTable = SeqTable<LengthCell, { 1 << 9 }>;
pub(crate) type OffsetTable = SeqTable<OffsetCell, { 1 << 8 }>;

impl<C: Cell, const N: usize> SeqTable<C, N> {
    pub(crate) const fn new() -> Self {
        Self {
            table_log: 0,
            with_more_bits: 0,
            table: [C::EMPTY; N],
        }
    }

    /// `with_more_bits` of the `symbols` have additional bits.
    const fn predefined<const M: usize>(
        table_log: u32,
        with_more_bits: u32,
        symbols: [C; M],
    ) -> Self {
        let mut table = [C::EMPTY; N];
        let (head, _) = table.split_at_mut(M);
        head.copy_from_slice(&symbols);
        Self {
            table_log,
            with_more_bits: with_more_bits << (9 - table_log),
            table,
        }
    }

    #[inline(always)]
    pub(crate) fn get(&self, state: usize) -> SeqSymbol {
        self.table
            .get(state & (N - 1))
            .copied()
            .unwrap_or(C::EMPTY)
            .unpack()
    }

    #[inline(always)]
    pub(crate) fn cell(&self, state: usize) -> &C {
        self.table.get(state & (N - 1)).unwrap_or(C::EMPTY_REF)
    }

    /// The states in use.
    pub(crate) fn symbols(&self) -> &[C] {
        self.table.get(..1 << self.table_log).unwrap_or_default()
    }

    fn copy_from(&mut self, other: &Self) {
        self.table_log = other.table_log;
        self.with_more_bits = other.with_more_bits;
        let symbols = other.symbols();
        if let Some(to) = self.table.get_mut(..symbols.len()) {
            to.copy_from_slice(symbols);
        }
    }

    /// `ZSTD_buildSeqTable_rle`
    pub(crate) fn build_rle(&mut self, code: u64) {
        let code = C::from_bits(code);
        self.table_log = 0;
        self.with_more_bits = u32::from(code.has_additional_bits()) << 9;
        if let Some(cell) = self.table.first_mut() {
            *cell = code;
        }
    }

    /// `ZSTD_buildFSETable`: `table_log` is such that the table fits, and the first `nb_symbols` of `spread.counts` add
    /// up to its size.
    pub(crate) fn build(
        &mut self,
        nb_symbols: usize,
        codes: &Codes,
        table_log: u32,
        spread: &mut Spread,
    ) -> Result<()> {
        let table_size = 1usize << table_log;
        let table_decode = self.table.sub_mut(..table_size)?;
        self.table_log = table_log;
        self.with_more_bits = (spread.counts.sub(..nb_symbols)?)
            .iter()
            .zip(codes)
            .filter(|&(_, &code)| C::from_bits(code).has_additional_bits())
            .map(|(&count, _)| u32::from(count.unsigned_abs()))
            .sum::<u32>()
            << (9 - table_log.min(9));
        spread.set(nb_symbols, table_log)?;

        for (cell, &symbol) in table_decode.iter_mut().zip(&spread.symbols) {
            let symbol = usize::from(symbol);
            let (Some(next), Some(code)) =
                (spread.symbol_next.get_mut(symbol), codes.get(symbol % 64))
            else {
                continue;
            };
            let next_state = C::NEXT_STATES.get(usize::from(*next) % (4 * MAX_TABLE_SIZE));
            *next = next.wrapping_add(1);
            *cell = C::from_bits(code | next_state.copied().unwrap_or(0));
        }
        Ok(())
    }
}

#[rustfmt::skip]
const LL_DEFAULT: [LengthCell; 64] = [
    l( 0,  0, 4,         0), l(16,  0, 4,         0), l(32,  0, 5,         1), l( 0,  0, 5,         3),
    l( 0,  0, 5,         4), l( 0,  0, 5,         6), l( 0,  0, 5,         7), l( 0,  0, 5,         9),
    l( 0,  0, 5,        10), l( 0,  0, 5,        12), l( 0,  0, 6,        14), l( 0,  1, 5,        16),
    l( 0,  1, 5,        20), l( 0,  1, 5,        22), l( 0,  2, 5,        28), l( 0,  3, 5,        32),
    l( 0,  4, 5,        48), l(32,  6, 5,        64), l( 0,  7, 5,       128), l( 0,  8, 6,       256),
    l( 0, 10, 6,      1024), l( 0, 12, 6,      4096), l(32,  0, 4,         0), l( 0,  0, 4,         1),
    l( 0,  0, 5,         2), l(32,  0, 5,         4), l( 0,  0, 5,         5), l(32,  0, 5,         7),
    l( 0,  0, 5,         8), l(32,  0, 5,        10), l( 0,  0, 5,        11), l( 0,  0, 6,        13),
    l(32,  1, 5,        16), l( 0,  1, 5,        18), l(32,  1, 5,        22), l( 0,  2, 5,        24),
    l(32,  3, 5,        32), l( 0,  3, 5,        40), l( 0,  6, 4,        64), l(16,  6, 4,        64),
    l(32,  7, 5,       128), l( 0,  9, 6,       512), l( 0, 11, 6,      2048), l(48,  0, 4,         0),
    l(16,  0, 4,         1), l(32,  0, 5,         2), l(32,  0, 5,         3), l(32,  0, 5,         5),
    l(32,  0, 5,         6), l(32,  0, 5,         8), l(32,  0, 5,         9), l(32,  0, 5,        11),
    l(32,  0, 5,        12), l( 0,  0, 6,        15), l(32,  1, 5,        18), l(32,  1, 5,        20),
    l(32,  2, 5,        24), l(32,  2, 5,        28), l(32,  3, 5,        40), l(32,  4, 5,        48),
    l( 0, 16, 6,     65536), l( 0, 15, 6,     32768), l( 0, 14, 6,     16384), l( 0, 13, 6,      8192),
];

#[rustfmt::skip]
const OF_DEFAULT: [OffsetCell; 32] = [
    o( 0,  0, 5), o( 0,  6, 4), o( 0,  9, 5), o( 0, 15, 5),
    o( 0, 21, 5), o( 0,  3, 5), o( 0,  7, 4), o( 0, 12, 5),
    o( 0, 18, 5), o( 0, 23, 5), o( 0,  5, 5), o( 0,  8, 4),
    o( 0, 14, 5), o( 0, 20, 5), o( 0,  2, 5), o(16,  7, 4),
    o( 0, 11, 5), o( 0, 17, 5), o( 0, 22, 5), o( 0,  4, 5),
    o(16,  8, 4), o( 0, 13, 5), o( 0, 19, 5), o( 0,  1, 5),
    o(16,  6, 4), o( 0, 10, 5), o( 0, 16, 5), o( 0, 28, 5),
    o( 0, 27, 5), o( 0, 26, 5), o( 0, 25, 5), o( 0, 24, 5),
];

#[rustfmt::skip]
const ML_DEFAULT: [LengthCell; 64] = [
    l( 0,  0, 6,         0), l( 0,  0, 4,         1), l(32,  0, 5,         2), l( 0,  0, 5,         3),
    l( 0,  0, 5,         5), l( 0,  0, 5,         6), l( 0,  0, 5,         8), l( 0,  0, 6,        10),
    l( 0,  0, 6,        13), l( 0,  0, 6,        16), l( 0,  0, 6,        19), l( 0,  0, 6,        22),
    l( 0,  0, 6,        25), l( 0,  0, 6,        28), l( 0,  0, 6,        31), l( 0,  1, 6,        34),
    l( 0,  1, 6,        38), l( 0,  2, 6,        44), l( 0,  3, 6,        56), l( 0,  4, 6,        80),
    l( 0,  7, 6,       128), l( 0,  9, 6,       512), l(16,  0, 4,         1), l( 0,  0, 4,         2),
    l(32,  0, 5,         3), l( 0,  0, 5,         4), l(32,  0, 5,         6), l( 0,  0, 5,         7),
    l( 0,  0, 6,         9), l( 0,  0, 6,        12), l( 0,  0, 6,        15), l( 0,  0, 6,        18),
    l( 0,  0, 6,        21), l( 0,  0, 6,        24), l( 0,  0, 6,        27), l( 0,  0, 6,        30),
    l( 0,  1, 6,        32), l( 0,  1, 6,        36), l( 0,  2, 6,        40), l( 0,  3, 6,        48),
    l( 0,  4, 6,        64), l( 0,  5, 6,        96), l( 0,  8, 6,       256), l(32,  0, 4,         1),
    l(48,  0, 4,         1), l(16,  0, 4,         2), l(32,  0, 5,         4), l(32,  0, 5,         5),
    l(32,  0, 5,         7), l(32,  0, 5,         8), l( 0,  0, 6,        11), l( 0,  0, 6,        14),
    l( 0,  0, 6,        17), l( 0,  0, 6,        20), l( 0,  0, 6,        23), l( 0,  0, 6,        26),
    l( 0,  0, 6,        29), l( 0, 16, 6,     65536), l( 0, 15, 6,     32768), l( 0, 14, 6,     16384),
    l( 0, 13, 6,      8192), l( 0, 12, 6,      4096), l( 0, 11, 6,      2048), l( 0, 10, 6,      1024),
];

/// Which table `LLTptr`, `MLTptr`, `OFTptr` or `HUFptr` points to.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TableSource {
    /// The context's own.
    Local,
    /// The dictionary's.
    Dict,
    /// The one the format predefines. There is none for literals.
    Predefined,
}

/// The tables of literal lengths, offsets and match lengths.
#[derive(Clone)]
pub(crate) struct SeqTables {
    pub(crate) ll: LengthTable,
    pub(crate) of: OffsetTable,
    pub(crate) ml: LengthTable,
}

static DEFAULT_TABLES: SeqTables = SeqTables {
    ll: SeqTable::predefined(LL_DEFAULT_NORM_LOG, 32, LL_DEFAULT),
    of: SeqTable::predefined(OF_DEFAULT_NORM_LOG, 31, OF_DEFAULT),
    ml: SeqTable::predefined(ML_DEFAULT_NORM_LOG, 21, ML_DEFAULT),
};

/// `LLTptr`, `OFTptr` and `MLTptr`
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct SeqTableSources {
    pub(crate) ll: TableSource,
    pub(crate) of: TableSource,
    pub(crate) ml: TableSource,
}

impl SeqTableSources {
    pub(crate) const fn all(source: TableSource) -> Self {
        Self {
            ll: source,
            of: source,
            ml: source,
        }
    }
}

impl SeqTables {
    pub(crate) const fn new() -> Self {
        Self {
            ll: SeqTable::new(),
            of: SeqTable::new(),
            ml: SeqTable::new(),
        }
    }

    /// The three tables that `sources` designates, side by side. If they are not, those that are not in `self` are
    /// copied there, which `sources` then says.
    pub(crate) fn gather<'a>(
        &'a mut self,
        sources: &mut SeqTableSources,
        dict: Option<&'a Self>,
    ) -> &'a Self {
        let from = |source| match (source, dict) {
            (TableSource::Predefined, _) => Some(&DEFAULT_TABLES),
            (TableSource::Dict, Some(dict)) => Some(dict),
            _ => None,
        };
        if *sources == SeqTableSources::all(sources.ll) {
            return from(sources.ll).unwrap_or(self);
        }
        if let Some(other) = from(sources.ll) {
            self.ll.copy_from(&other.ll);
        }
        if let Some(other) = from(sources.of) {
            self.of.copy_from(&other.of);
        }
        if let Some(other) = from(sources.ml) {
            self.ml.copy_from(&other.ml);
        }
        *sources = SeqTableSources::all(TableSource::Local);
        self
    }
}
