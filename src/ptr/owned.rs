//! Owned pointer abstractions.
//!
//! The four pointer shapes (single-item vs slice, optional vs non-optional) map to
//! four distinct std types per the crate map:
//!
//!   legacy shape              Rust type
//!   ------------------------  ---------
//!   Owned(*T)                 Box<T>
//!   Owned([]T)                Box<[T]>   (or Vec<T> if it grows)
//!   Owned(?*T)                Option<Box<T>>
//!   Owned(?[]T)               Option<Box<[T]>>
//!   OwnedIn(P, Allocator)     Box<T> — allocator param deleted (global mimalloc)
//!   Dynamic(P)                Box<T> — allocator field deleted
//!   Unmanaged                 Box<T> — managed/unmanaged split disappears
//!
//! `bun_core::ptr::owned::*` resolves and so the API surface has a 1:1 diffable mapping comment.

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
/// In Rust this is `Box<T>` / `Box<[T]>` / `Option<Box<_>>`. The alias below covers
/// only the `*T` (single, non-optional) case, which is the overwhelmingly common one. Slice and
pub type Owned<T> = Box<T>;

/// The runtime-allocator param/field is deleted entirely outside AST crates. `Dynamic` collapses
/// to `Box<T>`.
pub type Dynamic<T> = Box<T>;
// A caller that genuinely needs a runtime-chosen allocator (e.g. arena vs heap at runtime)
// belongs in an AST crate and should use `bumpalo::boxed::Box<'bump, T>` or a bespoke enum —
// not this type.

/// An owned pointer or slice, allocated using an instance of `Allocator`.
///
/// The `Allocator` type parameter is dropped — global mimalloc. See module doc.
pub type OwnedIn<T /*, Allocator */> = Box<T>;
// Nightly `allocator_api` (`Box<T, A>`) would be the literal translation, but PORTING.md
// forbids it (delete allocator params), so the alias stays single-param.

// ──────────────────────────────────────────────────────────────────────────────────────────────
// The block below maps each method of the original `OwnedIn` API to
// its `Box<T>` / `Box<[T]>` / `Option<Box<_>>` equivalent.
// ──────────────────────────────────────────────────────────────────────────────────────────────

// const Self = @This();
// const info = PointerInfo.parse(Pointer, .{});      → no @typeInfo; shape is encoded in the
//                                                       choice of std type at the call site
// const NonOptionalPointer = info.NonOptionalPointer; → `T` in `Option<Box<T>>`
// const Child = info.Child;                           → `T` in `Box<T>` / element of `Box<[T]>`
// const ConstPointer = AddConst(Pointer);             → `&T` / `&[T]`

// #pointer: Pointer,     → the Box itself (Box<T> IS the pointer)

// pub const Unmanaged = owned.Unmanaged(Pointer, Allocator);
//   → managed/unmanaged split disappears (no allocator field to elide). `Box<T>` is already
//     "unmanaged" (no per-value allocator storage).

// ── alloc ────────────────────────────────────────────────────────────────────────────────────
// Allocates a new owned pointer with a default-initialized `Allocator`.
//
//   .single: alloc(value: Child) AllocError!Self
//     → Box::new(value)                         (infallible — aborts on OOM, same as bun.handleOom)
//     → Box::try_new(value)                     // nightly-only; would apply if AllocError must propagate
//
//   .slice:  alloc(count: usize, elem: Child) AllocError!Self   (shallow copies of `elem`)
//     → vec![elem; count].into_boxed_slice()    where Child: Clone
//
// `Box::new` aborts on OOM. PORTING.md says
// `bun.handleOom(expr)` → `expr`, so the fallible form is not needed at most call sites.

// ── allocIn ──────────────────────────────────────────────────────────────────────────────────
// Allocates a new owned pointer with the given allocator.
//
//   .single: allocIn(value, allocator)  → Box::new(value)        (allocator param deleted)
//   .slice:  allocIn(count, elem, allocator)
//     → vec![elem; count].into_boxed_slice()                     (allocator param deleted)
//
// The vec! macro handles both allocation and fill.

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
//     .single:   → unsafe { bun_core::heap::take(data) }
//     .slice:    → unsafe { bun_core::heap::take(core::ptr::slice_from_raw_parts_mut(ptr, len)) }
//                  or, when `data` came from `Vec::into_raw_parts`:
//                  unsafe { Vec::from_raw_parts(ptr, len, cap) }.into_boxed_slice()
//     optional:  → if data.is_null() { None } else { Some(unsafe { bun_core::heap::take(data) }) }

// ── fromRawIn ────────────────────────────────────────────────────────────────────────────────
//   fromRawIn(data, allocator) → same as fromRaw; allocator param deleted.

// ── deinit ───────────────────────────────────────────────────────────────────────────────────
// Calls `deinit` on the underlying data (pointer target or slice elements) and then frees.
//   deinit(self: *Self) void
//   `deinit` on the allocator → no-op (no allocator field).

