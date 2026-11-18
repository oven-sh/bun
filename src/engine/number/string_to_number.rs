use bun_engine_text::{CodeUnit, Text, with_text};
use bun_engine_unicode::is_str_white_space;

use crate::decimal_scanner::scan_sign;
use crate::double::with_sign;
use crate::parse_decimal_prefix;
use crate::radix_scanner::scan_binary_integer;

/// StringToNumber of ECMA-262.
pub fn string_to_number(text: Text<'_>) -> f64 {
    with_text!(text, |units| to_number(units))
}

/// What `parseFloat` returns for a string.
pub fn parse_float(text: Text<'_>) -> f64 {
    with_text!(text, |units| {
        str_decimal_literal(trim_start(units)).map_or(f64::NAN, |(value, _)| value)
    })
}

#[inline(always)]
fn to_number<T: CodeUnit>(units: &[T]) -> f64 {
    if let [first, ..] = units
        && first.is_ascii_alphabetic()
        && !first.is(b'I')
    {
        return f64::NAN;
    }
    match parse_decimal_prefix(units) {
        Some((value, length)) if length == units.len() => value,
        _ => uncommon_to_number(units),
    }
}

fn uncommon_to_number<T: CodeUnit>(units: &[T]) -> f64 {
    let units = trim_start(units);
    if units.is_empty() {
        return 0.0;
    }
    match non_decimal_integer_literal(units).or_else(|| str_decimal_literal(units)) {
        Some((value, length)) if trim_start(&units[length..]).is_empty() => value,
        _ => f64::NAN,
    }
}

pub(crate) fn trim_start<T: CodeUnit>(units: &[T]) -> &[T] {
    let count = units
        .iter()
        .take_while(|unit| is_str_white_space(unit.to_u32()))
        .count();
    &units[count..]
}

fn non_decimal_integer_literal<T: CodeUnit>(units: &[T]) -> Option<(f64, usize)> {
    let [zero, marker, digits @ ..] = units else {
        return None;
    };
    let radix = match u8::try_from(marker.to_u16() | 0x20) {
        Ok(b'x') => 16,
        Ok(b'o') => 8,
        Ok(b'b') => 2,
        _ => return None,
    };
    if !zero.is(b'0') {
        return None;
    }
    let (value, count) = scan_binary_integer(digits, radix);
    (count != 0).then_some((value, 2 + count))
}

fn str_decimal_literal<T: CodeUnit>(units: &[T]) -> Option<(f64, usize)> {
    const INFINITY: Text<'static> = Text::from_ascii("Infinity");
    parse_decimal_prefix(units).or_else(|| {
        let (is_negative, start) = scan_sign(units, 0);
        T::text(&units[start..]).starts_with(INFINITY).then(|| {
            let value = with_sign(f64::INFINITY, is_negative);
            (value, start + INFINITY.len())
        })
    })
}
