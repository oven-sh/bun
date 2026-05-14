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
//! linear scan below the threshold, indexed lookup above it. Point removals
//! (`pop`, `swap_remove`) patch the index in place (O(1), matching Zig's
//! `removeFromIndexByIndex`); wholesale permutations (`sort`,
//! `ordered_remove`) drop and immediately rebuild it so lookups never
//! silently degrade to O(n).

use core::alloc::Allocator;
use core::hash::{Hash, Hasher};
use std::alloc::Global;
// See workspace `Cargo.toml` hashbrown comment + `bun_alloc/hashbrown_bridge.rs`
// for why `StringHashMap`'s `A` must implement *both* allocator traits and why
// the default is `DefaultAlloc` rather than `std::alloc::Global`.
use bun_alloc::{DefaultAlloc, HashbrownAllocator};
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
        // Zig: std.array_hash_map.getAutoHashFn → std.hash.Wyhash. Route through
        // the one-shot hasher to skip the streaming state's 48-byte zero-fill —
        // keys here are small POD (`Ref`, indices) so the fold is a single `mum`.
        bun_wyhash::auto_hash(key) as u32 // @truncate
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
    pub fn hash_bytes(s: &[u8]) -> u32 {
        bun_wyhash::hash_ascii_lowercase(0, s) as u32 // @truncate
    }

    /// `bun.CaseInsensitiveASCIIStringContext.pre` (src/bun.zig:1031).
    #[inline]
    pub fn pre(input: &[u8]) -> CaseInsensitiveAsciiPrehashed<'_> {
        CaseInsensitiveAsciiPrehashed {
            value: Self::hash_bytes(input),
            input,
        }
    }
}

/// `bun.CaseInsensitiveASCIIStringContext.Prehashed` (src/bun.zig:1035) —
/// caches the case-folded hash for `input` so repeated probes against the same
/// key skip the lowercasing pass.
pub struct CaseInsensitiveAsciiPrehashed<'a> {
    pub value: u32,
    pub input: &'a [u8],
}

