#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("InvalidQueryBinding")]
    InvalidQueryBinding,
    #[error("BufferTooSmall")]
    BufferTooSmall,
    #[error("InvalidEscapeSequence")]
    InvalidEscapeSequence,
    #[error("UnknownEscapeSequence")]
    UnknownEscapeSequence,
    #[error("InvalidBuffer")]
    InvalidBuffer,
    #[error("InvalidSign")]
    InvalidSign,
    #[error("PBKDFD2")]
    PBKDFD2,
    #[error("InvalidServerKey")]
    InvalidServerKey,
    #[error("InvalidServerSignature")]
    InvalidServerSignature,
    #[error("UnsupportedArrayType")]
    UnsupportedArrayType,
    #[error("JSError")]
    JSError,
    #[error("AuthenticationFailed")]
    AuthenticationFailed,
    #[error("InvalidBinaryValue")]
    InvalidBinaryValue,
    #[error("Terminated")]
    Terminated,
    #[error("Thrown")]
    Thrown,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::InvalidQueryBinding => "InvalidQueryBinding",
            Self::BufferTooSmall => "BufferTooSmall",
            Self::InvalidEscapeSequence => "InvalidEscapeSequence",
            Self::UnknownEscapeSequence => "UnknownEscapeSequence",
            Self::InvalidBuffer => "InvalidBuffer",
            Self::InvalidSign => "InvalidSign",
            Self::PBKDFD2 => "PBKDFD2",
            Self::InvalidServerKey => "InvalidServerKey",
            Self::InvalidServerSignature => "InvalidServerSignature",
            Self::UnsupportedArrayType => "UnsupportedArrayType",
            Self::JSError => "JSError",
            Self::AuthenticationFailed => "AuthenticationFailed",
            Self::InvalidBinaryValue => "InvalidBinaryValue",
            Self::Terminated => "Terminated",
            Self::Thrown => "Thrown",
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
