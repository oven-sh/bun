//! [`AtomicCell<T>`] and [`ThreadCell<T>`] — the two named replacements for
//! [`RacyCell`](crate::RacyCell) when state crosses (or is asserted *not* to
//! cross) a thread boundary.
//!
//! `RacyCell` is overloaded for three unrelated invariants. This module splits two of them
//! into types the compiler / debug build can check:
//!
//! | Invariant                                      | Type                  |
//! | ---------------------------------------------- | --------------------- |
//! | one-byte `Copy` enum, read+written from ≥2 threads | [`AtomicCell<T>`] |
//! | thread-confined scratch (HTTP-thread-only buffer, resolver watermark) | [`ThreadCell<T>`] |
//! | init-once-then-read-only                       | `std::sync::OnceLock` |
//!
//! After migration, `RacyCell` should remain only for FFI-shaped `.bss`
//! symbols where Rust never reads the bytes itself.
//!
//! See `docs/PORTING.md` §Global mutable state.

use core::cell::UnsafeCell;
use core::mem::ManuallyDrop;
#[cfg(debug_assertions)]
use core::sync::atomic::AtomicU64;
use core::sync::atomic::{AtomicU8, Ordering};

// ═══════════════════════════════════════════════════════════════════════════
// AtomicCell<T>
// ═══════════════════════════════════════════════════════════════════════════

/// This is the cross-thread counterpart to [`RacyCell`](crate::RacyCell):
/// where `RacyCell` documents "single-threaded by construction", `AtomicCell`
/// documents "actually shared; every load/store is an atomic op with
/// Acquire/Release ordering". Use this for one-byte enums that several threads touch.
///
/// Default ordering is **Acquire/Release**, not Relaxed — at least six of the
/// data-race findings that motivated this type were "Relaxed gives no
/// happens-before for the init it guards".
#[repr(C)]
pub struct AtomicCell<T: Copy> {
    inner: UnsafeCell<T>,
}

// SAFETY: every shared access goes through an atomic op; `T: Atom ⊃ Copy` so
// no drop glue races. `Atom`'s safety contract includes cross-thread transport.
unsafe impl<T: Atom> Sync for AtomicCell<T> {}

impl<T: Copy> AtomicCell<T> {
    /// `const` constructor — required because most call sites are `static`
    /// initializers.
    #[inline]
    pub const fn new(value: T) -> Self {
        Self {
            inner: UnsafeCell::new(value),
        }
    }
}

impl<T: Atom> AtomicCell<T> {
    /// Acquire load.
    #[inline]
    pub fn load(&self) -> T {
        // SAFETY: `inner` is live for `&self`; `T: Atom` upholds the
        // size/padding contract.
        unsafe { _dispatch_load(self.inner.get(), Ordering::Acquire) }
    }

