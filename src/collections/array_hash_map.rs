//! Port of Zig's `std.ArrayHashMap` family + Bun's string-keyed wrappers
//! (`bun.StringArrayHashMap`, `bun.StringHashMap`,
//! `bun.CaseInsensitiveASCIIStringArrayHashMap`, `bun.StringHashMapUnowned`).
//!
//! `ArrayHashMap` differs from a regular `HashMap` in three ways that callers
//! depend on (PORTING.md §Collections):
//!   * iteration order is insertion order;
//!   * `keys()` / `values()` return contiguous slices (the entries live in
//!     parallel `Vec`s, not a hash table's bucket array);
//!   * `getOrPut` hands back a stable `key_ptr` / `value_ptr` / `index` triple
//!     so callers can fill the slot in-place after the lookup.
//!
//! PERF(port): Zig builds a separate `index_header` once `len > 8`; this port
//! stores `hashes: Vec<u32>` and does a hash-prefiltered linear scan for every
//! lookup. Correct, deterministic, O(n). Phase C should add the index header
//! when profiling shows it matters.

use core::hash::{Hash, Hasher};
use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};

use bun_alloc::AllocError;

// ──────────────────────────────────────────────────────────────────────────
// Free functions (Zig: `std.array_hash_map.hashString` / `std.hash_map.hashString`)
// ──────────────────────────────────────────────────────────────────────────

/// `std.array_hash_map.hashString` — wyhash(seed=0) truncated to u32.
#[inline]
pub fn hash_string(s: &[u8]) -> u32 {
    bun_wyhash::hash(s) as u32 // @truncate
}

// ──────────────────────────────────────────────────────────────────────────
// Context traits (Zig: `Context` / `Adapter` duck types)
// ──────────────────────────────────────────────────────────────────────────

/// Hash/eql strategy for an `ArrayHashMap<K, _>`.
/// Zig passes these as `anytype`; here it's a trait so the map can be generic
/// over the strategy without each method taking a `ctx` argument.
pub trait ArrayHashContext<K: ?Sized>: Default {
    fn hash(&self, key: &K) -> u32;
    /// `b_index` is the index of `b` in the entry array (Zig passes it so
    /// adapted contexts can look at sibling storage).
    fn eql(&self, a: &K, b: &K, b_index: usize) -> bool;
}

/// Adapted lookup: hash a `Q` and compare it against the stored `K`s without
/// constructing a `K` first (Zig: `getOrPutAdapted` / `getOrPutContextAdapted`).
pub trait ArrayHashAdapter<Q: ?Sized, K> {
    fn hash(&self, key: &Q) -> u32;
    fn eql(&self, a: &Q, b: &K, b_index: usize) -> bool;
}

/// Default context: `Hash` + `Eq` driven through wyhash, mirroring Zig's
/// `AutoContext` / `getAutoHashFn`.
#[derive(Default, Clone, Copy)]
pub struct AutoContext;

impl<K: Hash + Eq + ?Sized> ArrayHashContext<K> for AutoContext {
    #[inline]
    fn hash(&self, key: &K) -> u32 {
        let mut h = bun_wyhash::Wyhash11::init(0);
        key.hash(&mut h);
        h.finish() as u32 // @truncate
    }
    #[inline]
    fn eql(&self, a: &K, b: &K, _b_index: usize) -> bool {
        a == b
    }
}

/// `std.array_hash_map.StringContext` — byte-slice keys hashed with wyhash.
#[derive(Default, Clone, Copy)]
pub struct StringContext;

impl ArrayHashContext<[u8]> for StringContext {
    #[inline]
    fn hash(&self, key: &[u8]) -> u32 {
        hash_string(key)
    }
    #[inline]
    fn eql(&self, a: &[u8], b: &[u8], _b_index: usize) -> bool {
        a == b
    }
}

/// `bun.CaseInsensitiveASCIIStringContext` (src/bun.zig) — ASCII-lowercased
/// wyhash + ASCII-case-insensitive equality. Used for env-var maps on Windows.
#[derive(Default, Clone, Copy)]
pub struct CaseInsensitiveAsciiStringContext;

