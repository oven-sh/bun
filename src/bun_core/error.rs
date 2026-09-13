#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("EndOfStream")]
    EndOfStream,
    #[error("StreamTooLong")]
    StreamTooLong,
    #[error("FmtError")]
    FmtError,
    #[error("Unexpected")]
    Unexpected,
    #[error("InvalidByteSequence")]
    InvalidByteSequence,
    #[error("StringTooLong")]
    StringTooLong,
    #[error("InvalidCharacter")]
    InvalidCharacter,
    // errno-category names kept local (bun_core cannot depend on bun_errno):
    #[error("NoSpaceLeft")]
    NoSpaceLeft,
    #[error("NameTooLong")]
    NameTooLong,
    #[error("FileNotFound")]
    FileNotFound,
    #[error("AccessDenied")]
    AccessDenied,
    #[error("WriteFailed")]
    WriteFailed,
    #[error("CurrentWorkingDirectoryUnlinked")]
    CurrentWorkingDirectoryUnlinked,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::EndOfStream => "EndOfStream",
            Self::StreamTooLong => "StreamTooLong",
            Self::FmtError => "FmtError",
            Self::Unexpected => "Unexpected",
            Self::InvalidByteSequence => "InvalidByteSequence",
            Self::StringTooLong => "StringTooLong",
            Self::InvalidCharacter => "InvalidCharacter",
            Self::NoSpaceLeft => "NoSpaceLeft",
            Self::NameTooLong => "NameTooLong",
            Self::FileNotFound => "FileNotFound",
            Self::AccessDenied => "AccessDenied",
            Self::WriteFailed => "WriteFailed",
            Self::CurrentWorkingDirectoryUnlinked => "CurrentWorkingDirectoryUnlinked",
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
