#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("EndOfStream")]
    EndOfStream,
    #[error("FmtError")]
    FmtError,
    #[error("MachportCreationFailed")]
    MachportCreationFailed,
    #[error("Unexpected")]
    Unexpected,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::EndOfStream => "EndOfStream",
            Self::FmtError => "FmtError",
            Self::MachportCreationFailed => "MachportCreationFailed",
            Self::Unexpected => "Unexpected",
            Self::Sys(e) => <&'static str>::from(e),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
