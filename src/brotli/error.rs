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
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::BrotliFailedToLoad => "BrotliFailedToLoad",
            Self::BrotliFailedToCreateInstance => "BrotliFailedToCreateInstance",
            Self::BrotliDecompressionError => "BrotliDecompressionError",
            Self::ShortRead => "ShortRead",
            Self::BrotliCompressionError => "BrotliCompressionError",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
