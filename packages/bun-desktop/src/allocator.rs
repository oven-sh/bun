//! Bun's allocator: the one that it lends, or else the system's.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::OnceLock;

use crate::bun::abi;

static LENT: OnceLock<&'static abi::Allocator> = OnceLock::new();

/// Before anything is allocated.
#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_set_allocator(allocator: &'static abi::Allocator) {
    LENT.set(allocator).ok();
}

pub struct Allocator;

pub fn release_memory() {
    if let Some(lent) = LENT.get() {
        (lent.release)();
    }
}

// SAFETY: which of them it is does not change once something is allocated.
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        match LENT.get() {
            Some(lent) => (lent.allocate)(layout.size(), layout.align()).cast(),
            // SAFETY: the caller's contract.
            None => unsafe { System.alloc(layout) },
        }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        match LENT.get() {
            Some(lent) => (lent.allocate_zeroed)(layout.size(), layout.align()).cast(),
            // SAFETY: the caller's contract.
            None => unsafe { System.alloc_zeroed(layout) },
        }
    }

    unsafe fn dealloc(&self, start: *mut u8, layout: Layout) {
        // SAFETY: the caller's contract.
        unsafe {
            match LENT.get() {
                Some(lent) => (lent.free)(start.cast()),
                None => System.dealloc(start, layout),
            }
        }
    }

    unsafe fn realloc(&self, start: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        // SAFETY: the caller's contract.
        unsafe {
            match LENT.get() {
                Some(lent) => (lent.reallocate)(start.cast(), size, layout.align()).cast(),
                None => System.realloc(start, layout, size),
            }
        }
    }
}
