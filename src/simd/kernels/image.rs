//! Ports of image_resize.cpp. They panic if a width is zero or if `dst` has no room for the result.
use bun_simd::{Int, Out, Writer};
use core::array::from_fn;
use std::collections::TryReserveError;

type Pixel = [u8; 4];

/// The pixels that one of the result is made of.
#[derive(Clone, Copy, Default)]
struct Span {
    start: usize,
    len: usize,
}

const MAX_TAPS: usize = 256;
const SHIFT: u32 = 14;
const ROUND: i32 = 1 << (SHIFT - 1);

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{F32, I32, U8, U32, Vector, x128};

    /// The rows share the weights and the bounds checks.
    #[inline(always)]
    fn resample_rows<'a, const K: usize>(
        src: [&[Pixel]; K],
        taps: impl Iterator<Item = (&'a Span, &'a [i16])>,
        dst: &mut [&mut [Pixel]; K],
    ) {
        use x128::{I16, I32, U8, U32, U64};
        let by_channel = U8::load(&[
            0, 0x80, 4, 0x80, 1, 0x80, 5, 0x80, 2, 0x80, 6, 0x80, 3, 0x80, 7, 0x80,
        ]);
        for (x, (span, weights)) in taps.enumerate() {
            let (weight_pairs, last_weight) = weights[..span.len].as_chunks::<2>();
            let rows = src.map(|row| row[span.start..][..span.len].as_chunks::<2>());
            let mut sums = [I32::splat(ROUND); K];
            #[rustc_unroll(never)]
            for (i, &[w0, w1]) in weight_pairs.iter().enumerate() {
                let weights = U32::splat(u32::from(w0 as u16) | u32::from(w1 as u16) << 16);
                for k in 0..K {
                    let pair = u64::from_le_bytes(*rows[k].0[i].as_flattened().as_array().unwrap());
                    let channels = U64::from_first(pair).bitcast::<U8>().lookup(by_channel);
                    sums[k] += I32::pairwise_dot(channels.bitcast::<I16>(), weights.bitcast());
                }
            }
            for k in 0..K {
                if let ([pixel], &[weight]) = (rows[k].1, last_weight) {
                    sums[k] += Vector::load(pixel).cast::<i32>() * i32::from(weight);
                }
            }
            for k in 0..K {
                dst[k][x] = (sums[k] >> SHIFT).saturating_cast_u8().to_array();
            }
        }
    }

    /// Resamples each row of `src`.
    #[export(up_to = avx2, up_to = neon)]
    pub fn horizontal<'a>(
        src: &[Pixel],
        src_w: usize,
        axis: &Axis,
        dst: Out<'a, Pixel>,
    ) -> &'a mut [Pixel] {
        let (taps, dst_w, src_h) = (axis.taps(), axis.spans.len(), src.len() / src_w);
        let from = |y: usize| &src[y * src_w..][..src_w];
        let mut dst = dst.into_writer();
        if src_h < 4 {
            for y in 0..src_h {
                dst.append(|to| {
                    let to = zeroed(to, dst_w);
                    resample_rows([from(y)], taps.clone(), &mut [&mut *to]);
                    to
                });
            }
            return dst.finish();
        }
        for y in tiles(src_h) {
            dst.truncate(y * dst_w);
            dst.append(|to| {
                let to = zeroed(to, 4 * dst_w);
                let from = from_fn(|i| from(y + i));
                resample_rows(from, taps.clone(), &mut four_rows_mut(to, dst_w));
                to
            });
        }
        dst.finish()
    }

    /// For rows of at least `PIXELS`, which have `K * N` bytes.
    #[inline(always)]
    fn sum_rows<const K: usize, const N: usize, const PIXELS: usize>(
        src: &[Pixel],
        width: usize,
        axis: &Axis,
        dst: &mut Writer<'_, Pixel>,
    ) where
        i32: Int<N>,
    {
        for (span, weights) in axis.taps() {
            let window = &src[span.start * width..][..span.len * width];
            dst.append(|to| {
                to.fill_chunks(&window[..width], |mut at, _: &[Pixel; PIXELS]| {
                    let mut sums = [Vector::<i32, N>::splat(ROUND); K];
                    for &weight in &weights[..span.len] {
                        let bytes = window[at..][..PIXELS].as_flattened().as_chunks().0;
                        for k in 0..K {
                            let channels = Vector::load(&bytes[k]).cast::<i32>();
                            sums[k] += channels * Vector::splat(weight).cast();
                        }
                        at += width;
                    }
                    let bytes = sums.map(|sum| (sum >> SHIFT).saturating_cast_u8().to_array());
                    bytes.as_flattened().as_chunks().0.as_array().copied()
                })
            });
        }
    }

    /// Resamples each column of `src`.
    #[export(up_to = neon)]
    pub fn vertical<'a>(
        src: &[Pixel],
        width: usize,
        axis: &Axis,
        dst: Out<'a, Pixel>,
    ) -> &'a mut [Pixel] {
        let mut dst = dst.into_writer();
        if width >= U32::LEN {
            sum_rows::<{ U8::LEN / 16 }, 16, { U32::LEN }>(src, width, axis, &mut dst);
        } else if width >= 4 {
            sum_rows::<1, 16, 4>(src, width, axis, &mut dst);
        } else {
            sum_rows::<1, 4, 1>(src, width, axis, &mut dst);
        }
        dst.finish()
    }

    /// For rows of at least `N` pixels.
    #[inline(always)]
    fn flip_rows<const N: usize, const LANES: usize>(
        mut src: &[Pixel],
        width: usize,
        dst: &mut Writer<'_, Pixel>,
    ) where
        u32: Int<LANES>,
    {
        let reversed = |pixels: &[Pixel; N]| {
            let (from, mut all) = (pixels.as_chunks::<LANES>().0, *pixels);
            for (to, from) in all.as_chunks_mut().0.iter_mut().zip(from.iter().rev()) {
                let lanes = Vector::from_array(from.map(u32::from_ne_bytes));
                *to = lanes.reverse().to_array().map(u32::to_ne_bytes);
            }
            all
        };
        while let Some((row, below)) = src.split_at_checked(width)
            && let Some((_, last)) = row.split_last_chunk()
        {
            let overlap = (width - 1) % N + 1;
            let chunks = row[..width - overlap].as_chunks().0;
            assert!(dst.remaining() >= width);
            dst.append(|to| {
                let mut to = to.take(width).into_writer();
                to.push_first(reversed(last), overlap);
                // Unlike with `rev`, the loop has one condition.
                let from_end = |i: usize| &chunks[chunks.len() - 1 - i];
                to.extend_with(0..chunks.len(), |i| Some(reversed(from_end(i))));
                to.finish()
            });
            src = below;
        }
    }

    #[export(up_to = neon)]
    pub fn flip_horizontally<'a>(
        src: &[Pixel],
        width: usize,
        dst: Out<'a, Pixel>,
    ) -> &'a mut [Pixel] {
        let mut dst = dst.into_writer();
        match width {
            16.. => flip_rows::<16, { U32::LEN }>(src, width, &mut dst),
            4.. => flip_rows::<4, 4>(src, width, &mut dst),
            _ => {
                for row in src.chunks_exact(width) {
                    assert!(dst.remaining() >= width);
                    dst.extend_with(row.iter().rev(), |&pixel| Some([pixel]));
                }
            }
        }
        dst.finish()
    }

    #[inline(always)]
    fn transposed(rows: [&[Pixel; 4]; 4]) -> [x128::U8; 4] {
        let load = |i: usize| x128::U8::from_slice(rows[i].as_flattened()).bitcast::<x128::U32>();
        let ((ac, ac_next), (bd, bd_next)) =
            (load(0).interleave(load(2)), load(1).interleave(load(3)));
        let ((a, b), (c, d)) = (ac.interleave(bd), ac_next.interleave(bd_next));
        [a, b, c, d].map(|v| v.bitcast())
    }

    /// Makes a band of rows at a time, to read whole cache lines. No side is shorter than a tile.
    #[inline(always)]
    fn rotate_tiles<'a, const IS_CLOCKWISE: bool>(
        src: &[Pixel],
        width: usize,
        height: usize,
        dst: Out<'a, Pixel>,
    ) -> &'a mut [Pixel] {
        let (mut done, mut dst) = (0, dst.into_writer());
        while done < width {
            let rows = if width - done < 68 { width - done } else { 64 };
            let left = if IS_CLOCKWISE {
                done
            } else {
                width - done - rows
            };
            dst.append(|band| {
                let band = zeroed(band, rows * height);
                for y in tiles(height) {
                    let (ab, cd) = src[y * width..][..4 * width].split_at(2 * width);
                    let ((a, b), (c, d)) = (ab.split_at(width), cd.split_at(width));
                    let from = if IS_CLOCKWISE {
                        [d, c, b, a]
                    } else {
                        [a, b, c, d]
                    };
                    let from = from.map(|row| &row[left..][..rows]);
                    let column = if IS_CLOCKWISE { height - 4 - y } else { y };
                    for x in tiles(rows) {
                        let row = if IS_CLOCKWISE { x } else { rows - 4 - x };
                        let [a, b, c, d] = four_rows_mut(&mut band[row * height..], height);
                        let to = if IS_CLOCKWISE {
                            [a, b, c, d]
                        } else {
                            [d, c, b, a]
                        };
                        let to = to.map(|row| row[column..][..4].as_flattened_mut());
                        let tile = transposed(from.map(|row| row[x..].first_chunk().unwrap()));
                        for (pixels, to) in tile.iter().zip(to) {
                            pixels.copy_to_slice(to);
                        }
                    }
                }
                band
            });
            done += rows;
        }
        dst.finish()
    }

    #[export(baseline)]
    pub fn rotate_tiles_90<'a>(
        src: &[Pixel],
        width: usize,
        height: usize,
        dst: Out<'a, Pixel>,
    ) -> &'a mut [Pixel] {
        rotate_tiles::<true>(src, width, height, dst)
    }

    #[export(baseline)]
    pub fn rotate_tiles_270<'a>(
        src: &[Pixel],
        width: usize,
        height: usize,
        dst: Out<'a, Pixel>,
    ) -> &'a mut [Pixel] {
        rotate_tiles::<false>(src, width, height, dst)
    }

    /// The index of the first color at the least distance.
    #[export(up_to = neon)]
    pub fn nearest_in_palette(palette: &[Pixel], color: Pixel) -> u8 {
        let palette = &palette[..palette.len().min(256)];
        let padded = || {
            let last = palette.len().checked_sub(1)?;
            let palette: [_; 4] = from_fn(|i| palette[i.min(last)]);
            width::x128::nearest_in_palette(&palette, color)
        };
        width::full::nearest_in_palette(palette, color)
            .or_else(|| width::x128::nearest_in_palette(palette, color))
            .or_else(padded)
            .unwrap_or(0)
    }

    #[bun_simd::foreach_width]
    mod width {
        use isa::{I16, I32, U8, U16};

        /// `None` unless the palette fills a vector.
        #[inline(always)]
        pub fn nearest_in_palette(palette: &[Pixel], color: Pixel) -> Option<u8> {
            let last = palette.split_last_chunk()?.1;
            let color = U8::repeat(color);
            let distance_and_index = |colors: &[Pixel; I32::LEN], index: I32| {
                let diff: U16 = U8::from_slice(colors.as_flattened())
                    .abs_diff(color)
                    .bitcast();
                let (even, odd): (I16, I16) = ((diff & 0xFF).bitcast(), (diff >> 8).bitcast());
                (I32::pairwise_dot(even, even) + I32::pairwise_dot(odd, odd)) << 8 | index
            };
            let mut index = I32::iota();
            let mut best = distance_and_index(last, index + (palette.len() - I32::LEN) as i32);
            for colors in palette[..palette.len() - 1].as_chunks().0 {
                best = best.simd_min(distance_and_index(colors, index));
                index += I32::LEN as i32;
            }
            Some(best.reduce_min() as u8)
        }
    }

    #[export(long_running, up_to = neon)]
    pub fn modulate(pixels: &mut [Pixel], brightness: f32, saturation: f32) {
        U8::map_in_place(pixels.as_flattened_mut(), |v| {
            let v: U32 = v.bitcast();
            let channel = |at: u32| (v >> at & 0xFF).bitcast::<I32>().cast::<f32>();
            let (r, g, b) = (channel(0), channel(8), channel(16));
            let y = r.mul_add(
                F32::splat(0.299),
                g.mul_add(F32::splat(0.587), b * F32::splat(0.114)),
            );
            let modulated = |c: F32, at: u32| {
                let c = (c - y).mul_add(F32::splat(saturation), y) * F32::splat(brightness);
                (c + F32::splat(0.5))
                    .simd_clamp(0.0, 255.0)
                    .to_i32()
                    .bitcast::<U32>()
                    << at
            };
            (modulated(r, 0) | modulated(g, 8) | (modulated(b, 16) | v & 0xFF00_0000)).bitcast()
        });
    }
}

