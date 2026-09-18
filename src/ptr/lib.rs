#![feature(allocator_api)]
#![allow(
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    deprecated
)]
// bun_ptr is a T0 foundation crate that bun_threading and bun_collections
// depend on; importing either to satisfy disallowed-types would create a
// dependency cycle.
#![allow(clippy::disallowed_types)]
#![warn(unused_must_use)]
//! The `ptr` module contains smart pointer types that are used throughout Bun.
//!
//! Per PORTING.md §Pointers, most consumers of `bun.ptr.*` map directly to std
//! types (`Box`, `Rc`, `Arc`, `Cow`) and `bun_collections` (`TaggedPtr`,
//! `TaggedPtrUnion`). This crate hosts the intrusive/FFI-crossing variants.

// Lets the `::bun_ptr::` paths the ref-count derives emit resolve in-crate.
extern crate self as bun_ptr;

// `bun.ptr.CowSlice(T)` / `CowSliceZ` — the lifetime-free struct port (owns or
// borrows a raw slice with `init_owned`/`borrow_subslice`/`length`). Callers
// that need the struct-shaped API (e.g. `pack_command::Pattern`) reach for
// `cow_slice::CowSlice<u8>`.
#[path = "CowSlice.rs"]
pub mod cow_slice;
mod js_cell;
pub use js_cell::JsCell;

// FFI-crossing externally-ref-counted pointer (e.g., WTFStringImpl). Canonical
// impl moved down to `bun_core::external_shared` (cycle-break for the
// `bun_string → bun_core` merge); re-exported here unchanged.
pub use bun_core::external_shared;
pub use bun_core::{ExternalShared, ExternalSharedDescriptor, WTFString};
// `cast_fn_ptr` and `RawSlice` likewise moved to `bun_core`; re-export.
pub use bun_core::{RawSlice, cast_fn_ptr};

pub mod raw_ref_count;
pub mod weak_ptr;

pub mod tagged_pointer;
pub use tagged_pointer::TaggedPtr;

pub mod ref_count;
pub use ref_count::{
    AnyRefCounted, CellRefCounted, RefCount, RefCounted, RefPtr, ThreadSafeRefCount,
    ThreadSafeRefCounted,
};
// Derive macros — same names as the traits (separate namespace). The derives
// expand to `::bun_ptr::…` paths, so this crate is the canonical re-export
// point: `#[derive(bun_ptr::CellRefCounted)]`.
pub use bun_core_macros::{CellRefCounted, RefCounted, ThreadSafeRefCounted};

pub mod parent_ref;
pub use parent_ref::ParentRef;
pub use raw_ref_count::RawRefCount;
pub use weak_ptr::WeakPtr;

// Intrusive parent-from-field recovery — canonical helpers live in `bun_core`
// (lowest tier, every crate can reach them); re-exported here so callers can
// spell `bun_ptr::container_of` / `bun_ptr::from_field_ptr!`.
pub use bun_core::{
    IntrusiveField, assert_not_freeze, container_of, from_field_ptr, impl_field_parent,
    intrusive_field,
};

// C-callback `void *user_data` → `&mut T` recovery — same tiering rationale
// as `container_of`; canonical impl lives in `bun_core`, re-exported here so
// runtime crates spell `bun_ptr::callback_ctx::<T>(ctx)`.
pub use bun_core::callback_ctx;

// ─────────────────────────────────────────────────────────────────────────────
// BackRef<T> / RawSlice<T> — runtime back-reference / borrowed-slice wrappers.
//
// Runtime structs frequently hold a non-owning pointer back to their owner.
// These fields were once raw `*mut T` / `*const [T]` with open-coded
// `unsafe { &*self.field }` at every read site. These two wrappers centralise
// that pattern under the
// `StoreRef`/`StoreSlice` contract from the parser, but for the *runtime*
// lifetime invariant: the pointee strictly outlives the holder by construction
// (owner creates child, child stores `BackRef` to owner; owner is destroyed
// only after the child). No arena involved — the pointee is heap- or
// stack-pinned for the holder's entire life.
//
// Unlike `StoreRef` (parser-arena, `u32` slice len), `RawSlice` keeps the full
// `usize` length so it is a drop-in replacement for any `*const [T]` field.
// ─────────────────────────────────────────────────────────────────────────────

pub struct Shared;
pub struct Mut;
/// Provenance marker: the back-reference was minted from a [`ThisPtr`] (or a
/// leaked `Box`), i.e. it is the root pointer of a live heap allocation, so it
/// may hand a [`ThisPtr`] back out. `BackRef<T, Mut>` (any `&mut T`) may not.
pub struct Root;

