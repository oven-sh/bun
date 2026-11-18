use bun_engine_text::{AllocError, StringRef, Text};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ErrorKind {
    Error,
    RangeError,
    TypeError,
    OutOfMemory,
    Interruption,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Error {
    Plain(&'static str),
    Range(&'static str),
    /// The message ends with text that the script passed.
    RangeQuoting(StringRef),
    Type(&'static str),
    OutOfMemory,
    /// The poll function asked to stop. Whoever answered it has the reason.
    Interrupted,
}

pub type Result<T> = core::result::Result<T, Error>;

impl Error {
    #[cold]
    pub fn range_quoting(prefix: &'static str, quoted: Text<'_>) -> Error {
        StringRef::try_concat(&[Text::from_ascii(prefix), quoted])
            .map_or(Error::OutOfMemory, Error::RangeQuoting)
    }

    pub fn kind(&self) -> ErrorKind {
        match self {
            Error::Plain(_) => ErrorKind::Error,
            Error::Range(_) | Error::RangeQuoting(_) => ErrorKind::RangeError,
            Error::Type(_) => ErrorKind::TypeError,
            Error::OutOfMemory => ErrorKind::OutOfMemory,
            Error::Interrupted => ErrorKind::Interruption,
        }
    }

    pub fn message(&self) -> StringRef {
        match self {
            Error::Plain(message) | Error::Range(message) | Error::Type(message) => {
                StringRef::from_literal(message)
            }
            Error::RangeQuoting(message) => message.clone(),
            Error::OutOfMemory => StringRef::from_literal("Out of memory"),
            Error::Interrupted => StringRef::empty(),
        }
    }
}

impl From<AllocError> for Error {
    fn from(_: AllocError) -> Error {
        Error::OutOfMemory
    }
}

impl From<smallvec::CollectionAllocErr> for Error {
    fn from(_: smallvec::CollectionAllocErr) -> Error {
        Error::OutOfMemory
    }
}

impl From<hashbrown::TryReserveError> for Error {
    fn from(_: hashbrown::TryReserveError) -> Error {
        Error::OutOfMemory
    }
}

pub(crate) trait IcuResult<T> {
    /// `error` stands for any failure but a lack of memory.
    fn or_error(self, error: Error) -> Result<T>;

    fn or_type_error(self, message: &'static str) -> Result<T>;
}

impl<T> IcuResult<T> for bun_icu::Result<T> {
    #[inline]
    fn or_error(self, error: Error) -> Result<T> {
        self.map_err(|failure| match failure {
            bun_icu::Error::MEMORY_ALLOCATION => Error::OutOfMemory,
            _ => error,
        })
    }

    #[inline]
    fn or_type_error(self, message: &'static str) -> Result<T> {
        self.or_error(Error::Type(message))
    }
}
