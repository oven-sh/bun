use core::cmp::Ordering;

use crate::digits::{self, MAX_WIDTH, NearPowerOfTwo, Reciprocal, Wanted};
use crate::{BigIntRef, DivisorCache, Error, Fill, Filled, Outcome, Poll, Work};

/// Rounds towards zero.
#[inline(always)]
pub fn divide<'a>(
    x: BigIntRef<'a>,
    y: BigIntRef<'a>,
    cache: &'a DivisorCache,
) -> Result<Outcome<impl Fill + 'a>, Error> {
    let is_negative = x.is_negative != y.is_negative;
    match (x.digits, y.digits) {
        (_, []) => return Err(Error::DivisionByZero),
        (&[a], &[b]) if a < b => return Ok(Outcome::ZERO),
        (&[a], &[b]) => return Ok(Outcome::small(is_negative, u128::from(a / b))),
        (_, [1]) if !y.is_negative => return Ok(Outcome::First),
        (&[low, high], &[divisor]) => {
            let quotient = match cache.digit(divisor) {
                Some(divisor) => divisor.divide_pair(low, high).0,
                None => digits::join(low, high) / u128::from(divisor),
            };
            return Ok(Outcome::small(is_negative, quotient));
        }
        _ => {}
    }
    let Some(extra) = x.digits.len().checked_sub(y.digits.len()) else {
        return Ok(Outcome::ZERO);
    };
    let top_is_zero = digits::compare_same_length(&x.digits[extra..], y.digits) == Ordering::Less;
    let length = extra + 1 - usize::from(top_is_zero);
    if length == 0 {
        return Ok(Outcome::ZERO);
    }
    if length == 1
        && let Some(quotient) = digits::small_quotient(x.digits, y.digits)
    {
        return Ok(Outcome::small(is_negative, u128::from(quotient)));
    }
    Ok(Outcome::large(Quotient {
        length,
        a: x.digits,
        b: y.digits,
        is_negative,
        cache,
    }))
}

struct Quotient<'a> {
    length: usize,
    a: &'a [u64],
    b: &'a [u64],
    is_negative: bool,
    cache: &'a DivisorCache,
}

impl Fill for Quotient<'_> {
    #[inline(always)]
    fn digit_count(&self) -> usize {
        self.length
    }

    #[inline(always)]
    fn fill(self, out: &mut [u64], poll: Poll<'_>) -> Result<Filled, Error> {
        let out = &mut out[..self.length];
        if let [divisor] = *self.b {
            divide_by_digit(out, self.a, divisor, self.cache);
        } else {
            divide_by_digits(out, Wanted::Quotient, self.a, self.b, self.cache, poll)?;
        }
        Ok(Filled::whole(self.is_negative, out))
    }
}

fn divide_by_digit(out: &mut [u64], a: &[u64], divisor: u64, cache: &DivisorCache) {
    if divisor.is_power_of_two() {
        digits::shift_bits_right(out, a, divisor.trailing_zeros());
    } else if let Some(divisor) = cache.digit(divisor) {
        divisor.divide(out, a);
    } else {
        digits::divide_by_digit(out, a, divisor);
    }
}

/// Has the sign of `x`.
#[inline(always)]
pub fn remainder<'a>(
    x: BigIntRef<'a>,
    y: BigIntRef<'a>,
    cache: &'a DivisorCache,
) -> Result<Outcome<impl Fill + 'a>, Error> {
    let magnitude = match (x.digits, y.digits) {
        (_, []) => return Err(Error::DivisionByZero),
        ([], _) => return Ok(Outcome::First),
        (&[a], &[b]) if a < b => return Ok(Outcome::First),
        (&[a], &[b]) => a % b,
        (&[low, ..], &[divisor]) if divisor.is_power_of_two() => low & (divisor - 1),
        (&[low, high], &[divisor]) => match cache.digit(divisor) {
            Some(divisor) => divisor.divide_pair(low, high).1,
            None => (digits::join(low, high) % u128::from(divisor)) as u64,
        },
        (_, &[divisor]) => remainder_by_digit(x.digits, divisor, cache),
        _ => {
            return Ok(match digits::compare(x.digits, y.digits) {
                Ordering::Less => Outcome::First,
                Ordering::Equal => Outcome::ZERO,
                Ordering::Greater => Outcome::large(Remainder {
                    a: x.digits,
                    b: y.digits,
                    is_negative: x.is_negative,
                    cache,
                }),
            });
        }
    };
    Ok(Outcome::small(x.is_negative, u128::from(magnitude)))
}

fn remainder_by_digit(a: &[u64], divisor: u64, cache: &DivisorCache) -> u64 {
    match cache.digit(divisor) {
        Some(divisor) => divisor.remainder(a),
        None => digits::remainder_by_digit(a, divisor),
    }
}

/// `a` is more than `b`, which has two digits or more.
struct Remainder<'a> {
    a: &'a [u64],
    b: &'a [u64],
    is_negative: bool,
    cache: &'a DivisorCache,
}

impl Fill for Remainder<'_> {
    const CAN_FALL_SHORT: bool = true;

    #[inline(always)]
    fn digit_count(&self) -> usize {
        self.b.len()
    }

    #[inline(always)]
    fn fill(self, out: &mut [u64], poll: Poll<'_>) -> Result<Filled, Error> {
        let Remainder { a, b, cache, .. } = self;
        let out = &mut out[..b.len()];
        if a.len() <= b.len() + 1
            && let Some(quotient) = digits::small_quotient(a, b)
        {
            digits::subtract_multiple(out, a, b, quotient);
        } else if a.len() <= 2 * b.len()
            && let Some(near) = NearPowerOfTwo::of(b)
        {
            near.remainder(out, a, b);
        } else {
            divide_by_digits(out, Wanted::Remainder, a, b, cache, poll)?;
        }
        Ok(Filled::trimmed(self.is_negative, out))
    }
}

#[inline(always)]
fn divide_by_digits(
    out: &mut [u64],
    wanted: Wanted,
    a: &[u64],
    b: &[u64],
    cache: &DivisorCache,
    poll: Poll<'_>,
) -> Result<(), Error> {
    let known = cache.reciprocal(b);
    if let Some(known) = known
        && b.len() <= MAX_WIDTH
        && a.len() <= 2 * b.len()
        && digits::divide_in_one_block(out, wanted, a, b, known)
    {
        return Ok(());
    }
    divide_at_length(out, wanted, a, b, known, poll)
}

fn divide_at_length(
    out: &mut [u64],
    wanted: Wanted,
    a: &[u64],
    b: &[u64],
    known: Option<&Reciprocal>,
    poll: Poll<'_>,
) -> Result<(), Error> {
    // Whatever `poll` runs can use the cache.
    let known = known.cloned();
    let (quotient, remainder): (&mut [u64], &mut [u64]) = match wanted {
        Wanted::Quotient => (out, &mut []),
        Wanted::Remainder => (&mut [], out),
    };
    let work = &mut Work::new(poll);
    digits::divide(quotient, remainder, a, b, known.as_ref(), work)
}
