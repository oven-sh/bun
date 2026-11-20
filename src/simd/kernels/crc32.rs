//! The CRC-32 of gzip, derived from libdeflate (LICENSE.md). The highest power of x is in the lowest bit.
use crate::{Aligned, Byte, Copies, aligned, copy_then, unaligned_len};
use bun_simd::{Out, SharedU8, opaque};
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

/// For the last 8-byte words of the input. The sum of the products is the input times x^32.
static FACTORS: Aligned<[u64; 64]> = Aligned(from_fn(const |i| power_of_x(64 * (63 - i) + 31)));

/// Products are fast there. Detecting `sha3` is no substitute: its op slows them on Neoverse N2.
const IS_APPLE: bool = cfg!(all(target_vendor = "apple", target_feature = "sha3"));

/// Below it, the instruction of Arm is faster than products.
const SHORT: usize = if IS_APPLE { 128 } else { 384 };

/// Up to it, a table is.
const TINY: usize = 4;

#[inline]
pub fn crc32(crc: u32, bytes: &[u8]) -> u32 {
    !match bytes.len() {
        ..SHORT if cfg!(target_arch = "aarch64") => instruction_simd::update(!crc, bytes),
        ..=TINY => by_small_steps(!crc, bytes),
        _ if unaligned_len(bytes) > 0 => !aligned(crc, bytes, crc32),
        _ => folding_simd::update(!crc, bytes),
    }
}

#[inline]
pub fn crc32_shared(crc: u32, bytes: &[SharedU8]) -> u32 {
    !match bytes.len() {
        ..SHORT if cfg!(target_arch = "aarch64") => instruction_simd::update_shared(!crc, bytes),
        ..=TINY => by_small_steps(!crc, bytes),
        _ if unaligned_len(bytes) > 0 => !aligned(crc, bytes, crc32_shared),
        _ => folding_simd::update_shared(!crc, bytes),
    }
}

/// Adds the copy to `crc`. Panics if it does not fit.
#[inline]
pub fn copy_and_crc32<'a>(crc: &mut u32, from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
    match from.len() {
        ..SHORT if cfg!(target_arch = "aarch64") => {
            instruction_simd::copy_and_update(crc, from, to)
        }
        ..=TINY => copy_then(crc, from, to, crc32),
        _ => folding_simd::copy_and_update(crc, from, to),
    }
}

#[bun_simd::foreach_target(
    avx512_icl,
    avx2 + "vpclmulqdq",
    avx2 + "pclmulqdq" + "avx512vl",
    avx2 + "pclmulqdq",
    sse4 + "pclmulqdq",
    neon + "crc" + "aes",
    portable
)]
mod folding_simd {
    use isa::{U8, Vector, crc32_u64, x128};
    use width::x128::{CHAINS, Chains, STRIDE, fold, load_stride};

    /// An instruction multiplies only 128 bits.
    const IS_NARROW: bool =
        U8::LEN == 16 || matches!(MORE_FEATURES, [it, ..] if matches!(it.as_bytes(), b"pclmulqdq"));
    const HAS_INSTRUCTION: bool =
        matches!(MORE_FEATURES, [it, ..] if matches!(it.as_bytes(), b"crc"));

    /// Barrett reduction
    #[inline(always)]
    fn reduce(v: x128::U64) -> u32 {
        let (polynomial, quotient_of_x95) = (0x1_DB71_0641, 0xB4E5_B025_F701_1641);
        let times = |v: x128::U64, by| v.carryless_mul_lower(x128::U64::from_first(by));
        (v ^ times(times(v, quotient_of_x95), polynomial))[1] as u32
    }

    #[bun_simd::foreach_width]
    mod width {
        use isa::{U8, U64};

        /// As many as keep the multipliers busy.
        pub const CHAINS: usize = match U8::LEN {
            16 if HAS_INSTRUCTION => 8,
            16 => 6,
            _ => 4,
        };
        pub const STRIDE: usize = CHAINS * U8::LEN;

