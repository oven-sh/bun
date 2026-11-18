use crate::{BigIntRef, Error, Fill, Filled, New, Poll, SmallBigInt, digits};

const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

impl BigIntRef<'_> {
    /// ToBigUint64 of ECMA-262: modulo 2^64.
    #[inline(always)]
    pub fn to_u64_wrapping(self) -> u64 {
        let low = self.digits.first().copied().unwrap_or(0);
        if self.is_negative {
            low.wrapping_neg()
        } else {
            low
        }
    }

    /// ToBigInt64 of ECMA-262.
    #[inline(always)]
    pub fn to_i64_wrapping(self) -> i64 {
        self.to_u64_wrapping() as i64
    }

    #[inline]
    pub fn to_u64(self) -> Option<u64> {
        (self.digits.len() <= 1 && !self.is_negative).then(|| self.to_u64_wrapping())
    }

    #[inline]
    pub fn to_i64(self) -> Option<i64> {
        let wrapped = self.to_i64_wrapping();
        (self.digits.len() <= 1 && (wrapped < 0) == self.is_negative).then_some(wrapped)
    }

    #[inline]
    pub fn to_i128(self) -> Option<i128> {
        let magnitude = digits::to_u128(self.digits)?;
        if self.is_negative {
            0i128.checked_sub_unsigned(magnitude)
        } else {
            i128::try_from(magnitude).ok()
        }
    }

    /// The number of the same value if that is a safe integer.
    #[inline]
    pub fn to_safe_integer(self) -> Option<f64> {
        match *self.digits {
            [] => Some(0.0),
            [digit @ ..=MAX_SAFE_INTEGER] => {
                let digit = digit as i64;
                Some(if self.is_negative { -digit } else { digit } as f64)
            }
            _ => None,
        }
    }

    /// The nearest number, ties to even.
    #[inline]
    pub fn to_number(self) -> f64 {
        self.to_safe_integer()
            .unwrap_or_else(|| self.to_rounded_number())
    }

    fn to_rounded_number(self) -> f64 {
        let length = digits::bit_length(self.digits);
        let magnitude = if length > 1024 {
            f64::INFINITY
        } else {
            let top = digits::top_bits(self.digits);
            let dropped = top & 0x7ff;
            let rounds_up = dropped > 0x400
                || dropped == 0x400
                    && (top & 0x800 != 0 || digits::has_bits_below_top(self.digits));
            // The leading bit of the significand adds one to the exponent, and so does a carry out of the rounding.
            let exponent = (length as u64 + 1021) << 52;
            f64::from_bits(exponent + (top >> 11) + u64::from(rounds_up))
        };
        if self.is_negative {
            -magnitude
        } else {
            magnitude
        }
    }
}

/// NumberToBigInt of ECMA-262.
#[inline(always)]
pub fn from_number(number: f64) -> Result<New<impl Fill>, Error> {
    let integer = number as i64;
    if integer as f64 == number && integer != i64::MAX {
        return Ok(New::Small(integer.into()));
    }
    let bits = number.to_bits();
    let exponent = (bits >> 52 & 0x7ff) as usize;
    if !(1023 + 63..0x7ff).contains(&exponent) {
        return Err(Error::NotAnInteger);
    }
    let is_negative = number < 0.0;
    let significand = bits << 11 | 1 << 63;
    let shift = exponent - (1023 + 63);
    Ok(if shift <= 64 {
        New::Small(SmallBigInt::new(
            is_negative,
            u128::from(significand) << shift,
        ))
    } else {
        New::Large(ScaledDigit {
            significand,
            shift,
            is_negative,
        })
    })
}

struct ScaledDigit {
    significand: u64,
    shift: usize,
    is_negative: bool,
}

impl Fill for ScaledDigit {
    #[inline]
    fn digit_count(&self) -> usize {
        self.shift.div_ceil(64) + 1
    }

    fn fill(self, out: &mut [u64], _: Poll<'_>) -> Result<Filled, Error> {
        let out = &mut out[..self.digit_count()];
        digits::shift_left(out, &[self.significand], self.shift);
        Ok(Filled::whole(self.is_negative, out))
    }
}
