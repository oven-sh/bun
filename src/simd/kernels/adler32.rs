//! The Adler-32 of zlib, derived from libdeflate (LICENSE.md).
use crate::{Byte, Copies, aligned, copy_then, unaligned_len};
use bun_simd::{Isa, Out, SharedU8};

const MODULUS: u32 = 65521;
/// The most bytes after which both sums fit in 32 bits. Lanes may wrap around before that.
const CHUNK: usize = 5552;
const _: () = {
    let n = CHUNK as u64;
    assert!(255 * n * (n + 1) / 2 + (n + 1) * 65535 < 1 << 32);
};
const SHORT: usize = 16;
/// The most bytes for one call of `simd`.
const PIECE: usize = 65536;

/// Continues `adler`, which is 1 for no bytes.
#[inline]
pub fn adler32(adler: u32, bytes: &[u8]) -> u32 {
    match bytes.len() {
        ..SHORT => by_bytes(adler, bytes),
        _ if unaligned_len(bytes) > 0 => aligned(adler, bytes, adler32),
        SHORT..=PIECE => simd::update(adler, bytes),
        _ => in_pieces(adler, bytes, adler32),
    }
}

#[inline]
pub fn adler32_shared(adler: u32, bytes: &[SharedU8]) -> u32 {
    match bytes.len() {
        ..SHORT => by_bytes(adler, bytes),
        _ if unaligned_len(bytes) > 0 => aligned(adler, bytes, adler32_shared),
        SHORT..=PIECE => simd::update_shared(adler, bytes),
        _ => in_pieces(adler, bytes, adler32_shared),
    }
}

/// Adds the copy to `adler`. Panics if it does not fit.
#[inline]
pub fn copy_and_adler32<'a>(adler: &mut u32, from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
    match from.len() {
        ..SHORT => copy_then(adler, from, to, by_bytes),
        SHORT..=PIECE => simd::copy_and_update(adler, from, to),
        _ => copy_in_pieces(adler, from, to),
    }
}

#[inline(always)]
fn reduced(high: u32, low: u32) -> u32 {
    ((high % MODULUS) << 16) | (low % MODULUS)
}

#[inline(always)]
fn by_bytes(adler: u32, bytes: &[impl Byte]) -> u32 {
    let (mut low, mut high) = (adler & 0xFFFF, adler >> 16);
    for byte in bytes {
        low += u32::from(byte.get());
        high += low;
    }
    reduced(high, low)
}

/// Their ends are aligned like that of `bytes`.
#[inline(never)]
fn in_pieces<B>(adler: u32, bytes: &[B], update: impl Fn(u32, &[B]) -> u32) -> u32 {
    bytes.rchunks(PIECE).rfold(adler, update)
}

#[inline(never)]
fn copy_in_pieces<'a>(adler: &mut u32, from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
    let mut to = to.into_writer();
    for piece in from.chunks(PIECE) {
        to.append(|to| copy_and_adler32(adler, piece, to));
    }
    to.finish()
}

#[bun_simd::foreach_target(avx512_icl, avx2, sse4, neon + "dotprod", portable)]
mod simd {
    #[bun_simd::foreach_width]
    mod width {
        use isa::{I8, I16, I32, U8, U64};

        /// The others have dot products.
        const ADDS_PAIRS: bool = HAS_PAIRWISE_DOT && U8::LEN < 64;
        const ROW: usize = if U8::LEN < 64 { 128 } else { 256 };
        const VECTORS: usize = ROW / U8::LEN;
        const BIAS: usize = if HAS_PAIRWISE_DOT { ROW / 2 + 1 } else { 1 };

        const _: () = {
            let rows = PIECE / ROW;
            assert!(ROW - BIAS < 128 && BIAS < 130);
            assert!(255 * ROW * rows * rows / 2 < 1 << 32);
            assert!(255 * ROW * (ROW + 1) / 2 * rows + 65535 < 1 << 32);
        };

        /// How often the bytes count in the upper half, less `BIAS`, from `left` before the end of a row.
        #[inline(always)]
        fn weights(left: usize) -> I8 {
            I8::splat(left.wrapping_sub(BIAS) as i8) - I8::iota()
        }

        #[inline(always)]
        fn once<C: Copies>(loaded: U8) -> U8 {
            if C::KEEPS { loaded.opaque() } else { loaded }
        }

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

        /// Returns its bytes. Independent sums hide the latency of dot products.
        #[inline(always)]
        fn add_row<C: Copies>(
            row: &[[impl Byte; U8::LEN]; VECTORS],
            plain: &mut I32,
            weighted: &mut [I32; VECTORS],
        ) -> [u8; ROW] {
            let (mut sum, mut pairs, mut bytes) = (I32::zero(), [I16::zero(); VECTORS], [0; ROW]);
            #[rustc_unroll(full)]
            for (i, to) in bytes.as_chunks_mut().0.iter_mut().enumerate() {
                let v = once::<C>(U8::load_at(row, i));
                let weights = weights(ROW - i * U8::LEN);
                v.store(to);
                if ADDS_PAIRS {
                    sum += U64::sums_of_8(v).bitcast::<I32>();
                    pairs[i] = I16::saturating_pairwise_dot(v, weights);
                } else {
                    add_vector(v, weights, &mut sum, &mut weighted[i]);
                }
            }
            if ADDS_PAIRS {
                // The weights of the halves have opposite signs, so these sums fit too.
                for (&first, &second) in pairs.iter().zip(&pairs[VECTORS / 2..]) {
                    weighted[0] += I32::pairwise_dot(first + second, I16::splat(1));
                }
            }
            *plain += sum;
            bytes
        }

