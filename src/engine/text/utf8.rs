//! From UTF-8.

use core::hint::select_unpredictable;
use core::io::BorrowedCursor;
use core::mem::MaybeUninit;

use bun_alloc::AllocError;
use bun_highway::utf8::{LEAST_ROOM, SLACK};
use bun_simdutf_sys::simdutf;

use crate::{Cursor, StringBuilder, StringRef, Text, ascii};

/// What is converted on the stack, where there is room for the worst case, and then copied.
const SCRATCH: usize = 1024;
/// The highest first byte of a character up to U+00FF.
const LAST_LATIN1_LEAD: u8 = 0xc3;
const REPLACEMENT: u32 = 0xfffd;
const TOP_BITS: u128 = u128::MAX / 0xff * 0x80;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Invalid {
    Stops,
    IsReplaced,
}

/// Of a string that is not ASCII.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Width {
    Narrowest,
    Utf16,
}

#[inline(always)]
fn is_continuation(byte: u8) -> bool {
    byte & 0xc0 == 0x80
}

/// For each byte the lowest that can follow it in a sequence, and how many can.
static SECOND_BYTES: [[u8; 2]; 256] = {
    let (mut ranges, mut first) = ([[0; 2]; 256], 0xc2);
    while first <= 0xf4 {
        ranges[first] = match first {
            0xe0 => [0xa0, 0x20],
            0xed => [0x80, 0x20],
            0xf0 => [0x90, 0x30],
            0xf4 => [0x80, 0x10],
            _ => [0x80, 0x40],
        };
        first += 1;
    }
    ranges
};

/// Whether the first two of `bytes`, which are not empty, belong together.
#[inline(always)]
fn starts_with_sequence(bytes: &[u8]) -> bool {
    let [lowest, count] = SECOND_BYTES[usize::from(bytes[0])];
    bytes.get(1).map_or(0, |&it| it).wrapping_sub(lowest) < count
}

/// The character that `bytes` start with and its length, if their first two belong together. The error is the length
/// of a sequence that ends early.
#[inline(always)]
fn decode_sequence(bytes: &[u8]) -> Result<(u32, usize), usize> {
    let bits = |byte: u8, mask: u8, shift: u32| u32::from(byte & mask) << shift;
    match *bytes {
        [a @ ..0xe0, b, ..] => Ok((bits(a, 0x1f, 6) | bits(b, 0x3f, 0), 2)),
        [a @ ..0xf0, b, c, ..] if is_continuation(c) => {
            Ok((bits(a, 0x0f, 12) | bits(b, 0x3f, 6) | bits(c, 0x3f, 0), 3))
        }
        [a, b, c, d, ..] if is_continuation(c) & is_continuation(d) => Ok((
            bits(a, 0x07, 18) | bits(b, 0x3f, 12) | bits(c, 0x3f, 6) | bits(d, 0x3f, 0),
            4,
        )),
        [_, _, c, ..] if is_continuation(c) => Err(3),
        _ => Err(2),
    }
}

/// The character above U+007F that `bytes` start with, and its length.
#[inline(always)]
pub(crate) fn decode_non_ascii(bytes: &[u8; 4]) -> Option<(u32, usize)> {
    starts_with_sequence(bytes).then(|| decode_sequence(bytes).ok())?
}

