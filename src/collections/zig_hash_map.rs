//! Open-addressing hash map — linear-probe, tombstone-on-delete, power-of-two
//! capacity, 80% max load. Layout (and therefore iteration order) is
//! load-bearing: callers snapshot the iteration sequence (e.g. lockfile debug
//! stringify).
//!
//! A tombstone counts toward the load like an entry, so at least 20% of the
//! slots are always free and a probe always ends at one of them. When the
//! tombstones use up the load limit the map clears them (`make_room`). A map
//! that never removes has no tombstones: its layout and its growth points do
//! not depend on any of this.
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

/// Slots of a `capacity`-slot table that may hold an entry or a tombstone.
#[inline]
fn max_load(capacity: usize) -> u32 {
    ((capacity as u64 * MAX_LOAD_PERCENTAGE) / 100) as u32
}

/// The typed half of a table, as the in-place rehash sees it.
trait SlotArray {
    fn hash_at(&self, idx: usize) -> u64;
    fn swap(&mut self, a: usize, b: usize);
}

struct Slots<'a, K, V, C>(&'a mut [Option<(K, V)>], PhantomData<C>);

impl<K, V, C: HashContext<K>> SlotArray for Slots<'_, K, V, C> {
    fn hash_at(&self, idx: usize) -> u64 {
        let (key, _) = self.0[idx].as_ref().unwrap();
        C::ctx_hash(key)
    }
    fn swap(&mut self, a: usize, b: usize) {
        self.0.swap(a, b);
    }
}

