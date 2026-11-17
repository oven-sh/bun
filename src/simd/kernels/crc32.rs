//! The CRC-32 of gzip, derived from libdeflate (LICENSE.md). The highest power of x is in the lowest bit.
use crate::Aligned;
use core::array::from_fn;

const fn times_power_of_x(mut value: u32, mut exponent: usize) -> u32 {
    while exponent > 0 {
        value = (value >> 1) ^ ((value & 1) * 0xEDB8_8320);
        exponent -= 1;
    }
    value
}

const fn power_of_x(exponent: usize) -> u64 {
    times_power_of_x(1 << 31, exponent) as u64
}

/// For a block that starts `distance` bytes before the one that it is folded into.
const fn factors(distance: usize) -> [u64; 2] {
    [power_of_x(8 * distance + 31), power_of_x(8 * distance - 33)]
}

#[inline]
pub fn crc32(crc: u32, bytes: &[u8]) -> u32 {
    !crate::in_aligned_parts(!crc, bytes, folding_simd::update)
}

/// On Arm, only wide cores are faster with this than with the CRC instructions, and those have `sha3`.
#[bun_simd::foreach_target(
    avx512_icl,
    avx2 + "vpclmulqdq",
    sse4 + "pclmulqdq" + "avx",
    sse4 + "pclmulqdq",
    neon + "aes" + "sha3",
    portable
)]
mod folding_simd {
    use isa::{U8, U64, x128};

    /// As many as keep the multipliers busy.
    const CHAINS: usize = if cfg!(target_arch = "aarch64") { 16 } else { 8 };

    const LONG: usize = 64;
    const _: () = assert!(LONG >= U8::LEN);

    #[bun_simd::foreach_width]
    mod width {
        /// Merges `earlier` into `later` without changing the CRC.
        #[inline(always)]
        pub fn fold(earlier: isa::U64, factors: isa::U64, later: isa::U64) -> isa::U64 {
            earlier.carryless_mul_lower(factors) ^ earlier.carryless_mul_upper(factors) ^ later
        }
    }

    /// Halves the number of chains, or starts them, and goes on until fewer than `K` vectors are left.
    #[inline(always)]
    fn fold_into<const TWICE: usize, const K: usize>(
        chains: Option<[U64; TWICE]>,
        crc: u32,
        rest: &mut &[[u8; U8::LEN]],
    ) -> Option<[U64; K]> {
        let factors = U64::repeat(const { factors(K * U8::LEN) });
        let mut halved = [U64::zero(); K];
        if let Some(all) = chains {
            for (i, chain) in halved.iter_mut().enumerate() {
                *chain = width::full::fold(all[i], factors, all[K + i]);
            }
        } else {
            let (first, after) = rest.split_first_chunk::<K>()?;
            for (chain, bytes) in halved.iter_mut().zip(first) {
                *chain = U8::load(bytes).bitcast();
            }
            halved[0] ^= U64::from_first(crc.into());
            *rest = after;
        }
        while let Some((next, after)) = rest.split_first_chunk::<K>() {
            for (chain, bytes) in halved.iter_mut().zip(next) {
                *chain = width::full::fold(*chain, factors, U8::load(bytes).bitcast());
            }
            *rest = after;
            if K < CHAINS {
                break;
            }
        }
        Some(halved)
    }

    #[inline(always)]
    fn fold_blocks(v: U64) -> x128::U64 {
        const FACTORS: [u64; U64::LEN] = from_fn(const |i| match U64::LEN / 2 - 1 - i / 2 {
            0 => 0,
            blocks => factors(16 * blocks)[i % 2],
        });
        let folded = width::full::fold(v, U64::from_array(FACTORS), U64::zero()).to_array();
        let earlier = folded[..U64::LEN - 2].as_chunks().0.iter();
        let last = x128::U64::from_slice(&v.to_array()[U64::LEN - 2..]);
        earlier.fold(last, |all, &block| all ^ x128::U64::from_array(block))
    }

