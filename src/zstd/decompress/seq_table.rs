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

#[rustfmt::skip]
pub(crate) const ML_BASE: [u32; MAX_ML as usize + 1] = [
         3,      4,      5,      6,       7,     8,     9,    10,
        11,     12,     13,     14,      15,    16,    17,    18,
        19,     20,     21,     22,      23,    24,    25,    26,
        27,     28,     29,     30,      31,    32,    33,    34,
        35,     37,     39,     41,      43,    47,    51,    59,
        67,     83,     99,   0x83,   0x103, 0x203, 0x403, 0x803,
    0x1003, 0x2003, 0x4003, 0x8003, 0x10003,
];

/// `ZSTD_seqSymbol`
#[derive(Clone, Copy)]
pub(crate) struct SeqSymbol {
    pub(crate) next_state: u16,
    pub(crate) nb_additional_bits: u8,
    pub(crate) nb_bits: u8,
    pub(crate) base_value: u32,
}

const fn s(next_state: u16, nb_additional_bits: u8, nb_bits: u8, base_value: u32) -> SeqSymbol {
    SeqSymbol {
        next_state,
        nb_additional_bits,
        nb_bits,
        base_value,
    }
}

/// A table of at most `N` states, which is a power of 2.
#[derive(Clone)]
pub(crate) struct SeqTable<const N: usize> {
    pub(crate) table_log: u32,
    table: [SeqSymbol; N],
}

impl<const N: usize> SeqTable<N> {
    pub(crate) const fn new() -> Self {
        Self {
            table_log: 0,
            table: [s(0, 0, 0, 0); N],
        }
    }

    const fn predefined<const M: usize>(table_log: u32, symbols: [SeqSymbol; M]) -> Self {
        let mut table = [s(0, 0, 0, 0); N];
        let (head, _) = table.split_at_mut(M);
        head.copy_from_slice(&symbols);
        Self { table_log, table }
    }

    #[inline(always)]
    pub(crate) fn get(&self, state: usize) -> SeqSymbol {
        self.table
            .get(state & (N - 1))
            .copied()
            .unwrap_or(s(0, 0, 0, 0))
    }

    /// The states in use.
    pub(crate) fn symbols(&self) -> &[SeqSymbol] {
        self.table.get(..1 << self.table_log).unwrap_or_default()
    }

