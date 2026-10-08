//! The operations of JavaScript strings, on UTF-8 text.
//!
//! | JavaScript | here |
//! | --- | --- |
//! | `s.length` | [`utf16_len`] |
//! | `[...s]`, `s.codePointAt(i)` | [`code_points`] |
//! | `[...s].length` | [`code_point_count`] |
//! | `/\s/u.test(c)` | [`is_js_whitespace`] |
//! | `s.trim()`, `trimStart()`, `trimEnd()` | [`trim`], [`trim_start`], [`trim_end`] |
//! | `s.toLowerCase()`, `s.toUpperCase()` | [`to_lower_case`], [`to_upper_case`] |
//! | `s[0].toUpperCase() + s.slice(1)` | [`upper_case_first`] |
//! | `String(n)` | [`number_to_string`] |
//! | `JSON.stringify(s)` | [`json_stringify`] |
//! | `s.split(/\r\n\|[\r\n  ]/u)` | [`lines`] |
//! | `s.slice(a, b)` with UTF-16 indices | [`utf16_slice`], [`utf16_offset_to_byte`] |

use bun_core::lexer::char_and_size;
use bun_core::strings;
use std::borrow::Cow;

pub use crate::source::utf16_len;

/// The code points of `text`, each with the offset in bytes where it starts. A byte that is not
/// part of valid UTF-8 is U+FFFD.
#[inline]
pub fn code_points(text: &[u8]) -> CodePoints<'_> {
    CodePoints { text, at: 0 }
}

#[derive(Copy, Clone)]
pub struct CodePoints<'t> {
    text: &'t [u8],
    at: usize,
}

impl Iterator for CodePoints<'_> {
    type Item = (usize, u32);

    #[inline]
    fn next(&mut self) -> Option<(usize, u32)> {
        let (c, size) = char_and_size(self.text, self.at);
        if size == 0 {
            return None;
        }
        let at = self.at;
        self.at += size;
        Some((at, c as u32))
    }
}

/// `[...text].length`
pub fn code_point_count(text: &[u8]) -> usize {
    match strings::first_non_ascii(text) {
        None => text.len(),
        Some(_) => code_points(text).count(),
    }
}

/// The first code point of `text`.
#[inline]
pub fn first_code_point(text: &[u8]) -> Option<u32> {
    code_points(text).next().map(|it| it.1)
}

/// The last code point of `text`.
pub fn last_code_point(text: &[u8]) -> Option<u32> {
    (!text.is_empty()).then(|| bun_core::lexer::last_char(text).0 as u32)
}

/// The number of UTF-16 code units of the code point `c`.
#[inline]
pub fn utf16_width(c: u32) -> u32 {
    if c > 0xFFFF { 2 } else { 1 }
}

/// The offset in bytes of the UTF-16 index `index` of `text`. An index past the end is the length
/// of `text`, and one in the middle of a surrogate pair is the start of the pair.
pub fn utf16_offset_to_byte(text: &[u8], index: u32) -> usize {
    let mut units = 0;
    for (at, c) in code_points(text) {
        units += utf16_width(c);
        if units > index {
            return at;
        }
    }
    text.len()
}

/// `text.slice(start, end)` for indices that are not negative.
pub fn utf16_slice(text: &[u8], start: u32, end: u32) -> &[u8] {
    let from = utf16_offset_to_byte(text, start);
    let to = utf16_offset_to_byte(text, end).max(from);
    text.get(from..to).unwrap_or_default()
}

/// ECMAScript's `LineTerminator`.
#[inline]
pub fn is_line_terminator(c: u32) -> bool {
    matches!(c, 0x0A | 0x0D | 0x2028 | 0x2029)
}

/// What `\s` matches: ECMAScript's `WhiteSpace` and `LineTerminator`.
#[inline]
pub fn is_js_whitespace(c: u32) -> bool {
    match c {
        0x09..=0x0D | 0x20 => true,
        0..0x80 => false,
        _ => is_line_terminator(c) || bun_core::lexer::is_whitespace(c as i32),
    }
}

/// `text.trimStart()`
pub fn trim_start(text: &[u8]) -> &[u8] {
    let end = bun_core::lexer::end_of_run(text, 0, |c| is_js_whitespace(c as u32));
    text.get(end..).unwrap_or_default()
}

/// `text.trimEnd()`
pub fn trim_end(mut text: &[u8]) -> &[u8] {
    while !text.is_empty() {
        let (c, start) = bun_core::lexer::last_char(text);
        if !is_js_whitespace(c as u32) {
            break;
        }
        text = &text[..start];
    }
    text
}

/// `text.trim()`
#[inline]
pub fn trim(text: &[u8]) -> &[u8] {
    trim_end(trim_start(text))
}

/// `/^\s*$/u.test(text)`
#[inline]
pub fn is_blank(text: &[u8]) -> bool {
    trim_start(text).is_empty()
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
    *to_upper_case(text) == *text
}

/// `text === text.toLowerCase()`
#[inline]
pub fn is_lower_case(text: &[u8]) -> bool {
    *to_lower_case(text) == *text
}

