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
    /// The value 0 itself, which no rule selects.
    Eq0,
    /// The value 1 itself, which no rule selects.
    Eq1,
}

pub(crate) const COUNT: usize = 8;
/// The forms that rules select come first.
pub(crate) const SELECTABLE_COUNT: usize = 6;

impl PluralForm {
    pub(crate) const ALL: [Self; COUNT] = [
        Self::Zero,
        Self::One,
        Self::Two,
        Self::Few,
        Self::Many,
        Self::Other,
        Self::Eq0,
        Self::Eq1,
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
            Self::Eq0 => c"=0",
            Self::Eq1 => c"=1",
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
            b"=0" | b"0" => Self::Eq0,
            b"=1" | b"1" => Self::Eq1,
            _ => return None,
        })
    }

    pub(crate) fn from_keyword_units(keyword: impl ExactSizeIterator<Item = u16>) -> Option<Self> {
        let mut chars = [0; "other".len()];
        let chars = chars.get_mut(..keyword.len())?;
        for (c, unit) in chars.iter_mut().zip(keyword) {
            *c = u8::try_from(unit).ok()?;
        }
        Self::from_keyword(chars)
    }
}
