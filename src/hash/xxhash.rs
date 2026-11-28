//! XXH32 and XXH64 of xxHash, which have no vector form. Bit-identical to the reference, version 0.8.2.
//!
//! `HashObject.rs` exposes these, which have a `(seed, bytes)`
//! signature (seed first, unlike Murmur/CityHash).

pub(crate) const PRIME32: [u32; 5] = [0x9E3779B1, 0x85EBCA77, 0xC2B2AE3D, 0x27D4EB2F, 0x165667B1];
pub(crate) const PRIME64: [u64; 5] = [
    0x9E3779B185EBCA87,
    0xC2B2AE3D27D4EB4F,
    0x165667B19E3779F9,
    0x85EBCA77C2B2AE63,
    0x27D4EB2F165667C5,
];

pub struct XxHash32;

impl XxHash32 {
    pub fn hash(seed: u32, input: &[u8]) -> u32 {
        let [p1, p2, p3, p4, p5] = PRIME32;
        let (stripes, rest) = input.as_chunks::<16>();
        let mut h = if stripes.is_empty() {
            seed.wrapping_add(p5)
        } else {
            let mut v =
                [p1.wrapping_add(p2), p2, 0, p1.wrapping_neg()].map(|x| seed.wrapping_add(x));
            for stripe in stripes {
                for (v, &word) in v.iter_mut().zip(stripe.as_chunks().0) {
                    let product = u32::from_le_bytes(word).wrapping_mul(p2);
                    *v = v.wrapping_add(product).rotate_left(13).wrapping_mul(p1);
                }
            }
            (v[0].rotate_left(1).wrapping_add(v[1].rotate_left(7)))
                .wrapping_add(v[2].rotate_left(12).wrapping_add(v[3].rotate_left(18)))
        };
        h = h.wrapping_add(input.len() as u32);
        let (words, bytes) = rest.as_chunks();
        for &word in words {
            bun_simd::not_unrolled();
            let product = u32::from_le_bytes(word).wrapping_mul(p3);
            h = h.wrapping_add(product).rotate_left(17).wrapping_mul(p4);
        }
        for &byte in bytes {
            bun_simd::not_unrolled();
            let product = u32::from(byte).wrapping_mul(p5);
            h = h.wrapping_add(product).rotate_left(11).wrapping_mul(p1);
        }
        h = (h ^ h >> 15).wrapping_mul(p2);
        h = (h ^ h >> 13).wrapping_mul(p3);
        h ^ h >> 16
    }
}

const STRIPE: usize = 32;
type Accumulators = [u64; 4];

#[inline(always)]
fn round(acc: u64, word: u64) -> u64 {
    acc.wrapping_add(word.wrapping_mul(PRIME64[1]))
        .rotate_left(31)
        .wrapping_mul(PRIME64[0])
}

#[inline(always)]
fn start(seed: u64) -> Accumulators {
    let [p1, p2, ..] = PRIME64;
    [p1.wrapping_add(p2), p2, 0, p1.wrapping_neg()].map(|x| seed.wrapping_add(x))
}

#[inline(always)]
fn accumulate(mut v: Accumulators, stripes: &[[u8; STRIPE]]) -> Accumulators {
    for stripe in stripes {
        for (v, &word) in v.iter_mut().zip(stripe.as_chunks().0) {
            *v = round(*v, u64::from_le_bytes(word));
        }
    }
    v
}

#[inline(always)]
fn merge(v: Accumulators) -> u64 {
    let h = (v[0].rotate_left(1).wrapping_add(v[1].rotate_left(7)))
        .wrapping_add(v[2].rotate_left(12).wrapping_add(v[3].rotate_left(18)));
    v.into_iter().fold(h, |h, v| {
        (h ^ round(0, v))
            .wrapping_mul(PRIME64[0])
            .wrapping_add(PRIME64[3])
    })
}

#[inline(always)]
pub(crate) fn avalanche64(h: u64) -> u64 {
    let h = (h ^ h >> 33).wrapping_mul(PRIME64[1]);
    let h = (h ^ h >> 29).wrapping_mul(PRIME64[2]);
    h ^ h >> 32
}

/// `rest` is less than a stripe.
#[inline(always)]
fn finish(mut h: u64, rest: &[u8]) -> u64 {
    let [p1, p2, p3, p4, p5] = PRIME64;
    let (words, mut rest) = rest.as_chunks();
    for i in 0..STRIPE / 8 - 1 {
        let Some(&word) = words.get(i) else { break };
        h ^= round(0, u64::from_le_bytes(word));
        h = h.rotate_left(27).wrapping_mul(p1).wrapping_add(p4);
    }
    if let Some((&word, bytes)) = rest.split_first_chunk() {
        h ^= u64::from(u32::from_le_bytes(word)).wrapping_mul(p1);
        h = h.rotate_left(23).wrapping_mul(p2).wrapping_add(p3);
        rest = bytes;
    }
    for &byte in rest {
        bun_simd::not_unrolled();
        h ^= u64::from(byte).wrapping_mul(p5);
        h = h.rotate_left(11).wrapping_mul(p1);
    }
    avalanche64(h)
}

pub struct XxHash64;

impl XxHash64 {
    pub fn hash(seed: u64, input: &[u8]) -> u64 {
        let (stripes, rest) = input.as_chunks();
        let h = if stripes.is_empty() {
            seed.wrapping_add(PRIME64[4])
        } else {
            merge(accumulate(start(seed), stripes))
        };
        finish(h.wrapping_add(input.len() as u64), rest)
    }
}

/// Streaming XxHash64 — used by the bundler's `ContentHasher`
/// (length-prefixed chunk hashing across many `update()` calls before a single
/// `digest()`), plus the dev-server source-map hash and the resolver stat hash.
pub struct XxHash64Streaming {
    total_len: u64,
    accumulators: Accumulators,
    /// Starts with the last `total_len % STRIPE` bytes.
    pending: [u8; STRIPE],
}

