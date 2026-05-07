//! Owned pointer abstractions.
//!
//! PORT NOTE: The Zig `Owned(comptime Pointer: type)` is a single type-returning function that
//! dispatches on `@typeInfo(Pointer)` (single-item vs slice, optional vs non-optional). Rust has
//! no `@typeInfo`, so the four shapes become four distinct std types per the crate map:
//!
//!   Zig                       Rust
//!   ───────────────────────   ──────────────────────────
//!   Owned(*T)                 Box<T>
//!   Owned([]T)                Box<[T]>   (or Vec<T> if it grows)
//!   Owned(?*T)                Option<Box<T>>
//!   Owned(?[]T)               Option<Box<[T]>>
//!   OwnedIn(P, Allocator)     Box<T> — allocator param deleted (global mimalloc)
//!   Dynamic(P)                Box<T> — std.mem.Allocator field deleted
//!   Unmanaged                 Box<T> — managed/unmanaged split disappears
//!
//! Phase-A callers should use the std types directly (PORTING.md §Pointers). This file exists so
//! `bun_ptr::owned::*` resolves and so the Zig API surface has a 1:1 diffable mapping comment.

use core::mem::ManuallyDrop;

use bun_alloc::AllocError;

use super::meta::{AddConst, PointerInfo}; // TODO(port): meta.zig helpers are @typeInfo-based; likely unused in Rust

/// An owned pointer or slice that was allocated using the default allocator.
///
/// This type is a wrapper around a pointer or slice of type `Pointer` that was allocated using
/// `bun.default_allocator`. Calling `deinit` on this type first calls `deinit` on the underlying
/// data, and then frees the memory.
///
/// `Pointer` can be a single-item pointer, a slice, or an optional version of either of those;
/// e.g., `Owned(*u8)`, `Owned([]u8)`, `Owned(?*u8)`, or `Owned(?[]u8)`.
///
/// This type is an alias of `OwnedIn(Pointer, bun.DefaultAllocator)`, and thus has no overhead
/// because `bun.DefaultAllocator` is a zero-sized type.
///
/// PORT NOTE: in Rust this is `Box<T>` / `Box<[T]>` / `Option<Box<_>>`. The alias below covers
/// only the `*T` (single, non-optional) case, which is the overwhelmingly common one. Slice and
/// optional callers use `Box<[T]>` / `Option<Box<T>>` directly.
pub type Owned<T> = Box<T>;
// TODO(port): Zig `Owned` accepts a *pointer type* (`*T`, `[]T`, `?*T`, `?[]T`) and branches on
// kind via @typeInfo. Rust generics cannot inspect "is T a slice / is T optional", so a single
// alias cannot cover all four. Phase B: audit call sites; they should already be `Box<T>` /
// `Box<[T]>` / `Option<Box<_>>` per PORTING.md §Pointers and LIFETIMES.tsv.

/// An owned pointer or slice allocated using any `std.mem.Allocator`.
///
/// This type is an alias of `OwnedIn(Pointer, std.mem.Allocator)`, and thus stores the
/// `std.mem.Allocator` at runtime.
///
/// PORT NOTE: Rust's global `#[global_allocator]` is mimalloc; per PORTING.md §Allocators the
/// `std.mem.Allocator` param/field is deleted entirely outside AST crates. `Dynamic` collapses
/// to `Box<T>`.
pub type Dynamic<T> = Box<T>;
// TODO(port): if any caller genuinely needs a runtime-chosen allocator (e.g. arena vs heap at
// runtime), that caller is in an AST crate and should use `bumpalo::boxed::Box<'bump, T>` or a
// bespoke enum — not this type. Audit in Phase B.

/// An owned pointer or slice, allocated using an instance of `Allocator`.
///
/// `Allocator` must be one of the following:
///
/// * `std.mem.Allocator`
/// * A type with a method named `allocator` that takes no parameters (except `self`) and returns
///   an instance of `std.mem.Allocator`.
///
/// If `Allocator` is a zero-sized type, the owned pointer has no overhead compared to a raw
/// pointer.
///
/// PORT NOTE: the `Allocator` type parameter is dropped — global mimalloc. See module doc.
pub type OwnedIn<T /*, Allocator */> = Box<T>;
// TODO(port): nightly `allocator_api` (`Box<T, A>`) would be the literal translation, but
// PORTING.md forbids it (delete allocator params). Keeping the alias single-param.

