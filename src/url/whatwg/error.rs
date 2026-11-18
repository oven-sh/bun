use bun_engine_text::AllocError;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Error {
    /// What the URL Standard calls failure. A `TypeError` where it is thrown.
    Invalid,
    /// The result is longer than a string can be, or there is no memory for it. A `RangeError`.
    OutOfMemory,
}

pub type Result<T> = core::result::Result<T, Error>;

impl Error {
    pub fn message(self) -> &'static str {
        match self {
            Error::Invalid => "Invalid URL",
            Error::OutOfMemory => "Out of memory",
        }
    }
}

impl From<AllocError> for Error {
    fn from(_: AllocError) -> Error {
        Error::OutOfMemory
    }
}
