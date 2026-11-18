use bun_engine_text::{AllocError, StringRef};

use crate::buffer::Buffer;
use crate::class::{self, Set};
use crate::input::{Encoding, Source};

#[inline(always)]
fn escape(byte: u8) -> [u8; 3] {
    const DIGITS: &[u8; 16] = b"0123456789ABCDEF";
    [
        b'%',
        DIGITS[usize::from(byte >> 4)],
        DIGITS[usize::from(byte & 15)],
    ]
}

#[inline(always)]
fn latin1_to_utf8(character: u8) -> [u8; 2] {
    [0xc0 | character >> 6, 0x80 | (character & 0x3f)]
}

/// Appends escapes for all of `source`.
#[inline(always)]
pub(crate) fn escape_all(source: Source<'_>, out: &mut Buffer) -> Result<(), AllocError> {
    if source.encoding == Encoding::Latin1 && !source.bytes.iter().all(u8::is_ascii) {
        return escape_latin1(source.bytes, out);
    }
    let (escapes, _) = out.append(3 * source.bytes.len())?.as_chunks_mut();
    for (target, &byte) in escapes.iter_mut().zip(source.bytes) {
        *target = escape(byte);
    }
    Ok(())
}

fn escape_latin1(characters: &[u8], out: &mut Buffer) -> Result<(), AllocError> {
    for &character in characters {
        if character.is_ascii() {
            out.extend(&escape(character))?;
        } else {
            out.extend(latin1_to_utf8(character).map(escape).as_flattened())?;
        }
    }
    Ok(())
}

/// UTF-8 percent-encode, for a short text.
pub(crate) fn encode(source: Source<'_>, set: Set, out: &mut Buffer) -> Result<(), AllocError> {
    let mut rest = source.bytes;
    while let Some(start) = rest.iter().position(|&byte| class::is_in(set, byte)) {
        let (plain, run) = rest.split_at(start);
        let (run, after) = run.split_at(class::run_length(set, run));
        out.extend(plain)?;
        escape_all(source.with_bytes(run), out)?;
        rest = after;
    }
    out.extend(rest)
}

/// The byte that `text` starts with an escape for.
#[inline(always)]
pub(crate) fn unescape(text: &[u8]) -> Option<u8> {
    let digit = |digit: u8| char::from(digit).to_digit(16);
    match *text {
        [b'%', high, low, ..] => Some((digit(high)? << 4 | digit(low)?) as u8),
        _ => None,
    }
}

/// Appends the UTF-8 for a byte of a text that is not part of an escape.
#[inline(always)]
pub(crate) fn push_utf8(out: &mut Buffer, byte: u8, encoding: Encoding) -> Result<(), AllocError> {
    if byte.is_ascii() || encoding != Encoding::Latin1 {
        out.push(byte)
    } else {
        out.extend(&latin1_to_utf8(byte))
    }
}

/// Percent-decode of the UTF-8 encoding of a short text.
pub(crate) fn decode(source: Source<'_>, out: &mut Buffer) -> Result<(), AllocError> {
    let mut rest = source.bytes;
    while let [byte, tail @ ..] = rest {
        if let Some(byte) = unescape(rest) {
            out.push(byte)?;
            rest = &rest[3..];
        } else {
            push_utf8(out, *byte, source.encoding)?;
            rest = tail;
        }
    }
    Ok(())
}

/// Percent-decode: gives `sink` the bytes that `ascii` stands for, piece by piece.
#[inline]
pub(crate) fn percent_decode<E>(
    ascii: &[u8],
    mut sink: impl FnMut(&[u8]) -> Result<(), E>,
) -> Result<(), E> {
    let (mut pending, mut at) = (0, 0);
    while let Some(distance) = bun_highway::index_of_char(&ascii[at..], b'%') {
        at += distance;
        while let Some(byte) = unescape(&ascii[at..]) {
            if pending < at {
                sink(&ascii[pending..at])?;
            }
            sink(&[byte])?;
            at += 3;
            pending = at;
        }
        at += usize::from(ascii.get(at) == Some(&b'%'));
    }
    sink(&ascii[pending..])
}

/// The text that a component of a URL stands for. `None` if that is not UTF-8.
pub(crate) fn decode_to_string(ascii: &[u8]) -> Result<Option<StringRef>, AllocError> {
    if bun_highway::index_of_char(ascii, b'%').is_none() {
        return StringRef::try_from_units(ascii).map(Some);
    }
    let mut bytes = Buffer::new();
    percent_decode(ascii, |piece| bytes.extend(piece))?;
    StringRef::try_from_utf8(&bytes)
}
