//! JavaScript's string operations, on UTF-8 text.
//!
//! | JavaScript | here |
//! | --- | --- |
//! | `s.length` | [`strings::wtf8_len_utf16`] |
//! | `[...s]`, `s.codePointAt(i)` | [`strings::wtf8_codepoints`] |
//! | `[...s].length` | [`strings::wtf8_codepoint_count`] |
//! | `/\s/u.test(c)` | [`strings::is_js_whitespace`] |
//! | `/^\s/u.exec(s)?.[0].length` in bytes | [`strings::js_whitespace_len`] |
//! | `s.trim()`, `trimStart()`, `trimEnd()` | [`strings::trim_js_whitespace`], [`strings::trim_js_whitespace_start`], [`strings::trim_js_whitespace_end`] |
//! | `/^\s*$/u.test(s)` | [`strings::is_all_js_whitespace`] |
//! | `s.replace(/^abc/iu, "")`, `/^\w/iu.test(s)`, `/\w$/iu.test(s)` | [`strip_prefix_ignoring_case`], [`starts_with_word_ignoring_case`], [`ends_with_word_ignoring_case`] |
//! | `s.toLowerCase()`, `s.toUpperCase()` | [`to_lower_case`], [`to_upper_case`] |
//! | `s[0].toUpperCase() + s.slice(1)` | [`upper_case_first`] |
//! | `String(n)` | [`number_to_string`] |
//! | `Number(s)` | [`bun_core::fmt::js_string_to_number`] |
//! | `JSON.stringify(s)` | [`json_stringify`] |
//! | `decodeURIComponent(s)`, `decodeURI(s)` | [`decode_uri`] |
//! | `s.toWellFormed()` | [`strings::push_wtf8_well_formed`] |
//! | `String.fromCodePoint(...values)`, `String.fromCharCode(...values)` | [`string_from_code_points`], [`strings::push_codepoint_wtf8_joined`] |
//! | `a < b`, `a.localeCompare`-free sorting | [`strings::order_utf16`] |
//! | `require("natural-compare")` | [`natural_compare`] |
//! | `require("natural-orderby").compare()`, `compare({ locale })` | [`natural_orderby`], [`natural_orderby_in`], [`natural_orderby_without_locale`] |
//! | `a.localeCompare(b, locale)` | [`strings::Collator`] |
//! | `esutils.keyword.isIdentifierES5`, `isIdentifierES6` | [`is_identifier_es5`], [`is_identifier_es6`] |
//! | `s.split(/\r\n\|[\r\n\u2028\u2029]/u)`, `/\r\n\|[\r\n\u2028\u2029]/u.test(s)` | [`strings::js_lines`], [`strings::contains_js_line_break`] |
//! | `s.slice(a, b)` with UTF-16 indices (an index in the middle of a surrogate pair is treated as the pair's start) |
//! [`strings::wtf8_slice_by_utf16`], [`strings::wtf8_offset_of_utf16_index`] |

use bun_core::lexer::{char_and_size, is_type_script_identifier_part};
use bun_core::strings;
use std::borrow::Cow;
use std::cmp::Ordering;

/// TypeScript's `getSpellingSuggestion`. Returns the candidate that `name` is most likely a typo of.
pub fn spelling_suggestion<'c>(
    name: &[u8],
    candidates: impl Iterator<Item = &'c [u8]>,
) -> Option<&'c [u8]> {
    bun_sema::check::get_spelling_suggestion(name, candidates, |it| it, |a, b| a.cmp(b))
}

/// The last code point of `text`.
pub fn last_code_point(text: &[u8]) -> Option<u32> {
    (!text.is_empty()).then(|| bun_core::lexer::last_char(text).0 as u32)
}

