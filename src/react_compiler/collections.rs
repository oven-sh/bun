//! Drop-in `IndexMap` / `IndexSet` for the React Compiler port.
//!
//! Newtype wrappers over [`bun_collections::ArrayHashMap`] with the allocator
//! fixed to [`bun_alloc::AstAlloc`], so every map/set built during a compile
//! lives in the per-parse arena and is bulk-freed on reset (no per-entry
//! `Drop`). Method surface mirrors `indexmap::IndexMap` / `indexmap::IndexSet`
//! closely enough that upstream call sites need only swap the `use` line.
//!
//! Semantic notes vs `indexmap`:
//!   * lookups take `&K` (no `Borrow<Q>` adapter) — every key type in this
//!     crate is a small `Copy` id or an owned `String`, so this is sufficient;
//!   * `remove` is an order-preserving (`shift_remove`) alias, not the
//!     deprecated `swap_remove` alias indexmap 2.x uses.

use core::fmt;
use core::hash::Hash;
use core::iter::{FromIterator, Zip};
use core::slice;

use bun_alloc::AstAlloc;
use bun_collections::array_hash_map::{ArrayHashMap, AutoContext, MapEntry};

/// Unordered map/set keyed by small `Copy` ids — `std`'s SipHash is the wrong
/// default for dense `u32` newtypes. The `disallowed_types` lint is satisfied:
/// the hasher is `FxBuildHasher` (same choice `bun_collections::AutoContext`
/// makes for small-int keys), not `RandomState`.
#[allow(clippy::disallowed_types)]
pub type FxHashMap<K, V> = std::collections::HashMap<K, V, rustc_hash::FxBuildHasher>;
#[allow(clippy::disallowed_types)]
pub type FxHashSet<K> = std::collections::HashSet<K, rustc_hash::FxBuildHasher>;

type Inner<K, V> = ArrayHashMap<K, V, AutoContext, AstAlloc>;

pub type Entry<'a, K, V> = MapEntry<'a, K, V, AutoContext, AstAlloc>;
pub use bun_collections::array_hash_map::{OccupiedEntry, VacantEntry};

// ──────────────────────────────────────────────────────────────────────────
// IndexMap
// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
pub struct IndexMap<K, V>(Inner<K, V>);

impl<K, V> IndexMap<K, V> {
    #[inline]
    pub fn new() -> Self {
        Self(Inner::new())
    }
    #[inline]
    pub fn with_capacity(n: usize) -> Self {
        Self(Inner::with_capacity(n))
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.0.len()
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    #[inline]
    pub fn capacity(&self) -> usize {
        self.0.capacity()
    }
    #[inline]
    pub fn clear(&mut self) {
        self.0.clear();
    }
    #[inline]
    pub fn reserve(&mut self, additional: usize) {
        self.0.reserve(additional);
    }

    #[inline]
    pub fn keys(&self) -> slice::Iter<'_, K> {
        self.0.keys().iter()
    }
    #[inline]
    pub fn values(&self) -> slice::Iter<'_, V> {
        self.0.values().iter()
    }
    #[inline]
    pub fn values_mut(&mut self) -> slice::IterMut<'_, V> {
        self.0.values_mut().iter_mut()
    }
    #[inline]
    pub fn iter(&self) -> Zip<slice::Iter<'_, K>, slice::Iter<'_, V>> {
        self.0.iter()
    }
    pub fn iter_mut(&mut self) -> impl Iterator<Item = (&K, &mut V)> {
        self.0.iterator().map(|e| (&*e.key_ptr, &mut *e.value_ptr))
    }

    /// `(key, value)` at insertion-order position `i`.
    #[inline]
    pub fn get_index(&self, i: usize) -> Option<(&K, &V)> {
        let k = self.0.keys().get(i)?;
        Some((k, &self.0.values()[i]))
    }
    #[inline]
    pub fn get_index_mut(&mut self, i: usize) -> Option<(&mut K, &mut V)> {
        self.0.get_index_mut(i)
    }
    #[inline]
    pub fn first(&self) -> Option<(&K, &V)> {
        self.get_index(0)
    }
    #[inline]
    pub fn last(&self) -> Option<(&K, &V)> {
        self.get_index(self.len().checked_sub(1)?)
    }
    #[inline]
    pub fn pop(&mut self) -> Option<(K, V)> {
        self.0.pop().map(|kv| (kv.key, kv.value))
    }

    #[inline]
    pub fn retain<F: FnMut(&K, &mut V) -> bool>(&mut self, f: F) {
        self.0.retain(f);
    }

    /// Remove every entry, yielding `(K, V)` in insertion order.
    pub fn drain(&mut self, range: core::ops::RangeFull) -> IntoIter<K, V> {
        let _ = range;
        core::mem::take(self).into_iter()
    }

    pub fn into_values(self) -> alloc::vec::IntoIter<V, AstAlloc> {
        self.0.into_entries().1.into_iter()
    }
    pub fn into_keys(self) -> alloc::vec::IntoIter<K, AstAlloc> {
        self.0.into_entries().0.into_iter()
    }
}

