//! What JavaScript's strings and regular expressions do, for bytes.

use std::borrow::Cow;

/// If `text` starts with a character that `\s` matches, its length in bytes.
pub(crate) fn white_space_len_at_start(text: &[u8]) -> Option<usize> {
    match *text {
        [b'\t' | b'\n' | 0x0B | 0x0C | b'\r' | b' ', ..] => Some(1),
        [0xC2, 0xA0, ..] => Some(2),
        // U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF
        [0xE1, 0x9A, 0x80, ..]
        | [0xE2, 0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF, ..]
        | [0xE2, 0x81, 0x9F, ..]
        | [0xE3, 0x80, 0x80, ..]
        | [0xEF, 0xBB, 0xBF, ..] => Some(3),
        _ => None,
    }
}

fn white_space_len_at_end(text: &[u8]) -> Option<usize> {
    match *text.last()? {
        b'\t' | b'\n' | 0x0B | 0x0C | b'\r' | b' ' => return Some(1),
        0..0x80 => return None,
        _ => {}
    }
    (2..=3usize).find(|&len| {
        text.len()
            .checked_sub(len)
            .and_then(|at| text.get(at..))
            .and_then(white_space_len_at_start)
            == Some(len)
    })
}

/// `/^\s/.test(text)`
pub(crate) fn starts_with_white_space(text: &[u8]) -> bool {
    white_space_len_at_start(text).is_some()
}

/// `text.trimStart()`
pub(crate) fn trim_start(mut text: &[u8]) -> &[u8] {
    while let Some(len) = white_space_len_at_start(text) {
        text = &text[len..];
    }
    text
}

/// `text.trimEnd()`
pub(crate) fn trim_end(mut text: &[u8]) -> &[u8] {
    while let Some(len) = white_space_len_at_end(text) {
        text = &text[..text.len() - len];
    }
    text
}

/// `text.trim()`
pub(crate) fn trim(text: &[u8]) -> &[u8] {
    trim_end(trim_start(text))
}

/// `text.toLowerCase()`
pub(crate) fn to_lower_case(text: &[u8]) -> Cow<'_, [u8]> {
    // Neither an upper case letter nor anything that is not ASCII.
    if text
        .iter()
        .all(|byte| !matches!(byte, b'A'..=b'Z' | 0x80..))
    {
        return Cow::Borrowed(text);
    }
    if text.is_ascii() {
        return Cow::Owned(text.to_ascii_lowercase());
    }
    match std::str::from_utf8(text) {
        Ok(text) => Cow::Owned(text.to_lowercase().into_bytes()),
        Err(_) => Cow::Owned(text.to_ascii_lowercase()),
    }
}

/// `a.toLowerCase() === b`, where `b` is ASCII in lower case.
pub(crate) fn eq_lower_case(a: &[u8], b: &[u8]) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// `\w`
pub(crate) fn is_word_character(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// The number of bytes of `text` that are before its first character that `\s` does not match.
pub(crate) fn leading_white_space_len(text: &[u8]) -> usize {
    text.len() - trim_start(text).len()
}

/// A set of bytes, for the ends of tokens: they are a few bytes away, and there are more kinds of them
/// than the vectorized search takes at once.
pub(crate) struct ByteSet([bool; 256]);

impl ByteSet {
    pub(crate) const fn new(bytes: &[u8]) -> ByteSet {
        let mut set = [false; 256];
        let mut i = 0;
        while i < bytes.len() {
            set[bytes[i] as usize] = true;
            i += 1;
        }
        ByteSet(set)
    }

    /// The index of the first byte of `text` from `from` on that is in the set.
    pub(crate) fn find(&self, text: &[u8], from: usize) -> Option<usize> {
        let rest = text.get(from..)?;
        rest.iter()
            .position(|&byte| self.0[byte as usize])
            .map(|at| from + at)
    }
}

/// `text.includes(part)`
pub(crate) fn includes(text: &[u8], part: &[u8]) -> bool {
    bun_core::strings::contains(text, part)
}

/// `text.indexOf(byte, from)`
pub(crate) fn index_of_char_from(text: &[u8], byte: u8, from: usize) -> Option<usize> {
    bun_core::strings::index_of_char_usize(text.get(from..)?, byte).map(|at| at + from)
}

/// `text.indexOf(part, from)`
pub(crate) fn index_of_from(text: &[u8], part: &[u8], from: usize) -> Option<usize> {
    bun_core::strings::index_of(text.get(from..)?, part).map(|at| at + from)
}
