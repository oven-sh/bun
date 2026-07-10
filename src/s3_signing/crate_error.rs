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

pub type Result<T, E = Error> = core::result::Result<T, E>;
