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
pub use external_shared::{ExternalShared, ExternalSharedDescriptor, ExternalSharedOptional, WTFString};

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
// Derive macros — same names as the traits (separate namespace). The derives
// expand to `::bun_ptr::…` paths, so this crate is the canonical re-export
// point: `#[derive(bun_ptr::CellRefCounted)]`.
pub use bun_core_macros::{CellRefCounted, ThreadSafeRefCounted};
// Compat aliases for Phase-A drafts that used pointer-typedef stubs.
pub type IntrusiveRc<T> = RefPtr<T>;
pub type IntrusiveArc<T> = RefPtr<T>;

pub use raw_ref_count::RawRefCount;
pub use weak_ptr::WeakPtr;

// Intrusive parent-from-field recovery — canonical helpers live in `bun_core`
// (lowest tier, every crate can reach them); re-exported here so callers can
// spell `bun_ptr::container_of` / `bun_ptr::from_field_ptr!`.
pub use bun_core::{container_of, container_of_const, from_field_ptr};

// C-callback `void *user_data` → `&mut T` recovery — same tiering rationale
// as `container_of`; canonical impl lives in `bun_core`, re-exported here so
// runtime crates spell `bun_ptr::callback_ctx::<T>(ctx)`.
pub use bun_core::callback_ctx;

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

    #[inline]
    pub const fn as_ptr(self) -> *mut T {
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

/// Detach a slice borrow from its borrowck lifetime.
///
/// This is the **local-variable** counterpart to [`RawSlice`]. Use it when you
/// need to read through a slice while a sibling field is reborrowed `&mut`
/// (the classic Zig `var buf = lockfile.buffers.string_bytes; … &mut lockfile`
/// pattern), and the backing storage is known not to move/realloc for the
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
/// `unsafe { &*(&raw const x) }` lifetime-laundering idiom that the Phase-A
/// port scattered everywhere a Zig `*const T` was held across a sibling
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
pub unsafe fn boxed_slices_as_borrowed<T>(s: &[Box<[T]>]) -> &[&[T]] {
    const {
        assert!(core::mem::size_of::<Box<[T]>>() == core::mem::size_of::<&[T]>());
        assert!(core::mem::align_of::<Box<[T]>>() == core::mem::align_of::<&[T]>());
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

/// Reinterpret a fn pointer between two ABI-identical signatures.
///
/// Rust forbids `as`-casting between fn-pointer types even when the only
/// difference is the pointee type of a `*mut T` parameter, so the Zig
/// `@ptrCast` of a comptime fn item has no direct safe spelling. This is the
/// single audited bit-cast for that pattern; callers state the source and
/// destination signatures explicitly. The const-assert below catches a
/// non-pointer-sized `F`/`G` at compile time — it does **not** verify that
/// `F`/`G` are fn-pointer types or that their arity/ABI match (all fn
/// pointers are pointer-sized regardless of arity); those remain caller
/// contract.
///
/// # Safety
/// `F` and `G` must be fn-pointer types with the **same calling convention,
/// arity, and ABI** — they may differ only in the nominal pointee type of
/// thin-pointer parameters that the callee casts back before use.
#[inline(always)]
pub const unsafe fn cast_fn_ptr<F: Copy, G: Copy>(f: F) -> G {
    const {
        assert!(core::mem::size_of::<F>() == core::mem::size_of::<fn()>());
        assert!(core::mem::size_of::<G>() == core::mem::size_of::<fn()>());
        // `read` below pulls a `G` out of a stack slot aligned for `F`; rule
        // out under-alignment so the bitcast stays defined even if a caller
        // smuggles in a non-fn-ptr `Copy` type.
        assert!(core::mem::align_of::<F>() == core::mem::align_of::<fn()>());
        assert!(core::mem::align_of::<G>() == core::mem::align_of::<fn()>());
    }
    // SAFETY: caller contract — `F` and `G` are ABI-identical fn pointers.
    // `read` of a pointer-sized `Copy` value through a same-size cast is the
    // bitwise reinterpretation `@ptrCast` performs.
    unsafe { (&raw const f).cast::<G>().read() }
}

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

// SAFETY: `RawSlice<T>` only ever vends `&[T]` (never `&mut [T]` / owned `T`),
// so its auto-trait bounds follow `&[T]` exactly: `&[T]: Send ⇔ T: Sync` and
// `&[T]: Sync ⇔ T: Sync`. The wrapped raw pointer carries no ownership.
unsafe impl<T: Sync> Send for RawSlice<T> {}
unsafe impl<T: Sync> Sync for RawSlice<T> {}

// ─────────────────────────────────────────────────────────────────────────────
// ThisPtr<T> — callback-dispatch self-pointer
//
// uSockets / C++ FFI dispatch hands every socket-event handler a raw
// `*mut Self` recovered from the userdata slot. The Phase-A port open-coded
// `unsafe { (*this).field }` / `unsafe { (&*this).ref_() }` /
// `scopeguard::guard(this, |p| unsafe { Self::deref(p) })` at ~90 call sites
// across the websocket-client family. `ThisPtr` centralises that pattern under
// ONE constructor SAFETY contract: wrap the raw pointer once at fn entry, then
// read fields via `Deref` and bracket the body with `ref_guard()` (RAII
// `ScopedRef`) instead of hand-paired `ref_()`/`deref()` at every early-exit.
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
/// [`ThisPtr::ref_guard`] for the keep-alive bracket.
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
    /// [`ref_guard`](Self::ref_guard). No `&mut T` to `*p` may be live across
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

impl<T: AnyRefCounted> ThisPtr<T>
where
    T::DestructorCtx: Default,
{
    /// Bump the intrusive refcount and return an RAII guard that derefs on
    /// `Drop`. Replaces the hand-rolled
    /// `this.ref_(); scopeguard::guard(this_ptr, |p| Self::deref(p))` /
    /// `this.ref_(); … defer this.deref()` bracket: the guard runs the paired
    /// `deref()` on every exit path, so manual `Self::deref(this)` at each
    /// early return goes away.
    ///
    /// Safe: the [`new`](Self::new) invariant already established that the
    /// pointee is live, which is exactly [`ScopedRef::new`]'s precondition.
    #[inline]
    pub fn ref_guard(self) -> ScopedRef<T> {
        // SAFETY: `ThisPtr::new` invariant — `self.0` points to a live `T`.
        unsafe { ScopedRef::new(self.0.as_ptr()) }
    }
}

// SAFETY: `BackRef<T>` is morally `&T` (Deref/get) with an unsafe `get_mut`
// escape hatch whose exclusivity is the caller's per-site obligation. Match
// `&T` auto-trait bounds: `&T: Send ⇔ T: Sync`, `&T: Sync ⇔ T: Sync`. Holders
// that additionally call `get_mut` across threads must separately ensure
// `T: Send` at the call site (no different from `NonNull<T>` today).
unsafe impl<T: ?Sized + Sync> Send for BackRef<T> {}
unsafe impl<T: ?Sized + Sync> Sync for BackRef<T> {}
