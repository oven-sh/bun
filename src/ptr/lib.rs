#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, deprecated, clippy::all)]
#![warn(unused_must_use)]
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

// ported from: src/ptr/ptr.zig

// ─────────────────────────────────────────────────────────────────────────────
// BackRef<T> / RawSlice<T> — runtime back-reference / borrowed-slice wrappers.
//
// Runtime structs frequently hold a non-owning pointer back to their owner
// (Zig: `*Parent`, `*const VirtualMachine`, `[]const u8`). Phase-A modeled
// these as raw `*mut T` / `*const [T]` and open-coded `unsafe { &*self.field }`
// at every read site. These two wrappers centralise that pattern under the
// `StoreRef`/`StoreSlice` contract from the parser, but for the *runtime*
// lifetime invariant: the pointee strictly outlives the holder by construction
// (owner creates child, child stores `BackRef` to owner; owner is destroyed
// only after the child). No arena involved — the pointee is heap- or
// stack-pinned for the holder's entire life.
//
// Unlike `StoreRef` (parser-arena, `u32` slice len), `RawSlice` keeps the full
// `usize` length so it is a drop-in replacement for any `*const [T]` field.
// ─────────────────────────────────────────────────────────────────────────────

/// Non-owning, non-null back-reference to an object that outlives `self`.
///
/// Mirrors Zig `*T` struct fields where the pointee is the owner/parent and is
/// guaranteed live for the holder's entire lifetime (owner-creates-child).
/// `Copy` + `Deref` so call sites read `self.owner.method()` instead of
/// `unsafe { &*self.owner }.method()`.
#[repr(transparent)]
pub struct BackRef<T: ?Sized>(core::ptr::NonNull<T>);

impl<T: ?Sized> BackRef<T> {
    /// Wrap a reference to the owner. Safe: no lifetime is forged at
    /// construction; the back-reference invariant (pointee outlives holder) is
    /// the caller's structural guarantee, enforced at the *type* boundary by
    /// only ever constructing a `BackRef` from the owner that is creating the
    /// holder.
    #[inline]
    pub fn new(r: &T) -> Self {
        BackRef(core::ptr::NonNull::from(r))
    }

    /// Wrap a mutable reference to the owner (same invariant as `new`).
    #[inline]
    pub fn new_mut(r: &mut T) -> Self {
        BackRef(core::ptr::NonNull::from(r))
    }

    /// Wrap a raw pointer.
    ///
    /// # Safety
    /// `p` must be non-null, properly aligned, and point to a `T` that will
    /// remain live and at a stable address for the entire lifetime of every
    /// `BackRef` copied from the result (the back-reference invariant).
    #[inline]
    pub const unsafe fn from_raw(p: *mut T) -> Self {
        // SAFETY: caller contract — `p` is non-null.
        BackRef(unsafe { core::ptr::NonNull::new_unchecked(p) })
    }

    /// Wrap a raw const pointer.
    ///
    /// # Safety
    /// Same as [`from_raw`]: `p` must be non-null, aligned, and the pointee
    /// must outlive every `BackRef` derived from the result. The pointee is
    /// only ever accessed via `&T` (shared) through this constructor's result;
    /// callers must not later use [`get_mut`] on a `BackRef` built from a
    /// genuinely read-only location.
    #[inline]
    pub const unsafe fn from_raw_const(p: *const T) -> Self {
        // SAFETY: caller contract — `p` is non-null. `cast_mut` is a
        // provenance-preserving no-op; mutation is gated by `get_mut`'s
        // separate contract.
        BackRef(unsafe { core::ptr::NonNull::new_unchecked(p as *mut T) })
    }

    #[inline]
    pub const fn from_non_null(p: core::ptr::NonNull<T>) -> Self {
        BackRef(p)
    }

    #[inline]
    pub const fn as_ptr(self) -> *mut T {
        self.0.as_ptr()
    }

    #[inline]
    pub const fn as_non_null(self) -> core::ptr::NonNull<T> {
        self.0
    }

    /// Borrow the pointee.
    ///
    /// # Safety (encapsulated)
    /// Sound under the `BackRef` invariant: the pointee outlives the holder
    /// and is at a stable address, so materialising `&T` for any lifetime not
    /// exceeding the holder's is valid. The returned borrow is tied to `&self`
    /// so it cannot outlive the `BackRef` itself.
    #[inline]
    pub fn get(&self) -> &T {
        // SAFETY: BackRef invariant — pointee outlives holder; non-null,
        // aligned, dereferenceable. No `&mut` alias is live: owners hand out
        // `BackRef` only to children they themselves own, and child access is
        // single-threaded per the runtime's `!Send` event-loop affinity.
        unsafe { self.0.as_ref() }
    }

