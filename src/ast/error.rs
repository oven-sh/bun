#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("SyntaxError")]
    SyntaxError,
    #[error("ModuleNotFound")]
    ModuleNotFound,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::SyntaxError => "SyntaxError",
            Self::ModuleNotFound => "ModuleNotFound",
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;

/// `Expr::deep_clone` recurses once per nesting level, so a tree the
/// depth-guarded parsers accepted can still run out of native stack here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DeepCloneError {
    #[error("StackOverflow")]
    StackOverflow,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}
