//! Prettier's `printNumber`.

use crate::prelude::*;
use std::borrow::Cow;

/// - Lowercase everything: `0XAB` is `0xab`, `1E5` is `1e5`, `10N` is `10n`.
/// - No `+` and no leading zeros in the exponent: `1e+05` is `1e5`. No exponent that is zero.
/// - A digit before the dot: `.5` is `0.5`.
/// - No trailing zeros after the dot, except for one if there is nothing else: `1.50` is `1.5`,
///   `1.00` is `1.0`.
/// - No trailing dot: `1.` is `1`.
pub(crate) fn format_trimmed_number(text: &[u8]) -> Cow<'_, [u8]> {
    let is_plain = |b: &u8| b.is_ascii_digit();
    if text.len() == 1 || text.iter().all(is_plain) {
        return Cow::Borrowed(text);
    }
    let lower = text.to_ascii_lowercase();
    // Only decimal literals without separators match the patterns.
    let is_decimal = lower.iter().all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'+' | b'-'));
    if !is_decimal {
        let mut out = lower;
        if out.first() == Some(&b'.') {
            out.insert(0, b'0');
        }
        return finish(text, out);
    }

    let (mantissa, exponent) = match bun_core::strings::split_once_char(&lower, b'e') {
        Some((mantissa, exponent)) => (mantissa, Some(exponent)),
        None => (&lower[..], None),
    };
    let mut out = Vec::with_capacity(lower.len() + 1);
    if mantissa.first() == Some(&b'.') {
        out.push(b'0');
    }
    match bun_core::strings::split_once_char(mantissa, b'.') {
        Some((integer, fraction)) => {
            out.extend_from_slice(integer);
            // `(\.\d+?)0+(?=e|$)` keeps at least one digit.
            let significant = fraction.len() - fraction.iter().rev().take_while(|b| **b == b'0').count();
            let kept = &fraction[..significant.max(1).min(fraction.len())];
            if !kept.is_empty() {
                out.push(b'.');
                out.extend_from_slice(kept);
            }
        }
        None => out.extend_from_slice(mantissa),
    }
    if let Some(exponent) = exponent {
        let (sign, digits) = match exponent.split_first() {
            Some((b'-', digits)) => (&b"-"[..], digits),
            Some((b'+', digits)) => (&b""[..], digits),
            _ => (&b""[..], exponent),
        };
        let digits = &digits[digits.iter().take_while(|b| **b == b'0').count()..];
        if !digits.is_empty() {
            out.push(b'e');
            out.extend_from_slice(sign);
            out.extend_from_slice(digits);
        }
    }
    finish(text, out)
}

fn finish(text: &[u8], out: Vec<u8>) -> Cow<'_, [u8]> {
    match out == text {
        true => Cow::Borrowed(text),
        false => Cow::Owned(out),
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