impl<K: Hash + Eq, V> IndexMap<K, V> {
    #[inline]
    pub fn get(&self, key: &K) -> Option<&V> {
        self.0.get(key)
    }
    #[inline]
    pub fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        self.0.get_mut(key)
    }
    #[inline]
    pub fn contains_key(&self, key: &K) -> bool {
        self.0.contains(key)
    }
    #[inline]
    pub fn get_index_of(&self, key: &K) -> Option<usize> {
        self.0.get_index(key)
    }
    #[inline]
    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.0.insert(key, value)
    }
    #[inline]
    pub fn entry(&mut self, key: K) -> Entry<'_, K, V> {
        self.0.entry(key)
    }
    /// Order-preserving remove. O(n).
    #[inline]
    pub fn shift_remove(&mut self, key: &K) -> Option<V> {
        self.0.remove(key)
    }
    /// O(1) remove; does not preserve order.
    #[inline]
    pub fn swap_remove(&mut self, key: &K) -> Option<V> {
        self.0.fetch_swap_remove(key).map(|(_, v)| v)
    }
    /// Alias for [`shift_remove`](Self::shift_remove).
    #[inline]
    pub fn remove(&mut self, key: &K) -> Option<V> {
        self.0.remove(key)
    }
}

impl<K, V> Default for IndexMap<K, V> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl<K: Clone, V: Clone> Clone for IndexMap<K, V> {
    fn clone(&self) -> Self {
        Self(self.0.clone().expect("OOM"))
    }
}

impl<K: fmt::Debug, V: fmt::Debug> fmt::Debug for IndexMap<K, V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_map().entries(self.iter()).finish()
    }
}

impl<K: Hash + Eq, V> Extend<(K, V)> for IndexMap<K, V> {
    fn extend<I: IntoIterator<Item = (K, V)>>(&mut self, iter: I) {
        let iter = iter.into_iter();
        let (lo, _) = iter.size_hint();
        self.0.reserve(lo);
        for (k, v) in iter {
            self.0.insert(k, v);
        }
    }
}

impl<K: Hash + Eq, V> FromIterator<(K, V)> for IndexMap<K, V> {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(iter: I) -> Self {
        let mut m = Self::new();
        m.extend(iter);
        m
    }
}

impl<K: Hash + Eq, V, const N: usize> From<[(K, V); N]> for IndexMap<K, V> {
    fn from(arr: [(K, V); N]) -> Self {
        Self::from_iter(arr)
    }
}

impl<K: Hash + Eq, V> core::ops::Index<&K> for IndexMap<K, V> {
    type Output = V;
    #[inline]
    fn index(&self, key: &K) -> &V {
        self.get(key).expect("IndexMap: key not found")
    }
}

extern crate alloc;

