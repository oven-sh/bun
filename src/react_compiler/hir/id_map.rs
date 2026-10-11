//! Containers keyed by the id newtypes. The ids of a compile are small consecutive numbers, so an
//! id indexes a table directly: nothing is hashed.
//!
//! [`IdMap`] and [`IdSet`] iterate in insertion order, as a JavaScript `Map` and `Set` do.
//! [`IdBitSet`] iterates in the order of the ids.
//!
//! The tables are as long as the largest id, so one of these per function or per pass is cheap and
//! one per instruction is not, unless it stays within [`SCAN_MAX`] entries.

use core::fmt;
use core::marker::PhantomData;
use core::slice;

/// With no more entries than this the keys are scanned and there is no table.
const SCAN_MAX: usize = 8;

/// The keys in insertion order, and where each is.
#[derive(Clone, Default)]
struct IdIndex {
    keys: Vec<u32>,
    /// By id: the position of the key plus one, or zero. Empty until there are more than
    /// [`SCAN_MAX`] keys.
    slots: Vec<u32>,
}

impl IdIndex {
    #[inline]
    fn position(&self, id: u32) -> Option<usize> {
        if self.slots.is_empty() {
            return self.keys.iter().position(|&key| key == id);
        }
        match self.slots.get(id as usize) {
            Some(&slot) if slot != 0 => Some(slot as usize - 1),
            _ => None,
        }
    }

    /// Appends a key that is not there and says where it is.
    #[inline]
    fn push(&mut self, id: u32) -> usize {
        let at = self.keys.len();
        self.keys.push(id);
        if !self.slots.is_empty() {
            self.set_slot(id, at);
        } else if at >= SCAN_MAX {
            self.fill_slots();
        }
        at
    }

    #[inline]
    fn set_slot(&mut self, id: u32, at: usize) {
        let id = id as usize;
        if id >= self.slots.len() {
            self.slots.resize(id + 1, 0);
        }
        self.slots[id] = at as u32 + 1;
    }

    #[cold]
    #[inline(never)]
    fn fill_slots(&mut self) {
        let largest = self.keys.iter().copied().max().unwrap_or(0) as usize;
        self.slots.clear();
        self.slots.resize(largest + 1, 0);
        for (at, &id) in self.keys.iter().enumerate() {
            self.slots[id as usize] = at as u32 + 1;
        }
    }

    /// Keeps the order of the rest.
    fn shift_remove_at(&mut self, at: usize) {
        let id = self.keys.remove(at);
        if !self.slots.is_empty() {
            self.slots[id as usize] = 0;
            for &later in &self.keys[at..] {
                self.slots[later as usize] -= 1;
            }
        }
    }

    /// The last key takes the place of the removed one.
    fn swap_remove_at(&mut self, at: usize) {
        let id = self.keys.swap_remove(at);
        if !self.slots.is_empty() {
            self.slots[id as usize] = 0;
            if let Some(&moved) = self.keys.get(at) {
                self.slots[moved as usize] = at as u32 + 1;
            }
        }
    }

    fn clear(&mut self) {
        self.keys.clear();
        self.slots.clear();
    }

