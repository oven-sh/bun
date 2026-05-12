//! bun_collections — crate root.
//! Thin re-export hub mirroring `src/collections/collections.zig`.

#![feature(
    type_info,
    adt_const_params,
    unsized_const_params,
    const_cmp,
    const_trait_impl,
    core_intrinsics,
    allocator_api
)]
#![allow(incomplete_features, internal_features)]
#![allow(unused, non_snake_case, clippy::all)]
#![warn(unused_must_use, unreachable_pub)]

extern crate self as bun_collections;

pub mod hive_array;
pub mod multi_array_list;
pub mod vec_ext;
// `bounded_array` moved down to `bun_core` (cycle-break for the
// `bun_string → bun_core` merge — `bun_core::string::immutable` needs it).
// Re-exported here unchanged so existing `bun_collections::BoundedArray` /
// `bun_collections::bounded_array::*` paths keep resolving.
pub use bun_core::bounded_array;
pub mod identity_context;
pub mod linear_fifo;

// TODO(b2-large): heavy nightly-feature usage (adt_const_params for enum-typed
// const generics, generic_const_exprs, inherent assoc types). Rewrite to
// stable: enum const params → const usize/bool, inherent assoc → free aliases.
pub mod bit_set;
pub mod pool;
pub use pool::{ObjectPool, ObjectPoolTrait, ObjectPoolType, PoolGuard};
pub mod comptime_string_map;
pub use comptime_string_map::{ComptimeStringMap, ComptimeStringMapWithKeyType};
#[path = "StaticHashMap.rs"]
pub mod static_hash_map;
pub use static_hash_map::StaticHashMap;

pub use bounded_array::BoundedArray;
pub use hive_array::{Fallback as HiveArrayFallback, HiveArray, HiveRef, HiveSlot};
pub use linear_fifo::{LinearFifo, LinearFifoBufferType};
pub use multi_array_list::MultiArrayList;
#[doc(hidden)]
pub use paste::paste as __mal_paste;
pub use vec_ext::{ByteVecExt, OffsetByteList, VecExt, prepend_from};

pub use bit_set::{
    AutoBitSet, DynamicBitSet, DynamicBitSetList, DynamicBitSetUnmanaged, IntegerBitSet,
    StaticBitSet,
};

// Re-export for back-compat (`bun_jsc::host_fn`, `multi_array_list` import
// from here); canonical impl lives in `bun_core::strings`.
pub use bun_core::strings::{const_bytes_eq, const_str_eq};

/// `bun.bit_set` namespace alias (Zig: `bun.bit_set.List`).
pub mod dynamic_bit_set {
    pub use super::bit_set::DynamicBitSet;
    pub use super::bit_set::DynamicBitSetList as List;
}

// ──────────────────────────────────────────────────────────────────────────
// `PriorityQueue` — port of `std.PriorityQueue(T, Context, lessThan)`.
// Min-heap backed by a `Vec<T>`; the comparator context is held by value so
// callers can rebind it (Zig stores `context: Context` directly on the queue).
// ──────────────────────────────────────────────────────────────────────────
pub trait PriorityCompare<T> {
    fn compare(&self, a: &T, b: &T) -> core::cmp::Ordering;
}
pub struct PriorityQueue<T, C> {
    pub items: Vec<T>,
    pub context: C,
}
impl<T, C: Default> Default for PriorityQueue<T, C> {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            context: C::default(),
        }
    }
}
impl<T, C> PriorityQueue<T, C> {
    pub fn init(context: C) -> Self {
        Self {
            items: Vec::new(),
            context,
        }
    }
    #[inline]
    pub fn count(&self) -> usize {
        self.items.len()
    }
    #[inline]
    pub fn len(&self) -> usize {
        self.items.len()
    }
    pub fn deinit(&mut self) {
        self.items.clear();
    }
}
impl<T: Copy, C: PriorityCompare<T>> PriorityQueue<T, C> {
    /// Zig: `add(elem) !void` — push and sift-up.
    pub fn add(&mut self, elem: T) -> Result<(), bun_alloc::AllocError> {
        self.items.push(elem);
        let mut child = self.items.len() - 1;
        while child > 0 {
            let parent = (child - 1) / 2;
            if self
                .context
                .compare(&self.items[child], &self.items[parent])
                == core::cmp::Ordering::Less
            {
                self.items.swap(child, parent);
                child = parent;
            } else {
                break;
            }
        }
        Ok(())
    }
    /// Zig: `removeOrNull()` — pop min, sift-down; `None` when empty.
    pub fn remove_or_null(&mut self) -> Option<T> {
        if self.items.is_empty() {
            return None;
        }
        let last = self.items.len() - 1;
        self.items.swap(0, last);
        let out = self.items.pop();
        // sift-down
        let len = self.items.len();
        let mut idx = 0usize;
        loop {
            let l = 2 * idx + 1;
            let r = 2 * idx + 2;
            let mut smallest = idx;
            if l < len
                && self.context.compare(&self.items[l], &self.items[smallest])
                    == core::cmp::Ordering::Less
            {
                smallest = l;
            }
            if r < len
                && self.context.compare(&self.items[r], &self.items[smallest])
                    == core::cmp::Ordering::Less
            {
                smallest = r;
            }
            if smallest == idx {
                break;
            }
            self.items.swap(idx, smallest);
            idx = smallest;
        }
        out
    }
}
pub use identity_context::{
    ArrayIdentityContext, ArrayIdentityContextU64, IdentityContext, IdentityHash, U64,
};