// ──────────────────────────────────────────────────────────────────────────────────────────────
// The block below mirrors the body of `fn OwnedIn(...) type { return struct { ... } }` so that
// Phase-B reviewers can diff method-by-method against owned.zig. Each Zig method is mapped to
// its `Box<T>` / `Box<[T]>` / `Option<Box<_>>` equivalent.
// ──────────────────────────────────────────────────────────────────────────────────────────────

// const Self = @This();
// const info = PointerInfo.parse(Pointer, .{});      → no @typeInfo; shape is encoded in the
//                                                       choice of std type at the call site
// const NonOptionalPointer = info.NonOptionalPointer; → `T` in `Option<Box<T>>`
// const Child = info.Child;                           → `T` in `Box<T>` / element of `Box<[T]>`
// const ConstPointer = AddConst(Pointer);             → `&T` / `&[T]`

// #pointer: Pointer,     → the Box itself (Box<T> IS the pointer)
// #allocator: Allocator, → deleted (global mimalloc; PORTING.md §Allocators)

// pub const Unmanaged = owned.Unmanaged(Pointer, Allocator);
//   → managed/unmanaged split disappears (no allocator field to elide). `Box<T>` is already
//     "unmanaged" in the Zig sense (no per-value allocator storage).

// ── alloc ────────────────────────────────────────────────────────────────────────────────────
// Allocates a new owned pointer with a default-initialized `Allocator`.
//
//   .single: alloc(value: Child) AllocError!Self
//     → Box::new(value)                         (infallible — aborts on OOM, same as bun.handleOom)
//     → Box::try_new(value)                     // TODO(port): nightly; use if AllocError must propagate
//
//   .slice:  alloc(count: usize, elem: Child) AllocError!Self   (shallow copies of `elem`)
//     → vec![elem; count].into_boxed_slice()    where Child: Clone
//
// PORT NOTE: Zig returns `AllocError!Self`; Rust `Box::new` aborts on OOM. PORTING.md says
// `bun.handleOom(expr)` → `expr`, so the fallible form is not needed at most call sites.

// ── allocIn ──────────────────────────────────────────────────────────────────────────────────
// Allocates a new owned pointer with the given allocator.
//
//   .single: allocIn(value, allocator)  → Box::new(value)        (allocator param deleted)
//   .slice:  allocIn(count, elem, allocator)
//     → vec![elem; count].into_boxed_slice()                     (allocator param deleted)
//
// The Zig body does `bun.memory.create` / `allocator.alloc` + `@memset`. In Rust the vec! macro
// handles both allocation and fill.

// ── new ──────────────────────────────────────────────────────────────────────────────────────
// Allocates an owned pointer for a single item, and calls `bun.outOfMemory` if allocation fails.
//   new(value: Child) Self
//     → Box::new(value)

// ── allocDupe ────────────────────────────────────────────────────────────────────────────────
// Creates an owned pointer by allocating memory and performing a shallow copy of `data`.
//   allocDupe(data: ConstPointer) AllocError!Self
//     .single:   → Box::new(data.clone())            // or Box::new(*data) if Copy
//     .slice:    → Box::<[T]>::from(data)            // == data.to_vec().into_boxed_slice()
//     optional:  → data.map(|d| Box::<[T]>::from(d))

// ── allocDupeIn ──────────────────────────────────────────────────────────────────────────────
//   allocDupeIn(data, allocator) → same as allocDupe; allocator param deleted.

// ── fromRaw ──────────────────────────────────────────────────────────────────────────────────
// Creates an owned pointer from a raw pointer.
//   fromRaw(data: Pointer) Self
//     .single:   → unsafe { Box::from_raw(data) }
//     .slice:    → unsafe { Box::from_raw(core::ptr::slice_from_raw_parts_mut(ptr, len)) }
//                  or, when `data` came from `Vec::into_raw_parts`:
//                  unsafe { Vec::from_raw_parts(ptr, len, cap) }.into_boxed_slice()
//     optional:  → if data.is_null() { None } else { Some(unsafe { Box::from_raw(data) }) }
//
// PORT NOTE: the Zig doc's caveat about `bun.new` vs `bun.default_allocator.create` is the
// typed-mimalloc-heap distinction; in Rust both paths go through the same `#[global_allocator]`,
// so the caveat does not apply.

