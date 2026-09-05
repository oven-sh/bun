#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("BrotliFailedToCreateInstance")]
    BrotliFailedToCreateInstance,
    #[error("BrotliDecompressionError")]
    BrotliDecompressionError,
    /// The output, or the decoder state the stream's window size dictates, could not be allocated.
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("ShortRead")]
    ShortRead,
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::BrotliFailedToCreateInstance => "BrotliFailedToCreateInstance",
            Self::BrotliDecompressionError => "BrotliDecompressionError",
            Self::OutOfMemory => "OutOfMemory",
            Self::ShortRead => "ShortRead",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
