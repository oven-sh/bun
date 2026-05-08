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
//! Zig builds a separate `index_header` (open-addressed `hash → entry_index`
//! table) once `len > 8` so lookups stay O(1). This port mirrors that with a
//! lazily-built `hashbrown::HashTable<u32>` keyed by the cached u32 hash:
//! linear scan below the threshold, indexed lookup above it. The index is
//! dropped (not patched) on the rare reorder paths (`swap_remove`, `sort`,
//! `pop`, …) and rebuilt on the next lookup — the bundler hot path is
//! write-once / read-many, so the rebuild cost is negligible and the
//! invalidation keeps every mutation site trivially correct.

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
        // Zig: std.array_hash_map.getAutoHashFn → std.hash.Wyhash. The
        // streaming `Wyhash` state zero-fills a 48-byte buffer on every
        // `init`/`shallow_copy` (Zig left it `undefined`); route through the
        // one-shot hasher to skip that — keys here are small POD (`Ref`,
        // indices) so the per-chunk fold is a single `mum`.
        let mut h = bun_wyhash::OneShotHasher::default();
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
        // and feed wyhash incrementally. Zig uses std.hash.Wyhash (NOT Wyhash11).
        let mut buf = [0u8; 1024];
        let mut h = bun_wyhash::Wyhash::init(0);
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

/// Lifts an `ArrayHashContext<[u8]>` to operate on `Box<[u8]>` keys by
/// delegating to the underlying byte slice. Used as the inner context for
/// `StringArrayHashMap` so methods reached via `Deref` (e.g. `put_no_clobber`,
/// `remove`, `entry`) compute the *same* u32 hash as the wrapper's
/// `&[u8]`-taking methods — otherwise the two paths disagree and lookups miss.
#[derive(Clone, Copy)]
pub struct BoxedSliceContext<C>(C);

impl<C: Default> Default for BoxedSliceContext<C> {
    #[inline]
    fn default() -> Self {
        Self(C::default())
    }
}

