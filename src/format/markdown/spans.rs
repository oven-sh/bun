//! What is in a paragraph and is not CommonMark's or GFM's as `bun_md` reads them: links that are not marked as such as micromark finds
//! them, math. And how micromark and mdast write down a title and a text with NUL in it.

use super::strings::{CharacterClass, classify, unescape};
use crate::text::first_char;

fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t')
}

fn is_ascii_control(byte: u8) -> bool {
    byte < 32 || byte == 127
}

fn skip_spaces(bytes: &[u8], mut index: usize) -> usize {
    while bytes.get(index).copied().is_some_and(is_space) {
        index += 1;
    }
    index
}

/// A title without the indentation of its lines.
pub(crate) fn push_title(raw: &[u8], out: &mut Vec<u8>) {
    if !bun_core::strings::contains_char(raw, b'\n') {
        return unescape(raw, out);
    }
    let mut stripped = Vec::with_capacity(raw.len());
    for (index, line) in bun_core::strings::split(raw, b"\n").enumerate() {
        if index > 0 {
            stripped.push(b'\n');
        }
        stripped.extend_from_slice(if index > 0 {
            &line[skip_spaces(line, 0)..]
        } else {
            line
        });
    }
    unescape(&stripped, out);
}

fn class_at(bytes: &[u8], index: usize) -> CharacterClass {
    classify_unit(first_char(&bytes[index.min(bytes.len())..]).map(|it| it.0))
}

fn classify_unit(c: Option<char>) -> CharacterClass {
    match c {
        Some(c) if c as u32 > 0xFFFF => CharacterClass::Other,
        _ => classify(c),
    }
}

fn is_whitespace_at(bytes: &[u8], index: usize) -> bool {
    class_at(bytes, index) == CharacterClass::Whitespace
}

/// `tokenizeTrail`: whether what is at `index` is punctuation at the end of a link, which is not part of it.
fn is_trail(bytes: &[u8], mut index: usize) -> bool {
    loop {
        match bytes.get(index) {
            Some(
                b'!' | b'"' | b'\'' | b')' | b'*' | b',' | b'.' | b':' | b';' | b'?' | b'_' | b'~',
            ) => index += 1,
            Some(b'&') => {
                let letters = bytes[index + 1..]
                    .iter()
                    .take_while(|byte| byte.is_ascii_alphabetic())
                    .count();
                if letters == 0 || bytes.get(index + 1 + letters) != Some(&b';') {
                    return false;
                }
                index += letters + 2;
            }
            Some(b']') => {
                index += 1;
                if matches!(bytes.get(index), None | Some(b'(' | b'['))
                    || is_whitespace_at(bytes, index)
                {
                    return true;
                }
            }
            Some(b'<') | None => return true,
            Some(_) => return is_whitespace_at(bytes, index),
        }
    }
}

/// `tokenizeDomain`: where the domain at `start` ends.
fn parse_domain(bytes: &[u8], start: usize) -> Option<usize> {
    let (mut in_last, mut in_last_but_one, mut has_data) = (false, false, false);
    let mut index = start;
    loop {
        match bytes.get(index) {
            Some(&byte @ (b'.' | b'_')) => {
                if is_trail(bytes, index) {
                    break;
                }
                match byte {
                    b'_' => in_last = true,
                    _ => (in_last_but_one, in_last) = (in_last, false),
                }
                index += 1;
            }
            None => break,
            Some(&byte) => {
                let class = class_at(bytes, index);
                if class == CharacterClass::Whitespace
                    || (byte != b'-' && class == CharacterClass::Punctuation)
                {
                    break;
                }
                has_data = true;
                index += first_char(&bytes[index..]).map_or(1, |it| it.1);
            }
        }
    }
    (!in_last && !in_last_but_one && has_data).then_some(index)
}

/// `tokenizePath`: where the path at `start` ends.
fn parse_path(bytes: &[u8], start: usize) -> usize {
    let (mut open, mut close) = (0, 0);
    let mut index = start;
    loop {
        match bytes.get(index) {
            Some(b'(') => {
                open += 1;
                index += 1;
            }
            Some(b')') if close < open => {
                close += 1;
                index += 1;
            }
            Some(
                &byte @ (b'!' | b'"' | b'&' | b'\'' | b')' | b'*' | b',' | b'.' | b':' | b';'
                | b'<' | b'?' | b']' | b'_' | b'~'),
            ) => {
                if is_trail(bytes, index) {
                    return index;
                }
                close += usize::from(byte == b')');
                index += 1;
            }
            None => return index,
            Some(_) if is_whitespace_at(bytes, index) => return index,
            Some(_) => index += first_char(&bytes[index..]).map_or(1, |it| it.1),
        }
    }
}

