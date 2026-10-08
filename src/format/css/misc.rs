//! Prettier's `print/misc.js`, and the utilities of Prettier that it uses: strings, numbers, units,
//! and questions about the text around a position.

use super::text::{self, ByteSet};
use std::borrow::Cow;

/// The units of `css-units-list`, as they are written.
const CSS_UNITS: [&[u8]; 62] = [
    b"em", b"rem", b"ex", b"rex", b"cap", b"rcap", b"ch", b"rch", b"ic", b"ric", b"lh", b"rlh", b"vw", b"svw", b"lvw",
    b"dvw", b"vh", b"svh", b"lvh", b"dvh", b"vi", b"svi", b"lvi", b"dvi", b"vb", b"svb", b"lvb", b"dvb", b"vmin",
    b"svmin", b"lvmin", b"dvmin", b"vmax", b"svmax", b"lvmax", b"dvmax", b"cm", b"mm", b"Q", b"in", b"pt", b"pc", b"px",
    b"deg", b"grad", b"rad", b"turn", b"s", b"ms", b"Hz", b"kHz", b"dpi", b"dpcm", b"dppx", b"x", b"cqw", b"cqh", b"cqi",
    b"cqb", b"cqmin", b"cqmax", b"fr",
];

fn css_unit(unit: &[u8]) -> Option<&'static [u8]> {
    CSS_UNITS.iter().find(|it| it.eq_ignore_ascii_case(unit)).copied()
}

/// `printUnit`
pub(crate) fn print_unit(unit: &[u8]) -> &[u8] {
    css_unit(unit).unwrap_or(unit)
}

/// `printCssNumber`: `printNumber`, and no `.0` at the end. `raw` is a number as the parsers for
/// values and the regular expression of `adjustNumbers` take it.
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
    let fraction_len = fraction.iter().rposition(|&b| b != b'0').map_or(0, |at| at + 1);
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

/// `/(["'])(?:(?!\1)[^\\]|\\.)*\1/s` at the start of `text`: the length of the match.
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

/// Prettier's `makeString`.
fn make_string(raw_content: &[u8], enclosing_quote: u8, out: &mut Vec<u8>) {
    let other_quote = if enclosing_quote == b'"' { b'\'' } else { b'"' };
    out.push(enclosing_quote);
    let mut at = 0;
    while let Some(&byte) = raw_content.get(at) {
        match (byte, raw_content.get(at + 1)) {
            (b'\\', Some(&escaped @ (b'"' | b'\'' | b'\\'))) => {
                if escaped != other_quote {
                    out.push(b'\\');
                }
                out.push(escaped);
                at += 2;
                continue;
            }
            (b'"' | b'\'', _) if byte == enclosing_quote => out.extend_from_slice(&[b'\\', byte]),
            _ => out.push(byte),
        }
        at += 1;
    }
    out.push(enclosing_quote);
}

/// Prettier's `printString`. `raw` has its quotes.
pub(crate) fn print_string(raw: &[u8], single_quote: bool, out: &mut Vec<u8>) {
    let content = raw.get(1..raw.len().saturating_sub(1)).unwrap_or_default();
    let (preferred, alternate) = if single_quote { (b'\'', b'"') } else { (b'"', b'\'') };
    let count = |quote: u8| bun_core::strings::count_char(content, quote);
    let enclosing_quote = if count(preferred) > count(alternate) { alternate } else { preferred };
    if raw.first() == Some(&enclosing_quote) {
        return out.extend_from_slice(raw);
    }
    make_string(content, enclosing_quote, out);
}

