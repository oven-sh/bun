use core::hash::{BuildHasher, Hasher};

/// For keys of eight bytes that are random, or of which a peer cannot have many in one map.
pub(crate) type IdMap<K, V> = hashbrown::HashMap<K, V, Seeded>;

/// For keys that anyone can choose.
pub(crate) type KeyedMap<K, V> = hashbrown::HashMap<K, V, std::hash::RandomState>;

#[derive(Clone, Copy)]
pub(crate) struct Seeded(pub(crate) u64);

impl BuildHasher for Seeded {
    type Hasher = Self;

    #[inline]
    fn build_hasher(&self) -> Self {
        *self
    }
}

impl Hasher for Seeded {
    #[inline]
    fn write_u64(&mut self, value: u64) {
        let product = u128::from(self.0 ^ value) * 0x9e37_79b9_7f4a_7c15;
        self.0 = product as u64 ^ (product >> 64) as u64;
    }

    fn write(&mut self, bytes: &[u8]) {
        bytes.iter().for_each(|&byte| self.write_u64(byte.into()));
    }

    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
}
