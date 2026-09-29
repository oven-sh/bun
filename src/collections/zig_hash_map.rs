//! Open-addressing hash map — linear-probe, backward-shift delete,
//! power-of-two capacity, 80% max load. The layout of a map that only inserts
//! (and therefore its iteration order) is load-bearing: callers snapshot the
//! iteration sequence (e.g. `bun.lock`, lockfile debug stringify). A removal
//! moves the later entries of its run back by one or more slots, so the order
//! after a removal is unspecified.
//!
//! A removal walks its run to the next free slot and hashes every key it
//! passes. Runs are short only when the hash spreads the keys: use
//! `IdentityContext` for keys that are hashes already, never for dense
//! integers.
//!
//! Storage is split: `Vec<u8>` for metadata + `Vec<Option<(K, V)>>` for
//! slots. This costs an `Option` discriminant per slot but keeps the
//! implementation in safe Rust; slot indices and the metadata state machine
//! determine iteration order.

use core::borrow::Borrow;
use core::hash::Hash;
use core::marker::PhantomData;

use crate::identity_context::{IdentityContext, IdentityHash};

// ─── Metadata byte ─────────────────────────────────────────────────────────
// bit 7 = `used`, bits 0..7 = `fingerprint`.
const SLOT_FREE: u8 = 0x00; // used=0, fp=0

#[inline]
fn meta_is_used(m: u8) -> bool {
    m & 0x80 != 0
}
/// Top 7 bits of the 64-bit hash.
#[inline]
fn take_fingerprint(hash: u64) -> u8 {
    (hash >> (64 - 7)) as u8
}
#[inline]
fn meta_fill(fp: u8) -> u8 {
    0x80 | (fp & 0x7F)
}

const MINIMAL_CAPACITY: u32 = 8;
/// Maximum load percentage before growth. All instantiations use 80, so this
/// is a const rather than a generic parameter.
const MAX_LOAD_PERCENTAGE: u64 = 80;

#[inline]
fn capacity_for_size(size: u32) -> u32 {
    let new_cap = ((size as u64 * 100) / MAX_LOAD_PERCENTAGE + 1) as u32;
    new_cap.next_power_of_two()
}

// ─── HashContext ───────────────────────────────────────────────────────────
// The hash/eql strategy is a stateless trait keyed on a zero-sized marker
// type. `AutoHashContext` is the default; `IdentityContext<K>` covers the
// `hash(k) == k` case used for pre-hashed keys.

/// Hash/eql strategy for [`HashMap`]. Implement on a zero-sized marker type.
pub trait HashContext<K: ?Sized> {
    fn ctx_hash(key: &K) -> u64;
    fn ctx_eql(a: &K, b: &K) -> bool;
}

/// `std.AutoHashMap` context — wyhash over the key's `Hash` representation.
#[derive(Default, Clone, Copy)]
pub struct AutoHashContext;

impl<K: Hash + Eq + ?Sized> HashContext<K> for AutoHashContext {
    #[inline]
    fn ctx_hash(key: &K) -> u64 {
        // wyhash routed through `core::hash::Hash`; exact bucket order for
        // this context isn't relied on by any test today.
        bun_wyhash::auto_hash(key)
    }
    #[inline]
    fn ctx_eql(a: &K, b: &K) -> bool {
        a == b
    }
}

impl<K: IdentityHash> HashContext<K> for IdentityContext<K> {
    #[inline]
    fn ctx_hash(key: &K) -> u64 {
        key.identity_hash()
    }
    #[inline]
    fn ctx_eql(a: &K, b: &K) -> bool {
        a == b
    }
}

// ─── HashMap ───────────────────────────────────────────────────────────────

pub struct HashMap<K, V, C = AutoHashContext> {
    metadata: Vec<u8>,
    slots: Vec<Option<(K, V)>>,
    size: u32,
    /// Entries that fit before a grow.
    available: u32,
    _ctx: PhantomData<C>,
}

impl<K, V, C> Default for HashMap<K, V, C> {
    #[inline]
    fn default() -> Self {
        Self {
            metadata: Vec::new(),
            slots: Vec::new(),
            size: 0,
            available: 0,
            _ctx: PhantomData,
        }
    }
}

