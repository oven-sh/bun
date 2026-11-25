//! VP8L: https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification

pub(crate) mod decoder;
pub(crate) mod encoder;

/// Alpha in the highest byte, blue in the lowest.
type Argb = u32;

const BLACK: Argb = 0xff00_0000;

pub(crate) const SIGNATURE: u8 = 0x2f;
const IMAGE_SIZE_BITS: u32 = 14;
const VERSION_BITS: u32 = 3;

const MAX_PALETTE_LEN: usize = 256;
const MAX_CACHE_BITS: u32 = 11;

const LITERAL_CODES: usize = 256;
const LENGTH_CODES: usize = 24;
const DISTANCE_CODES: usize = 40;
const CODE_LENGTH_CODES: usize = 19;
const MAX_CODE_LENGTH: usize = 15;
/// What code 16 repeats until a length other than zero has been seen.
const DEFAULT_CODE_LENGTH: u8 = 8;
/// In which the lengths of the code length code are stored.
const CODE_LENGTH_CODE_ORDER: [u8; CODE_LENGTH_CODES] = [
    17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
];

/// What the distance codes 1 to 120 stand for: so many pixels to the left and rows up.
const NEIGHBORS: [(i8, i8); 120] = [
    (0, 1),
    (1, 0),
    (1, 1),
    (-1, 1),
    (0, 2),
    (2, 0),
    (1, 2),
    (-1, 2),
    (2, 1),
    (-2, 1),
    (2, 2),
    (-2, 2),
    (0, 3),
    (3, 0),
    (1, 3),
    (-1, 3),
    (3, 1),
    (-3, 1),
    (2, 3),
    (-2, 3),
    (3, 2),
    (-3, 2),
    (0, 4),
    (4, 0),
    (1, 4),
    (-1, 4),
    (4, 1),
    (-4, 1),
    (3, 3),
    (-3, 3),
    (2, 4),
    (-2, 4),
    (4, 2),
    (-4, 2),
    (0, 5),
    (3, 4),
    (-3, 4),
    (4, 3),
    (-4, 3),
    (5, 0),
    (1, 5),
    (-1, 5),
    (5, 1),
    (-5, 1),
    (2, 5),
    (-2, 5),
    (5, 2),
    (-5, 2),
    (4, 4),
    (-4, 4),
    (3, 5),
    (-3, 5),
    (5, 3),
    (-5, 3),
    (0, 6),
    (6, 0),
    (1, 6),
    (-1, 6),
    (6, 1),
    (-6, 1),
    (2, 6),
    (-2, 6),
    (6, 2),
    (-6, 2),
    (4, 5),
    (-4, 5),
    (5, 4),
    (-5, 4),
    (3, 6),
    (-3, 6),
    (6, 3),
    (-6, 3),
    (0, 7),
    (7, 0),
    (1, 7),
    (-1, 7),
    (5, 5),
    (-5, 5),
    (7, 1),
    (-7, 1),
    (4, 6),
    (-4, 6),
    (6, 4),
    (-6, 4),
    (2, 7),
    (-2, 7),
    (7, 2),
    (-7, 2),
    (3, 7),
    (-3, 7),
    (7, 3),
    (-7, 3),
    (5, 6),
    (-5, 6),
    (6, 5),
    (-6, 5),
    (8, 0),
    (4, 7),
    (-4, 7),
    (7, 4),
    (-7, 4),
    (8, 1),
    (8, 2),
    (6, 6),
    (-6, 6),
    (8, 3),
    (5, 7),
    (-5, 7),
    (7, 5),
    (-7, 5),
    (8, 4),
    (6, 7),
    (-6, 7),
    (7, 6),
    (-7, 6),
    (8, 5),
    (7, 7),
    (-7, 7),
    (8, 6),
    (8, 7),
];

/// A tile of a transform, or of the entropy image, is `1 << bits` pixels wide and high. `bits - MIN_TILE_BITS` is
/// stored in `TILE_BITS_BITS` bits.
const MIN_TILE_BITS: u32 = 2;
const TILE_BITS_BITS: u32 = 3;

#[derive(Clone, Copy)]
enum TransformType {
    Predictor = 0,
    CrossColor = 1,
    SubtractGreen = 2,
    ColorIndexing = 3,
}

/// Where the color cache of `1 << bits` colors has `argb`.
const fn color_cache_key(argb: Argb, bits: u32) -> usize {
    (argb.wrapping_mul(0x1e35_a7bd) >> (32 - bits)) as usize
}

/// How many tiles of `1 << bits` it takes to cover `size`.
const fn subsampled(size: usize, bits: u32) -> usize {
    (size + (1 << bits) - 1) >> bits
}

/// `1 << bundle_bits()` indices into a palette share the green of one pixel.
const fn bundle_bits(palette_len: usize) -> u32 {
    match palette_len {
        ..=2 => 3,
        3..=4 => 2,
        5..=16 => 1,
        _ => 0,
    }
}