    /// `ZSTD_buildSeqTable_rle`
    pub(crate) fn build_rle(&mut self, base_value: u32, nb_additional_bits: u8) {
        self.table_log = 0;
        if let Some(cell) = self.table.first_mut() {
            *cell = s(0, nb_additional_bits, 0, base_value);
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
        let mut symbol_next = [0u16; MAX_SEQ as usize + 1];
        let mut high_threshold = table_size - 1;

        // Until the last pass, `base_value` holds the symbol.
        self.table_log = table_log;
        for (symbol, (&count, next)) in normalized_counter.iter().zip(&mut symbol_next).enumerate()
        {
            if count == -1 {
                table_decode.at_mut(high_threshold)?.base_value = symbol as u32;
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
            let mut spread = [0u8; (1 << 9) + 8];
            let mut pos = 0usize;
            let mut sv = 0u64;
            for &count in normalized_counter {
                let n = count as usize;
                for i in (0..n.max(1)).step_by(8) {
                    write_le64(&mut spread, pos + i, sv)?;
                }
                pos += n;
                sv += 0x0101_0101_0101_0101;
            }
            let mut position = 0usize;
            for &symbol in spread.sub(..table_size)? {
                table_decode.at_mut(position)?.base_value = u32::from(symbol);
                position = (position + step) & table_mask;
            }
        } else {
            let mut position = 0usize;
            for (symbol, &count) in normalized_counter.iter().enumerate() {
                for _ in 0..count {
                    table_decode.at_mut(position)?.base_value = symbol as u32;
                    position = (position + step) & table_mask;
                    while position > high_threshold {
                        position = (position + step) & table_mask;
                    }
                }
            }
        }

        for cell in table_decode {
            let symbol = cell.base_value as usize;
            let next = symbol_next.at_mut(symbol)?;
            let next_state = u32::from(*next);
            *next = next.wrapping_add(1);
            let nb_bits = table_log.wrapping_sub(highbit32(next_state));
            *cell = SeqSymbol {
                next_state: (next_state.wrapping_shl(nb_bits) as usize).wrapping_sub(table_size)
                    as u16,
                nb_additional_bits: nb_additional_bits.at(symbol)?,
                nb_bits: nb_bits as u8,
                base_value: base_value.at(symbol)?,
            };
        }
        Ok(())
    }
}

#[rustfmt::skip]
const LL_DEFAULT: [SeqSymbol; 64] = [
    s( 0,  0, 4,         0), s(16,  0, 4,         0), s(32,  0, 5,         1), s( 0,  0, 5,         3),
    s( 0,  0, 5,         4), s( 0,  0, 5,         6), s( 0,  0, 5,         7), s( 0,  0, 5,         9),
    s( 0,  0, 5,        10), s( 0,  0, 5,        12), s( 0,  0, 6,        14), s( 0,  1, 5,        16),
    s( 0,  1, 5,        20), s( 0,  1, 5,        22), s( 0,  2, 5,        28), s( 0,  3, 5,        32),
    s( 0,  4, 5,        48), s(32,  6, 5,        64), s( 0,  7, 5,       128), s( 0,  8, 6,       256),
    s( 0, 10, 6,      1024), s( 0, 12, 6,      4096), s(32,  0, 4,         0), s( 0,  0, 4,         1),
    s( 0,  0, 5,         2), s(32,  0, 5,         4), s( 0,  0, 5,         5), s(32,  0, 5,         7),
    s( 0,  0, 5,         8), s(32,  0, 5,        10), s( 0,  0, 5,        11), s( 0,  0, 6,        13),
    s(32,  1, 5,        16), s( 0,  1, 5,        18), s(32,  1, 5,        22), s( 0,  2, 5,        24),
    s(32,  3, 5,        32), s( 0,  3, 5,        40), s( 0,  6, 4,        64), s(16,  6, 4,        64),
    s(32,  7, 5,       128), s( 0,  9, 6,       512), s( 0, 11, 6,      2048), s(48,  0, 4,         0),
    s(16,  0, 4,         1), s(32,  0, 5,         2), s(32,  0, 5,         3), s(32,  0, 5,         5),
    s(32,  0, 5,         6), s(32,  0, 5,         8), s(32,  0, 5,         9), s(32,  0, 5,        11),
    s(32,  0, 5,        12), s( 0,  0, 6,        15), s(32,  1, 5,        18), s(32,  1, 5,        20),
    s(32,  2, 5,        24), s(32,  2, 5,        28), s(32,  3, 5,        40), s(32,  4, 5,        48),
    s( 0, 16, 6,     65536), s( 0, 15, 6,     32768), s( 0, 14, 6,     16384), s( 0, 13, 6,      8192),
];

#[rustfmt::skip]
const OF_DEFAULT: [SeqSymbol; 32] = [
    s( 0,  0, 5,         0), s( 0,  6, 4,        61), s( 0,  9, 5,       509), s( 0, 15, 5,     32765),
    s( 0, 21, 5,   2097149), s( 0,  3, 5,         5), s( 0,  7, 4,       125), s( 0, 12, 5,      4093),
    s( 0, 18, 5,    262141), s( 0, 23, 5,   8388605), s( 0,  5, 5,        29), s( 0,  8, 4,       253),
    s( 0, 14, 5,     16381), s( 0, 20, 5,   1048573), s( 0,  2, 5,         1), s(16,  7, 4,       125),
    s( 0, 11, 5,      2045), s( 0, 17, 5,    131069), s( 0, 22, 5,   4194301), s( 0,  4, 5,        13),
    s(16,  8, 4,       253), s( 0, 13, 5,      8189), s( 0, 19, 5,    524285), s( 0,  1, 5,         1),
    s(16,  6, 4,        61), s( 0, 10, 5,      1021), s( 0, 16, 5,     65533), s( 0, 28, 5, 268435453),
    s( 0, 27, 5, 134217725), s( 0, 26, 5,  67108861), s( 0, 25, 5,  33554429), s( 0, 24, 5,  16777213),
];

#[rustfmt::skip]
const ML_DEFAULT: [SeqSymbol; 64] = [
    s( 0,  0, 6,         3), s( 0,  0, 4,         4), s(32,  0, 5,         5), s( 0,  0, 5,         6),
    s( 0,  0, 5,         8), s( 0,  0, 5,         9), s( 0,  0, 5,        11), s( 0,  0, 6,        13),
    s( 0,  0, 6,        16), s( 0,  0, 6,        19), s( 0,  0, 6,        22), s( 0,  0, 6,        25),
    s( 0,  0, 6,        28), s( 0,  0, 6,        31), s( 0,  0, 6,        34), s( 0,  1, 6,        37),
    s( 0,  1, 6,        41), s( 0,  2, 6,        47), s( 0,  3, 6,        59), s( 0,  4, 6,        83),
    s( 0,  7, 6,       131), s( 0,  9, 6,       515), s(16,  0, 4,         4), s( 0,  0, 4,         5),
    s(32,  0, 5,         6), s( 0,  0, 5,         7), s(32,  0, 5,         9), s( 0,  0, 5,        10),
    s( 0,  0, 6,        12), s( 0,  0, 6,        15), s( 0,  0, 6,        18), s( 0,  0, 6,        21),
    s( 0,  0, 6,        24), s( 0,  0, 6,        27), s( 0,  0, 6,        30), s( 0,  0, 6,        33),
    s( 0,  1, 6,        35), s( 0,  1, 6,        39), s( 0,  2, 6,        43), s( 0,  3, 6,        51),
    s( 0,  4, 6,        67), s( 0,  5, 6,        99), s( 0,  8, 6,       259), s(32,  0, 4,         4),
    s(48,  0, 4,         4), s(16,  0, 4,         5), s(32,  0, 5,         7), s(32,  0, 5,         8),
    s(32,  0, 5,        10), s(32,  0, 5,        11), s( 0,  0, 6,        14), s( 0,  0, 6,        17),
    s( 0,  0, 6,        20), s( 0,  0, 6,        23), s( 0,  0, 6,        26), s( 0,  0, 6,        29),
    s( 0,  0, 6,        32), s( 0, 16, 6,     65539), s( 0, 15, 6,     32771), s( 0, 14, 6,     16387),
    s( 0, 13, 6,      8195), s( 0, 12, 6,      4099), s( 0, 11, 6,      2051), s( 0, 10, 6,      1027),
];
pub(crate) static LL_DEFAULT_DTABLE: SeqTable<512> =
    SeqTable::predefined(LL_DEFAULT_NORM_LOG, LL_DEFAULT);
pub(crate) static OF_DEFAULT_DTABLE: SeqTable<256> =
    SeqTable::predefined(OF_DEFAULT_NORM_LOG, OF_DEFAULT);
pub(crate) static ML_DEFAULT_DTABLE: SeqTable<512> =
    SeqTable::predefined(ML_DEFAULT_NORM_LOG, ML_DEFAULT);
