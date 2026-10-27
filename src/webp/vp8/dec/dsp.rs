//! `dsp/dec.c`: the inverse transforms, the intra predictions and the loop filters.

use crate::util::{Bug, Checked, SliceExt};
use crate::vp8::common::IntraMode;

/// The stride of the work buffer.
pub(super) const BPS: usize = 32;

/// The samples of one macroblock with those above and to the left of it, 4x4 blocks shown as one character:
/// ```text
///   .+------   one row
///   .|yyyyt.
///   .|yyyyt.
///   .|yyyyt.
///   .|yyyy..
///   .+--.+--   one row
///   .|uu.|vv
///   .|uu.|vv
/// ```
/// `|`, `-` and `+` are the left, top and top left samples, `t` the top right ones of the 4x4 blocks below them.
pub(super) type YuvB = [u8; YUV_SIZE];
pub(super) const YUV_SIZE: usize = BPS * 17 + BPS * 9;
pub(super) const Y_OFF: usize = BPS + 8;
pub(super) const U_OFF: usize = Y_OFF + BPS * 16 + BPS;
pub(super) const V_OFF: usize = U_OFF + 16;

#[inline(always)]
fn clip_8b(v: i32) -> u8 {
    v.clamp(0, 255) as u8
}

//------------------------------------------------------------------------------
// Transforms (paragraph 14.4)

/// Four rows of four samples in the work buffer, from the first sample to the last.
pub(super) type Block4 = [u8; 3 * BPS + 4];

// Coefficients that no encoder produces overflow these products in libwebp too.
#[inline(always)]
fn mul1(a: i32) -> i32 {
    (a.wrapping_mul(20091) >> 16) + a
}

#[inline(always)]
fn mul2(a: i32) -> i32 {
    a.wrapping_mul(35468) >> 16
}

#[inline(always)]
fn store(dst: &mut Block4, rows: [[i32; 4]; 4]) {
    for (dst, row) in dst.chunks_mut(BPS).zip(rows) {
        for (dst, v) in dst.iter_mut().zip(row) {
            *dst = clip_8b(i32::from(*dst) + (v >> 3));
        }
    }
}

#[inline(always)]
fn transform_1d(in0: i32, in1: i32, in2: i32, in3: i32) -> [i32; 4] {
    let a = in0 + in2;
    let b = in0 - in2;
    let c = mul2(in1) - mul1(in3);
    let d = mul1(in1) + mul2(in3);
    [a + d, b + c, b - c, a - d]
}

pub(super) fn transform_one(input: &[i16; 16], dst: &mut Block4) {
    let [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13, i14, i15] =
        input.map(i32::from);
    let [a0, a1, a2, a3] = transform_1d(i0, i4, i8, i12);
    let [b0, b1, b2, b3] = transform_1d(i1, i5, i9, i13);
    let [c0, c1, c2, c3] = transform_1d(i2, i6, i10, i14);
    let [d0, d1, d2, d3] = transform_1d(i3, i7, i11, i15);
    store(
        dst,
        [
            transform_1d(a0 + 4, b0, c0, d0),
            transform_1d(a1 + 4, b1, c1, d1),
            transform_1d(a2 + 4, b2, c2, d2),
            transform_1d(a3 + 4, b3, c3, d3),
        ],
    );
}

/// When only `input[0]`, `input[1]` and `input[4]` are not zero.
pub(super) fn transform_ac3(input: &[i16; 16], dst: &mut Block4) {
    let a = i32::from(input[0]) + 4;
    let c4 = mul2(i32::from(input[4]));
    let d4 = mul1(i32::from(input[4]));
    let c1 = mul2(i32::from(input[1]));
    let d1 = mul1(i32::from(input[1]));
    store(
        dst,
        [a + d4, a + c4, a - c4, a - d4].map(|dc| [dc + d1, dc + c1, dc - c1, dc - d1]),
    );
}

