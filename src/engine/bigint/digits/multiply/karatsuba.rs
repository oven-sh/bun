use core::cmp::Ordering;
use core::hint::select_unpredictable;

use super::rows::{MAX_WIDTH, array, multiply_arrays_into, square_array_into};
use super::{is_square, multiply_medium};
use crate::digits::{
    add_arrays, add_assign_digit, compare_same_length, decrement, increment, subtract_arrays,
    subtract_same_length, unroll,
};

/// `out = |low - high|`. `out` is as long as `low`, and `high` is no longer. Returns whether `low` is less.
#[inline(always)]
pub(super) fn absolute_difference(out: &mut [u64], low: &[u64], high: &[u64]) -> bool {
    let (low, low_above) = low.split_at(high.len());
    let (out, out_above) = out.split_at_mut(high.len());
    let is_less = low_above.iter().all(|&digit| digit == 0)
        && compare_same_length(low, high) == Ordering::Less;
    let (larger, smaller) = select_unpredictable(is_less, (high, low), (low, high));
    let mut borrow = subtract_same_length(out, larger, smaller);
    for (out, above) in out_above.iter_mut().zip(low_above) {
        (*out, borrow) = above.overflowing_sub(u64::from(borrow));
    }
    is_less
}

/// `b` is no longer than `a`, and longer than half of it.
pub(super) fn multiply(out: &mut [u64], a: &[u64], b: &[u64], scratch: &mut [u64]) {
    let half = a.len().div_ceil(2);
    let ((a0, a1), (b0, b1)) = (a.split_at(half), b.split_at(half));
    let (middle, scratch) = scratch.split_at_mut(2 * half);
    let (low, high) = out.split_at_mut(2 * half);

    let (a_difference, b_difference) = low.split_at_mut(half);
    let a_is_negative = absolute_difference(a_difference, a0, a1);
    let middle_is_negative = if is_square(a, b) {
        multiply_medium(middle, a_difference, a_difference, scratch);
        false
    } else {
        let b_is_negative = absolute_difference(b_difference, b0, b1);
        multiply_medium(middle, a_difference, b_difference, scratch);
        a_is_negative != b_is_negative
    };
    multiply_medium(low, a0, b0, scratch);
    multiply_medium(high, a1, b1, scratch);
    interpolate(out, middle, middle_is_negative);
}

/// The sum of four digits and `carry`, which becomes what is above it.
#[inline(always)]
fn sum(shared: u128, a: u64, b: u64, carry: &mut u64) -> u64 {
    let sum = shared + u128::from(a) + u128::from(b) + u128::from(*carry);
    *carry = (sum >> 64) as u64;
    sum as u64
}

/// Adds the low product and the high product less `middle` to the center of `out`, which holds the two.
#[inline(always)]
fn interpolate(out: &mut [u64], middle: &[u64], middle_is_negative: bool) {
    let quarter = middle.len() / 2;
    let (first, rest) = out.split_at_mut(quarter);
    let (second, upper) = rest.split_at_mut(quarter);
    let (third, fourth) = upper.split_at_mut(quarter);
    let (middle_low, middle_high) = middle.split_at(quarter);
    let middle_high = &middle_high[..quarter];
    let subtracts = u64::from(!middle_is_negative);
    let complement = subtracts.wrapping_neg();

    let (mut low_carry, mut high_carry) = (subtracts, 0);
    macro_rules! step {
        ($i:expr, $from_fourth:expr) => {
            let shared = u128::from(second[$i]) + u128::from(third[$i]);
            second[$i] = sum(
                shared,
                first[$i],
                middle_low[$i] ^ complement,
                &mut low_carry,
            );
            third[$i] = sum(
                shared,
                $from_fourth,
                middle_high[$i] ^ complement,
                &mut high_carry,
            );
        };
    }
    assert!(fourth.len() <= quarter);
    for i in 0..fourth.len() {
        step!(i, fourth[i]);
    }
    for i in fourth.len()..quarter {
        step!(i, 0);
    }

    add_assign_digit(upper, low_carry);
    add_assign_signed(&mut upper[quarter..], high_carry as i64 - subtracts as i64);
}