impl CaseInsensitiveAsciiStringContext {
    fn hash_bytes(mut s: &[u8]) -> u32 {
        // Mirrors the Zig: lowercase into a 1024-byte scratch buffer in chunks
        // and feed wyhash incrementally.
        let mut buf = [0u8; 1024];
        let mut h = bun_wyhash::Wyhash11::init(0);
        while !s.is_empty() {
            let n = s.len().min(buf.len());
            for (dst, &src) in buf[..n].iter_mut().zip(&s[..n]) {
                *dst = src.to_ascii_lowercase();
            }
            h.update(&buf[..n]);
            s = &s[n..];
        }
        h.finish() as u32 // @truncate
    }
}

impl ArrayHashContext<[u8]> for CaseInsensitiveAsciiStringContext {
    #[inline]
    fn hash(&self, key: &[u8]) -> u32 {
        Self::hash_bytes(key)
    }
    #[inline]
    fn eql(&self, a: &[u8], b: &[u8], _b_index: usize) -> bool {
        a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.eq_ignore_ascii_case(y))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GetOrPutResult / Entry / Iterator
// ──────────────────────────────────────────────────────────────────────────

/// Result of `get_or_put*`. When `found_existing == false`, `*value_ptr` is a
/// freshly-defaulted slot the caller is expected to overwrite (Zig leaves it
/// `undefined`; Rust cannot, so the value type carries a `Default` bound on the
/// inserting paths).
pub struct GetOrPutResult<'a, K, V> {
    pub found_existing: bool,
    pub index: usize,
    pub key_ptr: &'a mut K,
    pub value_ptr: &'a mut V,
}

/// Iterator entry — both halves mutable, matching Zig's `Entry { key_ptr: *K,
/// value_ptr: *V }`.
pub struct Entry<'a, K, V> {
    pub key_ptr: &'a mut K,
    pub value_ptr: &'a mut V,
}

/// Insertion-order iterator yielding `Entry`. Resettable (Zig callers do
/// `it.reset()` to rewind; here `index = 0`).
pub struct Iter<'a, K, V> {
    keys: *mut K,
    values: *mut V,
    len: usize,
    index: usize,
    _marker: PhantomData<&'a mut [(K, V)]>,
}

impl<'a, K, V> Iter<'a, K, V> {
    #[inline]
    pub fn reset(&mut self) {
        self.index = 0;
    }
}

impl<'a, K, V> Iterator for Iter<'a, K, V> {
    type Item = Entry<'a, K, V>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.index >= self.len {
            return None;
        }
        let i = self.index;
        self.index += 1;
        // SAFETY: `keys`/`values` point at `len`-element Vec backing arrays
        // borrowed mutably for `'a`; each index is yielded at most once so the
        // returned `&mut`s are disjoint.
        unsafe {
            Some(Entry {
                key_ptr: &mut *self.keys.add(i),
                value_ptr: &mut *self.values.add(i),
            })
        }
    }
}

/// Extension surface dependents name as `bun_collections::ArrayHashMapExt` so
/// they can spell the iterator type generically (`<M as ArrayHashMapExt>::Iterator`).
pub trait ArrayHashMapExt {
    type Key;
    type Value;
    type Iterator<'a>: Iterator<Item = Entry<'a, Self::Key, Self::Value>>
    where
        Self: 'a;
    fn iterator(&mut self) -> Self::Iterator<'_>;
}

// ──────────────────────────────────────────────────────────────────────────
// ArrayHashMap<K, V, C>
// ──────────────────────────────────────────────────────────────────────────

/// Insertion-ordered hash map with contiguous key / value storage.
pub struct ArrayHashMap<K, V, C = AutoContext> {
    keys: Vec<K>,
    values: Vec<V>,
    hashes: Vec<u32>,
    ctx: C,
    // Zig `pointer_stability: std.debug.SafetyLock` — debug-only re-entrancy
    // guard around operations that may invalidate entry pointers.
    #[cfg(debug_assertions)]
    pointer_stability: core::cell::Cell<bool>,
}

