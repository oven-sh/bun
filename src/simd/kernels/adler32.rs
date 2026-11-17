//! The Adler-32 of zlib, derived from libdeflate (LICENSE.md).
use crate::Byte;
use bun_simd::{Isa, SharedU8};
use core::array::from_fn;

const MODULUS: u32 = 65521;
/// The most bytes after which both sums fit in 32 bits. Lanes may wrap around before that.
const CHUNK: usize = 5552;
const _: () = assert!(255 * CHUNK * (CHUNK + 1) / 2 + (CHUNK + 1) * 65520 <= u32::MAX as usize);
/// Below it, neither sum reaches the modulus.
const SHORT: usize = 16;
const _: () = assert!(255 * SHORT * (SHORT + 1) / 2 + SHORT < MODULUS as usize);

#[inline]
pub fn adler32(bytes: &[u8]) -> u32 {
    update(bytes, dot_simd::update)
}

#[inline]
pub fn adler32_shared(bytes: &[SharedU8]) -> u32 {
    update(bytes, dot_simd::update_shared)
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

/// How often each byte of a row counts in the upper half of the checksum, less `bias`.
const fn weights<const N: usize>(bias: usize) -> [[i8; N]; 4] {
    from_fn(const |i| from_fn(const |j| ((4 - i) * N - j).wrapping_sub(bias) as i8))
}

/// `sums` adds the bytes up, and the same with weights as if zeros filled the last row.
#[inline(always)]
fn by_chunks<B>(
    adler: u32,
    bytes: &[B],
    [row, bias]: [usize; 2],
    sums: impl Fn(&[B]) -> [i32; 2],
) -> u32 {
    let (mut low, mut high) = (adler & 0xFFFF, adler >> 16);
    for chunk in bytes.chunks(CHUNK / row * row) {
        let [plain, weighted] = sums(chunk).map(i32::cast_unsigned);
        let missing = bias.wrapping_sub(chunk.len().wrapping_neg() % row) as u32;
        let added = weighted.wrapping_add(missing.wrapping_mul(plain));
        high = (high + chunk.len() as u32 * low + added) % MODULUS;
        low = (low + plain) % MODULUS;
    }
    high << 16 | low
}

#[bun_simd::foreach_target(avx512_icl, neon + "dotprod", portable)]
mod dot_simd {
    use isa::{I8, I32, U8};

    const ROW: usize = 4 * U8::LEN;
    const BIAS: usize = ROW.saturating_sub(127);

    /// The second sum is that of what the first one was before each row.
    #[inline(always)]
    fn add_row(row: &[U8; 4], [plain, earlier]: &mut [I32; 2], weighted: &mut [I32; 4]) {
        let mut sum = I32::zero();
        for ((&bytes, weights), weighted) in row.iter().zip(const { weights(BIAS) }).zip(weighted) {
            sum = sum.add_dot(bytes, I8::splat(1));
            *weighted = weighted.add_dot(bytes, I8::from_array(weights));
        }
        *earlier += *plain;
        *plain += sum;
    }

    #[inline(always)]
    fn sums(chunk: &[impl Byte]) -> [i32; 2] {
        let rows = chunk.as_chunks().0.as_chunks().0;
        let rest = &chunk[chunk.len() / ROW * ROW..];
        // Independent sums hide the latency of the instruction.
        let (mut sums, mut weighted) = ([I32::zero(); 2], [I32::zero(); 4]);
        for row in rows {
            add_row(&U8::load4(row), &mut sums, &mut weighted);
        }
        if !rest.is_empty() {
            add_row(&U8::load_or_zero(rest), &mut sums, &mut weighted);
        }
        let ([plain, earlier], [a, b, c, d]) = (sums, weighted);
        [plain, a + b + (c + d) + (earlier << ROW.ilog2())].map(I32::reduce_sum)
    }

    #[export(or = simd::update)]
    pub fn update(adler: u32, bytes: &[u8]) -> u32 {
        by_chunks(adler, bytes, [ROW, BIAS], |chunk| sums(chunk))
    }

    #[export(or = simd::update_shared)]
    pub fn update_shared(adler: u32, bytes: &[SharedU8]) -> u32 {
        by_chunks(adler, bytes, [ROW, BIAS], |chunk| sums(chunk))
    }
}

#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
mod simd {
    use isa::{I8, I16, I32, U8, U16, U64};

    const ROW: usize = 4 * U8::LEN;
    /// Otherwise, it is faster to add the rows up and to multiply once.
    const MULTIPLIES_ROWS: bool = isa::Isa::HAS_PAIRWISE_DOT && 255 * ROW <= i16::MAX as usize;
    const BIAS: usize = ROW / 2 + 1;
    const _: () = assert!(255 * (CHUNK / ROW) <= i16::MAX as usize);

    #[inline(always)]
    fn add_row(row: &[U8; 4], [plain, earlier, weighted]: &mut [I32; 3], columns: &mut [U16; 8]) {
        *earlier += *plain;
        if MULTIPLIES_ROWS {
            let [a, b, c, d] = row.map(|bytes| U64::sums_of_8(bytes));
            *plain += (a + b + (c + d)).bitcast::<I32>();
            let weights = const { weights(BIAS) }.map(I8::from_array);
            let [a, b, c, d] = from_fn(|i| I16::saturating_pairwise_dot(row[i], weights[i]));
            // Their weights have opposite signs, so these sums fit too.
            *weighted += I32::pairwise_dot(a + d, I16::splat(1));
            *weighted += I32::pairwise_dot(b + c, I16::splat(1));
        } else {
            let [a, b, c, d] = row.map(|bytes| U16::sums_of_2(bytes));
            let pairs: I32 = (a + b + c + d).bitcast();
            *plain += (pairs & 0xFFFF) + (pairs >> 16);
            for (bytes, [lower, upper]) in row.iter().zip(columns.as_chunks_mut().0) {
                let [first, second] = bytes.halves();
                (*lower, *upper) = (*lower + first.cast(), *upper + second.cast());
            }
        }
    }

    #[inline(always)]
    fn sums(chunk: &[impl Byte]) -> [i32; 2] {
        let rows = chunk.as_chunks().0.as_chunks().0;
        let rest = &chunk[chunk.len() / ROW * ROW..];
        let (mut sums, mut columns) = ([I32::zero(); 3], [U16::zero(); 8]);
        for row in rows {
            add_row(&U8::load4(row), &mut sums, &mut columns);
        }
        if !rest.is_empty() {
            add_row(&U8::load_or_zero(rest), &mut sums, &mut columns);
        }
        let [plain, earlier, mut weighted] = sums;
        if !MULTIPLIES_ROWS {
            for (i, column) in columns.into_iter().enumerate() {
                let weights = I16::splat((ROW - BIAS) as i16) - (i * I16::LEN) as i16 - I16::iota();
                for (sums, weights) in column.halves().into_iter().zip(weights.halves()) {
                    weighted += sums.cast::<i16>().cast::<i32>() * weights.cast();
                }
            }
        }
        [plain, weighted + (earlier << ROW.ilog2())].map(I32::reduce_sum)
    }

    #[export]
    pub fn update(adler: u32, bytes: &[u8]) -> u32 {
        by_chunks(adler, bytes, [ROW, BIAS], |chunk| sums(chunk))
    }

    #[export]
    pub fn update_shared(adler: u32, bytes: &[SharedU8]) -> u32 {
        by_chunks(adler, bytes, [ROW, BIAS], |chunk| sums(chunk))
    }
}