impl<'a> CaseInsensitiveAsciiPrehashed<'a> {
    #[inline]
    pub fn hash(&self, s: &[u8]) -> u32 {
        if core::ptr::eq(s.as_ptr(), self.input.as_ptr()) && s.len() == self.input.len() {
            return self.value;
        }
        CaseInsensitiveAsciiStringContext::hash_bytes(s)
    }
    #[inline]
    pub fn eql(&self, a: &[u8], b: &[u8]) -> bool {
        bun_core::strings::eql_case_insensitive_ascii_check_length(a, b)
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

impl<C: ArrayHashContext<[u8]>, A: Allocator> ArrayHashContext<Box<[u8], A>>
    for BoxedSliceContext<C>
{
    #[inline]
    fn hash(&self, key: &Box<[u8], A>) -> u32 {
        self.0.hash(&**key)
    }
    #[inline]
    fn eql(&self, a: &Box<[u8], A>, b: &Box<[u8], A>, b_index: usize) -> bool {
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
        bun_core::strings::eql_case_insensitive_ascii_check_length(a, b)
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

// ── Non-generic index-accelerator helpers ────────────────────────────────────
//
// The `hashbrown::HashTable<u32>` index is keyed purely by `self.hashes`
// (a `&[u32]`); nothing about it depends on `K`, `V`, `C`, or `A`. The
// previous shape — inline `|&j| spread_hash(self.hashes[j as usize])` closures
// inside the generic `push_entry<K,V,C,A>` / `rebuild_index<K,V,C,A>` — meant
// `hashbrown::raw::RawTable<u32>::reserve_rehash` (which is monomorphic over
// the closure type) was re-instantiated in every downstream crate that touched
// an `ArrayHashMap`: bun_css, bun_dotenv, bun_md, bun_install each emitted
// their own physically-distinct copy, ICF could not fold them (per-CGU codegen
// differs in size), and the linker scattered those hot copies into cold 64 KB
// code pages (encoding_rs / bun_css `process_doc` / bun_sql_jsc), pulling
// ~320 KB of otherwise-cold code resident on startup.
//
// Hoisting the closure into one named return-position `impl Fn` and routing
// every insert/rebuild through `#[inline(never)]` free fns collapses all of
// that to a single `reserve_rehash` monomorph emitted once in this crate's
// CGU, where `src/startup.order` can place it.

/// The one rehasher closure type for the `HashTable<u32>` accelerator.
/// Return-position `impl Fn` names a single concrete type, so every
/// `insert_unique`/`reserve` call below shares one `RawTable<u32>` grow path.
#[inline]
fn index_rehasher(hashes: &[u32]) -> impl Fn(&u32) -> u64 + '_ {
    move |&j| spread_hash(hashes[j as usize])
}

/// Append entry index `i` (cached hash `h`) to the accelerator. Outlined so the
/// `RawTable<u32>::{insert_unique, reserve_rehash}` it monomorphizes live in
/// `bun_collections` instead of being cloned into every generic
/// `push_entry::<K,V,C,A>` instantiation downstream. The extra call frame is
/// ~5 cycles against a ~30-cycle SwissTable insert; the win is one hot copy
/// the linker can order instead of N scattered ones.
#[inline(never)]
fn index_insert_unique(index: &mut hashbrown::HashTable<u32>, hashes: &[u32], i: u32, h: u32) {
    index.insert_unique(spread_hash(h), i, index_rehasher(hashes));
}

/// Grow a live accelerator so it can hold `target` entries without a further
/// `RawTable<u32>` rehash. Outlined for the same reason as
/// [`index_insert_unique`] — keep the `reserve_rehash` monomorph in this crate
/// rather than re-emitting it per `<K,V,C,A>` instantiation. Called from the
/// `reserve` / `ensure_*_capacity` paths so a caller that pre-sizes the map
/// (the Zig originals' `ensureTotalCapacityContext`, which also sizes the index
/// header) pays the SwissTable grow once instead of `O(log n)` times across the
/// following `push_entry` loop.
#[inline(never)]
fn index_reserve(index: &mut hashbrown::HashTable<u32>, hashes: &[u32], target: usize) {
    let extra = target.saturating_sub(index.len());
    if extra != 0 {
        index.reserve(extra, index_rehasher(hashes));
    }
}

/// Build a fresh `hash → entry index` accelerator from a cached-hash column,
/// pre-sized to `capacity` (clamped up to the number of entries already
/// present). Passing the owning map's *column capacity* here — not just
/// `hashes.len()` — means a map that was `reserve()`d up front gets an index
/// big enough for its final size the moment it first crosses
/// [`INDEX_THRESHOLD`], so the per-`push_entry` SwissTable grow path never
/// runs again.
///
/// Free fn (no `K`/`V`/`C`/`A` in scope) + `#[inline(never)]` so this — and
/// the `HashTable::with_capacity` / grow path inside it — is one symbol shared
/// by every `ArrayHashMap` instantiation. Boxed so the caller can store it as
/// `Option<Box<…>>` (8 B header vs the 32 B inline `HashTable`).
#[cold]
#[inline(never)]
fn rebuild_index_from_hashes(hashes: &[u32], capacity: usize) -> Box<hashbrown::HashTable<u32>> {
    let mut table = hashbrown::HashTable::with_capacity(capacity.max(hashes.len()));
    for (i, &h) in hashes.iter().enumerate() {
        table.insert_unique(spread_hash(h), i as u32, index_rehasher(hashes));
    }
    Box::new(table)
}

/// Shorthand for the allocator bound every `ArrayHashMap`/`StringArrayHashMap`
/// `impl` block needs: `core::alloc::Allocator` for the `Vec<K/V/u32, A>`
/// columns and the per-key `Box<[u8], A>`; `Clone` so `Vec`/`Box` can clone
/// their allocator on resize/clone; `Default` so constructors don't need an
/// `*_in(alloc: A)` variant — all current `A` (`Global`, `AstAlloc`) are ZST.
///
/// Unlike `StringHashMap<V, A>`, this does **not** require
/// `HashbrownAllocator`: the `hashbrown::HashTable<u32>` index accelerator is
/// kept on hashbrown's default global allocator regardless of `A`. The index
/// is ~4 bytes/entry and only materialises past [`INDEX_THRESHOLD`]; for
/// `Ast.named_exports` (10 000 entries) it is ~40 KB vs ~1 MB of column +
/// key-box bytes, so routing only the latter through `AstAlloc` captures
/// >95% of the leak while keeping the default `A = std::alloc::Global` —
/// which means `Box<[u8], A>` defaults to plain `Box<[u8]>` and existing call
/// sites that name that type (e.g. `StringMap::keys() -> &[Box<[u8]>]`)
/// compile unchanged. Bridging `Global` to `allocator_api2::Allocator` to
/// route the index too is blocked by orphan rules.
pub trait MapAllocator: Allocator + Clone + Default {}
impl<A: Allocator + Clone + Default> MapAllocator for A {}

/// Insertion-ordered hash map with contiguous key / value storage.
///
/// `A` routes the three column `Vec`s and (for `StringArrayHashMap`) the
/// per-key `Box<[u8], A>` through the same allocator, so an
/// `ArrayHashMap<_, _, _, AstAlloc>` is bulk-freed by the AST arena's
/// `mi_heap_destroy` instead of leaking on the global heap when its owning AST
/// node never has `Drop` run (the `BabyList` pattern — same motivation as
/// `Vec<T, AstAlloc>` for `G::DeclList`/`PropertyList`, and
/// `StringHashMap<V, AstAlloc>` for `Scope::members`). The `hashbrown` index
/// accelerator stays on the global allocator; see [`MapAllocator`].
pub struct ArrayHashMap<K, V, C = AutoContext, A: MapAllocator = Global> {
    keys: Vec<K, A>,
    values: Vec<V, A>,
    hashes: Vec<u32, A>,
    /// `hash → entry index` accelerator. `None` below [`INDEX_THRESHOLD`]
    /// entries. Stores `u32` indices; the table is hashed by [`spread_hash`]
    /// of `self.hashes[i]` so lookups never re-hash `K`. Kept in sync with
    /// the column vecs by every mutation path (patched on point removal,
    /// rebuilt on permutation). Stays on hashbrown's default global allocator
    /// regardless of `A` (see [`MapAllocator`] for why).
    ///
    /// Boxed so the per-map header cost is 8 B (`Option<Box>` uses the
    /// `NonNull` niche) instead of the 32 B inline `HashTable` — `Part`
    /// embeds two `ArrayHashMap`s, so the inline shape alone added +48 B to
    /// every `Part` and doubled the `Vec<Part>` grow `memmove`s the bundler
    /// page-faults on. The box is allocated once, lazily, at the
    /// `INDEX_THRESHOLD` crossover.
    index: Option<Box<hashbrown::HashTable<u32>>>,
    ctx: C,
    // Zig `pointer_stability: std.debug.SafetyLock` — debug-only re-entrancy
    // guard around operations that may invalidate entry pointers. `AtomicBool`
    // (not `Cell<bool>`) so the field doesn't strip `Sync` off the map in
    // debug builds — a debug-only diagnostic must not change the type's
    // auto-trait surface vs release (callers store maps in `static LazyLock`,
    // e.g. `bundler::options::DEFAULT_LOADERS_BUN`).
    #[cfg(debug_assertions)]
    pointer_stability: core::sync::atomic::AtomicBool,
}

impl<K, V, C: Default, A: MapAllocator> Default for ArrayHashMap<K, V, C, A> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K: Clone, V: Clone, C: Default, A: MapAllocator> ArrayHashMap<K, V, C, A> {
    /// Zig `clone()` is fallible (OOM); kept as `Result` for API parity.
    pub fn clone(&self) -> Result<Self, AllocError> {
        Ok(Self {
            keys: self.keys.clone(),
            values: self.values.clone(),
            hashes: self.hashes.clone(),
            index: self.index.clone(),
            ctx: C::default(),
            #[cfg(debug_assertions)]
            pointer_stability: core::sync::atomic::AtomicBool::new(false),
        })
    }
}

impl<K, V, C: Default, A: MapAllocator> ArrayHashMap<K, V, C, A> {
    pub fn new() -> Self {
        Self {
            keys: Vec::new_in(A::default()),
            values: Vec::new_in(A::default()),
            hashes: Vec::new_in(A::default()),
            index: None,
            ctx: C::default(),
            #[cfg(debug_assertions)]
            pointer_stability: core::sync::atomic::AtomicBool::new(false),
        }
    }

    pub fn with_capacity(n: usize) -> Self {
        let mut m = Self::new();
        m.reserve(n);
        m
    }
}

impl<K, V, C, A: MapAllocator> ArrayHashMap<K, V, C, A> {
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
    /// `None` when empty. O(1); patches the index in place (Zig
    /// `removeFromIndexByIndex`) so subsequent lookups stay O(1).
    pub fn pop(&mut self) -> Option<KV<K, V>> {
        let key = self.keys.pop()?;
        // SAFETY: keys/values/hashes always share the same length.
        let value = self.values.pop().unwrap();
        let h = self.hashes.pop().unwrap();
        self.index_remove_tail(self.keys.len(), h);
        Some(KV { key, value })
    }

    /// Zig: `clearAndFree(allocator)` — drop every entry and release the
    /// backing allocations (capacity goes to zero).
    pub fn clear_and_free(&mut self) {
        self.keys = Vec::new_in(A::default());
        self.values = Vec::new_in(A::default());
        self.hashes = Vec::new_in(A::default());
        self.index = None;
    }

    pub fn ensure_total_capacity(&mut self, n: usize) -> Result<(), AllocError> {
        let need = n.saturating_sub(self.keys.len());
        self.keys.reserve(need);
        self.values.reserve(need);
        self.hashes.reserve(need);
        self.reserve_index_to_capacity();
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
    pub fn ensure_total_capacity_context<Ctx>(
        &mut self,
        n: usize,
        _ctx: Ctx,
    ) -> Result<(), AllocError> {
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
        self.reserve_index_to_capacity();
        Ok(())
    }

    /// std-HashMap-compat alias for `ensure_unused_capacity` (infallible).
    #[inline]
    pub fn reserve(&mut self, additional: usize) {
        self.keys.reserve(additional);
        self.values.reserve(additional);
        self.hashes.reserve(additional);
        self.reserve_index_to_capacity();
    }

    /// If the accelerator is already live, grow it to the current column
    /// capacity so a `reserve()` / `ensure_*_capacity()` call also right-sizes
    /// the index — keeping its SwissTable grow path off the subsequent
    /// `push_entry` loop. No-op when the index hasn't materialised yet (it will
    /// be built at the right size by [`rebuild_index`] when the map first
    /// crosses [`INDEX_THRESHOLD`], since that reads `self.keys.capacity()`).
    #[inline]
    fn reserve_index_to_capacity(&mut self) {
        let cap = self.keys.capacity();
        if let Some(index) = self.index.as_deref_mut() {
            index_reserve(index, &self.hashes, cap);
        }
    }

    /// Zig: `shrinkAndFree(new_len)` — truncate to `new_len` entries (dropping
    /// any tail) and release excess capacity. Insertion order is preserved, so
    /// no rehash of the surviving prefix is needed.
    pub fn shrink_and_free(&mut self, new_len: usize) {
        // Drop tail index slots first (Zig: removeFromIndexByIndex loop), so
        // the surviving accelerator stays valid for O(1) lookups.
        if self.index.is_some() {
            for i in new_len..self.hashes.len() {
                let h = self.hashes[i];
                self.index_remove_tail(i, h);
            }
        }
        self.keys.truncate(new_len);
        self.values.truncate(new_len);
        self.hashes.truncate(new_len);
        self.keys.shrink_to_fit();
        self.values.shrink_to_fit();
        self.hashes.shrink_to_fit();
        // Re-assert the threshold invariant: a map shrunk back below
        // `INDEX_THRESHOLD` should route lookups through the linear scan, not
        // keep a (now mostly-empty) hashbrown table alive past shrink_to_fit.
        if self.keys.len() <= INDEX_THRESHOLD {
            self.index = None;
        }
    }

    /// Debug-only: assert no in-flight `GetOrPutResult` borrows when an
    /// operation that may reallocate runs. No-op in release.
    #[inline]
    pub fn lock_pointers(&self) {
        #[cfg(debug_assertions)]
        {
            use core::sync::atomic::Ordering::Relaxed;
            debug_assert!(
                !self.pointer_stability.load(Relaxed),
                "ArrayHashMap pointers already locked",
            );
            self.pointer_stability.store(true, Relaxed);
        }
    }

    #[inline]
    pub fn unlock_pointers(&self) {
        #[cfg(debug_assertions)]
        self.pointer_stability
            .store(false, core::sync::atomic::Ordering::Relaxed);
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
        // Drop (not clear) the accelerator: post-clear `len == 0` is below
        // `INDEX_THRESHOLD`, so per the threshold invariant `self.index` must be
        // `None` — otherwise the next few `push_entry` calls would maintain a
        // hashbrown probe for a 1–8-entry map that the linear scan handles in
        // one cache line.
        self.index = None;
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
        if let Some(index) = self.index.as_deref() {
            let hashes = self.hashes.as_ptr();
            let keys = self.keys.as_ptr();
            return index
                .find(spread_hash(h), |&i| {
                    let i = i as usize;
                    // SAFETY: bounds-check elision on the hot probe path.
                    // Every `i` stored in `self.index` satisfies
                    // `i < self.hashes.len() == self.keys.len()` — it was
                    // inserted by `push_entry`/`rebuild_index` with that
                    // bound, and every path that shrinks or permutes those
                    // vecs either patches the index in place
                    // (`index_swap_remove`/`index_remove_tail`) or calls
                    // `drop_index()` first.
                    unsafe { *hashes.add(i) == h && eq(&*keys.add(i), i) }
                })
                .map(|&i| i as usize);
        }
        // Below the index threshold: hash-prefiltered linear scan.
        // `hashes.len()` ≤ 8 here, so this is a single cache line; the bounds
        // check on `keys[i]` is not worth eliding.
        for (i, &stored) in self.hashes.iter().enumerate() {
            if stored == h && eq(&self.keys[i], i) {
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
        match self.index.as_deref_mut() {
            // Route through the non-generic outlined helper so the
            // `RawTable<u32>` grow path is emitted once in this crate, not
            // re-monomorphized per `<K,V,C,A>` in every downstream CGU.
            Some(index) => index_insert_unique(index, &self.hashes, i as u32, h),
            None if i >= INDEX_THRESHOLD => self.rebuild_index(),
            None => {}
        }
        i
    }

    /// Rebuild the `hash → index` accelerator from `self.hashes`. Called when
    /// the entry count first crosses [`INDEX_THRESHOLD`]. Thin wrapper over
    /// the non-generic [`rebuild_index_from_hashes`] free fn — the body has no
    /// dependence on `K`/`V`/`C`/`A`, so keep it out of the generic impl to
    /// avoid one monomorph per instantiating crate.
    ///
    /// `#[cold]` (not `#[inline]`): this fires exactly once per map lifetime —
    /// the threshold-crossing transition — so weighting its arm in `push_entry`
    /// as unlikely keeps the hot `Some(index)` / `None => {}` arms' codegen
    /// tight and out of the boot-path `.text` working set.
    #[cold]
    fn rebuild_index(&mut self) {
        self.index = Some(rebuild_index_from_hashes(&self.hashes, self.keys.capacity()));
    }

    /// Invalidate the accelerator. Called by operations that permute entry
    /// indices wholesale (`sort`, `re_index`, bulk `set_entries_len`); paired
    /// with an immediate `rebuild_index()` when the map is past the threshold
    /// so subsequent lookups never silently fall back to O(n) linear scan.
    /// Point removals (`pop`/`swap_remove`) instead patch the index in place
    /// — see [`index_remove_tail`]/[`index_swap_remove`].
    #[inline]
    fn drop_index(&mut self) {
        self.index = None;
    }

    /// Remove the index slot pointing at `tail` (the just-popped last entry).
    /// O(1); mirrors Zig `removeFromIndexByIndex` for the `pop`/`shrink` path.
    #[inline]
    fn index_remove_tail(&mut self, tail: usize, tail_hash: u32) {
        let Some(index) = self.index.as_deref_mut() else {
            return;
        };
        if let Ok(slot) = index.find_entry(spread_hash(tail_hash), |&i| i as usize == tail) {
            slot.remove();
        }
    }

    /// Patch the index after a `Vec::swap_remove(removed)`: drop the slot for
    /// `removed`, then retarget the slot that still says `old_last` (the
    /// pre-swap tail index, == `self.keys.len()` post-swap) to `removed`.
    /// O(1); mirrors Zig `removeFromIndexByIndex` + `updateEntryIndex`.
    #[inline]
    fn index_swap_remove(&mut self, removed: usize, removed_hash: u32) {
        let Some(index) = self.index.as_deref_mut() else {
            return;
        };
        if let Ok(slot) = index.find_entry(spread_hash(removed_hash), |&i| i as usize == removed) {
            slot.remove();
        }
        let old_last = self.keys.len();
        if old_last != removed {
            // The element now at `removed` carried its hash with it.
            let moved_hash = self.hashes[removed];
            if let Some(slot) = index.find_mut(spread_hash(moved_hash), |&i| i as usize == old_last)
            {
                *slot = removed as u32;
            }
        }
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
        let had_index = self.index.is_some();
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
        if had_index {
            self.rebuild_index();
        }
    }

    fn gop_at(&mut self, index: usize, found_existing: bool) -> GetOrPutResult<'_, K, V> {
        // SAFETY: `keys` and `values` are distinct allocations; producing one
        // `&mut` into each is sound even though both derive from `&mut self`.
        // `index < self.keys.len() == self.values.len()` — every caller
        // (`get_or_put*`/`put_index`) passes the index just returned by
        // `push_entry` or `find_hash`.
        let (key_ptr, value_ptr) = unsafe {
            (
                &mut *self.keys.as_mut_ptr().add(index),
                &mut *self.values.as_mut_ptr().add(index),
            )
        };
        GetOrPutResult {
            found_existing,
            index,
            key_ptr,
            value_ptr,
        }
    }

    /// Mutable access to the entry at `index` (key + value). Returns `None` if
    /// `index >= len`. Mirrors `indexmap::IndexMap::get_index_mut`.
    pub fn get_index_mut(&mut self, index: usize) -> Option<(&mut K, &mut V)> {
        if index >= self.keys.len() {
            return None;
        }
        // `keys` and `values` are distinct struct fields; borrowck permits one
        // `&mut` into each simultaneously. Bound proven above.
        Some((&mut self.keys[index], &mut self.values[index]))
    }

    /// Zig `swapRemoveAt` — remove the entry at `index` by swapping in the last
    /// entry. O(1); does not preserve insertion order. Returns the removed pair.
    pub fn swap_remove_at(&mut self, index: usize) -> (K, V) {
        let k = self.keys.swap_remove(index);
        let v = self.values.swap_remove(index);
        let h = self.hashes.swap_remove(index);
        self.index_swap_remove(index, h);
        (k, v)
    }

    // ── adapted lookup (Zig: getAdapted / getIndexAdapted) ─────────────────

    /// Look up by `key` using `adapter` for hash/eql, without constructing a `K`.
    #[inline]
    pub fn get_index_adapted<Q: ?Sized, Ad>(&self, key: &Q, adapter: Ad) -> Option<usize>
    where
        Ad: ArrayHashAdapter<Q, K>,
    {
        let h = adapter.hash(key);
        self.find_hash(h, |k, idx| adapter.eql(key, k, idx))
    }

    #[inline]
    pub fn get_adapted<Q: ?Sized, Ad>(&self, key: &Q, adapter: Ad) -> Option<&V>
    where
        Ad: ArrayHashAdapter<Q, K>,
    {
        self.get_index_adapted(key, adapter)
            .map(|i| &self.values[i])
    }

    /// Zig `getPtrContext` / `getPtrAdapted` — mutable value lookup using an
    /// externally-supplied hash/eql adapter.
    #[inline]
    pub fn get_ptr_adapted<Q: ?Sized, Ad>(&mut self, key: &Q, adapter: Ad) -> Option<&mut V>
    where
        Ad: ArrayHashAdapter<Q, K>,
    {
        let i = self.get_index_adapted(key, adapter)?;
        Some(&mut self.values[i])
    }

    #[inline]
    pub fn contains_adapted<Q: ?Sized, Ad>(&self, key: &Q, adapter: Ad) -> bool
    where
        Ad: ArrayHashAdapter<Q, K>,
    {
        self.get_index_adapted(key, adapter).is_some()
    }
}

impl<K, V, C: ArrayHashContext<K>, A: MapAllocator> ArrayHashMap<K, V, C, A> {
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
            self.find_hash(h, |k, idx| self.ctx.eql(&key, k, idx))
                .is_none(),
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
        let Some(i) = self.get_index(key) else {
            return false;
        };
        self.swap_remove_at(i);
        true
    }

    /// Zig: `fetchSwapRemove` — swap-remove returning the removed `(K, V)` pair,
    /// or `None` if `key` was not present.
    pub fn fetch_swap_remove(&mut self, key: &K) -> Option<(K, V)> {
        let i = self.get_index(key)?;
        Some(self.swap_remove_at(i))
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
        // Ordered remove shifts every index ≥ i; rebuild rather than patching
        // each slot. Immediate rebuild keeps subsequent lookups O(1) (Zig
        // patches in place; this is the simpler-correct equivalent for the
        // rare ordered path).
        self.drop_index();
        if self.keys.len() > INDEX_THRESHOLD {
            self.rebuild_index();
        }
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
    pub fn entry(&mut self, key: K) -> MapEntry<'_, K, V, C, A> {
        let h = self.ctx.hash(&key);
        if let Some(idx) = self.find_hash(h, |k, i| self.ctx.eql(&key, k, i)) {
            MapEntry::Occupied(OccupiedEntry { map: self, idx })
        } else {
            MapEntry::Vacant(VacantEntry {
                map: self,
                key,
                hash: h,
            })
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// std-compatible Entry API
// ──────────────────────────────────────────────────────────────────────────

/// std-HashMap-compat entry. Named `MapEntry` (not `Entry`) to avoid clashing
/// with the iterator `Entry` above; re-exported as `bun_collections::hash_map::Entry`.
pub enum MapEntry<'a, K, V, C, A: MapAllocator = Global> {
    Occupied(OccupiedEntry<'a, K, V, C, A>),
    Vacant(VacantEntry<'a, K, V, C, A>),
}

pub struct OccupiedEntry<'a, K, V, C, A: MapAllocator = Global> {
    map: &'a mut ArrayHashMap<K, V, C, A>,
    idx: usize,
}

impl<'a, K, V, C, A: MapAllocator> OccupiedEntry<'a, K, V, C, A> {
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
        self.map.swap_remove_at(self.idx).1
    }
}

pub struct VacantEntry<'a, K, V, C, A: MapAllocator = Global> {
    map: &'a mut ArrayHashMap<K, V, C, A>,
    key: K,
    hash: u32,
}

impl<'a, K, V, C, A: MapAllocator> VacantEntry<'a, K, V, C, A> {
    #[inline]
    pub fn key(&self) -> &K {
        &self.key
    }
    pub fn insert(self, value: V) -> &'a mut V {
        let i = self.map.push_entry(self.key, value, self.hash);
        &mut self.map.values[i]
    }
}

impl<'a, K, V, C, A: MapAllocator> MapEntry<'a, K, V, C, A> {
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

impl<K, V: Default, C: ArrayHashContext<K>, A: MapAllocator> ArrayHashMap<K, V, C, A> {
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

impl<K: Default, V: Default, C, A: MapAllocator> ArrayHashMap<K, V, C, A> {
    /// Zig `getOrPutAdapted`: look up by `key` using `adapter` for hash/eql;
    /// on miss, append a *defaulted* `K`/`V` pair — caller fills both via
    /// `key_ptr` / `value_ptr`.
    pub fn get_or_put_adapted<Q, Ad>(
        &mut self,
        key: Q,
        adapter: Ad,
    ) -> Result<GetOrPutResult<'_, K, V>, AllocError>
    where
        Ad: ArrayHashAdapter<Q, K>,
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
    pub fn get_or_put_context_adapted<Q, Ad>(
        &mut self,
        key: Q,
        adapter: Ad,
        _ctx: C,
    ) -> Result<GetOrPutResult<'_, K, V>, AllocError>
    where
        Ad: ArrayHashAdapter<Q, K>,
    {
        self.get_or_put_adapted(key, adapter)
    }
}

impl<K, V, C, A: MapAllocator> ArrayHashMapExt for ArrayHashMap<K, V, C, A> {
    type Key = K;
    type Value = V;
    type Iterator<'a>
        = Iter<'a, K, V>
    where
        Self: 'a;
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
pub struct StringArrayHashMap<V, C = StringContext, A: MapAllocator = Global> {
    inner: ArrayHashMap<Box<[u8], A>, V, BoxedSliceContext<C>, A>,
    // The string context is consulted for hash/eql on `[u8]` borrows. The inner
    // map's context is `BoxedSliceContext<C>` (NOT `AutoContext`) so methods
    // reached via `Deref` hash identically to the `&[u8]` paths above.
    ctx: C,
}

/// Windows env-var map (`src/bun.zig` `CaseInsensitiveASCIIStringArrayHashMap`).
pub type CaseInsensitiveAsciiStringArrayHashMap<V> =
    StringArrayHashMap<V, CaseInsensitiveAsciiStringContext>;

impl<V, C: Default, A: MapAllocator> Default for StringArrayHashMap<V, C, A> {
    fn default() -> Self {
        Self {
            inner: ArrayHashMap::new(),
            ctx: C::default(),
        }
    }
}

impl<V: Clone, C: Default, A: MapAllocator> StringArrayHashMap<V, C, A> {
    /// Zig `clone()` is fallible (OOM); kept as `Result` for API parity.
    pub fn clone(&self) -> Result<Self, AllocError> {
        Ok(Self {
            inner: self.inner.clone()?,
            ctx: C::default(),
        })
    }
}

impl<V, C, A: MapAllocator> Deref for StringArrayHashMap<V, C, A> {
    type Target = ArrayHashMap<Box<[u8], A>, V, BoxedSliceContext<C>, A>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<V, C, A: MapAllocator> DerefMut for StringArrayHashMap<V, C, A> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl<V, C: ArrayHashContext<[u8]> + Default, A: MapAllocator> StringArrayHashMap<V, C, A> {
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
            self.inner.push_entry(box_key::<A>(key), value, h);
            None
        }
    }

    pub fn put(&mut self, key: &[u8], value: V) -> Result<(), AllocError> {
        let h = self.ctx.hash(key);
        if let Some(i) = self.inner.find_hash(h, |k, idx| self.ctx.eql(key, k, idx)) {
            self.inner.values[i] = value;
        } else {
            self.inner.push_entry(box_key::<A>(key), value, h);
        }
        Ok(())
    }

    pub fn put_assume_capacity(&mut self, key: &[u8], value: V) {
        let _ = self.put(key, value);
    }

    pub fn swap_remove(&mut self, key: &[u8]) -> bool {
        let Some(i) = self.find(key) else {
            return false;
        };
        self.inner.swap_remove_at(i);
        true
    }

    /// Zig: `StringArrayHashMap.fetchSwapRemove` — removes the entry (swapping
    /// the last element into its slot) and returns the owned key/value pair.
    pub fn fetch_swap_remove(&mut self, key: &[u8]) -> Option<KV<Box<[u8], A>, V>> {
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

impl<V: Default, C: ArrayHashContext<[u8]> + Default, A: MapAllocator> StringArrayHashMap<V, C, A> {
    /// See `ArrayHashMap::get_or_put`. The key is boxed on insert; callers that
    /// then write `*gop.key_ptr = Box::from(key)` are doing a redundant alloc —
    /// harmless, and lets the Zig-shaped call sites compile unchanged.
    pub fn get_or_put(
        &mut self,
        key: &[u8],
    ) -> Result<GetOrPutResult<'_, Box<[u8], A>, V>, AllocError> {
        let h = self.ctx.hash(key);
        if let Some(i) = self.inner.find_hash(h, |k, idx| self.ctx.eql(key, k, idx)) {
            return Ok(self.inner.gop_at(i, true));
        }
        let i = self.inner.push_entry(box_key::<A>(key), V::default(), h);
        Ok(self.inner.gop_at(i, false))
    }

    pub fn get_or_put_value(
        &mut self,
        key: &[u8],
        value: V,
    ) -> Result<GetOrPutResult<'_, Box<[u8], A>, V>, AllocError> {
        let h = self.ctx.hash(key);
        if let Some(i) = self.inner.find_hash(h, |k, idx| self.ctx.eql(key, k, idx)) {
            return Ok(self.inner.gop_at(i, true));
        }
        let i = self.inner.push_entry(box_key::<A>(key), value, h);
        Ok(self.inner.gop_at(i, false))
    }
}

impl<V, C, A: MapAllocator> ArrayHashMapExt for StringArrayHashMap<V, C, A> {
    type Key = Box<[u8], A>;
    type Value = V;
    type Iterator<'a>
        = Iter<'a, Box<[u8], A>, V>
    where
        Self: 'a;
    fn iterator(&mut self) -> Iter<'_, Box<[u8], A>, V> {
        self.inner.iterator()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StringHashMap<V, A> — unordered `[]const u8`-keyed map
// ──────────────────────────────────────────────────────────────────────────

/// `std.StringHashMap(V)`. Thin newtype over `hashbrown::HashMap` that adds
/// the Zig `getOrPut` / `getOrPutValue` entry points while keeping the
/// `hashbrown` surface (`.get`, `.contains_key`, `.reserve`, `.insert`, …)
/// reachable via `Deref`.
///
/// Allocator-generic so AST containers (`Scope::members` &c.) can route both
/// the table *and* the owned-key boxes through `bun_alloc::AstAlloc`,
/// matching Zig's `Unmanaged` semantics where the map's backing store lives
/// in the same arena as the AST nodes that hold it. The `A = Global` default
/// keeps every existing `StringHashMap<V>` site source-compatible.
// Hashed with seed-0 wyhash (matches Zig's `std.hash_map.StringContext`) —
// deterministic across runs and ~3-5× faster than `RandomState`/SipHash on
// the short identifier keys the parser/printer/renamer churn.
//
// The `A: Default` bound is the substitute for Zig's per-call `Allocator`
// parameter: hashbrown's `HashMap<_, _, _, A>` stores the allocator by value,
// and every key `Box<[u8], A>` needs its own `A` too. For zero-sized
// allocators (`Global`, `AstAlloc`) `A::default()` is a no-op constant; if a
// stateful allocator is ever needed, add `*_in(alloc: A)` constructors and
// loosen the bound there.
#[derive(Clone)]
pub struct StringHashMap<V, A: Allocator + HashbrownAllocator + Clone + Default = DefaultAlloc> {
    inner: hashbrown::HashMap<StringHashMapKey<A>, V, bun_wyhash::BuildHasher, A>,
}

/// Public alias for the underlying `hashbrown` map so downstream signatures
/// (and `Deref::Target`) don't repeat the four-argument spelling.
pub type StringHashMapInner<V, A = DefaultAlloc> =
    hashbrown::HashMap<StringHashMapKey<A>, V, bun_wyhash::BuildHasher, A>;

/// Key stored in `StringHashMap`. Either an owned heap copy (`Owned`, the
/// default produced by `put`/`get_or_put`) or a borrowed `&'static [u8]`
/// (`Static`, produced by `put_static_key`).
///
/// Zig's `std.StringHashMap` always *borrows* the caller's `[]const u8` key —
/// the map never copies it. The Rust port originally heap-boxed every key on
/// `put` for safety, which profiling showed as the dominant cost of
/// `DirEntry::add_entry` (the resolver's per-file hot path): the key bytes
/// there already live in the process-static `FilenameStore`/`EntryStore`, so
/// the `Box<[u8]>` was a redundant second copy. The `Static` variant lets such
/// callers store the existing slice directly, matching Zig's zero-copy
/// behaviour without giving up owned-key safety for everyone else.
///
/// `Deref<Target = [u8]>` + `Borrow<[u8]>` keep `.get(&[u8])`,
/// `.contains_key(&[u8])`, and `&**key` working unchanged at every call site,
/// so this is a drop-in replacement for the previous `Box<[u8], A>` alias.
///
/// ## Layout
/// Packed `(ptr, len | OWNED_BIT)` instead of a 2-variant enum. The enum had
/// no usable niche (both `Box<[u8]>` and `&[u8]` start with a non-null
/// pointer), so it was 24 B; folding the owned/borrowed discriminant into the
/// top bit of `len` brings it to 16 B — same as Zig's `[]const u8`. For
/// `Scope::members` (`hashbrown::RawTable<(StringHashMapKey, Member)>`) that
/// shrinks the stored tuple 40 B → 32 B, cutting the module-scope table's
/// page footprint (and `reserve_rehash` `memcpy` traffic) by ~20 %.
pub struct StringHashMapKey<A: Allocator + Default = DefaultAlloc> {
    /// First byte of the key. Never null — empty borrowed keys use the slice's
    /// own (dangling-but-non-null) pointer; empty owned keys use whatever
    /// `Box::<[u8], A>::into_raw` returned, which round-trips through
    /// `Box::from_raw_in` in `Drop`.
    ptr: core::ptr::NonNull<u8>,
    /// Low `usize::BITS - 1` bits: byte length. Top bit: set ⇔ owned (heap
    /// allocation made via `A`, freed in `Drop`); clear ⇔ borrowed (`'static`
    /// or arena-lifetime, never freed). Slices cannot exceed `isize::MAX`
    /// bytes, so the top bit is always free.
    len_tag: usize,
    _alloc: PhantomData<Box<[u8], A>>,
}

const SHMK_OWNED_BIT: usize = 1 << (usize::BITS - 1);

// Compile-time check: with a ZST allocator the key is exactly two words.
const _: () = assert!(
    core::mem::size_of::<StringHashMapKey<DefaultAlloc>>() == 2 * core::mem::size_of::<usize>()
);

// `NonNull<u8>` is `!Send`/`!Sync`; restore the auto-traits the enum had
// (both payloads were `Send + Sync` for any sendable/syncable `A`).
unsafe impl<A: Allocator + Default + Send> Send for StringHashMapKey<A> {}
unsafe impl<A: Allocator + Default + Sync> Sync for StringHashMapKey<A> {}

impl<A: Allocator + Default> StringHashMapKey<A> {
    #[inline(always)]
    const fn packed_len(&self) -> usize {
        self.len_tag & !SHMK_OWNED_BIT
    }

    #[inline(always)]
    const fn is_owned(&self) -> bool {
        self.len_tag & SHMK_OWNED_BIT != 0
    }

    /// Borrowed-key constructor (previously the `Static` variant). Stores the
    /// slice by reference; never freed on drop.
    #[inline]
    pub const fn borrowed(s: &'static [u8]) -> Self {
        // `&[u8]`'s pointer is always non-null (dangling for `len == 0`).
        // SAFETY: `as_ptr()` on a slice reference is never null.
        let ptr = unsafe { core::ptr::NonNull::new_unchecked(s.as_ptr() as *mut u8) };
        Self {
            ptr,
            len_tag: s.len(),
            _alloc: PhantomData,
        }
    }

    /// Owned-key constructor (previously the `Owned` variant). Takes ownership
    /// of `b`'s allocation; freed via `A::default()` on drop.
    #[inline]
    pub fn owned(b: Box<[u8], A>) -> Self {
        let len = b.len();
        debug_assert!(
            len & SHMK_OWNED_BIT == 0,
            "slice len cannot exceed isize::MAX"
        );
        // Discard the stored `A` — for every `A` in use (`Global`,
        // `DefaultAlloc`, `AstAlloc`) it is a ZST, so `A::default()` in `Drop`
        // is the same instance. `into_raw_with_allocator` because on current
        // nightly `Box::into_raw` is restricted to `Box<T, Global>`.
        let (raw, _alloc) = Box::into_raw_with_allocator(b);
        // SAFETY: `Box::into_raw_with_allocator` never returns null.
        let ptr = unsafe { core::ptr::NonNull::new_unchecked(raw.cast::<u8>()) };
        Self {
            ptr,
            len_tag: len | SHMK_OWNED_BIT,
            _alloc: PhantomData,
        }
    }
}

impl<A: Allocator + Default> Drop for StringHashMapKey<A> {
    #[inline]
    fn drop(&mut self) {
        if self.is_owned() {
            let len = self.packed_len();
            // SAFETY: `ptr`/`len` were produced by `Box::<[u8], A>::into_raw`
            // in `owned()`; reconstituting and dropping is the documented
            // round-trip. `A::default()` is sound for the ZST allocators in
            // use (see `owned()`).
            unsafe {
                let slice = core::ptr::slice_from_raw_parts_mut(self.ptr.as_ptr(), len);
                drop(Box::<[u8], A>::from_raw_in(slice, A::default()));
            }
        }
    }
}

impl<A: Allocator + Default> Deref for StringHashMapKey<A> {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        // SAFETY: `ptr` points at `packed_len()` initialised bytes for the
        // lifetime of `self` — either a `'static`/arena slice (borrowed) or a
        // live `Box<[u8], A>` allocation (owned, freed only in `Drop`).
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.packed_len()) }
    }
}

impl<A: Allocator + Default> core::borrow::Borrow<[u8]> for StringHashMapKey<A> {
    #[inline]
    fn borrow(&self) -> &[u8] {
        self
    }
}

impl<A: Allocator + Default> AsRef<[u8]> for StringHashMapKey<A> {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        self
    }
}

impl<A: Allocator + Default> Hash for StringHashMapKey<A> {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        // Must match `<[u8] as Hash>` so `Borrow<[u8]>`-keyed lookups agree.
        (**self).hash(state)
    }
}

impl<A: Allocator + Default> PartialEq for StringHashMapKey<A> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        **self == **other
    }
}
impl<A: Allocator + Default> Eq for StringHashMapKey<A> {}