impl<K, V, C: Default> Default for ArrayHashMap<K, V, C> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K: Clone, V: Clone, C: Default> ArrayHashMap<K, V, C> {
    /// Zig `clone()` is fallible (OOM); kept as `Result` for API parity.
    pub fn clone(&self) -> Result<Self, AllocError> {
        Ok(Self {
            keys: self.keys.clone(),
            values: self.values.clone(),
            hashes: self.hashes.clone(),
            ctx: C::default(),
            #[cfg(debug_assertions)]
            pointer_stability: core::cell::Cell::new(false),
        })
    }
}

impl<K, V, C: Default> ArrayHashMap<K, V, C> {
    pub fn new() -> Self {
        Self {
            keys: Vec::new(),
            values: Vec::new(),
            hashes: Vec::new(),
            ctx: C::default(),
            #[cfg(debug_assertions)]
            pointer_stability: core::cell::Cell::new(false),
        }
    }

    pub fn with_capacity(n: usize) -> Self {
        let mut m = Self::new();
        m.reserve(n);
        m
    }
}

impl<K, V, C> ArrayHashMap<K, V, C> {
    // ── capacity / size ────────────────────────────────────────────────────

    #[inline]
    pub fn count(&self) -> usize {
        self.keys.len()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.keys.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    pub fn ensure_total_capacity(&mut self, n: usize) -> Result<(), AllocError> {
        let need = n.saturating_sub(self.keys.len());
        self.keys.reserve(need);
        self.values.reserve(need);
        self.hashes.reserve(need);
        Ok(())
    }

    pub fn ensure_unused_capacity(&mut self, additional: usize) -> Result<(), AllocError> {
        self.keys.reserve(additional);
        self.values.reserve(additional);
        self.hashes.reserve(additional);
        Ok(())
    }

    /// std-HashMap-compat alias for `ensure_unused_capacity` (infallible).
    #[inline]
    pub fn reserve(&mut self, additional: usize) {
        self.keys.reserve(additional);
        self.values.reserve(additional);
        self.hashes.reserve(additional);
    }

    /// Debug-only: assert no in-flight `GetOrPutResult` borrows when an
    /// operation that may reallocate runs. No-op in release.
    #[inline]
    pub fn lock_pointers(&self) {
        #[cfg(debug_assertions)]
        {
            debug_assert!(!self.pointer_stability.get(), "ArrayHashMap pointers already locked");
            self.pointer_stability.set(true);
        }
    }

    #[inline]
    pub fn unlock_pointers(&self) {
        #[cfg(debug_assertions)]
        self.pointer_stability.set(false);
    }

    // ── slice access ──────────────────────────────────────────────────────

    #[inline]
    pub fn keys(&self) -> &[K] {
        &self.keys
    }

    #[inline]
    pub fn keys_mut(&mut self) -> &mut [K] {
        &mut self.keys
    }

    #[inline]
    pub fn values(&self) -> &[V] {
        &self.values
    }

    #[inline]
    pub fn values_mut(&mut self) -> &mut [V] {
        &mut self.values
    }

    pub fn iterator(&mut self) -> Iter<'_, K, V> {
        Iter {
            keys: self.keys.as_mut_ptr(),
            values: self.values.as_mut_ptr(),
            len: self.keys.len(),
            index: 0,
            _marker: PhantomData,
        }
    }

    pub fn clear_retaining_capacity(&mut self) {
        self.keys.clear();
        self.values.clear();
        self.hashes.clear();
    }

    // ── internal lookup ───────────────────────────────────────────────────

    #[inline]
    fn find_hash<F: Fn(&K, usize) -> bool>(&self, h: u32, eq: F) -> Option<usize> {
        // PERF(port): linear scan with hash prefilter; see module note.
        for (i, &stored) in self.hashes.iter().enumerate() {
            if stored == h && eq(&self.keys[i], i) {
                return Some(i);
            }
        }
        None
    }

