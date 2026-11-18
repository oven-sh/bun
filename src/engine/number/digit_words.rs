//! Eight decimal digits in a word, the first one in the lowest byte.

use bun_engine_text::CodeUnit;

pub(crate) const ZEROS: u64 = u64::from_le_bytes([b'0'; 8]);

/// The digit values of a number below 10^8, the last one in the lowest byte.
#[inline(always)]
pub(crate) const fn spread_digits(number: u32) -> u64 {
    // `n + (2^k - d) * (n / d)` is `n / d` shifted up by `k` bits beside `n % d`.
    let number = number as u64;
    let fours = number + ((1 << 32) - 10_000) * ((number * 109_951_163) >> 40);
    let twos = fours + ((1 << 16) - 100) * (((fours * 5243) >> 19) & 0x0000_007f_0000_007f);
    twos + ((1 << 8) - 10) * (((twos * 103) >> 10) & 0x000f_000f_000f_000f)
}

/// The characters of the result of `spread_digits`.
#[inline(always)]
pub(crate) const fn to_characters(spread: u64) -> u64 {
    spread.swap_bytes() | ZEROS
}

/// The characters of a number below 10^8, with leading zeros.
#[inline(always)]
pub(crate) const fn eight_digits(number: u32) -> u64 {
    to_characters(spread_digits(number))
}

/// The upper and the lower eight digits of a number below 10^16.
#[inline(always)]
pub(crate) const fn split_sixteen_digits(number: u64) -> (u32, u32) {
    ((number / 100_000_000) as u32, (number % 100_000_000) as u32)
}

/// A unit above 0xff becomes zero or 0xff.
#[inline(always)]
pub(crate) fn load<T: CodeUnit>(units: &[T; 8]) -> u64 {
    u64::from_le_bytes(units.map(|unit| (unit.to_u16() as i16).clamp(0, 0xff) as u8))
}

/// The top bit of the first byte that is not a digit is the lowest bit set.
#[inline(always)]
pub(crate) const fn non_digits(characters: u64) -> u64 {
    (characters.wrapping_add(0x4646_4646_4646_4646) | characters.wrapping_sub(ZEROS))
        & 0x8080_8080_8080_8080
}

/// The number that eight digit values spell.
#[inline(always)]
pub(crate) const fn gather_digits(digits: u64) -> u64 {
    const MASK: u64 = 0x0000_00ff_0000_00ff;
    let twos = digits.wrapping_mul(10).wrapping_add(digits >> 8);
    let first_and_third = (twos & MASK).wrapping_mul(100 + (1_000_000 << 32));
    let second_and_fourth = ((twos >> 16) & MASK).wrapping_mul(1 + (10_000 << 32));
    first_and_third.wrapping_add(second_and_fourth) >> 32
}

#[inline(always)]
pub(crate) fn store<const N: usize>(out: &mut [u8; N], at: usize, characters: u64) {
    out[at..at + 8].copy_from_slice(&characters.to_le_bytes());
}
