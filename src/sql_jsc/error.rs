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
    #[error("Thrown")]
    Thrown,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    MySqlProtocol(#[from] bun_sql::mysql::protocol::Error),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::PBKDFD2 => "PBKDFD2",
            Self::InvalidServerKey => "InvalidServerKey",
            Self::InvalidServerSignature => "InvalidServerSignature",
            Self::InvalidBinaryValue => "InvalidBinaryValue",
            Self::Thrown => "Thrown",
            Self::Alloc(_) => "OutOfMemory",
            Self::MySqlProtocol(e) => <&'static str>::from(e),
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
