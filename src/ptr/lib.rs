#![allow(unused, non_snake_case, non_camel_case_types, deprecated, clippy::all)]
//! The `ptr` module contains smart pointer types that are used throughout Bun.
//!
//! Per PORTING.md §Pointers, most consumers of `bun.ptr.*` map directly to std
//! types (`Box`, `Rc`, `Arc`, `Cow`) and `bun_collections` (`TaggedPtr`,
//! `TaggedPtrUnion`). This crate hosts the intrusive/FFI-crossing variants.

// B-1: gate Phase-A draft bodies (E0658 nightly features, missing imports);
// expose stable-surface stubs. Full bodies preserved on disk for B-2.

// Cow/CowSlice → std (PORTING.md says these ARE std::borrow::Cow)
pub use std::borrow::Cow;
pub type CowSlice<'a, T> = Cow<'a, [T]>;
pub type CowSliceZ<'a> = Cow<'a, core::ffi::CStr>;
pub type CowString<'a> = Cow<'a, [u8]>;

#[cfg(any())] pub mod owned;
pub type Owned<T> = Box<T>;
pub type OwnedIn<T> = Box<T>; // B-2: arena-aware
pub type DynamicOwned<T> = Box<T>;

#[cfg(any())] pub mod shared;
pub type Shared<T> = std::rc::Rc<T>;
pub type AtomicShared<T> = std::sync::Arc<T>;
#[cfg(any())] pub mod external_shared;
pub struct ExternalShared<T>(*mut T); // B-2: FFI-crossing Arc

#[cfg(any())] pub mod ref_count;
#[cfg(any())] pub mod raw_ref_count;
// Intrusive ref-count mixins — B-2 implements; B-1 stubs as marker traits.
pub trait RefCount { fn ref_(&self); fn deref_(&self); }
pub trait ThreadSafeRefCount: Send + Sync { fn ref_(&self); fn deref_(&self); }
pub type RefPtr<T> = *mut T;
pub type IntrusiveRc<T> = *mut T;
pub type IntrusiveArc<T> = *mut T;
#[repr(transparent)] pub struct RawRefCount(core::sync::atomic::AtomicU32);

#[cfg(any())] pub mod tagged_pointer;
// 49 addr bits + 15 tag bits packed into u64 (PORTING.md §Type map).
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct TaggedPointer(pub u64);
#[repr(transparent)]
pub struct TaggedPointerUnion<T>(pub TaggedPointer, core::marker::PhantomData<T>); // B-2: tag enum T

#[cfg(any())] pub mod weak_ptr;
pub type WeakPtr<T> = *mut T; // B-2: intrusive 2-arg weak

pub mod meta; // small, used by other crates

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/ptr.zig (33 lines)
//   confidence: high
//   todos:      2
//   notes:      thin re-export hub; Phase B must reconcile with std Box/Rc/Arc mapping and bun_collections::TaggedPtr
// ──────────────────────────────────────────────────────────────────────────
