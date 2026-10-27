#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("invalid signature")]
    Signature,
    #[error("end of file")]
    UnexpectedEof,
    #[error("invalid IHDR chunk")]
    InvalidHeader,
    #[error("a row of the image is too long")]
    RowTooLong,
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
    #[error("more tRNS entries than PLTE entries")]
    InvalidTransparency,
    #[error("reached chunk limits")]
    ChunkLimits,
    #[error("IDAT stream too short")]
    IdatTooShort,
    #[error("IDAT stream error")]
    IdatStream,
    #[error("invalid scanline filter")]
    InvalidFilter,
    #[error("zlib error")]
    Zlib,
    #[error("invalid buffer size")]
    BufferSize,
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
