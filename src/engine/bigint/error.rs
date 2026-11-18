#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Error {
    /// The result has more than [`MAX_LENGTH`](crate::MAX_LENGTH) digits.
    TooBig,
    OutOfMemory,
    DivisionByZero,
    NegativeExponent,
    NotAnInteger,
    InvalidText,
    /// The poll function asked to stop. Whoever answered it has the reason.
    Interrupted,
}

/// What a script sees of an [`Error`].
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ErrorKind {
    RangeError,
    /// A RangeError that is marked as an out-of-memory error.
    OutOfMemoryError,
    SyntaxError,
    Interruption,
}

impl Error {
    pub const fn kind(self) -> ErrorKind {
        match self {
            Error::TooBig | Error::OutOfMemory => ErrorKind::OutOfMemoryError,
            Error::DivisionByZero | Error::NegativeExponent | Error::NotAnInteger => {
                ErrorKind::RangeError
            }
            Error::InvalidText => ErrorKind::SyntaxError,
            Error::Interrupted => ErrorKind::Interruption,
        }
    }

    pub const fn message(self) -> &'static str {
        match self {
            Error::TooBig => "Out of memory: BigInt generated from this operation is too big",
            Error::OutOfMemory => "Out of memory",
            Error::DivisionByZero => "0 is an invalid divisor value.",
            Error::NegativeExponent => "Negative exponent is not allowed",
            Error::NotAnInteger => "Not an integer",
            Error::InvalidText => "Failed to parse String to BigInt",
            Error::Interrupted => "",
        }
    }
}
