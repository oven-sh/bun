//! Natural numbers as slices of digits, least significant first.

mod add;
mod argument;
mod carry;
mod divide;
mod multiply;
mod shift;
mod unroll;

use core::cmp::Ordering;

pub(crate) use add::*;
pub(crate) use argument::*;
pub(crate) use carry::*;
pub(crate) use divide::*;
pub(crate) use multiply::*;
pub(crate) use shift::*;
pub(crate) use unroll::*;

#[inline]
pub(crate) fn trim(mut digits: &[u64]) -> &[u64] {
    while let [rest @ .., 0] = digits {
        digits = rest;
    }
    digits
}

/// The low digits of `a`, as many as `out` has.
#[inline(always)]
pub(crate) fn copy(out: &mut [u64], a: &[u64]) {
    for_short_length!(
        out.len(),
        |N| out.copy_from_slice(array::<N>(a)),
        _ => out.copy_from_slice(&a[..out.len()])
    );
}

#[inline]
pub(crate) fn low_zero_count(digits: &[u64]) -> usize {
    digits.iter().take_while(|&&digit| digit == 0).count()
}

#[inline(always)]
pub(crate) fn digit_or_zero(digits: &[u64], index: usize) -> u64 {
    digits.get(index).copied().unwrap_or(0)
}

#[inline(always)]
pub(crate) fn join(low: u64, high: u64) -> u128 {
    u128::from(high) << 64 | u128::from(low)
}

#[inline(always)]
pub(crate) fn to_u128(digits: &[u64]) -> Option<u128> {
    match *digits {
        [] => Some(0),
        [low] => Some(u128::from(low)),
        [low, high] => Some(join(low, high)),
        _ => None,
    }
}

/// Of trimmed digits.
#[inline]
pub(crate) fn bit_length(digits: &[u64]) -> usize {
    match digits {
        [] => 0,
        [rest @ .., top] => rest.len() * 64 + top.bit_width() as usize,
    }
}

/// The 64 bits from the leading one of trimmed digits down.
#[inline]
pub(crate) fn top_bits(digits: &[u64]) -> u64 {
    match *digits {
        [] => 0,
        [top] => top << top.leading_zeros(),
        [.., next, top] => top.funnel_shl(next, top.leading_zeros()),
    }
}

/// Whether [`top_bits`] leaves a one out.
pub(crate) fn has_bits_below_top(digits: &[u64]) -> bool {
    match *digits {
        [] | [_] => false,
        [ref rest @ .., next, top] => {
            next << top.leading_zeros() != 0 || rest.iter().any(|&digit| digit != 0)
        }
    }
}

/// Of trimmed digits.
#[inline]
pub(crate) fn compare(a: &[u64], b: &[u64]) -> Ordering {
    a.len()
        .cmp(&b.len())
        .then_with(|| compare_same_length(a, b))
}

#[inline]
pub(crate) fn compare_same_length(a: &[u64], b: &[u64]) -> Ordering {
    debug_assert!(a.len() == b.len());
    match a.iter().zip(b).rev().find(|(a, b)| a != b) {
        Some((a, b)) => a.cmp(b),
        None => Ordering::Equal,
    }
}
