//! What `str` does, for bytes that are UTF-8 or nearly so.

use bun_core::strings;

/// The first character of `text` and how many bytes it has. Bytes that are not UTF-8 are U+FFFD.
pub(super) fn first_char(text: &[u8]) -> Option<(char, usize)> {
    match text.first() {
        None => None,
        Some(&byte) if byte < 128 => Some((byte as char, 1)),
        Some(_) => {
            let (char, len) = bstr::decode_utf8(text);
            Some((char.unwrap_or(char::REPLACEMENT_CHARACTER), len))
        }
    }
}

pub(super) fn last_char(text: &[u8]) -> Option<(char, usize)> {
    match text.last() {
        None => None,
        Some(&byte) if byte < 128 => Some((byte as char, 1)),
        Some(_) => {
            let (char, len) = bstr::decode_last_utf8(text);
            Some((char.unwrap_or(char::REPLACEMENT_CHARACTER), len))
        }
    }
}

/// `str::trim_start_matches`
pub(super) fn trim_start_matches(mut text: &[u8], matches: impl Fn(char) -> bool) -> &[u8] {
    while let Some((char, len)) = first_char(text).filter(|it| matches(it.0)) {
        let _ = char;
        text = &text[len..];
    }
    text
}

/// `str::trim_end_matches`
pub(super) fn trim_end_matches(mut text: &[u8], matches: impl Fn(char) -> bool) -> &[u8] {
    while let Some((_, len)) = last_char(text).filter(|it| matches(it.0)) {
        text = &text[..text.len() - len];
    }
    text
}

/// `str::lines`
pub(super) fn lines(text: &[u8]) -> impl Iterator<Item = &[u8]> + Clone {
    let has_last_line_break = text.ends_with(b"\n");
    let count = if text.is_empty() {
        0
    } else {
        strings::count_char(text, b'\n') + usize::from(!has_last_line_break)
    };
    strings::split(text, b"\n")
        .take(count)
        .enumerate()
        .map(move |(index, line)| {
            // A carriage return that no line feed follows is part of the line.
            match index + 1 < count || has_last_line_break {
                true => line.strip_suffix(b"\r").unwrap_or(line),
                false => line,
            }
        })
}

/// The parts of `parts` with `separator` between them.
pub(super) fn join<'a>(parts: impl Iterator<Item = &'a [u8]>, separator: &[u8]) -> Vec<u8> {
    let mut result = Vec::new();
    for (index, part) in parts.enumerate() {
        if index > 0 {
            result.extend_from_slice(separator);
        }
        result.extend_from_slice(part);
    }
    result
}

/// `n` spaces.
pub(super) fn push_spaces(out: &mut Vec<u8>, n: usize) {
    out.resize(out.len() + n, b' ');
}

/// The number that the ASCII digits `digits` are.
pub(super) fn parse_index(digits: &[u8]) -> Option<usize> {
    digits.iter().try_fold(0usize, |all, &digit| {
        all.checked_mul(10)?.checked_add(usize::from(digit - b'0'))
    })
}

pub(super) fn push_number(out: &mut Vec<u8>, number: usize) {
    out.extend_from_slice(number.to_string().as_bytes());
}
