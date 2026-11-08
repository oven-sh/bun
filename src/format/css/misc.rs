//! Prettier's `print/misc.js`, plus the Prettier utilities it uses for strings, numbers and units.

use crate::html::in_js::PLACEHOLDER_START;
use crate::text::make_string;
use bun_core::strings;
use std::borrow::Cow;

/// The units in `css-units-list`, in their canonical case.
const CSS_UNITS: [&[u8]; 62] = [
    b"em", b"rem", b"ex", b"rex", b"cap", b"rcap", b"ch", b"rch", b"ic", b"ric", b"lh", b"rlh",
    b"vw", b"svw", b"lvw", b"dvw", b"vh", b"svh", b"lvh", b"dvh", b"vi", b"svi", b"lvi", b"dvi",
    b"vb", b"svb", b"lvb", b"dvb", b"vmin", b"svmin", b"lvmin", b"dvmin", b"vmax", b"svmax",
    b"lvmax", b"dvmax", b"cm", b"mm", b"Q", b"in", b"pt", b"pc", b"px", b"deg", b"grad", b"rad",
    b"turn", b"s", b"ms", b"Hz", b"kHz", b"dpi", b"dpcm", b"dppx", b"x", b"cqw", b"cqh", b"cqi",
    b"cqb", b"cqmin", b"cqmax", b"fr",
];

fn css_unit(unit: &[u8]) -> Option<&'static [u8]> {
    CSS_UNITS
        .iter()
        .find(|it| it.eq_ignore_ascii_case(unit))
        .copied()
}

/// `printUnit`
pub(crate) fn print_unit(unit: &[u8]) -> &[u8] {
    css_unit(unit).unwrap_or(unit)
}

/// `printCssNumber`: `printNumber`, then drop a trailing `.0`. `raw` is a number as matched by the value parsers or by
/// the regular expression in `adjustNumbers`.
pub(crate) fn print_css_number(raw: &[u8], out: &mut Vec<u8>) {
    if raw.len() == 1 {
        return out.extend_from_slice(raw);
    }
    let digits = |text: &[u8]| text.iter().take_while(|b| b.is_ascii_digit()).count();
    let (sign, rest) = match raw {
        [sign @ (b'+' | b'-'), rest @ ..] => (Some(*sign), rest),
        _ => (None, raw),
    };
    let (integer, rest) = rest.split_at(digits(rest));
    let (fraction, rest) = match rest {
        [b'.', rest @ ..] => rest.split_at(digits(rest)),
        _ => (&b""[..], rest),
    };
    let (exponent_sign, exponent) = match rest {
        [b'e' | b'E', sign @ (b'+' | b'-'), exponent @ ..] => (Some(*sign), exponent),
        [b'e' | b'E', exponent @ ..] => (None, exponent),
        // Not a number after all.
        [_, ..] => return out.extend_from_slice(&raw.to_ascii_lowercase()),
        [] => (None, &b""[..]),
    };
    if integer.is_empty() && fraction.is_empty() {
        return out.extend_from_slice(&raw.to_ascii_lowercase());
    }
    out.extend(sign);
    match integer.is_empty() {
        true => out.push(b'0'),
        false => out.extend_from_slice(integer),
    }
    let fraction_len = fraction
        .iter()
        .rposition(|&b| b != b'0')
        .map_or(0, |at| at + 1);
    if fraction_len > 0 {
        out.push(b'.');
        out.extend_from_slice(&fraction[..fraction_len]);
    }
    let exponent = &exponent[exponent.iter().take_while(|&&b| b == b'0').count()..];
    if !exponent.is_empty() {
        out.push(b'e');
        out.extend(exponent_sign.filter(|&sign| sign == b'-'));
        out.extend_from_slice(exponent);
    }
}

/// Matches `/(["'])(?:(?!\1)[^\\]|\\.)*\1/s` at the start of `text` and returns the match's length.
fn string_len(text: &[u8]) -> Option<usize> {
    let &quote = text.first().filter(|b| matches!(b, b'"' | b'\''))?;
    let mut at = 1;
    loop {
        match *text.get(at)? {
            b'\\' => {
                text.get(at + 1)?;
                at += 2;
            }
            byte if byte == quote => return Some(at + 1),
            _ => at += 1,
        }
    }
}

/// Prettier's `printString`. `raw` includes its quotes.
pub(crate) fn print_string(raw: &[u8], single_quote: bool, out: &mut Vec<u8>) {
    let content = raw.get(1..raw.len().saturating_sub(1)).unwrap_or_default();
    let (preferred, alternate) = if single_quote {
        (b'\'', b'"')
    } else {
        (b'"', b'\'')
    };
    let count = |quote: u8| bun_core::strings::count_char(content, quote);
    let enclosing_quote = if count(preferred) > count(alternate) {
        alternate
    } else {
        preferred
    };
    if raw.first() == Some(&enclosing_quote) {
        return out.extend_from_slice(raw);
    }
    make_string(content, enclosing_quote, out);
}

