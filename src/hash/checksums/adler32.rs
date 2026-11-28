//! The Adler-32 of zlib.

use super::input::{Copies, Input, Source, copying};
use bun_simd::prelude::*;
use std::io::BorrowedCursor;

targets!(neon82, default);

const X86: bool = cfg!(target_arch = "x86_64");
/// What can be added up without an overflow.
pub(super) const PIECE: usize = if X86 { 65536 } else { 16384 };
const MODULUS: u32 = 65521;

#[simd]
type Bytes<W> = Simd<u8, W, S>;
#[simd]
type Sums<W> = Simd<u32, W, S>;

#[simd]
const HAS_DOT: bool = has!(vnni | dot);
#[simd]
const GROUP: usize = (if X86 { 128 } else { 64 }) * if S::HAS_DOT { 2 } else { 1 };
/// Taken off the weights of a group to get them into signed bytes.
#[simd]
const BIAS: usize = if X86 {
    S::GROUP / 2 + 1
} else {
    S::HAS_DOT as usize
};

#[simd]
fn add_bytes<W: Width>(sums: Sums<W, S>, bytes: Bytes<W, S>) -> Sums<W, S> {
    if X86 && !S::HAS_DOT {
        sums + bytes.sum_groups::<u64>().bitcast()
    } else {
        bytes.dot_add::<u32>(1, sums)
    }
}

/// A group of one vector.
#[simd]
fn add_vector<W: Width>(x: Bytes<W, S>, [sums_before, sum, weighted]: &mut [Sums<W, S>; 3]) {
    *sums_before += *sum;
    *sum = add_bytes(*sum, x);
    *weighted = x.dot_add(W::BYTES as u8 - Bytes::<W, S>::iota(0), *weighted);
}