/// Non-owning, non-null back-reference to an object that outlives `self`.
/// For struct fields where the pointee is the owner/parent and is
/// guaranteed live for the holder's entire lifetime (owner-creates-child).
/// `Copy` + `Deref` so call sites read `self.owner.method()` instead of
/// `unsafe { &*self.owner }.method()`.
#[repr(transparent)]
pub struct BackRef<T: ?Sized, P = Shared>(core::ptr::NonNull<T>, core::marker::PhantomData<P>);

impl<T: ?Sized> BackRef<T, Shared> {
    /// Wrap a reference to the owner. Safe: no lifetime is forged at
    /// construction; the back-reference invariant (pointee outlives holder) is
    /// the caller's structural guarantee, enforced at the *type* boundary by
    /// only ever constructing a `BackRef` from the owner that is creating the
    /// holder.
    #[inline]
    pub fn new(r: &T) -> Self {
        BackRef(core::ptr::NonNull::from(r), core::marker::PhantomData)
    }

    /// Wrap a raw pointer as a read-only back-reference.
    ///
    /// # Safety
    /// `p` must be non-null, properly aligned, and point to a `T` that will
    /// remain live and at a stable address for the entire lifetime of every
    /// `BackRef` copied from the result (the back-reference invariant).
    #[inline]
    pub const unsafe fn from_raw(p: *mut T) -> Self {
        // SAFETY: caller contract — `p` is non-null.
        BackRef(
            unsafe { core::ptr::NonNull::new_unchecked(p) },
            core::marker::PhantomData,
        )
    }
}

impl<T: ?Sized> BackRef<T, Mut> {
    #[inline]
    pub fn new_mut(r: &mut T) -> Self {
        BackRef(core::ptr::NonNull::from(r), core::marker::PhantomData)
    }

    /// Wrap a write-capable raw pointer.
    ///
    /// # Safety
    /// Same contract as [`BackRef::from_raw`]; additionally `p` must have been
    /// derived with mutable provenance (`ptr::from_mut`, `&raw mut`,
    /// `Box::into_raw`, ...).
    #[inline]
    pub const unsafe fn from_raw_mut(p: *mut T) -> Self {
        // SAFETY: caller contract — `p` is non-null.
        BackRef(
            unsafe { core::ptr::NonNull::new_unchecked(p) },
            core::marker::PhantomData,
        )
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
        // liveness/alignment; `Mut` records write provenance.
        unsafe { self.0.as_mut() }
    }
}

impl<T, P> BackRef<T, P> {
    #[inline]
    pub const fn dangling() -> Self {
        BackRef(core::ptr::NonNull::dangling(), core::marker::PhantomData)
    }
}

impl<T: ?Sized> BackRef<T, Mut> {
    #[inline]
    pub const fn as_ptr(self) -> *mut T {
        self.0.as_ptr()
    }
}

impl<T: ?Sized, P> BackRef<T, P> {
    #[inline]
    pub const fn as_const_ptr(self) -> *const T {
        self.0.as_ptr()
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
        // aligned, dereferenceable.
        unsafe { self.0.as_ref() }
    }
}

impl<T> BackRef<T, Root> {
    /// View the pointee as a [`ThisPtr`] again for the dispatch entry points
    /// that take one. Safe under the `BackRef` invariant (the pointee is live
    /// for as long as this back-reference is held — [`ThisPtr::new`]'s
    /// precondition) plus what `Root` records: this pointer *is* a heap
    /// allocation's root, so the callee may release refs through it.
    #[inline]
    pub fn this_ptr(&self) -> ThisPtr<T> {
        // SAFETY: see above.
        unsafe { ThisPtr::new(self.0.as_ptr()) }
    }

    /// Wrap the root pointer of a live heap allocation.
    ///
    /// # Safety
    /// [`BackRef::from_raw`]'s contract, and `p` is what `Box::into_raw` /
    /// `heap::into_raw` returned for an allocation that stays live while the
    /// result is held.
    #[inline]
    pub const unsafe fn from_root(p: *mut T) -> Self {
        // SAFETY: caller contract — `p` is non-null.
        BackRef(
            unsafe { core::ptr::NonNull::new_unchecked(p) },
            core::marker::PhantomData,
        )
    }
}

impl<T> From<ThisPtr<T>> for BackRef<T, Root> {
    /// Record a dispatch-time [`ThisPtr`] as a back-reference. The holder takes
    /// on the `BackRef` invariant: it must drop/clear this before the pointee
    /// can be freed.
    #[inline]
    fn from(p: ThisPtr<T>) -> Self {
        BackRef(p.0, core::marker::PhantomData)
    }
}

impl<T: ?Sized, P> Copy for BackRef<T, P> {}
impl<T: ?Sized, P> Clone for BackRef<T, P> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T: ?Sized, P> core::ops::Deref for BackRef<T, P> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        self.get()
    }
}

