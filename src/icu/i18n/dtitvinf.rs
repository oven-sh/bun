//! Interval patterns by skeleton and by the largest field in which two dates differ. ICU4C: dtitvinf.cpp

use crate::common::bytes::U16s;
use crate::common::cstring::until_nul;
use crate::common::locid::Locale;
use crate::common::memory::{Appendable, try_push, try_to_vec};
use crate::common::resource::{ResourceSink, ResourceTable, ResourceValue};
use crate::common::slice_ext::SliceExt;
use crate::common::uhash::Hashtable;
use crate::common::uinvchar::append_invariant_chars;
use crate::common::unistr::UStr;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::calendar::Field;
use crate::i18n::dtptngen::calendar_type_in_data;

/// The calendar fields that select an interval pattern, from the largest to the smallest.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum IntervalField {
    Era,
    Year,
    Month,
    Date,
    AmPm,
    Hour,
    Minute,
    Second,
    Millisecond,
}

impl IntervalField {
    pub(crate) const ALL: [Self; 9] = [
        Self::Era,
        Self::Year,
        Self::Month,
        Self::Date,
        Self::AmPm,
        Self::Hour,
        Self::Minute,
        Self::Second,
        Self::Millisecond,
    ];

    pub(crate) fn calendar_field(self) -> Field {
        match self {
            Self::Era => Field::Era,
            Self::Year => Field::Year,
            Self::Month => Field::Month,
            Self::Date => Field::Date,
            Self::AmPm => Field::AmPm,
            Self::Hour => Field::Hour,
            Self::Minute => Field::Minute,
            Self::Second => Field::Second,
            Self::Millisecond => Field::Millisecond,
        }
    }

    fn from_pattern_letter(key: &[u8]) -> Option<Self> {
        match key {
            b"G" => Some(Self::Era),
            b"y" => Some(Self::Year),
            b"M" => Some(Self::Month),
            b"d" => Some(Self::Date),
            b"a" | b"B" => Some(Self::AmPm),
            b"h" | b"H" => Some(Self::Hour),
            b"m" => Some(Self::Minute),
            _ => None,
        }
    }
}

/// The difference between the argument and the result of `best_skeleton`.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum SkeletonDifference {
    None,
    Width,
    Fields,
}

/// The number of occurrences in a skeleton of each code unit from `A` to `z`.
pub(crate) struct FieldWidths([u32; 58]);

impl FieldWidths {
    pub(crate) fn of(skeleton: &[u16]) -> Self {
        let mut widths = [0; 58];
        for &unit in skeleton {
            if let Some(width) = widths.get_mut(usize::from(unit).wrapping_sub(usize::from(b'A'))) {
                *width += 1;
            }
        }
        Self(widths)
    }

    pub(crate) fn get(&self, letter: u8) -> u32 {
        self.0.at(usize::from(letter.wrapping_sub(b'A')))
    }

    pub(crate) fn set(&mut self, letter: u8, width: u32) {
        self.0.set(usize::from(letter.wrapping_sub(b'A')), width);
    }
}

