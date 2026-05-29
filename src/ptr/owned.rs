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
//! Callers should use the std types directly (PORTING.md §Pointers). This file exists so
//! `bun_ptr::owned::*` resolves and so the Zig API surface has a 1:1 diffable mapping comment.

pub type Owned<T> = Box<T>;

/// `std.mem.Allocator` param/field is deleted entirely outside AST crates. `Dynamic` collapses
/// to `Box<T>`.
pub type Dynamic<T> = Box<T>;
// TODO(port): if any caller genuinely needs a runtime-chosen allocator (e.g. arena vs heap at
// runtime), that caller is in an AST crate and should use `bumpalo::boxed::Box<'bump, T>` or a
// bespoke enum — not this type. Audit call sites if one appears.

pub type OwnedIn<T /*, Allocator */> = Box<T>;
// TODO(port): nightly `allocator_api` (`Box<T, A>`) would be the literal translation, but
// PORTING.md forbids it (delete allocator params). Keeping the alias single-param.

// #pointer: Pointer,     → the Box itself (Box<T> IS the pointer)
// #allocator: Allocator, → deleted (global mimalloc; PORTING.md §Allocators)

// pub const Unmanaged = owned.Unmanaged(Pointer, Allocator);
//   → managed/unmanaged split disappears (no allocator field to elide). `Box<T>` is already
//     "unmanaged" in the Zig sense (no per-value allocator storage).

// ── allocDupeIn ──────────────────────────────────────────────────────────────────────────────
//   allocDupeIn(data, allocator) → same as allocDupe; allocator param deleted.

// ── fromRawIn ────────────────────────────────────────────────────────────────────────────────
//   fromRawIn(data, allocator) → same as fromRaw; allocator param deleted.
//   Zig sets `#allocator = undefined` when optional+null — irrelevant in Rust (no field).

// ── getStdAllocator (private) ────────────────────────────────────────────────────────────────
//   → deleted.

// ──────────────────────────────────────────────────────────────────────────────────────────────
// fn Unmanaged(comptime Pointer: type, comptime Allocator: type) type
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

#[inline]
pub fn alloc_slice<T: Clone>(count: usize, elem: T) -> Box<[T]> {
    // PERF(port): Zig used allocator.alloc + @memset (no per-elem clone for Copy types).
    vec![elem; count].into_boxed_slice()
}

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
    // SAFETY: caller contract above mirrors Zig `fromRaw` requirements.
    unsafe { bun_core::heap::take(data) }
}

/// `Owned(*T).intoRaw()` → `bun_core::heap::into_raw(boxed)`
#[inline]
pub fn into_raw<T>(boxed: Box<T>) -> *mut T {
    bun_core::heap::into_raw(boxed)
}

// Suppress unused-import warnings until the unused helpers are pruned.

// ported from: src/ptr/owned.zig
