//! Division that finds several digits of the quotient at a time, from the leading digits of the reciprocal of the
//! divisor. Barrett, Implementing the Rivest Shamir and Adleman public key encryption algorithm on a standard digital
//! signal processor.

use core::cell::Cell;

use super::divide;
use crate::digits::{
    Argument, MAX_WIDTH, add_assign_same_length, add_row, add_with_carry, array, digit_or_zero,
    increment, shift_bits_right, subtract_arrays, subtract_assign_same_length, unroll,
};
use crate::{Error, Work};

/// With two digits more than a block of the quotient has, the estimate is off by a fraction of its last digit.
const MAX_LENGTH: usize = MAX_WIDTH + 2;

/// For blocks of `k` digits: the top `k + 2` digits, which are `2^(64 * (n + k + 1)) / divisor` or a little less
/// for a divisor of `n` digits.
#[derive(Clone, Default)]
pub(crate) struct Reciprocal(Cell<[u64; MAX_LENGTH]>);

impl Reciprocal {
    /// How many of the top digits of a divisor it depends on.
    pub(crate) const DIVISOR_LENGTH: usize = MAX_LENGTH;

    /// For blocks no longer than `divisor`, which is trimmed and has two digits or more.
    pub(crate) fn new(divisor: &[u64], work: &mut Work<'_>) -> Result<Reciprocal, Error> {
        let used = divisor.len().min(MAX_LENGTH);
        let length = divisor.len().min(MAX_WIDTH) + 2;
        let mut top = [0; MAX_LENGTH];
        let top = &mut top[..used];
        top.copy_from_slice(&divisor[divisor.len() - used..]);
        let mut digits = [0; MAX_LENGTH];
        let quotient = &mut digits[MAX_LENGTH - length..];
        if used < divisor.len() && increment(top) {
            quotient[..length - 1].fill(u64::MAX);
        } else {
            let ones = &[u64::MAX; 2 * MAX_LENGTH][..used + length - 1];
            divide(quotient, &mut [], ones, top, None, work)?;
        }
        Ok(Reciprocal(Cell::new(digits)))
    }

    /// For the divisor shifted left.
    pub(super) fn for_shifted(&self, bits: u32) -> Reciprocal {
        let mut digits = [0; MAX_LENGTH];
        shift_bits_right(&mut digits, &self.0.get(), bits);
        Reciprocal(Cell::new(digits))
    }

    pub(crate) fn set(&self, other: &Reciprocal) {
        self.0.set(other.0.get());
    }

    #[inline(always)]
    fn top<const N: usize>(&self) -> &[Cell<u64>; N] {
        self.0.as_array_of_cells().last_chunk().unwrap()
    }
}

/// The quotient, as `K` digits and the one above, from the top `L = K + 2` digits of the dividend. It may be one too
/// small if the flag is set.
#[inline(always)]
fn estimate<const K: usize, const L: usize>(
    top: &[u64; L],
    reciprocal: &[Cell<u64>; L],
) -> ([u64; K], u64, bool) {
    const MAX_ERROR: u64 = 4 * MAX_LENGTH as u64;
    // At 0 is the digit below the quotient. Each row starts one digit lower still, of which only the carry is lost.
    macro_rules! row {
        ($row:expr) => {{
            let (mut low, mut high) = ([0; L], [0; L]);
            unroll!(10, i in 0, $row + 1 => {
                (low[i], high[i]) = top[L - 1 - $row + i].carrying_mul(reciprocal[$row].get(), 0);
            });
            let mut carry = false;
            unroll!(10, i in 0, $row + 1 => {
                let above = if i < $row { low[i + 1] } else { 0 };
                (high[i], carry) = add_with_carry(high[i], above, carry);
            });
            high
        }};
    }
    let mut last = [0; L];
    if reciprocal[L - 1].get() == 1 {
        unroll!(10, i in 1, L => {
            last[i - 1] = top[i];
        });
    } else {
        last = row!(L - 1);
    }
    let mut sum = [0; L];
    unroll!(10, index in 0, L => {
        let row = if index < L - 1 { row!(index) } else { last };
        let mut carry = false;
        unroll!(10, i in 0, index + 1 => {
            (sum[i], carry) = add_with_carry(sum[i], row[i], carry);
        });
        if index + 1 < L {
            sum[index + 1] = u64::from(carry);
        }
    });
    let is_doubtful = sum[0] >= MAX_ERROR.wrapping_neg();
    (*array(&sum[1..]), sum[L - 1], is_doubtful)
}

/// `left - a * b`, all cut to `N` digits.
#[inline(always)]
fn subtract_low_product<const N: usize>(
    mut left: [u64; N],
    a: &[u64; N],
    b: &[u64; N],
) -> [u64; N] {
    unroll!(row in 0, N => {
        let (mut low, mut high) = ([0; N], [0; N]);
        unroll!(i in row, N => {
            (low[i], high[i]) = a[i - row].carrying_mul(b[row], 0);
        });
        let mut carry = false;
        unroll!(i in row + 1, N => {
            (low[i], carry) = add_with_carry(low[i], high[i - 1], carry);
        });
        left = subtract_arrays(&left, &low).0;
    });
    left
}

