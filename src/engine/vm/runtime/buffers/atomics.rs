//! Sequentially consistent access to single elements.

use core::sync::atomic::Ordering::SeqCst;
use core::sync::atomic::{AtomicU8, AtomicU16, AtomicU32, AtomicU64};

use bun_threading::Guarded;

use super::element::{Bits, Element};
use super::slice::BufferSlice;

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum AtomicOperation {
    Add,
    And,
    Exchange,
    Or,
    Sub,
    Xor,
}

/// The address is that of an aligned integer that can be read and written.
pub trait AtomicBits: Sized {
    /// # Safety
    /// See above. So for all.
    unsafe fn load(address: *mut Self) -> Self;
    unsafe fn store(address: *mut Self, value: Self);
    unsafe fn modify(address: *mut Self, operation: AtomicOperation, operand: Self) -> Self;
    unsafe fn compare_exchange(address: *mut Self, expected: Self, replacement: Self) -> Self;
}

macro_rules! atomic_bits {
    ($($type:ty, $atomic:ty;)*) => {$(
        impl AtomicBits for $type {
            #[inline(always)]
            unsafe fn load(address: *mut $type) -> $type {
                // SAFETY: the caller's.
                unsafe { <$atomic>::from_ptr(address) }.load(SeqCst)
            }

            #[inline(always)]
            unsafe fn store(address: *mut $type, value: $type) {
                // SAFETY: the caller's.
                unsafe { <$atomic>::from_ptr(address) }.store(value, SeqCst);
            }

            #[inline(always)]
            unsafe fn modify(address: *mut $type, operation: AtomicOperation, operand: $type) -> $type {
                // SAFETY: the caller's.
                let atomic = unsafe { <$atomic>::from_ptr(address) };
                match operation {
                    AtomicOperation::Add => atomic.fetch_add(operand, SeqCst),
                    AtomicOperation::And => atomic.fetch_and(operand, SeqCst),
                    AtomicOperation::Exchange => atomic.swap(operand, SeqCst),
                    AtomicOperation::Or => atomic.fetch_or(operand, SeqCst),
                    AtomicOperation::Sub => atomic.fetch_sub(operand, SeqCst),
                    AtomicOperation::Xor => atomic.fetch_xor(operand, SeqCst),
                }
            }

            #[inline(always)]
            unsafe fn compare_exchange(address: *mut $type, expected: $type, replacement: $type) -> $type {
                // SAFETY: the caller's.
                unsafe { <$atomic>::from_ptr(address) }
                    .compare_exchange(expected, replacement, SeqCst, SeqCst)
                    .unwrap_or_else(|found| found)
            }
        }
    )*};
}

atomic_bits! {
    u8, AtomicU8;
    u16, AtomicU16;
    u32, AtomicU32;
    u64, AtomicU64;
}

/// The processor does nothing atomically at an address that is not aligned. Returns the old value.
#[cold]
fn update_under_lock<T: Bits>(element: BufferSlice<'_, T>, new: &dyn Fn(u64) -> Option<u64>) -> T {
    static LOCK: Guarded<()> = Guarded::new(());
    let _lock = LOCK.lock();
    let old = element.at(0);
    if let Some(new) = new(old.into()) {
        element.set(0, T::truncate(new));
    }
    old
}

/// All panic past the end.
impl<T: Element> BufferSlice<'_, T> {
    #[inline(always)]
    fn atomically(
        self,
        index: usize,
        aligned: impl FnOnce(*mut T::Bits) -> T::Bits,
        new: impl Fn(u64) -> Option<u64>,
    ) -> T {
        let element = self.slice(index..index + 1).bits();
        T::from_bits(if element.is_aligned() {
            aligned(element.as_ptr())
        } else {
            update_under_lock(element, &new)
        })
    }

    #[inline(always)]
    pub fn atomic_load(self, index: usize) -> T {
        // SAFETY: what `atomically` passes.
        self.atomically(index, |it| unsafe { AtomicBits::load(it) }, |_| None)
    }

    #[inline(always)]
    pub fn atomic_store(self, index: usize, value: T) {
        let value = value.to_bits();
        let store = |address| {
            // SAFETY: as above.
            unsafe { AtomicBits::store(address, value) };
            value
        };
        self.atomically(index, store, |_| Some(value.into()));
    }

    /// Returns the old value.
    #[inline(always)]
    pub fn atomic_modify(self, index: usize, operation: AtomicOperation, operand: T) -> T {
        let operand = operand.to_bits();
        let wide: u64 = operand.into();
        self.atomically(
            index,
            // SAFETY: as above.
            |address| unsafe { AtomicBits::modify(address, operation, operand) },
            |old| {
                Some(match operation {
                    AtomicOperation::Add => old.wrapping_add(wide),
                    AtomicOperation::And => old & wide,
                    AtomicOperation::Exchange => wide,
                    AtomicOperation::Or => old | wide,
                    AtomicOperation::Sub => old.wrapping_sub(wide),
                    AtomicOperation::Xor => old ^ wide,
                })
            },
        )
    }

    /// Returns the old value.
    #[inline(always)]
    pub fn atomic_compare_exchange(self, index: usize, expected: T, replacement: T) -> T {
        let (expected, replacement) = (expected.to_bits(), replacement.to_bits());
        self.atomically(
            index,
            // SAFETY: as above.
            |address| unsafe { AtomicBits::compare_exchange(address, expected, replacement) },
            |old| (old == expected.into()).then(|| replacement.into()),
        )
    }
}
