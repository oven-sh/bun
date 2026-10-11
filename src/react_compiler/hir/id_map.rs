//! Containers keyed by the id newtypes. The ids of a compile are small consecutive numbers, so an
//! id indexes a table directly: nothing is hashed.
//!
//! [`IdMap`] iterates in insertion order, as a JavaScript `Map` does.
//! [`IdBitSet`] iterates in the order of the ids.
//!
//! A table has two levels, so that what is written for it grows with the ids that are in it and
//! only a thirty-second part with their range. Up to [`SCAN_MAX`] entries there is none.

use core::fmt;
use core::marker::PhantomData;
use core::slice;
use std::alloc::Global;

use bun_collections::array_hash_map::MapAllocator;

/// With no more entries than this the keys are scanned and there is no table.
const SCAN_MAX: usize = 8;

/// The ids that share a page of a [`Table`].
const PAGE: u32 = 32;

/// A number for each id, zero for most.
#[derive(Clone)]
struct Table<A: MapAllocator> {
    /// By id / [`PAGE`] less `first_page`: which of the pages in `slots` is that of the id,
    /// counted from one, or zero.
    pages: Vec<u32, A>,
    slots: Vec<u32, A>,
    first_page: u32,
}

impl<A: MapAllocator> Table<A> {
    #[inline]
    fn new() -> Self {
        Table {
            pages: Vec::new_in(A::default()),
            slots: Vec::new_in(A::default()),
            first_page: 0,
        }
    }

    /// Nothing was ever written.
    #[inline]
    fn is_empty(&self) -> bool {
        self.pages.is_empty()
    }

    fn clear(&mut self) {
        self.pages.clear();
        self.slots.clear();
    }

    #[inline]
    fn get(&self, id: u32) -> u32 {
        match self
            .pages
            .get((id / PAGE).wrapping_sub(self.first_page) as usize)
        {
            Some(&page) if page != 0 => self.slots[((page - 1) * PAGE + id % PAGE) as usize],
            _ => 0,
        }
    }

    #[inline]
    fn get_mut(&mut self, id: u32) -> &mut u32 {
        let known = (id / PAGE).checked_sub(self.first_page);
        let page = match known.and_then(|at| self.pages.get(at as usize)) {
            Some(&page) if page != 0 => page,
            _ => self.add_page(id / PAGE),
        };
        &mut self.slots[((page - 1) * PAGE + id % PAGE) as usize]
    }

    /// `pages` doubles at the end where it is too short, so that ids which come in rising or in
    /// falling order lengthen it seldom.
    #[inline(never)]
    fn add_page(&mut self, number: u32) -> u32 {
        if self.pages.is_empty() {
            self.first_page = number;
        }
        if number < self.first_page {
            let missing = (self.first_page - number).max(self.pages.len() as u32);
            let missing = missing.min(self.first_page);
            let mut pages =
                Vec::with_capacity_in(missing as usize + self.pages.len(), A::default());
            pages.resize(missing as usize, 0);
            pages.extend_from_slice(&self.pages);
            self.pages = pages;
            self.first_page -= missing;
        }
        let at = (number - self.first_page) as usize;
        if at >= self.pages.len() {
            self.pages.resize((at + 1).max(self.pages.len() * 2), 0);
        }
        self.slots.extend_from_slice(&[0; PAGE as usize]);
        self.pages[at] = self.slots.len() as u32 / PAGE;
        self.pages[at]
    }
}

/// The keys in insertion order, and where each is.
#[derive(Clone)]
struct IdIndex<K, A: MapAllocator> {
    keys: Vec<K, A>,
    /// By id: the position of the key plus one. Empty until there are more than [`SCAN_MAX`] keys.
    places: Table<A>,
}

impl<K, A: MapAllocator> IdIndex<K, A> {
    #[inline]
    fn new() -> Self {
        IdIndex {
            keys: Vec::new_in(A::default()),
            places: Table::new(),
        }
    }