impl<A: Allocator + Default> Clone for StringHashMapKey<A> {
    #[inline]
    fn clone(&self) -> Self {
        if self.is_owned() {
            // Re-box via `A` so the clone owns an independent allocation.
            Self::owned(box_key::<A>(self))
        } else {
            // Borrowed: copy the (ptr, len) pair; nothing to free on drop.
            Self {
                ptr: self.ptr,
                len_tag: self.len_tag,
                _alloc: PhantomData,
            }
        }
    }
}

impl<A: Allocator + Default> From<Box<[u8], A>> for StringHashMapKey<A> {
    #[inline]
    fn from(b: Box<[u8], A>) -> Self {
        Self::owned(b)
    }
}

impl<A: Allocator + Default> From<&'static [u8]> for StringHashMapKey<A> {
    /// Zero-copy: the slice is stored by reference. This is the conversion
    /// `hashbrown::VacantEntryRef::insert` calls on miss in the
    /// [`StringHashMap::put_borrowed`] / [`StringHashMap::get_or_put_borrowed`]
    /// fast paths, so it must NOT allocate (the `'static` here is the
    /// caller-asserted lifetime erasure, not a literal program-lifetime
    /// requirement — see those methods' safety docs).
    #[inline]
    fn from(s: &'static [u8]) -> Self {
        Self::borrowed(s)
    }
}