/// Turn every tombstone back into a free slot without a new table. Every entry
/// ends where a probe from its home slot reaches it before a free slot.
///
/// Not generic, so that the maps of every key and value type share one copy.
#[cold]
#[inline(never)]
fn rehash_in_place(metadata: &mut [u8], slots: &mut dyn SlotArray) {
    // Until an entry has its place again, its slot carries the tombstone byte.
    for m in metadata.iter_mut() {
        *m = if meta_is_used(*m) {
            SLOT_TOMBSTONE
        } else {
            SLOT_FREE
        };
    }
    let mask = metadata.len() - 1;
    for i in 0..metadata.len() {
        while meta_is_tombstone(metadata[i]) {
            let hash = slots.hash_at(i);
            let mut idx = (hash as usize) & mask;
            while meta_is_used(metadata[idx]) {
                idx = (idx + 1) & mask;
            }
            // `idx` is free, or holds an entry without a place: this one, or another
            // one that now waits in slot `i`.
            if idx != i {
                slots.swap(i, idx);
                metadata[i] = metadata[idx];
            }
            metadata[idx] = meta_fill(take_fingerprint(hash));
        }
    }
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
    /// Free slots an insert can still take before the entries and the tombstones
    /// together reach the load limit.
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
        self.available = max_load(self.metadata.len());
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

    fn grow_if_needed(&mut self, new_count: u32) {
        if new_count > self.available {
            self.make_room(new_count);
        }
    }

    /// Fewer than `new_count` free slots are left under the load limit. Grow when
    /// the entries alone need a larger table. Otherwise tombstones took the room:
    /// clear them in place while the entries fill at most half of the load limit,
    /// else move to twice the capacity. Both leave at least half of the load limit
    /// free, so the cost of this call spreads over that many inserts.
    #[cold]
    fn make_room(&mut self, new_count: u32) {
        let capacity = self.metadata.len();
        let needed = self.size + new_count;
        let fitted = capacity_for_size(needed);
        if fitted as usize > capacity {
            self.grow(fitted);
        } else if needed <= max_load(capacity) / 2 {
            rehash_in_place(
                &mut self.metadata,
                &mut Slots::<K, V, C>(&mut self.slots, PhantomData),
            );
            self.available = max_load(capacity) - self.size;
        } else {
            self.grow(capacity as u32 * 2);
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
        map.available = max_load(new_cap as usize);

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

    /// Probe for `key`, stop on free, skip tombstones.
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
        } else {
            self.available -= 1;
        }
        self.metadata[idx] = meta_fill(fp);
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

    fn remove_by_index(&mut self, idx: usize) -> Option<(K, V)> {
        self.metadata[idx] = SLOT_TOMBSTONE;
        let kv = self.slots[idx].take();
        self.size -= 1;
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

// ─── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use core::cell::Cell;
    use core::fmt::Debug;

    type IdentityMap = HashMap<u64, u64, IdentityContext<u64>>;

    struct Census {
        free: usize,
        tombstones: usize,
        used: usize,
    }

    fn census<K, V, C>(map: &HashMap<K, V, C>) -> Census {
        let mut census = Census {
            free: 0,
            tombstones: 0,
            used: 0,
        };
        for &m in &map.metadata {
            if meta_is_free(m) {
                census.free += 1;
            } else if meta_is_tombstone(m) {
                census.tombstones += 1;
            } else {
                census.used += 1;
            }
        }
        census
    }

    /// The slot of every entry, in slot order. Iteration follows this order.
    fn layout<K: Copy, V, C>(map: &HashMap<K, V, C>) -> Vec<(usize, K)> {
        map.slots
            .iter()
            .enumerate()
            .filter_map(|(idx, slot)| slot.as_ref().map(|(key, _)| (idx, *key)))
            .collect()
    }

    /// The slots that are not free between the home slot of `key` and the first free slot:
    /// what a lookup of `key` walks when the map does not hold it.
    fn miss_probe_len<K, V, C: HashContext<K>>(map: &HashMap<K, V, C>, key: &K) -> usize {
        let capacity = map.metadata.len();
        if capacity == 0 {
            return 0;
        }
        let mut idx = C::ctx_hash(key) as usize & (capacity - 1);
        let mut passed = 0;
        while passed < capacity && !meta_is_free(map.metadata[idx]) {
            idx = (idx + 1) & (capacity - 1);
            passed += 1;
        }
        passed
    }

    fn assert_reachable<K: Copy + Debug, V, C: HashContext<K>>(map: &HashMap<K, V, C>) {
        assert_eq!(map.slots.len(), map.metadata.len());
        for (idx, slot) in map.slots.iter().enumerate() {
            assert_eq!(slot.is_some(), meta_is_used(map.metadata[idx]));
            if let Some((key, _)) = slot {
                assert_eq!(map.get_index(key), Some(idx), "{key:?} is not reachable");
            }
        }
    }

    /// Every entry is reachable, and `available` counts the tombstones as load.
    fn assert_consistent<K: Copy + Debug, V, C: HashContext<K>>(map: &HashMap<K, V, C>) {
        assert_reachable(map);
        let census = census(map);
        assert_eq!(census.used, map.len());
        assert_eq!(
            census.used + census.tombstones + map.available as usize,
            max_load(map.capacity()) as usize,
        );
    }

    /// The layout of a map that only inserts, written out: probe linearly from `hash & mask`,
    /// and when the 80% load is full move every entry, in slot order, to twice the capacity.
    fn insert_only_layout<K: Copy, C: HashContext<K>>(
        capacity: usize,
        keys: &[K],
    ) -> (usize, Vec<(usize, K)>) {
        fn place<K: Copy, C: HashContext<K>>(slots: &mut [Option<K>], key: K) {
            let mask = slots.len() - 1;
            let mut idx = C::ctx_hash(&key) as usize & mask;
            while slots[idx].is_some() {
                idx = (idx + 1) & mask;
            }
            slots[idx] = Some(key);
        }
        let mut slots: Vec<Option<K>> = vec![None; capacity];
        for (len, &key) in keys.iter().enumerate() {
            if len == slots.len() * 80 / 100 {
                let grown = vec![None; (slots.len() * 2).max(MINIMAL_CAPACITY as usize)];
                for moved in core::mem::replace(&mut slots, grown).into_iter().flatten() {
                    place::<K, C>(&mut slots, moved);
                }
            }
            place::<K, C>(&mut slots, key);
        }
        let entries = slots
            .iter()
            .enumerate()
            .filter_map(|(idx, slot)| slot.map(|key| (idx, key)))
            .collect();
        (slots.len(), entries)
    }

    /// Deterministic pseudo-random numbers (xorshift64*).
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        fn below(&mut self, bound: u64) -> u64 {
            self.next() % bound
        }
    }

    fn assert_insert_only_layout<K: Copy + Eq + Debug, C: HashContext<K>>(keys: &[K]) {
        let mut map: HashMap<K, usize, C> = HashMap::new();
        for (n, &key) in keys.iter().enumerate() {
            let capacity_before = map.capacity();
            assert_eq!(map.insert(key, n), None);
            // The growth points and the end. Without Miri, also each insert of a short sequence.
            let grew = map.capacity() != capacity_before;
            if grew || n + 1 == keys.len() || (!cfg!(miri) && n < 60) {
                let (capacity, entries) = insert_only_layout::<K, C>(0, &keys[..=n]);
                assert_eq!(map.capacity(), capacity, "capacity after insert {}", n + 1);
                assert_eq!(layout(&map), entries, "layout after insert {}", n + 1);
            }
        }
        assert_consistent(&map);
        let order: Vec<K> = map.keys().copied().collect();
        let slot_order: Vec<K> = layout(&map).into_iter().map(|(_, key)| key).collect();
        assert_eq!(order, slot_order);
        for (n, key) in keys.iter().enumerate() {
            assert_eq!(map.get(key), Some(&n));
        }
    }

    // The layout of a map that never removes is load-bearing (see the module comment).
    // These tests pin it: the capacity at every growth point, the slot of every entry, and
    // the iteration order.

    #[test]
    fn insert_only_layout_of_identity_keys_is_literal() {
        let mut map = IdentityMap::new();
        for key in [0, 8, 1, 16, 9] {
            map.insert(key, key * 10);
        }
        assert_eq!(map.capacity(), 8);
        assert_eq!(layout(&map), [(0, 0), (1, 8), (2, 1), (3, 16), (4, 9)]);
        let iterated: Vec<(u64, u64)> = map.iter().map(|(k, v)| (*k, *v)).collect();
        assert_eq!(iterated, [(0, 0), (8, 80), (1, 10), (16, 160), (9, 90)]);
    }

    #[test]
    fn insert_only_growth_points_are_pinned() {
        let mut map: HashMap<u32, ()> = HashMap::new();
        let mut growth = Vec::new();
        for n in 1..=205u32 {
            let before = map.capacity();
            map.insert(n, ());
            if map.capacity() != before {
                growth.push((n, map.capacity()));
            }
        }
        assert_eq!(
            growth,
            [
                (1, 8),
                (7, 16),
                (13, 32),
                (26, 64),
                (52, 128),
                (103, 256),
                (205, 512)
            ],
        );
    }

    #[test]
    fn insert_only_layout_matches_the_plain_algorithm() {
        let count = if cfg!(miri) { 40 } else { 3000 };
        let rising: Vec<u32> = (0..count).map(|n| 2 * n + 1).collect();
        assert_insert_only_layout::<u32, AutoHashContext>(&rising);

        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let mut seen = std::collections::HashSet::new();
        let mut random: Vec<u32> = Vec::new();
        while random.len() < count as usize {
            let key = rng.next() as u32;
            if seen.insert(key) {
                random.push(key);
            }
        }
        assert_insert_only_layout::<u32, AutoHashContext>(&random);

        let sequential: Vec<u64> = (0..count as u64).collect();
        assert_insert_only_layout::<u64, IdentityContext<u64>>(&sequential);
        // Every key of a run of 64 has the same home slot until the table has 64 * 64 slots.
        let clustered: Vec<u64> = (0..count as u64).map(|n| (n % 64) * 64 + n / 64).collect();
        assert_insert_only_layout::<u64, IdentityContext<u64>>(&clustered);
    }

    #[test]
    fn reserved_capacity_is_pinned() {
        for (size, capacity) in [
            (1, 8),
            (6, 8),
            (7, 16),
            (12, 16),
            (13, 32),
            (25, 32),
            (26, 64),
            (100, 128),
            (102, 128),
            (103, 256),
        ] {
            let keys: Vec<u32> = (0..size as u32).collect();
            let mut map: HashMap<u32, usize> = HashMap::with_capacity(size);
            assert_eq!(map.capacity(), capacity, "with_capacity({size})");
            for (n, &key) in keys.iter().enumerate() {
                map.insert(key, n);
            }
            assert_eq!(
                map.capacity(),
                capacity,
                "{size} inserts after with_capacity({size})"
            );
            let (_, entries) = insert_only_layout::<u32, AutoHashContext>(capacity, &keys);
            assert_eq!(layout(&map), entries);
        }

        let mut map: HashMap<u32, ()> = HashMap::new();
        for key in 0..3 {
            map.insert(key, ());
        }
        map.reserve(20);
        assert_eq!(map.capacity(), 32);
        map.ensure_total_capacity(23).unwrap();
        assert_eq!(map.capacity(), 32);
        map.ensure_total_capacity(26).unwrap();
        assert_eq!(map.capacity(), 64);
        assert_consistent(&map);
    }

    #[test]
    fn clear_keeps_the_capacity_and_frees_every_slot() {
        let keys: Vec<u32> = (0..20).collect();
        let mut map: HashMap<u32, u32> = HashMap::new();
        for &key in &keys {
            map.insert(key, key);
        }
        for key in 0..5 {
            assert_eq!(map.remove(&key), Some(key));
        }
        let capacity = map.capacity();
        map.clear();
        assert_eq!((map.len(), map.capacity()), (0, capacity));
        assert_eq!(census(&map).free, capacity);
        assert_consistent(&map);
        assert_eq!(map.get(&7), None);

        for &key in &keys {
            map.insert(key, key);
        }
        let (_, entries) = insert_only_layout::<u32, AutoHashContext>(capacity, &keys);
        assert_eq!(layout(&map), entries);
    }

    #[test]
    fn insert_reuses_the_first_tombstone_of_its_probe() {
        let mut map = IdentityMap::new();
        for key in [0, 8, 16] {
            map.insert(key, key);
        }
        assert_eq!(layout(&map), [(0, 0), (1, 8), (2, 16)]);
        assert_eq!(map.remove(&8), Some(8));
        assert_eq!(layout(&map), [(0, 0), (2, 16)]);
        // A lookup walks over the tombstone in slot 1.
        assert_eq!(map.get(&16), Some(&16));

        map.insert(24, 24);
        assert_eq!(layout(&map), [(0, 0), (1, 24), (2, 16)]);
        assert_reachable(&map);
        assert_eq!(census(&map).tombstones, 0);
    }

    // Tombstones count as load.

    /// `live` keys stay in the map while new keys replace the oldest ones, `pairs` times.
    /// Returns the mean of `miss_probe_len` for the new keys.
    fn churn(map: &mut HashMap<u32, u32>, next_key: &mut u32, live: usize, pairs: usize) -> f64 {
        let mut walked = 0usize;
        for n in 0..pairs {
            walked += miss_probe_len(map, next_key);
            assert_eq!(map.insert(*next_key, *next_key), None);
            let oldest = *next_key - 2 * live as u32;
            assert_eq!(map.remove(&oldest), Some(oldest));
            *next_key += 2;
            // At least 20% of the slots are free, so every probe ends.
            assert!(census_is_cheap(n) || census(map).free * 5 >= map.capacity());
        }
        walked as f64 / pairs as f64
    }

    /// The census reads every slot. Take it for one pair in 64.
    fn census_is_cheap(n: usize) -> bool {
        n % 64 != 0
    }

    #[test]
    fn a_miss_stays_short_after_a_burst_of_keys() {
        const LIVE: usize = 16;
        let bursts: &[usize] = if cfg!(miri) {
            &[0, 100]
        } else {
            &[0, 100, 1000, 5000]
        };
        let pairs = if cfg!(miri) { 300 } else { 100_000 };
        for &burst in bursts {
            let mut map: HashMap<u32, u32> = HashMap::new();
            let mut next_key = 1u32;
            // The burst: many keys at once. Then all but `LIVE` of them go away.
            for _ in 0..burst.max(LIVE) {
                map.insert(next_key, next_key);
                next_key += 2;
            }
            for key in (1..next_key - 2 * LIVE as u32).step_by(2) {
                assert_eq!(map.remove(&key), Some(key));
            }
            assert_eq!(map.len(), LIVE);
            let capacity_after_burst = map.capacity();

            for _ in 0..2 {
                let mean_miss = churn(&mut map, &mut next_key, LIVE, pairs);
                assert!(
                    mean_miss < 8.0,
                    "burst {burst}: a miss walks {mean_miss} slots"
                );
                assert_consistent(&map);
            }
            assert_eq!(map.len(), LIVE);
            // The peak sets the capacity, except that a small table doubles one time so that
            // the live keys fill at most half of the load limit.
            assert!(
                map.capacity() <= capacity_after_burst.max(64),
                "burst {burst}"
            );
        }
    }

    #[test]
    fn tombstones_are_cleared_in_place_up_to_half_of_the_load_limit() {
        // 16 slots, load limit 12.
        for (removed, capacity_after) in [(7, 16), (6, 32)] {
            let mut map: HashMap<u32, u32> = HashMap::new();
            for key in 0..12 {
                map.insert(key, key);
            }
            assert_eq!((map.capacity(), map.available), (16, 0));
            for key in 0..removed {
                map.remove(&key);
            }
            let before = census(&map);
            assert_eq!((before.tombstones, map.available), (removed as usize, 0));
            let table = map.metadata.as_ptr();

            // No free slot is left under the load limit. With 5 entries the insert of a sixth
            // keeps the table. With 6 entries the seventh moves to twice the capacity.
            map.insert(100, 100);
            assert_eq!(map.capacity(), capacity_after);
            assert_eq!(map.metadata.as_ptr() == table, capacity_after == 16);
            assert_eq!(census(&map).tombstones, 0);
            assert_consistent(&map);
            for key in removed..12 {
                assert_eq!(map.get(&key), Some(&key));
            }
            assert_eq!(map.get(&100), Some(&100));
        }
    }

    #[test]
    fn an_in_place_rehash_keeps_a_cluster_that_wraps() {
        // Home slot 15 of 16 for every key: the cluster runs over the end of the table.
        let keys: Vec<u64> = (0..12).map(|n| n * 16 + 15).collect();
        let mut map = IdentityMap::new();
        for &key in &keys {
            map.insert(key, key);
        }
        let slots = |map: &IdentityMap| -> Vec<usize> {
            layout(map).into_iter().map(|(idx, _)| idx).collect()
        };
        assert_eq!(map.capacity(), 16);
        assert_eq!(slots(&map), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15]);
        for &key in &keys[..7] {
            map.remove(&key);
        }
        map.insert(1000 * 16 + 15, 0);
        assert_eq!((map.capacity(), census(&map).tombstones), (16, 0));
        assert_consistent(&map);
        // The entries close up to the home slot again.
        assert_eq!(slots(&map), [0, 1, 2, 3, 4, 15]);
    }

    thread_local! {
        static HASHES: Cell<usize> = const { Cell::new(0) };
    }

    /// `AutoHashContext` that counts its hash calls. A rehash hashes every entry again.
    struct CountingContext;
    impl HashContext<u32> for CountingContext {
        fn ctx_hash(key: &u32) -> u64 {
            HASHES.set(HASHES.get() + 1);
            AutoHashContext::ctx_hash(key)
        }
        fn ctx_eql(a: &u32, b: &u32) -> bool {
            a == b
        }
    }

    #[test]
    fn a_key_that_comes_back_takes_its_tombstone_and_never_causes_a_rehash() {
        let mut map: HashMap<u32, u32, CountingContext> = HashMap::new();
        for key in [10, 20, 30] {
            map.insert(key, key);
        }
        let (capacity, available) = (map.capacity(), map.available);
        let rounds = if cfg!(miri) { 150 } else { 100_000 };
        HASHES.set(0);
        for round in 0..rounds {
            let key = [10, 20, 30][round % 3];
            assert_eq!(map.remove(&key), Some(key));
            assert_eq!(map.insert(key, key), None);
        }
        // One hash for each remove and for each insert.
        assert_eq!(HASHES.get(), 2 * rounds);
        assert_eq!((map.capacity(), map.available), (capacity, available));
    }

    #[test]
    fn churn_hashes_each_entry_again_less_than_once_for_each_insert() {
        const LIVE: u32 = 16;
        let pairs: u32 = if cfg!(miri) { 500 } else { 200_000 };
        let mut map: HashMap<u32, u32, CountingContext> = HashMap::new();
        for key in 0..LIVE {
            map.insert(key, key);
        }
        // Warm up until the capacity has settled.
        for key in LIVE..LIVE + 200 {
            map.insert(key, key);
            map.remove(&(key - LIVE));
        }
        let (capacity, table) = (map.capacity(), map.metadata.as_ptr());
        HASHES.set(0);
        for key in LIVE + 200..LIVE + 200 + pairs {
            map.insert(key, key);
            map.remove(&(key - LIVE));
        }
        // The table is not allocated again, and the in-place rehashes add less than one
        // hash to the two that an insert and a remove take.
        assert_eq!((map.capacity(), map.metadata.as_ptr()), (capacity, table));
        assert!(
            HASHES.get() < 3 * pairs as usize,
            "{} hashes for {pairs} pairs",
            HASHES.get()
        );
        assert_eq!(map.len(), LIVE as usize);
    }

    #[test]
    fn random_operations_agree_with_std() {
        let operations = if cfg!(miri) { 700 } else { 200_000 };
        let mut rng = Rng(0x2545_F491_4F6C_DD1D);
        // Boxed values: Miri reports an entry that a rehash drops twice or leaks.
        let mut map: HashMap<u32, Box<u32>> = HashMap::new();
        let mut model: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
        let mut rising = 1_000_000u32;
        for n in 0..operations {
            // Keys from a small range come back. Rising keys never do.
            let key = if rng.below(2) == 0 {
                rng.below(96) as u32
            } else {
                rising += 1;
                rising
            };
            match rng.below(100) {
                0..=49 => {
                    let previous = map.insert(key, Box::new(n));
                    assert_eq!(previous.map(|value| *value), model.insert(key, n));
                }
                50..=89 => {
                    // Remove a key that is in the map, when there is one.
                    let key = match model.keys().nth(rng.below(8) as usize) {
                        Some(&present) => present,
                        None => key,
                    };
                    assert_eq!(map.remove(&key).map(|value| *value), model.remove(&key));
                }
                90..=95 => assert_eq!(map.get(&key).map(|value| **value), model.get(&key).copied()),
                96..=97 => {
                    let value = map.entry(key).or_insert_with(|| Box::new(n));
                    assert_eq!(**value, *model.entry(key).or_insert(n));
                }
                98 => map.reserve(rng.below(40) as usize),
                _ => {
                    if rng.below(8) == 0 {
                        map.clear();
                        model.clear();
                    }
                }
            }
            assert_eq!(map.len(), model.len());
            if n % 512 == 0 {
                assert_consistent(&map);
            }
        }
        assert_consistent(&map);
        let mut entries: Vec<(u32, u32)> = map.iter().map(|(key, value)| (*key, **value)).collect();
        let mut expected: Vec<(u32, u32)> = model.into_iter().collect();
        entries.sort_unstable();
        expected.sort_unstable();
        assert_eq!(entries, expected);
    }
}
