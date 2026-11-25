#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("{}", .0.message())]
    Damaged(#[from] Damage),
    /// Not the one that the stream asks for.
    #[error("wrong dictionary")]
    WrongDictionary,
    #[error("invalid parameter")]
    InvalidParameter,
    /// The stream is not at a point where the call makes sense.
    #[error("invalid state")]
    InvalidState,
    #[error("input after the end of the stream")]
    InputAfterFinish,
    /// For what the types allow and the code rules out.
    #[error("internal error")]
    Internal,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

/// What is wrong with compressed data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("{}", self.message())]
pub enum Damage {
    HeaderCheck,
    UnknownMethod,
    WindowSize,
    UnknownHeaderFlags,
    HeaderCrc,
    BlockType,
    StoredLengths,
    TooManySymbols,
    CodeLengthsSet,
    BitLengthRepeat,
    MissingEndOfBlock,
    LiteralLengthsSet,
    DistancesSet,
    LiteralLengthCode,
    DistanceCode,
    DistanceTooFarBack,
    DataCheck,
    LengthCheck,
}

impl Damage {
    /// zlib's, which scripts get to see.
    pub fn message(self) -> &'static str {
        match self {
            Self::HeaderCheck => "incorrect header check",
            Self::UnknownMethod => "unknown compression method",
            Self::WindowSize => "invalid window size",
            Self::UnknownHeaderFlags => "unknown header flags set",
            Self::HeaderCrc => "header crc mismatch",
            Self::BlockType => "invalid block type",
            Self::StoredLengths => "invalid stored block lengths",
            Self::TooManySymbols => "too many length or distance symbols",
            Self::CodeLengthsSet => "invalid code lengths set",
            Self::BitLengthRepeat => "invalid bit length repeat",
            Self::MissingEndOfBlock => "invalid code -- missing end-of-block",
            Self::LiteralLengthsSet => "invalid literal/lengths set",
            Self::DistancesSet => "invalid distances set",
            Self::LiteralLengthCode => "invalid literal/length code",
            Self::DistanceCode => "invalid distance code",
            Self::DistanceTooFarBack => "invalid distance too far back",
            Self::DataCheck => "incorrect data check",
            Self::LengthCheck => "incorrect length check",
        }
    }
}

impl From<std::collections::TryReserveError> for Error {
    fn from(_: std::collections::TryReserveError) -> Self {
        Self::Alloc(bun_alloc::AllocError)
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
