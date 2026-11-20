use bun_simd_kernels::{XxHash64State, xxhash64};

/// With seed 0.
pub struct XxHash64(XxHash64State);

impl XxHash64 {
    pub fn new() -> Self {
        Self(XxHash64State::new(0))
    }

    #[inline]
    pub fn hash(bytes: &[u8]) -> u64 {
        xxhash64(0, bytes)
    }

    pub fn update(&mut self, bytes: &[u8]) {
        self.0.update(bytes);
    }

    pub fn digest(&self) -> u64 {
        self.0.digest()
    }
}
