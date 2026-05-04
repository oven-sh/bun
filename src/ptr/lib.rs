//! The `ptr` module contains smart pointer types that are used throughout Bun.
//!
//! Per PORTING.md §Pointers, most consumers of `bun.ptr.*` map directly to std
//! types (`Box`, `Rc`, `Arc`, `Cow`) and `bun_collections` (`TaggedPtr`,
//! `TaggedPtrUnion`). This crate hosts the intrusive/FFI-crossing variants
//! (`IntrusiveRc`, `IntrusiveArc`) and the remaining Bun-specific wrappers.

pub mod cow;
pub use cow::Cow;

pub mod cow_slice;
pub use cow_slice::CowSlice;
pub use cow_slice::CowSliceZ;
pub type CowString = CowSlice<u8>;

pub mod owned;
/// Owned pointer allocated with the default allocator.
pub use owned::Owned;
/// Owned pointer allocated with a specific type of allocator.
pub use owned::OwnedIn;
/// Owned pointer allocated with any `std.mem.Allocator`.
pub use owned::Dynamic as DynamicOwned;

pub mod shared;
pub use shared::Shared;
pub use shared::AtomicShared;
pub mod external_shared;
pub use external_shared::ExternalShared;

pub mod ref_count;
/// Deprecated; use `Shared(*T)` (i.e. `Rc<T>`).
#[deprecated]
pub use ref_count::RefCount;
/// Deprecated; use `AtomicShared(*T)` (i.e. `Arc<T>`).
#[deprecated]
pub use ref_count::ThreadSafeRefCount;
/// Deprecated; use `Shared(*T)` (i.e. `Rc<T>`).
#[deprecated]
pub use ref_count::RefPtr;
// TODO(port): PORTING.md §Pointers references `bun_ptr::IntrusiveRc<T>` /
// `bun_ptr::IntrusiveArc<T>` as the Rust mapping for the intrusive `RefCount` /
// `ThreadSafeRefCount` mixins. Phase B: re-export those names here once
// `ref_count.rs` defines them.

pub mod raw_ref_count;
pub use raw_ref_count::RawRefCount;

pub mod tagged_pointer;
pub use tagged_pointer::TaggedPointer;
pub use tagged_pointer::TaggedPointerUnion;
// TODO(port): PORTING.md maps `bun.ptr.TaggedPointer{,Union}` to
// `bun_collections::TaggedPtr{,Union}`. Phase B: decide whether the canonical
// home is here (re-exported by bun_collections) or vice versa.

pub mod weak_ptr;
/// Deprecated; use `Shared(*T).Weak` (i.e. `std::rc::Weak`).
#[deprecated]
pub use weak_ptr::WeakPtr;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/ptr.zig (33 lines)
//   confidence: high
//   todos:      2
//   notes:      thin re-export hub; Phase B must reconcile with std Box/Rc/Arc mapping and bun_collections::TaggedPtr
// ──────────────────────────────────────────────────────────────────────────