/// A byte counts in `b` once for every byte up to the end of its group, and `group` times for every group behind it.
#[simd]
fn in_groups<W: Width, C: Copies>(adler: u32, input: &mut Input<C>) -> u32 {
    let (n, group, bias) = (W::BYTES, S::GROUP, S::BIAS);
    let vectors = group / n;
    let weights = |left: usize| left.wrapping_sub(bias) as u8 - Bytes::<W, S>::iota(0);

    let a = adler & 0xFFFF;
    let mut b = (adler >> 16) as u64 + a as u64 * input.len() as u64;
    // Whether the upper half fits 32 bits before it is reduced.
    let is_short = input.len() <= 5552;
    // The first group is as short as it takes for the others to be whole.
    let left = input.len() % group;
    let (mut sum, mut weighted) = (Sums::<W, S>::zero(), Sums::<W, S>::zero());
    let odd = left % n;
    if odd != 0 {
        let x = input.start_of_vector(odd) & Bytes::<W, S>::load(&FIRST.0[1][64 - odd..]);
        sum = add_bytes(sum, x);
        weighted = x.dot_add_relaxed(Simd::load(&FIRST.0[0][64 - odd..]), weighted);
    }
    let mut all = [Sums::<W, S>::zero(), sum, weighted];
    for _ in 0..(left - odd) / n {
        not_unrolled();
        add_vector(input.vector(), &mut all);
    }
    sum = all[1];
    weighted = all[2] + (all[0] << n.ilog2()) - sum * bias as u32;

    if input.len() != 0 {
        let mut sums_before = Sums::<W, S>::zero();
        if S::HAS_DOT {
            let mut ways = [Simd::<i32, W, S>::zero(); 16];
            input.groups(
                group,
                #[inline(always)]
                |input| {
                    let mut x = [Bytes::<W, S>::zero(); 16];
                    // Unrolled, so that the weights are constants.
                    unroll!(for i in 0..16 {
                        if i < vectors {
                            x[i] = input.vector();
                            ways[i] = x[i].dot_add(weights(group - i * n).cast_signed(), ways[i]);
                        }
                    });
                    let mut added = Sums::<W, S>::zero();
                    for i in 0..vectors {
                        added = add_bytes(added, x[i]);
                    }
                    sums_before += sum;
                    sum += added;
                },
            );
            for i in 0..vectors {
                weighted += ways[i].cast_unsigned();
            }
        } else if X86 {
            let pairs = |x: Bytes<W, S>, at| x.saturating_dot(weights(group - at).bitcast());
            input.groups(
                group,
                #[inline(always)]
                |input| {
                    let mut x = [Bytes::<W, S>::zero(); 8];
                    let mut added = Simd::<u64, W, S>::zero();
                    for i in 0..vectors {
                        x[i] = input.vector();
                        added += x[i].sum_groups::<u64>();
                    }
                    sums_before += sum;
                    sum += added.bitcast();
                    // The weights are positive in one half and negative in the other, so 16 bits hold the sum.
                    for (i, j) in (0..vectors / 2).zip(vectors / 2..) {
                        weighted += (pairs(x[i], i * n) + pairs(x[j], j * n))
                            .sum_groups::<i32>()
                            .bitcast();
                    }
                },
            );
        } else {
            // The bytes that have the same weight are added up first.
            let mut columns = [Simd::<u16, W, S>::zero(); 8];
            input.groups(
                group,
                #[inline(always)]
                |input| {
                    let mut added = Simd::<u16, W, S>::zero();
                    for i in 0..vectors {
                        let x: Bytes<W, S> = input.vector();
                        added += x.sum_groups::<u16>();
                        let [lower, upper] = x.widen::<u16>();
                        columns[2 * i] += lower;
                        columns[2 * i + 1] += upper;
                    }
                    sums_before += sum;
                    sum += added.sum_groups::<u32>();
                },
            );
            let mut upper = Sums::<W, S>::zero();
            // As a loop, it keeps the columns in memory.
            unroll!(for i in 0..8 {
                if i < 2 * vectors {
                    let weights = (group - i * n / 2) as u16 - Simd::<u16, W, S>::iota(0);
                    [weighted, upper] = columns[i].widening_mul_add(weights, [weighted, upper]);
                }
            });
            weighted += upper;
        }
        if is_short {
            weighted += sums_before << group.ilog2();
        } else {
            b = (b + group as u64 * sums_before.reduce_sum() as u64) % MODULUS as u64;
        }
    }

    result(a, b as u32, sum, weighted, bias as u32)
}

#[simd]
fn result<W: Width>(a: u32, b: u32, sum: Sums<W, S>, weighted: Sums<W, S>, bias: u32) -> u32 {
    let (byte_sum, weighted) = if X86 {
        // Both at once. The lower half carries nothing over.
        let others = if S::HAS_DOT {
            weighted.alternate(sum).swap_pairs().bitcast()
        } else {
            weighted.bitcast::<u64>() << 32
        };
        let both = (sum.alternate(weighted).bitcast::<u64>() + others).reduce_sum();
        (both as u32, (both >> 32) as u32)
    } else {
        (sum.reduce_sum(), weighted.reduce_sum())
    };
    // What `weighted` adds up to may be negative, so this is meant to wrap.
    let high = b.wrapping_add(weighted).wrapping_add(bias * byte_sum);
    ((a + byte_sum) % MODULUS) | (high % MODULUS) << 16
}

/// So that no load crosses a page.
#[repr(align(256))]
struct Aligned<T>(T);

/// From `64 - count` on: the weights of `count` bytes, and what keeps these.
static FIRST: Aligned<[[u8; 128]; 2]> = {
    let (mut all, mut i) = ([[0; 128]; 2], 0);
    while i < 64 {
        (all[0][i], all[1][i]) = (64 - i as u8, !0);
        i += 1;
    }
    Aligned(all)
};

