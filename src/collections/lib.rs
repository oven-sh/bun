//! bun_collections — crate root.
//! Thin re-export hub mirroring `src/collections/collections.zig`.

#![allow(unused, non_snake_case, clippy::all)]

// Let `#[derive(MultiArrayElement)]` expansions name this crate as
// `bun_collections::…` even from inside it (tests, internal element types).
extern crate self as bun_collections;

pub mod multi_array_list;
pub mod baby_list;
pub mod hive_array;
pub mod bounded_array;
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

pub use multi_array_list::{MultiArrayList, MultiArrayElement};
pub use bun_collections_macros::MultiArrayElement;
pub use baby_list::{BabyList, ByteList, OffsetByteList};
pub use hive_array::{HiveArray, HiveRef, Fallback as HiveArrayFallback};
pub use bounded_array::BoundedArray;
pub use linear_fifo::{LinearFifo, LinearFifoBufferType};

pub use bit_set::{AutoBitSet, DynamicBitSet, DynamicBitSetList, DynamicBitSetUnmanaged, IntegerBitSet, StaticBitSet};
/// `bun.bit_set` namespace alias (Zig: `bun.bit_set.List`).
pub mod dynamic_bit_set {
    pub use super::bit_set::DynamicBitSetList as List;
    pub use super::bit_set::DynamicBitSet;
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
    fn default() -> Self { Self { items: Vec::new(), context: C::default() } }
}
impl<T, C> PriorityQueue<T, C> {
    pub fn init(context: C) -> Self { Self { items: Vec::new(), context } }
    #[inline] pub fn count(&self) -> usize { self.items.len() }
    #[inline] pub fn len(&self) -> usize { self.items.len() }
    pub fn deinit(&mut self) { self.items.clear(); }
}
impl<T: Copy, C: PriorityCompare<T>> PriorityQueue<T, C> {
    /// Zig: `add(elem) !void` — push and sift-up.
    pub fn add(&mut self, elem: T) -> Result<(), bun_alloc::AllocError> {
        self.items.push(elem);
        let mut child = self.items.len() - 1;
        while child > 0 {
            let parent = (child - 1) / 2;
            if self.context.compare(&self.items[child], &self.items[parent])
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
        if self.items.is_empty() { return None; }
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
            if smallest == idx { break; }
            self.items.swap(idx, smallest);
            idx = smallest;
        }
        out
    }
}
pub use identity_context::{ArrayIdentityContext, IdentityContext, IdentityHash};

pub mod array_hash_map;
pub use array_hash_map::{
    string_hash_map, ArrayHashMap, ArrayHashMapExt, CaseInsensitiveAsciiStringArrayHashMap, Entry,
    GetOrPutResult, MapEntry, OccupiedEntry, StringArrayHashMap, StringHashMap,
    StringHashMapContext, StringHashMapUnownedKey, StringSet, VacantEntry,
};
/// Explicit-context alias; `ArrayHashMap<K, V>` already has `C = AutoContext`
/// as a default, this just gives the three-param spelling a distinct name.
pub type ArrayHashMapWithContext<K, V, C> = ArrayHashMap<K, V, C>;

pub mod string_map;
pub use string_map::StringMap;

// Re-export from bun_ptr so callers can name it as `bun_collections::TaggedPtrUnion`
// (PORTING.md groups it under Collections; the impl lives in src/ptr/).
pub use bun_ptr::tagged_pointer::{TaggedPtr as TaggedPointer, TaggedPtrUnion};

/// `bun.SmallList` — small-buffer-optimised list. The implementation lives in
/// `bun_css::small_list` (it predates this crate and pulling it down would
/// cycle); this stub aliases `Vec<T>` so dependents that only need
/// `push`/`len`/`as_slice` compile. PERF(port): no SBO — replace once
/// `small_list.rs` is hoisted out of `bun_css`.
pub type SmallList<T, const N: usize> = Vec<T>;

// ──────────────────────────────────────────────────────────────────────────
// HashMap — `std.AutoHashMap(K, V)` / `std.HashMap(K, V, Ctx, max_load)`.
//
// Newtype (not a bare alias) so it can:
//   1. carry the optional third `Ctx` parameter Zig call sites thread
//      (`IdentityContext<u64>` etc.) without forcing it to be a `BuildHasher`;
//   2. expose `get_or_put` returning the Zig-shaped `{found_existing, value_ptr}`.
//
// `Deref`/`DerefMut` to the inner `std::collections::HashMap` keeps the rest of
// the std surface (`get`, `insert`, `entry`, `iter`, …) available unchanged.
//
// TODO(port): `Ctx` is currently a phantom marker — hashing still uses std's
// `RandomState`. Phase B must route `Ctx`/wyhash into the actual hasher so
// iteration order and `IdentityContext` semantics match Zig (PORTING.md
// §Collections: "wyhash, not SipHash").
// ──────────────────────────────────────────────────────────────────────────

/// Default context marker for `HashMap<K, V>` when the Zig site used
/// `std.AutoHashMap` (auto-derived hash/eql).
#[derive(Default, Clone, Copy)]
pub struct AutoHashContext;

