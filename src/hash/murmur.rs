//! MurmurHash family.
//!
//! Ported from `vendor/zig/lib/std/hash/murmur.zig`. `HashObject.zig` exposes
//! these via `hashWrap`, which dispatches to `hashWithSeed(str, seed)` (the
//! `(bytes, seed)` argument order — note the seed comes *second*, unlike
//! XxHash). The default seed is `0xc70f6907`.
//!
//! The Zig version reads `len` as `@truncate(str.len)` (a `u32` truncation) for
//! the 32-bit variants; we preserve that quirk so > 4 GiB inputs hash
//! identically.

const DEFAULT_SEED: u32 = 0xc70f6907;

#[inline(always)]
fn read_u32_le(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

#[inline(always)]
fn read_u64_le(b: &[u8]) -> u64 {
    u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}

// ──────────────────────────────────────────────────────────────────────────
// Murmur2_32
// ──────────────────────────────────────────────────────────────────────────

pub struct Murmur2_32;

impl Murmur2_32 {
    #[inline]
    pub fn hash(str: &[u8]) -> u32 {
        Self::hash_with_seed(str, DEFAULT_SEED)
    }

    pub fn hash_with_seed(str: &[u8], seed: u32) -> u32 {
        const M: u32 = 0x5bd1e995;
        let len: u32 = str.len() as u32; // @truncate
        let mut h1: u32 = seed ^ len;

        let mut i: usize = 0;
        let blocks = (len >> 2) as usize;
        while i < blocks {
            let mut k1 = read_u32_le(&str[i * 4..]);
            k1 = k1.wrapping_mul(M);
            k1 ^= k1 >> 24;
            k1 = k1.wrapping_mul(M);
            h1 = h1.wrapping_mul(M);
            h1 ^= k1;
            i += 1;
        }

        let offset = (len & 0xfffffffc) as usize;
        let rest = len & 3;
        if rest >= 3 {
            h1 ^= (str[offset + 2] as u32) << 16;
        }
        if rest >= 2 {
            h1 ^= (str[offset + 1] as u32) << 8;
        }
        if rest >= 1 {
            h1 ^= str[offset] as u32;
            h1 = h1.wrapping_mul(M);
        }
        h1 ^= h1 >> 13;
        h1 = h1.wrapping_mul(M);
        h1 ^= h1 >> 15;
        h1
    }

    #[inline]
    pub fn hash_uint32(v: u32) -> u32 {
        Self::hash_uint32_with_seed(v, DEFAULT_SEED)
    }

    pub fn hash_uint32_with_seed(v: u32, seed: u32) -> u32 {
        const M: u32 = 0x5bd1e995;
        let len: u32 = 4;
        let mut h1: u32 = seed ^ len;
        let mut k1 = v.wrapping_mul(M);
        k1 ^= k1 >> 24;
        k1 = k1.wrapping_mul(M);
        h1 = h1.wrapping_mul(M);
        h1 ^= k1;
        h1 ^= h1 >> 13;
        h1 = h1.wrapping_mul(M);
        h1 ^= h1 >> 15;
        h1
    }

    #[inline]
    pub fn hash_uint64(v: u64) -> u32 {
        Self::hash_uint64_with_seed(v, DEFAULT_SEED)
    }

    pub fn hash_uint64_with_seed(v: u64, seed: u32) -> u32 {
        const M: u32 = 0x5bd1e995;
        let len: u32 = 8;
        let mut h1: u32 = seed ^ len;
        let mut k1 = (v as u32).wrapping_mul(M);
        k1 ^= k1 >> 24;
        k1 = k1.wrapping_mul(M);
        h1 = h1.wrapping_mul(M);
        h1 ^= k1;
        k1 = ((v >> 32) as u32).wrapping_mul(M);
        k1 ^= k1 >> 24;
        k1 = k1.wrapping_mul(M);
        h1 = h1.wrapping_mul(M);
        h1 ^= k1;
        h1 ^= h1 >> 13;
        h1 = h1.wrapping_mul(M);
        h1 ^= h1 >> 15;
        h1
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Murmur2_64
// ──────────────────────────────────────────────────────────────────────────

pub struct Murmur2_64;

impl Murmur2_64 {
    #[inline]
    pub fn hash(str: &[u8]) -> u64 {
        Self::hash_with_seed(str, DEFAULT_SEED as u64)
    }

    pub fn hash_with_seed(str: &[u8], seed: u64) -> u64 {
        const M: u64 = 0xc6a4a7935bd1e995;
        let mut h1: u64 = seed ^ (str.len() as u64).wrapping_mul(M);

        let blocks = str.len() / 8;
        let mut i: usize = 0;
        while i < blocks {
            let mut k1 = read_u64_le(&str[i * 8..]);
            k1 = k1.wrapping_mul(M);
            k1 ^= k1 >> 47;
            k1 = k1.wrapping_mul(M);
            h1 ^= k1;
            h1 = h1.wrapping_mul(M);
            i += 1;
        }

        let rest = str.len() & 7;
        let offset = str.len() - rest;
        if rest > 0 {
            // Zig: @memcpy into the low bytes of a u64 then read native-endian,
            // byte-swapping on big-endian — i.e. a little-endian load of `rest`
            // bytes zero-extended to u64.
            let mut buf = [0u8; 8];
            buf[..rest].copy_from_slice(&str[offset..]);
            let k1 = u64::from_le_bytes(buf);
            h1 ^= k1;
            h1 = h1.wrapping_mul(M);
        }
        h1 ^= h1 >> 47;
        h1 = h1.wrapping_mul(M);
        h1 ^= h1 >> 47;
        h1
    }

    #[inline]
    pub fn hash_uint32(v: u32) -> u64 {
        Self::hash_uint32_with_seed(v, DEFAULT_SEED as u64)
    }

    pub fn hash_uint32_with_seed(v: u32, seed: u64) -> u64 {
        const M: u64 = 0xc6a4a7935bd1e995;
        let len: u64 = 4;
        let mut h1: u64 = seed ^ len.wrapping_mul(M);
        let k1: u64 = v as u64;
        h1 ^= k1;
        h1 = h1.wrapping_mul(M);
        h1 ^= h1 >> 47;
        h1 = h1.wrapping_mul(M);
        h1 ^= h1 >> 47;
        h1
    }

    #[inline]
    pub fn hash_uint64(v: u64) -> u64 {
        Self::hash_uint64_with_seed(v, DEFAULT_SEED as u64)
    }

    pub fn hash_uint64_with_seed(v: u64, seed: u64) -> u64 {
        const M: u64 = 0xc6a4a7935bd1e995;
        let len: u64 = 8;
        let mut h1: u64 = seed ^ len.wrapping_mul(M);
        let mut k1 = v.wrapping_mul(M);
        k1 ^= k1 >> 47;
        k1 = k1.wrapping_mul(M);
        h1 ^= k1;
        h1 = h1.wrapping_mul(M);
        h1 ^= h1 >> 47;
        h1 = h1.wrapping_mul(M);
        h1 ^= h1 >> 47;
        h1
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Murmur3_32
// ──────────────────────────────────────────────────────────────────────────

/// Murmur3 32-bit finalizer (avalanche mix). Shared with `CityHash32::fmix`.
#[inline(always)]
pub(crate) fn fmix32(mut h: u32) -> u32 {
    h ^= h >> 16;
    h = h.wrapping_mul(0x85ebca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2ae35);
    h ^ (h >> 16)
}

pub struct Murmur3_32;

impl Murmur3_32 {
    #[inline(always)]
    fn rotl32(x: u32, r: u32) -> u32 {
        x.rotate_left(r)
    }

    #[inline]
    pub fn hash(str: &[u8]) -> u32 {
        Self::hash_with_seed(str, DEFAULT_SEED)
    }

    pub fn hash_with_seed(str: &[u8], seed: u32) -> u32 {
        const C1: u32 = 0xcc9e2d51;
        const C2: u32 = 0x1b873593;
        let len: u32 = str.len() as u32; // @truncate
        let mut h1: u32 = seed;

        let blocks = (len >> 2) as usize;
        let mut i: usize = 0;
        while i < blocks {
            let mut k1 = read_u32_le(&str[i * 4..]);
            k1 = k1.wrapping_mul(C1);
            k1 = Self::rotl32(k1, 15);
            k1 = k1.wrapping_mul(C2);
            h1 ^= k1;
            h1 = Self::rotl32(h1, 13);
            h1 = h1.wrapping_mul(5).wrapping_add(0xe6546b64);
            i += 1;
        }

        {
            let mut k1: u32 = 0;
            let offset = (len & 0xfffffffc) as usize;
            let rest = len & 3;
            if rest == 3 {
                k1 ^= (str[offset + 2] as u32) << 16;
            }
            if rest >= 2 {
                k1 ^= (str[offset + 1] as u32) << 8;
            }
            if rest >= 1 {
                k1 ^= str[offset] as u32;
                k1 = k1.wrapping_mul(C1);
                k1 = Self::rotl32(k1, 15);
                k1 = k1.wrapping_mul(C2);
                h1 ^= k1;
            }
        }

        h1 ^= len;
        fmix32(h1)
    }

    #[inline]
    pub fn hash_uint32(v: u32) -> u32 {
        Self::hash_uint32_with_seed(v, DEFAULT_SEED)
    }

    pub fn hash_uint32_with_seed(v: u32, seed: u32) -> u32 {
        const C1: u32 = 0xcc9e2d51;
        const C2: u32 = 0x1b873593;
        let len: u32 = 4;
        let mut h1: u32 = seed;
        let mut k1 = v.wrapping_mul(C1);
        k1 = Self::rotl32(k1, 15);
        k1 = k1.wrapping_mul(C2);
        h1 ^= k1;
        h1 = Self::rotl32(h1, 13);
        h1 = h1.wrapping_mul(5).wrapping_add(0xe6546b64);
        h1 ^= len;
        fmix32(h1)
    }

    #[inline]
    pub fn hash_uint64(v: u64) -> u32 {
        Self::hash_uint64_with_seed(v, DEFAULT_SEED)
    }

    pub fn hash_uint64_with_seed(v: u64, seed: u32) -> u32 {
        const C1: u32 = 0xcc9e2d51;
        const C2: u32 = 0x1b873593;
        let len: u32 = 8;
        let mut h1: u32 = seed;
        let mut k1 = (v as u32).wrapping_mul(C1);
        k1 = Self::rotl32(k1, 15);
        k1 = k1.wrapping_mul(C2);
        h1 ^= k1;
        h1 = Self::rotl32(h1, 13);
        h1 = h1.wrapping_mul(5).wrapping_add(0xe6546b64);
        k1 = ((v >> 32) as u32).wrapping_mul(C1);
        k1 = Self::rotl32(k1, 15);
        k1 = k1.wrapping_mul(C2);
        h1 ^= k1;
        h1 = Self::rotl32(h1, 13);
        h1 = h1.wrapping_mul(5).wrapping_add(0xe6546b64);
        h1 ^= len;
        fmix32(h1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::{smhasher_32, smhasher_64};

    #[test]
    fn murmur2_32_uint() {
        let v0: u32 = 0x12345678;
        let v1: u64 = 0x1234567812345678;
        assert_eq!(
            Murmur2_32::hash(&v0.to_le_bytes()),
            Murmur2_32::hash_uint32(v0)
        );
        assert_eq!(
            Murmur2_32::hash(&v1.to_le_bytes()),
            Murmur2_32::hash_uint64(v1)
        );
    }

    #[test]
    fn murmur2_32_smhasher() {
        assert_eq!(smhasher_32(Murmur2_32::hash_with_seed), 0x27864C1E);
    }

    #[test]
    fn murmur2_64_uint() {
        let v0: u32 = 0x12345678;
        let v1: u64 = 0x1234567812345678;
        assert_eq!(
            Murmur2_64::hash(&v0.to_le_bytes()),
            Murmur2_64::hash_uint32(v0)
        );
        assert_eq!(
            Murmur2_64::hash(&v1.to_le_bytes()),
            Murmur2_64::hash_uint64(v1)
        );
    }

    #[test]
    fn murmur2_64_smhasher() {
        assert_eq!(smhasher_64(Murmur2_64::hash_with_seed), 0x1F0D3804);
    }

    #[test]
    fn murmur3_32_uint() {
        let v0: u32 = 0x12345678;
        let v1: u64 = 0x1234567812345678;
        assert_eq!(
            Murmur3_32::hash(&v0.to_le_bytes()),
            Murmur3_32::hash_uint32(v0)
        );
        assert_eq!(
            Murmur3_32::hash(&v1.to_le_bytes()),
            Murmur3_32::hash_uint64(v1)
        );
    }

    #[test]
    fn murmur3_32_smhasher() {
        assert_eq!(smhasher_32(Murmur3_32::hash_with_seed), 0xB0F57EE3);
    }
}