impl<V, A: Allocator + HashbrownAllocator + Clone + Default> Default for StringHashMap<V, A> {
    fn default() -> Self {
        Self {
            inner: hashbrown::HashMap::with_hasher_in(
                bun_wyhash::BuildHasher::default(),
                A::default(),
            ),
        }
    }
}

impl<V, A: Allocator + HashbrownAllocator + Clone + Default> Deref for StringHashMap<V, A> {
    type Target = StringHashMapInner<V, A>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<V, A: Allocator + HashbrownAllocator + Clone + Default> DerefMut for StringHashMap<V, A> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

/// Clone `key` into a `Box<[u8], A>` using `A::default()`. The previous
/// `Box::from(key)` spelling is `Global`-only; this is the allocator-generic
/// equivalent. For `AstAlloc` the buffer lands in the thread-local AST
/// `mi_heap` so the key is reclaimed by the same `mi_heap_destroy` that frees
/// the table and the AST node holding the map.
#[inline]
fn box_key<A: Allocator + Default>(key: &[u8]) -> Box<[u8], A> {
    let mut v = Vec::with_capacity_in(key.len(), A::default());
    v.extend_from_slice(key);
    v.into_boxed_slice()
}

/// `box_key` wrapped in the `StringHashMap` key enum. Kept separate from
/// `box_key` because `StringArrayHashMap` (which still stores plain
/// `Box<[u8], A>` keys) shares the bare helper.
#[inline]
fn owned_key<A: Allocator + Default>(key: &[u8]) -> StringHashMapKey<A> {
    StringHashMapKey::owned(box_key::<A>(key))
}

impl<V, A: Allocator + HashbrownAllocator + Clone + Default> StringHashMap<V, A> {
    /// `const` constructor — empty map, no heap touch. Exists so aggregates
    /// that embed a `StringHashMap` (e.g. `js_ast::Scope::EMPTY`) can be
    /// spelled as a `const` and used with struct-update syntax in hot
    /// allocation paths, instead of calling the `Default` chain at runtime
    /// for every field. `hashbrown::HashMap::with_hasher_in` and
    /// `BuildHasherDefault::new` are both `const fn`, so this is a true
    /// compile-time value (all-zeros for ZST `A`).
    #[inline]
    pub const fn new_in(alloc: A) -> Self {
        Self {
            inner: hashbrown::HashMap::with_hasher_in(core::hash::BuildHasherDefault::new(), alloc),
        }
    }
}

impl<V, A: Allocator + HashbrownAllocator + Clone + Default> StringHashMap<V, A> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_capacity(n: usize) -> Self {
        Self {
            inner: hashbrown::HashMap::with_capacity_and_hasher_in(
                n,
                bun_wyhash::BuildHasher::default(),
                A::default(),
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
    pub fn values(&self) -> hashbrown::hash_map::Values<'_, StringHashMapKey<A>, V> {
        self.inner.values()
    }

    #[inline]
    pub fn values_mut(&mut self) -> hashbrown::hash_map::ValuesMut<'_, StringHashMapKey<A>, V> {
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
        self.inner.insert(owned_key::<A>(key), value);
        Ok(())
    }

