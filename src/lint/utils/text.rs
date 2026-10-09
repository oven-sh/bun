//! The operations of JavaScript strings, on UTF-8 text.
//!
//! | JavaScript | here |
//! | --- | --- |
//! | `s.length` | [`utf16_len`] |
//! | `[...s]`, `s.codePointAt(i)` | [`code_points`] |
//! | `[...s].length` | [`code_point_count`] |
//! | `/\s/u.test(c)` | [`is_js_whitespace`] |
//! | `/^\s/u.exec(s)?.[0].length` in bytes | [`white_space_len`] |
//! | `s.trim()`, `trimStart()`, `trimEnd()` | [`trim`], [`trim_start`], [`trim_end`] |
//! | `s.replace(/^abc/iu, "")`, `/^\w/iu.test(s)`, `/\w$/iu.test(s)` | [`strip_prefix_ignoring_case`], [`starts_with_word_ignoring_case`], [`ends_with_word_ignoring_case`] |
//! | `s.toLowerCase()`, `s.toUpperCase()` | [`to_lower_case`], [`to_upper_case`] |
//! | `s[0].toUpperCase() + s.slice(1)` | [`upper_case_first`] |
//! | `String(n)` | [`number_to_string`] |
//! | `Number(s)` | [`string_to_number`] |
//! | `JSON.stringify(s)` | [`json_stringify`] |
//! | `s.toWellFormed()` | [`to_well_formed`] |
//! | `String.fromCodePoint(...values)`, `String.fromCharCode(...values)` | [`string_from_code_points`], [`push_code_point`] |
//! | `a < b`, `a.localeCompare`-free sorting | [`compare`] |
//! | `require("natural-compare")` | [`natural_compare`] |
//! | `esutils.keyword.isIdentifierES5`, `isIdentifierES6` | [`is_identifier_es5`], [`is_identifier_es6`] |
//! | `s.split(/\r\n\|[\r\n\u2028\u2029]/u)` | [`lines`] |
//! | `s.slice(a, b)` with UTF-16 indices | [`utf16_slice`], [`utf16_offset_to_byte`] |

use bun_core::lexer::char_and_size;
use bun_core::strings;
use std::borrow::Cow;
use std::cmp::Ordering;

/// `text.length`
pub fn utf16_len(text: &[u8]) -> u32 {
    match strings::first_non_ascii(text) {
        None => text.len() as u32,
        Some(_) => code_points(text).map(|it| utf16_width(it.1)).sum(),
    }
}

/// The code points of `text`, each with the offset in bytes where it starts. A byte that is not
/// part of valid UTF-8 is U+FFFD. Half of a surrogate pair, which the value of a string literal
/// such as `"\uD800"` has as three bytes, is itself.
#[inline]
pub fn code_points(text: &[u8]) -> CodePoints<'_> {
    CodePoints { text, at: 0 }
}

