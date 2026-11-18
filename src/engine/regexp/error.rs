use bun_engine_text::AllocError;

/// Why a pattern has no matcher. As wide as a character, so that a `Result` of one is a pair of registers.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    PatternTooLarge,
    QuantifierOutOfOrder,
    NothingToRepeat,
    QuantifierTooLarge,
    IncompleteQuantifier,
    QuantifiedLookbehind,
    UnterminatedGroup,
    LoneBracket,
    UnmatchedParenthesis,
    InvalidGroup,
    InvalidGroupName,
    DuplicateGroupName,
    UnterminatedClass,
    RangeOutOfOrder,
    InvalidRange,
    UnterminatedClassStrings,
    EscapeAtEnd,
    InvalidUnicodeEscape,
    InvalidCodePointEscape,
    InvalidBackReference,
    InvalidNamedReference,
    InvalidIdentityEscape,
    InvalidOctalEscape,
    InvalidControlEscape,
    InvalidProperty,
    MinimumLengthTooLarge,
    InvalidFlags,
    InvalidSetOperation,
    NegatedStrings,
    InvalidSetCharacter,
    InvalidModifier,
    TooManyCaptures,
    /// The native stack ran out. Another attempt can succeed.
    TooDeeplyNested,
    OutOfMemory,
}

/// What a script sees.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ErrorKind {
    SyntaxError,
    /// A RangeError that is marked as lack of memory.
    OutOfMemory,
}

impl Error {
    pub const fn kind(self) -> ErrorKind {
        match self {
            Error::TooDeeplyNested | Error::OutOfMemory => ErrorKind::OutOfMemory,
            _ => ErrorKind::SyntaxError,
        }
    }

    pub const fn message(self) -> &'static str {
        macro_rules! invalid {
            ($reason:literal) => {
                concat!("Invalid regular expression: ", $reason)
            };
        }
        match self {
            Error::PatternTooLarge => invalid!("regular expression too large"),
            Error::QuantifierOutOfOrder => invalid!("numbers out of order in {} quantifier"),
            Error::NothingToRepeat => invalid!("nothing to repeat"),
            Error::QuantifierTooLarge => invalid!("number too large in {} quantifier"),
            Error::IncompleteQuantifier => {
                invalid!("incomplete {} quantifier for Unicode pattern")
            }
            Error::QuantifiedLookbehind => invalid!("invalid quantifier"),
            Error::UnterminatedGroup => invalid!("missing )"),
            Error::LoneBracket => invalid!("unmatched ] or } bracket for Unicode pattern"),
            Error::UnmatchedParenthesis => invalid!("unmatched parentheses"),
            Error::InvalidGroup => invalid!("unrecognized character after (?"),
            Error::InvalidGroupName => invalid!("invalid group specifier name"),
            Error::DuplicateGroupName => invalid!("duplicate group specifier name"),
            Error::UnterminatedClass => invalid!("missing terminating ] for character class"),
            Error::RangeOutOfOrder => invalid!("range out of order in character class"),
            Error::InvalidRange => {
                invalid!("invalid range in character class for Unicode pattern")
            }
            Error::UnterminatedClassStrings => {
                invalid!("missing terminating } for class string disjunction")
            }
            Error::EscapeAtEnd => invalid!("\\ at end of pattern"),
            Error::InvalidUnicodeEscape => invalid!("invalid Unicode \\u escape"),
            Error::InvalidCodePointEscape => invalid!("invalid Unicode code point \\u{} escape"),
            Error::InvalidBackReference => invalid!("invalid backreference for Unicode pattern"),
            Error::InvalidNamedReference => invalid!("invalid \\k<> named backreference"),
            Error::InvalidIdentityEscape => {
                invalid!("invalid escaped character for Unicode pattern")
            }
            Error::InvalidOctalEscape => invalid!("invalid octal escape for Unicode pattern"),
            Error::InvalidControlEscape => invalid!("invalid \\c escape for Unicode pattern"),
            Error::InvalidProperty => invalid!("invalid property expression"),
            Error::MinimumLengthTooLarge => invalid!("pattern exceeds string length limits"),
            Error::InvalidFlags => invalid!("invalid flags"),
            Error::InvalidSetOperation => invalid!("invalid operation in class set"),
            Error::NegatedStrings => invalid!("negated class set may contain strings"),
            Error::InvalidSetCharacter => invalid!("invalid class set character"),
            Error::InvalidModifier => invalid!("invalid regular expression modifier"),
            Error::TooManyCaptures => invalid!("too many captures"),
            Error::TooDeeplyNested => {
                "Out of memory: Invalid regular expression: too many nested disjunctions"
            }
            Error::OutOfMemory => "Out of memory",
        }
    }
}

impl From<AllocError> for Error {
    fn from(_: AllocError) -> Error {
        Error::OutOfMemory
    }
}
