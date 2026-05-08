//! Centralized heap-pointer round-trip helpers.
//!
//! Zig's `bun.TrivialNew(@This())` / `bun.destroy(this)` / `bun.new(T, init)`
//! pattern was ported file-by-file as open-coded `Box::into_raw(Box::new(..))`
//! / `drop(Box::from_raw(..))` pairs (~1.8k occurrences). Per
//! `docs/RUST_PATTERNS.md` §5, every one of those is an unchecked ownership
//! transfer with the invariant restated in a `// SAFETY:` comment at every
//! site.
//!
//! This module is the **single** place that performs the `Box` ↔ `*mut T`
//! round-trip. Callers spell their intent (`alloc` / `leak` / `take` /
//! `destroy`) instead of the mechanism, and the `unsafe` block lives once
//! here. Schedulers (`WorkPool`, `ConcurrentTask`, libuv handle data, JSC
//! finalizers) build their typed `Box<T>`-taking APIs on top of these.
//!
//! All four are `#[inline(always)]` `repr(transparent)`-level no-ops — they
//! compile to the exact same machine code as the open-coded form.

/// Heap-allocate `value` and return the raw pointer (Zig: `bun.new(T, init)` /
/// `bun.TrivialNew`). Ownership transfers to the caller; pair with [`destroy`]
/// or [`take`].
#[inline(always)]
pub fn alloc<T>(value: T) -> *mut T {
    Box::into_raw(Box::new(value))
}

/// Leak an existing `Box<T>` to its raw pointer. Type-preserving — works for
/// `Box<[T]>`, `Box<dyn Trait>`, etc. Pair with [`take`] or [`destroy`].
#[inline(always)]
pub fn leak<T: ?Sized>(boxed: Box<T>) -> *mut T {
    Box::into_raw(boxed)
}

/// Reclaim ownership of a heap allocation previously produced by [`alloc`] /
/// [`leak`] (or any `Box::into_raw`).
///
/// # Safety
/// `ptr` must be the unique live pointer to a `Box<T>` allocation that has
/// not yet been [`take`]n or [`destroy`]ed.
#[inline(always)]
pub unsafe fn take<T: ?Sized>(ptr: *mut T) -> Box<T> {
    // SAFETY: caller contract above.
    unsafe { Box::from_raw(ptr) }
}

/// Drop a heap allocation previously produced by [`alloc`] / [`leak`]
/// (Zig: `bun.destroy(this)` / `bun.TrivialDeinit`).
///
/// # Safety
/// Same as [`take`].
#[inline(always)]
pub unsafe fn destroy<T: ?Sized>(ptr: *mut T) {
    // SAFETY: caller contract above.
    drop(unsafe { Box::from_raw(ptr) });
}

/// Heap-allocate `value` and return a `NonNull<T>`. Convenience for struct
/// fields typed `NonNull<T>` (per `docs/LIFETIMES.tsv` BACKREF/INTRUSIVE).
#[inline(always)]
pub fn alloc_nn<T>(value: T) -> core::ptr::NonNull<T> {
    // SAFETY: `Box::into_raw` never returns null.
    unsafe { core::ptr::NonNull::new_unchecked(alloc(value)) }
}
