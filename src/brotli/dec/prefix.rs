//! 5. Encoding of literal insertion lengths and copy lengths.

use crate::common::constants::{
    COPY_LENGTH_PREFIX_CODE, INSERT_LENGTH_PREFIX_CODE, NUM_COMMAND_SYMBOLS,
};

/// What an insert-and-copy length symbol stands for.
#[derive(Clone, Copy)]
pub(crate) struct CmdLutElement {
    pub(crate) insert_len_extra_bits: u8,
    pub(crate) copy_len_extra_bits: u8,
    /// 0 if the command implies that distance code, -1 if a distance code follows it. With a `bool` here decoding takes
    /// 1.8 % more instructions.
    distance_code: i8,
    /// 7.2. Context ID for distances.
    pub(crate) context: u8,
    pub(crate) insert_len_offset: u16,
    pub(crate) copy_len_offset: u16,
}

impl CmdLutElement {
    /// The distance is the last one, and no distance code follows the command.
    #[inline(always)]
    pub(crate) const fn implicit_distance(self) -> bool {
        self.distance_code >= 0
    }
}

pub(crate) static CMD_LUT: [CmdLutElement; NUM_COMMAND_SYMBOLS] = build();

#[allow(clippy::indexing_slicing, reason = "evaluated by the compiler")]
const fn build() -> [CmdLutElement; NUM_COMMAND_SYMBOLS] {
    // For each run of 64 symbols, which 8 insert codes (`& 0x18`) and which 8 copy codes (`<< 3 & 0x18`) it covers.
    const CELL_POS: [usize; 11] = [0, 1, 0, 1, 8, 9, 2, 16, 10, 17, 18];

    let mut items = [CmdLutElement {
        insert_len_extra_bits: 0,
        copy_len_extra_bits: 0,
        distance_code: 0,
        context: 0,
        insert_len_offset: 0,
        copy_len_offset: 0,
    }; NUM_COMMAND_SYMBOLS];
    let mut symbol = 0;
    while symbol < NUM_COMMAND_SYMBOLS {
        let cell_idx = symbol >> 6;
        let cell_pos = CELL_POS[cell_idx];
        let copy_code = ((cell_pos << 3) & 0x18) + (symbol & 7);
        let insert_code = (cell_pos & 0x18) + ((symbol >> 3) & 7);
        let insert = INSERT_LENGTH_PREFIX_CODE[insert_code];
        let copy = COPY_LENGTH_PREFIX_CODE[copy_code];
        items[symbol] = CmdLutElement {
            insert_len_extra_bits: insert.nbits,
            copy_len_extra_bits: copy.nbits,
            distance_code: if cell_idx >= 2 { -1 } else { 0 },
            context: if copy.offset > 4 {
                3
            } else {
                copy.offset as u8 - 2
            },
            insert_len_offset: insert.offset,
            copy_len_offset: copy.offset,
        };
        symbol += 1;
    }
    items
}
