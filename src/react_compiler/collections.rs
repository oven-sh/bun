//! Drop-in `IndexMap` / `IndexSet` for the React Compiler port.
//!
//! The allocator is fixed to [`bun_alloc::AstAlloc`], so every map/set built during a compile
//! lives in the per-parse arena and is bulk-freed on reset (no per-entry `Drop`). Keyed by an id
//! they are an [`IdMap`], keyed by anything else a [`bun_collections::ArrayHashMap`]: see [`Key`].
//! Method surface mirrors `indexmap::IndexMap` / `indexmap::IndexSet` closely enough that
//! upstream call sites need only swap the `use` line.
//!
//! Semantic notes vs `indexmap`:
//!   * lookups take `&K` (no `Borrow<Q>` adapter) — every key type in this
//!     crate is a small `Copy` id or an owned `String`, so this is sufficient.

use core::fmt;
use core::hash::Hash;
use core::iter::{FromIterator, Zip};
use core::slice;

use bun_alloc::{AstAlloc, AstVec};
use bun_collections::array_hash_map::{ArrayHashMap, AutoContext};

pub use crate::hir::id_map::{IdBitSet, IdMap};
/// Stable, as `Array.prototype.sort` is: for what upstream sorts, where equals can be told apart.
pub(crate) use bun_collections::index_sort::sort_slice_by;

/// Unordered map/set keyed by small `Copy` ids — `std`'s SipHash is the wrong
/// default for dense `u32` newtypes. The `disallowed_types` lint is satisfied:
/// the hasher is `FxBuildHasher` (same choice `bun_collections::AutoContext`
/// makes for small-int keys), not `RandomState`.
#[allow(clippy::disallowed_types)]
pub type FxHashMap<K, V> = std::collections::HashMap<K, V, rustc_hash::FxBuildHasher>;
#[allow(clippy::disallowed_types)]
pub type FxHashSet<K> = std::collections::HashSet<K, rustc_hash::FxBuildHasher>;

// ──────────────────────────────────────────────────────────────────────────
// Key
// ──────────────────────────────────────────────────────────────────────────

/// What can be the key of an [`IndexMap`] or in an [`IndexSet`], and what these are made of then.
pub trait Key: Sized {
    type Map<V>: Entries<Self, V>;
}

/// Keys and values in insertion order, and a way to find a key.
pub trait Entries<K, V>: Default {
    fn keys(&self) -> &[K];
    fn values(&self) -> &[V];
    fn values_mut(&mut self) -> &mut [V];
    fn iter_mut<'a>(&'a mut self) -> impl Iterator<Item = (&'a K, &'a mut V)>
    where
        K: 'a,
        V: 'a;
    fn into_entries(self) -> (AstVec<K>, AstVec<V>);
    fn position(&self, key: &K) -> Option<usize>;
    /// A key that is there keeps its place.
    fn insert(&mut self, key: K, value: V) -> Option<V>;
    fn get_or_insert_with(&mut self, key: K, make: impl FnOnce() -> V) -> &mut V;
    fn shift_remove(&mut self, key: &K) -> Option<V>;
    fn retain(&mut self, keep: impl FnMut(&K, &mut V) -> bool);
    fn clear(&mut self);
    fn reserve(&mut self, additional: usize);
    fn duplicate(&self) -> Self
    where
        K: Clone,
        V: Clone;
}

type Hashed<K, V> = ArrayHashMap<K, V, AutoContext, AstAlloc>;

impl<K: Hash + Eq, V> Entries<K, V> for Hashed<K, V> {
    #[inline]
    fn keys(&self) -> &[K] {
        self.keys()
    }
    #[inline]
    fn values(&self) -> &[V] {
        self.values()
    }
    #[inline]
    fn values_mut(&mut self) -> &mut [V] {
        self.values_mut()
    }
    fn iter_mut<'a>(&'a mut self) -> impl Iterator<Item = (&'a K, &'a mut V)>
    where
        K: 'a,
        V: 'a,
    {
        self.iterator().map(|e| (&*e.key_ptr, &mut *e.value_ptr))
    }
    fn into_entries(self) -> (AstVec<K>, AstVec<V>) {
        self.into_entries()
    }
    #[inline]
    fn position(&self, key: &K) -> Option<usize> {
        self.get_index(key)
    }
    #[inline]
    fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.insert(key, value)
    }
    #[inline]
    fn get_or_insert_with(&mut self, key: K, make: impl FnOnce() -> V) -> &mut V {
        self.entry(key).or_insert_with(make)
    }
    fn shift_remove(&mut self, key: &K) -> Option<V> {
        self.remove(key)
    }
    fn retain(&mut self, keep: impl FnMut(&K, &mut V) -> bool) {
        self.retain(keep);
    }
    fn clear(&mut self) {
        self.clear();
    }
    fn reserve(&mut self, additional: usize) {
        self.reserve(additional);
    }
    fn duplicate(&self) -> Self
    where
        K: Clone,
        V: Clone,
    {
        self.clone().expect("OOM")
    }
}