pub(super) fn transform_dc(input: &[i16; 16], dst: &mut Block4) {
    store(dst, [[i32::from(input[0]) + 4; 4]; 4]);
}

/// Paragraph 14.3: from the block of the DCs to the DC of each of the 16 blocks of `out`.
pub(super) fn transform_wht(input: &[i16; 16], out: &mut [[i16; 16]]) {
    let [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13, i14, i15] =
        input.map(i32::from);
    let vertical = |in0: i32, in4: i32, in8: i32, in12: i32| {
        let a0 = in0 + in12;
        let a1 = in4 + in8;
        let a2 = in4 - in8;
        let a3 = in0 - in12;
        [a0 + a1, a3 + a2, a0 - a1, a3 - a2]
    };
    let [a0, a1, a2, a3] = vertical(i0, i4, i8, i12);
    let [b0, b1, b2, b3] = vertical(i1, i5, i9, i13);
    let [c0, c1, c2, c3] = vertical(i2, i6, i10, i14);
    let [d0, d1, d2, d3] = vertical(i3, i7, i11, i15);
    let horizontal = |t0: i32, t1: i32, t2: i32, t3: i32| {
        let dc = t0 + 3;
        let a0 = dc + t3;
        let a1 = t1 + t2;
        let a2 = t1 - t2;
        let a3 = dc - t3;
        [a0 + a1, a3 + a2, a0 - a1, a3 - a2].map(|v| (v >> 3) as i16)
    };
    let dcs = [
        horizontal(a0, b0, c0, d0),
        horizontal(a1, b1, c1, d1),
        horizontal(a2, b2, c2, d2),
        horizontal(a3, b3, c3, d3),
    ];
    for (out, dc) in out.iter_mut().zip(dcs.as_flattened()) {
        out[0] = *dc;
    }
}

//------------------------------------------------------------------------------
// Intra predictions

/// Predicts the luma (`N` = 16) or one chroma plane (`N` = 8) of a macroblock, whose first sample is at `off`. Without
/// `has_top` or `has_left` the macroblock is on that edge of the image.
pub(super) fn predict_block<const N: usize>(
    mode: IntraMode,
    has_top: bool,
    has_left: bool,
    yuv_b: &mut YuvB,
    off: usize,
) -> Checked {
    let top: [u8; N] = *yuv_b.array_at(off - BPS)?;
    let top_left = i32::from(yuv_b.at(off - BPS - 1)?);
    let left = yuv_b.iter().skip(off - 1).step_by(BPS).take(N);
    let left_sum: u32 = left.map(|&v| u32::from(v)).sum();
    // Each starts with the sample to the left of the row.
    let rows = yuv_b.sub_mut(off - 1..)?.chunks_mut(BPS).take(N);
    let rows = rows.filter_map(|row| {
        let (left, row) = row.split_first_mut()?;
        Some((*left, row.first_chunk_mut::<N>()?))
    });
    match mode {
        IntraMode::Dc => {
            let shift = N.trailing_zeros();
            let top_sum: u32 = top.iter().map(|&v| u32::from(v)).sum();
            let dc = match (has_top, has_left) {
                (true, true) => (top_sum + left_sum + N as u32) >> (shift + 1),
                (true, false) => (top_sum + N as u32 / 2) >> shift,
                (false, true) => (left_sum + N as u32 / 2) >> shift,
                (false, false) => 0x80,
            };
            for (_, row) in rows {
                *row = [dc as u8; N];
            }
        }
        IntraMode::TrueMotion => {
            for (left, row) in rows {
                let delta = i32::from(left) - top_left;
                for (dst, &top) in row.iter_mut().zip(&top) {
                    *dst = clip_8b(i32::from(top) + delta);
                }
            }
        }
        IntraMode::Vertical => {
            for (_, row) in rows {
                *row = top;
            }
        }
        IntraMode::Horizontal => {
            for (left, row) in rows {
                *row = [left; N];
            }
        }
        _ => return Err(Bug),
    }
    Ok(())
}

