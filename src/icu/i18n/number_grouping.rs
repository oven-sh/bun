//! Where the grouping separators go. ICU4C: number_grouping.cpp

use crate::common::locid::Locale;
use crate::common::uresimp::ures_open;
use crate::i18n::number_patternstring::ParsedPatternInfo;

#[derive(Clone, Copy)]
pub(crate) enum Grouper {
    Off,
    /// Groups from the locale's minimum of digits on, but at least two before the first separator.
    Min2,
    /// Groups from the locale's minimum of digits on.
    Auto,
    /// Always groups, by three if the pattern has no separator.
    OnAligned,
    /// Always groups if the pattern has a separator.
    AsInPattern,
}

/// The sizes of the last group and of the others, and the minimum of digits before the first separator.
#[derive(Clone, Copy)]
pub(crate) struct Grouping {
    primary: i32,
    secondary: i32,
    min_grouping: i32,
}

fn min_grouping_for_locale(locale: &Locale) -> i32 {
    let digits = ures_open(None, locale.get_name()).and_then(|bundle| {
        bundle.get_string_by_key_with_fallback(b"NumberElements/minimumGroupingDigits")
    });
    match digits.map(|digits| digits.units()) {
        Ok(digits) if digits.len() == 1 => i32::from(digits.at(0)) - 0x30,
        _ => 1,
    }
}

impl Grouper {
    /// Returns `None` if no number has separators.
    pub(crate) fn resolve(self, pattern: &ParsedPatternInfo, locale: &Locale) -> Option<Grouping> {
        let (primary, secondary) = match (self, pattern.group_sizes) {
            (Self::Off, _) => return None,
            (Self::OnAligned, None) => (3, 3),
            (_, sizes) => sizes?,
        };
        Some(Grouping {
            primary,
            secondary,
            min_grouping: match self {
                Self::Auto => min_grouping_for_locale(locale),
                Self::Min2 => min_grouping_for_locale(locale).max(2),
                _ => 1,
            },
        })
    }
}

impl Grouping {
    /// Returns whether a separator follows the digit at 10^`position` in a number with `integer_count` integer digits.
    pub(crate) fn group_at_position(&self, position: i32, integer_count: i32) -> bool {
        position >= self.primary
            && (position - self.primary).checked_rem(self.secondary) == Some(0)
            && integer_count - self.primary >= self.min_grouping
    }
}
