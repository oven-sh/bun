//! The lossy decoder, but for the loop filter.

use super::common::*;
use bun_simd::prelude::*;

targets!(Upto<B32>);

/// Each four lanes are a row of a block.
#[simd]
fn transpose4x4<W: Width>([v0, v1, v2, v3]: [Simd<i16, W, S>; 4]) -> [Simd<i16, W, S>; 4] {
    let ([a0, a2], [a1, a3]) = (v0.in_blocks().interleave(v1), v2.in_blocks().interleave(v3));
    let (b0, b1) = (
        lower_as::<u32, _, _, S>(a0, a1),
        lower_as::<u32, _, _, S>(a2, a3),
    );
    let (b2, b3) = (
        upper_as::<u32, _, _, S>(a0, a1),
        upper_as::<u32, _, _, S>(a2, a3),
    );
    [
        lower_as::<u64, _, _, S>(b0, b1),
        upper_as::<u64, _, _, S>(b0, b1),
        lower_as::<u64, _, _, S>(b2, b3),
        upper_as::<u64, _, _, S>(b2, b3),
    ]
}

/// Turns the coefficients of a macroblock's 24 blocks into what is added to their prediction. Four blocks are side by
/// side, in four rows of 16. If none of them has its bit in `non_zero` set, they are left alone. Otherwise those that
/// do not have it have only zeros. All sums wrap at 16 bits, as in libwebp's `Transform_SSE2()`.
#[kernel]
pub(crate) fn inverse_dct(coefficients: &mut [[i16; 64]; 6], mut non_zero: u32) {
    for group in coefficients {
        if non_zero == 0 {
            break;
        }
        for x in (0..16).step_by(i16xN::LANES) {
            let is_zero = non_zero & ((1 << (i16xN::LANES / 4)) - 1) == 0;
            non_zero >>= i16xN::LANES / 4;
            if is_zero {
                continue;
            }
            let rows = [
                i16xN::load(&group[x..]),
                i16xN::load(&group[x + 16..]),
                i16xN::load(&group[x + 32..]),
                i16xN::load(&group[x + 48..]),
            ];
            let mut v = transpose4x4(inverse_dct_pass(rows));
            v[0] += 4;
            let v = transpose4x4(inverse_dct_pass(v));
            for (row, v) in v.into_iter().enumerate() {
                (v >> 3).store(&mut group[x + 16 * row..]);
            }
        }
    }
}

// RFC 6386 section 12.3. The edge of a subblock goes up along its left side, around the corner, and along the top to
// four samples beyond its end: L K J I X A B C D E F G H. In a vector the first and the last are there twice.

/// An index that gets zero.
const K: u8 = 0x80;
const TRUE_MOTION: u8 = 1;

/// By mode, where each sample is found: lane n of the averages of three neighbors on the edge, in whose lane 15 is the
/// average of L K J I A B C D, or with 16 added, lane n of the averages of two.
static SUBBLOCK_SOURCES: Aligned<[[u8; 16]; 10]> = Aligned([
    [15; 16],
    [0; 16],
    [5, 6, 7, 8, 5, 6, 7, 8, 5, 6, 7, 8, 5, 6, 7, 8],
    [3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0],
    [4, 5, 6, 7, 3, 4, 5, 6, 2, 3, 4, 5, 1, 2, 3, 4],
    [21, 22, 23, 24, 4, 5, 6, 7, 3, 21, 22, 23, 2, 4, 5, 6],
    [6, 7, 8, 9, 7, 8, 9, 10, 8, 9, 10, 11, 9, 10, 11, 12],
    [22, 23, 24, 25, 6, 7, 8, 9, 23, 24, 25, 10, 7, 8, 9, 11],
    [20, 4, 5, 6, 19, 3, 20, 4, 18, 2, 19, 3, 17, 1, 18, 2],
    [19, 2, 18, 1, 18, 1, 17, 0, 17, 0, 16, 16, 16, 16, 16, 16],
]);

#[simd]
type V16 = u8x16<S>;

#[simd]
fn pick(from: V16<S>, lanes: [u8; 16]) -> V16<S> {
    from.in_blocks().lookup_bytes(lanes)
}

