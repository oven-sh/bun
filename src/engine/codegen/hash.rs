use core::hash::{BuildHasher, Hasher};
use std::hash::RandomState;

/// For keys made of a few small integers.
#[derive(Default, Clone, Copy)]
pub struct FastHasher(u64);

impl FastHasher {
    #[inline]
    fn add(&mut self, word: u64) {
        let product = u128::from(self.0 ^ word) * 0x9e37_79b9_7f4a_7c15;
        self.0 = product as u64 ^ (product >> 64) as u64;
    }
}

/// For tables whose keys come from the program, and in which a search has no limit.
#[derive(Clone, Copy)]
pub struct Seed(u64);

impl Default for Seed {
    fn default() -> Self {
        Self(RandomState::new().hash_one(()))
    }
}

impl BuildHasher for Seed {
    type Hasher = FastHasher;

    #[inline]
    fn build_hasher(&self) -> FastHasher {
        FastHasher(self.0)
    }
}

impl Hasher for FastHasher {
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }

    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        let (words, rest) = bytes.as_chunks::<4>();
        words
            .iter()
            .for_each(|&word| self.add(u32::from_le_bytes(word).into()));
        rest.iter().for_each(|&byte| self.add(byte.into()));
    }

    #[inline]
    fn write_u8(&mut self, value: u8) {
        self.add(value.into());
    }

    #[inline]
    fn write_u32(&mut self, value: u32) {
        self.add(value.into());
    }

    #[inline]
    fn write_u64(&mut self, value: u64) {
        self.add(value);
    }

    #[inline]
    fn write_usize(&mut self, value: usize) {
        self.add(value as u64);
    }
}