impl<T: ?Sized> From<core::ptr::NonNull<T>> for BackRef<T, Shared> {
    #[inline]
    fn from(p: core::ptr::NonNull<T>) -> Self {
        BackRef(p, core::marker::PhantomData)
    }
}

impl<T: ?Sized, P> From<BackRef<T, P>> for core::ptr::NonNull<T> {
    #[inline]
    fn from(b: BackRef<T, P>) -> Self {
        b.0
    }
}

impl<T: ?Sized, P> core::fmt::Debug for BackRef<T, P> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_tuple("BackRef").field(&self.0).finish()
    }
}

impl<T: ?Sized, P> PartialEq for BackRef<T, P> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        core::ptr::addr_eq(self.0.as_ptr(), other.0.as_ptr())
    }
}
impl<T: ?Sized, P> Eq for BackRef<T, P> {}

/// Detach a slice borrow from its borrowck lifetime.
///
/// This is the **local-variable** counterpart to [`RawSlice`]. Use it when you
/// need to read through a slice while a sibling field is reborrowed `&mut`,
/// and the backing storage is known not to move/realloc for the
/// scope of the returned reference. Unlike `RawSlice`, this is *not* meant for
/// struct fields — it exists so the borrowck-dodge stays a one-liner with the
/// `unsafe` centralised here, rather than laundering the slice through a
/// `RawSlice::new(..).slice()` round-trip that obscures intent.
///
/// # Safety
/// Caller guarantees the slice's backing allocation is not freed, moved, or
/// reallocated, and no exclusive `&mut` to the same elements is formed, for
/// the full lifetime `'a` chosen by the caller.
#[inline(always)]
pub unsafe fn detach_lifetime<'a, T>(s: &[T]) -> &'a [T] {
    // SAFETY: caller contract — `s` points to `len` initialized `T` that remain
    // live and un-aliased-exclusively for `'a`.
    unsafe { &*core::ptr::from_ref::<[T]>(s) }
}

/// Detach a `&T` borrow from its borrowck lifetime (general `?Sized` form of
/// [`detach_lifetime`]).
///
/// Replaces the open-coded `unsafe { &*std::ptr::from_ref::<T>(x) }` /
/// `unsafe { &*(&raw const x) }` lifetime-laundering idiom that was once
/// scattered everywhere a raw `*const T` was held across a sibling
/// `&mut self` reborrow (arena handles, SoA columns, self-referential views).
/// Centralising it here makes the call sites grep-able and the safety
/// obligation uniform.
///
/// # Safety
/// Caller guarantees the pointee is not freed, moved, or exclusively borrowed
/// for the full caller-chosen lifetime `'a`.
#[inline(always)]
pub unsafe fn detach_lifetime_ref<'a, T: ?Sized>(r: &T) -> &'a T {
    // SAFETY: caller contract — `r` is live and shared-only for `'a`.
    unsafe { &*core::ptr::from_ref::<T>(r) }
}

/// Detach a `&mut T` borrow from its borrowck lifetime.
///
/// Mutable counterpart of [`detach_lifetime_ref`]. Replaces the open-coded
/// `unsafe { &mut *std::ptr::from_mut::<T>(x) }` pattern. Strictly more
/// dangerous than the shared form: callers must additionally guarantee
/// **uniqueness** for `'a` (no other `&`/`&mut` to the same `T` is live).
///
/// # Safety
/// Caller guarantees the pointee is live for `'a` and that no other borrow
/// (shared or exclusive) to it overlaps the returned `&'a mut T`.
#[inline(always)]
pub unsafe fn detach_lifetime_mut<'a, T: ?Sized>(r: &mut T) -> &'a mut T {
    // SAFETY: caller contract — `r` is live and exclusively held for `'a`.
    unsafe { &mut *core::ptr::from_mut::<T>(r) }
}

/// Marker trait for types whose `&mut self` methods launder `self` through
/// `core::hint::black_box` (PORT_NOTES_PLAN **R-2**) before dispatching a
/// re-entrant parent/user callback, then reborrow via [`LaunderedSelf::r`].
///
/// This trait makes the reborrow sound without scattering
/// `unsafe { &mut *this }` at every field access.
///
/// # Safety (impl contract)
/// For every method on `Self` that calls [`r`](Self::r):
/// - `Self` is an inline/intrusive field of a heap object that is **never
///   freed** during the re-entrant callback (the laundered raw pointer aliases
///   a `&mut self` whose stack frame is still live);
/// - re-entry runs on the **single JS thread** (no concurrent `&mut Self`);
/// - each `&mut Self` produced by [`r`](Self::r) is short-lived and is the
///   sole live borrow at the point of use — never held across the next
///   parent/user dispatch.
pub unsafe trait LaunderedSelf: Sized {
    /// Reborrow a PORT_NOTES_PLAN R-2 laundered self-pointer.
    ///
    /// `this` is the `black_box`-laundered address of an outer `&mut self`;
    /// the laundered raw pointer carries no `noalias`, so the compiler may not
    /// cache fields across re-entry. See the trait-level safety contract for
    /// the encapsulated invariant.
    // The safety contract is on `unsafe impl LaunderedSelf` (the implementor
    // promises every `this` it passes is a live laundered `&mut self`); the
    // method is safe-to-call by design — that's the point of `unsafe trait`.
    // Clippy's `not_unsafe_ptr_arg_deref` doesn't see the trait-level
    // invariant; making this `unsafe fn` would force 89 call sites to restate
    // a contract they cannot violate.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    #[inline(always)]
    fn r<'a>(this: *mut Self) -> &'a mut Self {
        debug_assert!(!this.is_null());
        // SAFETY: `LaunderedSelf` impl contract — `this` aliases a live
        // `&mut self` on the single JS thread; sole borrow at point of use.
        unsafe { &mut *this }
    }
}

