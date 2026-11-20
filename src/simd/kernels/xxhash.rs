//! XXH32, XXH64 and XXH3 of xxHash.
use crate::Byte;
use bun_simd::{Isa, SharedU8, opaque};
use core::slice;

pub use simd::{xxhash3_64_shared, xxhash32, xxhash32_shared, xxhash64, xxhash64_shared};

const PRIME32_1: u32 = 0x9E3779B1;
const PRIME32_2: u32 = 0x85EBCA77;
const PRIME32_3: u32 = 0xC2B2AE3D;
const PRIME32_4: u32 = 0x27D4EB2F;
const PRIME32_5: u32 = 0x165667B1;
const PRIME64_1: u64 = 0x9E3779B185EBCA87;
const PRIME64_2: u64 = 0xC2B2AE3D27D4EB4F;
const PRIME64_3: u64 = 0x165667B19E3779F9;
const PRIME64_4: u64 = 0x85EBCA77C2B2AE63;
const PRIME64_5: u64 = 0x27D4EB2F165667C5;
const PRIME_MX1: u64 = 0x165667919E3779F9;
const PRIME_MX2: u64 = 0x9FB21C651E98DF25;
const INIT: [u64; 8] = [
    PRIME32_3 as u64,
    PRIME64_1,
    PRIME64_2,
    PRIME64_3,
    PRIME64_4,
    PRIME32_2 as u64,
    PRIME64_5,
    PRIME32_1 as u64,
];
const SECRET: [u8; 192] = [
    0xb8, 0xfe, 0x6c, 0x39, 0x23, 0xa4, 0x4b, 0xbe, 0x7c, 0x01, 0x81, 0x2c, 0xf7, 0x21, 0xad, 0x1c,
    0xde, 0xd4, 0x6d, 0xe9, 0x83, 0x90, 0x97, 0xdb, 0x72, 0x40, 0xa4, 0xa4, 0xb7, 0xb3, 0x67, 0x1f,
    0xcb, 0x79, 0xe6, 0x4e, 0xcc, 0xc0, 0xe5, 0x78, 0x82, 0x5a, 0xd0, 0x7d, 0xcc, 0xff, 0x72, 0x21,
    0xb8, 0x08, 0x46, 0x74, 0xf7, 0x43, 0x24, 0x8e, 0xe0, 0x35, 0x90, 0xe6, 0x81, 0x3a, 0x26, 0x4c,
    0x3c, 0x28, 0x52, 0xbb, 0x91, 0xc3, 0x00, 0xcb, 0x88, 0xd0, 0x65, 0x8b, 0x1b, 0x53, 0x2e, 0xa3,
    0x71, 0x64, 0x48, 0x97, 0xa2, 0x0d, 0xf9, 0x4e, 0x38, 0x19, 0xef, 0x46, 0xa9, 0xde, 0xac, 0xd8,
    0xa8, 0xfa, 0x76, 0x3f, 0xe3, 0x9c, 0x34, 0x3f, 0xf9, 0xdc, 0xbb, 0xc7, 0xc7, 0x0b, 0x4f, 0x1d,
    0x8a, 0x51, 0xe0, 0x4b, 0xcd, 0xb4, 0x59, 0x31, 0xc8, 0x9f, 0x7e, 0xc9, 0xd9, 0x78, 0x73, 0x64,
    0xea, 0xc5, 0xac, 0x83, 0x34, 0xd3, 0xeb, 0xc3, 0xc5, 0x81, 0xa0, 0xff, 0xfa, 0x13, 0x63, 0xeb,
    0x17, 0x0d, 0xdd, 0x51, 0xb7, 0xf0, 0xda, 0x49, 0xd3, 0x16, 0x55, 0x26, 0x29, 0xd4, 0x68, 0x9e,
    0x2b, 0x16, 0xbe, 0x58, 0x7d, 0x47, 0xa1, 0xfc, 0x8f, 0xf8, 0xb8, 0xd1, 0x7a, 0xd0, 0x31, 0xce,
    0x45, 0xcb, 0x3a, 0x8f, 0x95, 0x16, 0x04, 0x28, 0xaf, 0xd7, 0xfb, 0xca, 0xbb, 0x4b, 0x40, 0x7e,
];

