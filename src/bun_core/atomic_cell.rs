//! [`AtomicCell<T>`] — the named replacement for
//! [`RacyCell`](crate::RacyCell) when state crosses a thread boundary.
//!
//! | Invariant                                      | Type                  |
//! | ---------------------------------------------- | --------------------- |
//! | small `Copy` scalar, read+written from ≥2 threads | [`AtomicCell<T>`]  |
//! | init-once-then-read-only                       | `std::sync::OnceLock` |
//!
//! After migration, `RacyCell` should remain only for FFI-shaped `.bss`
//! symbols where Rust never reads the bytes itself.
//!
//! See `docs/PORTING.md` §Global mutable state.

use core::cell::UnsafeCell;
use core::mem::ManuallyDrop;
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
/// handles, and pointers that more than one thread touches.
///
/// `T` must implement [`Atom`] (no padding, `size_of::<T>() ∈ {1,2,4,8}`).
/// Larger or padded `T` is a compile error — use `bun_threading::Guarded<T>` or
/// restructure. There is **no** seqlock fallback (unlike crossbeam's
/// `AtomicCell`): if it doesn't fit in a native atomic word, it doesn't
/// compile.
///
/// Default ordering is **Acquire/Release**, not Relaxed — at least six of the
/// data-race findings that motivated this type were "Relaxed gives no
/// happens-before for the init it guards".
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
// via `load()` would be a data race.
unsafe impl<T: Atom> Sync for AtomicCell<T> {}

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
///   than [`AnyBitPattern`](crate::AnyBitPattern) — `#[repr(u8)]` enums qualify because the
///   cell only ever stores valid discriminants.
/// - `Self` is safe to transport across threads when stored in an
///   `AtomicCell` — i.e. it has no thread affinity beyond what the atomic op
///   itself provides. This is what backs `AtomicCell<T: Atom>: Sync`.
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
        }
    )+};
}

// The two dispatch helpers below are `pub` only so `unsafe_impl_atom!` can
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
            // `unsafe_impl_atom!`'s `const _` assert rejects every other width.
            _ => unreachable!(),
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
        let c: AtomicCell<*mut u32> = AtomicCell::new(core::ptr::null_mut());
        assert!(c.load().is_null());
        c.store(&raw mut x);
        assert_eq!(unsafe { *c.load() }, 5);
    }
}
