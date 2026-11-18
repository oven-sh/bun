//! The operands act as two's complement bit strings of infinite length.

use core::marker::PhantomData;

use crate::digits::{self, array, for_short_length, unroll};
use crate::{BigIntRef, Error, Fill, Filled, Outcome, Poll};

#[inline(always)]
pub fn bitwise_and<'a>(x: BigIntRef<'a>, y: BigIntRef<'a>) -> Outcome<impl Fill + 'a> {
    if let (&[a, ..], &[b], false) = (x.digits, y.digits, x.is_negative | y.is_negative) {
        return Outcome::small(false, u128::from(a & b));
    }
    if let (false, Some(mask)) = (y.is_negative, digits::to_u128(y.digits)) {
        return Outcome::small(false, low_bits(x) & mask);
    }
    if let (false, Some(mask)) = (x.is_negative, digits::to_u128(x.digits)) {
        return Outcome::small(false, low_bits(y) & mask);
    }
    combine::<And>(x, y)
}

#[inline(always)]
pub fn bitwise_or<'a>(x: BigIntRef<'a>, y: BigIntRef<'a>) -> Outcome<impl Fill + 'a> {
    combine_unless_zero::<Or>(x, y)
}

#[inline(always)]
pub fn bitwise_xor<'a>(x: BigIntRef<'a>, y: BigIntRef<'a>) -> Outcome<impl Fill + 'a> {
    combine_unless_zero::<Xor>(x, y)
}

trait Operator {
    fn apply(a: u64, b: u64) -> u64;

    /// Whether `a` settles the result whatever the other operand is.
    #[inline(always)]
    fn is_settled_by(a: u64) -> bool {
        Self::apply(a, 0) == Self::apply(a, u64::MAX)
    }
}

macro_rules! operators {
    ($($name:ident $operator:tt)*) => {$(
        struct $name;

        impl Operator for $name {
            #[inline(always)]
            fn apply(a: u64, b: u64) -> u64 {
                a $operator b
            }
        }
    )*};
}

operators!(And & Or | Xor ^);

/// The digit that repeats above the magnitude.
#[inline(always)]
fn extension(is_negative: bool) -> u64 {
    u64::from(is_negative).wrapping_neg()
}

/// `x` modulo 2^128.
#[inline(always)]
pub(crate) fn low_bits(x: BigIntRef<'_>) -> u128 {
    let magnitude = match *x.digits {
        [] => 0,
        [low] => u128::from(low),
        [low, high, ..] => digits::join(low, high),
    };
    if x.is_negative {
        magnitude.wrapping_neg()
    } else {
        magnitude
    }
}

#[inline(always)]
fn combine_unless_zero<'a, O: Operator>(
    x: BigIntRef<'a>,
    y: BigIntRef<'a>,
) -> Outcome<Combination<'a, O>> {
    if let (&[a], &[b], false) = (x.digits, y.digits, x.is_negative | y.is_negative) {
        return Outcome::small(false, u128::from(O::apply(a, b)));
    }
    if y.is_zero() {
        return Outcome::First;
    }
    if x.is_zero() {
        return Outcome::Second;
    }
    combine(x, y)
}

#[inline(always)]
fn combine<'a, O: Operator>(x: BigIntRef<'a>, y: BigIntRef<'a>) -> Outcome<Combination<'a, O>> {
    let is_negative = O::apply(extension(x.is_negative), extension(y.is_negative)) != 0;
    if x.digits.len() <= 2 && y.digits.len() <= 2 {
        let (a, b) = (low_bits(x), low_bits(y));
        let bits = digits::join(
            O::apply(a as u64, b as u64),
            O::apply((a >> 64) as u64, (b >> 64) as u64),
        );
        if !is_negative {
            return Outcome::small(false, bits);
        }
        if bits != 0 {
            return Outcome::small(true, bits.wrapping_neg());
        }
    }
    let (long, short) = if x.digits.len() < y.digits.len() {
        (y, x)
    } else {
        (x, y)
    };
    let length = if long.is_negative | short.is_negative {
        length_with_signs::<O>(long, short)
    } else {
        length_without_signs::<O>(long.digits, short.digits)
    };
    if length == 0 {
        return Outcome::ZERO;
    }
    Outcome::large(Combination {
        length,
        long,
        short,
        operator: PhantomData,
    })
}

#[inline(always)]
fn length_without_signs<O: Operator>(long: &[u64], short: &[u64]) -> usize {
    if long.len() > short.len() && !O::is_settled_by(0) {
        return long.len();
    }
    long.iter()
        .zip(short)
        .rposition(|(&a, &b)| O::apply(a, b) != 0)
        .map_or(0, |top| top + 1)
}