    /// Insert `value` under `key` **without copying the key bytes**. This is
    /// the zero-copy path that matches Zig's `StringHashMap.put` (which always
    /// borrows). `key` is stored as `StringHashMapKey::Static`, so the caller
    /// must guarantee the bytes genuinely live for `'static` — in practice
    /// that means slices into a process-lifetime arena (`FilenameStore`,
    /// `EntryStore`, AST heap) where the `'static` was minted via an explicit
    /// `unsafe` lifetime widen at the call site.
    #[inline]
    pub fn put_static_key(&mut self, key: &'static [u8], value: V) -> Result<(), AllocError> {
        self.inner.insert(StringHashMapKey::borrowed(key), value);
        Ok(())
    }

    /// The hash this map's `BuildHasher` assigns `key` — exactly what
    /// `get`/`insert`/&c. compute internally for a `[u8]` lookup. Exposed
    /// so a caller that already has the key bytes in hand (and will probe *and*
    /// then insert the same key) can hash once and feed the result to
    /// [`get_hashed`] / [`put_static_key_hashed`] instead of re-deriving it on
    /// each call. The resolver's `DirEntry::add_entry` does precisely this: one
    /// case-insensitive probe against the previous-generation directory map,
    /// one insert into the new one, same (lowercased) basename bytes.
    #[inline]
    pub fn hash_key(&self, key: &[u8]) -> u64 {
        use core::hash::{BuildHasher, Hash, Hasher};
        let mut state = self.inner.hasher().build_hasher();
        key.hash(&mut state);
        state.finish()
    }

