mod blocks;
mod digit;
mod narrow;
mod newton;
mod quick;
mod recursive;
mod repeated;

pub(crate) use blocks::{Reciprocal, Wanted, divide_in_one_block};
pub(crate) use digit::*;
pub(crate) use quick::*;
pub(crate) use repeated::divide_each;

use super::{
    MAX_WIDTH, compare, compare_same_length, decrement, increment, low_zero_count, multiply,
    shift_bits_left, shift_bits_right, trim,
};
use crate::{Error, Scratch, Work};
use narrow::DivisorTop;
use recursive::{Division, MAX_BLOCKS_LENGTH};

const MIN_BLOCKS_LENGTH: usize = 4;
/// The shortest quotient that is worth working out a [`Reciprocal`] for.
const RECIPROCAL_LENGTH: usize = 56;

/// `b` is trimmed and no longer than `a`. `quotient` has `a.len() - b.len() + 1` digits, or one less if the quotient
/// fits, and `remainder` is as long as `b`. Either can be empty if it is not wanted.
pub(crate) fn divide(
    quotient: &mut [u64],
    mut remainder: &mut [u64],
    mut a: &[u64],
    mut b: &[u64],
    mut reciprocal: Option<&Reciprocal>,
    work: &mut Work<'_>,
) -> Result<(), Error> {
    if b[0] == 0 {
        let zeros = low_zero_count(b);
        if let Some(low) = remainder.split_off_mut(..zeros) {
            low.copy_from_slice(&a[..zeros]);
        }
        (a, b, reciprocal) = (&a[zeros..], &b[zeros..], None);
    }
    if let [divisor] = *b {
        let left = if quotient.is_empty() {
            remainder_by_digit(a, divisor)
        } else {
            divide_by_digit(quotient, a, divisor)
        };
        remainder.fill(left);
        return work.spend(4 * a.len());
    }
    if b.len() > MAX_WIDTH && remainder.is_empty() {
        return divide_for_quotient(quotient, a, b, reciprocal, work);
    }
    if (MIN_BLOCKS_LENGTH..=MAX_BLOCKS_LENGTH).contains(&b.len()) {
        if let Some(reciprocal) = reciprocal {
            return divide_in_blocks(quotient, remainder, a, b, reciprocal, work);
        }
        if a.len() - b.len() >= RECIPROCAL_LENGTH {
            let reciprocal = Reciprocal::new(b, work)?;
            return divide_in_blocks(quotient, remainder, a, b, &reciprocal, work);
        }
    }
    if b.len() <= MAX_WIDTH {
        narrow::divide(quotient, remainder, a, b);
        return work.spend(2 * MAX_WIDTH * a.len());
    }
    divide_wide(quotient, remainder, a, b, reciprocal, work)
}

fn divide_in_blocks(
    quotient: &mut [u64],
    remainder: &mut [u64],
    a: &[u64],
    b: &[u64],
    reciprocal: &Reciprocal,
    work: &mut Work<'_>,
) -> Result<(), Error> {
    let extra = a.len() - b.len();
    let length = extra + usize::from(compare_same_length(&a[extra..], b).is_ge());
    let unwanted_length = if quotient.is_empty() { length } else { 0 };
    let mut scratch = Scratch::<u64, 128>::new();
    let scratch = scratch.filled(0, a.len() + 1 + unwanted_length, work)?;
    let (dividend, unwanted) = scratch.split_at_mut(a.len() + 1);
    dividend[..a.len()].copy_from_slice(a);
    let quotient = match quotient.split_at_mut_checked(length) {
        Some((low, high)) => {
            high.fill(0);
            low
        }
        None => unwanted,
    };
    let used = &mut dividend[..length + b.len()];
    blocks::divide_in_place(quotient, used, b, reciprocal, work)?;
    remainder.copy_from_slice(&dividend[..remainder.len()]);
    Ok(())
}

/// The operands shifted so that the top bit of the divisor is set.
struct Normalized<'a> {
    shift: u32,
    divisor: &'a [u64],
}