        pub type Chains = [U64; CHAINS];

        /// For the last `count` vectors of the input.
        #[inline(always)]
        fn factors(count: usize) -> &'static [[u64; U64::LEN]] {
            let all = FACTORS.0.as_chunks().0;
            &all[all.len() - count..]
        }

        /// LLVM would load each half on its own for Arm.
        #[inline(always)]
        fn load_factors(from: &[u64; U64::LEN]) -> U64 {
            let factors = U64::load(from);
            if HAS_INSTRUCTION {
                factors.opaque()
            } else {
                factors
            }
        }

        #[inline(always)]
        fn add_products(sum: U64, words: U64, factors: U64) -> U64 {
            sum ^ words.carryless_mul_lower(factors) ^ words.carryless_mul_upper(factors)
        }

        /// Merges `earlier` into `later`, which starts `BYTES` after it, without changing the CRC.
        #[inline(always)]
        pub fn fold<const BYTES: usize>(earlier: U64, later: U64) -> U64 {
            let factors = const { [power_of_x(8 * BYTES + 31), power_of_x(8 * BYTES - 33)] };
            let mut factors = U64::repeat(factors);
            if IS_NARROW && !HAS_INSTRUCTION {
                // LLVM would give each a register, of which products can use only 16.
                factors = factors.opaque();
            }
            add_products(later, earlier, factors)
        }

        #[inline(always)]
        fn once<C: Copies>(loaded: U8) -> U8 {
            if C::KEEPS { loaded.opaque() } else { loaded }
        }

        #[inline(always)]
        fn load<C: Copies>(from: &[impl Byte; U8::LEN], copy: &mut C, count: usize) -> U64 {
            let bytes = once::<C>(U8::load(from));
            copy.put(bytes.to_array(), count);
            bytes.bitcast()
        }

        #[inline(always)]
        pub fn load_stride<C: Copies>(
            from: &[[impl Byte; U8::LEN]; CHAINS],
            copy: &mut C,
        ) -> Chains {
            let (mut all, mut bytes) = ([U64::zero(); CHAINS], [0; STRIDE]);
            #[rustc_unroll(full)]
            for (i, to) in bytes.as_chunks_mut().0.iter_mut().enumerate() {
                let v = once::<C>(U8::load_at(from, i));
                v.store(to);
                all[i] = v.bitcast();
            }
            copy.put(bytes, STRIDE);
            all
        }

        /// `None` if there is no whole vector. `faster` may take care of some strides.
        #[inline(always)]
        pub fn update<B: Byte, C: Copies>(
            crc: u32,
            bytes: &[B],
            copy: &mut C,
            faster: impl Fn(&mut Chains, &mut &[[B; U8::LEN]], &mut C),
        ) -> Option<u32> {
            let (first, (part, mut rest)) = (bytes.first_chunk()?, bytes.as_rchunks());
            let (mut sum, mut next) = (U64::zero(), U64::from_first(crc.into()));
            let is_long = rest.len() >= 2 * CHAINS;
            if let len @ 1.. = part.len() {
                let first: U8 = (load(first, copy, len) ^ next).bitcast();
                // Zeros before the input do not change its CRC.
                let padded = first.slide_up(U8::LEN - len).bitcast();
                next = next >> (8 * len as u32).min(32);
                match is_long {
                    true => next = fold::<{ U8::LEN }>(padded, next),
                    false => {
                        sum = add_products(sum, padded, load_factors(&factors(rest.len() + 1)[0]))
                    }
                }
            }
            if is_long {
                let first;
                (first, rest) = rest.split_first_chunk()?;
                let mut chains = load_stride(first, copy);
                chains[0] ^= next;
                faster(&mut chains, &mut rest, copy);
                while let Some((next, after)) = rest.split_first_chunk() {
                    for (chain, v) in chains.iter_mut().zip(load_stride(next, copy)) {
                        *chain = fold::<STRIDE>(*chain, v);
                    }
                    rest = after;
                }
                let factors = factors(rest.len() + CHAINS).first_chunk::<CHAINS>()?;
                for i in 0..CHAINS - 1 {
                    sum = add_products(sum, chains[i], load_factors(&factors[i]));
                }
                next = chains[CHAINS - 1];
            } else {
                let first;
                (first, rest) = rest.split_first()?;
                next ^= load(first, copy, U8::LEN);
            }
            // One sum would wait for itself twice in each turn.
            let mut upper = U64::zero();
            #[rustc_unroll(never)]
            for (bytes, factors) in rest.iter().zip(&factors(rest.len() + 1)[..rest.len()]) {
                let factors = load_factors(factors);
                sum ^= next.carryless_mul_lower(factors);
                upper ^= next.carryless_mul_upper(factors);
                next = load(bytes, copy, U8::LEN);
            }
            Some(finish(sum ^ upper, next))
        }

