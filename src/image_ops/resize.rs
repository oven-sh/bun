//! Resizing in two passes, across and then down.
//!
//! The filters, and the centers at `(i + 0.5) * shrink - 0.5`, are those of libvips' `templates.h` and `reduceh.cpp`, and
//! the weights are 16-bit numbers as in its path for bytes. At the edges, libvips repeats pixels. Here the weights that are
//! left are normalized again, as in stb_image_resize.

use super::{Image, Pixel, Result, area, fill_up, filled, with_room};
use bun_simd::prelude::*;
use core::f64::consts::FRAC_PI_3;

/// The weights of a span add up to `1 << SHIFT`.
const SHIFT: u32 = 14;
const MAX_TAPS: usize = 256;
/// For the last vector of a row.
const SLACK: usize = 64;

/// An output is the sum of `len` inputs from `start` on, times their weights.
#[derive(Clone, Copy)]
struct Span {
    start: u32,
    len: u32,
}

struct Axis {
    spans: Vec<Span>,
    /// `stride` for each span, a multiple of four. Those past its end are zero.
    weights: Vec<i16>,
    stride: usize,
}

impl Axis {
    /// The multiple of four that covers all spans, if they start at a multiple of `step`.
    #[inline(always)]
    fn longest(&self, step: usize) -> usize {
        let ends = (self.spans.iter()).map(|span| span.start % step as u32 + span.len);
        ends.max().unwrap_or(0).next_multiple_of(4) as usize
    }

    /// Gives all spans one length, a multiple of four, and returns it. They end within `src_len`, if that is not less.
    fn pad(&mut self, src_len: usize) -> usize {
        let len = self
            .spans
            .iter()
            .map(|span| span.len)
            .max()
            .unwrap_or(0)
            .next_multiple_of(4);
        let last = (src_len as u32).saturating_sub(len);
        for (span, weights) in self
            .spans
            .iter_mut()
            .zip(self.weights.chunks_exact_mut(self.stride))
        {
            if span.start > last {
                weights[..len as usize].rotate_right((span.start - last) as usize);
            }
            *span = Span {
                start: span.start.min(last),
                len,
            };
        }
        len as usize
    }

    /// Has all spans start at a multiple of `STEP`.
    fn align(&mut self) {
        for (span, weights) in
            (self.spans.iter_mut()).zip(self.weights.chunks_exact_mut(self.stride))
        {
            let early = span.start % STEP as u32;
            weights.rotate_right(early as usize);
            span.start -= early;
            span.len += early;
        }
    }
}

#[simd]
fn round<W: Width>(sum: Simd<i32, W, S>) -> Simd<i32, W, S> {
    sum.rounding_shr_relaxed(SHIFT)
}

/// How many rows `across` takes at a time. They share the weights.
const BAND: usize = 4;

/// Each channel of a pixel next to that of the next pixel, in 16 bits.
const PAIRS: [u8; 16] = [
    0, 128, 4, 128, 1, 128, 5, 128, 2, 128, 6, 128, 3, 128, 7, 128,
];

#[simd]
fn weigh_four(pixels: u8x16<S>, [a, b, c, d]: [i16; 4], sum: i32x4<S>) -> i32x4<S> {
    let [lower, upper] = pixels.widen::<i16>();
    let ([p, q], [r, s]) = (lower.split(), upper.split());
    sum + p.cast_mul(a) + q.cast_mul(b) + r.cast_mul(c) + s.cast_mul(d)
}

/// Adds four pixels of each of two rows, times their weights, to the sums for the two.
#[simd]
fn weigh_pixels(pixels: [&[u8; 16]; 2], [a, b, c, d]: [i16; 4], sums: i32x8<S>) -> i32x8<S> {
    let [first, second] = [u8x16::from(pixels[0]), u8x16::from(pixels[1])];
    if cfg!(target_arch = "aarch64") {
        let [lower, upper] = sums.split();
        return weigh_four(first, [a, b, c, d], lower).concat(weigh_four(
            second,
            [a, b, c, d],
            upper,
        ));
    }
    let (both, pairs) = (first.concat(second).in_blocks(), u8x32::repeat(&PAIRS));
    let lower = both.lookup_bytes(pairs).bitcast::<i16>();
    let upper = both.lookup_bytes(pairs | 8).bitcast::<i16>();
    sums + lower.dot(i16x16::repeat(&[a, b])) + upper.dot(i16x16::repeat(&[c, d]))
}

