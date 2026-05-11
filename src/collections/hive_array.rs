use core::marker::PhantomData;
use core::mem::{size_of, ManuallyDrop, MaybeUninit};
use core::ptr::NonNull;

use crate::bit_set::IntegerBitSet;
use bun_core::asan;

/// An array that efficiently tracks which elements are in use.
/// The pointers are intended to be stable
/// Sorta related to https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2021/p0447r15.html
// PORT NOTE: Zig's `capacity: u16` is widened to `usize` here because Rust array
// lengths and `IntegerBitSet<N>` require a `usize` const generic on stable.
pub struct HiveArray<T, const CAPACITY: usize> {
    pub buffer: [MaybeUninit<T>; CAPACITY],
    pub used: IntegerBitSet<CAPACITY>,
}

impl<T, const CAPACITY: usize> HiveArray<T, CAPACITY> {
    pub const SIZE: usize = CAPACITY;

    // PORT NOTE: Zig had `pub var empty: Self` as a mutable static to work around
    // https://github.com/ziglang/zig/issues/22462 and /21988. Rust has no such
    // limitation; callers should use `init()` (which is `const`).

    pub const fn init() -> Self {
        Self {
            buffer: [const { MaybeUninit::uninit() }; CAPACITY],
            used: IntegerBitSet::init_empty(),
        }
    }

    /// Claim a slot and return a raw pointer to its **uninitialized** storage.
    ///
    /// Prefer [`get_init`](Self::get_init) / [`emplace`](Self::emplace) /
    /// [`claim`](Self::claim), which encode the "a `used` slot is always
    /// fully initialized" invariant in the type system. This entry point
    /// hands out `*mut T` to garbage; forming `&mut T` over it is instant UB
    /// when `T` has niche-bearing fields, and an early return between `get()`
    /// and the caller's `ptr::write` leaves the slot claimed-but-uninit so a
    /// later [`put`](Self::put) drops garbage.
    #[deprecated = "returns *mut T to uninitialized memory; use get_init / emplace / claim"]
    pub fn get(&mut self) -> Option<*mut T> {
        let Some(index) = self.used.find_first_unset() else {
            return None;
        };
        self.used.set(index);
        let ret = self.buffer[index].as_mut_ptr();
        // SAFETY: `ret` points to `size_of::<T>` bytes within `buffer`.
        unsafe { asan::unpoison(ret.cast(), size_of::<T>()) };
        Some(ret)
    }

    /// One-shot claim + write. Preferred entry point — no uninit window.
    ///
    /// Returns `None` (and does **not** consume `value`'s slot) if the hive
    /// is full; on `None` the caller still owns `value` and must drop it.
    #[inline]
    pub fn get_init(&mut self, value: T) -> Option<NonNull<T>> {
        Some(self.claim()?.write(value))
    }

    /// Claim + write where `T` is self-referential on its own slot address
    /// (e.g. a struct that registers itself as a uws/libuv user-data pointer
    /// inside its own constructor). `init` receives the slot's stable address
    /// and must return the value to be stored there.
    #[inline]
    pub fn emplace(&mut self, init: impl FnOnce(NonNull<T>) -> T) -> Option<NonNull<T>> {
        let slot = self.claim()?;
        let addr = slot.addr();
        Some(slot.write(init(addr)))
    }