/// Goes on up to a character that starts at `end` or later. Returns how many bytes it has read. If what is invalid
/// stops it, so does what does not fit. Otherwise, or if `IS_MOSTLY_ASCII`, there is room for a unit for each byte.
#[inline(always)]
fn decode_characters<const IS_MOSTLY_ASCII: bool>(
    bytes: &[u8],
    end: usize,
    invalid: Invalid,
    cursor: &mut Cursor<'_, u16>,
) -> usize {
    assert!(end <= bytes.len());
    let mut read = 0;
    while read < end {
        if IS_MOSTLY_ASCII && let Some(word) = bytes[read..].first_chunk() {
            let top_bits = u64::from_le_bytes(*word) & TOP_BITS as u64;
            let ascii = top_bits.trailing_zeros() as usize / 8;
            cursor.push_mapped_prefix(word, ascii, u16::from);
            read += ascii;
            if top_bits == 0 {
                continue;
            }
        }
        let rest = &bytes[read..];
        let (code_point, length) = if starts_with_sequence(rest) {
            match decode_sequence(rest) {
                Ok(character) => character,
                Err(_) if invalid == Invalid::Stops => break,
                Err(length) => (REPLACEMENT, length),
            }
        } else if invalid == Invalid::Stops && !rest[0].is_ascii() {
            break;
        } else {
            let is_ascii = rest[0].is_ascii();
            (
                select_unpredictable(is_ascii, u32::from(rest[0]), REPLACEMENT),
                1,
            )
        };
        if invalid == Invalid::Stops && cursor.remaining() <= usize::from(code_point > 0xffff) {
            break;
        }
        cursor.push_code_point(code_point);
        read += length;
    }
    read
}

impl Cursor<'_, u16> {
    /// The longest start that is valid and fits. Returns how many bytes it has read. The room may be overwritten.
    #[inline(always)]
    pub fn push_valid_utf8(&mut self, bytes: &[u8]) -> usize {
        let read = self.push_start_of_utf8(bytes);
        if read == bytes.len() {
            return read;
        }
        read + self.push_valid_end(&bytes[read..])
    }

    /// The same for what the kernel has left.
    #[inline(never)]
    fn push_valid_end(&mut self, bytes: &[u8]) -> usize {
        const MOST: usize = 3 * LEAST_ROOM;
        if self.remaining() <= LEAST_ROOM && bytes.len() <= MOST {
            let (mut scratch, mut read) = ([MaybeUninit::uninit(); MOST + SLACK], 0);
            let units = Cursor::fill_uninit(&mut scratch, |it| read = it.push_start_of_utf8(bytes));
            if read == bytes.len() && units.len() <= self.remaining() {
                self.push_slice(units);
                return read;
            }
        }
        decode_characters::<false>(bytes, bytes.len(), Invalid::Stops, self)
    }

    /// There is room for a unit for each byte. The closer together the invalid sequences are, the longer the
    /// stretches that are gone through by character.
    #[cold]
    fn push_utf8_replacing(&mut self, mut bytes: &[u8]) {
        const SHORTEST_STRETCH: usize = 32;
        let mut stretch = SHORTEST_STRETCH;
        loop {
            let end = stretch.min(bytes.len());
            let has_few = |it| (u128::from_le_bytes(it) & TOP_BITS).count_ones() <= 2;
            let read = if bytes.first_chunk().copied().is_some_and(has_few) {
                decode_characters::<true>(bytes, end, Invalid::IsReplaced, self)
            } else {
                decode_characters::<false>(bytes, end, Invalid::IsReplaced, self)
            };
            bytes = &bytes[read..];
            if bytes.is_empty() {
                return;
            }
            let valid = self.push_start_of_utf8(bytes);
            bytes = &bytes[valid..];
            stretch = if valid > stretch {
                SHORTEST_STRETCH
            } else {
                (2 * stretch).min(SCRATCH)
            };
        }
    }
}

/// `bytes` up to the start of a sequence at or a little before `at`, which decode alike without the rest.
fn split_between_sequences(bytes: &[u8], at: usize) -> (&[u8], &[u8]) {
    let start = (at.saturating_sub(3)..=at)
        .rfind(|&start| bytes.get(start).is_none_or(|&byte| !is_continuation(byte)));
    bytes.split_at(start.unwrap_or(at))
}

/// No more than there are bytes.
#[inline(always)]
fn units_if_valid(bytes: &[u8]) -> usize {
    simdutf::length::utf16::from::utf8(bytes).min(bytes.len())
}

