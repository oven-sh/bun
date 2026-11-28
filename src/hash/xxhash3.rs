//! XXH3 of xxHash. Bit-identical to the reference, which has the constants: <https://github.com/Cyan4973/xxHash/blob/v0.8.2/xxhash.h>.

use bun_simd::prelude::*;
use core::sync::atomic::{AtomicU64, Ordering::Relaxed};

use super::xxhash::{PRIME32, PRIME64, avalanche64};

const PRIME_MX: [u64; 2] = [0x165667919E3779F9, 0x9FB21C651E98DF25];

type Secret = [u8; 192];
/// So that no load crosses a page.
#[repr(align(256))]
struct InPage(Secret);
#[rustfmt::skip]
const SECRET: &Secret = &InPage([
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
]).0;

/// The start of the secret, which the compiler has to load. Constants in the code are slower.
#[used]
static WORDS: [AtomicU64; 16] = {
    let (mut words, mut i) = ([const { AtomicU64::new(0) }; 16], 0);
    while i < 16 {
        words[i] = AtomicU64::new(u64::from_le_bytes(SECRET.as_chunks().0[i]));
        i += 1;
    }
    words
};

fn read32(bytes: &[u8], at: usize) -> u64 {
    u32::from_le_bytes(*bytes[at..].first_chunk().unwrap()) as u64
}
fn read64(bytes: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(*bytes[at..].first_chunk().unwrap())
}
fn fold(a: u64, b: u64) -> u64 {
    let product = a as u128 * b as u128;
    product as u64 ^ (product >> 64) as u64
}
fn avalanche(h: u64) -> u64 {
    let h = (h ^ h >> 37).wrapping_mul(PRIME_MX[0]);
    h ^ h >> 32
}
fn mix16(input: &[u8], at: usize, secret_at: usize, seed: u64) -> u64 {
    fold(
        read64(input, at) ^ read64(SECRET, secret_at).wrapping_add(seed),
        read64(input, at + 8) ^ read64(SECRET, secret_at + 8).wrapping_sub(seed),
    )
}
fn mix_ends(input: &[u8], i: usize, seed: u64) -> u64 {
    let mix = |at: usize, word: usize| {
        fold(
            read64(input, at) ^ WORDS[word].load(Relaxed).wrapping_add(seed),
            read64(input, at + 8) ^ WORDS[word + 1].load(Relaxed).wrapping_sub(seed),
        )
    };
    let from_end = mix(input.len() - 16 * (i + 1), 4 * i + 2);
    mix(16 * i, 4 * i).wrapping_add(from_end)
}

#[simd]
type Accumulators = u64x8<S>;

/// Each word is added to the accumulator next to its own, which can wait until they are summed up.
#[simd]
fn accumulate(acc: Accumulators<S>, stripes: &[[u8; 64]], secret: &[u8]) -> Accumulators<S> {
    let (mut products, mut words) = (acc, u64x8::zero());
    let mut add = |i: usize| {
        let data = u64x8::load_bytes(&stripes[i]);
        let keyed = (data ^ u64x8::load_bytes(&secret[8 * i..])).bitcast::<u32>();
        products += keyed.widening_mul_even_odd(keyed);
        words += data;
    };
    if Native::<S>::BYTES == 64 && stripes.len() == 16 {
        // There are registers for all of the secret.
        unroll!(for i in 0..16 {
            add(i)
        });
    } else {
        for i in 0..stripes.len() {
            add(i);
        }
    }
    products + words.swap_pairs()
}

#[simd]
fn scramble(acc: Accumulators<S>, secret: &Secret) -> Accumulators<S> {
    let prime = PRIME32[0];
    let acc = acc ^ acc >> 47 ^ u64x8::load_bytes(&secret[128..]);
    acc.bitcast::<u32>().widening_mul_even(prime)
        + ((acc >> 32).bitcast::<u32>().widening_mul_even(prime) << 32)
}

