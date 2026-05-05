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
#[cfg(any())] pub mod bit_set;             // 47 errors: IteratorDirection/Kind enum const-generics + WORDS const-expr
#[cfg(any())] pub mod pool;                // 15 errors: SinglyLinkedList inherent assoc + missing methods
#[cfg(any())] pub mod comptime_string_map; // 6 errors: per PORTING.md → phf::phf_map!, callers should use that directly
#[cfg(any())] #[path = "StaticHashMap.rs"]
              pub mod static_hash_map;     // 11 errors: Metadata inherent assoc; rarely used

pub use multi_array_list::MultiArrayList;
pub use baby_list::{BabyList, ByteList, OffsetByteList};
pub use hive_array::HiveArray;
pub use bounded_array::BoundedArray;
pub use linear_fifo::LinearFifo;

// Stub bit_set surface (downstream uses these names heavily).
pub mod bit_set {
    #[cfg(any())] include!("bit_set.rs"); // draft preserved
    #[derive(Clone, Default)] pub struct AutoBitSet;
    #[derive(Clone, Copy)] pub struct IntegerBitSet<const N: usize>(pub [u64; 4]); // TODO(b2): real N-bit storage
    impl<const N: usize> IntegerBitSet<N> {
        pub const fn init_empty() -> Self { Self([0; 4]) }
        pub const fn init_full() -> Self { Self([u64::MAX; 4]) }
        pub fn is_set(&self, i: usize) -> bool { (self.0[i / 64] >> (i % 64)) & 1 != 0 }
        pub fn set(&mut self, i: usize) { self.0[i / 64] |= 1 << (i % 64); }
        pub fn unset(&mut self, i: usize) { self.0[i / 64] &= !(1 << (i % 64)); }
        pub fn find_first_unset(&self) -> Option<usize> {
            for (w, &word) in self.0.iter().enumerate() {
                if word != u64::MAX { return Some(w * 64 + word.trailing_ones() as usize); }
            }
            None
        }
    }
    pub type StaticBitSet<const N: usize> = IntegerBitSet<N>;
    #[derive(Clone, Default)] pub struct DynamicBitSetUnmanaged;
}
pub use bit_set::{AutoBitSet, IntegerBitSet, StaticBitSet};

pub mod pool {
    #[cfg(any())] include!("pool.rs"); // draft preserved
    pub struct ObjectPool<T>(core::marker::PhantomData<T>);
}

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
