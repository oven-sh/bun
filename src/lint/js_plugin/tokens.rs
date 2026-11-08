//! A file's tokens and comments as arrays of numbers.
//!
//! A token list is its length, then every start offset, then every end offset, then every [`TokenKind`] as one byte,
//! padded with zeros to a multiple of 4 bytes.

use super::wire;
use crate::ast::{File, jsx_text_value_of};
use crate::estree::Dialect;
use crate::tokens::{TokenKind, Tokens};
use bun_core::strings::{self, Utf16OffsetTable};
use std::borrow::Cow;

fn write_list(tokens: Tokens, offsets: &Utf16OffsetTable, out: &mut Vec<u8>) {
    let count = tokens.count();
    wire::words(out, &[count as u32]);
    out.reserve(count * 9 + 3);
    for token in tokens {
        out.extend_from_slice(&offsets.to_utf16(token.start()).to_le_bytes());
    }
    for token in tokens {
        out.extend_from_slice(&offsets.to_utf16(token.end()).to_le_bytes());
    }
    out.extend(tokens.map(|it| it.kind() as u8));
    out.resize(out.len() + (4 - count % 4) % 4, 0);
}

/// Appends the `value` of each token whose value isn't a slice of the source, because espree decodes it. The layout is
/// the count, `[token index, start, end]` for each, then the UTF-16 code units that `start` and `end` index into,
/// padded with zeros to a multiple of 4 bytes.
fn write_decoded_values<'a>(file: &'a File<'a>, out: &mut Vec<u8>) {
    // oxlint decodes names the way espree does.
    let can_have_any = (Dialect::of(file) == Dialect::Espree || file.language().is_oxlint)
        && strings::index_of_any(file.text(), b"\\&\r").is_some();
    if !can_have_any {
        return wire::words(out, &[0]);
    }
    let mut entries = Vec::new();
    let mut units = Vec::new();
    let mut is_after_equals = false;
    for (index, token) in file.tokens().enumerate() {
        let is_attribute = core::mem::replace(&mut is_after_equals, token.is_punctuator("="));
        let value = match token.kind() {
            // An attribute's string keeps its source text. With oxlint, all JSX text does.
            TokenKind::JsxText if is_attribute || file.language().is_oxlint => continue,
            TokenKind::JsxText => jsx_text_value_of(token.text(), true),
            _ => token.decoded_value(),
        };
        let Cow::Owned(value) = value else {
            continue;
        };
        let start = units.len() as u32;
        match strings::wtf8_to_utf16_alloc(&value) {
            Some(value) => units.extend_from_slice(&value),
            None => units.extend(value.iter().map(|&it| u16::from(it))),
        }
        entries.extend_from_slice(&[index as u32, start, units.len() as u32]);
    }
    wire::words(out, &[entries.len() as u32 / 3]);
    wire::words(out, &entries);
    out.extend(units.iter().flat_map(|it| it.to_le_bytes()));
    out.resize(out.len() + units.len() % 2 * 2, 0);
}

/// Appends the tokens, then the comments, then the values that espree decodes.
pub(super) fn write<'a>(file: &'a File<'a>, offsets: &Utf16OffsetTable, out: &mut Vec<u8>) {
    write_list(file.tokens(), offsets, out);
    write_list(file.comments(), offsets, out);
    write_decoded_values(file, out);
}

pub(super) fn write_comments<'a>(
    file: &'a File<'a>,
    offsets: &Utf16OffsetTable,
    out: &mut Vec<u8>,
) {
    write_list(file.comments(), offsets, out);
}
