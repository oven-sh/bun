//! To UTF-8. A lone surrogate becomes U+FFFD.

use core::hint::{cold_path, select_unpredictable};
use core::mem::MaybeUninit;

use bun_alloc::AllocError;
use bun_simdutf_sys::simdutf::{self, WithUtf8Len};

use crate::block::{self, Pairs, Units};
use crate::{CodeUnit, Cursor, Text, ascii, with_text};

/// Up to here the vector code does not make up for the call.
const SHORT: usize = 8;
const SHORT_FOR_TEST: usize = 64;
const SHORT_FOR_LENGTH: usize = 32;
/// So many units are converted on the stack, where there is room for the worst case, and then copied.
const PIECE: usize = 512;
const SCRATCH: usize = 3 * PIECE + 1;
/// Room for the worst case of a short text.
const SHORT_BYTES: usize = 4 * SHORT;

/// How far a conversion into limited room has come.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Progress {
    pub read: usize,
    pub written: usize,
}

const fn worst_case<T: CodeUnit>() -> usize {
    if T::IS_LATIN1 { 2 } else { 3 }
}

/// The bytes of the first character of `units`, which are not empty, in the first `.1` of `.0`, and the number of
/// its units.
#[inline(always)]
pub(crate) fn encode<T: CodeUnit>(units: &[T]) -> ([u8; 4], usize, usize) {
    let tail = |value: u32, shift: u32| 0x80 | value >> shift & 0x3f;
    let unit = units[0].to_u32();
    if units[0].is_surrogate() {
        cold_path();
        return match T::text(units).code_point_at(0) {
            ..0x1_0000 => ([0xef, 0xbf, 0xbd, 0], 3, 1),
            pair => {
                let rest = tail(pair, 12) << 8 | tail(pair, 6) << 16 | tail(pair, 0) << 24;
                ((0xf0 | pair >> 18 | rest).to_le_bytes(), 4, 2)
            }
        };
    }
    let (is_above_1, is_above_2) = (unit >= 0x80, unit >= 0x800);
    let two = 0xc0 | unit >> 6 | tail(unit, 0) << 8;
    let three = 0xe0 | unit >> 12 | tail(unit, 6) << 8 | tail(unit, 0) << 16;
    let bytes = select_unpredictable(is_above_1, two, unit);
    let bytes = select_unpredictable(is_above_2, three, bytes);
    let length = 1 + usize::from(is_above_1) + usize::from(is_above_2);
    (bytes.to_le_bytes(), length, 1)
}

/// Goes on up to the character that starts at `end` or later. Returns how many units it has read. It needs room for
/// the worst case and one byte more, and writes past what it pushes.
#[inline(always)]
fn encode_characters<T: CodeUnit>(units: &[T], end: usize, cursor: &mut Cursor<'_, u8>) -> usize {
    assert!(end <= units.len());
    let mut read = 0;
    while read < end {
        let (bytes, length, width) = encode(&units[read..]);
        cursor.push_prefix(&bytes, length);
        read += width;
    }
    read
}

/// There is room for all of it.
#[inline(always)]
fn encode_utf16(input: WithUtf8Len<'_, u16>, cursor: &mut Cursor<'_, u8>) {
    let result = cursor.lend(|it| simdutf::convert::utf16::to::utf8::with_errors::le(input, it));
    if !result.is_successful() {
        encode_replacing(input.slice(), result.count, cursor);
    }
}

/// The first `valid` units are well formed. The closer together the lone surrogates are, the longer the stretches
/// that are gone through by character.
#[cold]
fn encode_replacing(mut units: &[u16], mut valid: usize, cursor: &mut Cursor<'_, u8>) {
    const SHORTEST_STRETCH: usize = 32;
    let mut stretch = SHORTEST_STRETCH;
    loop {
        if valid > stretch {
            let (piece, rest) = units.split_at(valid);
            let input = WithUtf8Len::utf16(piece);
            cursor.lend(|it| simdutf::convert::utf16::to::utf8::with_errors::le(input, it));
            units = rest;
            stretch = SHORTEST_STRETCH;
        } else {
            stretch = (2 * stretch).min(PIECE - 1);
        }
        let (mut scratch, mut read) = ([MaybeUninit::uninit(); SCRATCH], 0);
        cursor.push_slice(Cursor::fill_uninit(&mut scratch, |it| {
            read = encode_characters(units, stretch.min(units.len()), it);
        }));
        units = &units[read..];
        if units.is_empty() {
            return;
        }
        valid = simdutf::validate::with_errors::utf16le(units).count;
    }
}