// ── fromRawIn ────────────────────────────────────────────────────────────────────────────────
//   fromRawIn(data, allocator) → same as fromRaw; allocator param deleted.
//   Zig sets `#allocator = undefined` when optional+null — irrelevant in Rust (no field).

// ── deinit ───────────────────────────────────────────────────────────────────────────────────
// Calls `deinit` on the underlying data (pointer target or slice elements) and then frees.
//   deinit(self: *Self) void
//     → drop(boxed)                              (implicit at scope exit; see PORTING.md §Idiom)
//   `deinit` on the allocator → no-op (no allocator field).

// ── deinitShallow ────────────────────────────────────────────────────────────────────────────
// Frees the memory without calling `deinit` on the underlying data.
//   deinitShallow(self: *Self) void
//     → let _ = Box::into_raw(ManuallyDrop::into_inner(/* ... */));
//   PORT NOTE: "free the box allocation but don't drop T" is unusual in Rust. The two real uses:
//     (a) T has no Drop → plain `drop(boxed)` is already shallow.
//     (b) caller moved the payload out first → use `*boxed` to move out, then `drop(boxed)`.
//   If a literal "dealloc without dropping" is needed:
//     unsafe {
//         let raw = Box::into_raw(boxed);
//         core::ptr::drop_in_place(raw as *mut ManuallyDrop<T>); // no-op
//         alloc::alloc::dealloc(raw.cast(), Layout::new::<T>());
//     }
//   // TODO(port): audit callers of deinitShallow; likely all fall under (a) or (b).

// ── get ──────────────────────────────────────────────────────────────────────────────────────
// Returns the inner pointer or slice.
//   get(self: Self) Pointer
//     .single:   → &*boxed / &mut *boxed         (Deref/DerefMut)
//     .slice:    → &boxed[..] / &mut boxed[..]
//     optional:  → opt.as_deref() / opt.as_deref_mut()

// ── intoRaw ──────────────────────────────────────────────────────────────────────────────────
// Converts an owned pointer into a raw pointer, releasing ownership.
//   intoRaw(self: *Self) Pointer
//     .single:   → Box::into_raw(boxed)
//     .slice:    → Box::into_raw(boxed)          (yields *mut [T]; use .as_mut_ptr()/.len())
//     optional:  → opt.map(Box::into_raw).unwrap_or(core::ptr::null_mut())
//   `bun.memory.deinit(&self.#allocator)` → no-op.

// ── PointerAndAllocator / intoRawWithAllocator ───────────────────────────────────────────────
//   intoRawWithAllocator(self: *Self) (Pointer, Allocator) | ?(NonOptionalPointer, Allocator)
//     → Box::into_raw(boxed)                     (allocator dropped from tuple)
//   // TODO(port): if any caller actually inspects the returned allocator, it needs rethinking.

// ── initNull ─────────────────────────────────────────────────────────────────────────────────
// Returns a null owned pointer (only when `Pointer` is optional).
//   initNull() Self
//     → None::<Box<T>>

// ── take ─────────────────────────────────────────────────────────────────────────────────────
// Converts an `Owned(?T)` into an `?Owned(T)`, leaving `self` null.
//   take(self: *Self) ?OwnedNonOptional
//     → opt.take()                               (Option::take — identical semantics)

// ── reset ────────────────────────────────────────────────────────────────────────────────────
// Like `deinit`, but sets `self` to null instead of invalidating it.
//   reset(self: *Self) void
//     → *opt = None;                             (drops the old Box, leaves None)

// ── toOptional ───────────────────────────────────────────────────────────────────────────────
// Converts an `Owned(T)` into a non-null `Owned(?T)`.
//   toOptional(self: *Self) OwnedOptional
//     → Some(boxed)

// ── toUnmanaged ──────────────────────────────────────────────────────────────────────────────
// Converts to an unmanaged variant that doesn't store the allocator.
//   toUnmanaged(self: *Self) Self.Unmanaged
//     → boxed                                    (identity; no allocator field to drop)

// ── toDynamic ────────────────────────────────────────────────────────────────────────────────
// Converts a fixed-allocator owned pointer into one storing `std.mem.Allocator`.
//   toDynamic(self: *Self) Dynamic(Pointer)
//     → boxed                                    (identity; allocator type erased → deleted)
//   The `@hasDecl(Allocator, "Borrowed")` compile-time check has no Rust analogue and is
//   unnecessary once the allocator param is gone.

