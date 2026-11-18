//! The Adler-32 of zlib, derived from libdeflate (LICENSE.md).
use crate::{Aligned, Byte};
use bun_simd::{Isa, SharedU8};
use core::array::from_fn;

const MODULUS: u32 = 65521;
/// The most bytes after which both sums fit in 32 bits. Lanes may wrap around before that.
const CHUNK: usize = 5552;
const _: () = {
    let n = CHUNK as u64;
    assert!(255 * n * (n + 1) / 2 + (n + 1) * 65520 < 1 << 32);
};
/// Below it, neither sum reaches the modulus.
const SHORT: usize = 16;
const _: () = assert!(255 * SHORT * (SHORT + 1) / 2 + SHORT < MODULUS as usize);

#[inline]
pub fn adler32(bytes: &[u8]) -> u32 {
    update(bytes, simd::update)
}

#[inline]
pub fn adler32_shared(bytes: &[SharedU8]) -> u32 {
    update(bytes, simd::update_shared)
}

#[inline(always)]
fn update<B: Byte>(bytes: &[B], kernel: impl Fn(u32, &[B]) -> u32) -> u32 {
    if bytes.len() >= SHORT {
        return crate::in_aligned_parts(1, bytes, kernel);
    }
    let (mut low, mut high) = (1, 0);
    for byte in bytes {
        low += u32::from(byte.get());
        high += low;
    }
    high << 16 | low
}

/// `sums` adds the bytes up: once each, and as often as they count in the upper half.
#[inline(always)]
fn by_chunks<B>(adler: u32, bytes: &[B], row: usize, sums: impl Fn(&[B]) -> [i32; 2]) -> u32 {
    let (mut low, mut high) = (adler & 0xFFFF, adler >> 16);
    for chunk in bytes.chunks(CHUNK / row * row) {
        let [plain, weighted] = sums(chunk).map(i32::cast_unsigned);
        high = (high + chunk.len() as u32 * low + weighted) % MODULUS;
        low = (low + plain) % MODULUS;
    }
    high << 16 | low
}

#[bun_simd::foreach_target(avx512_icl, avx2, sse4, neon + "dotprod", portable)]
mod simd {
    use isa::{I8, I16, I32, U8, U64};

    const ROW: usize = 4 * U8::LEN;
    const BIAS: usize = if isa::Isa::HAS_PAIRWISE_DOT {
        ROW / 2 + 1
    } else {
        0
    };
    /// The other targets have dot products.
    const ADDS_PAIRS: bool = isa::Isa::HAS_PAIRWISE_DOT && 255 * ROW <= i16::MAX as usize;

    /// How often each byte of a row counts in the upper half, less `BIAS`.
    const WEIGHTS: &Aligned<[i8; ROW + U8::LEN]> = &Aligned(from_fn(const |i| {
        (ROW as isize - BIAS as isize - i as isize) as i8 & -((i < ROW) as i8)
    }));
    const _: () = assert!(ROW - BIAS < 128 && BIAS < 130);

    #[inline(always)]
    fn add_vector(bytes: U8, weights: I8, plain: &mut I32, weighted: &mut I32) {
        if ADDS_PAIRS {
            *plain += U64::sums_of_8(bytes).bitcast::<I32>();
            let pairs = I16::saturating_pairwise_dot(bytes, weights);
            *weighted += I32::pairwise_dot(pairs, I16::splat(1));
        } else {
            *plain = plain.add_dot(bytes, I8::splat(1));
            *weighted = weighted.add_dot(bytes, weights);
        }
    }

    /// Independent sums hide the latency of dot products.
    #[inline(always)]
    fn add_row(row: &[U8; 4], plain: &mut I32, weighted: &mut [I32; 4]) {
        let weights = [0, 1, 2, 3].map(|i| I8::from_slice(&WEIGHTS.0[i * U8::LEN..]));
        if ADDS_PAIRS {
            let [a, b, c, d] = row.map(|bytes| U64::sums_of_8(bytes));
            *plain += (a + b + (c + d)).bitcast::<I32>();
            let [a, b, c, d] = from_fn(|i| I16::saturating_pairwise_dot(row[i], weights[i]));
            // Their weights have opposite signs, so these sums fit too.
            weighted[0] += I32::pairwise_dot(a + d, I16::splat(1));
            weighted[0] += I32::pairwise_dot(b + c, I16::splat(1));
        } else {
            let mut sum = I32::zero();
            for (i, weighted) in weighted.iter_mut().enumerate() {
                add_vector(row[i], weights[i], &mut sum, weighted);
            }
            *plain += sum;
        }
    }