/// Shorter alias for [`detach_lifetime_ref`] — two workstreams converged on
/// slightly different names; both are kept so callers from either land cleanly.
pub use detach_lifetime_ref as detach_ref;

/// Reinterpret `&[Box<[T]>]` as `&[&[T]]` for read-only fan-out.
///
/// `Box<[T]>` and `&[T]` are both `(NonNull<T>, len: usize)` fat pointers with
/// identical layout (guaranteed by the unsized-pointer ABI), so a column of
/// owned boxed slices can be viewed as a column of borrows without copying.
/// Used by the bundler's SoA columns (`items_unique_key_for_additional_file`)
/// where the printer API wants `&[&[u8]]`.
///
/// The returned borrows are valid for the input borrow `'a` only — the boxes
/// are not moved or dropped while the view is live.
///
/// # Safety
/// Relies on `Box<[T]>` and `&[T]` having identical fat-pointer **field
/// order** (data-ptr then len). This is de-facto stable on every supported
/// rustc but is not a language guarantee — the const block below proves only
/// size/align. `unsafe` + `#[doc(hidden)]` so the layout assumption stays
/// visible at each call site rather than inviting new callers; do not use
/// outside the bundler SoA-column read-only fan-out it was written for.
#[doc(hidden)]
#[inline(always)]
pub unsafe fn boxed_slices_as_borrowed<T, A: core::alloc::Allocator>(s: &[Box<[T], A>]) -> &[&[T]] {
    const {
        assert!(core::mem::size_of::<Box<[T], A>>() == core::mem::size_of::<&[T]>());
        assert!(core::mem::align_of::<Box<[T], A>>() == core::mem::align_of::<&[T]>());
    }
    // SAFETY: layout-identical per the const asserts above; every `Box<[T]>`
    // element is a valid non-null `(ptr, len)` pair, which is exactly the
    // validity invariant of `&[T]`. Read-only, lifetime tied to `s`.
    let view: &[&[T]] = unsafe { core::slice::from_raw_parts(s.as_ptr().cast::<&[T]>(), s.len()) };
    // Fat-pointer field order (ptr-then-len) is de-facto stable but not
    // language-guaranteed; spot-check first+last in debug so an ABI flip
    // would trip here rather than silently misbehaving downstream. (Checking
    // every element is O(n) per call and the bundler passes thousands of
    // entries inside per-chunk loops; first/last is sufficient to detect a
    // field-order swap since it would affect every element uniformly.)
    #[cfg(debug_assertions)]
    if let (Some(bf), Some(bl)) = (s.first(), s.last()) {
        let (vf, vl) = (view[0], view[view.len() - 1]);
        debug_assert!(bf.as_ptr() == vf.as_ptr() && bf.len() == vf.len());
        debug_assert!(bl.as_ptr() == vl.as_ptr() && bl.len() == vl.len());
    }
    view
}

// ─────────────────────────────────────────────────────────────────────────────
// Interned — process-lifetime byte-slice proof type.
//
// The original port widened ~100 borrowed `&[u8]` to `&'static [u8]` via
// open-coded `unsafe { &*ptr::from_ref(s) }`. Audit splits them into:
//
//   • Population A (~80) — bytes live in a process-lifetime store
//     (`FilenameStore` / `DirnameStore` / `BSSStringList` singleton, a
//     `Box::leak`, or a true `static` literal). The widen is sound, but the
//     bare `&'static [u8]` carries no proof, so a refactor can silently feed
//     it a stack slice.
//   • Population B (~24) — bytes are owned by a value with a `Drop` that runs
//     before process exit (UserOptions arena, FetchTasklet, JSC slice, SSL
//     session). The widen is unsound the moment the value escapes the holder.
//
// `Interned` is the type-level proof that a `&'static [u8]` came from
// Population A. Safe constructors accept only genuinely-process-lifetime
// inputs (`from_static`, `leak`, `leak_vec`); the single `unsafe` escape hatch
// (`assume`) forces every Population-B caller to spell out — in its SAFETY
// comment — exactly which owner backs the bytes and when it drops, so the lie
// is grep-able rather than ambient.
//
// `repr(transparent)` over `&'static [u8]`: zero-cost, FFI-identical to the
// fields it replaces, `Option<Interned>` niche-packs, and `Send + Sync` is
// inherited via auto-traits (no `unsafe impl` needed).
//
// This does NOT cover `&'static mut [u8]` / `&'static mut T` forges (e.g.
// `FileReader::pending_view`, `Decompressor::seat` output, `CmdHandle::cmd_mut`)
// — those are tracked under the sibling `static-widen-mut` pattern and want a
// raw-pointer field or a future `RawSliceMut<T>`.
// ─────────────────────────────────────────────────────────────────────────────

