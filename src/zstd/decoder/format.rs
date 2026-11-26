//! What the encoder and the decoder agree on.

pub const FRAME_MAGIC: u32 = 0xFD2F_B528;
pub const DICTIONARY_MAGIC: u32 = 0xEC30_A437;
/// The low 4 bits are free.
pub(crate) const SKIPPABLE_MAGIC: u32 = 0x184D_2A50;

pub const WINDOW_LOG_MIN: u32 = 10;
pub const WINDOW_LOG_MAX: u32 = 31;
/// The largest window that a streaming decoder accepts unless it is told otherwise.
pub const WINDOW_LOG_LIMIT_DEFAULT: u32 = 27;

pub const FRAME_HEADER_LEN_MAX: usize = 18;
pub const BLOCK_HEADER_LEN: usize = 3;
pub const BLOCK_LEN_MAX: usize = 128 << 10;
pub const CHECKSUM_LEN: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BlockType {
    Raw = 0,
    Rle = 1,
    Compressed = 2,
}

/// How literals, or one kind of sequence codes, are encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Encoding {
    /// Raw literals, or the predefined distribution.
    Basic = 0,
    Rle = 1,
    Compressed = 2,
    Repeat = 3,
}

impl Encoding {
    pub(crate) fn from_low_bits(bits: u8) -> Self {
        match bits & 3 {
            0 => Self::Basic,
            1 => Self::Rle,
            2 => Self::Compressed,
            _ => Self::Repeat,
        }
    }
}

pub const MIN_MATCH: u32 = 3;
pub const INITIAL_REPEAT_OFFSETS: [u32; 3] = [1, 4, 8];
/// Sequence counts from here on take 3 bytes.
pub const LONG_SEQUENCE_COUNT: usize = 0x7F00;
pub(crate) const MIN_LITERALS_FOR_4_STREAMS: usize = 6;

pub const HUFFMAN_TABLE_LOG_MAX: u32 = 12;
pub const FSE_TABLE_LOG_MIN: u32 = 5;

/// In the order of their tables in a block.
#[derive(Clone, Copy)]
pub enum CodeKind {
    LiteralLength,
    Offset,
    MatchLength,
}

impl CodeKind {
    pub const ALL: [Self; 3] = [Self::LiteralLength, Self::Offset, Self::MatchLength];
}

pub const MAX_LITERAL_LENGTH_CODE: usize = 35;
pub const MAX_MATCH_LENGTH_CODE: usize = 52;
pub const MAX_OFFSET_CODE: usize = 31;

pub const LITERAL_LENGTH_TABLE_LOG_MAX: u32 = 9;
pub const MATCH_LENGTH_TABLE_LOG_MAX: u32 = 9;
pub const OFFSET_TABLE_LOG_MAX: u32 = 8;

#[rustfmt::skip]
pub const LITERAL_LENGTH_BITS: [u8; MAX_LITERAL_LENGTH_CODE + 1] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12,
    13, 14, 15, 16,
];

#[rustfmt::skip]
pub const MATCH_LENGTH_BITS: [u8; MAX_MATCH_LENGTH_CODE + 1] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11,
    12, 13, 14, 15, 16,
];

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
const fn bases<const N: usize>(extra_bits: &[u8; N]) -> [u32; N] {
    let (mut bases, mut code) = ([0; N], 1);
    while code < N {
        bases[code] = bases[code - 1] + (1 << extra_bits[code - 1]);
        code += 1;
    }
    bases
}

/// By code: the first length that has it.
pub const LITERAL_LENGTH_BASES: [u32; MAX_LITERAL_LENGTH_CODE + 1] = bases(&LITERAL_LENGTH_BITS);
/// The same, less [`MIN_MATCH`].
pub const MATCH_LENGTH_BASES: [u32; MAX_MATCH_LENGTH_CODE + 1] = bases(&MATCH_LENGTH_BITS);

/// A predefined distribution. -1 is a probability of less than 1.
pub struct Distribution<'a> {
    pub counts: &'a [i16],
    pub table_log: u32,
}

#[rustfmt::skip]
pub const DEFAULT_LITERAL_LENGTHS: Distribution<'static> = Distribution {
    counts: &[
        4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1,
        2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1,
        -1, -1, -1, -1,
    ],
    table_log: 6,
};

#[rustfmt::skip]
pub const DEFAULT_MATCH_LENGTHS: Distribution<'static> = Distribution {
    counts: &[
        1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1,
        -1, -1, -1, -1, -1,
    ],
    table_log: 6,
};

#[rustfmt::skip]
pub const DEFAULT_OFFSETS: Distribution<'static> = Distribution {
    counts: &[
        1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1,
    ],
    table_log: 5,
};

/// The step with which FSE spreads symbols over a table.
pub const fn fse_table_step(table_size: usize) -> usize {
    (table_size >> 1) + (table_size >> 3) + 3
}
