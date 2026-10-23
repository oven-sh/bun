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
    #[error("Truncated input file")]
    TruncatedInput,
    #[error("Truncated tar archive detected while reading sparse file data")]
    TruncatedSparse,
    #[error("Redundant '{0}' header")]
    RedundantHeader(char),
    #[error("Special header has invalid size")]
    InvalidSpecialHeaderSize,
    #[error("Invalid empty pax extended header")]
    EmptyPaxHeader,
    #[error("Malformed pax attribute")]
    MalformedPaxAttribute,
    #[error("Tar size attribute overflow")]
    PaxSizeOverflow,
    #[error("Tar entry has negative size")]
    NegativeSize,
    #[error("Tar entry size overflow")]
    SizeOverflow,
    #[error("Malformed sparse map data")]
    MalformedSparseMap,
    #[error("Unreasonably large sparse map")]
    SparseMapTooLarge,
    #[error("Oversized AppleDouble extension")]
    OversizedMacMetadata,
    #[error("truncated gzip input")]
    TruncatedGzip,
    #[error("gzip decompression failed")]
    GzipDecompressionFailed,
    #[error("gzip trailer mismatch: bad CRC32 or uncompressed size")]
    GzipTrailerMismatch,
    #[error("Out of memory")]
    OutOfMemory,
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