/// Returns what follows `prefix` in `text`, if `/^prefix/iu` matches. `prefix` must be ASCII without capitals.
///
/// With these flags U+017F matches `s` and U+212A matches `k`, and both match `\w`. No other non-ASCII character
/// case-folds to an ASCII character.
pub fn strip_prefix_ignoring_case<'t>(text: &'t [u8], prefix: &[u8]) -> Option<&'t [u8]> {
    let mut rest = text;
    for &c in prefix {
        rest = match *rest {
            [first, ref rest @ ..] if first.to_ascii_lowercase() == c => rest,
            [0xC5, 0xBF, ref rest @ ..] if c == b's' => rest,
            [0xE2, 0x84, 0xAA, ref rest @ ..] if c == b'k' => rest,
            _ => return None,
        };
    }
    Some(rest)
}

/// The first byte of the non-ASCII character that case-folds to `c`, or `c` if there's none.
#[inline]
pub fn first_byte_of_other_case(c: u8) -> u8 {
    match c {
        b's' => 0xC5,
        b'k' => 0xE2,
        _ => c,
    }
}

/// `/^\w/iu.test(text)`
#[inline]
pub fn starts_with_word_ignoring_case(text: &[u8]) -> bool {
    matches!(
        *text,
        [b'0'..=b'9' | b'A'..=b'Z' | b'_' | b'a'..=b'z', ..] | [0xC5, 0xBF, ..] | [0xE2, 0x84, 0xAA, ..]
    )
}

/// `/\w$/iu.test(text)`
#[inline]
pub fn ends_with_word_ignoring_case(text: &[u8]) -> bool {
    matches!(
        *text,
        [.., b'0'..=b'9' | b'A'..=b'Z' | b'_' | b'a'..=b'z'] | [.., 0xC5, 0xBF] | [.., 0xE2, 0x84, 0xAA]
    )
}

fn map_case<'t>(
    text: &'t [u8],
    is_unchanged: impl Fn(&u8) -> bool,
    ascii: impl Fn(&[u8]) -> Vec<u8>,
    unicode: impl Fn(&str) -> String,
) -> Cow<'t, [u8]> {
    if strings::first_non_ascii(text).is_none() {
        return match text.iter().all(is_unchanged) {
            true => Cow::Borrowed(text),
            false => Cow::Owned(ascii(text)),
        };
    }
    let mut out = Vec::with_capacity(text.len());
    for chunk in text.utf8_chunks() {
        out.extend_from_slice(unicode(chunk.valid()).as_bytes());
        out.extend_from_slice(chunk.invalid());
    }
    Cow::Owned(out)
}

/// True if `text` ends with `ending`, ignoring the case of ASCII letters.
pub fn ends_with_ignore_ascii_case(text: &[u8], ending: &[u8]) -> bool {
    (text.len().checked_sub(ending.len()))
        .and_then(|at| text.get(at..))
        .is_some_and(|end| end.eq_ignore_ascii_case(ending))
}

/// `text.toLowerCase()`
pub fn to_lower_case(text: &[u8]) -> Cow<'_, [u8]> {
    map_case(
        text,
        |c| !c.is_ascii_uppercase(),
        <[u8]>::to_ascii_lowercase,
        str::to_lowercase,
    )
}

/// `text.toUpperCase()`
pub fn to_upper_case(text: &[u8]) -> Cow<'_, [u8]> {
    map_case(
        text,
        |c| !c.is_ascii_lowercase(),
        <[u8]>::to_ascii_uppercase,
        str::to_uppercase,
    )
}

/// `text === text.toUpperCase()`
#[inline]
pub fn is_upper_case(text: &[u8]) -> bool {
    match text.is_ascii() {
        true => !text.iter().any(u8::is_ascii_lowercase),
        false => *to_upper_case(text) == *text,
    }
}

/// `text === text.toLowerCase()`
#[inline]
pub fn is_lower_case(text: &[u8]) -> bool {
    match text.is_ascii() {
        true => !text.iter().any(u8::is_ascii_uppercase),
        false => *to_lower_case(text) == *text,
    }
}

/// ESLint's and typescript-eslint's `upperCaseFirst`: `text[0].toUpperCase() + text.slice(1)`.
pub fn upper_case_first(text: &[u8]) -> Cow<'_, [u8]> {
    let (c, size) = char_and_size(text, 0);
    // For a character outside the BMP, `text[0]` is a lone surrogate, which has no case.
    if size == 0 || c > 0xFFFF {
        return Cow::Borrowed(text);
    }
    match to_upper_case(&text[..size]) {
        Cow::Borrowed(_) => Cow::Borrowed(text),
        Cow::Owned(mut first) => {
            first.extend_from_slice(&text[size..]);
            Cow::Owned(first)
        }
    }
}

