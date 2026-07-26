#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("DoesntTakeValue")]
    DoesntTakeValue,
    #[error("MissingValue")]
    MissingValue,
    #[error("InvalidArgument")]
    InvalidArgument,
    #[error("WriteFailed")]
    WriteFailed,
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::DoesntTakeValue => "DoesntTakeValue",
            Self::MissingValue => "MissingValue",
            Self::InvalidArgument => "InvalidArgument",
            Self::WriteFailed => "WriteFailed",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

impl From<core::fmt::Error> for Error {
    fn from(_: core::fmt::Error) -> Self {
        Self::WriteFailed
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
