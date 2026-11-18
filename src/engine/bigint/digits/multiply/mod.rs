mod karatsuba;
mod rows;
mod toom3;
mod transform;

pub(crate) use rows::*;

use core::ops::Deref;

use super::add_assign;
use crate::{Error, Scratch, Work};
use transform::Transformed;

/// The longest operand that is multiplied row by row, or by halves that are.
const MAX_SHORT_LENGTH: usize = 2 * MAX_WIDTH;
const TOOM3_LENGTH: usize = 130;
const MIN_TRANSFORM_LENGTH: usize = 130;

#[inline(always)]
fn is_square(a: &[u64], b: &[u64]) -> bool {
    core::ptr::eq(a, b)
}

#[inline(always)]
pub(crate) fn long_and_short<'a>(a: &'a [u64], b: &'a [u64]) -> (&'a [u64], &'a [u64]) {
    if a.len() < b.len() { (b, a) } else { (a, b) }
}

/// The longer the other operand is, the sooner transforms pay.
fn suits_transforms(long: &[u64], short: &[u64]) -> bool {
    let extra = if is_square(long, short) { 390 } else { 450 };
    short.len().saturating_sub(MIN_TRANSFORM_LENGTH) * long.len() >= extra * short.len()
}

/// `out = a * b`. Neither is empty, and `out` is as long as both together.
pub(crate) fn multiply(
    out: &mut [u64],
    a: &[u64],
    b: &[u64],
    work: &mut Work<'_>,
) -> Result<(), Error> {
    let (long, short) = long_and_short(a, b);
    if short.len() <= MAX_SHORT_LENGTH {
        const PIECE_LENGTH: usize = 1 << 12;
        if long.len() <= PIECE_LENGTH {
            multiply_short(out, long, short);
            return work.spend(long.len() * short.len());
        }
        let overlap = &mut [0; MAX_SHORT_LENGTH][..short.len()];
        return for_each_piece(out, long, PIECE_LENGTH, overlap, |product, piece| {
            let (long, short) = long_and_short(piece, short);
            multiply_short(product, long, short);
            work.spend(long.len() * short.len())
        });
    }
    if suits_transforms(long, short) {
        if long.len() <= 12 * short.len() {
            return transform::multiply(out, long, short, work);
        }
        let pieces = long
            .len()
            .div_ceil(Transformed::best_other_length(short.len()));
        let piece_length = long.len().div_ceil(pieces);
        let mut transformed = Transformed::new(short, piece_length, work)?;
        let mut overlap = work.try_filled(0, short.len())?;
        return for_each_piece(out, long, piece_length, &mut overlap, |product, piece| {
            transformed.multiply(product, piece, work)
        });
    }
    let mut scratch = Scratch::<u64, 256>::new();
    if are_balanced(long, short) {
        let scratch = scratch.filled(0, scratch_length(long.len()), work)?;
        multiply_medium(out, long, short, scratch);
        return work.spend(long.len() * short.len() / 2);
    }
    let (overlap, scratch) = scratch
        .filled(0, short.len() + scratch_length(short.len()), work)?
        .split_at_mut(short.len());
    for_each_piece(out, long, short.len(), overlap, |product, piece| {
        multiply_medium(product, short, piece, scratch);
        work.spend(short.len() * short.len() / 2)
    })
}

/// A number that several others are multiplied by.
pub(crate) struct Multiplier<D> {
    digits: D,
    transformed: Option<Transformed>,
}

impl<D: Deref<Target = [u64]>> Multiplier<D> {
    pub(crate) fn new(
        digits: D,
        max_other_length: usize,
        uses: usize,
        work: &mut Work<'_>,
    ) -> Result<Multiplier<D>, Error> {
        /// The transforms that are kept take seven times the room of the product.
        const MAX_PRODUCT_LENGTH: usize = 1 << 21;
        let (long, short) = (
            digits.len().max(max_other_length),
            digits.len().min(max_other_length),
        );
        let is_worth_keeping = uses > 1
            && long + short <= MAX_PRODUCT_LENGTH
            && short.saturating_sub(MIN_TRANSFORM_LENGTH) * long >= 250 * short;
        let transformed = if is_worth_keeping {
            Some(Transformed::new(&digits, max_other_length, work)?)
        } else {
            None
        };
        Ok(Multiplier {
            digits,
            transformed,
        })
    }

