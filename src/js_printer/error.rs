#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("WriteFailed")]
    WriteFailed,
    #[error("StackOverflow")]
    StackOverflow,
    #[error("PartialWrite")]
    PartialWrite,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Core(#[from] bun_core::Error),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::WriteFailed => "WriteFailed",
            Self::StackOverflow => "StackOverflow",
            Self::PartialWrite => "PartialWrite",
            Self::Alloc(_) => "OutOfMemory",
            Self::Core(e) => e.name(),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
