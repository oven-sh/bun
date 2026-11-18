use super::RECIPROCAL_LENGTH;
use super::blocks::Reciprocal;
use super::narrow::DivisorTop;
use super::newton::{self, LongDivisor};
use super::recursive::Division;
use crate::digits::{shift_bits_left, shift_bits_right, trim};
use crate::{Error, Scratch, Work};

/// Divides each number in `numbers`, which follow each other and have `2 * half` digits, by `divisor * 2^(64 * zeros)`.
/// The remainder goes in the low half and the quotient in the high half. Both fit. `divisor` is trimmed and has two
/// digits or more.
pub(crate) fn divide_each(
    numbers: &mut [u64],
    half: usize,
    divisor: &[u64],
    zeros: usize,
    work: &mut Work<'_>,
) -> Result<(), Error> {
    let (length, uses) = (divisor.len(), numbers.len() / (2 * half));
    let max_dividend_length = 2 * half - zeros + 1;
    let max_quotient_length = (max_dividend_length - length).min(half + 1);
    let mut scratch = Scratch::<u64, 384>::new();
    let scratch = scratch.filled(
        0,
        2 * length + max_dividend_length + max_quotient_length,
        work,
    )?;
    let (shifted, scratch) = scratch.split_at_mut(length);
    let (product, scratch) = scratch.split_at_mut(length);
    let (dividend, quotient) = scratch.split_at_mut(max_dividend_length);
    let shift = divisor[length - 1].leading_zeros();
    shift_bits_left(shifted, divisor, shift);

    let (mut long, mut reciprocal) = (None, None);
    if newton::is_suitable(max_quotient_length, length, uses) {
        long = Some(LongDivisor::new(shifted, max_quotient_length, uses, work)?);
    } else if length >= Reciprocal::DIVISOR_LENGTH && half * uses >= RECIPROCAL_LENGTH {
        reciprocal = Some(Reciprocal::new(shifted, work)?);
    }
    let mut division = Division {
        top: DivisorTop::of(shifted),
        reciprocal,
        product,
        work,
    };

    for number in numbers.chunks_exact_mut(2 * half) {
        let high = trim(&number[zeros..]);
        let Some(extra) = high.len().checked_sub(length) else {
            continue;
        };
        let top = shift_bits_left(&mut dividend[..high.len()], high, shift);
        dividend[high.len()] = top;
        let fits = top == 0 && dividend[high.len() - 1] < shifted[length - 1];
        let quotient = &mut quotient[..extra + usize::from(!fits)];
        let dividend = &mut dividend[..quotient.len() + length];
        match &mut long {
            Some(long) => long.divide_in_place(quotient, dividend, true, division.work)?,
            None => division.divide(quotient, dividend, shifted)?,
        }
        let (low, high) = number.split_at_mut(half);
        let (remainder, above) = low[zeros..].split_at_mut(length);
        shift_bits_right(remainder, &dividend[..length], shift);
        above.fill(0);
        let quotient = trim(quotient);
        high[..quotient.len()].copy_from_slice(quotient);
        high[quotient.len()..].fill(0);
    }
    Ok(())
}