pub(crate) fn is_gfm_atext(byte: u8) -> bool {
    matches!(byte, b'+' | b'-' | b'.' | b'_') || byte.is_ascii_alphanumeric()
}

/// `tokenizeEmailAutolink`
pub(crate) fn parse_email_literal(bytes: &[u8], start: usize) -> Option<usize> {
    let name = bytes[start..]
        .iter()
        .take_while(|&&byte| is_gfm_atext(byte))
        .count();
    if name == 0 || bytes.get(start + name) != Some(&b'@') {
        return None;
    }
    let mut index = start + name + 1;
    let (mut has_data, mut has_dot) = (false, false);
    loop {
        match bytes.get(index) {
            Some(b'.') if bytes.get(index + 1).is_some_and(u8::is_ascii_alphanumeric) => {
                has_dot = true
            }
            Some(&byte) if byte == b'-' || byte == b'_' || byte.is_ascii_alphanumeric() => {
                has_data = true
            }
            _ => break,
        }
        index += 1;
    }
    (has_data && has_dot && bytes[index - 1].is_ascii_alphabetic()).then_some(index)
}

/// `tokenizeWwwAutolink`
pub(crate) fn parse_www_literal(bytes: &[u8], start: usize) -> Option<usize> {
    let prefix = bytes.get(start..start + 4)?;
    if !prefix.eq_ignore_ascii_case(b"www.") || bytes.len() == start + 4 {
        return None;
    }
    Some(parse_path(bytes, parse_domain(bytes, start)?))
}

/// `tokenizeProtocolAutolink`
pub(crate) fn parse_protocol_literal(bytes: &[u8], start: usize) -> Option<usize> {
    let rest = &bytes[start..];
    let len = [&b"https://"[..], b"http://"]
        .into_iter()
        .find(|it| rest.len() >= it.len() && rest[..it.len()].eq_ignore_ascii_case(it))?
        .len();
    let after = start + len;
    let first = *bytes.get(after)?;
    if is_ascii_control(first) || class_at(bytes, after) != CharacterClass::Other {
        return None;
    }
    Some(parse_path(bytes, parse_domain(bytes, after)?))
}

/// `bytes` with `nul` in the place of each NUL.
pub(crate) fn push_without_nul(bytes: &[u8], nul: &[u8], out: &mut Vec<u8>) {
    for (index, part) in bun_core::strings::split(bytes, b"\0").enumerate() {
        if index > 0 {
            out.extend_from_slice(nul);
        }
        out.extend_from_slice(part);
    }
}

/// Prettier's `COMMENT_REGEX`, anywhere in `html`: `<!---->|<!---?[^>-](?:-?[^-])*-->`
pub(crate) fn has_html_comment(html: &[u8]) -> bool {
    let mut from = 0;
    while let Some(at) = bun_core::strings::index_of(&html[from..], b"<!--") {
        let start = from + at + 4;
        if html[start..].starts_with(b"-->") {
            return true;
        }
        // An optional dash, something that is neither `>` nor a dash, then no two dashes in a row before `-->`.
        let first = start + usize::from(html.get(start) == Some(&b'-'));
        if html
            .get(first)
            .is_some_and(|byte| !matches!(byte, b'>' | b'-'))
            && let Some(dashes) = bun_core::strings::index_of(&html[first..], b"--")
            && html[first + dashes + 2..].starts_with(b">")
        {
            return true;
        }
        from = start;
    }
    false
}

/// remark-math 3: where the `$ .. $` or `$$ .. $$` at `start` ends.
pub(crate) fn find_math_end(bytes: &[u8], start: usize) -> Option<usize> {
    let is_double = bytes.get(start + 1) == Some(&b'$');
    let mut index = start + 1 + usize::from(is_double);
    if matches!(bytes.get(index), Some(b' ' | b'\t')) {
        return None;
    }
    while let Some(&byte) = bytes.get(index) {
        let next = bytes.get(index + 1).copied();
        match byte {
            b'$' if !matches!(bytes[index - 1], b' ' | b'\t')
                && !next.is_some_and(|next| next.is_ascii_digit())
                && (!is_double || next == Some(b'$')) =>
            {
                return Some(index + 1 + usize::from(is_double));
            }
            b'\\' => index += 1,
            _ => {}
        }
        index += 1;
    }
    None
}

/// Where the run of exactly `size` times `marker` ends that closes code or math whose content starts at `from`.
pub(crate) fn find_closing_run(
    bytes: &[u8],
    mut from: usize,
    marker: u8,
    size: usize,
) -> Option<usize> {
    loop {
        from += bun_core::strings::index_of_char_usize(bytes.get(from..)?, marker)?;
        let run = bytes[from..]
            .iter()
            .take_while(|&&byte| byte == marker)
            .count();
        from += run;
        if run == size {
            return Some(from);
        }
    }
}