/// There is room for the worst case.
#[inline(always)]
fn encode_all<T: CodeUnit>(units: &[T], cursor: &mut Cursor<'_, u8>) {
    match T::text(units) {
        Text::Latin1(characters) => {
            let input = WithUtf8Len::latin1_worst_case(characters);
            cursor.lend(|it| simdutf::convert::latin1::to::utf8(input, it));
        }
        Text::Utf16(units) => {
            let input = WithUtf8Len::utf16_worst_case(units, cursor.remaining());
            encode_utf16(input.expect("room"), cursor);
        }
    }
}

/// Lends the bytes of a piece at most, which take fewer than `N` of them.
#[inline(always)]
fn with_encoded<T: CodeUnit, R, const N: usize>(units: &[T], take: impl FnOnce(&[u8]) -> R) -> R {
    let mut scratch = [MaybeUninit::uninit(); N];
    take(Cursor::fill_uninit(&mut scratch, |it| {
        if units.len() <= SHORT || cfg!(miri) {
            encode_characters(units, units.len(), it);
        } else {
            encode_all(units, it);
        }
    }))
}

/// Pushes the whole characters of a piece that fit. Returns how many units it has read if some did not.
#[inline(always)]
fn push_encoded<T: CodeUnit, const N: usize>(
    units: &[T],
    cursor: &mut Cursor<'_, u8>,
) -> Option<usize> {
    with_encoded::<T, _, N>(units, |bytes| {
        let mut end = cursor.remaining();
        if bytes.len() <= end {
            cursor.push_slice(bytes);
            return None;
        }
        while bytes[end] & 0xc0 == 0x80 {
            end -= 1;
        }
        cursor.push_slice(&bytes[..end]);
        let continuations = block::count(Units(&bytes[..end], |it: u8| it & 0xc0 == 0x80));
        Some(end - continuations + block::count(Units(&bytes[..end], |it: u8| it >= 0xf0)))
    })
}

/// `units` up to `at`, which is not zero, or one less so as not to split a surrogate pair, and the rest.
#[inline(always)]
fn split_between_characters<T: CodeUnit>(units: &[T], at: usize) -> (&[T], &[T]) {
    units.split_at(at - usize::from(at < units.len() && units[at - 1].is_lead_surrogate()))
}

/// Returns how many units it has read.
#[inline]
fn encode_fitting<T: CodeUnit>(units: &[T], cursor: &mut Cursor<'_, u8>) -> usize {
    if units.len() <= SHORT_FOR_TEST.min(cursor.remaining()) && ascii::is_ascii(units) {
        cursor.push_text(T::text(units));
        return units.len();
    }
    if units.len() <= cursor.remaining() / worst_case::<T>() && !cfg!(miri) {
        encode_all(units, cursor);
        return units.len();
    }
    if units.len() <= SHORT {
        return push_encoded::<T, SHORT_BYTES>(units, cursor).unwrap_or(units.len());
    }
    encode_in_pieces(units, cursor)
}

#[inline(never)]
fn encode_in_pieces<T: CodeUnit>(units: &[T], cursor: &mut Cursor<'_, u8>) -> usize {
    let mut rest = units;
    while let fitting @ PIECE.. = rest.len().min(cursor.remaining() / worst_case::<T>())
        && !cfg!(miri)
    {
        let piece;
        (piece, rest) = split_between_characters(rest, fitting);
        encode_all(piece, cursor);
    }
    while !rest.is_empty() {
        // One unit more than there are bytes left does not fit, whatever it is.
        let most = rest.len().min(PIECE).min(cursor.remaining() + 2);
        let (piece, after) = split_between_characters(rest, most);
        if let Some(read) = push_encoded::<T, SCRATCH>(piece, cursor) {
            return units.len() - rest.len() + read;
        }
        rest = after;
    }
    units.len()
}

