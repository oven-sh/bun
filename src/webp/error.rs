use crate::util::Bug;

/// The `VP8StatusCode`s and `WebPEncodingError`s that decoding a whole file or encoding an image can return.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("the output buffer is too small for the image")]
    InvalidParam,
    #[error("invalid bitstream")]
    BitstreamError,
    #[error("animations are not supported")]
    UnsupportedFeature,
    #[error("truncated file")]
    NotEnoughData,
    #[error("the quality is not 0 to 100")]
    InvalidConfiguration,
    #[error("a side is 0 or more than 16383 pixels, or the input is shorter than the image")]
    BadDimension,
    #[error("the first partition of the lossy image is over 512 KiB")]
    Partition0Overflow,
    #[error("the file would be over 4 GiB")]
    FileTooBig,
    #[error("bun_webp broke one of its own invariants")]
    Bug,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl From<Bug> for Error {
    fn from(_: Bug) -> Self {
        Self::Bug
    }
}

impl From<std::collections::TryReserveError> for Error {
    fn from(_: std::collections::TryReserveError) -> Self {
        Self::Alloc(bun_alloc::AllocError)
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
