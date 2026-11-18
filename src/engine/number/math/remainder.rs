use crate::double::{
    FRACTION_BITS, FRACTION_MASK, IMPLICIT_BIT, MAX_BIASED_EXPONENT, SIGN_BIT, biased_exponent,
};

/// Number::remainder of ECMA-262.
pub fn remainder(dividend: f64, divisor: f64) -> f64 {
    const INTEGER_IN_LOW_BITS: f64 = IMPLICIT_BIT as f64;
    let (x, y) = (dividend.abs(), divisor.abs());
    if x < y {
        return dividend;
    }
    let (x_exponent, y_exponent) = (biased_exponent(x.to_bits()), biased_exponent(y.to_bits()));
    let distance = x_exponent.wrapping_sub(y_exponent);
    if distance >= FRACTION_BITS || y_exponent <= FRACTION_BITS || x_exponent == MAX_BIASED_EXPONENT
    {
        return dividend % divisor;
    }
    // The rounded quotient is below 2^52, and its integer part is right or one too many.
    let quotient =
        ((x / y).trunc() + INTEGER_IN_LOW_BITS).to_bits() - INTEGER_IN_LOW_BITS.to_bits();
    let x_significand = x.to_bits() & FRACTION_MASK | IMPLICIT_BIT;
    let y_significand = y.to_bits() & FRACTION_MASK | IMPLICIT_BIT;
    let rest =
        (x_significand << distance).wrapping_sub(quotient.wrapping_mul(y_significand)) as i64;
    let rest = rest + (rest >> 63 & y_significand as i64);
    let unit = f64::from_bits(u64::from(y_exponent - FRACTION_BITS) << FRACTION_BITS);
    f64::from_bits((rest as f64 * unit).to_bits() | dividend.to_bits() & SIGN_BIT)
}
