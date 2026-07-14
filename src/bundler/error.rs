#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("InvalidRecordKind")]
    InvalidRecordKind,
    #[error("ModuleNotFound")]
    ModuleNotFound,
    #[error("BuildFailed")]
    BuildFailed,
    #[error("CompilationFailed")]
    CompilationFailed,
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
    #[error("JSError")]
    Js(bun_core::JsError),
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Core(#[from] bun_core::Error),
    #[error(transparent)]
    JsPrinter(#[from] bun_js_printer::Error),
    #[error(transparent)]
    Resolver(#[from] bun_resolver::Error),
    #[error(transparent)]
    Dotenv(#[from] bun_dotenv::Error),
    #[error(transparent)]
    JsParser(#[from] bun_js_parser::Error),
    #[error(transparent)]
    Parsers(#[from] bun_parsers::Error),
    #[error(transparent)]
    Sourcemap(#[from] bun_sourcemap::Error),
    #[error(transparent)]
    Url(#[from] bun_url::Error),
    #[error(transparent)]
    OptionsTypes(#[from] bun_options_types::Error),
    #[error(transparent)]
    OutputFileList(#[from] crate::linker_context::output_file_list_builder::OutputFileListError),
}

impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::WriteFailed
    }
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e.into())
    }
}

impl From<Error> for bun_js_printer::Error {
    fn from(e: Error) -> Self {
        match e {
            Error::JsPrinter(inner) => inner,
            Error::Core(inner) => bun_js_printer::Error::Core(inner),
            Error::Alloc(inner) => bun_js_printer::Error::Alloc(inner),
            Error::WriteFailed => bun_js_printer::Error::WriteFailed,
            _ => bun_js_printer::Error::Core(bun_core::Error::Unexpected),
        }
    }
}

impl From<crate::linker_context_mod::LinkError> for Error {
    fn from(e: crate::linker_context_mod::LinkError) -> Self {
        use crate::linker_context_mod::LinkError;
        match e {
            LinkError::OutOfMemory => Self::Alloc(bun_alloc::AllocError),
            LinkError::BuildFailed | LinkError::ImportResolutionFailed => Self::BuildFailed,
        }
    }
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::InvalidRecordKind => "InvalidRecordKind",
            Self::ModuleNotFound => "ModuleNotFound",
            Self::BuildFailed => "BuildFailed",
            Self::CompilationFailed => "CompilationFailed",
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
            Self::Js(bun_core::JsError::OutOfMemory) => "OutOfMemory",
            Self::Js(_) => "JSError",
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::Core(e) => e.name(),
            Self::JsPrinter(e) => e.name(),
            Self::Resolver(e) => e.name(),
            Self::Dotenv(e) => e.name(),
            Self::JsParser(e) => e.name(),
            Self::Parsers(e) => e.name(),
            Self::Sourcemap(e) => e.name(),
            Self::Url(e) => e.name(),
            Self::OptionsTypes(e) => e.name(),
            Self::OutputFileList(e) => <&'static str>::from(e),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

impl From<bun_parsers::yaml::YamlParseError> for Error {
    fn from(e: bun_parsers::yaml::YamlParseError) -> Self {
        Self::Parsers(e.into())
    }
}

impl From<bun_parsers::json5::ExternalError> for Error {
    fn from(e: bun_parsers::json5::ExternalError) -> Self {
        Self::Parsers(e.into())
    }
}

impl From<bun_parsers::xml::ExternalError> for Error {
    fn from(e: bun_parsers::xml::ExternalError) -> Self {
        Self::Parsers(e.into())
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