pub mod array_hash_map;
pub use array_hash_map::{
    ArrayHashMap, ArrayHashMapExt, CaseInsensitiveAsciiPrehashed,
    CaseInsensitiveAsciiStringArrayHashMap, CaseInsensitiveAsciiStringContext, Entry,
    GetOrPutResult, MapEntry, OccupiedEntry, StringArrayHashMap, StringHashMap,
    StringHashMapContext, StringHashMapInner, StringHashMapKey, StringHashMapUnownedKey, StringSet,
    VacantEntry, string_hash_map,
};
/// Downstream crates name hashbrown's iterator/entry types in struct fields
/// (e.g. `bun_resolver::DirEntryDirIter`). `StringHashMap` `Deref`s to a
/// `hashbrown::HashMap`, so those iterators are the API surface; re-export
/// the crate so callers don't grow their own direct dep just to spell the
/// type. (A type alias per iterator would work too, but every `.iter()` /
/// `.values()` / `.entry()` returns a distinct hashbrown type — re-exporting
/// the crate is the smaller surface.)
pub use hashbrown;
/// Explicit-context alias; `ArrayHashMap<K, V>` already has `C = AutoContext`
/// as a default, this just gives the three-param spelling a distinct name.
pub type ArrayHashMapWithContext<K, V, C> = ArrayHashMap<K, V, C>;

pub mod string_map;
pub use string_map::StringMap;

// Re-export from bun_ptr so callers can name it as `bun_collections::TaggedPtrUnion`
// (PORTING.md groups it under Collections; the impl lives in src/ptr/).
pub use bun_ptr::tagged_pointer::{TaggedPtr as TaggedPointer, TaggedPtrUnion};
// Lifetime-erasure helpers (RUST_PATTERNS.md §6/§18) — re-exported here so
// crates that already depend on `bun_collections` (logger, css, js_parser,
// crash_handler, watcher, http_types) can route the borrowck-dodge through
// one centralised `unsafe fn` instead of open-coding the lifetime cast.
pub use bun_ptr::{RawSlice, detach_lifetime, detach_ref};

// ──────────────────────────────────────────────────────────────────────────
// SmallList — `bun.SmallList(T, N)` (Zig: src/css/small_list.zig).
//
// Thin `#[repr(transparent)]` newtype over `smallvec::SmallVec<[T; N]>` that
// preserves the Zig-named API surface (`append`, `slice`, `at`, `len()->u32`,
// `init_capacity`, …) so the ~300 CSS-parser call sites stay untouched.
// Replaces the bespoke ~800-line `Data`/`HeapData` union + raw-ptr container
// that previously lived in `bun_css::small_list` (which was itself a port of
// servo/rust-smallvec — this closes the loop back onto the upstream crate).
//
// `const_generics` feature is required so `[T; N]` satisfies `smallvec::Array`
// for an arbitrary `const N: usize` (callers use N ∈ {1,2,3,4,5,6}).
// ──────────────────────────────────────────────────────────────────────────

pub use smallvec;

#[repr(transparent)]
pub struct SmallList<T, const N: usize>(pub smallvec::SmallVec<[T; N]>);

impl<T, const N: usize> Default for SmallList<T, N> {
    #[inline]
    fn default() -> Self {
        Self(smallvec::SmallVec::new())
    }
}
impl<T: Clone, const N: usize> Clone for SmallList<T, N> {
    #[inline]
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}
impl<T: PartialEq, const N: usize> PartialEq for SmallList<T, N> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}
impl<T: Eq, const N: usize> Eq for SmallList<T, N> {}
impl<T: core::fmt::Debug, const N: usize> core::fmt::Debug for SmallList<T, N> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.0.fmt(f)
    }
}

impl<T, const N: usize> core::ops::Deref for SmallList<T, N> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        self.0.as_slice()
    }
}
impl<T, const N: usize> core::ops::DerefMut for SmallList<T, N> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [T] {
        self.0.as_mut_slice()
    }
}

impl<T, const N: usize> IntoIterator for SmallList<T, N> {
    type Item = T;
    type IntoIter = smallvec::IntoIter<[T; N]>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}