impl<C: ArrayHashContext<[u8]>> ArrayHashContext<Box<[u8]>> for BoxedSliceContext<C> {
    #[inline]
    fn hash(&self, key: &Box<[u8]>) -> u32 {
        self.0.hash(&**key)
    }
    #[inline]
    fn eql(&self, a: &Box<[u8]>, b: &Box<[u8]>, b_index: usize) -> bool {
        self.0.eql(&**a, &**b, b_index)
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

/// Zig: `std.ArrayHashMap.KV` — owned key/value pair returned by
/// `fetchSwapRemove` / `fetchOrderedRemove`.
pub struct KV<K, V> {
    pub key: K,
    pub value: V,
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

/// Zig `index_header` threshold: at or below this many entries the
/// hash-prefiltered linear scan over `hashes` wins (the whole `Vec<u32>` fits
/// in one cache line); above it we build/maintain the SwissTable index. Same
/// `linear_scan_max` cut-off as `std/array_hash_map.zig`.
const INDEX_THRESHOLD: usize = 8;

/// Widen the cached `u32` entry hash to the `u64` hashbrown probes with. The
/// SwissTable control byte is `h2 = top 7 bits of the 64-bit hash`; if we fed
/// the raw `u32` zero-extended, every entry would land in the same h2 group
/// and probing would degrade to a scan. Splitting the low/high halves into
/// both lanes keeps h2 well-distributed without rehashing the key.
#[inline(always)]
const fn spread_hash(h: u32) -> u64 {
    let h = h as u64;
    h | (h.wrapping_mul(0x9E37_79B9).wrapping_shl(32))
}

/// Insertion-ordered hash map with contiguous key / value storage.
pub struct ArrayHashMap<K, V, C = AutoContext> {
    keys: Vec<K>,
    values: Vec<V>,
    hashes: Vec<u32>,
    /// Lazily-built `hash → entry index` accelerator. `None` below
    /// [`INDEX_THRESHOLD`] entries or after a reorder/remove until the next
    /// lookup rebuilds it. Stores `u32` indices; the table is hashed by
    /// [`spread_hash`] of `self.hashes[i]` so lookups never re-hash `K`.
    index: Option<hashbrown::HashTable<u32>>,
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
            index: self.index.clone(),
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
            index: None,
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

    /// Zig: `capacity()` — number of entries the backing storage can hold
    /// without reallocating.
    #[inline]
    pub fn capacity(&self) -> usize {
        self.keys.capacity()
    }

    /// Zig: `pop()` — remove and return the last entry in insertion order, or
    /// `None` when empty. O(1); no rehash needed (the removed slot is the tail).
    pub fn pop(&mut self) -> Option<KV<K, V>> {
        let key = self.keys.pop()?;
        // SAFETY: keys/values/hashes always share the same length.
        let value = self.values.pop().unwrap();
        self.hashes.pop();
        self.drop_index();
        Some(KV { key, value })
    }

    /// Zig: `clearAndFree(allocator)` — drop every entry and release the
    /// backing allocations (capacity goes to zero).
    pub fn clear_and_free(&mut self) {
        self.keys = Vec::new();
        self.values = Vec::new();
        self.hashes = Vec::new();
        self.index = None;
    }

    pub fn ensure_total_capacity(&mut self, n: usize) -> Result<(), AllocError> {
        let need = n.saturating_sub(self.keys.len());
        self.keys.reserve(need);
        self.values.reserve(need);
        self.hashes.reserve(need);
        Ok(())
    }

    /// Zig: `map.entries.len = n` after `ensureTotalCapacity(n)` — bulk-resize
    /// the backing columns so callers can `keys_mut().copy_from_slice(...)` /
    /// `values_mut().copy_from_slice(...)` and then `re_index()`. Mirrors the
    /// pattern in `lockfile/bun.lockb.zig`'s `Serializer.load`.
    ///
    /// # Safety
    /// `n` must not exceed reserved capacity, and every element in
    /// `old_len..n` of each column must be fully written before any read
    /// (including `re_index`, which reads `keys`). For `Copy` POD keys/values
    /// (the only callers today) the intermediate uninit window is sound as
    /// long as it is filled immediately.
    pub unsafe fn set_entries_len(&mut self, n: usize) {
        debug_assert!(n <= self.keys.capacity());
        debug_assert!(n <= self.values.capacity());
        debug_assert!(n <= self.hashes.capacity());
        // SAFETY: caller contract above; matches Zig `.entries.len = n`.
        unsafe {
            self.keys.set_len(n);
            self.values.set_len(n);
            self.hashes.set_len(n);
        }
        // Caller is about to overwrite keys/values then `re_index()`.
        self.drop_index();
    }

    /// Zig `ensureTotalCapacityContext`: same as `ensure_total_capacity` but
    /// takes an explicit `ctx` for the stored key type. This port maintains no
    /// separate index header (lookup scans the cached `hashes` vec), so the
    /// context is accepted and ignored — capacity reservation is purely a Vec
    /// operation here.
    #[inline]
    pub fn ensure_total_capacity_context<Ctx>(&mut self, n: usize, _ctx: Ctx) -> Result<(), AllocError> {
        self.ensure_total_capacity(n)
    }

    /// Zig `putAssumeCapacityContext`: insert/replace using an externally-supplied
    /// hash/eql context instead of the stored `C`. Used when `C = AutoContext`
    /// can't satisfy `K: Hash` (e.g. `bun_semver::String`, whose hash needs the
    /// owning `arg_buf`/`existing_buf`). Takes closures rather than an
    /// `ArrayHashAdapter` so callers with inherent-method contexts (no trait
    /// impl, by-value receivers) don't need a wrapper struct.
    pub fn put_assume_capacity_context(
        &mut self,
        key: K,
        value: V,
        hash: impl Fn(&K) -> u32,
        eql: impl Fn(&K, &K, usize) -> bool,
    ) {
        let h = hash(&key);
        if let Some(i) = self.find_hash(h, |k, idx| eql(&key, k, idx)) {
            self.keys[i] = key;
            self.values[i] = value;
            return;
        }
        // PERF(port): was assume_capacity — Vec::push is amortized O(1) regardless.
        self.push_entry(key, value, h);
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

    /// Zig: `shrinkAndFree(new_len)` — truncate to `new_len` entries (dropping
    /// any tail) and release excess capacity. Insertion order is preserved, so
    /// no rehash of the surviving prefix is needed.
    pub fn shrink_and_free(&mut self, new_len: usize) {
        self.keys.truncate(new_len);
        self.values.truncate(new_len);
        self.hashes.truncate(new_len);
        self.keys.shrink_to_fit();
        self.values.shrink_to_fit();
        self.hashes.shrink_to_fit();
        self.drop_index();
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
        if let Some(index) = self.index.as_mut() {
            index.clear();
        }
    }

    /// std-HashMap-compat alias for `clear_retaining_capacity`. Zig callers
    /// frequently spell this `clearRetainingCapacity()`; ported call sites that
    /// went through the std-alias path expect bare `clear()`.
    #[inline]
    pub fn clear(&mut self) {
        self.clear_retaining_capacity();
    }

    /// std-HashMap-compat: shared iteration over `(key, value)` pairs in
    /// insertion order. Distinct from [`iterator`](Self::iterator) which yields
    /// mutable `Entry { key_ptr, value_ptr }` (Zig shape) and requires
    /// `&mut self`.
    #[inline]
    pub fn iter(&self) -> core::iter::Zip<core::slice::Iter<'_, K>, core::slice::Iter<'_, V>> {
        self.keys.iter().zip(self.values.iter())
    }

    /// Zig `getIndexContext` for callers whose context is an inherent-method
    /// struct (no `ArrayHashAdapter` impl). Takes the precomputed `u32` hash
    /// plus an `eql` closure so e.g. `bun_semver::String::ArrayHashContext`
    /// (which needs `arg_buf`/`existing_buf`) can drive a `&self` lookup.
    #[inline]
    pub fn get_index_adapted_raw<F: Fn(&K, usize) -> bool>(&self, h: u32, eq: F) -> Option<usize> {
        self.find_hash(h, eq)
    }

    // ── internal lookup ───────────────────────────────────────────────────

    #[inline]
    fn find_hash<F: Fn(&K, usize) -> bool>(&self, h: u32, eq: F) -> Option<usize> {
        if let Some(index) = self.index.as_ref() {
            let hashes = self.hashes.as_ptr();
            let keys = self.keys.as_ptr();
            return index
                .find(spread_hash(h), |&i| {
                    let i = i as usize;
                    // SAFETY: every `i` stored in `self.index` was pushed by
                    // `push_entry`/`rebuild_index` with `i < self.hashes.len()`
                    // (== `self.keys.len()`), and every path that shrinks or
                    // permutes those vecs first calls `drop_index()`. Going
                    // through raw pointers (not `self.hashes[i]`) sidesteps an
                    // overlapping-borrow false positive: `index` already
                    // borrows `self`.
                    unsafe { *hashes.add(i) == h && eq(&*keys.add(i), i) }
                })
                .map(|&i| i as usize);
        }
        // Below the index threshold (or just after a reorder dropped the
        // index): hash-prefiltered linear scan. `hashes.len()` ≤ 8 here in the
        // steady state, so this is a single cache line.
        for (i, &stored) in self.hashes.iter().enumerate() {
            // SAFETY: `keys.len() == hashes.len()` is a struct invariant
            // upheld by every mutation path.
            if stored == h && eq(unsafe { self.keys.get_unchecked(i) }, i) {
                return Some(i);
            }
        }
        None
    }

    /// Append a fresh entry to all three column vecs and, if the index is
    /// live (or this push crosses the threshold), record it there too. Every
    /// insert path funnels through here so the index can never miss an entry.
    #[inline]
    fn push_entry(&mut self, key: K, value: V, h: u32) -> usize {
        let i = self.keys.len();
        self.keys.push(key);
        self.values.push(value);
        self.hashes.push(h);
        match self.index.as_mut() {
            Some(index) => {
                let hashes = self.hashes.as_ptr();
                index.insert_unique(spread_hash(h), i as u32, |&j| {
                    // SAFETY: `j` was inserted with `j < hashes.len()` and the
                    // vec is append-only between `drop_index()` calls.
                    spread_hash(unsafe { *hashes.add(j as usize) })
                });
            }
            None if i >= INDEX_THRESHOLD => self.rebuild_index(),
            None => {}
        }
        i
    }

    /// Rebuild the `hash → index` accelerator from `self.hashes`. Called when
    /// the entry count first crosses [`INDEX_THRESHOLD`].
    #[cold]
    fn rebuild_index(&mut self) {
        let mut table = hashbrown::HashTable::with_capacity(self.hashes.len());
        let hashes = self.hashes.as_ptr();
        for (i, &h) in self.hashes.iter().enumerate() {
            table.insert_unique(spread_hash(h), i as u32, |&j| {
                // SAFETY: `j < self.hashes.len()` — it was inserted by an
                // earlier iteration of this loop.
                spread_hash(unsafe { *hashes.add(j as usize) })
            });
        }
        self.index = Some(table);
    }

    /// Invalidate the accelerator. Called by every operation that removes or
    /// permutes entries; the next insert past the threshold rebuilds it.
    /// Cheaper than patching in place for the rare-mutation / heavy-lookup
    /// shape the bundler exhibits, and trivially correct.
    #[inline]
    fn drop_index(&mut self) {
        self.index = None;
    }

    /// Zig `ArrayHashMap.sort` — stable in-place sort of keys/values/hashes by
    /// a caller-supplied index comparator. The closure receives borrows of the
    /// key and value slices so it can compare on either without re-borrowing
    /// `self`.
    pub fn sort(&mut self, mut less_than: impl FnMut(&[K], &[V], usize, usize) -> bool) {
        let len = self.keys.len();
        if len < 2 {
            return;
        }
        let mut perm: Vec<usize> = (0..len).collect();
        {
            let keys = &self.keys[..];
            let values = &self.values[..];
            perm.sort_by(|&a, &b| {
                if less_than(keys, values, a, b) {
                    core::cmp::Ordering::Less
                } else if less_than(keys, values, b, a) {
                    core::cmp::Ordering::Greater
                } else {
                    core::cmp::Ordering::Equal
                }
            });
        }
        // Apply permutation in-place via cycle-following swaps.
        self.drop_index();
        let mut visited = vec![false; len];
        for start in 0..len {
            if visited[start] || perm[start] == start {
                continue;
            }
            let mut i = start;
            while !visited[i] {
                visited[i] = true;
                let j = perm[i];
                if j == start {
                    break;
                }
                self.keys.swap(i, j);
                self.values.swap(i, j);
                self.hashes.swap(i, j);
                i = j;
            }
        }
    }

    fn gop_at(&mut self, index: usize, found_existing: bool) -> GetOrPutResult<'_, K, V> {
        // SAFETY: `keys` and `values` are distinct allocations; producing one
        // `&mut` into each is sound even though both derive from `&mut self`.
        let key_ptr = unsafe { &mut *self.keys.as_mut_ptr().add(index) };
        let value_ptr = unsafe { &mut *self.values.as_mut_ptr().add(index) };
        GetOrPutResult { found_existing, index, key_ptr, value_ptr }
    }

    /// Mutable access to the entry at `index` (key + value). Returns `None` if
    /// `index >= len`. Mirrors `indexmap::IndexMap::get_index_mut`.
    pub fn get_index_mut(&mut self, index: usize) -> Option<(&mut K, &mut V)> {
        if index >= self.keys.len() {
            return None;
        }
        // SAFETY: `keys` and `values` are distinct allocations; one `&mut` into
        // each is sound even though both derive from `&mut self`.
        let key_ptr = unsafe { &mut *self.keys.as_mut_ptr().add(index) };
        let value_ptr = unsafe { &mut *self.values.as_mut_ptr().add(index) };
        Some((key_ptr, value_ptr))
    }

    /// Zig `swapRemoveAt` — remove the entry at `index` by swapping in the last
    /// entry. O(1); does not preserve insertion order. Returns the removed pair.
    pub fn swap_remove_at(&mut self, index: usize) -> (K, V) {
        let k = self.keys.swap_remove(index);
        let v = self.values.swap_remove(index);
        self.hashes.swap_remove(index);
        self.drop_index();
        (k, v)
    }

    // ── adapted lookup (Zig: getAdapted / getIndexAdapted) ─────────────────

    /// Look up by `key` using `adapter` for hash/eql, without constructing a `K`.
    #[inline]
    pub fn get_index_adapted<Q: ?Sized, A>(&self, key: &Q, adapter: A) -> Option<usize>
    where
        A: ArrayHashAdapter<Q, K>,
    {
        let h = adapter.hash(key);
        self.find_hash(h, |k, idx| adapter.eql(key, k, idx))
    }

    #[inline]
    pub fn get_adapted<Q: ?Sized, A>(&self, key: &Q, adapter: A) -> Option<&V>
    where
        A: ArrayHashAdapter<Q, K>,
    {
        self.get_index_adapted(key, adapter).map(|i| &self.values[i])
    }

    /// Zig `getPtrContext` / `getPtrAdapted` — mutable value lookup using an
    /// externally-supplied hash/eql adapter.
    #[inline]
    pub fn get_ptr_adapted<Q: ?Sized, A>(&mut self, key: &Q, adapter: A) -> Option<&mut V>
    where
        A: ArrayHashAdapter<Q, K>,
    {
        let i = self.get_index_adapted(key, adapter)?;
        Some(&mut self.values[i])
    }

    #[inline]
    pub fn contains_adapted<Q: ?Sized, A>(&self, key: &Q, adapter: A) -> bool
    where
        A: ArrayHashAdapter<Q, K>,
    {
        self.get_index_adapted(key, adapter).is_some()
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
        self.drop_index();
        if self.keys.len() > INDEX_THRESHOLD {
            self.rebuild_index();
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
            self.push_entry(key, value, h);
        }
        Ok(())
    }

    pub fn put_no_clobber(&mut self, key: K, value: V) -> Result<(), AllocError> {
        let h = self.ctx.hash(&key);
        debug_assert!(
            self.find_hash(h, |k, idx| self.ctx.eql(&key, k, idx)).is_none(),
            "put_no_clobber: key already present",
        );
        self.push_entry(key, value, h);
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
            self.push_entry(key, value, h);
            None
        }
    }

    pub fn swap_remove(&mut self, key: &K) -> bool {
        let Some(i) = self.get_index(key) else { return false };
        self.keys.swap_remove(i);
        self.values.swap_remove(i);
        self.hashes.swap_remove(i);
        self.drop_index();
        true
    }

    /// Zig: `fetchSwapRemove` — swap-remove returning the removed `(K, V)` pair,
    /// or `None` if `key` was not present.
    pub fn fetch_swap_remove(&mut self, key: &K) -> Option<(K, V)> {
        let i = self.get_index(key)?;
        self.hashes.swap_remove(i);
        self.drop_index();
        Some((self.keys.swap_remove(i), self.values.swap_remove(i)))
    }

    /// Zig: `orderedRemove` — preserves insertion order of remaining entries.
    /// Returns `true` if the key was present (matching Zig's `bool` return).
    #[inline]
    pub fn ordered_remove(&mut self, key: &K) -> bool {
        self.remove(key).is_some()
    }

    /// std-HashMap-compat: ordered remove returning the value. Preserves the
    /// relative order of remaining entries (unlike `swap_remove`).
    pub fn remove(&mut self, key: &K) -> Option<V> {
        let i = self.get_index(key)?;
        self.keys.remove(i);
        self.hashes.remove(i);
        self.drop_index();
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
        self.map.drop_index();
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
        let i = self.map.push_entry(self.key, value, self.hash);
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
        let i = self.push_entry(key, V::default(), h);
        Ok(self.gop_at(i, false))
    }

    /// Zig `getOrPutAssumeCapacity`: like [`get_or_put`] but skips the grow
    /// check. Caller must have called `ensure_unused_capacity` first.
    pub fn get_or_put_assume_capacity(&mut self, key: K) -> GetOrPutResult<'_, K, V> {
        let h = self.ctx.hash(&key);
        if let Some(i) = self.find_hash(h, |k, idx| self.ctx.eql(&key, k, idx)) {
            return self.gop_at(i, true);
        }
        // PERF(port): `push_within_capacity` is unstable; `push` is a no-grow
        // when the prior `ensure_unused_capacity` reserved the slot.
        let i = self.push_entry(key, V::default(), h);
        self.gop_at(i, false)
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
        let i = self.push_entry(K::default(), V::default(), h);
        Ok(self.gop_at(i, false))
    }

    /// Zig `getOrPutContextAdapted`: same as `get_or_put_adapted` but takes an
    /// explicit `ctx` for the *stored* key type. This port does not need `ctx`
    /// for the index header (none yet), so it is accepted and ignored.
    #[inline]
    pub fn get_or_put_context_adapted<Q, A>(
        &mut self,
        key: Q,
        adapter: A,
        _ctx: C,
    ) -> Result<GetOrPutResult<'_, K, V>, AllocError>
    where
        A: ArrayHashAdapter<Q, K>,
    {
        self.get_or_put_adapted(key, adapter)
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
    inner: ArrayHashMap<Box<[u8]>, V, BoxedSliceContext<C>>,
    // The string context is consulted for hash/eql on `[u8]` borrows. The inner
    // map's context is `BoxedSliceContext<C>` (NOT `AutoContext`) so methods
    // reached via `Deref` hash identically to the `&[u8]` paths above.
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

impl<V: Clone, C: Default> StringArrayHashMap<V, C> {
    /// Zig `clone()` is fallible (OOM); kept as `Result` for API parity.
    pub fn clone(&self) -> Result<Self, AllocError> {
        Ok(Self { inner: self.inner.clone()?, ctx: C::default() })
    }
}

impl<V, C> Deref for StringArrayHashMap<V, C> {
    type Target = ArrayHashMap<Box<[u8]>, V, BoxedSliceContext<C>>;
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
            self.inner.push_entry(Box::from(key), value, h);
            None
        }
    }

    pub fn put(&mut self, key: &[u8], value: V) -> Result<(), AllocError> {
        let h = self.ctx.hash(key);
        if let Some(i) = self.inner.find_hash(h, |k, idx| self.ctx.eql(key, k, idx)) {
            self.inner.values[i] = value;
        } else {
            self.inner.push_entry(Box::from(key), value, h);
        }
        Ok(())
    }

    pub fn put_assume_capacity(&mut self, key: &[u8], value: V) {
        let _ = self.put(key, value);
    }

    pub fn swap_remove(&mut self, key: &[u8]) -> bool {
        let Some(i) = self.find(key) else { return false };
        self.inner.swap_remove_at(i);
        true
    }

    /// Zig: `StringArrayHashMap.fetchSwapRemove` — removes the entry (swapping
    /// the last element into its slot) and returns the owned key/value pair.
    pub fn fetch_swap_remove(&mut self, key: &[u8]) -> Option<KV<Box<[u8]>, V>> {
        let i = self.find(key)?;
        let (k, v) = self.inner.swap_remove_at(i);
        Some(KV { key: k, value: v })
    }

    pub fn re_index(&mut self) -> Result<(), AllocError> {
        for (i, k) in self.inner.keys.iter().enumerate() {
            self.inner.hashes[i] = self.ctx.hash(k);
        }
        self.inner.drop_index();
        if self.inner.keys.len() > INDEX_THRESHOLD {
            self.inner.rebuild_index();
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
        let i = self.inner.push_entry(Box::from(key), V::default(), h);
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
        let i = self.inner.push_entry(Box::from(key), value, h);
        Ok(self.inner.gop_at(i, false))
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
// Hashed with seed-0 wyhash (matches Zig's `std.hash_map.StringContext`) —
// deterministic across runs and ~3-5× faster than `RandomState`/SipHash on
// the short identifier keys the parser/printer/renamer churn.
#[derive(Clone)]
pub struct StringHashMap<V> {
    inner: std::collections::HashMap<Box<[u8]>, V, bun_wyhash::BuildHasher>,
}

impl<V> Default for StringHashMap<V> {
    fn default() -> Self {
        Self { inner: std::collections::HashMap::default() }
    }
}

impl<V> Deref for StringHashMap<V> {
    type Target = std::collections::HashMap<Box<[u8]>, V, bun_wyhash::BuildHasher>;
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

    pub fn with_capacity(n: usize) -> Self {
        Self {
            inner: std::collections::HashMap::with_capacity_and_hasher(
                n,
                bun_wyhash::BuildHasher::default(),
            ),
        }
    }

    #[inline]
    pub fn count(&self) -> usize {
        self.inner.len()
    }

    /// Zig `valueIterator()`. Inherent forwarder so callers can name
    /// `StringHashMap::values` without relying on `Deref` resolution.
    #[inline]
    pub fn values(&self) -> std::collections::hash_map::Values<'_, Box<[u8]>, V> {
        self.inner.values()
    }

    #[inline]
    pub fn values_mut(&mut self) -> std::collections::hash_map::ValuesMut<'_, Box<[u8]>, V> {
        self.inner.values_mut()
    }

    pub fn ensure_total_capacity(&mut self, n: usize) -> Result<(), AllocError> {
        let need = n.saturating_sub(self.inner.len());
        self.inner.reserve(need);
        Ok(())
    }

    pub fn ensure_unused_capacity(&mut self, additional: usize) -> Result<(), AllocError> {
        self.inner.reserve(additional);
        Ok(())
    }

    pub fn put(&mut self, key: &[u8], value: V) -> Result<(), AllocError> {
        self.inner.insert(Box::from(key), value);
        Ok(())
    }

    /// Insert a pre-boxed key without re-allocating it. Uses `try_reserve` so
    /// OOM surfaces as `Err` instead of aborting (matches Zig `put` returning
    /// `error.OutOfMemory`); callers can roll back side effects on failure.
    pub fn put_owned(&mut self, key: Box<[u8]>, value: V) -> Result<(), AllocError> {
        self.inner.try_reserve(1).map_err(|_| AllocError)?;
        self.inner.insert(key, value);
        Ok(())
    }

    /// PERF(port): Zig skips the grow check; std::HashMap cannot, so this is
    /// just `put` without the `Result`.
    #[inline]
    pub fn put_assume_capacity(&mut self, key: &[u8], value: V) {
        self.inner.insert(Box::from(key), value);
    }

    /// Zig `putNoClobber` — asserts the key was not already present.
    pub fn put_no_clobber(&mut self, key: &[u8], value: V) -> Result<(), AllocError> {
        let prev = self.inner.insert(Box::from(key), value);
        debug_assert!(prev.is_none(), "put_no_clobber: key already present");
        Ok(())
    }

    /// Zig `getAdapted` — look up by `key` using `adapter` for hash/eql.
    ///
    /// PERF(port): the underlying `std::HashMap` cannot be queried with an
    /// external u64 hash (it uses its own `BuildHasher`), so the adapter's
    /// precomputed hash is ignored and the lookup falls back to the normal
    /// `get(key)` path. Correctness is preserved (`adapter.eql` is byte
    /// equality for all current adapters); only the rehash-avoidance is lost.
    /// Restore once `StringHashMap` is moved off `std::HashMap` onto a
    /// wyhash-backed table that accepts a raw u64.
    #[inline]
    pub fn get_adapted<A>(&self, key: &[u8], _adapter: &A) -> Option<&V> {
        self.inner.get(key)
    }

    /// See `get_adapted` for the PERF(port) caveat.
    #[inline]
    pub fn contains_adapted<A>(&self, key: &[u8], _adapter: &A) -> bool {
        self.inner.contains_key(key)
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

    /// Zig `getOrPutContextAdapted` on `StringHashMap` — see `get_adapted` for
    /// why the adapter's precomputed hash is currently ignored.
    pub fn get_or_put_context_adapted<A>(
        &mut self,
        key: &[u8],
        _adapter: A,
    ) -> StringHashMapGetOrPut<'_, V> {
        let found_existing = self.inner.contains_key(key);
        let value_ptr = self
            .inner
            .entry(Box::from(key))
            .or_insert_with(V::default);
        StringHashMapGetOrPut { found_existing, value_ptr }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StringHashMapContext + Prehashed adapters (src/bun.zig)
// ──────────────────────────────────────────────────────────────────────────

/// `bun.StringHashMapContext` — wyhash(seed=0) over byte slices, full 64-bit.
/// This is the *unordered* map context (vs. `StringContext` above which
/// truncates to u32 for `ArrayHashMap`).
///
/// PORT NOTE: spelled as a module rather than a unit struct so callers can
/// path-access the nested `Prehashed` / `PrehashedCaseInsensitive` types
/// (`StringHashMapContext::Prehashed::…`) on stable Rust, which forbids
/// inherent associated types.
#[allow(non_snake_case)]
pub mod StringHashMapContext {
    #[inline]
    pub fn hash(s: &[u8]) -> u64 {
        bun_wyhash::hash(s)
    }
    #[inline]
    pub fn eql(a: &[u8], b: &[u8]) -> bool {
        a == b
    }
    /// Precompute the hash of `input` so repeated lookups across many maps
    /// can skip rehashing. Returns a `Prehashed` adapter.
    #[inline]
    pub fn pre(input: &[u8]) -> super::string_hash_map::Prehashed<'_> {
        super::string_hash_map::Prehashed { value: bun_wyhash::hash(input), input }
    }

    pub use super::string_hash_map::{Prehashed, PrehashedCaseInsensitive};
}

/// Namespace mirroring `std.hash_map` so call sites can write
/// `bun_collections::string_hash_map::{hash, Prehashed, GetOrPutResult}`.
pub mod string_hash_map {
    /// `std.hash_map.hashString` — wyhash(seed=0), full u64.
    #[inline]
    pub fn hash(s: &[u8]) -> u64 {
        bun_wyhash::hash(s)
    }

    /// `bun.StringHashMapContext.Prehashed` — caches the hash of one borrowed
    /// slice; `hash()` returns the cached value when asked about that exact
    /// slice (pointer + len identity), otherwise rehashes.
    #[derive(Clone, Copy)]
    pub struct Prehashed<'a> {
        pub value: u64,
        pub input: &'a [u8],
    }

    impl<'a> Prehashed<'a> {
        #[inline]
        pub fn new(input: &'a [u8]) -> Self {
            Self { value: hash(input), input }
        }
        #[inline]
        pub fn hash(&self, s: &[u8]) -> u64 {
            if core::ptr::eq(s.as_ptr(), self.input.as_ptr()) && s.len() == self.input.len() {
                return self.value;
            }
            hash(s)
        }
        #[inline]
        pub fn eql(&self, a: &[u8], b: &[u8]) -> bool {
            a == b
        }
    }

    /// `bun.StringHashMapContext.PrehashedCaseInsensitive` — owns a lowercased
    /// copy of the input. Dropped via `Box`.
    pub struct PrehashedCaseInsensitive {
        pub value: u64,
        pub input: Box<[u8]>,
    }

    impl PrehashedCaseInsensitive {
        pub fn init(input: &[u8]) -> Self {
            let mut out = vec![0u8; input.len()].into_boxed_slice();
            for (dst, &src) in out.iter_mut().zip(input) {
                *dst = src.to_ascii_lowercase();
            }
            Self { value: hash(&out), input: out }
        }
        #[inline]
        pub fn hash(&self, s: &[u8]) -> u64 {
            if core::ptr::eq(s.as_ptr(), self.input.as_ptr()) && s.len() == self.input.len() {
                return self.value;
            }
            hash(s)
        }
        #[inline]
        pub fn eql(&self, a: &[u8], b: &[u8]) -> bool {
            a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.eq_ignore_ascii_case(y))
        }
    }

    /// Result type alias for `StringHashMap::get_or_put*` so callers can name
    /// it as `string_hash_map::GetOrPutResult<'_, V>`.
    pub type GetOrPutResult<'a, V> = super::StringHashMapGetOrPut<'a, V>;
}

// ──────────────────────────────────────────────────────────────────────────
// StringSet (src/bun.zig) — `StringArrayHashMap<()>` with key-duping insert
// ──────────────────────────────────────────────────────────────────────────

/// `bun.StringSet` — insertion-ordered set of owned byte-string keys.
#[derive(Default)]
pub struct StringSet {
    pub map: StringArrayHashMap<()>,
}

impl StringSet {
    #[inline]
    pub fn new() -> Self {
        Self::default()
    }