    fn gop_at(&mut self, index: usize, found_existing: bool) -> GetOrPutResult<'_, K, V> {
        // SAFETY: `keys` and `values` are distinct allocations; producing one
        // `&mut` into each is sound even though both derive from `&mut self`.
        let key_ptr = unsafe { &mut *self.keys.as_mut_ptr().add(index) };
        let value_ptr = unsafe { &mut *self.values.as_mut_ptr().add(index) };
        GetOrPutResult { found_existing, index, key_ptr, value_ptr }
    }
}

impl<K, V, C: ArrayHashContext<K>> ArrayHashMap<K, V, C> {
    #[inline]
    pub fn get_index(&self, key: &K) -> Option<usize> {
        let h = self.ctx.hash(key);
        self.find_hash(h, |k, i| self.ctx.eql(key, k, i))
    }

    #[inline]
    pub fn contains(&self, key: &K) -> bool {
        self.get_index(key).is_some()
    }

    /// std-HashMap-compat alias.
    #[inline]
    pub fn contains_key(&self, key: &K) -> bool {
        self.contains(key)
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.get_index(key).map(|i| &self.values[i])
    }

    /// Zig `getPtr` — mutable value lookup.
    pub fn get_ptr_mut(&mut self, key: &K) -> Option<&mut V> {
        let i = self.get_index(key)?;
        Some(&mut self.values[i])
    }

    /// Recompute every stored hash from the current keys. Call after mutating
    /// keys via `keys_mut()`.
    pub fn re_index(&mut self) -> Result<(), AllocError> {
        for (i, k) in self.keys.iter().enumerate() {
            self.hashes[i] = self.ctx.hash(k);
        }
        Ok(())
    }

    pub fn put(&mut self, key: K, value: V) -> Result<(), AllocError> {
        let h = self.ctx.hash(&key);
        if let Some(i) = self.find_hash(h, |k, idx| self.ctx.eql(&key, k, idx)) {
            // Zig putContext (std/array_hash_map.zig:941): only assigns
            // `result.value_ptr.*`; the original key is preserved.
            self.values[i] = value;
        } else {
            self.keys.push(key);
            self.values.push(value);
            self.hashes.push(h);
        }
        Ok(())
    }

    pub fn put_no_clobber(&mut self, key: K, value: V) -> Result<(), AllocError> {
        let h = self.ctx.hash(&key);
        debug_assert!(
            self.find_hash(h, |k, idx| self.ctx.eql(&key, k, idx)).is_none(),
            "put_no_clobber: key already present",
        );
        self.keys.push(key);
        self.values.push(value);
        self.hashes.push(h);
        Ok(())
    }

    /// PERF(port): Zig skips the grow check; this port does too but `Vec::push`
    /// will still reallocate if the caller lied about capacity.
    pub fn put_assume_capacity(&mut self, key: K, value: V) {
        let _ = self.put(key, value);
    }

