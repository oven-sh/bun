//! CityHash32 / CityHash64.
//!
//! Ported from `vendor/zig/lib/std/hash/cityhash.zig` (which itself follows
//! Google's reference implementation / Abseil).
//!
//! `HashObject.zig` exposes:
//!   * `cityHash32` → `CityHash32::hash(input)` (no seed; the JS seed is ignored)
//!   * `cityHash64` → `CityHash64::hash_with_seed(input, seed)`

#[inline(always)]
fn fetch32(b: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(
        b[offset..offset + 4]
            .try_into()
            .expect("infallible: size matches"),
    )
}

#[inline(always)]
fn fetch64(b: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(
        b[offset..offset + 8]
            .try_into()
            .expect("infallible: size matches"),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// CityHash32
// ──────────────────────────────────────────────────────────────────────────

pub struct CityHash32;

impl CityHash32 {
    // Magic numbers for 32-bit hashing. Copied from Murmur3.
    const C1: u32 = 0xcc9e2d51;
    const C2: u32 = 0x1b873593;

    // A 32-bit to 32-bit integer hash copied from Murmur3.
    #[inline(always)]
    fn fmix(h: u32) -> u32 {
        crate::murmur::fmix32(h)
    }

    #[inline(always)]
    fn rotr32(x: u32, r: u32) -> u32 {
        x.rotate_right(r)
    }

    // Helper from Murmur3 for combining two 32-bit values.
    #[inline(always)]
    fn mur(a: u32, h: u32) -> u32 {
        let mut a1 = a;
        let mut h1 = h;
        a1 = a1.wrapping_mul(Self::C1);
        a1 = Self::rotr32(a1, 17);
        a1 = a1.wrapping_mul(Self::C2);
        h1 ^= a1;
        h1 = Self::rotr32(h1, 19);
        h1.wrapping_mul(5).wrapping_add(0xe6546b64)
    }

    fn hash32_len_0_to_4(str: &[u8]) -> u32 {
        let len = str.len() as u32; // @truncate
        let mut b: u32 = 0;
        let mut c: u32 = 9;
        for &v in str {
            // Zig: @bitCast(@intCast(@bitCast(v) as i8) as i32) — i.e. sign-extend the byte.
            b = b
                .wrapping_mul(Self::C1)
                .wrapping_add((v as i8 as i32) as u32);
            c ^= b;
        }
        Self::fmix(Self::mur(b, Self::mur(len, c)))
    }

    fn hash32_len_5_to_12(str: &[u8]) -> u32 {
        let mut a: u32 = str.len() as u32; // @truncate
        let mut b: u32 = a.wrapping_mul(5);
        let mut c: u32 = 9;
        let d: u32 = b;

        a = a.wrapping_add(fetch32(str, 0));
        b = b.wrapping_add(fetch32(str, str.len() - 4));
        c = c.wrapping_add(fetch32(str, (str.len() >> 1) & 4));

        Self::fmix(Self::mur(c, Self::mur(b, Self::mur(a, d))))
    }

    fn hash32_len_13_to_24(str: &[u8]) -> u32 {
        let len: u32 = str.len() as u32; // @truncate
        let a = fetch32(str, (str.len() >> 1) - 4);
        let b = fetch32(str, 4);
        let c = fetch32(str, str.len() - 8);
        let d = fetch32(str, str.len() >> 1);
        let e = fetch32(str, 0);
        let f = fetch32(str, str.len() - 4);

        Self::fmix(Self::mur(
            f,
            Self::mur(
                e,
                Self::mur(d, Self::mur(c, Self::mur(b, Self::mur(a, len)))),
            ),
        ))
    }

    pub fn hash(str: &[u8]) -> u32 {
        if str.len() <= 24 {
            if str.len() <= 4 {
                return Self::hash32_len_0_to_4(str);
            } else if str.len() <= 12 {
                return Self::hash32_len_5_to_12(str);
            }
            return Self::hash32_len_13_to_24(str);
        }

        let len: u32 = str.len() as u32; // @truncate
        let mut h: u32 = len;
        let mut g: u32 = Self::C1.wrapping_mul(len);
        let mut f: u32 = g;

        let a0 = Self::rotr32(fetch32(str, str.len() - 4).wrapping_mul(Self::C1), 17)
            .wrapping_mul(Self::C2);
        let a1 = Self::rotr32(fetch32(str, str.len() - 8).wrapping_mul(Self::C1), 17)
            .wrapping_mul(Self::C2);
        let a2 = Self::rotr32(fetch32(str, str.len() - 16).wrapping_mul(Self::C1), 17)
            .wrapping_mul(Self::C2);
        let a3 = Self::rotr32(fetch32(str, str.len() - 12).wrapping_mul(Self::C1), 17)
            .wrapping_mul(Self::C2);
        let a4 = Self::rotr32(fetch32(str, str.len() - 20).wrapping_mul(Self::C1), 17)
            .wrapping_mul(Self::C2);

        h ^= a0;
        h = Self::rotr32(h, 19);
        h = h.wrapping_mul(5).wrapping_add(0xe6546b64);
        h ^= a2;
        h = Self::rotr32(h, 19);
        h = h.wrapping_mul(5).wrapping_add(0xe6546b64);
        g ^= a1;
        g = Self::rotr32(g, 19);
        g = g.wrapping_mul(5).wrapping_add(0xe6546b64);
        g ^= a3;
        g = Self::rotr32(g, 19);
        g = g.wrapping_mul(5).wrapping_add(0xe6546b64);
        f = f.wrapping_add(a4);
        f = Self::rotr32(f, 19);
        f = f.wrapping_mul(5).wrapping_add(0xe6546b64);

        let mut iters = (str.len() - 1) / 20;
        let mut off: usize = 0;
        while iters != 0 {
            let b0 =
                Self::rotr32(fetch32(str, off).wrapping_mul(Self::C1), 17).wrapping_mul(Self::C2);
            let b1 = fetch32(str, off + 4);
            let b2 = Self::rotr32(fetch32(str, off + 8).wrapping_mul(Self::C1), 17)
                .wrapping_mul(Self::C2);
            let b3 = Self::rotr32(fetch32(str, off + 12).wrapping_mul(Self::C1), 17)
                .wrapping_mul(Self::C2);
            let b4 = fetch32(str, off + 16);

            h ^= b0;
            h = Self::rotr32(h, 18);
            h = h.wrapping_mul(5).wrapping_add(0xe6546b64);
            f = f.wrapping_add(b1);
            f = Self::rotr32(f, 19);
            f = f.wrapping_mul(Self::C1);
            g = g.wrapping_add(b2);
            g = Self::rotr32(g, 18);
            g = g.wrapping_mul(5).wrapping_add(0xe6546b64);
            h ^= b3.wrapping_add(b1);
            h = Self::rotr32(h, 19);
            h = h.wrapping_mul(5).wrapping_add(0xe6546b64);
            g ^= b4;
            g = g.swap_bytes().wrapping_mul(5);
            h = h.wrapping_add(b4.wrapping_mul(5));
            h = h.swap_bytes();
            f = f.wrapping_add(b0);
            let t = h;
            h = f;
            f = g;
            g = t;
            off += 20;
            iters -= 1;
        }

        g = Self::rotr32(g, 11).wrapping_mul(Self::C1);
        g = Self::rotr32(g, 17).wrapping_mul(Self::C1);
        f = Self::rotr32(f, 11).wrapping_mul(Self::C1);
        f = Self::rotr32(f, 17).wrapping_mul(Self::C1);
        h = Self::rotr32(h.wrapping_add(g), 19);
        h = h.wrapping_mul(5).wrapping_add(0xe6546b64);
        h = Self::rotr32(h, 17).wrapping_mul(Self::C1);
        h = Self::rotr32(h.wrapping_add(f), 19);
        h = h.wrapping_mul(5).wrapping_add(0xe6546b64);
        h = Self::rotr32(h, 17).wrapping_mul(Self::C1);
        h
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CityHash64
// ──────────────────────────────────────────────────────────────────────────

pub struct CityHash64;

#[derive(Clone, Copy)]
struct WeakPair {
    first: u64,
    second: u64,
}

impl CityHash64 {
    // Some primes between 2^63 and 2^64 for various uses.
    const K0: u64 = 0xc3a5c85c97cb3127;
    const K1: u64 = 0xb492b66fbe98f273;
    const K2: u64 = 0x9ae16a3b2f90404f;

    #[inline(always)]
    fn rotr64(x: u64, r: u32) -> u64 {
        x.rotate_right(r)
    }

    #[inline(always)]
    fn shiftmix(v: u64) -> u64 {
        v ^ (v >> 47)
    }

    #[inline(always)]
    fn hash_len16(u: u64, v: u64) -> u64 {
        Self::hash128_to_64(u, v)
    }

    #[inline(always)]
    fn hash_len16_mul(low: u64, high: u64, mul: u64) -> u64 {
        let mut a = (low ^ high).wrapping_mul(mul);
        a ^= a >> 47;
        let mut b = (high ^ a).wrapping_mul(mul);
        b ^= b >> 47;
        b.wrapping_mul(mul)
    }

    #[inline(always)]
    fn hash128_to_64(low: u64, high: u64) -> u64 {
        Self::hash_len16_mul(low, high, 0x9ddfea08eb382d69)
    }

    fn hash_len_0_to_16(str: &[u8]) -> u64 {
        let len = str.len() as u64;
        if len >= 8 {
            let mul = Self::K2.wrapping_add(len.wrapping_mul(2));
            let a = fetch64(str, 0).wrapping_add(Self::K2);
            let b = fetch64(str, str.len() - 8);
            let c = Self::rotr64(b, 37).wrapping_mul(mul).wrapping_add(a);
            let d = Self::rotr64(a, 25).wrapping_add(b).wrapping_mul(mul);
            return Self::hash_len16_mul(c, d, mul);
        }
        if len >= 4 {
            let mul = Self::K2.wrapping_add(len.wrapping_mul(2));
            let a = fetch32(str, 0) as u64;
            return Self::hash_len16_mul(
                len.wrapping_add(a << 3),
                fetch32(str, str.len() - 4) as u64,
                mul,
            );
        }
        if len > 0 {
            let a = str[0];
            let b = str[str.len() >> 1];
            let c = str[str.len() - 1];
            let y: u32 = (a as u32).wrapping_add((b as u32) << 8);
            let z: u32 = (str.len() as u32).wrapping_add((c as u32) << 2);
            return Self::shiftmix(
                (y as u64).wrapping_mul(Self::K2) ^ (z as u64).wrapping_mul(Self::K0),
            )
            .wrapping_mul(Self::K2);
        }
        Self::K2
    }

    fn hash_len_17_to_32(str: &[u8]) -> u64 {
        let len = str.len() as u64;
        let mul = Self::K2.wrapping_add(len.wrapping_mul(2));
        let a = fetch64(str, 0).wrapping_mul(Self::K1);
        let b = fetch64(str, 8);
        let c = fetch64(str, str.len() - 8).wrapping_mul(mul);
        let d = fetch64(str, str.len() - 16).wrapping_mul(Self::K2);

        Self::hash_len16_mul(
            Self::rotr64(a.wrapping_add(b), 43)
                .wrapping_add(Self::rotr64(c, 30))
                .wrapping_add(d),
            a.wrapping_add(Self::rotr64(b.wrapping_add(Self::K2), 18))
                .wrapping_add(c),
            mul,
        )
    }

    fn hash_len_33_to_64(str: &[u8]) -> u64 {
        let len = str.len() as u64;
        let mul = Self::K2.wrapping_add(len.wrapping_mul(2));
        let a = fetch64(str, 0).wrapping_mul(Self::K2);
        let b = fetch64(str, 8);
        let c = fetch64(str, str.len() - 24);
        let d = fetch64(str, str.len() - 32);
        let e = fetch64(str, 16).wrapping_mul(Self::K2);
        let f = fetch64(str, 24).wrapping_mul(9);
        let g = fetch64(str, str.len() - 8);
        let h = fetch64(str, str.len() - 16).wrapping_mul(mul);

        let u = Self::rotr64(a.wrapping_add(g), 43)
            .wrapping_add(Self::rotr64(b, 30).wrapping_add(c).wrapping_mul(9));
        let v = (a.wrapping_add(g) ^ d).wrapping_add(f).wrapping_add(1);
        let w = (u.wrapping_add(v).wrapping_mul(mul))
            .swap_bytes()
            .wrapping_add(h);
        let x = Self::rotr64(e.wrapping_add(f), 42).wrapping_add(c);
        let y = (v.wrapping_add(w).wrapping_mul(mul))
            .swap_bytes()
            .wrapping_add(g)
            .wrapping_mul(mul);
        let z = e.wrapping_add(f).wrapping_add(c);
        let a1 = (x.wrapping_add(z).wrapping_mul(mul).wrapping_add(y))
            .swap_bytes()
            .wrapping_add(b);
        let b1 = Self::shiftmix(
            z.wrapping_add(a1)
                .wrapping_mul(mul)
                .wrapping_add(d)
                .wrapping_add(h),
        )
        .wrapping_mul(mul);
        b1.wrapping_add(x)
    }

    #[inline(always)]
    fn weak_hash_len32_with_seeds_helper(
        w: u64,
        x: u64,
        y: u64,
        z: u64,
        a: u64,
        b: u64,
    ) -> WeakPair {
        let mut a1 = a;
        let mut b1 = b;
        a1 = a1.wrapping_add(w);
        b1 = Self::rotr64(b1.wrapping_add(a1).wrapping_add(z), 21);
        let c = a1;
        a1 = a1.wrapping_add(x);
        a1 = a1.wrapping_add(y);
        b1 = b1.wrapping_add(Self::rotr64(a1, 44));
        WeakPair {
            first: a1.wrapping_add(z),
            second: b1.wrapping_add(c),
        }
    }

    #[inline(always)]
    fn weak_hash_len32_with_seeds(str: &[u8], off: usize, a: u64, b: u64) -> WeakPair {
        Self::weak_hash_len32_with_seeds_helper(
            fetch64(str, off),
            fetch64(str, off + 8),
            fetch64(str, off + 16),
            fetch64(str, off + 24),
            a,
            b,
        )
    }

    pub fn hash(str: &[u8]) -> u64 {
        if str.len() <= 32 {
            if str.len() <= 16 {
                return Self::hash_len_0_to_16(str);
            }
            return Self::hash_len_17_to_32(str);
        } else if str.len() <= 64 {
            return Self::hash_len_33_to_64(str);
        }

        let mut len = str.len() as u64;

        let mut x = fetch64(str, str.len() - 40);
        let mut y = fetch64(str, str.len() - 16).wrapping_add(fetch64(str, str.len() - 56));
        let mut z = Self::hash_len16(
            fetch64(str, str.len() - 48).wrapping_add(len),
            fetch64(str, str.len() - 24),
        );
        let mut v = Self::weak_hash_len32_with_seeds(str, str.len() - 64, len, z);
        let mut w =
            Self::weak_hash_len32_with_seeds(str, str.len() - 32, y.wrapping_add(Self::K1), x);

        x = x.wrapping_mul(Self::K1).wrapping_add(fetch64(str, 0));
        len = (len - 1) & !63u64;

        let mut off: usize = 0;
        loop {
            x = Self::rotr64(
                x.wrapping_add(y)
                    .wrapping_add(v.first)
                    .wrapping_add(fetch64(str, off + 8)),
                37,
            )
            .wrapping_mul(Self::K1);
            y = Self::rotr64(
                y.wrapping_add(v.second)
                    .wrapping_add(fetch64(str, off + 48)),
                42,
            )
            .wrapping_mul(Self::K1);
            x ^= w.second;
            y = y.wrapping_add(v.first).wrapping_add(fetch64(str, off + 40));
            z = Self::rotr64(z.wrapping_add(w.first), 33).wrapping_mul(Self::K1);
            v = Self::weak_hash_len32_with_seeds(
                str,
                off,
                v.second.wrapping_mul(Self::K1),
                x.wrapping_add(w.first),
            );
            w = Self::weak_hash_len32_with_seeds(
                str,
                off + 32,
                z.wrapping_add(w.second),
                y.wrapping_add(fetch64(str, off + 16)),
            );
            core::mem::swap(&mut z, &mut x);

            off += 64;
            len -= 64;
            if len == 0 {
                break;
            }
        }

        Self::hash_len16(
            Self::hash_len16(v.first, w.first)
                .wrapping_add(Self::shiftmix(y).wrapping_mul(Self::K1))
                .wrapping_add(z),
            Self::hash_len16(v.second, w.second).wrapping_add(x),
        )
    }

    #[inline]
    pub fn hash_with_seed(str: &[u8], seed: u64) -> u64 {
        Self::hash_with_seeds(str, Self::K2, seed)
    }

    #[inline]
    pub fn hash_with_seeds(str: &[u8], seed0: u64, seed1: u64) -> u64 {
        Self::hash_len16(Self::hash(str).wrapping_sub(seed0), seed1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::{smhasher_32, smhasher_64};

    #[test]
    fn cityhash32_smhasher() {
        // SMHasher doesn't provide a 32bit version of the algorithm.
        // The implementation was verified against the Google Abseil version.
        assert_eq!(smhasher_32(|b, _seed| CityHash32::hash(b)), 0x68254F81);
    }

    #[test]
    fn cityhash64_smhasher() {
        // This is not compliant with the SMHasher implementation of CityHash64!
        // The implementation was verified against the Google Abseil version.
        assert_eq!(smhasher_64(CityHash64::hash_with_seed), 0x5FABC5C5);
    }
}