        #[inline(always)]
        pub fn finish(sum: U64, last: U64) -> u32 {
            let factors = U64::load(&factors(1)[0]);
            let upper = match U8::LEN {
                // The last factor is 1.
                16 => U64::from_first(last[1]),
                _ => last.carryless_mul_upper(factors),
            };
            let all = (sum ^ last.carryless_mul_lower(factors) ^ upper).to_array();
            let blocks = all.as_chunks().0.iter();
            reduce(blocks.fold(x128::U64::zero(), |all, it| all ^ x128::U64::load(it)))
        }
    }

    /// How many bytes the instruction gets for each stride.
    const BESIDE: usize = 16 * if IS_APPLE { 4 } else { 6 };

    /// The instruction has a unit of its own, which works on some of the bytes meanwhile.
    #[inline(always)]
    fn fold_beside_instruction(
        chains: &mut Chains,
        rest: &mut &[[impl Byte; 16]],
        copy: &mut impl Copies,
    ) {
        while let Some((skipped, after)) = rest.split_first_chunk::<{ BESIDE / 16 }>()
            && let Some((next, after)) = after.split_first_chunk()
        {
            let (mut crc, mut bytes) = (0, [0; BESIDE]);
            let words = skipped.as_flattened().as_chunks().0;
            #[rustc_unroll(full)]
            for (i, to) in bytes.as_chunks_mut().0.iter_mut().enumerate() {
                let word = opaque(u64::from_le_bytes(Vector::load_at(words, i).to_array()));
                (*to, crc) = (word.to_le_bytes(), crc32_u64(crc, word));
            }
            copy.put(bytes, BESIDE);
            for (chain, v) in chains.iter_mut().zip(load_stride(next, copy)) {
                *chain = fold::<{ STRIDE + BESIDE }>(*chain, v);
            }
            chains[0] ^= x128::U64::from_first(crc.into());
            *rest = after;
        }
    }

    /// A vector needs no products if it is added to others: https://arxiv.org/abs/2412.16398
    #[inline(always)]
    fn fold_and_skip(chains: &mut Chains, rest: &mut &[[impl Byte; 16]]) {
        const DISTANCES: [usize; 9] = [15, 17, 20, 23, 26, 28, 46, 50, 53];
        const _: () = {
            let (mut sum, mut i) = (power_of_x(53), 0);
            while i < DISTANCES.len() {
                (sum, i) = (sum ^ power_of_x(53 - DISTANCES[i]), i + 1);
            }
            assert!(sum == 0);
        };
        /// With more, the sums take longer than the products if one starts in each cycle.
        const SKIPPED: usize = match MORE_FEATURES {
            [_, it] if matches!(it.as_bytes(), b"avx512vl") => 18,
            _ => 10,
        };
        const ROUND: usize = SKIPPED + 53usize.next_multiple_of(CHAINS);
        while let Some((round, after)) = rest.split_first_chunk::<ROUND>() {
            let mut skipped = [x128::U64::zero(); SKIPPED];
            #[rustc_unroll(full)]
            for at in 0..ROUND {
                let mut v: x128::U64 = x128::U8::load_at(round, at).bitcast();
                #[rustc_unroll(full)]
                for distance in DISTANCES {
                    if at.wrapping_sub(distance) < SKIPPED {
                        v ^= skipped[at - distance];
                    }
                }
                let Some(folded) = at.checked_sub(SKIPPED) else {
                    skipped[at] = v;
                    continue;
                };
                let chain = &mut chains[folded % CHAINS];
                *chain = match folded < CHAINS {
                    true => fold::<{ STRIDE + 16 * SKIPPED }>(*chain, v.opaque()),
                    false => fold::<STRIDE>(*chain, v.opaque()),
                };
                // LLVM would follow one chain at a time.
                chain.keep();
            }
            *rest = after;
        }
    }

    /// For 4 to 15 bytes, which zeros follow.
    #[inline(always)]
    fn update_short(crc: u32, bytes: x128::U8, len: usize) -> u32 {
        debug_assert!(len >= 4);
        let all = bytes ^ x128::U32::from_first(crc).bitcast::<x128::U8>();
        width::x128::finish(x128::U64::zero(), all.slide_up(16 - len).bitcast())
    }

    #[inline(always)]
    fn update_long<C: Copies>(crc: u32, bytes: &[impl Byte], copy: &mut C) -> Option<u32> {
        assert!(!HAS_INSTRUCTION || bytes.len() >= SHORT);
        if !IS_NARROW && bytes.len() >= 64 {
            return width::full::update(crc, bytes, copy, |_, _, _| {});
        }
        width::x128::update(crc, bytes, copy, |chains, rest, copy| {
            if HAS_INSTRUCTION {
                fold_beside_instruction(chains, rest, copy);
            } else if !C::KEEPS {
                // What does not fit the registers would wait in line with the stores of a copy.
                fold_and_skip(chains, rest);
            }
        })
    }

    #[inline(always)]
    fn update_any(crc: u32, bytes: &[impl Byte]) -> u32 {
        match update_long(crc, bytes, &mut ()) {
            Some(crc) => crc,
            None => update_short(crc, x128::U8::load_or_zero::<_, 1>(bytes)[0], bytes.len()),
        }
    }

    #[export(or = instruction_simd::update)]
    pub fn update(crc: u32, bytes: &[u8]) -> u32 {
        update_any(crc, bytes)
    }

    #[export(or = instruction_simd::update_shared)]
    pub fn update_shared(crc: u32, bytes: &[SharedU8]) -> u32 {
        update_any(crc, bytes)
    }

    #[export(or = instruction_simd::copy_and_update)]
    pub fn copy_and_update<'a>(crc: &mut u32, from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
        assert!(from.len() <= to.len());
        let mut to = to.take(from.len()).into_writer();
        *crc = !match update_long(!*crc, from, &mut to) {
            Some(state) => state,
            None => {
                let bytes = x128::U8::load_or_zero::<_, 1>(from)[0].opaque();
                bytes.append_partial(&mut to, from.len());
                update_short(!*crc, bytes, from.len())
            }
        };
        to.finish()
    }
}

