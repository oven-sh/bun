//! Centralized heap-pointer round-trip helpers.
//!
//! Zig's `bun.TrivialNew(@This())` / `bun.destroy(this)` / `bun.new(T, init)`
//! pattern was ported file-by-file as open-coded `Box::into_raw(Box::new(..))`
//! / `drop(Box::from_raw(..))` pairs (~1.8k occurrences). Per
//! `docs/RUST_PATTERNS.md` §5, every one of those is an unchecked ownership
//! transfer with the invariant restated in a `// SAFETY:` comment at every
//! site.
//!
//! These are **thin aliases** — they do not reduce per-site proof
//! obligations (each `take`/`destroy` is still its own `unsafe { }` block).
//! They exist for vocabulary consistency with the Zig spelling and as the
//! shared primitive *inside* the typed shims; they are NOT the safety
//! deliverable. The deliverable is the typed `Box<T>`-taking entry points
//! that own BOTH halves of the round-trip:
//!
//!   - `bun_threading::WorkPool::schedule_owned` / `OwnedTask`
//!   - `bun_event_loop::Task::from_boxed` / `ConcurrentTask::create_boxed`
//!   - `#[js_class]`-generated `T::to_js_boxed`
//!   - `bun_libuv_sys::UvHandle::set_owned_data` / `take_owned_data`
//!
//! New code should reach for one of those. Direct `heap::into_raw`/`heap::take`
//! calls are for the residual cases that don't fit a typed scheduler
//! (intrusive refcounts, self-referential payloads where the raw pointer is
//! observed after hand-off, FFI ownership protocols outside the four above).
//!
//! All four are `#[inline(always)]` no-ops — identical machine code to the
//! open-coded `Box::into_raw`/`from_raw`.

/// Heap-allocate `value` and return the raw pointer (Zig: `bun.new(T, init)` /
/// `bun.TrivialNew`). Ownership transfers to the caller; pair with [`destroy`]
/// or [`take`].
#[inline(always)]
pub fn alloc<T>(value: T) -> *mut T {
    Box::into_raw(Box::new(value))
}

#[inline(always)]
pub fn into_raw<T: ?Sized>(boxed: Box<T>) -> *mut T {
    Box::into_raw(boxed)
}

#[inline(always)]
pub fn release<'a, T: ?Sized + 'a>(boxed: Box<T>) -> &'a mut T {
    Box::leak(boxed)
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
    // `Box::leak` → `&mut T` → `NonNull::from`: zero unsafe, identical codegen
    // to `NonNull::new_unchecked(Box::into_raw(_))`.
    core::ptr::NonNull::from(Box::leak(Box::new(value)))
}

/// Hand off an existing `Box<T>` as a `NonNull<T>`. Type-preserving — works
/// for `Box<[T]>`, `Box<dyn Trait>`, etc. Pair with [`take`] or [`destroy`]
/// (via `.as_ptr()`). Zero-unsafe variant of `NonNull::new_unchecked(into_raw(b))`.
#[inline(always)]
pub fn into_raw_nn<T: ?Sized>(boxed: Box<T>) -> core::ptr::NonNull<T> {
    core::ptr::NonNull::from(Box::leak(boxed))
}
