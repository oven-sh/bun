//! The text of `Uint8Array.fromBase64`, `setFromBase64` and `toBase64`.

use core::mem::MaybeUninit;

use bun_alloc::AllocError;
use bun_simdutf_sys::simdutf;

use crate::{CodeUnit, Cursor, Progress, StringRef, Text, with_text};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Base64Alphabet {
    Standard,
    Url,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LastChunkHandling {
    Loose,
    Strict,
    StopBeforePartial,
}

/// A SyntaxError.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BinarySyntaxError {
    InvalidForFromBase64,
    InvalidForSetFromBase64,
    OddLengthForFromHex,
    OddLengthForSetFromHex,
    NoDigitForFromHex,
    NoDigitForSetFromHex,
}

impl BinarySyntaxError {
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidForFromBase64 => "Uint8Array.fromBase64 requires a valid base64 string",
            Self::InvalidForSetFromBase64 => {
                "Uint8Array.prototype.setFromBase64 requires a valid base64 string"
            }
            Self::OddLengthForFromHex => "Uint8Array.fromHex requires a string of even length",
            Self::OddLengthForSetFromHex => {
                "Uint8Array.prototype.setFromHex requires a string of even length"
            }
            Self::NoDigitForFromHex => {
                "Uint8Array.prototype.fromHex requires a string containing only \"0123456789abcdefABCDEF\""
            }
            Self::NoDigitForSetFromHex => {
                "Uint8Array.prototype.setFromHex requires a string containing only \"0123456789abcdefABCDEF\""
            }
        }
    }
}

/// Up to so many characters the vector code does not make up for the call.
const SHORT: usize = 96;
const SCRATCH: usize = 3072;

const STANDARD: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const WHITE_SPACE: u8 = 0x80;
const PADDING: u8 = 0x81;
const INVALID: u8 = 0x82;

const fn values(alphabet: &[u8; 64]) -> [u8; 256] {
    let (mut values, mut value) = ([INVALID; 256], 0);
    while value < alphabet.len() {
        values[alphabet[value] as usize] = value as u8;
        value += 1;
    }
    let mut spaces: &[u8] = b"\t\n\x0c\r ";
    while let [space, rest @ ..] = spaces {
        values[*space as usize] = WHITE_SPACE;
        spaces = rest;
    }
    values[b'=' as usize] = PADDING;
    values
}

impl Base64Alphabet {
    fn characters(self) -> &'static [u8; 64] {
        match self {
            Base64Alphabet::Standard => STANDARD,
            Base64Alphabet::Url => URL,
        }
    }

    fn values(self) -> &'static [u8; 256] {
        match self {
            Base64Alphabet::Standard => &const { values(STANDARD) },
            Base64Alphabet::Url => &const { values(URL) },
        }
    }
}

struct Invalid;

/// Whose memory is written.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Target {
    /// It has room for everything, and nobody looks past what is written.
    New,
    /// Its size is the maxLength of FromBase64.
    Existing,
}

struct Decoder<'a, T> {
    units: &'a [T],
    alphabet: Base64Alphabet,
    values: &'static [u8; 256],
    target: Target,
}

