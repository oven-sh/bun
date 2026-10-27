//! `common_dec.h`: what the decoder and the encoder agree on.

/// Prediction modes. All ten are for 4x4 luma blocks; whole macroblocks, luma and chroma, use the first four.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IntraMode {
    Dc,
    TrueMotion,
    Vertical,
    Horizontal,
    DownRight,
    VerticalRight,
    DownLeft,
    VerticalLeft,
    HorizontalDown,
    HorizontalUp,
}

pub(crate) const NUM_BMODES: usize = 10;

/// Paragraph 9.1: three bytes of flags and the size of the first partition, `SIGNATURE`, the width and the height.
pub(crate) const FRAME_HEADER_SIZE: usize = 10;
pub(crate) const SIGNATURE: [u8; 3] = [0x9d, 0x01, 0x2a];

pub(crate) const MB_FEATURE_TREE_PROBS: usize = 3;
pub(crate) const NUM_MB_SEGMENTS: usize = 4;
pub(crate) const NUM_REF_LF_DELTAS: usize = 4;
pub(crate) const NUM_MODE_LF_DELTAS: usize = 4;
pub(crate) const MAX_NUM_PARTITIONS: usize = 8;

/// 0: luma AC of a 16x16 macroblock, 1: its DC, 2: chroma, 3: luma of a 4x4 macroblock.
pub(crate) const NUM_TYPES: usize = 4;
pub(crate) const NUM_BANDS: usize = 8;
pub(crate) const NUM_CTX: usize = 3;
pub(crate) const NUM_PROBAS: usize = 11;