    fn clear(&mut self) {
        self.keys.clear();
        self.places.clear();
    }
}

impl<K: Copy + Into<u32>, A: MapAllocator> IdIndex<K, A> {
    #[inline]
    fn position(&self, key: K) -> Option<usize> {
        let id = key.into();
        if self.places.is_empty() {
            return self.keys.iter().position(|&key| key.into() == id);
        }
        let at = (self.places.get(id) as usize).checked_sub(1)?;
        debug_assert!(self.keys[at].into() == id);
        Some(at)
    }

    /// Appends a key that is not there and says where it is.
    #[inline]
    fn push(&mut self, key: K) -> usize {
        let at = self.keys.len();
        self.keys.push(key);
        if !self.places.is_empty() {
            *self.places.get_mut(key.into()) = at as u32 + 1;
        } else if at >= SCAN_MAX {
            self.fill_places();
        }
        at
    }

    #[cold]
    #[inline(never)]
    fn fill_places(&mut self) {
        self.places.clear();
        for (at, &key) in self.keys.iter().enumerate() {
            *self.places.get_mut(key.into()) = at as u32 + 1;
        }
    }

    /// Keeps the order of the rest.
    fn shift_remove_at(&mut self, at: usize) -> K {
        let key = self.keys.remove(at);
        if !self.places.is_empty() {
            *self.places.get_mut(key.into()) = 0;
            for &later in &self.keys[at..] {
                *self.places.get_mut(later.into()) -= 1;
            }
        }
        key
    }

    /// The last key takes the place of the removed one.
    fn swap_remove_at(&mut self, at: usize) -> K {
        let key = self.keys.swap_remove(at);
        if !self.places.is_empty() {
            *self.places.get_mut(key.into()) = 0;
            if let Some(&moved) = self.keys.get(at) {
                *self.places.get_mut(moved.into()) = at as u32 + 1;
            }
        }
        key
    }
}

// ──────────────────────────────────────────────────────────────────────────
// IdMap
// ──────────────────────────────────────────────────────────────────────────

/// Insertion-ordered map keyed by a `u32` newtype id.
pub struct IdMap<K, V, A: MapAllocator = Global> {
    index: IdIndex<K, A>,
    values: Vec<V, A>,
}

impl<K, V, A: MapAllocator> IdMap<K, V, A> {
    #[inline]
    pub(crate) fn new() -> Self {
        Self {
            index: IdIndex::new(),
            values: Vec::new_in(A::default()),
        }
    }
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.values.len()
    }
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.values.is_empty()
    }
    #[inline]
    pub(crate) fn keys(&self) -> core::iter::Copied<slice::Iter<'_, K>>
    where
        K: Copy,
    {
        self.index.keys.iter().copied()
    }
    #[inline]
    pub(crate) fn values(&self) -> slice::Iter<'_, V> {
        self.values.iter()
    }
    #[inline]
    pub(crate) fn iter(&self) -> impl ExactSizeIterator<Item = (K, &V)>
    where
        K: Copy,
    {
        self.keys().zip(&self.values)
    }
    /// The keys and the values, each in insertion order.
    #[inline]
    pub(crate) fn as_slices(&self) -> (&[K], &[V]) {
        (&self.index.keys, &self.values)
    }
    #[inline]
    pub(crate) fn as_mut_slices(&mut self) -> (&[K], &mut [V]) {
        (&self.index.keys, &mut self.values)
    }
    pub(crate) fn into_entries(self) -> (Vec<K, A>, Vec<V, A>) {
        (self.index.keys, self.values)
    }
    pub(crate) fn clear(&mut self) {
        self.index.clear();
        self.values.clear();
    }
    pub(crate) fn reserve(&mut self, additional: usize) {
        self.index.keys.reserve(additional);
        self.values.reserve(additional);
    }
}

