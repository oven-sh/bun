//! Port of the long-input loop of xxhash3.cpp. The constants are those of xxHash.
use core::slice;

const PRIME32_1: u64 = 0x9E3779B1;
const PRIME64_1: u64 = 0x9E3779B185EBCA87;
const INIT: [u64; 8] = [
    0xC2B2AE3D,
    PRIME64_1,
    0xC2B2AE3D27D4EB4F,
    0x165667B19E3779F9,
    0x85EBCA77C2B2AE63,
    0x85EBCA77,
    0x27D4EB2F165667C5,
    PRIME32_1,
];
pub(crate) static SECRET: [u8; 192] = [
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
pub(crate) mod simd {
    use isa::{U8, U64};

    /// For up to 16 stripes, `K` per iteration.
    #[inline(always)]
    fn accumulate<const K: usize>(acc: &mut [u64; 8], stripes: &[[u8; 64]], secret: &[u8]) {
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
        let prime = U64::splat(PRIME32_1);
        for (acc, key) in acc.as_chunks_mut().0.iter_mut().zip(secret.as_chunks().0) {
            let a = U64::load(acc);
            let a = a ^ a >> 47 ^ U8::load(key).bitcast::<U64>();
            let high = (a >> 32)
                .mul_low32(prime)
                .bitcast::<U8>()
                .lookup(U8::repeat_16(UP_BY_32));
            (a.mul_low32(prime) + high.bitcast::<U64>()).store(acc);
        }
    }

    /// For more than 240 bytes.
    #[export]
    pub fn hash_long(input: &[u8], secret: &[u8; 192]) -> Option<u64> {
        let (mut acc, last) = (INIT, input.split_last_chunk()?.1);
        let (blocks, rest) = input[..input.len() - 1].as_chunks::<1024>();
        for block in blocks {
            accumulate::<{ U8::LEN / 8 }>(&mut acc, block.as_chunks().0, secret);
            scramble(&mut acc, secret.last_chunk()?);
        }
        accumulate::<1>(&mut acc, rest.as_chunks().0, secret);
        accumulate::<1>(&mut acc, slice::from_ref(last), &secret[128 - 7..]);

        let mut h = (input.len() as u64).wrapping_mul(PRIME64_1);
        for (pair, key) in acc
            .as_chunks::<2>()
            .0
            .iter()
            .zip(secret[11..].as_chunks::<16>().0)
        {
            let [k0, k1] = [
                u64::from_le_bytes(*key.first_chunk().unwrap()),
                u64::from_le_bytes(*key.last_chunk().unwrap()),
            ];
            let product = u128::from(pair[0] ^ k0) * u128::from(pair[1] ^ k1);
            h = h.wrapping_add(product as u64 ^ (product >> 64) as u64);
        }
        h ^= h >> 37;
        h = h.wrapping_mul(0x165667919E3779F9);
        Some(h ^ (h >> 32))
    }
}