/// A byte slice backed by **process-lifetime** storage.
///
/// Process-lifetime ≡ one of:
///   • interned in a `BSSStringList` singleton (`FilenameStore`, `DirnameStore`),
///   • a `Box::leak` / `Vec::leak` that is never reclaimed,
///   • a true `'static` item (string literal, `static` array).
///
/// `Interned` exists so that the ~80 open-coded `&[u8] → &'static [u8]` widens
/// become a safe value flowing from the store, and so that the ~24 sites whose
/// backing **does** drop can no longer pretend to be `'static` — they must
/// spell `unsafe { Interned::assume(..) }` and name the owner in the SAFETY
/// comment, or (correctly) switch to [`RawSlice<u8>`] / [`BackRef<T>`].
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Ord, PartialOrd)]
pub struct Interned(&'static [u8]);

impl Interned {
    /// Empty slice. Safe — `b""` is a true `'static` literal.
    pub const EMPTY: Self = Interned(b"");

    /// Wrap a true `'static` input — string literals, `static` arrays. Safe by
    /// definition: the borrow checker has already proved process lifetime.
    #[inline]
    pub const fn from_static(s: &'static [u8]) -> Self {
        Interned(s)
    }

    /// Escape hatch for storage this module cannot see (mmap'd standalone
    /// graph, mimalloc arena leaked for the process, C-side constant table).
    ///
    /// # Safety
    /// `s` must remain valid and immutable for the rest of the process. Name
    /// the owning store in the SAFETY comment. **Never** call this on bytes
    /// owned by a value with a `Drop` impl that runs before process exit — use
    /// [`RawSlice<u8>`] for holder-lifetime slices instead.
    #[inline]
    pub const unsafe fn assume(s: &[u8]) -> Self {
        // SAFETY: caller contract — `s` is process-lifetime and immutable.
        Interned(unsafe { &*core::ptr::from_ref::<[u8]>(s) })
    }

    /// Recover the underlying `&'static [u8]` (for storing into legacy fields
    /// that have not yet been retyped to `Interned`).
    #[inline]
    pub const fn as_bytes(self) -> &'static [u8] {
        self.0
    }

    #[inline]
    pub const fn is_empty(self) -> bool {
        self.0.is_empty()
    }
}

impl core::ops::Deref for Interned {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        self.0
    }
}

impl AsRef<[u8]> for Interned {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        self.0
    }
}

impl core::borrow::Borrow<[u8]> for Interned {
    /// Lets `HashMap<Interned, _>` / `HashSet<Interned>` look up by `&[u8]`.
    #[inline]
    fn borrow(&self) -> &[u8] {
        self.0
    }
}

impl Default for Interned {
    #[inline]
    fn default() -> Self {
        Self::EMPTY
    }
}

impl From<&'static str> for Interned {
    #[inline]
    fn from(s: &'static str) -> Self {
        Interned(s.as_bytes())
    }
}

impl From<&'static [u8]> for Interned {
    #[inline]
    fn from(s: &'static [u8]) -> Self {
        Interned(s)
    }
}