/// The modes are too hard to guess for a branch. Returns four rows of four.
#[simd]
fn reconstruct_subblock(edge: V16<S>, mode: u8, residuals: &[i16]) -> V16<S> {
    let (next, after_next) = (
        edge.shift_elements_left::<1>(0),
        edge.shift_elements_left::<2>(0),
    );
    let outer = edge.midpoint(after_next);
    let sum = pick(edge, [K, K, K, K, K, K, K, K, 1, 2, 3, 4, 6, 7, 8, 9]).sum_groups::<u64>();
    // Its three lowest bits end up in lane 14. Lane 15 of the others is zero, or becomes it.
    let dc = ((sum + [0, 4]) << 53).bitcast::<u8>();
    let (of_three, of_two) = (outer.midpoint_up(next) | dc, edge.midpoint_up(next));
    let directional = of_three
        .concat_swizzle_dyn_relaxed(of_two, u8x16::from(SUBBLOCK_SOURCES[mode.min(9) as usize]));

    let above = pick(edge, [6, 7, 8, 9, 6, 7, 8, 9, 6, 7, 8, 9, 6, 7, 8, 9]);
    let left = pick(edge, [4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]);
    let corner = edge.splat_lane::<5>();
    let true_motion = above
        .saturating_add(left.saturating_sub(corner))
        .saturating_sub(corner.saturating_sub(left));
    let predicted = u8x16::splat(mode)
        .simd_eq(TRUE_MOTION)
        .select(true_motion, directional);

    let upper = i16x4::load(residuals).concat(i16x4::load(&residuals[16..]));
    let lower = i16x4::load(&residuals[32..]).concat(i16x4::load(&residuals[48..]));
    let [predicted_upper, predicted_lower] = predicted.widen::<i16>();
    (upper + predicted_upper).saturating_narrow(lower + predicted_lower)
}

/// Predicts each 4 by 4 samples of a macroblock's luma from those before them, and adds what `inverse_dct()` left.
/// `left` has the sample in the corner, the 16 below it, and 3 that do not count. `modes` are numbered as in libwebp.
#[allow(clippy::trivially_copy_pass_by_ref, reason = "loaded from where it is")]
#[kernel]
pub(crate) fn reconstruct_subblocks(
    above: &[u8; 16],
    above_right: &[u8; 4],
    left: &[u8; 20],
    modes: &[[u8; 4]; 4],
    residuals: &[[i16; 64]; 4],
    samples: &mut [[u8; 16]; 16],
) {
    const LAST_COLUMN: [u8; 16] = [15, 15, 11, 7, 3, K, K, K, K, K, K, K, K, K, K, K];
    let above_right = u8x4::from(above_right).resize::<B16>();
    // All rows of subblocks have this at their right end.
    let beyond = pick(
        above_right,
        [K, K, K, K, K, K, K, K, K, K, 0, 1, 2, 3, 3, K],
    );
    let mut top = u8x16::from(above);
    for (y, rows) in samples.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        let (modes, residuals) = (&modes[y], &residuals[y]);
        let left = u8x8::load(&left[4 * y..]).resize::<B16>();
        let first_column = pick(left, [4, 4, 3, 2, 1, 0, K, K, K, K, K, K, K, K, K, K]);
        let edge = first_column | pick(top, [K, K, K, K, K, K, 0, 1, 2, 3, 4, 5, 6, 7, 7, K]);
        let b0 = reconstruct_subblock(edge, modes[0], residuals);
        let edge =
            pick(b0, LAST_COLUMN) | pick(top, [K, K, K, K, K, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, K]);
        let b1 = reconstruct_subblock(edge, modes[1], &residuals[4..]);
        let edge = pick(b1, LAST_COLUMN)
            | pick(top, [K, K, K, K, K, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, K]);
        let b2 = reconstruct_subblock(edge, modes[2], &residuals[8..]);
        let edge = pick(b2, LAST_COLUMN)
            | (pick(top, [K, K, K, K, K, 11, 12, 13, 14, 15, K, K, K, K, K, K]) | beyond);
        let b3 = reconstruct_subblock(edge, modes[3], &residuals[12..]);
        let (upper01, upper23) = (
            lower_as::<u32, _, _, S>(b0, b1),
            lower_as::<u32, _, _, S>(b2, b3),
        );
        let (lower01, lower23) = (
            upper_as::<u32, _, _, S>(b0, b1),
            upper_as::<u32, _, _, S>(b2, b3),
        );
        top = upper_as::<u64, _, _, S>(lower01, lower23);
        lower_as::<u64, _, _, S>(upper01, upper23).store(&mut rows[0]);
        upper_as::<u64, _, _, S>(upper01, upper23).store(&mut rows[1]);
        lower_as::<u64, _, _, S>(lower01, lower23).store(&mut rows[2]);
        top.store(&mut rows[3]);
    }
}

