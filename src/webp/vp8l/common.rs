//! `format_constants.h`, `lossless_common.h`: what the lossless decoder and encoder agree on.

pub(crate) const MAGIC_BYTE: u8 = 0x2f;
pub(crate) const IMAGE_SIZE_BITS: u32 = 14;
pub(crate) const VERSION_BITS: u32 = 3;
pub(crate) const VERSION: u32 = 0;
pub(crate) const FRAME_HEADER_SIZE: usize = 5;

pub(crate) const MAX_PALETTE_SIZE: usize = 256;
pub(crate) const ARGB_BLACK: u32 = 0xff00_0000;
pub(crate) const MAX_CACHE_BITS: u32 = 11;
/// Green with the length prefixes and the color cache indices, red, blue, alpha, distance.
pub(crate) const HUFFMAN_CODES_PER_META_CODE: usize = 5;

/// What the code length before the first one counts as.
pub(crate) const DEFAULT_CODE_LENGTH: u8 = 8;
pub(crate) const MAX_ALLOWED_CODE_LENGTH: usize = 15;

pub(crate) const NUM_LITERAL_CODES: usize = 256;
pub(crate) const NUM_LENGTH_CODES: usize = 24;
pub(crate) const NUM_DISTANCE_CODES: usize = 40;
pub(crate) const CODE_LENGTH_CODES: usize = 19;
/// Green symbols from here on are color cache indices.
pub(crate) const FIRST_CACHE_CODE: usize = NUM_LITERAL_CODES + NUM_LENGTH_CODES;

pub(crate) const MIN_HUFFMAN_BITS: u32 = 2;
pub(crate) const NUM_HUFFMAN_BITS: u32 = 3;
pub(crate) const MAX_HUFFMAN_BITS: u32 = MIN_HUFFMAN_BITS + (1 << NUM_HUFFMAN_BITS) - 1;
pub(crate) const MIN_TRANSFORM_BITS: u32 = 2;
pub(crate) const NUM_TRANSFORM_BITS: u32 = 3;
pub(crate) const MAX_TRANSFORM_BITS: u32 = MIN_TRANSFORM_BITS + (1 << NUM_TRANSFORM_BITS) - 1;
pub(crate) const NUM_TRANSFORMS: usize = 4;

/// The order in which the lengths of the code length code are stored.
pub(crate) const CODE_LENGTH_CODE_ORDER: [u8; CODE_LENGTH_CODES] = [
    17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
];

/// Symbols of the code length code below this are code lengths.
pub(crate) const CODE_LENGTH_LITERALS: u32 = 16;
/// This symbol repeats the last length that is not 0. The two symbols after it repeat 0.
pub(crate) const CODE_LENGTH_REPEAT_CODE: u32 = 16;
/// For each of those three symbols, how many bits of a count follow it.
pub(crate) const CODE_LENGTH_EXTRA_BITS: [u8; 3] = [2, 3, 7];
/// What is added to that count.
pub(crate) const CODE_LENGTH_REPEAT_OFFSETS: [u8; 3] = [3, 3, 11];

/// The distance codes up to this one stand for the nearest pixels in two dimensions.
pub(crate) const CODE_TO_PLANE_CODES: usize = 120;
/// Where those pixels are: the rows up in the high nibble, 8 minus the columns to the left in the low nibble.
#[rustfmt::skip]
pub(crate) const CODE_TO_PLANE: [u8; CODE_TO_PLANE_CODES] = [
    0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a,
    0x26, 0x2a, 0x38, 0x05, 0x37, 0x39, 0x15, 0x1b, 0x36, 0x3a,
    0x25, 0x2b, 0x48, 0x04, 0x47, 0x49, 0x14, 0x1c, 0x35, 0x3b,
    0x46, 0x4a, 0x24, 0x2c, 0x58, 0x45, 0x4b, 0x34, 0x3c, 0x03,
    0x57, 0x59, 0x13, 0x1d, 0x56, 0x5a, 0x23, 0x2d, 0x44, 0x4c,
    0x55, 0x5b, 0x33, 0x3d, 0x68, 0x02, 0x67, 0x69, 0x12, 0x1e,
    0x66, 0x6a, 0x22, 0x2e, 0x54, 0x5c, 0x43, 0x4d, 0x65, 0x6b,
    0x32, 0x3e, 0x78, 0x01, 0x77, 0x79, 0x53, 0x5d, 0x11, 0x1f,
    0x64, 0x6c, 0x42, 0x4e, 0x76, 0x7a, 0x21, 0x2f, 0x75, 0x7b,
    0x31, 0x3f, 0x63, 0x6d, 0x52, 0x5e, 0x00, 0x74, 0x7c, 0x41,
    0x4f, 0x10, 0x20, 0x62, 0x6e, 0x30, 0x73, 0x7d, 0x51, 0x5f,
    0x40, 0x72, 0x7e, 0x61, 0x6f, 0x50, 0x71, 0x7f, 0x60, 0x70,
];

/// `VP8LImageTransformType`, in the order of its two bits in the bitstream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TransformType {
    Predictor = 0,
    CrossColor = 1,
    SubtractGreen = 2,
    ColorIndexing = 3,
}

impl TransformType {
    pub(crate) const fn from_bits(two_bits: u32) -> Self {
        match two_bits {
            0 => Self::Predictor,
            1 => Self::CrossColor,
            2 => Self::SubtractGreen,
            _ => Self::ColorIndexing,
        }
    }
}

/// `VP8LSubSampleSize`: how many blocks of `1 << sampling_bits` pixels cover `size` pixels.
#[inline]
pub(crate) const fn sub_sample_size(size: usize, sampling_bits: u32) -> usize {
    (size + (1 << sampling_bits) - 1) >> sampling_bits
}

/// With a palette of `num_colors`, a pixel holds `1 << color_index_bits(num_colors)` indices.
pub(crate) const fn color_index_bits(num_colors: usize) -> u32 {
    match num_colors {
        17.. => 0,
        5.. => 1,
        3.. => 2,
        _ => 3,
    }
}

/// `VP8LMultipliers`: signed, in 3.5 fixed point.
#[derive(Clone, Copy, Default)]
pub(crate) struct Multipliers {
    pub(crate) green_to_red: u8,
    pub(crate) green_to_blue: u8,
    pub(crate) red_to_blue: u8,
}

impl Multipliers {
    /// `ColorCodeToMultipliers`: from an element of the color transform's image.
    #[inline]
    pub(crate) const fn from_color_code(color_code: u32) -> Self {
        let [green_to_red, green_to_blue, red_to_blue, _] = color_code.to_le_bytes();
        Self {
            green_to_red,
            green_to_blue,
            red_to_blue,
        }
    }

    /// `MultipliersToColorCode`
    pub(crate) const fn to_color_code(self) -> u32 {
        u32::from_le_bytes([
            self.green_to_red,
            self.green_to_blue,
            self.red_to_blue,
            0xff,
        ])
    }
}

#[inline(always)]
pub(crate) const fn color_transform_delta(color_pred: i8, color: i8) -> i32 {
    (color_pred as i32 * color as i32) >> 5
}
