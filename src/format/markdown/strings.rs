//! Characters and strings as micromark sees them.

use super::unicode_tables::PUNCTUATION_OR_SYMBOL;

pub(crate) fn is_in(table: &[(u32, u32)], c: u32) -> bool {
    let after = table.partition_point(|range| range.0 <= c);
    after > 0 && table.get(after - 1).is_some_and(|range| c <= range.1)
}

/// The character that `text` starts with, and its length. What is not UTF-8 is a character of one byte.
pub(crate) fn first_char(text: &[u8]) -> Option<(char, usize)> {
    let (c, len) = bstr::decode_utf8(text);
    match (c, len) {
        (_, 0) => None,
        (Some(c), len) => Some((c, len)),
        (None, len) => Some((char::REPLACEMENT_CHARACTER, len)),
    }
}

pub(crate) fn last_char(text: &[u8]) -> Option<(char, usize)> {
    let (c, len) = bstr::decode_last_utf8(text);
    match (c, len) {
        (_, 0) => None,
        (Some(c), len) => Some((c, len)),
        (None, len) => Some((char::REPLACEMENT_CHARACTER, len)),
    }
}

pub(crate) fn is_unicode_punctuation(c: char) -> bool {
    match c.is_ascii() {
        true => c.is_ascii_punctuation(),
        false => is_in(PUNCTUATION_OR_SYMBOL, c as u32),
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum CharacterClass {
    Whitespace,
    Punctuation,
    Other,
}

/// micromark's `classifyCharacter`. `None`: the start or the end of the text.
pub(crate) fn classify(c: Option<char>) -> CharacterClass {
    match c {
        None => CharacterClass::Whitespace,
        Some(c) if bun_core::strings::is_js_whitespace(c as u32) => CharacterClass::Whitespace,
        Some(c) if is_unicode_punctuation(c) => CharacterClass::Punctuation,
        Some(_) => CharacterClass::Other,
    }
}

/// micromark's `decodeNumericCharacterReference`
pub(crate) fn numeric_character(code: u32) -> char {
    let is_bad = code < 9
        || code == 11
        || (13 < code && code < 32)
        || (126 < code && code < 160)
        || (0xFDD0..=0xFDEF).contains(&code)
        || code & 0xFFFF >= 0xFFFE;
    match is_bad {
        true => char::REPLACEMENT_CHARACTER,
        false => char::from_u32(code).unwrap_or(char::REPLACEMENT_CHARACTER),
    }
}

/// The character reference that `text` starts with, `&amp;`, `&#38;` or `&#x26;`: its length. What it stands
/// for is appended to `out`.
pub(crate) fn character_reference(text: &[u8], out: Option<&mut Vec<u8>>) -> Option<usize> {
    let body = text.strip_prefix(b"&")?;
    if let Some(number) = body.strip_prefix(b"#") {
        let (digits, radix, max, prefix) = match number.first() {
            Some(b'x' | b'X') => (&number[1..], 16, 6, 3),
            _ => (number, 10, 7, 2),
        };
        let count = digits
            .iter()
            .take_while(|&&byte| (byte as char).is_digit(radix))
            .count();
        if count == 0 || count > max || digits.get(count) != Some(&b';') {
            return None;
        }
        if let Some(out) = out {
            let code = digits[..count].iter().fold(0u32, |code, &digit| {
                code * radix + (digit as char).to_digit(radix).unwrap_or(0)
            });
            bun_core::strings::push_codepoint_wtf8(out, numeric_character(code) as u32);
        }
        return Some(prefix + count + 1);
    }
    let count = body
        .iter()
        .take_while(|byte| byte.is_ascii_alphanumeric())
        .count();
    if count == 0 || count > 31 || body.get(count) != Some(&b';') {
        return None;
    }
    let decoded = &mut [0; 8];
    let decoded = bun_md::helpers::decode_entity_to_utf8(&text[..count + 2], decoded)?;
    if let Some(out) = out {
        out.extend_from_slice(decoded);
    }
    Some(count + 2)
}

/// micromark's `decodeString`: `text` without the backslashes of its escapes and with what its character
/// references stand for.
pub(crate) fn unescape(text: &[u8], out: &mut Vec<u8>) {
    let mut rest = text;
    while let Some(at) = bun_core::strings::index_of_any(rest, b"\\&") {
        out.extend_from_slice(&rest[..at]);
        rest = &rest[at..];
        match rest {
            [b'\\', escaped, ..] if escaped.is_ascii_punctuation() => {
                out.push(*escaped);
                rest = &rest[2..];
            }
            _ => match character_reference(rest, Some(out)) {
                Some(len) => rest = &rest[len..],
                None => {
                    out.push(rest[0]);
                    rest = &rest[1..];
                }
            },
        }
    }
    out.extend_from_slice(rest);
}

/// `text.toLowerCase()`
pub(crate) fn push_lowercase(text: &[u8], out: &mut Vec<u8>) {
    match std::str::from_utf8(text) {
        Ok(text) if !text.is_ascii() => out.extend_from_slice(text.to_lowercase().as_bytes()),
        _ => out.extend(text.iter().map(u8::to_ascii_lowercase)),
    }
}

/// micromark's `normalizeIdentifier`: white space is collapsed, and the case does not count.
pub(crate) fn normalize_identifier(text: &[u8]) -> Vec<u8> {
    let mut collapsed = Vec::with_capacity(text.len());
    for word in bun_core::strings::split_any(text, b"\t\n\r ").filter(|word| !word.is_empty()) {
        if !collapsed.is_empty() {
            collapsed.push(b' ');
        }
        collapsed.extend_from_slice(word);
    }
    match std::str::from_utf8(&collapsed) {
        Ok(text) if !text.is_ascii() => text.to_lowercase().to_uppercase().into_bytes(),
        _ => {
            collapsed.make_ascii_uppercase();
            collapsed
        }
    }
}