/// The most samples that `upsample()` and `append_rgba()` take at once.
pub(crate) const ROW_STEP: usize = 32;

/// A loop over an index into these is still fast with the checks of hardened builds, unlike `zip()`.
#[simd]
fn steps(bytes: &[u8]) -> &[[u8; u8xN::<S>::LANES]] {
    bytes.as_chunks().0
}

/// From two rows of chroma to the two rows of pixels between them: two samples for each of the first `count` pairs of
/// neighbors. All slices are long enough for a multiple of `ROW_STEP` pairs.
///
/// Between four samples are four pixels. Each gets 9/16 of the nearest, 3/16 of the next one across and of the next one
/// down or up, and 1/16 of the fourth. All of it is done with averages of two bytes.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/upsampling_sse2.c#L32
#[inline(always)]
pub(crate) fn upsample(
    [upper, lower]: [&[u8]; 2],
    [to_upper, to_lower]: [&mut [u8]; 2],
    count: usize,
) {
    upsample_rows(upper, lower, count, to_upper, to_lower);
}

/// Arrays would go through memory.
#[kernel]
pub(crate) fn upsample_rows(
    upper: &[u8],
    lower: &[u8],
    count: usize,
    to_upper: &mut [u8],
    to_lower: &mut [u8],
) {
    #[simd]
    const N: usize = u8xN::LANES;
    let len = count.wrapping_add(S::N - 1) / S::N * S::N;
    assert!(len >= count);
    let (upper, lower) = (&upper[..=len], &lower[..=len]);
    let (a, b) = (steps(&upper[..len]), steps(&upper[1..]));
    let (c, d) = (steps(&lower[..len]), steps(&lower[1..]));
    let to_upper = &mut to_upper.as_chunks_mut::<{ 2 * S::N }>().0[..a.len()];
    let to_lower = &mut to_lower.as_chunks_mut::<{ 2 * S::N }>().0[..a.len()];
    for i in 0..a.len() {
        let (a, b, c, d) = (
            u8xN::load(&a[i]),
            u8xN::load(&b[i]),
            u8xN::load(&c[i]),
            u8xN::load(&d[i]),
        );
        let (s, t) = (a.midpoint_up(d), b.midpoint_up(c));
        let (st, ad, bc) = (s ^ t, a ^ d, b ^ c);
        // (a + b + c + d) / 4
        let k = s.midpoint_up(t) - ((ad | bc | st) & 1);
        // (a + 3b + 3c + d) / 8 and (3a + b + c + 3d) / 8
        let rising = k.midpoint_up(t) - ((k ^ t | bc & st) & 1);
        let falling = k.midpoint_up(s) - ((k ^ s | ad & st) & 1);
        Simd::store_interleaved(
            [a.midpoint_up(rising), b.midpoint_up(falling)],
            &mut to_upper[i],
        );
        Simd::store_interleaved(
            [c.midpoint_up(falling), d.midpoint_up(rising)],
            &mut to_lower[i],
        );
    }
}

/// All three come minus 128, times 256, and `u` plus 1. The results are yet to be clamped.
///
/// libwebp rounds each `sample * factor / 256` down. The multiplication that is one instruction everywhere rounds to
/// nearest. Taking something off the sample first makes up for that, and puts the result off by a whole number.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/yuv.h#L62
#[simd]
fn to_rgb([y, u, v]: [i16xN<S>; 3]) -> [i16xN<S>; 3] {
    const RED: i16 = 9538 + 13074 - 14234;
    const GREEN: i16 = 9538 - 3209 - 7492 + 8708;
    const BLUE: i16 = 9538 + 16524 - 17685;
    let half_v = v >> 1;
    let luma = (y >> 1).mul_q15(19077) + RED;
    let from_green = (u >> 1).mul_q15(6419) + (half_v - (16 * 128)).mul_q15(13320);
    [
        (luma + half_v.mul_q15(26149)) >> 6,
        (luma - (from_green + (RED - GREEN))) >> 6,
        luma.saturating_add(u.mul_q15(16525) + (BLUE - RED)) >> 6,
    ]
}