/// The patterns of one skeleton, indexed by `IntervalField` up to `Minute`. A missing pattern is empty.
type SkeletonPatterns = [U16s<'static>; IntervalField::Second as usize];

pub(crate) struct DateIntervalInfo {
    /// Contains "{0}" for the earlier date of the interval and "{1}" for the later date.
    pub(crate) fallback_pattern: Vec<u16>,
    /// The order for patterns without a "latestFirst:" or "earliestFirst:" prefix.
    pub(crate) later_date_first: bool,
    /// The order of iteration breaks ties in `best_skeleton`.
    patterns: Hashtable<SkeletonPatterns>,
}

impl DateIntervalInfo {
    pub(crate) fn for_locale(locale: &Locale) -> Result<Self, UErrorCode> {
        let mut calendar_type =
            calendar_type_in_data(locale).or_else(|_| try_to_vec(b"gregorian"))?;
        let bundle = ures_open(None, locale.get_name())?;
        let calendars = bundle.get_by_key_with_fallback(b"calendar")?;
        let calendar = calendars.get_by_key_with_fallback(&calendar_type)?;
        let formats = calendar.get_by_key_with_fallback(b"intervalFormats")?;
        let fallback_pattern = formats.get_string_by_key_with_fallback(b"fallback")?;
        let fallback_pattern = fallback_pattern.units().try_to_vec()?;
        let index_of = |argument: &[u8; 3]| fallback_pattern.index_of(&argument.map(u16::from));
        let (Some(earlier), Some(later)) = (index_of(b"{0}"), index_of(b"{1}")) else {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        };

        // Load the calendar type, then each type that its `intervalFormats` alias points to.
        let mut sink = DateIntervalSink::default();
        let mut loaded = Vec::new();
        loop {
            ures_get_all_items_with_fallback(&calendars, until_nul(&calendar_type), &mut sink)?;
            try_push(&mut loaded, calendar_type)?;
            let Some(next) = sink.next_calendar_type.take() else {
                break;
            };
            if loaded.iter().any(|seen| next.eq_bytes(seen)) {
                return Err(U_INVALID_FORMAT_ERROR);
            }
            calendar_type = Vec::new();
            append_invariant_chars(&mut calendar_type, next.iter())?;
        }
        Ok(Self {
            fallback_pattern,
            later_date_first: earlier > later,
            patterns: sink.patterns,
        })
    }

    /// Returns the pattern for `skeleton` and `field`, or an empty string if there is none.
    pub(crate) fn interval_pattern(&self, skeleton: &[u16], field: IntervalField) -> U16s<'static> {
        self.patterns
            .get(skeleton)
            .map_or(U16s::EMPTY, |patterns| patterns.at(field as usize))
    }

    /// Returns the closest skeleton of the data. In `skeleton`, z, k and K count as v, H and h; a and b are ignored.
    pub(crate) fn best_skeleton(&self, skeleton: &[u16]) -> Option<(&[u16], SkeletonDifference)> {
        const DIFFERENT_FIELD: u32 = 0x1000;
        const STRING_NUMERIC_DIFFERENCE: u32 = 0x100;
        const MAX_POSITIVE_INT: u32 = 56632;

        let mut input = FieldWidths::of(skeleton);
        for (letter, replacement) in [(b'z', b'v'), (b'k', b'H'), (b'K', b'h')] {
            input.set(replacement, input.get(replacement) + input.get(letter));
        }
        for letter in *b"zkKab" {
            input.set(letter, 0);
        }

        let (mut best, mut best_distance) = (None, MAX_POSITIVE_INT);
        for (candidate, _) in self.patterns.iter() {
            let (mut distance, mut difference) = (0u32, SkeletonDifference::Width);
            for (letter, (&input_width, width)) in
                (b'A'..).zip(input.0.iter().zip(FieldWidths::of(candidate).0))
            {
                if input_width == width {
                    continue;
                }
                distance = distance.wrapping_add(if input_width == 0 || width == 0 {
                    difference = SkeletonDifference::Fields;
                    DIFFERENT_FIELD
                } else if letter == b'M' && (input_width <= 2) != (width <= 2) {
                    STRING_NUMERIC_DIFFERENCE
                } else {
                    input_width.abs_diff(width)
                });
            }
            if distance == 0 {
                return Some((candidate, SkeletonDifference::None));
            }
            if distance < best_distance {
                best = Some((candidate, difference));
                best_distance = distance;
            }
        }
        best
    }
}

/// Receives the table of a calendar type from the locale's bundle, then from each parent bundle.
#[derive(Default)]
struct DateIntervalSink {
    patterns: Hashtable<SkeletonPatterns>,
    /// Scratch buffer for the current key as UTF-16.
    skeleton: Vec<u16>,
    next_calendar_type: Option<U16s<'static>>,
}

impl ResourceSink for DateIntervalSink {
    fn put(&mut self, value: &ResourceValue) -> Result<(), UErrorCode> {
        let Some(formats) = value.get_table()?.get(b"intervalFormats") else {
            return Ok(());
        };
        if let Ok(path) = formats.get_alias_string() {
            self.next_calendar_type = Some(calendar_type_from_path(path)?);
        } else if let Ok(skeletons) = formats.get_table() {
            for (skeleton, value) in skeletons.iter() {
                if let Ok(table) = value.get_table() {
                    self.put_skeleton(skeleton, &table)?;
                }
            }
        }
        Ok(())
    }
}

impl DateIntervalSink {
    /// Stores the patterns that are missing. A table without patterns leaves no entry.
    fn put_skeleton(&mut self, skeleton: &[u8], table: &ResourceTable) -> Result<(), UErrorCode> {
        let (mut found, mut has_patterns) = (SkeletonPatterns::default(), false);
        for (key, value) in table.iter() {
            if let (Some(field), Ok(pattern)) =
                (IntervalField::from_pattern_letter(key), value.get_string())
            {
                has_patterns = true;
                if found.at(field as usize).is_empty() {
                    found.set(field as usize, pattern);
                }
            }
        }
        if !has_patterns {
            return Ok(());
        }
        self.skeleton.clear();
        self.skeleton
            .add_each(skeleton.iter().map(|&c| u16::from(c)));
        let patterns = self
            .patterns
            .get_or_put(&self.skeleton, || Ok(Default::default()))?;
        for (stored, pattern) in patterns.iter_mut().zip(found) {
            if stored.is_empty() {
                *stored = pattern;
            }
        }
        Ok(())
    }
}

/// Returns "chinese" for "/LOCALE/calendar/chinese/intervalFormats".
fn calendar_type_from_path(path: U16s<'static>) -> Result<U16s<'static>, UErrorCode> {
    const PREFIX: &[u8] = b"/LOCALE/calendar/";
    const SUFFIX: &[u8] = b"/intervalFormats";
    let end = path.len().saturating_sub(SUFFIX.len());
    if path.slice_clamped(0..PREFIX.len()).eq_bytes(PREFIX) && path.slice(end..).eq_bytes(SUFFIX) {
        Ok(path.slice_clamped(PREFIX.len()..end))
    } else {
        Err(U_INVALID_FORMAT_ERROR)
    }
}