impl XxHash64Streaming {
    #[inline]
    pub fn new(seed: u64) -> Self {
        Self {
            total_len: 0,
            accumulators: start(seed),
            pending: [0; STRIPE],
        }
    }

    #[inline(always)]
    fn pending_len(&self) -> usize {
        self.total_len as usize % STRIPE
    }

    #[inline]
    pub fn update(&mut self, bytes: &[u8]) {
        let pending_len = self.pending_len();
        self.total_len = self.total_len.wrapping_add(bytes.len() as u64);
        let room = &mut self.pending[pending_len..];
        if bytes.len() < room.len() {
            room[..bytes.len()].copy_from_slice(bytes);
        } else {
            self.update_stripes(pending_len, bytes);
        }
    }

    /// There are enough `bytes` to complete what is pending.
    fn update_stripes(&mut self, pending_len: usize, mut bytes: &[u8]) {
        let mut v = self.accumulators;
        if pending_len != 0 {
            let (first, rest) = bytes.split_at(STRIPE - pending_len);
            self.pending[pending_len..].copy_from_slice(first);
            v = accumulate(v, &[self.pending]);
            bytes = rest;
        }
        let (stripes, rest) = bytes.as_chunks();
        self.accumulators = accumulate(v, stripes);
        self.pending[..rest.len()].copy_from_slice(rest);
    }

    pub fn digest(&self) -> u64 {
        let h = if self.total_len >= STRIPE as u64 {
            merge(self.accumulators)
        } else {
            // Before the first stripe, the third accumulator is the seed.
            self.accumulators[2].wrapping_add(PRIME64[4])
        };
        finish(
            h.wrapping_add(self.total_len),
            &self.pending[..self.pending_len()],
        )
    }
}

impl Default for XxHash64Streaming {
    #[inline]
    fn default() -> Self {
        Self::new(0)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use bun_simd::target::Target;

    use super::*;
    use crate::verify::{smhasher_32, smhasher_64};
    use crate::xxhash3_64;

    fn sample(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 191 + 17) as u8).collect()
    }

    #[test]
    fn smhasher() {
        let hash32 = |bytes: &[u8], seed| XxHash32::hash(seed, bytes);
        let hash64 = |bytes: &[u8], seed| XxHash64::hash(seed, bytes);
        assert_eq!(smhasher_32(hash32), 0xBA88B743);
        assert_eq!(smhasher_64(hash64), 0x024B7CF4);
        assert_eq!(
            smhasher_64(|bytes, seed| xxhash3_64(seed, bytes)),
            0x9A636405
        );
    }

    #[test]
    fn pieces_hash_like_the_whole() {
        let bytes = sample(200);
        for piece in [1, 7, 31, 32, 33, 70] {
            let (mut state, mut len) = (XxHash64Streaming::new(42), 0);
            for piece in bytes.chunks(piece) {
                state.update(&[]);
                assert_eq!(state.digest(), XxHash64::hash(42, &bytes[..len]));
                state.update(piece);
                len += piece.len();
            }
            assert_eq!(state.digest(), XxHash64::hash(42, &bytes));
        }
    }

    /// The hash of all hashes is from the reference.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn sums_with_the_seed_wrap_around() {
        #[allow(unsafe_code)]
        unsafe extern "C" {
            fn bun_hash_xxhash3_64(input: *const u8, len: usize, seed: u64) -> u64;
        }
        let bytes = sample(1100);
        for (seed, expected) in [
            (u64::MAX, 0x3EE7003CED1758B1),
            (0xF00000F0F00000F1, 0x919DC4D7452EB056),
        ] {
            let mut all = XxHash64Streaming::default();
            for bytes in (0..260).chain([1100]).map(|len| &bytes[..len]) {
                let mut state = XxHash64Streaming::new(seed);
                state.update(bytes);
                assert_eq!(state.digest(), XxHash64::hash(seed, bytes));
                let start = bytes.first().map_or(core::ptr::null(), |_| bytes.as_ptr());
                #[allow(unsafe_code)]
                // SAFETY: a slice.
                let hash3 = unsafe { bun_hash_xxhash3_64(start, bytes.len(), seed) };
                let hash32 = XxHash32::hash(seed as u32, bytes).into();
                for hash in [hash32, state.digest(), hash3] {
                    all.update(&hash.to_le_bytes());
                }
            }
            assert_eq!(all.digest(), expected);
        }

        // The length is added to the largest number.
        let mut state = XxHash64Streaming::new(!PRIME64[4]);
        state.update(b"abc");
        assert_eq!(state.digest(), 0x542CD97037CF3C0E);
        assert_eq!(XxHash64::hash(!PRIME64[4], b"abc"), 0x542CD97037CF3C0E);
        assert_eq!(XxHash32::hash(!PRIME32[4], b"abc"), 0x2C0C05CB);
        assert_eq!(xxhash3_64(0x987D8C8415BDC646, &[0; 9]), 0x2694D3A6C4EED9F0);
    }

    pub(crate) fn long_xxhash3(target: Target) {
        let bytes = sample(4096);
        for (len, seed, hash) in [
            (241, 0, 0xDC3FC1135592D6E6),
            (513, 42, 0xAB3F1CF78B260C6F),
            (1024, 0, 0xA9E2EEE0215AA4E9),
            (1025, 2882400001, 0xC39418C639C2FAB2),
            (4096, 0, 0xA8E6A7A23C5B3935),
        ] {
            assert_eq!(xxhash3_64(seed, &bytes[..len]), hash, "{target:?} {len}");
        }
    }
}
