//! Division by halves, which leaves most of the work to multiplication.
//! Burnikel and Ziegler, Fast recursive division.

use super::blocks::{self, Reciprocal};
use super::narrow::{self, DivisorTop};
use super::newton::{self, LongDivisor};
use crate::digits::{
    MAX_WIDTH, add_assign_same_length, compare_same_length, decrement, multiply,
    multiply_subtract_digit, subtract_assign_same_length,
};
use crate::{Error, Work};

/// The longest divisor that is divided by in blocks.
pub(super) const MAX_BLOCKS_LENGTH: usize = 32;

pub(super) struct Division<'a, 'w> {
    pub(super) top: DivisorTop,
    pub(super) reciprocal: Option<Reciprocal>,
    /// As long as the divisor.
    pub(super) product: &'a mut [u64],
    pub(super) work: &'a mut Work<'w>,
}

impl Division<'_, '_> {
    /// `divisor` has its top bit set, and the top digits of `a` are less. `a` is as long as `quotient` and `divisor`
    /// together, and its low digits become the remainder.
    pub(super) fn divide(
        &mut self,
        quotient: &mut [u64],
        a: &mut [u64],
        divisor: &[u64],
    ) -> Result<(), Error> {
        let length = divisor.len();
        if let Some(reciprocal) = &self.reciprocal
            && (Reciprocal::DIVISOR_LENGTH..=MAX_BLOCKS_LENGTH).contains(&length)
        {
            return blocks::divide_in_place(quotient, a, divisor, reciprocal, self.work);
        }
        if length <= MAX_WIDTH {
            narrow::divide_in_place(quotient, a, divisor, &self.top);
            return self.work.spend(quotient.len() * 2 * MAX_WIDTH);
        }
        if newton::is_suitable(quotient.len(), length, 1) {
            return LongDivisor::new(divisor, quotient.len(), 1, self.work)?
                .divide_in_place(quotient, a, true, self.work);
        }
        if newton::is_suitable(quotient.len(), quotient.len(), 1) && quotient.len() < length {
            return self.divide_part(quotient, a, divisor);
        }
        let part_length = length.div_ceil(2);
        let mut end = quotient.len();
        for part in quotient.rchunks_mut(part_length) {
            let start = end - part.len();
            self.divide_part(part, &mut a[start..end + length], divisor)?;
            end = start;
        }
        Ok(())
    }

    /// The quotient is shorter than the divisor, and is estimated from as many of its top digits.
    fn divide_part(
        &mut self,
        quotient: &mut [u64],
        a: &mut [u64],
        divisor: &[u64],
    ) -> Result<(), Error> {
        if let [digit] = quotient {
            *digit = self.divide_for_digit(a, divisor);
            return self.work.spend(divisor.len());
        }
        let (divisor_low, divisor_high) = divisor.split_at(divisor.len() - quotient.len());
        let upper = &mut a[divisor_low.len()..];
        let top = &mut upper[quotient.len()..];
        let has_extra_digit = compare_same_length(top, divisor_high).is_ge();
        if has_extra_digit {
            subtract_assign_same_length(top, divisor_high);
        }
        self.divide(quotient, upper, divisor_high)?;

        let (left, product) = (&mut a[..divisor.len()], &mut self.product[..divisor.len()]);
        multiply(product, quotient, divisor_low, self.work)?;
        let mut borrows = u32::from(subtract_assign_same_length(left, product));
        if has_extra_digit {
            let upper = &mut left[quotient.len()..];
            borrows += u32::from(subtract_assign_same_length(upper, divisor_low));
        }
        while borrows != 0 {
            decrement(quotient);
            borrows -= u32::from(add_assign_same_length(left, divisor));
        }
        Ok(())
    }

    fn divide_for_digit(&self, a: &mut [u64], divisor: &[u64]) -> u64 {
        let (left, above) = a.split_at_mut(divisor.len());
        let (high, middle, low) = (above[0], left[left.len() - 1], left[left.len() - 2]);
        let estimate = if self.top.is(high, middle) {
            u64::MAX
        } else {
            self.top.step(high, middle, low).0
        };
        if multiply_subtract_digit(left, divisor, estimate) > high {
            add_assign_same_length(left, divisor);
            return estimate - 1;
        }
        estimate
    }

    /// Like [`divide`](Self::divide), but the quotient can be off by as much as the number of bits in its length,
    /// and nothing of use is left in `a`. It never wraps around.
    pub(super) fn divide_roughly(
        &mut self,
        mut quotient: &mut [u64],
        mut a: &mut [u64],
        mut divisor: &[u64],
    ) -> Result<(), Error> {
        loop {
            if let Some(reciprocal) = &self.reciprocal
                && quotient.len() <= MAX_WIDTH
            {
                blocks::estimate_block(quotient, a, reciprocal);
                return Ok(());
            }
            let unused = divisor.len().saturating_sub(quotient.len() + 1);
            (a, divisor) = (&mut a[unused..], &divisor[unused..]);
            if a[quotient.len()..] == *divisor {
                quotient.fill(u64::MAX);
                return Ok(());
            }
            if divisor.len() <= MAX_WIDTH {
                return self.divide(quotient, a, divisor);
            }
            if newton::is_suitable(quotient.len(), divisor.len(), 1) {
                return LongDivisor::new(divisor, quotient.len(), 1, self.work)?
                    .divide_in_place(quotient, a, false, self.work);
            }
            let low_length = quotient.len().min(divisor.len()) / 2;
            let (low, high) = quotient.split_at_mut(low_length);
            self.divide(high, &mut a[low_length..], divisor)?;
            (quotient, a) = (low, &mut a[..low_length + divisor.len()]);
        }
    }
}
