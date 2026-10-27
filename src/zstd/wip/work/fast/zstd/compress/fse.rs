//! `fse_compress.c` and the encoding half of `fse.h`: Finite State Entropy coding.

use crate::common::{MAX_SEQ, ML_FSE_LOG};
use crate::util::SliceExt;

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
    pub(crate) symbol_tt: [FseSymbolTransform; MAX_SEQ as usize + 1],
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
            }; MAX_SEQ as usize + 1],
        }
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
