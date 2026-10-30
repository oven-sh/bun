//! Numbers fixed by the formats: DEFLATE (RFC 1951), zlib (RFC 1950) and gzip (RFC 1952).

pub(crate) const DEFLATE_BLOCKTYPE_UNCOMPRESSED: u32 = 0;
pub(crate) const DEFLATE_BLOCKTYPE_STATIC_HUFFMAN: u32 = 1;
pub(crate) const DEFLATE_BLOCKTYPE_DYNAMIC_HUFFMAN: u32 = 2;

pub(crate) const DEFLATE_MIN_MATCH_LEN: u32 = 3;
pub(crate) const DEFLATE_MAX_MATCH_LEN: u32 = 258;
pub(crate) const DEFLATE_MAX_MATCH_OFFSET: usize = 32768;
pub(crate) const DEFLATE_WINDOW_ORDER: u32 = 15;

pub(crate) const DEFLATE_NUM_PRECODE_SYMS: usize = 19;
pub(crate) const DEFLATE_NUM_LITLEN_SYMS: usize = 288;
pub(crate) const DEFLATE_NUM_OFFSET_SYMS: usize = 32;
pub(crate) const DEFLATE_MAX_NUM_SYMS: usize = 288;

pub(crate) const DEFLATE_NUM_LITERALS: usize = 256;
pub(crate) const DEFLATE_END_OF_BLOCK: usize = 256;
pub(crate) const DEFLATE_FIRST_LEN_SYM: usize = 257;

pub(crate) const DEFLATE_MAX_PRE_CODEWORD_LEN: u32 = 7;
pub(crate) const DEFLATE_MAX_LITLEN_CODEWORD_LEN: u32 = 15;
pub(crate) const DEFLATE_MAX_OFFSET_CODEWORD_LEN: u32 = 15;
pub(crate) const DEFLATE_MAX_CODEWORD_LEN: usize = 15;

/// A run of 138 zeroes that starts at the last codeword length goes this far past the end.
pub(crate) const DEFLATE_MAX_LENS_OVERRUN: usize = 137;

pub(crate) const DEFLATE_MAX_EXTRA_LENGTH_BITS: u32 = 5;
pub(crate) const DEFLATE_MAX_EXTRA_OFFSET_BITS: u32 = 13;

/// The order in which a dynamic block stores the precode codeword lengths.
pub(crate) const PRECODE_LENS_PERMUTATION: [u8; DEFLATE_NUM_PRECODE_SYMS] = [
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

pub(crate) const ZLIB_MIN_HEADER_SIZE: usize = 2;
pub(crate) const ZLIB_FOOTER_SIZE: usize = 4;

pub(crate) const ZLIB_CM_DEFLATE: u16 = 8;
pub(crate) const ZLIB_CINFO_32K_WINDOW: u16 = 7;

pub(crate) const ZLIB_FASTEST_COMPRESSION: u16 = 0;
pub(crate) const ZLIB_FAST_COMPRESSION: u16 = 1;
pub(crate) const ZLIB_DEFAULT_COMPRESSION: u16 = 2;
pub(crate) const ZLIB_SLOWEST_COMPRESSION: u16 = 3;

pub(crate) const GZIP_MIN_HEADER_SIZE: usize = 10;
pub(crate) const GZIP_FOOTER_SIZE: usize = 8;

pub(crate) const GZIP_ID1: u8 = 0x1F;
pub(crate) const GZIP_ID2: u8 = 0x8B;
pub(crate) const GZIP_CM_DEFLATE: u8 = 8;

pub(crate) const GZIP_FHCRC: u8 = 0x02;
pub(crate) const GZIP_FEXTRA: u8 = 0x04;
pub(crate) const GZIP_FNAME: u8 = 0x08;
pub(crate) const GZIP_FCOMMENT: u8 = 0x10;
pub(crate) const GZIP_FRESERVED: u8 = 0xE0;

pub(crate) const GZIP_XFL_SLOWEST_COMPRESSION: u8 = 0x02;
pub(crate) const GZIP_XFL_FASTEST_COMPRESSION: u8 = 0x04;

pub(crate) const GZIP_OS_UNKNOWN: u8 = 255;
