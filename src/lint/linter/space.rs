//! White space as JavaScript sees it: `\s` in a regular expression, `String.prototype.trim`.

/// The length of the white space character that `text` starts with. 0 if it starts with something
/// else.
pub(crate) fn space_len(text: &[u8]) -> usize {
    match *text {
        [b'\t' | b'\n' | 0x0B | 0x0C | b'\r' | b' ', ..] => 1,
        [0xC2, 0xA0, ..] => 2,
        [0xE1, 0x9A, 0x80, ..]
        | [0xE2, 0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF, ..]
        | [0xE2, 0x81, 0x9F, ..]
        | [0xE3, 0x80, 0x80, ..]
        | [0xEF, 0xBB, 0xBF, ..] => 3,
        _ => 0,
    }
}

/// The length of the white space character that `text` ends with.
pub(crate) fn space_len_back(text: &[u8]) -> usize {
    match *text {
        [.., b'\t' | b'\n' | 0x0B | 0x0C | b'\r' | b' '] => 1,
        [.., 0xC2, 0xA0] => 2,
        [.., 0xE1, 0x9A, 0x80]
        | [.., 0xE2, 0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF]
        | [.., 0xE2, 0x81, 0x9F]
        | [.., 0xE3, 0x80, 0x80]
        | [.., 0xEF, 0xBB, 0xBF] => 3,
        _ => 0,
    }
}

pub(crate) fn trim_start(mut text: &[u8]) -> &[u8] {
    loop {
        match space_len(text) {
            0 => return text,
            n => text = &text[n..],
        }
    }
}

pub(crate) fn trim_end(mut text: &[u8]) -> &[u8] {
    loop {
        match space_len_back(text) {
            0 => return text,
            n => text = &text[..text.len() - n],
        }
    }
}

#[inline]
pub(crate) fn trim(text: &[u8]) -> &[u8] {
    trim_end(trim_start(text))
}

/// The length of the character that `text` starts with, which is not empty.
#[inline]
pub(crate) fn char_len(text: &[u8]) -> usize {
    bun_core::lexer::char_and_size(text, 0)
        .1
        .clamp(1, text.len().max(1))
}
