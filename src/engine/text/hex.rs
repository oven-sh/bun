//! The text of `Uint8Array.fromHex`, `setFromHex` and `toHex`.

use bun_alloc::AllocError;

use crate::block::{self, Not, Units};
use crate::{BinarySyntaxError, CodeUnit, Cursor, Progress, StringRef, Text, with_text};

const NO_DIGIT: u8 = 0x80;

static DIGIT_VALUES: [u8; 256] = {
    let (mut values, mut value) = ([NO_DIGIT; 256], 0);
    while value < 16 {
        values[b"0123456789abcdef"[value] as usize] = value as u8;
        values[b"0123456789ABCDEF"[value] as usize] = value as u8;
        value += 1;
    }
    values
};

#[inline(always)]
pub(crate) fn decode_pair<T: CodeUnit>(high: T, low: T) -> Option<u8> {
    let value = |unit: T| DIGIT_VALUES[usize::from(unit.to_u16().min(0xff))];
    let (high, low) = (value(high), value(low));
    ((high | low) < NO_DIGIT).then_some(high << 4 | low)
}

#[inline(always)]
fn is_digit<T: CodeUnit>(unit: T) -> bool {
    unit.is_ascii_digit() | ((unit.to_u16() | 0x20).wrapping_sub(u16::from(b'a')) < 6)
}

/// As many pairs as fit, up to one that is invalid. Returns whether there is none among them.
#[inline(never)]
fn decode<T: CodeUnit>(units: &[T], to: &mut Cursor<'_, u8>) -> bool {
    /// What is tested is still in the cache when it is decoded.
    const PIECE: usize = 4096;
    let units = &units[..2 * (units.len() / 2).min(to.remaining())];
    for piece in units.chunks(PIECE) {
        let digits = block::first(Not(Units(piece, is_digit))).unwrap_or(piece.len());
        match T::text(&piece[..digits]) {
            Text::Latin1(digits) => to.push_mapped(digits.as_chunks().0, |pair| {
                let pair = u16::from_le_bytes(pair);
                let values = (pair & 0x0f0f) + (pair >> 6 & 0x0101) * 9;
                (values << 4 | values >> 8) as u8
            }),
            Text::Utf16(digits) => to.push_mapped(digits.as_chunks().0, |[high, low]| {
                let pair = u32::from(high) | u32::from(low) << 16;
                let values = (pair & 0x000f_000f) + (pair >> 6 & 0x0001_0001) * 9;
                (values << 4 | values >> 16) as u8
            }),
        }
        if digits < piece.len() {
            return false;
        }
    }
    true
}

impl Text<'_> {
    /// `fromHex`. There is room for half as many bytes as there are units.
    pub fn decode_hex(self, to: &mut Cursor<'_, u8>) -> Result<(), BinarySyntaxError> {
        if !self.len().is_multiple_of(2) {
            return Err(BinarySyntaxError::OddLengthForFromHex);
        }
        assert!(to.remaining() >= self.len() / 2);
        with_text!(self, |units| decode(units, to))
            .then_some(())
            .ok_or(BinarySyntaxError::NoDigitForFromHex)
    }

    /// `setFromHex`. What comes before an invalid pair is written, and the rest of `target` is as it was.
    pub fn decode_hex_into(self, target: &mut [u8]) -> Result<Progress, BinarySyntaxError> {
        let mut result = Ok(0);
        let written = Cursor::fill(target, |to| result = self.decode_hex_that_fits(to));
        result.map(|read| Progress { read, written })
    }

    /// The same, for a caller that wants to know what is written before an error. Returns how many units it has read.
    pub fn decode_hex_that_fits(self, to: &mut Cursor<'_, u8>) -> Result<usize, BinarySyntaxError> {
        if !self.len().is_multiple_of(2) {
            return Err(BinarySyntaxError::OddLengthForSetFromHex);
        }
        let room = to.remaining();
        with_text!(self, |units| decode(units, to))
            .then(|| 2 * (room - to.remaining()))
            .ok_or(BinarySyntaxError::NoDigitForSetFromHex)
    }
}

impl StringRef {
    /// `toHex`.
    pub fn try_hex_of(bytes: &[u8]) -> Result<StringRef, AllocError> {
        StringRef::try_write(bytes.len().saturating_mul(2), |to| {
            to.push_mapped_pairs(bytes, |byte| {
                let values = (u16::from(byte) >> 4 | u16::from(byte) << 8) & 0x0f0f;
                let letters = (values + 0x0606) >> 4 & 0x0101;
                (values + 0x3030 + letters * u16::from(b'a' - b'9' - 1)).to_le_bytes()
            });
        })
    }
}