impl<K: Copy + Into<u32>, V> Entries<K, V> for IdMap<K, V, AstAlloc> {
    #[inline]
    fn keys(&self) -> &[K] {
        self.as_slices().0
    }
    #[inline]
    fn values(&self) -> &[V] {
        self.as_slices().1
    }
    #[inline]
    fn values_mut(&mut self) -> &mut [V] {
        self.as_mut_slices().1
    }
    fn iter_mut<'a>(&'a mut self) -> impl Iterator<Item = (&'a K, &'a mut V)>
    where
        K: 'a,
        V: 'a,
    {
        let (keys, values) = self.as_mut_slices();
        keys.iter().zip(values)
    }
    fn into_entries(self) -> (AstVec<K>, AstVec<V>) {
        self.into_entries()
    }
    #[inline]
    fn position(&self, key: &K) -> Option<usize> {
        self.position(*key)
    }
    #[inline]
    fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.insert(key, value)
    }
    #[inline]
    fn get_or_insert_with(&mut self, key: K, make: impl FnOnce() -> V) -> &mut V {
        self.entry(key).or_insert_with(make)
    }
    fn shift_remove(&mut self, key: &K) -> Option<V> {
        self.remove(*key)
    }
    fn retain(&mut self, mut keep: impl FnMut(&K, &mut V) -> bool) {
        self.retain(|key, value| keep(&key, value));
    }
    fn clear(&mut self) {
        self.clear();
    }
    fn reserve(&mut self, additional: usize) {
        self.reserve(additional);
    }
    fn duplicate(&self) -> Self
    where
        K: Clone,
        V: Clone,
    {
        self.clone()
    }
}

macro_rules! keys {
    ($map:ident: $($key:ty),* $(,)?) => {$(
        impl Key for $key {
            type Map<V> = $map<Self, V>;
        }
    )*};
}
type ById<K, V> = IdMap<K, V, AstAlloc>;
keys!(ById:
    crate::hir::BlockId,
    crate::hir::DeclarationId,
    crate::hir::IdentifierId,
    crate::hir::ScopeId,
);
keys!(Hashed:
    bun_ast::Ref,
    String,
    &str,
    &[u8],
    crate::diagnostics::SourceLocation,
    crate::hir::PropertyLiteral,
);

// ──────────────────────────────────────────────────────────────────────────
// IndexMap
// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
pub struct IndexMap<K: Key, V>(K::Map<V>);

impl<K: Key, V> IndexMap<K, V> {
    #[inline]
    pub(crate) fn new() -> Self {
        Self(Default::default())
    }

    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.0.keys().len()
    }
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.0.keys().is_empty()
    }

    #[inline]
    pub(crate) fn keys(&self) -> slice::Iter<'_, K> {
        self.0.keys().iter()
    }
    #[inline]
    pub(crate) fn values(&self) -> slice::Iter<'_, V> {
        self.0.values().iter()
    }
    #[inline]
    pub(crate) fn values_mut(&mut self) -> slice::IterMut<'_, V> {
        self.0.values_mut().iter_mut()
    }
    #[inline]
    pub(crate) fn iter(&self) -> Zip<slice::Iter<'_, K>, slice::Iter<'_, V>> {
        self.keys().zip(self.values())
    }
    pub(crate) fn iter_mut(&mut self) -> impl Iterator<Item = (&K, &mut V)> {
        self.0.iter_mut()
    }

    #[inline]
    pub(crate) fn retain<F: FnMut(&K, &mut V) -> bool>(&mut self, f: F) {
        self.0.retain(f);
    }

    /// Remove every entry, yielding `(K, V)` in insertion order.
    pub(crate) fn drain(&mut self, range: core::ops::RangeFull) -> IntoIter<K, V> {
        let _ = range;
        core::mem::take(self).into_iter()
    }

    #[inline]
    pub(crate) fn get(&self, key: &K) -> Option<&V> {
        self.0.position(key).map(|at| &self.0.values()[at])
    }
    #[inline]
    pub(crate) fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        self.0.position(key).map(|at| &mut self.0.values_mut()[at])
    }
    #[inline]
    pub(crate) fn contains_key(&self, key: &K) -> bool {
        self.0.position(key).is_some()
    }
    #[inline]
    pub(crate) fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.0.insert(key, value)
    }
    #[inline]
    pub(crate) fn entry(&mut self, key: K) -> Entry<'_, K, V> {
        Entry { map: self, key }
    }
    /// Order-preserving remove. O(n).
    #[inline]
    pub(crate) fn shift_remove(&mut self, key: &K) -> Option<V> {
        self.0.shift_remove(key)
    }
}

pub struct Entry<'a, K: Key, V> {
    map: &'a mut IndexMap<K, V>,
    key: K,
}

