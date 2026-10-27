/// Why a stream cannot be decoded or an image cannot be encoded. The messages are libjpeg's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Empty input file")]
    InputEmpty,
    #[error("Not a JPEG file: starts with 0x{0:02x} 0x{1:02x}")]
    NoSoi(u8, u8),
    #[error("Invalid JPEG file structure: two SOI markers")]
    SoiDuplicate,
    #[error("Invalid JPEG file structure: two SOF markers")]
    SofDuplicate,
    #[error("Invalid JPEG file structure: missing SOS marker")]
    SofNoSos,
    #[error("Unsupported JPEG process: SOF type 0x{0:02x}")]
    SofUnsupported(u8),
    #[error("Invalid JPEG file structure: SOS before SOF")]
    SosNoSof,
    #[error("Didn't expect more than one scan")]
    EoiExpected,
    #[error("JPEG datastream contains no image")]
    NoImage,
    #[error("Empty JPEG image (DNL not supported)")]
    EmptyImage,
    #[error("Bogus marker length")]
    BadLength,
    #[error("Invalid component ID {0} in SOS")]
    BadComponentId(u8),
    #[error("Bogus DAC index {0}")]
    DacIndex(u8),
    #[error("Bogus DAC value 0x{0:x}")]
    DacValue(u8),
    #[error("Bogus DHT index {0}")]
    DhtIndex(u8),
    #[error("Bogus DQT index {0}")]
    DqtIndex(u8),
    #[error("Bogus Huffman table definition")]
    BadHuffTable,
    #[error("Huffman table 0x{0:02x} was not defined")]
    NoHuffTable(u8),
    #[error("Quantization table 0x{0:02x} was not defined")]
    NoQuantTable(u8),
    #[error("Unsupported marker type 0x{0:02x}")]
    UnknownMarker(u8),
    #[error("Maximum supported image dimension is {0} pixels")]
    ImageTooBig(u32),
    #[error("Unsupported JPEG data precision {0}")]
    BadPrecision(u8),
    #[error("Too many color components: {0}, max {1}")]
    ComponentCount(u32, u32),
    #[error("Bogus sampling factors")]
    BadSampling,
    #[error("Sampling factors too large for interleaved scan")]
    BadMcuSize,
    #[error("Fractional sampling not implemented yet")]
    FractSampleNotImpl,
    #[error("Unsupported color conversion request")]
    ConversionNotImpl,
    #[error("Could not determine colorspace of JPEG image")]
    UnknownColorSpace,
    #[error("Invalid progressive parameters Ss={0} Se={1} Ah={2} Al={3}")]
    BadProgression(u8, u8, u8, u8),
    #[error("Bogus virtual array access")]
    BadVirtualAccess,
    #[error(
        "Invalid restart interval {0}; must be an integer multiple of the number of MCUs in an MCU row ({1})"
    )]
    BadRestart(u32, u32),
    #[error("Arithmetic table 0x{0:02x} was not defined")]
    NoArithTable(u8),
    #[error("Sorry, arithmetic coding is not implemented")]
    ArithNotImpl,
    #[error("Corrupt JPEG data: bad DCT coefficient")]
    BadDctCoef,
    #[error("Huffman code size table overflow")]
    HuffCodeLengthOverflow,
    #[error("Missing Huffman code table entry")]
    HuffMissingCode,
    #[error("Invalid argument")]
    InvalidArgument,
    #[error("Insufficient memory")]
    OutOfMemory,
    /// A state this crate rules out. It stands where C would index out of bounds.
    #[error("Internal error")]
    Internal,
}

pub type Result<T> = core::result::Result<T, Error>;