/// Lends the units of up to `SCRATCH` bytes. `None` if they are invalid and that stops it.
#[inline(always)]
fn with_decoded<R>(bytes: &[u8], invalid: Invalid, take: impl FnOnce(&[u16]) -> R) -> Option<R> {
    let (mut scratch, mut is_done) = ([MaybeUninit::uninit(); SCRATCH + SLACK], true);
    let units = Cursor::fill_uninit(&mut scratch, |it| {
        let rest = &bytes[it.push_start_of_utf8(bytes)..];
        if rest.is_empty() {
            return;
        }
        match invalid {
            Invalid::Stops => is_done = it.push_valid_end(rest) == rest.len(),
            Invalid::IsReplaced => it.push_utf8_replacing(rest),
        }
    });
    is_done.then(|| take(units))
}

impl StringBuilder {
    /// Each maximal invalid sequence becomes U+FFFD, as in the WHATWG decoder.
    #[inline]
    pub fn push_utf8_lossy(&mut self, bytes: &[u8]) {
        if ascii::is_ascii(bytes) {
            self.push_latin1_slice(bytes);
        } else {
            self.push_non_ascii_utf8(bytes, Invalid::IsReplaced);
        }
    }

    /// Returns false, having pushed a start of them, if the bytes are not UTF-8.
    #[inline]
    pub fn push_utf8(&mut self, bytes: &[u8]) -> bool {
        if (self.is_latin1() || bytes.len() <= SLACK) && ascii::is_ascii(bytes) {
            self.push_latin1_slice(bytes);
            return true;
        }
        self.push_non_ascii_utf8(bytes, Invalid::Stops)
    }

    /// Returns false if the bytes are invalid and that stops it.
    fn push_non_ascii_utf8(&mut self, mut bytes: &[u8], invalid: Invalid) -> bool {
        if self.has_room::<u16>(bytes.len().saturating_add(SLACK)) {
            self.write_in_spare(|it| bytes = &bytes[it.push_valid_utf8(bytes)..]);
        } else if bytes.len() > SCRATCH && !cfg!(miri) {
            if self.is_latin1() && ascii::find_above(bytes, LAST_LATIN1_LEAD).is_none() {
                self.grow(simdutf::length::latin1::from::utf8(bytes));
            } else {
                self.write_utf16(units_if_valid(bytes), |it| {
                    bytes = &bytes[it.push_valid_utf8(bytes)..]
                });
            }
        }
        while !bytes.is_empty() && !self.has_overflowed() {
            let piece;
            (piece, bytes) = split_between_sequences(bytes, bytes.len().min(SCRATCH));
            if with_decoded(piece, invalid, |units| self.push_utf16(units)).is_none() {
                return false;
            }
        }
        bytes.is_empty() || invalid == Invalid::IsReplaced || simdutf::validate::utf8(bytes)
    }
}

#[inline(always)]
fn from_utf8(
    bytes: &[u8],
    invalid: Invalid,
    width: Width,
) -> Result<Option<StringRef>, AllocError> {
    if ascii::is_ascii(bytes) {
        return StringRef::try_copy(Text::Latin1(bytes)).map(Some);
    }
    from_non_ascii_utf8(bytes, invalid, width)
}

fn from_non_ascii_utf8(
    bytes: &[u8],
    invalid: Invalid,
    width: Width,
) -> Result<Option<StringRef>, AllocError> {
    if bytes.len() <= SCRATCH {
        let copy = |units: &[u16]| {
            let text = Text::Utf16(units);
            if width == Width::Narrowest && text.fits_latin1() {
                StringRef::try_write::<u8>(text.len(), |cursor| cursor.push_text(text))
            } else {
                StringRef::try_write::<u16>(text.len(), |cursor| cursor.push_text(text))
            }
        };
        return with_decoded(bytes, invalid, copy).transpose();
    }
    let mut builder = StringBuilder::new();
    if width == Width::Utf16 {
        builder.widen(0);
    }
    if !builder.push_non_ascii_utf8(bytes, invalid) {
        return Ok(None);
    }
    builder.finish().map(Some)
}

