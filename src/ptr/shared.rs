//! Shared (reference-counted) pointers.
//!
//! `std::rc::Rc<T>` and `bun.ptr.AtomicShared(*T)` → `std::sync::Arc<T>` directly,
//! and explicitly forbids introducing a custom `bun_core::ptr::Shared<T>` to shave the
//! weak-count header word ("4 uses tree-wide, 8 bytes per allocation is negligible,
//! and you lose `Rc::downgrade`/`make_mut`/`get_mut`").
//!
//! This module therefore re-exports `Rc`/`Arc`/`Weak` under the legacy names so that
//! mechanical `bun_core::ptr::shared::*` references resolve, and documents the 1:1 method
//! mapping.

use std::rc::Rc;

// ───────────────────────────────────────────────────────────────────────────────
// Options
// ───────────────────────────────────────────────────────────────────────────────

// The legacy `Options` struct (the parameter of `WithOptions`) has no Rust value:
// each knob collapses to a std `Rc`/`Arc` choice made at the use site.
//
// * `Allocator` — std `Rc`/`Arc` always use the global allocator (mimalloc via
//   `#[global_allocator]`). `Rc::new_in`/`Arc::new_in` are nightly-only
//   (`feature(allocator_api)`).
// * `atomic` — picks `Rc` vs `Arc`.
// * `allow_weak` — `Rc`/`Arc` always carry a weak count, so this is always
//   effectively `true`.
// * `deinit` — `Rc`/`Arc` always run `Drop` on the inner `T`. To suppress
//   `Drop`, wrap the payload in `ManuallyDrop<T>` at the call site.

// ───────────────────────────────────────────────────────────────────────────────
// Shared / AtomicShared
// ───────────────────────────────────────────────────────────────────────────────

/// `Option<Rc<T>>` is one word).
///
/// This type is not thread-safe: all pointers to the same piece of data must live on the same
/// thread. See `AtomicShared` for a thread-safe version.
///
/// ## Method map (legacy → Rust)
///
/// | Legacy                      | Rust                                          |
/// |-----------------------------|-----------------------------------------------|
/// | `Shared(*T).alloc(v)`       | `Rc::new(v)` (infallible; aborts on OOM)      |
/// | `Shared(*T).allocIn(v, a)`  | — (allocator_api unstable; allocator deleted) |
/// | `Shared(*T).new(v)`         | `Rc::new(v)`                                  |
/// | `s.get()`                   | `&*s` / `Rc::as_ptr(&s)`                      |
/// | `s.clone()`                 | `Rc::clone(&s)`                               |
/// | `s.cloneWeak()`             | `Rc::downgrade(&s)`                           |
/// | `s.deinit()`                | `drop(s)` (implicit at scope exit)            |
/// | `Shared(?*T).initNull()`    | `None::<Rc<T>>`                               |
/// | `s.take()`                  | `Option::take` on `Option<Rc<T>>`             |
/// | `s.toOptional()`            | `Some(s)`                                     |
/// | `s.strongCount()`           | `Rc::strong_count(&s)`                        |
/// | `s.weakCount()`             | `Rc::weak_count(&s)`                          |
/// | `s.leak()`                  | `Rc::into_raw(s)`                             |
/// | `Self.adoptRawUnsafe(p)`    | `unsafe { Rc::from_raw(p) }`                  |
/// | `Self.cloneFromRawUnsafe(p)`| `unsafe { Rc::increment_strong_count(p); Rc::from_raw(p) }` |
///
pub type Shared<T> = Rc<T>;

/// A shared pointer allocated using a specific type of allocator.
///
/// The requirements for `Allocator` are the same as `bun.ptr.OwnedIn`.
//

/// A thread-safe shared pointer allocated using a specific type of allocator.
//

/// Like `Shared`, but takes explicit options.
//

// ───────────────────────────────────────────────────────────────────────────────
// Weak
// ───────────────────────────────────────────────────────────────────────────────

/// A weak pointer.
///
/// Weak pointers must be upgraded to strong pointers before the shared data can be
/// accessed. This upgrading can fail if no shared pointers exist anymore, as the shared
/// data will have been deinitialized in that case.
///
/// ## Method map (legacy → Rust)
///
/// | Legacy               | Rust                                  |
/// |----------------------|---------------------------------------|
/// | `w.upgrade()`        | `w.upgrade()` (→ `Option<Rc<T>>`)     |
/// | `w.clone()`          | `w.clone()`                           |
/// | `w.deinit()`         | `drop(w)`                             |
/// | `Weak.initNull()`    | `Weak::new()` (dangling) or `None`    |
/// | `w.isNull()`         | `Option::is_none` / `w.ptr_eq(&Weak::new())` |
/// | `w.strongCount()`    | `w.strong_count()`                    |
/// | `w.weakCount()`      | `w.weak_count()`                      |
pub type Weak<T> = std::rc::Weak<T>;

// ───────────────────────────────────────────────────────────────────────────────
// FullData / NonAtomicCount / AtomicCount
// ───────────────────────────────────────────────────────────────────────────────
//
// The legacy `FullData` struct (value + strong_count + weak_count + allocator +
// thread_lock) is the moral equivalent of `RcInner<T>` / `ArcInner<T>` in std,
// which are private implementation details. We do not re-implement them.
//
// `NonAtomicCount` ↔ `Cell<usize>` inside `RcInner`.
// `AtomicCount`    ↔ `AtomicUsize` inside `ArcInner` (with the same
//                    `.monotonic` increment / `.acq_rel` decrement ordering and
//                    the same CAS-loop `try_increment` for `Weak::upgrade`).
//
// The `thread_lock: bun.safety.ThreadLock` debug-assertion that a non-atomic
// `Shared` is only touched from one thread is enforced statically in Rust by
// `Rc<T>: !Send + !Sync`.
//
// The `fromValuePtr` (`@fieldParentPtr("value", ptr)`) recovery is provided by
// `Rc::from_raw` / `Arc::from_raw`, which subtract the header offset internally.

// `RawCount` was `u32`; std uses `usize`. The overflow assertion
// (`old != maxInt(RawCount)`) is replaced by std's own abort-on-overflow check
// in `Arc::clone` (it aborts if the count would exceed `isize::MAX`).

// `parsePointer` (reflection over `*T` / `?*T`) has no Rust
// analogue and is not needed: optionality is expressed at the use site as
// `Option<Rc<T>>`, and slices/const are rejected by the type system rather than
// a compile-time check.