impl core::fmt::Debug for Interned {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // bstr-style: print as a (possibly-UTF-8) string rather than a byte
        // array dump, matching how these slices are used (paths, identifiers).
        core::fmt::Debug::fmt(bstr::BStr::new(self.0), f)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ThisPtr<T> — callback-dispatch self-pointer
//
// uSockets / C++ FFI dispatch hands every socket-event handler a raw
// `*mut Self` recovered from the userdata slot. `ThisPtr` wraps it under ONE
// constructor SAFETY contract: wrap the raw pointer once at fn entry, then
// read fields via `Deref` and hold `RefPtr::from_this(this)` across any
// re-entrant call that could drop the last ref.
//
// Unlike [`BackRef`] (owner-outlives-holder back-reference), a `ThisPtr` is for
// the *callee-is-the-allocation* case: the pointee is an intrusively-refcounted
// heap object that may be **freed during the call** (a reentrant `deref()`
// reaching zero). `ThisPtr` therefore:
//   • is `Copy` and holds no ref of its own — it is purely a typed view of the
//     incoming `*mut Self`;
//   • only ever vends fresh short-lived `&T` (no `DerefMut`): handlers that
//     re-enter via the same userdata pointer would alias a held `&mut T`.
//     Mutation goes through `as_ptr()` with a per-site `unsafe { (*p).… }`.
// ─────────────────────────────────────────────────────────────────────────────

/// Non-owning, `Copy` self-pointer for uSockets / FFI callback dispatch.
///
/// See the module comment above for the full rationale. Construct once per
/// handler entry with [`ThisPtr::new`], then use `Deref` for field reads and
/// [`RefPtr::from_this`] for the keep-alive bracket.
#[repr(transparent)]
pub struct ThisPtr<T>(core::ptr::NonNull<T>);

impl<T> ThisPtr<T> {
    /// Wrap the raw `*mut Self` arriving from a uWS / FFI callback.
    ///
    /// # Safety
    /// `p` must be non-null and point to a live `T` (heap-allocated via
    /// `heap::alloc`, intrusively refcounted) that remains live for every
    /// subsequent access through this `ThisPtr` and its copies — i.e. either
    /// the caller already holds a ref, or the first thing it does is take a
    /// [`RefPtr::from_this`]. No `&mut T` to `*p` may be live across
    /// any `Deref` borrow produced from this `ThisPtr`.
    #[inline]
    pub unsafe fn new(p: *mut T) -> Self {
        debug_assert!(!p.is_null(), "ThisPtr::new: null callback self-pointer");
        // SAFETY: caller contract — `p` is non-null.
        ThisPtr(unsafe { core::ptr::NonNull::new_unchecked(p) })
    }

    /// Recover the raw pointer (root provenance) for mutation or for forwarding
    /// to another raw-ptr handler. Mutation still requires a per-site `unsafe`.
    #[inline]
    pub fn as_ptr(self) -> *mut T {
        self.0.as_ptr()
    }

    /// Fresh shared borrow of the pointee.
    ///
    /// Sound under the [`new`](Self::new) invariant: the pointee is live and
    /// no `&mut T` overlaps the returned `&T`. Each call materialises a NEW
    /// short-lived `&T` (autoref scope only); do not hold the result across a
    /// call that may form `&mut T` to the same allocation.
    #[inline]
    pub fn get(&self) -> &T {
        // SAFETY: `ThisPtr::new` invariant — pointee is live, non-null,
        // aligned, and no exclusive borrow overlaps this shared one.
        unsafe { self.0.as_ref() }
    }
}

impl<T> Copy for ThisPtr<T> {}
impl<T> Clone for ThisPtr<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> core::ops::Deref for ThisPtr<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        self.get()
    }
}

// SAFETY: `BackRef<T, P>` is morally `&T` (Deref/get) with, for `P = Mut`, an
// unsafe `get_mut` escape hatch whose exclusivity is the caller's per-site
// obligation. Match `&T` auto-trait bounds: `&T: Send ⇔ T: Sync`,
// `&T: Sync ⇔ T: Sync`. Holders that additionally call `get_mut` across
// threads must separately ensure `T: Send` at the call site (no different
// from `NonNull<T>` today).
unsafe impl<T: ?Sized + Sync, P> Send for BackRef<T, P> {}
// SAFETY: `&BackRef<T, P>` only yields `&T` (via `get`/`Deref`); `&T: Sync`
// holds exactly when `T: Sync`, so sharing the back-reference across threads is
// sound.
unsafe impl<T: ?Sized + Sync, P> Sync for BackRef<T, P> {}

// ─────────────────────────────────────────────────────────────────────────────
// DetachablePtr<T> — scoped `&mut T` parked behind `&self` for re-entrant reads.
//
// Pattern: a Rust/C library hands a handler closure `&mut X` for the duration
// of one synchronous call; the handler needs to expose `X` to re-entrant code
// (JS host-fns) that can only reach it through `&self` on a long-lived wrapper.
// The handler erases the lifetime and parks the pointer with [`set`]; host-fns
// read it via [`get_mut`]; a scopeguard calls [`detach`] before the closure
// returns the borrow to the library. A detached slot reads as `None`, so a
// wrapper retained past its handler scope never reaches a dangling pointer.
//
// This is the `&mut`-yielding sibling of [`BackRef`]. Like `BackRef`, the
// safety obligation is a TYPE invariant discharged at the *set* site (not a
// per-`get` `unsafe` block): whoever parks a pointer must arrange the paired
// `detach()` before the original `&mut T` borrow ends, and every `get_mut()`
// caller consumes the result within its own synchronous frame without holding
// it across a call that could reach the same slot. Under that protocol the
// single `unsafe` in [`get_mut`] is sound; keeping it here (rather than at
// each host-fn call site) is the same centralisation trade-off `BackRef::get`
// / `LaunderedSelf::r` already make in this crate.
// ─────────────────────────────────────────────────────────────────────────────

