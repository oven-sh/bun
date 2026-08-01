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
    #[error(transparent)]
    Core(#[from] bun_core::Error),
    #[error(transparent)]
    Jsc(#[from] bun_jsc::CrateError),
    #[error(transparent)]
    Bundler(#[from] bun_bundler::Error),
    #[error(transparent)]
    Resolver(#[from] bun_resolver::Error),
    #[error(transparent)]
    ToJs(#[from] bun_ast::ToJSError),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::ModuleNotFound => "ModuleNotFound",
            Self::MacroNotFound => "MacroNotFound",
            Self::MacroLoadError => "MacroLoadError",
            Self::MacroFailed => "MacroFailed",
            Self::JSTerminated => "JSTerminated",
            Self::JSError => "JSError",
            Self::Alloc(_) => "OutOfMemory",
            Self::Core(e) => e.name(),
            Self::Jsc(e) => e.name(),
            Self::Bundler(e) => e.name(),
            Self::Resolver(e) => e.name(),
            Self::ToJs(e) => e.into(),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