    /// std-HashMap-compat alias for `put`, returning the displaced value.
    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        let h = self.ctx.hash(&key);
        if let Some(i) = self.find_hash(h, |k, idx| self.ctx.eql(&key, k, idx)) {
            // std::HashMap::insert and Zig put: keep the original key on hit.
            Some(core::mem::replace(&mut self.values[i], value))
        } else {
            self.keys.push(key);
            self.values.push(value);
            self.hashes.push(h);
            None
        }
    }

    pub fn swap_remove(&mut self, key: &K) -> bool {
        let Some(i) = self.get_index(key) else { return false };
        self.keys.swap_remove(i);
        self.values.swap_remove(i);
        self.hashes.swap_remove(i);
        true
    }

    /// std-HashMap-compat: ordered remove returning the value. Preserves the
    /// relative order of remaining entries (unlike `swap_remove`).
    pub fn remove(&mut self, key: &K) -> Option<V> {
        let i = self.get_index(key)?;
        self.keys.remove(i);
        self.hashes.remove(i);
        Some(self.values.remove(i))
    }

    /// std-HashMap-compat alias for `get_ptr_mut`.
    #[inline]
    pub fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        self.get_ptr_mut(key)
    }

    /// std-HashMap-compat `entry` API. Mirrors `std::collections::hash_map::Entry`
    /// closely enough that call sites written against the old std-alias compile
    /// unchanged. Backed by the same single-hash lookup as `get_or_put`.
    pub fn entry(&mut self, key: K) -> MapEntry<'_, K, V, C> {
        let h = self.ctx.hash(&key);
        if let Some(idx) = self.find_hash(h, |k, i| self.ctx.eql(&key, k, i)) {
            MapEntry::Occupied(OccupiedEntry { map: self, idx })
        } else {
            MapEntry::Vacant(VacantEntry { map: self, key, hash: h })
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// std-compatible Entry API
// ──────────────────────────────────────────────────────────────────────────

/// std-HashMap-compat entry. Named `MapEntry` (not `Entry`) to avoid clashing
/// with the iterator `Entry` above; re-exported as `bun_collections::hash_map::Entry`.
pub enum MapEntry<'a, K, V, C> {
    Occupied(OccupiedEntry<'a, K, V, C>),
    Vacant(VacantEntry<'a, K, V, C>),
}

pub struct OccupiedEntry<'a, K, V, C> {
    map: &'a mut ArrayHashMap<K, V, C>,
    idx: usize,
}

impl<'a, K, V, C> OccupiedEntry<'a, K, V, C> {
    #[inline]
    pub fn get(&self) -> &V {
        &self.map.values[self.idx]
    }
    #[inline]
    pub fn get_mut(&mut self) -> &mut V {
        &mut self.map.values[self.idx]
    }
    #[inline]
    pub fn into_mut(self) -> &'a mut V {
        &mut self.map.values[self.idx]
    }
    #[inline]
    pub fn key(&self) -> &K {
        &self.map.keys[self.idx]
    }
    #[inline]
    pub fn index(&self) -> usize {
        self.idx
    }
    pub fn insert(&mut self, value: V) -> V {
        core::mem::replace(&mut self.map.values[self.idx], value)
    }
    pub fn swap_remove(self) -> V {
        self.map.keys.swap_remove(self.idx);
        self.map.hashes.swap_remove(self.idx);
        self.map.values.swap_remove(self.idx)
    }
}

pub struct VacantEntry<'a, K, V, C> {
    map: &'a mut ArrayHashMap<K, V, C>,
    key: K,
    hash: u32,
}

impl<'a, K, V, C> VacantEntry<'a, K, V, C> {
    #[inline]
    pub fn key(&self) -> &K {
        &self.key
    }
    pub fn insert(self, value: V) -> &'a mut V {
        let i = self.map.keys.len();
        self.map.keys.push(self.key);
        self.map.values.push(value);
        self.map.hashes.push(self.hash);
        &mut self.map.values[i]
    }
}

impl<'a, K, V, C> MapEntry<'a, K, V, C> {
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
}

impl<K, V: Default, C: ArrayHashContext<K>> ArrayHashMap<K, V, C> {
    /// Zig `getOrPut`: look up `key`; if absent, append it with a defaulted
    /// value slot and return `found_existing = false`.
    pub fn get_or_put(&mut self, key: K) -> Result<GetOrPutResult<'_, K, V>, AllocError> {
        let h = self.ctx.hash(&key);
        if let Some(i) = self.find_hash(h, |k, idx| self.ctx.eql(&key, k, idx)) {
            return Ok(self.gop_at(i, true));
        }
        let i = self.keys.len();
        self.keys.push(key);
        self.values.push(V::default());
        self.hashes.push(h);
        Ok(self.gop_at(i, false))
    }

    /// Zig `getOrPutValue`: like `get_or_put` but writes `value` when absent.
    pub fn get_or_put_value(
        &mut self,
        key: K,
        value: V,
    ) -> Result<GetOrPutResult<'_, K, V>, AllocError> {
        let gop = self.get_or_put(key)?;
        if !gop.found_existing {
            // SAFETY: re-borrow at same index — `gop` borrows `self` so go
            // through the slot it already points at.
            *gop.value_ptr = value;
        }
        // PORT NOTE: reshaped — can't return `gop` while it borrows in the
        // branch above without NLL gymnastics; recompute via index.
        let i = gop.index;
        let found = gop.found_existing;
        drop(gop);
        Ok(self.gop_at(i, found))
    }
}

