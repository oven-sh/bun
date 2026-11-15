//! Ports of image_resize.cpp.
use bun_simd::{Int, Isa, Out};
use core::slice::ChunksExact;

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
    use isa::{F32, I32, U8, U16, U32, Vector, x128};

    #[inline(always)]
    fn weighted_sum(pixels: &[Pixel], weights: &[i16]) -> Pixel {
        use x128::{I16, I32, U8, U32, U64};
        let by_channel = U8::load(&[
            0, 0x80, 4, 0x80, 1, 0x80, 5, 0x80, 2, 0x80, 6, 0x80, 3, 0x80, 7, 0x80,
        ]);
        let ((pairs, last), (weight_pairs, last_weight)) =
            (pixels.as_chunks::<2>(), weights.as_chunks::<2>());
        let mut sum = I32::splat(ROUND);
        for (pair, &[w0, w1]) in pairs.iter().zip(weight_pairs) {
            let pair = u64::from_le_bytes(*pair.as_flattened().as_array().unwrap());
            let channels = U64::from_first(pair).bitcast::<U8>().lookup(by_channel);
            let weights = U32::splat(u32::from(w0 as u16) | u32::from(w1 as u16) << 16);
            sum += I32::pairwise_dot(channels.bitcast::<I16>(), weights.bitcast());
        }
        if let ([pixel], &[weight]) = (last, last_weight) {
            sum += Vector::load(pixel).cast::<i32>() * i32::from(weight);
        }
        (sum >> SHIFT).saturating_cast_u8().to_array()
    }

    /// Resamples each row of `src`.
    #[export]
    pub fn horizontal<'a>(
        src: &[Pixel],
        src_w: usize,
        axis: &Axis,
        dst: Out<'a, Pixel>,
    ) -> &'a mut [Pixel] {
        let mut dst = dst.into_writer();
        for row in src.chunks_exact(src_w) {
            dst.extend_with(axis.taps(), |(span, weights)| {
                let pixels = &row[span.start..][..span.len];
                Some([weighted_sum(pixels, &weights[..span.len])])
            });
        }
        dst.finish()
    }

    /// Of the chunk at `index` in each row.
    #[inline(always)]
    fn weighted_sum_of_rows<const N: usize, const PIXELS: usize>(
        rows: ChunksExact<'_, u8>,
        index: usize,
        weights: &[i16],
    ) -> [Pixel; PIXELS]
    where
        i32: Int<N>,
    {
        let mut sum = Vector::<i32, N>::splat(ROUND);
        for (row, &weight) in rows.zip(weights) {
            let channels = Vector::load(&row.as_chunks().0[index]).cast::<i32>();
            sum += channels * Vector::splat(weight).cast();
        }
        let bytes = (sum >> SHIFT).saturating_cast_u8().to_array();
        *bytes.as_chunks().0.as_array().unwrap()
    }

    /// Resamples each column of `src`.
    #[export]
    pub fn vertical<'a>(
        src: &[Pixel],
        width: usize,
        axis: &Axis,
        dst: Out<'a, Pixel>,
    ) -> &'a mut [Pixel] {
        let mut dst = dst.into_writer();
        for (span, weights) in axis.taps() {
            let window = src[span.start * width..][..span.len * width].as_flattened();
            let rows = || window.chunks_exact(4 * width);
            dst.extend_with(0..width / 4, |i| {
                Some(weighted_sum_of_rows::<16, 4>(rows(), i, weights))
            });
            dst.extend_with(width / 4 * 4..width, |i| {
                Some(weighted_sum_of_rows::<4, 1>(rows(), i, weights))
            });
        }
        dst.finish()
    }

    #[export]
    pub fn cmyk_to_rgba(mut pixels: &mut [Pixel]) {
        if isa::Isa::HAS_INTERLEAVED_MEMORY {
            let blocks;
            (blocks, pixels) = pixels.as_chunks_mut();
            for block in blocks {
                let [c, m, y, k] = U8::load_interleaved4(block);
                let times_256_255ths = |t: U16| (t + 128 + ((t + 128) >> 8)).bitcast::<U8>();
                let times_k = |v: U8| {
                    let (low, high) = U16::widening_mul(v, k);
                    times_256_255ths(low).deinterleave(times_256_255ths(high)).1
                };
                U8::store_interleaved4(
                    [times_k(c), times_k(m), times_k(y), U8::splat(0xFF)],
                    block,
                );
            }
        }
        U8::map_in_place(pixels.as_flattened_mut(), |v| {
            let k = v.bitcast::<U32>() >> 24;
            let k: U16 = (k | k << 16).bitcast();
            let times_k = |v: U16| {
                let t = v * k + 128;
                (t + (t >> 8)) >> 8
            };
            let v: U16 = v.bitcast();
            ((times_k(v & 0xFF) | times_k(v >> 8) << 8).bitcast::<U32>() | 0xFF00_0000).bitcast()
        });
    }

    #[export(long_running)]
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

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-8 {
        return 1.0;
    }
    let px = core::f64::consts::PI * x;
    px.sin() / px
}