impl<K: Copy + Into<u32>, V, A: MapAllocator> IdMap<K, V, A> {
    /// Where the key is in insertion order.
    #[inline]
    pub(crate) fn position(&self, k: K) -> Option<usize> {
        self.index.position(k)
    }
    #[inline]
    pub(crate) fn get(&self, k: K) -> Option<&V> {
        self.index.position(k).map(|at| &self.values[at])
    }
    #[inline]
    pub(crate) fn get_mut(&mut self, k: K) -> Option<&mut V> {
        self.index.position(k).map(|at| &mut self.values[at])
    }
    #[inline]
    pub(crate) fn contains_key(&self, k: K) -> bool {
        self.index.position(k).is_some()
    }
    /// A key that is there keeps its place.
    #[inline]
    pub(crate) fn insert(&mut self, k: K, v: V) -> Option<V> {
        match self.index.position(k) {
            Some(at) => Some(core::mem::replace(&mut self.values[at], v)),
            None => {
                self.index.push(k);
                self.values.push(v);
                None
            }
        }
    }
    #[inline]
    pub(crate) fn entry(&mut self, k: K) -> IdEntry<'_, K, V, A> {
        let at = self.index.position(k);
        IdEntry {
            map: self,
            key: k,
            at,
        }
    }
    /// Order-preserving remove. O(n).
    pub(crate) fn remove(&mut self, k: K) -> Option<V> {
        let at = self.index.position(k)?;
        self.index.shift_remove_at(at);
        Some(self.values.remove(at))
    }
    /// O(1) remove; does not preserve order.
    pub(crate) fn swap_remove(&mut self, k: K) -> Option<V> {
        let at = self.index.position(k)?;
        self.index.swap_remove_at(at);
        Some(self.values.swap_remove(at))
    }
    pub(crate) fn retain(&mut self, mut keep: impl FnMut(K, &mut V) -> bool) {
        let before = self.values.len();
        let mut at = 0;
        let keys = &mut self.index.keys;
        let mut kept = 0;
        self.values.retain_mut(|value| {
            let key = keys[at];
            at += 1;
            let keeps = keep(key, value);
            if keeps {
                keys[kept] = key;
                kept += 1;
            }
            keeps
        });
        keys.truncate(kept);
        if kept != before && !self.index.places.is_empty() {
            self.index.fill_places();
        }
    }
}

impl<K, V, A: MapAllocator> Default for IdMap<K, V, A> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl<K: Clone, V: Clone, A: MapAllocator> Clone for IdMap<K, V, A> {
    fn clone(&self) -> Self {
        Self {
            index: self.index.clone(),
            values: self.values.clone(),
        }
    }
}

impl<K: Copy + fmt::Debug, V: fmt::Debug, A: MapAllocator> fmt::Debug for IdMap<K, V, A> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_map().entries(self.iter()).finish()
    }
}

impl<K: Copy + Into<u32>, V, A: MapAllocator> Extend<(K, V)> for IdMap<K, V, A> {
    fn extend<I: IntoIterator<Item = (K, V)>>(&mut self, iter: I) {
        for (k, v) in iter {
            self.insert(k, v);
        }
    }
}

impl<K: Copy + Into<u32>, V, A: MapAllocator> FromIterator<(K, V)> for IdMap<K, V, A> {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(iter: I) -> Self {
        let mut map = Self::new();
        map.extend(iter);
        map
    }
}

impl<K, V, A: MapAllocator> IntoIterator for IdMap<K, V, A> {
    type Item = (K, V);
    type IntoIter = core::iter::Zip<std::vec::IntoIter<K, A>, std::vec::IntoIter<V, A>>;
    fn into_iter(self) -> Self::IntoIter {
        self.index.keys.into_iter().zip(self.values)
    }
}

pub struct IdEntry<'a, K, V, A: MapAllocator = Global> {
    map: &'a mut IdMap<K, V, A>,
    key: K,
    at: Option<usize>,
}