#[inline]
fn utf8_len<T: CodeUnit>(units: &[T]) -> usize {
    match T::text(units) {
        _ if units.len() <= SHORT_FOR_LENGTH || cfg!(miri) => short_utf8_len(units),
        Text::Latin1(characters) => simdutf::length::utf8::from::latin1(characters),
        Text::Utf16(units) => simdutf::length::utf8::from::utf16::le_with_replacement(units),
    }
}

#[inline(always)]
fn short_utf8_len<T: CodeUnit>(units: &[T]) -> usize {
    let ascii = block::count(Units(units, T::is_ascii));
    if T::IS_LATIN1 || ascii == units.len() {
        return 2 * units.len() - ascii;
    }
    let length = 3 * units.len() - ascii - block::count(Units(units, |it: T| it.to_u16() < 0x800));
    if !block::any(Units(units, T::is_surrogate)) {
        return length;
    }
    length
        - 2 * block::count(Pairs::new(units, &units[1..], |a: T, b: T| {
            a.is_lead_surrogate() & b.is_trail_surrogate()
        }))
}

#[inline]
fn to_utf8<T: CodeUnit>(units: &[T]) -> Result<Vec<u8>, AllocError> {
    let mut bytes = Vec::new();
    if (T::IS_LATIN1 || units.len() <= SHORT_FOR_TEST) && ascii::is_ascii(units) {
        Cursor::extend_vec(&mut bytes, units.len(), |it| it.push_text(T::text(units)))?;
    } else if units.len() <= PIECE {
        with_encoded::<T, _, SCRATCH>(units, |encoded| {
            Cursor::extend_vec(&mut bytes, encoded.len(), |it| it.push_slice(encoded))
        })?;
    } else if cfg!(miri) {
        Cursor::extend_vec(&mut bytes, utf8_len(units), |it| {
            _ = encode_in_pieces(units, it)
        })?;
    } else {
        match T::text(units) {
            Text::Latin1(characters) => {
                let input = WithUtf8Len::latin1(characters);
                Cursor::extend_vec(&mut bytes, input.utf8_len(), |cursor| {
                    cursor.lend(|it| simdutf::convert::latin1::to::utf8(input, it));
                })?;
            }
            Text::Utf16(units) => {
                let input = WithUtf8Len::utf16_with_replacement(units);
                Cursor::extend_vec(&mut bytes, input.utf8_len(), |it| encode_utf16(input, it))?;
            }
        }
    }
    Ok(bytes)
}

impl<'a> Text<'a> {
    #[inline(always)]
    pub fn utf8_len(self) -> usize {
        with_text!(self, |units| utf8_len(units))
    }

    /// The characters themselves, if they are stored as UTF-8 has them.
    #[inline(always)]
    pub fn as_utf8(self) -> Option<&'a [u8]> {
        u8::units(self).filter(|characters| ascii::is_ascii(characters))
    }

    #[inline(always)]
    pub fn try_to_utf8(self) -> Result<Vec<u8>, AllocError> {
        with_text!(self, |units| to_utf8(units))
    }

    /// As many whole characters as fit. Returns how many units it has read.
    #[inline(always)]
    pub fn write_utf8(self, cursor: &mut Cursor<'_, u8>) -> usize {
        with_text!(self, |units| encode_fitting(units, cursor))
    }

    /// `encodeInto` of the Encoding Standard: as many whole characters as fit, and the rest of `target` as it was.
    #[inline(always)]
    pub fn encode_utf8_into(self, target: &mut [u8]) -> Progress {
        let mut read = 0;
        let written = Cursor::fill(target, |cursor| read = self.write_utf8(cursor));
        Progress { read, written }
    }
}
