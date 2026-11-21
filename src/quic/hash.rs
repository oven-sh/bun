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

#[test]
fn bytes_count_as_integers() {
    let (mut bytes, mut integers) = (Seeded(1), Seeded(1));
    bytes.write(&[2, 3]);
    integers.write_u64(2);
    integers.write_u64(3);
    assert_eq!(bytes.finish(), integers.finish());
}

#[test]
fn all_of_a_key_counts() {
    use crate::cid::{LocalId, ResetToken};
    for at in 0..ResetToken::LEN {
        let other = core::array::from_fn(|it| u8::from(it == at));
        let tokens = [[0; ResetToken::LEN], other].map(|it| Seeded(1).hash_one(ResetToken(it)));
        assert_ne!(tokens[0], tokens[1]);
    }
    let ids = [[0; LocalId::LEN], [1; LocalId::LEN]].map(|it| Seeded(1).hash_one(LocalId(it)));
    assert_ne!(ids[0], ids[1]);
}