impl<K, V, C> HashMap<K, V, C> {
    #[inline]
    pub fn new() -> Self {
        Self::default()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.size as usize
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }
    #[inline]
    pub fn capacity(&self) -> usize {
        self.metadata.len()
    }

    /// Release storage.
    #[inline]
    pub fn deinit(&mut self) {
        *self = Self::default();
    }

    /// Clear all entries, retaining capacity.
    pub fn clear(&mut self) {
        if self.metadata.is_empty() {
            return;
        }
        for m in self.metadata.iter_mut() {
            *m = SLOT_FREE;
        }
        for s in self.slots.iter_mut() {
            *s = None;
        }
        self.size = 0;
        self.available = ((self.metadata.len() as u64 * MAX_LOAD_PERCENTAGE) / 100) as u32;
    }

    /// Debug-mode pointer-stability assertion. No-op stub kept so callers can
    /// keep their lock/unlock bracketing without `#[cfg]` noise at every call
    /// site (see `SavedSourceMap`).
    #[inline]
    pub fn lock_pointers(&self) {}
    /// See [`lock_pointers`](Self::lock_pointers).
    #[inline]
    pub fn unlock_pointers(&self) {}

    pub fn iter(&self) -> Iter<'_, K, V> {
        Iter {
            metadata: &self.metadata,
            slots: &self.slots,
            idx: 0,
            remaining: self.size,
        }
    }
    pub fn iter_mut(&mut self) -> IterMut<'_, K, V> {
        IterMut {
            metadata: &self.metadata,
            slots: self.slots.iter_mut(),
            idx: 0,
            remaining: self.size,
        }
    }
    pub fn keys(&self) -> Keys<'_, K, V> {
        Keys { inner: self.iter() }
    }
    pub fn values(&self) -> Values<'_, K, V> {
        Values { inner: self.iter() }
    }
    pub fn values_mut(&mut self) -> ValuesMut<'_, K, V> {
        ValuesMut {
            inner: self.iter_mut(),
        }
    }
}

impl<K, V, C: HashContext<K>> HashMap<K, V, C> {
    pub fn with_capacity(capacity: usize) -> Self {
        let mut m = Self::default();
        if capacity > 0 {
            let _ = m.ensure_total_capacity(capacity);
        }
        m
    }

    /// Grow so `new_size` elements fit without further allocation. `Result`
    /// kept for call-site `?` symmetry.
    pub fn ensure_total_capacity(&mut self, new_size: usize) -> Result<(), bun_alloc::AllocError> {
        let new_size = new_size as u32;
        if new_size > self.size {
            self.grow_if_needed(new_size - self.size);
        }
        Ok(())
    }

    pub fn ensure_unused_capacity(
        &mut self,
        additional: usize,
    ) -> Result<(), bun_alloc::AllocError> {
        self.ensure_total_capacity(self.size as usize + additional)
    }

    /// std `reserve` — alias of [`ensure_unused_capacity`] for callers ported
    /// from the old `std::collections::HashMap` Deref.
    #[inline]
    pub fn reserve(&mut self, additional: usize) {
        let _ = self.ensure_unused_capacity(additional);
    }

    fn load(&self) -> u32 {
        let max_load = ((self.metadata.len() as u64 * MAX_LOAD_PERCENTAGE) / 100) as u32;
        debug_assert!(max_load >= self.available);
        max_load - self.available
    }

    fn grow_if_needed(&mut self, new_count: u32) {
        if new_count > self.available {
            self.grow(capacity_for_size(self.load() + new_count));
        }
    }

    #[cold]
    fn grow(&mut self, new_capacity: u32) {
        let new_cap = new_capacity.max(MINIMAL_CAPACITY);
        debug_assert!(new_cap as usize > self.metadata.len());
        debug_assert!(new_cap.is_power_of_two());

        let mut map = Self {
            metadata: vec![SLOT_FREE; new_cap as usize],
            // LSAN: this Vec is owned by the map and freed by HashMap's auto-Drop.
            // A leak reported here means the *container* HashMap leaked, not grow().
            slots: Vec::with_capacity(new_cap as usize),
            ..Default::default()
        };
        for _ in 0..new_cap {
            map.slots.push(None);
        }
        map.available = ((new_cap as u64 * MAX_LOAD_PERCENTAGE) / 100) as u32;

        if self.size != 0 {
            let old_cap = self.metadata.len();
            for i in 0..old_cap {
                if !meta_is_used(self.metadata[i]) {
                    continue;
                }
                if let Some((k, v)) = self.slots[i].take() {
                    map.put_assume_capacity_no_clobber(k, v);
                }
                if map.size == self.size {
                    break;
                }
            }
        }

        *self = map;
    }

