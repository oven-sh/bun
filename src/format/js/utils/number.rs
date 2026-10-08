//! Prettier's `printNumber`.

use crate::prelude::*;
use smallvec::SmallVec;
use std::borrow::Cow;

/// - Lowercase everything: `0XAB` is `0xab`, `1E5` is `1e5`.
/// - No `+` and no leading zeros in the exponent: `1e+05` is `1e5`. No exponent that is zero.
/// - A digit before the dot: `.5` is `0.5`.
/// - No trailing zeros after the dot, except for one if there is nothing else: `1.50` is `1.5`,
///   `1.00` is `1.0`.
/// - No trailing dot: `1.` is `1`.
///
/// Prettier does this with regular expressions that know nothing about `_`, so a separator in the
/// wrong place keeps a rule from being applied: `1_0.50` is `1_0.5`, `1.5_0` stays.
pub(crate) fn format_trimmed_number(text: &[u8]) -> Cow<'_, [u8]> {
    if text.len() == 1 || text.iter().all(u8::is_ascii_digit) {
        return Cow::Borrowed(text);
    }
    let mut out: SmallVec<[u8; 32]> = text.iter().map(u8::to_ascii_lowercase).collect();

    let mantissa_len = out.iter().take_while(|b| b.is_ascii_digit() || **b == b'.').count();
    if mantissa_len > 0 && out.get(mantissa_len) == Some(&b'e') {
        // `^([\d.]+e)(?:\+|(-))?0*(?=\d)` becomes `$1$2`
        let sign = mantissa_len + 1;
        let digits = sign + usize::from(matches!(out.get(sign), Some(b'+' | b'-')));
        let zeros = out.iter().skip(digits).take_while(|b| **b == b'0').count();
        let removed_zeros = match out.get(digits + zeros) {
            Some(next) if next.is_ascii_digit() => zeros,
            _ => zeros.saturating_sub(1),
        };
        if out.get(digits + removed_zeros).is_some_and(u8::is_ascii_digit) {
            out.drain(digits..digits + removed_zeros);
            if out.get(sign) == Some(&b'+') {
                out.remove(sign);
            }
        }
        // `^([\d.]+)e[+-]?0+$` becomes `$1`
        let digits = sign + usize::from(matches!(out.get(sign), Some(b'+' | b'-')));
        if digits < out.len() && out.iter().skip(digits).all(|b| *b == b'0') {
            out.truncate(mantissa_len);
        }
    }

    // `^\.` becomes `0.`
    if out.first() == Some(&b'.') {
        out.insert(0, b'0');
    }

    // Angular takes a number with more than one dot. Each of the two is done at the first dot where it can be.
    let next_dot = |out: &[u8], from: usize| {
        out.get(from..).and_then(|rest| bun_core::strings::index_of_char_usize(rest, b'.')).map(|at| from + at)
    };
    // `(\.\d+?)0+(?=e|$)` becomes `$1`
    let mut from = 0;
    while let Some(dot) = next_dot(&out, from) {
        let fraction = dot + 1;
        let fraction_end = fraction + out.iter().skip(fraction).take_while(|b| b.is_ascii_digit()).count();
        if matches!(out.get(fraction_end), None | Some(b'e')) {
            let digits = out.get(fraction..fraction_end).unwrap_or_default();
            let zeros = digits.iter().rev().take_while(|b| **b == b'0').count();
            let kept_end = (fraction_end - zeros).max(fraction + 1);
            if kept_end < fraction_end {
                out.drain(kept_end..fraction_end);
                break;
            }
        }
        from = fraction;
    }
    // `\.(?=e|$)` is removed
    let mut from = 0;
    while let Some(dot) = next_dot(&out, from) {
        if matches!(out.get(dot + 1), None | Some(b'e')) {
            out.remove(dot);
            break;
        }
        from = dot + 1;
    }

    match out[..] == *text {
        true => Cow::Borrowed(text),
        false => Cow::Owned(out.to_vec()),
    }
}

/// A numeric literal as it is written in the source.
pub(crate) fn format_number_token(text: &[u8]) -> CleanedNumberLiteralText<'_> {
    CleanedNumberLiteralText { text }
}

pub(crate) struct CleanedNumberLiteralText<'t> {
    text: &'t [u8],
}

impl<'a> Format<'a> for CleanedNumberLiteralText<'_> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        text_without_whitespace(&format_trimmed_number(self.text)).fmt(f);
    }
}
