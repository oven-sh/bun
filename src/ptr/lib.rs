#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, deprecated, clippy::all)]
//! The `ptr` module contains smart pointer types that are used throughout Bun.
//!
//! Per PORTING.md §Pointers, most consumers of `bun.ptr.*` map directly to std
//! types (`Box`, `Rc`, `Arc`, `Cow`) and `bun_collections` (`TaggedPtr`,
//! `TaggedPtrUnion`). This crate hosts the intrusive/FFI-crossing variants.

// B-1: gate Phase-A draft bodies (E0658 nightly features, missing imports);
// expose stable-surface stubs. Full bodies preserved on disk for B-2.

// Cow/CowSlice → std (PORTING.md says these ARE std::borrow::Cow)
#![warn(unreachable_pub)]
pub use std::borrow::Cow;
pub type CowSlice<'a, T> = Cow<'a, [T]>;
pub type CowSliceZ<'a> = Cow<'a, core::ffi::CStr>;
pub type CowString<'a> = Cow<'a, [u8]>;

// `bun.ptr.CowSlice(T)` / `CowSliceZ` — the lifetime-free struct port (owns or
// borrows a raw slice with `init_owned`/`borrow_subslice`/`length`). Distinct
// from the `std::borrow::Cow` aliases above; callers that need the Zig-shaped
// API (e.g. `pack_command::Pattern`) reach for `cow_slice::CowSlice<u8>`.
#[path = "CowSlice.rs"]
pub mod cow_slice;

// owned/shared — OBSOLETE per PORTING.md §Pointers: callers
// use std `Box`/`Rc`/`Arc` directly. Draft modules kept for diff-pass only.
 pub mod owned;
 pub mod shared;
pub type Owned<T> = Box<T>;
pub type OwnedIn<T> = Box<T>;
pub type DynamicOwned<T> = Box<T>;
pub type Shared<T> = std::rc::Rc<T>;
pub type AtomicShared<T> = std::sync::Arc<T>;

// FFI-crossing externally-ref-counted pointer (e.g., WTFStringImpl). Real impl.
pub mod external_shared;
pub use external_shared::{ExternalShared, ExternalSharedDescriptor, ExternalSharedOptional};

pub mod raw_ref_count;
pub mod weak_ptr;

pub mod tagged_pointer;
// Compat aliases — Phase-A draft used short names; downstream uses long ones.
pub use tagged_pointer::{TaggedPtr as TaggedPointer, TaggedPtrUnion as TaggedPointerUnion};

pub mod ref_count;
pub use ref_count::{
    RefCounted, ThreadSafeRefCounted, AnyRefCounted, CellRefCounted, RefCount, ThreadSafeRefCount,
    RefPtr, ScopedRef,
};
// Compat aliases for Phase-A drafts that used pointer-typedef stubs.
pub type IntrusiveRc<T> = RefPtr<T>;
pub type IntrusiveArc<T> = RefPtr<T>;

pub use raw_ref_count::RawRefCount;
pub use weak_ptr::WeakPtr;

pub mod meta; // small, used by other crates

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/ptr.zig (33 lines)
//   confidence: high
//   todos:      2
//   notes:      thin re-export hub; Phase B must reconcile with std Box/Rc/Arc mapping and bun_collections::TaggedPtr
// ──────────────────────────────────────────────────────────────────────────
