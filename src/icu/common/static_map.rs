//! A process-wide map. A value is built before locking, and dropped after unlocking if another thread was first.

use crate::common::maps::Map;
use crate::common::memory::{Appendable, insert_within_capacity, try_map_reserve};
use crate::common::utypes::UErrorCode;
use bun_core::Mutex;
use std::borrow::Borrow;
use std::hash::{BuildHasherDefault, Hash};

/// Cloning a `V` must not allocate: a `&'static`, an `Arc`, a number.
pub(crate) struct StaticMap<K, V>(Mutex<Map<K, V>>);

impl<K: Eq + Hash, V> StaticMap<K, V> {
    pub(crate) const fn new() -> Self {
        Self(Mutex::new(Map::with_hasher(BuildHasherDefault::new())))
    }

    pub(crate) fn with_lock<R>(&self, f: impl FnOnce(&mut Map<K, V>) -> R) -> R {
        f(&mut self.0.lock())
    }

    pub(crate) fn get<Q: Eq + Hash + ?Sized>(&self, key: &Q) -> Option<V>
    where
        K: Borrow<Q>,
        V: Clone,
    {
        self.with_lock(|map| map.get(key).cloned())
    }

    /// Returns the value for `key`, or inserts the result of `finish`, which runs under the lock.
    pub(crate) fn get_or_insert_with(
        &self,
        key: K,
        finish: impl FnOnce() -> V,
    ) -> Result<V, UErrorCode>
    where
        V: Clone,
    {
        self.get_or_insert_by(
            (key, finish),
            |map, new| map.get(&new.0).cloned(),
            |(key, finish)| (key, finish()),
        )
    }

    /// Returns the result of `find`, or inserts `finish(new)`. The key may borrow from the value.
    pub(crate) fn get_or_insert_by<T>(
        &self,
        new: T,
        find: impl FnOnce(&Map<K, V>, &T) -> Option<V>,
        finish: impl FnOnce(T) -> (K, V),
    ) -> Result<V, UErrorCode>
    where
        V: Clone,
    {
        let result = self.with_reserved(|map| match find(map, &new) {
            Some(found) => (found, Some(new)),
            None => {
                let (key, value) = finish(new);
                insert_within_capacity(map, key, value.clone());
                (value, None)
            }
        });
        result.map(|(value, _unused)| value)
    }

    /// Runs `f` under the lock, with spare capacity for one entry.
    pub(crate) fn with_reserved<R>(
        &self,
        f: impl FnOnce(&mut Map<K, V>) -> R,
    ) -> Result<R, UErrorCode> {
        let mut map = self.0.lock();
        try_map_reserve(&mut map, 1)?;
        Ok(f(&mut map))
    }

    /// Moves the entries that match `predicate` to `out`, up to the capacity of `out`.
    pub(crate) fn drain_matching(
        &self,
        out: &mut Vec<(K, V)>,
        predicate: impl FnMut(&K, &mut V) -> bool,
    ) {
        let spare = out.capacity() - out.len();
        self.with_lock(|map| {
            map.extract_if(predicate)
                .take(spare)
                .for_each(|entry| out.add(entry))
        });
    }
}
