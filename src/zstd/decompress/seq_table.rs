//! The FSE tables that sequences are decoded with: `ZSTD_seqSymbol` and `ZSTD_buildFSETable`.

use crate::common::{
    LL_DEFAULT_NORM_LOG, MAX_LL, MAX_ML, MAX_OFF, MAX_SEQ, ML_DEFAULT_NORM_LOG,
    OF_DEFAULT_NORM_LOG, fse_table_step,
};
use crate::error::Result;
use crate::util::{SliceExt, highbit32, write_le64};

#[rustfmt::skip]
pub(crate) const LL_BASE: [u32; MAX_LL as usize + 1] = [
         0,      1,      2,       3,     4,     5,     6,      7,
         8,      9,     10,      11,    12,    13,    14,     15,
        16,     18,     20,      22,    24,    28,    32,     40,
        48,     64,   0x80,   0x100, 0x200, 0x400, 0x800, 0x1000,
    0x2000, 0x4000, 0x8000, 0x10000,
];

#[rustfmt::skip]
pub(crate) const OF_BASE: [u32; MAX_OFF as usize + 1] = [
           0,         1,         1,         5,       0xD,       0x1D,       0x3D,       0x7D,
        0xFD,     0x1FD,     0x3FD,     0x7FD,     0xFFD,     0x1FFD,     0x3FFD,     0x7FFD,
      0xFFFD,   0x1FFFD,   0x3FFFD,   0x7FFFD,   0xFFFFD,   0x1FFFFD,   0x3FFFFD,   0x7FFFFD,
    0xFFFFFD, 0x1FFFFFD, 0x3FFFFFD, 0x7FFFFFD, 0xFFFFFFD, 0x1FFFFFFD, 0x3FFFFFFD, 0x7FFFFFFD,
];

#[rustfmt::skip]
pub(crate) const OF_BITS: [u8; MAX_OFF as usize + 1] = [
     0,  1,  2,  3,  4,  5,  6,  7,
     8,  9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22, 23,
    24, 25, 26, 27, 28, 29, 30, 31,
];

/// What a match length code starts at, above `MINMATCH`.
#[rustfmt::skip]
pub(crate) const ML_BASE: [u32; MAX_ML as usize + 1] = [
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
    fn pack(symbol: SeqSymbol) -> Self;
    fn unpack(self) -> SeqSymbol;
}

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
    #[inline(always)]
    pub(crate) fn base_value(self) -> u32 {
        u32::from(self.base_value) + (u32::from(self.nb_additional_bits >> 4) << 16)
    }
}

impl Cell for LengthCell {
    const EMPTY: Self = l(0, 0, 0, 0);
    const EMPTY_REF: &'static Self = &Self::EMPTY;