/// Appends a band. `weigh` returns the sums for its rows, given the start of a span and `taps` weights.
#[simd]
fn push_band(
    axis: &Axis,
    taps: usize,
    out: &mut Vec<Pixel>,
    mut weigh: impl FnMut(usize, &[[i16; 4]]) -> [i32x8<S>; 2],
) {
    let (end, count) = (out.len(), axis.spans.len());
    fill_up(out, end + BAND * count, [0; 4]);
    let (upper, lower) = out[end..].split_at_mut(2 * count);
    let ((to0, to1), (to2, to3)) = (upper.split_at_mut(count), lower.split_at_mut(count));
    // Without the division of `chunks_exact`, which thin images would notice.
    let mut rest = &axis.weights[..];
    for ((((span, to0), to1), to2), to3) in axis.spans.iter().zip(to0).zip(to1).zip(to2).zip(to3) {
        let weights;
        (weights, rest) = rest.split_at(axis.stride);
        let [upper, lower] = weigh(span.start as usize, weights[..taps].as_chunks().0);
        let sums = round(upper)
            .in_blocks()
            .saturating_narrow::<i16>(round(lower))
            .saturating_cast::<u8>()
            .to_array();
        let sums = sums.as_chunks().0;
        [*to0, *to1, *to2, *to3] = [sums[0], sums[2], sums[1], sums[3]];
    }
}

impl<'a> Image<'a> {
    /// `len` pixels from the start of each row on. The last row is repeated.
    #[inline(always)]
    fn band(self, top: usize, len: usize) -> [&'a [Pixel]; BAND] {
        let row = |y: usize| &self.pixels[(top + y).min(self.height - 1) * self.width..][..len];
        [row(0), row(1), row(2), row(3)]
    }
}

#[simd]
fn weigh_columns(image: Image<'_>, height: usize, axis: &Axis, taps: usize, out: &mut Vec<Pixel>) {
    for top in (0..height).step_by(BAND) {
        let rows = image.band(top, image.width.max(taps));
        push_band(axis, taps, out, |start, weights| {
            let from = array::map(rows, |row| {
                row[start..][..taps].as_flattened().as_chunks().0
            });
            let [mut upper, mut lower] = [i32x8::zero(); 2];
            for (i, &weights) in weights.iter().enumerate() {
                upper = weigh_pixels([&from[0][i], &from[1][i]], weights, upper);
                lower = weigh_pixels([&from[2][i], &from[3][i]], weights, lower);
            }
            [upper, lower]
        });
    }
}

/// All spans have the length `taps`. Appends the bands with the first `height` rows to `out`, which has the room.
/// Behind rows that are shorter, the weights are zero, and `image` has a band more.
#[kernel(Upto<B32>)]
fn across(image: Image<'_>, height: usize, axis: &Axis, taps: usize, out: &mut Vec<Pixel>) {
    match taps {
        4 => weigh_columns(image, height, axis, 4, out),
        _ => weigh_columns(image, height, axis, taps, out),
    }
}

/// How many products an instruction adds up.
const STEP: usize = if cfg!(target_arch = "aarch64") { 4 } else { 2 };
/// So many pixels of each row of a band, channel by channel: in 16 bits, or less 128 in 8.
#[derive(Clone, Copy)]
#[repr(align(64))]
struct Step([u8; 64]);

/// How far spans start into the steps, which stay in the cache.
const AHEAD: usize = 256;

