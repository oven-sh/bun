//! What the decoder and the encoder share.

use bun_simd::prelude::*;

#[simd]
#[inline(always)]
pub(crate) fn lower_as<U: Lane, T: Lane, W: Width>(
    a: Simd<T, W, S>,
    b: Simd<T, W, S>,
) -> Simd<T, W, S> {
    a.bitcast::<U>().in_blocks().interleave(b.bitcast())[0].bitcast()
}

#[simd]
#[inline(always)]
pub(crate) fn upper_as<U: Lane, T: Lane, W: Width>(
    a: Simd<T, W, S>,
    b: Simd<T, W, S>,
) -> Simd<T, W, S> {
    a.bitcast::<U>().in_blocks().interleave(b.bitcast())[1].bitcast()
}

/// RFC 6386 section 14.4. The factors are 65536 + 20091 and 2 * 17734 out of 65536.
#[simd]
pub(crate) fn inverse_dct_pass<W: Width>(v: [Simd<i16, W, S>; 4]) -> [Simd<i16, W, S>; 4] {
    let (a, b) = (v[0] + v[2], v[0] - v[2]);
    let times_cos = |v: Simd<i16, W, S>| v + v.mul_high(20091);
    let times_sin = |v: Simd<i16, W, S>| v.mul_high_doubled(17734);
    let (c, d) = (
        times_sin(v[1]) - times_cos(v[3]),
        times_cos(v[1]) + times_sin(v[3]),
    );
    [a + d, b + c, b - c, a - d]
}