#[kernel]
fn hash_long(input: &[u8], secret: &Secret) -> u64 {
    let ([x, y, z, ..], [a, b, c, d, e]) = (PRIME32, PRIME64);
    let mut acc = u64x8::from([z.into(), a, b, c, d, y.into(), e, x.into()]);
    let (Some(last), Some((_, all_but_one))) = (input.last_chunk(), input.split_last()) else {
        return 0;
    };
    let (blocks, stripes) = all_but_one.as_chunks::<64>().0.as_chunks::<16>();
    for block in blocks {
        acc = scramble(accumulate(acc, block, secret), secret);
    }
    let acc = accumulate(acc, &stripes[..stripes.len() % 16], secret);
    let acc = accumulate(acc, &[*last], &secret[192 - 64 - 7..]).to_array();
    let mut hash = (input.len() as u64).wrapping_mul(a);
    for i in 0..4 {
        let at = 11 + 16 * i;
        hash = hash.wrapping_add(fold(
            acc[2 * i] ^ read64(secret, at),
            acc[2 * i + 1] ^ read64(secret, at + 8),
        ));
    }
    avalanche(hash)
}

/// Apart, so that shorter inputs do not save the registers that these take.
#[inline(never)]
fn hash_above_128(seed: u64, input: &[u8]) -> u64 {
    let (len, len64) = (input.len(), input.len() as u64);
    if (129..=240).contains(&len) {
        let acc = (0..8).fold(len64.wrapping_mul(PRIME64[0]), |acc, i| {
            acc.wrapping_add(mix16(input, 16 * i, 16 * i, seed))
        });
        let end = mix16(input, len - 16, 136 - 17, seed);
        let end = (8..len / 16).fold(end, |acc, i| {
            acc.wrapping_add(mix16(input, 16 * i, 16 * (i - 8) + 3, seed))
        });
        avalanche(avalanche(acc).wrapping_add(end))
    } else if seed == 0 {
        hash_long(input, SECRET)
    } else {
        let mut secret = *SECRET;
        for [low, high] in secret.as_chunks_mut::<8>().0.as_chunks_mut().0 {
            *low = u64::from_le_bytes(*low).wrapping_add(seed).to_le_bytes();
            *high = u64::from_le_bytes(*high).wrapping_sub(seed).to_le_bytes();
        }
        hash_long(input, &secret)
    }
}

/// `XXH3_64bits_withSeed`.
pub fn xxhash3_64(seed: u64, input: &[u8]) -> u64 {
    let (len, len64) = (input.len(), input.len() as u64);
    let key = |at| read64(SECRET, at) ^ read64(SECRET, at + 8);
    if len > 128 {
        hash_above_128(seed, input)
    } else if len > 16 {
        let mut acc = len64
            .wrapping_mul(PRIME64[0])
            .wrapping_add(mix_ends(input, 0, seed));
        if len > 32 {
            acc = acc.wrapping_add(mix_ends(input, 1, seed));
            if len > 64 {
                acc = acc.wrapping_add(mix_ends(input, 2, seed));
                if len > 96 {
                    acc = acc.wrapping_add(mix_ends(input, 3, seed));
                }
            }
        }
        avalanche(acc)
    } else if len > 8 {
        let low = read64(input, 0) ^ key(24).wrapping_add(seed);
        let high = read64(input, len - 8) ^ key(40).wrapping_sub(seed);
        avalanche(
            len64
                .wrapping_add(low.swap_bytes())
                .wrapping_add(high)
                .wrapping_add(fold(low, high)),
        )
    } else if len >= 4 {
        let seed = seed ^ ((seed as u32).swap_bytes() as u64) << 32;
        let h = (read32(input, len - 4) + (read32(input, 0) << 32)) ^ key(8).wrapping_sub(seed);
        let h = (h ^ h.rotate_left(49) ^ h.rotate_left(24)).wrapping_mul(PRIME_MX[1]);
        let h = (h ^ ((h >> 35) + len64)).wrapping_mul(PRIME_MX[1]);
        h ^ h >> 28
    } else if len != 0 {
        let [a, b, c] = [input[0], input[len >> 1], input[len - 1]].map(u64::from);
        avalanche64(
            (a << 16 | b << 24 | c | len64 << 8)
                ^ (read32(SECRET, 0) ^ read32(SECRET, 4)).wrapping_add(seed),
        )
    } else {
        avalanche64(seed ^ key(56))
    }
}
