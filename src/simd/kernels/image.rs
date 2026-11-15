//! Ports of image_resize.cpp.

/// The pixels that one of the result is made of.
#[derive(Clone, Copy, Default)]
pub(crate) struct Span {
    start: usize,
    n: usize,
}

const MAX_TAPS: usize = 256;
const SHIFT: u32 = 14;
const ROUND: i32 = 1 << (SHIFT - 1);

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{F32, I16, I32, U8, U16, U32, x128};

    #[export]
    pub fn horizontal(
        src: &[[u8; 4]],
        src_w: usize,
        dst: &mut [[u8; 4]],
        dst_w: usize,
        spans: &[Span],
        weights: &[i16],
        stride: usize,
    ) {
        use x128::{I16, I32, U8, U32, U64};
        let by_channel = U8::load(&[
            0, 0x80, 4, 0x80, 1, 0x80, 5, 0x80, 2, 0x80, 6, 0x80, 3, 0x80, 7, 0x80,
        ]);
        for (src_row, dst_row) in src.chunks_exact(src_w).zip(dst.chunks_exact_mut(dst_w)) {
            for ((out, span), w) in dst_row
                .iter_mut()
                .zip(spans)
                .zip(weights.chunks_exact(stride))
            {
                let (pixels, w) = (&src_row[span.start..][..span.n], &w[..span.n]);
                let ((pairs, last), (w_pairs, w_last)) =
                    (pixels.as_chunks::<2>(), w.as_chunks::<2>());
                let mut sum = I32::splat(ROUND);
                for (pair, &[w0, w1]) in pairs.iter().zip(w_pairs) {
                    let pair = U64::load(&[
                        u64::from_le_bytes(*pair.as_flattened().as_array().unwrap()),
                        0,
                    ]);
                    let weights = U32::splat(u32::from(w0 as u16) | u32::from(w1 as u16) << 16);
                    sum = sum
                        + pair
                            .cast::<u8>()
                            .lookup(by_channel)
                            .cast::<i16>()
                            .mul_add_pairs(weights.cast());
                }
                if let ([pixel], &[w]) = (last, w_last) {
                    sum = sum
                        + I32::load_bytes(pixel)
                            .cast::<i16>()
                            .mul_add_pairs(I16::splat(w));
                }
                *out = (sum >> SHIFT).clamped_to_bytes();
            }
        }
    }

    #[export]
    pub fn vertical(
        src: &[u8],
        row_bytes: usize,
        dst: &mut [u8],
        spans: &[Span],
        weights: &[i16],
        stride: usize,
    ) {
        for ((dst_row, span), w) in dst
            .chunks_exact_mut(row_bytes)
            .zip(spans)
            .zip(weights.chunks_exact(stride))
        {
            let window = &src[span.start * row_bytes..][..span.n * row_bytes];
            let (chunks, rest) = dst_row.as_chunks_mut();
            let mut x = 0;
            for out in chunks {
                let mut sum = I32::splat(ROUND);
                for (row, &w) in window.chunks_exact(row_bytes).zip(w) {
                    let bytes = row[x..x + I32::LANES].as_array().unwrap();
                    sum = sum
                        + I32::load_bytes(bytes)
                            .cast::<i16>()
                            .mul_add_pairs(I16::splat(w));
                }
                *out = (sum >> SHIFT).clamped_to_bytes();
                x += I32::LANES;
            }
            for out in rest {
                let acc = window
                    .chunks_exact(row_bytes)
                    .zip(w)
                    .fold(ROUND, |acc, (row, &w)| {
                        acc + i32::from(row[x]) * i32::from(w)
                    });
                *out = (acc >> SHIFT).clamp(0, 255) as u8;
                x += 1;
            }
        }
    }

    #[export]
    pub fn cmyk_to_rgba(mut pixels: &mut [[u8; 4]]) {
        if !isa::IS_X86 {
            let blocks;
            (blocks, pixels) = pixels.as_chunks_mut();
            for block in blocks {
                let [c, m, y, k] = U8::load_interleaved4(block);
                let times_256_255ths = |t: U16| (t + 128 + ((t + 128) >> 8)).cast::<u8>();
                let times_k = |v: U8| {
                    let (low, high) = v.widening_mul(k);
                    times_256_255ths(low).deinterleave(times_256_255ths(high)).1
                };
                U8::store_interleaved4(
                    [times_k(c), times_k(m), times_k(y), U8::splat(0xFF)],
                    block,
                );
            }
        }
        isa::map_in_place(pixels.as_flattened_mut(), |v| {
            let k = v.cast::<u32>() >> 24;
            let k: U16 = (k | k << 16).cast();
            let times_k = |v: U16| {
                let t = v * k + 128;
                (t + (t >> 8)) >> 8
            };
            let v: U16 = v.cast();
            ((times_k(v & 0xFF) | times_k(v >> 8) << 8).cast::<u32>() | 0xFF00_0000).cast()
        });
    }

    #[export(long_running)]
    pub fn modulate(pixels: &mut [[u8; 4]], brightness: f32, saturation: f32) {
        isa::map_in_place(pixels.as_flattened_mut(), |v| {
            let v: U32 = v.cast();
            let channel = |at: u32| F32::from_i32((v >> at & 0xFF).cast());
            let (r, g, b) = (channel(0), channel(8), channel(16));
            let y = r.mul_add(
                F32::splat(0.299),
                g.mul_add(F32::splat(0.587), b * F32::splat(0.114)),
            );
            let modulated = |c: F32, at: u32| {
                let c = (c - y).mul_add(F32::splat(saturation), y) * F32::splat(brightness);
                (c + F32::splat(0.5))
                    .clamp(0.0, 255.0)
                    .to_i32()
                    .cast::<u32>()
                    << at
            };
            (modulated(r, 0) | modulated(g, 8) | (modulated(b, 16) | v & 0xFF00_0000)).cast()
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
            n,
        };
    }
}

#[derive(Default)]
struct Axis {
    spans: Vec<Span>,
    weights: Vec<i16>,
    stride: usize,
}

impl Axis {
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
    between: Vec<[u8; 4]>,
}

impl Resizer {
    /// Neither image is empty.
    pub fn lanczos3(&mut self, src: &[[u8; 4]], src_w: usize, dst: &mut [[u8; 4]], dst_w: usize) {
        let Self { x, y, between } = self;
        let src_h = src.len() / src_w;
        x.set(src_w, dst_w);
        y.set(src_h, dst.len() / dst_w);
        between.resize(dst_w * src_h, [0; 4]);
        simd::horizontal(src, src_w, between, dst_w, &x.spans, &x.weights, x.stride);
        let (between, dst) = (between.as_flattened(), dst.as_flattened_mut());
        simd::vertical(between, 4 * dst_w, dst, &y.spans, &y.weights, y.stride);
    }
}