/// What is behind the rows stays. Its weights are zero.
#[simd]
#[inline(never)]
fn put_in_order(rows: [&[u8]; BAND], steps: &mut [Step]) {
    let put = |four: u8x64<S>, to: &mut [Step; 4 / STEP]| {
        if STEP == 4 {
            let order = u8x64::from_fn(|i| (i % 4 * 4 + i / 4 % 4) as u8);
            to[0].0 = (four ^ 128).in_blocks().lookup_bytes(order).to_array();
        } else {
            for (to, at) in to.iter_mut().zip([0, 8]) {
                to.0 = four
                    .in_blocks()
                    .lookup_bytes(u8x64::repeat(&PAIRS) | at)
                    .to_array();
            }
        }
    };
    let steps = steps.as_chunks_mut().0;
    let (steps, rest) = steps.split_at_mut(steps.len().min(rows[0].len() / 16));
    let whole = array::map(rows, |row| &row.as_chunks::<16>().0[..steps.len()]);
    for (i, to) in steps.iter_mut().enumerate() {
        put(Simd::from_parts(|y| u8x16::from(whole[y][i])), to);
    }
    if let Some(to) = rest.first_mut() {
        put(
            Simd::from_parts(|y| u8x16::load_or_default(rows[y].as_chunks::<16>().1)),
            to,
        );
    }
}

/// The same where spans overlap, so that it pays to put the pixels in order first. `steps` is for `AHEAD` and `taps` more.
#[kernel(icelake, avx2, sse4, neon82)]
fn across_in_steps(
    image: Image<'_>,
    axis: &mut Axis,
    taps: usize,
    steps: &mut [Step],
    out: &mut Vec<Pixel>,
) {
    if STEP == 4 {
        // Of each four weights the signed lower bytes, and then how many times 256 is left.
        let split = |it: i16x8<S>| {
            ((it + 128) ^ 128)
                .bitcast::<u8>()
                .swizzle_groups([0, 2, 4, 6, 1, 3, 5, 7])
        };
        i16x8::over_mut(&mut axis.weights).map(|it| split(it).bitcast());
    }
    for top in (0..image.height).step_by(BAND) {
        let rows = array::map(image.band(top, image.width), |row| row.as_flattened());
        let mut first = usize::MAX;
        push_band(axis, taps, out, |start, weights| {
            if start.checked_sub(first).is_none_or(|it| it > AHEAD) {
                first = start;
                put_in_order(array::map(rows, |row| &row[4 * first..]), steps);
            }
            let from = steps[(start - first) / STEP..][..taps / STEP]
                .as_chunks::<{ 4 / STEP }>()
                .0;
            let mut sums = [i32x16::zero(); 2];
            for (from, &[a, b, c, d]) in from.iter().zip(weights) {
                unroll!(for i in 0..2 {
                    let (from, by) = (
                        u8x64::from(from[2 * i / STEP].0),
                        i16x32::repeat(&[[a, b], [c, d]][i]),
                    );
                    sums[i] = if STEP == 4 {
                        from.cast_signed().dot_add(by.bitcast::<i8>(), sums[i])
                    } else {
                        sums[i] + from.bitcast::<i16>().dot(by)
                    };
                });
            }
            if STEP == 4 {
                sums[0] + (sums[1] << 8) + (128 << SHIFT)
            } else {
                sums[0] + sums[1]
            }
            .split()
        });
    }
}

/// Whether `across_in_steps` has the instructions with which it is faster.
#[kernel(avx2, neon82)]
fn adds_up_products() -> bool {
    has!(avx2) || has!(dot)
}

/// The weighted sum of the vectors at `x` in rows of `row` bytes.
#[simd]
fn weigh_rows(src: &[u8], row: usize, mut x: usize, weights: &[[i16; 2]]) -> u8xN<S> {
    let mut sums = [i32xN::zero(); 4];
    for weights in weights {
        let (a, b) = (u8xN::load_at(src, x), u8xN::load_at(src, x + row));
        x += 2 * row;
        sums = a.in_blocks().weighted_add(b, *weights, sums);
    }
    let pack = |a, b| round(a).in_blocks().saturating_narrow::<i16>(round(b));
    pack(sums[0], sums[1])
        .in_blocks()
        .saturating_narrow(pack(sums[2], sums[3]))
}

