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

/// Why `Expr::deep_clone` could not copy a tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DeepCloneError {
    /// The tree is nested deeper than the native stack allows. The parsers
    /// guard their own recursion, but their frames are smaller than the
    /// clone's, so a tree they accept can still overflow here.
    #[error("StackOverflow")]
    StackOverflow,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}