/// `adjustStrings`
pub(crate) fn adjust_strings(value: &[u8], single_quote: bool) -> Cow<'_, [u8]> {
    static QUOTES: ByteSet = ByteSet::new(b"\"'");
    if QUOTES.find(value, 0).is_none() {
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

/// `/(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?/i` at the start of `text`: the length of the match.
fn number_len(text: &[u8]) -> Option<usize> {
    let digits = |from: usize| text.get(from..).unwrap_or_default().iter().take_while(|b| b.is_ascii_digit()).count();
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
    let is_word_part = |b: u8| text::is_word_character(b) || b == b'-' || b >= 0x80;
    if !value.iter().any(u8::is_ascii_digit) {
        return Cow::Borrowed(value);
    }
    // The numbers in a word are part of it, and so is everything in a name.
    let name = &value[value.iter().take_while(|&&b| b == b'-').count()..];
    if name.first().is_some_and(|&b| is_word_start(b)) && name.iter().all(|&b| is_word_part(b)) {
        return Cow::Borrowed(value);
    }
    let unit_len = |from: usize| value[from..].iter().take_while(|b| b.is_ascii_alphabetic()).count();
    let mut out = Vec::with_capacity(value.len());
    let mut at = 0;
    while let Some(&byte) = value.get(at) {
        if let Some(len) = string_len(&value[at..]) {
            out.extend_from_slice(&value[at..at + len]);
            at += len;
            continue;
        }
        // `[$@]?[_a-z\u0080-￿][\w\u0080-￿-]*`, which gives back what it takes for a number
        // to follow.
        let prefix = usize::from(matches!(byte, b'$' | b'@'));
        if value.get(at + prefix).is_some_and(|&b| is_word_start(b)) {
            let shortest = at + prefix + 1;
            let longest = shortest + value[shortest..].iter().take_while(|&&b| is_word_part(b)).count();
            let number_start = (shortest..=longest).rev().find(|&start| number_len(&value[start..]).is_some());
            let end = match number_start {
                Some(start) => {
                    let end = start + number_len(&value[start..]).unwrap_or(0);
                    end + unit_len(end)
                }
                // Nor does any word that starts later in this one have a number behind it.
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
        let (number, unit) = (&value[at..at + len], &value[at + len..at + len + unit_len(at + len)]);
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
    // `/^(?<value>.+?)\s+(?<flag>[a-z])$/i`, in which `.` is not a line break.
    let flag = value.last().copied().filter(u8::is_ascii_alphabetic).and_then(|flag| {
        let before = &value[..value.len() - 1];
        let unflagged = text::trim_end(before);
        let is_match = unflagged.len() < before.len()
            && !unflagged.is_empty()
            && bun_core::strings::index_of_any(unflagged, b"\n\r").is_none();
        is_match.then_some((unflagged.len(), flag))
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

/// `maybeToLowerCase`
pub(crate) fn maybe_to_lower_case(value: &[u8]) -> Cow<'_, [u8]> {
    static SIGNS: ByteSet = ByteSet::new(b"$@#");
    static OPEN: ByteSet = ByteSet::new(b"(");
    static CLOSE: ByteSet = ByteSet::new(b")");
    let keeps_case = SIGNS.find(value, 0).is_some()
        || value.starts_with(b"%")
        || value.starts_with(b"--")
        || value.starts_with(b":--")
        || (OPEN.find(value, 0).is_some() && CLOSE.find(value, 0).is_some());
    match keeps_case {
        true => Cow::Borrowed(value),
        false => text::to_lower_case(value),
    }
}

/// `lastLineHasInlineComment`
pub(crate) fn last_line_has_inline_comment(value: &[u8]) -> bool {
    let last_line_start = bun_core::strings::last_index_of_any(value, b"\n\r").map_or(0, |at| at + 1);
    text::includes(&value[last_line_start..], b"//")
}

// ───────────────────────────── `src/utilities` ─────────────────────────────

fn skip_forward(text: &[u8], mut at: usize, set: &[u8]) -> usize {
    while text.get(at).is_some_and(|b| bun_core::strings::contains_char(set, *b)) {
        at += 1;
    }
    at
}

/// The length of the line break at the start of `text`.
fn newline_len(text: &[u8]) -> usize {
    match text {
        [b'\r', b'\n', ..] => 2,
        [b'\n' | b'\r', ..] => 1,
        [0xE2, 0x80, 0xA8 | 0xA9, ..] => 3,
        _ => 0,
    }
}

/// `hasNewline(text, index)`
pub(crate) fn has_newline(text: &[u8], index: usize) -> bool {
    let at = skip_forward(text, index, b" \t");
    newline_len(text.get(at..).unwrap_or_default()) > 0
}

/// `hasNewline(text, index, { backwards: true })`
pub(crate) fn has_newline_backwards(text: &[u8], index: usize) -> bool {
    let before = text.get(..index).unwrap_or_default();
    let end = before.iter().rposition(|b| !matches!(b, b' ' | b'\t')).map_or(0, |at| at + 1);
    matches!(before[..end], [.., b'\n' | b'\r'] | [.., 0xE2, 0x80, 0xA8 | 0xA9])
}

/// `isNextLineEmpty(text, index)`
pub(crate) fn is_next_line_empty(text: &[u8], index: usize) -> bool {
    let mut at = index;
    loop {
        let old = at;
        at = skip_forward(text, at, b",; \t");
        if text.get(at..).is_some_and(|rest| rest.starts_with(b"/*"))
            && let Some(close) = text::index_of_from(text, b"*/", at + 2)
        {
            at = close + 2;
        }
        at = skip_forward(text, at, b" \t");
        if at == old {
            break;
        }
    }
    if text.get(at..).is_some_and(|rest| rest.starts_with(b"//")) {
        at += bun_core::strings::index_of_any(&text[at..], b"\n\r").map_or(text.len() - at, |len| len as usize);
    }
    at += newline_len(text.get(at..).unwrap_or_default());
    has_newline(text, at)
}