/// A nullable slot for a lifetime-erased `&mut T` borrowed from an outer scope.
/// See the module comment above for the full protocol.
///
/// # Type invariant
/// Whenever the slot is non-null, the pointee is a live, exclusively-borrowed
/// `T` whose originating `&mut T` scope has not yet ended (the setter has
/// arranged a [`detach`](Self::detach) that runs before it does). Each
/// [`get_mut`](Self::get_mut) borrow is the sole live `&mut T` for its use —
/// callers take it once per host-fn body and never hold it across a re-entry
/// that could reach the same slot.
#[repr(transparent)]
pub struct DetachablePtr<T>(core::cell::Cell<*mut T>);

impl<T> DetachablePtr<T> {
    /// A detached (null) slot.
    #[inline]
    pub const fn null() -> Self {
        DetachablePtr(core::cell::Cell::new(core::ptr::null_mut()))
    }

    /// Construct with an initial parked pointer. Establishes the type
    /// invariant: `ptr` (if non-null) must satisfy the contract on [`set`].
    #[inline]
    pub const fn new(ptr: *mut T) -> Self {
        DetachablePtr(core::cell::Cell::new(ptr))
    }

    /// Park / retarget the slot. Safe: no reference is forged here. The type
    /// invariant is the caller's structural guarantee — `ptr` is the
    /// lifetime-erased address of a live `&mut T`, and a paired [`detach`]
    /// will run before that borrow ends.
    #[inline]
    pub fn set(&self, ptr: *mut T) {
        self.0.set(ptr);
    }

    /// Null the slot. After this, [`get_mut`] returns `None` and the wrapper's
    /// host-fns become harmless no-ops.
    #[inline]
    pub fn detach(&self) {
        self.0.set(core::ptr::null_mut());
    }

    /// `true` once [`detach`] has run (or the slot was never set).
    #[inline]
    pub fn is_detached(&self) -> bool {
        self.0.get().is_null()
    }

    /// Load the parked `&mut T`, or `None` if detached.
    ///
    /// # Safety (encapsulated)
    /// Sound under the `DetachablePtr` type invariant: a non-null load means
    /// the pointee is still inside the setter's live exclusive borrow — valid,
    /// aligned, and lent to nobody else. The unbounded `'a` is the caller's
    /// obligation per the invariant: consume within the current synchronous
    /// frame, never across a re-entry that could reach this slot.
    #[inline]
    pub fn get_mut<'a>(&self) -> Option<&'a mut T> {
        // SAFETY: `DetachablePtr` type invariant — non-null ⇒ pointee is a
        // live `&mut T` whose originating borrow has not ended; the paired
        // `detach()` nulls the slot before it does. Sole live `&mut` per call.
        unsafe { self.0.get().as_mut() }
    }
}