/// With `<< 32`, LLVM makes a product of 64 bits of it, which takes 15 cycles on Intel's cores.
const UP_BY_32: [u8; 16] = [
    128, 128, 128, 128, 0, 1, 2, 3, 128, 128, 128, 128, 8, 9, 10, 11,
];

#[bun_simd::foreach_target]
mod simd {
    use isa::{U8, U64, Vector, x128};

    #[inline(always)]
    fn u32_at(bytes: &[impl Byte], at: usize) -> u32 {
        u32::from_le_bytes(Vector::load(bytes[at..].first_chunk().unwrap()).to_array())
    }

    #[inline(always)]
    fn u64_at(bytes: &[impl Byte], at: usize) -> u64 {
        u64::from_le_bytes(Vector::load(bytes[at..].first_chunk().unwrap()).to_array())
    }

    /// For up to 16 stripes, `K` per iteration.
    #[inline(always)]
    fn accumulate<const K: usize>(acc: &mut [u64; 8], stripes: &[[SharedU8; 64]], secret: &[u8]) {
        let mut sums = [0; 8];
        for (i, group) in stripes.as_chunks::<K>().0.iter().enumerate() {
            for (j, stripe) in group.iter().enumerate() {
                let key = &secret[8 * (K * (i % (16 / K)) + j)..][..64];
                let inputs = stripe.as_chunks().0.iter().zip(key.as_chunks().0);
                let outputs = acc.as_chunks_mut().0.iter_mut().zip(sums.as_chunks_mut().0);
                for ((data, key), (acc, sum)) in inputs.zip(outputs) {
                    let data: U64 = U8::load(data).bitcast();
                    let keyed = data ^ U8::load(key).bitcast::<U64>();
                    (U64::load(acc) + keyed.mul_low32(keyed >> 32)).store(acc);
                    (U64::load(sum) + data).store(sum);
                }
            }
        }
        // The sum of what is swapped is the sum, swapped.
        for (acc, sum) in acc.as_chunks_mut().0.iter_mut().zip(sums.as_chunks().0) {
            (U64::load(acc) + U64::load(sum).swap_pairs()).store(acc);
        }
    }

    fn scramble(acc: &mut [u64; 8], secret: &[u8; 64]) {
        let prime = U64::splat(PRIME32_1.into());
        for (acc, key) in acc.as_chunks_mut().0.iter_mut().zip(secret.as_chunks().0) {
            let a = U64::load(acc);
            let a = a ^ a >> 47 ^ U8::load(key).bitcast::<U64>();
            let high = (a >> 32)
                .mul_low32(prime)
                .bitcast::<U8>()
                .lookup(U8::repeat(UP_BY_32));
            (a.mul_low32(prime) + high.bitcast::<U64>()).store(acc);
        }
    }

    /// For more than 240 bytes.
    #[export(up_to = neon)]
    pub fn hash_long(input: &[SharedU8], secret: &[u8; 192]) -> u64 {
        let (mut acc, last) = (INIT, input.split_last_chunk().unwrap().1);
        let (blocks, rest) = input[..input.len() - 1].as_chunks::<1024>();
        for block in blocks {
            accumulate::<{ U8::LEN / 8 }>(&mut acc, block.as_chunks().0, secret);
            scramble(&mut acc, secret.last_chunk().unwrap());
        }
        accumulate::<1>(&mut acc, rest.as_chunks().0, secret);
        accumulate::<1>(&mut acc, slice::from_ref(last), &secret[128 - 7..]);

        for (acc, key) in acc
            .as_chunks_mut()
            .0
            .iter_mut()
            .zip(secret[11..].as_chunks().0)
        {
            (U64::load(acc) ^ U8::load(key).bitcast::<U64>()).store(acc);
        }
        let mut hash = (input.len() as u64).wrapping_mul(PRIME64_1);
        for &[low, high] in acc.as_chunks().0 {
            hash = hash.wrapping_add(folded_mul(low, high));
        }
        avalanche3(hash)
    }

    #[inline(always)]
    fn mix(data: &[SharedU8; 16], key_at: usize, seed: u64) -> u64 {
        let key: x128::U64 = x128::U8::from_slice(&SECRET[key_at..]).bitcast();
        let key = key + x128::U64::from_array([seed, seed.wrapping_neg()]);
        let [low, high] = (x128::U8::load(data).bitcast::<x128::U64>() ^ key).to_array();
        folded_mul(low, high)
    }

