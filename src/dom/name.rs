use core::hash::{BuildHasherDefault, Hasher};

/// A tag, class, id, attribute or custom property name, by its hash. Two names that collide are styled alike.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Name(u64);

impl Name {
    pub(crate) const NONE: Name = Name(0);

    pub(crate) const fn new(bytes: &[u8]) -> Name {
        Name::hash(bytes, false)
    }

    pub(crate) const fn lowercase(bytes: &[u8]) -> Name {
        Name::hash(bytes, true)
    }

    const fn hash(bytes: &[u8], lowercase: bool) -> Name {
        const fn mix(hash: u64, word: u64) -> u64 {
            let product = (hash ^ word) as u128 * 0x9e37_79b9_7f4a_7c15;
            product as u64 ^ (product >> 64) as u64
        }
        const fn lower(word: u64) -> u64 {
            const ONES: u64 = u64::MAX / 255;
            let low = word & (ONES * 0x7f);
            let is_upper =
                (low + ONES * (0x80 - b'A' as u64)) & !(low + ONES * (0x7f - b'Z' as u64)) & !word;
            word | (is_upper & (ONES * 0x80)) >> 2
        }
        let (mut hash, mut rest) = (0xcbf2_9ce4_8422_2325 ^ bytes.len() as u64, bytes);
        while let Some((word, after)) = rest.split_first_chunk::<8>() {
            let word = u64::from_le_bytes(*word);
            (hash, rest) = (mix(hash, if lowercase { lower(word) } else { word }), after);
        }
        let mut last = 0;
        while let [byte, after @ ..] = rest {
            (last, rest) = (last << 8 | *byte as u64, after);
        }
        Name(
            mix(
                mix(hash, if lowercase { lower(last) } else { last }),
                0xa076_1d64_78bd_642f,
            ) | 1,
        )
    }

    /// The same name in another namespace, such as classes or ids.
    pub(crate) const fn salted(self, salt: u64) -> Name {
        Name(self.0.rotate_left(salt as u32 * 7) ^ salt.wrapping_mul(0xa076_1d64_78bd_642f))
    }

    pub(crate) const fn paired(self, other: Name) -> Name {
        Name(self.0.rotate_left(29).wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ other.0 | 1)
    }

    pub(crate) const fn bits(self) -> u64 {
        self.0
    }
}

macro_rules! name {
    ($text:literal) => {
        const { $crate::name::Name::new($text.as_bytes()) }
    };
}
pub(crate) use name;

macro_rules! is_name {
    ($name:expr, $($text:literal)|+) => {{
        let name = $name;
        $(name == $crate::name::name!($text))||+
    }};
}
pub(crate) use is_name;

#[derive(Default)]
pub(crate) struct FastHasher(u64);

impl Hasher for FastHasher {
    fn finish(&self) -> u64 {
        self.0.rotate_left(26)
    }
    fn write(&mut self, bytes: &[u8]) {
        self.write_u64(bun_wyhash::hash(bytes));
    }
    fn write_u8(&mut self, value: u8) {
        self.write_u64(value.into());
    }
    fn write_u16(&mut self, value: u16) {
        self.write_u64(value.into());
    }
    fn write_u32(&mut self, value: u32) {
        self.write_u64(value.into());
    }
    fn write_u64(&mut self, value: u64) {
        self.0 = (self.0.wrapping_add(value)).wrapping_mul(0xf135_7aea_2e62_a9c5);
    }
    fn write_usize(&mut self, value: usize) {
        self.write_u64(value as u64);
    }
}

pub(crate) type Map<K, V> =
    bun_collections::hashbrown::HashMap<K, V, BuildHasherDefault<FastHasher>>;
pub(crate) type Set<K> = bun_collections::hashbrown::HashSet<K, BuildHasherDefault<FastHasher>>;