macro_rules! for_each_block {
    ($function:ident: $($length:literal)*) => {
        [$($function::<$length, { $length + 2 }>),*]
    };
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Wanted {
    Quotient,
    Remainder,
}

/// The divisor has from 2 to [`MAX_WIDTH`] digits and `a` up to twice as many. The result fits in `out`.
/// Returns false if the quotient is wanted and in doubt.
#[inline(always)]
pub(crate) fn divide_in_one_block(
    out: &mut [u64],
    wanted: Wanted,
    a: &[u64],
    divisor: &[u64],
    reciprocal: &Reciprocal,
) -> bool {
    type Divide = fn(&mut [u64], Wanted, Argument<&[u64]>, Argument<&[u64]>, &Reciprocal) -> bool;
    static BY_LENGTH: [Divide; MAX_WIDTH - 1] = for_each_block!(divide_by_array: 2 3 4 5 6 7 8);
    BY_LENGTH[divisor.len() - 2](
        out,
        wanted,
        Argument::new(a),
        Argument::new(divisor),
        reciprocal,
    )
}

fn divide_by_array<const N: usize, const L: usize>(
    out: &mut [u64],
    wanted: Wanted,
    a: Argument<&[u64]>,
    divisor: Argument<&[u64]>,
    reciprocal: &Reciprocal,
) -> bool {
    let mut padded = [0; L];
    let top = match a[N - 2..].first_chunk::<L>() {
        Some(top) => top,
        None => {
            unroll!(10, i in 0, L => {
                padded[i] = digit_or_zero(&a, N - 2 + i);
            });
            &padded
        }
    };
    let (quotient, above, is_doubtful) = estimate::<N, L>(top, reciprocal.top());
    if wanted == Wanted::Quotient {
        unroll!(i in 0, N => {
            if let Some(out) = out.get_mut(i) {
                *out = quotient[i];
            }
        });
        if let Some(out) = out.get_mut(N) {
            *out = above;
        }
        return !is_doubtful;
    }
    let (out, divisor) = (out.first_chunk_mut::<N>().unwrap(), array::<N>(&divisor));
    *out = subtract_low_product(*array(&a), &quotient, divisor);
    if is_doubtful {
        settle(out, divisor);
    }
    true
}

/// `left` is within a small fraction of `divisor`, modulo the number of digits. Returns whether it was subtracted.
#[cold]
fn settle(left: &mut [u64], divisor: &[u64]) -> bool {
    subtract_assign_same_length(left, divisor);
    let is_negative = left[left.len() - 1] >> 63 != 0;
    if is_negative {
        add_assign_same_length(left, divisor);
    }
    !is_negative
}

type DivideBlock = fn(&mut [u64], Argument<&mut [u64]>, Argument<&[u64]>, &Reciprocal, bool);
static DIVIDE_BLOCK: [DivideBlock; MAX_WIDTH] = for_each_block!(divide_block: 1 2 3 4 5 6 7 8);

/// The top digits of `a` are less than `divisor`, which is trimmed. `a` is as long as `quotient` and `divisor`
/// together, and its low digits become the remainder.
pub(super) fn divide_in_place(
    quotient: &mut [u64],
    a: &mut [u64],
    divisor: &[u64],
    reciprocal: &Reciprocal,
    work: &mut Work<'_>,
) -> Result<(), Error> {
    let blocks = quotient.len().div_ceil(divisor.len().min(MAX_WIDTH));
    let mut end = quotient.len();
    for block in quotient.rchunks_mut(end.div_ceil(blocks.max(1)).max(1)) {
        let start = end - block.len();
        DIVIDE_BLOCK[block.len() - 1](
            block,
            Argument::new(&mut a[start..end + divisor.len()]),
            Argument::new(divisor),
            reciprocal,
            true,
        );
        work.spend(block.len() * (divisor.len() + MAX_WIDTH))?;
        end = start;
    }
    Ok(())
}

/// The same for a quotient of one block, which can come out one too small. Leaves `a` as it is.
pub(super) fn estimate_block(quotient: &mut [u64], a: &mut [u64], reciprocal: &Reciprocal) {
    DIVIDE_BLOCK[quotient.len() - 1](
        quotient,
        Argument::new(a),
        Argument::new(&[]),
        reciprocal,
        false,
    );
}

fn divide_block<const K: usize, const L: usize>(
    quotient: &mut [u64],
    mut a: Argument<&mut [u64]>,
    divisor: Argument<&[u64]>,
    reciprocal: &Reciprocal,
    is_exact: bool,
) {
    let quotient = quotient.first_chunk_mut::<K>().unwrap();
    let (block, _, is_doubtful) = estimate::<K, L>(a.last_chunk().unwrap(), reciprocal.top());
    *quotient = block;
    if !is_exact {
        return;
    }
    let left = &mut a[..divisor.len()];
    let (left_low, left_high) = left.split_last_chunk_mut::<K>().unwrap();
    let (divisor_low, divisor_high) = divisor.split_last_chunk::<K>().unwrap();
    let mut sum = [0; K];
    for (left, &digit) in left_low.iter_mut().zip(divisor_low) {
        *left = !add_row(&mut sum, quotient, digit, !*left);
    }
    let high = subtract_arrays(left_high, &sum).0;
    *left_high = subtract_low_product(high, quotient, divisor_high);
    if is_doubtful && settle(left, &divisor) {
        increment(quotient);
    }
}