    #[inline(never)]
    fn hash_129_to_240(seed: u64, input: &[SharedU8]) -> u64 {
        let (first, others) = input.as_chunks().0.split_first_chunk::<8>().unwrap();
        let mut hash = (input.len() as u64).wrapping_mul(PRIME64_1);
        for (i, data) in first.iter().enumerate() {
            hash = hash.wrapping_add(mix(data, 16 * i, seed));
        }
        hash = avalanche3(hash).wrapping_add(mix(input.last_chunk().unwrap(), 136 - 17, seed));
        for (data, i) in others.iter().zip(0..7) {
            hash = hash.wrapping_add(mix(data, 16 * i + 3, seed));
        }
        avalanche3(hash)
    }

    #[export(baseline)]
    pub fn xxhash3_64_shared(seed: u64, input: &[SharedU8]) -> u64 {
        let len = input.len();
        let key = |at: usize| u64_at(&SECRET, at) ^ u64_at(&SECRET, at + 8);
        let mut hash = (len as u64).wrapping_mul(PRIME64_1);
        match len {
            0 => avalanche64(seed ^ key(56)),
            1..=3 => {
                let [first, middle, last] = [0, len / 2, len - 1].map(|at| input[at].get());
                let all = u32::from_le_bytes([last, len as u8, first, middle]);
                let key = u32_at(&SECRET, 0) ^ u32_at(&SECRET, 4);
                avalanche64(u64::from(all) ^ u64::from(key).wrapping_add(seed))
            }
            4..=8 => {
                let seed = seed ^ u64::from((seed as u32).swap_bytes()) << 32;
                let ends = u64::from(u32_at(input, 0)) << 32 | u64::from(u32_at(input, len - 4));
                hash = ends ^ key(8).wrapping_sub(seed);
                hash = (hash ^ hash.rotate_left(49) ^ hash.rotate_left(24)).wrapping_mul(PRIME_MX2);
                hash = (hash ^ ((hash >> 35) + len as u64)).wrapping_mul(PRIME_MX2);
                hash ^ hash >> 28
            }
            9..=16 => {
                let low = u64_at(input, 0) ^ key(24).wrapping_add(seed);
                let high = u64_at(input, len - 8) ^ key(40).wrapping_sub(seed);
                hash = (len as u64)
                    .wrapping_add(low.swap_bytes())
                    .wrapping_add(high);
                avalanche3(hash.wrapping_add(folded_mul(low, high)))
            }
            17..=128 => {
                for i in 0..4 {
                    if len > 32 * i {
                        let (front, back) = (&input[16 * i..], &input[..len - 16 * i]);
                        let front = mix(front.first_chunk().unwrap(), 32 * i, seed);
                        let back = mix(back.split_last_chunk().unwrap().1, 32 * i + 16, seed);
                        hash = hash.wrapping_add(front).wrapping_add(back);
                    }
                }
                avalanche3(hash)
            }
            129..=240 => hash_129_to_240(seed, input),
            _ if seed == 0 => super::hash_long(input, &SECRET),
            _ => hash_long_with_seed(seed, input),
        }
    }

    #[inline(always)]
    fn accumulate32(mut acc: [u32; 4], stripes: &[[impl Byte; 16]]) -> [u32; 4] {
        use x128::{U8, U32};
        if isa::Isa::HAS_SINGLE_CYCLE_OPS {
            for stripe in stripes {
                let words = Vector::load4(stripe.as_chunks().0.as_array().unwrap());
                for (acc, word) in acc.iter_mut().zip(words) {
                    let product = u32::from_le_bytes(word.to_array()).wrapping_mul(PRIME32_2);
                    let rotated = acc.wrapping_add(product).rotate_left(13);
                    // x86-64 takes 10 cycles to multiply in a vector.
                    *acc = opaque(rotated.wrapping_mul(PRIME32_1).into()) as u32;
                }
            }
            return acc;
        }
        let splat = |it| U32::splat(it).opaque();
        let (prime_1, shifted, prime_2) =
            (splat(PRIME32_1), splat(PRIME32_1 << 13), splat(PRIME32_2));
        let product = |stripe| (U8::load(stripe).bitcast::<U32>() * prime_2).opaque();
        // The two parts of the rotation are multiplied side by side.
        let round = |sum: U32, next: U32| (next + sum * shifted).opaque() + (sum >> 19) * prime_1;
        let Some((first, rest)) = stripes.split_first() else {
            return acc;
        };
        let mut sum = product(first) + Vector::from_array(acc);
        #[rustc_unroll(2)]
        for stripe in rest {
            sum = round(sum, product(stripe));
        }
        round(sum, Vector::zero()).to_array()
    }