    /// After the keys were filtered in place.
    fn reindex(&mut self) {
        if !self.slots.is_empty() {
            self.fill_slots();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// IdMap
// ──────────────────────────────────────────────────────────────────────────

/// Insertion-ordered map keyed by a `u32` newtype id.
pub struct IdMap<K, V> {
    index: IdIndex,
    values: Vec<V>,
    key: PhantomData<K>,
}

impl<K, V> IdMap<K, V> {
    #[inline]
    pub(crate) fn new() -> Self {
        Self {
            index: IdIndex::default(),
            values: Vec::new(),
            key: PhantomData,
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
    pub(crate) fn values(&self) -> slice::Iter<'_, V> {
        self.values.iter()
    }
    #[inline]
    pub(crate) fn values_mut(&mut self) -> slice::IterMut<'_, V> {
        self.values.iter_mut()
    }
    pub(crate) fn clear(&mut self) {
        self.index.clear();
        self.values.clear();
    }
}

impl<K: Copy + Into<u32>, V> IdMap<K, V> {
    #[inline]
    pub(crate) fn get(&self, k: K) -> Option<&V> {
        self.index.position(k.into()).map(|at| &self.values[at])
    }
    #[inline]
    pub(crate) fn get_mut(&mut self, k: K) -> Option<&mut V> {
        self.index
            .position(k.into())
            .map(|at| &mut self.values[at])
    }
    #[inline]
    pub(crate) fn contains_key(&self, k: K) -> bool {
        self.index.position(k.into()).is_some()
    }
    /// A key that is there keeps its place.
    #[inline]
    pub(crate) fn insert(&mut self, k: K, v: V) -> Option<V> {
        let id = k.into();
        match self.index.position(id) {
            Some(at) => Some(core::mem::replace(&mut self.values[at], v)),
            None => {
                self.index.push(id);
                self.values.push(v);
                None
            }
        }
    }
    #[inline]
    pub(crate) fn entry(&mut self, k: K) -> IdEntry<'_, K, V> {
        let id = k.into();
        let at = self.index.position(id);
        IdEntry { map: self, id, at }
    }
    /// Order-preserving remove. O(n).
    pub(crate) fn remove(&mut self, k: K) -> Option<V> {
        let at = self.index.position(k.into())?;
        self.index.shift_remove_at(at);
        Some(self.values.remove(at))
    }
    /// O(1) remove; does not preserve order.
    pub(crate) fn swap_remove(&mut self, k: K) -> Option<V> {
        let at = self.index.position(k.into())?;
        self.index.swap_remove_at(at);
        Some(self.values.swap_remove(at))
    }
}

impl<K: Copy + From<u32>, V> IdMap<K, V> {
    #[inline]
    pub(crate) fn keys(&self) -> impl ExactSizeIterator<Item = K> + '_ {
        self.index.keys.iter().map(|&id| K::from(id))
    }
    #[inline]
    pub(crate) fn iter(&self) -> impl ExactSizeIterator<Item = (K, &V)> {
        self.index
            .keys
            .iter()
            .map(|&id| K::from(id))
            .zip(&self.values)
    }
    #[inline]
    pub(crate) fn iter_mut(&mut self) -> impl ExactSizeIterator<Item = (K, &mut V)> {
        self.index
            .keys
            .iter()
            .map(|&id| K::from(id))
            .zip(&mut self.values)
    }
    pub(crate) fn retain(&mut self, mut keep: impl FnMut(K, &mut V) -> bool) {
        let mut kept = Vec::with_capacity(self.index.keys.len());
        let mut keys = self.index.keys.iter();
        self.values.retain_mut(|value| {
            let id = *keys.next().expect("a key for each value");
            let keeps = keep(K::from(id), value);
            if keeps {
                kept.push(id);
            }
            keeps
        });
        self.index.keys = kept;
        self.index.reindex();
    }
}

impl<K, V> Default for IdMap<K, V> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl<K, V: Clone> Clone for IdMap<K, V> {
    fn clone(&self) -> Self {
        Self {
            index: self.index.clone(),
            values: self.values.clone(),
            key: PhantomData,
        }
    }
}

impl<K: Copy + From<u32> + fmt::Debug, V: fmt::Debug> fmt::Debug for IdMap<K, V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_map().entries(self.iter()).finish()
    }
}

impl<K: Copy + Into<u32>, V> Extend<(K, V)> for IdMap<K, V> {
    fn extend<I: IntoIterator<Item = (K, V)>>(&mut self, iter: I) {
        for (k, v) in iter {
            self.insert(k, v);
        }
    }
}

impl<K: Copy + Into<u32>, V> FromIterator<(K, V)> for IdMap<K, V> {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(iter: I) -> Self {
        let mut map = Self::new();
        map.extend(iter);
        map
    }
}

impl<K: Copy + From<u32>, V> IntoIterator for IdMap<K, V> {
    type Item = (K, V);
    type IntoIter = core::iter::Zip<
        core::iter::Map<std::vec::IntoIter<u32>, fn(u32) -> K>,
        std::vec::IntoIter<V>,
    >;
    fn into_iter(self) -> Self::IntoIter {
        self.index
            .keys
            .into_iter()
            .map(K::from as fn(u32) -> K)
            .zip(self.values)
    }
}

pub struct IdEntry<'a, K, V> {
    map: &'a mut IdMap<K, V>,
    id: u32,
    at: Option<usize>,
}

