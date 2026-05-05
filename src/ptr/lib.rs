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

pub mod tagged_pointer;
// Compat aliases — Phase-A draft used short names; downstream uses long ones.
pub use tagged_pointer::{TaggedPtr as TaggedPointer, TaggedPtrUnion as TaggedPointerUnion};

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
pub use weak_ptr::WeakPtr;

pub mod meta; // small, used by other crates

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/ptr.zig (33 lines)
//   confidence: high
//   todos:      2
//   notes:      thin re-export hub; Phase B must reconcile with std Box/Rc/Arc mapping and bun_collections::TaggedPtr
// ──────────────────────────────────────────────────────────────────────────
