#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("not a JPEG file")]
    InvalidSignature,
    #[error("unknown marker")]
    UnknownMarker,
    #[error("marker out of place")]
    MarkerOutOfPlace,
    #[error("invalid segment length")]
    InvalidLength,
    #[error("invalid frame header")]
    InvalidFrame,
    #[error("invalid scan header")]
    InvalidScan,
    #[error("invalid table")]
    InvalidTable,
    #[error("missing table")]
    MissingTable,
    #[error("invalid restart interval")]
    InvalidRestartInterval,
    #[error("coefficient out of range")]
    InvalidCoefficient,
    #[error("component without a scan")]
    MissingScan,
    #[error("too many scans")]
    TooManyScans,
    #[error("unsupported kind of JPEG")]
    Unsupported,
    #[error("invalid image size")]
    InvalidSize,
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

impl From<bun_highway::JpegMisfit> for Error {
    fn from(_: bun_highway::JpegMisfit) -> Self {
        Self::Internal
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