/// For pixels that are not written in order. They are few enough to stay in the cache.
#[inline(always)]
fn zeroed(out: Out<'_, Pixel>, len: usize) -> &mut [Pixel] {
    let mut out = out.into_writer();
    out.extend_with(0..len, |_| Some([[0; 4]]));
    out.finish()
}

#[inline(always)]
fn four_rows_mut(image: &mut [Pixel], width: usize) -> [&mut [Pixel]; 4] {
    let (ab, cd) = image[..4 * width].split_at_mut(2 * width);
    let ((a, b), (c, d)) = (ab.split_at_mut(width), cd.split_at_mut(width));
    [a, b, c, d]
}

/// Where tiles of 4 start that cover `len`, which is at least 4. The last one overlaps.
#[inline(always)]
fn tiles(len: usize) -> impl Iterator<Item = usize> {
    let mut end = 0;
    core::iter::from_fn(move || {
        let start = (end < len).then(|| end.min(len - 4))?;
        end = start + 4;
        Some(start)
    })
}

#[inline(always)]
fn rotate_low<const IS_CLOCKWISE: bool, const HEIGHT: usize>(
    src: &[Pixel],
    width: usize,
    dst: &mut Writer<'_, Pixel>,
) {
    let len = width.min(dst.remaining() / HEIGHT);
    let rows: [_; HEIGHT] = from_fn(|y| &src[y * width..][..len]);
    dst.extend_with(0..len, |x| {
        Some::<[_; HEIGHT]>(from_fn(|y| match IS_CLOCKWISE {
            true => rows[HEIGHT - 1 - y][x],
            false => rows[y][len - 1 - x],
        }))
    });
}

