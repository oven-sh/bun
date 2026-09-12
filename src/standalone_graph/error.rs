/// What `StandaloneModuleGraph::from_bytes` found wrong with the graph embedded
/// in the executable. Every offset it reads comes from the file, so each one is
/// checked before it is dereferenced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Corruption {
    ByteCount,
    ModuleList,
    EntryPointId,
    DuplicateModuleName,
    ModuleName,
    ModuleContents,
    ModuleSourceMap,
    ModuleBytecode,
    ModuleInfo,
    BytecodeOriginPath,
    CompileExecArgv,
}

impl Corruption {
    pub const fn message(self) -> &'static str {
        match self {
            Self::ByteCount => "Corrupted module graph: byte count exceeds the section",
            Self::ModuleList => "Corrupted module graph: module list is out of range",
            Self::EntryPointId => {
                "Corrupted module graph: entry point ID is out of range for the module list"
            }
            Self::DuplicateModuleName => "Corrupted module graph: two modules share a name",
            Self::ModuleName => "Corrupted module graph: module name is out of range",
            Self::ModuleContents => "Corrupted module graph: module contents are out of range",
            Self::ModuleSourceMap => "Corrupted module graph: module source map is out of range",
            Self::ModuleBytecode => "Corrupted module graph: module bytecode is out of range",
            Self::ModuleInfo => "Corrupted module graph: module info is out of range",
            Self::BytecodeOriginPath => {
                "Corrupted module graph: bytecode origin path is out of range"
            }
            Self::CompileExecArgv => "Corrupted module graph: compile exec argv is out of range",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("{}", .0.message())]
    CorruptedModuleGraph(Corruption),
    #[error("TargetNotFound")]
    TargetNotFound,
    #[error("NetworkError")]
    NetworkError,
    #[error("InvalidResponse")]
    InvalidResponse,
    #[error("ExtractionFailed")]
    ExtractionFailed,
    #[error("InvalidSourceMap")]
    InvalidSourceMap,
    #[error("SourceMapTooLarge")]
    SourceMapTooLarge,
    #[error("embedded module graph would exceed 4 GiB (its offsets are 32-bit)")]
    ModuleGraphTooLarge,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Http(#[from] bun_http::Error),
    #[error(transparent)]
    Paths(#[from] bun_paths::Error),
    #[error(transparent)]
    Options(#[from] bun_options_types::Error),
}

impl From<Corruption> for Error {
    fn from(c: Corruption) -> Self {
        Self::CorruptedModuleGraph(c)
    }
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e.into())
    }
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::CorruptedModuleGraph(c) => c.message(),
            Self::TargetNotFound => "TargetNotFound",
            Self::NetworkError => "NetworkError",
            Self::InvalidResponse => "InvalidResponse",
            Self::ExtractionFailed => "ExtractionFailed",
            Self::InvalidSourceMap => "InvalidSourceMap",
            Self::SourceMapTooLarge => "SourceMapTooLarge",
            Self::ModuleGraphTooLarge => {
                "embedded module graph would exceed 4 GiB (its offsets are 32-bit)"
            }
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::Http(e) => e.name(),
            Self::Paths(e) => e.name(),
            Self::Options(e) => e.name(),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