impl<T: CodeUnit> Decoder<'_, T> {
    #[inline(always)]
    fn value(&self, unit: T) -> u8 {
        self.values[usize::from(unit.to_u16().min(0xff))]
    }

    fn skip_white_space(&self, mut at: usize) -> usize {
        while (self.units.get(at)).is_some_and(|&unit| self.value(unit) == WHITE_SPACE) {
            at += 1;
        }
        at
    }

    /// Whole chunks from the start that fit, but perhaps not all. Returns the index after the last of them.
    fn decode_long(&self, to: &mut Cursor<'_, u8>) -> usize {
        let is_url = self.alphabet == Base64Alphabet::Url;
        let decode = |piece: &[T], to: &mut Cursor<'_, u8>| {
            to.lend(|it| match T::text(piece) {
                Text::Latin1(piece) => simdutf::base64::decode_whole_chunks(piece, it, is_url),
                Text::Utf16(piece) => simdutf::base64::decode_whole_chunks16(piece, it, is_url),
            })
        };
        let mut at = 0;
        loop {
            let piece = &self.units[at..];
            let piece = &piece[..piece.len().min(to.remaining() / 3 * 4) / 4 * 4];
            if piece.len() <= SHORT {
                break;
            }
            let read = if self.target == Target::New {
                decode(piece, to)
            } else {
                // The vector code may write past what it decodes.
                let piece = &piece[..piece.len().min(SCRATCH / 3 * 4)];
                let (mut scratch, mut read) = ([MaybeUninit::uninit(); SCRATCH], None);
                to.push_slice(Cursor::fill_uninit(&mut scratch, |it| {
                    read = decode(piece, it)
                }));
                read
            };
            match read {
                Some(read @ 1..) => at += read,
                _ => break,
            }
        }
        (self.units[..at].iter())
            .rposition(|&unit| self.value(unit) != WHITE_SPACE)
            .map_or(0, |last| last + 1)
    }

    /// Chunks without white space from `at` that fit. Returns the index after the last of them.
    #[inline(always)]
    fn decode_plain(&self, mut at: usize, to: &mut Cursor<'_, u8>) -> usize {
        while let Some(&[a, b, c, d]) = self.units[at..].first_chunk()
            && to.remaining() >= 3
        {
            let (a, b, c, d) = (self.value(a), self.value(b), self.value(c), self.value(d));
            if a | b | c | d >= WHITE_SPACE {
                break;
            }
            to.push_array([a << 2 | b >> 4, b << 4 | c >> 2, c << 6 | d]);
            at += 4;
        }
        at
    }

    /// FromBase64 of ECMA-262. Returns `read`.
    #[inline(never)]
    fn decode(&self, last: LastChunkHandling, to: &mut Cursor<'_, u8>) -> Result<usize, Invalid> {
        let length = self.units.len();
        let is_limited = self.target == Target::Existing;
        let mut read = if length > SHORT && !cfg!(miri) {
            self.decode_long(to)
        } else {
            0
        };
        loop {
            read = self.decode_plain(read, to);
            if is_limited && to.remaining() == 0 {
                return Ok(read);
            }
            let (mut at, mut bits, mut count) = (read, 0u32, 0);
            while count < 4 {
                at = self.skip_white_space(at);
                let Some(&unit) = self.units.get(at) else {
                    return match (count, last) {
                        (0, _) => Ok(length),
                        (_, LastChunkHandling::StopBeforePartial) => Ok(read),
                        (1, _) | (_, LastChunkHandling::Strict) => Err(Invalid),
                        _ => {
                            push_last_chunk(bits, count, to);
                            Ok(length)
                        }
                    };
                };
                at += 1;
                match self.value(unit) {
                    PADDING if count >= 2 => {
                        at = self.skip_white_space(at);
                        if count == 2 {
                            match self.units.get(at) {
                                None if last == LastChunkHandling::StopBeforePartial => {
                                    return Ok(read);
                                }
                                Some(next) if next.is(b'=') => at = self.skip_white_space(at + 1),
                                _ => return Err(Invalid),
                            }
                        }
                        let extra = bits & ((1 << (6 * count % 8)) - 1);
                        if at < length || (last == LastChunkHandling::Strict && extra != 0) {
                            return Err(Invalid);
                        }
                        push_last_chunk(bits, count, to);
                        return Ok(length);
                    }
                    WHITE_SPACE.. => return Err(Invalid),
                    _ if is_limited && count > to.remaining() => return Ok(read),
                    value => (bits, count) = (bits << 6 | u32::from(value), count + 1),
                }
            }
            let [_, a, b, c] = bits.to_be_bytes();
            to.push_array([a, b, c]);
            read = at;
        }
    }
}