    #[inline(always)]
    fn hash32(seed: u32, input: &[impl Byte]) -> u32 {
        let (stripes, rest) = input.as_chunks::<16>();
        let mut hash = seed.wrapping_add(PRIME32_5);
        if !stripes.is_empty() {
            let (b, d) = (seed.wrapping_add(PRIME32_2), seed.wrapping_sub(PRIME32_1));
            let [a, b, c, d] = accumulate32([b.wrapping_add(PRIME32_1), b, seed, d], stripes);
            hash = (a.rotate_left(1).wrapping_add(b.rotate_left(7)))
                .wrapping_add(c.rotate_left(12).wrapping_add(d.rotate_left(18)));
        }
        hash = hash.wrapping_add(input.len() as u32);
        let (words, bytes) = rest.as_chunks::<4>();
        #[rustc_unroll(never)]
        for word in words {
            hash = hash.wrapping_add(u32_at(word, 0).wrapping_mul(PRIME32_3));
            hash = hash.rotate_left(17).wrapping_mul(PRIME32_4);
        }
        #[rustc_unroll(never)]
        for byte in bytes {
            hash = hash.wrapping_add(u32::from(byte.get()).wrapping_mul(PRIME32_5));
            hash = hash.rotate_left(11).wrapping_mul(PRIME32_1);
        }
        hash = (hash ^ hash >> 15).wrapping_mul(PRIME32_2);
        hash = (hash ^ hash >> 13).wrapping_mul(PRIME32_3);
        hash ^ hash >> 16
    }

    #[export(baseline)]
    pub fn xxhash32(seed: u32, input: &[u8]) -> u32 {
        hash32(seed, input)
    }

    #[export(baseline)]
    pub fn xxhash32_shared(seed: u32, input: &[SharedU8]) -> u32 {
        hash32(seed, input)
    }

    #[inline(always)]
    fn accumulate64(mut acc: [u64; 4], stripes: &[[impl Byte; 32]]) -> [u64; 4] {
        for stripe in stripes {
            let words = Vector::load4(stripe.as_chunks().0.as_array().unwrap());
            for (acc, word) in acc.iter_mut().zip(words) {
                *acc = round64(*acc, u64::from_le_bytes(word.to_array()));
            }
        }
        acc
    }

    /// `rest` follows the last whole stripe.
    #[inline(always)]
    fn finish64(mut hash: u64, rest: &[impl Byte]) -> u64 {
        let (words, mut bytes) = rest.as_chunks::<8>();
        #[rustc_unroll(never)]
        for word in words {
            hash = (hash ^ round64(0, u64_at(word, 0))).rotate_left(27);
            hash = hash.wrapping_mul(PRIME64_1).wrapping_add(PRIME64_4);
        }
        if let Some((word, after)) = bytes.split_first_chunk::<4>() {
            hash ^= u64::from(u32_at(word, 0)).wrapping_mul(PRIME64_1);
            hash = hash
                .rotate_left(23)
                .wrapping_mul(PRIME64_2)
                .wrapping_add(PRIME64_3);
            bytes = after;
        }
        #[rustc_unroll(never)]
        for byte in bytes {
            hash ^= u64::from(byte.get()).wrapping_mul(PRIME64_5);
            hash = hash.rotate_left(11).wrapping_mul(PRIME64_1);
        }
        avalanche64(hash)
    }

    #[inline(always)]
    fn hash64(seed: u64, input: &[impl Byte]) -> u64 {
        let (stripes, rest) = input.as_chunks();
        let hash = match stripes {
            [] => seed.wrapping_add(PRIME64_5),
            _ => merge64(accumulate64(XxHash64State::new(seed).acc, stripes)),
        };
        finish64(hash.wrapping_add(input.len() as u64), rest)
    }

