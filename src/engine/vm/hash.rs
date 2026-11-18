use core::hash::{BuildHasherDefault, Hasher};

/// For keys that are addresses, small integers or hashes already.
#[derive(Clone, Copy, Default)]
pub struct MultiplyHasher(u64);

impl Hasher for MultiplyHasher {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        bytes.iter().for_each(|&byte| self.write_u8(byte));
    }

    #[inline]
    fn write_u8(&mut self, value: u8) {
        self.write_u64(value.into());
    }

    #[inline]
    fn write_u16(&mut self, value: u16) {
        self.write_u64(value.into());
    }

    #[inline]
    fn write_u32(&mut self, value: u32) {
        self.write_u64(value.into());
    }

    #[inline]
    fn write_u64(&mut self, value: u64) {
        self.0 = self
            .0
            .wrapping_add(value)
            .wrapping_mul(0xf135_7aea_2e62_a9c5);
    }

    #[inline]
    fn write_usize(&mut self, value: usize) {
        self.write_u64(value as u64);
    }

    #[inline]
    fn finish(&self) -> u64 {
        self.0.rotate_left(26)
    }
}

pub type FastHasher = BuildHasherDefault<MultiplyHasher>;
pub type FastHashMap<K, V> = hashbrown::HashMap<K, V, FastHasher>;
pub type FastHashSet<K> = hashbrown::HashSet<K, FastHasher>;
