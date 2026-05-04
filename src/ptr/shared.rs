//! Shared (reference-counted) pointers.
//!
//! Per `docs/PORTING.md` §Pointers, the Rust port maps `bun.ptr.Shared(*T)` →
//! `std::rc::Rc<T>` and `bun.ptr.AtomicShared(*T)` → `std::sync::Arc<T>` directly,
//! and explicitly forbids introducing a custom `bun_ptr::Shared<T>` to shave the
//! weak-count header word ("4 uses tree-wide, 8 bytes per allocation is negligible,
//! and you lose `Rc::downgrade`/`make_mut`/`get_mut`").
//!
//! This module therefore re-exports `Rc`/`Arc`/`Weak` under the Zig names so that
//! mechanical `bun_ptr::shared::*` references resolve, and documents the 1:1 method
//! mapping for Phase-B reviewers diffing against `src/ptr/shared.zig`.

use std::rc::Rc;
use std::sync::Arc;

// ───────────────────────────────────────────────────────────────────────────────
// Options
// ───────────────────────────────────────────────────────────────────────────────

/// Options for `WithOptions`.
///
/// In the Rust port these collapse to the std `Rc`/`Arc` knobs:
///
/// * `Allocator` — std `Rc`/`Arc` always use the global allocator (mimalloc via
///   `#[global_allocator]`). `Rc::new_in`/`Arc::new_in` are nightly-only
///   (`feature(allocator_api)`); see `// TODO(port)` on `SharedIn` below.
/// * `atomic` — picks `Rc` vs `Arc`.
/// * `allow_weak` — `Rc`/`Arc` always carry a weak count, so this is always
///   effectively `true`. The Zig flag existed only to save 4 bytes when weak
///   pointers were not needed.
/// * `deinit` — `Rc`/`Arc` always run `Drop` on the inner `T`. To suppress
///   `Drop`, wrap the payload in `ManuallyDrop<T>` at the call site.
//
// TODO(port): this struct is kept only as documentation of the Zig surface; no
// Rust code should construct it. Remove once all `WithOptions` call sites are
// migrated to plain `Rc<T>`/`Arc<T>`.
#[allow(dead_code)]
pub struct Options {
    // If non-null, the shared pointer will always use the provided allocator. This saves a small
    // amount of memory, but it means the shared pointer will be a different type from shared
    // pointers that use different allocators.
    // (Rust: global mimalloc; allocator_api is unstable.)
    //
    /// Whether to use an atomic type to store the ref count. This makes the shared pointer
    /// thread-safe, assuming the underlying data is also thread-safe.
    pub atomic: bool,

    /// Whether to allow weak pointers to be created. This uses slightly more memory but is often
    /// negligible due to padding.
    ///
    /// There is no point in enabling this if `deinit` is false, or if your data type doesn't have
    /// a `deinit` method, since the sole purpose of weak pointers is to allow `deinit` to be called
    /// before the memory is freed.
    pub allow_weak: bool,

