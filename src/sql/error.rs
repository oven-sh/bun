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
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::InvalidCharacter => "InvalidCharacter",
            Self::UnknownFieldType => "UnknownFieldType",
            Self::InvalidAuthSwitchRequest => "InvalidAuthSwitchRequest",
            Self::MissingAuthData => "MissingAuthData",
            Self::InvalidPublicKey => "InvalidPublicKey",
            Self::FailedToEncryptPassword => "FailedToEncryptPassword",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
