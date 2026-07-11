#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("MissingCredentials")]
    MissingCredentials,
    #[error("InvalidMethod")]
    InvalidMethod,
    #[error("InvalidPath")]
    InvalidPath,
    #[error("InvalidEndpoint")]
    InvalidEndpoint,
    #[error("InvalidSessionToken")]
    InvalidSessionToken,
    #[error("SignError")]
    SignError,
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::MissingCredentials => "MissingCredentials",
            Self::InvalidMethod => "InvalidMethod",
            Self::InvalidPath => "InvalidPath",
            Self::InvalidEndpoint => "InvalidEndpoint",
            Self::InvalidSessionToken => "InvalidSessionToken",
            Self::SignError => "SignError",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

impl From<crate::credentials::SignError> for Error {
    fn from(e: crate::credentials::SignError) -> Self {
        use crate::credentials::SignError;
        match e {
            SignError::MissingCredentials => Self::MissingCredentials,
            SignError::InvalidMethod => Self::InvalidMethod,
            SignError::InvalidPath => Self::InvalidPath,
            SignError::InvalidEndpoint => Self::InvalidEndpoint,
            SignError::InvalidSessionToken => Self::InvalidSessionToken,
            SignError::InvalidHeaderValue
            | SignError::FailedToGenerateSignature
            | SignError::NoSpaceLeft => Self::SignError,
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