    /// Low-level reservation. Only when [`get_init`](Self::get_init) /
    /// [`emplace`](Self::emplace) are insufficient — typically when the caller
    /// must interleave fallible work between claim and commit, or perform
    /// `repr(C)` placement-new via [`HiveSlot::as_uninit`].
    ///
    /// The returned token borrows `self` for `'_`; precompute any raw
    /// back-pointers to the parent struct *before* calling `claim()` if they
    /// are needed inside the initializer.
    pub fn claim(&mut self) -> Option<HiveSlot<'_, T, CAPACITY>> {
        let index = self.used.find_first_unset()?;
        self.used.set(index);
        let slot = NonNull::from(&mut self.buffer[index]);
        // SAFETY: `slot` points to `size_of::<T>` bytes within `buffer`.
        unsafe { asan::unpoison(slot.as_ptr().cast(), size_of::<T>()) };
        let owner = core::ptr::from_mut(self) as usize;
        // Tagged-pointer scheme requires the low bit clear for inline slots.
        // `HiveArray` is at least pointer-aligned via `IntegerBitSet`'s
        // backing word, and in practice `align_of::<T>() >= 2` for every `T`
        // we pool; assert in debug so a future 1-byte `T` is caught.
        debug_assert_eq!(owner & 1, 0, "HiveArray must be >=2-byte aligned for HiveSlot owner tag");
        Some(HiveSlot { slot, owner, _marker: PhantomData })
    }

    /// Recycle a slot **without** running `T::drop`. Safe: if `value` does not
    /// point into this hive, returns `false` and is a no-op. Use when the
    /// caller has already moved the contents out / destructured them, or when
    /// `T` is POD and the slot is being released on an error path before it
    /// was fully initialized (Zig `value.* = undefined`).
    pub fn put_raw(&mut self, value: *mut T) -> bool {
        let Some(index) = self.index_of(value) else {
            return false;
        };
        debug_assert!(self.used.is_set(index as usize));
        // SAFETY: `value` points to `size_of::<T>` bytes within `buffer`.
        unsafe { asan::poison(value.cast(), size_of::<T>()) };
        self.used.unset(index as usize);
        true
    }

    pub fn at(&mut self, index: u16) -> *mut T {
        debug_assert!((index as usize) < CAPACITY);
        let ret = self.buffer[index as usize].as_mut_ptr();
        asan::assert_unpoisoned(ret.cast::<u8>());
        ret
    }

    pub fn index_of(&self, value: *const T) -> Option<u32> {
        asan::assert_unpoisoned(value.cast::<u8>());
        let start = self.buffer.as_ptr().cast::<T>();
        // One-past-the-end pointer of `buffer`; `wrapping_add` is sound for
        // the in-allocation offset and matches `add` exactly here.
        let end = start.wrapping_add(CAPACITY);
        if !((value as usize) >= (start as usize) && (value as usize) < (end as usize)) {
            return None;
        }

        // aligned to the size of T
        let index = ((value as usize) - (start as usize)) / size_of::<T>();
        debug_assert!(index < CAPACITY);
        debug_assert!(self.buffer[index].as_ptr().cast::<T>() == value);
        Some(u32::try_from(index).expect("int cast"))
    }

    pub fn r#in(&self, value: *const T) -> bool {
        asan::assert_unpoisoned(value.cast::<u8>());
        let start = self.buffer.as_ptr().cast::<T>();
        let end = start.wrapping_add(CAPACITY);
        (value as usize) >= (start as usize) && (value as usize) < (end as usize)
    }

    /// Return a slot to the pool, dropping the contained `T` in place.
    ///
    /// Returns `false` (and drops nothing) if `value` does not point into
    /// this hive's buffer.
    ///
    /// # Safety
    /// If `value` points into this hive, it must point to a fully-initialized
    /// `T` previously obtained via [`get`](Self::get) and written by the
    /// caller. The slot is dropped in place; passing a moved-from or
    /// uninitialized slot is UB for `T` with drop glue.
    pub unsafe fn put(&mut self, value: *mut T) -> bool {
        let Some(index) = self.index_of(value) else {
            return false;
        };

        debug_assert!(self.used.is_set(index as usize));
        debug_assert!(self.buffer[index as usize].as_ptr().cast::<T>() == value.cast_const());

        // PORT NOTE: Zig wrote `value.* = undefined;` — Zig has no destructors,
        // so the slot was simply marked logically uninitialized. In the Rust
        // port several `T` carry owned heap data (e.g. `NumberScope.name_counts:
        // StringHashMap`, `NetworkTask.url_buf: Box<[u8]>`); drop the slot
        // before recycling so the put/get cycle does not leak it. Callers that
        // pre-clean fields (`PooledSocket::release_parked_refs`) leave only
        // trivially-droppable residuals, so this is idempotent for them.
        // SAFETY: caller contract — `value` is a fully-initialized `T` in `buffer`.
        unsafe {
            core::ptr::drop_in_place(value);
            asan::poison(value.cast(), size_of::<T>());
        }

        self.used.unset(index as usize);
        true
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HiveSlot
// ──────────────────────────────────────────────────────────────────────────

/// Linear reservation token for a claimed-but-uninitialized hive slot.
///
/// `HiveArray` slots are `[MaybeUninit<T>; CAP]`. The legacy [`HiveArray::get`]
/// contract was two-phase — claim a `*mut T` to garbage, then `ptr::write` it
/// — which opened three UB hazards in the gap: (H1) early-return / `?` / panic
/// leaves the slot claimed-uninit so a later `put()` drops garbage; (H2)
/// `&mut *p` over uninit `T` is instant validity UB when `T` has niches; (H3)
/// partial field-write then `assume_init_ref` on the whole slot.
///
/// `HiveSlot` encodes the invariant **"a `used` slot is always fully
/// initialized"** in the type system: you cannot obtain the stable
/// initialized `*mut T` without going through [`write`](Self::write) (or the
/// `unsafe` [`assume_init`](Self::assume_init) escape hatch). If the token is
/// dropped (early return, `?`, panic) the slot is released **without** running
/// `T::drop` — it was never written.
///
/// Two-pointer-sized; `owner` is a tagged `usize`:
///   - low bit `0` ⇒ `*mut HiveArray<T, CAP>` (release = unset `used` bit + poison),
///   - low bit `1` ⇒ heap `Box<MaybeUninit<T>>` (release = dealloc, no `T::drop`).
///
/// **Aliasing note** (matches the `BackRef<T>` precedent in `bun_ptr`): the
/// token stores a raw `*mut HiveArray` rather than `&'h mut HiveArray`. The
/// `PhantomData<&'h mut _>` keeps it lifetime-scoped to the `claim()` borrow,
/// but the structural guarantee — the hive is a field of a long-lived owner
/// that is not moved between `claim()` and `write()` — is the caller's, same
/// as every back-pointer in the port.
#[must_use = "claimed hive slot is leaked if neither written nor dropped"]
pub struct HiveSlot<'h, T, const CAPACITY: usize> {
    slot: NonNull<MaybeUninit<T>>,
    /// Tagged owner; see type-level docs.
    owner: usize,
    _marker: PhantomData<&'h mut HiveArray<T, CAPACITY>>,
}