/// The spec's `Decode`. `preserved` has the characters whose escapes are kept: none for `decodeURIComponent`,
/// `;/?:@&=+$,#` for `decodeURI`. Returns `None` where JavaScript throws: an escape is incomplete or isn't UTF-8.
pub fn decode_uri(text: &[u8], preserved: &[u8]) -> Option<Vec<u8>> {
    let byte_at = |at: usize| match text.get(at..at + 3) {
        Some(&[b'%', high, low]) => bun_core::fmt::hex_pair_value(high, low),
        _ => None,
    };
    let mut decoded = Vec::with_capacity(text.len());
    let mut at = 0;
    while let Some(&byte) = text.get(at) {
        if byte != b'%' {
            decoded.push(byte);
            at += 1;
            continue;
        }
        let first = byte_at(at)?;
        let len = match first {
            0..0x80 => 1,
            0xC0..0xE0 => 2,
            0xE0..0xF0 => 3,
            0xF0..0xF8 => 4,
            _ => return None,
        };
        let bytes: Vec<u8> = (0..len)
            .map(|i| byte_at(at + 3 * i))
            .collect::<Option<_>>()?;
        if std::str::from_utf8(&bytes).is_err() {
            return None;
        }
        match strings::contains_char(preserved, first) {
            true => decoded.extend_from_slice(&text[at..at + 3]),
            false => decoded.extend_from_slice(&bytes),
        }
        at += 3 * len;
    }
    Some(decoded)
}

/// `String(n)`
#[inline]
pub fn number_to_string(n: f64) -> Vec<u8> {
    bun_sema::atom::number_to_string(n)
}

/// True if `text` is an `IdentifierName` without escapes. Reserved words count.
pub fn is_identifier_name(text: &[u8]) -> bool {
    let mut points = strings::wtf8_codepoints(text).map(|it| it.1);
    points
        .next()
        .is_some_and(bun_core::lexer::is_identifier_start)
        && points.all(|c| is_type_script_identifier_part(c as i32))
}

/// `String.fromCodePoint(...values)`, also `String.fromCharCode(...values)`: a lead surrogate followed by a trail
/// surrogate becomes one character.
pub fn string_from_code_points(values: impl IntoIterator<Item = u32>) -> Vec<u8> {
    let mut text = Vec::new();
    for value in values {
        strings::push_codepoint_wtf8_joined(&mut text, value);
    }
    text
}

/// The npm package `natural-compare`, which `sort-keys` and `member-ordering` sort with. It's like
/// [`strings::order_utf16`], but a run of digits compares as a number, and ASCII is ordered punctuation, digits, upper
/// case, lower case.
pub fn natural_compare(a: &[u8], b: &[u8]) -> Ordering {
    /// The code unit `code`'s position in the order.
    fn rank(code: u32) -> u32 {
        match code {
            code @ (..45 | 128..) => code,
            45 => 65,
            code @ ..48 => code - 1,
            code @ ..58 => code + 18,
            code @ ..65 => code - 11,
            code @ ..91 => code + 11,
            code @ ..97 => code - 37,
            code @ ..123 => code + 5,
            code => code - 63,
        }
    }
    fn code_at<T: Copy + Into<u32>>(text: &[T], at: usize) -> u32 {
        rank(text.get(at).map_or(0, |&c| c.into()))
    }
    /// The number that starts at `start`, and where it ends.
    fn number_at<T: Copy + Into<u32>>(text: &[T], start: usize) -> (f64, usize) {
        let mut end = start;
        while let 66..76 = code_at(text, end) {
            end += 1;
        }
        let digits = text[start..end].iter().map(|&c| {
            let code: u32 = c.into();
            code as u8
        });
        let value = match end - start {
            ..=15 => digits.fold(0u64, |value, digit| value * 10 + u64::from(digit - b'0')) as f64,
            _ => bun_core::fmt::parse_f64(&digits.collect::<Vec<u8>>()).unwrap_or(f64::INFINITY),
        };
        (value, end)
    }
    fn compare_units<T: Copy + Into<u32>>(a: &[T], b: &[T]) -> Ordering {
        let (mut at_a, mut at_b) = (0, 0);
        loop {
            let (code_a, code_b) = (code_at(a, at_a), code_at(b, at_b));
            let is_number = |code| (67..76).contains(&code);
            if is_number(code_a) && is_number(code_b) {
                let ((value_a, end_a), (value_b, end_b)) = (number_at(a, at_a), number_at(b, at_b));
                if value_a != value_b {
                    return value_a.total_cmp(&value_b);
                }
                (at_a, at_b) = (end_a, end_b);
                continue;
            }
            if code_a != code_b {
                return code_a.cmp(&code_b);
            }
            if code_b == 0 {
                return Ordering::Equal;
            }
            at_a += 1;
            at_b += 1;
        }
    }
    if a == b {
        return Ordering::Equal;
    }
    if strings::first_non_ascii(a).is_none() && strings::first_non_ascii(b).is_none() {
        return compare_units(a, b);
    }
    compare_units(&strings::wtf8_to_utf16(a), &strings::wtf8_to_utf16(b))
}