    #[inline(always)]
    fn pack(symbol: SeqSymbol) -> Self {
        Self {
            base_value: symbol.base_value as u16,
            next_state: symbol.next_state,
            state_mask: (1u16.wrapping_shl(u32::from(symbol.nb_bits))).wrapping_sub(1),
            nb_additional_bits: symbol.nb_additional_bits,
            nb_bits: symbol.nb_bits,
        }
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

impl Cell for OffsetCell {
    const EMPTY: Self = o(0, 0, 0);
    const EMPTY_REF: &'static Self = &Self::EMPTY;

    #[inline(always)]
    fn pack(symbol: SeqSymbol) -> Self {
        Self {
            first_value: 1u32.wrapping_shl(u32::from(symbol.nb_additional_bits)),
            next_state: symbol.next_state as u8,
            state_mask: (1u16.wrapping_shl(u32::from(symbol.nb_bits))).wrapping_sub(1) as u8,
            nb_additional_bits: symbol.nb_additional_bits,
            nb_bits: symbol.nb_bits,
        }
    }

    #[inline(always)]
    fn unpack(self) -> SeqSymbol {
        SeqSymbol {
            next_state: u16::from(self.next_state),
            nb_additional_bits: self.nb_additional_bits,
            nb_bits: self.nb_bits,
            // `OF_BASE`
            base_value: if self.nb_additional_bits < 2 {
                u32::from(self.nb_additional_bits)
            } else {
                self.first_value - 3
            },
        }
    }
}

const MAX_TABLE_SIZE: usize = 1 << 9;

/// The first two passes of `ZSTD_buildFSETable`: which symbol each state decodes.
struct Spread {
    symbols: [u8; MAX_TABLE_SIZE + 8],
    symbol_next: [u16; MAX_SEQ as usize + 1],
}

impl Spread {
    fn new(normalized_counter: &[i16], table_log: u32) -> Result<Self> {
        let table_size = 1usize << table_log;
        let mut symbols = [0u8; MAX_TABLE_SIZE + 8];
        let mut symbol_next = [0u16; MAX_SEQ as usize + 1];
        let mut high_threshold = table_size - 1;

        for (symbol, (&count, next)) in normalized_counter.iter().zip(&mut symbol_next).enumerate()
        {
            if count == -1 {
                symbols.put(high_threshold, symbol as u8)?;
                high_threshold = high_threshold.wrapping_sub(1);
                *next = 1;
            } else {
                *next = count as u16;
            }
        }

        let table_mask = table_size - 1;
        let step = fse_table_step(table_size);
        if high_threshold == table_size - 1 {
            // No symbol of low probability: lay the symbols down in order, then spread them in a second pass that
            // has no branch to mispredict.
            let mut in_order = [0u8; MAX_TABLE_SIZE + 8];
            let mut pos = 0usize;
            let mut sv = 0u64;
            for &count in normalized_counter {
                let n = count as usize;
                for i in (0..n.max(1)).step_by(8) {
                    write_le64(&mut in_order, pos + i, sv)?;
                }
                pos += n;
                sv += 0x0101_0101_0101_0101;
            }
            let mut position = 0usize;
            for &symbol in in_order.sub(..table_size)? {
                symbols.put(position, symbol)?;
                position = (position + step) & table_mask;
            }
        } else {
            let mut position = 0usize;
            for (symbol, &count) in normalized_counter.iter().enumerate() {
                for _ in 0..count {
                    symbols.put(position, symbol as u8)?;
                    position = (position + step) & table_mask;
                    while position > high_threshold {
                        position = (position + step) & table_mask;
                    }
                }
            }
        }
        Ok(Self {
            symbols,
            symbol_next,
        })
    }
}

/// A table of at most `N` states, which is a power of 2.
#[derive(Clone)]
pub(crate) struct SeqTable<C, const N: usize> {
    pub(crate) table_log: u32,
    pub(crate) table: [C; N],
}

pub(crate) type LengthTable = SeqTable<LengthCell, { 1 << 9 }>;
pub(crate) type OffsetTable = SeqTable<OffsetCell, { 1 << 8 }>;

impl<C: Cell, const N: usize> SeqTable<C, N> {
    pub(crate) const fn new() -> Self {
        Self {
            table_log: 0,
            table: [C::EMPTY; N],
        }
    }

    const fn predefined<const M: usize>(table_log: u32, symbols: [C; M]) -> Self {
        let mut table = [C::EMPTY; N];
        let (head, _) = table.split_at_mut(M);
        head.copy_from_slice(&symbols);
        Self { table_log, table }
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
        let symbols = other.symbols();
        if let Some(to) = self.table.get_mut(..symbols.len()) {
            to.copy_from_slice(symbols);
        }
    }

    /// `ZSTD_buildSeqTable_rle`
    pub(crate) fn build_rle(&mut self, base_value: u32, nb_additional_bits: u8) {
        self.table_log = 0;
        if let Some(cell) = self.table.first_mut() {
            *cell = C::pack(SeqSymbol {
                next_state: 0,
                nb_additional_bits,
                nb_bits: 0,
                base_value,
            });
        }
    }

    /// `ZSTD_buildFSETable`: `table_log` is such that the table fits, and `normalized_counter` adds up to its size.
    pub(crate) fn build(
        &mut self,
        normalized_counter: &[i16],
        base_value: &[u32],
        nb_additional_bits: &[u8],
        table_log: u32,
    ) -> Result<()> {
        let table_size = 1usize << table_log;
        let table_decode = self.table.sub_mut(..table_size)?;
        self.table_log = table_log;
        let Spread {
            symbols,
            mut symbol_next,
        } = Spread::new(normalized_counter, table_log)?;

        for (cell, &symbol) in table_decode.iter_mut().zip(&symbols) {
            let symbol = usize::from(symbol);
            let next = symbol_next.at_mut(symbol)?;
            let next_state = u32::from(*next);
            *next = next.wrapping_add(1);
            let nb_bits = table_log.wrapping_sub(highbit32(next_state));
            *cell = C::pack(SeqSymbol {
                next_state: (next_state.wrapping_shl(nb_bits) as usize).wrapping_sub(table_size)
                    as u16,
                nb_additional_bits: nb_additional_bits.at(symbol)?,
                nb_bits: nb_bits as u8,
                base_value: base_value.at(symbol)?,
            });
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
    ll: SeqTable::predefined(LL_DEFAULT_NORM_LOG, LL_DEFAULT),
    of: SeqTable::predefined(OF_DEFAULT_NORM_LOG, OF_DEFAULT),
    ml: SeqTable::predefined(ML_DEFAULT_NORM_LOG, ML_DEFAULT),
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
