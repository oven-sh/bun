//! How c-ares cuts configuration files into pieces.

use bun_core::strings;

use crate::buf::all_print;

pub(crate) fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c)
}

pub(crate) fn trim_start(text: &[u8]) -> &[u8] {
    let spaces = text.iter().take_while(|&&byte| is_space(byte)).count();
    text.get(spaces..).unwrap_or_default()
}

pub(crate) fn trim(text: &[u8]) -> &[u8] {
    let text = trim_start(text);
    let spaces = text
        .iter()
        .rev()
        .take_while(|&&byte| is_space(byte))
        .count();
    text.get(..text.len() - spaces).unwrap_or_default()
}

/// The bytes at the start of `text` that `belongs` takes, and the rest.
pub(crate) fn take_while(text: &[u8], belongs: impl Fn(u8) -> bool) -> (&[u8], &[u8]) {
    let count = text.iter().take_while(|&&byte| belongs(byte)).count();
    text.split_at_checked(count).unwrap_or((text, &[]))
}

/// What is before the first white space, and the rest.
pub(crate) fn word(text: &[u8]) -> (&[u8], &[u8]) {
    take_while(text, |byte| !is_space(byte))
}

/// `text` if it would fit c-ares's buffer of `size` bytes with a NUL and all of it prints.
pub(crate) fn fits(text: &[u8], size: usize) -> Option<&[u8]> {
    (text.len() < size && all_print(text)).then_some(text)
}

/// The parts of `text` between any of `delimiters`, without the empty ones. With `max_parts`, the last one is all the rest.
pub(crate) fn split<'a>(
    mut text: &'a [u8],
    delimiters: &[u8],
    trimmed: bool,
    max_parts: Option<usize>,
) -> Vec<&'a [u8]> {
    let mut parts = Vec::new();
    let mut first = true;
    while !text.is_empty() {
        if !core::mem::take(&mut first) {
            text = text.get(1..).unwrap_or_default();
        }
        let end = match max_parts {
            Some(max) if parts.len() + 1 >= max => None,
            _ => strings::index_of_any(text, delimiters),
        };
        let (part, rest) = text
            .split_at_checked(end.unwrap_or(text.len()))
            .unwrap_or((text, &[]));
        text = rest;
        let part = if trimmed { trim(part) } else { part };
        if !part.is_empty() {
            parts.push(part);
        }
    }
    parts
}

/// Digits only, so no sign, and no more than `max`.
pub(crate) fn parse_uint(text: &[u8], max: u32) -> Option<u32> {
    if text.is_empty() {
        return None;
    }
    let mut value: u32 = 0;
    for &byte in text {
        let digit = char::from(byte).to_digit(10)?;
        value = value.checked_mul(10)?.checked_add(digit)?;
    }
    (value <= max).then_some(value)
}