    /// At `count`, moves the first `count` bytes to the end. At `16 + count`, moves the others to the start.
    #[inline(always)]
    fn shift(at: usize) -> x128::U8 {
        static SHIFTS: Aligned<[u8; 48]> =
            Aligned(from_fn(
                const |i| if i / 16 == 1 { i as u8 % 16 } else { 0x80 },
            ));
        x128::U8::from_slice(&SHIFTS.0[at..])
    }

    /// Barrett reduction
    #[inline(always)]
    fn reduce(v: x128::U64) -> u32 {
        let (polynomial, quotient_of_x95) = (0x1_DB71_0641, 0xB4E5_B025_F701_1641);
        let times = |v: x128::U64, by| v.carryless_mul_lower(x128::U64::from_first(by));
        let v = times(v, const { power_of_x(95) }) ^ x128::U64::from_first(v[1]);
        (v ^ times(times(v, quotient_of_x95), polynomial))[1] as u32
    }

    /// `rest` is the end of `bytes`, and `sum` has what is before it.
    #[inline(always)]
    fn finish(mut sum: x128::U64, rest: &[u8], bytes: &[u8]) -> u32 {
        let (blocks, rest) = rest.as_chunks();
        let factors = x128::U64::from_array(const { factors(16) });
        #[rustc_unroll(never)]
        for block in blocks {
            sum = width::x128::fold(sum, factors, x128::U8::load(block).bitcast());
        }
        if let (1.., Some(last)) = (rest.len(), bytes.last_chunk()) {
            let (sum_bytes, to_start) = (sum.bitcast::<x128::U8>(), shift(16 + rest.len()));
            let is_new = to_start.bitcast::<x128::I8>().simd_lt(0).cast();
            let later = is_new.select(x128::U8::load(last), sum_bytes.lookup(to_start));
            let earlier = sum_bytes.lookup(shift(rest.len()));
            sum = width::x128::fold(earlier.bitcast(), factors, later.bitcast());
        }
        reduce(sum)
    }

    /// The registers that it needs cost the short inputs nothing.
    #[inline(never)]
    fn update_long(crc: u32, bytes: &[u8]) -> u32 {
        let (mut vectors, rest) = bytes.as_chunks();
        let chains = match CHAINS {
            16 => fold_into::<32, 16>(None, crc, &mut vectors),
            _ => None,
        };
        let chains = fold_into::<16, 8>(chains, crc, &mut vectors);
        let chains = fold_into::<8, 4>(chains, crc, &mut vectors);
        let chains = fold_into::<4, 2>(chains, crc, &mut vectors);
        let chains = fold_into::<2, 1>(chains, crc, &mut vectors);
        let Some([all]) = chains else { return crc };
        finish(fold_blocks(all), rest, bytes)
    }

    #[export(or = instruction_simd::update)]
    pub fn update(crc: u32, bytes: &[u8]) -> u32 {
        if bytes.len() >= LONG {
            return update_long(crc, bytes);
        }
        let initial = x128::U32::from_first(crc).bitcast::<x128::U8>();
        if let Some((first, rest)) = bytes.split_first_chunk() {
            return finish((x128::U8::load(first) ^ initial).bitcast(), rest, bytes);
        }
        let [all] = x128::U8::load_or_zero(bytes);
        let at_end = (all ^ initial).lookup(shift(bytes.len()));
        reduce(at_end.bitcast()) ^ crc.unbounded_shr(8 * bytes.len() as u32)
    }
}

#[bun_simd::foreach_target(neon + "crc")]
mod instruction_simd {
    use isa::{crc32_u8, crc32_u64};

    const PART: usize = 512;

    /// Multiplies every fourth bit at a time, so that no carry reaches a bit that is kept.
    #[inline(always)]
    fn times_distance<const PARTS: usize>(crc: u32) -> u64 {
        const MASK: u64 = 0x1111_1111_1111_1111;
        let (a, b) = (u64::from(crc), const { power_of_x(8 * PARTS * PART - 33) });
        let part = |i: u32, j: u32| (a & MASK << j) * (b & MASK << (i.wrapping_sub(j) % 4));
        let bits = |i| (part(i, 0) ^ part(i, 1) ^ part(i, 2) ^ part(i, 3)) & MASK << i;
        bits(0) | bits(1) | bits(2) | bits(3)
    }

