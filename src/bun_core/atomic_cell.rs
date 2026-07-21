//! [`AtomicCell<T>`] and [`ThreadCell<T>`] — the two named replacements for
//! [`RacyCell`](crate::RacyCell) when state crosses (or is asserted *not* to
//! cross) a thread boundary.
//!
//! `RacyCell` is overloaded for three unrelated invariants. This module splits two of them
//! into types the compiler / debug build can check:
//!
//! | Invariant                                      | Type                  |
//! | ---------------------------------------------- | --------------------- |
//! | small `Copy` scalar, read+written from ≥2 threads | [`AtomicCell<T>`]  |
//! | thread-confined scratch (HTTP-thread-only buffer, resolver watermark) | [`ThreadCell<T>`] |
//! | init-once-then-read-only                       | `std::sync::OnceLock` |
//!
//! After migration, `RacyCell` should remain only for FFI-shaped `.bss`
//! symbols where Rust never reads the bytes itself.
//!
//! See `docs/PORTING.md` §Global mutable state.

use core::cell::UnsafeCell;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicPtr, AtomicU8, AtomicU16, AtomicU32, AtomicU64, Ordering};

// ═══════════════════════════════════════════════════════════════════════════
// AtomicCell<T>
// ═══════════════════════════════════════════════════════════════════════════

/// Lock-free atomic cell for any `Copy` type up to 8 bytes.
///
/// This is the cross-thread counterpart to [`RacyCell`](crate::RacyCell):
/// where `RacyCell` documents "single-threaded by construction", `AtomicCell`
/// documents "actually shared; every load/store is an atomic op with
/// Acquire/Release ordering". Use this for flags, counters, small enums,
/// handles, and `Option<NonNull<_>>` that more than one thread touches.
///
/// `T` must implement [`Atom`] (no padding, `size_of::<T>() ∈ {1,2,4,8}`).
/// Larger or padded `T` is a compile error — use `bun_threading::RwLock<T>` or
/// restructure. There is **no** seqlock fallback (unlike crossbeam's
/// `AtomicCell`): if it doesn't fit in a native atomic word, it doesn't
/// compile.
///
/// Default ordering is **Acquire/Release**, not Relaxed — at least six of the
/// data-race findings that motivated this type were "Relaxed gives no
/// happens-before for the init it guards". Telemetry / best-effort hints can
/// opt out via [`load_relaxed`](Self::load_relaxed) /
/// [`store_relaxed`](Self::store_relaxed), named so grep finds every site
/// that opted out of ordering.
#[repr(C)]
pub struct AtomicCell<T: Copy> {
    // ZST that forces 8-byte alignment so `inner`'s address is valid for
    // `AtomicU64` (the widest backing we cast to). Smaller widths need ≤8, so
    // this covers all sizes. With `repr(C)` the ZST occupies offset 0 and
    // `inner` is also at offset 0.
    _align: [AtomicU64; 0],
    inner: UnsafeCell<T>,
}

// SAFETY: every shared access goes through an atomic op; `T: Atom ⊃ Copy` so
// no drop glue races. We bound on `T: Atom` (not `T: Send`) because `Atom`'s
// safety contract includes cross-thread transport — that's what lets the
// pointer specializations carry `*mut U` / `NonNull<U>` across threads
// (matching `AtomicPtr<U>: Send + Sync` unconditionally) even though raw
// pointers are `!Send`. What the receiving thread *does* with a loaded pointer
// is on the caller, same as `AtomicPtr`. A plain `T: Copy` bound would be
// unsound: `&Cell<u32>` is `Copy + !Send`, and shipping one to another thread
// via `into_inner()` would be a data race.
unsafe impl<T: Atom> Sync for AtomicCell<T> {}
// SAFETY: see the `Sync` justification above — the same invariants apply to
// moving the cell itself across threads; `T: Copy` has no drop glue to race.
unsafe impl<T: Atom> Send for AtomicCell<T> {}

impl<T: Copy> AtomicCell<T> {
    /// `const` constructor — required because most call sites are `static`
    /// initializers.
    #[inline]
    pub const fn new(value: T) -> Self {
        Self {
            _align: [],
            inner: UnsafeCell::new(value),
        }
    }
}

