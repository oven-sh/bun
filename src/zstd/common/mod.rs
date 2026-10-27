//! What the compressor and the decompressor share: `zstd_internal.h` and `lib/common`.

pub(crate) mod bitstream;
pub(crate) mod entropy;
pub(crate) mod fse_decompress;
pub(crate) mod xxhash;

pub(crate) const ZSTD_MAGICNUMBER: u32 = 0xFD2F_B528;
pub(crate) const ZSTD_MAGIC_DICTIONARY: u32 = 0xEC30_A437;
pub(crate) const ZSTD_MAGIC_SKIPPABLE_START: u32 = 0x184D_2A50;
pub(crate) const ZSTD_MAGIC_SKIPPABLE_MASK: u32 = 0xFFFF_FFF0;
pub(crate) const ZSTD_SKIPPABLEHEADERSIZE: usize = 8;

pub(crate) const ZSTD_BLOCKSIZELOG_MAX: u32 = 17;
pub(crate) const ZSTD_BLOCKSIZE_MAX: usize = 1 << ZSTD_BLOCKSIZELOG_MAX;

pub(crate) const ZSTD_WINDOWLOG_MAX: u32 = 31;
pub(crate) const ZSTD_WINDOWLOG_ABSOLUTEMIN: u32 = 10;
pub(crate) const ZSTD_WINDOWLOG_LIMIT_DEFAULT: u32 = 27;

pub const ZSTD_CONTENTSIZE_UNKNOWN: u64 = u64::MAX;
pub const ZSTD_CONTENTSIZE_ERROR: u64 = u64::MAX - 1;

pub(crate) const ZSTD_REP_NUM: usize = 3;
pub(crate) const REP_START_VALUE: [u32; ZSTD_REP_NUM] = [1, 4, 8];

pub(crate) const ZSTD_FCS_FIELD_SIZE: [usize; 4] = [0, 2, 4, 8];
pub(crate) const ZSTD_DID_FIELD_SIZE: [usize; 4] = [0, 1, 2, 4];

pub(crate) const ZSTD_FRAMEIDSIZE: usize = 4;
pub(crate) const ZSTD_BLOCKHEADERSIZE: usize = 3;

/// `blockType_e`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum BlockType {
    Raw,
    Rle,
    Compressed,
    Reserved,
}

/// `SymbolEncodingType_e`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SymbolEncodingType {
    Basic,
    Rle,
    Compressed,
    Repeat,
}

impl SymbolEncodingType {
    #[inline]
    pub(crate) const fn from_bits(bits: u8) -> Self {
        match bits & 3 {
            0 => Self::Basic,
            1 => Self::Rle,
            2 => Self::Compressed,
            _ => Self::Repeat,
        }
    }
}

pub(crate) const MIN_SEQUENCES_SIZE: usize = 1;
pub(crate) const MIN_CBLOCK_SIZE: usize = 1 + 1;
pub(crate) const MIN_LITERALS_FOR_4_STREAMS: usize = 6;

pub(crate) const LONGNBSEQ: usize = 0x7F00;

pub(crate) const MINMATCH: u32 = 3;

pub(crate) const MAX_ML: u32 = 52;
pub(crate) const MAX_LL: u32 = 35;
pub(crate) const DEFAULT_MAX_OFF: u32 = 28;
pub(crate) const MAX_OFF: u32 = 31;
pub(crate) const MAX_SEQ: u32 = MAX_ML;
pub(crate) const ML_FSE_LOG: u32 = 9;
pub(crate) const LL_FSE_LOG: u32 = 9;
pub(crate) const OFF_FSE_LOG: u32 = 8;

#[rustfmt::skip]
pub(crate) const LL_BITS: [u8; MAX_LL as usize + 1] = [
     0, 0, 0, 0, 0, 0, 0, 0,
     0, 0, 0, 0, 0, 0, 0, 0,
     1, 1, 1, 1, 2, 2, 3, 3,
     4, 6, 7, 8, 9,10,11,12,
    13,14,15,16,
];

#[rustfmt::skip]
pub(crate) const LL_DEFAULT_NORM: [i16; MAX_LL as usize + 1] = [
     4, 3, 2, 2, 2, 2, 2, 2,
     2, 2, 2, 2, 2, 1, 1, 1,
     2, 2, 2, 2, 2, 2, 2, 2,
     2, 3, 2, 1, 1, 1, 1, 1,
    -1,-1,-1,-1,
];
pub(crate) const LL_DEFAULT_NORM_LOG: u32 = 6;

#[rustfmt::skip]
pub(crate) const ML_BITS: [u8; MAX_ML as usize + 1] = [
     0, 0, 0, 0, 0, 0, 0, 0,
     0, 0, 0, 0, 0, 0, 0, 0,
     0, 0, 0, 0, 0, 0, 0, 0,
     0, 0, 0, 0, 0, 0, 0, 0,
     1, 1, 1, 1, 2, 2, 3, 3,
     4, 4, 5, 7, 8, 9,10,11,
    12,13,14,15,16,
];

#[rustfmt::skip]
pub(crate) const ML_DEFAULT_NORM: [i16; MAX_ML as usize + 1] = [
     1, 4, 3, 2, 2, 2, 2, 2,
     2, 1, 1, 1, 1, 1, 1, 1,
     1, 1, 1, 1, 1, 1, 1, 1,
     1, 1, 1, 1, 1, 1, 1, 1,
     1, 1, 1, 1, 1, 1, 1, 1,
     1, 1, 1, 1, 1, 1,-1,-1,
    -1,-1,-1,-1,-1,
];
pub(crate) const ML_DEFAULT_NORM_LOG: u32 = 6;

#[rustfmt::skip]
pub(crate) const OF_DEFAULT_NORM: [i16; DEFAULT_MAX_OFF as usize + 1] = [
     1, 1, 1, 1, 1, 1, 2, 2,
     2, 1, 1, 1, 1, 1, 1, 1,
     1, 1, 1, 1, 1, 1, 1, 1,
    -1,-1,-1,-1,-1,
];
pub(crate) const OF_DEFAULT_NORM_LOG: u32 = 5;

pub(crate) const WILDCOPY_OVERLENGTH: usize = 32;

pub(crate) const FSE_MAX_SYMBOL_VALUE: u32 = 255;
pub(crate) const FSE_MAX_TABLELOG: u32 = 12;
pub(crate) const FSE_MIN_TABLELOG: u32 = 5;
pub(crate) const FSE_TABLELOG_ABSOLUTE_MAX: u32 = 15;

/// `FSE_TABLESTEP`
#[inline(always)]
pub(crate) const fn fse_table_step(table_size: usize) -> usize {
    (table_size >> 1) + (table_size >> 3) + 3
}

pub(crate) const HUF_TABLELOG_MAX: u32 = 12;
pub(crate) const HUF_SYMBOLVALUE_MAX: u32 = 255;
