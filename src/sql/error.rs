#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("InvalidCharacter")]
    InvalidCharacter,
    #[error("UnknownFieldType")]
    UnknownFieldType,
    #[error("InvalidAuthSwitchRequest")]
    InvalidAuthSwitchRequest,
    #[error("MissingAuthData")]
    MissingAuthData,
    #[error("InvalidPublicKey")]
    InvalidPublicKey,
    #[error("FailedToEncryptPassword")]
    FailedToEncryptPassword,
    #[error(transparent)]
    MySQL(#[from] crate::mysql::protocol::any_mysql_error::Error),
    #[error(transparent)]
    Postgres(#[from] crate::postgres::any_postgres_error::AnyPostgresError),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::InvalidCharacter => "InvalidCharacter",
            Self::UnknownFieldType => "UnknownFieldType",
            Self::InvalidAuthSwitchRequest => "InvalidAuthSwitchRequest",
            Self::MissingAuthData => "MissingAuthData",
            Self::InvalidPublicKey => "InvalidPublicKey",
            Self::FailedToEncryptPassword => "FailedToEncryptPassword",
            Self::MySQL(e) => <&'static str>::from(e),
            Self::Postgres(e) => <&'static str>::from(e),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