impl<'a, K: Key, V> Entry<'a, K, V> {
    #[inline]
    pub(crate) fn or_insert_with<F: FnOnce() -> V>(self, f: F) -> &'a mut V {
        self.map.0.get_or_insert_with(self.key, f)
    }
    #[inline]
    pub(crate) fn or_default(self) -> &'a mut V
    where
        V: Default,
    {
        self.or_insert_with(V::default)
    }
}

impl<K: Key, V> Default for IndexMap<K, V> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl<K: Key + Clone, V: Clone> Clone for IndexMap<K, V> {
    fn clone(&self) -> Self {
        Self(self.0.duplicate())
    }
}

impl<K: Key + fmt::Debug, V: fmt::Debug> fmt::Debug for IndexMap<K, V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_map().entries(self.iter()).finish()
    }
}

impl<K: Key, V> Extend<(K, V)> for IndexMap<K, V> {
    fn extend<I: IntoIterator<Item = (K, V)>>(&mut self, iter: I) {
        let iter = iter.into_iter();
        let (lo, _) = iter.size_hint();
        self.0.reserve(lo);
        for (k, v) in iter {
            self.0.insert(k, v);
        }
    }
}

impl<K: Key, V> FromIterator<(K, V)> for IndexMap<K, V> {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(iter: I) -> Self {
        let mut m = Self::new();
        m.extend(iter);
        m
    }
}

impl<K: Key, V, const N: usize> From<[(K, V); N]> for IndexMap<K, V> {
    fn from(arr: [(K, V); N]) -> Self {
        Self::from_iter(arr)
    }
}

impl<K: Key, V> core::ops::Index<&K> for IndexMap<K, V> {
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

impl<K: Key, V> IntoIterator for IndexMap<K, V> {
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
impl<'a, K: Key, V> IntoIterator for &'a IndexMap<K, V> {
    type Item = (&'a K, &'a V);
    type IntoIter = Zip<slice::Iter<'a, K>, slice::Iter<'a, V>>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<K: Key, V: PartialEq> PartialEq for IndexMap<K, V> {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len() && self.iter().all(|(k, v)| other.get(k) == Some(v))
    }
}
impl<K: Key, V: Eq> Eq for IndexMap<K, V> {}

// ──────────────────────────────────────────────────────────────────────────
// IndexSet
// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
pub struct IndexSet<K: Key>(K::Map<()>);

impl<K: Key> IndexSet<K> {
    #[inline]
    pub(crate) fn new() -> Self {
        Self(Default::default())
    }

    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.0.keys().len()
    }
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.0.keys().is_empty()
    }
    #[inline]
    pub(crate) fn clear(&mut self) {
        self.0.clear();
    }

    #[inline]
    pub(crate) fn iter(&self) -> slice::Iter<'_, K> {
        self.0.keys().iter()
    }

    /// Returns `true` if the value was newly inserted.
    #[inline]
    pub(crate) fn insert(&mut self, key: K) -> bool {
        self.0.insert(key, ()).is_none()
    }
    #[inline]
    pub(crate) fn contains(&self, key: &K) -> bool {
        self.0.position(key).is_some()
    }
    #[inline]
    pub(crate) fn shift_remove(&mut self, key: &K) -> bool {
        self.0.shift_remove(key).is_some()
    }
}

impl<K: Key> Default for IndexSet<K> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl<K: Key + Clone> Clone for IndexSet<K> {
    fn clone(&self) -> Self {
        Self(self.0.duplicate())
    }
}

impl<K: Key + fmt::Debug> fmt::Debug for IndexSet<K> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_set().entries(self.iter()).finish()
    }
}

impl<K: Key> Extend<K> for IndexSet<K> {
    fn extend<I: IntoIterator<Item = K>>(&mut self, iter: I) {
        let iter = iter.into_iter();
        let (lo, _) = iter.size_hint();
        self.0.reserve(lo);
        for k in iter {
            self.insert(k);
        }
    }
}

impl<K: Key> FromIterator<K> for IndexSet<K> {
    fn from_iter<I: IntoIterator<Item = K>>(iter: I) -> Self {
        let mut s = Self::new();
        s.extend(iter);
        s
    }
}

impl<K: Key, const N: usize> From<[K; N]> for IndexSet<K> {
    fn from(arr: [K; N]) -> Self {
        Self::from_iter(arr)
    }
}

impl<K: Key> IntoIterator for IndexSet<K> {
    type Item = K;
    type IntoIter = alloc::vec::IntoIter<K, AstAlloc>;
    fn into_iter(self) -> Self::IntoIter {
        self.0.into_entries().0.into_iter()
    }
}
impl<'a, K: Key> IntoIterator for &'a IndexSet<K> {
    type Item = &'a K;
    type IntoIter = slice::Iter<'a, K>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<K: Key> PartialEq for IndexSet<K> {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len() && self.iter().all(|k| other.contains(k))
    }
}
impl<K: Key> Eq for IndexSet<K> {}
