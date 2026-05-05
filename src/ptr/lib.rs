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

// owned/shared/external_shared — OBSOLETE per PORTING.md §Pointers: callers
// use std `Box`/`Rc`/`Arc` directly. Draft modules kept for diff-pass only.
#[cfg(any())] pub mod owned;
#[cfg(any())] pub mod shared;
#[cfg(any())] pub mod external_shared;
pub type Owned<T> = Box<T>;
pub type OwnedIn<T> = Box<T>;
pub type DynamicOwned<T> = Box<T>;
pub type Shared<T> = std::rc::Rc<T>;
pub type AtomicShared<T> = std::sync::Arc<T>;
pub struct ExternalShared<T>(*mut T); // FFI-crossing Arc — TODO(b2) if any caller actually needs it

pub mod raw_ref_count;
pub mod weak_ptr;

// TODO(b2-large): tagged_pointer.rs (320L) uses inherent assoc types for
// `TaggedPtr::Tag` / `TaggedPtrUnion::TagInt` (6× E0223). Rewrite via free
// type aliases or a `TaggedPtrUnionTypes` trait. Per PORTING.md §Dispatch,
// most users move to `(tag: u8, ptr: *mut ())` anyway.
#[cfg(any())] pub mod tagged_pointer;
pub mod tagged_pointer_stub {
    /// 49 addr bits + 15 tag bits packed into u64 (PORTING.md §Type map).
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct TaggedPointer(pub u64);
    #[repr(transparent)]
    #[derive(Clone, Copy)]
    pub struct TaggedPointerUnion<T>(pub TaggedPointer, core::marker::PhantomData<T>);
}
use tagged_pointer_stub as tagged_pointer;

// TODO(b2-large): ref_count.rs (1079L) — intrusive RefCount mixin. Heavy
// inherent-assoc-type usage; needs trait redesign. Downstream FFI types
// (`.classes.ts` payloads, WTFStringImpl) embed this.
#[cfg(any())] pub mod ref_count;
pub trait RefCount { fn ref_(&self); fn deref_(&self); }
pub trait ThreadSafeRefCount: Send + Sync { fn ref_(&self); fn deref_(&self); }
pub type RefPtr<T> = *mut T;
pub type IntrusiveRc<T> = *mut T;
pub type IntrusiveArc<T> = *mut T;

pub use raw_ref_count::RawRefCount;
pub use tagged_pointer::{TaggedPointer, TaggedPointerUnion};
pub use weak_ptr::WeakPtr;

pub mod meta; // small, used by other crates

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/ptr.zig (33 lines)
//   confidence: high
//   todos:      2
//   notes:      thin re-export hub; Phase B must reconcile with std Box/Rc/Arc mapping and bun_collections::TaggedPtr
// ──────────────────────────────────────────────────────────────────────────
