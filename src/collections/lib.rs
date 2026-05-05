//! bun_collections — crate root.
//! Thin re-export hub mirroring `src/collections/collections.zig`.

// B-1: gate modules using nightly features (adt_const_params/generic_const_exprs/
// inherent assoc types) or many bun_core::strings fns not yet implemented.
#[cfg(any())] mod multi_array_list;
#[cfg(any())] pub mod baby_list;
#[cfg(any())] pub mod bit_set;
#[cfg(any())] mod hive_array;
#[cfg(any())] mod bounded_array;

// Stub re-exports so downstream `use bun_collections::Foo` resolves.
pub struct MultiArrayList<T>(core::marker::PhantomData<T>);
#[repr(C)] pub struct BabyList<T> { pub ptr: *mut T, pub len: u32, pub cap: u32 }
pub type ByteList = BabyList<u8>;
pub struct OffsetByteList;
pub struct AutoBitSet;
pub struct HiveArray<T, const N: usize>(core::marker::PhantomData<T>);
pub struct BoundedArray<T, const N: usize> { pub buf: [T; N], pub len: u32 }

// HashMap aliases. PORTING.md: must be wyhash-backed for determinism.
// B-1 stub: std hasher until bun_wyhash::Hasher lands (TODO(b1): swap in B-2).
pub type HashMap<K, V> = std::collections::HashMap<K, V>;
pub type StringHashMap<V> = HashMap<Box<[u8]>, V>;
pub type StringArrayHashMap<V> = indexmap_stub::IndexMap<Box<[u8]>, V>;
pub type ArrayHashMap<K, V> = indexmap_stub::IndexMap<K, V>;
pub mod hash_map { pub use std::collections::hash_map::Entry; }
mod indexmap_stub { pub type IndexMap<K, V> = std::collections::HashMap<K, V>; }

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