impl<'a, K: Copy + Into<u32>, V, A: MapAllocator> IdEntry<'a, K, V, A> {
    #[inline]
    pub(crate) fn or_insert_with(self, make: impl FnOnce() -> V) -> &'a mut V {
        let at = match self.at {
            Some(at) => at,
            None => {
                self.map.values.push(make());
                self.map.index.push(self.key)
            }
        };
        &mut self.map.values[at]
    }
    #[inline]
    pub(crate) fn or_insert(self, default: V) -> &'a mut V {
        self.or_insert_with(|| default)
    }
    #[inline]
    pub(crate) fn or_default(self) -> &'a mut V
    where
        V: Default,
    {
        self.or_insert_with(V::default)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// IdBitSet
// ──────────────────────────────────────────────────────────────────────────

/// Set of a `u32` newtype id, a bit for each. Iterates in the order of the ids, NOT of insertion.
pub struct IdBitSet<K> {
    words: Vec<u64>,
    len: usize,
    key: PhantomData<K>,
}

impl<K> IdBitSet<K> {
    #[inline]
    pub(crate) fn new() -> Self {
        Self {
            words: Vec::new(),
            len: 0,
            key: PhantomData,
        }
    }
    /// With room for the ids below `ids`. It still grows for others.
    pub(crate) fn with_ids(ids: usize) -> Self {
        Self {
            words: vec![0; ids.div_ceil(64)],
            len: 0,
            key: PhantomData,
        }
    }
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.len
    }
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.len == 0
    }
    /// Keeps the room.
    pub(crate) fn clear(&mut self) {
        self.words.fill(0);
        self.len = 0;
    }
}

impl<K: Copy + Into<u32>> IdBitSet<K> {
    /// Returns `true` if the value was newly inserted.
    #[inline]
    pub(crate) fn insert(&mut self, k: K) -> bool {
        let id = k.into() as usize;
        if id / 64 >= self.words.len() {
            self.words
                .resize((id / 64 + 1).max(self.words.len() * 2), 0);
        }
        let word = &mut self.words[id / 64];
        let bit = 1u64 << (id % 64);
        let is_new = *word & bit == 0;
        *word |= bit;
        self.len += is_new as usize;
        is_new
    }
    #[inline]
    pub(crate) fn contains(&self, k: K) -> bool {
        let id = k.into() as usize;
        match self.words.get(id / 64) {
            Some(word) => word & (1u64 << (id % 64)) != 0,
            None => false,
        }
    }
}

impl<K: Copy + From<u32>> IdBitSet<K> {
    /// In the order of the ids.
    pub(crate) fn iter(&self) -> impl Iterator<Item = K> + '_ {
        self.words.iter().enumerate().flat_map(|(at, &word)| {
            let mut rest = word;
            core::iter::from_fn(move || {
                if rest == 0 {
                    return None;
                }
                let bit = rest.trailing_zeros();
                rest &= rest - 1;
                Some(K::from(at as u32 * 64 + bit))
            })
        })
    }
}

impl<K> Default for IdBitSet<K> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl<K> Clone for IdBitSet<K> {
    fn clone(&self) -> Self {
        Self {
            words: self.words.clone(),
            len: self.len,
            key: PhantomData,
        }
    }
}

impl<K> PartialEq for IdBitSet<K> {
    fn eq(&self, other: &Self) -> bool {
        let shared = self.words.len().min(other.words.len());
        self.len == other.len && self.words[..shared] == other.words[..shared]
    }
}
impl<K> Eq for IdBitSet<K> {}

impl<K: Copy + From<u32> + fmt::Debug> fmt::Debug for IdBitSet<K> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_set().entries(self.iter()).finish()
    }
}

impl<K: Copy + Into<u32>> Extend<K> for IdBitSet<K> {
    fn extend<I: IntoIterator<Item = K>>(&mut self, iter: I) {
        for k in iter {
            self.insert(k);
        }
    }
}

impl<K: Copy + Into<u32>> FromIterator<K> for IdBitSet<K> {
    fn from_iter<I: IntoIterator<Item = K>>(iter: I) -> Self {
        let mut set = Self::new();
        set.extend(iter);
        set
    }
}
