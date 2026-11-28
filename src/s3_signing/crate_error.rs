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
