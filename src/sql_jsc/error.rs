#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
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
            Self::InvalidBinaryValue => "InvalidBinaryValue",
            Self::Thrown => "Thrown",
            Self::Alloc(_) => "OutOfMemory",
            Self::MySqlProtocol(e) => <&'static str>::from(e),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