    #[export(baseline)]
    pub fn xxhash64(seed: u64, input: &[u8]) -> u64 {
        hash64(seed, input)
    }

    #[export(baseline)]
    pub fn xxhash64_shared(seed: u64, input: &[SharedU8]) -> u64 {
        hash64(seed, input)
    }

    #[export(baseline)]
    pub fn update(state: &mut XxHash64State, mut input: &[u8]) {
        let room = &mut state.pending[state.len as usize % 32..];
        state.len += input.len() as u64;
        let Some((first, after)) = input.split_at_checked(room.len()) else {
            return room[..input.len()].copy_from_slice(input);
        };
        if room.len() < 32 {
            room.copy_from_slice(first);
            (state.acc, input) = (accumulate64(state.acc, &[state.pending]), after);
        }
        let (stripes, rest) = input.as_chunks();
        state.acc = accumulate64(state.acc, stripes);
        state.pending[..rest.len()].copy_from_slice(rest);
    }

    #[export(baseline)]
    pub fn digest(state: &XxHash64State) -> u64 {
        let hash = match state.len {
            ..32 => state.acc[2].wrapping_add(PRIME64_5),
            _ => merge64(state.acc),
        };
        finish64(
            hash.wrapping_add(state.len),
            &state.pending[..state.len as usize % 32],
        )
    }
}

#[inline(always)]
fn folded_mul(a: u64, b: u64) -> u64 {
    let product = u128::from(a) * u128::from(b);
    product as u64 ^ (product >> 64) as u64
}

#[inline(always)]
fn avalanche3(mut hash: u64) -> u64 {
    hash = (hash ^ hash >> 37).wrapping_mul(PRIME_MX1);
    hash ^ hash >> 32
}

#[inline(always)]
fn avalanche64(mut hash: u64) -> u64 {
    hash = (hash ^ hash >> 33).wrapping_mul(PRIME64_2);
    hash = (hash ^ hash >> 29).wrapping_mul(PRIME64_3);
    hash ^ hash >> 32
}

#[inline(never)]
fn hash_long_with_seed(seed: u64, input: &[SharedU8]) -> u64 {
    let mut secret = SECRET;
    for (i, word) in secret.as_chunks_mut().0.iter_mut().enumerate() {
        let seed = if i % 2 == 0 {
            seed
        } else {
            seed.wrapping_neg()
        };
        *word = u64::from_le_bytes(*word).wrapping_add(seed).to_le_bytes();
    }
    simd::hash_long(input, &secret)
}

#[inline(always)]
fn round64(acc: u64, input: u64) -> u64 {
    // With `madd`, the product would wait for `acc`.
    let sum = acc.wrapping_add(opaque(input.wrapping_mul(PRIME64_2)));
    sum.rotate_left(31).wrapping_mul(PRIME64_1)
}

#[inline(always)]
fn merge64(acc: [u64; 4]) -> u64 {
    let rotated = acc
        .iter()
        .zip([1, 7, 12, 18])
        .map(|(acc, by)| acc.rotate_left(by));
    let mut hash = rotated.fold(0, u64::wrapping_add);
    for lane in acc {
        hash = (hash ^ round64(0, lane))
            .wrapping_mul(PRIME64_1)
            .wrapping_add(PRIME64_4);
    }
    hash
}

/// `xxhash64` of an input that comes in parts.
pub struct XxHash64State {
    acc: [u64; 4],
    len: u64,
    /// Starts with what follows the last whole stripe.
    pending: [u8; 32],
}

impl XxHash64State {
    #[inline]
    pub fn new(seed: u64) -> Self {
        let from_seed = [
            PRIME64_1.wrapping_add(PRIME64_2),
            PRIME64_2,
            0,
            PRIME64_1.wrapping_neg(),
        ];
        Self {
            acc: from_seed.map(|it| it.wrapping_add(seed)),
            len: 0,
            pending: [0; 32],
        }
    }

    #[inline]
    pub fn update(&mut self, input: &[u8]) {
        simd::update(self, input);
    }

    #[inline]
    pub fn digest(&self) -> u64 {
        simd::digest(self)
    }
}
