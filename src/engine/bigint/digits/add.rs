use super::{NO_BORROW, add_with_carry, subtract_with_flag, unroll};

type Step = fn(u64, u64, bool) -> (u64, bool);

#[inline(always)]
fn run<const N: usize>(mut a: [u64; N], b: &[u64; N], flag: &mut bool, step: Step) -> [u64; N] {
    unroll!(i in 0, N => {
        (a[i], *flag) = step(a[i], b[i], *flag);
    });
    a
}

/// Does the runs of `N` digits and returns what is left of each slice.
#[inline(always)]
fn runs<'o, 'a, 'b, const N: usize>(
    (out, a, b): (&'o mut [u64], &'a [u64], &'b [u64]),
    flag: &mut bool,
    step: Step,
) -> (&'o mut [u64], &'a [u64], &'b [u64]) {
    let (out, out_rest) = out.as_chunks_mut::<N>();
    let ((a, a_rest), (b, b_rest)) = (a.as_chunks(), b.as_chunks());
    for ((out, a), b) in out.iter_mut().zip(a).zip(b) {
        *out = run(*a, b, flag, step);
    }
    (out_rest, a_rest, b_rest)
}

#[inline(always)]
fn runs_in_place<'a, 'b, const N: usize>(
    (a, b): (&'a mut [u64], &'b [u64]),
    flag: &mut bool,
    step: Step,
) -> (&'a mut [u64], &'b [u64]) {
    let ((a, a_rest), (b, b_rest)) = (a.as_chunks_mut::<N>(), b.as_chunks());
    for (a, b) in a.iter_mut().zip(b) {
        *a = run(*a, b, flag, step);
    }
    (a_rest, b_rest)
}

#[inline(always)]
fn combine(out: &mut [u64], a: &[u64], b: &[u64], mut flag: bool, step: Step) -> bool {
    let (a, b) = (&a[..out.len()], &b[..out.len()]);
    let rest = runs::<8>((out, a, b), &mut flag, step);
    let rest = runs::<4>(rest, &mut flag, step);
    runs::<1>(rest, &mut flag, step);
    flag
}

#[inline(always)]
fn combine_in_place(a: &mut [u64], b: &[u64], mut flag: bool, step: Step) -> bool {
    let b = &b[..a.len()];
    let rest = runs_in_place::<8>((a, b), &mut flag, step);
    let rest = runs_in_place::<4>(rest, &mut flag, step);
    runs_in_place::<1>(rest, &mut flag, step);
    flag
}

#[inline(always)]
pub(crate) fn add_arrays<const N: usize>(
    a: &[u64; N],
    b: &[u64; N],
    mut carry: bool,
) -> ([u64; N], bool) {
    (run(*a, b, &mut carry, add_with_carry), carry)
}

#[inline(always)]
pub(crate) fn subtract_arrays<const N: usize>(a: &[u64; N], b: &[u64; N]) -> ([u64; N], bool) {
    let mut flag = NO_BORROW;
    (run(*a, b, &mut flag, subtract_with_flag), flag != NO_BORROW)
}

/// `out = a + b`, all of one length. Returns the carry.
pub(crate) fn add_same_length(out: &mut [u64], a: &[u64], b: &[u64]) -> bool {
    combine(out, a, b, false, add_with_carry)
}

/// `out = a - b`, all of one length. Returns the borrow.
pub(crate) fn subtract_same_length(out: &mut [u64], a: &[u64], b: &[u64]) -> bool {
    combine(out, a, b, NO_BORROW, subtract_with_flag) != NO_BORROW
}

/// `a += b`, both of one length. Returns the carry.
pub(crate) fn add_assign_same_length(a: &mut [u64], b: &[u64]) -> bool {
    combine_in_place(a, b, false, add_with_carry)
}

/// `a -= b`, both of one length. Returns the borrow.
pub(crate) fn subtract_assign_same_length(a: &mut [u64], b: &[u64]) -> bool {
    combine_in_place(a, b, NO_BORROW, subtract_with_flag) != NO_BORROW
}

/// `a = b - a`, both of one length. Returns the borrow.
pub(crate) fn subtract_from_same_length(a: &mut [u64], b: &[u64]) -> bool {
    let step: Step = |a, b, flag| subtract_with_flag(b, a, flag);
    combine_in_place(a, b, NO_BORROW, step) != NO_BORROW
}

