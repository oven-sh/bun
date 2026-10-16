//! One session's per-stream state by stream id: dense storage, and `ids` gives the open order.

use bun_collections::ArrayHashMap;
use bun_collections::hash_map::Entry;

/// The link of the oldest and of the newest entry: no neighbour on that side.
const NONE: u32 = u32::MAX;

struct Slot<V> {
    value: V,
    /// Position of the stream that opened before this one.
    older: u32,
    /// Position of the stream that opened after this one.
    newer: u32,
}

pub(crate) struct StreamTable<V> {
    map: ArrayHashMap<u32, Slot<V>>,
    oldest: u32,
    newest: u32,
}

impl<V> Default for StreamTable<V> {
    #[inline]
    fn default() -> Self {
        Self {
            map: ArrayHashMap::new(),
            oldest: NONE,
            newest: NONE,
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
        self.map.get(&id).map(|slot| &slot.value)
    }

    #[inline]
    pub(crate) fn get_mut(&mut self, id: u32) -> Option<&mut V> {
        self.map.get_mut(&id).map(|slot| &mut slot.value)
    }

    #[inline]
    pub(crate) fn contains_key(&self, id: u32) -> bool {
        self.map.contains_key(&id)
    }

    /// Returns the value the id had before. A new id becomes the newest entry.
    #[inline]
    pub(crate) fn insert(&mut self, id: u32, value: V) -> Option<V> {
        match self.map.entry(id) {
            Entry::Occupied(mut entry) => {
                Some(core::mem::replace(&mut entry.get_mut().value, value))
            }
            Entry::Vacant(entry) => {
                let at = entry.index();
                entry.insert(Slot {
                    value,
                    older: self.newest,
                    newer: NONE,
                });
                self.link_newest(at);
                None
            }
        }
    }

    /// One lookup. `make` runs only when the id is absent.
    #[inline]
    pub(crate) fn get_or_insert_with(&mut self, id: u32, make: impl FnOnce() -> V) -> &mut V {
        let at = match self.map.entry(id) {
            Entry::Occupied(entry) => entry.index(),
            Entry::Vacant(entry) => {
                let at = entry.index();
                entry.insert(Slot {
                    value: make(),
                    older: self.newest,
                    newer: NONE,
                });
                self.link_newest(at);
                at
            }
        };
        &mut self.map.values_mut()[at].value
    }

    #[inline]
    fn link_newest(&mut self, at: usize) {
        let at = at as u32;
        if self.newest == NONE {
            self.oldest = at;
        } else {
            self.map.values_mut()[self.newest as usize].newer = at;
        }
        self.newest = at;
    }

    /// Makes the `older` neighbour (or `oldest`) and the `newer` neighbour (or `newest`) point at new positions.
    #[inline]
    fn point(&mut self, older: u32, newer: u32, older_to: u32, newer_to: u32) {
        if older == NONE {
            self.oldest = older_to;
        } else {
            self.map.values_mut()[older as usize].newer = older_to;
        }
        if newer == NONE {
            self.newest = newer_to;
        } else {
            self.map.values_mut()[newer as usize].older = newer_to;
        }
    }

    /// Removes the entry. The last entry moves into its position, and the open order of the rest stays.
    #[inline]
    pub(crate) fn take(&mut self, id: u32) -> Option<V> {
        let at = self.map.get_index(&id)?;
        let removed = &self.map.values()[at];
        let (older, newer) = (removed.older, removed.newer);
        self.point(older, newer, newer, older);
        let (_, slot) = self.map.swap_remove_at(at);
        if let Some(moved) = self.map.values().get(at) {
            let (older, newer) = (moved.older, moved.newer);
            self.point(older, newer, at as u32, at as u32);
        }
        Some(slot.value)
    }

    #[inline]
    pub(crate) fn clear(&mut self) {
        self.map.clear();
        self.oldest = NONE;
        self.newest = NONE;
    }

    /// A snapshot of the ids in open order, for a walk whose body can insert or take.
    pub(crate) fn ids(&self) -> Vec<u32> {
        let (ids, slots) = (self.map.keys(), self.map.values());
        let mut open_order = Vec::with_capacity(ids.len());
        let mut at = self.oldest;
        while let Some(slot) = slots.get(at as usize) {
            open_order.push(ids[at as usize]);
            at = slot.newer;
        }
        open_order
    }

    /// Storage order: the open order until a removal moves an entry.
    #[inline]
    pub(crate) fn iter(&self) -> impl Iterator<Item = (u32, &V)> {
        self.map.iter().map(|(id, slot)| (*id, &slot.value))
    }

    /// Storage order, like `iter`.
    #[inline]
    pub(crate) fn iter_mut(&mut self) -> impl Iterator<Item = (u32, &mut V)> {
        self.map
            .iterator()
            .map(|entry| (*entry.key_ptr, &mut entry.value_ptr.value))
    }

    /// The positions a full walk (`iter`, `iter_mut`, `ids`) reads.
    pub(crate) fn walk_positions(&self) -> usize {
        self.map.len()
    }
}
