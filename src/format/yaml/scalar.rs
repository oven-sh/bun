//! `yaml` 2.9: `compose/resolve-flow-scalar.js`: what a scalar that is not a block says.

use super::ast::Kind;
use bun_core::strings;
use std::borrow::Cow;

/// `foldLines`
fn fold_lines(source: &[u8]) -> Cow<'_, [u8]> {
    #[derive(Copy, Clone)]
    #[repr(u8)]
    enum Separator {
        Space = b' ',
        LineBreak = b'\n',
    }
    let Some(first_newline) = strings::index_of_char_usize(source, b'\n') else {
        return Cow::Borrowed(source);
    };
    let trim_end = |line: &[u8]| -> usize {
        line.iter()
            .rposition(|b| !matches!(b, b' ' | b'\t'))
            .map_or(0, |at| at + 1)
    };
    let trim_start = |line: &[u8]| -> usize {
        line.iter()
            .position(|b| !matches!(b, b' ' | b'\t'))
            .unwrap_or(line.len())
    };
    let mut result = source[..trim_end(&source[..first_newline])].to_vec();
    let mut sep = Separator::Space;
    let mut rest = &source[first_newline + 1..];
    while let Some(newline) = strings::index_of_char_usize(rest, b'\n') {
        let line = &rest[..newline];
        let line = &line[trim_start(line)..];
        let line = &line[..trim_end(line)];
        if line.is_empty() {
            match sep {
                Separator::LineBreak => result.push(b'\n'),
                Separator::Space => sep = Separator::LineBreak,
            }
        } else {
            result.push(sep as u8);
            result.extend_from_slice(line);
            sep = Separator::Space;
        }
        rest = &rest[newline + 1..];
    }
    result.push(sep as u8);
    result.extend_from_slice(&rest[trim_start(rest)..]);
    Cow::Owned(result)
}

/// `scalar.source`, for a scalar of `kind` that is written `source`.
pub(crate) fn scalar_source(kind: Kind, source: &[u8]) -> Cow<'_, [u8]> {
    match kind {
        Kind::QuoteSingle => single_quoted_value(source),
        Kind::QuoteDouble => double_quoted_value(source),
        _ => fold_lines(source),
    }
}

fn single_quoted_value(source: &[u8]) -> Cow<'_, [u8]> {
    let folded = fold_lines(
        source
            .get(1..source.len().saturating_sub(1))
            .unwrap_or_default(),
    );
    if !strings::contains(&folded, b"''") {
        return folded;
    }
    let mut result = Vec::with_capacity(folded.len());
    let mut i = 0;
    while let Some(&byte) = folded.get(i) {
        result.push(byte);
        i += if byte == b'\'' && folded.get(i + 1) == Some(&b'\'') {
            2
        } else {
            1
        };
    }
    Cow::Owned(result)
}

fn double_quoted_value(source: &[u8]) -> Cow<'_, [u8]> {
    let end = source.len().saturating_sub(1);
    let inner = source.get(1..end).unwrap_or_default();
    if strings::index_of_any(inner, b"\\\n").is_none() {
        return Cow::Borrowed(inner);
    }
    let at = |i: usize| source.get(i).copied();
    let is_blank = |ch: Option<u8>| matches!(ch, Some(b' ' | b'\t'));
    let mut result = Vec::with_capacity(inner.len());
    let mut i = 1;
    while i < end {
        let ch = source[i];
        if ch == b'\n' {
            // `foldNewline`
            let mut fold = 0;
            while matches!(at(i + 1), Some(b' ' | b'\t' | b'\n')) {
                if at(i + 1) == Some(b'\n') {
                    fold += 1;
                }
                i += 1;
            }
            match fold {
                0 => result.push(b' '),
                _ => result.resize(result.len() + fold, b'\n'),
            }
        } else if ch == b'\\' {
            i += 1;
            let next = source[i];
            let escape: Option<&str> = match next {
                b'0' => Some("\0"),
                b'a' => Some("\x07"),
                b'b' => Some("\x08"),
                b'e' => Some("\x1b"),
                b'f' => Some("\x0C"),
                b'n' => Some("\n"),
                b'r' => Some("\r"),
                b't' => Some("\t"),
                b'v' => Some("\x0B"),
                b'N' => Some("\u{85}"),
                b'_' => Some("\u{a0}"),
                b'L' => Some("\u{2028}"),
                b'P' => Some("\u{2029}"),
                b' ' => Some(" "),
                b'"' => Some("\""),
                b'/' => Some("/"),
                b'\\' => Some("\\"),
                b'\t' => Some("\t"),
                _ => None,
            };
            if let Some(escape) = escape {
                result.extend_from_slice(escape.as_bytes());
            } else if next == b'\n' {
                // An escaped line break is nothing, and neither is the indentation of the next line.
                while is_blank(at(i + 1)) {
                    i += 1;
                }
            } else if matches!(next, b'x' | b'u' | b'U') {
                let length = match next {
                    b'x' => 2,
                    b'u' => 4,
                    _ => 8,
                };
                // `parseCharCode`
                let code = source
                    .get(i + 1..i + 1 + length)
                    .filter(|it| it.iter().all(u8::is_ascii_hexdigit))
                    .map(|digits| {
                        digits.iter().fold(0u32, |code, &digit| {
                            code * 16 + (digit as char).to_digit(16).unwrap_or(0)
                        })
                    })
                    .filter(|&code| code <= 0x10FFFF);
                match code {
                    Some(code) => {
                        let character = char::from_u32(code).unwrap_or(char::REPLACEMENT_CHARACTER);
                        result.extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes());
                    }
                    None => {
                        result.extend_from_slice(&source[i - 1..(i + 1 + length).min(source.len())])
                    }
                }
                i += length;
            } else {
                result.extend_from_slice(&source[i - 1..=i]);
            }
        } else if matches!(ch, b' ' | b'\t') {
            // White space at the end of a line is nothing.
            let start = i;
            while is_blank(at(i + 1)) {
                i += 1;
            }
            if at(i + 1) != Some(b'\n') {
                result.extend_from_slice(&source[start..=i]);
            }
        } else {
            result.push(ch);
        }
        i += 1;
    }
    Cow::Owned(result)
}
