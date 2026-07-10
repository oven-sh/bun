#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("InvalidRecordKind")]
    InvalidRecordKind,
    #[error("ModuleNotFound")]
    ModuleNotFound,
    #[error("BuildFailed")]
    BuildFailed,
    #[error("Plugin")]
    Plugin,
    #[error("InvalidCssImport")]
    InvalidCssImport,
    #[error("PrintError")]
    PrintError,
    #[error("WriteFailed")]
    WriteFailed,
    #[error("DuplicateOutputPath")]
    DuplicateOutputPath,
    #[error("MultipleOutputFilesWithoutOutputDir")]
    MultipleOutputFilesWithoutOutputDir,
    #[error("InvalidJSON")]
    InvalidJSON,
    #[error("Fail")]
    Fail,
    #[error("ParserError")]
    ParserError,
    #[error("SyntaxError")]
    SyntaxError,
    #[error("MinifyError")]
    MinifyError,
    #[error("InvalidNativePlugin")]
    InvalidNativePlugin,
    #[error("EmptyAST")]
    EmptyAST,
    #[error("FormatError")]
    FormatError,
    #[error("ResolveMessage")]
    ResolveMessage,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::InvalidRecordKind => "InvalidRecordKind",
            Self::ModuleNotFound => "ModuleNotFound",
            Self::BuildFailed => "BuildFailed",
            Self::Plugin => "Plugin",
            Self::InvalidCssImport => "InvalidCssImport",
            Self::PrintError => "PrintError",
            Self::WriteFailed => "WriteFailed",
            Self::DuplicateOutputPath => "DuplicateOutputPath",
            Self::MultipleOutputFilesWithoutOutputDir => "MultipleOutputFilesWithoutOutputDir",
            Self::InvalidJSON => "InvalidJSON",
            Self::Fail => "Fail",
            Self::ParserError => "ParserError",
            Self::SyntaxError => "SyntaxError",
            Self::MinifyError => "MinifyError",
            Self::InvalidNativePlugin => "InvalidNativePlugin",
            Self::EmptyAST => "EmptyAST",
            Self::FormatError => "FormatError",
            Self::ResolveMessage => "ResolveMessage",
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