#[repr(transparent)]
pub struct HashMap<K, V, C = AutoHashContext> {
    inner: std::collections::HashMap<K, V>,
    _ctx: core::marker::PhantomData<C>,
}

impl<K, V, C> Default for HashMap<K, V, C> {
    fn default() -> Self {
        Self { inner: std::collections::HashMap::default(), _ctx: core::marker::PhantomData }
    }
}

impl<K, V, C> core::ops::Deref for HashMap<K, V, C> {
    type Target = std::collections::HashMap<K, V>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<K, V, C> core::ops::DerefMut for HashMap<K, V, C> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl<K, V, C> HashMap<K, V, C> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            inner: std::collections::HashMap::with_capacity(capacity),
            _ctx: core::marker::PhantomData,
        }
    }

    /// Zig `deinit` — drop all entries and release storage.
    pub fn deinit(&mut self) {
        self.inner = std::collections::HashMap::default();
    }

    /// Zig `lockPointers` — debug-mode pointer-stability assertion. The std
    /// `HashMap` backing has no such mode; no-op stub kept so the Zig
    /// lock/unlock bracketing translates without `#[cfg]` noise at every call
    /// site (see `SavedSourceMap`).
    #[inline]
    pub fn lock_pointers(&self) {}

    /// Zig `unlockPointers` — see [`lock_pointers`].
    #[inline]
    pub fn unlock_pointers(&self) {}
}

impl<K, V, C> HashMap<K, V, C>
where
    K: Eq + core::hash::Hash,
{
    /// Zig `getOrPut`: single-probe insert-or-lookup. On miss the value slot is
    /// left "undefined" in Zig; Rust cannot expose uninit through a `&mut V`,
    /// so `V: Default` and the slot is default-initialised — callers are
    /// expected to overwrite `*value_ptr` when `!found_existing`.
    pub fn get_or_put(
        &mut self,
        key: K,
    ) -> Result<hash_map::GetOrPutResult<'_, V>, bun_alloc::AllocError>
    where
        V: Default,
    {
        use std::collections::hash_map::Entry as StdEntry;
        match self.inner.entry(key) {
            StdEntry::Occupied(o) => Ok(hash_map::GetOrPutResult {
                found_existing: true,
                value_ptr: o.into_mut(),
            }),
            StdEntry::Vacant(v) => Ok(hash_map::GetOrPutResult {
                found_existing: false,
                value_ptr: v.insert(V::default()),
            }),
        }
    }

    /// Zig `putNoClobber`: insert asserting the key is new.
    pub fn put_no_clobber(&mut self, key: K, value: V) -> Result<(), bun_alloc::AllocError> {
        let prev = self.inner.insert(key, value);
        debug_assert!(prev.is_none(), "putNoClobber: key already present");
        Ok(())
    }

    /// Zig `put`: insert or overwrite.
    pub fn put(&mut self, key: K, value: V) -> Result<(), bun_alloc::AllocError> {
        self.inner.insert(key, value);
        Ok(())
    }
}

impl<'a, K, V, C> IntoIterator for &'a HashMap<K, V, C> {
    type Item = (&'a K, &'a V);
    type IntoIter = std::collections::hash_map::Iter<'a, K, V>;
    fn into_iter(self) -> Self::IntoIter {
        self.inner.iter()
    }
}

impl<'a, K, V, C> IntoIterator for &'a mut HashMap<K, V, C> {
    type Item = (&'a K, &'a mut V);
    type IntoIter = std::collections::hash_map::IterMut<'a, K, V>;
    fn into_iter(self) -> Self::IntoIter {
        self.inner.iter_mut()
    }
}

/// std-compat path so call sites that wrote `bun_collections::hash_map::Entry`
/// against the old std-alias keep compiling now that `ArrayHashMap` is real.
pub mod hash_map {
    pub use crate::array_hash_map::{MapEntry as Entry, OccupiedEntry, VacantEntry};

    /// Result of `HashMap::get_or_put` — the unordered map has no stable index
    /// or key slot to hand out, so unlike `array_hash_map::GetOrPutResult` this
    /// only exposes `found_existing` + `value_ptr`.
    pub struct GetOrPutResult<'a, V> {
        pub found_existing: bool,
        pub value_ptr: &'a mut V,
    }
}

pub mod array_list;
// TODO(port): per PORTING.md the managed/unmanaged ArrayList split collapses to
// `Vec<T>` (global mimalloc) outside AST crates; Phase B may drop most of these
// aliases once callers are migrated.
pub use array_list::ArrayList; // any `std.mem.Allocator`
pub use array_list::ArrayListDefault; // always default allocator (no overhead)
pub use array_list::ArrayListIn; // specific type of generic allocator
pub use array_list::ArrayListAligned;
pub use array_list::ArrayListAlignedDefault;
pub use array_list::ArrayListAlignedIn;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/collections/collections.zig (17 lines)
//   confidence: high
//   todos:      1
//   notes:      pure re-export hub; Phase B must add mod decls for HashMap/ArrayHashMap/TaggedPtr etc. referenced by PORTING.md's Collections table but not present in the Zig source.
// ──────────────────────────────────────────────────────────────────────────
