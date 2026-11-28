//! Most matches are near, and `over` is made for a long way.

use bun_simd::prelude::*;

/// How many vectors are looked at one by one.
#[simd]
const NEAR: usize = if Native::<S>::BYTES == 32 { 6 } else { 3 };

/// A bit for each byte of the two vectors of 32 or 64 from `at` on, if any is set. As one vector, they share an address.
#[simd]
fn bits_of_two<T: Unsigned, E: Readable<T>>(
    text: &[E],
    at: usize,
    matches: &impl Fn(SimdN<T, S>) -> MaskN<T, S>,
) -> Option<u128> {
    let (a, b) = if Native::<S>::BYTES == 64 {
        let [a, b] = Simd::<T, B128, S>::load_at(text, at).split();
        (a.resize(), b.resize())
    } else {
        let [a, b] = Simd::<T, B64, S>::load_at(text, at).split();
        (a.resize(), b.resize())
    };
    if (matches(a) | matches(b)).none() {
        return None;
    }
    let (a, b) = (matches(a).to_bitmask(), matches(b).to_bitmask());
    Some(if Native::<S>::BYTES == 64 {
        u128::from(a) | u128::from(b) << 64
    } else {
        u128::from(a | b << 32)
    })
}

/// The first match, or the length.
#[simd]
pub(crate) fn first_near<T: Unsigned, E: Readable<T>>(
    text: &[E],
    matches: impl Fn(SimdN<T, S>) -> MaskN<T, S>,
) -> usize {
    let (n, mut seen, mut rest) = (SimdN::<T, S>::LANES, 0, text);
    let (alone, pairs) = if n == 32 && Native::<S>::BYTES == 32 {
        (3, 3)
    } else {
        (S::NEAR, 0)
    };
    // Lengths are hard to predict, so the start is looked at before long is told from short.
    if Native::<S>::BYTES < 64
        && text.len() >= n
        && let Some(at) = matches(Simd::load_at(text, 0)).first_set()
    {
        return at;
    }
    if Native::<S>::BYTES < 64 && text.len() >= (alone + 2 * pairs + 1) * n {
        unroll!(for i in 1..6 {
            if i < alone
                && let Some(at) = matches(Simd::load_at(text, i * n)).first_set()
            {
                return i * n + at;
            }
        });
        unroll!(for i in 0..3 {
            let at = (alone + 2 * i) * n;
            if i < pairs
                && let Some(bits) = bits_of_two(text, at, &matches)
            {
                return at + (bits as u64).trailing_zeros() as usize;
            }
        });
        seen = (alone + 2 * pairs) * n;
        rest = &text[seen..];
    }
    over(rest)
        .position(matches)
        .map_or(text.len(), |at| seen + at)
}

#[simd]
pub(crate) fn last_near<E: Readable<u8>>(
    text: &[E],
    matches: impl Fn(u8xN<S>) -> MaskN<u8, S>,
) -> Option<usize> {
    let (n, mut rest) = (u8xN::LANES, text);
    if n == 16 && text.len() >= 4 * n {
        unroll!(for _i in 0..3 {
            let at = rest.len() - n;
            if let Some(lane) = matches(u8xN::load_at(rest, at)).last_set() {
                return Some(at + lane);
            }
            rest = &rest[..at];
        });
    }
    if n > 16 && text.len() >= 3 * n {
        let at = text.len() - n;
        if let Some(lane) = matches(u8xN::load_at(text, at)).last_set() {
            return Some(at + lane);
        }
        rest = &text[..at];
        unroll!(for i in 0..8 {
            if i * n < 256
                && let Some(at) = rest.len().checked_sub(2 * n)
            {
                if let Some(bits) = bits_of_two(rest, at, &matches) {
                    core::hint::cold_path();
                    return Some((at + 127).wrapping_sub(bits.leading_zeros() as usize));
                }
                rest = &rest[..at];
            }
        });
        if n == 64 && rest.len() >= 512 {
            let in_two = |far: &[E], at: usize| {
                let [a, b] = Simd::<u8, B128, S>::load_at(far, at).split();
                matches(a.resize()) | matches(b.resize())
            };
            rest = &text[..rest.len() + rest.as_ptr_range().end.addr().wrapping_neg() % n];
            while let Some((before, far)) = rest.split_last_chunk::<256>()
                && (in_two(far, 128) | in_two(far, 0)).none()
            {
                rest = before;
            }
        }
    }
    over(rest).rposition(matches)
}
