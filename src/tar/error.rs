#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Unrecognized archive format")]
    UnrecognizedFormat,
    #[error("Damaged tar archive (bad header checksum)")]
    BadChecksum,
    #[error("Damaged tar archive (end-of-archive within a sequence of headers)")]
    EndWithinHeaders,
    #[error("Truncated tar archive detected while reading next header")]
    TruncatedHeader,
    #[error("Truncated tar archive detected while reading data")]
    TruncatedData,
    #[error("Truncated archive detected while reading metadata")]
    TruncatedMetadata,
    #[error("Truncated tar archive detected while reading pax attribute name")]
    TruncatedPaxName,
    #[error("Truncated archive detected while reading macOS metadata")]
    TruncatedMacMetadata,
    #[error("Truncated tar archive detected while skipping data")]
    TruncatedSkip,
    #[error("Truncated input file (needed {needed} bytes, only {available} available)")]
    TruncatedInput { needed: i64, available: i64 },
    #[error("Truncated tar archive detected while reading sparse file data")]
    TruncatedSparse,
    #[error("Redundant '{0}' header")]
    RedundantHeader(&'static str),
    #[error("Special header has invalid size: {0}")]
    InvalidSpecialHeaderSize(i64),
    #[error("pax extension header has invalid size: {0}")]
    InvalidPaxHeaderSize(i64),
    #[error("Invalid empty pax extended header")]
    EmptyPaxHeader,
    #[error("Invalid empty pax global extended header")]
    EmptyPaxGlobalHeader,
    #[error("Malformed pax attribute")]
    MalformedPaxAttribute,
    #[error("Tar size attribute overflow")]
    PaxSizeOverflow,
    #[error("Tar entry has negative file size")]
    NegativeFileSize,
    #[error("Tar entry has negative size")]
    NegativeSize,
    #[error("Tar entry size overflow")]
    SizeOverflow,
    #[error("Line too long")]
    LineTooLong,
    #[error("Malformed sparse map data")]
    MalformedSparseMap,
    #[error("Encountered out-of-order sparse blocks")]
    OutOfOrderSparse,
    #[error("Unreasonably large sparse map")]
    SparseMapTooLarge,
    #[error(
        "The holes of sparse files add up to more than {limit} bytes, the most that is read into memory from an archive of this size"
    )]
    HolesTooLarge { limit: usize },
    #[error("Oversized AppleDouble extension")]
    OversizedMacMetadata,
    #[error("Input requires too many filters for decoding")]
    TooManyLayers,
    #[error("truncated gzip input")]
    TruncatedGzip,
    #[error("gzip decompression failed")]
    GzipDecompressionFailed,
    #[error("GZip compression failed")]
    GzipCompressionFailed,
    #[error("gzip trailer mismatch: bad CRC32 or uncompressed size")]
    GzipTrailerMismatch,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl From<std::collections::TryReserveError> for Error {
    fn from(_: std::collections::TryReserveError) -> Self {
        Self::Alloc(bun_alloc::AllocError)
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
