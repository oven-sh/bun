//! Memory that the collector may read while this thread writes it.

use core::ptr;
use core::sync::atomic::{AtomicU8, AtomicU64, Ordering, fence};

use crate::engine::Engine;

/// # Safety
/// `place` is aligned and valid, and other threads only read it, atomically.
#[inline]
pub(crate) unsafe fn store(place: *mut u64, word: u64) {
    // SAFETY: the caller's.
    unsafe { AtomicU64::from_ptr(place) }.store(word, Ordering::Relaxed);
}

/// # Safety
/// `place` is aligned, valid and initialized, and is written a word at once.
#[inline]
pub(crate) unsafe fn load(place: *mut u64) -> u64 {
    // SAFETY: the caller's.
    unsafe { AtomicU64::from_ptr(place) }.load(Ordering::Relaxed)
}

impl Engine {
    #[inline]
    pub(crate) fn barrier_threshold(&self) -> u8 {
        let place = ptr::with_exposed_provenance_mut(self.layout().barrier_threshold_address);
        // SAFETY: the host vouches for the address.
        unsafe { AtomicU8::from_ptr(place) }.load(Ordering::Relaxed)
    }

    #[inline]
    fn collector_may_read(&self) -> bool {
        self.barrier_threshold() != 0
    }

    /// Between initializing a cell and storing a reference to it.
    #[inline]
    pub(crate) fn publish_fence(&self) {
        if self.collector_may_read() {
            fence(Ordering::Release);
        }
    }

    /// The ranges may overlap.
    ///
    /// # Safety
    /// As for `store` and `load`, for `count` words.
    #[inline]
    pub(crate) unsafe fn move_words(&self, dst: *mut u64, src: *mut u64, count: usize) {
        if !self.collector_may_read() {
            // SAFETY: the caller's, and no other thread reads.
            return unsafe { ptr::copy(src, dst, count) };
        }
        // SAFETY: the caller's.
        let copy = |index| unsafe { store(dst.add(index), load(src.add(index))) };
        if dst <= src {
            (0..count).for_each(copy);
        } else {
            (0..count).rev().for_each(copy);
        }
    }

    /// Repeats `pattern` `count` times.
    ///
    /// # Safety
    /// As for `store`, for all these words.
    #[inline]
    pub(crate) unsafe fn fill_words<const N: usize>(
        &self,
        dst: *mut u64,
        pattern: [u64; N],
        count: usize,
    ) {
        if !self.collector_may_read() {
            for index in 0..count {
                // SAFETY: the caller's, and no other thread reads.
                unsafe { dst.cast::<[u64; N]>().add(index).write(pattern) };
            }
            return;
        }
        for index in 0..count * N {
            // SAFETY: the caller's.
            unsafe { store(dst.add(index), pattern[index % N]) };
        }
    }
}
