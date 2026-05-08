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

pub mod multi_array_list;
pub mod vec_ext;
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

pub use multi_array_list::MultiArrayList;
#[doc(hidden)]
pub use paste::paste as __mal_paste;
pub use vec_ext::{ByteVecExt, DeepClone, OffsetByteList, VecExt};
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
// Lifetime-erasure helpers (RUST_PATTERNS.md §6/§18) — re-exported here so
// crates that already depend on `bun_collections` (logger, css, js_parser,
// crash_handler, watcher, http_types) can route the borrowck-dodge through
// one centralised `unsafe fn` instead of open-coding the lifetime cast.
pub use bun_ptr::{detach_lifetime, detach_ref, RawSlice};

/// `bun.SmallList` — small-buffer-optimised list. The implementation lives in
/// `bun_css::small_list` (it predates this crate and pulling it down would
/// cycle); this stub aliases `Vec<T>` so dependents that only need
/// `push`/`len`/`as_slice` compile. PERF(port): no SBO — replace once
/// `small_list.rs` is hoisted out of `bun_css`.
pub type SmallList<T, const N: usize> = Vec<T>;

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
    /// `fetchRemove` / `fetchPut`.
    pub struct KV<K, V> {
        pub key: K,
        pub value: V,
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

// ported from: src/collections/collections.zig