impl<'a, K, V> IdEntry<'a, K, V> {
    #[inline]
    pub(crate) fn or_insert_with(self, make: impl FnOnce() -> V) -> &'a mut V {
        let at = match self.at {
            Some(at) => at,
            None => {
                self.map.values.push(make());
                self.map.index.push(self.id)
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
// IdSet
// ──────────────────────────────────────────────────────────────────────────

/// Insertion-ordered set of a `u32` newtype id.
pub struct IdSet<K> {
    index: IdIndex,
    key: PhantomData<K>,
}

impl<K> IdSet<K> {
    #[inline]
    pub(crate) fn new() -> Self {
        Self {
            index: IdIndex::default(),
            key: PhantomData,
        }
    }
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.index.keys.len()
    }
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.index.keys.is_empty()
    }
    pub(crate) fn clear(&mut self) {
        self.index.clear();
    }
}

impl<K: Copy + Into<u32>> IdSet<K> {
    /// Returns `true` if the value was newly inserted.
    #[inline]
    pub(crate) fn insert(&mut self, k: K) -> bool {
        let id = k.into();
        let is_new = self.index.position(id).is_none();
        if is_new {
            self.index.push(id);
        }
        is_new
    }
    #[inline]
    pub(crate) fn contains(&self, k: K) -> bool {
        self.index.position(k.into()).is_some()
    }
    /// Order-preserving remove. O(n).
    pub(crate) fn remove(&mut self, k: K) -> bool {
        match self.index.position(k.into()) {
            Some(at) => {
                self.index.shift_remove_at(at);
                true
            }
            None => false,
        }
    }
}

impl<K: Copy + From<u32>> IdSet<K> {
    #[inline]
    pub(crate) fn iter(&self) -> impl ExactSizeIterator<Item = K> + DoubleEndedIterator + '_ {
        self.index.keys.iter().map(|&id| K::from(id))
    }
}

impl<K> Default for IdSet<K> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl<K> Clone for IdSet<K> {
    fn clone(&self) -> Self {
        Self {
            index: self.index.clone(),
            key: PhantomData,
        }
    }
}

impl<K: Copy + From<u32> + fmt::Debug> fmt::Debug for IdSet<K> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_set().entries(self.iter()).finish()
    }
}

impl<K: Copy + Into<u32>> Extend<K> for IdSet<K> {
    fn extend<I: IntoIterator<Item = K>>(&mut self, iter: I) {
        for k in iter {
            self.insert(k);
        }
    }
}

impl<K: Copy + Into<u32>> FromIterator<K> for IdSet<K> {
    fn from_iter<I: IntoIterator<Item = K>>(iter: I) -> Self {
        let mut set = Self::new();
        set.extend(iter);
        set
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
    /// Adds all of `other` and says whether that added anything.
    pub(crate) fn union_with(&mut self, other: &Self) -> bool {
        if self.words.len() < other.words.len() {
            self.words.resize(other.words.len(), 0);
        }
        let before = self.len;
        for (word, &more) in self.words.iter_mut().zip(&other.words) {
            self.len += (more & !*word).count_ones() as usize;
            *word |= more;
        }
        self.len != before
    }
    /// Keeps what is also in `other` and says whether that removed anything.
    pub(crate) fn intersect_with(&mut self, other: &Self) -> bool {
        let before = self.len;
        for (at, word) in self.words.iter_mut().enumerate() {
            let kept = *word & other.words.get(at).copied().unwrap_or(0);
            self.len -= (*word & !kept).count_ones() as usize;
            *word = kept;
        }
        self.len != before
    }
}

impl<K: Copy + Into<u32>> IdBitSet<K> {
    /// Returns `true` if the value was newly inserted.
    #[inline]
    pub(crate) fn insert(&mut self, k: K) -> bool {
        let id = k.into() as usize;
        if id / 64 >= self.words.len() {
            self.words.resize(id / 64 + 1, 0);
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
    /// Returns `true` if the value was there.
    #[inline]
    pub(crate) fn remove(&mut self, k: K) -> bool {
        let id = k.into() as usize;
        let Some(word) = self.words.get_mut(id / 64) else {
            return false;
        };
        let bit = 1u64 << (id % 64);
        let was_there = *word & bit != 0;
        *word &= !bit;
        self.len -= was_there as usize;
        was_there
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
