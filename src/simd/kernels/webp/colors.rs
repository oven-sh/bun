use super::Rgba;
use bun_simd::Out;
use core::array::from_fn;

pub use simd::upsample;

/// The most samples that `upsample` and `yuv_to_rgba` take at once.
pub const ROW_STEP: usize = 32;

#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
mod simd {
    use isa::{I16, U8};
    const N: usize = U8::LEN;
    const _: () = assert!(N <= ROW_STEP);

    /// From two rows to both halves of `to`: two samples for each of `count` pairs, in whole steps.
    #[export]
    #[must_use]
    pub fn upsample(from: &[u8], distance: usize, to: &mut [u8], count: usize) -> Option<()> {
        let len = count.checked_add(ROW_STEP - 1)? / ROW_STEP * ROW_STEP;
        // Unlike `div_ceil`, LLVM takes it for `len / N` if it is.
        let steps = count.wrapping_add(N - 1) / N;
        let lower = from.get(distance..)?.get(..len + 1)?;
        let upper = &from[..len + 1];
        let upper = upper[..len]
            .as_chunks()
            .0
            .iter()
            .zip(upper[1..].as_chunks().0);
        let lower = lower[..len]
            .as_chunks()
            .0
            .iter()
            .zip(lower[1..].as_chunks().0);
        let (to_upper, to_lower) = to.split_at_mut(to.len() / 2);
        let to_upper = to_upper.as_chunks_mut().0.get_mut(..len)?.as_chunks_mut().0;
        let to_lower = to_lower.as_chunks_mut().0.get_mut(..len)?.as_chunks_mut().0;
        let to = to_upper.iter_mut().zip(to_lower);
        #[rustc_unroll(never)]
        for ((((a, b), (c, d)), to), _) in upper.zip(lower).zip(to).zip(0..steps) {
            let [a, b, c, d] = [U8::load(a), U8::load(b), U8::load(c), U8::load(d)];
            // 9, 3, 3 and 1 sixteenths of the four samples around a pixel, from averages of two bytes
            let (s, t) = (a.average_round(d), b.average_round(c));
            let (st, ad, bc) = (s ^ t, a ^ d, b ^ c);
            // `(a + b + c + d) / 4`, `(a + 3b + 3c + d) / 8` and `(3a + b + c + 3d) / 8`
            let k = s.average_round(t) - ((ad | bc | st) & 1);
            let rising = k.average_round(t) - ((k ^ t | bc & st) & 1);
            let falling = k.average_round(s) - ((k ^ s | ad & st) & 1);
            *to.0 = U8::to_interleaved2([a.average_round(rising), b.average_round(falling)]);
            *to.1 = U8::to_interleaved2([c.average_round(falling), d.average_round(rising)]);
        }
        Some(())
    }

    /// From samples less 128, times 256. libwebp rounds each `sample * factor / 256` down.
    #[inline(always)]
    fn to_rgb([y, u, v]: [I16; 3]) -> [I16; 3] {
        const RED: i16 = 19077 / 2 + 26149 / 2 - 14234;
        const GREEN: i16 = 19077 / 2 - 6419 / 2 - 13320 / 2 + 8708;
        const BLUE: i16 = 19077 / 2 + 16525 - 17685;
        // With an odd factor, the 128 leave a half, which rounding to nearest makes up for.
        let times_odd = |x: I16, factor: i16| (x >> 1).mul_q15(factor.into());
        let luma = times_odd(y, 19077) + RED;
        let from_green = times_odd(u, 6419) + v.mul_high(13320.into());
        let to_blue = u + u.mul_high((33050u16 as i16).into());
        [
            (luma + times_odd(v, 26149)) >> 6,
            (luma - (from_green + (RED - GREEN))) >> 6,
            luma.saturating_add(to_blue + (BLUE - RED)) >> 6,
        ]
    }

    #[inline(always)]
    fn to_rgba([y, u, v, alpha]: [&[u8; N]; 4]) -> [Rgba; N] {
        let widen = |samples| {
            let (lower, upper) = U8::zero().interleave_in_blocks(U8::load(samples) ^ 128);
            [lower.bitcast(), upper.bitcast()]
        };
        let [y, u, v] = [widen(y), widen(u), widen(v)];
        let (lower, upper) = (to_rgb([y[0], u[0], v[0]]), to_rgb([y[1], u[1], v[1]]));
        let [r, g, b] = from_fn(|i| U8::pack(lower[i], upper[i]));
        U8::to_interleaved4([r, g, b, U8::load(alpha)])
    }

    /// Finishes the last step if there is room for it.
    #[export]
    pub fn yuv_to_rgba<'a>(yuva: &[&[u8]; 4], to: Out<'a, Rgba>, width: usize) -> &'a mut [Rgba] {
        let [y, u, v, alpha] = yuva.map(|row| row.as_chunks().0);
        let len = y.len().min(u.len()).min(v.len().min(alpha.len()));
        if len / (ROW_STEP / N) < width.div_ceil(ROW_STEP) {
            return &mut [];
        }
        let group = |i: usize| (i < len).then(|| to_rgba([&y[i], &u[i], &v[i], &alpha[i]]));
        let mut out = to.take(width.saturating_add(N - 1) / N * N).into_writer();
        out.extend_with(0.., &group);
        if let rest @ 1..N = out.remaining()
            && let Some(last) = group(out.len() / N)
        {
            out.extend_from_slice(&last[..rest]);
        }
        out.finish()
    }
}

/// Puts `width` pixels at `start`, over those that are there and into the spare capacity.
#[inline(always)]
#[must_use]
pub fn yuv_to_rgba(
    yuva: [&[u8]; 4],
    rgba: &mut Vec<Rgba>,
    start: usize,
    width: usize,
) -> Option<()> {
    if let Some(old) = rgba.get_mut(start..)?.get_mut(..width) {
        return (simd::yuv_to_rgba(&yuva, old.into(), width).len() == width).then_some(());
    }
    rgba.truncate(start);
    let (room, rest) = bun_simd::spare_capacity(rgba);
    rest.append(simd::yuv_to_rgba(&yuva, room, width).get_mut(..width)?);
    Some(())
}
