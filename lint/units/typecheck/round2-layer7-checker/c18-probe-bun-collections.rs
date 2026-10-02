//! Stand-in for the crate bun_collections in the probe: the map that core/golang.rs imports, with the six methods it calls.
#![allow(clippy::disallowed_types)]
use std::hash::Hash;

pub struct HashMap<K, V>(std::collections::HashMap<K, V>);

impl<K: Hash + Eq, V> Default for HashMap<K, V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K: Hash + Eq, V> HashMap<K, V> {
    pub fn new() -> Self {
        Self(std::collections::HashMap::new())
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    pub fn get(&self, key: &K) -> Option<&V> {
        self.0.get(key)
    }
    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.0.insert(key, value)
    }
    pub fn remove(&mut self, key: &K) -> Option<V> {
        self.0.remove(key)
    }
    pub fn clear(&mut self) {
        self.0.clear();
    }
}