/// The npm package `natural-orderby`'s `compare()` on two strings. Unlike [`natural_compare`] it lower-cases, parses
/// numbers and dates, and orders text outside ASCII as `localeCompare` does.
pub fn natural_orderby(a: &[u8], b: &[u8]) -> Ordering {
    natural_orderby::compare(a, b, strings::locale_compare)
}

/// [`natural_orderby`] as `compare({ locale })` makes it: text with a character outside ASCII is ordered by
/// `collator`, `localeCompare(other, locale)`.
pub fn natural_orderby_in(collator: strings::Collator, a: &[u8], b: &[u8]) -> Ordering {
    natural_orderby::compare(a, b, |a, b| collator.compare(a, b))
}

/// [`natural_orderby`] for a `locale` that `localeCompare` throws a `RangeError` for: `None` where that call is
/// reached, `Some` of the order everywhere else.
pub fn natural_orderby_without_locale(a: &[u8], b: &[u8]) -> Option<Ordering> {
    let reached_locale = std::cell::Cell::new(false);
    let order = natural_orderby::compare(a, b, |_, _| {
        reached_locale.set(true);
        Ordering::Equal
    });
    (!reached_locale.get()).then_some(order)
}

mod natural_orderby {
    use super::{number_to_string, to_lower_case};
    use bun_core::fmt::js_string_to_number;
    use bun_core::strings;
    use smallvec::SmallVec;
    use std::borrow::Cow;
    use std::cmp::Ordering;

