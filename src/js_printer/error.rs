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
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::WriteFailed => "WriteFailed",
            Self::StackOverflow => "StackOverflow",
            Self::PartialWrite => "PartialWrite",
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