// ── deinitShallow ────────────────────────────────────────────────────────────────────────────
// Frees the memory without calling `deinit` on the underlying data.
//   deinitShallow(self: *Self) void
//     → let _ = bun_core::heap::into_raw(ManuallyDrop::into_inner(/* ... */));
//   "Free the box allocation but don't drop T" is unusual in Rust. The two real uses:
//     (a) T has no Drop → plain `drop(boxed)` is already shallow.
//     (b) caller moved the payload out first → use `*boxed` to move out, then `drop(boxed)`.
//   If a literal "dealloc without dropping" is needed:
//     unsafe {
//         let raw = bun_core::heap::into_raw(boxed);
//         core::ptr::drop_in_place(raw as *mut ManuallyDrop<T>); // no-op
//         alloc::alloc::dealloc(raw.cast(), Layout::new::<T>());
//     }

// ── get ──────────────────────────────────────────────────────────────────────────────────────
// Returns the inner pointer or slice.
//   get(self: Self) Pointer
//     .single:   → &*boxed / &mut *boxed         (Deref/DerefMut)
//     .slice:    → &boxed[..] / &mut boxed[..]
//     optional:  → opt.as_deref() / opt.as_deref_mut()

// ── intoRaw ──────────────────────────────────────────────────────────────────────────────────
// Converts an owned pointer into a raw pointer, releasing ownership.
//   intoRaw(self: *Self) Pointer
//     .single:   → bun_core::heap::into_raw(boxed)
//     .slice:    → bun_core::heap::into_raw(boxed)          (yields *mut [T]; use .as_mut_ptr()/.len())
//     optional:  → opt.map(bun_core::heap::into_raw).unwrap_or(core::ptr::null_mut())
//   `bun.memory.deinit(&self.#allocator)` → no-op.

// ── PointerAndAllocator / intoRawWithAllocator ───────────────────────────────────────────────
//   intoRawWithAllocator(self: *Self) (Pointer, Allocator) | ?(NonOptionalPointer, Allocator)
//     → bun_core::heap::into_raw(boxed)                     (allocator dropped from tuple)

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
// Converts a fixed-allocator owned pointer into one storing a runtime allocator handle.
//   toDynamic(self: *Self) Dynamic(Pointer)
//     → boxed                                    (identity; allocator type erased → deleted)
//   The `@hasDecl(Allocator, "Borrowed")` compile-time check has no Rust analogue and is
//   unnecessary once the allocator param is gone.

// ── allocator ────────────────────────────────────────────────────────────────────────────────
// Returns a borrowed version of the allocator.
//   allocator(self: Self) MaybeAllocator
//     → ()                                       (no allocator stored)

// ── getStdAllocator (private) ────────────────────────────────────────────────────────────────
//   → deleted.

// ── deinitImpl (private) ─────────────────────────────────────────────────────────────────────
//   deinitImpl(self, mode: { deep, shallow })
//     .deep    → drop(boxed)
//     .shallow → see deinitShallow above
//   The `info.kind()` switch (`bun.memory.destroy` vs `allocator.free`) is subsumed by Box's
//   Drop impl, which knows its own Layout.

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Unmanaged(Pointer, Allocator)
// ──────────────────────────────────────────────────────────────────────────────────────────────

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
// cannot express. These provide a landing spot if a generic helper is wanted; otherwise
// callers use the std forms inline.
// ──────────────────────────────────────────────────────────────────────────────────────────────

#[inline]
pub fn alloc_slice<T: Clone>(count: usize, elem: T) -> Box<[T]> {
    vec![elem; count].into_boxed_slice()
}

/// `Owned([]T).allocDupe(data)` → `Box::<[T]>::from(data)`
///
/// Shallow-copies `data` into a freshly heap-allocated boxed slice.
/// For empty input this returns a zero-length `Box` with a dangling
/// pointer and **no allocation** — identical to `Box::<[T]>::default()`,
/// so callers MUST NOT add their own `is_empty()` guard — empty boxed
/// slices are non-allocating.
#[inline]
pub fn alloc_dupe_slice<T: Clone>(data: &[T]) -> Box<[T]> {
    Box::<[T]>::from(data)
}

/// `Owned(*T).fromRaw(ptr)` → `bun_core::heap::take(ptr)`
///
/// # Safety
/// `data` must have been produced by `bun_core::heap::into_raw`/`alloc` (or
/// equivalently allocated via the global allocator with the layout of `T`)
/// and must not be freed elsewhere for the life of the returned `Box`.
#[inline]
pub unsafe fn from_raw<T>(data: *mut T) -> Box<T> {
    // SAFETY: caller contract above.
    unsafe { bun_core::heap::take(data) }
}

/// `Owned(*T).intoRaw()` → `bun_core::heap::into_raw(boxed)`
#[inline]
pub fn into_raw<T>(boxed: Box<T>) -> *mut T {
    bun_core::heap::into_raw(boxed)
}

// Suppress unused-import warnings until the unused helpers are pruned.
