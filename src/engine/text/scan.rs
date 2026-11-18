//! Scans for units by a test. A test that has no branch (`|` and `&`, not `||` and `&&`, and no table) is applied to
//! sixteen units at a time.

use bun_highway::text as kernels;

use crate::block::{self, BLOCK, Not, Positions, Units};
use crate::{CodeUnit, Text, with_text};

/// The index of the first unit that passes.
#[inline(always)]
pub fn position<T: CodeUnit>(units: &[T], test: impl Fn(u16) -> bool + Copy) -> Option<usize> {
    block::first(Units(units, |unit: T| test(unit.to_u16())))
}

/// The index of the last unit that passes.
#[inline(always)]
pub fn rposition<T: CodeUnit>(units: &[T], test: impl Fn(u16) -> bool + Copy) -> Option<usize> {
    block::last(Units(units, |unit: T| test(unit.to_u16())))
}

/// How many units at the start pass.
#[inline(always)]
pub fn run_len<T: CodeUnit>(units: &[T], test: impl Fn(u16) -> bool + Copy) -> usize {
    block::first(Not(Units(units, |unit: T| test(unit.to_u16())))).unwrap_or(units.len())
}

/// The indices of the units that pass.
#[inline(always)]
pub fn positions<T: CodeUnit>(
    units: &[T],
    test: impl Fn(u16) -> bool + Copy,
) -> impl Iterator<Item = usize> {
    let passing = Units(units, move |unit: T| test(unit.to_u16()));
    let (mut next, mut mask) = (0, 0u32);
    core::iter::from_fn(move || {
        while mask == 0 {
            mask = match units.len().checked_sub(next)? {
                0 => return None,
                BLOCK.. => passing.mask(next),
                _ => block::short_mask(Units(&units[next..], passing.1)),
            };
            next += BLOCK;
        }
        let lane = mask.trailing_zeros() as usize;
        mask &= mask - 1;
        Some(next - BLOCK + lane)
    })
}

#[inline(always)]
pub(crate) fn is_json_special(unit: u16) -> bool {
    (unit < 0x20) | (unit == 0x22) | (unit == 0x5c)
}

/// How many units come before a quotation mark, a backslash or a control character.
#[inline(always)]
pub fn json_string_run_len<T: CodeUnit>(units: &[T]) -> usize {
    const SHORT: usize = kernels::MINIMUM_LENGTH;
    let special = Units(units, |unit: T| is_json_special(unit.to_u16()));
    let long = |at: usize| {
        let at = at.min(units.len() - SHORT);
        kernels::find_json_special(&units[at..]).map(|index| at + index)
    };
    block::first_or_else(special, SHORT, long).unwrap_or(units.len())
}

/// How many units at the start are white space of JSON.
#[inline(always)]
pub fn json_white_space_len<T: CodeUnit>(units: &[T]) -> usize {
    match units.first() {
        Some(first) if first.to_u16() <= 0x20 => run_len(units, |unit| {
            (unit == 0x20) | (unit == 0x0a) | (unit == 0x0d) | (unit == 0x09)
        }),
        _ => 0,
    }
}

/// How many units at the start are ASCII letters, digits, `$` or `_`.
#[inline(always)]
pub fn ascii_identifier_run_len<T: CodeUnit>(units: &[T]) -> usize {
    run_len(units, |unit| {
        unit.is_ascii_alphabetic() | unit.is_ascii_digit() | unit.is(b'$') | unit.is(b'_')
    })
}

#[inline(always)]
fn is_line_terminator(unit: u16) -> bool {
    (unit == 0x0a) | (unit == 0x0d) | (unit | 1 == 0x2029)
}

/// The index of the first LineTerminator of ECMA-262.
#[inline(always)]
pub fn find_line_terminator<T: CodeUnit>(units: &[T]) -> Option<usize> {
    position(units, is_line_terminator)
}

/// The indices of the LineTerminators of ECMA-262. CR LF has two.
#[inline(always)]
pub fn line_terminators<T: CodeUnit>(units: &[T]) -> impl Iterator<Item = usize> {
    positions(units, is_line_terminator)
}

impl Text<'_> {
    /// The first index at or after `start` of a unit that passes. See [`crate::scan`] for `test`.
    #[inline]
    pub fn position(self, start: usize, test: impl Fn(u16) -> bool + Copy) -> Option<usize> {
        with_text!(self, |units| position(units.get(start..)?, test)).map(|index| start + index)
    }

    /// Whether every unit passes. See [`crate::scan`] for `test`.
    #[inline]
    pub fn all(self, test: impl Fn(u16) -> bool + Copy) -> bool {
        with_text!(self, |units| run_len(units, test)) == self.len()
    }
}