impl<K: Default, V: Default, C> ArrayHashMap<K, V, C> {
    /// Zig `getOrPutAdapted`: look up by `key` using `adapter` for hash/eql;
    /// on miss, append a *defaulted* `K`/`V` pair — caller fills both via
    /// `key_ptr` / `value_ptr`.
    pub fn get_or_put_adapted<Q, A>(
        &mut self,
        key: Q,
        adapter: A,
    ) -> Result<GetOrPutResult<'_, K, V>, AllocError>
    where
        A: ArrayHashAdapter<Q, K>,
    {
        let h = adapter.hash(&key);
        if let Some(i) = self.find_hash(h, |k, idx| adapter.eql(&key, k, idx)) {
            return Ok(self.gop_at(i, true));
        }
        let i = self.keys.len();
        self.keys.push(K::default());
        self.values.push(V::default());
        self.hashes.push(h);
        Ok(self.gop_at(i, false))
    }
}

impl<K, V, C> ArrayHashMapExt for ArrayHashMap<K, V, C> {
    type Key = K;
    type Value = V;
    type Iterator<'a> = Iter<'a, K, V> where Self: 'a;
    fn iterator(&mut self) -> Iter<'_, K, V> {
        ArrayHashMap::iterator(self)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StringArrayHashMap<V, C> — `[]const u8`-keyed wrapper
// ──────────────────────────────────────────────────────────────────────────

/// `std.StringArrayHashMap(V)` / `bun.CaseInsensitiveASCIIStringArrayHashMap(V)`.
///
/// Newtype (not an alias) so `get_or_put` / `get` / `put` can take `&[u8]`
/// borrows — the Zig API stores `[]const u8` keys and lets the caller decide
/// whether to dupe them; here keys are `Box<[u8]>` and the borrowing methods
/// box on insert.
pub struct StringArrayHashMap<V, C = StringContext> {
    inner: ArrayHashMap<Box<[u8]>, V, AutoContext>,
    // The string context is consulted for hash/eql on `[u8]` borrows; the
    // inner map's `AutoContext` is unused (hashes are fed in directly).
    ctx: C,
}

/// Windows env-var map (`src/bun.zig` `CaseInsensitiveASCIIStringArrayHashMap`).
pub type CaseInsensitiveAsciiStringArrayHashMap<V> =
    StringArrayHashMap<V, CaseInsensitiveAsciiStringContext>;

impl<V, C: Default> Default for StringArrayHashMap<V, C> {
    fn default() -> Self {
        Self { inner: ArrayHashMap::new(), ctx: C::default() }
    }
}

impl<V, C> Deref for StringArrayHashMap<V, C> {
    type Target = ArrayHashMap<Box<[u8]>, V, AutoContext>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<V, C> DerefMut for StringArrayHashMap<V, C> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl<V, C: ArrayHashContext<[u8]> + Default> StringArrayHashMap<V, C> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_capacity(n: usize) -> Self {
        let mut m = Self::default();
        m.reserve(n);
        m
    }

    #[inline]
    fn find(&self, key: &[u8]) -> Option<usize> {
        let h = self.ctx.hash(key);
        self.inner.find_hash(h, |k, i| self.ctx.eql(key, k, i))
    }

    #[inline]
    pub fn get_index(&self, key: &[u8]) -> Option<usize> {
        self.find(key)
    }

    #[inline]
    pub fn contains(&self, key: &[u8]) -> bool {
        self.find(key).is_some()
    }

    #[inline]
    pub fn contains_key(&self, key: &[u8]) -> bool {
        self.contains(key)
    }

    pub fn get(&self, key: &[u8]) -> Option<&V> {
        self.find(key).map(|i| &self.inner.values[i])
    }