#[inline(always)]
fn add_assign_signed(a: &mut [u64], change: i64) {
    if let [lowest, rest @ ..] = a {
        let wraps;
        (*lowest, wraps) = lowest.overflowing_add_signed(change);
        if wraps {
            carry_or_borrow(rest, change);
        }
    }
}

#[cold]
#[inline(never)]
fn carry_or_borrow(a: &mut [u64], change: i64) {
    if change < 0 {
        decrement(a);
    } else {
        increment(a);
    }
}

/// `|low - high|` and whether `low` is less.
#[inline(always)]
fn array_difference<const LOW: usize, const HIGH: usize>(
    low: &[u64; LOW],
    high: &[u64; HIGH],
) -> ([u64; LOW], bool) {
    let mut padded = [0; LOW];
    unroll!(i in 0, HIGH => {
        padded[i] = high[i];
    });
    let (mut difference, is_less) = subtract_arrays(low, &padded);
    let complement = u64::from(is_less).wrapping_neg();
    unroll!(i in 0, LOW => {
        difference[i] ^= complement;
    });
    (add_arrays(&difference, &[0; LOW], is_less).0, is_less)
}

/// Both operands have one length, above [`MAX_WIDTH`] and at most twice that.
#[inline(always)]
pub(super) fn multiply_by_narrow_halves(out: &mut [u64], a: &[u64], b: &[u64]) {
    static BY_LENGTH: [fn(&mut [u64], &[u64], &[u64]); MAX_WIDTH] = [
        multiply_halves::<5, 4>,
        multiply_halves::<5, 5>,
        multiply_halves::<6, 5>,
        multiply_halves::<6, 6>,
        multiply_halves::<7, 6>,
        multiply_halves::<7, 7>,
        multiply_halves::<8, 7>,
        multiply_halves::<8, 8>,
    ];
    BY_LENGTH[a.len() - MAX_WIDTH - 1](out, a, b);
}

/// Both operands have `LOW + HIGH` digits, with `HIGH` equal to `LOW` or one less.
fn multiply_halves<const LOW: usize, const HIGH: usize>(out: &mut [u64], a: &[u64], b: &[u64]) {
    let out = &mut out[..2 * (LOW + HIGH)];
    let (a, b) = (&a[..LOW + HIGH], &b[..LOW + HIGH]);
    let ((a0, a1), (b0, b1)) = (a.split_at(LOW), b.split_at(LOW));
    let (low, high) = out.split_at_mut(2 * LOW);
    let mut middle = [[0; LOW]; 2];

    let (a_difference, a_is_negative) = array_difference::<LOW, HIGH>(array(a0), array(a1));
    let subtracts = if is_square(a, b) {
        square_array_into::<LOW>(middle.as_flattened_mut(), &a_difference);
        square_array_into::<LOW>(low, a0);
        square_array_into::<HIGH>(high, a1);
        true
    } else {
        let (b_difference, b_is_negative) = array_difference::<LOW, HIGH>(array(b0), array(b1));
        multiply_arrays_into::<LOW>(middle.as_flattened_mut(), &a_difference, &b_difference);
        multiply_arrays_into::<LOW>(low, a0, b0);
        multiply_arrays_into::<HIGH>(high, a1, b1);
        a_is_negative == b_is_negative
    };

    let complement = u64::from(subtracts).wrapping_neg();
    let mut fourth = [0; LOW];
    unroll!(i in 0, LOW => {
        middle[0][i] ^= complement;
        middle[1][i] ^= complement;
        if i < 2 * HIGH - LOW {
            fourth[i] = high[LOW + i];
        }
    });
    let (shared, shared_carry) = add_arrays::<LOW>(array(&low[LOW..]), array(high), false);
    let (shared_above, _) = add_arrays(&shared, &[0; LOW], shared_carry);
    let (second, carry) = add_arrays(&shared, array(low), false);
    let (third, carry) = add_arrays(&shared_above, &fourth, carry);
    let (second, middle_carry) = add_arrays(&second, &middle[0], subtracts);
    let (third, middle_carry) = add_arrays(&third, &middle[1], middle_carry);
    low[LOW..].copy_from_slice(&second);
    high[..LOW].copy_from_slice(&third);
    let change = i64::from(shared_carry) - i64::from(subtracts);
    let change = change + i64::from(carry) + i64::from(middle_carry);
    add_assign_signed(&mut high[LOW..], change);
}