    /// `get` with a caller-supplied hash. `hash` MUST equal `self.hash_key(key)`
    /// — the probe trusts it without recomputing (`hashbrown`'s `*_nocheck`).
    #[inline]
    pub fn get_hashed(&self, hash: u64, key: &[u8]) -> Option<&V> {
        self.inner
            .raw_entry()
            .from_key_hashed_nocheck(hash, key)
            .map(|(_, v)| v)
    }

    /// [`put_static_key`] with a caller-supplied hash. `hash` MUST equal
    /// `self.hash_key(key)` (see [`hash_key`]); the insert trusts it without
    /// recomputing. Same zero-copy / `'static`-key contract as [`put_static_key`]:
    /// overwrites the value if the key is already present.
    #[inline]
    pub fn put_static_key_hashed(
        &mut self,
        hash: u64,
        key: &'static [u8],
        value: V,
    ) -> Result<(), AllocError> {
        use hashbrown::hash_map::RawEntryMut;
        match self.inner.raw_entry_mut().from_key_hashed_nocheck(hash, key) {
            RawEntryMut::Occupied(mut e) => {
                e.insert(value);
            }
            RawEntryMut::Vacant(e) => {
                e.insert_hashed_nocheck(hash, StringHashMapKey::borrowed(key), value);
            }
        }
        Ok(())
    }