    /// Linear-probe insert assuming the key is absent and `available > 0`.
    fn put_assume_capacity_no_clobber(&mut self, key: K, value: V) {
        let cap = self.metadata.len();
        let hash = C::ctx_hash(&key);
        let mask = cap - 1;
        let mut idx = (hash as usize) & mask;

        while meta_is_used(self.metadata[idx]) {
            idx = (idx + 1) & mask;
        }

        debug_assert!(self.available > 0);
        self.available -= 1;

        let fp = take_fingerprint(hash);
        self.metadata[idx] = meta_fill(fp);
        self.slots[idx] = Some((key, value));
        self.size += 1;
    }

    /// Probe for `key`. A run of used slots always ends at a free one: the
    /// table is never more than 80% full and a removal leaves no tombstone.
    fn get_index<Q>(&self, key: &Q) -> Option<usize>
    where
        K: Borrow<Q>,
        C: HashContext<Q>,
        Q: ?Sized,
    {
        if self.size == 0 {
            return None;
        }
        let hash = C::ctx_hash(key);
        let mask = self.metadata.len() - 1;
        let meta = meta_fill(take_fingerprint(hash));
        let mut idx = (hash as usize) & mask;

        while meta_is_used(self.metadata[idx]) {
            if self.metadata[idx] == meta {
                if let Some((k, _)) = &self.slots[idx] {
                    if C::ctx_eql(key, k.borrow()) {
                        return Some(idx);
                    }
                }
            }
            idx = (idx + 1) & mask;
        }
        None
    }

    pub fn get<Q>(&self, key: &Q) -> Option<&V>
    where
        K: Borrow<Q>,
        C: HashContext<Q>,
        Q: ?Sized,
    {
        self.get_index(key)
            .and_then(|i| self.slots[i].as_ref().map(|(_, v)| v))
    }

    pub fn get_mut<Q>(&mut self, key: &Q) -> Option<&mut V>
    where
        K: Borrow<Q>,
        C: HashContext<Q>,
        Q: ?Sized,
    {
        self.get_index(key)
            .and_then(move |i| self.slots[i].as_mut().map(|(_, v)| v))
    }

    pub fn get_key_value<Q>(&self, key: &Q) -> Option<(&K, &V)>
    where
        K: Borrow<Q>,
        C: HashContext<Q>,
        Q: ?Sized,
    {
        self.get_index(key)
            .and_then(|i| self.slots[i].as_ref().map(|(k, v)| (k, v)))
    }

    #[inline]
    pub fn contains_key<Q>(&self, key: &Q) -> bool
    where
        K: Borrow<Q>,
        C: HashContext<Q>,
        Q: ?Sized,
    {
        self.get_index(key).is_some()
    }

    /// Alias for [`contains_key`](Self::contains_key).
    #[inline]
    pub fn contains(&self, key: &K) -> bool {
        self.get_index(key).is_some()
    }

    /// Grow-on-demand insert-or-lookup probe. Returns
    /// the slot index and whether it was already occupied; the slot is left
    /// `None` on miss so the caller can write the (K, V) pair.
    fn get_or_put_slot(&mut self, key: &K) -> (usize, bool) {
        self.grow_if_needed(1);

        let hash = C::ctx_hash(key);
        let mask = self.metadata.len() - 1;
        let meta = meta_fill(take_fingerprint(hash));
        let mut idx = (hash as usize) & mask;

        while meta_is_used(self.metadata[idx]) {
            if self.metadata[idx] == meta {
                if let Some((k, _)) = &self.slots[idx] {
                    if C::ctx_eql(key, k) {
                        return (idx, true);
                    }
                }
            }
            idx = (idx + 1) & mask;
        }

        self.available -= 1;
        self.metadata[idx] = meta;
        self.size += 1;
        (idx, false)
    }

