// Scratch stand-in for the workspace crates (std only), so that rustc alone can type-check the binder port.
use std::collections::HashMap as StdMap;
use std::hash::Hash;

pub struct HashMap<K, V>(StdMap<K, V>);
impl<K: Hash + Eq, V> HashMap<K, V> {
    pub fn new() -> Self {
        Self(StdMap::new())
    }
    pub fn len(&self) -> usize {
        self.0.len()
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

pub struct ArrayHashMap<K, V> {
    index: StdMap<K, usize>,
    keys: Vec<K>,
    values: Vec<V>,
}
impl<K: Hash + Eq + Clone, V> ArrayHashMap<K, V> {
    pub fn new() -> Self {
        Self {
            index: StdMap::new(),
            keys: Vec::new(),
            values: Vec::new(),
        }
    }
    pub fn len(&self) -> usize {
        self.keys.len()
    }
    pub fn keys(&self) -> &[K] {
        &self.keys
    }
    pub fn values(&self) -> &[V] {
        &self.values
    }
    pub fn get(&self, key: &K) -> Option<&V> {
        self.values.get(*self.index.get(key)?)
    }
    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        if let Some(&slot) = self.index.get(&key) {
            return self
                .values
                .get_mut(slot)
                .map(|v| std::mem::replace(v, value));
        }
        self.index.insert(key.clone(), self.keys.len());
        self.keys.push(key);
        self.values.push(value);
        None
    }
    pub fn ordered_remove(&mut self, key: &K) -> bool {
        let Some(slot) = self.index.remove(key) else {
            return false;
        };
        self.keys.remove(slot);
        self.values.remove(slot);
        for position in self.index.values_mut() {
            if *position > slot {
                *position -= 1;
            }
        }
        true
    }
}

pub fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn hash_bytes_second(bytes: &[u8]) -> u64 {
    hash_bytes(bytes).rotate_left(17)
}

pub fn index_of(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    (0..haystack.len().checked_sub(needle.len())? + 1)
        .find(|&i| haystack.get(i..i + needle.len()) == Some(needle))
}
