#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("PBKDFD2")]
    PBKDFD2,
    #[error("InvalidServerKey")]
    InvalidServerKey,
    #[error("InvalidServerSignature")]
    InvalidServerSignature,
    #[error("InvalidBinaryValue")]
    InvalidBinaryValue,
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::PBKDFD2 => "PBKDFD2",
            Self::InvalidServerKey => "InvalidServerKey",
            Self::InvalidServerSignature => "InvalidServerSignature",
            Self::InvalidBinaryValue => "InvalidBinaryValue",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
