//! Products with a short operand: it is multiplied by one digit of the other at a time, and the sums stay in registers.

use crate::digits::{Argument, add_with_carry, subtract_arrays, subtract_same_length, unroll};

/// The most digits in a row.
pub(crate) const MAX_WIDTH: usize = 8;

/// `a * factor + addend` and the digit above. Multiplies first, so that one run of additions joins the halves.
#[inline(always)]
pub(crate) fn scale<const N: usize>(a: &[u64; N], factor: u64, addend: u64) -> ([u64; N], u64) {
    let (mut low, mut high) = ([0; N], [0; N]);
    unroll!(i in 0, N => {
        (low[i], high[i]) = a[i].carrying_mul(factor, 0);
    });
    let (mut below, mut carry) = (addend, false);
    unroll!(i in 0, N => {
        (low[i], carry) = add_with_carry(low[i], below, carry);
        below = high[i];
    });
    (low, below.wrapping_add(u64::from(carry)))
}

/// Adds `a * factor + addend` to `sum`, returns the lowest digit and moves the others down.
#[inline(always)]
pub(crate) fn add_row<const N: usize>(
    sum: &mut [u64; N],
    a: &[u64; N],
    factor: u64,
    addend: u64,
) -> u64 {
    let (row, top) = scale(a, factor, addend);
    let (lowest, mut carry) = sum[0].overflowing_add(row[0]);
    unroll!(i in 1, N => {
        (sum[i - 1], carry) = add_with_carry(sum[i], row[i], carry);
    });
    sum[N - 1] = top.wrapping_add(u64::from(carry));
    lowest
}

/// `out = a * factor + carry`, both of one length. Returns the digit above.
#[inline]
pub(crate) fn multiply_digit(out: &mut [u64], a: &[u64], factor: u64, mut carry: u64) -> u64 {
    let a = &a[..out.len()];
    let ((out, out_rest), (a, a_rest)) = (out.as_chunks_mut::<4>(), a.as_chunks());
    for (out, a) in out.iter_mut().zip(a) {
        (*out, carry) = scale(a, factor, carry);
    }
    for (out, a) in out_rest.iter_mut().zip(a_rest) {
        (*out, carry) = a.carrying_mul(factor, carry);
    }
    carry
}

/// [`multiply_digit`] without a carry, to be inlined where `a` is short.
#[inline(always)]
pub(crate) fn multiply_short_by_digit(out: &mut [u64], a: &[u64], factor: u64) -> u64 {
    if let (Some(out), Some(a)) = (out.first_chunk_mut::<4>(), a.as_array()) {
        let top;
        (*out, top) = scale(a, factor, 0);
        return top;
    }
    let mut carry = 0;
    for (out, a) in out.iter_mut().zip(a) {
        (*out, carry) = a.carrying_mul(factor, carry);
    }
    carry
}

/// `a = a * factor + carry`. Returns the digit above.
pub(crate) fn multiply_assign_digit(a: &mut [u64], factor: u64, mut carry: u64) -> u64 {
    let (a, rest) = a.as_chunks_mut::<4>();
    for a in a {
        (*a, carry) = scale(a, factor, carry);
    }
    for a in rest {
        (*a, carry) = a.carrying_mul(factor, carry);
    }
    carry
}

/// `a -= b * factor`, both of one length. Returns what is left to subtract from the digit above.
pub(crate) fn multiply_subtract_digit(a: &mut [u64], b: &[u64], factor: u64) -> u64 {
    let b = &b[..a.len()];
    let ((a, a_rest), (b, b_rest)) = (a.as_chunks_mut::<4>(), b.as_chunks());
    let mut carry = 0;
    for (a, b) in a.iter_mut().zip(b) {
        let (product, top) = scale(b, factor, carry);
        let borrow;
        (*a, borrow) = subtract_arrays(a, &product);
        carry = top.wrapping_add(u64::from(borrow));
    }
    for (a, b) in a_rest.iter_mut().zip(b_rest) {
        let (product, top) = b.carrying_mul(factor, carry);
        let borrow;
        (*a, borrow) = a.overflowing_sub(product);
        carry = top.wrapping_add(u64::from(borrow));
    }
    carry
}

/// `out = a - b * factor`, cut to the length of `out`, which is that of `b`.
#[inline(always)]
pub(crate) fn subtract_multiple(out: &mut [u64], a: &[u64], b: &[u64], factor: u64) {
    if let (Some(out), Some(a), Some(b)) = (out.as_mut_array::<4>(), a.first_chunk(), b.as_array())
    {
        *out = subtract_arrays(a, &scale(b, factor, 0).0).0;
    } else if factor == 1 {
        subtract_same_length(out, a, b);
    } else {
        out.copy_from_slice(&a[..b.len()]);
        multiply_subtract_digit(out, b, factor);
    }
}

type Multiply = fn(Argument<&mut [u64]>, Argument<&[u64]>, Argument<&[u64]>) -> u64;

macro_rules! for_each_width {
    (|$width:ident| $function:expr) => {
        for_each_width!(|$width| $function, 1 2 3 4 5 6 7 8)
    };
    (|$width:ident| $function:expr, $($value:literal)*) => {
        [$({
            const $width: usize = $value;
            $function
        }),*]
    };
}

