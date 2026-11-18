use hashbrown::HashTable;

pub(super) struct Map<V>(HashTable<(u64, V)>);

impl<V> Default for Map<V> {
    fn default() -> Self {
        Self(HashTable::new())
    }
}

fn hash(key: u64) -> u64 {
    let product = key.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    product ^ product >> 32
}

impl<V: Copy> Map<V> {
    pub(super) fn clear(&mut self) {
        self.0.clear();
    }

    pub(super) fn get_or_insert_with(&mut self, key: u64, make: impl FnOnce() -> V) -> V {
        let entry = self
            .0
            .entry(hash(key), |known| known.0 == key, |known| hash(known.0));
        entry.or_insert_with(|| (key, make())).get().1
    }
}
