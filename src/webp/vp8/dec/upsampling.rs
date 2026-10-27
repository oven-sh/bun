//! `dsp/upsampling.c`, `dsp/yuv.h`. Pixels `2x + 1` (odd) and `2x + 2` (even) stay apart to the end: no shuffles.

use crate::util::{Bug, Checked, SliceExt, try_vec};
use bun_alloc::AllocError;

/// A sample times 256, kept in memory so that the multiplications compile to the high half of a 16-bit product.
type Wide = u16;

#[inline(always)]
fn wide(v: u8) -> Wide {
    Wide::from(v) << 8
}

/// The upsampled samples of one chroma plane for one row of the image.
struct Plane {
    first: Wide,
    odd: Vec<Wide>,
    even: Vec<Wide>,
    /// Of an even width.
    last: Wide,
}

impl Plane {
    fn new(pairs: usize) -> Result<Self, AllocError> {
        Ok(Self {
            first: 0,
            odd: try_vec(0, pairs)?,
            even: try_vec(0, pairs)?,
            last: 0,
        })
    }
}

/// Upsamples a chroma plane for the two rows of the image that lie between the chroma rows `top` and `cur`. With the
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
/// rounded in two steps.
fn upsample(top: &[u8], cur: &[u8], out_top: &mut Plane, out_bottom: &mut Plane) -> Checked {
    let edge = |near: u8, far: u8| wide(((3 * u16::from(near) + u16::from(far) + 2) >> 2) as u8);
    let (&t, &c) = (top.first().ok_or(Bug)?, cur.first().ok_or(Bug)?);
    out_top.first = edge(t, c);
    out_bottom.first = edge(c, t);
    let (&t, &c) = (top.last().ok_or(Bug)?, cur.last().ok_or(Bug)?);
    out_top.last = edge(t, c);
    out_bottom.last = edge(c, t);

    let samples = top.iter().zip(top.sub(1..)?).zip(cur).zip(cur.sub(1..)?);
    let out_top = out_top.odd.iter_mut().zip(&mut out_top.even);
    let out_bottom = out_bottom.odd.iter_mut().zip(&mut out_bottom.even);
    for ((((&tl, &t), &l), &uv), ((top_odd, top_even), (bottom_odd, bottom_even))) in
        samples.zip(out_top.zip(out_bottom))
    {
        let [tl, t, l, uv] = [tl, t, l, uv].map(u16::from);
        let avg = tl + t + l + uv + 8;
        let diag_12 = (avg + 2 * (t + l)) >> 3;
        let diag_03 = (avg + 2 * (tl + uv)) >> 3;
        *top_odd = ((diag_12 + tl) >> 1) << 8;
        *top_even = ((diag_03 + t) >> 1) << 8;
        *bottom_odd = ((diag_03 + l) >> 1) << 8;
        *bottom_even = ((diag_12 + uv) >> 1) << 8;
    }
    Ok(())
}

/// `MultHi`: `(v * coeff) >> 8` for the sample `v`.
#[inline(always)]
fn mult_hi(v: Wide, coeff: u16) -> u16 {
    ((u32::from(v) * u32::from(coeff)) >> 16) as u16
}

/// `VP8YuvToRgb`. All in 16 bits, 6 of which are the fraction.
#[inline(always)]
fn yuv_to_rgb(y: Wide, u: Wide, v: Wide) -> [u8; 3] {
    let y = mult_hi(y, 19077);
    // -14234 to 30814, although the sum before the subtraction is over `i16::MAX`.
    let r = (y + mult_hi(v, 26149)).wrapping_sub(14234) as i16;
    // -10952 to 27710
    let g = (y + 8708).wrapping_sub(mult_hi(u, 6419) + mult_hi(v, 13320)) as i16;
    // -17685 to 34237
    let b = (y + mult_hi(u, 33050)).saturating_sub(17685);
    [
        (r >> 6).clamp(0, 255) as u8,
        (g >> 6).clamp(0, 255) as u8,
        (b >> 6).min(255) as u8,
    ]
}

/// The working memory of the conversion of two rows.
pub(super) struct Upsampler {
    /// U and V of the upper row, then of the lower.
    chroma: [[Plane; 2]; 2],
    /// One row.
    r: Vec<u8>,
    g: Vec<u8>,
    b: Vec<u8>,
}

impl Upsampler {
    pub(super) fn new(width: usize) -> Result<Self, AllocError> {
        let plane = || Plane::new(width.saturating_sub(1) / 2);
        Ok(Self {
            chroma: [[plane()?, plane()?], [plane()?, plane()?]],
            r: try_vec(0, width)?,
            g: try_vec(0, width)?,
            b: try_vec(0, width)?,
        })
    }

    /// The first half of `UpsampleRgbaLinePair`: `top` and `cur` are U and V of two chroma rows.
    pub(super) fn upsample(&mut self, top: [&[u8]; 2], cur: [&[u8]; 2]) -> Checked {
        let [[top_u, top_v], [bottom_u, bottom_v]] = &mut self.chroma;
        upsample(top[0], cur[0], top_u, bottom_u)?;
        upsample(top[1], cur[1], top_v, bottom_v)
    }

    /// The second half, for the upper or `lower` row between the chroma rows. `y`, `alpha`, `dst` are one row.
    pub(super) fn convert(
        &mut self,
        lower: bool,
        y: &[u8],
        alpha: &[u8],
        dst: &mut [u8],
    ) -> Checked {
        let [u, v] = self.chroma.at_ref(usize::from(lower))?;
        let (r, g, b) = (&mut *self.r, &mut *self.g, &mut *self.b);
        let (
            [first_y, y @ ..],
            [first_r, r_rest @ ..],
            [first_g, g_rest @ ..],
            [first_b, b_rest @ ..],
        ) = (y, &mut *r, &mut *g, &mut *b)
        else {
            return Err(Bug);
        };
        [*first_r, *first_g, *first_b] = yuv_to_rgb(wide(*first_y), u.first, v.first);

        let (y, last_y) = y.as_chunks::<2>();
        let (r_pairs, last_r) = r_rest.as_chunks_mut::<2>();
        let (g_pairs, last_g) = g_rest.as_chunks_mut::<2>();
        let (b_pairs, last_b) = b_rest.as_chunks_mut::<2>();
        let chroma = u.odd.iter().zip(&u.even).zip(&v.odd).zip(&v.even);
        let rgb = r_pairs.iter_mut().zip(g_pairs).zip(b_pairs);
        for ((((r, g), b), &y), (((&u_odd, &u_even), &v_odd), &v_even)) in rgb.zip(y).zip(chroma) {
            let y = u16::from_le_bytes(y);
            let [r_odd, g_odd, b_odd] = yuv_to_rgb(y << 8, u_odd, v_odd);
            let [r_even, g_even, b_even] = yuv_to_rgb(y & 0xff00, u_even, v_even);
            *r = [r_odd, r_even];
            *g = [g_odd, g_even];
            *b = [b_odd, b_even];
        }
        if let ([y], [r], [g], [b]) = (last_y, last_r, last_g, last_b) {
            [*r, *g, *b] = yuv_to_rgb(wide(*y), u.last, v.last);
        }

        let pixels = dst.as_chunks_mut::<4>().0.iter_mut();
        for ((((dst, &r), &g), &b), &a) in pixels.zip(&*r).zip(&*g).zip(&*b).zip(alpha) {
            *dst = [r, g, b, a];
        }
        Ok(())
    }
}
