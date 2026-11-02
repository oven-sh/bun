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