    #[export(or = table_simd::update)]
    pub fn update(mut crc: u32, bytes: &[u8]) -> u32 {
        let step = |crc, word: &[u8; 8]| crc32_u64(crc, u64::from_le_bytes(*word));
        let (words, rest) = bytes.as_chunks();
        let (groups, words) = words.as_chunks::<{ 4 * PART / 8 }>();
        // Independent parts hide the latency of the instruction.
        for group in groups {
            let mut all = [crc, 0, 0, 0];
            for at in 0..PART / 8 {
                all = from_fn(|i| step(all[i], &group[i * PART / 8 + at]));
            }
            let [a, b, c, d] = all;
            let moved = times_distance::<3>(a) ^ times_distance::<2>(b) ^ times_distance::<1>(c);
            crc = d ^ crc32_u64(0, moved);
        }
        crc = words.iter().fold(crc, step);
        rest.iter().fold(crc, |crc, &byte| crc32_u8(crc, byte))
    }
}

/// For a byte and the number of bytes after it.
static TABLES: [[u32; 256]; 8] =
    from_fn(const |after| from_fn(const |byte| times_power_of_x(byte as u32, 8 * (after + 1))));

fn by_tables(crc: u32, bytes: &[u8]) -> u32 {
    let look_up = |word: u32, after: usize| {
        let [a, b, c, d] = word.to_le_bytes().map(usize::from);
        let tables = &TABLES[after..];
        tables[3][a] ^ tables[2][b] ^ (tables[1][c] ^ tables[0][d])
    };
    let (words, rest) = bytes.as_chunks();
    let crc = words.iter().fold(crc, |crc, &word| {
        let word = u64::from_le_bytes(word);
        look_up((word >> 32) as u32, 0) ^ look_up(word as u32 ^ crc, 4)
    });
    let step = |crc: u32, &byte| crc >> 8 ^ TABLES[0][usize::from(crc as u8 ^ byte)];
    rest.iter().fold(crc, step)
}

/// Chorba: https://arxiv.org/abs/2412.16398
#[bun_simd::foreach_target(sse4, neon, portable)]
mod table_simd {
    use isa::x128::{U8, U32};

    /// x^300 + x^155 + x^117 + x^89 + 1 and its eighth power are multiples of the polynomial.
    const DISTANCES: [usize; 4] = [300 - 155, 300 - 117, 300 - 89, 300];
    const KEPT: usize = 304;
    const BATCH: usize = 1024;

    /// With what the bytes before `at` add to it.
    #[inline(always)]
    fn with_earlier(bytes: &[u8; 16], earlier: &[u8; KEPT + BATCH], at: usize) -> U8 {
        let [a, b, c, d] = DISTANCES.map(|distance| U8::from_slice(&earlier[at - distance..]));
        U8::load(bytes) ^ a ^ b ^ c ^ d
    }

    #[export]
    pub fn update(crc: u32, bytes: &[u8]) -> u32 {
        let (vectors, rest) = bytes.as_chunks();
        let parts = vectors.split_last_chunk::<{ KEPT / 16 }>();
        let (768.., Some(([first, others @ ..], last))) = (bytes.len(), parts) else {
            return by_tables(crc, bytes);
        };
        // A byte can be dropped if it is added to the ones at these distances after it.
        let mut dropped = [0; KEPT + BATCH];
        (U8::load(first) ^ U32::from_first(crc).bitcast::<U8>())
            .copy_to_slice(&mut dropped[KEPT - 16..]);
        for batch in others.chunks(BATCH / 16) {
            for (at, bytes) in (KEPT..KEPT + BATCH).step_by(16).zip(batch) {
                with_earlier(bytes, &dropped, at).copy_to_slice(&mut dropped[at..]);
            }
            dropped.copy_within(16 * batch.len()..16 * batch.len() + KEPT, 0);
        }
        dropped[KEPT..2 * KEPT].fill(0);
        let kept: [_; KEPT / 16] =
            from_fn(|i| with_earlier(&last[i], &dropped, KEPT + 16 * i).to_array());
        by_tables(by_tables(0, kept.as_flattened()), rest)
    }
}