/// Copies `a` with a carry running through it as far as it goes.
#[inline(always)]
fn copy_with(out: &mut [u64], a: &[u64], mut carry: bool, step: Step) -> bool {
    const SHORT: usize = 4;
    let out = &mut out[..a.len()];
    let mut done = 0;
    while done < a.len() && (carry || a.len() <= SHORT) {
        (out[done], carry) = step(a[done], 0, carry);
        done += 1;
    }
    if done < a.len() {
        out[done..].copy_from_slice(&a[done..]);
    }
    carry
}

/// `out = a + b`. `out` is as long as `a`, and `b` is no longer. Returns the carry.
pub(crate) fn add(out: &mut [u64], a: &[u64], b: &[u64]) -> bool {
    let (out_low, out_high) = out.split_at_mut(b.len());
    let (a_low, a_high) = a.split_at(b.len());
    let carry = add_same_length(out_low, a_low, b);
    copy_with(out_high, a_high, carry, u64::carrying_add)
}

/// `out = a - b`. `out` is as long as `a`, and `b` is no longer. Returns the borrow.
pub(crate) fn subtract(out: &mut [u64], a: &[u64], b: &[u64]) -> bool {
    let (out_low, out_high) = out.split_at_mut(b.len());
    let (a_low, a_high) = a.split_at(b.len());
    let borrow = subtract_same_length(out_low, a_low, b);
    copy_with(out_high, a_high, borrow, u64::borrowing_sub)
}

/// Does `step` on operands of a few digits without a loop, if they are such.
#[inline(always)]
fn combine_short(
    out: &mut [u64],
    a: &[u64],
    b: &[u64],
    mut flag: bool,
    step: Step,
) -> Option<bool> {
    macro_rules! lengths {
        ($($long:literal $short:literal),*) => {
            match (out.len(), b.len()) {
                $(($long, $short) => {
                    let mut padded = [0; $long];
                    padded[..$short].copy_from_slice(b);
                    *out.as_mut_array()? = run(*a.first_chunk()?, &padded, &mut flag, step);
                })*
                _ => return None,
            }
        };
    }
    lengths!(2 2, 3 3, 4 4, 5 5, 6 6, 7 7, 8 8, 5 4, 4 3, 4 1, 3 1, 3 2);
    Some(flag)
}

/// [`add`], to be inlined where short operands are common.
#[inline(always)]
pub(crate) fn add_into(out: &mut [u64], a: &[u64], b: &[u64]) -> bool {
    combine_short(out, a, b, false, add_with_carry).unwrap_or_else(|| add(out, a, b))
}

/// `out = a - b`, cut to the length of `out`. `a` is no shorter than that.
#[inline(always)]
pub(crate) fn subtract_into(out: &mut [u64], a: &[u64], b: &[u64]) {
    if combine_short(out, a, b, NO_BORROW, subtract_with_flag).is_none() {
        subtract(out, &a[..out.len()], &b[..b.len().min(out.len())]);
    }
}

/// `a += b`, where `b` is no longer. Returns the carry.
#[inline]
pub(crate) fn add_assign(a: &mut [u64], b: &[u64]) -> bool {
    let (low, high) = a.split_at_mut(b.len());
    let carry = add_assign_same_length(low, b);
    add_assign_digit(high, u64::from(carry))
}

/// `a -= b`, where `b` is no longer. Returns the borrow.
#[inline]
pub(crate) fn subtract_assign(a: &mut [u64], b: &[u64]) -> bool {
    let (low, high) = a.split_at_mut(b.len());
    let borrow = subtract_assign_same_length(low, b);
    subtract_assign_digit(high, u64::from(borrow))
}

/// `a += digit`. Returns whether something is left to carry.
#[inline]
pub(crate) fn add_assign_digit(a: &mut [u64], digit: u64) -> bool {
    let [first, rest @ ..] = a else {
        return digit != 0;
    };
    let carry;
    (*first, carry) = first.overflowing_add(digit);
    carry && increment(rest)
}

/// `a -= digit`. Returns whether something is left to borrow.
#[inline]
pub(crate) fn subtract_assign_digit(a: &mut [u64], digit: u64) -> bool {
    let [first, rest @ ..] = a else {
        return digit != 0;
    };
    let borrow;
    (*first, borrow) = first.overflowing_sub(digit);
    borrow && decrement(rest)
}

/// `a += 1`. Returns the carry.
#[inline]
pub(crate) fn increment(a: &mut [u64]) -> bool {
    a.iter_mut().all(|digit| {
        *digit = digit.wrapping_add(1);
        *digit == 0
    })
}

/// `a -= 1`. Returns the borrow.
#[inline]
pub(crate) fn decrement(a: &mut [u64]) -> bool {
    a.iter_mut().all(|digit| {
        *digit = digit.wrapping_sub(1);
        *digit == u64::MAX
    })
}
