//! bun_collections — crate root.
//! Thin re-export hub mirroring `src/collections/collections.zig`.

mod multi_array_list;
pub use crate::multi_array_list::MultiArrayList;

pub mod baby_list;
pub use baby_list::BabyList;
pub use baby_list::ByteList; // alias of BabyList<u8>
pub use baby_list::OffsetByteList;

pub mod bit_set;
pub use bit_set::AutoBitSet;

mod hive_array;
pub use crate::hive_array::HiveArray;

mod bounded_array;
pub use crate::bounded_array::BoundedArray;

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