#[simd]
fn convert([y, u, v, alpha]: [u8xN<S>; 4], to: &mut [[u8; 4]]) {
    let high = |v: u8xN<S>, low: u8xN<S>| {
        array::map(low.in_blocks().interleave(v ^ 128), |it| it.bitcast())
    };
    // Hidden, or LLVM adds a shuffle.
    let (zero, one) = (u8xN::zero(), u8xN::splat(1).black_box());
    let ([y0, y1], [u0, u1], [v0, v1]) = (high(y, zero), high(u, one), high(v, zero));
    let ([r0, g0, b0], [r1, g1, b1]) = (to_rgb([y0, u0, v0]), to_rgb([y1, u1, v1]));
    // Like the interleaving, this is within each 16 bytes.
    let pack = |lower: i16xN<S>, upper| lower.in_blocks().saturating_narrow(upper);
    Simd::store_interleaved(
        [pack(r0, r1), pack(g0, g1), pack(b0, b1), alpha],
        to.as_flattened_mut(),
    );
}

/// Appends `width` pixels to `rgba`. It has room for a multiple of `ROW_STEP`, and the inputs are as long.
#[inline(always)]
pub(crate) fn append_rgba([y, u, v, alpha]: [&[u8]; 4], rgba: &mut Vec<[u8; 4]>, width: usize) {
    append_row(y, u, v, alpha, rgba, width);
}

#[kernel]
pub(crate) fn append_row(
    y: &[u8],
    u: &[u8],
    v: &[u8],
    alpha: &[u8],
    rgba: &mut Vec<[u8; 4]>,
    width: usize,
) {
    #[simd]
    const N: usize = u8xN::LANES;
    let len = width.next_multiple_of(S::N);
    // To grow would abort if it is refused.
    assert!(len <= rgba.capacity() - rgba.len());
    let (y, u, v, alpha) = (
        steps(&y[..len]),
        steps(&u[..len]),
        steps(&v[..len]),
        steps(&alpha[..len]),
    );
    let out = &mut Output::append(rgba, len);
    for i in 0..y.len() {
        let yuva = [
            u8xN::load(&y[i]),
            u8xN::load(&u[i]),
            u8xN::load(&v[i]),
            u8xN::load(&alpha[i]),
        ];
        convert(yuva, out.push_array([[0; 4]; S::N]));
    }
    out.truncate(width);
}

/// The same in the place of pixels that are there.
#[inline(always)]
pub(crate) fn replace_rgba([y, u, v, alpha]: [&[u8]; 4], rgba: &mut [[u8; 4]]) {
    replace_row(y, u, v, alpha, rgba);
}

#[kernel]
pub(crate) fn replace_row(y: &[u8], u: &[u8], v: &[u8], alpha: &[u8], rgba: &mut [[u8; 4]]) {
    #[simd]
    const N: usize = u8xN::LANES;
    let mut short = [[0; 4]; S::N];
    let to = if rgba.len() >= S::N {
        &mut *rgba
    } else {
        &mut short
    };
    let len = to.len();
    let (y, u, v, alpha) = (&y[..len], &u[..len], &v[..len], &alpha[..len]);
    for x in (0..len).step_by(S::N) {
        // The last step overlaps the one before.
        let x = x.min(len - S::N);
        let yuva = [
            u8xN::load_at(y, x),
            u8xN::load_at(u, x),
            u8xN::load_at(v, x),
            u8xN::load_at(alpha, x),
        ];
        convert(yuva, &mut to[x..][..S::N]);
    }
    if let Some(short) = short.get(..rgba.len())
        && rgba.len() < S::N
    {
        rgba.copy_from_slice(short);
    }
}