impl<'h, T, const CAPACITY: usize> HiveSlot<'h, T, CAPACITY> {
    /// Stable address of the slot. Safe to capture (e.g. register as a
    /// libuv/uws user-data pointer) **before** [`write`](Self::write), as long
    /// as nothing dereferences it until after `write()`.
    #[inline]
    pub fn addr(&self) -> NonNull<T> {
        self.slot.cast::<T>()
    }

    /// `&mut MaybeUninit<T>` for piecewise init via `addr_of_mut!`. Prefer
    /// [`write`](Self::write); this exists for `repr(C)` placement-new
    /// (`create_in`-style constructors that take `&mut MaybeUninit<Self>`).
    #[inline]
    pub fn as_uninit(&mut self) -> &mut MaybeUninit<T> {
        // SAFETY: `slot` is a unique live pointer into the hive buffer (or a
        // freshly leaked `Box<MaybeUninit<T>>`); the `&mut self` receiver
        // guarantees no other `&mut` to the same `MaybeUninit<T>` exists.
        unsafe { self.slot.as_mut() }
    }

    /// Move `value` into the slot and return the stable initialized pointer.
    /// Consumes the token (its `Drop` does not run).
    #[inline]
    pub fn write(self, value: T) -> NonNull<T> {
        let mut this = ManuallyDrop::new(self);
        NonNull::from(this.as_uninit().write(value))
    }

    /// Caller has fully initialized the slot via [`as_uninit`](Self::as_uninit)
    /// (or by writing through [`addr`](Self::addr)). Consumes the token.
    ///
    /// # Safety
    /// Every field of `T` must be initialized, including padding-adjacent
    /// niches (enum discriminants, `NonNull`, `Box`, `&`). Calling this on a
    /// partially-written slot is the exact UB this type exists to prevent.
    #[inline]
    pub unsafe fn assume_init(self) -> NonNull<T> {
        let this = ManuallyDrop::new(self);
        this.slot.cast::<T>()
    }
}

