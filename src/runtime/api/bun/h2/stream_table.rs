//! One session's per-stream state by stream id, kept dense: `take`, a swap-removal, is the only removal.

use bun_collections::ArrayHashMap;

pub(crate) struct StreamTable<V> {
    map: ArrayHashMap<u32, V>,
}

impl<V> Default for StreamTable<V> {
    #[inline]
    fn default() -> Self {
        Self {
            map: ArrayHashMap::new(),
        }
    }
}

impl<V> StreamTable<V> {
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.map.len()
    }

    #[inline]
    pub(crate) fn get(&self, id: u32) -> Option<&V> {
        self.map.get(&id)
    }

    #[inline]
    pub(crate) fn get_mut(&mut self, id: u32) -> Option<&mut V> {
        self.map.get_mut(&id)
    }

    #[inline]
    pub(crate) fn contains_key(&self, id: u32) -> bool {
        self.map.contains_key(&id)
    }

    /// Returns the value the id had before.
    #[inline]
    pub(crate) fn insert(&mut self, id: u32, value: V) -> Option<V> {
        self.map.insert(id, value)
    }

    /// One lookup. `make` runs only when the id is absent.
    #[inline]
    pub(crate) fn get_or_insert_with(&mut self, id: u32, make: impl FnOnce() -> V) -> &mut V {
        self.map.entry(id).or_insert_with(make)
    }

    /// Removes the entry and moves the last entry into its position.
    #[inline]
    pub(crate) fn take(&mut self, id: u32) -> Option<V> {
        self.map.fetch_swap_remove(&id).map(|(_, value)| value)
    }

    #[inline]
    pub(crate) fn clear(&mut self) {
        self.map.clear();
    }

    /// A snapshot of the ids, for a walk whose body can insert or take.
    pub(crate) fn ids(&self) -> Vec<u32> {
        self.map.keys().to_vec()
    }

    #[inline]
    pub(crate) fn iter(&self) -> impl Iterator<Item = (u32, &V)> {
        self.map.iter().map(|(id, value)| (*id, value))
    }

    #[inline]
    pub(crate) fn iter_mut(&mut self) -> impl Iterator<Item = (u32, &mut V)> {
        self.map
            .iterator()
            .map(|entry| (*entry.key_ptr, entry.value_ptr))
    }

    /// The positions a full walk (`iter`, `iter_mut`, `ids`) reads.
    pub(crate) fn walk_positions(&self) -> usize {
        self.map.len()
    }
}