impl<'a, T, const N: usize> IntoIterator for &'a SmallList<T, N> {
    type Item = &'a T;
    type IntoIter = core::slice::Iter<'a, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}
impl<'a, T, const N: usize> IntoIterator for &'a mut SmallList<T, N> {
    type Item = &'a mut T;
    type IntoIter = core::slice::IterMut<'a, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.0.iter_mut()
    }
}
impl<T, const N: usize> FromIterator<T> for SmallList<T, N> {
    #[inline]
    fn from_iter<I: IntoIterator<Item = T>>(iter: I) -> Self {
        Self(smallvec::SmallVec::from_iter(iter))
    }
}
impl<T, const N: usize> Extend<T> for SmallList<T, N> {
    #[inline]
    fn extend<I: IntoIterator<Item = T>>(&mut self, iter: I) {
        self.0.extend(iter)
    }
}

#[allow(clippy::len_without_is_empty)]
impl<T, const N: usize> SmallList<T, N> {
    // ── constructors ───────────────────────────────────────────────────────
    #[inline]
    pub fn with_one(val: T) -> Self {
        let mut v = smallvec::SmallVec::new();
        v.push(val);
        Self(v)
    }
    #[inline]
    pub fn init_capacity(capacity: u32) -> Self {
        Self(smallvec::SmallVec::with_capacity(capacity as usize))
    }
    #[inline]
    pub fn init_inlined(values: &[T]) -> Self
    where
        T: Copy,
    {
        debug_assert!(values.len() <= N);
        Self(smallvec::SmallVec::from_slice(values))
    }
    /// Zig `fromList` / `fromBabyList` — adopt a `Vec<T>` as the heap buffer
    /// (O(1) header transfer; no element copy).
    #[inline]
    pub fn from_list(list: Vec<T>) -> Self {
        Self(smallvec::SmallVec::from_vec(list))
    }
    #[inline]
    pub fn from_list_no_deinit(list: Vec<T>) -> Self {
        Self::from_list(list)
    }
    #[inline]
    pub fn from_baby_list(list: Vec<T>) -> Self {
        Self::from_list(list)
    }
    #[inline]
    pub fn from_baby_list_no_deinit(list: Vec<T>) -> Self {
        Self::from_list(list)
    }

    // ── access ─────────────────────────────────────────────────────────────
    /// Zig `len()` returns `u32` (not `usize`); preserved so the ~300 call-site
    /// integer arithmetic in `bun_css` stays unchanged. Inherent shadows the
    /// `[T]::len()->usize` reachable via `Deref`.
    #[inline]
    pub fn len(&self) -> u32 {
        self.0.len() as u32
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    #[inline]
    pub fn slice(&self) -> &[T] {
        self.0.as_slice()
    }
    #[inline]
    pub fn slice_mut(&mut self) -> &mut [T] {
        self.0.as_mut_slice()
    }
    #[inline]
    pub fn at(&self, idx: u32) -> &T {
        &self.0[idx as usize]
    }
    #[inline]
    pub fn r#mut(&mut self, idx: u32) -> &mut T {
        &mut self.0[idx as usize]
    }
    #[inline]
    pub fn last(&self) -> Option<&T> {
        self.0.last()
    }
    #[inline]
    pub fn last_mut(&mut self) -> Option<&mut T> {
        self.0.last_mut()
    }
    #[inline]
    pub fn get_last_unchecked(&self) -> &T {
        // SAFETY: caller guarantees len >= 1 (Zig contract).
        unsafe { self.0.get_unchecked(self.0.len() - 1) }
    }