    /// `other` is not empty, and `out` is as long as both together.
    pub(crate) fn multiply(
        &mut self,
        out: &mut [u64],
        other: &[u64],
        work: &mut Work<'_>,
    ) -> Result<(), Error> {
        match &mut self.transformed {
            Some(transformed) if 2 * other.len() >= transformed.max_other_length() => {
                transformed.multiply(out, other, work)
            }
            _ => multiply(out, &self.digits, other, work),
        }
    }
}

#[inline(always)]
fn are_balanced(long: &[u64], short: &[u64]) -> bool {
    2 * long.len() < 3 * short.len()
}

/// Enough for [`multiply_medium`] whatever the length of the short operand.
fn scratch_length(long: usize) -> usize {
    if long < TOOM3_LENGTH {
        2 * long
    } else {
        3 * long + 32
    }
}

/// `short` is no longer than `long`, and too short for transforms.
#[inline(always)]
fn multiply_medium(out: &mut [u64], long: &[u64], short: &[u64], scratch: &mut [u64]) {
    debug_assert!(long.len() >= short.len() && out.len() == long.len() + short.len());
    if short.len() <= MAX_SHORT_LENGTH {
        multiply_short(out, long, short);
    } else if short.len() >= TOOM3_LENGTH && short.len() > 2 * long.len().div_ceil(3) + 1 {
        toom3::multiply(out, long, short, scratch);
    } else if are_balanced(long, short) {
        karatsuba::multiply(out, long, short, scratch);
    } else {
        multiply_in_pieces(out, long, short, scratch);
    }
}

#[inline(always)]
fn multiply_short(out: &mut [u64], long: &[u64], short: &[u64]) {
    if short.len() <= MAX_WIDTH {
        out[long.len() + short.len() - 1] = multiply_narrow(out, long, short);
    } else if long.len() == short.len() {
        karatsuba::multiply_by_narrow_halves(out, long, short);
    } else {
        multiply_in_strips(out, long, short);
    }
}

/// Cuts `short` in two strips that are narrow enough for a row.
fn multiply_in_strips(out: &mut [u64], long: &[u64], short: &[u64]) {
    let (low, high) = short.split_at(short.len() / 2);
    out[long.len() + low.len() - 1] = multiply_narrow(out, long, low);
    let out = &mut out[low.len()..];
    out[long.len() + high.len() - 1] = multiply_add_narrow(out, long, high);
}

fn multiply_in_pieces(out: &mut [u64], long: &[u64], short: &[u64], scratch: &mut [u64]) {
    let (overlap, scratch) = scratch.split_at_mut(short.len());
    let Ok(()) = for_each_piece(out, long, short.len(), overlap, |product, piece| {
        multiply_medium(product, short, piece, scratch);
        Ok::<(), core::convert::Infallible>(())
    });
}

/// `multiply` writes the product of a piece of `long` and the other operand, which is as long as `overlap`.
#[inline(always)]
fn for_each_piece<E>(
    out: &mut [u64],
    long: &[u64],
    piece_length: usize,
    overlap: &mut [u64],
    mut multiply: impl FnMut(&mut [u64], &[u64]) -> Result<(), E>,
) -> Result<(), E> {
    for (index, piece) in long.chunks(piece_length).enumerate() {
        let product = &mut out[index * piece_length..][..piece.len() + overlap.len()];
        if index != 0 {
            overlap.copy_from_slice(&product[..overlap.len()]);
        }
        multiply(product, piece)?;
        if index != 0 {
            add_assign(product, overlap);
        }
    }
    Ok(())
}