    /// Whether to call `deinit` on the data before freeing it, if such a method exists.
    pub deinit: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self { atomic: false, allow_weak: false, deinit: true }
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Shared / AtomicShared
// ───────────────────────────────────────────────────────────────────────────────

/// A shared pointer, allocated using the default allocator.
///
/// Zig's `Shared(*T)` and `Shared(?*T)` both map to `Rc<T>` in Rust:
/// `Shared(?*T)` → `Option<Rc<T>>` at the field/param site (the optionality moves
/// outside the smart pointer; `Rc<T>` is already null-pointer-optimized so
/// `Option<Rc<T>>` is one word).
///
/// This type is not thread-safe: all pointers to the same piece of data must live on the same
/// thread. See `AtomicShared` for a thread-safe version.
///
/// ## Method map (Zig → Rust)
///
/// | Zig                         | Rust                                          |
/// |-----------------------------|-----------------------------------------------|
/// | `Shared(*T).alloc(v)`       | `Rc::new(v)` (infallible; aborts on OOM)      |
/// | `Shared(*T).allocIn(v, a)`  | — (allocator_api unstable; `// TODO(port)`)   |
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
// PERF(port): Rc weak-count header — profile in Phase B (PORTING.md §Pointers).
pub type Shared<T> = Rc<T>;

/// A thread-safe shared pointer, allocated using the default allocator.
///
/// This type uses atomic operations to manage the ref count, but it does not provide any
/// synchronization of the data itself. You must ensure proper concurrency using mutexes or
/// atomics.
///
/// Same method map as `Shared` above, with `Arc` in place of `Rc`.
pub type AtomicShared<T> = Arc<T>;

/// A shared pointer allocated using a specific type of allocator.
///
/// The requirements for `Allocator` are the same as `bun.ptr.OwnedIn`.
/// `Allocator` may be `std.mem.Allocator` to allow any kind of allocator.
//
// TODO(port): `Rc::new_in` requires nightly `feature(allocator_api)`. The four
// tree-wide call sites all pass `bun.DefaultAllocator`, which is the global
// mimalloc — so in Phase B, rewrite those call sites to plain `Rc::new` and
// delete this alias. If a non-default allocator is ever needed, gate on the
// feature or hand-roll an `RcIn<T, A>` then.
pub type SharedIn<T /*, A */> = Rc<T>;

/// A thread-safe shared pointer allocated using a specific type of allocator.
//
// TODO(port): same as `SharedIn` — `Arc::new_in` is nightly-only.
pub type AtomicSharedIn<T /*, A */> = Arc<T>;

/// Like `Shared`, but takes explicit options.
//
// TODO(port): Rust cannot accept a struct const-generic on stable
// (`feature(adt_const_params)`). Every `WithOptions` instantiation in-tree is
// covered by one of `Rc<T>` / `Arc<T>` / `Option<Rc<T>>` / `Option<Arc<T>>` /
// `ManuallyDrop<T>` payload. Phase B: rewrite each call site to the concrete
// std type and delete this generic shim. The compile-time assertion
// `allow_weak ⇒ deinit` from the Zig is moot because std `Rc`/`Arc` always
// support weak and always run `Drop`.
pub type WithOptions<T> = Rc<T>;

// ───────────────────────────────────────────────────────────────────────────────
// Weak
// ───────────────────────────────────────────────────────────────────────────────

/// A weak pointer.
///
/// Weak pointers must be upgraded to strong pointers before the shared data can be
/// accessed. This upgrading can fail if no shared pointers exist anymore, as the shared
/// data will have been deinitialized in that case.
///
/// ## Method map (Zig → Rust)
///
/// | Zig                  | Rust                                  |
/// |----------------------|---------------------------------------|
/// | `w.upgrade()`        | `w.upgrade()` (→ `Option<Rc<T>>`)     |
/// | `w.clone()`          | `w.clone()`                           |
/// | `w.deinit()`         | `drop(w)`                             |
/// | `Weak.initNull()`    | `Weak::new()` (dangling) or `None`    |
/// | `w.isNull()`         | `Option::is_none` / `w.ptr_eq(&Weak::new())` |
/// | `w.strongCount()`    | `w.strong_count()`                    |
/// | `w.weakCount()`      | `w.weak_count()`                      |
pub type Weak<T> = std::rc::Weak<T>;

/// Thread-safe weak pointer (companion to `AtomicShared`).
pub type AtomicWeak<T> = std::sync::Weak<T>;

// ───────────────────────────────────────────────────────────────────────────────
// FullData / NonAtomicCount / AtomicCount
// ───────────────────────────────────────────────────────────────────────────────
//
// The Zig `FullData` struct (value + strong_count + weak_count + allocator +
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
//
// TODO(port): if Phase-B profiling shows the std weak-count word is measurable
// in a hot array, revisit with a `#[repr(C)]` hand-rolled inner — but per
// PORTING.md this is explicitly deprioritized.

// `RawCount` was `u32` in Zig; std uses `usize`. The overflow assertion
// (`old != maxInt(RawCount)`) is replaced by std's own abort-on-overflow check
// in `Arc::clone` (it aborts if the count would exceed `isize::MAX`).

// `parsePointer` (Zig comptime reflection over `*T` / `?*T`) has no Rust
// analogue and is not needed: optionality is expressed at the use site as
// `Option<Rc<T>>`, and slices/const are rejected by the type system rather than
// a comptime check.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/shared.zig (568 lines)
//   confidence: medium
//   todos:      4
//   notes:      Per PORTING.md §Pointers, Shared/AtomicShared map to std Rc/Arc — this file is type aliases + method-map docs, not a reimplementation. Phase B: rewrite the ~4 SharedIn/WithOptions call sites to concrete Rc/Arc and delete the shim aliases.
// ──────────────────────────────────────────────────────────────────────────
