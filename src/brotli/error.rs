use core::ffi::CStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("BrotliFailedToLoad")]
    BrotliFailedToLoad,
    #[error("BrotliDecompressionError")]
    BrotliDecompressionError,
    /// The output, or the decoder state the stream's window size dictates, could not be allocated.
    #[error("OutOfMemory")]
    OutOfMemory,
    /// The stream goes on, and more input may come.
    #[error("ShortRead")]
    ShortRead,
}

impl Error {
    pub fn name(self) -> &'static str {
        match self {
            Self::BrotliFailedToLoad => "BrotliFailedToLoad",
            Self::BrotliDecompressionError => "BrotliDecompressionError",
            Self::OutOfMemory => "OutOfMemory",
            Self::ShortRead => "ShortRead",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;

/// The values are those of `BROTLI_DECODER_ERROR_*` in `node:zlib`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i8)]
pub enum DecodeError {
    ExuberantNibble = -1,
    Reserved = -2,
    ExuberantMetaNibble = -3,
    SimpleHuffmanAlphabet = -4,
    SimpleHuffmanSame = -5,
    ClSpace = -6,
    HuffmanSpace = -7,
    ContextMapRepeat = -8,
    BlockLength1 = -9,
    BlockLength2 = -10,
    Transform = -11,
    Dictionary = -12,
    WindowBits = -13,
    Padding1 = -14,
    Padding2 = -15,
    Distance = -16,
    BlockSwitch = -17,
    CompoundDictionary = -18,
    AllocTreeGroups = -22,
    AllocContextMap = -25,
    AllocRingBuffer1 = -26,
    AllocRingBuffer2 = -27,
    /// For what the types allow and the code rules out.
    Unreachable = -31,
}

impl DecodeError {
    /// `error.code` in `node:zlib`, which has the two underscores.
    pub fn code(self) -> &'static CStr {
        match self {
            Self::ExuberantNibble => c"ERR__ERROR_FORMAT_EXUBERANT_NIBBLE",
            Self::Reserved => c"ERR__ERROR_FORMAT_RESERVED",
            Self::ExuberantMetaNibble => c"ERR__ERROR_FORMAT_EXUBERANT_META_NIBBLE",
            Self::SimpleHuffmanAlphabet => c"ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET",
            Self::SimpleHuffmanSame => c"ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_SAME",
            Self::ClSpace => c"ERR__ERROR_FORMAT_CL_SPACE",
            Self::HuffmanSpace => c"ERR__ERROR_FORMAT_HUFFMAN_SPACE",
            Self::ContextMapRepeat => c"ERR__ERROR_FORMAT_CONTEXT_MAP_REPEAT",
            Self::BlockLength1 => c"ERR__ERROR_FORMAT_BLOCK_LENGTH_1",
            Self::BlockLength2 => c"ERR__ERROR_FORMAT_BLOCK_LENGTH_2",
            Self::Transform => c"ERR__ERROR_FORMAT_TRANSFORM",
            Self::Dictionary => c"ERR__ERROR_FORMAT_DICTIONARY",
            Self::WindowBits => c"ERR__ERROR_FORMAT_WINDOW_BITS",
            Self::Padding1 => c"ERR__ERROR_FORMAT_PADDING_1",
            Self::Padding2 => c"ERR__ERROR_FORMAT_PADDING_2",
            Self::Distance => c"ERR__ERROR_FORMAT_DISTANCE",
            Self::BlockSwitch => c"ERR__ERROR_FORMAT_BLOCK_SWITCH",
            Self::CompoundDictionary => c"ERR__ERROR_COMPOUND_DICTIONARY",
            Self::AllocTreeGroups => c"ERR__ERROR_ALLOC_TREE_GROUPS",
            Self::AllocContextMap => c"ERR__ERROR_ALLOC_CONTEXT_MAP",
            Self::AllocRingBuffer1 => c"ERR__ERROR_ALLOC_RING_BUFFER_1",
            Self::AllocRingBuffer2 => c"ERR__ERROR_ALLOC_RING_BUFFER_2",
            Self::Unreachable => c"ERR__ERROR_UNREACHABLE",
        }
    }

    pub fn is_out_of_memory(self) -> bool {
        matches!(
            self,
            Self::AllocTreeGroups
                | Self::AllocContextMap
                | Self::AllocRingBuffer1
                | Self::AllocRingBuffer2
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodeError {
    /// The state of the stream does not allow it.
    InvalidOperation,
    OutOfMemory,
}

impl From<bun_alloc::AllocError> for EncodeError {
    fn from(_: bun_alloc::AllocError) -> Self {
        Self::OutOfMemory
    }
}
