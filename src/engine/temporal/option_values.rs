use bun_engine_text::{PropertyName, Text, names};

use crate::{Error, Result};

/// An option whose value is one of a few strings.
pub trait OptionValue: Copy + 'static {
    const PROPERTY: PropertyName<'static>;
    const VALUES: &'static [(&'static str, Self)];
    const INVALID: Error;

    /// The validation of GetOption.
    fn parse(text: Text<'_>) -> Result<Self> {
        Self::VALUES
            .iter()
            .find(|(name, _)| text.eq_ascii(name))
            .map(|&(_, value)| value)
            .ok_or(Self::INVALID)
    }
}

macro_rules! option_values {
    ($(
        $(#[$attribute:meta])*
        $name:ident($property:ident, $invalid:ident) { $($variant:ident = $text:literal,)* }
    )*) => {$(
        $(#[$attribute])*
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub enum $name {
            $($variant,)*
        }

        impl OptionValue for $name {
            const PROPERTY: PropertyName<'static> = names::$property;
            const VALUES: &'static [(&'static str, $name)] = &[$(($text, $name::$variant),)*];
            const INVALID: Error = Error::$invalid;
        }
    )*};
}

option_values! {
    /// What becomes of a field that is out of range.
    Overflow(overflow, InvalidOverflow) {
        Constrain = "constrain",
        Reject = "reject",
    }

    /// Which instant stands for a local time that a zone skips or repeats.
    Disambiguation(disambiguation, InvalidDisambiguation) {
        Compatible = "compatible",
        Earlier = "earlier",
        Later = "later",
        Reject = "reject",
    }

    /// What becomes of an offset that the time zone disagrees with.
    OffsetOption(offset, InvalidOffsetOption) {
        Use = "use",
        Prefer = "prefer",
        Ignore = "ignore",
        Reject = "reject",
    }

    RoundingMode(roundingMode, InvalidRoundingMode) {
        Ceil = "ceil",
        Floor = "floor",
        Expand = "expand",
        Trunc = "trunc",
        HalfCeil = "halfCeil",
        HalfFloor = "halfFloor",
        HalfExpand = "halfExpand",
        HalfTrunc = "halfTrunc",
        HalfEven = "halfEven",
    }

    ShowCalendar(calendarName, InvalidCalendarName) {
        Auto = "auto",
        Always = "always",
        Never = "never",
        Critical = "critical",
    }

    ShowOffset(offset, InvalidShowOffset) {
        Auto = "auto",
        Never = "never",
    }

    ShowTimeZone(timeZoneName, InvalidTimeZoneName) {
        Auto = "auto",
        Never = "never",
        Critical = "critical",
    }

    Direction(direction, InvalidDirection) {
        Next = "next",
        Previous = "previous",
    }
}

impl Overflow {
    /// `value` or, if it is greater, `maximum`.
    #[inline]
    pub(crate) fn limit(self, value: u8, maximum: u8, rejected: Error) -> Result<u8> {
        if value > maximum && self == Overflow::Reject {
            return Err(rejected);
        }
        Ok(value.min(maximum))
    }
}
