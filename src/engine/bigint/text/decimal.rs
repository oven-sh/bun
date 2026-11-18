//! Decimal characters, eight at a time.

use bun_engine_text::CodeUnit;

use super::{packed, repeated};

pub(super) const CHUNK_LENGTH: usize = 19;
const TEN_TO_THE_EIGHTH: u64 = 100_000_000;

/// Halves the number of decimal places in each lane three times. The multiplications divide by 100 and by 10.
#[inline(always)]
fn eight_characters(value: u32) -> [u8; 8] {
    let fours = u64::from(value / 10_000) | u64::from(value % 10_000) << 32;
    let hundreds = (fours * 10_486) >> 20 & 0x0000_007f_0000_007f;
    let twos = hundreds | (fours - hundreds * 100) << 16;
    let tens = (twos * 103) >> 10 & 0x000f_000f_000f_000f;
    let ones = tens | (twos - tens * 10) << 8;
    (ones | repeated(b'0')).to_le_bytes()
}

/// `value < 10^19`
#[inline(always)]
pub(super) fn write_chunk(out: &mut [u8; CHUNK_LENGTH], value: u64) {
    let (upper, low) = (value / TEN_TO_THE_EIGHTH, value % TEN_TO_THE_EIGHTH);
    let (high, middle) = (upper / TEN_TO_THE_EIGHTH, upper % TEN_TO_THE_EIGHTH);
    let (hundreds, rest) = (high as u32 / 100, high as u32 % 100);
    out[..3].copy_from_slice(&[hundreds, rest / 10, rest % 10].map(|digit| b'0' + digit as u8));
    out[3..11].copy_from_slice(&eight_characters(middle as u32));
    out[11..].copy_from_slice(&eight_characters(low as u32));
}

/// Writes at the end of `out`, and returns where the text starts. It takes 20 characters at most.
#[inline]
pub(super) fn write_digit<const N: usize>(out: &mut [u8; N], mut value: u64) -> usize {
    let mut start = out.len();
    loop {
        start -= 8;
        let group = eight_characters((value % TEN_TO_THE_EIGHTH) as u32);
        out[start..][..8].copy_from_slice(&group);
        value /= TEN_TO_THE_EIGHTH;
        if value == 0 {
            let zeros = (u64::from_le_bytes(group) ^ repeated(b'0') | 1 << 56).trailing_zeros();
            return start + zeros as usize / 8;
        }
    }
}

#[inline(always)]
fn read_eight<T: CodeUnit>(units: &[T; 8]) -> Option<u64> {
    let ones = packed(units) ^ repeated(b'0');
    if (ones | ones.wrapping_add(repeated(6))) & repeated(0xf0) != 0 {
        return None;
    }
    let twos = (ones.wrapping_mul(10 << 8 | 1) >> 8) & 0x00ff_00ff_00ff_00ff;
    let fours = (twos.wrapping_mul(100 << 16 | 1) >> 16) & 0x0000_ffff_0000_ffff;
    Some(fours.wrapping_mul(10_000 << 32 | 1) >> 32)
}

/// At most [`CHUNK_LENGTH`] characters.
#[inline(always)]
pub(super) fn read_chunk<T: CodeUnit>(units: &[T]) -> Option<u64> {
    let (first, groups) = units.as_rchunks::<8>();
    let value = first.iter().try_fold(0, |value, unit| {
        let digit = unit.to_u32().wrapping_sub(u32::from(b'0'));
        (digit < 10).then(|| value * 10 + u64::from(digit))
    })?;
    groups.iter().try_fold(value, |value, group| {
        Some(value * TEN_TO_THE_EIGHTH + read_eight(group)?)
    })
}
