//! White space and line breaks, for UTF-8 and WTF-8 bytes, one function for each definition.
//! ECMAScript's: the white space that `\s` matches and `String.prototype.trim` strips, and the line
//! terminators that end a line of a source text. Unicode's: the property `White_Space`, which Rust's
//! `str::trim` goes by. ASCII's is std's: `<[u8]>::trim_ascii`, `u8::is_ascii_whitespace`.

use super::{contains_char, index_of_any, index_of_char_usize, wtf8_codepoints};
use std::borrow::Cow;

/// `text.replace(/\s/g, "")`, for WTF-8.
pub fn without_js_whitespace(text: &[u8]) -> Cow<'_, [u8]> {
    if !text
        .iter()
        .any(|b| matches!(b, 0x09..=0x0D | 0x20 | 0x80..))
    {
        return Cow::Borrowed(text);
    }
    let mut out = Vec::with_capacity(text.len());
    let mut points = wtf8_codepoints(text).peekable();
    while let Some((at, cp)) = points.next() {
        let end = points.peek().map_or(text.len(), |next| next.0);
        if !is_js_whitespace(cp) {
            out.extend_from_slice(&text[at..end]);
        }
    }
    Cow::Owned(out)
}

/// ECMAScript's `LineTerminator`: LF, CR, U+2028 and U+2029.
#[inline]
pub const fn is_js_line_terminator(cp: u32) -> bool {
    matches!(cp, 0x0A | 0x0D | 0x2028 | 0x2029)
}

/// What `\s` matches: ECMAScript's `WhiteSpace` and `LineTerminator`, 25 code points.
/// Rust's `char::is_whitespace` has U+0085 and lacks U+FEFF.
#[inline]
pub fn is_js_whitespace(cp: u32) -> bool {
    match cp {
        0x09..=0x0D | 0x20 => true,
        0..0x80 => false,
        _ => is_js_line_terminator(cp) || crate::string::lexer::is_whitespace(cp as i32),
    }
}

/// The length in bytes of the character that `text` starts with, if `\s` matches it, and 0 if not.
#[inline]
pub fn js_whitespace_len(text: &[u8]) -> usize {
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

/// The same for the character that `text` ends with.
#[inline]
pub fn js_whitespace_len_back(text: &[u8]) -> usize {
    match *text {
        [.., 0x09..=0x0D | b' '] => 1,
        [.., 0..0x80] | [] => 0,
        [.., 0xC2, 0xA0] => 2,
        [.., a, b, c] if js_whitespace_len(&[a, b, c]) == 3 => 3,
        _ => 0,
    }
}

/// `text.trimStart()`
#[inline]
pub fn trim_js_whitespace_start(mut text: &[u8]) -> &[u8] {
    while let len @ 1.. = js_whitespace_len(text) {
        text = &text[len..];
    }
    text
}

/// `text.trimEnd()`
#[inline]
pub fn trim_js_whitespace_end(mut text: &[u8]) -> &[u8] {
    while let len @ 1.. = js_whitespace_len_back(text) {
        text = &text[..text.len() - len];
    }
    text
}

/// `text.trim()`
#[inline]
pub fn trim_js_whitespace(text: &[u8]) -> &[u8] {
    trim_js_whitespace_end(trim_js_whitespace_start(text))
}

/// `/^\s*$/u.test(text)`
#[inline]
pub fn is_all_js_whitespace(text: &[u8]) -> bool {
    trim_js_whitespace_start(text).is_empty()
}

/// The length in bytes of the line break that `text` starts with: `\r\n`, `\r`, `\n`, U+2028 or
/// U+2029. 0 if it starts with none.
#[inline]
pub fn js_line_break_len(text: &[u8]) -> usize {
    match text {
        [b'\r', b'\n', ..] => 2,
        [b'\r' | b'\n', ..] => 1,
        [0xE2, 0x80, 0xA8 | 0xA9, ..] => 3,
        _ => 0,
    }
}

/// The same for the line break that `text` ends with.
#[inline]
pub fn js_line_break_len_back(text: &[u8]) -> usize {
    match text {
        [.., b'\r', b'\n'] => 2,
        [.., b'\r' | b'\n'] => 1,
        [.., 0xE2, 0x80, 0xA8 | 0xA9] => 3,
        _ => 0,
    }
}

/// Where the first line break of `text` starts, and its length in bytes.
pub fn find_js_line_break(text: &[u8]) -> Option<(usize, usize)> {
    let mut from = 0;
    loop {
        let at = from + index_of_any(text.get(from..)?, b"\r\n\xE2")?;
        match js_line_break_len(&text[at..]) {
            0 => from = at + 1,
            len => return Some((at, len)),
        }
    }
}

/// `/\r\n|[\r\n  ]/u.test(text)`
#[inline]
pub fn contains_js_line_break(text: &[u8]) -> bool {
    find_js_line_break(text).is_some()
}

/// `text.split(/\r\n|[\r\n  ]/u)`: the lines without their line breaks. There is always
/// at least one.
#[inline]
pub fn js_lines(text: &[u8]) -> JsLines<'_> {
    JsLines { rest: Some(text) }
}

