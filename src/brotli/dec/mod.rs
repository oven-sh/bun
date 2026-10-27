//! The decoder.

mod bit_reader;
mod decoder;
mod huffman;
mod prefix;

pub use decoder::Decoder;

use core::ffi::CStr;

use crate::util::Bug;

/// What [`Decoder::decompress_stream`] returns.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum DecoderResult {
    /// The input is corrupt, or memory ran out. [`Decoder::error_code`] says which.
    Error = 0,
    /// The stream has ended and all of the output was written.
    Success = 1,
    /// All of the input was consumed and the stream has not ended.
    NeedsMoreInput = 2,
    /// The output is full and there is more to write.
    NeedsMoreOutput = 3,
}

macro_rules! error_codes {
    ($($variant:ident = $value:literal, $name:literal;)*) => {
        /// The numbers and names are those of `BrotliDecoderErrorCode`, which `node:zlib` exposes.
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(i32)]
        pub enum DecoderErrorCode {
            $($variant = $value,)*
        }

        impl DecoderErrorCode {
            /// What `BrotliDecoderErrorString` returns.
            pub const fn name(self) -> &'static str {
                match self {
                    $(Self::$variant => $name,)*
                }
            }

            /// `"ERR_"` and [`Self::name`], which is the `code` of the error in `node:zlib`.
            pub const fn node_code(self) -> &'static CStr {
                match self {
                    $(Self::$variant => const {
                        match CStr::from_bytes_with_nul(concat!("ERR_", $name, "\0").as_bytes()) {
                            Ok(code) => code,
                            Err(_) => panic!(),
                        }
                    },)*
                }
            }
        }
    };
}

error_codes! {
    NoError = 0, "_NO_ERROR";
    Success = 1, "_SUCCESS";
    NeedsMoreInput = 2, "_NEEDS_MORE_INPUT";
    NeedsMoreOutput = 3, "_NEEDS_MORE_OUTPUT";

    FormatExuberantNibble = -1, "_ERROR_FORMAT_EXUBERANT_NIBBLE";
    FormatReserved = -2, "_ERROR_FORMAT_RESERVED";
    FormatExuberantMetaNibble = -3, "_ERROR_FORMAT_EXUBERANT_META_NIBBLE";
    FormatSimpleHuffmanAlphabet = -4, "_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET";
    FormatSimpleHuffmanSame = -5, "_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME";
    FormatClSpace = -6, "_ERROR_FORMAT_CL_SPACE";
    FormatHuffmanSpace = -7, "_ERROR_FORMAT_HUFFMAN_SPACE";
    FormatContextMapRepeat = -8, "_ERROR_FORMAT_CONTEXT_MAP_REPEAT";
    FormatBlockLength1 = -9, "_ERROR_FORMAT_BLOCK_LENGTH_1";
    FormatBlockLength2 = -10, "_ERROR_FORMAT_BLOCK_LENGTH_2";
    FormatTransform = -11, "_ERROR_FORMAT_TRANSFORM";
    FormatDictionary = -12, "_ERROR_FORMAT_DICTIONARY";
    FormatWindowBits = -13, "_ERROR_FORMAT_WINDOW_BITS";
    FormatPadding1 = -14, "_ERROR_FORMAT_PADDING_1";
    FormatPadding2 = -15, "_ERROR_FORMAT_PADDING_2";
    FormatDistance = -16, "_ERROR_FORMAT_DISTANCE";
    FormatBlockSwitch = -17, "_ERROR_FORMAT_BLOCK_SWITCH";

    CompoundDictionary = -18, "_ERROR_COMPOUND_DICTIONARY";
    DictionaryNotSet = -19, "_ERROR_DICTIONARY_NOT_SET";
    InvalidArguments = -20, "_ERROR_INVALID_ARGUMENTS";

    AllocContextModes = -21, "_ERROR_ALLOC_CONTEXT_MODES";
    AllocTreeGroups = -22, "_ERROR_ALLOC_TREE_GROUPS";
    AllocContextMap = -25, "_ERROR_ALLOC_CONTEXT_MAP";
    AllocRingBuffer1 = -26, "_ERROR_ALLOC_RING_BUFFER_1";
    AllocRingBuffer2 = -27, "_ERROR_ALLOC_RING_BUFFER_2";
    AllocBlockTypeTrees = -30, "_ERROR_ALLOC_BLOCK_TYPE_TREES";

    Unreachable = -31, "_ERROR_UNREACHABLE";
}

impl DecoderErrorCode {
    /// Decoding cannot go on.
    pub const fn is_error(self) -> bool {
        (self as i32) < 0
    }

    /// Memory ran out.
    pub const fn is_alloc_failure(self) -> bool {
        matches!(
            self,
            Self::AllocContextModes
                | Self::AllocTreeGroups
                | Self::AllocContextMap
                | Self::AllocRingBuffer1
                | Self::AllocRingBuffer2
                | Self::AllocBlockTypeTrees
        )
    }
}

impl From<Bug> for DecoderErrorCode {
    #[cold]
    fn from(_: Bug) -> Self {
        Self::Unreachable
    }
}

/// `BrotliDecoderParameter`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum DecoderParameter {
    /// Allocate the whole window at once, rather than a ring buffer that grows with the output.
    DisableRingBufferReallocation = 0,
    /// Accept "large window brotli", which is not RFC 7932.
    LargeWindow = 1,
}

impl DecoderParameter {
    pub const fn from_raw(raw: u32) -> Option<Self> {
        match raw {
            0 => Some(Self::DisableRingBufferReallocation),
            1 => Some(Self::LargeWindow),
            _ => None,
        }
    }
}
