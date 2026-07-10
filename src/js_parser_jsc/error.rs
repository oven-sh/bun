#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("ModuleNotFound")]
    ModuleNotFound,
    #[error("MacroNotFound")]
    MacroNotFound,
    #[error("MacroLoadError")]
    MacroLoadError,
    #[error("MacroFailed")]
    MacroFailed,
    #[error("JSTerminated")]
    JSTerminated,
    #[error("JSError")]
    JSError,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::ModuleNotFound => "ModuleNotFound",
            Self::MacroNotFound => "MacroNotFound",
            Self::MacroLoadError => "MacroLoadError",
            Self::MacroFailed => "MacroFailed",
            Self::JSTerminated => "JSTerminated",
            Self::JSError => "JSError",
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
