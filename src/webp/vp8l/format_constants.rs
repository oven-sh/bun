//! `format_constants.h`: what the lossless bitstream fixes.

pub(crate) const MAGIC_BYTE: u8 = 0x2f;
pub(crate) const IMAGE_SIZE_BITS: u32 = 14;
pub(crate) const VERSION_BITS: u32 = 3;
pub(crate) const VERSION: u32 = 0;
pub(crate) const FRAME_HEADER_SIZE: usize = 5;

pub(crate) const MAX_PALETTE_SIZE: usize = 256;
pub(crate) const ARGB_BLACK: u32 = 0xff00_0000;
pub(crate) const MAX_CACHE_BITS: u32 = 11;
pub(crate) const HUFFMAN_CODES_PER_META_CODE: usize = 5;

pub(crate) const DEFAULT_CODE_LENGTH: u8 = 8;
pub(crate) const MAX_ALLOWED_CODE_LENGTH: usize = 15;

pub(crate) const NUM_LITERAL_CODES: usize = 256;
pub(crate) const NUM_LENGTH_CODES: usize = 24;
pub(crate) const NUM_DISTANCE_CODES: usize = 40;
pub(crate) const CODE_LENGTH_CODES: usize = 19;

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

/// `VP8LImageTransformType`, in the order of its two bits in the bitstream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TransformType {
    Predictor = 0,
    CrossColor = 1,
    SubtractGreen = 2,
    ColorIndexing = 3,
}

/// `VP8LSubSampleSize`: how many blocks of `1 << sampling_bits` pixels cover `size` pixels.
#[inline]
pub(crate) const fn sub_sample_size(size: usize, sampling_bits: u32) -> usize {
    (size + (1 << sampling_bits) - 1) >> sampling_bits
}
