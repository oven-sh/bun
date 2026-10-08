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
//! | `Number(s)` | [`string_to_number`] |
//! | `JSON.stringify(s)` | [`json_stringify`] |
//! | `a < b`, `a.localeCompare`-free sorting | [`compare`] |
//! | `require("natural-compare")` | [`natural_compare`] |
//! | `esutils.keyword.isIdentifierES5`, `isIdentifierES6` | [`is_identifier_es5`], [`is_identifier_es6`] |
//! | `s.split(/\r\n\|[\r\n\u2028\u2029]/u)` | [`lines`] |
//! | `s.slice(a, b)` with UTF-16 indices | [`utf16_slice`], [`utf16_offset_to_byte`] |

use bun_core::lexer::char_and_size;
use bun_core::strings;
use std::borrow::Cow;
use std::cmp::Ordering;

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

/// `Number(text)`: ECMAScript's `StringToNumber`. NaN if `text` is not a number.
pub fn string_to_number(text: &[u8]) -> f64 {
    let text = trim(text);
    if text.is_empty() {
        return 0.0;
    }
    if let [b'0', prefix, digits @ ..] = text
        && let Some(radix) = match prefix {
            b'x' | b'X' => Some(16u32),
            b'o' | b'O' => Some(8),
            b'b' | b'B' => Some(2),
            _ => None,
        }
    {
        let value = digits.iter().try_fold(0f64, |value, &c| {
            Some(value * f64::from(radix) + f64::from(char::from(c).to_digit(radix)?))
        });
        return value.filter(|_| !digits.is_empty()).unwrap_or(f64::NAN);
    }
    let unsigned = match text {
        [b'+' | b'-', rest @ ..] => rest,
        _ => text,
    };
    if unsigned == b"Infinity" {
        return if text[0] == b'-' { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    // `StrUnsignedDecimalLiteral`
    let digits = |from: usize| unsigned[from..].iter().take_while(|c| c.is_ascii_digit()).count();
    let whole = digits(0);
    let mut at = whole;
    let mut fraction = 0;
    if unsigned.get(at) == Some(&b'.') {
        fraction = digits(at + 1);
        at += 1 + fraction;
    }
    if whole + fraction == 0 {
        return f64::NAN;
    }
    if let Some(b'e' | b'E') = unsigned.get(at) {
        let sign = usize::from(matches!(unsigned.get(at + 1), Some(b'+' | b'-')));
        match digits(at + 1 + sign) {
            0 => return f64::NAN,
            exponent => at += 1 + sign + exponent,
        }
    }
    match at == unsigned.len() {
        true => bun_core::fmt::parse_f64(text).unwrap_or(f64::NAN),
        false => f64::NAN,
    }
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

/// `/\r\n|[\r\n\u2028\u2029]/u.test(text)`
#[inline]
pub fn has_line_break(text: &[u8]) -> bool {
    find_line_break(text).is_some()
}

/// `text.split(/\r\n|[\r\n\u2028\u2029]/u)`: the lines without their line breaks. There is always
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

/// `a < b`, `a === b` or `a > b` for strings: the order of UTF-16 code units, which is not that of
/// the bytes where a character outside the BMP meets one from U+E000.
pub fn compare(a: &[u8], b: &[u8]) -> Ordering {
    let common = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    match (a.get(common), b.get(common)) {
        (Some(0xF0..), Some(0xEE | 0xEF)) => Ordering::Less,
        (Some(0xEE | 0xEF), Some(0xF0..)) => Ordering::Greater,
        (x, y) => x.cmp(&y),
    }
}

/// The npm package `natural-compare`, which `sort-keys` and `member-ordering` sort by: as
/// [`compare`], but a run of digits counts as the number it is, and the order of ASCII is punctuation,
/// digits, upper case, lower case.
pub fn natural_compare(a: &[u8], b: &[u8]) -> Ordering {
    fn code_at<T: Copy + Into<u32>>(text: &[T], at: usize) -> u32 {
        match text.get(at).map_or(0, |&c| c.into()) {
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
    /// The number that starts at `start`, and where it ends.
    fn number_at<T: Copy + Into<u32>>(text: &[T], start: usize) -> (f64, usize) {
        let (mut value, mut at) = (0.0, start);
        while let code @ 66..76 = code_at(text, at) {
            value = value * 10.0 + f64::from(code - 66);
            at += 1;
        }
        (value, at)
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
    let units = |text: &[u8]| -> Vec<u16> {
        let mut units = Vec::with_capacity(text.len());
        for (_, c) in code_points(text) {
            let c = char::from_u32(c).unwrap_or(char::REPLACEMENT_CHARACTER);
            units.extend_from_slice(c.encode_utf16(&mut [0; 2]));
        }
        units
    };
    compare_units(&units(a), &units(b))
}

/// `esutils.keyword.isKeywordES6(name, false)`, or `null`, `true` or `false`.
fn is_reserved_word_es6(name: &[u8]) -> bool {
    matches!(
        name,
        b"if" | b"in"
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

/// `esutils.keyword.isIdentifierES6(name)`: an identifier that is not a reserved word outside of
/// strict mode.
pub fn is_identifier_es6(name: &[u8]) -> bool {
    is_identifier_name(name) && !is_reserved_word_es6(name)
}

/// `esutils.keyword.isIdentifierES5(name)`: the same, but `yield` is an identifier and characters
/// outside the BMP are not allowed.
pub fn is_identifier_es5(name: &[u8]) -> bool {
    is_identifier_name(name)
        && (name == b"yield" || !is_reserved_word_es6(name))
        && code_points(name).all(|it| it.1 <= 0xFFFF)
}