/// Appends a start of `bytes`: the longest that is valid, if that fits. Returns how many bytes it has read. The rest
/// of `target` is as it was.
pub fn decode_valid_utf8(bytes: &[u8], mut target: BorrowedCursor<'_, u16>) -> usize {
    let mut rest = bytes;
    while !rest.is_empty() {
        let piece = split_between_sequences(rest, rest.len().min(SCRATCH)).0;
        let (mut scratch, mut read) = ([MaybeUninit::uninit(); SCRATCH + SLACK], 0);
        let units = Cursor::fill_uninit(&mut scratch, |it| read = it.push_valid_utf8(piece));
        if units.len() > target.capacity() {
            break;
        }
        target.append(units);
        rest = &rest[read..];
        if read < piece.len() {
            break;
        }
    }
    bytes.len() - rest.len()
}

/// Appends the longest start of `bytes` that is valid, having made room for all of valid bytes and `spare` units
/// more. Returns how many bytes it has read.
pub fn append_valid_utf8(
    bytes: &[u8],
    target: &mut Vec<u16>,
    spare: usize,
) -> Result<usize, AllocError> {
    let mut read = 0;
    if bytes.len() <= SCRATCH {
        let mut scratch = [MaybeUninit::uninit(); SCRATCH + SLACK];
        let units = Cursor::fill_uninit(&mut scratch, |it| read = it.push_valid_utf8(bytes));
        Cursor::extend_vec(target, units.len() + spare, |it| it.push_slice(units))?;
    } else {
        Cursor::extend_vec(target, units_if_valid(bytes) + spare, |it| {
            read = it.push_valid_utf8(bytes)
        })?;
    }
    Ok(read)
}

/// Each maximal invalid sequence becomes U+FFFD, as in the WHATWG decoder. Leaves room for `spare` units more.
pub fn append_utf8_lossy(
    bytes: &[u8],
    target: &mut Vec<u16>,
    spare: usize,
) -> Result<(), AllocError> {
    Cursor::extend_vec(target, bytes.len() + spare, |it| {
        it.push_utf8_replacing(bytes);
    })
}

/// How many bytes at the end are a sequence that more of them could complete.
pub fn unfinished_utf8_len(bytes: &[u8]) -> usize {
    match *bytes {
        [.., 0xc2..=0xf4] => 1,
        [.., a @ 0xe0..=0xf4, b] if starts_with_sequence(&[a, b]) => 2,
        [.., a @ 0xf0..=0xf4, b, c] if starts_with_sequence(&[a, b]) && is_continuation(c) => 3,
        _ => 0,
    }
}

impl StringRef {
    /// `Ok(None)` if the bytes are not UTF-8. Latin-1 if the characters allow it.
    #[inline]
    pub fn try_from_utf8(bytes: &[u8]) -> Result<Option<StringRef>, AllocError> {
        from_utf8(bytes, Invalid::Stops, Width::Narrowest)
    }

    /// Each maximal invalid sequence becomes U+FFFD, as in the WHATWG decoder. Latin-1 if the characters allow it.
    #[inline]
    pub fn try_from_utf8_lossy(bytes: &[u8]) -> Result<StringRef, AllocError> {
        from_utf8(bytes, Invalid::IsReplaced, Width::Narrowest).map(Option::unwrap_or_default)
    }

    /// `try_from_utf8`, but UTF-16 unless the characters are ASCII.
    pub fn try_wide_from_utf8(bytes: &[u8]) -> Result<Option<StringRef>, AllocError> {
        from_utf8(bytes, Invalid::Stops, Width::Utf16)
    }

    /// `try_from_utf8_lossy`, but UTF-16 unless the characters are ASCII.
    pub fn try_wide_from_utf8_lossy(bytes: &[u8]) -> Result<StringRef, AllocError> {
        from_utf8(bytes, Invalid::IsReplaced, Width::Utf16).map(Option::unwrap_or_default)
    }

    /// For text whose size no script picks.
    pub fn from_str(text: &str) -> StringRef {
        Self::try_from_utf8_lossy(text.as_bytes()).unwrap_or_else(|_| bun_alloc::out_of_memory())
    }
}