#[bun_simd::foreach_target(neon + "crc", portable)]
mod instruction_simd {
    use isa::{Vector, crc32_u64};

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

    #[inline(always)]
    fn load(from: &[impl Byte; 8]) -> u64 {
        opaque(u64::from_le_bytes(Vector::load(from).to_array()))
    }

    /// For the first 1 to 7 bytes. Zeros before them do not change a state of zero.
    #[inline(always)]
    fn first_bytes(crc: u32, word: u64, len: usize) -> u32 {
        let (crc, bits) = (u64::from(crc), 8 * len);
        crc32_u64(0, (word ^ crc) << (64 - bits)) ^ (crc >> bits) as u32
    }

    /// Returns the bytes.
    #[inline(always)]
    fn add_words<const N: usize>(crc: &mut u32, from: &[impl Byte; N]) -> [u8; N] {
        let (words, mut bytes) = (from.as_chunks().0, [0; N]);
        #[rustc_unroll(full)]
        for (i, to) in bytes.as_chunks_mut().0.iter_mut().enumerate() {
            let word = opaque(u64::from_le_bytes(Vector::load_at(words, i).to_array()));
            (*to, *crc) = (word.to_le_bytes(), crc32_u64(*crc, word));
        }
        bytes
    }

    #[inline(always)]
    fn by_words(mut crc: u32, bytes: &[impl Byte], copy: &mut impl Copies) -> Option<u32> {
        let (first, (start, lines)) = (load(bytes.first_chunk()?), bytes.as_rchunks::<64>());
        let (part, words) = start.as_rchunks::<8>();
        if let len @ 1.. = part.len() {
            copy.put(first.to_le_bytes(), len);
            crc = first_bytes(crc, first, len);
        }
        copy.put_each(words, |it| add_words(&mut crc, it));
        copy.put_each(lines, |it| add_words(&mut crc, it));
        Some(crc)
    }

