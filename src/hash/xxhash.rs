//! XxHash32 / XxHash64 / XxHash3.
//!
//! Thin wrappers over the C++/Highway xxHash kernel in
//! `src/jsc/bindings/xxhash3.cpp` (exposed by `bun_highway`). XXH3's long-input
//! stripe loop is runtime-dispatched to the widest SIMD ISA the CPU supports;
//! XXH32/XXH64 are scalar (no SIMD form exists in the reference). Output is
//! bit-identical to `std.hash.XxHash{32,64,3}` in Zig and to the xxHash
//! reference test vectors — verified by the vector suite + SMHasher below.
//!
//! `HashObject.zig` exposes these via `hashWrap` with a `(seed, bytes)`
//! signature (seed first, unlike Murmur/CityHash).

pub struct XxHash32;

impl XxHash32 {
    #[inline]
    pub fn hash(seed: u32, input: &[u8]) -> u32 {
        bun_highway::xxhash32(seed, input)
    }
}

pub struct XxHash64;

impl XxHash64 {
    #[inline]
    pub fn hash(seed: u64, input: &[u8]) -> u64 {
        bun_highway::xxhash64(seed, input)
    }
}

/// Streaming `std.hash.XxHash64` — used by the bundler's `ContentHasher`
/// (length-prefixed chunk hashing across many `update()` calls before a single
/// `digest()`), plus the dev-server source-map hash and the resolver stat hash.
/// Wraps `bun_highway::XxHash64State` so the workspace has exactly one xxhash
/// implementation; output is bit-identical to Zig's `std.hash.XxHash64`.
pub struct XxHash64Streaming(bun_highway::XxHash64State);

impl XxHash64Streaming {
    #[inline]
    pub fn new(seed: u64) -> Self {
        Self(bun_highway::XxHash64State::new(seed))
    }

    #[inline]
    pub fn update(&mut self, bytes: &[u8]) {
        self.0.update(bytes);
    }

    #[inline]
    pub fn digest(&self) -> u64 {
        self.0.digest()
    }
}

impl Default for XxHash64Streaming {
    #[inline]
    fn default() -> Self {
        Self::new(0)
    }
}

pub struct XxHash3;

impl XxHash3 {
    #[inline]
    pub fn hash(seed: u64, input: &[u8]) -> u64 {
        bun_highway::xxhash3_64(seed, input)
    }
}

// These tests call the C++/Highway kernel through the FFI, so they can't run
// under Miri (no foreign-function support) — gate them out there. The rest of
// `bun_hash` (cityhash/murmur/adler/rapidhash) stays Miri-tested.
#[cfg(all(test, not(miri)))]
mod tests {
    use super::*;

    // Vectors copied verbatim from the xxHash reference (and Zig
    // `std.hash.xxhash`) to prove the C++ kernel matches reference output.

    #[test]
    fn xxhash3_vectors() {
        let cases: &[(u64, &[u8], u64)] = &[
            // non-seeded
            (0, b"", 0x2d06800538d394c2),
            (0, b"a", 0xe6c632b61e964e1f),
            (0, b"abc", 0x78af5f94892f3950),
            (0, b"message", 0x0b1ca9b8977554fa),
            (0, b"message digest", 0x160d8e9329be94f9),
            (0, b"abcdefghijklmnopqrstuvwxyz", 0x810f9ca067fbb90c),
            (
                0,
                b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
                0x643542bb51639cb2,
            ),
            (
                0,
                b"12345678901234567890123456789012345678901234567890123456789012345678901234567890",
                0x7f58aa2520c681f9,
            ),
            // seeded
            (1, b"", 0x4dc5b0cc826f6703),
            (1, b"a", 0xd2f6d0996f37a720),
            (1, b"abc", 0x6b4467b443c76228),
            (1, b"message", 0x73fb1cf20d561766),
            (1, b"message digest", 0xfe71a82a70381174),
            (1, b"abcdefghijklmnopqrstuvwxyz", 0x902a2c2d016a37ba),
            (
                1,
                b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
                0xbf552e540c5c6882,
            ),
            (
                1,
                b"12345678901234567890123456789012345678901234567890123456789012345678901234567890",
                0xf2ca33235a6b865b,
            ),
        ];
        for &(seed, input, expected) in cases {
            assert_eq!(
                XxHash3::hash(seed, input),
                expected,
                "seed={seed} input={:?}",
                input
            );
        }
    }

    #[test]
    fn xxhash64_vectors() {
        let cases: &[(u64, &[u8], u64)] = &[
            (0, b"", 0xef46db3751d8e999),
            (0, b"a", 0xd24ec4f1a98c6e5b),
            (0, b"abc", 0x44bc2cf5ad770999),
            (0, b"message digest", 0x066ed728fceeb3be),
            (0, b"abcdefghijklmnopqrstuvwxyz", 0xcfe1f278fa89835c),
            (
                0,
                b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
                0xaaa46907d3047814,
            ),
            (
                0,
                b"12345678901234567890123456789012345678901234567890123456789012345678901234567890",
                0xe04a477f19ee145d,
            ),
        ];
        for &(seed, input, expected) in cases {
            assert_eq!(XxHash64::hash(seed, input), expected);
        }
    }

    #[test]
    fn xxhash32_vectors() {
        let cases: &[(u32, &[u8], u32)] = &[
            (0, b"", 0x02cc5d05),
            (0, b"a", 0x550d7456),
            (0, b"abc", 0x32d153ff),
            (0, b"message digest", 0x7c948494),
            (0, b"abcdefghijklmnopqrstuvwxyz", 0x63a14d5f),
            (
                0,
                b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
                0x9c285e64,
            ),
            (
                0,
                b"12345678901234567890123456789012345678901234567890123456789012345678901234567890",
                0x9c05f475,
            ),
        ];
        for &(seed, input, expected) in cases {
            assert_eq!(XxHash32::hash(seed, input), expected);
        }
    }

    use crate::verify::{smhasher_32, smhasher_64};

    #[test]
    fn xxhash32_smhasher() {
        assert_eq!(smhasher_32(|b, s| XxHash32::hash(s, b)), 0xBA88B743);
    }

    #[test]
    fn xxhash64_smhasher() {
        assert_eq!(smhasher_64(|b, s| XxHash64::hash(s, b)), 0x024B7CF4);
    }

    #[test]
    fn xxhash3_smhasher() {
        assert_eq!(smhasher_64(|b, s| XxHash3::hash(s, b)), 0x9A636405);
    }
}