impl<T: Atom> AtomicCell<T> {
    /// Acquire load.
    #[inline]
    pub fn load(&self) -> T {
        // SAFETY: `inner` is 8-aligned (see `_align`); `T: Atom` upholds the
        // size/padding contract.
        unsafe { T::_atomic_load(self.inner.get(), Ordering::Acquire) }
    }

    /// Release store.
    #[inline]
    pub fn store(&self, value: T) {
        // SAFETY: as above.
        unsafe { T::_atomic_store(self.inner.get(), value, Ordering::Release) }
    }

    /// AcqRel compare-and-swap. `Ok(prev)` on success, `Err(actual)` on
    /// failure.
    #[inline]
    pub fn compare_exchange(&self, current: T, new: T) -> Result<T, T> {
        // SAFETY: as above.
        unsafe {
            T::_atomic_cas(
                self.inner.get(),
                current,
                new,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
        }
    }

    /// AcqRel RMW loop. For `MAX_FD = max(MAX_FD, fd)`-shaped updates.
    /// Returns `Ok(previous)` if `f` produced a new value (and it was
    /// installed), `Err(current)` if `f` returned `None`.
    #[inline]
    pub fn fetch_update(&self, mut f: impl FnMut(T) -> Option<T>) -> Result<T, T> {
        let mut prev = self.load();
        while let Some(next) = f(prev) {
            match self.compare_exchange(prev, next) {
                Ok(x) => return Ok(x),
                Err(actual) => prev = actual,
            }
        }
        Err(prev)
    }
}

impl<T: Copy + Default> Default for AtomicCell<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}

impl<T: Atom + core::fmt::Debug> core::fmt::Debug for AtomicCell<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_tuple("AtomicCell").field(&self.load()).finish()
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Atom — marker + dispatch trait
// ───────────────────────────────────────────────────────────────────────────

/// Types storable in an [`AtomicCell`].
///
/// The hidden `_atomic_*` methods route each operation to the correct
/// `core::sync::atomic` backing for `Self`'s width (or `AtomicPtr` for
/// pointer types, preserving provenance). Callers never invoke these
/// directly — they exist so [`AtomicCell`] has a single inherent `impl` block
/// without inherent-impl overlap on pointer specializations.
///
/// # Safety
///
/// Implementors guarantee:
/// - `size_of::<Self>()` is 1, 2, 4, or 8.
/// - `Self` has **no padding or otherwise-uninitialized bytes** (so
///   reinterpreting as `uN` reads only initialized bits).
/// - Round-tripping `Self → uN → Self` (where every `uN` value observed was
///   produced from a valid `Self`) yields the original value. This is weaker
///   than `bytemuck::AnyBitPattern` — `#[repr(u8)]` enums qualify because the
///   cell only ever stores valid discriminants.
/// - `Self` is safe to transport across threads when stored in an
///   `AtomicCell` — i.e. it has no thread affinity beyond what the atomic op
///   itself provides. This is what backs `AtomicCell<T: Atom>: Send + Sync`.
///   Raw pointers / `NonNull` qualify (the *pointee* may be thread-affine, but
///   that's the caller's problem, exactly as with `AtomicPtr`). A `Copy`
///   reference like `&Cell<_>` does **not** — it would alias unsynchronized
///   interior mutability across threads.
///
/// Prefer the [`unsafe_impl_atom!`](crate::unsafe_impl_atom) macro over a
/// hand-written `impl`.
pub unsafe trait Atom: Copy {
    #[doc(hidden)]
    unsafe fn _atomic_load(p: *mut Self, ord: Ordering) -> Self;
    #[doc(hidden)]
    unsafe fn _atomic_store(p: *mut Self, v: Self, ord: Ordering);
    #[doc(hidden)]
    unsafe fn _atomic_cas(
        p: *mut Self,
        current: Self,
        new: Self,
        success: Ordering,
        failure: Ordering,
    ) -> Result<Self, Self>;
}

/// Bit-reinterpret `a` as `B` without a size check (caller asserts the sizes
/// match). Uses a `union` so the dead arms of the size-dispatch below remain
/// well-formed regardless of width.
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