        /// Panics if there is no whole vector.
        #[inline(always)]
        pub fn update<C: Copies>(adler: u32, bytes: &[impl Byte], copy: &mut C) -> u32 {
            debug_assert!(bytes.len() <= PIECE);
            let (first, low) = (bytes.first_chunk().unwrap(), adler & 0xFFFF);
            let mut high = u64::from(adler >> 16) + u64::from(low) * bytes.len() as u64;
            let (mut plain, mut weighted) = (I32::zero(), I32::zero());
            // What is not a whole vector or row comes first, so that a load can reach past it.
            let (start, rows) = bytes.split_at(bytes.len() % ROW);
            let (part, vectors) = start.as_rchunks();
            if let len @ 1.. = part.len() {
                let first = once::<C>(U8::load(first));
                copy.put(first.to_array(), len);
                let kept = U8::iota().simd_lt(len as u8).to_vector();
                // Arm takes none that are negative.
                let weights = weights(start.len()) & kept.bitcast::<I8>();
                add_vector(first & kept, weights, &mut plain, &mut weighted);
            }
            let mut weights = weights(vectors.len() * U8::LEN);
            #[rustc_unroll(never)]
            for bytes in vectors {
                let bytes = once::<C>(U8::load(bytes));
                copy.put(bytes.to_array(), U8::LEN);
                add_vector(bytes, weights, &mut plain, &mut weighted);
                weights -= U8::LEN as i8;
            }
            if !rows.is_empty() {
                let (mut earlier, mut sums) = (I32::zero(), [I32::zero(); VECTORS]);
                sums[0] = weighted;
                copy.put_each(rows.as_chunks().0.as_chunks().0, |row| {
                    earlier += plain;
                    add_row::<C>(row, &mut plain, &mut sums)
                });
                weighted = sums.into_iter().fold(I32::zero(), |all, it| all + it);
                if bytes.len() <= CHUNK {
                    weighted += earlier << ROW.ilog2();
                } else {
                    high += ROW as u64 * u64::from(earlier.reduce_sum() as u32);
                    high %= u64::from(MODULUS);
                }
            }
            let [plain, biased] = [plain, weighted].map(|it| it.reduce_sum() as u32);
            let weighted = biased.wrapping_add(BIAS as u32 * plain);
            reduced(high as u32 + weighted, low + plain)
        }
    }

    const HAS_PAIRWISE_DOT: bool = isa::Isa::HAS_PAIRWISE_DOT;

    #[inline(always)]
    fn update_any(adler: u32, bytes: &[impl Byte], copy: &mut impl Copies) -> u32 {
        match isa::U8::LEN == 16 || bytes.len() < isa::U8::LEN {
            true => width::x128::update(adler, bytes, copy),
            false => width::full::update(adler, bytes, copy),
        }
    }

    #[export(or = column_simd::update)]
    pub fn update(adler: u32, bytes: &[u8]) -> u32 {
        update_any(adler, bytes, &mut ())
    }

    #[export(or = column_simd::update_shared)]
    pub fn update_shared(adler: u32, bytes: &[SharedU8]) -> u32 {
        update_any(adler, bytes, &mut ())
    }

    #[export(or = copy_then_update)]
    pub fn copy_and_update<'a>(adler: &mut u32, from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
        assert!(from.len() <= to.len());
        let mut to = to.take(from.len()).into_writer();
        *adler = update_any(*adler, from, &mut to);
        to.finish()
    }
}

fn copy_then_update<'a>(adler: &mut u32, from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
    copy_then(adler, from, to, column_simd::update)
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

    /// Adds the bytes up: once each, and as often as they count in the upper half.
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

    #[inline(always)]
    fn update_any(adler: u32, bytes: &[impl Byte]) -> u32 {
        let (mut low, mut high) = (adler & 0xFFFF, adler >> 16);
        for chunk in bytes.chunks(CHUNK / ROW * ROW) {
            let [plain, weighted] = sums(chunk).map(i32::cast_unsigned);
            high = (high + chunk.len() as u32 * low + weighted) % MODULUS;
            low = (low + plain) % MODULUS;
        }
        high << 16 | low
    }

    #[export]
    pub fn update(adler: u32, bytes: &[u8]) -> u32 {
        update_any(adler, bytes)
    }

    #[export]
    pub fn update_shared(adler: u32, bytes: &[SharedU8]) -> u32 {
        update_any(adler, bytes)
    }
}