/// A 4x4 block in the work buffer with its neighbours: it starts at the top left sample and ends at the last sample of
/// the block.
pub(super) type Luma4 = [u8; 4 * BPS + 5];

#[inline(always)]
fn avg2(a: u8, b: u8) -> u8 {
    ((u32::from(a) + u32::from(b) + 1) >> 1) as u8
}

#[inline(always)]
fn avg3(a: u8, b: u8, c: u8) -> u8 {
    ((u32::from(a) + 2 * u32::from(b) + u32::from(c) + 2) >> 2) as u8
}

pub(super) fn predict_luma4(mode: IntraMode, dst: &mut Luma4) {
    let [x, a, b, c, d, e, f, g, h] = [
        dst[0], dst[1], dst[2], dst[3], dst[4], dst[5], dst[6], dst[7], dst[8],
    ];
    let [i, j, k, l] = [dst[BPS], dst[2 * BPS], dst[3 * BPS], dst[4 * BPS]];
    let rows = match mode {
        IntraMode::Dc => {
            let sum: u32 = [a, b, c, d, i, j, k, l].iter().map(|&v| u32::from(v)).sum();
            [[((sum + 4) >> 3) as u8; 4]; 4]
        }
        IntraMode::TrueMotion => [i, j, k, l].map(|left| {
            [a, b, c, d].map(|top| clip_8b(i32::from(top) + i32::from(left) - i32::from(x)))
        }),
        IntraMode::Vertical => [[avg3(x, a, b), avg3(a, b, c), avg3(b, c, d), avg3(c, d, e)]; 4],
        IntraMode::Horizontal => [
            [avg3(x, i, j); 4],
            [avg3(i, j, k); 4],
            [avg3(j, k, l); 4],
            [avg3(k, l, l); 4],
        ],
        IntraMode::DownRight => {
            let [e0, e1, e2, e3, e4, e5, e6] = [
                avg3(j, k, l),
                avg3(i, j, k),
                avg3(x, i, j),
                avg3(a, x, i),
                avg3(b, a, x),
                avg3(c, b, a),
                avg3(d, c, b),
            ];
            [
                [e3, e4, e5, e6],
                [e2, e3, e4, e5],
                [e1, e2, e3, e4],
                [e0, e1, e2, e3],
            ]
        }
        IntraMode::DownLeft => {
            let [e0, e1, e2, e3, e4, e5, e6] = [
                avg3(a, b, c),
                avg3(b, c, d),
                avg3(c, d, e),
                avg3(d, e, f),
                avg3(e, f, g),
                avg3(f, g, h),
                avg3(g, h, h),
            ];
            [
                [e0, e1, e2, e3],
                [e1, e2, e3, e4],
                [e2, e3, e4, e5],
                [e3, e4, e5, e6],
            ]
        }
        IntraMode::VerticalRight => [
            [avg2(x, a), avg2(a, b), avg2(b, c), avg2(c, d)],
            [avg3(i, x, a), avg3(x, a, b), avg3(a, b, c), avg3(b, c, d)],
            [avg3(j, i, x), avg2(x, a), avg2(a, b), avg2(b, c)],
            [avg3(k, j, i), avg3(i, x, a), avg3(x, a, b), avg3(a, b, c)],
        ],
        IntraMode::VerticalLeft => [
            [avg2(a, b), avg2(b, c), avg2(c, d), avg2(d, e)],
            [avg3(a, b, c), avg3(b, c, d), avg3(c, d, e), avg3(d, e, f)],
            [avg2(b, c), avg2(c, d), avg2(d, e), avg3(e, f, g)],
            [avg3(b, c, d), avg3(c, d, e), avg3(d, e, f), avg3(f, g, h)],
        ],
        IntraMode::HorizontalUp => [
            [avg2(i, j), avg3(i, j, k), avg2(j, k), avg3(j, k, l)],
            [avg2(j, k), avg3(j, k, l), avg2(k, l), avg3(k, l, l)],
            [avg2(k, l), avg3(k, l, l), l, l],
            [l, l, l, l],
        ],
        IntraMode::HorizontalDown => [
            [avg2(i, x), avg3(i, x, a), avg3(x, a, b), avg3(a, b, c)],
            [avg2(j, i), avg3(j, i, x), avg2(i, x), avg3(i, x, a)],
            [avg2(k, j), avg3(k, j, i), avg2(j, i), avg3(j, i, x)],
            [avg2(l, k), avg3(l, k, j), avg2(k, j), avg3(k, j, i)],
        ],
    };
    for (dst, row) in dst.chunks_mut(BPS).skip(1).zip(rows) {
        for (dst, v) in dst.iter_mut().skip(1).zip(row) {
            *dst = v;
        }
    }
}