impl<T> Default for DetachablePtr<T> {
    #[inline]
    fn default() -> Self {
        Self::null()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AsCtxPtr — `&self` → `*mut Self` for FFI / C-callback ctx slots.
//
// Dual of [`callback_ctx`]: this is the *producer* side that stuffs `self`
// into a `void *user_data` / `*mut T` ctx parameter; `callback_ctx` (or a
// plain `unsafe { &*p }`) is the *consumer* side that recovers it inside the
// trampoline.
//
// The returned pointer carries **shared (read-only) provenance** — it is
// derived from `&self`, so writing through it directly is UB. The `*mut`
// spelling exists purely to match C-shaped signatures (`void *`, uSockets
// ext slots, `RefPtr::init_ref`, vtable thunks, intrusive
// `RefCount::deref`). Consumers must deref as `&*p` and route mutation
// through `Cell` / `JsCell` / `UnsafeCell` interior-mutability fields.
//
// Blanket-implemented for all `T`: bring the trait into scope with
// `use bun_ptr::AsCtxPtr;` and the inherent-looking `self.as_ctx_ptr()`
// resolves on any type.
// ─────────────────────────────────────────────────────────────────────────────

/// `&self` → `*mut Self` with shared provenance, for C-callback / scopeguard
/// ctx slots. See module-level comment above for the safety contract.
pub trait AsCtxPtr {
    /// `self`'s address as `*mut Self` for deferred-task / scopeguard /
    /// `RefPtr::init_ref` ctx slots. The closures/trampolines deref it as shared
    /// (`&*p`) — every method they reach is `&self` post-R-2, so no write
    /// provenance is required; the `*mut` spelling is purely to match the
    /// `HasAutoFlush` / `RefCount` ABI.
    #[inline(always)]
    fn as_ctx_ptr(&self) -> *mut Self
    where
        Self: Sized,
    {
        core::ptr::from_ref::<Self>(self).cast_mut()
    }
}
impl<T: ?Sized> AsCtxPtr for T {}

#[cfg(test)]
mod container_of_tests {
    //! The shapes `container_of` / `impl_field_parent!` are used in, kept
    //! Miri-clean under Tree Borrows (`bun run rust:miri`). Stacked Borrows
    //! rejects every reference-derived form by design; only
    //! `raw_place_projection` is defined under both models.
    use core::cell::{Cell, UnsafeCell};

    struct Parent {
        count: Cell<u32>,
        plain: u32,
        by_mut: ByMut,
        by_shared: UnsafeCell<ByShared>,
    }
    /// A `Freeze` child reached through `&mut self`.
    struct ByMut {
        hits: u32,
    }
    /// A `!Freeze` child reached through `&self`, itself sitting in an
    /// interior-mutable slot the parent writes through (the `JsCell` shape).
    struct ByShared {
        hits: Cell<u32>,
    }

    bun_core::impl_field_parent! { ByMut => Parent.by_mut; fn parent; fn mut parent_ptr; }
    bun_core::impl_field_parent! { ByShared => Parent.by_shared; fn shared parent; }

    impl Parent {
        fn boxed() -> *mut Parent {
            bun_core::heap::into_raw(Box::new(Parent {
                count: Cell::new(0),
                plain: 0,
                by_mut: ByMut { hits: 0 },
                by_shared: UnsafeCell::new(ByShared { hits: Cell::new(0) }),
            }))
        }
        /// Parent method that reaches back into the child it was called from.
        fn bump_shared_child(&self) {
            // SAFETY: single-threaded test; no `&mut ByShared` is live.
            unsafe {
                (*self.by_shared.get())
                    .hits
                    .set((*self.by_shared.get()).hits.get() + 1)
            };
            self.count.set(self.count.get() + 1);
        }
    }

    impl ByMut {
        fn touch(&mut self) {
            self.hits += 1;
            self.parent().count.set(10);
            // SAFETY: `plain` is disjoint from `by_mut`; deref at point of use.
            unsafe { (*self.parent_ptr()).plain = 20 };
            self.hits += 1;
        }
    }

    impl ByShared {
        fn touch(&self) {
            self.hits.set(1);
            self.parent().count.set(30);
            self.parent().bump_shared_child();
            assert_eq!(self.hits.get(), 2);
        }
    }

    #[test]
    fn raw_place_projection() {
        let p = Parent::boxed();
        // SAFETY: `p` is live; the field pointer keeps whole-`Parent` provenance.
        unsafe {
            let field = &raw mut (*p).by_mut;
            let back: *mut Parent = bun_core::from_field_ptr!(Parent, by_mut, field);
            assert!(core::ptr::eq(back, p));
            (*back).plain = 1;
            (*back).by_mut.hits = 1;
            assert_eq!(((*p).plain, (*p).by_mut.hits), (1, 1));
            drop(bun_core::heap::take(p));
        }
    }

    /// `&mut self` arms, called the way the runtime calls them: through a
    /// `&mut Parent` that is a protected function argument.
    #[test]
    fn mut_receiver_under_parent_borrow() {
        fn drive(parent: &mut Parent) {
            parent.by_mut.touch();
            assert_eq!(
                (parent.count.get(), parent.plain, parent.by_mut.hits),
                (10, 20, 2)
            );
        }
        let p = Parent::boxed();
        // SAFETY: `p` is live and uniquely owned here.
        unsafe {
            drive(&mut *p);
            drop(bun_core::heap::take(p));
        }
    }

    /// `shared` arm: `&self` on a `!Freeze` child, writing the parent's cells
    /// and letting the parent write back into the child mid-call.
    #[test]
    fn shared_receiver_with_reentrant_parent() {
        fn drive(parent: &Parent) {
            // SAFETY: single-threaded test; no `&mut ByShared` is live.
            unsafe { (*parent.by_shared.get()).touch() };
            assert_eq!(parent.count.get(), 31);
        }
        let p = Parent::boxed();
        // SAFETY: `p` is live.
        unsafe {
            drive(&*p);
            drop(bun_core::heap::take(p));
        }
    }

    #[test]
    fn freeze_detection() {
        use bun_core::__NotFreeze as _;
        const {
            assert!(<bun_core::__IsFreeze<ByMut>>::IS_FREEZE);
            assert!(!<bun_core::__IsFreeze<ByShared>>::IS_FREEZE);
            assert!(!<bun_core::__IsFreeze<Parent>>::IS_FREEZE);
            // Interior mutability behind a pointer does not count.
            assert!(<bun_core::__IsFreeze<Box<Cell<u32>>>>::IS_FREEZE);
        }
        bun_core::assert_not_freeze!(ByShared, Parent);
    }
}
