//! The tokens and the comments of a file as arrays of numbers.
//!
//! A list of tokens is its length, then where each starts, then where each ends, then the
//! [`TokenKind`] of each, a byte for each, and zeros up to a multiple of 4 bytes.

use super::wire;
use crate::ast::File;
use crate::tokens::Tokens;
use bun_core::strings::Utf16OffsetTable;

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

/// Appends the tokens, then the comments.
pub(super) fn write<'a>(file: &'a File<'a>, offsets: &Utf16OffsetTable, out: &mut Vec<u8>) {
    write_list(file.tokens(), offsets, out);
    write_list(file.comments(), offsets, out);
}

pub(super) fn write_comments<'a>(
    file: &'a File<'a>,
    offsets: &Utf16OffsetTable,
    out: &mut Vec<u8>,
) {
    write_list(file.comments(), offsets, out);
}