    #[inline(always)]
    fn update_short(crc: u32, bytes: &[impl Byte]) -> u32 {
        if let Some(crc) = by_words(crc, bytes, &mut ()) {
            return crc;
        }
        let len = bytes.len();
        let half = |it| u64::from(u32::from_le_bytes(Vector::load(it).to_array()));
        let byte = |at: usize| u64::from(bytes[at].get()) << (8 * at);
        let word = match (bytes.first_chunk(), bytes.last_chunk()) {
            (Some(first), Some(last)) => half(first) | half(last) << (8 * (len - 4)),
            _ if len == 0 => return crc,
            _ => byte(0) | byte(len / 2) | byte(len - 1),
        };
        first_bytes(crc, word, len)
    }

    /// Independent parts hide the latency of the instruction.
    #[inline(never)]
    fn update_long(mut crc: u32, bytes: &[impl Byte]) -> u32 {
        let (groups, rest) = bytes.as_chunks::<{ 4 * PART }>();
        for group in groups {
            let (words, mut all) = (group.as_chunks().0, [crc, 0, 0, 0]);
            for at in 0..PART / 8 {
                all = from_fn(|i| crc32_u64(all[i], load(&words[i * PART / 8 + at])));
            }
            let [a, b, c, d] = all;
            let moved = times_distance::<3>(a) ^ times_distance::<2>(b) ^ times_distance::<1>(c);
            crc = d ^ crc32_u64(0, moved);
        }
        update_short(crc, rest)
    }

    #[inline(always)]
    fn update_any(crc: u32, bytes: &[impl Byte]) -> u32 {
        match bytes.len() < 4 * PART {
            true => update_short(crc, bytes),
            false => update_long(crc, bytes),
        }
    }

    #[export(or = table_simd::update)]
    pub fn update(crc: u32, bytes: &[u8]) -> u32 {
        update_any(crc, bytes)
    }

    #[export(or = table_simd::update_shared)]
    pub fn update_shared(crc: u32, bytes: &[SharedU8]) -> u32 {
        update_any(crc, bytes)
    }

    #[export(or = copy_then_update)]
    pub fn copy_and_update<'a>(crc: &mut u32, from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
        if !(8..4 * PART).contains(&from.len()) {
            return copy_then_update(crc, from, to);
        }
        assert!(from.len() <= to.len());
        let mut to = to.take(from.len()).into_writer();
        *crc = !by_words(!*crc, from, &mut to).unwrap_or_default();
        to.finish()
    }
}

#[inline(never)]
fn copy_then_update<'a>(crc: &mut u32, from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
    copy_then(crc, from, to, |crc, copy| {
        !instruction_simd::update(!crc, copy)
    })
}

/// For a byte and the number of bytes after it.
static TABLES: [[u32; 256]; 8] =
    from_fn(const |after| from_fn(const |byte| times_power_of_x(byte as u32, 8 * (after + 1))));