    /// Release store.
    #[inline]
    pub fn store(&self, value: T) {
        // SAFETY: as above.
        unsafe { _dispatch_store(self.inner.get(), value, Ordering::Release) }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Atom — marker trait
// ───────────────────────────────────────────────────────────────────────────

/// Types storable in an [`AtomicCell`].
///
/// # Safety
///
/// Implementors guarantee:
/// - `size_of::<Self>()` is 1.
/// - `Self` has **no padding or otherwise-uninitialized bytes** (so
///   reinterpreting as `uN` reads only initialized bits).
/// - Round-tripping `Self → uN → Self` (where every `uN` value observed was
///   produced from a valid `Self`) yields the original value. This is weaker
///   than [`AnyBitPattern`](crate::AnyBitPattern) — `#[repr(u8)]` enums qualify because the
///   cell only ever stores valid discriminants.
/// - `Self` is safe to transport across threads when stored in an
///   `AtomicCell` — i.e. it has no thread affinity beyond what the atomic op
///   itself provides. This is what backs `AtomicCell<T: Atom>: Sync`.
///
/// Prefer the [`unsafe_impl_atom!`](crate::unsafe_impl_atom) macro over a
/// hand-written `impl`.
pub unsafe trait Atom: Copy {}

/// Bit-reinterpret `a` as `B` without a size check (caller asserts the sizes
/// match). Uses a `union` because `transmute` rejects a generic type.
#[inline(always)]
const unsafe fn xmute<A, B>(a: A) -> B {
    #[repr(C)]
    union U<A, B> {
        a: ManuallyDrop<A>,
        b: ManuallyDrop<B>,
    }
    // SAFETY: caller contract.
    ManuallyDrop::into_inner(unsafe {
        U::<A, B> {
            a: ManuallyDrop::new(a),
        }
        .b
    })
}

/// Implement [`Atom`] for a one-byte `Copy` type.
///
/// `unsafe` because the caller asserts the [`Atom`] safety contract. A `const _` assert checks the size.
#[macro_export]
macro_rules! unsafe_impl_atom {
    ($($T:ty),+ $(,)?) => {$(
        // Compile-time size gate — fires at the `impl` site, not at first use.
        const _: () = ::core::assert!(
            ::core::mem::size_of::<$T>() == 1,
            concat!("Atom: size_of::<", stringify!($T), ">() must be 1"),
        );
        // SAFETY: caller of `unsafe_impl_atom!` upholds the rest of the
        // contract; size checked above.
        unsafe impl $crate::atomic_cell::Atom for $T {}
    )+};
}

macro_rules! size_dispatch {
    ($T:ty, $p:expr, |$a:ident: $A:ident, $I:ident| $body:expr) => {
        match ::core::mem::size_of::<$T>() {
            1 => {
                type $A = AtomicU8;
                type $I = u8;
                // SAFETY: caller passes a live `*mut $T`; this arm
                // is taken only when `size_of::<$T>()` matches `$A`'s width.
                let $a = unsafe { &*($p as *const $A) };
                $body
            }
            // `unsafe_impl_atom!`'s `const _` assert rejects every other width.
            _ => unreachable!(),
        }
    };
}

#[inline(always)]
unsafe fn _dispatch_load<T: Copy>(p: *mut T, ord: Ordering) -> T {
    size_dispatch!(T, p, |a: A, I| {
        // SAFETY: this arm has `size_of::<I>() == size_of::<T>()`; the loaded
        // `I` was stored from a valid `T` so the `Atom` round-trip holds.
        unsafe { xmute::<I, T>(a.load(ord)) }
    })
}
#[inline(always)]
unsafe fn _dispatch_store<T: Copy>(p: *mut T, v: T, ord: Ordering) {
    size_dispatch!(T, p, |a: A, I| a.store(
        // SAFETY: this arm has `size_of::<I>() == size_of::<T>()`; `T: Atom`
        // guarantees no padding so every byte of `v` is initialized.
        unsafe { xmute::<T, I>(v) },
        ord,
    ))
}

// ═══════════════════════════════════════════════════════════════════════════
// ThreadCell<T>
// ═══════════════════════════════════════════════════════════════════════════

/// `RacyCell<T>` + a debug-only owner latch.
///
/// For state whose `// SAFETY:` comment says "HTTP-thread-only" /
/// "resolver-thread-only" / "single watcher thread" and that claim is
/// **load-bearing but unchecked**. `ThreadCell` converts the comment into a
/// checked invariant: once [`claim`](Self::claim) is called from the owning
/// thread, every subsequent [`get`](Self::get) on a different thread panics
/// in debug builds. Release builds compile the latch away — `ThreadCell<T>`
/// has the same layout as `RacyCell<T>`.
///
/// This is the worker-thread sibling of `JsCell<T>` (which is JS-thread-
/// affine and additionally documents reentrancy as the hazard).
///
/// **Migration note:** until [`claim`](Self::claim) is called, `get()` does
/// *not* assert (matching `RacyCell`). This lets a static be initialized on
/// the spawning thread, then claimed from the worker thread's entry point.
/// Existing `RacyCell` sites can swap to `ThreadCell` as a drop-in first
/// step, then add `claim()` once cross-thread callers are routed away.
#[repr(C)]
pub struct ThreadCell<T: ?Sized> {
    #[cfg(debug_assertions)]
    owner: AtomicU64,
    inner: UnsafeCell<T>,
}

// SAFETY: same lie as `RacyCell` (caller promises thread-affinity), now
// *checked* in debug via `owner`.
unsafe impl<T: ?Sized> Sync for ThreadCell<T> {}

#[cfg(debug_assertions)]
const UNCLAIMED: u64 = 0;

impl<T> ThreadCell<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        Self {
            #[cfg(debug_assertions)]
            owner: AtomicU64::new(UNCLAIMED),
            inner: UnsafeCell::new(value),
        }
    }
}

impl<T: ?Sized> ThreadCell<T> {
    /// Bind this cell to the calling thread. Idempotent on the owner; panics
    /// if a *different* thread has already claimed it. Call once from the
    /// owning thread's entry point (e.g. `HTTPThread::on_start`,
    /// `IoRequestLoop::on_spawn_io_thread`).
    #[inline]
    pub fn claim(&self) {
        #[cfg(debug_assertions)]
        {
            let me = crate::util::debug_thread_id();
            match self
                .owner
                .compare_exchange(UNCLAIMED, me, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => {}
                Err(prev) if prev == me => {}
                Err(prev) => {
                    panic!("ThreadCell: thread {me} tried to claim, already owned by thread {prev}")
                }
            }
        }
    }

    /// Debug-panic if the cell is claimed by a different thread.
    #[inline]
    pub(crate) fn assert_owner(&self) {
        #[cfg(debug_assertions)]
        {
            let owner = self.owner.load(Ordering::Acquire);
            if owner != UNCLAIMED {
                let me = crate::util::debug_thread_id();
                assert!(
                    owner == me,
                    "ThreadCell: accessed from thread {me}, owned by thread {owner}"
                );
            }
        }
    }

    /// Raw pointer to the contained value (debug-asserts owner if claimed).
    /// Mirrors [`RacyCell::get`](crate::RacyCell::get) — callers stay in
    /// raw-ptr land and deref per-access.
    #[inline]
    pub fn get(&self) -> *mut T {
        self.assert_owner();
        self.inner.get()
    }

    /// Raw pointer **without** the owner assertion. Use only on paths that
    /// touch fields which are *themselves* cross-thread-safe (lock-free
    /// queue + waker), pending a refactor that moves those fields out of the
    /// thread-confined struct. Every call site must say which fields it
    /// touches and why that's sound.
    #[inline]
    pub fn get_unchecked(&self) -> *mut T {
        self.inner.get()
    }
}

impl<T: Default> Default for ThreadCell<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}
