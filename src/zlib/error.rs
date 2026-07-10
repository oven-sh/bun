#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("ZlibError")]
    ZlibError,
    #[error("ShortRead")]
    ShortRead,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Core(#[from] bun_core::Error),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::ZlibError => "ZlibError",
            Self::ShortRead => "ShortRead",
            Self::Alloc(_) => "OutOfMemory",
            Self::Core(e) => e.name(),
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
