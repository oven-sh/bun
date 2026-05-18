//! Port of Zig's `std.HashMapUnmanaged` — open-addressing, linear-probe,
//! tombstone-on-delete, power-of-two capacity, 80% max load. Layout (and
//! therefore iteration order) must match the Zig spec exactly because callers
//! snapshot the iteration sequence (e.g. lockfile debug stringify).
//!
//! Storage differs from Zig's single-allocation `[Header][meta][keys][values]`:
//! `Vec<u8>` for metadata + `Vec<Option<(K, V)>>` for slots. This costs an
//! `Option` discriminant per slot but keeps the implementation in safe Rust;
//! slot indices and the metadata state machine are bit-identical so iteration
//! order matches.
//!
//! Spec: vendor/zig/lib/std/hash_map.zig

use core::borrow::Borrow;
use core::hash::{Hash, Hasher};
use core::marker::PhantomData;

use crate::identity_context::{IdentityContext, IdentityHash};

// ─── Metadata byte ─────────────────────────────────────────────────────────
// Zig: `packed struct { fingerprint: u7, used: u1 }` — LSB-first packing, so
// bit 7 = `used`, bits 0..7 = `fingerprint`.
const SLOT_FREE: u8 = 0x00; // used=0, fp=0
const SLOT_TOMBSTONE: u8 = 0x01; // used=0, fp=1

#[inline]
fn meta_is_used(m: u8) -> bool {
    m & 0x80 != 0
}
#[inline]
fn meta_is_free(m: u8) -> bool {
    m == SLOT_FREE
}
#[inline]
fn meta_is_tombstone(m: u8) -> bool {
    m == SLOT_TOMBSTONE
}
#[inline]
fn meta_fingerprint(m: u8) -> u8 {
    m & 0x7F
}
/// Zig `Metadata.takeFingerprint`: top 7 bits of the 64-bit hash.
#[inline]
fn take_fingerprint(hash: u64) -> u8 {
    (hash >> (64 - 7)) as u8
}
#[inline]
fn meta_fill(fp: u8) -> u8 {
    0x80 | (fp & 0x7F)
}

const MINIMAL_CAPACITY: u32 = 8;
/// Zig `default_max_load_percentage`. All Bun-side `std.HashMap` instantiations
/// use 80; the const-generic load-factor parameter is dropped here.
const MAX_LOAD_PERCENTAGE: u64 = 80;

#[inline]
fn capacity_for_size(size: u32) -> u32 {
    // Zig: `((size * 100) / max_load + 1).ceilPowerOfTwo()`
    let new_cap = ((size as u64 * 100) / MAX_LOAD_PERCENTAGE + 1) as u32;
    new_cap.next_power_of_two()
}

