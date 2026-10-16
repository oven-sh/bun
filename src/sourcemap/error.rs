#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("MissingGeneratedColumnValue")]
    MissingGeneratedColumnValue,
    #[error("InvalidGeneratedColumnValue")]
    InvalidGeneratedColumnValue,
    #[error("InvalidSourceIndexDelta")]
    InvalidSourceIndexDelta,
    #[error("InvalidSourceIndexValue")]
    InvalidSourceIndexValue,
    #[error("MissingOriginalLine")]
    MissingOriginalLine,
    #[error("InvalidOriginalLineValue")]
    InvalidOriginalLineValue,
    #[error("MissingOriginalColumnValue")]
    MissingOriginalColumnValue,
    #[error("InvalidOriginalColumnValue")]
    InvalidOriginalColumnValue,
    #[error("InvalidNameIndexDelta")]
    InvalidNameIndexDelta,
    #[error("InvalidBase64")]
    InvalidBase64,
    #[error("UnsupportedFormat")]
    UnsupportedFormat,
    #[error("InvalidJSON")]
    InvalidJSON,
    #[error("UnsupportedVersion")]
    UnsupportedVersion,
    #[error("InvalidSourceMap")]
    InvalidSourceMap,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Core(#[from] bun_core::Error),
}

impl Error {
    /// What a `ParseFail` reports to the user.
    pub fn message(self) -> &'static str {
        match self {
            Self::MissingGeneratedColumnValue => "Missing generated column value",
            Self::InvalidGeneratedColumnValue => "Invalid generated column value",
            Self::InvalidSourceIndexDelta => "Invalid source index delta",
            Self::InvalidSourceIndexValue => "Invalid source index value",
            Self::MissingOriginalLine => "Missing original line",
            Self::InvalidOriginalLineValue => "Invalid original line value",
            Self::MissingOriginalColumnValue => "Missing original column value",
            Self::InvalidOriginalColumnValue => "Invalid original column value",
            Self::InvalidNameIndexDelta => "Invalid name index delta",
            Self::InvalidBase64 => "Invalid base64",
            Self::UnsupportedFormat => "Unsupported source map format",
            Self::InvalidJSON => "Invalid source map JSON",
            Self::UnsupportedVersion => "Unsupported source map version",
            Self::InvalidSourceMap => "Invalid source map",
            Self::Alloc(_) => "Out of memory",
            Self::Core(e) => e.name(),
        }
    }

    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::MissingGeneratedColumnValue => "MissingGeneratedColumnValue",
            Self::InvalidGeneratedColumnValue => "InvalidGeneratedColumnValue",
            Self::InvalidSourceIndexDelta => "InvalidSourceIndexDelta",
            Self::InvalidSourceIndexValue => "InvalidSourceIndexValue",
            Self::MissingOriginalLine => "MissingOriginalLine",
            Self::InvalidOriginalLineValue => "InvalidOriginalLineValue",
            Self::MissingOriginalColumnValue => "MissingOriginalColumnValue",
            Self::InvalidOriginalColumnValue => "InvalidOriginalColumnValue",
            Self::InvalidNameIndexDelta => "InvalidNameIndexDelta",
            Self::InvalidBase64 => "InvalidBase64",
            Self::UnsupportedFormat => "UnsupportedFormat",
            Self::InvalidJSON => "InvalidJSON",
            Self::UnsupportedVersion => "UnsupportedVersion",
            Self::InvalidSourceMap => "InvalidSourceMap",
            Self::Alloc(_) => "OutOfMemory",
            Self::Core(e) => e.name(),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
