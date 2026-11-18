use super::{array, digit_or_zero, for_short_length, unroll};

/// `out = a << bits` with `bits < 64`, both of one length. Returns the bits that were pushed out.
pub(crate) fn shift_bits_left(out: &mut [u64], a: &[u64], bits: u32) -> u64 {
    debug_assert!(out.len() == a.len() && bits < 64);
    let ([out_first, out_rest @ ..], [first, ..], [.., last]) = (&mut *out, a, a) else {
        return 0;
    };
    if bits == 0 {
        out.copy_from_slice(a);
        return 0;
    }
    *out_first = first << bits;
    for (out, &[low, high]) in out_rest.iter_mut().zip(a.array_windows()) {
        *out = high << bits | low >> (64 - bits);
    }
    last >> (64 - bits)
}

/// `out = a >> bits` with `bits < 64`. `out` is as long as `a`, or one digit shorter to leave the top digit out.
pub(crate) fn shift_bits_right(out: &mut [u64], a: &[u64], bits: u32) {
    debug_assert!(a.len() - out.len() <= 1 && bits < 64);
    if bits == 0 {
        out.copy_from_slice(&a[..out.len()]);
        return;
    }
    for (out, &[low, high]) in out.iter_mut().zip(a.array_windows()) {
        *out = low >> bits | high << (64 - bits);
    }
    if out.len() == a.len()
        && let (Some(out), Some(last)) = (out.last_mut(), a.last())
    {
        *out = last >> bits;
    }
}

/// `out = a << amount`. `out` has room for the digits of `a`, for the result, and for at most one digit more
/// than `a` reaches.
#[inline(always)]
pub(crate) fn shift_left(out: &mut [u64], a: &[u64], amount: usize) {
    let (zeros, out) = out.split_at_mut(amount / 64);
    if !zeros.is_empty() {
        zeros.fill(0);
    }
    let bits = (amount % 64) as u32;
    // Where there is no digit above, this is one that is written next.
    out[out.len() - 1] = 0u64.funnel_shl(a[a.len() - 1], bits);
    let out = &mut out[..a.len()];
    for_short_length!(a.len(), |N| {
        out[0] = a[0] << bits;
        unroll!(i in 1, N => {
            out[i] = a[i].funnel_shl(a[i - 1], bits);
        });
    }, _ => {
        shift_bits_left(out, a, bits);
    });
}

/// `out = a >> amount`. `out` has room for the result, and for no more digits than are left of `a`.
#[inline(always)]
pub(crate) fn shift_right(out: &mut [u64], a: &[u64], amount: usize) {
    let (a, bits) = (&a[amount / 64..], (amount % 64) as u32);
    for_short_length!(out.len(), |N| {
        let (above, a) = (digit_or_zero(a, N), array::<N>(a));
        unroll!(i in 1, N => {
            out[i - 1] = a[i].funnel_shr(a[i - 1], bits);
        });
        out[N - 1] = above.funnel_shr(a[N - 1], bits);
    }, _ => shift_bits_right(out, a, bits));
}

/// `a >>= bits` with `0 < bits < 64`.
pub(crate) fn shift_bits_right_assign(a: &mut [u64], bits: u32) {
    debug_assert!((1..64).contains(&bits));
    for index in 1..a.len() {
        a[index - 1] = a[index - 1] >> bits | a[index] << (64 - bits);
    }
    if let Some(last) = a.last_mut() {
        *last >>= bits;
    }
}

/// `a <<= bits` with `0 < bits < 64`, where the result fits.
pub(crate) fn shift_bits_left_assign(a: &mut [u64], bits: u32) {
    debug_assert!((1..64).contains(&bits));
    for index in (1..a.len()).rev() {
        a[index] = a[index] << bits | a[index - 1] >> (64 - bits);
    }
    if let Some(first) = a.first_mut() {
        *first <<= bits;
    }
}