/// The rows have `row` bytes. `src` has one to spare, and `SLACK` bytes. `out` has the room, and `SLACK` bytes.
#[kernel]
fn down(src: &[u8], row: usize, axis: &Axis, out: &mut Vec<u8>) {
    let out = &mut Output::append(out, row * axis.spans.len() + SLACK);
    for (span, weights) in (axis.spans.iter()).zip(axis.weights.chunks_exact(axis.stride)) {
        let weights = &weights.as_chunks().0[..span.len.div_ceil(2) as usize];
        let src = &src[span.start as usize * row..];
        // Else the shift of the sums moves away from the narrowing, with which it is one instruction.
        assert!(!weights.is_empty());
        for x in (0..row).step_by(u8xN::LANES) {
            out.push_with_slack(weigh_rows(src, row, x, weights).first_n(row - x));
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Filter {
    Box,
    Bilinear,
    Lanczos3,
    Mitchell,
    Nearest,
    /// Catmull-Rom
    Cubic,
    Lanczos2,
    /// Magic Kernel Sharp (Costella)
    Mks2013,
    Mks2021,
}

#[inline(never)]
fn sinc(x: f64) -> f64 {
    let px = core::f64::consts::PI * x;
    if x.abs() < 1e-8 { 1.0 } else { px.sin() / px }
}

fn normalize(weights: &mut [f64]) {
    let sum = weights.iter().fold(0.0, |sum, it| sum + it);
    let inverse = if sum != 0.0 { 1.0 / sum } else { 0.0 };
    for it in weights {
        *it = *it * inverse * f64::from(1 << SHIFT);
    }
}

/// With one sine for all `weights`, given those of the steps from `x(0)`, and `sin(3a) = 3 sin(a) - 4 sin(a)^3`.
/// They are off by less than 1e-8. Returns whether that leaves no doubt about how to round them.
#[inline(always)]
fn lanczos3_by_turns(x: impl Fn(usize) -> f64, turns: &[(f64, f64)], weights: &mut [f64]) -> bool {
    let (sin, cos) = (FRAC_PI_3 * x(0)).sin_cos();
    for (k, (weight, turn)) in weights.iter_mut().zip(turns).enumerate() {
        let (sin, angle) = (sin * turn.1 + cos * turn.0, FRAC_PI_3 * x(k));
        let (near, far) = (angle * angle, sin * sin);
        let usual = far * (1.0 - 4.0 / 3.0 * far) / near;
        *weight = match x(k).abs() {
            ..1e-2 => 1.0 - near * (5.0 / 3.0 - near * (14.0 / 15.0 - near * (17.0 / 63.0))),
            ..3.0 => usual,
            _ => 0.0,
        };
    }
    normalize(weights);
    let off = |it: &f64| (it - it.round_ties_even()).abs();
    weights
        .iter()
        .fold(true, |all, it| all & (off(it) < 0.5 - 1e-6))
}

/// The family of Mitchell & Netravali 1988.
fn bc_cubic(b: f64, c: f64, x: f64) -> f64 {
    let xx = x * x;
    if x < 1.0 {
        ((12.0 - 9.0 * b - 6.0 * c) * xx * x + (-18.0 + 12.0 * b + 6.0 * c) * xx + (6.0 - 2.0 * b))
            / 6.0
    } else if x < 2.0 {
        ((-b - 6.0 * c) * xx * x
            + (6.0 * b + 30.0 * c) * xx
            + (-12.0 * b - 48.0 * c) * x
            + (8.0 * b + 24.0 * c))
            / 6.0
    } else {
        0.0
    }
}

impl Filter {
    fn at(self, signed: f64) -> f64 {
        let x = signed.abs();
        match self {
            Self::Box | Self::Nearest => (signed > -0.5 && signed <= 0.5) as u8 as f64,
            _ if x >= self.radius() => 0.0,
            Self::Bilinear => 1.0 - x,
            Self::Mitchell => bc_cubic(1.0 / 3.0, 1.0 / 3.0, x),
            Self::Cubic => bc_cubic(0.0, 0.5, x),
            Self::Lanczos2 => sinc(x) * sinc(x / 2.0),
            Self::Lanczos3 => sinc(x) * sinc(x / 3.0),
            Self::Mks2013 if x >= 1.5 => -(x - 2.5) * (x - 2.5) / 8.0,
            Self::Mks2013 if x >= 0.5 => (4.0 * x * x - 11.0 * x + 7.0) / 4.0,
            Self::Mks2013 => 17.0 / 16.0 - 7.0 * x * x / 4.0,
            Self::Mks2021 if x >= 3.5 => -(4.0 * x * x - 36.0 * x + 81.0) / 1152.0,
            Self::Mks2021 if x >= 2.5 => (4.0 * x * x - 27.0 * x + 45.0) / 144.0,
            Self::Mks2021 if x >= 1.5 => -(24.0 * x * x - 113.0 * x + 130.0) / 144.0,
            Self::Mks2021 if x >= 0.5 => (140.0 * x * x - 379.0 * x + 239.0) / 144.0,
            Self::Mks2021 => 577.0 / 576.0 - 239.0 * x * x / 144.0,
        }
    }

    fn radius(self) -> f64 {
        match self {
            Self::Box | Self::Nearest => 0.5,
            Self::Bilinear => 1.0,
            Self::Mitchell | Self::Cubic | Self::Lanczos2 => 2.0,
            Self::Mks2013 => 2.5,
            Self::Lanczos3 => 3.0,
            Self::Mks2021 => 4.5,
        }
    }

    fn axis(self, src_len: usize, dst_len: usize) -> Result<Axis> {
        let scale = dst_len as f64 / src_len as f64;
        let max_len = ((self.radius() / scale.min(1.0)).ceil() as usize * 2 + 2).min(MAX_TAPS);
        let max_len = max_len.min(src_len);
        let stride = (max_len + STEP - 1).next_multiple_of(4);
        // Stretched to cover all that becomes one pixel. But `Nearest` picks one sample at any scale.
        let stretch = if self == Self::Nearest {
            1.0
        } else {
            scale.min(1.0)
        };
        // With the limit here, a span that would be too long stays centered.
        let support = (self.radius() / stretch).min((MAX_TAPS / 2 - 1) as f64);
        let (mut spans, mut weights) = (with_room(dst_len)?, filled(area(dst_len, stride)?, 0)?);
        let (mut few, mut many);
        let (exact, turns): (&mut [_], &mut [_]) = if max_len <= 16 {
            few = ([0.0; 16], [(0.0, 0.0); 16]);
            (&mut few.0, &mut few.1)
        } else {
            many = ([0.0; MAX_TAPS], [(0.0, 0.0); MAX_TAPS]);
            (&mut many.0, &mut many.1)
        };
        if self == Self::Lanczos3 {
            for (k, turn) in (0..).zip(&mut turns[..max_len]) {
                *turn = (FRAC_PI_3 * stretch * f64::from(k)).sin_cos();
            }
        }
        for (i, weights) in weights.chunks_exact_mut(stride).enumerate() {
            let center = (f64::from(i as u32) + 0.5) / scale - 0.5;
            let start = ((center - support + 0.5).floor() as i64).max(0) as usize;
            let end = ((center + support + 0.5).floor() as i64 as usize).min(src_len - 1);
            let len = (end + 1 - start).min(max_len);
            let exact = &mut exact[..len];
            let x = |k: usize| (f64::from((start + k) as u32) - center) * stretch;
            if !(self == Self::Lanczos3 && lanczos3_by_turns(x, turns, exact)) {
                for (k, exact) in exact.iter_mut().enumerate() {
                    *exact = self.at(x(k));
                }
                normalize(exact);
            }
            // Most spans have a zero at one end, which is left out.
            let (mut skipped, mut used) = (0, 1);
            let (mut total, mut biggest, mut most) = (0, 0, 0);
            for (k, exact) in exact.iter().enumerate() {
                let weight = exact.round_ties_even() as i16;
                if weight == 0 {
                    skipped += usize::from(skipped == k);
                    continue;
                }
                used = k + 1 - skipped;
                // What is left of a filter at the edge has its middle.
                debug_assert!(weight.abs() < 127 * 256);
                weights[used - 1] = weight;
                total += i32::from(weight);
                if weight.unsigned_abs() > most {
                    (biggest, most) = (used - 1, weight.unsigned_abs());
                }
            }
            // The sum is exact, so that a flat field stays flat.
            weights[biggest] = (i32::from(weights[biggest]) + (1 << SHIFT) - total) as i16;
            // If all were zero, it is the first.
            spans.push(Span {
                start: (start + if skipped < len { skipped } else { 0 }) as u32,
                len: used as u32,
            });
        }
        Ok(Axis {
            spans,
            weights,
            stride,
        })
    }
}

pub(crate) fn resize(
    image: Image<'_>,
    width: usize,
    height: usize,
    filter: Filter,
) -> Result<Vec<u8>> {
    let mut out = with_room(area(area(width, height)?, 4)?.saturating_add(SLACK))?;
    let between_len = area(width, image.height + BAND)?.saturating_add(SLACK / 4);
    let mut between = with_room(between_len)?;
    let mut axis = filter.axis(image.width, width)?;
    // As measured.
    let (direct, in_steps) = (axis.longest(1), axis.longest(STEP));
    let pays = direct > 4 && 4 * in_steps * width + (8 - STEP) * image.width <= 7 * direct * width;
    let is_in_steps = pays && image.height >= 8 * BAND && adds_up_products();
    let taps = if is_in_steps {
        in_steps
    } else {
        axis.pad(image.width)
    };
    if is_in_steps {
        axis.align();
        let mut steps = filled(
            (image.width.next_multiple_of(4).min(AHEAD) + taps) / STEP,
            Step([0; 64]),
        )?;
        across_in_steps(image, &mut axis, taps, &mut steps, &mut between);
    } else if taps <= image.width {
        across(image, image.height, &axis, taps, &mut between);
    } else {
        // A span is read whole, up to three pixels past its row. The last rows are copied to where that is possible.
        let height = image.height.saturating_sub(BAND) / BAND * BAND;
        across(image, height, &axis, taps, &mut between);
        let last = &image.pixels[height * image.width..];
        let mut pixels = filled(3 * BAND * image.width, [0; 4])?;
        pixels[..last.len()].copy_from_slice(last);
        let last = Image::of_pixels(&pixels, image.width, 3 * BAND)?;
        across(last, image.height - height, &axis, taps, &mut between);
    }
    fill_up(&mut between, between_len, [0; 4]);
    down(
        between.as_flattened(),
        4 * width,
        &filter.axis(image.height, height)?,
        &mut out,
    );
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg_attr(miri, ignore = "slow, and no more than arithmetic")]
    fn turns_are_as_near_as_they_say() {
        for (stretch, first) in (1..40)
            .flat_map(|a| (0..9).map(move |b| (1.0 / f64::from(a), 3.0 + 0.003 * f64::from(b))))
        {
            let x = |k: usize| k as f64 * stretch - first;
            let turns: [_; 256] =
                core::array::from_fn(|k| (FRAC_PI_3 * stretch * k as f64).sin_cos());
            let (mut near, mut exact) = (
                [0.0; 256],
                core::array::from_fn::<_, 256, _>(|k| Filter::Lanczos3.at(x(k))),
            );
            lanczos3_by_turns(x, &turns, &mut near);
            normalize(&mut exact);
            assert!(near.iter().zip(exact).all(|(a, b)| (a - b).abs() < 1e-8));
        }
    }

    #[test]
    #[cfg_attr(miri, ignore = "slow, and no more than arithmetic")]
    fn halves_leave_a_doubt() {
        let turns: [_; 6] = core::array::from_fn(|k| (FRAC_PI_3 * k as f64).sin_cos());
        for (wanted, is_sure) in [
            (9000.5 - 3e-6, true),
            (9000.5 - 3e-7, false),
            (9000.5, false),
        ] {
            let (mut first, mut step, mut weights) = (2.5, 0.25, [0.0; 6]);
            let mut was_sure = false;
            while step > 1e-14 {
                was_sure = lanczos3_by_turns(|k| k as f64 - first, &turns, &mut weights);
                first += if weights[2] > wanted { step } else { -step };
                step /= 2.0;
            }
            assert_eq!(was_sure, is_sure);
        }
    }
}