pub struct IntoIter<K, V> {
    keys: alloc::vec::IntoIter<K, AstAlloc>,
    values: alloc::vec::IntoIter<V, AstAlloc>,
}
impl<K, V> Iterator for IntoIter<K, V> {
    type Item = (K, V);
    #[inline]
    fn next(&mut self) -> Option<(K, V)> {
        Some((self.keys.next()?, self.values.next()?))
    }
    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.keys.size_hint()
    }
}
impl<K, V> ExactSizeIterator for IntoIter<K, V> {}

impl<K, V> IntoIterator for IndexMap<K, V> {
    type Item = (K, V);
    type IntoIter = IntoIter<K, V>;
    fn into_iter(self) -> IntoIter<K, V> {
        let (keys, values) = self.0.into_entries();
        IntoIter {
            keys: keys.into_iter(),
            values: values.into_iter(),
        }
    }
}
impl<'a, K, V> IntoIterator for &'a IndexMap<K, V> {
    type Item = (&'a K, &'a V);
    type IntoIter = Zip<slice::Iter<'a, K>, slice::Iter<'a, V>>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<K: Hash + Eq, V: PartialEq> PartialEq for IndexMap<K, V> {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len() && self.iter().all(|(k, v)| other.get(k) == Some(v))
    }
}
impl<K: Hash + Eq, V: Eq> Eq for IndexMap<K, V> {}

// ──────────────────────────────────────────────────────────────────────────
// IndexSet
// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
pub struct IndexSet<K>(Inner<K, ()>);

impl<K> IndexSet<K> {
    #[inline]
    pub fn new() -> Self {
        Self(Inner::new())
    }
    #[inline]
    pub fn with_capacity(n: usize) -> Self {
        Self(Inner::with_capacity(n))
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.0.len()
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    #[inline]
    pub fn clear(&mut self) {
        self.0.clear();
    }
    #[inline]
    pub fn reserve(&mut self, additional: usize) {
        self.0.reserve(additional);
    }

    #[inline]
    pub fn iter(&self) -> slice::Iter<'_, K> {
        self.0.keys().iter()
    }
    #[inline]
    pub fn get_index(&self, i: usize) -> Option<&K> {
        self.0.keys().get(i)
    }
    #[inline]
    pub fn first(&self) -> Option<&K> {
        self.0.keys().first()
    }
    #[inline]
    pub fn last(&self) -> Option<&K> {
        self.0.keys().last()
    }
    #[inline]
    pub fn pop(&mut self) -> Option<K> {
        self.0.pop().map(|kv| kv.key)
    }
    #[inline]
    pub fn retain<F: FnMut(&K) -> bool>(&mut self, mut f: F) {
        self.0.retain(|k, _| f(k));
    }
    pub fn drain(&mut self, range: core::ops::RangeFull) -> alloc::vec::IntoIter<K, AstAlloc> {
        let _ = range;
        core::mem::take(&mut self.0).into_entries().0.into_iter()
    }
}

impl<K: Hash + Eq> IndexSet<K> {
    /// Returns `true` if the value was newly inserted.
    #[inline]
    pub fn insert(&mut self, key: K) -> bool {
        self.0.insert(key, ()).is_none()
    }
    #[inline]
    pub fn contains(&self, key: &K) -> bool {
        self.0.contains(key)
    }
    #[inline]
    pub fn get(&self, key: &K) -> Option<&K> {
        self.0.get_index(key).map(|i| &self.0.keys()[i])
    }
    #[inline]
    pub fn get_index_of(&self, key: &K) -> Option<usize> {
        self.0.get_index(key)
    }
    #[inline]
    pub fn shift_remove(&mut self, key: &K) -> bool {
        self.0.remove(key).is_some()
    }
    #[inline]
    pub fn swap_remove(&mut self, key: &K) -> bool {
        self.0.swap_remove(key)
    }
    #[inline]
    pub fn remove(&mut self, key: &K) -> bool {
        self.0.remove(key).is_some()
    }
}