    /// Insert `value` under `key` **without copying the key bytes** — the
    /// arena-lifetime twin of [`put_static_key`]. Zig's
    /// `StringHashMapUnmanaged.put` stores the caller's `[]const u8` slice by
    /// value; the safe Rust [`put`] heap-boxes it instead, which profiling
    /// flagged as the dominant `_mi_malloc_generic` caller in the parser
    /// (`Scope::members` takes one box per declared identifier per scope).
    /// This entry point restores the Zig zero-copy behaviour for callers whose
    /// key bytes already live in an arena that outlives the map.
    ///
    /// # Safety
    /// The bytes behind `key` must remain alive and unmoved for as long as the
    /// resulting entry stays in `self` (i.e. until the entry is removed or the
    /// map is dropped/reset). For the parser this is satisfied because keys
    /// point into source text or the lexer string-table, both of which outlive
    /// the `AstAlloc` arena that owns the `Scope` holding this map.
    #[inline]
    pub unsafe fn put_borrowed(&mut self, key: &[u8], value: V) -> Result<(), AllocError> {
        // SAFETY: caller contract above. Erase the borrow's lifetime so it can
        // be stored as `Static` without a heap copy; the map never inspects the
        // lifetime, only the (ptr, len) pair.
        let key: &'static [u8] = unsafe { &*(key as *const [u8]) };
        self.inner.insert(StringHashMapKey::borrowed(key), value);
        Ok(())
    }

