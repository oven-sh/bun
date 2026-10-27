//! `dsp/upsampling.c`, `dsp/yuv.h`: the fancy upsampler and the conversion to RGB.

use crate::util::{Bug, Checked, SliceExt};

/// Upsamples one chroma plane for the two rows of the image that lie between the chroma rows `top` and `cur`. With the
/// samples
/// ```text
///   [a b]
///   [c d]
/// ```
/// the four in between are
/// ```text
///   ([9*a + 3*b + 3*c +   d    3*a + 9*b + 3*c +   d] + [8 8]) / 16
///   ([3*a +   b + 9*c + 3*d      a + 3*b + 3*c + 9*d]   [8 8]) / 16
/// ```
/// rounded in two steps. `out_top` and `out_bottom` are twice as long as `top` and `cur`.
pub(super) fn upsample_chroma_pair(
    top: &[u8],
    cur: &[u8],
    out_top: &mut [u8],
    out_bottom: &mut [u8],
) -> Checked {
    let edge = |near: u8, far: u8| ((3 * u32::from(near) + u32::from(far) + 2) >> 2) as u8;
    let ([top_first, top_mid @ .., top_last], [bottom_first, bottom_mid @ .., bottom_last]) =
        (out_top, out_bottom)
    else {
        return Err(Bug);
    };
    let (t, c) = (top.at(0)?, cur.at(0)?);
    *top_first = edge(t, c);
    *bottom_first = edge(c, t);
    let (t, c) = (top.at(top.len() - 1)?, cur.at(cur.len() - 1)?);
    *top_last = edge(t, c);
    *bottom_last = edge(c, t);

    let top_pairs = top.iter().zip(top.sub(1..)?);
    let cur_pairs = cur.iter().zip(cur.sub(1..)?);
    let out_pairs = top_mid.as_chunks_mut::<2>().0.iter_mut();
    let out_pairs = out_pairs.zip(bottom_mid.as_chunks_mut::<2>().0);
    for (((&tl, &t), (&l, &uv)), (out_top, out_bottom)) in top_pairs.zip(cur_pairs).zip(out_pairs) {
        let [tl, t, l, uv] = [tl, t, l, uv].map(u16::from);
        let avg = tl + t + l + uv + 8;
        let diag_12 = (avg + 2 * (t + l)) >> 3;
        let diag_03 = (avg + 2 * (tl + uv)) >> 3;
        *out_top = [((diag_12 + tl) >> 1) as u8, ((diag_03 + t) >> 1) as u8];
        *out_bottom = [((diag_03 + l) >> 1) as u8, ((diag_12 + uv) >> 1) as u8];
    }
    Ok(())
}

/// `(v * coeff) >> 8`
#[inline(always)]
fn mult_hi(v: u8, coeff: i32) -> i32 {
    (i32::from(v) * coeff) >> 8
}

/// From 14 bits, 6 of which are the fraction.
#[inline(always)]
fn clip8(v: i32) -> u8 {
    (v >> 6).clamp(0, 255) as u8
}

#[inline(always)]
fn yuv_to_rgba(y: u8, u: u8, v: u8) -> [u8; 4] {
    let y = mult_hi(y, 19077);
    [
        clip8(y + mult_hi(v, 26149) - 14234),
        clip8(y - mult_hi(u, 6419) - mult_hi(v, 13320) + 8708),
        clip8(y + mult_hi(u, 33050) - 17685),
        0xff,
    ]
}

/// As many pixels as `y` has samples.
pub(super) fn yuv_to_rgba_row(y: &[u8], u: &[u8], v: &[u8], dst: &mut [u8]) {
    let pixels = dst.as_chunks_mut::<4>().0.iter_mut();
    for (((dst, &y), &u), &v) in pixels.zip(y).zip(u).zip(v) {
        *dst = yuv_to_rgba(y, u, v);
    }
}