    // ── mutation ───────────────────────────────────────────────────────────
    #[inline]
    pub fn append(&mut self, item: T) {
        self.0.push(item)
    }
    #[inline]
    pub fn append_assume_capacity(&mut self, item: T) {
        // SmallVec v1 has no stable `push_unchecked`; the capacity check is a
        // single branch and `reserve` is amortised, so this is a no-op delta.
        self.0.push(item)
    }
    #[inline]
    pub fn append_slice(&mut self, items: &[T])
    where
        T: Clone,
    {
        // SmallVec v1 `extend_from_slice` requires `T: Copy`; use the
        // cloning-iterator path so non-`Copy` element types (e.g. `CSSString`)
        // remain admissible.
        self.0.extend(items.iter().cloned())
    }
    #[inline]
    pub fn append_slice_assume_capacity(&mut self, items: &[T])
    where
        T: Clone,
    {
        self.0.extend(items.iter().cloned())
    }
    #[inline]
    pub fn insert(&mut self, index: u32, item: T) {
        self.0.insert(index as usize, item)
    }
    #[inline]
    pub fn insert_slice(&mut self, index: u32, items: &[T])
    where
        T: Clone,
    {
        // SmallVec v1 `insert_from_slice` requires `T: Copy`; emulate with
        // `insert_many` (shifts the tail once, then writes the cloned items).
        self.0.insert_many(index as usize, items.iter().cloned())
    }
    #[inline]
    pub fn insert_slice_assume_capacity(&mut self, index: u32, items: &[T])
    where
        T: Clone,
    {
        self.0.insert_many(index as usize, items.iter().cloned())
    }
    #[inline]
    pub fn pop(&mut self) -> Option<T> {
        self.0.pop()
    }
    #[inline]
    pub fn ordered_remove(&mut self, idx: u32) -> T {
        self.0.remove(idx as usize)
    }
    #[inline]
    pub fn swap_remove(&mut self, idx: u32) -> T {
        self.0.swap_remove(idx as usize)
    }
    #[inline]
    pub fn clear_retaining_capacity(&mut self) {
        self.0.clear()
    }
    #[inline]
    pub fn reserve(&mut self, additional: u32) {
        self.0.reserve(additional as usize)
    }
    #[inline]
    pub fn ensure_total_capacity(&mut self, new_capacity: u32) {
        let cur = self.0.capacity();
        if (new_capacity as usize) > cur {
            self.0.reserve_exact(new_capacity as usize - cur);
        }
    }
    /// Zig `setLen` — exposed as safe for API parity with the previous port
    /// (whose only external caller shrinks to 0). Growing past the initialised
    /// region is the caller's responsibility, same as before.
    #[inline]
    pub fn set_len(&mut self, new_len: u32) {
        // SAFETY: matches the previous bun_css::SmallList::set_len contract
        // (Zig callers treat this as a raw length store).
        unsafe { self.0.set_len(new_len as usize) }
    }

    // ── conversion / clone ─────────────────────────────────────────────────
    #[inline]
    pub fn to_owned_slice(self) -> Box<[T]> {
        self.0.into_vec().into_boxed_slice()
    }
    #[inline]
    pub fn into_vec(self) -> Vec<T> {
        self.0.into_vec()
    }
    #[inline]
    pub fn shallow_clone(&self) -> Self
    where
        T: Copy,
    {
        Self(self.0.clone())
    }

    // ── iteration helpers (Zig-named) ──────────────────────────────────────
    #[inline]
    pub fn any(&self, predicate: impl Fn(&T) -> bool) -> bool {
        self.0.iter().any(predicate)
    }
    #[inline]
    pub fn map(&mut self, func: impl Fn(&mut T)) {
        for item in self.0.iter_mut() {
            func(item);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HashMap — `std.AutoHashMap(K, V)` / `std.HashMap(K, V, Ctx, max_load)`.
//
// Ported linear-probe layout (open-addressing, tombstones, power-of-two cap,
// 80% load) so iteration order matches Zig exactly — required by callers that
// snapshot the iteration sequence (lockfile debug stringify, etc.). The `Ctx`
// type parameter is now load-bearing: `AutoHashContext` wyhashes the key,
// `IdentityContext<K>` uses `k as u64` so pre-hashed keys aren't re-hashed.
// ──────────────────────────────────────────────────────────────────────────

pub mod zig_hash_map;
pub use zig_hash_map::{AutoHashContext, HashContext, HashMap};

/// std-compat path so call sites that wrote `bun_collections::hash_map::Entry`
/// against the old std-alias keep compiling.
pub mod hash_map {
    pub use crate::array_hash_map::{MapEntry as Entry, OccupiedEntry, VacantEntry};

    /// Result of `HashMap::get_or_put` — the unordered map has no stable index
    /// or key slot to hand out, so unlike `array_hash_map::GetOrPutResult` this
    /// only exposes `found_existing` + `value_ptr`.
    pub struct GetOrPutResult<'a, V> {
        pub found_existing: bool,
        pub value_ptr: &'a mut V,
    }

    /// Zig `std.HashMap.KV` — owned `{key, value}` pair returned from
    /// `fetchRemove` / `fetchPut`. Identical to `std.ArrayHashMap.KV`; re-exported
    /// from `array_hash_map` rather than duplicated.
    pub use crate::array_hash_map::KV;
}

pub mod array_list;
// TODO(port): per PORTING.md the managed/unmanaged ArrayList split collapses to
// `Vec<T>` (global mimalloc) outside AST crates; Phase B may drop most of these
// aliases once callers are migrated.
pub use array_list::ArrayList; // any `std.mem.Allocator`
pub use array_list::ArrayListAligned;
pub use array_list::ArrayListAlignedDefault;
pub use array_list::ArrayListAlignedIn;
pub use array_list::ArrayListDefault; // always default allocator (no overhead)
pub use array_list::ArrayListIn; // specific type of generic allocator

// ported from: src/collections/collections.zig