    /// Insert a pre-boxed key without re-allocating it. Uses `try_reserve` so
    /// OOM surfaces as `Err` instead of aborting (matches Zig `put` returning
    /// `error.OutOfMemory`); callers can roll back side effects on failure.
    pub fn put_owned(&mut self, key: Box<[u8], A>, value: V) -> Result<(), AllocError> {
        self.inner.try_reserve(1).map_err(|_| AllocError)?;
        self.inner.insert(StringHashMapKey::owned(key), value);
        Ok(())
    }

    /// PERF(port): Zig skips the grow check; std::HashMap cannot, so this is
    /// just `put` without the `Result`.
    #[inline]
    pub fn put_assume_capacity(&mut self, key: &[u8], value: V) {
        self.inner.insert(owned_key::<A>(key), value);
    }

    /// Zig `putNoClobber` — asserts the key was not already present.
    pub fn put_no_clobber(&mut self, key: &[u8], value: V) -> Result<(), AllocError> {
        let prev = self.inner.insert(owned_key::<A>(key), value);
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
    pub fn get_adapted<C>(&self, key: &[u8], _adapter: &C) -> Option<&V> {
        self.inner.get(key)
    }

    /// See `get_adapted` for the PERF(port) caveat.
    #[inline]
    pub fn contains_adapted<C>(&self, key: &[u8], _adapter: &C) -> bool {
        self.inner.contains_key(key)
    }
}

/// `StringHashMap::get_or_put` result — `std::HashMap` cannot hand out
/// `&mut K`, so this result omits `key_ptr` (unlike `GetOrPutResult` for the
/// array-backed maps). Callers that need to overwrite the stored key must use
/// `StringArrayHashMap` instead.
pub use crate::hash_map::GetOrPutResult as StringHashMapGetOrPut;

impl<V: Default, A: Allocator + HashbrownAllocator + Clone + Default> StringHashMap<V, A> {
    /// PERF(port): the previous shape (`contains_key` + `entry(Box::from(key))`)
    /// hashed `key` twice and unconditionally heap-allocated the `Box` even on
    /// hit. `Scope::members` calls this once per declared identifier during
    /// parse, so on three.js that was ~thousands of redundant `Box`
    /// allocations + double-hashes per file. Route through a single `entry()`
    /// match; the `Box` is still allocated upfront (std `HashMap::entry`
    /// requires the owned key) but on hit it is dropped without a second
    /// probe. Full prehash reuse needs a `raw_entry`-style API — tracked in
    /// the `get_adapted` PERF note above.
    pub fn get_or_put(&mut self, key: &[u8]) -> Result<StringHashMapGetOrPut<'_, V>, AllocError> {
        Ok(self.get_or_put_context_adapted(key, ()))
    }

    pub fn get_or_put_value(&mut self, key: &[u8], value: V) -> Result<&mut V, AllocError> {
        Ok(self.inner.entry(owned_key::<A>(key)).or_insert(value))
    }

    /// Zig `getOrPutContextAdapted` on `StringHashMap` — see `get_adapted` for
    /// why the adapter's precomputed hash is currently ignored.
    pub fn get_or_put_context_adapted<C>(
        &mut self,
        key: &[u8],
        _adapter: C,
    ) -> StringHashMapGetOrPut<'_, V> {
        use hashbrown::hash_map::Entry as HbEntry;
        match self.inner.entry(owned_key::<A>(key)) {
            HbEntry::Occupied(o) => StringHashMapGetOrPut {
                found_existing: true,
                value_ptr: o.into_mut(),
            },
            HbEntry::Vacant(v) => StringHashMapGetOrPut {
                found_existing: false,
                value_ptr: v.insert(V::default()),
            },
        }
    }

    /// Zero-allocation `getOrPut` — the arena-lifetime twin of
    /// [`get_or_put`]/[`get_or_put_context_adapted`]. Looks up `key` and on
    /// miss inserts `V::default()` keyed by the **borrowed slice itself** (no
    /// `box_key`). Single hash + single probe via `hashbrown`'s `entry_ref`;
    /// the `From<&'static [u8]>` impl above is what `VacantEntryRef::insert`
    /// uses to turn the lifetime-erased slice into a `Static` key.
    ///
    /// This is the hot path for `Scope::members` (one call per declared
    /// identifier in `declare_symbol_maybe_generated` / scope hoisting), where
    /// the previous owning shape was the parser's single largest
    /// `mi_heap_malloc` source.
    ///
    /// # Safety
    /// Same contract as [`put_borrowed`]: the bytes behind `key` must outlive
    /// the entry's residency in `self`.
    #[inline]
    pub unsafe fn get_or_put_borrowed(&mut self, key: &[u8]) -> StringHashMapGetOrPut<'_, V> {
        use hashbrown::hash_map::EntryRef;
        // SAFETY: caller contract above; see `put_borrowed`.
        let key: &'static [u8] = unsafe { &*(key as *const [u8]) };
        match self.inner.entry_ref(key) {
            EntryRef::Occupied(o) => StringHashMapGetOrPut {
                found_existing: true,
                value_ptr: o.into_mut(),
            },
            EntryRef::Vacant(v) => StringHashMapGetOrPut {
                found_existing: false,
                value_ptr: v.insert(V::default()),
            },
        }
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
    pub fn eql(a: &[u8], b: &[u8]) -> bool {
        a == b
    }
    /// Precompute the hash of `input` so repeated lookups across many maps
    /// can skip rehashing. Returns a `Prehashed` adapter.
    #[inline]
    pub fn pre(input: &[u8]) -> super::string_hash_map::Prehashed<'_> {
        super::string_hash_map::Prehashed {
            value: bun_wyhash::hash(input),
            input,
        }
    }

    pub use super::string_hash_map::{Prehashed, PrehashedCaseInsensitive, hash};
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
            Self {
                value: hash(input),
                input,
            }
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
            bun_core::strings::copy_lowercase(input, &mut out);
            Self {
                value: hash(&out),
                input: out,
            }
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
            bun_core::strings::eql_case_insensitive_ascii_check_length(a, b)
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
        Ok(Self {
            map: self.map.clone()?,
        })
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
        Self {
            hash: bun_wyhash::hash(s),
            len: s.len(),
        }
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
