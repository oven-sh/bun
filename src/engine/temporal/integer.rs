use crate::{Error, Result};

/// ToIntegerWithTruncation. A magnitude that no field can have is reduced by a multiple of 400, so that it stays out of
/// range and a leap year stays one.
#[inline]
pub fn to_integer_with_truncation(number: f64, not_finite: Error) -> Result<i32> {
    const LIMIT: i32 = 1_000_000_000;
    if number.abs() < f64::from(LIMIT) {
        return Ok(number as i32);
    }
    if !number.is_finite() {
        return Err(not_finite);
    }
    let reduced = LIMIT + (number.abs() % 400.0) as i32;
    Ok(if number < 0.0 { -reduced } else { reduced })
}

/// The greatest `u8` stands for everything above it.
#[inline]
pub(crate) fn saturate(value: i32) -> u8 {
    value.clamp(0, i32::from(u8::MAX)) as u8
}