#[derive(Copy, Clone)]
pub struct JsLines<'t> {
    rest: Option<&'t [u8]>,
}

impl<'t> Iterator for JsLines<'t> {
    type Item = &'t [u8];

    fn next(&mut self) -> Option<&'t [u8]> {
        let rest = self.rest?;
        match find_js_line_break(rest) {
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

/// `text.split(/\r\n|\n|\r/)`: the lines without their line breaks. There is always at least one.
pub fn split_crlf_lines(text: &[u8]) -> impl Iterator<Item = &[u8]> + Clone {
    let mut rest = Some(text);
    core::iter::from_fn(move || {
        let text = rest?;
        let Some(at) = index_of_any(text, b"\n\r") else {
            rest = None;
            return Some(text);
        };
        let len = if text[at..].starts_with(b"\r\n") {
            2
        } else {
            1
        };
        rest = Some(&text[at + len..]);
        Some(&text[..at])
    })
}

/// `buf += text.replace(/\r\n?/g, "\n")`
pub fn push_crlf_as_lf(buf: &mut Vec<u8>, text: &[u8]) {
    let mut rest = text;
    while let Some(at) = index_of_char_usize(rest, b'\r') {
        buf.extend_from_slice(&rest[..at]);
        buf.push(b'\n');
        rest = &rest[at + 1..];
        rest = rest.strip_prefix(b"\n").unwrap_or(rest);
    }
    buf.extend_from_slice(rest);
}

/// `text.replace(/\r\n?/g, "\n")`
pub fn crlf_as_lf(text: &[u8]) -> Cow<'_, [u8]> {
    if !contains_char(text, b'\r') {
        return Cow::Borrowed(text);
    }
    let mut normalized = Vec::with_capacity(text.len());
    push_crlf_as_lf(&mut normalized, text);
    Cow::Owned(normalized)
}

/// The length in bytes of the character that `text` starts with, if it has the property `White_Space`
/// of Unicode, which `char::is_whitespace` and `str::trim` go by, and 0 if not. U+0085 has it and
/// `\s` does not match it; `\s` matches U+FEFF, which has it not.
#[inline]
fn unicode_whitespace_len(text: &[u8]) -> usize {
    match *text {
        [0x09..=0x0D | b' ', ..] => 1,
        [0xC2, 0x85 | 0xA0, ..] => 2,
        // U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000
        [0xE1, 0x9A, 0x80, ..]
        | [0xE2, 0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF, ..]
        | [0xE2, 0x81, 0x9F, ..]
        | [0xE3, 0x80, 0x80, ..] => 3,
        _ => 0,
    }
}

/// `str::trim_start`
#[inline]
pub fn trim_unicode_whitespace_start(mut text: &[u8]) -> &[u8] {
    while let len @ 1.. = unicode_whitespace_len(text) {
        text = &text[len..];
    }
    text
}

/// `str::trim_end`
#[inline]
pub fn trim_unicode_whitespace_end(mut text: &[u8]) -> &[u8] {
    loop {
        text = match *text {
            [ref rest @ .., 0x09..=0x0D | b' '] => rest,
            [.., 0..0x80] | [] => return text,
            [ref rest @ .., 0xC2, 0x85 | 0xA0] => rest,
            [ref rest @ .., a, b, c] if unicode_whitespace_len(&[a, b, c]) == 3 => rest,
            _ => return text,
        };
    }
}

/// `str::trim`
#[inline]
pub fn trim_unicode_whitespace(text: &[u8]) -> &[u8] {
    trim_unicode_whitespace_end(trim_unicode_whitespace_start(text))
}

/// `text.chars().all(char::is_whitespace)`
#[inline]
pub fn is_all_unicode_whitespace(text: &[u8]) -> bool {
    trim_unicode_whitespace_start(text).is_empty()
}

/// `str::split_whitespace`: the runs of characters that are not white space.
pub fn split_unicode_whitespace(text: &[u8]) -> impl Iterator<Item = &[u8]> + Clone {
    let mut rest = text;
    core::iter::from_fn(move || {
        rest = trim_unicode_whitespace_start(rest);
        let len = (0..rest.len())
            .find(|&at| unicode_whitespace_len(&rest[at..]) > 0)
            .unwrap_or(rest.len());
        let (word, after) = rest.split_at(len);
        rest = after;
        (!word.is_empty()).then_some(word)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_whitespace_by_bytes_is_js_whitespace_by_code_point() {
        let mut count = 0;
        for c in (0..=0x10FFFF).filter_map(char::from_u32) {
            let mut buf = [0; 4];
            let bytes = c.encode_utf8(&mut buf).as_bytes();
            let len = if is_js_whitespace(c as u32) {
                bytes.len()
            } else {
                0
            };
            assert_eq!(js_whitespace_len(bytes), len, "U+{:04X}", c as u32);
            assert_eq!(js_whitespace_len_back(bytes), len, "U+{:04X}", c as u32);
            count += usize::from(len > 0);
        }
        assert_eq!(count, 25);
    }

    #[test]
    fn trim_js_whitespace_strips_both_ends_only() {
        let text = "\u{FEFF}\t\u{2029} a \u{3000} b\u{A0}\r\n".as_bytes();
        assert_eq!(trim_js_whitespace(text), "a \u{3000} b".as_bytes());
        assert_eq!(trim_js_whitespace(b"\x85a\x85"), b"\x85a\x85");
        assert!(is_all_js_whitespace("\u{2000}\n".as_bytes()));
        assert!(!is_all_js_whitespace("\u{200B}".as_bytes()));
    }

    #[test]
    fn js_lines_end_at_the_four_line_terminators() {
        let text = "a\r\nb\rc\n\u{2028}d\u{2029}\u{2027}".as_bytes();
        let lines: Vec<&[u8]> = js_lines(text).collect();
        let expected: [&[u8]; 6] = [b"a", b"b", b"c", b"", b"d", "\u{2027}".as_bytes()];
        assert_eq!(lines, expected);
        assert_eq!(js_lines(b"").count(), 1);
        assert_eq!(
            find_js_line_break("\u{2027}\u{2028}".as_bytes()),
            Some((3, 3))
        );
        assert!(!contains_js_line_break("\u{2027}".as_bytes()));
    }

    #[test]
    fn carriage_returns_and_line_feeds() {
        let text = b"a\r\nb\rc\n\r\n\xE2\x80\xA8d\r";
        let lines: Vec<&[u8]> = split_crlf_lines(text).collect();
        let expected: [&[u8]; 6] = [b"a", b"b", b"c", b"", b"\xE2\x80\xA8d", b""];
        assert_eq!(lines, expected);
        assert_eq!(&*crlf_as_lf(text), b"a\nb\nc\n\n\xE2\x80\xA8d\n");
        assert!(matches!(crlf_as_lf(b"a\nb"), Cow::Borrowed(_)));
        let ends: [(&[u8], usize); 5] = [
            (b"a\r\n", 2),
            (b"a\n\r", 1),
            (b"\xE2\x80\xA9", 3),
            (b"\xE2\x80\xAA", 0),
            (b"", 0),
        ];
        for (text, len) in ends {
            assert_eq!(js_line_break_len_back(text), len, "{text:x?}");
        }
    }

    #[test]
    fn unicode_whitespace_is_what_char_says() {
        for c in (0..=0x10FFFF).filter_map(char::from_u32) {
            let mut buf = [0; 4];
            let bytes = c.encode_utf8(&mut buf).as_bytes();
            let left = if c.is_whitespace() { 0 } else { bytes.len() };
            assert_eq!(trim_unicode_whitespace_start(bytes).len(), left, "{c:?}");
            assert_eq!(trim_unicode_whitespace_end(bytes).len(), left, "{c:?}");
        }
        let text = "\u{85} a\u{3000}\u{FEFF}b \n";
        assert_eq!(
            trim_unicode_whitespace(text.as_bytes()),
            text.trim().as_bytes()
        );
        let words: Vec<&[u8]> = split_unicode_whitespace(text.as_bytes()).collect();
        let expected: Vec<&[u8]> = text.split_whitespace().map(str::as_bytes).collect();
        assert_eq!(words, expected);
    }
}