/// The code point that starts at `at`, and its length in bytes, which is 0 at the end of `text`. See
/// [`code_points`].
#[inline]
pub fn code_point_at(text: &[u8], at: usize) -> (u32, usize) {
    match text.get(at..) {
        Some(&[0xED, b @ 0xA0..=0xBF, c @ 0x80..=0xBF, ..]) => {
            (0xD000 | u32::from(b & 0x3F) << 6 | u32::from(c & 0x3F), 3)
        }
        _ => {
            let (c, size) = char_and_size(text, at);
            (c as u32, size)
        }
    }
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
        let at = self.at;
        let (c, size) = code_point_at(self.text, at);
        if size == 0 {
            return None;
        }
        self.at += size;
        Some((at, c))
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

/// The length in bytes of the character that `text` starts with, if `\s` matches it, and 0 if not.
#[inline]
pub fn white_space_len(text: &[u8]) -> usize {
    match *text {
        [0x09..=0x0D | b' ', ..] => 1,
        [0xC2, 0xA0, ..] => 2,
        // U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF
        [0xE1, 0x9A, 0x80, ..]
        | [0xE2, 0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF, ..]
        | [0xE2, 0x81, 0x9F, ..]
        | [0xE3, 0x80, 0x80, ..]
        | [0xEF, 0xBB, 0xBF, ..] => 3,
        _ => 0,
    }
}

/// `text.trimStart()`
#[inline]
pub fn trim_start(mut text: &[u8]) -> &[u8] {
    while let len @ 1.. = white_space_len(text) {
        text = &text[len..];
    }
    text
}

/// `text.trimEnd()`
#[inline]
pub fn trim_end(mut text: &[u8]) -> &[u8] {
    loop {
        text = match *text {
            [ref rest @ .., 0x09..=0x0D | b' '] => rest,
            [.., 0..0x80] | [] => return text,
            [ref rest @ .., 0xC2, 0xA0] => rest,
            [ref rest @ .., a, b, c] if white_space_len(&[a, b, c]) == 3 => rest,
            _ => return text,
        };
    }
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

/// What follows `prefix` in `text`, if `/^prefix/iu` matches. `prefix`: characters of ASCII, no capitals.
///
/// With these flags U+017F is an `s` and U+212A a `k`, and both are a `\w`. No other character outside ASCII is one of ASCII but
/// for its case.
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

/// The byte that the character outside ASCII starts with that is `c` but for its case, and `c` if there is none.
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
    let special = if escapes_hyphen {
        SPECIAL
    } else {
        &SPECIAL[..SPECIAL.len() - 1]
    };
    let Some(first) = strings::index_of_any(text, special) else {
        return Cow::Borrowed(text);
    };
    let mut out = Vec::with_capacity(text.len() + 8);
    out.extend_from_slice(&text[..first]);
    for &c in &text[first..] {
        match c {
            b'-' if escapes_hyphen => out.extend_from_slice(b"\\x2d"),
            c if c != b'-' && strings::contains_char(special, c) => {
                out.extend_from_slice(&[b'\\', c])
            }
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
        return if text[0] == b'-' {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    // `StrUnsignedDecimalLiteral`
    let digits = |from: usize| {
        unsigned[from..]
            .iter()
            .take_while(|c| c.is_ascii_digit())
            .count()
    };
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
    // `ID_Continue` since Unicode 15.1.
    bun_core::lexer::is_identifier_part(c) || matches!(c, 0x30FB | 0xFF65)
}

/// Whether `text` is an `IdentifierName` without escapes. Reserved words are.
pub fn is_identifier_name(text: &[u8]) -> bool {
    let mut points = code_points(text).map(|it| it.1);
    points.next().is_some_and(is_identifier_start) && points.all(is_identifier_part)
}

/// `JSON.stringify(text)`
pub fn json_stringify(text: &[u8]) -> Vec<u8> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = Vec::with_capacity(text.len() + 2);
    out.push(b'"');
    let mut at = 0;
    while let Some(&c) = text.get(at) {
        at += 1;
        match c {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0x08 => out.extend_from_slice(b"\\b"),
            0x0C => out.extend_from_slice(b"\\f"),
            0..0x20 => {
                out.extend_from_slice(b"\\u00");
                out.push(HEX[usize::from(c >> 4)]);
                out.push(HEX[usize::from(c & 15)]);
            }
            // Half of a surrogate pair.
            0xED if matches!(code_point_at(text, at - 1), (0xD800..=0xDFFF, 3)) => {
                let half = code_point_at(text, at - 1).0;
                out.extend_from_slice(b"\\u");
                out.extend(
                    (0..4)
                        .rev()
                        .map(|digit| HEX[(half >> (4 * digit) & 15) as usize]),
                );
                at += 2;
            }
            c => out.push(c),
        }
    }
    out.push(b'"');
    out
}

/// `text.toWellFormed()`: half of a surrogate pair, which is three bytes here, is U+FFFD. That is also
/// what is printed for it.
pub fn to_well_formed(text: &[u8]) -> Cow<'_, [u8]> {
    let is_half = |at: usize| matches!(code_point_at(text, at), (0xD800..=0xDFFF, 3));
    let mut candidates = strings::index_of_char_usize(text, 0xED);
    let (mut out, mut written) = (Vec::new(), 0);
    while let Some(at) = candidates {
        let mut next = at + 1;
        if is_half(at) {
            out.extend_from_slice(&text[written..at]);
            out.extend_from_slice("\u{FFFD}".as_bytes());
            next = at + 3;
            written = next;
        }
        candidates = strings::index_of_char_usize(&text[next..], 0xED).map(|found| next + found);
    }
    if written == 0 {
        return Cow::Borrowed(text);
    }
    out.extend_from_slice(&text[written..]);
    Cow::Owned(out)
}

/// Appends the code point `c` to `text`. Half of a surrogate pair is the three bytes that its code
/// point would have, as in the value of a string literal.
pub fn push_code_point(text: &mut Vec<u8>, c: u32) {
    match char::from_u32(c) {
        Some(c) => text.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes()),
        None => text.extend_from_slice(&[
            0xE0 | ((c >> 12) & 0x0F) as u8,
            0x80 | ((c >> 6) & 0x3F) as u8,
            0x80 | (c & 0x3F) as u8,
        ]),
    }
}

/// `String.fromCodePoint(...values)`, also `String.fromCharCode(...values)`: a lead and a trail
/// surrogate in a row are one character.
pub fn string_from_code_points(values: impl IntoIterator<Item = u32>) -> Vec<u8> {
    let mut text = Vec::new();
    let mut lead: Option<u32> = None;
    for value in values {
        match (lead.take(), value) {
            (Some(lead), 0xDC00..=0xDFFF) => {
                push_code_point(
                    &mut text,
                    0x10000 + ((lead - 0xD800) << 10) + (value - 0xDC00),
                );
            }
            (alone, _) => {
                if let Some(alone) = alone {
                    push_code_point(&mut text, alone);
                }
                match value {
                    0xD800..=0xDBFF => lead = Some(value),
                    _ => push_code_point(&mut text, value),
                }
            }
        }
    }
    if let Some(alone) = lead {
        push_code_point(&mut text, alone);
    }
    text
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
    /// Where the code unit `code` is in the order.
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

/// `esutils.keyword.isIdentifierES6(name)`: an identifier that is not a reserved word outside of
/// strict mode.
pub fn is_identifier_es6(name: &[u8]) -> bool {
    is_identifier_name(name) && !is_reserved_word_es6(name)
}

/// `esutils.keyword.isIdentifierES5(name)`: the same, but `yield` is an identifier, characters
/// outside the BMP are not allowed, and neither is what is a letter only by `Other_ID_Start` or
/// `Other_ID_Continue`: ES5 goes by general categories.
pub fn is_identifier_es5(name: &[u8]) -> bool {
    is_identifier_name(name)
        && (name == b"yield" || !is_reserved_word_es6(name))
        && code_points(name).all(|(at, c)| match c {
            0x1885 | 0x1886 => at != 0,
            0x2118 | 0x212E | 0x309B | 0x309C | 0xB7 | 0x387 | 0x1369..=0x1371 | 0x19DA => false,
            _ => c <= 0xFFFF,
        })
}