#[inline(always)]
fn rotate<'a, const IS_CLOCKWISE: bool>(
    src: &[Pixel],
    width: usize,
    dst: Out<'a, Pixel>,
) -> &'a mut [Pixel] {
    let height = src.len() / width;
    assert!(dst.len() >= width * height);
    if width >= 4 && height >= 4 {
        return match IS_CLOCKWISE {
            true => simd::rotate_tiles_90(src, width, height, dst),
            false => simd::rotate_tiles_270(src, width, height, dst),
        };
    }
    let mut dst = dst.into_writer();
    match height {
        0 => {}
        1 => rotate_low::<IS_CLOCKWISE, 1>(src, width, &mut dst),
        2 => rotate_low::<IS_CLOCKWISE, 2>(src, width, &mut dst),
        3 => rotate_low::<IS_CLOCKWISE, 3>(src, width, &mut dst),
        _ => {
            for x in 0..width {
                dst.extend_with(0..height, |y| match IS_CLOCKWISE {
                    true => Some([src[(height - 1 - y) * width + x]]),
                    false => Some([src[y * width + width - 1 - x]]),
                });
            }
        }
    }
    dst.finish()
}

/// Clockwise.
pub fn rotate_90<'a>(src: &[Pixel], width: usize, dst: Out<'a, Pixel>) -> &'a mut [Pixel] {
    rotate::<true>(src, width, dst)
}

