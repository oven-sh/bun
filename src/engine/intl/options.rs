use core::ops::RangeInclusive;

use bun_engine_text::{StringRef, Text};

use crate::{Error, Result};

/// One of a fixed list of strings.
pub trait Named: Copy + 'static {
    const ALL: &'static [Self];

    fn as_str(self) -> &'static str;

    /// Does not allocate.
    fn to_string_ref(self) -> StringRef;

    fn from_name(name: Text<'_>) -> Option<Self> {
        (Self::ALL.iter().copied()).find(|value| name.eq_ascii(value.as_str()))
    }
}

/// The value of a property that GetOption reads as a string.
pub trait OptionValue: Named {
    const INVALID: &'static str;

    fn parse(text: Text<'_>) -> Result<Self> {
        Self::from_name(text).ok_or(Error::Range(Self::INVALID))
    }
}

macro_rules! named_enum {
    (
        $(#[$attribute:meta])*
        $visibility:vis enum $name:ident {
            $($(#[$variant_attribute:meta])* $variant:ident = $text:literal,)*
        }
    ) => {
        $(#[$attribute])*
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        $visibility enum $name {
            $($(#[$variant_attribute])* $variant,)*
        }

        impl $crate::Named for $name {
            const ALL: &'static [$name] = &[$($name::$variant),*];

            fn as_str(self) -> &'static str {
                match self {
                    $($name::$variant => $text,)*
                }
            }

            fn to_string_ref(self) -> bun_engine_text::StringRef {
                static NAMES: [bun_engine_text::StaticString; <$name as $crate::Named>::ALL.len()] =
                    [$(bun_engine_text::StaticString::new($text.as_bytes())),*];
                bun_engine_text::StringRef::from_static(&NAMES[self as usize])
            }
        }
    };
}

/// A `named_enum!` with the message for a string that is not in the list.
macro_rules! option_enum {
    ($(#[$attribute:meta])* $visibility:vis enum $name:ident: $invalid:literal $variants:tt) => {
        named_enum! { $(#[$attribute])* $visibility enum $name $variants }

        impl $crate::OptionValue for $name {
            const INVALID: &'static str = $invalid;
        }
    };
}

option_enum! {
    /// Only validated: the best fit is what the lookup finds.
    pub enum LocaleMatcher: "localeMatcher must be either \"lookup\" or \"best fit\"" {
        Lookup = "lookup",
        BestFit = "best fit",
    }
}

option_enum! {
    pub enum HourCycle: "hourCycle must be \"h11\", \"h12\", \"h23\", or \"h24\"" {
        H11 = "h11",
        H12 = "h12",
        H23 = "h23",
        H24 = "h24",
    }
}

option_enum! {
    /// Of `ListFormat` and `RelativeTimeFormat`.
    #[derive(Default)]
    pub enum Style: "style must be either \"long\", \"short\", or \"narrow\"" {
        #[default]
        Long = "long",
        Short = "short",
        Narrow = "narrow",
    }
}

/// DefaultNumberOption from the result of ToNumber on.
pub fn integer_option(
    value: f64,
    range: RangeInclusive<u16>,
    out_of_range: &'static str,
) -> Result<u16> {
    if value >= f64::from(*range.start()) && value <= f64::from(*range.end()) {
        Ok(value as u16)
    } else {
        Err(Error::Range(out_of_range))
    }
}
