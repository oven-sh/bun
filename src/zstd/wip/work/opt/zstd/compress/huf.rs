//! `huf_compress.c`: Huffman coding of literals.

use crate::common::HUF_SYMBOLVALUE_MAX;
use crate::util::SliceExt;

/// `HUF_repeat`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum HufRepeat {
    /// The table cannot be used again.
    None,
    /// It can, if it has a code for every symbol to encode.
    Check,
    /// It can.
    Valid,
}

/// `HUF_CElt[HUF_CTABLE_SIZE_ST(255)]`. The first element is the header: the table log in its lowest byte, and the
/// largest symbol value in the next. Element `symbol + 1` has the number of bits in its lowest byte, and the code in
/// its highest bits.
#[derive(Clone)]
pub(crate) struct HufCTable(pub(crate) [u64; HUF_SYMBOLVALUE_MAX as usize + 2]);

impl HufCTable {
    pub(crate) const fn new() -> Self {
        Self([0; HUF_SYMBOLVALUE_MAX as usize + 2])
    }

    /// `HUF_getNbBitsFromCTable`: 0 if the table has no code for `symbol_value`.
    #[inline]
    pub(crate) fn get_nb_bits(&self, symbol_value: u32) -> u32 {
        let [header, elements @ ..] = &self.0;
        let max_symbol_value = (header >> 8) as u8;
        if symbol_value > u32::from(max_symbol_value) {
            return 0;
        }
        (elements.at(symbol_value as usize).unwrap_or(0) & 0xFF) as u32
    }
}
