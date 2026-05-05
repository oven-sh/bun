//! bun_collections — crate root.
//! Thin re-export hub mirroring `src/collections/collections.zig`.

#![allow(unused, non_snake_case, clippy::all)]

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
pub use baby_list::{BabyList, ByteList, OffsetByteList};
pub use hive_array::HiveArray;
pub use bounded_array::BoundedArray;
pub use linear_fifo::{LinearFifo, LinearFifoBufferType};

pub use bit_set::{AutoBitSet, IntegerBitSet, StaticBitSet, DynamicBitSetUnmanaged};

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

// Unordered HashMap alias. PORTING.md: must be wyhash-backed for determinism.
// TODO(port): swap RandomState for a wyhash BuildHasher once bun_wyhash exposes one.
pub type HashMap<K, V> = std::collections::HashMap<K, V>;
/// std-compat path so call sites that wrote `bun_collections::hash_map::Entry`
/// against the old std-alias keep compiling now that `ArrayHashMap` is real.
pub mod hash_map {
    pub use crate::array_hash_map::{MapEntry as Entry, OccupiedEntry, VacantEntry};
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
