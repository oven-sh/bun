//! Every decimal digit of a binary number.

use core::hint::select_unpredictable;

use crate::powers_of_ten::floor_log10_of_power_of_two;

pub(crate) const BLOCK_DIGITS: usize = 19;
const BLOCK: u64 = 10_000_000_000_000_000_000;
/// 2^1025 has 309 digits. A value that is scaled past the zeros after its point has at most 768 binary places.
const WORDS: usize = 17;

/// Yields blocks of 19 digits, the most significant first, until only zeros are left. The first is not zero.
pub(crate) struct Expansion {
    /// At the start the integer part in base 10^19, at the end the fraction in base 2^64, the least significant first.
    words: [u64; WORDS],
    whole_count: usize,
    fraction_start: usize,
    point: i32,
}

impl Expansion {
    /// `significand * 2^exponent`, from 2^-1075 to below 2^1025, with a significand below 2^54.
    #[inline]
    pub(crate) fn new(significand: u64, exponent: i32) -> Expansion {
        let mut expansion = Expansion {
            words: [0; WORDS],
            whole_count: 0,
            fraction_start: WORDS,
            point: 0,
        };
        let places = exponent.unsigned_abs();
        if exponent >= 0 {
            expansion.set_integer(significand, places as usize);
        } else if let whole @ 1.. = significand.unbounded_shr(places) {
            expansion.words[0] = whole;
            expansion.whole_count = 1;
            expansion.point = BLOCK_DIGITS as i32;
            expansion.fraction_start = WORDS - 1;
            expansion.words[WORDS - 1] = significand << (64 - places);
        } else {
            expansion.set_fraction(significand, places);
        }
        expansion
    }

    fn set_integer(&mut self, significand: u64, shift: usize) {
        let mut limbs = [0u64; 17];
        let shifted = u128::from(significand) << (shift % 64);
        limbs[shift / 64] = shifted as u64;
        limbs[shift / 64 + 1] = (shifted >> 64) as u64;
        let mut count = shift / 64 + 2;
        while count > 0 {
            if limbs[count - 1] == 0 {
                count -= 1;
                continue;
            }
            let mut remainder = 0;
            for limb in limbs[..count].iter_mut().rev() {
                (*limb, remainder) = divide_by_block(remainder, *limb);
            }
            self.words[self.whole_count] = remainder;
            self.whole_count += 1;
        }
        self.point = (self.whole_count * BLOCK_DIGITS) as i32;
    }

    /// `significand / 2^places`, which is below one.
    fn set_fraction(&mut self, significand: u64, places: u32) {
        const LARGEST_POWER: u32 = 27;
        let bits = 64 - significand.leading_zeros();
        let zeros = (-1 - floor_log10_of_power_of_two(bits as i32 - places as i32)).max(0) as u32;
        self.point = -(zeros as i32);

        // Times 10^zeros: the fives multiply the significand and the twos move the point.
        let places = places - zeros;
        let limbs = places.div_ceil(64);
        self.fraction_start -= limbs as usize;
        let shifted = u128::from(significand) << (limbs * 64 - places);
        let fraction = &mut self.words[self.fraction_start..];
        fraction[0] = shifted as u64;
        let mut count = 1;
        let mut carry = (shifted >> 64) as u64;
        let mut fives = zeros;
        loop {
            if carry != 0 {
                fraction[count] = carry;
                count += 1;
            }
            if fives == 0 {
                break;
            }
            let step = fives.min(LARGEST_POWER);
            carry = multiply(&mut fraction[..count], 5u64.pow(step));
            fives -= step;
        }
    }

    /// How many digits of the blocks precede the decimal point.
    pub(crate) fn point(&self) -> i32 {
        self.point
    }
}

impl Iterator for Expansion {
    type Item = u64;

    #[inline]
    fn next(&mut self) -> Option<u64> {
        if self.whole_count > 0 {
            self.whole_count -= 1;
            return Some(self.words[self.whole_count]);
        }
        while *self.words.get(self.fraction_start)? == 0 {
            self.fraction_start += 1;
        }
        Some(multiply(&mut self.words[self.fraction_start..], BLOCK))
    }
}

/// Returns the limb that is carried out.
#[inline]
pub(crate) fn multiply(limbs: &mut [u64], factor: u64) -> u64 {
    let mut carry = 0;
    for limb in limbs {
        (*limb, carry) = limb.carrying_mul(factor, carry);
    }
    carry
}

/// Quotient and remainder of `high * 2^64 + low`, with `high` below the divisor. Möller and Granlund, "Improved
/// division by invariant integers".
#[inline]
fn divide_by_block(high: u64, low: u64) -> (u64, u64) {
    const RECIPROCAL: u64 = (u128::MAX / BLOCK as u128 - (1 << 64)) as u64;
    let estimate =
        u128::from(RECIPROCAL) * u128::from(high) + (u128::from(high) << 64 | u128::from(low));
    let quotient = ((estimate >> 64) as u64).wrapping_add(1);
    let remainder = low.wrapping_sub(quotient.wrapping_mul(BLOCK));
    let is_too_large = remainder > estimate as u64;
    let mut quotient = quotient.wrapping_sub(u64::from(is_too_large));
    let mut remainder = remainder.wrapping_add(select_unpredictable(is_too_large, BLOCK, 0));
    if remainder >= BLOCK {
        quotient += 1;
        remainder -= BLOCK;
    }
    (quotient, remainder)
}