/// Up to a group. The conditions are those that the loads check.
#[simd]
fn in_one_group<W: Width, C: Copies>(adler: u32, input: &mut Input<C>) -> u32 {
    let (n, len) = (W::BYTES, input.len());
    let more = len.wrapping_sub(1) % n;
    let (a, zero) = (adler & 0xFFFF, Sums::<W, S>::zero());
    let b = (adler >> 16) + a * len as u32;
    if const { has!(masked) && !C::COPIES } && len < n {
        let x: Bytes<W, S> = input.few(len);
        let weighted = x.dot_add_relaxed(Simd::load(&FIRST.0[0][64 - len..]), zero);
        return result(a, b, add_bytes(zero, x), weighted, 0);
    }
    let x: Bytes<W, S> = input.start_of_vector(more + 1);
    let weighted = x.dot_add_relaxed(Simd::load(&FIRST.0[0][63 - more..]), zero);
    let sum = add_bytes(zero, x & Bytes::<W, S>::load(&FIRST.0[1][63 - more..]));
    let mut all = [zero, sum, weighted];
    while input.has(n) {
        not_unrolled();
        add_vector(input.vector(), &mut all);
    }
    result(a, b, all[1], all[2] + (all[0] << n.ilog2()), 0)
}

#[simd]
fn by_width<const IS_LONG: bool, W: Width, C: Copies>(adler: u32, input: &mut Input<C>) -> u32 {
    if IS_LONG {
        in_groups::<W, _, S>(adler, input)
    } else {
        in_one_group::<W, _, S>(adler, input)
    }
}

#[simd]
fn of_piece<const IS_LONG: bool, C: Copies>(adler: u32, input: &mut Input<C>) -> u32 {
    // The stores hold up either size, and half as many of 32 bytes cross a cache line.
    let is_narrow = const { C::COPIES && (S::HAS_DOT || !IS_LONG) };
    let wide = if is_narrow {
        Upto::<B32, S>::BYTES
    } else {
        Native::<S>::BYTES
    };
    if const { !IS_LONG && Native::<S>::BYTES > 16 && (C::COPIES || !has!(masked)) }
        && input.len() < wide
    {
        in_one_group::<B16, _, S>(adler, input)
    } else if is_narrow {
        by_width::<IS_LONG, Upto<B32, S>, _, S>(adler, input)
    } else {
        by_width::<IS_LONG, Native<S>, _, S>(adler, input)
    }
}

/// What is shorter saves no registers if this is a function of its own.
#[simd]
#[inline(never)]
fn long(adler: u32, bytes: &[u8]) -> u32 {
    assert!(bytes.len() > S::GROUP);
    of_piece::<true, _, S>(adler, &mut Input::new(bytes))
}

#[simd]
#[inline(never)]
fn copy_long(adler: u32, bytes: Source<'_>, copy: BorrowedCursor<'_, u8>) -> u32 {
    copying(
        bytes,
        copy,
        #[inline(always)]
        |input| {
            assert!(input.len() > S::GROUP);
            of_piece::<true, _, S>(adler, input)
        },
    )
}

/// For 16 bytes up to [`PIECE`]. The inflation around it takes most of the time.
#[kernel(neon82, no_downclock)]
pub(crate) fn adler32(adler: u32, bytes: &[u8]) -> u32 {
    if bytes.len() > S::GROUP {
        return long(adler, bytes);
    }
    assert!(bytes.len() >= 16);
    of_piece::<false, _, S>(adler, &mut Input::counting(bytes))
}

#[kernel]
pub(crate) fn copy_and_adler32(adler: u32, bytes: Source<'_>, copy: BorrowedCursor<'_, u8>) -> u32 {
    if bytes.len() > S::GROUP || bytes.len() > copy.capacity() {
        return copy_long(adler, bytes, copy);
    }
    assert!(bytes.len() >= 16);
    copying(
        bytes,
        copy,
        #[inline(always)]
        |input| of_piece::<false, _, S>(adler, input),
    )
}
