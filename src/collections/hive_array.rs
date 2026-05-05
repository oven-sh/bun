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
        let start = self.buffer.as_ptr() as *const T;
        // SAFETY: one-past-the-end pointer of `buffer`.
        let end = unsafe { start.add(CAPACITY) };
        if !((value as usize) >= (start as usize) && (value as usize) < (end as usize)) {
            return None;
        }

        // aligned to the size of T
        let index = ((value as usize) - (start as usize)) / size_of::<T>();
        debug_assert!(index < CAPACITY);
        debug_assert!(self.buffer[index].as_ptr() as *const T == value);
        Some(u32::try_from(index).unwrap())
    }

    pub fn r#in(&self, value: *const T) -> bool {
        asan::assert_unpoisoned(value.cast::<u8>());
        let start = self.buffer.as_ptr() as *const T;
        // SAFETY: one-past-the-end pointer of `buffer`.
        let end = unsafe { start.add(CAPACITY) };
        (value as usize) >= (start as usize) && (value as usize) < (end as usize)
    }

    pub fn put(&mut self, value: *mut T) -> bool {
        let Some(index) = self.index_of(value) else {
            return false;
        };

        debug_assert!(self.used.is_set(index as usize));
        debug_assert!(self.buffer[index as usize].as_ptr() as *const T == value as *const T);

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
    // PORT NOTE: `allocator: std.mem.Allocator` dropped — global mimalloc.
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
        Box::into_raw(Box::<T>::new_uninit()).cast::<T>()
    }

    pub fn get_and_see_if_new(&mut self, new: &mut bool) -> *mut T {
        if CAPACITY > 0 {
            if let Some(value) = self.hive.get() {
                *new = false;
                return value;
            }
        }

        Box::into_raw(Box::<T>::new_uninit()).cast::<T>()
    }

    pub fn try_get(&mut self) -> Result<*mut T, AllocError> {
        if CAPACITY > 0 {
            if let Some(value) = self.hive.get() {
                return Ok(value);
            }
        }

        // TODO(port): Box::try_new_uninit is nightly-only; Phase B may need a
        // fallible alloc helper in bun_alloc to mirror `try allocator.create(T)`.
        Ok(Box::into_raw(Box::<T>::new_uninit()).cast::<T>())
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

        // SAFETY: `value` was produced by `Box::into_raw(Box::<MaybeUninit<T>>::new_uninit())`
        // in `get_impl`/`get_and_see_if_new`/`try_get` above, since it is not in the hive.
        // The slot is treated as uninitialized (Zig's `allocator.destroy` does not drop).
        drop(unsafe { Box::<MaybeUninit<T>>::from_raw(value.cast()) });
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
                assert_eq!(a.index_of(b), Some(u32::try_from(i).unwrap()));
                assert!(a.put(b));
                assert!(a.get().unwrap() == b);
            }
            for _ in 0..SIZE {
                assert!(a.get().is_none());
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/collections/hive_array.zig (187 lines)
//   confidence: medium
//   todos:      1
//   notes:      CAPACITY widened u16→usize for array/bitset const-generic; Fallback un-nested; try_get needs fallible alloc helper
// ──────────────────────────────────────────────────────────────────────────
