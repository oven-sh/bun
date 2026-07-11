#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("BrotliFailedToLoad")]
    BrotliFailedToLoad,
    #[error("BrotliFailedToCreateInstance")]
    BrotliFailedToCreateInstance,
    #[error("BrotliDecompressionError")]
    BrotliDecompressionError,
    #[error("ShortRead")]
    ShortRead,
    #[error("BrotliCompressionError")]
    BrotliCompressionError,
    #[error(transparent)]
    Core(#[from] bun_core::Error),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::BrotliFailedToLoad => "BrotliFailedToLoad",
            Self::BrotliFailedToCreateInstance => "BrotliFailedToCreateInstance",
            Self::BrotliDecompressionError => "BrotliDecompressionError",
            Self::ShortRead => "ShortRead",
            Self::BrotliCompressionError => "BrotliCompressionError",
            Self::Core(e) => e.name(),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
