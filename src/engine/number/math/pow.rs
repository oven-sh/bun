use core::hint::select_unpredictable;

use crate::exact_int32;

/// Compiled code that multiplies in line has to stop at the same exponent to give the same results.
pub const MAX_EXPONENT_BY_SQUARING: i32 = 1000;

/// Number::exponentiate of ECMA-262.
pub fn pow(base: f64, exponent: f64) -> f64 {
    portable_pow(base, exponent).unwrap_or_else(|| base.powf(exponent))
}

/// The same, where it is the same on all platforms.
#[inline(always)]
pub fn portable_pow(base: f64, exponent: f64) -> Option<f64> {
    let magnitude = base.abs();
    if exponent.is_nan() || (magnitude == 1.0 && exponent.is_infinite()) {
        return Some(f64::NAN);
    }
    if exponent.abs() == 0.5 {
        let is_own_root = magnitude == 0.0 || magnitude == f64::INFINITY;
        let root = if is_own_root { magnitude } else { base.sqrt() };
        return Some(if exponent > 0.0 { root } else { 1.0 / root });
    }
    match exact_int32(exponent + 0.0)? {
        integer @ 0..=MAX_EXPONENT_BY_SQUARING => Some(pow_by_squaring(base, integer as u32)),
        _ => None,
    }
}

/// What `pow` gives for an exponent from 0 to `MAX_EXPONENT_BY_SQUARING`.
#[inline]
pub fn pow_by_squaring(mut base: f64, mut exponent: u32) -> f64 {
    let mut result = 1.0;
    while exponent != 0 {
        let factor = select_unpredictable(exponent & 1 != 0, base.to_bits(), 1f64.to_bits());
        result *= f64::from_bits(factor);
        base *= base;
        exponent >>= 1;
    }
    result
}
