#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("MachportCreationFailed")]
    MachportCreationFailed,
    #[error("Unexpected")]
    Unexpected,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