#[inline(always)]
fn call(table: &[Multiply; MAX_WIDTH], out: &mut [u64], long: &[u64], short: &[u64]) -> u64 {
    table[short.len() - 1](
        Argument::new(out),
        Argument::new(long),
        Argument::new(short),
    )
}

/// `short` has at most [`MAX_WIDTH`] digits. Writes all digits of the product but the top one, which it returns.
#[inline(always)]
pub(crate) fn multiply_narrow(out: &mut [u64], long: &[u64], short: &[u64]) -> u64 {
    static SQUARE: [Multiply; MAX_WIDTH] = for_each_width!(|N| square_array::<N>);
    static SAME_LENGTH: [Multiply; MAX_WIDTH] = for_each_width!(|N| multiply_arrays::<N>);
    static ANY_LENGTH: [Multiply; MAX_WIDTH] = for_each_width!(|N| multiply_by_array::<N, false>);
    let table = if long.len() != short.len() {
        &ANY_LENGTH
    } else if long.as_ptr() == short.as_ptr() {
        &SQUARE
    } else {
        &SAME_LENGTH
    };
    call(table, out, long, short)
}

/// Like [`multiply_narrow`], but adds the first `long.len()` digits of `out` to the product.
#[inline(always)]
pub(crate) fn multiply_add_narrow(out: &mut [u64], long: &[u64], short: &[u64]) -> u64 {
    static ADD: [Multiply; MAX_WIDTH] = for_each_width!(|N| multiply_by_array::<N, true>);
    call(&ADD, out, long, short)
}

/// `out = a * b`
#[inline(always)]
pub(super) fn multiply_arrays_into<const N: usize>(out: &mut [u64], a: &[u64], b: &[u64]) {
    out[2 * N - 1] = multiply_arrays::<N>(Argument::new(out), Argument::new(a), Argument::new(b));
}

/// `out = a * a`
#[inline(always)]
pub(super) fn square_array_into<const N: usize>(out: &mut [u64], a: &[u64]) {
    out[2 * N - 1] = square_array::<N>(Argument::new(out), Argument::new(a), Argument::new(a));
}

#[inline(always)]
pub(crate) fn array<const N: usize>(digits: &[u64]) -> &[u64; N] {
    digits.first_chunk().unwrap()
}

#[inline(never)]
fn multiply_arrays<const N: usize>(
    mut out: Argument<&mut [u64]>,
    a: Argument<&[u64]>,
    b: Argument<&[u64]>,
) -> u64 {
    let (out, a, b) = (&mut out[..2 * N - 1], array::<N>(&a), array::<N>(&b));
    let mut sum = [0; N];
    unroll!(i in 0, N => {
        out[i] = add_row(&mut sum, a, b[i], 0);
    });
    unroll!(i in 1, N => {
        out[N - 1 + i] = sum[i - 1];
    });
    sum[N - 1]
}

fn multiply_by_array<const N: usize, const ADDS: bool>(
    mut out: Argument<&mut [u64]>,
    a: Argument<&[u64]>,
    b: Argument<&[u64]>,
) -> u64 {
    let b = array::<N>(&b);
    let (low, high) = out.split_at_mut(a.len());
    if N == 1 && !ADDS {
        return multiply_digit(low, &a, b[0], 0);
    }
    let high = &mut high[..N - 1];
    let mut sum = [0; N];
    for (out, &factor) in low.iter_mut().zip(a.iter()) {
        *out = add_row(&mut sum, b, factor, if ADDS { *out } else { 0 });
    }
    unroll!(i in 1, N => {
        high[i - 1] = sum[i - 1];
    });
    sum[N - 1]
}

/// The products of two different digits are summed once and doubled.
#[inline(never)]
fn square_array<const N: usize>(
    mut out: Argument<&mut [u64]>,
    a: Argument<&[u64]>,
    _: Argument<&[u64]>,
) -> u64 {
    let (out, a) = (&mut out[..2 * N - 1], array::<N>(&a));
    let mut cross = [[0; N]; 2];
    let cross = cross.as_flattened_mut();
    unroll!(i in 0, N - 1 => {
        let (mut low, mut high) = ([0; N], [0; N]);
        unroll!(j in i + 1, N => {
            (low[j], high[j]) = a[j].carrying_mul(a[i], 0);
        });
        let mut carry = false;
        unroll!(j in i + 2, N => {
            (low[j], carry) = add_with_carry(low[j], high[j - 1], carry);
        });
        let top = high[N - 1].wrapping_add(u64::from(carry));
        carry = false;
        unroll!(j in i + 1, N => {
            (cross[i + j], carry) = add_with_carry(cross[i + j], low[j], carry);
        });
        cross[i + N] = top.wrapping_add(u64::from(carry));
    });
    let mut squares = [[0; 2]; N];
    unroll!(i in 0, N => {
        squares[i] = a[i].carrying_mul(a[i], 0).into();
    });
    let squares = squares.as_flattened_mut();
    let mut carry = false;
    unroll!(16, k in 1, 2 * N => {
        (cross[k], carry) = add_with_carry(cross[k], cross[k], carry);
    });
    carry = false;
    unroll!(16, k in 1, 2 * N => {
        (squares[k], carry) = add_with_carry(squares[k], cross[k], carry);
    });
    unroll!(16, k in 0, 2 * N - 1 => {
        out[k] = squares[k];
    });
    squares[2 * N - 1]
}
