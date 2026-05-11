use core::mem::{size_of, MaybeUninit};

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

    pub fn get(&mut self) -> *mut T {
        let value = self.get_impl();
        value
    }

    fn get_impl(&mut self) -> *mut T {
        if CAPACITY > 0 {
            if let Some(value) = self.hive.get() {
                return value;
            }
        }

        // `allocator.create(T)` returns uninitialized `*T`.
        bun_core::heap::into_raw(Box::<T>::new_uninit()).cast::<T>()
    }

    pub fn get_and_see_if_new(&mut self, new: &mut bool) -> *mut T {
        if CAPACITY > 0 {
            if let Some(value) = self.hive.get() {
                *new = false;
                return value;
            }
        }

        bun_core::heap::into_raw(Box::<T>::new_uninit()).cast::<T>()
    }

    pub fn try_get(&mut self) -> *mut T {
        if CAPACITY > 0 {
            if let Some(value) = self.hive.get() {
                return value;
            }
        }

        bun_core::heap::into_raw(Box::<T>::new_uninit()).cast::<T>()
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
        let this = unsafe { (*pool).try_get() };
        // SAFETY: `try_get` returns an uninitialized slot; we fully initialize it.
        unsafe {
            core::ptr::write(this, HiveRef { ref_count: 1, pool, value });
        }
        this
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
}

// ported from: src/collections/hive_array.zig
