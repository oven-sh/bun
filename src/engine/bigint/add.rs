use core::cmp::Ordering;
use core::hint::select_unpredictable;

use crate::{BigIntRef, Error, Fill, Filled, MAX_LENGTH, Outcome, Poll, digits};

const ONE: BigIntRef<'static> = BigIntRef {
    is_negative: false,
    digits: &[1],
};

#[inline(always)]
pub fn add<'a>(x: BigIntRef<'a>, y: BigIntRef<'a>) -> Outcome<impl Fill + 'a> {
    if x.is_zero() {
        return Outcome::Second;
    }
    sum(x, y.is_negative, y.digits)
}

#[inline(always)]
pub fn subtract<'a>(x: BigIntRef<'a>, y: BigIntRef<'a>) -> Outcome<impl Fill + 'a> {
    sum(x, !y.is_negative, y.digits)
}

#[inline(always)]
pub fn increment(x: BigIntRef<'_>) -> Outcome<impl Fill + '_> {
    sum(x, false, ONE.digits)
}

#[inline(always)]
pub fn decrement(x: BigIntRef<'_>) -> Outcome<impl Fill + '_> {
    sum(x, true, ONE.digits)
}

/// `-x - 1`
#[inline(always)]
pub fn bitwise_not(x: BigIntRef<'_>) -> Outcome<impl Fill + '_> {
    let negated = BigIntRef {
        is_negative: !x.is_negative,
        digits: x.digits,
    };
    sum(negated, true, ONE.digits)
}

#[inline(always)]
pub fn unary_minus(x: BigIntRef<'_>) -> Outcome<impl Fill + '_> {
    match digits::to_u128(x.digits) {
        Some(0) => Outcome::First,
        Some(magnitude) => Outcome::small(!x.is_negative, magnitude),
        None => Outcome::large(Negation(x)),
    }
}

struct Negation<'a>(BigIntRef<'a>);

impl Fill for Negation<'_> {
    #[inline(always)]
    fn digit_count(&self) -> usize {
        self.0.digits.len()
    }

    #[inline(always)]
    fn fill(self, out: &mut [u64], _: Poll<'_>) -> Result<Filled, Error> {
        let out = &mut out[..self.digit_count()];
        digits::copy(out, self.0.digits);
        Ok(Filled::whole(!self.0.is_negative, out))
    }
}

/// The sign of a zero operand does not matter.
#[inline(always)]
fn sum<'a>(x: BigIntRef<'a>, y_is_negative: bool, y: &'a [u64]) -> Outcome<Sum<'a>> {
    let adds = x.is_negative == y_is_negative;
    if let (&[a], &[b]) = (x.digits, y) {
        return if adds {
            Outcome::small(x.is_negative, u128::from(a) + u128::from(b))
        } else {
            Outcome::small(x.is_negative != (a < b), u128::from(a.abs_diff(b)))
        };
    }
    if let (&[_, _, .., a], &[.., b]) = (x.digits, y)
        && x.digits.len() == y.len()
    {
        if adds {
            return Outcome::large(Sum {
                length: y.len() + 1,
                long: x.digits,
                short: y,
                adds,
                is_negative: x.is_negative,
            });
        }
        if a.abs_diff(b) > 1 {
            let (long, short) = select_unpredictable(a < b, (y, x.digits), (x.digits, y));
            return Outcome::large(Sum {
                length: y.len(),
                long,
                short,
                adds,
                is_negative: x.is_negative != (a < b),
            });
        }
    }
    if y.is_empty() {
        return Outcome::First;
    }
    if let (Some(a), Some(b)) = (digits::to_u128(x.digits), digits::to_u128(y)) {
        if !adds {
            return Outcome::small(x.is_negative != (a < b), a.abs_diff(b));
        }
        if let Some(magnitude) = a.checked_add(b) {
            return Outcome::small(x.is_negative, magnitude);
        }
    }
    if adds {
        let (long, short) = digits::long_and_short(x.digits, y);
        let top = long.len() - 1;
        return Outcome::large(Sum {
            length: long.len() + usize::from(long[top] >= !digits::digit_or_zero(short, top)),
            long,
            short,
            adds,
            is_negative: x.is_negative,
        });
    }
    let (long, short, is_negative) = match digits::compare(x.digits, y) {
        Ordering::Equal => return Outcome::ZERO,
        Ordering::Greater => (x.digits, y, x.is_negative),
        Ordering::Less => (y, x.digits, y_is_negative),
    };
    Outcome::large(Sum {
        length: difference_length(long, short),
        long,
        short,
        adds,
        is_negative,
    })
}

/// The length of `larger - smaller`, or one more.
#[inline(always)]
fn difference_length(larger: &[u64], smaller: &[u64]) -> usize {
    let top = larger.len() - 1;
    if larger[top] - digits::digit_or_zero(smaller, top) > 1 {
        return larger.len();
    }
    difference_length_after_cancellation(larger, smaller)
}

fn difference_length_after_cancellation(larger: &[u64], smaller: &[u64]) -> usize {
    let pair = |index: usize| (larger[index], digits::digit_or_zero(smaller, index));
    let mut top = larger.len() - 1;
    while pair(top).0 == pair(top).1 {
        top -= 1;
    }
    if pair(top).0 - pair(top).1 == 1 {
        while top > 0 && pair(top - 1) == (0, u64::MAX) {
            top -= 1;
        }
    }
    top + 1
}

struct Sum<'a> {
    /// Need not have room for a carry if the top digits rule one out.
    length: usize,
    /// The larger of the two if they are subtracted.
    long: &'a [u64],
    short: &'a [u64],
    adds: bool,
    is_negative: bool,
}

impl Fill for Sum<'_> {
    #[inline(always)]
    fn digit_count(&self) -> usize {
        self.length
    }

    #[inline(always)]
    fn fill(self, out: &mut [u64], _: Poll<'_>) -> Result<Filled, Error> {
        let out = &mut out[..self.length];
        if !self.adds {
            digits::subtract_into(out, self.long, self.short);
            return Filled::whole_or_one_less(self.is_negative, out);
        }
        // Where there is no room for a carry, this is a digit that is written next.
        out[self.length - 1] = 1;
        let carry = digits::add_into(&mut out[..self.long.len()], self.long, self.short);
        let length = self.long.len() + usize::from(carry);
        if length > MAX_LENGTH {
            return Err(Error::TooBig);
        }
        Ok(Filled::whole(self.is_negative, &out[..length]))
    }
}
