use crate::{
    BigIntRef, Error, Fill, Filled, MAX_BITS, MAX_LENGTH, Outcome, Poll, Scratch, Work, digits,
};

#[inline(always)]
pub fn exponentiate<'a>(
    base: BigIntRef<'a>,
    exponent: BigIntRef<'a>,
) -> Result<Outcome<impl Fill + 'a>, Error> {
    if exponent.is_negative {
        return Err(Error::NegativeExponent);
    }
    let [low, rest @ ..] = exponent.digits else {
        return Ok(Outcome::small(false, 1));
    };
    let is_negative = base.is_negative && low & 1 != 0;
    match base.digits {
        [] => return Ok(Outcome::First),
        [1] => return Ok(Outcome::small(is_negative, 1)),
        _ => {}
    }
    if !rest.is_empty() || *low >= MAX_BITS as u64 {
        return Err(Error::TooBig);
    }
    let exponent = *low as u32;
    if exponent == 1 {
        return Ok(Outcome::First);
    }
    let length = match *base.digits {
        [digit] if digit.is_power_of_two() => {
            let shift = u64::from(digit.ilog2()) * u64::from(exponent);
            if shift < 128 {
                return Ok(Outcome::small(is_negative, 1 << shift));
            }
            if shift >= MAX_BITS as u64 {
                return Err(Error::TooBig);
            }
            shift as usize / 64 + 1
        }
        [digit] if digit.ilog2() * exponent.min(128) < 128 => {
            if let Some(power) = u128::from(digit).checked_pow(exponent) {
                return Ok(Outcome::small(is_negative, power));
            }
            length_of_power(base.digits, exponent)?
        }
        _ if exponent == 2 && base.digits.len() <= MAX_LENGTH / 2 => 2 * base.digits.len(),
        _ => length_of_power(base.digits, exponent)?,
    };
    Ok(Outcome::large(Power {
        length,
        base: base.digits,
        exponent,
        is_negative,
    }))
}

/// For each bit of the exponent below the leading one, from the top: whether the base is multiplied in after squaring.
fn steps(exponent: u32) -> impl ExactSizeIterator<Item = bool> + Clone {
    (0..exponent.ilog2())
        .rev()
        .map(move |bit| exponent >> bit & 1 != 0)
}

/// Takes steps for as long as the power fits in a digit.
#[inline(always)]
fn raise_digit(base: u64, steps: &mut (impl Iterator<Item = bool> + Clone)) -> u64 {
    let mut power = base;
    loop {
        let mut rest = steps.clone();
        let next = rest.next().and_then(|multiplies| {
            let square = power.checked_mul(power)?;
            square.checked_mul(if multiplies { base } else { 1 })
        });
        let Some(next) = next else {
            return power;
        };
        (power, *steps) = (next, rest);
    }
}

/// Or one more.
fn length_of_power(base: &[u64], exponent: u32) -> Result<usize, Error> {
    let mut steps = steps(exponent);
    let factor = UpperBound::of(base);
    let mut power = match *base {
        [digit] => UpperBound::of(&[raise_digit(digit, &mut steps)]),
        _ => factor,
    };
    for multiplies in steps {
        power = power.times(power);
        if multiplies {
            power = power.times(factor);
        }
    }
    // The roundings add up to a factor below `1 + exponent * 2^-61`.
    if (power.bit_length, power.significand) >= (MAX_BITS as u64 + 1, 1 << 63 | 1 << 32) {
        return Err(Error::TooBig);
    }
    Ok((power.bit_length as usize).div_ceil(64))
}

/// `significand * 2^(bit_length - 64)`, with the top bit of the significand set.
#[derive(Clone, Copy)]
struct UpperBound {
    significand: u64,
    bit_length: u64,
}

impl UpperBound {
    #[inline(always)]
    fn new(significand: u64, bit_length: u64, is_exact: bool) -> UpperBound {
        let (significand, carry) = significand.overflowing_add(u64::from(!is_exact));
        UpperBound {
            significand: significand | 1 << 63,
            bit_length: bit_length + u64::from(carry),
        }
    }

    #[inline(always)]
    fn of(digits: &[u64]) -> UpperBound {
        let bit_length = digits::bit_length(digits) as u64;
        let is_exact = !digits::has_bits_below_top(digits);
        UpperBound::new(digits::top_bits(digits), bit_length, is_exact)
    }

    #[inline(always)]
    fn times(self, other: UpperBound) -> UpperBound {
        let product = u128::from(self.significand) * u128::from(other.significand);
        let shift = 1 - (product >> 127) as u32;
        let product = product << shift;
        UpperBound::new(
            (product >> 64) as u64,
            self.bit_length + other.bit_length - u64::from(shift),
            product as u64 == 0,
        )
    }
}

struct Power<'a> {
    length: usize,
    base: &'a [u64],
    exponent: u32,
    is_negative: bool,
}

impl Fill for Power<'_> {
    #[inline(always)]
    fn digit_count(&self) -> usize {
        self.length
    }

    #[inline(always)]
    fn fill(self, out: &mut [u64], poll: Poll<'_>) -> Result<Filled, Error> {
        let (out, work) = (&mut out[..self.length], &mut Work::new(poll));
        match *self.base {
            [digit] if digit.is_power_of_two() => {
                out.fill(0);
                out[self.length - 1] = 1 << (digit.ilog2() * self.exponent % 64);
            }
            _ if self.exponent == 2 && self.length == 2 * self.base.len() => {
                digits::multiply(out, self.base, self.base, work)?;
            }
            _ => raise(out, self.base, self.exponent, work)?,
        }
        Filled::whole_or_one_less(self.is_negative, out)
    }
}

/// The factors of two come out of the base first and go back in at the end.
fn raise(out: &mut [u64], base: &[u64], exponent: u32, work: &mut Work<'_>) -> Result<(), Error> {
    let zero_digits = digits::low_zero_count(base);
    let base = &base[zero_digits..];
    let zero_bits = base[0].trailing_zeros();
    let shift = (zero_digits * 64 + zero_bits as usize) * exponent as usize;

    // A product can take one digit more than its value.
    let capacity = out.len() - shift / 64 + 1;
    let mut scratch = Scratch::<u64, 128>::new();
    let (shifted, buffers) = scratch
        .filled(0, base.len() + 2 * capacity, work)?
        .split_at_mut(base.len());
    let odd = if zero_bits == 0 {
        base
    } else {
        digits::shift_bits_right(shifted, base, zero_bits);
        digits::trim(shifted)
    };
    let (mut power, mut next) = buffers.split_at_mut(capacity);
    let (mut length, mut steps) = (odd.len(), steps(exponent));
    if let [digit] = *odd {
        power[0] = raise_digit(digit, &mut steps);
    } else {
        power[..length].copy_from_slice(odd);
    }
    while let Some(multiplies) = steps.next() {
        let (factor, product) = (&power[..length], &mut next[..2 * length]);
        digits::multiply(product, factor, factor, work)?;
        length = 2 * length - usize::from(product[2 * length - 1] == 0);
        core::mem::swap(&mut power, &mut next);
        if !multiplies {
            continue;
        }
        if steps.len() == 0 && shift == 0 && length + odd.len() == out.len() {
            return digits::multiply(out, &power[..length], odd, work);
        }
        let product = &mut next[..length + odd.len()];
        digits::multiply(product, &power[..length], odd, work)?;
        length = product.len() - usize::from(product[product.len() - 1] == 0);
        core::mem::swap(&mut power, &mut next);
    }
    digits::shift_left(out, &power[..length], shift);
    Ok(())
}
