use crate::util::{Bug, OutOfMemory};

/// Those of libwebp's `VP8StatusCode` that a decode of a whole file ends with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DecodeError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("the output buffer is too small for the image")]
    InvalidParam,
    #[error("invalid bitstream")]
    BitstreamError,
    #[error("animations are not supported")]
    UnsupportedFeature,
    #[error("truncated file")]
    NotEnoughData,
    #[error("the decoder broke one of its own invariants")]
    Bug,
}

impl From<Bug> for DecodeError {
    fn from(_: Bug) -> Self {
        Self::Bug
    }
}

impl From<OutOfMemory> for DecodeError {
    fn from(_: OutOfMemory) -> Self {
        Self::OutOfMemory
    }
}

/// Those of libwebp's `WebPEncodingError` that the two ways to encode end with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum EncodeError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("the quality is not 0 to 100")]
    InvalidConfiguration,
    #[error("a side is 0 or more than 16383 pixels, or the input is shorter than the image")]
    BadDimension,
    #[error("the first partition of the lossy image is over 512 KiB")]
    Partition0Overflow,
    #[error("the file would be over 4 GiB")]
    FileTooBig,
    #[error("the encoder broke one of its own invariants")]
    Bug,
}

impl From<Bug> for EncodeError {
    fn from(_: Bug) -> Self {
        Self::Bug
    }
}

impl From<OutOfMemory> for EncodeError {
    fn from(_: OutOfMemory) -> Self {
        Self::OutOfMemory
    }
}
