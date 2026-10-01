// core.LinkStore and the two stores of checker/links.go. `get` hands out a handle, never a reference.
use crate::checker::checker::Checker;
use crate::tscore::golang::Map;
use crate::tscore::ids::SymbolId;
use std::hash::Hash;
use std::marker::PhantomData;

pub struct LinkStore<K, V> {
    entries: Map<K, u32>,
    arena: Vec<V>,
    nil: V,
    sink: V,
}

pub struct Link<V>(u32, PhantomData<fn() -> V>);

impl<V> Clone for Link<V> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<V> Copy for Link<V> {}

impl<K: Hash + Ord + Copy, V: Default> Default for LinkStore<K, V> {
    fn default() -> Self {
        Self {
            entries: Map::make(),
            arena: Vec::new(),
            nil: V::default(),
            sink: V::default(),
        }
    }
}

impl<K: Hash + Ord + Copy, V: Default> LinkStore<K, V> {
    // Get: the links of the key, made on the first request.
    pub fn get(&mut self, key: K) -> Link<V> {
        if let Some(index) = self.entries.get_ok(&key) {
            return Link(index, PhantomData);
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
    pub fn try_get(&self, key: K) -> Option<Link<V>> {
        self.entries
            .get_ok(&key)
            .map(|index| Link(index, PhantomData))
    }
    pub fn len(&self) -> isize {
        self.arena.len() as isize
    }
}

impl<K, V> std::ops::Index<Link<V>> for LinkStore<K, V> {
    type Output = V;
    fn index(&self, link: Link<V>) -> &V {
        (link.0 as usize)
            .checked_sub(1)
            .and_then(|i| self.arena.get(i))
            .unwrap_or(&self.nil)
    }
}

impl<K, V: Default> std::ops::IndexMut<Link<V>> for LinkStore<K, V> {
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

impl Checker<'_> {
    // symbolArenaLinkStore.Get: the store is keyed by ast.GetSymbolId, so the first access gives the symbol its id.
    pub fn value_symbol_links_get(
        &mut self,
        symbol: SymbolId,
    ) -> Link<crate::checker::types::ValueSymbolLinks> {
        let id = self.ast.get_symbol_id(symbol);
        self.value_symbol_links.get(id)
    }
    // symbolArenaLinkStore.Has and TryGet: they ask for the id as well.
    pub fn value_symbol_links_try_get(
        &mut self,
        symbol: SymbolId,
    ) -> Option<Link<crate::checker::types::ValueSymbolLinks>> {
        let id = self.ast.get_symbol_id(symbol);
        self.value_symbol_links.try_get(id)
    }
}
