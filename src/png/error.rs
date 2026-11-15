#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("invalid signature")]
    InvalidSignature,
    #[error("end of file")]
    UnexpectedEof,
    #[error("invalid IHDR chunk")]
    InvalidHeader,
    #[error("image too large")]
    ImageTooLarge,
    #[error("chunk exceeds maximum standard length")]
    ChunkTooLong,
    #[error("critical chunk out of place")]
    ChunkOutOfPlace,
    #[error("unknown critical chunk")]
    UnknownCriticalChunk,
    #[error("invalid PLTE chunk")]
    InvalidPalette,
    #[error("missing PLTE for indexed image")]
    MissingPalette,
    #[error("IDAT stream too short")]
    IdatTooShort,
    #[error("IDAT stream error")]
    InvalidIdatStream,
    #[error("invalid filter type")]
    InvalidFilterType,
    #[error("zlib error")]
    Zlib,
    #[error("invalid buffer size")]
    InvalidBufferSize,
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

impl From<bun_zlib::ZlibError> for Error {
    fn from(error: bun_zlib::ZlibError) -> Self {
        match error {
            bun_zlib::ZlibError::OutOfMemory => Self::Alloc(bun_alloc::AllocError),
            _ => Self::Zlib,
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