/// Fills `dividend`, which is one digit longer than `a`.
fn normalize<'a>(
    dividend: &mut [u64],
    divisor: &'a mut [u64],
    a: &[u64],
    b: &'a [u64],
) -> Normalized<'a> {
    let shift = b[b.len() - 1].leading_zeros();
    dividend[a.len()] = shift_bits_left(&mut dividend[..a.len()], a, shift);
    if shift == 0 {
        return Normalized { shift, divisor: b };
    }
    shift_bits_left(divisor, b, shift);
    Normalized { shift, divisor }
}

impl Normalized<'_> {
    fn start<'a, 'w>(
        &self,
        quotient_length: usize,
        known: Option<&Reciprocal>,
        product: &'a mut [u64],
        work: &'a mut Work<'w>,
    ) -> Result<Division<'a, 'w>, Error> {
        let reciprocal = match known {
            Some(known) => Some(known.for_shifted(self.shift)),
            None if quotient_length >= RECIPROCAL_LENGTH => {
                Some(Reciprocal::new(self.divisor, work)?)
            }
            None => None,
        };
        Ok(Division {
            top: DivisorTop::of(self.divisor),
            reciprocal,
            product,
            work,
        })
    }
}

fn divide_wide(
    quotient: &mut [u64],
    remainder: &mut [u64],
    a: &[u64],
    b: &[u64],
    reciprocal: Option<&Reciprocal>,
    work: &mut Work<'_>,
) -> Result<(), Error> {
    let length = a.len() - b.len() + 1;
    let mut scratch = Scratch::<u64, 384>::new();
    let scratch = scratch.filled(0, 2 * b.len() + a.len() + 1 + length, work)?;
    let (divisor, scratch) = scratch.split_at_mut(b.len());
    let (product, scratch) = scratch.split_at_mut(b.len());
    let (dividend, whole_quotient) = scratch.split_at_mut(a.len() + 1);
    let normalized = normalize(dividend, divisor, a, b);
    let fits = dividend[a.len()] == 0 && dividend[a.len() - 1] < normalized.divisor[b.len() - 1];
    let needed = length - usize::from(fits);
    normalized
        .start(needed, reciprocal, product, work)?
        .divide(
            &mut whole_quotient[..needed],
            &mut dividend[..needed + b.len()],
            normalized.divisor,
        )?;
    quotient.copy_from_slice(&whole_quotient[..quotient.len()]);
    shift_bits_right(remainder, &dividend[..b.len()], normalized.shift);
    Ok(())
}

/// Works out a digit below the last one of the quotient, and looks at the low digits of the operands only if that
/// leaves a doubt.
fn divide_for_quotient(
    quotient: &mut [u64],
    a: &[u64],
    b: &[u64],
    reciprocal: Option<&Reciprocal>,
    work: &mut Work<'_>,
) -> Result<(), Error> {
    const MAX_ERROR: u64 = 64;
    let length = a.len() - b.len() + 2;
    let unused = b.len().saturating_sub(length + 2);
    let (a_high, b_high) = (&a[unused..], &b[unused..]);
    let mut scratch = Scratch::<u64, 384>::new();
    let scratch = scratch.filled(0, 2 * b_high.len() + a_high.len() + 2 + length, work)?;
    let (divisor, scratch) = scratch.split_at_mut(b_high.len());
    let (product, scratch) = scratch.split_at_mut(b_high.len());
    let (dividend, estimate) = scratch.split_at_mut(a_high.len() + 2);
    let normalized = normalize(&mut dividend[1..], divisor, a_high, b_high);
    normalized
        .start(length, reciprocal, product, work)?
        .divide_roughly(estimate, dividend, normalized.divisor)?;

    let (fraction, whole) = (estimate[0], &mut estimate[1..]);
    if fraction.wrapping_add(MAX_ERROR) < 2 * MAX_ERROR {
        let wraps = fraction >= MAX_ERROR && increment(whole);
        let mut scratch = Scratch::<u64, 128>::new();
        let product = scratch.filled(0, a.len() + 1, work)?;
        multiply(product, whole, b, work)?;
        if wraps || compare(trim(product), trim(a)).is_gt() {
            decrement(whole);
        }
    }
    quotient.copy_from_slice(&whole[..quotient.len()]);
    Ok(())
}