    pub fn get_ptr_mut(&mut self, key: &[u8]) -> Option<&mut V> {
        let i = self.find(key)?;
        Some(&mut self.inner.values[i])
    }

    /// std-HashMap-compat alias for `get_ptr_mut`.
    #[inline]
    pub fn get_mut(&mut self, key: &[u8]) -> Option<&mut V> {
        self.get_ptr_mut(key)
    }

    pub fn insert(&mut self, key: &[u8], value: V) -> Option<V> {
        let h = self.ctx.hash(key);
        if let Some(i) = self.inner.find_hash(h, |k, idx| self.ctx.eql(key, k, idx)) {
            Some(core::mem::replace(&mut self.inner.values[i], value))
        } else {
            self.inner.keys.push(Box::from(key));
            self.inner.values.push(value);
            self.inner.hashes.push(h);
            None
        }
    }

    pub fn put(&mut self, key: &[u8], value: V) -> Result<(), AllocError> {
        let h = self.ctx.hash(key);
        if let Some(i) = self.inner.find_hash(h, |k, idx| self.ctx.eql(key, k, idx)) {
            self.inner.values[i] = value;
        } else {
            self.inner.keys.push(Box::from(key));
            self.inner.values.push(value);
            self.inner.hashes.push(h);
        }
        Ok(())
    }

    pub fn put_assume_capacity(&mut self, key: &[u8], value: V) {
        let _ = self.put(key, value);
    }

    pub fn swap_remove(&mut self, key: &[u8]) -> bool {
        let Some(i) = self.find(key) else { return false };
        self.inner.keys.swap_remove(i);
        self.inner.values.swap_remove(i);
        self.inner.hashes.swap_remove(i);
        true
    }

    pub fn re_index(&mut self) -> Result<(), AllocError> {
        for (i, k) in self.inner.keys.iter().enumerate() {
            self.inner.hashes[i] = self.ctx.hash(k);
        }
        Ok(())
    }
}

impl<V: Default, C: ArrayHashContext<[u8]> + Default> StringArrayHashMap<V, C> {
    /// See `ArrayHashMap::get_or_put`. The key is boxed on insert; callers that
    /// then write `*gop.key_ptr = Box::from(key)` are doing a redundant alloc —
    /// harmless, and lets the Zig-shaped call sites compile unchanged.
    pub fn get_or_put(
        &mut self,
        key: &[u8],
    ) -> Result<GetOrPutResult<'_, Box<[u8]>, V>, AllocError> {
        let h = self.ctx.hash(key);
        if let Some(i) = self.inner.find_hash(h, |k, idx| self.ctx.eql(key, k, idx)) {
            return Ok(self.inner.gop_at(i, true));
        }
        let i = self.inner.keys.len();
        self.inner.keys.push(Box::from(key));
        self.inner.values.push(V::default());
        self.inner.hashes.push(h);
        Ok(self.inner.gop_at(i, false))
    }

    pub fn get_or_put_value(
        &mut self,
        key: &[u8],
        value: V,
    ) -> Result<GetOrPutResult<'_, Box<[u8]>, V>, AllocError> {
        let h = self.ctx.hash(key);
        if let Some(i) = self.inner.find_hash(h, |k, idx| self.ctx.eql(key, k, idx)) {
            return Ok(self.inner.gop_at(i, true));
        }
        let i = self.inner.keys.len();
        self.inner.keys.push(Box::from(key));
        self.inner.values.push(value);
        self.inner.hashes.push(h);
        Ok(self.inner.gop_at(i, false))
    }
}

impl<V: Clone, C: Default> StringArrayHashMap<V, C> {
    pub fn clone(&self) -> Result<Self, AllocError> {
        Ok(Self { inner: self.inner.clone()?, ctx: C::default() })
    }
}

