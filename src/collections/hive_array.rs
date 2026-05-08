use core::mem::{size_of, MaybeUninit};

use crate::bit_set::IntegerBitSet;
use bun_alloc::AllocError;
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
            // SAFETY: an array of MaybeUninit needs no initialization.
            buffer: unsafe { MaybeUninit::uninit().assume_init() },
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
        // SAFETY: one-past-the-end pointer of `buffer`.
        let end = unsafe { start.add(CAPACITY) };
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
        // SAFETY: one-past-the-end pointer of `buffer`.
        let end = unsafe { start.add(CAPACITY) };
        (value as usize) >= (start as usize) && (value as usize) < (end as usize)
    }

    pub fn put(&mut self, value: *mut T) -> bool {
        let Some(index) = self.index_of(value) else {
            return false;
        };

        debug_assert!(self.used.is_set(index as usize));
        debug_assert!(self.buffer[index as usize].as_ptr().cast::<T>() == value.cast_const());

        // PORT NOTE: Zig wrote `value.* = undefined;`. T has no destructor in Zig;
        // the slot is simply marked logically uninitialized again.
        // SAFETY: `value` points to `size_of::<T>` bytes within `buffer`.
        unsafe { asan::poison(value.cast(), size_of::<T>()) };

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

    pub fn try_get(&mut self) -> Result<*mut T, AllocError> {
        if CAPACITY > 0 {
            if let Some(value) = self.hive.get() {
                return Ok(value);
            }
        }

        // TODO(port): Box::try_new_uninit is nightly-only; Phase B may need a
        // fallible alloc helper in bun_alloc to mirror `try allocator.create(T)`.
        Ok(bun_core::heap::into_raw(Box::<T>::new_uninit()).cast::<T>())
    }

    pub fn r#in(&self, value: *const T) -> bool {
        if CAPACITY > 0 {
            if self.hive.r#in(value) {
                return true;
            }
        }

        false
    }

    pub fn put(&mut self, value: *mut T) {
        if CAPACITY > 0 {
            if self.hive.put(value) {
                return;
            }
        }

        // SAFETY: `value` was produced by `heap::into_raw(Box::<T>::new_uninit())`
        // in `get_impl`/`get_and_see_if_new`/`try_get` above, since it is not in the hive.
        // The slot is treated as uninitialized (Zig's `allocator.destroy` does not drop).
        unsafe { bun_core::heap::destroy(value.cast::<MaybeUninit<T>>()) };
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
    pub unsafe fn init(
        value: T,
        pool: *mut Fallback<Self, CAPACITY>,
    ) -> Result<*mut Self, AllocError> {
        // SAFETY: caller contract — `pool` is dereferenceable.
        let this = unsafe { (*pool).try_get()? };
        // SAFETY: `try_get` returns an uninitialized slot; we fully initialize it.
        unsafe {
            core::ptr::write(this, HiveRef { ref_count: 1, pool, value });
        }
        Ok(this)
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
            // to dropping `value` in place; `Fallback::put` then poisons/recycles
            // the slot without running any destructor.
            unsafe {
                core::ptr::drop_in_place(core::ptr::addr_of_mut!(self.value));
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
            assert!(a.get().unwrap() != b);
            assert_eq!(a.index_of(b), Some(0));
            assert!(a.put(b));
            assert!(a.get().unwrap() == b);
            let c = a.get().unwrap();
            // SAFETY: `c` points into `a.buffer` and was just unpoisoned by `get()`.
            unsafe { *c = 123 };
            let mut d: Int = 12345;
            assert!(a.put(&mut d) == false);
            assert!(a.r#in(&d) == false);
        }

        a.used = IntegerBitSet::init_empty();
        {
            for i in 0..SIZE {
                let b = a.get().unwrap();
                assert_eq!(a.index_of(b), Some(u32::try_from(i).expect("int cast")));
                assert!(a.put(b));
                assert!(a.get().unwrap() == b);
            }
            for _ in 0..SIZE {
                assert!(a.get().is_none());
            }
        }
    }
}

// ported from: src/collections/hive_array.zig
