#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Clobber")]
    Clobber,
    #[error("SyntaxError")]
    SyntaxError,
    #[error("ModuleNotFound")]
    ModuleNotFound,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Clobber => "Clobber",
            Self::SyntaxError => "SyntaxError",
            Self::ModuleNotFound => "ModuleNotFound",
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