    /// Single-probe insert-or-lookup. Uninit values cannot be exposed through
    /// a `&mut V`, so `V: Default` and on miss the slot is default-initialised
    /// — callers overwrite `*value_ptr` when `!found_existing`.
    pub fn get_or_put(
        &mut self,
        key: K,
    ) -> Result<crate::hash_map::GetOrPutResult<'_, V>, bun_alloc::AllocError>
    where
        V: Default,
    {
        let (idx, found_existing) = self.get_or_put_slot(&key);
        if !found_existing {
            self.slots[idx] = Some((key, V::default()));
        }
        let value_ptr = &mut self.slots[idx].as_mut().unwrap().1;
        Ok(crate::hash_map::GetOrPutResult {
            found_existing,
            value_ptr,
        })
    }

    /// Alias of [`get_or_put`](Self::get_or_put) kept for call-site parity;
    /// the context is already bound by the type parameter.
    #[inline]
    pub fn get_or_put_context<Ctx>(
        &mut self,
        key: K,
        _ctx: Ctx,
    ) -> Result<crate::hash_map::GetOrPutResult<'_, V>, bun_alloc::AllocError>
    where
        V: Default,
    {
        self.get_or_put(key)
    }

    /// std `insert` — returns the previous value if any.
    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        let (idx, found_existing) = self.get_or_put_slot(&key);
        if found_existing {
            let slot = self.slots[idx].as_mut().unwrap();
            Some(core::mem::replace(&mut slot.1, value))
        } else {
            self.slots[idx] = Some((key, value));
            None
        }
    }

    /// Insert or overwrite.
    #[inline]
    pub fn put(&mut self, key: K, value: V) -> Result<(), bun_alloc::AllocError> {
        self.insert(key, value);
        Ok(())
    }

    /// Insert asserting the key is new.
    pub fn put_no_clobber(&mut self, key: K, value: V) -> Result<(), bun_alloc::AllocError> {
        let prev = self.insert(key, value);
        debug_assert!(prev.is_none(), "putNoClobber: key already present");
        Ok(())
    }

    /// Takes the entry at `idx` and closes the gap (Knuth, TAOCP 6.4,
    /// Algorithm R), so that no tombstone is left for later probes to walk
    /// over. Each later entry of the run moves back into the hole when the
    /// hole lies on its probe path, between its home slot and its own.
    fn remove_by_index(&mut self, idx: usize) -> Option<(K, V)> {
        let kv = self.slots[idx].take();
        let mask = self.metadata.len() - 1;
        let mut hole = idx;
        let mut next = (idx + 1) & mask;
        while let Some((key, _)) = &self.slots[next] {
            let home = (C::ctx_hash(key) as usize) & mask;
            if (hole.wrapping_sub(home) & mask) < (next.wrapping_sub(home) & mask) {
                self.metadata[hole] = self.metadata[next];
                self.slots[hole] = self.slots[next].take();
                hole = next;
            }
            next = (next + 1) & mask;
        }
        self.metadata[hole] = SLOT_FREE;
        self.size -= 1;
        self.available += 1;
        kv
    }

    /// std `remove`.
    pub fn remove<Q>(&mut self, key: &Q) -> Option<V>
    where
        K: Borrow<Q>,
        C: HashContext<Q>,
        Q: ?Sized,
    {
        self.get_index(key)
            .and_then(|i| self.remove_by_index(i).map(|(_, v)| v))
    }

    /// std `remove_entry`.
    pub fn remove_entry<Q>(&mut self, key: &Q) -> Option<(K, V)>
    where
        K: Borrow<Q>,
        C: HashContext<Q>,
        Q: ?Sized,
    {
        self.get_index(key).and_then(|i| self.remove_by_index(i))
    }

    /// Remove and return the owned `{key, value}` pair.
    pub fn fetch_remove(&mut self, key: &K) -> Option<crate::hash_map::KV<K, V>> {
        self.remove_entry(key)
            .map(|(k, v)| crate::hash_map::KV { key: k, value: v })
    }

    /// std `entry` API. `VacantEntry::insert` does a second probe (re-runs
    /// `get_or_put_slot`); acceptable for the few callers that use it.
    pub fn entry(&mut self, key: K) -> MapEntry<'_, K, V, C> {
        match self.get_index(&key) {
            Some(idx) => MapEntry::Occupied(OccupiedEntry { map: self, idx }),
            None => MapEntry::Vacant(VacantEntry { map: self, key }),
        }
    }
}

// ─── Iterators ─────────────────────────────────────────────────────────────

