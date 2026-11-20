//! XxHash32 / XxHash64, from `bun_simd_kernels`. The seed comes first, unlike in Murmur/CityHash.

pub struct XxHash32;

impl XxHash32 {
    #[inline]
    pub fn hash(seed: u32, input: &[u8]) -> u32 {
        bun_simd_kernels::xxhash32(seed, input)
    }
}

pub struct XxHash64;

impl XxHash64 {
    #[inline]
    pub fn hash(seed: u64, input: &[u8]) -> u64 {
        bun_simd_kernels::xxhash64(seed, input)
    }
}

/// Streaming XxHash64 — used by the bundler's `ContentHasher`
/// (length-prefixed chunk hashing across many `update()` calls before a single
/// `digest()`), plus the dev-server source-map hash and the resolver stat hash.
/// Wraps `bun_simd_kernels::XxHash64State`; output is bit-identical to the xxHash reference.
pub struct XxHash64Streaming(bun_simd_kernels::XxHash64State);

impl XxHash64Streaming {
    #[inline]
    pub fn new(seed: u64) -> Self {
        Self(bun_simd_kernels::XxHash64State::new(seed))
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