    /// Zig `init(allocator)` — allocator dropped (global mimalloc).
    #[inline]
    pub fn init() -> Self {
        Self::default()
    }

    pub fn clone(&self) -> Result<Self, AllocError> {
        Ok(Self { map: self.map.clone()? })
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.map.count() == 0
    }

    #[inline]
    pub fn count(&self) -> usize {
        self.map.count()
    }

    #[inline]
    pub fn keys(&self) -> &[Box<[u8]>] {
        self.map.keys()
    }

    /// Insert `key`, duping it on miss. Returns `Ok(())` whether or not the key
    /// was already present (Zig signature).
    pub fn insert(&mut self, key: &[u8]) -> Result<(), AllocError> {
        // get_or_put already boxes `key` on miss; the Zig second-dupe is
        // redundant under owned `Box<[u8]>` keys.
        let _ = self.map.get_or_put(key)?;
        Ok(())
    }

    #[inline]
    pub fn contains(&self, key: &[u8]) -> bool {
        self.map.contains(key)
    }

    #[inline]
    pub fn swap_remove(&mut self, key: &[u8]) -> bool {
        self.map.swap_remove(key)
    }

    pub fn clear_and_free(&mut self) {
        // Keys are `Box<[u8]>`; `clear` drops them.
        self.map.clear_retaining_capacity();
        // PORT NOTE: Zig also freed the backing arrays; Vec keeps capacity here
        // (callers wanting that can drop the whole `StringSet`).
    }