pub struct Iter<'a, K, V> {
    metadata: &'a [u8],
    slots: &'a [Option<(K, V)>],
    idx: usize,
    remaining: u32,
}
impl<'a, K, V> Iterator for Iter<'a, K, V> {
    type Item = (&'a K, &'a V);
    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        while self.idx < self.metadata.len() {
            let i = self.idx;
            self.idx += 1;
            if meta_is_used(self.metadata[i]) {
                self.remaining -= 1;
                let (k, v) = self.slots[i].as_ref().unwrap();
                return Some((k, v));
            }
        }
        None
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining as usize, Some(self.remaining as usize))
    }
}
impl<K, V> ExactSizeIterator for Iter<'_, K, V> {}

pub struct IterMut<'a, K, V> {
    metadata: &'a [u8],
    slots: core::slice::IterMut<'a, Option<(K, V)>>,
    idx: usize,
    remaining: u32,
}
impl<'a, K, V> Iterator for IterMut<'a, K, V> {
    type Item = (&'a K, &'a mut V);
    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        for slot in self.slots.by_ref() {
            let i = self.idx;
            self.idx += 1;
            if meta_is_used(self.metadata[i]) {
                self.remaining -= 1;
                let (k, v) = slot.as_mut().unwrap();
                return Some((&*k, v));
            }
        }
        None
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining as usize, Some(self.remaining as usize))
    }
}
impl<K, V> ExactSizeIterator for IterMut<'_, K, V> {}

pub struct Keys<'a, K, V> {
    inner: Iter<'a, K, V>,
}
impl<'a, K, V> Iterator for Keys<'a, K, V> {
    type Item = &'a K;
    #[inline]
    fn next(&mut self) -> Option<&'a K> {
        self.inner.next().map(|(k, _)| k)
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}
impl<K, V> ExactSizeIterator for Keys<'_, K, V> {}

pub struct Values<'a, K, V> {
    inner: Iter<'a, K, V>,
}
impl<'a, K, V> Iterator for Values<'a, K, V> {
    type Item = &'a V;
    #[inline]
    fn next(&mut self) -> Option<&'a V> {
        self.inner.next().map(|(_, v)| v)
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}
impl<K, V> ExactSizeIterator for Values<'_, K, V> {}

pub struct ValuesMut<'a, K, V> {
    inner: IterMut<'a, K, V>,
}
impl<'a, K, V> Iterator for ValuesMut<'a, K, V> {
    type Item = &'a mut V;
    #[inline]
    fn next(&mut self) -> Option<&'a mut V> {
        self.inner.next().map(|(_, v)| v)
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}
impl<K, V> ExactSizeIterator for ValuesMut<'_, K, V> {}

impl<'a, K, V, C> IntoIterator for &'a HashMap<K, V, C> {
    type Item = (&'a K, &'a V);
    type IntoIter = Iter<'a, K, V>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}
impl<'a, K, V, C> IntoIterator for &'a mut HashMap<K, V, C> {
    type Item = (&'a K, &'a mut V);
    type IntoIter = IterMut<'a, K, V>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter_mut()
    }
}

// ─── Entry API ─────────────────────────────────────────────────────────────

pub enum MapEntry<'a, K, V, C> {
    Occupied(OccupiedEntry<'a, K, V, C>),
    Vacant(VacantEntry<'a, K, V, C>),
}
pub struct OccupiedEntry<'a, K, V, C> {
    map: &'a mut HashMap<K, V, C>,
    idx: usize,
}
pub struct VacantEntry<'a, K, V, C> {
    map: &'a mut HashMap<K, V, C>,
    key: K,
}

impl<'a, K, V, C> MapEntry<'a, K, V, C>
where
    C: HashContext<K>,
{
    pub fn or_insert_with<F: FnOnce() -> V>(self, f: F) -> &'a mut V {
        match self {
            MapEntry::Occupied(o) => o.into_mut(),
            MapEntry::Vacant(v) => v.insert(f()),
        }
    }
    pub fn or_default(self) -> &'a mut V
    where
        V: Default,
    {
        self.or_insert_with(V::default)
    }
}

