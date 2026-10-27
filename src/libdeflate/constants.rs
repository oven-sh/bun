//! Numbers fixed by the DEFLATE format (RFC 1951).

pub(crate) const BLOCKTYPE_UNCOMPRESSED: u32 = 0;
pub(crate) const BLOCKTYPE_STATIC_HUFFMAN: u32 = 1;
pub(crate) const BLOCKTYPE_DYNAMIC_HUFFMAN: u32 = 2;

pub(crate) const MIN_MATCH_LEN: u32 = 3;
pub(crate) const MAX_MATCH_LEN: u32 = 258;
pub(crate) const MAX_MATCH_OFFSET: usize = 32768;
pub(crate) const WINDOW_ORDER: u32 = 15;

pub(crate) const NUM_PRECODE_SYMS: usize = 19;
pub(crate) const NUM_LITLEN_SYMS: usize = 288;
pub(crate) const NUM_OFFSET_SYMS: usize = 32;
pub(crate) const MAX_NUM_SYMS: usize = 288;

pub(crate) const NUM_LITERALS: usize = 256;
pub(crate) const END_OF_BLOCK: usize = 256;
pub(crate) const FIRST_LEN_SYM: usize = 257;

pub(crate) const MAX_PRE_CODEWORD_LEN: u32 = 7;
pub(crate) const MAX_LITLEN_CODEWORD_LEN: u32 = 15;
pub(crate) const MAX_OFFSET_CODEWORD_LEN: u32 = 15;
pub(crate) const MAX_CODEWORD_LEN: usize = 15;

/// A run of 138 zeroes that starts at the last codeword length goes this far past the end.
pub(crate) const MAX_LENS_OVERRUN: usize = 137;

pub(crate) const MAX_EXTRA_LENGTH_BITS: u32 = 5;
pub(crate) const MAX_EXTRA_OFFSET_BITS: u32 = 13;

/// The order in which a dynamic block stores the precode codeword lengths.
pub(crate) const PRECODE_LENS_PERMUTATION: [u8; NUM_PRECODE_SYMS] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

pub(crate) const LENGTH_SLOT_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
];

pub(crate) const EXTRA_LENGTH_BITS: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];

pub(crate) const OFFSET_SLOT_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];

pub(crate) const EXTRA_OFFSET_BITS: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];