//------------------------------------------------------------------------------
// Edge filtering

/// `VP8ksclip1`
#[inline(always)]
fn sclip1(v: i16) -> i16 {
    v.clamp(-128, 127)
}

/// `VP8ksclip2`
#[inline(always)]
fn sclip2(v: i16) -> i16 {
    v.clamp(-16, 15)
}

/// `VP8kclip1`
#[inline(always)]
fn clip1(v: i16) -> u8 {
    v.clamp(0, 255) as u8
}

/// The samples across an edge: `p3`, `p2`, `p1`, `p0`, then `q0`, `q1`, `q2`, `q3` on the other side.
type Across = [u8; 8];

#[inline(always)]
fn do_filter2(p1: i16, p0: i16, q0: i16, q1: i16) -> [u8; 2] {
    let a = 3 * (q0 - p0) + sclip1(p1 - q1);
    let a1 = sclip2((a + 4) >> 3);
    let a2 = sclip2((a + 3) >> 3);
    [clip1(p0 + a2), clip1(q0 - a1)]
}

#[inline(always)]
fn do_filter4(p1: i16, p0: i16, q0: i16, q1: i16) -> [u8; 4] {
    let a = 3 * (q0 - p0);
    let a1 = sclip2((a + 4) >> 3);
    let a2 = sclip2((a + 3) >> 3);
    let a3 = (a1 + 1) >> 1;
    [clip1(p1 + a3), clip1(p0 + a2), clip1(q0 - a1), clip1(q1 - a3)]
}

#[inline(always)]
fn do_filter6(p2: i16, p1: i16, p0: i16, q0: i16, q1: i16, q2: i16) -> [u8; 6] {
    let a = sclip1(3 * (q0 - p0) + sclip1(p1 - q1));
    let a1 = (27 * a + 63) >> 7;
    let a2 = (18 * a + 63) >> 7;
    let a3 = (9 * a + 63) >> 7;
    [
        clip1(p2 + a3),
        clip1(p1 + a2),
        clip1(p0 + a1),
        clip1(q0 - a1),
        clip1(q1 - a2),
        clip1(q2 - a3),
    ]
}

#[inline(always)]
fn needs_filter(p1: i16, p0: i16, q0: i16, q1: i16, t: i16) -> bool {
    4 * (p0 - q0).abs() + (p1 - q1).abs() <= t
}

/// Paragraph 15.2, on `p1`, `p0`, `q0`, `q1`.
#[inline(always)]
fn simple_filter(px: [u8; 4], thresh2: i16) -> [u8; 4] {
    let [p1, p0, q0, q1] = px.map(i16::from);
    if !needs_filter(p1, p0, q0, q1, thresh2) {
        return px;
    }
    let [new_p0, new_q0] = do_filter2(p1, p0, q0, q1);
    [px[0], new_p0, new_q0, px[3]]
}

#[derive(Clone, Copy)]
pub(super) struct Thresholds {
    /// `2 * thresh + 1`
    thresh2: i16,
    ithresh: i16,
    hev_thresh: i16,
}