    /// Mutably borrow the pointee.
    ///
    /// # Safety
    /// Caller must guarantee no other `&` or `&mut` to the pointee is live for
    /// the returned borrow's duration (same uniqueness rule as
    /// `NonNull::as_mut`). The `BackRef` invariant guarantees liveness and
    /// alignment but *not* exclusivity — that is a per-call-site obligation.
    #[inline]
    pub unsafe fn get_mut(&mut self) -> &mut T {
        // SAFETY: caller guarantees exclusivity; BackRef invariant guarantees
        // liveness/alignment.
        unsafe { self.0.as_mut() }
    }
}

impl<T: ?Sized> Copy for BackRef<T> {}
impl<T: ?Sized> Clone for BackRef<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T: ?Sized> core::ops::Deref for BackRef<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        self.get()
    }
}

impl<T: ?Sized> From<core::ptr::NonNull<T>> for BackRef<T> {
    #[inline]
    fn from(p: core::ptr::NonNull<T>) -> Self {
        BackRef(p)
    }
}

impl<T: ?Sized> core::fmt::Debug for BackRef<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_tuple("BackRef").field(&self.0).finish()
    }
}

impl<T: ?Sized> PartialEq for BackRef<T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        core::ptr::addr_eq(self.0.as_ptr(), other.0.as_ptr())
    }
}
impl<T: ?Sized> Eq for BackRef<T> {}

/// Non-owning borrowed slice whose backing storage outlives the holder.
///
/// Runtime sibling of `bun_js_parser::StoreSlice<T>` for `*const [T]` struct
/// fields. Same contract as [`BackRef`]: the slice memory is owned elsewhere
/// (parent struct, leaked `Box`, interned string) and remains valid for the
/// holder's full lifetime. Stores a fat raw pointer (`*const [T]`, `usize`
/// len) so it is a byte-for-byte drop-in for the Phase-A `*const [T]` fields
/// it replaces.
#[repr(transparent)]
pub struct RawSlice<T>(*const [T]);

impl<T> RawSlice<T> {
    /// Empty slice (dangling, len 0). Safe to `.slice()`.
    pub const EMPTY: Self = RawSlice(core::ptr::slice_from_raw_parts(
        core::ptr::NonNull::<T>::dangling().as_ptr(),
        0,
    ));

    /// Wrap a borrowed slice. Safe: stores the raw pointer; the
    /// outlives-holder invariant is the caller's structural guarantee.
    #[inline]
    pub const fn new(s: &[T]) -> Self {
        RawSlice(core::ptr::from_ref(s))
    }

    /// Wrap a raw slice pointer.
    ///
    /// # Safety
    /// `p` must either be a (dangling, len 0) empty slice or point to `len`
    /// initialized `T` that remain live and stable for the lifetime of every
    /// `RawSlice` copied from the result.
    #[inline]
    pub const unsafe fn from_raw(p: *const [T]) -> Self {
        RawSlice(p)
    }

    #[inline]
    pub const fn as_ptr(self) -> *const [T] {
        self.0
    }

    #[inline]
    pub const fn len(self) -> usize {
        self.0.len()
    }

    #[inline]
    pub const fn is_empty(self) -> bool {
        self.0.len() == 0
    }

    /// Re-borrow as `&[T]`.
    ///
    /// # Safety (encapsulated)
    /// Sound under the `RawSlice` invariant: backing storage outlives the
    /// holder, so materialising `&[T]` tied to `&self` is valid. Elements are
    /// initialized and the data pointer is non-null (`EMPTY` uses a dangling
    /// non-null pointer with len 0, which `from_raw_parts` accepts).
    #[inline]
    pub fn slice(&self) -> &[T] {
        // SAFETY: RawSlice invariant — pointer is non-null (real allocation or
        // `NonNull::dangling()` for EMPTY), `len` elements are initialized and
        // live for at least `'_` (the holder's borrow). No exclusive alias is
        // live: `RawSlice` only ever vends shared `&[T]`.
        unsafe { &*self.0 }
    }
}

impl<T> Copy for RawSlice<T> {}
impl<T> Clone for RawSlice<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Default for RawSlice<T> {
    #[inline]
    fn default() -> Self {
        RawSlice::EMPTY
    }
}

impl<T> core::ops::Deref for RawSlice<T> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        self.slice()
    }
}

impl<T> AsRef<[T]> for RawSlice<T> {
    #[inline]
    fn as_ref(&self) -> &[T] {
        self.slice()
    }
}

impl<T> From<&[T]> for RawSlice<T> {
    #[inline]
    fn from(s: &[T]) -> Self {
        RawSlice::new(s)
    }
}

impl<T: core::fmt::Debug> core::fmt::Debug for RawSlice<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.slice().fmt(f)
    }
}

// SAFETY: same rationale as `StoreSlice` / `BackRef` — wraps a raw pointer
// whose pointee's thread-safety is governed by `T`. Shared access (`slice()`)
// yields `&[T]`, which requires `T: Sync` to share across threads; sending the
// pointer requires `T: Send` so the eventual `&[T]` on the receiving thread is
// sound. This matches `&[T]: Send/Sync` auto-trait bounds.
unsafe impl<T: Sync> Send for RawSlice<T> {}
unsafe impl<T: Sync> Sync for RawSlice<T> {}
