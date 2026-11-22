//! Maps that report a failed allocation (`memory::try_map_insert`). Results must not depend on the iteration order.

use crate::common::memory::try_insert;
use crate::common::utypes::UErrorCode;
use bun_collections::hashbrown::{HashMap, HashSet};
use std::borrow::Borrow;

pub(crate) type Map<K, V> = HashMap<K, V, bun_wyhash::BuildHasher>;
pub(crate) type Set<T> = HashSet<T, bun_wyhash::BuildHasher>;

/// In place of `BTreeMap`, which aborts if allocation fails. Insertion is O(n), so neither the caller nor the data may choose n.
pub(crate) struct VecMap<K, V = ()>(Vec<(K, V)>);

impl<K, V> Default for VecMap<K, V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K, V> VecMap<K, V> {
    pub(crate) const fn new() -> Self {
        Self(Vec::new())
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(crate) fn iter(&self) -> impl DoubleEndedIterator<Item = (&K, &V)> + ExactSizeIterator {
        self.0.iter().map(|(key, value)| (key, value))
    }
}

impl<K: Ord, V> VecMap<K, V> {
    fn search<Q: Ord + ?Sized>(&self, key: &Q) -> Result<usize, usize>
    where
        K: Borrow<Q>,
    {
        self.0
            .binary_search_by(|(probe, _)| probe.borrow().cmp(key))
    }

    pub(crate) fn contains_key<Q: Ord + ?Sized>(&self, key: &Q) -> bool
    where
        K: Borrow<Q>,
    {
        self.search(key).is_ok()
    }

    /// `insert(key, value)`
    pub(crate) fn try_insert(&mut self, key: K, value: V) -> Result<Option<V>, UErrorCode> {
        match self.search(&key) {
            Ok(index) => Ok(self
                .0
                .get_mut(index)
                .map(|(_, old)| std::mem::replace(old, value))),
            Err(index) => try_insert(&mut self.0, index, (key, value)).map(|()| None),
        }
    }

    /// `entry(key).or_insert(value)`
    pub(crate) fn try_insert_if_absent(&mut self, key: K, value: V) -> Result<(), UErrorCode> {
        match self.search(&key) {
            Ok(_) => Ok(()),
            Err(index) => try_insert(&mut self.0, index, (key, value)),
        }
    }
}
