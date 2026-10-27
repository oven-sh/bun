//! Constants of the format (RFC 7932), shared by the decoder and the encoder.

/// 7.3. Encoding of the context map
pub(crate) const CONTEXT_MAP_MAX_RLE: usize = 16;

/// 2. Compressed representation overview
pub(crate) const MAX_NUMBER_OF_BLOCK_TYPES: usize = 256;

/// 3.3. Alphabet sizes
pub(crate) const NUM_LITERAL_SYMBOLS: usize = 256;
pub(crate) const NUM_COMMAND_SYMBOLS: usize = 704;
pub(crate) const NUM_BLOCK_LEN_SYMBOLS: usize = 26;
pub(crate) const MAX_CONTEXT_MAP_SYMBOLS: usize = MAX_NUMBER_OF_BLOCK_TYPES + CONTEXT_MAP_MAX_RLE;
pub(crate) const MAX_BLOCK_TYPE_SYMBOLS: usize = MAX_NUMBER_OF_BLOCK_TYPES + 2;

/// 3.5. Complex prefix codes
pub(crate) const REPEAT_PREVIOUS_CODE_LENGTH: usize = 16;
pub(crate) const REPEAT_ZERO_CODE_LENGTH: usize = 17;
pub(crate) const CODE_LENGTH_CODES: usize = REPEAT_ZERO_CODE_LENGTH + 1;
/// "code length of 8 is repeated"
pub(crate) const INITIAL_REPEATED_CODE_LENGTH: usize = 8;

/// The number of distance bits of "large window brotli". It is 62 although no more than 30 are supported, because it
/// decides how a simple prefix code for distances is written (3.4).
pub(crate) const LARGE_MAX_DISTANCE_BITS: u32 = 62;
pub(crate) const LARGE_MIN_WBITS: u32 = 10;
/// The format allows 62. Distances are computed in 32 bits here.
pub(crate) const LARGE_MAX_WBITS: u32 = 30;

/// 4. Encoding of distances
pub(crate) const NUM_DISTANCE_SHORT_CODES: u32 = 16;
pub(crate) const MAX_NPOSTFIX: u32 = 3;
pub(crate) const MAX_NDIRECT: u32 = 120;
pub(crate) const MAX_DISTANCE_BITS: u32 = 24;

pub(crate) const fn distance_alphabet_size(npostfix: u32, ndirect: u32, max_nbits: u32) -> u32 {
    NUM_DISTANCE_SHORT_CODES + ndirect + (max_nbits << (npostfix + 1))
}

/// The largest distance that any `NPOSTFIX` and `NDIRECT` can express in an RFC 7932 stream.
pub(crate) const MAX_DISTANCE: usize = 0x3FF_FFFC;

/// Up to here a distance can be computed in a signed 32-bit integer without overflow.
pub(crate) const MAX_ALLOWED_DISTANCE: u32 = 0x7FFF_FFFC;

/// 4. Encoding of Literal Insertion Lengths and Copy Lengths
pub(crate) const NUM_INS_COPY_CODES: usize = 24;

/// 7.1. "context IDs for literals are in the range of 0..63"
pub(crate) const LITERAL_CONTEXT_BITS: u32 = 6;
/// 7.2. Context ID for distances
pub(crate) const DISTANCE_CONTEXT_BITS: u32 = 2;

/// 9.1. The largest backward distance is this much less than the window.
pub(crate) const WINDOW_GAP: usize = 16;

pub(crate) const fn max_backward_limit(lgwin: u32) -> usize {
    (1usize << lgwin) - WINDOW_GAP
}

pub(crate) struct DistanceCodeLimit {
    pub(crate) max_alphabet_size: u32,
    pub(crate) max_distance: u32,
}

/// The largest distance alphabet that cannot express a distance over `max_distance`. An alphabet always ends with a
/// complete group of `1 << npostfix` symbols.
pub(crate) const fn calculate_distance_code_limit(
    max_distance: u32,
    npostfix: u32,
    ndirect: u32,
) -> DistanceCodeLimit {
    if max_distance <= ndirect {
        return DistanceCodeLimit {
            max_alphabet_size: max_distance + NUM_DISTANCE_SHORT_CODES,
            max_distance,
        };
    }
    let forbidden_distance = max_distance + 1;
    let offset = ((forbidden_distance - ndirect - 1) >> npostfix) + 4;
    let mut ndistbits = 0u32;
    let mut tmp = offset / 2;
    while tmp != 0 {
        ndistbits += 1;
        tmp >>= 1;
    }
    ndistbits -= 1;
    let half = (offset >> ndistbits) & 1;
    let group = ((ndistbits - 1) << 1) | half;
    if group == 0 {
        return DistanceCodeLimit {
            max_alphabet_size: ndirect + NUM_DISTANCE_SHORT_CODES,
            max_distance: ndirect,
        };
    }
    // The group found holds the forbidden distance, so the one before it is the last one allowed.
    let group = group - 1;
    let ndistbits = (group >> 1) + 1;
    let extra = (1u32 << ndistbits) - 1;
    let start = (1u32 << (ndistbits + 1)) - 4 + ((group & 1) << ndistbits);
    let postfix = (1u32 << npostfix) - 1;
    DistanceCodeLimit {
        max_alphabet_size: ((group << npostfix) | postfix) + ndirect + NUM_DISTANCE_SHORT_CODES + 1,
        max_distance: ((start + extra) << npostfix) + postfix + ndirect + 1,
    }
}

/// The values of a prefix code symbol: `offset .. offset + (1 << nbits)`.
#[derive(Clone, Copy)]
pub(crate) struct PrefixCodeRange {
    pub(crate) offset: u16,
    pub(crate) nbits: u8,
}

const fn range(offset: u16, nbits: u8) -> PrefixCodeRange {
    PrefixCodeRange { offset, nbits }
}

/// 6. Encoding of block-switch commands: block counts.
pub(crate) static BLOCK_LENGTH_PREFIX_CODE: [PrefixCodeRange; NUM_BLOCK_LEN_SYMBOLS] = [
    range(1, 2),
    range(5, 2),
    range(9, 2),
    range(13, 2),
    range(17, 3),
    range(25, 3),
    range(33, 3),
    range(41, 3),
    range(49, 4),
    range(65, 4),
    range(81, 4),
    range(97, 4),
    range(113, 5),
    range(145, 5),
    range(177, 5),
    range(209, 5),
    range(241, 6),
    range(305, 6),
    range(369, 7),
    range(497, 8),
    range(753, 9),
    range(1265, 10),
    range(2289, 11),
    range(4337, 12),
    range(8433, 13),
    range(16625, 24),
];
