use bun_highway::text as kernels;

use crate::block::{self, Units};
use crate::compare::equal_units_ignoring_ascii_case;
use crate::search_units::{Backward, Forward, find};
use crate::{CodeUnit, Text, scan, with_text};

/// How many units are looked at before a kernel takes over.
pub(crate) const SHORT: usize = kernels::MINIMUM_LENGTH;

#[inline]
pub(crate) fn find_unit<T: CodeUnit>(units: &[T], unit: T) -> Option<usize> {
    block::first_or_else(Units(units, |it| it == unit), SHORT, |at| {
        let at = at.min(units.len() - SHORT);
        kernels::find_unit(&units[at..], unit).map(|index| at + index)
    })
}

#[inline]
fn rfind_unit<T: CodeUnit>(units: &[T], unit: T) -> Option<usize> {
    block::last_or_else(Units(units, |it| it == unit), SHORT, |end| {
        kernels::find_last_unit(&units[..end.max(SHORT)], unit)
    })
}

#[inline]
fn count_unit<T: CodeUnit>(units: &[T], unit: T) -> usize {
    let equal = Units(units, |it| it == unit);
    if units.len() >= 2 * SHORT {
        let (long, short) = units.split_at(units.len() / SHORT * SHORT);
        return kernels::count_unit(long, unit) + block::count(Units(short, equal.1));
    }
    block::count(equal)
}

fn find_ignoring_ascii_case<H: CodeUnit, N: CodeUnit>(
    haystack: &[H],
    needle: &[N],
) -> Option<usize> {
    let Some(first) = needle.first() else {
        return Some(0);
    };
    let first = first.to_u16().to_ascii_lower();
    let starts = &haystack[..haystack.len().checked_sub(needle.len())? + 1];
    scan::positions(starts, |unit| unit.to_ascii_lower() == first)
        .find(|&at| equal_units_ignoring_ascii_case(&haystack[at..at + needle.len()], needle))
}

impl Text<'_> {
    /// The first index of `unit` at or after `start`.
    #[inline(always)]
    pub fn find_unit(self, unit: u16, start: usize) -> Option<usize> {
        with_text!(self, |units| find_unit(
            units.get(start..)?,
            CodeUnit::from_u16(unit)?
        ))
        .map(|index| start + index)
    }

    /// The last index of `unit` before `end`.
    #[inline(always)]
    pub fn rfind_unit(self, unit: u16, end: usize) -> Option<usize> {
        with_text!(self, |units| rfind_unit(
            &units[..end.min(units.len())],
            CodeUnit::from_u16(unit)?
        ))
    }

    /// StringIndexOf of ECMA-262.
    #[inline(always)]
    pub fn find(self, needle: Text<'_>, start: usize) -> Option<usize> {
        if needle.len() > self.len().checked_sub(start)? {
            return None;
        }
        match needle.len() {
            0 => Some(start),
            1 => self.find_unit(needle.at(0), start),
            _ => with_text!(self, |haystack| with_text!(needle, |needle| {
                find::<_, _, Forward>(haystack, needle, start)
            })),
        }
    }

    /// The last index of `needle` at or before `start`.
    #[inline(always)]
    pub fn rfind(self, needle: Text<'_>, start: usize) -> Option<usize> {
        let start = start.min(self.len().checked_sub(needle.len())?);
        match needle.len() {
            0 => Some(start),
            1 => self.rfind_unit(needle.at(0), start + 1),
            _ => with_text!(self, |haystack| with_text!(needle, |needle| {
                find::<_, _, Backward>(haystack, needle, start + 1)
            })),
        }
    }

    #[inline(always)]
    pub fn contains_unit(self, unit: u16) -> bool {
        self.find_unit(unit, 0).is_some()
    }

    #[inline(always)]
    pub fn contains(self, needle: Text<'_>) -> bool {
        self.find(needle, 0).is_some()
    }

    /// For a needle whose length no script picks: the time can be the product of the lengths.
    #[inline(always)]
    pub fn find_ignore_ascii_case(self, needle: Text<'_>) -> Option<usize> {
        with_text!(self, |haystack| with_text!(needle, |needle| {
            find_ignoring_ascii_case(haystack, needle)
        }))
    }

    #[inline(always)]
    pub fn count_unit(self, unit: u16) -> usize {
        with_text!(self, |units| CodeUnit::from_u16(unit)
            .map_or(0, |unit| count_unit(units, unit)))
    }
}