fn build_weights(src_len: i32, spans: &mut [Span], weights: &mut [i16], stride: usize) {
    let scale = spans.len() as f64 / f64::from(src_len);
    let fscale = scale.min(1.0);
    let support = (3.0 / fscale).min(127.0);
    for (i, (span, w)) in spans
        .iter_mut()
        .zip(weights.chunks_exact_mut(stride))
        .enumerate()
    {
        let center = (i as f64 + 0.5) / scale - 0.5;
        let start = ((center - support + 0.5).floor() as i32).max(0);
        let end = ((center + support + 0.5).floor() as i32).min(src_len - 1);
        let n = ((end - start + 1) as usize).min(stride);
        let mut fw = [0.0; MAX_TAPS];
        let mut sum = 0.0;
        for (k, f) in fw[..n].iter_mut().enumerate() {
            let x = ((f64::from(start + k as i32) - center) * fscale).abs();
            *f = if x < 3.0 {
                sinc(x) * sinc(x / 3.0)
            } else {
                0.0
            };
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
        *span = Span {
            start: start as usize,
            len: n,
        };
    }
}

#[derive(Default)]
pub(crate) struct Axis {
    spans: Vec<Span>,
    weights: Vec<i16>,
    stride: usize,
}

impl Axis {
    #[inline(always)]
    fn taps(&self) -> impl Iterator<Item = (&Span, &[i16])> {
        self.spans
            .iter()
            .zip(self.weights.chunks_exact(self.stride))
    }

    fn set(&mut self, src_len: usize, dst_len: usize) {
        let support = 3.0 / (dst_len as f64 / src_len as f64).min(1.0);
        self.stride = (support.ceil() as usize * 2 + 2).min(MAX_TAPS);
        self.spans.resize(dst_len, Span::default());
        self.weights.resize(dst_len * self.stride, 0);
        build_weights(
            src_len as i32,
            &mut self.spans,
            &mut self.weights,
            self.stride,
        );
    }
}

/// Memory to use again.
#[derive(Default)]
pub struct Resizer {
    x: Axis,
    y: Axis,
    between: Vec<Pixel>,
}

impl Resizer {
    /// Neither image is empty.
    pub fn lanczos3<'a>(
        &mut self,
        src: &[Pixel],
        src_w: usize,
        dst: Out<'a, Pixel>,
        dst_w: usize,
    ) -> &'a mut [Pixel] {
        let Self { x, y, between } = self;
        let src_h = src.len() / src_w;
        x.set(src_w, dst_w);
        y.set(src_h, dst.len() / dst_w);
        between.clear();
        bun_simd::extend_vec(between, dst_w * src_h, |out| {
            simd::horizontal(src, src_w, x, out)
        });
        simd::vertical(between, dst_w, y, dst)
    }
}