impl<K> Default for IndexSet<K> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl<K: Clone> Clone for IndexSet<K> {
    fn clone(&self) -> Self {
        Self(self.0.clone().expect("OOM"))
    }
}

impl<K: fmt::Debug> fmt::Debug for IndexSet<K> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_set().entries(self.iter()).finish()
    }
}

impl<K: Hash + Eq> Extend<K> for IndexSet<K> {
    fn extend<I: IntoIterator<Item = K>>(&mut self, iter: I) {
        let iter = iter.into_iter();
        let (lo, _) = iter.size_hint();
        self.0.reserve(lo);
        for k in iter {
            self.insert(k);
        }
    }
}

impl<K: Hash + Eq> FromIterator<K> for IndexSet<K> {
    fn from_iter<I: IntoIterator<Item = K>>(iter: I) -> Self {
        let mut s = Self::new();
        s.extend(iter);
        s
    }
}

impl<K: Hash + Eq, const N: usize> From<[K; N]> for IndexSet<K> {
    fn from(arr: [K; N]) -> Self {
        Self::from_iter(arr)
    }
}

impl<K> IntoIterator for IndexSet<K> {
    type Item = K;
    type IntoIter = alloc::vec::IntoIter<K, AstAlloc>;
    fn into_iter(self) -> Self::IntoIter {
        self.0.into_entries().0.into_iter()
    }
}
impl<'a, K> IntoIterator for &'a IndexSet<K> {
    type Item = &'a K;
    type IntoIter = slice::Iter<'a, K>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<K: Hash + Eq> PartialEq for IndexSet<K> {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len() && self.iter().all(|k| other.contains(k))
    }
}
impl<K: Hash + Eq> Eq for IndexSet<K> {}

// ──────────────────────────────────────────────────────────────────────────
// IdMap
// ──────────────────────────────────────────────────────────────────────────

/// Insertion-ordered map keyed by a `u32` newtype id. Stores keys as raw `u32`
/// so every id newtype shares one monomorphization of the underlying map.
pub struct IdMap<K, V>(IndexMap<u32, V>, core::marker::PhantomData<K>);

impl<K: Copy + Into<u32>, V> IdMap<K, V> {
    #[inline]
    pub fn new() -> Self {
        Self(IndexMap::new(), core::marker::PhantomData)
    }
    #[inline]
    pub fn get(&self, k: K) -> Option<&V> {
        self.0.get(&k.into())
    }
    #[inline]
    pub fn get_mut(&mut self, k: K) -> Option<&mut V> {
        self.0.get_mut(&k.into())
    }
    #[inline]
    pub fn insert(&mut self, k: K, v: V) -> Option<V> {
        self.0.insert(k.into(), v)
    }
    #[inline]
    pub fn contains_key(&self, k: K) -> bool {
        self.0.contains_key(&k.into())
    }
    #[inline]
    pub fn entry(&mut self, k: K) -> Entry<'_, u32, V> {
        self.0.entry(k.into())
    }
    #[inline]
    pub fn remove(&mut self, k: K) -> Option<V> {
        self.0.remove(&k.into())
    }
    #[inline]
    pub fn iter(&self) -> impl Iterator<Item = (K, &V)>
    where
        K: From<u32>,
    {
        self.0.iter().map(|(k, v)| (K::from(*k), v))
    }
    #[inline]
    pub fn len(&self) -> usize {
        self.0.len()
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    #[inline]
    pub fn values(&self) -> slice::Iter<'_, V> {
        self.0.values()
    }
    #[inline]
    pub fn values_mut(&mut self) -> slice::IterMut<'_, V> {
        self.0.values_mut()
    }
}

impl<K, V> Default for IdMap<K, V> {
    #[inline]
    fn default() -> Self {
        Self(IndexMap::new(), core::marker::PhantomData)
    }
}

impl<K, V: Clone> Clone for IdMap<K, V> {
    fn clone(&self) -> Self {
        Self(self.0.clone(), core::marker::PhantomData)
    }
}
