//! 5. Encoding of literal insertion lengths and copy lengths.

use crate::common::constants::{NUM_COMMAND_SYMBOLS, NUM_INS_COPY_CODES};

/// What an insert-and-copy length symbol stands for.
#[derive(Clone, Copy)]
pub(crate) struct CmdLutElement {
    pub(crate) insert_len_extra_bits: u8,
    pub(crate) copy_len_extra_bits: u8,
    /// 0 if the command implies distance code 0, -1 if it is followed by a distance code.
    pub(crate) distance_code: i8,
    /// 7.2. Context ID for distances.
    pub(crate) context: u8,
    pub(crate) insert_len_offset: u16,
    pub(crate) copy_len_offset: u16,
}

pub(crate) static CMD_LUT: [CmdLutElement; NUM_COMMAND_SYMBOLS] = build();

#[allow(clippy::indexing_slicing, reason = "evaluated by the compiler")]
const fn build() -> [CmdLutElement; NUM_COMMAND_SYMBOLS] {
    const INSERT_LENGTH_EXTRA_BITS: [u8; NUM_INS_COPY_CODES] = [
        0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24,
    ];
    const COPY_LENGTH_EXTRA_BITS: [u8; NUM_INS_COPY_CODES] = [
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24,
    ];
    // For each run of 64 symbols, which 8 insert codes (`& 0x18`) and which 8 copy codes (`<< 3 & 0x18`) it covers.
    const CELL_POS: [usize; 11] = [0, 1, 0, 1, 8, 9, 2, 16, 10, 17, 18];

    let mut insert_length_offsets = [0u16; NUM_INS_COPY_CODES];
    let mut copy_length_offsets = [2u16; NUM_INS_COPY_CODES];
    let mut i = 0;
    while i < NUM_INS_COPY_CODES - 1 {
        insert_length_offsets[i + 1] =
            insert_length_offsets[i] + (1 << INSERT_LENGTH_EXTRA_BITS[i]);
        copy_length_offsets[i + 1] = copy_length_offsets[i] + (1 << COPY_LENGTH_EXTRA_BITS[i]);
        i += 1;
    }

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
        let copy_len_offset = copy_length_offsets[copy_code];
        items[symbol] = CmdLutElement {
            insert_len_extra_bits: INSERT_LENGTH_EXTRA_BITS[insert_code],
            copy_len_extra_bits: COPY_LENGTH_EXTRA_BITS[copy_code],
            distance_code: if cell_idx >= 2 { -1 } else { 0 },
            context: if copy_len_offset > 4 {
                3
            } else {
                copy_len_offset as u8 - 2
            },
            insert_len_offset: insert_length_offsets[insert_code],
            copy_len_offset,
        };
        symbol += 1;
    }
    items
}
