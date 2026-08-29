#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("DoesntTakeValue")]
    DoesntTakeValue,
    #[error("MissingValue")]
    MissingValue,
    #[error("InvalidArgument")]
    InvalidArgument,
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::DoesntTakeValue => "DoesntTakeValue",
            Self::MissingValue => "MissingValue",
            Self::InvalidArgument => "InvalidArgument",
        }
    }
}

impl From<crate::streaming::ArgError> for Error {
    fn from(e: crate::streaming::ArgError) -> Self {
        match e {
            crate::streaming::ArgError::DoesntTakeValue => Self::DoesntTakeValue,
            crate::streaming::ArgError::MissingValue => Self::MissingValue,
            crate::streaming::ArgError::InvalidArgument => Self::InvalidArgument,
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
