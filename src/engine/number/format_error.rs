/// An argument of a method of Number.prototype is out of range. All are RangeErrors.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FormatError {
    Radix,
    FixedDigits,
    ExponentialDigits,
    Precision,
}

impl FormatError {
    pub fn message(self) -> &'static str {
        match self {
            FormatError::Radix => "toString() radix argument must be between 2 and 36",
            FormatError::FixedDigits => "toFixed() argument must be between 0 and 100",
            FormatError::ExponentialDigits => "toExponential() argument must be between 0 and 100",
            FormatError::Precision => "toPrecision() argument must be between 1 and 100",
        }
    }
}
