use bun_engine_text::{CodeUnit, Text, with_text};

use crate::Radix;
use crate::decimal_scanner::scan_sign;

/// What may surround the integer. White space is tab, line feed, line tabulation, form feed, carriage return and space.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Surroundings {
    Nothing,
    WhiteSpace,
    WhiteSpaceBeforeAnythingAfter,
}

/// An optional sign and digits whose value fits in `I`. The sign is only a minus if `I` is signed.
pub fn parse_integer<I: TryFrom<i128>>(
    text: Text<'_>,
    radix: Radix,
    surroundings: Surroundings,
) -> Option<I> {
    let (is_negative, magnitude) = parse_sign_and_magnitude(text, radix, surroundings)?;
    if !is_negative {
        return I::try_from(i128::from(magnitude)).ok();
    }
    I::try_from(-1).ok()?;
    I::try_from(-i128::from(magnitude)).ok()
}

fn parse_sign_and_magnitude(
    text: Text<'_>,
    radix: Radix,
    surroundings: Surroundings,
) -> Option<(bool, u64)> {
    with_text!(text, |units| parse(units, radix.get(), surroundings))
}

fn parse<T: CodeUnit>(units: &[T], radix: u32, surroundings: Surroundings) -> Option<(bool, u64)> {
    let is_allowed_space = |unit: &T| {
        surroundings != Surroundings::Nothing && matches!(unit.to_u16(), 0x09..=0x0d | 0x20)
    };
    let spaces = units.iter().take_while(|unit| is_allowed_space(unit));
    let (is_negative, start) = scan_sign(units, spaces.count());
    let mut end = start;
    let mut magnitude = 0u64;
    while let Some(digit) = units.get(end).and_then(|unit| unit.digit_value(radix)) {
        magnitude = magnitude
            .checked_mul(u64::from(radix))?
            .checked_add(u64::from(digit))?;
        end += 1;
    }
    let ends_well = surroundings == Surroundings::WhiteSpaceBeforeAnythingAfter
        || units[end..].iter().all(is_allowed_space);
    (end > start && ends_well).then_some((is_negative, magnitude))
}
