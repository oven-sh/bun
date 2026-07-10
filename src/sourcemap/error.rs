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
    #[error("Unknown")]
    Unknown,
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
            Self::Unknown => "Unknown",
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
