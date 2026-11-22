//! Where the grouping separators go. ICU4C: number_grouping.cpp

use crate::common::locid::Locale;
use crate::common::uresimp::ures_open;

#[derive(Clone, Copy)]
pub(crate) struct Grouper {
    /// -1: no grouping. -2: from the pattern of the locale. -4: like -2, but 3 if the pattern has no separator.
    pub(crate) grouping1: i16,
    pub(crate) grouping2: i16,
    /// -2: from the locale. -3: from the locale, but at least 2.
    pub(crate) min_grouping: i16,
}

/// The sizes of the last group and of the others, and the minimum of digits before the first separator.
#[derive(Clone, Copy)]
pub(crate) struct Grouping {
    primary: i32,
    secondary: i32,
    min_grouping: i32,
}

fn min_grouping_for_locale(locale: &Locale) -> i16 {
    let digits = ures_open(None, locale.get_name()).and_then(|bundle| {
        bundle.get_string_by_key_with_fallback(b"NumberElements/minimumGroupingDigits")
    });
    match digits.map(|digits| digits.units()) {
        Ok(digits) if digits.len() == 1 => (digits.at(0) as i16).wrapping_sub(0x30),
        _ => 1,
    }
}

impl Grouper {
    pub(crate) const OFF: Self = Self::new(-1, -2);
    pub(crate) const MIN2: Self = Self::new(-2, -3);
    pub(crate) const AUTO: Self = Self::new(-2, -2);
    pub(crate) const ON_ALIGNED: Self = Self::new(-4, 1);

    const fn new(grouping: i16, min_grouping: i16) -> Self {
        Self {
            grouping1: grouping,
            grouping2: grouping,
            min_grouping,
        }
    }

    /// Takes `ParsedPatternInfo::groupings` of the pattern of `locale`. Returns `None` if no number has separators.
    pub(crate) fn resolve(self, in_pattern: [i16; 3], locale: &Locale) -> Option<Grouping> {
        let (mut primary, mut secondary) = (self.grouping1, self.grouping2);
        if primary == -2 || secondary == -4 {
            let [first, second, third] = in_pattern;
            primary = match (second, primary) {
                (-1, -4) => 3,
                (-1, _) => -1,
                _ => first,
            };
            secondary = if third == -1 { primary } else { second };
        }
        if matches!(primary, -1 | 0) {
            return None;
        }
        let min_grouping = match self.min_grouping {
            -2 => min_grouping_for_locale(locale),
            -3 => min_grouping_for_locale(locale).max(2),
            min_grouping => min_grouping,
        };
        Some(Grouping {
            primary: primary.into(),
            secondary: secondary.into(),
            min_grouping: min_grouping.into(),
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
