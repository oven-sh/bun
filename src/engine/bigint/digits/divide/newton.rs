//! Division of long numbers by way of a long reciprocal. Brent and Zimmermann, Modern Computer Arithmetic, 3.4.1 and 2.4.1.

use super::divide;
use crate::digits::{
    Multiplier, add_assign, compare_same_length, decrement, increment, multiply, subtract_assign,
    subtract_assign_same_length,
};
use crate::{Error, Work};

/// `a` has its top bit set, and `out` is one digit longer. With `n` digits, `a * out < 2^(128 * n) <= a * (out + 2)`.
fn invert(
    out: &mut [u64],
    a: &[u64],
    scratch: &mut [u64],
    work: &mut Work<'_>,
) -> Result<(), Error> {
    const MAX_DIVIDED_LENGTH: usize = 150;
    let length = a.len();
    if length <= MAX_DIVIDED_LENGTH {
        let ones = &mut scratch[..2 * length];
        ones.fill(u64::MAX);
        return divide(out, &mut [], ones, a, None, work);
    }
    let low_length = (length - 1) / 2;
    let high_length = length - low_length;
    let (low, high) = out.split_at_mut(low_length);
    invert(high, &a[low_length..], scratch, work)?;

    let (error, correction) = scratch.split_at_mut(length + high_length + 1);
    multiply(error, a, high, work)?;
    while error[length + high_length] != 0 {
        decrement(high);
        subtract_assign(error, a);
    }
    // What it falls short of the power by is less than twice `a`.
    let error = &mut error[..=length];
    error.iter_mut().for_each(|digit| *digit = !*digit);
    increment(error);

    let correction = &mut correction[..2 * high_length + 2];
    multiply(correction, &error[low_length..], high, work)?;
    let (below, above) = correction[2 * high_length - low_length..].split_at(low_length);
    low.copy_from_slice(below);
    add_assign(high, above);
    Ok(())
}

/// Whether it pays for `uses` divisions by one divisor.
pub(super) fn is_suitable(quotient_length: usize, divisor_length: usize, uses: usize) -> bool {
    const MIN_DIVISOR_LENGTH: usize = 600;
    const MIN_QUOTIENTS_LENGTH: usize = 1600;
    divisor_length >= MIN_DIVISOR_LENGTH
        && quotient_length + 1 >= divisor_length
        && quotient_length * uses >= MIN_QUOTIENTS_LENGTH
}

/// A divisor whose top bit is set, with the reciprocal of its top digits.
pub(super) struct LongDivisor<'a> {
    divisor: &'a [u64],
    block_length: usize,
    by_reciprocal: Multiplier<Vec<u64>>,
    by_divisor: Multiplier<&'a [u64]>,
    scratch: Vec<u64>,
}

impl<'a> LongDivisor<'a> {
    /// The more often the reciprocal is used, the longer it can afford to be.
    pub(super) fn new(
        divisor: &'a [u64],
        max_quotient_length: usize,
        uses: usize,
        work: &mut Work<'_>,
    ) -> Result<LongDivisor<'a>, Error> {
        let min_blocks = 3usize.div_ceil(uses);
        let blocks = max_quotient_length.div_ceil(divisor.len()).max(min_blocks);
        let block_length = max_quotient_length.div_ceil(blocks);
        let mut scratch =
            work.try_filled(0, (3 * block_length + 8).max(block_length + divisor.len()))?;

        // Rounding the divisor up keeps each estimate from being too large.
        let mut top = work.try_filled(0, block_length)?;
        top.copy_from_slice(&divisor[divisor.len() - block_length..]);
        let mut reciprocal = work.try_filled(0, block_length + 1)?;
        if block_length < divisor.len() && increment(&mut top) {
            reciprocal[block_length] = 1;
        } else {
            invert(&mut reciprocal, &top, &mut scratch, work)?;
        }
        Ok(LongDivisor {
            divisor,
            block_length,
            by_reciprocal: Multiplier::new(reciprocal, block_length, blocks * uses, work)?,
            by_divisor: Multiplier::new(divisor, block_length, blocks * uses, work)?,
            scratch,
        })
    }

    /// The top digits of `a` are less than the divisor. `a` is as long as `quotient` and the divisor together, and its
    /// low digits become the remainder. Unless `is_exact`, they do not and the quotient can be too small by 7.
    pub(super) fn divide_in_place(
        &mut self,
        quotient: &mut [u64],
        a: &mut [u64],
        is_exact: bool,
        work: &mut Work<'_>,
    ) -> Result<(), Error> {
        let divisor = self.divisor;
        let mut end = quotient.len();
        for block in quotient.rchunks_mut(self.block_length) {
            let start = end - block.len();
            let window = &mut a[start..end + divisor.len()];
            let product = &mut self.scratch[..block.len() + self.block_length + 1];
            self.by_reciprocal
                .multiply(product, &window[divisor.len()..], work)?;
            block.copy_from_slice(&product[self.block_length..][..block.len()]);
            if start == 0 && !is_exact {
                break;
            }
            let product = &mut self.scratch[..block.len() + divisor.len()];
            self.by_divisor.multiply(product, block, work)?;
            let left = &mut window[..=divisor.len()];
            subtract_assign_same_length(left, product);
            while left[divisor.len()] != 0
                || compare_same_length(&left[..divisor.len()], divisor).is_ge()
            {
                subtract_assign(left, divisor);
                increment(block);
            }
            end = start;
        }
        Ok(())
    }
}