    // `deinit` → Drop.
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

// ported from: vendor/zig/lib/std/array_hash_map.zig

#[cfg(test)]
mod index_tests {
    use super::*;

    #[test]
    fn indexed_lookup_agrees_with_linear() {
        let mut m: ArrayHashMap<u64, u64> = ArrayHashMap::new();
        // Cross the threshold so the index is exercised.
        for i in 0..1000u64 {
            assert!(m.put(i.wrapping_mul(2654435761), i).is_ok());
        }
        for i in 0..1000u64 {
            let k = i.wrapping_mul(2654435761);
            assert_eq!(m.get(&k), Some(&i));
        }
        assert_eq!(m.get(&1), None);
        // Removal drops the index; subsequent lookups must still hit.
        assert!(m.swap_remove(&0));
        assert_eq!(m.get(&0), None);
        for i in 1..1000u64 {
            let k = i.wrapping_mul(2654435761);
            assert_eq!(m.get(&k), Some(&i));
        }
        // get_or_put on an existing key after the index was dropped+rebuilt.
        let gop = m.get_or_put(2654435761).unwrap();
        assert!(gop.found_existing);
        assert_eq!(*gop.value_ptr, 1);
    }

    #[test]
    fn string_map_indexed() {
        let mut m: StringArrayHashMap<usize> = StringArrayHashMap::new();
        let keys: Vec<String> = (0..200).map(|i| format!("key{i}")).collect();
        for (i, k) in keys.iter().enumerate() {
            m.put(k.as_bytes(), i).unwrap();
        }
        for (i, k) in keys.iter().enumerate() {
            assert_eq!(m.get(k.as_bytes()), Some(&i));
        }
        assert_eq!(m.get(b"missing"), None);
    }
}