pub fn rotate_270<'a>(src: &[Pixel], width: usize, dst: Out<'a, Pixel>) -> &'a mut [Pixel] {
    rotate::<false>(src, width, dst)
}

pub fn rotate_180<'a>(src: &[Pixel], dst: Out<'a, Pixel>) -> &'a mut [Pixel] {
    simd::flip_horizontally(src, src.len().max(1), dst)
}

pub fn flip_vertically<'a>(src: &[Pixel], width: usize, dst: Out<'a, Pixel>) -> &'a mut [Pixel] {
    let mut dst = dst.into_writer();
    for row in src.chunks_exact(width).rev() {
        dst.extend_from_slice(row);
    }
    dst.finish()
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-8 {
        return 1.0;
    }
    let px = core::f64::consts::PI * x;
    px.sin() / px
}

/// Of Mitchell and Netravali.
fn cubic(b: f64, c: f64, x: f64) -> f64 {
    let xx = x * x;
    if x < 1.0 {
        ((12.0 - 9.0 * b - 6.0 * c) * xx * x + (-18.0 + 12.0 * b + 6.0 * c) * xx + (6.0 - 2.0 * b))
            / 6.0
    } else {
        ((-b - 6.0 * c) * xx * x
            + (6.0 * b + 30.0 * c) * xx
            + (-12.0 * b - 48.0 * c) * x
            + (8.0 * b + 24.0 * c))
            / 6.0
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Filter {
    Box,
    Bilinear,
    Lanczos3,
    Mitchell,
    Nearest,
    CatmullRom,
    Lanczos2,
    /// Magic Kernel Sharp
    Mks2013,
    Mks2021,
}

impl Filter {
    pub const ALL: [Self; 9] = {
        use Filter::*;
        [
            Box, Bilinear, Lanczos3, Mitchell, Nearest, CatmullRom, Lanczos2, Mks2013, Mks2021,
        ]
    };

    fn radius(self) -> f64 {
        match self {
            Self::Box | Self::Nearest => 0.5,
            Self::Bilinear => 1.0,
            Self::Mitchell | Self::CatmullRom | Self::Lanczos2 => 2.0,
            Self::Mks2013 => 2.5,
            Self::Lanczos3 => 3.0,
            Self::Mks2021 => 4.5,
        }
    }

    fn weight_at(self, offset: f64) -> f64 {
        let x = offset.abs();
        match self {
            Self::Box | Self::Nearest => f64::from(offset > -0.5 && offset <= 0.5),
            _ if x >= self.radius() => 0.0,
            Self::Bilinear => 1.0 - x,
            Self::Mitchell => cubic(1.0 / 3.0, 1.0 / 3.0, x),
            Self::CatmullRom => cubic(0.0, 0.5, x),
            Self::Lanczos2 | Self::Lanczos3 => sinc(x) * sinc(x / self.radius()),
            Self::Mks2013 => match x {
                1.5.. => -(x - 2.5) * (x - 2.5) / 8.0,
                0.5.. => (4.0 * x * x - 11.0 * x + 7.0) / 4.0,
                _ => 17.0 / 16.0 - 7.0 * x * x / 4.0,
            },
            Self::Mks2021 => match x {
                3.5.. => -(4.0 * x * x - 36.0 * x + 81.0) / 1152.0,
                2.5.. => (4.0 * x * x - 27.0 * x + 45.0) / 144.0,
                1.5.. => -(24.0 * x * x - 113.0 * x + 130.0) / 144.0,
                0.5.. => (140.0 * x * x - 379.0 * x + 239.0) / 144.0,
                _ => 577.0 / 576.0 - 239.0 * x * x / 144.0,
            },
        }
    }
}

fn build_weights(
    filter: Filter,
    src_len: i32,
    spans: &mut [Span],
    weights: &mut [i16],
    stride: usize,
) {
    let scale = spans.len() as f64 / f64::from(src_len);
    // All but one cover what a pixel of a smaller image stands for.
    let fscale = if filter == Filter::Nearest {
        1.0
    } else {
        scale.min(1.0)
    };
    let support = (filter.radius() / fscale).min((MAX_TAPS / 2 - 1) as f64);
    let mut fw = [0.0; MAX_TAPS];
    for (i, (span, w)) in spans
        .iter_mut()
        .zip(weights.chunks_exact_mut(stride))
        .enumerate()
    {
        let center = (i as f64 + 0.5) / scale - 0.5;
        let start = ((center - support + 0.5).floor() as i32).max(0);
        let end = ((center + support + 0.5).floor() as i32).min(src_len - 1);
        let n = ((end - start + 1) as usize).min(stride);
        let mut sum = 0.0;
        for (k, f) in fw[..n].iter_mut().enumerate() {
            *f = filter.weight_at((f64::from(start + k as i32) - center) * fscale);
            sum += *f;
        }
        let inv = if sum != 0.0 { 1.0 / sum } else { 0.0 };
        let (mut total, mut big) = (0, 0);
        for k in 0..n {
            let q = ((fw[k] * inv * 16384.0).round_ties_even() as i32).clamp(-32768, 32767);
            w[k] = q as i16;
            total += q;
            if q.abs() > i32::from(w[big]).abs() {
                big = k;
            }
        }
        w[big] = (i32::from(w[big]) + (16384 - total)) as i16;
        let unused = w[..n].iter().take_while(|&&weight| weight == 0).count();
        let end = w[..n].iter().rposition(|&weight| weight != 0).unwrap_or(0) + 1;
        w.copy_within(unused..end, 0);
        *span = Span {
            start: start as usize + unused,
            len: end - unused,
        };
    }
}

pub(crate) struct Axis {
    spans: Vec<Span>,
    weights: Vec<i16>,
    stride: usize,
}

impl Axis {
    fn new(filter: Filter, src_len: usize, dst_len: usize) -> Result<Self, TryReserveError> {
        let support = filter.radius() / (dst_len as f64 / src_len as f64).min(1.0);
        let stride = (support.ceil() as usize * 2 + 2).min(MAX_TAPS);
        let (mut spans, mut weights) = (Vec::new(), Vec::new());
        spans.try_reserve_exact(dst_len)?;
        weights.try_reserve_exact(dst_len * stride)?;
        spans.resize(dst_len, Span::default());
        weights.resize(dst_len * stride, 0);
        build_weights(filter, src_len as i32, &mut spans, &mut weights, stride);
        Ok(Self {
            spans,
            weights,
            stride,
        })
    }

    #[inline(always)]
    fn taps(&self) -> impl Iterator<Item = (&Span, &[i16])> + Clone {
        self.spans
            .iter()
            .zip(self.weights.chunks_exact(self.stride))
    }
}

/// May panic if an image is empty.
pub fn resize<'a>(
    filter: Filter,
    src: &[Pixel],
    src_w: usize,
    dst: Out<'a, Pixel>,
    dst_w: usize,
) -> Result<&'a mut [Pixel], TryReserveError> {
    let src_h = src.len() / src_w;
    let x = Axis::new(filter, src_w, dst_w)?;
    let y = Axis::new(filter, src_h, dst.len() / dst_w)?;
    let mut between = Vec::new();
    between.try_reserve_exact(dst_w * src_h)?;
    let between = simd::horizontal(src, src_w, &x, between.spare_capacity_mut().into());
    Ok(simd::vertical(between, dst_w, &y, dst))
}
