// core/linkstore.go: LinkStore. `get` hands out a handle, never a reference, so a link stays usable across calls of the checker.
use crate::tscore::golang::Map;
use std::hash::Hash;
use std::marker::PhantomData;
use std::ops::{Index, IndexMut};

pub struct LinkStore<K, V> {
    entries: Map<K, u32>,
    arena: Vec<V>,
    nil: V,
    sink: V,
}

// `*V` of upstream: the position of the value in the arena of its store.
pub struct Link<V>(u32, PhantomData<fn() -> V>);

impl<V> Clone for Link<V> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<V> Copy for Link<V> {}

impl<V> Link<V> {
    pub const fn is_nil(self) -> bool {
        self.0 == 0
    }
}

impl<K: Hash + Eq + Copy, V: Default> Default for LinkStore<K, V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K: Hash + Eq + Copy, V: Default> LinkStore<K, V> {
    pub fn new() -> Self {
        Self {
            entries: Map::default(),
            arena: Vec::new(),
            nil: V::default(),
            sink: V::default(),
        }
    }
    // The links of `key`, made on the first request.
    pub fn get(&mut self, key: K) -> Link<V> {
        if let Some(index) = self.entries.get_ok(&key) {
            return Link(index, PhantomData);
        }
        if self.entries.is_nil() {
            self.entries = Map::make();
        }
        let Ok(index) = u32::try_from(self.arena.len() + 1) else {
            return Link(0, PhantomData);
        };
        self.arena.push(V::default());
        let _ = self.entries.set(key, index);
        Link(index, PhantomData)
    }
    pub fn has(&self, key: K) -> bool {
        self.entries.get_ok(&key).is_some()
    }
    // The nil link when the key has no links yet.
    pub fn try_get(&self, key: K) -> Link<V> {
        Link(self.entries.get(&key), PhantomData)
    }
    pub fn len(&self) -> usize {
        self.arena.len()
    }
}

impl<K, V> Index<Link<V>> for LinkStore<K, V> {
    type Output = V;
    fn index(&self, link: Link<V>) -> &V {
        (link.0 as usize)
            .checked_sub(1)
            .and_then(|i| self.arena.get(i))
            .unwrap_or(&self.nil)
    }
}

impl<K, V: Default> IndexMut<Link<V>> for LinkStore<K, V> {
    fn index_mut(&mut self, link: Link<V>) -> &mut V {
        match (link.0 as usize)
            .checked_sub(1)
            .and_then(|i| self.arena.get_mut(i))
        {
            Some(value) => value,
            None => {
                self.sink = V::default();
                &mut self.sink
            }
        }
    }
}