    /// One piece of a text: a run of digits (or the leading number) or the text between two.
    struct Chunk<'a> {
        /// Whitespace collapsed to one space and trimmed.
        text: Cow<'a, [u8]>,
        number: Option<f64>,
    }

    pub(super) fn compare(
        a: &[u8],
        b: &[u8],
        locale_compare: impl Fn(&[u8], &[u8]) -> Ordering,
    ) -> Ordering {
        if a == b {
            return Ordering::Equal;
        }
        let (a, b) = (stringify(a), stringify(b));
        let (number_a, number_b) = (numberify(&a), numberify(&b));
        if let (Some(number_a), Some(number_b)) = (number_a, number_b) {
            return compare_numbers(number_a, number_b);
        }
        // `createChunkMaps(parsedNumber ? `${parsedNumber}` : stringValue)`
        let printed_a = number_a.filter(|n| *n != 0.0).map(number_to_string);
        let printed_b = number_b.filter(|n| *n != 0.0).map(number_to_string);
        let chunks_a = chunks_of(printed_a.as_deref().unwrap_or(&a));
        let chunks_b = chunks_of(printed_b.as_deref().unwrap_or(&b));
        compare_chunks(&chunks_a, &chunks_b, locale_compare)
    }

    /// `value.toLowerCase().replace(/^\s+|\s+$/g, "")`
    fn stringify(text: &[u8]) -> Cow<'_, [u8]> {
        match to_lower_case(text) {
            Cow::Borrowed(lower) => Cow::Borrowed(strings::trim_js_whitespace(lower)),
            Cow::Owned(lower) => Cow::Owned(strings::trim_js_whitespace(&lower).to_vec()),
        }
    }

    /// `Number(value.replace(/_/g, ""))`, then `Date.parse(value)` for a text that looks like a date.
    fn numberify(text: &[u8]) -> Option<f64> {
        parse_number(text).or_else(|| parse_date(text))
    }

    fn parse_number(text: &[u8]) -> Option<f64> {
        if text.is_empty() {
            return None;
        }
        let number = if strings::contains_char(text, b'_') {
            let without: Vec<u8> = text.iter().copied().filter(|&c| c != b'_').collect();
            js_string_to_number(&without)
        } else {
            js_string_to_number(text)
        };
        (!number.is_nan()).then_some(number)
    }

    /// `parseDate`: `Date.parse(value)` for a text that `RE_DATE` takes for a date.
    fn parse_date(text: &[u8]) -> Option<f64> {
        if !looks_like_date(text) {
            return None;
        }
        bun_core::wtf::parse_date(text).ok()
    }

    fn looks_like_date(text: &[u8]) -> bool {
        let is_word = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
        let digits = |from: usize| {
            text.get(from..).map_or(0, |rest| {
                rest.iter().take_while(|c| c.is_ascii_digit()).count()
            })
        };
        let words = |from: usize| {
            text.get(from..)
                .map_or(0, |rest| rest.iter().take_while(|&&c| is_word(c)).count())
        };
        // `^\d{1,4}[/-]\d{1,4}[/-]\d{1,4}`
        let mut at = 0;
        let mut numeric = true;
        for part in 0..3 {
            let count = digits(at);
            if !(1..=4).contains(&count) {
                numeric = false;
                break;
            }
            at += count;
            if part < 2 {
                if !matches!(text.get(at), Some(b'/' | b'-')) {
                    numeric = false;
                    break;
                }
                at += 1;
            }
        }
        if numeric {
            return true;
        }
        // `^\w+, \w+ \d+, \d{4}`
        let first = words(0);
        if first > 0 && text.get(first..first + 2) == Some(b", ") {
            let second = words(first + 2);
            let mut at = first + 2 + second;
            if second > 0 && text.get(at) == Some(&b' ') {
                at += 1;
                let day = digits(at);
                at += day;
                if day > 0 && text.get(at..at + 2) == Some(b", ") && digits(at + 2) >= 4 {
                    return true;
                }
            }
        }
        // `^([\w ]+,?[\w ]+)?[\w ]+,?[\w ]+\d+:\d+(:\d+)?[\w ]?`: words and spaces with up to two commas in
        // them, ending in digits, then `:` and a digit.
        let mut commas = 0;
        let mut run = 0;
        while let Some(&c) = text.get(run) {
            if c == b',' {
                commas += 1;
                if commas > 2 || run == 0 || text.get(run - 1) == Some(&b',') {
                    return false;
                }
            } else if !is_word(c) && c != b' ' {
                break;
            }
            run += 1;
        }
        run >= 3
            && text.get(run) == Some(&b':')
            && text.get(run - 1).is_some_and(u8::is_ascii_digit)
            && text.get(run + 1).is_some_and(u8::is_ascii_digit)
    }

    fn compare_numbers(a: f64, b: f64) -> Ordering {
        a.partial_cmp(&b).unwrap_or(Ordering::Equal)
    }

    fn chunks_of(text: &[u8]) -> SmallVec<[Chunk<'_>; 4]> {
        let pieces = split(text);
        let mut chunks = SmallVec::with_capacity(pieces.len());
        for (index, piece) in pieces.iter().enumerate() {
            let previous = index.checked_sub(1).and_then(|i| pieces.get(i)).copied();
            chunks.push(Chunk {
                text: normalize(piece),
                number: numeric_chunk(piece, previous),
            });
        }
        chunks
    }

    /// `value.replace(RE_NUMBERS, "\0$1\0").replace(/\0$/, "").replace(/^\0/, "").split("\0")`
    fn split(text: &[u8]) -> SmallVec<[&[u8]; 4]> {
        let mut pieces = SmallVec::new();
        let mut start = 0;
        let mut at = 0;
        if let Some(end) = leading_number(text) {
            pieces.push(&text[..end]);
            start = end;
            at = end;
        }
        while at < text.len() {
            if text[at].is_ascii_digit() {
                let mut end = at + 1;
                while text.get(end).is_some_and(u8::is_ascii_digit) {
                    end += 1;
                }
                if at > start || !pieces.is_empty() {
                    pieces.push(&text[start..at]);
                }
                pieces.push(&text[at..end]);
                start = end;
                at = end;
            } else {
                at += 1;
            }
        }
        if start < text.len() {
            pieces.push(&text[start..]);
        }
        pieces
    }

    /// The end of a match of `^0x[\da-fA-F]+$` or `^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?!\.\d+)(?=\D|\s|$)`
    /// at the start of `text`, which is lower case.
    fn leading_number(text: &[u8]) -> Option<usize> {
        if let Some(hex) = text.strip_prefix(b"0x")
            && !hex.is_empty()
            && hex.iter().all(u8::is_ascii_hexdigit)
        {
            return Some(text.len());
        }
        let digits = |from: usize| {
            text.get(from..).map_or(0, |rest| {
                rest.iter().take_while(|c| c.is_ascii_digit()).count()
            })
        };
        let mut at = usize::from(matches!(text.first(), Some(b'+' | b'-')));
        let integer = digits(at);
        at += integer;
        if text.get(at) == Some(&b'.')
            && (integer > 0 || text.get(at + 1).is_some_and(u8::is_ascii_digit))
        {
            at += 1 + digits(at + 1);
        } else if integer == 0 {
            return None;
        }
        let mantissa = at;
        if text.get(at) == Some(&b'e') {
            let sign = usize::from(matches!(text.get(at + 1), Some(b'+' | b'-')));
            let exponent = digits(at + 1 + sign);
            if exponent > 0 {
                at += 1 + sign + exponent;
            }
        }
        let allowed = |end: usize| {
            let next = text.get(end);
            let fraction_follows =
                next == Some(&b'.') && text.get(end + 1).is_some_and(u8::is_ascii_digit);
            !fraction_follows && !next.is_some_and(u8::is_ascii_digit)
        };
        if allowed(at) {
            Some(at)
        } else if at != mantissa && allowed(mantissa) {
            Some(mantissa)
        } else {
            None
        }
    }

    /// `normalizeNumericChunk`: the number a chunk is, unless it is the fraction after a `.`.
    fn numeric_chunk(chunk: &[u8], previous: Option<&[u8]>) -> Option<f64> {
        if !is_int_or_float(chunk) {
            return None;
        }
        // `/^0+[1-9]{1}[0-9]*$/`
        let leading_zero = chunk.first() == Some(&b'0')
            && chunk.iter().all(u8::is_ascii_digit)
            && chunk.iter().any(|c| (b'1'..=b'9').contains(c));
        if leading_zero && previous == Some(b".") {
            return None;
        }
        Some(parse_number(chunk).unwrap_or(0.0))
    }

    /// `/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/`
    fn is_int_or_float(text: &[u8]) -> bool {
        let digits = |from: usize| {
            text.get(from..).map_or(0, |rest| {
                rest.iter().take_while(|c| c.is_ascii_digit()).count()
            })
        };
        let mut at = usize::from(matches!(text.first(), Some(b'+' | b'-')));
        let integer = digits(at);
        at += integer;
        if text.get(at) == Some(&b'.') {
            let fraction = digits(at + 1);
            if integer == 0 && fraction == 0 {
                return false;
            }
            at += 1 + fraction;
        } else if integer == 0 {
            return false;
        }
        if let Some(b'e' | b'E') = text.get(at) {
            let sign = usize::from(matches!(text.get(at + 1), Some(b'+' | b'-')));
            let exponent = digits(at + 1 + sign);
            if exponent == 0 {
                return false;
            }
            at += 1 + sign + exponent;
        }
        at == text.len()
    }

    /// `chunk.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "")`
    fn normalize(chunk: &[u8]) -> Cow<'_, [u8]> {
        let trimmed = strings::trim_js_whitespace(chunk);
        let mut at = 0;
        while at < trimmed.len() {
            let space = strings::js_whitespace_len(&trimmed[at..]);
            if space == 0 {
                at += 1;
                continue;
            }
            let mut out = trimmed[..at].to_vec();
            while at < trimmed.len() {
                let space = strings::js_whitespace_len(&trimmed[at..]);
                if space > 0 {
                    out.push(b' ');
                    at += space;
                } else {
                    out.push(trimmed[at]);
                    at += 1;
                }
            }
            return Cow::Owned(out);
        }
        Cow::Borrowed(trimmed)
    }

    fn compare_chunks(
        a: &[Chunk<'_>],
        b: &[Chunk<'_>],
        locale_compare: impl Fn(&[u8], &[u8]) -> Ordering,
    ) -> Ordering {
        for (chunk_a, chunk_b) in a.iter().zip(b) {
            if chunk_a.text == chunk_b.text {
                continue;
            }
            if chunk_a.text.is_empty() != chunk_b.text.is_empty() {
                return if chunk_a.text.is_empty() {
                    Ordering::Less
                } else {
                    Ordering::Greater
                };
            }
            return match (chunk_a.number, chunk_b.number) {
                (Some(number_a), Some(number_b)) => compare_numbers(number_a, number_b)
                    .then_with(|| strings::order_utf16(&chunk_a.text, &chunk_b.text)),
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                (None, None) => {
                    if strings::first_non_ascii(&chunk_a.text).is_some()
                        || strings::first_non_ascii(&chunk_b.text).is_some()
                    {
                        locale_compare(&chunk_a.text, &chunk_b.text)
                    } else {
                        strings::order_utf16(&chunk_a.text, &chunk_b.text)
                    }
                }
            };
        }
        a.len().cmp(&b.len())
    }
}

/// `esutils.keyword.isKeywordES6(name, false)`, or `null`, `true` or `false`.
fn is_reserved_word_es6(name: &[u8]) -> bool {
    matches!(
        name,
        b"if"
            | b"in"
            | b"do"
            | b"var"
            | b"for"
            | b"new"
            | b"try"
            | b"this"
            | b"else"
            | b"case"
            | b"void"
            | b"with"
            | b"enum"
            | b"while"
            | b"break"
            | b"catch"
            | b"throw"
            | b"const"
            | b"yield"
            | b"class"
            | b"super"
            | b"return"
            | b"typeof"
            | b"delete"
            | b"switch"
            | b"export"
            | b"import"
            | b"default"
            | b"finally"
            | b"extends"
            | b"function"
            | b"continue"
            | b"debugger"
            | b"instanceof"
            | b"null"
            | b"true"
            | b"false"
    )
}

/// `esutils.keyword.isIdentifierES6(name)`: an identifier that isn't a reserved word outside strict mode.
pub fn is_identifier_es6(name: &[u8]) -> bool {
    is_identifier_name(name) && !is_reserved_word_es6(name)
}

/// `esutils.keyword.isIdentifierES5(name)`: the same, but `yield` is an identifier, and it rejects characters outside
/// the BMP and characters that are only letters because of `Other_ID_Start` or `Other_ID_Continue`, because ES5 uses
/// general categories.
pub fn is_identifier_es5(name: &[u8]) -> bool {
    is_identifier_name(name)
        && (name == b"yield" || !is_reserved_word_es6(name))
        && strings::wtf8_codepoints(name).all(|(at, c)| match c {
            0x1885 | 0x1886 => at != 0,
            0x2118 | 0x212E | 0x309B | 0x309C | 0xB7 | 0x387 | 0x1369..=0x1371 | 0x19DA => false,
            _ => c <= 0xFFFF,
        })
}