/// Implement [`Atom`] for a non-pointer `Copy` type by routing to the
/// `AtomicU{8,16,32,64}` of matching width.
///
/// `unsafe` because the caller asserts the [`Atom`] safety contract (size is
/// a power of two ≤ 8, no padding bytes). A `const _` assert checks the size
/// half at compile time; the no-padding half is on you.
#[macro_export]
macro_rules! unsafe_impl_atom {
    ($($T:ty),+ $(,)?) => {$(
        // Compile-time size gate — fires at the `impl` site, not at first use.
        const _: () = ::core::assert!(
            ::core::mem::size_of::<$T>() == 1
                || ::core::mem::size_of::<$T>() == 2
                || ::core::mem::size_of::<$T>() == 4
                || ::core::mem::size_of::<$T>() == 8,
            concat!("Atom: size_of::<", stringify!($T), ">() must be 1, 2, 4, or 8"),
        );
        const _: () = ::core::assert!(
            ::core::mem::align_of::<$T>() <= ::core::mem::align_of::<u64>(),
            concat!("Atom: align_of::<", stringify!($T), ">() must be ≤ align_of::<u64>()"),
        );
        // SAFETY: caller of `unsafe_impl_atom!` upholds the no-padding half;
        // size/align checked above.
        unsafe impl $crate::atomic_cell::Atom for $T {
            #[inline]
            unsafe fn _atomic_load(p: *mut Self, ord: ::core::sync::atomic::Ordering) -> Self {
                // SAFETY: forwarded from `AtomicCell` which guarantees `p` is
                // 8-aligned and points to a live `Self`.
                unsafe { $crate::atomic_cell::_dispatch_load::<$T>(p, ord) }
            }
            #[inline]
            unsafe fn _atomic_store(p: *mut Self, v: Self, ord: ::core::sync::atomic::Ordering) {
                // SAFETY: as above.
                unsafe { $crate::atomic_cell::_dispatch_store::<$T>(p, v, ord) }
            }
            #[inline]
            unsafe fn _atomic_cas(
                p: *mut Self,
                cur: Self,
                new: Self,
                s: ::core::sync::atomic::Ordering,
                f: ::core::sync::atomic::Ordering,
            ) -> ::core::result::Result<Self, Self> {
                // SAFETY: as above.
                unsafe { $crate::atomic_cell::_dispatch_cas::<$T>(p, cur, new, s, f) }
            }
        }
    )+};
}

// The three dispatch helpers below are `pub` only so `unsafe_impl_atom!` can
// reach them from other crates; they are not part of the stable surface.

macro_rules! size_dispatch {
    ($T:ty, $p:expr, |$a:ident: $A:ident, $I:ident| $body:expr) => {
        match ::core::mem::size_of::<$T>() {
            1 => {
                type $A = AtomicU8;
                type $I = u8;
                // SAFETY: caller passes an 8-aligned live `*mut $T`; this arm
                // is taken only when `size_of::<$T>()` matches `$A`'s width.
                let $a = unsafe { &*($p as *const $A) };
                $body
            }
            2 => {
                type $A = AtomicU16;
                type $I = u16;
                // SAFETY: caller passes an 8-aligned live `*mut $T`; this arm
                // is taken only when `size_of::<$T>()` matches `$A`'s width.
                let $a = unsafe { &*($p as *const $A) };
                $body
            }
            4 => {
                type $A = AtomicU32;
                type $I = u32;
                // SAFETY: caller passes an 8-aligned live `*mut $T`; this arm
                // is taken only when `size_of::<$T>()` matches `$A`'s width.
                let $a = unsafe { &*($p as *const $A) };
                $body
            }
            8 => {
                type $A = AtomicU64;
                type $I = u64;
                // SAFETY: caller passes an 8-aligned live `*mut $T`; this arm
                // is taken only when `size_of::<$T>()` matches `$A`'s width.
                let $a = unsafe { &*($p as *const $A) };
                $body
            }
            // SAFETY: `unsafe_impl_atom!`'s `const _` assert rejected every
            // other width at compile time.
            _ => unsafe { ::core::hint::unreachable_unchecked() },
        }
    };
}

