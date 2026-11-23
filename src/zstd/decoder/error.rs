//! What can go wrong, in the encoder too.

use core::ffi::CStr;

macro_rules! errors {
    ($($(#[$doc:meta])* $variant:ident = $code:literal, $name:literal, $message:literal;)*) => {
        /// The values are those of `ZSTD_ErrorCode`, which `node:zlib` exposes.
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        #[repr(u8)]
        pub enum Error {
            $($(#[$doc])* $variant = $code,)*
        }

        impl Error {
            pub fn name(self) -> &'static CStr {
                match self {
                    $(Self::$variant => $name,)*
                }
            }

            pub fn message(self) -> &'static CStr {
                match self {
                    $(Self::$variant => $message,)*
                }
            }
        }
    };
}

errors! {
    /// For what the types allow and the code rules out.
    Internal = 1, c"ZSTD_error_GENERIC", c"Error (generic)";
    PrefixUnknown = 10, c"ZSTD_error_prefix_unknown", c"Unknown frame descriptor";
    FrameParameterUnsupported = 14, c"ZSTD_error_frameParameter_unsupported", c"Unsupported frame parameter";
    WindowTooLarge = 16, c"ZSTD_error_frameParameter_windowTooLarge", c"Frame requires too much memory for decoding";
    CorruptionDetected = 20, c"ZSTD_error_corruption_detected", c"Data corruption detected";
    ChecksumWrong = 22, c"ZSTD_error_checksum_wrong", c"Restored data doesn't match checksum";
    LiteralsHeaderWrong = 24, c"ZSTD_error_literals_headerWrong", c"Header of Literals' block doesn't respect format specification";
    DictionaryCorrupted = 30, c"ZSTD_error_dictionary_corrupted", c"Dictionary is corrupted";
    DictionaryWrong = 32, c"ZSTD_error_dictionary_wrong", c"Dictionary mismatch";
    ParameterUnsupported = 40, c"ZSTD_error_parameter_unsupported", c"Unsupported parameter";
    ParameterOutOfBound = 42, c"ZSTD_error_parameter_outOfBound", c"Parameter is out of bound";
    StageWrong = 60, c"ZSTD_error_stage_wrong", c"Operation not authorized at current processing stage";
    MemoryAllocation = 64, c"ZSTD_error_memory_allocation", c"Allocation error : not enough memory";
    DstSizeTooSmall = 70, c"ZSTD_error_dstSize_tooSmall", c"Destination buffer is too small";
    SrcSizeWrong = 72, c"ZSTD_error_srcSize_wrong", c"Src size is incorrect";
    NoForwardProgressDestFull = 80, c"ZSTD_error_noForwardProgress_destFull", c"Operation made no progress over multiple calls, due to output buffer being full";
    NoForwardProgressInputEmpty = 82, c"ZSTD_error_noForwardProgress_inputEmpty", c"Operation made no progress over multiple calls, due to input being empty";
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.message().to_str().unwrap_or_default())
    }
}

impl core::error::Error for Error {}

impl From<std::collections::TryReserveError> for Error {
    fn from(_: std::collections::TryReserveError) -> Self {
        Self::MemoryAllocation
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