impl<'a, K, V, C> OccupiedEntry<'a, K, V, C> {
    #[inline]
    pub fn get(&self) -> &V {
        &self.map.slots[self.idx].as_ref().unwrap().1
    }
    #[inline]
    pub fn get_mut(&mut self) -> &mut V {
        &mut self.map.slots[self.idx].as_mut().unwrap().1
    }
    #[inline]
    pub fn into_mut(self) -> &'a mut V {
        &mut self.map.slots[self.idx].as_mut().unwrap().1
    }
}

impl<'a, K, V, C: HashContext<K>> VacantEntry<'a, K, V, C> {
    pub fn insert(self, value: V) -> &'a mut V {
        let (idx, found) = self.map.get_or_put_slot(&self.key);
        debug_assert!(!found);
        self.map.slots[idx] = Some((self.key, value));
        &mut self.map.slots[idx].as_mut().unwrap().1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Five home slots for every key: long runs in a small table.
    struct FiveHomes;
    impl HashContext<u64> for FiveHomes {
        fn ctx_hash(key: &u64) -> u64 {
            (key % 5) | (key << 57)
        }
        fn ctx_eql(a: &u64, b: &u64) -> bool {
            a == b
        }
    }

    /// Home slots at the end of the table: every run wraps around to slot 0.
    struct LastSlots;
    impl HashContext<u64> for LastSlots {
        fn ctx_hash(key: &u64) -> u64 {
            u64::MAX - (key % 3)
        }
        fn ctx_eql(a: &u64, b: &u64) -> bool {
            a == b
        }
    }

