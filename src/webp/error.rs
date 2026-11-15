#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("end of file")]
    UnexpectedEof,
    #[error("invalid RIFF container")]
    InvalidContainer,
    #[error("animations are not supported")]
    Animated,
    #[error("invalid VP8 frame")]
    InvalidLossyFrame,
    #[error("invalid VP8L bitstream")]
    InvalidLosslessBitstream,
    #[error("invalid ALPH chunk")]
    InvalidAlpha,
    #[error("a WebP image is 1 to 16383 pixels wide and high")]
    InvalidDimensions,
    #[error("invalid buffer size")]
    InvalidBufferSize,
    #[error("too much data for a WebP file")]
    TooLarge,
    /// For what the types allow and the code rules out.
    #[error("internal error")]
    Internal,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl From<std::collections::TryReserveError> for Error {
    fn from(_: std::collections::TryReserveError) -> Self {
        Self::Alloc(bun_alloc::AllocError)
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
