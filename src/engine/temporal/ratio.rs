/// The nearest double to `numerator / denominator`, where the denominator is positive and below 2^72.
pub(crate) fn nearest_double(numerator: i128, denominator: i128) -> f64 {
    const EXACT: u128 = 1 << f64::MANTISSA_DIGITS;
    /// The significand, the bit that decides the rounding and one that records a remainder.
    const QUOTIENT_BITS: u32 = f64::MANTISSA_DIGITS + 2;

    let (dividend, divisor) = (numerator.unsigned_abs(), denominator.unsigned_abs());
    if dividend <= EXACT && divisor <= EXACT {
        return numerator as i64 as f64 / denominator as i64 as f64;
    }
    if dividend == 0 {
        return 0.0;
    }
    let shift = (QUOTIENT_BITS + dividend.leading_zeros()).saturating_sub(divisor.leading_zeros());
    let scaled = dividend << shift;
    let quotient = (scaled / divisor) | u128::from(scaled % divisor != 0);
    let scale = f64::from_bits(u64::from(1023 - shift) << 52);
    let magnitude = quotient as f64 * scale;
    if numerator < 0 { -magnitude } else { magnitude }
}
