//! The fields of an IEEE 754 binary64 value.

pub(crate) const FRACTION_BITS: u32 = 52;
pub(crate) const FRACTION_MASK: u64 = (1 << FRACTION_BITS) - 1;
pub(crate) const IMPLICIT_BIT: u64 = 1 << FRACTION_BITS;
pub(crate) const SIGN_BIT: u64 = 1 << 63;
pub(crate) const MAX_BIASED_EXPONENT: u32 = 0x7ff;
pub(crate) const EXPONENT_BIAS: i32 = 1023;
/// A normal value is its 53-bit significand times 2 to the biased exponent less this.
pub(crate) const SIGNIFICAND_BIAS: i32 = EXPONENT_BIAS + FRACTION_BITS as i32;
pub(crate) const MIN_EXPONENT: i32 = 1 - SIGNIFICAND_BIAS;

#[inline(always)]
pub(crate) const fn biased_exponent(bits: u64) -> u32 {
    (bits >> FRACTION_BITS) as u32 & MAX_BIASED_EXPONENT
}

/// The magnitude of a finite value as `significand * 2^exponent`.
#[inline]
pub(crate) const fn decompose(value: f64) -> (u64, i32) {
    let bits = value.to_bits();
    match biased_exponent(bits) {
        0 => (bits & FRACTION_MASK, MIN_EXPONENT),
        biased => (
            bits & FRACTION_MASK | IMPLICIT_BIT,
            biased as i32 - SIGNIFICAND_BIAS,
        ),
    }
}

/// `magnitude` has no sign.
#[inline(always)]
pub(crate) const fn with_sign(magnitude: f64, is_negative: bool) -> f64 {
    f64::from_bits(magnitude.to_bits() | (is_negative as u64) << 63)
}