impl Thresholds {
    pub(super) fn new(thresh: u8, ithresh: u8, hev_thresh: u8) -> Self {
        Self {
            thresh2: 2 * i16::from(thresh) + 1,
            ithresh: i16::from(ithresh),
            hev_thresh: i16::from(hev_thresh),
        }
    }
}

/// Paragraph 15.3: `FilterLoop24` for an edge inside a macroblock, `FilterLoop26` for one between macroblocks.
#[inline(always)]
fn complex_filter<const INNER: bool>(px: Across, t: Thresholds) -> Across {
    let [p3, p2, p1, p0, q0, q1, q2, q3] = px.map(i16::from);
    let it = t.ithresh;
    let needs_filter2 = needs_filter(p1, p0, q0, q1, t.thresh2)
        & ((p3 - p2).abs() <= it)
        & ((p2 - p1).abs() <= it)
        & ((p1 - p0).abs() <= it)
        & ((q3 - q2).abs() <= it)
        & ((q2 - q1).abs() <= it)
        & ((q1 - q0).abs() <= it);
    if !needs_filter2 {
        return px;
    }
    let hev = ((p1 - p0).abs() > t.hev_thresh) | ((q1 - q0).abs() > t.hev_thresh);
    if hev {
        let [new_p0, new_q0] = do_filter2(p1, p0, q0, q1);
        [px[0], px[1], px[2], new_p0, new_q0, px[5], px[6], px[7]]
    } else if INNER {
        let [new_p1, new_p0, new_q0, new_q1] = do_filter4(p1, p0, q0, q1);
        [px[0], px[1], new_p1, new_p0, new_q0, new_q1, px[6], px[7]]
    } else {
        let [new_p2, new_p1, new_p0, new_q0, new_q1, new_q2] = do_filter6(p2, p1, p0, q0, q1, q2);
        [px[0], new_p2, new_p1, new_p0, new_q0, new_q1, new_q2, px[7]]
    }
}

/// Filters the horizontal edge above the `N` samples at `off`.
fn simple_v_filter<const N: usize>(
    p: &mut [u8],
    off: usize,
    stride: usize,
    thresh2: i16,
) -> Checked {
    let start = off.checked_sub(2 * stride).ok_or(Bug)?;
    let p1: [u8; N] = *p.array_at(start)?;
    let mut p0: [u8; N] = *p.array_at(start + stride)?;
    let mut q0: [u8; N] = *p.array_at(off)?;
    let q1: [u8; N] = *p.array_at(off + stride)?;
    for (((&p1, p0), q0), &q1) in p1.iter().zip(&mut p0).zip(&mut q0).zip(&q1) {
        [_, *p0, *q0, _] = simple_filter([p1, *p0, *q0, q1], thresh2);
    }
    *p.array_at_mut(start + stride)? = p0;
    *p.array_at_mut(off)? = q0;
    Ok(())
}

/// Filters the vertical edge to the left of the `n` samples below one another from `off` on.
fn simple_h_filter(p: &mut [u8], off: usize, stride: usize, n: usize, thresh2: i16) -> Checked {
    let start = off.checked_sub(2).ok_or(Bug)?;
    for row in p.sub_mut(start..)?.chunks_mut(stride).take(n) {
        let px = row.first_chunk_mut().ok_or(Bug)?;
        *px = simple_filter(*px, thresh2);
    }
    Ok(())
}

