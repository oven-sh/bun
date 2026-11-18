//! A double rounded to a given number of decimal digits. Ties go away from zero.

use core::iter::once;

use crate::digit_words::{eight_digits, store};
use crate::double::decompose;
use crate::expansion::{BLOCK_DIGITS, Expansion};
use crate::integer_text::decimal_length;
use crate::powers_of_ten::{
    SMALL_POWERS, floor_log2_of_power_of_ten, floor_log10_of_power_of_two, power_of_ten,
};
use crate::sixteen_digits::write_sixteen_digits;

/// So many digits come out of one product with a power of ten.
pub(crate) const MAX_SCALED_DIGITS: usize = 17;

/// The magnitude of a finite nonzero value as an integer of `count` digits, and how many of them precede the point. See
/// Cox, "Floating-point printing and parsing can be simple and fast", for why 128 bits of the power are enough.
#[inline]
pub(crate) fn round_by_scaling(value: f64, count: usize) -> (u64, i32) {
    let (significand, exponent) = decompose(value);
    let leading_zeros = significand.leading_zeros();
    let top_bit = exponent + 63 - leading_zeros as i32;
    // The value has this many digits before the point, or one more.
    let mut point = floor_log10_of_power_of_two(top_bit) + 1;
    let n = count as i32 - point;
    let power = power_of_ten(n);
    let normalized = u128::from(significand << leading_zeros);
    let product =
        normalized * u128::from(power.high) + ((normalized * u128::from(power.low)) >> 64);
    let doubled = (product >> 64) as u64 >> (61 - top_bit - floor_log2_of_power_of_ten(n));
    let limit = SMALL_POWERS[count];
    let mut digits = doubled.div_ceil(2);
    if doubled >= 2 * limit {
        digits = (doubled / 2 + 5) / 10;
        point += 1;
    }
    if digits == limit {
        digits /= 10;
        point += 1;
    }
    (digits, point)
}

/// 21 digits before the point and 100 after it, the one that decides the rounding, and what blocks leave unused.
pub(crate) struct DigitBuffer([u8; 8 * BLOCK_DIGITS]);

impl DigitBuffer {
    pub(crate) const ZEROS: DigitBuffer = DigitBuffer([b'0'; _]);
}

/// The characters `d1d2d3...` and the `point` that make the magnitude of a finite value `0.d1d2d3... * 10^point`, where
/// `count` says how many digits to keep given the point. Zero has the point after one digit.
pub(crate) fn round_exactly(
    value: f64,
    count: impl Fn(i32) -> i32,
    DigitBuffer(buffer): &mut DigitBuffer,
) -> (&[u8], i32) {
    let (significand, exponent) = decompose(value);
    let max_point = floor_log10_of_power_of_two(exponent + 53) + 1;
    if significand == 0 || count(max_point) < 0 {
        return (buffer, 1);
    }
    let mut expansion = Expansion::new(significand, exponent);
    let first = expansion.next().unwrap_or(0);
    let start = BLOCK_DIGITS - decimal_length(first);
    let point = expansion.point() - start as i32;
    let Ok(count) = usize::try_from(count(point)) else {
        return (buffer, 1);
    };
    let targets = &mut buffer.as_chunks_mut().0[..=(start + count) / BLOCK_DIGITS];
    for (target, block) in targets.iter_mut().zip(once(first).chain(expansion)) {
        write_block(block, target);
    }
    let digits = &mut buffer[start..];
    if digits[count] < b'5' {
        return (digits, point);
    }
    for digit in digits[..count].iter_mut().rev() {
        if *digit != b'9' {
            *digit += 1;
            return (digits, point);
        }
        *digit = b'0';
    }
    digits[count] = b'0';
    digits[0] = b'1';
    (digits, point + 1)
}

fn write_block(block: u64, out: &mut [u8; BLOCK_DIGITS]) {
    let sixteen_digits = SMALL_POWERS[16];
    store(out, 0, eight_digits((block / sixteen_digits) as u32) >> 40);
    if let Some(lower) = out.last_chunk_mut() {
        write_sixteen_digits(block % sixteen_digits, lower);
    }
}