/// `count` is 2 or 3.
fn push_last_chunk(bits: u32, count: usize, to: &mut Cursor<'_, u8>) {
    let [_, bytes @ ..] = (bits << (6 * (4 - count))).to_be_bytes();
    to.push_slice(&bytes[..count - 1]);
}

#[inline(always)]
fn decode(
    text: Text<'_>,
    alphabet: Base64Alphabet,
    last: LastChunkHandling,
    target: Target,
    to: &mut Cursor<'_, u8>,
) -> Result<usize, Invalid> {
    let values = alphabet.values();
    with_text!(text, |units| Decoder {
        units,
        alphabet,
        values,
        target
    }
    .decode(last, to))
}

impl Text<'_> {
    /// The most bytes that the text stands for. It stands for fewer if it has white space.
    pub fn base64_decoded_capacity(self) -> usize {
        let characters = self.len() - self.trailing_len(|unit| unit.is(b'='));
        characters / 4 * 3 + (characters % 4).saturating_sub(1)
    }

    /// `fromBase64`. There is room for `base64_decoded_capacity` bytes, all of which may be overwritten.
    pub fn decode_base64(
        self,
        alphabet: Base64Alphabet,
        last: LastChunkHandling,
        to: &mut Cursor<'_, u8>,
    ) -> Result<(), BinarySyntaxError> {
        match decode(self, alphabet, last, Target::New, to) {
            Ok(_) => Ok(()),
            Err(Invalid) => Err(BinarySyntaxError::InvalidForFromBase64),
        }
    }

    /// `setFromBase64`. The chunks before an error are written, and the rest of `target` is as it was.
    pub fn decode_base64_into(
        self,
        alphabet: Base64Alphabet,
        last: LastChunkHandling,
        target: &mut [u8],
    ) -> Result<Progress, BinarySyntaxError> {
        let mut result = Ok(0);
        let written = Cursor::fill(target, |to| {
            result = self.decode_base64_that_fits(alphabet, last, to);
        });
        result.map(|read| Progress { read, written })
    }

    /// The same, for a caller that wants to know what is written before an error. Returns how many units it has read.
    pub fn decode_base64_that_fits(
        self,
        alphabet: Base64Alphabet,
        last: LastChunkHandling,
        to: &mut Cursor<'_, u8>,
    ) -> Result<usize, BinarySyntaxError> {
        decode(self, alphabet, last, Target::Existing, to)
            .map_err(|Invalid| BinarySyntaxError::InvalidForSetFromBase64)
    }
}

impl StringRef {
    /// `toBase64`.
    pub fn try_base64_of(
        bytes: &[u8],
        alphabet: Base64Alphabet,
        omits_padding: bool,
    ) -> Result<StringRef, AllocError> {
        let (chunks, last) = bytes.as_chunks::<3>();
        let (used, padding) = match last.len() {
            0 => (0, 0),
            count if omits_padding => (count + 1, 0),
            count => (count + 1, 3 - count),
        };
        let characters = alphabet.characters();
        let encode = |[a, b, c]: [u8; 3]| {
            let character = |value: u8| characters[usize::from(value & 63)];
            [
                character(a >> 2),
                character(a << 4 | b >> 4),
                character(b << 2 | c >> 6),
                character(c),
            ]
        };
        StringRef::try_write(4 * chunks.len() + used + padding, |to| {
            if 4 * chunks.len() <= SHORT || cfg!(miri) {
                chunks
                    .iter()
                    .for_each(|&chunk| to.push_array(encode(chunk)));
            } else {
                let is_url = alphabet == Base64Alphabet::Url;
                to.lend(|it| simdutf::base64::encode(chunks.as_flattened(), it, is_url));
            }
            if let [a, rest @ ..] = last {
                let b = rest.first().copied().unwrap_or_default();
                to.push_slice(&encode([*a, b, 0])[..used]);
                to.push_repeated(b'=', padding);
            }
        })
    }
}