    fn xorshift(state: &mut u64) -> u64 {
        *state ^= *state >> 12;
        *state ^= *state << 25;
        *state ^= *state >> 27;
        state.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn slot_keys<C>(map: &HashMap<u64, u64, C>, slots: usize) -> Vec<Option<u64>> {
        map.slots[..slots]
            .iter()
            .map(|slot| slot.map(|kv| kv.0))
            .collect()
    }

    /// What a probe relies on: each entry is reachable from its home slot
    /// without crossing a free slot, and each slot without an entry is free.
    /// `model[key]` is the value the map must hold for `key`.
    fn check<C: HashContext<u64>>(map: &HashMap<u64, u64, C>, model: &[Option<u64>]) {
        let expected = model.iter().flatten().count();
        assert_eq!(map.len(), expected);
        let cap = map.metadata.len();
        if cap == 0 {
            return;
        }
        let mask = cap - 1;
        let mut used = 0;
        for i in 0..cap {
            let Some((key, value)) = map.slots[i] else {
                assert_eq!(map.metadata[i], SLOT_FREE, "slot {i} holds no entry");
                continue;
            };
            used += 1;
            assert_eq!(model[key as usize], Some(value));
            let hash = C::ctx_hash(&key);
            assert_eq!(map.metadata[i], meta_fill(take_fingerprint(hash)));
            let mut j = (hash as usize) & mask;
            while j != i {
                assert!(
                    meta_is_used(map.metadata[j]),
                    "key {key} in slot {i}: slot {j} on its probe path is free"
                );
                j = (j + 1) & mask;
            }
        }
        assert_eq!(used, expected);
        assert_eq!(map.available as usize, cap * 80 / 100 - used);
    }

    fn run_against_model<C: HashContext<u64>>(seed: u64, key_space: usize, operations: usize) {
        let mut state = seed | 1;
        let mut map: HashMap<u64, u64, C> = HashMap::new();
        let mut model: Vec<Option<u64>> = vec![None; key_space];
        for _ in 0..operations {
            let key = xorshift(&mut state) % key_space as u64;
            let value = xorshift(&mut state);
            let slot = &mut model[key as usize];
            match xorshift(&mut state) % 100 {
                0..=29 => assert_eq!(map.insert(key, value), slot.replace(value)),
                30..=39 => {
                    let entry = map.get_or_put(key).unwrap();
                    assert_eq!(entry.found_existing, slot.is_some());
                    *entry.value_ptr = value;
                    *slot = Some(value);
                }
                40..=44 => {
                    let got = *map.entry(key).or_insert_with(|| value);
                    assert_eq!(got, *slot.get_or_insert(value));
                }
                45..=79 => assert_eq!(map.remove(&key), slot.take()),
                80..=84 => {
                    let got = map.fetch_remove(&key).map(|kv| (kv.key, kv.value));
                    assert_eq!(got, slot.take().map(|value| (key, value)));
                }
                85..=94 => assert_eq!(map.get(&key), slot.as_ref()),
                95..=96 => map.reserve((value % 40) as usize),
                97 => {
                    // Empty the map in key order: the first entry of each run goes first.
                    for (key, slot) in model.iter_mut().enumerate() {
                        assert_eq!(map.remove(&(key as u64)), slot.take());
                    }
                }
                _ => {
                    if value % 8 == 0 {
                        map.clear();
                        model.fill(None);
                    }
                }
            }
            check(&map, &model);
        }
    }

    // CI runs these under Miri, which interprets each statement: keep its share small.
    const OPERATIONS: usize = if cfg!(miri) { 150 } else { 20_000 };

    #[test]
    fn agrees_with_a_model_wyhash() {
        run_against_model::<AutoHashContext>(1, 48, OPERATIONS);
    }

    #[test]
    fn agrees_with_a_model_identity_hash() {
        run_against_model::<IdentityContext<u64>>(2, 40, OPERATIONS);
    }

    #[test]
    fn agrees_with_a_model_long_runs() {
        run_against_model::<FiveHomes>(3, 60, OPERATIONS);
    }

    #[test]
    fn agrees_with_a_model_runs_that_wrap() {
        run_against_model::<LastSlots>(4, 40, OPERATIONS);
    }

    #[test]
    fn insert_only_order_wyhash() {
        let mut map: HashMap<u32, ()> = HashMap::new();
        for key in 0..20 {
            map.insert(key, ());
        }
        let order: Vec<u32> = map.keys().copied().collect();
        assert_eq!(
            order,
            [
                0, 15, 13, 19, 11, 9, 7, 5, 18, 3, 1, 16, 14, 12, 10, 8, 6, 4, 2, 17
            ]
        );
    }

    #[test]
    fn insert_only_order_identity_hash() {
        // The slot is `key & 7`: 17, 9, 1 and 33 start at slot 1, 2 and 10 at slot 2.
        let mut map: HashMap<u64, (), IdentityContext<u64>> = HashMap::new();
        for key in [17, 9, 1, 33, 2, 10] {
            map.insert(key, ());
        }
        let order: Vec<u64> = map.keys().copied().collect();
        assert_eq!(order, [17, 9, 1, 33, 2, 10]);
    }

    #[test]
    fn removal_moves_back_the_entries_that_probed_past_it() {
        // 0, 5, 10, 15 share home slot 0 and fill slots 0..=3. 1 has home slot 1 and lands in slot 4.
        let mut map: HashMap<u64, u64, FiveHomes> = HashMap::new();
        for key in [0, 5, 10, 15, 1] {
            map.insert(key, key);
        }
        assert_eq!(map.remove(&5), Some(5));
        assert_eq!(
            slot_keys(&map, 5),
            [Some(0), Some(10), Some(15), Some(1), None]
        );
        assert_eq!(map.metadata[4], SLOT_FREE);
        for key in [0, 10, 15, 1] {
            assert_eq!(map.get(&key), Some(&key));
        }
        assert_eq!(map.get(&5), None);
    }

    #[test]
    fn removal_leaves_an_entry_in_its_home_slot() {
        // 0 and 5 share home slot 0 and fill slots 0 and 1. 2 sits in its home slot 2.
        let mut map: HashMap<u64, u64, FiveHomes> = HashMap::new();
        for key in [0, 5, 2] {
            map.insert(key, key);
        }
        assert_eq!(map.remove(&0), Some(0));
        assert_eq!(slot_keys(&map, 3), [Some(5), None, Some(2)]);
    }

    #[test]
    fn a_churn_of_distinct_keys_leaves_free_slots() {
        const LIVE: u64 = 64;
        const CYCLES: u64 = if cfg!(miri) { 300 } else { 50_000 };
        let mut map: HashMap<u64, ()> = HashMap::new();
        for key in 0..LIVE {
            map.insert(key, ());
        }
        for cycle in 0..CYCLES {
            assert_eq!(map.remove(&cycle), Some(()));
            map.insert(LIVE + cycle, ());
        }
        assert_eq!(map.len(), LIVE as usize);
        assert_eq!(map.capacity(), 128);
        let free = map
            .metadata
            .iter()
            .filter(|&&meta| meta == SLOT_FREE)
            .count();
        assert_eq!(free, 128 - LIVE as usize);
    }
}