// ─── HashContext ───────────────────────────────────────────────────────────
// Zig threads a `Context` value with `hash(K) -> u64` / `eql(K, K) -> bool`.
// All Bun contexts are zero-sized, so model as a stateless trait keyed on the
// marker type. `AutoHashContext` covers `std.AutoHashMap`; `IdentityContext<K>`
// covers the `hash(k) == k` case used for pre-hashed keys.

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
        // Zig autoHash for unique-repr types is `Wyhash.hash(0, asBytes(&key))`.
        // Routing through `core::hash::Hash` + wyhash is the closest stable
        // approximation without per-type byte-layout plumbing; exact AutoContext
        // bucket order isn't relied on by any test today.
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
    /// Slots writable before a grow (counts free *and* tombstone consumption).
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

    /// Zig `count`/std `len`.
    #[inline]
    pub fn len(&self) -> usize {
        self.size as usize
    }
    #[inline]
    pub fn count(&self) -> u32 {
        self.size
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }
    #[inline]
    pub fn capacity(&self) -> usize {
        self.metadata.len()
    }

    /// Zig `deinit` — release storage.
    #[inline]
    pub fn deinit(&mut self) {
        *self = Self::default();
    }

    /// Zig `clearRetainingCapacity`.
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

    /// Zig `lockPointers` — debug-mode pointer-stability assertion. No-op stub
    /// kept so the Zig lock/unlock bracketing translates without `#[cfg]` noise
    /// at every call site (see `SavedSourceMap`).
    #[inline]
    pub fn lock_pointers(&self) {}
    /// Zig `unlockPointers` — see [`lock_pointers`].
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

    /// Zig `ensureTotalCapacity` — grow so `new_size` elements fit without
    /// further allocation. `Result` kept for call-site `?` symmetry with the
    /// Zig OOM-propagating API.
    pub fn ensure_total_capacity(&mut self, new_size: usize) -> Result<(), bun_alloc::AllocError> {
        let new_size = new_size as u32;
        if new_size > self.size {
            self.grow_if_needed(new_size - self.size);
        }
        Ok(())
    }

    /// Zig `ensureUnusedCapacity`.
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

        let mut map: Self = Self::default();
        map.metadata = vec![SLOT_FREE; new_cap as usize];
        map.slots = Vec::with_capacity(new_cap as usize);
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

    /// Zig `putAssumeCapacityNoClobber` — linear-probe insert assuming key
    /// absent and `available > 0`.
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

    /// Zig `getIndex` — probe for `key`, stop on free, skip tombstones.
    fn get_index<Q>(&self, key: &Q) -> Option<usize>
    where
        K: Borrow<Q>,
        C: HashContext<Q>,
        Q: ?Sized,
    {
        if self.size == 0 {
            return None;
        }
        let cap = self.metadata.len();
        let hash = C::ctx_hash(key);
        let mask = cap - 1;
        let fp = take_fingerprint(hash);
        let mut limit = cap;
        let mut idx = (hash as usize) & mask;

        while !meta_is_free(self.metadata[idx]) && limit != 0 {
            if meta_is_used(self.metadata[idx]) && meta_fingerprint(self.metadata[idx]) == fp {
                if let Some((k, _)) = &self.slots[idx] {
                    if C::ctx_eql(key, k.borrow()) {
                        return Some(idx);
                    }
                }
            }
            limit -= 1;
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

    /// Zig `contains` — `std::HashMap` spells this `contains_key`.
    #[inline]
    pub fn contains(&self, key: &K) -> bool {
        self.get_index(key).is_some()
    }

    /// Zig `getOrPutAssumeCapacityAdapted` lifted to grow-on-demand. Returns
    /// the slot index and whether it was already occupied; the slot is left
    /// `None` on miss so the caller can write the (K, V) pair.
    fn get_or_put_slot(&mut self, key: &K) -> (usize, bool) {
        self.grow_if_needed(1);

        let cap = self.metadata.len();
        let hash = C::ctx_hash(key);
        let mask = cap - 1;
        let fp = take_fingerprint(hash);
        let mut limit = cap;
        let mut idx = (hash as usize) & mask;
        let mut first_tombstone_idx = cap; // invalid sentinel

        while !meta_is_free(self.metadata[idx]) && limit != 0 {
            if meta_is_used(self.metadata[idx]) && meta_fingerprint(self.metadata[idx]) == fp {
                if let Some((k, _)) = &self.slots[idx] {
                    if C::ctx_eql(key, k) {
                        return (idx, true);
                    }
                }
            } else if first_tombstone_idx == cap && meta_is_tombstone(self.metadata[idx]) {
                first_tombstone_idx = idx;
            }
            limit -= 1;
            idx = (idx + 1) & mask;
        }

        if first_tombstone_idx < cap {
            idx = first_tombstone_idx;
        }
        self.available -= 1;
        self.metadata[idx] = meta_fill(fp);
        self.size += 1;
        (idx, false)
    }

    /// Zig `getOrPut`: single-probe insert-or-lookup. On miss the value slot is
    /// left "undefined" in Zig; Rust cannot expose uninit through a `&mut V`, so
    /// `V: Default` and the slot is default-initialised — callers overwrite
    /// `*value_ptr` when `!found_existing`.
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

    /// Zig `getOrPutContext` — alias kept for call-site parity; the context is
    /// already bound by the type parameter.
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

    /// std `insert` / Zig `fetchPut` — returns the previous value if any.
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

    /// Zig `put`: insert or overwrite.
    #[inline]
    pub fn put(&mut self, key: K, value: V) -> Result<(), bun_alloc::AllocError> {
        self.insert(key, value);
        Ok(())
    }

    /// Zig `putNoClobber`: insert asserting the key is new.
    pub fn put_no_clobber(&mut self, key: K, value: V) -> Result<(), bun_alloc::AllocError> {
        let prev = self.insert(key, value);
        debug_assert!(prev.is_none(), "putNoClobber: key already present");
        Ok(())
    }

    fn remove_by_index(&mut self, idx: usize) -> Option<(K, V)> {
        self.metadata[idx] = SLOT_TOMBSTONE;
        let kv = self.slots[idx].take();
        self.size -= 1;
        self.available += 1;
        kv
    }

    /// std `remove` / Zig `fetchRemove` value half.
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

    /// Zig `fetchRemove` — remove and return the owned `{key, value}` pair.
    pub fn fetch_remove(&mut self, key: K) -> Option<crate::hash_map::KV<K, V>> {
        self.remove_entry(&key)
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
    pub fn or_insert(self, default: V) -> &'a mut V {
        match self {
            MapEntry::Occupied(o) => o.into_mut(),
            MapEntry::Vacant(v) => v.insert(default),
        }
    }
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
    #[inline]
    pub fn key(&self) -> &K {
        &self.map.slots[self.idx].as_ref().unwrap().0
    }
}

impl<'a, K, V, C: HashContext<K>> VacantEntry<'a, K, V, C> {
    pub fn insert(self, value: V) -> &'a mut V {
        let (idx, found) = self.map.get_or_put_slot(&self.key);
        debug_assert!(!found);
        self.map.slots[idx] = Some((self.key, value));
        &mut self.map.slots[idx].as_mut().unwrap().1
    }
    #[inline]
    pub fn key(&self) -> &K {
        &self.key
    }
}

// ported from: vendor/zig/lib/std/hash_map.zig
