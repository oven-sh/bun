use crate::{BigIntRef, Error, Fill, Filled, MAX_LENGTH, Outcome, Poll, Work, digits};

#[inline(always)]
pub fn multiply<'a>(x: BigIntRef<'a>, y: BigIntRef<'a>) -> Result<Outcome<impl Fill + 'a>, Error> {
    let is_negative = x.is_negative != y.is_negative;
    if let (&[a], &[b]) = (x.digits, y.digits) {
        return Ok(Outcome::small(is_negative, u128::from(a) * u128::from(b)));
    }
    let (long, short) = digits::long_and_short(x.digits, y.digits);
    match *short {
        [] if x.is_zero() => return Ok(Outcome::First),
        [] => return Ok(Outcome::Second),
        [1] if !y.is_negative && y.digits.len() == 1 => return Ok(Outcome::First),
        [1] if !x.is_negative && x.digits.len() == 1 => return Ok(Outcome::Second),
        _ => {}
    }
    if long.len() + short.len() - 1 > MAX_LENGTH {
        return Err(Error::TooBig);
    }
    Ok(Outcome::large(Product {
        long,
        short,
        is_negative,
    }))
}

struct Product<'a> {
    long: &'a [u64],
    short: &'a [u64],
    is_negative: bool,
}

impl Fill for Product<'_> {
    #[inline(always)]
    fn digit_count(&self) -> usize {
        self.long.len() + self.short.len()
    }

    #[inline(always)]
    fn fill(self, out: &mut [u64], poll: Poll<'_>) -> Result<Filled, Error> {
        let out = &mut out[..self.digit_count()];
        if self.long.len() > digits::MAX_WIDTH {
            digits::multiply(out, self.long, self.short, &mut Work::new(poll))?;
            return Filled::whole_or_one_less(self.is_negative, out);
        }
        let top = match *self.short {
            [factor] => digits::multiply_short_by_digit(out, self.long, factor),
            _ => digits::multiply_narrow(out, self.long, self.short),
        };
        out[out.len() - 1] = top;
        let length = out.len() - usize::from(top == 0);
        Ok(Filled::whole(self.is_negative, &out[..length]))
    }
}
