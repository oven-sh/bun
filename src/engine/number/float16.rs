//! IEEE 754 binary16 values, as their bits.

use crate::double::{EXPONENT_BIAS, FRACTION_BITS, SIGN_BIT};

const DROPPED_BITS: u32 = FRACTION_BITS - 10;
const REBIAS: u64 = ((EXPONENT_BIAS - 15) as u64) << FRACTION_BITS;
const INFINITY: u16 = 0x7c00;
const NAN: u16 = 0x7e00;
const MIN_NORMAL: f64 = 1.0 / (1 << 14) as f64;
/// Its unit in the last place is the smallest subnormal binary16 value.
const SUBNORMAL_IN_LOW_BITS: f64 = (1u64 << (FRACTION_BITS - 24)) as f64;

/// Rounds to nearest, ties to even.
#[inline]
pub fn float16_from_f64(value: f64) -> u16 {
    let sign = (value.to_bits() >> 48) as u16 & 0x8000;
    let magnitude = value.abs();
    sign | if magnitude < MIN_NORMAL {
        (magnitude + SUBNORMAL_IN_LOW_BITS).to_bits() as u16
    } else if magnitude < 65536.0 {
        let bits = magnitude.to_bits() - REBIAS;
        let just_below_half = (1 << (DROPPED_BITS - 1)) - 1;
        ((bits + just_below_half + (bits >> DROPPED_BITS & 1)) >> DROPPED_BITS) as u16
    } else if magnitude.is_nan() {
        NAN
    } else {
        INFINITY
    }
}

/// The exact value of a half-precision number.
#[inline]
pub fn float16_to_f64(bits: u16) -> f64 {
    let sign = u64::from(bits) << 48 & SIGN_BIT;
    let magnitude = u64::from(bits & 0x7fff);
    let magnitude = match bits & INFINITY {
        0 => {
            let shifted = f64::from_bits(SUBNORMAL_IN_LOW_BITS.to_bits() | magnitude);
            (shifted - SUBNORMAL_IN_LOW_BITS).to_bits()
        }
        INFINITY if bits & 0x3ff != 0 => return f64::NAN,
        INFINITY => f64::INFINITY.to_bits(),
        _ => (magnitude << DROPPED_BITS) + REBIAS,
    };
    f64::from_bits(sign | magnitude)
}