// ── allocator ────────────────────────────────────────────────────────────────────────────────
// Returns a borrowed version of the allocator.
//   allocator(self: Self) MaybeAllocator
//     → ()                                       (no allocator stored)
//   // TODO(port): callers should be deleted along with the allocator threading.

// ── getStdAllocator (private) ────────────────────────────────────────────────────────────────
//   → deleted.

// ── deinitImpl (private) ─────────────────────────────────────────────────────────────────────
//   deinitImpl(self, comptime mode: enum { deep, shallow })
//     .deep    → drop(boxed)
//     .shallow → see deinitShallow above
//   The `info.kind()` switch (`bun.memory.destroy` vs `allocator.free`) is subsumed by Box's
//   Drop impl, which knows its own Layout.

// ──────────────────────────────────────────────────────────────────────────────────────────────
// fn Unmanaged(comptime Pointer: type, comptime Allocator: type) type
// ──────────────────────────────────────────────────────────────────────────────────────────────

/// An unmanaged version of `OwnedIn(Pointer, Allocator)` that doesn't store the allocator.
///
/// If `Allocator` is a zero-sized type, there is no benefit to using this type. Just use a
/// normal owned pointer, which has no overhead in this case.
///
/// This type is accessible as `OwnedIn(Pointer, Allocator).Unmanaged`.
///
/// PORT NOTE: managed/unmanaged collapses; both are `Box<T>`.
pub type Unmanaged<T /*, Allocator */> = Box<T>;

// #pointer: Pointer,  → the Box itself
// const Managed = OwnedIn(Pointer, Allocator);  → Box<T>

// ── toManaged ────────────────────────────────────────────────────────────────────────────────
//   toManaged(self: *Self, allocator: Allocator) Managed
//     → boxed                                    (identity; allocator param deleted)

// ── deinit ───────────────────────────────────────────────────────────────────────────────────
//   deinit(self: *Self, allocator: Allocator) void
//     → drop(boxed)                              (allocator param deleted)

// ── get ──────────────────────────────────────────────────────────────────────────────────────
//   get(self: Self) Pointer
//     → &*boxed / &boxed[..]

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Convenience free functions for the slice / optional shapes that the `Owned<T> = Box<T>` alias
// cannot express. These give Phase-B a landing spot if a generic helper is wanted; otherwise
// callers use the std forms inline.
// ──────────────────────────────────────────────────────────────────────────────────────────────

/// `Owned([]T).alloc(count, elem)` → `vec![elem; count].into_boxed_slice()`
#[inline]
pub fn alloc_slice<T: Clone>(count: usize, elem: T) -> Box<[T]> {
    // PERF(port): Zig used allocator.alloc + @memset (no per-elem clone for Copy types).
    vec![elem; count].into_boxed_slice()
}

/// `Owned([]T).allocDupe(data)` → `Box::<[T]>::from(data)`
#[inline]
pub fn alloc_dupe_slice<T: Clone>(data: &[T]) -> Box<[T]> {
    Box::<[T]>::from(data)
}

/// `Owned(*T).fromRaw(ptr)` → `unsafe { Box::from_raw(ptr) }`
///
/// # Safety
/// `data` must have been produced by `Box::into_raw` (or equivalently allocated via the global
/// allocator with the layout of `T`) and must not be freed elsewhere for the life of the
/// returned `Box`.
#[inline]
pub unsafe fn from_raw<T>(data: *mut T) -> Box<T> {
    // SAFETY: caller contract above mirrors Zig `fromRaw` requirements.
    unsafe { Box::from_raw(data) }
}

/// `Owned(*T).intoRaw()` → `Box::into_raw(boxed)`
#[inline]
pub fn into_raw<T>(boxed: Box<T>) -> *mut T {
    Box::into_raw(boxed)
}

// Suppress unused-import warnings until Phase B prunes.
#[allow(unused_imports)]
use {AddConst as _, AllocError as _, ManuallyDrop as _, PointerInfo as _};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/owned.zig (428 lines)
//   confidence: medium
//   todos:      6
//   notes:      Owned/OwnedIn/Dynamic/Unmanaged all collapse to Box<T> per crate map; @typeInfo dispatch on pointer kind has no Rust analogue so slice/optional shapes use Box<[T]>/Option<Box<T>> directly at call sites. Phase B: delete this module once callers are migrated, or keep as doc-only.
// ──────────────────────────────────────────────────────────────────────────