#[doc(hidden)]
#[inline(always)]
pub unsafe fn _dispatch_load<T: Copy>(p: *mut T, ord: Ordering) -> T {
    size_dispatch!(T, p, |a: A, I| {
        // SAFETY: this arm has `size_of::<I>() == size_of::<T>()`; the loaded
        // `I` was stored from a valid `T` so the `Atom` round-trip holds.
        unsafe { xmute::<I, T>(a.load(ord)) }
    })
}
#[doc(hidden)]
#[inline(always)]
pub unsafe fn _dispatch_store<T: Copy>(p: *mut T, v: T, ord: Ordering) {
    size_dispatch!(T, p, |a: A, I| a.store(
        // SAFETY: this arm has `size_of::<I>() == size_of::<T>()`; `T: Atom`
        // guarantees no padding so every byte of `v` is initialized.
        unsafe { xmute::<T, I>(v) },
        ord,
    ))
}
#[doc(hidden)]
#[inline(always)]
pub unsafe fn _dispatch_cas<T: Copy>(
    p: *mut T,
    cur: T,
    new: T,
    s: Ordering,
    f: Ordering,
) -> Result<T, T> {
    size_dispatch!(T, p, |a: A, I| {
        match a.compare_exchange(
            // SAFETY: this arm has `size_of::<I>() == size_of::<T>()`;
            // `T: Atom` guarantees no padding bytes.
            unsafe { xmute::<T, I>(cur) },
            // SAFETY: as above.
            unsafe { xmute::<T, I>(new) },
            s,
            f,
        ) {
            // SAFETY: `x` was stored from a valid `T`; `Atom` round-trip holds.
            Ok(x) => Ok(unsafe { xmute::<I, T>(x) }),
            // SAFETY: as above.
            Err(x) => Err(unsafe { xmute::<I, T>(x) }),
        }
    })
}

// ── Built-in Atom impls ────────────────────────────────────────────────────

unsafe_impl_atom!(
    bool, char, u8, u16, u32, u64, usize, i8, i16, i32, i64, isize, f32, f64,
);

// Pointer specializations: route through `AtomicPtr` so provenance survives
// the round-trip (the integer path would launder it to an int and back).

// SAFETY: `*mut U` is pointer-sized, padding-free; `AtomicPtr<U>` is its
// native atomic backing.
unsafe impl<U> Atom for *mut U {
    #[inline]
    unsafe fn _atomic_load(p: *mut Self, ord: Ordering) -> Self {
        // SAFETY: `p` is `AtomicCell<*mut U>::inner.get()`, 8-aligned via
        // `_align`; `*mut U` and `AtomicPtr<U>` have identical layout.
        unsafe { (*(p as *const AtomicPtr<U>)).load(ord) }
    }
    #[inline]
    unsafe fn _atomic_store(p: *mut Self, v: Self, ord: Ordering) {
        // SAFETY: `p` is 8-aligned and live; `*mut U` and `AtomicPtr<U>` have
        // identical layout (see `_atomic_load`).
        unsafe { (*(p as *const AtomicPtr<U>)).store(v, ord) }
    }
    #[inline]
    unsafe fn _atomic_cas(
        p: *mut Self,
        cur: Self,
        new: Self,
        s: Ordering,
        f: Ordering,
    ) -> Result<Self, Self> {
        // SAFETY: `p` is 8-aligned and live; `*mut U` and `AtomicPtr<U>` have
        // identical layout (see `_atomic_load`).
        unsafe { (*(p as *const AtomicPtr<U>)).compare_exchange(cur, new, s, f) }
    }
}

// SAFETY: same as `*mut U`; the cast goes through `*mut U`.
unsafe impl<U> Atom for *const U {
    #[inline]
    unsafe fn _atomic_load(p: *mut Self, ord: Ordering) -> Self {
        // SAFETY: `p` is `AtomicCell<*const U>::inner.get()`, 8-aligned via
        // `_align`; `*const U` and `AtomicPtr<U>` have identical layout.
        unsafe { (*(p as *const AtomicPtr<U>)).load(ord).cast_const() }
    }
    #[inline]
    unsafe fn _atomic_store(p: *mut Self, v: Self, ord: Ordering) {
        // SAFETY: `p` is 8-aligned and live; `*const U` and `AtomicPtr<U>`
        // have identical layout (see `_atomic_load`).
        unsafe { (*(p as *const AtomicPtr<U>)).store(v.cast_mut(), ord) }
    }
    #[inline]
    unsafe fn _atomic_cas(
        p: *mut Self,
        cur: Self,
        new: Self,
        s: Ordering,
        f: Ordering,
    ) -> Result<Self, Self> {
        // SAFETY: `p` is 8-aligned and live; `*const U` and `AtomicPtr<U>`
        // have identical layout (see `_atomic_load`).
        unsafe {
            match (*(p as *const AtomicPtr<U>)).compare_exchange(
                cur.cast_mut(),
                new.cast_mut(),
                s,
                f,
            ) {
                Ok(x) => Ok(x.cast_const()),
                Err(x) => Err(x.cast_const()),
            }
        }
    }
}

