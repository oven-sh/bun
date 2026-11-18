//! The color conversions of JPEG, in the arithmetic of libjpeg-turbo (LICENSE.md).
use bun_simd::{Isa, Out, Shuffle, opaque};
use core::array::from_fn;

pub use simd::rgba_to_ycc420;

type Rgba = [u8; 4];

/// The kernels read and write whole groups of this many pixels.
pub const PIXEL_GROUP: usize = 32;

/// The Cb and Cr of a row of pixels.
#[derive(Clone, Copy)]
pub enum Chroma<'a> {
    Full {
        cb: &'a [u8],
        cr: &'a [u8],
    },
    /// One sample for two pixels. A row has one more sample before them, and room for 3 after them.
    HalfWidth {
        cb: &'a [u8],
        cr: &'a [u8],
    },
    /// One sample for 2 by 2 pixels: the nearest such row, then the next nearest.
    HalfSize {
        cb: [&'a [u8]; 2],
        cr: [&'a [u8]; 2],
    },
}

// Scaled by 2^14 and by 2^15. They give the results of jdcolor.c for all samples.
const CR_IN_RED: i16 = 22971;
const CB_IN_BLUE: i16 = 29033;
const CB_IN_GREEN: i16 = -11277;
const CR_IN_GREEN: i16 = -23401;

// Scaled by 2^16 (jccolor.c).
const RED_IN_LUMA: i16 = 19595;
const BLUE_IN_LUMA: i16 = 7471;
const LUMA_BIAS: i32 = 32768;
const CHROMA_BIAS: i32 = (128 << 16) + 32767;

/// The lanes at `i` in each group of four come together.
struct Transposed;

impl<const N: usize> Shuffle<N> for Transposed {
    const FROM: [usize; N] = from_fn(const |i| i % (N / 4) * 4 + i / (N / 4));
}

#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
mod simd {
    use isa::{Vector, x128, x256};

    const HAS_PLANES: bool = isa::Isa::HAS_INTERLEAVED_MEMORY;

    /// From the sample before a group to the third one after it.
    type Around = [u8; PIXEL_GROUP / 2 + 4];
    type Ycc<const N: usize, const HALF: usize> = ([Vector<u8, N>; 2], [Vector<u8, HALF>; 2]);

    /// For x86-64. Cb and Cr less 128 come as the first 8 of each 16 pixels, then the others.
    mod pixels {
        use super::*;
        use isa::{I8, I16, I32, U8, U32, U64};
        const N: usize = U8::LEN;
        const _: () = assert!(N <= PIXEL_GROUP);

        #[inline(always)]
        fn widen(bytes: &[u8; 32], part: usize) -> [I16; 2] {
            let (lower, upper) = U8::from_slice(&bytes[N * part..]).interleave_in_blocks(0.into());
            [lower.bitcast(), upper.bitcast()]
        }

        /// For each sample: `weight * (3 * sample + before)`, then `weight * (3 * sample + after)`.
        #[inline(always)]
        fn blend(row: &Around, part: usize, weight: i8) -> [I16; 2] {
            const NEIGHBORS: [u8; 32] =
                from_fn(const |i| (i / 16 * 8 + i % 16 / 4 + [0, 1, 1, 2][i % 4]) as u8);
            // LLVM would see which bytes each block needs, and shuffle twice.
            let hidden = if N > 16 { opaque(0) as u8 } else { 0 };
            let order = U8::from_slice(&NEIGHBORS[N * part..]) + hidden;
            let weights = I8::repeat([weight, 3 * weight, 3 * weight, weight]);
            let from = |at: usize| U8::repeat::<16>(*row[at..].first_chunk().unwrap());
            [0, 4].map(|at| I16::saturating_pairwise_dot(from(at).lookup(order), weights))
        }

        #[inline(always)]
        pub fn center(samples: &[u8; 32], part: usize) -> [I16; 2] {
            widen(samples, part).map(|it| it - 128)
        }

        #[inline(always)]
        pub fn upsample(row: &Around, part: usize) -> [I16; 2] {
            let bias = I16::repeat([1 - (128 << 2), 2 - (128 << 2)]);
            blend(row, part, 1).map(|sums| (sums + bias) >> 2)
        }

        #[inline(always)]
        pub fn upsample_between([near, far]: [&Around; 2], part: usize) -> [I16; 2] {
            let bias = I16::repeat([8 - (128 << 4), 7 - (128 << 4)]);
            let (near, far) = (blend(near, part, 3), blend(far, part, 1));
            from_fn(|i| (near[i] + far[i] + bias) >> 4)
        }

        #[inline(always)]
        pub fn rgba(luma: &[u8; 32], chroma: impl Fn(usize) -> [[I16; 2]; 2]) -> [Rgba; 32] {
            let chroma: [_; 32 / N] = from_fn(chroma);
            let mut all = [[[0; 4]; N]; 32 / N];
            #[rustc_unroll(full)]
            for part in 0..32 / N {
                let (y, [cb, cr]) = (widen(luma, part), chroma[part]);
                let green = |i: usize| {
                    let weights = I16::repeat([CB_IN_GREEN, CR_IN_GREEN]);
                    let sums = |both| (I32::pairwise_dot(both, weights) + (1 << 14)) >> 15;
                    let (lower, upper) = cb[i].interleave_in_blocks(cr[i]);
                    I16::pack(sums(lower), sums(upper))
                };
                let times = |it: I16, by: i16| it + it.mul_q15((2 * (by - (1 << 14))).into());
                let plus_luma = |[lower, upper]: [I16; 2]| U8::pack(y[0] + lower, y[1] + upper);
                let r = plus_luma(cr.map(|cr| times(cr, CR_IN_RED)));
                let g = plus_luma([green(0), green(1)]);
                let b = plus_luma(cb.map(|cb| times(cb, CB_IN_BLUE)));
                all[part] = U8::to_interleaved4([r, g, b, U8::splat(255)]);
            }
            *all.as_flattened().as_array().unwrap()
        }

        /// The luma of two rows, and the Cb and the Cr of each 2 by 2 pixels.
        #[inline(always)]
        pub fn split(rows: [&[Rgba; N]; 2]) -> Ycc<N, { N / 2 }> {
            const GREENS: [u8; 16] = from_fn(const |i| [i as u8 / 4 * 4 + 1, 0x80][i % 2]);
            const BY_PLANE: [u8; 16] = from_fn(const |i| (i % 8 * 2 + i / 8) as u8);
            let in_order = |v: U8| v.bitcast::<U32>().shuffle::<Transposed>(0.into()).bitcast();
            let (mut luma, mut chroma) = ([U8::zero(); 2], [I16::zero(); 4]);
            #[rustc_unroll(full)]
            for y in 0..2 {
                let mut sums = [I32::zero(); 4];
                #[rustc_unroll(full)]
                for i in 0..4 {
                    let pixels = U8::load(&rows[y].as_flattened().as_chunks().0[i]);
                    let rb = pixels.bitcast::<I16>() & 0xFF;
                    let gg = pixels.lookup(U8::repeat(GREENS)).bitcast();
                    let sum = |[r, b, g, more_g]: [i16; 4]| {
                        I32::pairwise_dot(rb, I16::repeat([r, b]))
                            + I32::pairwise_dot(gg, I16::repeat([g, more_g]))
                    };
                    // 38470 and 32768 do not fit: one is split in halves, the other negated.
                    sums[i] = (sum([RED_IN_LUMA, BLUE_IN_LUMA, 19235, 19235]) + LUMA_BIAS) >> 16;
                    let cb = I32::splat(CHROMA_BIAS) - sum([11059, -32768, 21709, 0]);
                    let cr = I32::splat(CHROMA_BIAS) - sum([-32768, 5329, 27439, 0]);
                    let both = cb.bitcast::<U32>() >> 16 | cr.bitcast::<U32>() & !0xFFFF;
                    chroma[i] += both.bitcast::<I16>();
                }
                let [a, b, c, d] = sums;
                luma[y] = in_order(U8::pack(I16::pack(a, b), I16::pack(c, d)));
            }
            let average = |a: I16, b: I16| {
                let (left, right) = a.bitcast::<U32>().deinterleave_in_blocks(b.bitcast());
                ((left + right).bitcast::<I16>() + I16::repeat([1, 1, 2, 2])) >> 2
            };
            let both = U8::pack(average(chroma[0], chroma[1]), average(chroma[2], chroma[3]));
            let both: U64 = in_order(both).lookup(U8::repeat(BY_PLANE)).bitcast();
            let (cb, cr) = both.deinterleave(both);
            let both = U64::from_halves([cb.halves()[0], cr.halves()[0]]);
            (luma, both.bitcast::<U8>().halves())
        }
    }

    /// The same for NEON, which widens and narrows on the way.
    mod planes {
        use super::*;
        use x128::{I16, U8, U16};

        #[inline(always)]
        pub fn center(samples: &[u8; 32]) -> [U8; 2] {
            (x256::U8::load(samples) ^ 128).halves()
        }

        #[inline(always)]
        pub fn upsample(row: &Around) -> [U8; 2] {
            let average_down = |a: U8, b| (a & b) + ((a ^ b) >> 1);
            let [before, sample, after] = [0, 1, 2].map(|at| U8::from_slice(&row[at..]));
            let even = average_down(sample, sample.average_round(before)) ^ 128;
            let odd = sample.average_round(average_down(sample, after)) ^ 128;
            even.interleave(odd).into()
        }

        /// Scaled by 16, so that the result is the high byte of each sum.
        #[inline(always)]
        pub fn upsample_between([near, far]: [&Around; 2]) -> [U8; 2] {
            use x256::U16;
            // LLVM would add the products up first.
            let opaque = |v: U16| U16::from_halves(v.halves().map(|it| it.opaque()));
            let add = |at: usize, weight: u8, sums: U16| {
                let times = |row: &Around, by| {
                    U8::from_slice(&row[at..]).cast() * U8::splat(by).opaque().cast()
                };
                opaque(sums + times(near, 3 * weight)) + times(far, weight)
            };
            let middle = add(1, 3 << 4, U16::splat((7 << 4) + (128 << 8)));
            let even = add(0, 1 << 4, opaque(middle + (1 << 4)));
            let odd = add(2, 1 << 4, middle);
            (even >> 8 | odd & 0xFF00).bitcast::<x256::U8>().halves()
        }

        #[inline(always)]
        pub fn rgba(luma: &[u8; 32], cb: [U8; 2], cr: [U8; 2]) -> [Rgba; 32] {
            let mut all = [[[0; 4]; 16]; 2];
            #[rustc_unroll(full)]
            for part in 0..2 {
                let y = U8::from_slice(&luma[16 * part..])
                    .halves()
                    .map(|it| it.cast());
                let double = |it: Vector<u8, 8>| it.cast::<i8>().cast() << 1;
                let [cb, cr]: [[I16; 2]; 2] = [cb, cr].map(|it| it[part].halves().map(double));
                let green = |i: usize| {
                    let sums = cb[i].widening_mul(CB_IN_GREEN.into())
                        + cr[i].widening_mul(CR_IN_GREEN.into());
                    ((sums + (1 << 15)) >> 16).cast()
                };
                let plus_luma = |[lower, upper]: [I16; 2]| U8::pack(lower + y[0], upper + y[1]);
                let r = plus_luma(cr.map(|cr| cr.mul_q15(CR_IN_RED.into())));
                let g = plus_luma([green(0), green(1)]);
                let b = plus_luma(cb.map(|cb| cb.mul_q15(CB_IN_BLUE.into())));
                all[part] = U8::to_interleaved4([r, g, b, U8::splat(255)]);
            }
            *all.as_flattened().as_array().unwrap()
        }

        /// Y less G, Cb and Cr. The weights add up to 1 or to 0, so two differences are enough.
        #[inline(always)]
        fn from_differences([r, g, b]: [Vector<u8, 8>; 3]) -> [Vector<u8, 8>; 3] {
            let [less_r, less_b] = [r, b].map(|it| (g.cast::<i16>() - it.cast()) << 7);
            let y = less_r.widening_mul((-RED_IN_LUMA).into())
                + less_b.widening_mul((-BLUE_IN_LUMA).into());
            let [a, b] = y.halves().map(|it| it.bitcast::<U16>());
            // With these weights, the rounding multiplication gives the truncated product.
            let difference = |halved: I16, other: I16, weight: i16| {
                let sum = halved + (other.mul_q15(weight.into()) >> 1);
                ((U16::splat((CHROMA_BIAS >> 8) as u16) - sum.bitcast::<U16>()) >> 8).cast()
            };
            [
                ((a.deinterleave(b).1 + (LUMA_BIAS >> 9) as u16) >> 7).cast(),
                difference(less_b, less_r, -22116),
                difference(less_r, less_b, -10658),
            ]
        }

        #[inline(always)]
        pub fn split(rows: [&[Rgba; 16]; 2]) -> Ycc<16, 8> {
            let (mut luma, mut chroma) = ([U8::zero(); 2], [U16::zero(); 2]);
            #[rustc_unroll(full)]
            for y in 0..2 {
                let [r, g, b, _] = U8::load_interleaved4(rows[y]);
                let lower = from_differences([r, g, b].map(|it| it.halves()[0]));
                let upper = from_differences([r, g, b].map(|it| it.halves()[1]));
                let [y_less_g, cb, cr] = from_fn(|i| U8::from_halves([lower[i], upper[i]]));
                luma[y] = g + y_less_g;
                chroma[0] += U16::sums_of_2(cb);
                chroma[1] += U16::sums_of_2(cr);
            }
            (
                luma,
                chroma.map(|sums| ((sums + U16::repeat([1, 2])) >> 2).cast()),
            )
        }
    }

    /// `$rows` has what `$how` needs to make the Cb and the Cr of the group `$i`.
    macro_rules! convert {
        ($y:ident, $out:ident, $how:ident, |$i:ident| $rows:block) => {{
            let mut out = $out.into_writer();
            out.extend_with($y.as_chunks().0.iter().enumerate(), |($i, y)| {
                let [cb, cr] = $rows;
                Some(match HAS_PLANES {
                    true => planes::rgba(y, planes::$how(cb), planes::$how(cr)),
                    false => pixels::rgba(y, |i| [cb, cr].map(|it| pixels::$how(it, i))),
                })
            });
            out.finish()
        }};
    }

    /// From this, LLVM sees that one check holds for all rows of the same length.
    #[inline(always)]
    fn around(row: &[u8], group: usize) -> Option<&Around> {
        let (at, last) = (
            PIXEL_GROUP / 2 * group,
            row.len().checked_sub(size_of::<Around>())?,
        );
        (at <= last).then(|| row[at..].first_chunk().unwrap())
    }

    #[export]
    pub fn ycc_to_rgba<'a>(y: &[u8], cb: &[u8], cr: &[u8], to: Out<'a, Rgba>) -> &'a mut [Rgba] {
        let (cb, cr) = (cb.as_chunks().0, cr.as_chunks().0);
        convert!(y, to, center, |i| { [cb.get(i)?, cr.get(i)?] })
    }

    #[export]
    pub fn ycc422_to_rgba<'a>(y: &[u8], cb: &[u8], cr: &[u8], to: Out<'a, Rgba>) -> &'a mut [Rgba] {
        let len = cb.len().min(cr.len());
        convert!(y, to, upsample, |i| {
            [around(&cb[..len], i)?, around(&cr[..len], i)?]
        })
    }

    #[export]
    pub fn ycc420_to_rgba<'a>(
        y: &[u8],
        chroma: &[[&[u8]; 2]; 2],
        to: Out<'a, Rgba>,
    ) -> &'a mut [Rgba] {
        let [[a, b], [c, d]] = *chroma;
        let len = a.len().min(b.len()).min(c.len().min(d.len()));
        convert!(y, to, upsample_between, |i| {
            let cb = [around(&a[..len], i)?, around(&b[..len], i)?];
            [cb, [around(&c[..len], i)?, around(&d[..len], i)?]]
        })
    }

    #[inline(always)]
    fn split_rows<const N: usize, const HALF: usize>(
        [upper, lower]: [&[Rgba]; 2],
        [to_upper, to_lower, cb, cr]: [&mut [u8]; 4],
        width: usize,
        split: impl Fn([&[Rgba; N]; 2]) -> Ycc<N, HALF>,
    ) -> Option<()> {
        let count = width / N;
        let upper = upper.as_chunks().0.get(..count)?;
        let lower = lower.as_chunks().0.get(..count)?;
        let to_upper = to_upper.as_chunks_mut().0.get_mut(..count)?;
        let to_lower = to_lower.as_chunks_mut().0.get_mut(..count)?;
        let cb = cb.as_chunks_mut().0.get_mut(..count)?;
        let cr = cr.as_chunks_mut().0.get_mut(..count)?;
        #[rustc_unroll(never)]
        for x in 0..count {
            let (luma, chroma) = split([&upper[x], &lower[x]]);
            [to_upper[x], to_lower[x]] = luma.map(Vector::to_array);
            [cb[x], cr[x]] = chroma.map(Vector::to_array);
        }
        Some(())
    }

    /// For whole groups, until a row does not fit. Those of `y` are twice `chroma_stride` apart.
    #[export]
    #[must_use]
    pub fn rgba_to_ycc420(
        rgba: &[Rgba],
        rgba_stride: usize,
        width: usize,
        row_pairs: usize,
        planes: [&mut [u8]; 3],
        chroma_stride: usize,
    ) -> Option<()> {
        let ([mut y, mut cb, mut cr], mut rgba) = (planes, rgba);
        let (from, to) = (rgba_stride, chroma_stride);
        if !width.is_multiple_of(PIXEL_GROUP) {
            return None;
        }
        for left in (0..row_pairs).rev() {
            let rows = [rgba, rgba.get(from..)?];
            let (upper, lower) = y.split_at_mut_checked(to.checked_mul(2)?)?;
            let out = [upper, &mut *lower, &mut *cb, &mut *cr];
            match HAS_PLANES {
                true => split_rows(rows, out, width, |it| planes::split(it)),
                false => split_rows(rows, out, width, |it| pixels::split(it)),
            }?;
            if left == 0 {
                break;
            }
            (rgba, y) = (rows[1].get(from..)?, lower.get_mut(2 * to..)?);
            (cb, cr) = (cb.get_mut(to..)?, cr.get_mut(to..)?);
        }
        Some(())
    }
}

/// Appends `width` pixels to `out`, if its spare capacity and all rows cover whole groups.
#[inline(always)]
#[must_use]
pub fn ycc_to_rgba(y: &[u8], chroma: Chroma<'_>, width: usize, out: &mut Vec<Rgba>) -> Option<()> {
    let (room, rest) = bun_simd::spare_capacity(out);
    let room = room.take(width.checked_next_multiple_of(PIXEL_GROUP)?);
    let filled = match chroma {
        Chroma::Full { cb, cr } => simd::ycc_to_rgba(y, cb, cr, room),
        Chroma::HalfWidth { cb, cr } => simd::ycc422_to_rgba(y, cb, cr, room),
        Chroma::HalfSize { cb, cr } => simd::ycc420_to_rgba(y, &[cb, cr], room),
    };
    rest.append(filled.get_mut(..width)?);
    Some(())
}
