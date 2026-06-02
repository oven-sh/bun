//! XxHash32 / XxHash64 / XxHash3.
//!
//! Thin wrappers over the C++/Highway xxHash kernel in
//! `src/jsc/bindings/xxhash3.cpp` (exposed by `bun_highway`). XXH3's long-input
//! stripe loop is runtime-dispatched to the widest SIMD ISA the CPU supports;
//! XXH32/XXH64 are scalar (no SIMD form exists in the reference). Output is
//! bit-identical to `std.hash.XxHash{32,64,3}` in Zig and to the xxHash
//! reference test vectors — verified against the reference (and across every
//! dispatch target) by `test/js/bun/util/hash.test.js`, which runs in CI.
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