/// `adjustStrings`
pub(crate) fn adjust_strings(value: &[u8], single_quote: bool) -> Cow<'_, [u8]> {
    if !strings::contains_any(value, b"\"'") {
        return Cow::Borrowed(value);
    }
    let mut out = Vec::with_capacity(value.len());
    let mut at = 0;
    while let Some(&byte) = value.get(at) {
        match string_len(&value[at..]) {
            Some(len) => {
                print_string(&value[at..at + len], single_quote, &mut out);
                at += len;
            }
            None => {
                out.push(byte);
                at += 1;
            }
        }
    }
    Cow::Owned(out)
}

/// Matches `/(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?/i` at the start of `text` and returns the match's length.
fn number_len(text: &[u8]) -> Option<usize> {
    let digits = |from: usize| {
        text.get(from..)
            .unwrap_or_default()
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count()
    };
    let integer = digits(0);
    let mut len = if text.get(integer) == Some(&b'.') && digits(integer + 1) > 0 {
        integer + 1 + digits(integer + 1)
    } else if integer > 0 {
        integer + usize::from(text.get(integer) == Some(&b'.'))
    } else {
        return None;
    };
    if matches!(text.get(len), Some(b'e' | b'E')) {
        let sign = usize::from(matches!(text.get(len + 1), Some(b'+' | b'-')));
        let exponent = digits(len + 1 + sign);
        if exponent > 0 {
            len += 1 + sign + exponent;
        }
    }
    Some(len)
}

/// `adjustNumbers`
pub(crate) fn adjust_numbers(value: &[u8]) -> Cow<'_, [u8]> {
    let is_word_start = |b: u8| b == b'_' || b.is_ascii_alphabetic() || b >= 0x80;
    let is_word_part = |b: u8| bun_core::strings::is_regexp_word_byte(b) || b == b'-' || b >= 0x80;
    if !value.iter().any(u8::is_ascii_digit) {
        return Cow::Borrowed(value);
    }
    // Digits inside a word belong to the word, so a value that's a single name stays as it is.
    let name = &value[value.iter().take_while(|&&b| b == b'-').count()..];
    if name.first().is_some_and(|&b| is_word_start(b)) && name.iter().all(|&b| is_word_part(b)) {
        return Cow::Borrowed(value);
    }
    let unit_len = |from: usize| {
        value[from..]
            .iter()
            .take_while(|b| b.is_ascii_alphabetic())
            .count()
    };
    let mut out = Vec::with_capacity(value.len());
    let mut at = 0;
    while let Some(&byte) = value.get(at) {
        if let Some(len) = string_len(&value[at..]) {
            out.extend_from_slice(&value[at..at + len]);
            at += len;
            continue;
        }
        // `[$@]?[_a-z\u0080-￿][\w\u0080-￿-]*`, which backtracks as far as needed for a number to follow.
        let prefix = usize::from(matches!(byte, b'$' | b'@'));
        if value.get(at + prefix).is_some_and(|&b| is_word_start(b)) {
            let shortest = at + prefix + 1;
            let longest = shortest
                + value[shortest..]
                    .iter()
                    .take_while(|&&b| is_word_part(b))
                    .count();
            let number_start = (shortest..=longest)
                .rev()
                .find(|&start| number_len(&value[start..]).is_some());
            let end = match number_start {
                Some(start) => {
                    let end = start + number_len(&value[start..]).unwrap_or(0);
                    end + unit_len(end)
                }
                // No word that starts later inside this one is followed by a number either, so skip all of it.
                None => longest,
            };
            out.extend_from_slice(&value[at..end]);
            at = end;
            continue;
        }
        let Some(len) = number_len(&value[at..]) else {
            out.push(byte);
            at += 1;
            continue;
        };
        let (number, unit) = (
            &value[at..at + len],
            &value[at + len..at + len + unit_len(at + len)],
        );
        if unit.is_empty() || unit.eq_ignore_ascii_case(b"n") || css_unit(unit).is_some() {
            print_css_number(number, &mut out);
            match css_unit(unit) {
                Some(unit) => out.extend_from_slice(unit),
                None => out.extend_from_slice(&unit.to_ascii_lowercase()),
            }
        } else {
            out.extend_from_slice(number);
            out.extend_from_slice(unit);
        }
        at += len + unit.len();
    }
    Cow::Owned(out)
}