impl<T, const CAPACITY: usize> Drop for HiveSlot<'_, T, CAPACITY> {
    fn drop(&mut self) {
        if self.owner & 1 == 0 {
            // Inline hive slot: unset the `used` bit and re-poison. Do NOT
            // `drop_in_place` — the slot was never `.write()`n.
            let hive = self.owner as *mut HiveArray<T, CAPACITY>;
            // SAFETY: `owner` was set from `core::ptr::from_mut(self)` in
            // `HiveArray::claim`; the hive is a field of a long-lived owner
            // that has not been moved (structural back-pointer guarantee).
            // No `&mut HiveArray` is live across this drop — `claim()`'s
            // borrow was released when the raw pointer was captured.
            unsafe {
                let index = (*hive)
                    .index_of(self.slot.as_ptr().cast::<T>())
                    .expect("HiveSlot points outside its owning hive");
                asan::poison(self.slot.as_ptr().cast(), size_of::<T>());
                (*hive).used.unset(index as usize);
            }
        } else {
            // Heap fallback slot: reclaim the `Box<MaybeUninit<T>>` allocation.
            // `MaybeUninit<T>` has no drop glue, so this deallocates without
            // touching `T`.
            // SAFETY: `slot` was produced by `Box::leak(Box::<MaybeUninit<T>>::new_uninit())`
            // in `Fallback::claim` and has not been freed.
            drop(unsafe { Box::from_raw(self.slot.as_ptr()) });
        }
    }
}

// PORT NOTE: In Zig this was the nested type `HiveArray(T, capacity).Fallback`.
// Rust cannot nest a generic struct that captures outer generics, so it lives at
// module scope with the same parameters. The Zig field
// `hive: if (capacity > 0) Self else void` is always materialized here; the
// `CAPACITY > 0` checks below preserve the original gating.
// PERF(port): zero-capacity case carried a zero-size hive in Zig — profile in Phase B.
pub struct Fallback<T, const CAPACITY: usize> {
    pub hive: HiveArray<T, CAPACITY>,
    // PORT NOTE: `std.mem.Allocator param` dropped — global mimalloc.
}

impl<T, const CAPACITY: usize> Fallback<T, CAPACITY> {
    pub const fn init() -> Self {
        Self {
            hive: HiveArray::init(),
        }
    }

    /// See [`HiveArray::get`] — same UB hazards, plus the heap path leaks a
    /// `Box<MaybeUninit<T>>` if the caller early-returns before `ptr::write`.
    #[deprecated = "returns *mut T to uninitialized memory; use get_init / emplace / claim"]
    pub fn get(&mut self) -> *mut T {
        // Forget the token so its `Drop` does not release the slot — legacy
        // callers expect the slot to remain claimed until their later `put()`.
        ManuallyDrop::new(self.claim()).addr().as_ptr()
    }

    #[deprecated = "returns *mut T to uninitialized memory; use get_init / emplace / claim"]
    pub fn get_and_see_if_new(&mut self, new: &mut bool) -> *mut T {
        if CAPACITY > 0 {
            #[allow(deprecated)]
            if let Some(value) = self.hive.get() {
                *new = false;
                return value;
            }
        }

        bun_core::heap::into_raw(Box::<T>::new_uninit()).cast::<T>()
    }

    #[deprecated = "returns *mut T to uninitialized memory; use get_init / emplace / claim"]
    pub fn try_get(&mut self) -> *mut T {
        ManuallyDrop::new(self.claim()).addr().as_ptr()
    }

    /// One-shot claim + write. Preferred entry point — no uninit window.
    /// Infallible: spills to a heap `Box<T>` when the inline hive is full.
    #[inline]
    pub fn get_init(&mut self, value: T) -> NonNull<T> {
        self.claim().write(value)
    }

    /// See [`HiveArray::emplace`]. Infallible (heap fallback).
    #[inline]
    pub fn emplace(&mut self, init: impl FnOnce(NonNull<T>) -> T) -> NonNull<T> {
        let slot = self.claim();
        let addr = slot.addr();
        slot.write(init(addr))
    }