#[inline(always)]
fn nn_to_raw<U>(v: Option<NonNull<U>>) -> *mut U {
    v.map_or(core::ptr::null_mut(), |n| n.as_ptr())
}

// SAFETY: `Option<NonNull<U>>` is guaranteed to have the same layout as
// `*mut U` (null-pointer niche), so the storage cast to `AtomicPtr<U>` is
// sound; round-tripping preserves provenance.
unsafe impl<U> Atom for Option<NonNull<U>> {
    #[inline]
    unsafe fn _atomic_load(p: *mut Self, ord: Ordering) -> Self {
        // SAFETY: `p` is 8-aligned and live; `Option<NonNull<U>>` has the same
        // layout as `*mut U` (null-pointer niche), hence as `AtomicPtr<U>`.
        NonNull::new(unsafe { (*(p as *const AtomicPtr<U>)).load(ord) })
    }
    #[inline]
    unsafe fn _atomic_store(p: *mut Self, v: Self, ord: Ordering) {
        // SAFETY: `p` is 8-aligned and live; `Option<NonNull<U>>` and
        // `AtomicPtr<U>` have identical layout (see `_atomic_load`).
        unsafe { (*(p as *const AtomicPtr<U>)).store(nn_to_raw(v), ord) }
    }
    #[inline]
    unsafe fn _atomic_cas(
        p: *mut Self,
        cur: Self,
        new: Self,
        s: Ordering,
        f: Ordering,
    ) -> Result<Self, Self> {
        // SAFETY: `p` is 8-aligned and live; `Option<NonNull<U>>` and
        // `AtomicPtr<U>` have identical layout (see `_atomic_load`).
        unsafe {
            match (*(p as *const AtomicPtr<U>)).compare_exchange(
                nn_to_raw(cur),
                nn_to_raw(new),
                s,
                f,
            ) {
                Ok(x) => Ok(NonNull::new(x)),
                Err(x) => Err(NonNull::new(x)),
            }
        }
    }
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
// SAFETY: `UnsafeCell<T>: Send` when `T: Send`, and `owner: AtomicU64` is
// `Send`; sending the cell just moves the (still thread-affine) `T`.
unsafe impl<T: ?Sized + Send> Send for ThreadCell<T> {}

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
    pub fn assert_owner(&self) {
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

    /// `&mut T` scoped to the closure (debug-asserts owner if claimed).
    ///
    /// # Safety
    /// Caller guarantees no other live reference to the inner `T` for the
    /// closure's duration (the same invariant `RacyCell` already imposed).
    #[inline]
    pub unsafe fn with_mut<R>(&self, f: impl FnOnce(&mut T) -> R) -> R {
        self.assert_owner();
        // SAFETY: caller contract above.
        f(unsafe { &mut *self.inner.get() })
    }
}

impl<T: Default> Default for ThreadCell<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_cell_roundtrip_ints() {
        let c = AtomicCell::new(42_i32);
        assert_eq!(c.load(), 42);
        c.store(-7);
        assert_eq!(c.load(), -7);
        assert_eq!(c.compare_exchange(0, 1), Err(-7));
        assert_eq!(c.compare_exchange(-7, 1), Ok(-7));
        assert_eq!(c.load(), 1);
    }

    #[test]
    fn atomic_cell_bool() {
        let c = AtomicCell::new(false);
        assert!(!c.load());
        c.store(true);
        assert!(c.load());
    }

    #[test]
    fn atomic_cell_ptr() {
        let mut x = 5_u32;
        let c: AtomicCell<Option<NonNull<u32>>> = AtomicCell::new(None);
        assert!(c.load().is_none());
        c.store(NonNull::new(&mut x));
        assert_eq!(unsafe { *c.load().unwrap().as_ptr() }, 5);
    }

    #[test]
    fn atomic_cell_fetch_update() {
        let c = AtomicCell::new(3_i32);
        let _ = c.fetch_update(|cur| (10 > cur).then_some(10));
        assert_eq!(c.load(), 10);
        let r = c.fetch_update(|cur| (5 > cur).then_some(5));
        assert_eq!(r, Err(10));
        assert_eq!(c.load(), 10);
    }
}