    #[inline(always)]
    fn sums(chunk: &[impl Byte]) -> [i32; 2] {
        let (mut plain, mut earlier, mut weighted) = (I32::zero(), I32::zero(), [I32::zero(); 4]);
        // What is not a whole vector or row comes first, so that a load can reach past it.
        let (first, rows) = chunk.split_at(chunk.len() % ROW);
        let (part, vectors) = first.as_rchunks();
        if !part.is_empty() {
            let bytes = match chunk.first_chunk() {
                Some(it) => U8::load(it) & U8::iota().simd_lt(part.len() as u8).to_vector(),
                None => U8::load_or_zero::<_, 1>(part)[0],
            };
            let weights = I8::from_slice(&WEIGHTS.0[ROW - first.len()..]);
            add_vector(bytes, weights, &mut plain, &mut weighted[0]);
        }
        let weights = WEIGHTS.0[ROW - vectors.len() * U8::LEN..].as_chunks().0;
        #[rustc_unroll(never)]
        for (bytes, weights) in vectors.iter().zip(weights) {
            let (bytes, weights) = (U8::load(bytes), I8::load(weights));
            add_vector(bytes, weights, &mut plain, &mut weighted[0]);
        }
        for row in rows.as_chunks().0.as_chunks().0 {
            earlier += plain;
            add_row(&U8::load4(row), &mut plain, &mut weighted);
        }
        let [a, b, c, d] = weighted;
        let [plain, biased] =
            [plain, a + b + (c + d) + (earlier << ROW.ilog2())].map(I32::reduce_sum);
        [plain, biased.wrapping_add(BIAS as i32 * plain)]
    }

    #[export(or = column_simd::update)]
    pub fn update(adler: u32, bytes: &[u8]) -> u32 {
        by_chunks(adler, bytes, ROW, |chunk| sums(chunk))
    }

    #[export(or = column_simd::update_shared)]
    pub fn update_shared(adler: u32, bytes: &[SharedU8]) -> u32 {
        by_chunks(adler, bytes, ROW, |chunk| sums(chunk))
    }
}

/// Without dot products, it is faster to add the rows up and to multiply once.
#[bun_simd::foreach_target(neon, portable)]
mod column_simd {
    use isa::{I16, I32, U8, U16};

    const ROW: usize = 4 * U8::LEN;
    const _: () = assert!(255 * (CHUNK / ROW) <= i16::MAX as usize);

    #[inline(always)]
    fn add_row(row: &[U8; 4], [plain, earlier]: &mut [I32; 2], columns: &mut [U16; 8]) {
        *earlier += *plain;
        let [a, b, c, d] = row.map(|bytes| U16::sums_of_2(bytes));
        let pairs: I32 = (a + b + c + d).bitcast();
        *plain += (pairs & 0xFFFF) + (pairs >> 16);
        for (bytes, [lower, upper]) in row.iter().zip(columns.as_chunks_mut().0) {
            let [first, second] = bytes.halves();
            (*lower, *upper) = (*lower + first.cast(), *upper + second.cast());
        }
    }

    #[inline(always)]
    fn sums(chunk: &[impl Byte]) -> [i32; 2] {
        let rows = chunk.as_chunks().0.as_chunks().0;
        let rest = &chunk[chunk.len() / ROW * ROW..];
        let (mut sums, mut columns) = ([I32::zero(); 2], [U16::zero(); 8]);
        for row in rows {
            add_row(&U8::load4(row), &mut sums, &mut columns);
        }
        if !rest.is_empty() {
            add_row(&U8::load_or_zero(rest), &mut sums, &mut columns);
        }
        let mut weighted = sums[1] << ROW.ilog2();
        for (i, column) in columns.into_iter().enumerate() {
            let weights = I16::splat((ROW - i * I16::LEN) as i16) - I16::iota();
            for (sums, weights) in column.halves().into_iter().zip(weights.halves()) {
                weighted += sums.cast::<i16>().cast::<i32>() * weights.cast();
            }
        }
        let [plain, padded] = [sums[0], weighted].map(I32::reduce_sum);
        let zeros = chunk.len().wrapping_neg() % ROW;
        [plain, padded.wrapping_sub(zeros as i32 * plain)]
    }

    #[export]
    pub fn update(adler: u32, bytes: &[u8]) -> u32 {
        by_chunks(adler, bytes, ROW, |chunk| sums(chunk))
    }

    #[export]
    pub fn update_shared(adler: u32, bytes: &[SharedU8]) -> u32 {
        by_chunks(adler, bytes, ROW, |chunk| sums(chunk))
    }
}
