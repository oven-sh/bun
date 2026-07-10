#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Invalid Bunfig")]
    InvalidBunfig,

    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),

    #[error(transparent)]
    Parse(#[from] bun_parsers::Error),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::InvalidBunfig => "Invalid Bunfig",
            Self::Alloc(_) => "OutOfMemory",
            Self::Parse(e) => e.name(),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