impl<V, C> ArrayHashMapExt for StringArrayHashMap<V, C> {
    type Key = Box<[u8]>;
    type Value = V;
    type Iterator<'a> = Iter<'a, Box<[u8]>, V> where Self: 'a;
    fn iterator(&mut self) -> Iter<'_, Box<[u8]>, V> {
        self.inner.iterator()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StringHashMap<V> — unordered `[]const u8`-keyed map
// ──────────────────────────────────────────────────────────────────────────

/// `std.StringHashMap(V)`. Thin newtype over `std::collections::HashMap` that
/// adds the Zig `getOrPut` / `getOrPutValue` entry points while keeping the
/// std surface (`.get`, `.contains_key`, `.reserve`, `.insert`, …) reachable
/// via `Deref`.
// TODO(port): swap `RandomState` for a wyhash `BuildHasher` once one lands in
// `bun_wyhash` so hashing is deterministic across runs.
#[derive(Clone)]
pub struct StringHashMap<V> {
    inner: std::collections::HashMap<Box<[u8]>, V>,
}

impl<V> Default for StringHashMap<V> {
    fn default() -> Self {
        Self { inner: std::collections::HashMap::new() }
    }
}

impl<V> Deref for StringHashMap<V> {
    type Target = std::collections::HashMap<Box<[u8]>, V>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<V> DerefMut for StringHashMap<V> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl<V> StringHashMap<V> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put(&mut self, key: &[u8], value: V) -> Result<(), AllocError> {
        self.inner.insert(Box::from(key), value);
        Ok(())
    }
}

/// `StringHashMap::get_or_put` result — `std::HashMap` cannot hand out
/// `&mut K`, so this result omits `key_ptr` (unlike `GetOrPutResult` for the
/// array-backed maps). Callers that need to overwrite the stored key must use
/// `StringArrayHashMap` instead.
pub struct StringHashMapGetOrPut<'a, V> {
    pub found_existing: bool,
    pub value_ptr: &'a mut V,
}

impl<V: Default> StringHashMap<V> {
    pub fn get_or_put(
        &mut self,
        key: &[u8],
    ) -> Result<StringHashMapGetOrPut<'_, V>, AllocError> {
        let found_existing = self.inner.contains_key(key);
        let value_ptr = self
            .inner
            .entry(Box::from(key))
            .or_insert_with(V::default);
        Ok(StringHashMapGetOrPut { found_existing, value_ptr })
    }

    pub fn get_or_put_value(&mut self, key: &[u8], value: V) -> Result<&mut V, AllocError> {
        Ok(self.inner.entry(Box::from(key)).or_insert(value))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StringHashMapUnowned (src/bun.zig) — pre-hashed string key
// ──────────────────────────────────────────────────────────────────────────

/// `bun.StringHashMapUnowned.Key` — a string identity reduced to `(hash, len)`
/// so the map never stores the string bytes. Collisions on both fields are
/// treated as equal (matches the Zig — used for side-effects globs where a
/// false positive is acceptable).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct StringHashMapUnownedKey {
    pub hash: u64,
    pub len: usize,
}

impl StringHashMapUnownedKey {
    #[inline]
    pub fn init(s: &[u8]) -> Self {
        Self { hash: bun_wyhash::hash(s), len: s.len() }
    }
}

/// `bun.StringHashMapUnowned` namespace.
pub mod string_hash_map_unowned {
    pub use super::StringHashMapUnownedKey as Key;

    /// Adapter feeding `Key.hash` straight through (Zig
    /// `bun.StringHashMapUnowned.Adapter`).
    #[derive(Default, Clone, Copy)]
    pub struct Adapter;

    impl Adapter {
        #[inline]
        pub fn hash(&self, key: &Key) -> u64 {
            key.hash
        }
        #[inline]
        pub fn eql(&self, a: &Key, b: &Key) -> bool {
            a.hash == b.hash && a.len == b.len
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     vendor/zig/lib/std/array_hash_map.zig (subset) +
//               src/bun.zig `StringHashMapUnowned` / `CaseInsensitiveASCIIStringContext`
//   confidence: medium
//   notes:      lookup is hash-prefiltered linear scan (no index_header yet);
//               GetOrPutResult requires V: Default (Zig left value undefined);
//               StringHashMap::get_or_put cannot expose the stored key.
// ──────────────────────────────────────────────────────────────────────────
