//! `zstd_errors.h` and `error_private.c`.

use core::ffi::CStr;

/// `ZSTD_ErrorCode`, without `ZSTD_error_no_error`. The values are part of `node:zlib`'s constants.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("{}", self.message().to_str().unwrap_or_default())]
pub enum Error {
    Generic = 1,
    PrefixUnknown = 10,
    VersionUnsupported = 12,
    FrameParameterUnsupported = 14,
    FrameParameterWindowTooLarge = 16,
    CorruptionDetected = 20,
    ChecksumWrong = 22,
    LiteralsHeaderWrong = 24,
    DictionaryCorrupted = 30,
    DictionaryWrong = 32,
    DictionaryCreationFailed = 34,
    ParameterUnsupported = 40,
    ParameterCombinationUnsupported = 41,
    ParameterOutOfBound = 42,
    TableLogTooLarge = 44,
    MaxSymbolValueTooLarge = 46,
    MaxSymbolValueTooSmall = 48,
    CannotProduceUncompressedBlock = 49,
    StabilityConditionNotRespected = 50,
    StageWrong = 60,
    InitMissing = 62,
    MemoryAllocation = 64,
    WorkSpaceTooSmall = 66,
    DstSizeTooSmall = 70,
    SrcSizeWrong = 72,
    DstBufferNull = 74,
    NoForwardProgressDestFull = 80,
    NoForwardProgressInputEmpty = 82,
}

pub type Result<T = usize, E = Error> = core::result::Result<T, E>;

impl Error {
    /// `ZSTD_getErrorString`.
    pub const fn message(self) -> &'static CStr {
        match self {
            Self::Generic => c"Error (generic)",
            Self::PrefixUnknown => c"Unknown frame descriptor",
            Self::VersionUnsupported => c"Version not supported",
            Self::FrameParameterUnsupported => c"Unsupported frame parameter",
            Self::FrameParameterWindowTooLarge => c"Frame requires too much memory for decoding",
            Self::CorruptionDetected => c"Data corruption detected",
            Self::ChecksumWrong => c"Restored data doesn't match checksum",
            Self::LiteralsHeaderWrong => {
                c"Header of Literals' block doesn't respect format specification"
            }
            Self::ParameterUnsupported => c"Unsupported parameter",
            Self::ParameterCombinationUnsupported => c"Unsupported combination of parameters",
            Self::ParameterOutOfBound => c"Parameter is out of bound",
            Self::InitMissing => c"Context should be init first",
            Self::MemoryAllocation => c"Allocation error : not enough memory",
            Self::WorkSpaceTooSmall => c"workSpace buffer is not large enough",
            Self::StageWrong => c"Operation not authorized at current processing stage",
            Self::TableLogTooLarge => c"tableLog requires too much memory : unsupported",
            Self::MaxSymbolValueTooLarge => c"Unsupported max Symbol Value : too large",
            Self::MaxSymbolValueTooSmall => c"Specified maxSymbolValue is too small",
            Self::CannotProduceUncompressedBlock => {
                c"This mode cannot generate an uncompressed block"
            }
            Self::StabilityConditionNotRespected => {
                c"pledged buffer stability condition is not respected"
            }
            Self::DictionaryCorrupted => c"Dictionary is corrupted",
            Self::DictionaryWrong => c"Dictionary mismatch",
            Self::DictionaryCreationFailed => c"Cannot create Dictionary from provided samples",
            Self::DstSizeTooSmall => c"Destination buffer is too small",
            Self::SrcSizeWrong => c"Src size is incorrect",
            Self::DstBufferNull => c"Operation on NULL destination buffer",
            Self::NoForwardProgressDestFull => {
                c"Operation made no progress over multiple calls, due to output buffer being full"
            }
            Self::NoForwardProgressInputEmpty => {
                c"Operation made no progress over multiple calls, due to input being empty"
            }
        }
    }

    /// The name of the constant in `zstd_errors.h`, which `node:zlib` reports as the error's `code`.
    pub const fn name(self) -> &'static CStr {
        match self {
            Self::Generic => c"ZSTD_error_GENERIC",
            Self::PrefixUnknown => c"ZSTD_error_prefix_unknown",
            Self::VersionUnsupported => c"ZSTD_error_version_unsupported",
            Self::FrameParameterUnsupported => c"ZSTD_error_frameParameter_unsupported",
            Self::FrameParameterWindowTooLarge => c"ZSTD_error_frameParameter_windowTooLarge",
            Self::CorruptionDetected => c"ZSTD_error_corruption_detected",
            Self::ChecksumWrong => c"ZSTD_error_checksum_wrong",
            Self::LiteralsHeaderWrong => c"ZSTD_error_literals_headerWrong",
            Self::DictionaryCorrupted => c"ZSTD_error_dictionary_corrupted",
            Self::DictionaryWrong => c"ZSTD_error_dictionary_wrong",
            Self::DictionaryCreationFailed => c"ZSTD_error_dictionaryCreation_failed",
            Self::ParameterUnsupported => c"ZSTD_error_parameter_unsupported",
            Self::ParameterCombinationUnsupported => {
                c"ZSTD_error_parameter_combination_unsupported"
            }
            Self::ParameterOutOfBound => c"ZSTD_error_parameter_outOfBound",
            Self::TableLogTooLarge => c"ZSTD_error_tableLog_tooLarge",
            Self::MaxSymbolValueTooLarge => c"ZSTD_error_maxSymbolValue_tooLarge",
            Self::MaxSymbolValueTooSmall => c"ZSTD_error_maxSymbolValue_tooSmall",
            // `node:zlib` has no constant for it.
            Self::CannotProduceUncompressedBlock => c"ZSTD_error_GENERIC",
            Self::StabilityConditionNotRespected => c"ZSTD_error_stabilityCondition_notRespected",
            Self::StageWrong => c"ZSTD_error_stage_wrong",
            Self::InitMissing => c"ZSTD_error_init_missing",
            Self::MemoryAllocation => c"ZSTD_error_memory_allocation",
            Self::WorkSpaceTooSmall => c"ZSTD_error_workSpace_tooSmall",
            Self::DstSizeTooSmall => c"ZSTD_error_dstSize_tooSmall",
            Self::SrcSizeWrong => c"ZSTD_error_srcSize_wrong",
            Self::DstBufferNull => c"ZSTD_error_dstBuffer_null",
            Self::NoForwardProgressDestFull => c"ZSTD_error_noForwardProgress_destFull",
            Self::NoForwardProgressInputEmpty => c"ZSTD_error_noForwardProgress_inputEmpty",
        }
    }
}

/// What the functions that allocate their output fail with. Users get to see the names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum ZstdError {
    /// The output, or the decoder state the frame's window size dictates, could not be allocated.
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidZstdData")]
    InvalidZstdData,
    #[error("DecompressionFailed")]
    DecompressionFailed,
    #[error("ZstdDecompressionError")]
    ZstdDecompressionError,
    #[error("ShortRead")]
    ShortRead,
}

impl ZstdError {
    /// The error for a failed decompression call; `other` is the non-allocation failure.
    pub(crate) fn for_decompression(code: Error, other: ZstdError) -> ZstdError {
        if code == Error::MemoryAllocation {
            ZstdError::OutOfMemory
        } else {
            other
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_show_what_c_and_users_know_them_by() {
        assert_eq!(
            Error::ChecksumWrong.to_string(),
            "Restored data doesn't match checksum"
        );
        assert_eq!(ZstdError::ShortRead.to_string(), "ShortRead");
        assert_eq!(<&'static str>::from(ZstdError::ShortRead), "ShortRead");
    }
}
