//! The operations of JavaScript strings, on UTF-8 text.
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
//! | `s.toWellFormed()` | [`strings::push_wtf8_well_formed`] |
//! | `String.fromCodePoint(...values)`, `String.fromCharCode(...values)` | [`string_from_code_points`], [`strings::push_codepoint_wtf8_joined`] |
//! | `a < b`, `a.localeCompare`-free sorting | [`strings::order_utf16`] |
//! | `require("natural-compare")` | [`natural_compare`] |
//! | `esutils.keyword.isIdentifierES5`, `isIdentifierES6` | [`is_identifier_es5`], [`is_identifier_es6`] |
//! | `s.split(/\r\n\|[\r\n\u2028\u2029]/u)`, `/\r\n\|[\r\n\u2028\u2029]/u.test(s)` | [`strings::js_lines`], [`strings::contains_js_line_break`] |
//! | `s.slice(a, b)` with UTF-16 indices | [`strings::wtf8_slice_by_utf16`], [`strings::wtf8_offset_of_utf16_index`] |

use bun_core::lexer::{char_and_size, is_type_script_identifier_part};
use bun_core::strings;
use std::borrow::Cow;
use std::cmp::Ordering;

/// The last code point of `text`.
pub fn last_code_point(text: &[u8]) -> Option<u32> {
    (!text.is_empty()).then(|| bun_core::lexer::last_char(text).0 as u32)
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

/// Whether `text` ends with `ending`, whatever the case of the ASCII letters.
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

/// Whether `text` is an `IdentifierName` without escapes. Reserved words are.
pub fn is_identifier_name(text: &[u8]) -> bool {
    let mut points = strings::wtf8_codepoints(text).map(|it| it.1);
    points
        .next()
        .is_some_and(bun_core::lexer::is_identifier_start)
        && points.all(|c| is_type_script_identifier_part(c as i32))
}

/// `String.fromCodePoint(...values)`, also `String.fromCharCode(...values)`: a lead and a trail
/// surrogate in a row are one character.
pub fn string_from_code_points(values: impl IntoIterator<Item = u32>) -> Vec<u8> {
    let mut text = Vec::new();
    for value in values {
        strings::push_codepoint_wtf8_joined(&mut text, value);
    }
    text
}

/// The npm package `natural-compare`, which `sort-keys` and `member-ordering` sort by: as
/// [`strings::order_utf16`], but a run of digits counts as the number it is, and the order of ASCII is punctuation,
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
        && strings::wtf8_codepoints(name).all(|(at, c)| match c {
            0x1885 | 0x1886 => at != 0,
            0x2118 | 0x212E | 0x309B | 0x309C | 0xB7 | 0x387 | 0x1369..=0x1371 | 0x19DA => false,
            _ => c <= 0xFFFF,
        })
}