/// ESLint's and typescript-eslint's `upperCaseFirst`: `text[0].toUpperCase() + text.slice(1)`.
pub fn upper_case_first(text: &[u8]) -> Cow<'_, [u8]> {
    let (c, size) = char_and_size(text, 0);
    // `text[0]` of a character outside the BMP is half of a surrogate pair, which has no case.
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

/// typescript-eslint's `escapeRegExp`, and the package `escape-string-regexp` that ESLint uses:
/// puts a backslash before each of `\ ^ $ . * + ? ( ) [ ] { } |`. With `escapes_hyphen`, `-` becomes
/// `\x2d`, as in `escape-string-regexp`.
pub fn escape_reg_exp_with(text: &[u8], escapes_hyphen: bool) -> Cow<'_, [u8]> {
    const SPECIAL: &[u8] = b"\\^$.*+?()[]{}|-";
    let special = if escapes_hyphen { SPECIAL } else { &SPECIAL[..SPECIAL.len() - 1] };
    let Some(first) = strings::index_of_any(text, special) else {
        return Cow::Borrowed(text);
    };
    let mut out = Vec::with_capacity(text.len() + 8);
    out.extend_from_slice(&text[..first]);
    for &c in &text[first..] {
        match c {
            b'-' if escapes_hyphen => out.extend_from_slice(b"\\x2d"),
            c if c != b'-' && strings::contains_char(special, c) => out.extend_from_slice(&[b'\\', c]),
            c => out.push(c),
        }
    }
    Cow::Owned(out)
}

/// typescript-eslint's `escapeRegExp`.
#[inline]
pub fn escape_reg_exp(text: &[u8]) -> Cow<'_, [u8]> {
    escape_reg_exp_with(text, false)
}

/// The package `escape-string-regexp`, which ESLint's rules call `escapeRegExp`.
#[inline]
pub fn escape_string_regexp(text: &[u8]) -> Cow<'_, [u8]> {
    escape_reg_exp_with(text, true)
}

/// `String(n)`
#[inline]
pub fn number_to_string(n: f64) -> Vec<u8> {
    bun_sema::atom::number_to_string(n)
}

/// ECMAScript's `IdentifierStart`, without escapes.
#[inline]
pub fn is_identifier_start(c: u32) -> bool {
    bun_core::lexer::is_identifier_start(c)
}

/// ECMAScript's `IdentifierPart`, without escapes.
#[inline]
pub fn is_identifier_part(c: u32) -> bool {
    bun_core::lexer::is_identifier_part(c)
}

/// Whether `text` is an `IdentifierName` without escapes. Reserved words are.
pub fn is_identifier_name(text: &[u8]) -> bool {
    let mut points = code_points(text).map(|it| it.1);
    points.next().is_some_and(is_identifier_start) && points.all(is_identifier_part)
}

/// `JSON.stringify(text)`
pub fn json_stringify(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + 2);
    out.push(b'"');
    for &c in text {
        match c {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0x08 => out.extend_from_slice(b"\\b"),
            0x0C => out.extend_from_slice(b"\\f"),
            0..0x20 => {
                const HEX: &[u8; 16] = b"0123456789abcdef";
                out.extend_from_slice(b"\\u00");
                out.push(HEX[usize::from(c >> 4)]);
                out.push(HEX[usize::from(c & 15)]);
            }
            c => out.push(c),
        }
    }
    out.push(b'"');
    out
}

/// The length in bytes of the line break that `text` starts with: `\r\n`, `\r`, `\n`, U+2028 or
/// U+2029. 0 if it starts with none.
#[inline]
pub fn line_break_len(text: &[u8]) -> usize {
    match text {
        [b'\r', b'\n', ..] => 2,
        [b'\r' | b'\n', ..] => 1,
        [0xE2, 0x80, 0xA8 | 0xA9, ..] => 3,
        _ => 0,
    }
}

/// Where the first line break of `text` starts, and its length in bytes.
pub fn find_line_break(text: &[u8]) -> Option<(usize, usize)> {
    let mut from = 0;
    loop {
        let at = from + strings::index_of_any(text.get(from..)?, b"\r\n\xE2")?;
        match line_break_len(&text[at..]) {
            0 => from = at + 1,
            len => return Some((at, len)),
        }
    }
}

/// `/\r\n|[\r\n  ]/u.test(text)`
#[inline]
pub fn has_line_break(text: &[u8]) -> bool {
    find_line_break(text).is_some()
}

/// `text.split(/\r\n|[\r\n  ]/u)`: the lines without their line breaks. There is always
/// at least one.
#[inline]
pub fn lines(text: &[u8]) -> Lines<'_> {
    Lines { rest: Some(text) }
}

#[derive(Copy, Clone)]
pub struct Lines<'t> {
    rest: Option<&'t [u8]>,
}

impl<'t> Iterator for Lines<'t> {
    type Item = &'t [u8];

    fn next(&mut self) -> Option<&'t [u8]> {
        let rest = self.rest?;
        match find_line_break(rest) {
            Some((at, len)) => {
                self.rest = Some(&rest[at + len..]);
                Some(&rest[..at])
            }
            None => {
                self.rest = None;
                Some(rest)
            }
        }
    }
}