/// The length of the result, or one more.
#[inline(always)]
fn length_with_signs<O: Operator>(long: BigIntRef<'_>, short: BigIntRef<'_>) -> usize {
    let (a, b) = (extension(long.is_negative), extension(short.is_negative));
    let result_extension = O::apply(a, b);
    let end = if O::is_settled_by(b) {
        short.digits.len()
    } else {
        long.digits.len()
    };
    // The carry of a negation stops at the first digit that is not zero.
    if end > 1 && long.digits[0] != 0 && short.digits[0] != 0 {
        let short_top = digits::digit_or_zero(short.digits, end - 1);
        let top = O::apply(long.digits[end - 1] ^ a, short_top ^ b) ^ result_extension;
        if top.wrapping_add(1) > 1 {
            return end;
        }
    }
    length_by_search::<O>(long, short, end)
}

fn length_by_search<O: Operator>(long: BigIntRef<'_>, short: BigIntRef<'_>, end: usize) -> usize {
    let (a, b) = (TwosComplement::new(long), TwosComplement::new(short));
    let result_extension = O::apply(a.extension, b.extension);
    // For a negative result this is its magnitude less one.
    let top = (0..end)
        .rev()
        .map(|index| {
            let digit = O::apply(a.digit(index), b.digit(index)) ^ result_extension;
            (index, digit)
        })
        .find(|&(_, digit)| digit != 0);
    match top {
        Some((index, digit)) => index + 1 + usize::from(digit & result_extension == u64::MAX),
        None => usize::from(result_extension != 0),
    }
}

pub(crate) struct TwosComplement<'a> {
    magnitude: &'a [u64],
    extension: u64,
    /// The digits below this one take the carry of the negation.
    carry_end: usize,
}

impl<'a> TwosComplement<'a> {
    #[inline]
    pub(crate) fn new(x: BigIntRef<'a>) -> TwosComplement<'a> {
        TwosComplement {
            magnitude: x.digits,
            extension: extension(x.is_negative),
            carry_end: if x.is_negative {
                digits::low_zero_count(x.digits) + 1
            } else {
                0
            },
        }
    }

    #[inline]
    pub(crate) fn digit(&self, index: usize) -> u64 {
        (digits::digit_or_zero(self.magnitude, index) ^ self.extension)
            .wrapping_add(u64::from(index < self.carry_end))
    }
}

struct Combination<'a, O> {
    length: usize,
    long: BigIntRef<'a>,
    short: BigIntRef<'a>,
    operator: PhantomData<O>,
}

impl<O: Operator> Fill for Combination<'_, O> {
    #[inline(always)]
    fn digit_count(&self) -> usize {
        self.length
    }

    #[inline(always)]
    fn fill(self, out: &mut [u64], _: Poll<'_>) -> Result<Filled, Error> {
        let out = &mut out[..self.length];
        if self.long.is_negative | self.short.is_negative {
            return fill_with_signs::<O>(out, self.long, self.short);
        }
        let (long, short) = (self.long.digits, self.short.digits);
        let paired = if out.len() <= short.len() {
            out.len()
        } else {
            0
        };
        for_short_length!(paired, |N| {
            let (long, short) = (array::<N>(long), array::<N>(short));
            unroll!(i in 0, N => {
                out[i] = O::apply(long[i], short[i]);
            });
        }, _ => fill_without_signs::<O>(out, long, short));
        Ok(Filled::whole(false, out))
    }
}

fn fill_without_signs<O: Operator>(out: &mut [u64], long: &[u64], short: &[u64]) {
    for ((out, &a), &b) in out.iter_mut().zip(long).zip(short) {
        *out = O::apply(a, b);
    }
    if short.len() < out.len() {
        out[short.len()..].copy_from_slice(&long[short.len()..]);
    }
}

fn fill_with_signs<O: Operator>(
    out: &mut [u64],
    long: BigIntRef<'_>,
    short: BigIntRef<'_>,
) -> Result<Filled, Error> {
    let (a, b) = (TwosComplement::new(long), TwosComplement::new(short));
    let result_extension = O::apply(a.extension, b.extension);
    let pairs = long.digits.iter().zip(short.digits);
    for (out, (&long, &short)) in out.iter_mut().zip(pairs) {
        *out = O::apply(long ^ a.extension, short ^ b.extension) ^ result_extension;
    }
    if let Some(above) = out.get_mut(short.digits.len()..) {
        let rest = &long.digits[short.digits.len()..];
        let (middle, top) = above.split_at_mut(rest.len().min(above.len()));
        for (out, &long) in middle.iter_mut().zip(rest) {
            *out = O::apply(long ^ a.extension, b.extension) ^ result_extension;
        }
        if let [top] = top {
            *top = 0;
        }
    }
    for (index, out) in out
        .iter_mut()
        .enumerate()
        .take(a.carry_end.max(b.carry_end))
    {
        *out = O::apply(a.digit(index), b.digit(index)) ^ result_extension;
    }
    let is_negative = result_extension != 0;
    if is_negative {
        digits::increment(out);
    }
    Filled::whole_or_one_less(is_negative, out)
}
