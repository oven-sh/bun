/// To close the connection with. The codes are those of RFC 9204 §6.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[repr(u16)]
pub enum Error {
    #[error("QPACK_DECOMPRESSION_FAILED")]
    DecompressionFailed = 0x200,
    #[error("QPACK_ENCODER_STREAM_ERROR")]
    EncoderStream = 0x201,
    #[error("QPACK_DECODER_STREAM_ERROR")]
    DecoderStream = 0x202,
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