/// `quoteAttributeValue`
pub(crate) fn quote_attribute_value(value: Cow<'_, [u8]>, single_quote: bool) -> Cow<'_, [u8]> {
    // `/^(?<value>.+?)\s+(?<flag>[a-z])$/i`, where `.` doesn't match a line break.
    let flag = value
        .last()
        .copied()
        .filter(u8::is_ascii_alphabetic)
        .and_then(|flag| {
            let before = &value[..value.len() - 1];
            let unflagged = bun_core::strings::trim_js_whitespace_end(before);
            // Prettier turns `b\ c` into `"b\" c`. It turns `b\31 c`, which means `b1c`, into `"b\31" c`.
            let is_escaped = ends_with_unescaped_backslash(unflagged);
            let escape_whitespace_len = usize::from(is_escaped || ends_with_hex_escape(unflagged));
            let is_match = unflagged.len() + escape_whitespace_len < before.len()
                && !unflagged.is_empty()
                && bun_core::strings::index_of_any(unflagged, b"\n\r").is_none();
            is_match.then_some((unflagged.len() + usize::from(is_escaped), flag))
        });
    let unflagged = &value[..flag.map_or(value.len(), |(len, _)| len)];
    let has_quotes = bun_core::strings::index_of_any(unflagged, b"\"'").is_some();
    if has_quotes && flag.is_none() {
        return value;
    }
    let quote = if single_quote { b'\'' } else { b'"' };
    let mut out = Vec::with_capacity(value.len() + 2);
    if !has_quotes {
        out.push(quote);
    }
    out.extend_from_slice(unflagged);
    if !has_quotes {
        out.push(quote);
    }
    if let Some((_, flag)) = flag {
        out.extend_from_slice(&[b' ', flag]);
    }
    Cow::Owned(out)
}

/// `value.toLowerCase()`, but only for ASCII letters, the only ones CSS treats as case-insensitive. Prettier turns a
/// Kelvin sign into `k`.
pub(crate) fn to_lower_case(value: &[u8]) -> Cow<'_, [u8]> {
    match value.iter().any(u8::is_ascii_uppercase) {
        true => Cow::Owned(value.to_ascii_lowercase()),
        false => Cow::Borrowed(value),
    }
}

/// `maybeToLowerCase`
pub(crate) fn maybe_to_lower_case(value: &[u8]) -> Cow<'_, [u8]> {
    // The last check is for the placeholder of a JavaScript template substitution. Prettier lowercases it and then
    // can't find it again.
    let keeps_case = strings::contains_any(value, b"$@#")
        || value.starts_with(b"%")
        || value.starts_with(b"--")
        || value.starts_with(b":--")
        || (strings::contains_char(value, b'(') && strings::contains_char(value, b')'))
        || (value.len() > PLACEHOLDER_START.len() && strings::contains(value, PLACEHOLDER_START));
    match keeps_case {
        true => Cow::Borrowed(value),
        false => to_lower_case(value),
    }
}

/// True if `text` ends with a backslash that isn't escaped itself. If `text` is a whole value or all of an at-rule's
/// parameters, the backslash escapes whitespace that `postcss` split off as trailing whitespace, because anything else
/// would still be in `text`. That doesn't hold for a word of a value: `\@a` is split into `\` and `@a`.
pub(crate) fn ends_with_unescaped_backslash(text: &[u8]) -> bool {
    text.ends_with(b"\\") && text.iter().rev().take_while(|byte| **byte == b'\\').count() % 2 == 1
}

/// True if `text` ends with `\` and one to six hex digits. One whitespace character after that is part of the escape:
/// `\31 0` means `10`.
pub(crate) fn ends_with_hex_escape(text: &[u8]) -> bool {
    let digits = (text.iter().rev())
        .take_while(|byte| byte.is_ascii_hexdigit())
        .count();
    (1..=6).contains(&digits) && ends_with_unescaped_backslash(&text[..text.len() - digits])
}

/// Returns the offset of the first SCSS or Less `//` comment in `text` at or after `at`. Skips strings, `/* */`
/// comments and unquoted `url()`s.
pub(crate) fn next_line_comment(text: &[u8], mut at: usize) -> Option<usize> {
    while let Some(found) = strings::index_of_any(text.get(at..)?, b"/\"'(") {
        at += found;
        match text[at] {
            quote @ (b'"' | b'\'') => {
                at += 1;
                while text.get(at).is_some_and(|it| *it != quote) {
                    at += 1 + usize::from(text[at] == b'\\');
                }
            }
            b'(' if at >= 3
                && text[at - 3..at].eq_ignore_ascii_case(b"url")
                && !matches!(
                    strings::trim_js_whitespace_start(&text[at + 1..]).first(),
                    Some(b'"' | b'\'')
                ) =>
            {
                at += strings::index_of_char_usize(&text[at..], b')')?;
            }
            b'/' if text.get(at + 1) == Some(&b'*') => {
                at += 3 + strings::index_of(text.get(at + 2..)?, b"*/")?;
            }
            b'/' if text.get(at + 1) == Some(&b'/') => return Some(at),
            _ => {}
        }
        at += 1;
    }
    None
}

/// Returns the offset of the `//` comment that `text` ends with.
pub(crate) fn line_comment_at_end(text: &[u8]) -> Option<usize> {
    let mut at = 0;
    loop {
        let start = next_line_comment(text, at)?;
        match strings::index_of_any(&text[start..], b"\n\r") {
            Some(len) => at = start + len,
            None => return Some(start),
        }
    }
}

/// `lastLineHasInlineComment`
pub(crate) fn last_line_has_inline_comment(value: &[u8]) -> bool {
    let last_line_start =
        bun_core::strings::last_index_of_any(value, b"\n\r").map_or(0, |at| at + 1);
    bun_core::strings::contains(&value[last_line_start..], b"//")
}
