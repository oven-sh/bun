//! Both operands are cut in three and the product is interpolated from its values at 0, 1, -1, 2 and infinity.
//! Bodrato and Zanoni, Integer and polynomial multiplication: towards optimal Toom-Cook matrices.

use super::karatsuba::absolute_difference;
use super::{is_square, multiply_medium};
use crate::digits::{
    add, add_assign, add_assign_same_length, shift_bits_left_assign, shift_bits_right_assign,
    subtract_assign, subtract_assign_same_length, subtract_from_same_length,
};

/// `a /= 3`, which leaves no remainder: `a * (2^64 - 1) / 3` is the quotient times `2^64 - 1`.
fn divide_assign_by_three(a: &mut [u64]) {
    let mut pending = 0u64;
    for a in a {
        let (low, high) = a.carrying_mul(u64::MAX / 3, 0);
        let borrow;
        (*a, borrow) = pending.overflowing_sub(low);
        pending = a.wrapping_sub(high).wrapping_sub(u64::from(borrow));
    }
}

struct Thirds<'a>([&'a [u64]; 3]);

impl<'a> Thirds<'a> {
    fn new(a: &'a [u64], third: usize) -> Thirds<'a> {
        let (low, rest) = a.split_at(third);
        let (middle, high) = rest.split_at(third);
        Thirds([low, middle, high])
    }

    /// Returns whether the value at -1, of which the magnitude is written, is negative.
    fn at_one_and_minus_one(&self, at_one: &mut [u64], at_minus_one: &mut [u64]) -> bool {
        let [low, middle, high] = self.0;
        at_one[low.len()] = u64::from(add(&mut at_one[..low.len()], low, high));
        let is_negative = absolute_difference(at_minus_one, at_one, middle);
        add_assign(at_one, middle);
        is_negative
    }

    fn at_two_from_one(&self, value: &mut [u64]) {
        let [low, _, high] = self.0;
        add_assign(value, high);
        shift_bits_left_assign(value, 1);
        subtract_assign(value, low);
    }
}

/// `b` is no longer than `a`, and longer than two of its thirds.
pub(super) fn multiply(out: &mut [u64], a: &[u64], b: &[u64], scratch: &mut [u64]) {
    let is_square = is_square(a, b);
    let third = a.len().div_ceil(3);
    let (a, b) = (Thirds::new(a, third), Thirds::new(b, third));
    let (at_minus_one, scratch) = scratch.split_at_mut(2 * third + 2);
    let (at_one, scratch) = scratch.split_at_mut(2 * third + 2);
    let (at_two, scratch) = scratch.split_at_mut(2 * third + 2);

    let (a_value, b_value) = out[..2 * third + 2].split_at_mut(third + 1);
    let (a_other, b_other) = at_two.split_at_mut(third + 1);
    let mut is_negative = a.at_one_and_minus_one(a_value, a_other);
    if is_square {
        is_negative = false;
        multiply_medium(at_minus_one, a_other, a_other, scratch);
        multiply_medium(at_one, a_value, a_value, scratch);
        a.at_two_from_one(a_value);
        multiply_medium(at_two, a_value, a_value, scratch);
    } else {
        is_negative ^= b.at_one_and_minus_one(b_value, b_other);
        multiply_medium(at_minus_one, a_other, b_other, scratch);
        multiply_medium(at_one, a_value, b_value, scratch);
        a.at_two_from_one(a_value);
        b.at_two_from_one(b_value);
        multiply_medium(at_two, a_value, b_value, scratch);
    }
    let (at_zero, rest) = out.split_at_mut(2 * third);
    let (gap, at_infinity) = rest.split_at_mut(2 * third);
    multiply_medium(at_zero, a.0[0], b.0[0], scratch);
    multiply_medium(at_infinity, a.0[2], b.0[2], scratch);

    let (first, second, last) = (at_minus_one, at_one, at_two);
    if is_negative {
        add_assign_same_length(last, first);
        add_assign_same_length(first, second);
    } else {
        subtract_assign_same_length(last, first);
        subtract_from_same_length(first, second);
    }
    divide_assign_by_three(last);
    shift_bits_right_assign(first, 1);
    subtract_assign(second, at_zero);
    subtract_assign_same_length(last, second);
    shift_bits_right_assign(last, 1);
    subtract_assign_same_length(second, first);
    subtract_assign(second, at_infinity);
    subtract_assign(last, at_infinity);
    subtract_assign(last, at_infinity);
    subtract_assign_same_length(first, last);

    gap.copy_from_slice(&second[..2 * third]);
    add_assign(at_infinity, &second[2 * third..]);
    add_assign(&mut out[third..], first);
    let rest = &mut out[3 * third..];
    add_assign(rest, &last[..last.len().min(rest.len())]);
}
