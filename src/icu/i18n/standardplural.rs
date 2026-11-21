//! The plural forms of CLDR. ICU4C: standardplural.cpp

use std::ffi::CStr;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum PluralForm {
    Zero,
    One,
    Two,
    Few,
    Many,
    Other,
}

pub(crate) const COUNT: usize = 6;

impl PluralForm {
    pub(crate) const ALL: [Self; COUNT] = [
        Self::Zero,
        Self::One,
        Self::Two,
        Self::Few,
        Self::Many,
        Self::Other,
    ];

    pub(crate) const fn index(self) -> usize {
        self as usize
    }

    pub(crate) fn keyword(self) -> &'static CStr {
        match self {
            Self::Zero => c"zero",
            Self::One => c"one",
            Self::Two => c"two",
            Self::Few => c"few",
            Self::Many => c"many",
            Self::Other => c"other",
        }
    }

    pub(crate) fn from_keyword(keyword: &[u8]) -> Option<Self> {
        Some(match keyword {
            b"zero" => Self::Zero,
            b"one" => Self::One,
            b"two" => Self::Two,
            b"few" => Self::Few,
            b"many" => Self::Many,
            b"other" => Self::Other,
            _ => return None,
        })
    }
}