fn complex_v_filter<const N: usize, const INNER: bool>(
    p: &mut [u8],
    off: usize,
    stride: usize,
    t: Thresholds,
) -> Checked {
    let start = off.checked_sub(4 * stride).ok_or(Bug)?;
    let mut rows = [[0; N]; 8];
    for (row, from) in rows.iter_mut().zip(p.sub(start..)?.chunks(stride)) {
        *row = *from.first_chunk().ok_or(Bug)?;
    }
    let [p3, p2, p1, p0, q0, q1, q2, q3] = &mut rows;
    let lanes = p3.iter_mut().zip(p2).zip(p1).zip(p0);
    let lanes = lanes.zip(q0).zip(q1).zip(q2).zip(q3);
    for (((((((p3, p2), p1), p0), q0), q1), q2), q3) in lanes {
        [*p3, *p2, *p1, *p0, *q0, *q1, *q2, *q3] =
            complex_filter::<INNER>([*p3, *p2, *p1, *p0, *q0, *q1, *q2, *q3], t);
    }
    for (row, to) in rows.iter().zip(p.sub_mut(start..)?.chunks_mut(stride)) {
        *to.first_chunk_mut().ok_or(Bug)? = *row;
    }
    Ok(())
}

fn complex_h_filter<const INNER: bool>(
    p: &mut [u8],
    off: usize,
    stride: usize,
    n: usize,
    t: Thresholds,
) -> Checked {
    let start = off.checked_sub(4).ok_or(Bug)?;
    for row in p.sub_mut(start..)?.chunks_mut(stride).take(n) {
        let px = row.first_chunk_mut().ok_or(Bug)?;
        *px = complex_filter::<INNER>(*px, t);
    }
    Ok(())
}

// In all of these `off` is where the macroblock starts in the plane `p`.

pub(super) fn simple_v_filter16(p: &mut [u8], off: usize, stride: usize, thresh: u8) -> Checked {
    simple_v_filter::<16>(p, off, stride, 2 * i16::from(thresh) + 1)
}

pub(super) fn simple_h_filter16(p: &mut [u8], off: usize, stride: usize, thresh: u8) -> Checked {
    simple_h_filter(p, off, stride, 16, 2 * i16::from(thresh) + 1)
}

pub(super) fn simple_v_filter16i(p: &mut [u8], off: usize, stride: usize, thresh: u8) -> Checked {
    (1..4).try_for_each(|k| simple_v_filter16(p, off + 4 * k * stride, stride, thresh))
}

pub(super) fn simple_h_filter16i(p: &mut [u8], off: usize, stride: usize, thresh: u8) -> Checked {
    (1..4).try_for_each(|k| simple_h_filter16(p, off + 4 * k, stride, thresh))
}

pub(super) fn v_filter16(p: &mut [u8], off: usize, stride: usize, t: Thresholds) -> Checked {
    complex_v_filter::<16, false>(p, off, stride, t)
}

pub(super) fn h_filter16(p: &mut [u8], off: usize, stride: usize, t: Thresholds) -> Checked {
    complex_h_filter::<false>(p, off, stride, 16, t)
}

pub(super) fn v_filter16i(p: &mut [u8], off: usize, stride: usize, t: Thresholds) -> Checked {
    (1..4).try_for_each(|k| complex_v_filter::<16, true>(p, off + 4 * k * stride, stride, t))
}

pub(super) fn h_filter16i(p: &mut [u8], off: usize, stride: usize, t: Thresholds) -> Checked {
    (1..4).try_for_each(|k| complex_h_filter::<true>(p, off + 4 * k, stride, 16, t))
}

pub(super) fn v_filter8(p: &mut [u8], off: usize, stride: usize, t: Thresholds) -> Checked {
    complex_v_filter::<8, false>(p, off, stride, t)
}

pub(super) fn h_filter8(p: &mut [u8], off: usize, stride: usize, t: Thresholds) -> Checked {
    complex_h_filter::<false>(p, off, stride, 8, t)
}

pub(super) fn v_filter8i(p: &mut [u8], off: usize, stride: usize, t: Thresholds) -> Checked {
    complex_v_filter::<8, true>(p, off + 4 * stride, stride, t)
}

pub(super) fn h_filter8i(p: &mut [u8], off: usize, stride: usize, t: Thresholds) -> Checked {
    complex_h_filter::<true>(p, off + 4, stride, 8, t)
}