#[inline(always)]
fn look_up(word: u32, after: usize) -> u32 {
    let [a, b, c, d] = word.to_le_bytes().map(usize::from);
    let tables = &TABLES[after..];
    // LLVM would add them one after the other, or move them to a vector.
    let pair = |a: u32, b: u32| opaque((a ^ b).into()) as u32;
    pair(tables[3][a], tables[2][b]) ^ pair(tables[1][c], tables[0][d])
}

#[inline(always)]
fn by_small_steps(mut crc: u32, bytes: &[impl Byte]) -> u32 {
    let (words, rest) = bytes.as_chunks();
    for [a, b, c, d] in words {
        crc = look_up(
            u32::from_le_bytes([a.get(), b.get(), c.get(), d.get()]) ^ crc,
            0,
        );
    }
    for byte in rest {
        crc = crc >> 8 ^ TABLES[0][usize::from(crc as u8 ^ byte.get())];
    }
    crc
}

/// Chorba: https://arxiv.org/abs/2412.16398
#[bun_simd::foreach_target(sse4, neon, portable)]
mod table_simd {
    use isa::Vector;
    use isa::x128::{U8, U32};

    /// x^300 + x^155 + x^117 + x^89 + 1 and its eighth power are multiples of the polynomial.
    const DISTANCES: [usize; 4] = [300 - 155, 300 - 117, 300 - 89, 300];
    const KEPT: usize = 304;

    #[inline(never)]
    fn by_tables(mut crc: u32, bytes: &[impl Byte]) -> u32 {
        let (words, rest) = bytes.as_chunks();
        for word in words {
            let word = u64::from_le_bytes(Vector::load(word).to_array());
            crc = look_up((word >> 32) as u32, 0) ^ look_up(word as u32 ^ crc, 4);
        }
        by_small_steps(crc, rest)
    }

    /// A byte can be dropped if it is added to the ones at these distances after it.
    #[inline(always)]
    fn with_earlier(bytes: &[impl Byte; 16], earlier: &[u8], at: usize) -> U8 {
        let [a, b, c, d] = DISTANCES.map(|distance| U8::from_slice(&earlier[at - distance..]));
        U8::load(bytes) ^ a ^ b ^ c ^ d
    }

    #[inline(always)]
    fn update_any(crc: u32, bytes: &[impl Byte]) -> u32 {
        let (vectors, rest) = bytes.as_chunks();
        let parts = vectors.split_last_chunk::<{ KEPT / 16 }>();
        let Some((others, last)) = parts.filter(|(others, _)| others.len() >= KEPT / 16) else {
            return by_tables(crc, bytes);
        };
        // They go round in the first third. The second repeats them, to be read in one piece.
        let Aligned(dropped) = &mut Aligned([0; 3 * KEPT]);
        U32::from_first(crc)
            .bitcast::<U8>()
            .copy_to_slice(&mut dropped[KEPT - 300..]);
        let mut end = KEPT;
        for lap in others.chunks(KEPT / 16) {
            for (i, bytes) in lap.iter().enumerate() {
                let sum = with_earlier(bytes, dropped, KEPT + 16 * i);
                sum.copy_to_slice(&mut dropped[16 * i..]);
                sum.copy_to_slice(&mut dropped[KEPT + 16 * i..]);
            }
            end = KEPT + 16 * lap.len();
        }
        dropped[end..2 * KEPT].fill(0);
        let dropped = &dropped[end - KEPT..][..2 * KEPT];
        let mut kept = [[0; 16]; KEPT / 16];
        for (i, to) in kept.iter_mut().enumerate() {
            with_earlier(&last[i], dropped, KEPT + 16 * i).store(to);
        }
        by_tables(by_tables(0, kept.as_flattened()), rest)
    }

    #[export]
    pub fn update(crc: u32, bytes: &[u8]) -> u32 {
        update_any(crc, bytes)
    }

    #[export]
    pub fn update_shared(crc: u32, bytes: &[SharedU8]) -> u32 {
        update_any(crc, bytes)
    }
}