    /// See [`HiveArray::claim`]. Infallible: when the inline hive is full,
    /// the returned token owns a freshly-allocated heap slot (tagged so its
    /// `Drop` deallocates without running `T::drop`).
    pub fn claim(&mut self) -> HiveSlot<'_, T, CAPACITY> {
        if CAPACITY > 0 {
            if let Some(slot) = self.hive.claim() {
                return slot;
            }
        }
        let slot = NonNull::from(Box::leak(Box::<T>::new_uninit()));
        HiveSlot {
            slot,
            // Low bit 1 ⇒ heap slot. The hive pointer is not needed on the
            // release path (dealloc is `Box::from_raw(slot)`).
            owner: 1,
            _marker: PhantomData,
        }
    }

    /// Recycle a slot **without** running `T::drop`. Counterpart to
    /// [`HiveArray::put_raw`] for the heap-fallback path.
    ///
    /// # Safety
    /// `value` must have been obtained from this `Fallback` (via `get_init` /
    /// `emplace` / `claim().write()` / the deprecated `get` family) and not
    /// yet returned. The contained `T` is **not** dropped — caller must have
    /// already moved out / destructured anything with drop glue, or `T` must
    /// be POD.
    pub unsafe fn put_raw(&mut self, value: *mut T) {
        if CAPACITY > 0 {
            if self.hive.put_raw(value) {
                return;
            }
        }
        // SAFETY: caller contract — `value` is a heap slot from `claim()` /
        // `get()`; it was allocated as `Box<MaybeUninit<T>>` (same layout as
        // `Box<T>`). Reclaiming as `MaybeUninit<T>` deallocates without
        // running `T::drop`.
        drop(unsafe { Box::from_raw(value.cast::<MaybeUninit<T>>()) });
    }

    pub fn r#in(&self, value: *const T) -> bool {
        if CAPACITY > 0 {
            if self.hive.r#in(value) {
                return true;
            }
        }

        false
    }

    /// Return a slot to the pool, dropping the contained `T`.
    ///
    /// # Safety
    /// `value` must point to a fully-initialized `T` previously obtained from
    /// [`get`](Self::get) / [`get_and_see_if_new`](Self::get_and_see_if_new) /
    /// [`try_get`](Self::try_get) on this `Fallback` and subsequently written
    /// by the caller.
    pub unsafe fn put(&mut self, value: *mut T) {
        if CAPACITY > 0 {
            // SAFETY: caller contract — `value` is fully initialized.
            if unsafe { self.hive.put(value) } {
                return;
            }
        }

        // SAFETY: `value` was produced by `heap::into_raw(Box::<T>::new_uninit())`
        // in `get_impl`/`get_and_see_if_new`/`try_get` above (it is not in the
        // hive), and the caller has since fully initialized it. `destroy`
        // reconstructs the `Box<T>` and runs `T::drop`.
        unsafe { bun_core::heap::destroy(value) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HiveRef
// ──────────────────────────────────────────────────────────────────────────
//
// PORT NOTE: ground truth is `bun.HiveRef` in src/bun.zig. It lives here (not
// in the `bun` crate) because every consumer names it through
// `bun_collections::HiveRef`, and its only collaborator is `Fallback` above.
//
// Zig defines `const HiveAllocator = HiveArray(@This(), capacity).Fallback`
// inside the returned struct; Rust spells the self-referential pool type out
// as `Fallback<HiveRef<T, CAPACITY>, CAPACITY>`. CAPACITY is `usize` (widened
// from Zig's `u16`) to line up with `HiveArray`/`Fallback`'s const generic.

/// Intrusive ref-counted slot allocated from a `HiveArray::Fallback` pool.
/// `pool` is a BACKREF (LIFETIMES.tsv class) — the pool strictly outlives
/// every `HiveRef` it hands out, so a raw pointer is the honest mapping.
#[repr(C)]
pub struct HiveRef<T, const CAPACITY: usize> {
    pub ref_count: u32,
    pub pool: *mut Fallback<HiveRef<T, CAPACITY>, CAPACITY>,
    pub value: T,
}

/// Convenience alias mirroring Zig's nested `const HiveAllocator`.
pub type HiveAllocator<T, const CAPACITY: usize> = Fallback<HiveRef<T, CAPACITY>, CAPACITY>;

impl<T, const CAPACITY: usize> HiveRef<T, CAPACITY> {
    /// Zig: `pub fn init(value, allocator) !*@This()`.
    ///
    /// # Safety
    /// `pool` must be valid for the entire lifetime of the returned
    /// `HiveRef` (i.e. until its `ref_count` drops to zero and it is `put`
    /// back). Callers hold the pool in a long-lived owner (e.g. `VirtualMachine`).
    pub unsafe fn init(value: T, pool: *mut Fallback<Self, CAPACITY>) -> *mut Self {
        // SAFETY: caller contract — `pool` is dereferenceable.
        unsafe { (*pool).get_init(HiveRef { ref_count: 1, pool, value }).as_ptr() }
    }

    pub fn ref_(&mut self) -> &mut Self {
        self.ref_count += 1;
        self
    }

    /// Zig: `pub fn unref(this) ?*@This()` — returns `null` when the count hit
    /// zero and the slot was returned to the pool.
    pub fn unref(&mut self) -> Option<&mut Self> {
        let ref_count = self.ref_count;
        self.ref_count = ref_count - 1;
        if ref_count == 1 {
            let pool = self.pool;
            // SAFETY: `self` was produced by `init` above, so `pool` is the
            // pool that owns this slot and is still live (caller contract on
            // `init`). Zig's `if @hasDecl(T, "deinit") this.value.deinit()` maps
            // to `T::drop`, which `Fallback::put` now runs (it drops the whole
            // `HiveRef` in place before recycling/freeing the slot).
            unsafe {
                (*pool).put(std::ptr::from_mut::<Self>(self));
            }
            return None;
        }
        Some(self)
    }
}

#[cfg(test)]
#[allow(deprecated)]
mod tests {
    use super::*;

    #[test]
    fn hive_array() {
        const SIZE: usize = 64;

        // Choose an integer with a weird alignment
        // PORT NOTE: Zig used `u127`; Rust has no arbitrary-width ints. `u128` is the closest.
        type Int = u128;

        let mut a = HiveArray::<Int, SIZE>::init();

        {
            let b = a.get().unwrap();
            // SAFETY: `b` points into `a.buffer` and was just unpoisoned by `get()`.
            unsafe { *b = 0 };
            assert!(a.get().unwrap() != b);
            assert_eq!(a.index_of(b), Some(0));
            // SAFETY: `b` is a fully-initialized hive slot.
            assert!(unsafe { a.put(b) });
            assert!(a.get().unwrap() == b);
            let c = a.get().unwrap();
            // SAFETY: `c` points into `a.buffer` and was just unpoisoned by `get()`.
            unsafe { *c = 123 };
            let mut d: Int = 12345;
            // SAFETY: `&mut d` is foreign — `put` returns `false` and drops nothing.
            assert!(unsafe { a.put(&mut d) } == false);
            assert!(a.r#in(&d) == false);
        }

        a.used = IntegerBitSet::init_empty();
        {
            for i in 0..SIZE {
                let b = a.get().unwrap();
                // SAFETY: `b` points into `a.buffer` and was just unpoisoned by `get()`.
                unsafe { *b = 0 };
                assert_eq!(a.index_of(b), Some(u32::try_from(i).expect("int cast")));
                // SAFETY: `b` is a fully-initialized hive slot.
                assert!(unsafe { a.put(b) });
                assert!(a.get().unwrap() == b);
            }
            for _ in 0..SIZE {
                assert!(a.get().is_none());
            }
        }
    }

    #[test]
    fn hive_slot_drop_releases_without_dtor() {
        use core::sync::atomic::{AtomicU32, Ordering};
        static DROPS: AtomicU32 = AtomicU32::new(0);
        struct D(#[allow(dead_code)] u64);
        impl Drop for D {
            fn drop(&mut self) { DROPS.fetch_add(1, Ordering::Relaxed); }
        }

        let mut a = HiveArray::<D, 4>::init();
        // Dropped token releases the slot without running D::drop.
        drop(a.claim().unwrap());
        assert!(!a.used.is_set(0));
        assert_eq!(DROPS.load(Ordering::Relaxed), 0);

        // write() commits and put() drops.
        let p = a.get_init(D(7)).unwrap();
        assert!(a.used.is_set(0));
        assert_eq!(DROPS.load(Ordering::Relaxed), 0);
        // SAFETY: `p` is a fully-initialized hive slot.
        unsafe { a.put(p.as_ptr()) };
        assert_eq!(DROPS.load(Ordering::Relaxed), 1);

        // put_raw() does not drop.
        let p = a.get_init(D(8)).unwrap();
        assert!(a.put_raw(p.as_ptr()));
        assert_eq!(DROPS.load(Ordering::Relaxed), 1);

        // Fallback heap path: dropped token deallocates without D::drop.
        let mut f = Fallback::<D, 0>::init();
        drop(f.claim());
        assert_eq!(DROPS.load(Ordering::Relaxed), 1);
        let p = f.get_init(D(9));
        // SAFETY: heap slot from this Fallback.
        unsafe { f.put(p.as_ptr()) };
        assert_eq!(DROPS.load(Ordering::Relaxed), 2);
    }
}

// ported from: src/collections/hive_array.zig
